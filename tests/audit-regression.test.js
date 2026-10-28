const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const axios = require('axios')
const course = require('../build/core/course')
const { PollListener } = require('../build/listeners/poll-listener')
const login = require('../build/core/login')
const runtime = require('../build/providers/runtime-config')
const { isSuccessfulMessage, isSuccessfulRecord } = require('../build/utils/checkin-result')

test('课程列表分别提取课程 ID 与班级 ID，分页失败不能伪装成功', async (t) => {
  const old = axios.get; t.after(() => { axios.get = old })
  axios.get = async () => ({ data: { result: 1, channelList: [{ key: 2, content: { id: 2, course: { data: [{ id: 1, name: '示例' }] } } }], hasMore: false } })
  const list = await course.getCourseList('mock')
  assert.equal(list[0].courseId, '1'); assert.equal(list[0].classId, '2')
  let calls = 0
  axios.get = async () => ++calls === 1 ? { data: { result: 1, channelList: [], hasMore: true } } : { data: { result: 0 } }
  await assert.rejects(course.getCourseList('mock'), /分页失败/)
})

test('活动接口错误标记为扫描失败并配置超时', async (t) => {
  const old = axios.get; t.after(() => { axios.get = old })
  let timeout
  axios.get = async (_url, opts) => { timeout = opts.timeout; return { data: { result: 0, errorMsg: 'not member' } } }
  await assert.rejects(course.getCourseActivities('mock', '1', '2'), /活动列表失败/)
  assert.ok(timeout > 0)
})

test('监听关闭后，在途响应不会触发签到；每次扫描读取新 Cookie', async (t) => {
  const old = axios.get; t.after(() => { axios.get = old })
  let resolve, cookie = 'new-cookie', enabled = true, callbacks = 0, used
  axios.get = (_url, opts) => { used = opts.headers.Cookie; return new Promise(r => { resolve = r }) }
  const listener = new PollListener(5000, 0)
  listener.onActivity(() => callbacks++)
  listener.start(() => cookie, [{ courseId: '1', classId: '2', courseName: '示例' }], () => enabled)
  enabled = false
  resolve({ data: { result: 1, data: { activeList: [{ id: 9, activeType: 2, nameOne: '签到', endTime: Date.now() + 10000 }] } } })
  await new Promise(r => setTimeout(r, 30)); listener.stop()
  assert.equal(used, 'new-cookie'); assert.equal(callbacks, 0)
})

test('验证页不能误判 Cookie 失效；用户信息请求使用配置代理', async (t) => {
  const old = axios.get, oldProxy = runtime.getProxyConfig; t.after(() => { axios.get = old; runtime.getProxyConfig = oldProxy })
  axios.get = async () => ({ data: '<html>安全验证</html>' })
  assert.equal(await login.checkCookie('mock'), 'unknown')
  runtime.getProxyConfig = () => ({ host: '127.0.0.1', port: 7890 })
  let options
  axios.get = async (_url, opts) => { options = opts; return { data: { result: 1, msg: { uid: 1, name: 'test' } } } }
  await login.getUserInfo('mock')
  assert.equal(options.proxy.port, 7890); assert.ok(options.timeout > 0)
})

test('成功判定使用明确状态，未确认和 unsuccessful 不能算成功', () => {
  assert.equal(isSuccessfulMessage('success [已核对✓]'), true)
  assert.equal(isSuccessfulMessage('success [平台未确认已签到]'), false)
  assert.equal(isSuccessfulMessage('failed: unsuccessful'), false)
  assert.equal(isSuccessfulRecord({ success: false, message: '签到成功但未确认' }), false)
  assert.equal(isSuccessfulRecord({ success: true, message: 'success' }), true)
})

test('二维码待办按活动编号匹配；缺编号且存在多个待办时不猜测', () => {
  const state = require('../build/providers/sign-state')
  state.setPendingQr('audit-a', { courseName: 'A' }); state.setPendingQr('audit-b', { courseName: 'B' })
  assert.equal(state.resolvePendingQr(), null)
  assert.equal(state.resolvePendingQr('audit-a').info.courseName, 'A')
  assert.equal(state.resolvePendingQr().aid, 'audit-b')
  state.flushSignState()
})

