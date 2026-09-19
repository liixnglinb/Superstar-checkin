/**
 * 钉钉 Stream 模式接收（二维码签到图片通道）
 *
 * 为什么用 Stream 而不是 HTTP 回调：
 * HTTP 回调要求钉钉能访问到本机，也就是需要公网 HTTPS 地址 / 域名 / 端口映射 / 内网穿透。
 * Stream 模式是**软件主动向外建 WebSocket 长连接**（wss-open-connection.dingtalk.com:443），
 * 不需要任何入站端口 —— 家里的电脑也能直接收群消息。
 *
 * 用途：在钉钉群里发二维码图片 → 软件自动下载并识别 → 自动签到。
 * 这是「人不在现场、同学把码发到群里」这个场景下最省事的一条链路：
 * 你不需要做任何中转操作。
 *
 * 前置条件（必须在钉钉开放平台做，且是「企业内部应用」而非群机器人 webhook）：
 *   1. 开发者后台 → 创建企业内部应用 → 记下 ClientID(AppKey) 与 ClientSecret(AppSecret)
 *   2. 该应用 → 应用能力 → 添加「机器人」→ 接收模式选 **Stream** → 发布
 *   3. 把机器人拉进群；群内发图即可
 *
 * 实现要点：
 * - SDK 是 ESM-only，这里用**动态 import**（编译成 CJS 后不能静态 import ESM），
 *   并带容错：SDK 缺失/加载失败只禁用本通道，不影响轮询与上传页。
 * - 收到消息必须应答（SDK 的返回值即应答），否则钉钉会在 60 秒后重推同一条消息。
 * - robotCode 用消息里自带的，不要拿 appKey 顶替（两者不总是相等）。
 */

import { logger } from '../utils/logger'

/** 机器人消息里可能带图片的形态 */
interface RobotImageInfo {
  pictureDownloadCode: string
  /** 图片所属会话（日志用） */
  from: string
}

export type ImageHandler = (buffer: Buffer, info: { downloadCode: string; from: string }) => Promise<void>

export interface DingTalkStreamOptions {
  clientId: string
  clientSecret: string
  debug?: boolean
  /** 把 downloadCode 换成图片 Buffer（复用 dingtalk-server 里已有的下载实现） */
  downloadImage: (downloadCode: string, robotCode?: string) => Promise<Buffer | null>
  onImage: ImageHandler
}

/** 从机器人消息 JSON 中提取所有图片的 downloadCode，兼容三种形态 */
export function extractImageCodes(msg: any): RobotImageInfo[] {
  const out: RobotImageInfo[] = []
  if (!msg || typeof msg !== 'object') return out
  const from = String(msg.senderNick || msg.senderStaffId || '未知来源')

  const push = (item: any) => {
    const code = item?.pictureDownloadCode || item?.downloadCode
    if (code && typeof code === 'string') out.push({ pictureDownloadCode: code, from })
  }

  // 形态①：官方 FAQ 里的富文本结构 { richText: [ { pictureDownloadCode }, ... ] }
  if (Array.isArray(msg.richText)) msg.richText.forEach(push)

  // 形态②：Stream 模式常见结构 { content: { richText: [...] } }
  if (Array.isArray(msg.content?.richText)) msg.content.richText.forEach(push)

  // 形态③：单张图片消息 { msgtype: 'picture', content: { downloadCode } }
  if (msg.msgtype === 'picture' || msg.content?.downloadCode) push(msg.content)

  return out
}

export class DingTalkStreamListener {
  private opts: DingTalkStreamOptions
  private client: any = null
  private connected = false
  private lastMessageAt = 0
  private syncTimer: NodeJS.Timeout | null = null

  constructor(opts: DingTalkStreamOptions) {
    this.opts = opts
  }

  isConnected(): boolean {
    // 以 SDK 的真实状态为准（见下方 start() 注释：该 SDK 不发 connect 事件，
    // 只能读它的 connected 字段）
    if (this.client && typeof this.client.connected === 'boolean') {
      return !!this.client.connected
    }
    return this.connected
  }

  getLastMessageAt(): number {
    return this.lastMessageAt
  }

