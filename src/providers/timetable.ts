/**
 * 课表（用户填写）—— 轮询扫描的唯一依据
 *
 * 为什么改成「用户填课表」而不是软件自己学时段：
 * 软件只能从历史签到时间反推，那既慢（要攒样本）又不准（老师偶尔换时间就学歪）。
 * 用户自己知道课表，填一次即可长期使用，且随时可改。软件只负责按课表扫描。
 *
 * 固定时间框架（用户指定）：周一~周五，每天 8 节
 *   上午 4 节：07:30–12:30
 *   下午 4 节：14:00–21:00
 * 每节只允许放一门课（用户明确要求「每个时间段只有一个课程」）。
 *
 * 安全阀：课表**必须填满**才能生效。填不满时一律按「未配置」处理（全天轮询，
 * 但受扫描时段限制），避免用户填一半就以为在正常工作 —— 那会静默漏签。
 */

import * as fs from 'fs'
import * as path from 'path'
import { logger } from '../utils/logger'
import { writeFileAtomic } from '../utils/fs'

/** 每节课的时间边界（分钟表示，便于比较） */
export interface SlotDef {
  /** 节次索引 0~7 */
  index: number
  /** 所属半天：morning / afternoon */
  half: 'morning' | 'afternoon'
  /** 展示用名称 */
  label: string
  /** 起止时刻（当天分钟数） */
  startMin: number
  endMin: number
  /** 展示用起止时间 */
  startText: string
  endText: string
}

/** 固定的 8 节课（上午 4 + 下午 4） */
export const SLOTS: SlotDef[] = [
  { index: 0, half: 'morning', label: '第1节', startMin: 7 * 60 + 30, endMin: 8 * 60 + 45, startText: '07:30', endText: '08:45' },
  { index: 1, half: 'morning', label: '第2节', startMin: 8 * 60 + 45, endMin: 10 * 60 + 0, startText: '08:45', endText: '10:00' },
  { index: 2, half: 'morning', label: '第3节', startMin: 10 * 60 + 0, endMin: 11 * 60 + 15, startText: '10:00', endText: '11:15' },
  { index: 3, half: 'morning', label: '第4节', startMin: 11 * 60 + 15, endMin: 12 * 60 + 30, startText: '11:15', endText: '12:30' },
  { index: 4, half: 'afternoon', label: '第5节', startMin: 14 * 60 + 0, endMin: 15 * 60 + 45, startText: '14:00', endText: '15:45' },
  { index: 5, half: 'afternoon', label: '第6节', startMin: 15 * 60 + 45, endMin: 17 * 60 + 30, startText: '15:45', endText: '17:30' },
  { index: 6, half: 'afternoon', label: '第7节', startMin: 17 * 60 + 30, endMin: 19 * 60 + 15, startText: '17:30', endText: '19:15' },
  { index: 7, half: 'afternoon', label: '第8节', startMin: 19 * 60 + 15, endMin: 21 * 60 + 0, startText: '19:15', endText: '21:00' },
]

/** 允许扫描的星期：周一~周五 */
export const WEEKDAYS = [1, 2, 3, 4, 5]
export const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 整体扫描时段窗（用户指定）：7:30–12:30 与 14:00–21:00 */
export const SCAN_WINDOW = { startMin: 7 * 60 + 30, endMin: 21 * 60 }

/**
 * 课表数据：{ "1": [courseId|null × 8], ... }，键为星期（1~5）。
 * 值里存 courseId 字符串，未填为 null。
 */
export type Timetable = Record<string, (string | null)[]>

let table: Timetable = {}
let tableFile = ''

export function initTimetable(dataDir: string): void {
  // 必须先清空内存状态：否则在同一进程内重复初始化（测试、或换数据目录）时，
  // 上一次的课表会残留在内存里，表现为"新目录没有课表却显示已填满"。
  table = {}
  tableFile = path.join(dataDir, 'timetable.json')
  try {
    if (fs.existsSync(tableFile)) {
      const raw = JSON.parse(fs.readFileSync(tableFile, 'utf-8'))
      table = normalize(raw)
    }
  } catch (e: any) {
    logger.warn(`课表读取失败（按未配置处理）: ${e.message}`)
    table = {}
  }
}

/** 规整成完整结构：周一~周五 × 8 节，缺的补 null，非法值剔除 */
function normalize(raw: any): Timetable {
  const out: Timetable = {}
  for (const d of WEEKDAYS) {
    const arr = Array.isArray(raw?.[d]) ? raw[d] : (Array.isArray(raw?.[String(d)]) ? raw[String(d)] : [])
    out[String(d)] = SLOTS.map((_, i) => {
      const v = arr[i]
      return v === undefined || v === null || v === '' ? null : String(v)
    })
  }
  return out
}

export function getTimetable(): Timetable {
  // 保证返回的永远是完整结构（未初始化时也返回空课表）
  return normalize(table)
}

/** 课表是否已填满（全部 40 格都有课程） */
export function isTimetableComplete(t?: Timetable): boolean {
  const tb = t || getTimetable()
  for (const d of WEEKDAYS) {
    const arr = tb[String(d)] || []
    for (let i = 0; i < SLOTS.length; i++) {
      if (!arr[i]) return false
    }
  }
  return true
}

