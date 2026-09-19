import jsdom from 'jsdom'
import axios from 'axios'
import cheerio from 'cheerio'
import { logger } from '../utils/logger'
import { EASEMOB } from '../constants'
import type { ImMessage } from '../types'
import { getProxyConfig } from '../providers/runtime-config'

const { JSDOM } = jsdom
const { window } = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://im.chaoxing.com/webim/me',
})

Object.defineProperty(global, 'window', { value: window, writable: true, configurable: true })
Object.defineProperty(global, 'navigator', { value: window.navigator, writable: true, configurable: true })
Object.defineProperty(global, 'location', { value: window.location, writable: true, configurable: true })
Object.defineProperty(global, 'document', { value: window.document, writable: true, configurable: true })
Object.defineProperty(global, 'WebSocket', { value: window.WebSocket, writable: true, configurable: true })

// 学习通环信 SDK：文件较大且为外部资源，用 require 动态加载并容错。
// 缺失时 IM 监听不可用，但进程仍可启动（轮询/上传页不受影响）。
let webimAvailable = true
try {
  require('../sdk/Easemob-chat-3.6.3')
} catch (e: any) {
  webimAvailable = false
  // 模块加载阶段不能引用 logger（顺序未定），延迟到构造时再打日志
}

type MessageHandler = (message: ImMessage, cookie: string) => void

/** 平台侧确认未开放（系统维护中）时的探测间隔：6 小时。
 *  IM 是「锦上添花」的实时通道，签到检测由轮询承担，因此低频探测即可，
 *  既不放弃「服务恢复后自动接回」，也不对死接口高频空转。 */
const PLATFORM_DOWN_RETRY_MS = 6 * 60 * 60 * 1000

/**
 * 环信 IM 监听器
 *
 * 优化点（相对旧版）：
 * - 跟踪连接状态（isConnected），供看门狗判断是否需要告警；
 * - 记录最近一次成功连接时间，看门狗据此判断「长时间无活动」；
 * - token 定时刷新：IM token 会过期，过期后静默重连会失败，这里周期性重新获取并重连；
 * - 断线自动重连（带退避），避免 onError 里只重连一次就放弃。
 */
export class ImListener {
  private cookie = ''
  private uid = 0
  private handler: MessageHandler | null = null
  private connected = false
  private lastConnectedAt = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private refreshTimer: NodeJS.Timeout | null = null
  private reconnectAttempt = 0
  private reconnectFailCount = 0
  /** 平台侧是否明确未开放（如 /webim/me 返回「系统维护中」）。
   *  为 true 时所有重连路径（含环信握手失败触发的 onError）都走低频探测，不再高频重试。 */
  private platformDown = false
  private tokenRefreshMs: number
  /** 连接状态回调（看门狗用） */
  onStatusChange: ((connected: boolean) => void) | null = null

  constructor(tokenRefreshMs = 20 * 60 * 1000) {
    this.tokenRefreshMs = tokenRefreshMs
    if (!webimAvailable) {
      logger.error('Easemob SDK 缺失（src/sdk/Easemob-chat-3.6.3），IM 监听不可用，请改用 poll/hybrid 模式')
      return
    }
    this.setupWebIM()
  }

  onMessage(handler: MessageHandler) {
    this.handler = handler
  }

  isConnected(): boolean {
    return this.connected
  }

  getLastConnectedAt(): number {
    return this.lastConnectedAt
  }

