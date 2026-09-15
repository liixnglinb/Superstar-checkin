import { CheckinEngine } from '../core/checkin-engine'
import { logger } from '../utils/logger'
import { randomDelay } from '../utils/anti-detect'
import { retry } from '../utils/retry'
import { DEFAULTS } from '../constants'
import type { AccountMetaData, CheckinInfo, CheckinResult, AppConfig } from '../types'
import type { AccountManager } from '../providers/account-manager'
import * as storage from '../providers/storage'

/** 统一成功判定：成功 / 签到成功 / 您已签到（重复提交但已签过，视同成功） */
function isSuccessMessage(result: string): boolean {
  return result.includes('success') || result.includes('签到成功') || result.includes('您已签到')
}

/**
 * 签到处理器：协调多账号签到、延迟、重试、历史记录
 */
export class CheckinHandler {
  private config: AppConfig
  private accountManager: AccountManager
  private history: CheckinResult[] = []
  /** 签到后二次核对开关（默认开启） */
  private verifyEnabled: boolean

  constructor(config: AppConfig, accountManager: AccountManager) {
    this.config = config
    this.accountManager = accountManager
    this.history = storage.get<CheckinResult[]>('checkinHistory') || []
    this.verifyEnabled = config.checkin.verify?.enabled !== false
    // 根据配置启用 UA 轮换（防检测增强）
    CheckinEngine.useragentRotation = config.checkin.antiDetect.enabled && config.checkin.antiDetect.useragentRotation
  }

  /**
   * 二次核对：提交成功后再次查询平台，确认账号已真正签到。
   * 核对失败会补交一次；补交仍无法确认时如实标注（不冒充成功，也不把提交结果谎报为失败）。
   */
  private async verifyAfterCheckin(
    meta: AccountMetaData,
    aid: string,
    courseId: number,
    classId: number,
    info: CheckinInfo,
    enc: string,
    result: string,
  ): Promise<string> {
    if (!this.verifyEnabled) return result
    try {
      const v = await CheckinEngine.verifyCheckin(meta.cookie, aid)
      if (!v.checked) return result + ' [已提交，核对暂不可用]'
      if (v.signed) return result + ' [已核对✓]'
      // 提交返回成功但平台显示未签到：补交一次再核对
      logger.warn(`${meta.name}: 提交成功但核对未通过，自动补交一次`)
      await randomDelay(2, 5)
      const retried = info.type === 'qr'
        ? await CheckinEngine.qrCheckin(meta, aid, enc)
        : await this.executeCheckin(meta, aid, courseId, classId, info)
      if (isSuccessMessage(retried)) {
        const v2 = await CheckinEngine.verifyCheckin(meta.cookie, aid)
        if (v2.checked && v2.signed) return result + ' [补交后已核对✓]'
      }
      return result + ' [⚠ 提交成功但平台未确认已签到，请手动检查]'
    } catch (e: any) {
      logger.warn(`${meta.name} 二次核对异常: ${e.message}`)
      return result + ' [核对失败]'
    }
  }

  /**
   * 处理一次签到事件（所有账号）
   */
  async handle(
    aid: string,
    courseId: number,
    classId: number,
    courseName: string,
    checkinInfo: CheckinInfo,
  ): Promise<CheckinResult[]> {
    const startTime = Date.now()
    const results: CheckinResult[] = []

    // 随机延迟（防检测）
    if (this.config.checkin.antiDetect.enabled && this.config.checkin.antiDetect.randomDelay) {
      const { min, max } = this.config.checkin.delay
      logger.info(`随机延迟 ${min}~${max} 秒后签到...`)
      await randomDelay(min, max)
    }

    // 遍历所有账号
    for (const account of this.accountManager.getAccounts()) {
      const meta = this.accountManager.getMeta(account.username)

      try {
        const result = await retry(
          () => this.executeCheckin(meta, aid, courseId, classId, checkinInfo),
          {
            maxAttempts: this.config.checkin.retry.maxAttempts,
            delayMs: this.config.checkin.retry.delayMs,
            label: `签到 ${meta.name}`,
          },
        )

        const verifiedMsg = await this.verifyAfterCheckin(meta, aid, courseId, classId, checkinInfo, '', result)

        const cr: CheckinResult = {
          account: account.username,
          accountName: meta.name,
          success: isSuccessMessage(result),
          message: verifiedMsg,
          type: checkinInfo.type,
          courseName,
          aid,
          duration: Date.now() - startTime,
          timestamp: Date.now(),
        }

        results.push(cr)
        this.history.push(cr)
        if (this.history.length > DEFAULTS.MAX_HISTORY) {
          this.history = this.history.slice(-DEFAULTS.MAX_HISTORY)
        }
        storage.set('checkinHistory', this.history)
        logger.info(`${meta.name}: ${cr.success ? '成功' : cr.message}`)
      } catch (e: any) {
        const cr: CheckinResult = {
          account: account.username,
          accountName: meta.name,
          success: false,
          message: `异常: ${e.message}`,
          type: checkinInfo.type,
          courseName,
          aid,
          timestamp: Date.now(),
        }
        results.push(cr)
        logger.error(`${meta.name} 签到失败: ${e.message}`)
      }
    }

    if (results.length) {
      this.history.push(...results)
      if (this.history.length > DEFAULTS.MAX_HISTORY) this.history = this.history.slice(-DEFAULTS.MAX_HISTORY)
      storage.set('checkinHistory', this.history)
    }

    return results
  }