test('二维码签到写入历史，核对显示未签到时不报告成功', async () => {
  const storage = require('../build/providers/storage')
  storage.initStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'cx-audit-history-')))
  const anti = require('../build/utils/anti-detect'), oldDelay = anti.randomDelay
  const { CheckinEngine } = require('../build/core/checkin-engine'), oldQr = CheckinEngine.qrCheckin, oldVerify = CheckinEngine.verifyCheckin
  const { CheckinHandler } = require('../build/handlers/checkin-handler')
  const cfg = { checkin: { verify: { enabled: true }, antiDetect: { enabled: false }, retry: { maxAttempts: 1, delayMs: 0 } }, geo: { locations: [], providers: {} } }
  const account = { getAccounts: () => [{ username: 'a' }], getMeta: () => ({ name: 'a', cookie: 'mock' }) }
  anti.randomDelay = async () => {}; CheckinEngine.qrCheckin = async () => 'success'; CheckinEngine.verifyCheckin = async () => ({ checked: true, signed: false })
  try {
    const handler = new CheckinHandler(cfg, account)
    const result = await handler.handleQr('123', 'mock', '示例课')
    assert.equal(result[0].success, false)
    assert.equal(handler.getHistory()[0].courseName, '示例课')
    assert.equal(handler.getHistory()[0].aid, '123')
  } finally { anti.randomDelay = oldDelay; CheckinEngine.qrCheckin = oldQr; CheckinEngine.verifyCheckin = oldVerify }
})

test('历史导出保留真实签到结果', async (t) => {
  const { DingTalkServer } = require('../build/server/dingtalk-server')
  const server = new DingTalkServer(0, '', { token: 'test-token', historyProvider: () => [{ timestamp: 1, courseName: '示例课', type: 'normal', success: true, message: 'success', accountName: 'a' }] })
  server.start(); t.after(() => server.stop())
  await new Promise(r => setTimeout(r, 100))
  const res = await fetch(`http://127.0.0.1:${server.server.address().port}/api/history/export?token=test-token`)
  const csv = await res.text()
  assert.match(csv, /"success"/)
})

test('一个账号检查失败不会阻断其他账号', async (t) => {
  const retry = require('../build/utils/retry'), oldRetry = retry.retry
  const oldLogin = login.login, oldInfo = login.getUserInfo
  const storage = require('../build/providers/storage'), oldGet = storage.get, oldSet = storage.set
  const calls = []
  retry.retry = async fn => fn()
  login.login = async u => { calls.push(u); if (u === 'first') throw new Error('offline'); return { cookie: 'test', uid: 1, fid: 1 } }
  login.getUserInfo = async () => ({ name: 'test' })
  storage.get = () => null; storage.set = () => {}
  t.after(() => { retry.retry = oldRetry; login.login = oldLogin; login.getUserInfo = oldInfo; storage.get = oldGet; storage.set = oldSet })
  const { AccountManager } = require('../build/providers/account-manager')
  const manager = new AccountManager([{ username: 'first' }, { username: 'second' }])
  await assert.rejects(manager.checkAll())
  assert.deepEqual(calls, ['first', 'second'])
  assert.equal(manager.getCookieState('second'), 'valid')
  assert.equal(manager.getCookieState('first'), 'unknown')
})

test('签到状态写盘失败不抛出未捕获异常', async (t) => {
  const state = require('../build/providers/sign-state'), atomic = require('../build/utils/fs')
  const old = atomic.writeFileAtomic
  state.initSignState(fs.mkdtempSync(path.join(os.tmpdir(), 'cx-state-audit-')))
  atomic.writeFileAtomic = () => { throw new Error('模拟写盘失败') }
  t.after(() => { atomic.writeFileAtomic = old; state.flushSignState() })
  state.setPendingQr('disk-fail', { courseName: '示例课' })
  await new Promise(r => setTimeout(r, 1100))
})