  private setupWebIM() {
    const W: any = window as any

    W.WebIM.config = {
      xmppURL: EASEMOB.XMPP_URL,
      apiURL: EASEMOB.API_URL,
      appkey: EASEMOB.APP_KEY,
      Host: 'easemob.com',
      https: true,
      isHttpDNS: false,
      isMultiLoginSessions: true,
      isAutoLogin: true,
      isWindowSDK: false,
      isSandBox: false,
      isDebug: false,
      autoReconnectNumMax: Number.POSITIVE_INFINITY,
      autoReconnectInterval: 2,
      isWebRTC: true,
      heartBeatWait: 2000,
      delivery: false,
    }

    W.WebIM.conn = new W.WebIM.connection({
      appKey: W.WebIM.config.appkey,
      isHttpDNS: W.WebIM.config.isHttpDNS,
      isMultiLoginSessions: W.WebIM.config.isMultiLoginSessions,
      host: W.WebIM.config.Host,
      https: W.WebIM.config.https,
      url: W.WebIM.config.xmppURL,
      apiUrl: W.WebIM.config.apiUrl,
      isAutoLogin: false,
      heartBeatWait: W.WebIM.config.heartBeatWait,
      autoReconnectNumMax: W.WebIM.config.autoReconnectNumMax,
      autoReconnectInterval: W.WebIM.config.autoReconnectInterval,
      delivery: W.WebIM.config.delivery,
      isDebug: W.WebIM.config.isDebug,
    })

    W.WebIM.conn.listen({
      onOpened: () => {
        this.connected = true
        this.lastConnectedAt = Date.now()
        this.reconnectAttempt = 0
        this.reconnectFailCount = 0
        logger.success('IM 协议连接成功')
        this.onStatusChange?.(true)
      },
      onClosed: () => {
        this.connected = false
        logger.warn('IM 协议连接关闭，准备重连')
        this.onStatusChange?.(false)
        this.scheduleReconnect()
      },
      onTextMessage: (message: ImMessage) => {
        logger.debug('IM 收到消息', JSON.stringify(message).substring(0, 200))
        this.handler?.(message, this.cookie)
      },
      onEmojiMessage: () => {},
      onPictureMessage: () => {},
      onCmdMessage: () => {},
      onAudioMessage: () => {},
      onLocationMessage: () => {},
      onFileMessage: () => {},
      onVideoMessage: () => {},
      onPresence: () => {},
      onRoster: () => {},
      onInviteMessage: () => {},
      onOnline: () => {},
      onOffline: () => logger.warn('IM 下线'),
      onError: async (message: any) => {
        logger.warn('IM 协议错误', message)
        // 任何错误都先标记断开，保证看门狗状态一致
        this.connected = false
        this.onStatusChange?.(false)
        if (message.type === 40) {
          // 身份验证失败：重新获取 token 并重连
          W.WebIM.conn.close()
          logger.warn('IM 身份验证失败，重新获取 token 并重连...')
          this.scheduleReconnect(2000)
        }
      },
      onBlacklistUpdate: () => {},
    })
  }

  async connect(cookie: string, uid: number): Promise<void> {
    this.cookie = cookie
    this.uid = uid
    try {
      await this.openWithFreshToken()
      this.startTokenRefresh()
    } catch (e: any) {
      this.reconnectFailCount++
      if (e?.retryAfterMs) {
        // 平台侧未开放（系统维护中）：不是本机/账号问题，降为低频重试并且不当成错误刷屏
        logger.warn(`IM 通道当前不可用（学习通服务端未开放）：${e.message}；已降为每 ${Math.round(e.retryAfterMs / 3600000)} 小时探测一次，签到检测由轮询承担`)
      } else {
        // 首次连接失败（Cookie 失效 / 网络抖动等）：记录日志并调度重连，不向调用方抛错
        logger.error(`IM 连接失败（hybrid/poll 模式由轮询兜底）: ${e.message}`)
      }
      this.scheduleReconnect(e?.retryAfterMs)
    }
  }

  /** 重新拉取 IM token 并打开连接 */
  private async openWithFreshToken(): Promise<void> {
    const token = await this.fetchToken()
    const W: any = window as any
    W.WebIM.conn.open({
      apiUrl: EASEMOB.API_URL,
      user: this.uid,
      accessToken: token,
      appKey: EASEMOB.APP_KEY,
    })
  }

