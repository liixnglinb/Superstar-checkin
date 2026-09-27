import { login, checkCookie, getUserInfo } from '../core/login'
import * as storage from './storage'
import { logger } from '../utils/logger'
import { retry } from '../utils/retry'
import type { Account, AccountMetaData } from '../types'

export class AccountManager {
  private accounts: Account[]
  private refreshTimer: NodeJS.Timeout | null = null
  /** 刷新失败回调（看门狗/通知用） */
  onRefreshFail: ((username: string, err: Error) => void) | null = null

  constructor(accounts: Account[]) {
    this.accounts = accounts
  }

  /**
   * 检查并刷新所有账号的 Cookie
   */
  async checkAll(): Promise<void> {
    logger.info(`开始检查 ${this.accounts.length} 个账号的 Cookie...`)

    for (const account of this.accounts) {
      await this.refreshIfNeeded(account)
    }
  }

  /**
   * 刷新单个账号（如果 Cookie 失效）
   * @param force 为 true 时忽略已有 Cookie 的有效性，直接重新登录（强制刷新用）
   */
  private async refreshIfNeeded(account: Account, force = false): Promise<void> {
    const meta = this.getMeta(account.username)

    if (!force && meta?.cookie) {
      const state = await checkCookie(meta.cookie)
      if (state === 'valid') {
        logger.success(`${meta.name} 的 Cookie 仍然有效`)
        return
      }
      if (state === 'unknown') {
        logger.warn(`${meta.name} 的 Cookie 校验请求未成功（网络或风控），本轮不重新登录，保留现有 Cookie`)
        return
      }
      logger.warn(`${account.username} 的 Cookie 已失效`)
    }

    // 优先使用配置中的 Cookie（绕过云端登录风控）
    if (!force && account.cookie) {
      logger.info(`使用配置文件中的 Cookie (${account.username})`)
      storage.set(`cookie_${account.username}`, account.cookie)
      storage.set(`uid_${account.username}`, account.uid || 0)
      storage.set(`fid_${account.username}`, account.fid || 0)

      const state = await checkCookie(account.cookie)
      if (state === 'unknown') {
        // 配置里手填的 Cookie 本来就是用来绕开登录风控的：校验请求失败时保留它，别去动密码登录
        logger.warn(`配置 Cookie 校验请求未成功（网络或风控），暂按有效继续使用`)
        return
      }
      if (state === 'valid') {
        try {
          const userInfo = await getUserInfo(account.cookie)
          storage.set(`name_${account.username}`, userInfo.name)
          storage.set(`schoolname_${account.username}`, userInfo.schoolname)
          logger.success(`${userInfo.name} 的配置 Cookie 已生效`)
          return
        } catch (e: any) {
          logger.warn(`获取用户信息失败: ${e.message}，使用用户名代替`)
          storage.set(`name_${account.username}`, account.username)
          return
        }
      }
      logger.warn(`配置中的 Cookie 已失效，尝试重新登录...`)
    }

    // 重新登录
    const loginResult = await retry(
      () => login(account.username, account.password),
      { maxAttempts: 3, delayMs: 5000, label: `登录 ${account.username}` },
    )

    storage.set(`cookie_${account.username}`, loginResult.cookie)
    storage.set(`uid_${account.username}`, loginResult.uid)
    storage.set(`fid_${account.username}`, loginResult.fid)

    // 获取用户信息
    const userInfo = await getUserInfo(loginResult.cookie)
    storage.set(`name_${account.username}`, userInfo.name)
    storage.set(`schoolname_${account.username}`, userInfo.schoolname)

    logger.success(`${userInfo.name} 的凭据已刷新`)
  }

  /**
   * 获取账号元数据
   */
  getMeta(username: string): AccountMetaData {
    return {
      cookie: storage.get<string>(`cookie_${username}`) || '',
      uid: storage.get<number>(`uid_${username}`) || 0,
      fid: storage.get<number>(`fid_${username}`) || 0,
      name: storage.get<string>(`name_${username}`) || username,
      schoolname: storage.get<string>(`schoolname_${username}`) || '',
    }
  }

  /**
   * 获取所有账号
   */
  getAccounts(): Account[] {
    return [...this.accounts]
  }

  /**
   * 启动 Cookie 定时自动刷新
   *
   * 旧实现只在启动时校验一次 Cookie；运行中途 Cookie 过期会导致静默签到失败。
   * 这里周期性校验并刷新每个账号的 Cookie（默认 6 小时一次）。
   * 首次调度会延迟一个随机时间，避免多个进程同时打登录接口。
   *
   * @param intervalMs 刷新间隔，默认 6 小时
   */
  startAutoRefresh(intervalMs: number = 6 * 60 * 60 * 1000) {
    if (this.refreshTimer) return
    const initialDelay = Math.floor(Math.random() * 60000) // 0~60s 错峰
    this.refreshTimer = setInterval(() => {
      this.refreshAll().catch(e => logger.error('Cookie 定时刷新出错', e))
    }, intervalMs)
    // 不阻塞启动：用一次性定时器错峰触发首次刷新
    setTimeout(() => {
      this.refreshAll().catch(e => logger.error('Cookie 定时刷新出错', e))
    }, initialDelay)
    logger.info(`已启动 Cookie 自动刷新（间隔 ${Math.round(intervalMs / 60000)} 分钟）`)
  }

  /** 立即校验并刷新所有账号（由定时任务或外部调用） */
  async refreshAll(): Promise<void> {
    for (const account of this.accounts) {
      try {
        await this.refreshIfNeeded(account)
      } catch (e: any) {
        logger.error(`账号 ${account.username} 刷新失败: ${e.message}`)
        this.onRefreshFail?.(account.username, e)
      }
    }
  }
}
