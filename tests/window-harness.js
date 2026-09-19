/**
 * 端到端验证「签到时段过滤」真的会跳过对应课程。
 *
 * 做法：预置 signin-windows.json，给两门课写入「凌晨 03:00 发签到」的样本，
 * 当前时刻不在该窗口内、也不是兜底扫描小时 → 这两门课这一轮不应被请求，
 * 而其它课（无样本 → 全天轮询）应照常被请求。
 */
process.env.NO_OPEN_BROWSER = '1'
process.env.CONFIG_FILE = 'config.windowtest.yaml'

const fs = require('fs')
const path = require('path')
const axios = require('axios')
const { execFileSync } = require('child_process')

const PORT = 3459
const origGet = axios.get.bind(axios)
const LOG = []
const log = (...a) => { const s = a.join(' '); LOG.push(s); console.log(s) }

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
  // 1) 生成独立配置：关闭 smartPoll、缩小间隔、把兜底小时设到当前不会命中的值
  fs.rmSync('config.windowtest.yaml', { force: true })
  fs.rmSync('data-windowtest', { recursive: true, force: true })
  const YAML = require('yaml')
  const c = YAML.parse(fs.readFileSync('config.yaml', 'utf-8'))
  c.web = { ...(c.web || {}), port: PORT }
  c.storage = { ...(c.storage || {}), dataDir: './data-windowtest' }
  c.listener = { ...(c.listener || {}), pollInterval: 8000, pollJitter: 0 }
  c.smartPoll = { ...(c.smartPoll || {}), enabled: false }
  c.report = { ...(c.report || {}), enabled: false, weekly: false }
  c.preCheck = { ...(c.preCheck || {}), enabled: false }
  const nowHour = new Date().getHours()
  // 兜底小时选一个"不是当前小时"的值，否则兜底放行会掩盖窗口过滤效果
  const sweepHour = (nowHour + 5) % 24
  c.signinWindow = { enabled: true, padMinutes: 15, sweepHour }
  fs.writeFileSync('config.windowtest.yaml', YAML.stringify(c), 'utf-8')
  fs.mkdirSync('data-windowtest', { recursive: true })

  // 2) 先取课程列表（用真实接口），拿到前两门课的 courseId
  const { decryptPassword, isEncrypted } = require('../build/utils/crypto.js')
  const rawData = JSON.parse(fs.readFileSync('data/superstar-data.json', 'utf-8').replace(/^\uFEFF/, ''))
  let cookie = rawData['cookie_19847671589'] || ''
  if (isEncrypted(cookie)) cookie = decryptPassword(cookie) || ''
  const cr = await origGet('https://mooc1-api.chaoxing.com/mycourse/backclazzdata', {
    headers: { Cookie: cookie, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' },
    params: { view: 'json', rss: 1, pageIndex: 1, pageSize: 100 }, timeout: 20000,
  })
  const active = (cr.data.channelList || []).filter(ch => ch.content?.isretire !== 1 && ch.content?.course?.data?.[0])
  if (active.length < 3) { log('可用课程不足，无法测试'); process.exit(1) }
  const atNight = active.slice(0, 2).map(ch => String(ch.key))
  const noSample = active.slice(2).map(ch => String(ch.key))
  log(`当前 ${nowHour} 点，兜底扫描小时设为 ${sweepHour}（刻意避开当前小时）`)
  log(`预置「凌晨 03:00 发签到」样本的课程: ${atNight.join(', ')}`)
  log(`无样本（应全天轮询）的课程数: ${noSample.length}`)

  // 3) 预置时段数据：给前两门课写 03:00 的样本（≥4 次才会生效）
  const samples = []
  for (let i = 1; i <= 5; i++) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(3, 0, 0, 0)
    samples.push(d.getTime())
  }
  const winData = {}
  for (const id of atNight) winData[id] = { samples: [...samples], updatedAt: Date.now() }
  fs.writeFileSync('data-windowtest/signin-windows.json', JSON.stringify(winData, null, 2), 'utf-8')
  log(`已写入 data-windowtest/signin-windows.json（${atNight.length} 门课，各 5 次样本）`)

  // 4) 启动服务
  log('\n启动被测服务...')
  require('../build/index.js')

  const token = () => (fs.readFileSync('config.windowtest.yaml', 'utf-8').match(/^ {2}token: (.+)$/m) || [])[1]?.trim() || ''
  for (let i = 0; i < 45; i++) {
    await new Promise(r => setTimeout(r, 1000))
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(3000) })
      if (r.status !== 200) continue
      const s = await fetch(`http://127.0.0.1:${PORT}/api/status?token=${encodeURIComponent(token())}`, { signal: AbortSignal.timeout(5000) })
      const j = await s.json()
      if ((j.courses || []).length > 0) break
    } catch { /* 继续等 */ }
  }
  const st = await (await fetch(`http://127.0.0.1:${PORT}/api/status?token=${encodeURIComponent(token())}`)).json()
  log(`服务就绪，可监听 ${st.courses.length} 门`)
  const wins = st.signinWindows || {}
  for (const id of atNight) log(`  时段表[${id}] = ${JSON.stringify(wins[id])}`)

  // 5) 观察若干轮
  polled.clear()
  await new Promise(r => setTimeout(r, 26000))
  const hitNight = atNight.filter(id => polled.has(id))
  const hitNoSample = noSample.filter(id => polled.has(id))

  log('\n=== 结果 ===')
  log(`  被请求的课程总数: ${polled.size}`)
  log(`  设了凌晨窗口的课是否被请求: ${hitNight.length === 0 ? '否 ✅（窗口外正确跳过）' : '是 ❌ ' + hitNight.join(',')}`)
  log(`  无样本的课是否被请求: ${hitNoSample.length}/${noSample.length} ${hitNoSample.length === noSample.length ? '✅（未限制）' : '⚠ 部分未被请求'}`)
  const pass = hitNight.length === 0 && hitNoSample.length === noSample.length
  log(pass ? '\n✅ 时段过滤按预期工作' : '\n❌ 时段过滤未按预期工作')

  fs.writeFileSync(path.join('data-windowtest', 'report.log'), LOG.join('\n') + '\n', 'utf-8')
  process.exit(pass ? 0 : 1)
})().catch(e => { console.log('异常:', e.message); process.exit(1) })
