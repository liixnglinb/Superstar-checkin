/**
 * 签到时段学习（signin-window）的回归测试。
 *
 * 这段逻辑最危险的地方：它决定「什么时候完全不发请求」。一旦算错，
 * 对应课程会永久不再被轮询，而且没有任何报错 —— 属于典型静默漏签。
 *
 * 因此这里重点守住这些安全阀：
 *   - 样本不足不限制轮询（保护新课程 / 新学期）
 *   - 星期判定需要「同一星期出现 ≥2 次」，一次异常时间不能把星期锁死
 *   - 每日兜底扫描（发现时刻漂移）与每周兜底扫描（发现星期漂移）各只放行一次
 *   - 窗口宽度下限、同分钟去重、留白参数
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

/** 构造「N 周前的某个星期 hh:mm」时间戳 */
function tsOnWeekday(targetDow, hh, mm, weeksAgo = 1) {
  const d = new Date()
  d.setDate(d.getDate() - 7 * weeksAgo)
  d.setDate(d.getDate() - d.getDay() + targetDow) // 归到目标星期
  d.setHours(hh, mm, 0, 0)
  return d.getTime()
}

/** 构造「本周某个星期 hh:mm」的 Date（用于注入"现在"） */
function dateOnWeekday(targetDow, hh, mm) {
  const d = new Date()
  d.setDate(d.getDate() - d.getDay() + targetDow)
  d.setHours(hh, mm, 0, 0)
  return d
}

/** 不带星期的样本（同一时刻连续多天） */
function seedDailySamples(courseId, hh, mm, n = 5) {
  for (let i = 1; i <= n; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    d.setHours(hh, mm, 0, 0)
    recordSigninTime(courseId, d.getTime())
  }
}

// ===================== 时刻窗口 =====================

test('样本不足时不限制轮询（保护新课程/新学期）', () => {
  freshStore()
  for (let i = 1; i <= 3; i++) recordSigninTime('c1', tsOnWeekday(2, 10, 0, i))
  const w = getWindow('c1')
  assert.equal(w.known, false, '样本不足应判定为未知时段')
  assert.equal(w.startMin, 0)
  assert.equal(w.endMin, 1440)
  assert.equal(shouldPollByWindow('c1', dateOnWeekday(5, 3, 0)), true, '未知时段的课任何时刻都应轮询')
  assert.equal(shouldPollByWindow('c1', dateOnWeekday(1, 23, 0)), true)
})

test('窗口宽度不小于下限（样本集中时不会收成一条线）', () => {
  freshStore()
  seedDailySamples('c5', 14, 30, 5)
  const w = getWindow('c5', 15)
  assert.equal(w.known, true)
  assert.ok(w.endMin - w.startMin >= 60, `窗口宽度应 ≥60 分钟，实际 ${w.endMin - w.startMin}`)
})

test('窗口两侧留白按参数生效', () => {
  freshStore()
  seedDailySamples('c8', 12, 0, 5)
  const narrow = getWindow('c8', 5)
  const wide = getWindow('c8', 45)
  assert.ok(wide.endMin - wide.startMin > narrow.endMin - narrow.startMin,
    `±45 应比 ±5 宽：narrow=${narrow.endMin - narrow.startMin} wide=${wide.endMin - wide.startMin}`)
})

test('同一分钟内的重复观测只计一次（避免轮询反复读到同一活动灌爆样本）', () => {
  freshStore()
  const t = tsOnWeekday(2, 9, 0, 1)
  recordSigninTime('c6', t)
  recordSigninTime('c6', t + 5000)
  recordSigninTime('c6', t + 30000)
  assert.equal(getWindow('c6').samples, 1, '同一分钟只应记一次')
  recordSigninTime('c6', t + 61000)
  assert.equal(getWindow('c6').samples, 2)
})

test('无效输入被忽略（不产生样本、不抛错）', () => {
  freshStore()
  recordSigninTime('c7', 0)
  recordSigninTime('c7', -1)
  recordSigninTime('', 1700000000000)
  assert.equal(getWindow('c7').samples, 0)
})

// ===================== 星期判定 =====================

