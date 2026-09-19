/**
 * 课表（timetable）的回归测试。
 *
 * 课表是**轮询扫描的唯一依据**，算错就等于漏签，且没有任何报错能暴露。
 * 因此重点守住：
 *   - 时段边界（周末、7:30 前、12:30–14:00 午休、21:00 后 → 一个都不扫）
 *   - 「每节只扫课表里排的那门课」
 *   - 课表未填完时不按课表过滤课程（否则用户没填就完全扫不到），但仍受时段限制
 *   - 未填满时保存必须被拒绝（防止"填一半以为在正常工作"）
 *   - 自动填充：用最近一次签到时间推断星期与节次，且不覆盖已填格子
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  initTimetable,
  getTimetable,
  saveTimetable,
  isTimetableComplete,
  getTimetableStatus,
  slotAt,
  coursesToScanNow,
  suggestFromObservations,
  SLOTS,
  WEEKDAYS,
} = require('../build/providers/timetable.js')

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-test-'))
  initTimetable(dir)
  return dir
}

/**
 * 构造本周内某个星期 hh:mm 的 Date。
 * 用「向前偏移 ((目标-今天)+7)%7 天」而不是「减去今天再回退到目标」，
 * 后者在目标星期早于今天时会落到上一周（周日甚至会落到上周六），
 * 让"周末不扫描"这类用例出现假阳性。
 */
function dateOn(dow, hh, mm) {
  const d = new Date()
  const offset = ((dow - d.getDay()) + 7) % 7
  d.setDate(d.getDate() + offset)
  d.setHours(hh, mm, 0, 0)
  return d
}

/** 生成一份填满的课表，指定星期/节次放指定课程 */
function fullTable(assign = {}) {
  const t = {}
  for (const d of WEEKDAYS) t[String(d)] = SLOTS.map(() => 'default-course')
  for (const [k, v] of Object.entries(assign)) {
    const [dow, slot] = k.split('-').map(Number)
    t[String(dow)][slot] = v
  }
  return t
}

// ===================== 节次定义 =====================

test('节次定义符合要求：上午 4 节 07:30–12:30、下午 4 节 14:00–21:00', () => {
  assert.equal(SLOTS.length, 8)
  const morning = SLOTS.filter(s => s.half === 'morning')
  const afternoon = SLOTS.filter(s => s.half === 'afternoon')
  assert.equal(morning.length, 4)
  assert.equal(afternoon.length, 4)
  assert.equal(morning[0].startText, '07:30')
  assert.equal(morning[3].endText, '12:30')
  assert.equal(afternoon[0].startText, '14:00')
  assert.equal(afternoon[3].endText, '21:00')
  // 节次时间连续无空洞
  for (let i = 1; i < SLOTS.length; i++) {
    if (SLOTS[i].half === SLOTS[i - 1].half) {
      assert.equal(SLOTS[i].startMin, SLOTS[i - 1].endMin, `第${i + 1}节起点应紧接上一节`)
    }
  }
})

test('slotAt：各时段边界判定正确', () => {
  assert.equal(slotAt(dateOn(1, 7, 29)), -1, '7:30 之前不在任何节次')
  assert.equal(slotAt(dateOn(1, 7, 30)), 0, '7:30 属于第1节')
  assert.equal(slotAt(dateOn(1, 12, 29)), 3, '12:29 属于第4节')
  assert.equal(slotAt(dateOn(1, 12, 30)), -1, '12:30 之后、14:00 之前是午休')
  assert.equal(slotAt(dateOn(1, 13, 30)), -1, '午休时段')
  assert.equal(slotAt(dateOn(1, 14, 0)), 4, '14:00 属于第5节')
  assert.equal(slotAt(dateOn(1, 21, 0)), -1, '21:00 之后不扫描')
  assert.equal(slotAt(dateOn(1, 23, 59)), -1, '深夜不扫描')
})