/** 统计已填格数与空格清单（用于界面提示「务必全部填完」） */
export function getTimetableStatus(): {
  total: number
  filled: number
  complete: boolean
  emptySlots: Array<{ weekday: number; weekdayName: string; slot: number; label: string; time: string }>
} {
  const tb = getTimetable()
  const total = WEEKDAYS.length * SLOTS.length
  let filled = 0
  const emptySlots: Array<{ weekday: number; weekdayName: string; slot: number; label: string; time: string }> = []
  for (const d of WEEKDAYS) {
    const arr = tb[String(d)] || []
    for (const s of SLOTS) {
      if (arr[s.index]) filled++
      else {
        emptySlots.push({
          weekday: d, weekdayName: WEEKDAY_NAMES[d], slot: s.index,
          label: s.label, time: `${s.startText}–${s.endText}`,
        })
      }
    }
  }
  return { total, filled, complete: emptySlots.length === 0, emptySlots }
}

/** 保存课表。返回是否成功；校验交给调用方（需要给出明确的"必须填满"提示） */
export function saveTimetable(input: any): { ok: boolean; message: string; status: ReturnType<typeof getTimetableStatus> } {
  const normalized = normalize(input)
  const status = getTimetableStatusOf(normalized)
  if (!status.complete) {
    // 不写盘：填一半的课表比没有课表更危险（看起来在正常工作，实际漏签）
    return {
      ok: false,
      message: `课表未填完（已填 ${status.filled}/${status.total}），未保存。务必把所有格子填完，否则无法识别该时段的签到，只能手动签到。`,
      status,
    }
  }
  table = normalized
  persist()
  logger.success(`课表已保存：${status.filled}/${status.total} 格全部填完`)
  return { ok: true, message: `课表已保存（${status.filled}/${status.total} 格），扫描将严格按课表进行`, status }
}

function getTimetableStatusOf(tb: Timetable) {
  const total = WEEKDAYS.length * SLOTS.length
  let filled = 0
  const emptySlots: Array<{ weekday: number; weekdayName: string; slot: number; label: string; time: string }> = []
  for (const d of WEEKDAYS) {
    const arr = tb[String(d)] || []
    for (const s of SLOTS) {
      if (arr[s.index]) filled++
      else emptySlots.push({ weekday: d, weekdayName: WEEKDAY_NAMES[d], slot: s.index, label: s.label, time: `${s.startText}–${s.endText}` })
    }
  }
  return { total, filled, complete: emptySlots.length === 0, emptySlots }
}

function persist(): void {
  if (!tableFile) return
  try {
    fs.mkdirSync(path.dirname(tableFile), { recursive: true })
    writeFileAtomic(tableFile, JSON.stringify(table, null, 2))
  } catch (e: any) {
    logger.warn(`课表保存失败: ${e.message}`)
  }
}

/** 当前时刻落在第几节（不在任何节次内返回 -1） */
export function slotAt(now: Date = new Date()): number {
  const cur = now.getHours() * 60 + now.getMinutes()
  const s = SLOTS.find(s => cur >= s.startMin && cur < s.endMin)
  return s ? s.index : -1
}

/**
 * 当前时刻应该扫描哪些课程（课表驱动）。
 *
 * 返回：
 *   - allowed=false：不在扫描时段（周末 / 早晚之外）→ 一个都不扫
 *   - configured=false：课表未配置完整 → 不限制课程（但仍受时段限制），
 *     保证用户在填课表之前软件不是完全瞎的
 */
export function coursesToScanNow(
  now: Date = new Date(),
): { allowed: boolean; configured: boolean; courseIds: string[]; slot: number } {
  const dow = now.getDay()
  const slot = slotAt(now)
  const inWindow = dow >= 1 && dow <= 5 && slot >= 0
  if (!inWindow) return { allowed: false, configured: isTimetableComplete(), courseIds: [], slot: -1 }

  const tb = getTimetable()
  if (!isTimetableComplete(tb)) {
    // 课表未填完：不过滤课程（否则用户没填就完全扫不到），仅按时间窗限制
    return { allowed: true, configured: false, courseIds: [], slot }
  }
  const id = tb[String(dow)]?.[slot]
  return { allowed: true, configured: true, courseIds: id ? [String(id)] : [], slot }
}

/**
 * 从签到观测时间生成课表建议（用于「自动填充」按钮）。
 *
 * 在**现有课表基础上**增量填充：已填的格子绝不覆盖 ——
 * 否则用户手动填好的会被自动填充冲掉（"自动填充剩余空格"才是符合预期的行为）。
 */
export function suggestFromObservations(
  observations: Record<string, number[]>,
  courseNameOf: (courseId: string) => string,
): { table: Timetable; filled: number; details: Array<{ weekday: number; slot: number; courseId: string; courseName: string; from: string }> } {
  const tb = normalize(getTimetable())
  const details: Array<{ weekday: number; slot: number; courseId: string; courseName: string; from: string }> = []
  for (const [courseId, times] of Object.entries(observations)) {
    const latest = (times || []).slice().sort((a, b) => b - a)[0]
    if (!latest) continue
    const d = new Date(latest)
    const dow = d.getDay()
    if (dow < 1 || dow > 5) continue
    const mins = d.getHours() * 60 + d.getMinutes()
    const slotDef = SLOTS.find(s => mins >= s.startMin && mins < s.endMin)
    if (!slotDef) continue
    const key = String(dow)
    if (tb[key][slotDef.index]) continue // 已填（手填或先前推断），不覆盖
    tb[key][slotDef.index] = courseId
    details.push({
      weekday: dow, slot: slotDef.index, courseId,
      courseName: courseNameOf(courseId),
      from: `${WEEKDAY_NAMES[dow]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
    })
  }
  return { table: tb, filled: details.length, details }
}
