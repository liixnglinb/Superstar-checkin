/**
 * 签到观测记录
 *
 * ⚠️ 职责变更（2026-09-19）：本模块**不再参与扫描决策**。
 * 扫描时段改由用户填写的课表决定（见 providers/timetable.ts），因为软件只能从历史
 * 签到时间反推时段，既慢（要攒样本）又不准（老师换时间就学歪），而课表是用户已知的。
 *
 * 现在这里只做两件事：
 *   1. 记录每门课的签到发布时间（观测），供「课表自动填充」推断课程排在哪一节；
 *   2. 给控制台展示观测摘要。
 *
 * 注：此前实现的 shouldPollByWindow（时段/星期/兜底扫描）已删除 —— 课表取代后它成为
 * 死代码，留着会让维护者误以为它仍在生效。
 */

import * as fs from 'fs'
import * as path from 'path'
import { logger } from '../utils/logger'
import { writeFileAtomic } from '../utils/fs'

/** 每门课保留的观测样本数 */
const MAX_SAMPLES = 8
/** 至少积累多少次观测，才算「观测充分」（用于展示与自动填充判断） */
const MIN_SAMPLES = 4
/**
 * 某个星期至少出现多少次，才认定「这门课在这个星期发签到」。
 * 取 2 是为了不让一次异常时间（如某次周四 21:09 的补签）把整个星期锁死。
 */
const MIN_WEEKDAY_SAMPLES = 2

interface CourseWindowData {
  /** 观测到的签到发布时间（时间戳，毫秒） */
  samples: number[]
  /** 最近一次更新 */
  updatedAt: number
}

let store: Record<string, CourseWindowData> = {}
let storeFile = ''

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
  /** 观测是否足够（≥ MIN_SAMPLES） */
  known: boolean
  /** 观测到的时刻范围（当天分钟数），供展示 */
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
 * 汇总某门课的签到观测（**仅用于展示与课表自动填充**，不参与扫描决策）。
 */
export function getWindow(courseId: string | number): WindowInfo {
  const cur = store[String(courseId)]
  const n = cur?.samples.length || 0
  if (n === 0) {
    return { known: false, startMin: 0, endMin: 0, samples: 0, weekdays: [], weekdayKnown: false }
  }
  const mins = cur!.samples.map(minuteOfDay).sort((a, b) => a - b)

  // 星期几：样本时间戳本身带日期，直接统计即可（不需要额外的存储结构）
  const counts = new Map<number, number>()
  for (const t of cur!.samples) {
    const d = new Date(t).getDay()
    counts.set(d, (counts.get(d) || 0) + 1)
  }
  // 只有出现 ≥2 次才算「这门课的固定星期」——一次异常时间（如某次补签）不会把星期锁死
  const weekdays = Array.from(counts.entries()).filter(([, c]) => c >= MIN_WEEKDAY_SAMPLES).map(([d]) => d).sort()

  return {
    known: n >= MIN_SAMPLES,
    startMin: mins[0],
    endMin: mins[mins.length - 1],
    samples: n,
    weekdays,
    weekdayKnown: weekdays.length > 0,
  }
}

/** 供控制台展示：每门课的时段摘要（仅用于展示，不参与扫描决策） */
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
        : `样本不足（${w.samples} 次）`,
    }
  }
  return out
}

/**
 * 导出原始观测样本（courseId -> 时间戳数组），用于「课表自动填充」。
 * 取每门课最近一次签到时间推断它排在哪一节。
 */
export function getObservations(): Record<string, number[]> {
  const out: Record<string, number[]> = {}
  for (const [id, data] of Object.entries(store)) {
    if (data?.samples?.length) out[id] = [...data.samples]
  }
  return out
}