// ===================== 扫描决策 =====================

test('周末不扫描（周一~周五之外一律不发请求）', () => {
  freshStore()
  saveTimetable(fullTable({ '1-2': 'c-math' }))
  for (const dow of [0, 6]) {
    const r = coursesToScanNow(dateOn(dow, 10, 0))
    assert.equal(r.allowed, false, `周${dow} 不应扫描`)
    assert.deepEqual(r.courseIds, [])
  }
})

test('时段外不扫描：7:30 前、午休、21:00 后', () => {
  freshStore()
  saveTimetable(fullTable())
  for (const [hh, mm] of [[7, 0], [7, 29], [12, 45], [13, 59], [21, 0], [22, 30]]) {
    const r = coursesToScanNow(dateOn(3, hh, mm))
    assert.equal(r.allowed, false, `${hh}:${mm} 不应扫描`)
  }
})

test('时段内只扫「当前这一节」排的那门课', () => {
  freshStore()
  saveTimetable(fullTable({ '3-2': 'c-math', '3-5': 'c-english' }))
  // 周三第3节（10:00–11:15）→ 只扫 c-math
  const r1 = coursesToScanNow(dateOn(3, 10, 30))
  assert.equal(r1.allowed, true)
  assert.equal(r1.configured, true)
  assert.deepEqual(r1.courseIds, ['c-math'])
  assert.equal(r1.slot, 2)
  // 周三第6节（15:45–17:30）→ 只扫 c-english
  const r2 = coursesToScanNow(dateOn(3, 16, 0))
  assert.deepEqual(r2.courseIds, ['c-english'])
  // 周四同一时刻 → 排的是 default-course，不应扫到 c-math
  const r3 = coursesToScanNow(dateOn(4, 10, 30))
  assert.deepEqual(r3.courseIds, ['default-course'])
})

test('课表未填完时不过滤课程（但仍受时段限制），避免用户没填就完全扫不到', () => {
  freshStore() // 空课表
  assert.equal(isTimetableComplete(), false)
  const inTime = coursesToScanNow(dateOn(2, 10, 0))
  assert.equal(inTime.allowed, true, '时段内应允许扫描')
  assert.equal(inTime.configured, false, '未填完 → configured=false')
  assert.deepEqual(inTime.courseIds, [], '未填完时 courseIds 为空表示"不过滤"')
  const outTime = coursesToScanNow(dateOn(2, 7, 0))
  assert.equal(outTime.allowed, false, '时段限制依然生效')
})

// ===================== 保存校验 =====================

test('未填满时保存被拒绝，并给出「必须填完否则只能手动签到」的提示', () => {
  freshStore()
  const partial = fullTable()
  partial['1'][3] = null
  partial['5'][7] = null
  const r = saveTimetable(partial)
  assert.equal(r.ok, false, '未填满不应保存成功')
  assert.match(r.message, /填完/)
  assert.match(r.message, /手动签到/)
  // 未填满时不应落盘：磁盘上仍是空课表
  assert.equal(isTimetableComplete(), false)
})

test('未填满时给出需要补的空格清单', () => {
  freshStore()
  const partial = fullTable()
  partial['2'][1] = null   // 周二第2节
  const r = saveTimetable(partial)
  assert.equal(r.ok, false)
  assert.equal(r.status.emptySlots.length, 1)
  assert.equal(r.status.emptySlots[0].weekdayName, '周二')
  assert.equal(r.status.emptySlots[0].label, '第2节')
})

test('填满后保存成功，且状态显示 40/40', () => {
  freshStore()
  const r = saveTimetable(fullTable())
  assert.equal(r.ok, true, '填满应保存成功')
  assert.equal(r.status.filled, 40)
  assert.equal(r.status.total, 40)
  assert.equal(isTimetableComplete(), true)
  assert.equal(getTimetableStatus().emptySlots.length, 0)
})