  private async executeCheckin(
    account: AccountMetaData,
    aid: string,
    courseId: number,
    classId: number,
    info: CheckinInfo,
  ): Promise<string> {
    switch (info.type) {
      case 'location':
        return CheckinEngine.geoCheckin(
          account, aid, courseId, classId,
          info.location,
          this.config.geo.locations,
          this.config.geo.providers,
          this.config.geo.locationRadius,
          { gpsDrift: this.config.checkin.antiDetect.enabled && this.config.checkin.antiDetect.gpsDrift },
        )

      case 'qr':
        throw new Error('二维码签到需要提供 enc 参数，请拖拽/上传二维码图片提交')

      case 'normal':
      default:
        return CheckinEngine.simpleCheckin(account, aid, { courseId, classId })
    }
  }

  /**
   * 处理二维码签到
   */
  async handleQr(aid: string, enc: string): Promise<CheckinResult[]> {
    const results: CheckinResult[] = []

    for (const account of this.accountManager.getAccounts()) {
      const meta = this.accountManager.getMeta(account.username)
      try {
        const result = await retry(
          () => CheckinEngine.qrCheckin(meta, aid, enc),
          {
            maxAttempts: this.config.checkin.retry.maxAttempts,
            delayMs: Math.min(this.config.checkin.retry.delayMs, 3000),
            label: `二维码签到 ${meta.name}`,
          },
        )
        const finalMsg = await this.verifyAfterCheckin(meta, aid, 0, 0, { type: 'qr' } as CheckinInfo, enc, result)
        results.push({
          account: account.username,
          accountName: meta.name,
          success: isSuccessMessage(result),
          message: finalMsg,
          type: 'qr',
          aid,
          timestamp: Date.now(),
        })
      } catch (e: any) {
        results.push({
          account: account.username,
          accountName: meta.name,
          success: false,
          message: e.message,
          type: 'qr',
          aid,
          timestamp: Date.now(),
        })
      }
    }

    return results
  }

  /**
   * 处理拍照签到（照片必须由用户配置/上传，软件不生成伪造照片）
   */
  async handlePhoto(
    aid: string,
    photoPath: string,
    info: { courseName: string; courseId: number; classId: number },
  ): Promise<CheckinResult[]> {
    const results: CheckinResult[] = []

    for (const account of this.accountManager.getAccounts()) {
      const meta = this.accountManager.getMeta(account.username)
      try {
        const result = await retry(
          () => CheckinEngine.photoCheckin(meta, aid, photoPath, { courseId: info.courseId, classId: info.classId }),
          {
            maxAttempts: this.config.checkin.retry.maxAttempts,
            delayMs: this.config.checkin.retry.delayMs,
            label: `拍照签到 ${meta.name}`,
          },
        )
        const finalMsg = await this.verifyAfterCheckin(meta, aid, info.courseId, info.classId, { type: 'photo' } as CheckinInfo, '', result)
        results.push({
          account: account.username,
          accountName: meta.name,
          success: isSuccessMessage(result),
          message: finalMsg,
          type: 'photo',
          courseName: info.courseName,
          aid,
          timestamp: Date.now(),
        })
      } catch (e: any) {
        results.push({
          account: account.username,
          accountName: meta.name,
          success: false,
          message: e.message,
          type: 'photo',
          courseName: info.courseName,
          aid,
          timestamp: Date.now(),
        })
      }
    }

    if (results.length) {
      this.history.push(...results)
      if (this.history.length > DEFAULTS.MAX_HISTORY) this.history = this.history.slice(-DEFAULTS.MAX_HISTORY)
      storage.set('checkinHistory', this.history)
    }
    return results
  }

  getHistory(): CheckinResult[] {
    return [...this.history].reverse()
  }

  /** 清空签到历史（软件内「清空记录」用） */
  clearHistory(): void {
    this.history = []
    storage.set('checkinHistory', this.history)
    logger.info('签到历史已清空')
  }
}
