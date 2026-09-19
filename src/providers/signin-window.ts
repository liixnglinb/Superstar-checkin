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
/** 当天已做过兜底扫描的 courseId（跨天重置） */
let sweptDate = ''
const sweptToday = new Set<string>()

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
    return { known: false, startMin: 0, endMin: 1440, samples: n }
  }
  const mins = cur!.samples.map(minuteOfDay).sort((a, b) => a - b)
  const median = mins[Math.floor(mins.length / 2)]
  let half = Math.max(MIN_WINDOW_MINUTES, padMinutes * 2) / 2
  // 用样本的实际跨度兜一下，避免窗口比历史分布还窄
  const span = (mins[mins.length - 1] - mins[0]) / 2 + padMinutes
  half = Math.max(half, span)
  const startMin = Math.max(0, Math.round(median - half))
  const endMin = Math.min(1440, Math.round(median + half))
  return { known: true, startMin, endMin, samples: n }
}

/**
 * 当前时刻这门课是否应该轮询。
 *
 * @param now 当前时间（可注入，便于测试）
 * @param padMinutes 窗口留白
 * @param sweepHour 每日兜底扫描小时（-1 表示关闭兜底）
 */
export function shouldPollByWindow(
  courseId: string | number,
  now: Date = new Date(),
  padMinutes = 15,
  sweepHour = 7,
): boolean {
  const w = getWindow(courseId, padMinutes)
  // 时段未知：全天轮询
  if (!w.known) return true

  const cur = now.getHours() * 60 + now.getMinutes()
  if (cur >= w.startMin && cur <= w.endMin) return true

  // 每日兜底扫描：跨天重置标记
  const today = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
  if (sweptDate !== today) {
    sweptDate = today
    sweptToday.clear()
  }
  if (sweepHour >= 0 && now.getHours() === sweepHour && !sweptToday.has(String(courseId))) {
    sweptToday.add(String(courseId))
    logger.debug(`兜底扫描 ${courseId}（不在活跃窗口内，每日一次）`)
    return true
  }

  return false
}

/** 供控制台展示：每门课的时段摘要 */
export function getWindowSummary(): Record<string, { known: boolean; text: string; samples: number }> {
  const out: Record<string, { known: boolean; text: string; samples: number }> = {}
  for (const id of Object.keys(store)) {
    const w = getWindow(id)
    const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    out[id] = {
      known: w.known,
      samples: w.samples,
      text: w.known ? `${fmt(w.startMin)}–${fmt(w.endMin)}` : `样本不足（${w.samples} 次），全天轮询`,
    }
  }
  return out
}
