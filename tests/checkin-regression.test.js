/**
 * 回归测试：只覆盖纯逻辑（无需网络与账号），用 Node 内置 test runner 跑。
 *
 *   npm run build && node --test tests/
 *
 * 为什么要留这些用例：
 * - shouldPollActivity 是 2026-09-19 修复「classId 取错导致轮询全量失效」时的配套闸门，
 *   它一旦回归失效，修好 classId 后会一次性把 42 个历史签到当成新签到触发。
 * - decodeQrContent 的正则是二维码签到的唯一入口，编码大小写/参数顺序变过就会静默漏签。
 */
const test = require('node:test')
const assert = require('node:assert')

const { shouldPollActivity } = require('../build/core/course.js')
const { QR_REGEX } = require('../build/constants.js')

test('shouldPollActivity：进行中的签到要处理', () => {
  const now = Date.now()
  assert.equal(shouldPollActivity({ endTime: now + 600000, status: 1 }, now), true)
  assert.equal(shouldPollActivity({ endTime: now + 600000, status: 3 }, now), true)
})

test('shouldPollActivity：已结束的签到要跳过（不应重签历史活动）', () => {
  const now = Date.now()
  assert.equal(shouldPollActivity({ endTime: now - 1000, status: 2 }, now), false)
  assert.equal(shouldPollActivity({ endTime: now - 86400000, status: 2 }, now), false)
})

test('shouldPollActivity：缺 endTime 时用 status 兜底', () => {
  const now = Date.now()
  assert.equal(shouldPollActivity({ endTime: 0, status: 2 }, now), false)
  // status 未知时不误杀，交给后续流程判断
  assert.equal(shouldPollActivity({ endTime: 0, status: 0 }, now), true)
  assert.equal(shouldPollActivity({ endTime: 0, status: 1 }, now), true)
})

test('shouldPollActivity：endTime 恰为当前时刻视为已结束', () => {
  const now = Date.now()
  assert.equal(shouldPollActivity({ endTime: now, status: 1 }, now), false)
})

test('QR_REGEX：能解出学习通签到码的 aid 与 enc', () => {
  const url = 'https://mobilelearn.chaoxing.com/newsign/preSign?SIGNIN:e?aid=1234567&enc=ABCDEF0123'
  const m = url.match(QR_REGEX)
  assert.ok(m, '应匹配签到码')
  assert.equal(m[3], '1234567')
  assert.equal(m[5], 'ABCDEF0123')
})

test('QR_REGEX：enc 为小写 hex 时也要匹配', () => {
  const url = 'SIGNIN:e?aid=7654321&enc=abcdef0123'
  const m = url.match(QR_REGEX)
  assert.ok(m, '小写 hex 应匹配')
  assert.equal(m[5], 'abcdef0123')
})
