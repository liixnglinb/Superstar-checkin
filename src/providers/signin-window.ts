/**
 * 签到时段学习与过滤
 *
 * 目的：签到发布时间高度规律（实测本机 42 条签到里 76% 集中在周二/周四/周五
 * 上午 10:00 前后），因此可以只为「历史上会发签到的时段」轮询对应课程，
 * 其余时间完全不发请求，把每天数万次无效请求降到千次级别。
 *
 * 三条安全设计（都很重要，改动时别删）：
 *
 * 1. **样本不足就不限制**：低于 MIN_SAMPLES 次观测的课程视为「未知时段」，
 *    全天正常轮询。新课程、新学期第一周因此不会被误伤。
 *
 * 2. **每天一次兜底扫描**：即便有时段，每门课每天仍会在 sweepHour 被完整扫一次。
 *    因为时段一旦算错，这门课就会永远不再被轮询 —— 没有任何反馈信号能纠正它。
 *    这次兜底扫描让「窗口失效」最多只影响 24 小时，而不是永久。
 *
 * 3. **窗口按「时刻」而非「时间戳」匹配**：老师的规律是「每周二 10:00 发签到」，
 *    所以比较的是当天的时分，不涉及星期几 —— 星期几判断错了会直接漏签，
 *    而时刻窗口只要覆盖住就够（代价是每天都会在该时刻扫一会儿）。
 */

import * as fs from 'fs'
import * as path from 'path'
import { logger } from '../utils/logger'
import { writeFileAtomic } from '../utils/fs'

/** 每门课保留的观测样本数 */
const MAX_SAMPLES = 8
/** 至少积累多少次观测才敢限制轮询（不足则全天轮询） */
const MIN_SAMPLES = 4
/**
 * 某个星期至少出现多少次，才认定「这门课在这个星期发签到」。
 * 取 2 是为了不让一次异常时间（如某次周四 21:09 的补签）把整个星期锁死。
 */
const MIN_WEEKDAY_SAMPLES = 2
/** 窗口最小宽度（分钟）：样本集中在同一时刻时，避免窗口过窄 */
const MIN_WINDOW_MINUTES = 60

interface CourseWindowData {
  /** 观测到的签到发布时间（时间戳，毫秒） */
  samples: number[]
  /** 最近一次更新 */
  updatedAt: number
}

let store: Record<string, CourseWindowData> = {}
let storeFile = ''
/**
 * 兜底扫描的放行记录：courseId → 本周期标识（"daily:2026-9-19" / "weekly:2026-9-14"）。
 * 每个周期内同一门课只放行一次，避免兜底退化成全天轮询。
 */
const sweptBuckets = new Map<string, string>()

export function initWindowStore(dataDir: string): void {
  storeFile = path.join(dataDir, 'signin-windows.json')
  try {
    if (fs.existsSync(storeFile)) {
      store = JSON.parse(fs.readFileSync(storeFile, 'utf-8')) || {}
    }
  } catch (e: any) {
    logger.warn(`签到时段数据读取失败（将从零积累）: ${e.message}`)
    store = {}
  }
}

function persist(): void {
  if (!storeFile) return
  try {
    fs.mkdirSync(path.dirname(storeFile), { recursive: true })
    writeFileAtomic(storeFile, JSON.stringify(store, null, 2))
  } catch (e: any) {
    logger.warn(`签到时段数据保存失败: ${e.message}`)
  }
}

/** 记录一次「这门课在这个时间发过签到」。重复时间戳不会重复计入。 */
export function recordSigninTime(courseId: string | number, timestamp: number): void {
  const id = String(courseId)
  if (!id || !timestamp || timestamp <= 0) return
  const cur = store[id] || { samples: [], updatedAt: 0 }
  // 同一分钟内只记一次，避免轮询反复读到同一个活动时灌爆样本
  const bucket = Math.floor(timestamp / 60000)
  if (cur.samples.some(t => Math.floor(t / 60000) === bucket)) return
  cur.samples.push(timestamp)
  cur.samples.sort((a, b) => a - b)
  if (cur.samples.length > MAX_SAMPLES) cur.samples = cur.samples.slice(-MAX_SAMPLES)
  cur.updatedAt = Date.now()
  store[id] = cur
  persist()
}

/** 把时间戳换算成「当天第几分钟」（0~1439） */
function minuteOfDay(ts: number): number {
  const d = new Date(ts)
  return d.getHours() * 60 + d.getMinutes()
}

export interface WindowInfo {
  /** 是否已能判定时段（样本足够） */
  known: boolean
  /** 窗口起点/终点（当天分钟数），unknown 时为 0/1440 */
  startMin: number
  endMin: number
  /** 观测样本数 */
  samples: number
  /** 历史上出现过签到的星期（0=周日 … 6=周六）。观测样本本身带日期，无需额外存储 */
  weekdays: number[]
  /** 是否已能判定「星期几」（至少一个星期的观测次数达标） */
  weekdayKnown: boolean
}

/**
 * 计算某门课的活跃窗口。
 * @param padMinutes 窗口两侧留白（默认 15 分钟）
 */