  async start(): Promise<void> {
    let DWClient: any
    try {
      // 动态 import：SDK 为 ESM-only，静态 import 在 CJS 产物里会失败
      const mod: any = await import('dingtalk-stream')
      DWClient = mod.DWClient
    } catch (e: any) {
      logger.error(`钉钉 Stream SDK 加载失败，图片通道不可用（上传页/文件夹仍可用）: ${e.message}`)
      return
    }
    if (!DWClient) {
      logger.error('钉钉 Stream SDK 未导出 DWClient，图片通道不可用')
      return
    }

    this.client = new DWClient({
      clientId: this.opts.clientId,
      clientSecret: this.opts.clientSecret,
      debug: !!this.opts.debug,
    })

    this.client.registerAllEventListener((msg: any) => {
      // 必须在 60 秒内应答，否则钉钉会重推同一条消息（表现为"同一张图签到两次"）
      this.handleMessage(msg).catch(e => logger.error(`钉钉消息处理失败: ${e.message}`))
      return { status: 'SUCCESS' }
    })

    /**
     * ⚠️ 这个 SDK **不会** emit 'connect'/'disconnect'/'error' 事件（实测）：
     * 它内部维护 connected 字段 + onSystem 处理 CONNECTED/DISCONNECTED，
     * 只 emit 消息主题（headers.topic）。所以这里不能靠事件判断连接状态，
     * 改为「connect() 成功即视为已连接 + 定期同步 SDK 的真实状态」。
     */
    try {
      await this.client.connect()
      this.connected = true
      logger.success('钉钉图片通道已连接（Stream 模式）—— 在群里发二维码图片即可自动签到')
      this.startStateSync()
    } catch (e: any) {
      this.connected = false
      logger.error(`钉钉图片通道连接失败: ${e.message}`)
      logger.warn('请检查 AppKey/AppSecret 是否正确、机器人是否已选择 Stream 模式并发布、以及机器人是否已加入群')
    }
  }

  /**
   * 定期把 SDK 的真实连接状态同步过来（用于控制台显示、断线后可感知）。
   * SDK 自带自动重连，这里只做状态同步，不主动重连。
   */
  private startStateSync(): void {
    if (this.syncTimer) return
    let lastLogged = true
    this.syncTimer = setInterval(() => {
      const now = !!this.client?.connected
      this.connected = now
      if (now !== lastLogged) {
        lastLogged = now
        if (now) logger.success('钉钉图片通道已重新连接')
        else logger.warn('钉钉图片通道连接断开，SDK 将自动重连')
      }
    }, 10000)
  }

  /** 处理一条机器人消息：提取图片 → 下载 → 交给签到流程 */
  private async handleMessage(down: any): Promise<void> {
    let msg: any = down?.data
    if (typeof msg === 'string') {
      try { msg = JSON.parse(msg) } catch { return }
    }
    if (!msg) return

    const topic = down?.headers?.topic || ''
    // 只处理机器人消息回调；其它 topic（卡片/AI 插件）忽略
    if (topic && !String(topic).includes('bot/messages')) return
    // 记录收到消息的时间（无论是否含图片），控制台用它显示"通道确实在工作"
    this.lastMessageAt = Date.now()

    const images = extractImageCodes(msg)
    if (!images.length) {
      if (msg.msgtype === 'text' && msg.text?.content) {
        logger.info(`钉钉群消息（文字，忽略）: ${String(msg.text.content).slice(0, 60)}`)
      }
      return
    }

    const robotCode = msg.robotCode || undefined
    // SDK 常量里明确带 robotCode，优先用它而不是 appKey（两者不总是相等）
    const codes = images.map(i => i.pictureDownloadCode)
    logger.info(`钉钉群收到图片 ${codes.length} 张（来自 ${images[0].from}），开始下载识别...`)

    // 一次消息里可能有多张图（比如同学连发几张），逐张处理
    for (let i = 0; i < codes.length; i++) {
      try {
        const buf = await this.opts.downloadImage(codes[i], robotCode)
        if (!buf) {
          logger.warn(`第 ${i + 1} 张图片下载失败，跳过`)
          continue
        }
        await this.opts.onImage(buf, { downloadCode: codes[i], from: images[i].from })
      } catch (e: any) {
        logger.error(`第 ${i + 1} 张图片处理失败: ${e.message}`)
      }
    }
  }

  stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer)
      this.syncTimer = null
    }
    try {
      this.client?.disconnect()
    } catch { /* 忽略 */ }
    this.connected = false
  }
}