  /** 断线后按退避间隔重连，避免雪崩。
   *  连续失败超过阈值（如 token 接口被服务端下线）时降为低频重试（30 分钟一次），
   *  避免对已失效接口高频发送无效请求刷屏日志。
   *  @param platformDownMs 平台侧明确不可用时的固定重试间隔（如「系统维护中」→ 6 小时） */
  private scheduleReconnect(delayMs = 5000, platformDownMs?: number) {
    if (this.reconnectTimer) return
    this.reconnectFailCount++

    // 平台侧已确认未开放：无论从哪条路径进来（含环信握手失败触发的 onError）都统一低频探测，
    // 否则 onError 会用 2s 的默认参数绕过这里的判断，把死接口重新拉回高频重试。
    if (!platformDownMs && this.platformDown) platformDownMs = PLATFORM_DOWN_RETRY_MS

    if (platformDownMs && platformDownMs > 0) {
      // 平台侧未开放：不做指数退避，固定低频探测即可（避免日志与无效请求刷屏）
      this.reconnectAttempt++
      this.reconnectTimer = setTimeout(async () => {
        this.reconnectTimer = null
        try {
          await this.openWithFreshToken()
          this.reconnectAttempt = 0
          this.reconnectFailCount = 0
          this.platformDown = false
          logger.info('IM 通道已恢复，重新开始实时监听')
          this.startTokenRefresh()
        } catch (e: any) {
          this.scheduleReconnect(delayMs, e?.retryAfterMs || platformDownMs)
        }
      }, platformDownMs)
      return
    }

    if (this.reconnectFailCount > 5) {
      delayMs = 30 * 60 * 1000
    }
    const backoff = Math.min(delayMs * Math.pow(2, this.reconnectAttempt), 60000)
    this.reconnectAttempt++
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      try {
        logger.info(`IM 重连中（第 ${this.reconnectAttempt} 次）...`)
        await this.openWithFreshToken()
        this.platformDown = false
        this.startTokenRefresh()
      } catch (e: any) {
        logger.error(`IM 重连失败: ${e.message}`)
        this.scheduleReconnect(5000, e?.retryAfterMs)
      }
    }, backoff)
  }

  /** 周期性刷新 token（保持会话不过期）。
   *  仅刷新 token 缓存，不重复调用 conn.open（重复 open 会触发环信异常）。
   *  连接断开时交给重连逻辑处理，这里只维护缓存。 */
  private startTokenRefresh() {
    if (this.refreshTimer) return
    this.refreshTimer = setInterval(async () => {
      if (!this.connected) return // 未连接时交给重连逻辑处理
      try {
        await this.fetchToken()
        logger.debug('IM token 已刷新')
      } catch (e: any) {
        logger.warn(`IM token 刷新失败: ${e.message}`)
      }
    }, this.tokenRefreshMs)
  }

  /** 仅拉取 token，不触发 conn.open。
   *  注意：cheerio/axios 用顶部静态 import（esModuleInterop 正确处理 CJS 默认导出），
   *  此前动态 import 在 CommonJS 编译下取 .default 为 undefined，会导致 token 解析崩溃。 */
  private async fetchToken(): Promise<string> {
    const res = await axios.get('https://im.chaoxing.com/webim/me', {
      headers: {
        Cookie: this.cookie,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      responseType: 'text',
      proxy: getProxyConfig(),
    })

    /**
     * 平台侧未开放：学习通会返回 HTTP 200 + 一张「信息提示 / 系统维护中，功能暂时无法使用」页，
     * 而不是 4xx/5xx。这种情况下页面里当然没有 #myToken，若按普通失败处理会被当成网络抖动
     * 反复重连。此处显式识别，交由 scheduleReconnect 走低频探测。
     *
     * 实测（2026-09-19）：带有效 Cookie 请求 → 200 + 该维护页；不带 Cookie → 302 跳
     * passport2 登录页。即鉴权是通过的，是服务端关闭了 /webim/me 这条路由。
     */
    if (typeof res.data === 'string' && res.data.includes('系统维护中')) {
      this.platformDown = true
      const err: any = new Error('学习通返回「系统维护中，功能暂时无法使用」')
      err.retryAfterMs = PLATFORM_DOWN_RETRY_MS
      throw err
    }

    const $ = cheerio.load(res.data)
    const token = $('#myToken').text()
    if (!token) throw new Error('未能获取 IM token（IM 通道暂不可用，已由轮询监听兜底）')
    return token
  }

  dispose() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.refreshTimer) clearInterval(this.refreshTimer)
    this.reconnectTimer = null
    this.refreshTimer = null
  }
}