export function getWindow(courseId: string | number, padMinutes = 15): WindowInfo {
  const cur = store[String(courseId)]
  const n = cur?.samples.length || 0
  if (n < MIN_SAMPLES) {
    // 样本不足：不限制（全天视为活跃），保证新课程/新学期不被误伤
    return { known: false, startMin: 0, endMin: 1440, samples: n, weekdays: [], weekdayKnown: false }
  }
  const mins = cur!.samples.map(minuteOfDay).sort((a, b) => a - b)
  const median = mins[Math.floor(mins.length / 2)]
  let half = Math.max(MIN_WINDOW_MINUTES, padMinutes * 2) / 2
  // 用样本的实际跨度兜一下，避免窗口比历史分布还窄
  const span = (mins[mins.length - 1] - mins[0]) / 2 + padMinutes
  half = Math.max(half, span)
  const startMin = Math.max(0, Math.round(median - half))
  const endMin = Math.min(1440, Math.round(median + half))

  // 星期几：样本时间戳本身带日期，直接统计即可（不需要额外的存储结构）
  const counts = new Map<number, number>()
  for (const t of cur!.samples) {
    const d = new Date(t).getDay()
    counts.set(d, (counts.get(d) || 0) + 1)
  }
  // 只有出现 ≥2 次才算「这门课的固定星期」——一次异常时间不会把星期锁死
  const weekdays = Array.from(counts.entries()).filter(([, c]) => c >= MIN_WEEKDAY_SAMPLES).map(([d]) => d).sort()

  return { known: true, startMin, endMin, samples: n, weekdays, weekdayKnown: weekdays.length > 0 }
}

/**
 * 当前时刻这门课是否应该轮询。
 *
 * 判定顺序（任何一步不满足就跳过，能省则省）：
 *   1. 时段未知 → 全天轮询（保护新课程）
 *   2. 星期判定已建立 → 只在历史星期轮询；不在 → 直接跳过
 *   3. 在活跃窗口内 → 轮询
 *   4. 兜底扫描（每日一次 / 每周一次）→ 放行一次，用于发现时段漂移
 *
 * @param now 当前时间（可注入，便于测试）
 * @param padMinutes 窗口留白
 * @param sweepHour 每日兜底扫描小时（-1 表示关闭）
 * @param weeklySweepDay 每周兜底扫描的星期（0=周日 … 6=周六；-1 表示关闭）
 */
export function shouldPollByWindow(
  courseId: string | number,
  now: Date = new Date(),
  padMinutes = 15,
  sweepHour = 7,
  weeklySweepDay = 0,
): boolean {
  const id = String(courseId)
  const w = getWindow(id, padMinutes)
  // 1) 时段未知：全天轮询
  if (!w.known) return true

  const cur = now.getHours() * 60 + now.getMinutes()
  const weekdayOk = !w.weekdayKnown || w.weekdays.includes(now.getDay())

  // 2) 星期不对：直接跳过（这是省请求的主力）
  if (!weekdayOk) {
    // 每周一次的兜底扫描仍然保留：否则老师一旦换到别的星期，这门课会永远
    // 不被查询、且没有任何报错能暴露它（静默漏签到）。这次扫描把代价限制在一周内。
    return maybeSweep(id, now, 'weekly', weeklySweepDay >= 0 && now.getDay() === weeklySweepDay)
  }

  // 3) 在活跃窗口内
  if (cur >= w.startMin && cur <= w.endMin) return true

  // 4) 星期对但时刻不对：每日兜底
  return maybeSweep(id, now, 'daily', sweepHour >= 0 && now.getHours() === sweepHour)
}

/** 兜底扫描：每个周期内同一门课只放行一次，避免退化成全天轮询 */
function maybeSweep(courseId: string, now: Date, kind: 'daily' | 'weekly', withinWindow: boolean): boolean {
  if (!withinWindow) return false
  const d = new Date(now)
  if (kind === 'weekly') {
    // 以「周日为一周起点」计算周序号，避免跨月干扰
    const day = new Date(d)
    day.setHours(0, 0, 0, 0)
    day.setDate(day.getDate() - day.getDay())
    d.setTime(day.getTime())
  }
  const bucket = `${kind}:${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
  if (sweptBuckets.get(courseId) === bucket) return false
  sweptBuckets.set(courseId, bucket)
  logger.debug(`兜底扫描 ${courseId}（${kind === 'daily' ? '每日' : '每周'}一次，用于发现时段漂移）`)
  return true
}

/** 供控制台展示：每门课的时段摘要 */
export function getWindowSummary(): Record<string, { known: boolean; text: string; samples: number; weekdays?: string }> {
  const out: Record<string, { known: boolean; text: string; samples: number; weekdays?: string }> = {}
  const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  for (const id of Object.keys(store)) {
    const w = getWindow(id)
    const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    const wdText = w.weekdayKnown ? w.weekdays.map(d => WD[d]).join('/') : ''
    out[id] = {
      known: w.known,
      samples: w.samples,
      weekdays: wdText,
      text: w.known
        ? `${fmt(w.startMin)}–${fmt(w.endMin)}${wdText ? ' · ' + wdText : ''}`
        : `样本不足（${w.samples} 次），全天轮询`,
    }
  }
  return out
}
