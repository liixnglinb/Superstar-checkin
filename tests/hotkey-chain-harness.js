/**
 * 验证「热键 / 剪贴板」实际调用的那条链是否真的通。
 *
 * 为什么必须单独验：这条路径此前引用了未定义的 token 变量（整体不可用），
 * 我今天修了但从没真机验证。热键没法自动按键，但**它做的三件事**可以完整验证：
 *   ① 读剪贴板图片 → ② POST /upload/image?type=qr → ③ 服务端返回结果文案
 * 这里用一张真实 PNG 走一遍 ②③（① 由 Electron 的 clipboard 提供，无法在 Node 里模拟）。
 */
process.env.NO_OPEN_BROWSER = '1'
process.env.CONFIG_FILE = 'config-hk.yaml'

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const YAML = require('yaml')

const PORT = 3461
const LOG = []
const log = (...a) => { const s = a.join(' '); LOG.push(s); console.log(s) }

/** 造一张最小的合法 PNG（纯色，不含二维码 —— 用于验证"识别失败"路径的文案） */
function makePng(w = 100, h = 100) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    const rowStart = y * (w * 4 + 1)
    raw[rowStart] = 0 // filter type
    for (let x = 0; x < w; x++) {
      const p = rowStart + 1 + x * 4
      raw[p] = 255; raw[p + 1] = 255; raw[p + 2] = 255; raw[p + 3] = 255
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
let crcTable = null
function crc32(buf) {
  if (!crcTable) {
    crcTable = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

;(async () => {
  fs.rmSync('config-hk.yaml', { force: true })
  fs.rmSync('data-hk', { recursive: true, force: true })
  const c = YAML.parse(fs.readFileSync('config.yaml', 'utf-8'))
  c.web = { ...(c.web || {}), port: PORT }
  c.storage = { ...(c.storage || {}), dataDir: './data-hk' }
  c.listener = { ...(c.listener || {}), pollInterval: 600000, pollJitter: 0 }
  c.smartPoll = { ...(c.smartPoll || {}), enabled: false }
  c.report = { ...(c.report || {}), enabled: false, weekly: false }
  c.preCheck = { ...(c.preCheck || {}), enabled: false }
  fs.writeFileSync('config-hk.yaml', YAML.stringify(c), 'utf-8')
  fs.mkdirSync('data-hk', { recursive: true })

  log('启动被测服务...')
  require('../build/index.js')

  const token = () => (fs.readFileSync('config-hk.yaml', 'utf-8').match(/^ {2}token: (.+)$/m) || [])[1]?.trim() || ''
  // 必须等**业务模块初始化完成**，不能只看 /health：
  // HTTP 服务在启动早期就开始监听，此时图片处理器还没注册，
  // 早发的请求会落到"服务未初始化"分支（曾因此误判成"热键链路坏了"）。
  let ready = false
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1000))
    try {
      const s = await fetch(`http://127.0.0.1:${PORT}/api/status?token=${encodeURIComponent(token())}`, { signal: AbortSignal.timeout(5000) })
      const j = await s.json()
      // courses 字段只在业务模块就绪后才存在
      if (Array.isArray(j.courses)) { ready = true; break }
    } catch { /* 继续等 */ }
  }
  if (!ready) { log('❌ 60 秒内业务模块未就绪'); process.exit(1) }
  await new Promise(r => setTimeout(r, 1500)) // 再留一点余量给处理器注册
  const tk = token()
  log(`服务已就绪，token=${tk.slice(0, 8)}…`)

  const png = makePng()
  log(`\n=== 模拟热键：POST /upload/image?type=qr（${png.length} 字节 PNG）===`)

  // ① 不带 token（验证鉴权生效）
  const r0 = await fetch(`http://127.0.0.1:${PORT}/upload/image?type=qr`, {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png,
  })
  log(`  不带 token → HTTP ${r0.status}（应为 401）`)
  const pass0 = r0.status === 401

  // ② 带 token + Bearer（热键用的正是这个组合）
  const r1 = await fetch(`http://127.0.0.1:${PORT}/upload/image?type=qr`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'image/png' },
    body: png,
  })
  const t1 = await r1.text()
  log(`  带 Bearer token → HTTP ${r1.status}`)
  log(`  响应: ${t1}`)
  let j1 = {}
  try { j1 = JSON.parse(t1) } catch { /* 非 JSON */ }
  // 这张图不含二维码，预期 success=false 且给出可执行的提示（而不是旧的"正在处理"）
  const pass1 = r1.status === 200 && j1.success === false && String(j1.error || '').length > 0
  log(`  → success=${j1.success}（应为 false，说明返回的是真实处理结果而非旧的"正在处理"）`)

  // ③ 带 token + ?token=（上传页用的组合，也应可用）
  const r2 = await fetch(`http://127.0.0.1:${PORT}/upload/image?type=qr&token=${encodeURIComponent(tk)}`, {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png,
  })
  const t2 = await r2.text()
  log(`\n  带 ?token= 查询参数 → HTTP ${r2.status}`)
  log(`  响应: ${t2}`)
  const pass2 = r2.status === 200

  log('\n=== 结论 ===')
  log(`  ① 无 token 被拒（401）              : ${pass0 ? '✅' : '❌'}`)
  log(`  ② 热键的 Bearer 组合可用并返回文案  : ${pass1 ? '✅' : '❌'}`)
  log(`  ③ 上传页的 ?token= 组合可用          : ${pass2 ? '✅' : '❌'}`)
  const all = pass0 && pass1 && pass2
  log(all
    ? '\n✅ 热键调用的链路完全可用，且识别失败时会返回可执行的提示（不再是"正在处理"）'
    : '\n❌ 链路有问题，见上')

  fs.writeFileSync(path.join('data-hk', 'report.log'), LOG.join('\n') + '\n', 'utf-8')
  process.exit(all ? 0 : 1)
})().catch(e => { console.log('异常:', e.message); process.exit(1) })
