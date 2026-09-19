/**
 * 免责声明的接受记录
 *
 * 为什么要存在服务端而不是浏览器 localStorage：
 * localStorage 是每个浏览器独立的 —— 桌面端（Electron 内嵌浏览器）与手机浏览器
 * 各自维护一份，换浏览器或清缓存就会重复弹窗，用户会以为是 bug。
 * 存到 data/ 下后，两种入口共用一份状态，并且留下**接受时间与声明版本**，
 * 若日后需要说明"用户已阅读并同意"，有据可查。
 *
 * 修改免责声明正文时必须同时提升 CONSENT_VERSION ——
 * 否则老用户不会重新确认，等于新条款没被同意过。
 */

import * as fs from 'fs'
import * as path from 'path'
import { logger } from '../utils/logger'
import { writeFileAtomic } from '../utils/fs'

/** 免责声明版本：正文有实质修改时 +1 */
export const CONSENT_VERSION = 1

interface ConsentRecord {
  accepted: boolean
  /** 接受时的时间（ISO 字符串，便于人工核对） */
  acceptedAt?: string
  /** 接受时的免责声明版本 */
  version?: number
}

let record: ConsentRecord = { accepted: false }
let file = ''

export function initDisclaimer(dataDir: string): void {
  file = path.join(dataDir, 'disclaimer.json')
  record = { accepted: false }
  try {
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
      // 版本不一致视为未接受：声明更新后必须重新确认
      if (raw && raw.accepted === true && Number(raw.version) === CONSENT_VERSION) {
        record = { accepted: true, acceptedAt: raw.acceptedAt, version: raw.version }
      }
    }
  } catch (e: any) {
    logger.warn(`免责声明记录读取失败（按未接受处理）: ${e.message}`)
    record = { accepted: false }
  }
}

export function getConsent(): ConsentRecord & { currentVersion: number } {
  return { ...record, currentVersion: CONSENT_VERSION }
}

export function acceptDisclaimer(): { accepted: boolean; acceptedAt: string; version: number } {
  const acceptedAt = new Date().toISOString()
  record = { accepted: true, acceptedAt, version: CONSENT_VERSION }
  try {
    if (file) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      writeFileAtomic(file, JSON.stringify(record, null, 2))
    }
  } catch (e: any) {
    logger.warn(`免责声明记录保存失败（本次会话内仍视为已接受）: ${e.message}`)
  }
  logger.info(`用户已接受免责声明（版本 ${CONSENT_VERSION}，${acceptedAt}）`)
  return { accepted: true, acceptedAt, version: CONSENT_VERSION }
}
