/**
 * 免责声明流程验证：
 *   ① 初始状态应为「未接受」（首次进入必须弹窗）
 *   ② 接受后返回接受时间与版本
 *   ③ 重启服务后仍为「已接受」—— 这是关键：接受记录必须能留得住
 *   ④ 记录文件确实落盘在 data/disclaimer.json
 *   ④ 声明版本不一致时应视为未接受（模拟升级条款后要求重新确认）
 */
process.env.NO_OPEN_BROWSER = '1'
process.env.CONFIG_FILE = 'config-dis.yaml'

const fs = require('fs')
const path = require('path')
const YAML = require('yaml')
const { execFileSync } = require('child_process')

const PORT = 3463
const LOG = []
const log = (...a) => { const s = a.join(' '); LOG.push(s); console.log(s) }

function startService() {
  // 用子进程起服务，便于"重启"验证
  const child = require('child_process').spawn(process.execPath, ['build/index.js'], {
    env: { ...process.env, CONFIG_FILE: 'config-dis.yaml', NO_OPEN_BROWSER: '1' },
    stdio: 'ignore',
    detached: false,
  })
  return child
}
async function waitReady() {
  for (let i = 0; i < 45; i++) {
    await new Promise(r => setTimeout(r, 1000))
    try {
      const s = await fetch(`http://127.0.0.1:${PORT}/api/status?token=${tk()}`, { signal: AbortSignal.timeout(5000) })
      const j = await s.json()
      if (Array.isArray(j.courses)) return true
    } catch { /* 继续等 */ }
  }
  return false
}
const tk = () => (fs.readFileSync('config-dis.yaml', 'utf-8').match(/^ {2}token: (.+)$/m) || [])[1].trim()
const api = async (p, body) => {
  const init = { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' } }
  if (body !== undefined) init.body = JSON.stringify(body)
  const r = await fetch(`http://127.0.0.1:${PORT}${p}?token=${encodeURIComponent(tk())}`, { ...init, signal: AbortSignal.timeout(10000) })
  return r.json()
}

;(async () => {
  fs.rmSync('config-dis.yaml', { force: true })
  fs.rmSync('data-dis', { recursive: true, force: true })
  const c = YAML.parse(fs.readFileSync('config.yaml', 'utf-8'))
  c.web = { ...(c.web || {}), port: PORT }
  c.storage = { ...(c.storage || {}), dataDir: './data-dis' }
  c.listener = { ...(c.listener || {}), pollInterval: 600000 }
  c.report = { ...(c.report || {}), enabled: false, weekly: false }
  c.preCheck = { ...(c.preCheck || {}), enabled: false }
  fs.writeFileSync('config-dis.yaml', YAML.stringify(c), 'utf-8')
  fs.mkdirSync('data-dis', { recursive: true })

  log('=== 第一次启动服务 ===')
  let svc = startService()
  if (!(await waitReady())) { log('❌ 服务未就绪'); process.exit(1) }

  const a = await api('/api/disclaimer')
  log(`\n① 初始状态: accepted=${a.accepted}（应为 false）currentVersion=${a.currentVersion}`)
  const pass1 = a.accepted === false

  log('\n② 调用接受接口')
  const b = await api('/api/disclaimer/accept', {})
  log(`   accepted=${b.accepted} acceptedAt=${b.acceptedAt} version=${b.version}`)
  const pass2 = b.accepted === true && !!b.acceptedAt && typeof b.version === 'number'

  const c2 = await api('/api/disclaimer')
  log(`   再次读取: accepted=${c2.accepted}（应为 true）`)
  const pass3 = c2.accepted === true

  log('\n=== ③ 重启服务（验证持久化）===')
  svc.kill()
  await new Promise(r => setTimeout(r, 3000))
  svc = startService()
  if (!(await waitReady())) { log('❌ 重启后服务未就绪'); process.exit(1) }
  const d = await api('/api/disclaimer')
  log(`   重启后: accepted=${d.accepted}（应为 true）acceptedAt=${d.acceptedAt}`)
  const pass4 = d.accepted === true

  log('\n=== ④ 记录文件确实落盘 ===')
  const f = path.join('data-dis', 'disclaimer.json')
  const exists = fs.existsSync(f)
  log(`   ${f} 存在=${exists}`)
  if (exists) log(`   内容: ${fs.readFileSync(f, 'utf-8').replace(/\s+/g, ' ')}`)
  const pass5 = exists && JSON.parse(fs.readFileSync(f, 'utf-8')).accepted === true

  log('\n=== ⑤ 声明版本不一致时应重新要求确认 ===')
  const raw = JSON.parse(fs.readFileSync(f, 'utf-8'))
  raw.version = 999 // 模拟"用户同意的是旧版声明"
  fs.writeFileSync(f, JSON.stringify(raw, null, 2))
  svc.kill()
  await new Promise(r => setTimeout(r, 3000))
  svc = startService()
  if (!(await waitReady())) { log('❌ 再次重启失败'); process.exit(1) }
  const e = await api('/api/disclaimer')
  log(`   版本不匹配时: accepted=${e.accepted}（应为 false，需重新确认）`)
  const pass6 = e.accepted === false

  svc.kill()

  log('\n=== 结论 ===')
  log(`  ① 初始未接受              : ${pass1 ? '✅' : '❌'}`)
  log(`  ② 接受后记录时间与版本    : ${pass2 ? '✅' : '❌'}`)
  log(`  ③ 接受后立即生效          : ${pass3 ? '✅' : '❌'}`)
  log(`  ④ 重启后仍为已接受（持久）: ${pass4 ? '✅' : '❌'}`)
  log(`  ⑤ 记录落盘 data/          : ${pass5 ? '✅' : '❌'}`)
  log(`  ⑥ 版本变更要求重新确认    : ${pass6 ? '✅' : '❌'}`)
  const all = pass1 && pass2 && pass3 && pass4 && pass5 && pass6
  log(all ? '\n✅ 免责声明流程全部通过' : '\n❌ 有环节未通过')

  fs.writeFileSync(path.join('data-dis', 'report.log'), LOG.join('\n') + '\n', 'utf-8')
  process.exit(all ? 0 : 1)
})().catch(e => { console.log('异常:', e.message); process.exit(1) })
