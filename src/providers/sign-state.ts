/**
 * 全局签到状态
 *
 * 解决两个原有缺陷：
 * 1. IM 监听器与轮询监听器各自维护去重集合，hybrid 模式下同一次签到可能被两个监听器各签一次。
 *    这里提供跨监听器共享的「已处理 aid 集合」。
 * 2. 原 index.ts 用单个全局变量 `pendingQrAid` 记录待处理的二维码签到，同时出现多个时会互相覆盖。
 *    这里改用 Map，支持并发的二维码签到，并可在多待办中取最近一个。
 */

// ===================== 去重（跨监听器共享） =====================

import * as fs from 'fs'
import * as path from 'path'
import { writeFileAtomic } from '../utils/fs'

const processedAids = new Set<string>()

const MAX_PROCESSED_AIDS = 5000

function trimProcessedAids(): void {
  while (processedAids.size > MAX_PROCESSED_AIDS) {
    const oldest = processedAids.values().next().value
    if (!oldest) break
    processedAids.delete(oldest)
  }
}

/** 标记某次签到活动已处理，返回之前是否已被处理（true=重复） */
export function markProcessed(aid: string): boolean {
  if (processedAids.has(aid)) return true
  processedAids.add(aid)
  trimProcessedAids()
  scheduleStatePersist()
  return false
}

export function isProcessed(aid: string): boolean {
  return processedAids.has(aid)
}

/** 撤销已处理标记（签到失败后调用，允许后续轮询/IM 重试） */
export function unmarkProcessed(aid: string): void {
  processedAids.delete(aid)
  scheduleStatePersist()
}

// ===================== 失败重试计数 =====================
// 撤销标记后 poll 每轮都会重新发现该签到，若不限次会无限重试。
// 这里为每个 aid 记录失败次数，超过上限后不再撤销标记（放弃重试）。

const MAX_FAIL_RETRY = 3
const failCounts = new Map<string, number>()

/** 记录一次签到处理失败，返回累计失败次数 */
export function recordFail(aid: string): number {
  const n = (failCounts.get(aid) || 0) + 1
  failCounts.set(aid, n)
  scheduleStatePersist()
  return n
}

/** 是否仍允许重试（失败次数未超上限） */
export function shouldRetryFail(aid: string): boolean {
  return (failCounts.get(aid) || 0) < MAX_FAIL_RETRY
}

/** 签到成功或放弃后清除失败计数 */
export function clearFail(aid: string): void {
  failCounts.delete(aid)
  scheduleStatePersist()
}

/** 防止内存无限增长：只保留最近 N 条 */
export function trimProcessed(max = 1000): void {
  if (processedAids.size <= max) return
  const arr = Array.from(processedAids)
  processedAids.clear()
  for (const aid of arr.slice(-max)) processedAids.add(aid)
  scheduleStatePersist()
}

// ===================== 二维码待处理队列 =====================

export interface PendingQr {
  courseName: string
  createdAt: number
}

const pendingQr = new Map<string, PendingQr>()

let stateFile = ''
let statePersistTimer: NodeJS.Timeout | null = null

export function initSignState(dataDir: string): void {
  stateFile = path.join(dataDir, 'sign-state.json')
  fs.mkdirSync(dataDir, { recursive: true })
  try {
    if (fs.existsSync(stateFile)) {
      const saved = JSON.parse(fs.readFileSync(stateFile, 'utf-8'))
      for (const aid of saved.processedAids || []) processedAids.add(String(aid))
      for (const [aid, count] of Object.entries(saved.failCounts || {})) failCounts.set(String(aid), Number(count))
      for (const [aid, info] of Object.entries(saved.pendingQr || {})) pendingQr.set(String(aid), info as PendingQr)
    }
  } catch {
    // 状态文件损坏时继续运行，签到仍可用
  }
}

function scheduleStatePersist(): void {
  if (statePersistTimer) return
  statePersistTimer = setTimeout(() => {
    statePersistTimer = null
    persistState()
  }, 1000)
}

function persistState(): void {
  if (!stateFile) return
  const payload = {
    processedAids: Array.from(processedAids),
    failCounts: Object.fromEntries(failCounts),
    pendingQr: Object.fromEntries(pendingQr),
  }
  writeFileAtomic(stateFile, JSON.stringify(payload, null, 2))
}

/** 待处理项过期时间（30 分钟），避免陈旧签到永久占用 */
const PENDING_TTL = 30 * 60 * 1000

/** 清理已过期的二维码待处理项 */
function sweepPending(m: Map<string, { createdAt: number }>) {
  const now = Date.now()
  for (const [k, v] of m) {
    if (now - v.createdAt > PENDING_TTL) m.delete(k)
  }
}

/** 登记一个待处理的二维码签到 */
export function setPendingQr(aid: string, info: Omit<PendingQr, 'createdAt'>): void {
  sweepPending(pendingQr)
  pendingQr.set(aid, { ...info, createdAt: Date.now() })
  scheduleStatePersist()
}

export function getPendingQr(aid: string): PendingQr | undefined {
  return pendingQr.get(aid)
}

/** 是否还有待处理的二维码签到 */
export function hasPendingQr(): boolean {
  return pendingQr.size > 0
}

/** 取出并移除最近登记的一个待处理二维码（JS Map 保留插入顺序，最后一个即最近） */
export function takeLatestPendingQr(): { aid: string; info: PendingQr } | null {
  sweepPending(pendingQr)
  const keys = Array.from(pendingQr.keys())
  if (keys.length === 0) return null
  const aid = keys[keys.length - 1]
  const info = pendingQr.get(aid)!
  pendingQr.delete(aid)
  scheduleStatePersist()
  return { aid, info }
}

/** 取出指定 aid 的待处理二维码（精确匹配时使用） */
export function takePendingQr(aid: string): PendingQr | null {
  sweepPending(pendingQr)
  const info = pendingQr.get(aid)
  if (!info) return null
  pendingQr.delete(aid)
  scheduleStatePersist()
  return info
}