test('星期判定需要「同一星期 ≥2 次」——一次异常时间不能把星期锁死', () => {
  freshStore()
  // 5 次都在周二，另有 1 次异常落在周四（对应真实数据里那条周四 21:09）
  for (let i = 1; i <= 5; i++) recordSigninTime('c9', tsOnWeekday(2, 10, 0, i))
  recordSigninTime('c9', tsOnWeekday(4, 21, 9, 3))
  const w = getWindow('c9')
  assert.deepEqual(w.weekdays, [2], `应只认定周二，实际 ${JSON.stringify(w.weekdays)}`)
  assert.equal(w.weekdayKnown, true)
})

test('星期已知后：历史星期内轮询，其它星期不轮询', () => {
  freshStore()
  for (let i = 1; i <= 5; i++) recordSigninTime('c10', tsOnWeekday(2, 10, 0, i)) // 全部周二
  const w = getWindow('c10')
  assert.deepEqual(w.weekdays, [2])

  // 周二、窗口内 → 轮询
  assert.equal(shouldPollByWindow('c10', dateOnWeekday(2, 10, 0), 15, 7, 0), true, '周二窗口内应轮询')
  // 周四（非历史星期）→ 不轮询
  assert.equal(shouldPollByWindow('c10', dateOnWeekday(4, 10, 0), 15, 7, 0), false, '非历史星期应跳过')
  // 周六（非历史星期）→ 不轮询
  assert.equal(shouldPollByWindow('c10', dateOnWeekday(6, 10, 0), 15, 7, 0), false, '周末应跳过')
})

test('每周兜底扫描：非历史星期的那一天仍会扫一次（发现星期漂移）', () => {
  freshStore()
  for (let i = 1; i <= 5; i++) recordSigninTime('c11', tsOnWeekday(2, 10, 0, i)) // 只在周二

  // 把每周兜底设在周三的 9 点
  assert.equal(shouldPollByWindow('c11', dateOnWeekday(3, 9, 0), 15, 7, 3), true, '兜底星期应放行')
  // 同一周内再来一次就不应再放行（否则退化成每天轮询）
  assert.equal(shouldPollByWindow('c11', dateOnWeekday(3, 9, 30), 15, 7, 3), false, '同一周期内只放行一次')
  // 周日不轮询、且不是兜底星期
  assert.equal(shouldPollByWindow('c11', dateOnWeekday(0, 9, 0), 15, 7, 3), false, '非兜底星期应跳过')
  // 关闭每周兜底（-1）后，非历史星期一律跳过
  assert.equal(shouldPollByWindow('c11', dateOnWeekday(3, 9, 0), 15, 7, -1), false, '关闭兜底后不应放行')
})

test('每日兜底扫描：历史星期内、窗口外，sweepHour 放行一次（发现时刻漂移）', () => {
  freshStore()
  for (let i = 1; i <= 5; i++) recordSigninTime('c12', tsOnWeekday(2, 10, 0, i))
  // 周二、早上 7 点（窗口外、兜底小时）→ 放行一次
  assert.equal(shouldPollByWindow('c12', dateOnWeekday(2, 7, 5), 15, 7, -1), true, '每日兜底应放行')
  assert.equal(shouldPollByWindow('c12', dateOnWeekday(2, 7, 40), 15, 7, -1), false, '同日不应重复放行')
  // 周二、15 点（窗口外、非兜底小时）→ 跳过
  assert.equal(shouldPollByWindow('c12', dateOnWeekday(2, 15, 0), 15, 7, -1), false, '窗口外非兜底时刻应跳过')
})

test('样本不足的课程完全不受星期与兜底设置影响（始终轮询）', () => {
  freshStore()
  recordSigninTime('c13', tsOnWeekday(2, 10, 0, 1))
  recordSigninTime('c13', tsOnWeekday(2, 10, 0, 2))
  // 只有 2 次 < MIN_SAMPLES
  assert.equal(getWindow('c13').known, false)
  assert.equal(shouldPollByWindow('c13', dateOnWeekday(6, 3, 0), 15, 7, -1), true)
})
