import axios from 'axios'
import { logger } from '../utils/logger'
import type { NotifyChannel } from '../types'

export interface Notifier {
  send(title: string, content: string): Promise<void>
}

/**
 * 通知管理器：向所有已启用的通道发送通知
 */
export class NotificationManager {
  private notifiers: Map<string, Notifier> = new Map()
  private desktopEnabled: boolean
  private quiet: { enabled: boolean; start: string; end: string }

  constructor(channels: NotifyChannel[], opts: { desktop?: boolean; quiet?: { enabled: boolean; start: string; end: string } } = {}) {
    this.desktopEnabled = opts.desktop !== false
    this.quiet = opts.quiet || { enabled: false, start: '23:00', end: '07:00' }
    for (const ch of channels) {
      if (!ch.enabled) continue

      switch (ch.type) {
        case 'pushplus':
          this.notifiers.set('pushplus', new PushPlusNotifier(ch.config.token))
          break
        case 'bark':
          this.notifiers.set('bark', new BarkNotifier(ch.config.url, ch.config.key))
          break
        case 'dingtalk':
          this.notifiers.set('dingtalk', new DingTalkNotifier(ch.config.webhook, ch.config.secret))
          break
        case 'email':
          this.notifiers.set('email', new EmailNotifier(ch.config))
          break
        case 'telegram':
          this.notifiers.set('telegram', new TelegramNotifier(ch.config.botToken, ch.config.chatId))
          break
        case 'feishu':
          this.notifiers.set('feishu', new FeishuNotifier(ch.config.webhook))
          break
        case 'wecom':
          this.notifiers.set('wecom', new WeComNotifier(ch.config.webhook))
          break
        case 'serverchan':
          this.notifiers.set('serverchan', new ServerChanNotifier(ch.config.sendKey))
          break
      }
    }

    if (this.desktopEnabled) {
      this.notifiers.set('desktop', new DesktopNotifier())
      logger.info('桌面通知已启用（免打扰: ' + (this.quiet.enabled ? `${this.quiet.start}~${this.quiet.end}` : '关闭') + '）')
    }

    logger.info(`已启用 ${this.notifiers.size} 个通知通道`)
  }

  /** 当前是否处于免打扰时段 */
  inQuietHours(now = new Date()): boolean {
    if (!this.quiet.enabled) return false
    const cur = now.getHours() * 60 + now.getMinutes()
    const [sh, sm] = (this.quiet.start || '23:00').split(':').map(Number)
    const [eh, em] = (this.quiet.end || '07:00').split(':').map(Number)
    const start = sh * 60 + (sm || 0)
    const end = eh * 60 + (em || 0)
    if (start === end) return false
    return start < end ? (cur >= start && cur < end) : (cur >= start || cur < end)
  }

  async notify(title: string, content: string): Promise<void> {
    // 免打扰时段内不弹桌面通知（pushplus/bark/钉钉/邮件等外部通道不受影响）
    const quietNow = this.inQuietHours()
    const results = await Promise.allSettled(
      Array.from(this.notifiers.entries()).map(async ([name, notifier]) => {
        if (name === 'desktop' && quietNow) {
          logger.debug(`免打扰时段，跳过桌面通知: ${title}`)
          return
        }
        try {
          await notifier.send(title, content)
          logger.debug(`${name} 通知已发送: ${title}`)
        } catch (e: any) {
          logger.error(`${name} 通知发送失败: ${e.message}`)
          throw e
        }
      }),
    )

    const failed = results.filter(r => r.status === 'rejected')
    if (failed.length === this.notifiers.size && this.notifiers.size > 0) {
      logger.error(`全部 ${this.notifiers.size} 个通知通道均发送失败，用户可能无法收到: ${title}`)
    }
  }
}

// ============ 具体通知实现 ============

class PushPlusNotifier implements Notifier {
  constructor(private token: string) {}

  async send(title: string, content: string): Promise<void> {
    await axios.post('https://www.pushplus.plus/send', {
      token: this.token,
      title,
      content,
      template: 'txt',
    })
  }
}

class BarkNotifier implements Notifier {
  constructor(private url: string, private key: string) {}

  async send(title: string, content: string): Promise<void> {
    const base = this.url || 'https://api.day.app'
    await axios.post(`${base}/${this.key}`, {
      title,
      body: content,
      group: '学习通签到',
    })
  }
}

class DingTalkNotifier implements Notifier {
  constructor(private webhook: string, private secret?: string) {}

  async send(title: string, content: string): Promise<void> {
    let url = this.webhook

    if (this.secret) {
      const crypto = await import('crypto')
      const timestamp = Date.now()
      const sign = crypto
        .createHmac('sha256', this.secret)
        .update(`${timestamp}\n${this.secret}`)
        .digest('base64')
      url += `&timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`
    }

    await axios.post(url, {
      msgtype: 'markdown',
      markdown: { title, text: `### ${title}\n\n${content}` },
    })
  }
}

class TelegramNotifier implements Notifier {
  constructor(private botToken: string, private chatId: string) {}

  async send(title: string, content: string): Promise<void> {
    await axios.post(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      chat_id: this.chatId,
      text: `*${title}*\n${content}`,
      parse_mode: 'Markdown',
    })
  }
}

class FeishuNotifier implements Notifier {
  constructor(private webhook: string) {}

  async send(title: string, content: string): Promise<void> {
    await axios.post(this.webhook, {
      msg_type: 'text',
      content: { text: `${title}\n${content}` },
    })
  }
}

class WeComNotifier implements Notifier {
  constructor(private webhook: string) {}

  async send(title: string, content: string): Promise<void> {
    await axios.post(this.webhook, {
      msgtype: 'markdown',
      markdown: { content: `### ${title}\n${content}` },
    })
  }
}

class ServerChanNotifier implements Notifier {
  constructor(private sendKey: string) {}

  async send(title: string, content: string): Promise<void> {
    await axios.post(`https://sctapi.ftqq.com/${this.sendKey}.send`, {
      title,
      desp: content,
    })
  }
}

// ============ 桌面通知（Electron 内置） ============

class DesktopNotifier implements Notifier {
  async send(title: string, content: string): Promise<void> {
    // 仅 Electron 主进程环境可用；纯 Node 运行（如 SEA 单文件版）自动跳过
    try {
      if (!process.versions.electron) return
      const electron = require('electron') as any
      const Notification = electron.Notification
      if (!Notification || !Notification.isSupported()) return
      const n = new Notification({ title, body: content, silent: false })
      n.show()
    } catch (e: any) {
      logger.debug(`桌面通知不可用: ${e.message}`)
    }
  }
}

class EmailNotifier implements Notifier {
  constructor(private config: Record<string, any>) {}

  async send(title: string, content: string): Promise<void> {
    // 使用 nodemailer（需额外安装）
    try {
      const NODEMAILER = 'nodemailer'
      const nodemailer = require(NODEMAILER)
      const transporter = nodemailer.createTransport({
        host: this.config.smtpHost,
        port: this.config.smtpPort || 465,
        secure: true,
        auth: { user: this.config.from, pass: this.config.password },
      })
      await transporter.sendMail({
        from: this.config.from,
        to: this.config.to,
        subject: title,
        text: content,
      })
    } catch {
      logger.warn('邮件通知需要安装 nodemailer: npm install nodemailer')
    }
  }
}
