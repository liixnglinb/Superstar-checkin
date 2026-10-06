/**
 * 本地 API 契约测试：真起 DingTalkServer（临时端口 + 临时 config.yaml）打 HTTP。
 *
 * 为什么留这些用例：模块三/七实测发现坏 JSON 回 500、越界值静默丢弃仍报保存成功、
 * 字符串 "false" 会开启监听、AppSecret 明文落盘且「留空」会抹掉已存密钥。
 * 这些行为是控制台 UI 与 PWA 的契约，回归即事故。
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const os = require('os')

// CONFIG_FILE_PATH 在模块加载时固化，必须在 require 之前设置
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-api-'))
const cfgFile = path.join(tmpDir, 'config.yaml')
fs.writeFileSync(cfgFile, [
  'accounts: []', 'listener: { mode: poll, pollInterval: 30000 }',
  'notify: { channels: [], desktop: false }',
  'web: { port: 0, token: test-token-123 }',
].join('\n'), 'utf8')
process.env.CONFIG_FILE = cfgFile

const { DingTalkServer } = require('../build/server/dingtalk-server.js')
const { before, after } = require('node:test')

const srv = new DingTalkServer(0, '', {
  token: 'test-token-123',
  // 生产里由 index.ts 注入；测试只关心入参契约，给个最小桩
  setListening: (on) => ({ ok: true, listening: on, listeningCount: 0 }),
})
let base = ''

before(async () => {
  srv.start()
  await new Promise((r) => setTimeout(r, 300))
  const port = srv.server.address().port
  base = `http://127.0.0.1:${port}`
}, { timeout: 10000 })

// node:test 的真钩子：全部用例跑完才关服务器（不能注册成普通 test，会按定义顺序提前执行）
after(() => srv.stop())

const call = async (method, p, body) => {
  const res = await fetch(base + p + (p.includes('?') ? '&' : '?') + 'token=test-token-123', {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* 导出等接口返回非 JSON */ }
  return { status: res.status, json, text, headers: res.headers }
}

test('坏 JSON 与空请求体：400 且说明原因（旧实现回 500）', async () => {
  const bad = await call('POST', '/api/settings', '{ not json')
  assert.equal(bad.status, 400)
  assert.match(bad.json.message, /JSON/)
  const empty = await call('POST', '/api/settings', undefined)
  assert.equal(empty.status, 400)
  assert.match(empty.json.message, /请求体为空/)
})

test('越界值明确拒绝且不动旧值（旧实现静默丢弃仍回保存成功）', async () => {
  const r = await call('POST', '/api/settings', { pollInterval: 0 })
  assert.equal(r.status, 400)
  assert.match(r.json.message, /轮询间隔/)
  const q = await call('POST', '/api/settings', { quietEnabled: true, quietStart: '99:99', quietEnd: '07:00' })
  assert.equal(q.status, 400)
  assert.match(q.json.message, /免打扰开始时间/)
})

test('布尔开关：字符串 "false" 是停止，"yes" 是 400（!! 写法会把 "false" 当 true）', async () => {
  const stop = await call('POST', '/api/listen', { on: 'false' })
  assert.equal(stop.status, 200)
  assert.equal(stop.json.listening, false)
  const bad = await call('POST', '/api/listen', { on: 'yes' })
  assert.equal(bad.status, 400)
  assert.match(bad.json.message, /true\/false/)
})

test('代理：file:// 与 ftp:// 拒绝（旧实现原样写进配置交给网络层）', async () => {
  assert.equal((await call('POST', '/api/proxy', { proxy: 'file:///etc/passwd' })).status, 400)
  assert.equal((await call('POST', '/api/proxy', { proxy: 'ftp://x' })).status, 400)
  assert.equal((await call('POST', '/api/proxy', { proxy: '127.0.0.1:7890' })).status, 200)
})

test('课程备注：超长与非文本拒绝', async () => {
  const long = await call('POST', '/api/course-notes', { c1: 'x'.repeat(201) })
  assert.equal(long.status, 400)
  assert.match(long.json.message, /200/)
  const obj = await call('POST', '/api/course-notes', { c1: { x: 1 } })
  assert.equal(obj.status, 400)
})

test('监听课程：非数组拒绝（旧实现字符串也照收变成「监听全部」）', async () => {
  const r = await call('POST', '/api/watch', { watchCourses: 'not-array' })
  assert.equal(r.status, 400)
  assert.match(r.json.message, /列表/)
})

test('安全响应头：CSP / X-Frame-Options / nosniff 全在（模块七）', async () => {
  const r = await call('GET', '/health')
  assert.equal(r.headers.get('content-security-policy'), "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
  assert.equal(r.headers.get('x-frame-options'), 'DENY')
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer')
})

test('钉钉 AppSecret：落盘 DPAPI 加密、留空保持、不回显', async () => {
  const save1 = await call('POST', '/api/dingtalk/stream', { appKey: 'k1', appSecret: 'super-secret-1', enabled: true })
  assert.equal(save1.status, 200)
  const raw1 = fs.readFileSync(cfgFile, 'utf8')
  assert.ok(/appSecret: DPAPI:/.test(raw1), '明文不应直接落盘')

  const blank = await call('POST', '/api/dingtalk/stream', { appKey: 'k1', appSecret: '', enabled: true })
  assert.equal(blank.status, 200)
  const raw2 = fs.readFileSync(cfgFile, 'utf8')
  assert.equal(raw2.match(/appSecret: (DPAPI:\S+)/)?.[1], raw1.match(/appSecret: (DPAPI:\S+)/)?.[1], '留空必须保持原密文')

  const get = await call('GET', '/api/dingtalk/settings')
  assert.equal(get.json.hasSecret, true)
  assert.ok(!get.text.includes('super-secret'), '响应不得回显明文')
})

test('未带 token：401（fail-closed）', async () => {
  const res = await fetch(base + '/api/status')
  assert.equal(res.status, 401)
})