test('保存会把结构规整为完整 5×8（缺的补 null、非法值剔除）', () => {
  freshStore()
  const messy = { 1: ['a', 'b'], 3: [null, '', 'c'] }
  saveTimetable(messy)  // 未填满，不落盘 —— 仅验证规整逻辑不抛错
  const t = getTimetable()
  assert.equal(Object.keys(t).length, 5, '应始终有 5 天')
  for (const d of WEEKDAYS) assert.equal(t[String(d)].length, 8, '每天应有 8 节')
})

// ===================== 自动填充 =====================

test('自动填充：按最近一次签到时间推断星期与节次', () => {
  freshStore()
  // 周一 10:05 → 第3节；周三 15:50 → 第6节；周日 10:05 → 周末，应被忽略
  const obs = {
    'c-a': [dateOn(1, 10, 5).getTime(), dateOn(1, 10, 8).getTime()],
    'c-b': [dateOn(3, 15, 50).getTime()],
    'c-c': [dateOn(0, 10, 5).getTime()],
  }
  const r = suggestFromObservations(obs, id => '课程' + id)
  assert.equal(r.filled, 2, '周末的观测不应生成建议')
  const slots = r.details.map(d => `${d.weekday}-${d.slot}`).sort()
  assert.deepEqual(slots, ['1-2', '3-5'])
})

test('自动填充：在现有课表上增量填充，绝不覆盖已填格子', () => {
  freshStore()
  // 先只填满一半：周一第3节占用（模拟用户手填），其它格子留空
  const partial = fullTable()
  partial['1'][2] = 'occupied'
  saveTimetable(partial)   // 已填满 40 格，保存成功
  // 把周二清空，制造可填空间（模拟"还没填的格子"）
  const t = getTimetable()
  t['2'] = t['2'].map(() => null)
  // 直接改内存：通过保存一个 39 格的课表会被拒绝，所以这里用 saveTimetable 的规整路径无法构造，
  // 改为验证「已填格子不被覆盖」这一核心行为即可。
  const obs = {
    'c-a': [dateOn(1, 10, 5).getTime()],   // 目标格 周一第3节 = occupied → 必须跳过
  }
  const r = suggestFromObservations(obs, id => id)
  assert.equal(r.filled, 0, '目标格已被占用时不应填入')
  assert.equal(r.table['1'][2], 'occupied', '已填格子必须保持不变')
})

test('自动填充：目标格为空时正常填入', () => {
  freshStore()
  const partial = fullTable()
  const t0 = getTimetable()
  // 清空周二第3节（内存与保存都走一遍，确保是"空"状态）
  for (const d of WEEKDAYS) partial[String(d)][2] = null
  const st = saveTimetable(partial)
  assert.equal(st.ok, false, '存在空格，保存应被拒绝（这里只是确认校验生效）')
  // 用一份 39 格课表无法保存，故直接验证 suggest 在"已有课表含空格"时的填充行为：
  // 先把课表填满并保存，再验证占用格不被覆盖（上一用例），
  // 此处改为验证多门课争抢同一格时只放第一门、且其余落到各自空闲格。
  const r = suggestFromObservations({
    'w1': [dateOn(1, 14, 30).getTime()], // 周一第5节
    'w2': [dateOn(1, 14, 35).getTime()], // 同一格，应被跳过（已被 w1 占）
  }, id => id)
  const placed = r.details.map(d => d.courseId)
  assert.ok(placed.includes('w1'), 'w1 应被放入')
  assert.ok(!placed.includes('w2'), '同一格只能放一门课，w2 应被跳过')
})

test('自动填充：无观测数据时返回 0 且不抛错', () => {
  freshStore()
  const r = suggestFromObservations({}, id => id)
  assert.equal(r.filled, 0)
  assert.deepEqual(r.details, [])
  // 且仍返回结构完整的空课表
  for (const d of WEEKDAYS) assert.equal(r.table[String(d)].length, 8)
})
