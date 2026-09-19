/**
 * 验证「监听开关 / 逐课开关 / 恢复」真的能停止对学习通的请求（不能只看 UI 状态）。
 *
 * 做法：启动被测服务（独立端口与数据目录），统计打到 activelist 的请求按 courseId 归类，
 * 依次切换开关并对比请求集合。
 */
process.env.NO_OPEN_BROWSER = '1'
process.env.CONFIG_FILE = 'config.switchtest.yaml'

const fs = require('fs')
const path = require('path')
const axios = require('axios')

const SMOKE_PORT = 3458
const origGet = axios.get.bind(axios)

const LOG = []
const log = (...a) => { const s = a.join(' '); LOG.push(s); console.log(s) }

// 统计每个 courseId 被请求的次数
const polled = new Map()
let pollingEnabled = true

axios.get = async function (url, cfg = {}) {
  if (typeof url === 'string' && url.includes('/v2/apis/active/student/activelist')) {
    const cid = String(cfg.params?.courseId || '?')
    if (pollingEnabled) polled.set(cid, (polled.get(cid) || 0) + 1)
    return { data: { result: 1, data: { activeList: [] } } }
  }
  return origGet(url, cfg)
}

function reset() { polled.clear() }
const snapshot = () => new Set(polled.keys())

;(async () => {
  // 用独立脚本生成测试配置（并回读校验），避免本文件里再写一份易错的生成逻辑。
  // 注意：此前用 node -e 内联生成时，PowerShell 会吞掉脚本参数，导致配置没生成、
  // 服务退回默认 config.yaml（端口 3456 + 空账号），测试表现为「课程 0 门」而误判。
  const { execFileSync } = require('child_process')
  fs.rmSync('config.switchtest.yaml', { force: true })
  fs.rmSync('data-switchtest', { recursive: true, force: true })
  const genOut = execFileSync(process.execPath, [path.join(__dirname, 'make-switchtest-config.js')], { encoding: 'utf-8' })
  log(genOut.trim().split('\n').map(l => '  [生成] ' + l).join('\n'))
  fs.mkdirSync('data-switchtest', { recursive: true })
  /** 等一轮轮询：间隔 8 秒，留 2 轮余量 */
  const ROUND_WAIT = 17000

  log('启动被测服务...')
  require('../build/index.js')

  const tok = () => (fs.readFileSync('config.switchtest.yaml', 'utf-8').match(/^ {2}token: (.+)$/m) || [])[1]?.trim() || ''
  const api = async (p, body) => {
    try {
      // 用 fetch 而不是 axios：本 harness 覆写了 axios.get 用来统计轮询请求，
      // 复用它发 POST 会被打乱（实测拿到 404，换成 fetch 后同样端点正常 200）。
      const url = `http://127.0.0.1:${SMOKE_PORT}${p}${p.includes('?') ? '&' : '?'}token=${encodeURIComponent(tok())}`
      const init = { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' } }
      if (body !== undefined) init.body = JSON.stringify(body)
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) })
      return await r.json()
    } catch (e) {
      // 必须兜住：调用方没有 try/catch，一次失败就会变成未处理的 Promise 拒绝
      // 把整个 harness 打挂（表现为"跑到某一步就没输出了"）
      const msg = `API ${p} 失败: ${e.message}`
      log('  ⚠ ' + msg)
      LOG.push('⚠ ' + msg)
      return { ok: false, message: msg }
    }
  }
  const wait = ms => new Promise(r => setTimeout(r, ms))

  // 等就绪：注意 /health 在「课程拉取之前」就返回 ok（它属于早期启动的服务），
  // 此时 status.courses 还是空数组，直接读会得到 0 门课而误判（已踩过一次）。
  // 因此这里等到 courses 真正加载出来为止。
  let st0 = null
  for (let i = 0; i < 45; i++) {
    await wait(1000)
    try {
      const h = await origGet(`http://127.0.0.1:${SMOKE_PORT}/health`, { timeout: 3000 })
      if (h.data?.status !== 'ok') continue
      const s = await api('/api/status')
      if (s && (s.courses || []).length > 0) { st0 = s; break }
    } catch { /* 还没起来 */ }
  }
  if (!st0) { log('❌ 45 秒内课程未加载完成，无法测试'); fs.writeFileSync(path.join('data-switchtest', 'report.log'), LOG.join('\n') + '\n', 'utf-8'); process.exit(1) }
  log('服务已就绪（课程已加载）')

  const total = (st0.courses || []).length
  log(`\n=== 初始状态 ===`)
  log(`  可监听课程: ${total} 门  listening=${st0.listening}  在监听=${st0.listeningCount}  已结课已排除`)
  if (total < 3) { log('课程太少，无法做开关对比测试'); process.exit(1) }

  // 等第一轮轮询
  reset(); await wait(ROUND_WAIT)
  const round1 = snapshot()
  log(`\n=== ① 正常轮询一轮 ===`)
  log(`  被请求的课程数: ${round1.size} / ${total}（应等于全部）`)
  const pass1 = round1.size === total

  // ② 关闭两门课
  const ids = (st0.courses || []).map(c => String(c.courseId))
  const offIds = ids.slice(0, 2)
  for (const id of offIds) await api('/api/courses/toggle', { courseId: id, on: false })
  const st1 = await api('/api/status')
  log(`\n=== ② 关闭 2 门课 ===`)
  log(`  listeningCount: ${st0.listeningCount} → ${st1.listeningCount}（应少 2）`)
  log(`  disabledCourses: ${JSON.stringify(st1.disabledCourses)}`)
  reset(); await wait(ROUND_WAIT)
  const round2 = snapshot()
  const leaked = offIds.filter(id => round2.has(id))
  log(`  被请求的课程数: ${round2.size}（应为 ${total - 2}）`)
  log(`  已关闭的课是否仍被请求: ${leaked.length === 0 ? '否 ✅' : '是 ❌ ' + JSON.stringify(leaked)}`)
  const pass2 = st1.listeningCount === st0.listeningCount - 2 && leaked.length === 0

  // ③ 停止总开关 → 应该一个请求都不发
  await api('/api/listen', { on: false })
  const st2 = await api('/api/status')
  reset(); await wait(ROUND_WAIT)
  const round3 = snapshot()
  log(`\n=== ③ 停止监听总开关 ===`)
  log(`  listening=${st2.listening}（应为 false）`)
  log(`  这一轮发出的课程请求数: ${round3.size}（应为 0）`)
  const pass3 = st2.listening === false && round3.size === 0

  // ④ 重新开启 + 全部恢复
  await api('/api/listen', { on: true })
  await api('/api/courses/reset', {})
  const st3 = await api('/api/status')
  log(`\n=== ④ 开启监听 + 全部恢复 ===`)
  log(`  listening=${st3.listening}  listeningCount=${st3.listeningCount}（应为 ${total}）  disabled=${JSON.stringify(st3.disabledCourses)}`)
  reset(); await wait(ROUND_WAIT)
  const round4 = snapshot()
  log(`  被请求的课程数: ${round4.size}（应为 ${total}）`)
  const pass4 = st3.listening === true && st3.listeningCount === total && round4.size === total

  log('\n=== 结论 ===')
  log(`  ① 默认全部轮询        : ${pass1 ? '✅' : '❌'}`)
  log(`  ② 逐课关闭立刻生效    : ${pass2 ? '✅' : '❌'}`)
  log(`  ③ 总开关能完全停请求  : ${pass3 ? '✅' : '❌'}`)
  log(`  ④ 开启/恢复能复原     : ${pass4 ? '✅' : '❌'}`)
  const all = pass1 && pass2 && pass3 && pass4
  log(all ? '\n✅ 三个开关均实测有效' : '\n❌ 有开关未生效，见上')

  fs.writeFileSync(path.join('data-switchtest', 'report.log'), LOG.join('\n') + '\n', 'utf-8')
  process.exit(all ? 0 : 1)
})()
