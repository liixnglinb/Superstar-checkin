/**
 * 课表功能端到端验证：
 *   ① 未填满时保存必须被拒绝（并在提示里说清"否则只能手动签到"）
 *   ② 按最近签到时间自动填充能生成建议
 *   ③ 填满后保存成功
 *   ④ 保存后轮询只扫「当前这一节」排的那门课（这是课表的核心作用）
 */
process.env.NO_OPEN_BROWSER = '1'
process.env.CONFIG_FILE = 'config-tt.yaml'

const fs = require('fs')
const path = require('path')
const axios = require('axios')

const PORT = 3460
const origGet = axios.get.bind(axios)
const LOG = []
const log = (...a) => { const s = a.join(' '); LOG.push(s); console.log(s) }

// 统计每门课被请求次数
const polled = new Map()
axios.get = async function (url, cfg = {}) {
  if (typeof url === 'string' && url.includes('/v2/apis/active/student/activelist')) {
    const cid = String(cfg.params?.courseId || '?')
    polled.set(cid, (polled.get(cid) || 0) + 1)
    return { data: { result: 1, data: { activeList: [] } } }
  }
  return origGet(url, cfg)
}

;(async () => {
  fs.rmSync('config-tt.yaml', { force: true })
  fs.rmSync('data-tt', { recursive: true, force: true })
  const YAML = require('yaml')
  const c = YAML.parse(fs.readFileSync('config.yaml', 'utf-8'))
  c.web = { ...(c.web || {}), port: PORT }
  c.storage = { ...(c.storage || {}), dataDir: './data-tt' }
  c.listener = { ...(c.listener || {}), pollInterval: 6000, pollJitter: 0 }
  c.smartPoll = { ...(c.smartPoll || {}), enabled: false }
  c.report = { ...(c.report || {}), enabled: false, weekly: false }
  c.preCheck = { ...(c.preCheck || {}), enabled: false }
  fs.writeFileSync('config-tt.yaml', YAML.stringify(c), 'utf-8')
  fs.mkdirSync('data-tt', { recursive: true })

  // 预置签到观测：把 3 门课分别放在「今天当前这一节的相邻节次」之外的时刻，
  // 便于验证自动填充能推断出日期与节次
  const { decryptPassword, isEncrypted } = require('../build/utils/crypto.js')
  const rawData = JSON.parse(fs.readFileSync('data/superstar-data.json', 'utf-8').replace(/^\uFEFF/, ''))
  let cookie = rawData['cookie_19847671589'] || ''
  if (isEncrypted(cookie)) cookie = decryptPassword(cookie) || ''
  const cr = await origGet('https://mooc1-api.chaoxing.com/mycourse/backclazzdata', {
    headers: { Cookie: cookie, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' },
    params: { view: 'json', rss: 1, pageIndex: 1, pageSize: 100 }, timeout: 20000,
  })
  const active = (cr.data.channelList || []).filter(ch => ch.content?.isretire !== 1 && ch.content?.course?.data?.[0])
  const ids = active.map(ch => String(ch.key))
  log(`可监听课程 ${ids.length} 门`)

  const now = new Date()
  const today = now.getDay() // 可能落在周末
  const mkTimes = (dow, hh, mm) => {
    const arr = []
    for (let i = 0; i < 3; i++) {
      const d = new Date()
      d.setDate(d.getDate() - 7 * i)
      d.setDate(d.getDate() - d.getDay() + dow)
      d.setHours(hh, mm, 0, 0)
      arr.push(d.getTime())
    }
    return arr
  }
  const seed = {}
  seed[ids[0]] = { samples: mkTimes(1, 10, 5), updatedAt: Date.now() }   // 周一第3节 10:00-11:15
  seed[ids[1]] = { samples: mkTimes(3, 15, 50), updatedAt: Date.now() }  // 周三第6节 15:45-17:30
  fs.writeFileSync('data-tt/signin-windows.json', JSON.stringify(seed, null, 2), 'utf-8')
  log(`已预置 ${Object.keys(seed).length} 门课的签到时间观测（周一 10:05、周三 15:50）`)
  log(`今天是周${today}，当前 ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`)

  log('\n启动被测服务...')
  require('../build/index.js')

  const tok = () => (fs.readFileSync('config-tt.yaml', 'utf-8').match(/^ {2}token: (.+)$/m) || [])[1]?.trim() || ''
  const api = async (p, body) => {
    const url = `http://127.0.0.1:${PORT}${p}${p.includes('?') ? '&' : '?'}token=${encodeURIComponent(tok())}`
    const init = { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' } }
    if (body !== undefined) init.body = JSON.stringify(body)
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) })
    return r.json()
  }
  for (let i = 0; i < 45; i++) {
    await new Promise(r => setTimeout(r, 1000))
    try {
      const h = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(3000) })
      if (h.status !== 200) continue
      const s = await api('/api/status')
      if ((s.courses || []).length > 0) break
    } catch { /* 继续等 */ }
  }

  // ① 课表结构 + 未填满状态
  const tt = await api('/api/timetable')
  log(`\n=== ① 读取课表 ===`)
  log(`  ok=${tt.ok} 节次数=${(tt.slots || []).length} 星期数=${(tt.weekdays || []).length} 可填课程=${(tt.courses || []).length}`)
  log(`  完整度: ${tt.status?.filled}/${tt.status?.total} complete=${tt.status?.complete}`)
  const pass1 = tt.ok && tt.slots.length === 8 && tt.weekdays.length === 5 && tt.status.complete === false

  // ② 自动填充建议
  const sug = await api('/api/timetable/suggest', {})
  log(`\n=== ② 自动填充建议 ===`)
  log(`  ok=${sug.ok} 生成格数=${sug.filled}`)
  ;(sug.details || []).forEach(d => log(`    ${d.courseName} → 周${d.weekday} 第${d.slot + 1} 节（依据 ${d.from}）`))
  const pass2 = sug.ok && sug.filled >= 2

  // ③ 未填满保存必须被拒绝
  const badSave = await api('/api/timetable/save', { table: sug.table })
  log(`\n=== ③ 未填满就保存 ===`)
  log(`  ok=${badSave.ok}（应为 false）`)
  log(`  message=${badSave.message}`)
  const pass3 = badSave.ok === false && /填完|手动签到/.test(badSave.message || '')

  // ④ 填满后保存
  const full = {}
  for (const d of (tt.weekdays || [])) {
    full[String(d.value)] = (tt.slots || []).map(() => ids[0]) // 全部填同一门课，仅为验证保存逻辑
  }
  const okSave = await api('/api/timetable/save', { table: full })
  log(`\n=== ④ 填满后保存 ===`)
  log(`  ok=${okSave.ok}（应为 true）`)
  log(`  message=${okSave.message}`)
  const pass4 = okSave.ok === true

  // ⑤ 保存后：只扫当前这一节排的课
  polled.clear()
  await new Promise(r => setTimeout(r, 20000))
  const scanned = Array.from(polled.keys())
  const nowSlot = (() => {
    const mins = new Date().getHours() * 60 + new Date().getMinutes()
    const s = (tt.slots || []).find(x => {
      const [sh, sm] = String(x.startText).split(':').map(Number)
      const [eh, em] = String(x.endText).split(':').map(Number)
      return mins >= sh * 60 + sm && mins < eh * 60 + em
    })
    return s ? s.index : -1
  })()
  const dow = new Date().getDay()
  const inWindow = dow >= 1 && dow <= 5 && nowSlot >= 0
  log(`\n=== ⑤ 按课表扫描 ===`)
  log(`  今天周${dow}，当前节次=${nowSlot}（${inWindow ? '在扫描时段内' : '不在扫描时段'}）`)
  log(`  这一轮被请求的课程: ${scanned.length ? scanned.join(',') : '（无）'}`)
  const pass5 = inWindow
    ? (scanned.length === 1 && scanned[0] === ids[0])
    : scanned.length === 0
  log(`  期望: ${inWindow ? '只扫课表这一节排的 ' + ids[0] : '不扫任何课程'}`)

  log('\n=== 结论 ===')
  log(`  ① 课表结构与未填状态     : ${pass1 ? '✅' : '❌'}`)
  log(`  ② 自动填充生成建议       : ${pass2 ? '✅' : '❌'}`)
  log(`  ③ 未填满拒绝保存并提示   : ${pass3 ? '✅' : '❌'}`)
  log(`  ④ 填满后保存成功         : ${pass4 ? '✅' : '❌'}`)
  log(`  ⑤ 只扫课表当节排的课     : ${pass5 ? '✅' : '❌'}`)
  const all = pass1 && pass2 && pass3 && pass4 && pass5
  log(all ? '\n✅ 课表功能全部按预期工作' : '\n❌ 有环节未通过，见上')

  fs.writeFileSync(path.join('data-tt', 'report.log'), LOG.join('\n') + '\n', 'utf-8')
  process.exit(all ? 0 : 1)
})().catch(e => { console.log('异常:', e.message, e.stack); process.exit(1) })
