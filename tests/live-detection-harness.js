/**
 * 活体验证：注入一个「未结束的签到活动」，验证轮询检测 → 类型判定 → 等待上传 的完整链路。
 *
 * 为什么要这么做：只证明「历史签到被跳过」不足以说明修复有效，
 * 必须同时证明「未结束的签到能被发现」。这里用假的 activeId（999999999），
 * 不会产生任何真实签到副作用；数据目录也用独立目录，不污染 data/。
 */
process.env.NO_OPEN_BROWSER = '1'
process.env.CONFIG_FILE = 'config.smoke.yaml'
process.env.WEB_HOST = '127.0.0.1'

const fs = require('fs')
const path = require('path')
const axios = require('axios')

const FAKE_AID = '999999999'
const LOG = []
const origGet = axios.get.bind(axios)

function log(...a) { const s = a.join(' '); LOG.push(s); console.log(s) }

axios.get = async function (url, cfg = {}) {
  if (typeof url === 'string') {
    // 1) 活动列表：把假签到塞进第一门课，模拟"刚发布的、还没结束的签到"
    if (url.includes('/v2/apis/active/student/activelist')) {
      const courseId = cfg.params?.courseId
      if (!globalThis.__injected) {
        globalThis.__injected = true
        log(`[注入] 活动列表返回 1 条未结束的签到：aid=${FAKE_AID} courseId=${courseId} classId=${cfg.params?.classId}`)
        return { data: { result: 1, data: { activeList: [{
          id: Number(FAKE_AID), activeType: 2, otherId: '2', nameOne: '二维码签到',
          startTime: Date.now() - 60000, endTime: Date.now() + 600000, status: 1,
        }] } } }
      }
      return { data: { result: 1, data: { activeList: [] } } }
    }
    // 2) 活动详情：假活动判定为二维码签到（走「等待上传」分支，不会真的提交签到）
    //    注意 otherId 必须是 number：引擎用 switch(d.otherId) 严格比较，
    //    返回字符串 "2" 会落到 default 被当成普通签到（实测真实接口返回数字）。
    if (url.includes('/v2/apis/active/getPPTActiveInfo')) {
      log('[注入] 活动详情 → otherId=2（二维码签到）')
      return { data: { result: 1, data: { otherId: 2, ifphoto: 0, status: 1 } } }
    }
    // 注意：只拦这两个端点。若对 chaoxing 全域做通配 mock，会把 Cookie 校验与课程列表
    // 一起打成假数据，导致账号被判失效、课程为 0，轮询拿不到任何课程（白测一场）。
  }
  return origGet(url, cfg)
}

;(async () => {
  // 独立配置：不碰真实 config.yaml，监听另一个端口
  const SMOKE_PORT = 3457
  const cfgText = fs.readFileSync('config.yaml', 'utf-8')
    .replace(/port: 3456/, `port: ${SMOKE_PORT}`)
    .replace(/dataDir: .\/data/, 'dataDir: ./data-smoke')
  fs.writeFileSync('config.smoke.yaml', cfgText, 'utf-8')
  fs.mkdirSync('data-smoke', { recursive: true })

  log('启动被测服务（端口 ' + SMOKE_PORT + '，数据目录 data-smoke，活动列表已注入假签到）...')
  require('../build/index.js')

  // ⚠️ 必须从磁盘上的 smoke 配置里取 web.token，且只认 2 空格缩进的顶层 web 段：
  // config.yaml 的 notify.channels 里也有一个 `token:`（PushPlus Token，4 空格缩进），
  // 用 /^\s*token: (.+)$/m 会先匹配到它，拿到一个无效 token → 请求 401，白测一场。
  const readToken = () => {
    const text = fs.readFileSync('config.smoke.yaml', 'utf-8')
    const m = text.match(/^ {2}token: (.+)$/m)
    return m ? m[1].trim() : ''
  }
  const statusUrl = () => `http://127.0.0.1:${SMOKE_PORT}/api/status?token=${encodeURIComponent(readToken())}`

  // 先等 /health 就绪：否则轮询会打到「恰好还在 3456 上的其它实例」，
  // 读到它的状态，得出与本次测试无关的结论（曾经就踩过这个坑）。
  const bootDeadline = Date.now() + 30000
  let ready = false
  while (Date.now() < bootDeadline && !ready) {
    await new Promise(r => setTimeout(r, 1000))
    try {
      const h = await origGet(`http://127.0.0.1:${SMOKE_PORT}/health`, { timeout: 3000 })
      ready = h.data?.status === 'ok'
    } catch { /* 还没起来 */ }
  }
  log(ready ? `服务已就绪（:${SMOKE_PORT}），web.token=${readToken().slice(0, 8)}…` : `⚠️ 服务未在 30 秒内就绪`)

  // 判定方式：假活动是二维码签到，走通后会被放进「待上传」队列 → qrPending=true。
  // 比拦截日志可靠：logger 不经过 console.log，拦不到。
  const deadline = Date.now() + 60000
  let qrPending = false
  let lastProbe = '(未探测)'
  while (Date.now() < deadline && !qrPending) {
    await new Promise(r => setTimeout(r, 2000))
    try {
      const r = await origGet(statusUrl(), { timeout: 5000 })
      lastProbe = `HTTP ${r.status} qrPending=${JSON.stringify(r.data?.qrPending)} recordCount=${JSON.stringify(r.data?.recordCount)}`
      if (r.data?.qrPending) { qrPending = true; break }
    } catch (e) {
      lastProbe = `请求异常: ${e.response?.status || e.message}`
    }
  }
  log(`  状态接口最后一次探测: ${lastProbe}`)

  const discovered = LOG.some(l => l.includes('活动列表返回 1 条'))
  const detailCalled = LOG.some(l => l.includes('活动详情'))
  log('\n=== 结论 ===')
  log(`  轮询读到注入的未结束签到 : ${discovered ? '✅ 是' : '❌ 否'}`)
  log(`  触发 processCheckin 判定 : ${detailCalled ? '✅ 是（活动详情端点被调用）' : '❌ 否'}`)
  log(`  进入「二维码待上传」队列 : ${qrPending ? '✅ 是（qrPending=true）' : '❌ 否'}`)
  const ok = discovered && detailCalled && qrPending
  log(ok
    ? '\n✅ 检测链路完整可用：轮询 → 发现未结束签到 → 类型判定 → 等待上传'
    : '\n❌ 链路仍有问题，见上方各项')

  fs.writeFileSync(path.join('data-smoke', 'report.log'), LOG.join('\n') + '\n', 'utf-8')
  process.exit(ok ? 0 : 1)
})()
