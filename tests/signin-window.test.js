/**
 * 签到时段学习（signin-window）的回归测试。
 *
 * 这段逻辑最危险的地方：它决定「什么时候完全不发请求」。一旦算错，
 * 对应课程会永久不再被轮询，而且没有任何报错 —— 属于典型静默漏签。
 * 因此下面重点守住三条安全阀：样本不足不限制、每日兜底扫描、窗口不窄于下限。
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  initWindowStore,
  recordSigninTime,
  getWindow,
  shouldPollByWindow,
} = require('../build/providers/signin-window.js')

/** 每个用例用独立数据目录，避免相互污染 */
function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'win-test-'))
  initWindowStore(dir)
  return dir
}

/** 构造一个「某天 hh:mm」的时间戳 */
function tsAt(hh, mm, dayOffset = 0) {
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hh, mm, 0, 0)
  return d.getTime()
}
/** 构造一个当天 hh:mm 的 Date */
function dateAt(hh, mm) {
  const d = new Date()
  d.setHours(hh, mm, 0, 0)
  return d
}

test('样本不足时不限制轮询（保护新课程/新学期）', () => {
  freshStore()
  // 只观测 3 次，低于 MIN_SAMPLES=4
  for (let i = 1; i <= 3; i++) recordSigninTime('c1', tsAt(10, 0, -i))
  const w = getWindow('c1')
  assert.equal(w.known, false, '样本不足应判定为未知时段')
  assert.equal(w.startMin, 0)
  assert.equal(w.endMin, 1440)
  // 未知时段的课，任何时刻都应轮询
  assert.equal(shouldPollByWindow('c1', dateAt(3, 0)), true)
  assert.equal(shouldPollByWindow('c1', dateAt(23, 0)), true)
})

test('样本足够后：窗口内轮询、窗口外不轮询', () => {
  freshStore()
  // 稳定在 10:00 发签到
  for (let i = 1; i <= 5; i++) recordSigninTime('c2', tsAt(10, 0, -i))
  const w = getWindow('c2', 15)
  assert.equal(w.known, true)
  assert.ok(w.startMin <= 10 * 60, `窗口起点应 ≤10:00，实际 ${w.startMin}`)
  assert.ok(w.endMin >= 10 * 60, `窗口终点应 ≥10:00，实际 ${w.endMin}`)

  assert.equal(shouldPollByWindow('c2', dateAt(10, 0), 15, 7), true, '窗口内应轮询')
  // 用一个明确远离窗口且不是兜底小时（7 点）的时刻
  assert.equal(shouldPollByWindow('c2', dateAt(15, 0), 15, 7), false, '窗口外应停止')
  assert.equal(shouldPollByWindow('c2', dateAt(3, 0), 15, 7), false, '凌晨应停止')
})

test('每日兜底扫描：即便在窗口外，sweepHour 仍会扫一次', () => {
  freshStore()
  for (let i = 1; i <= 5; i++) recordSigninTime('c3', tsAt(10, 0, -i))
  // 兜底小时设为 7；当天第 7 点的第一次调用应放行
  assert.equal(shouldPollByWindow('c3', dateAt(7, 5), 15, 7), true, '兜底时段应放行一次')
  // 同一天同一门课不应反复放行（否则又变成全天轮询）
  assert.equal(shouldPollByWindow('c3', dateAt(7, 10), 15, 7), false, '同一天不应重复兜底')
  // sweepHour = -1 表示关闭兜底
  assert.equal(shouldPollByWindow('c4', dateAt(7, 5), 15, -1), true, '无样本的课不受兜底开关影响')
})

test('窗口宽度不小于下限（样本集中时不会收成一条线）', () => {
  freshStore()
  // 5 次全部集中在同一分钟
  for (let i = 1; i <= 5; i++) recordSigninTime('c5', tsAt(14, 30, -i))
  const w = getWindow('c5', 15)
  assert.equal(w.known, true)
  const width = w.endMin - w.startMin
  assert.ok(width >= 60, `窗口宽度应 ≥60 分钟，实际 ${width}`)
})

test('同一分钟内的重复观测只计一次（避免轮询反复读到同一活动灌爆样本）', () => {
  freshStore()
  const t = tsAt(9, 0, -1)
  recordSigninTime('c6', t)
  recordSigninTime('c6', t + 5000)   // 同一分钟
  recordSigninTime('c6', t + 30000)  // 同一分钟
  assert.equal(getWindow('c6').samples, 1, '同一分钟只应记一次')

  recordSigninTime('c6', t + 61000)  // 跨到下一分钟
  assert.equal(getWindow('c6').samples, 2)
})

test('无效输入被忽略（不产生样本、不抛错）', () => {
  freshStore()
  recordSigninTime('c7', 0)
  recordSigninTime('c7', -1)
  recordSigninTime('', tsAt(10, 0))
  assert.equal(getWindow('c7').samples, 0)
})

test('窗口两侧留白按参数生效', () => {
  freshStore()
  for (let i = 1; i <= 5; i++) recordSigninTime('c8', tsAt(12, 0, -i))
  const narrow = getWindow('c8', 5)
  const wide = getWindow('c8', 45)
  assert.ok(wide.endMin - wide.startMin > narrow.endMin - narrow.startMin,
    `±45 的窗口应比 ±5 宽：narrow=${narrow.endMin - narrow.startMin} wide=${wide.endMin - wide.startMin}`)
})
