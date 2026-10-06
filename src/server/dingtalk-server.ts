import * as http from 'http'
import * as crypto from 'crypto'
import * as fs from 'fs'
import YAML from 'yaml'
import axios from 'axios'
import { logger } from '../utils/logger'
import { getProxyConfig, getProxy, setProxy } from '../providers/runtime-config'
import { encryptPassword, isEncrypted } from '../utils/crypto'
import { getConsolePage, ConsoleStatus } from './console-ui'
import { writeFileAtomic } from '../utils/fs'
import { BadRequestError, boolFlag, intInRange, proxyUrl, requiredText, textField, timeOfDay } from '../utils/validate'

export interface DingTalkMessage {
  msgtype: string
  text?: { content: string }
  richText?: { richText: Array<{ pictureDownloadCode?: string; text?: string }> }
  pictureDownloadCode?: string
  senderStaffId?: string
  conversationId?: string
  chatbotCorpId?: string
  msgId?: string
}

type ImageHandler = (imageBuffer: Buffer) => Promise<string | void>

/** 控制台首页数据提供者（每次请求时实时获取） */
export type StatusProvider = () => Record<string, any>

/** 抹掉代理地址里的凭据（http://user:pass@host:port → http://***@host:port） */
function maskProxyUrl(p: string): string {
  if (!p) return ''
  try {
    const u = new URL(p)
    if (u.username || u.password) {
      u.username = u.username ? '***' : ''
      u.password = ''
    }
    return u.toString()
  } catch {
    return p.replace(/\/\/[^@/]+@/, '//***@')
  }
}

/** config.yaml 的唯一路径来源（进程内不变，CONFIG_FILE 启动时注入） */
const CONFIG_FILE_PATH = process.env.CONFIG_FILE || 'config.yaml'

/**
 * 读 config.yaml 为对象：此前 12 处路由各自 `fs.existsSync ? YAML.parse || {} : {}`，
 * 行为漂移风险集中到这里——文件不存在/空文件/解析为 null 一律得到空对象。
 */
function readConfigDoc(): Record<string, any> {
  if (!fs.existsSync(CONFIG_FILE_PATH)) return {}
  return YAML.parse(fs.readFileSync(CONFIG_FILE_PATH, 'utf-8')) || {}
}

export interface DingTalkServerOptions {
  /** 企业内部应用的 AppKey（用于获取 access_token 与图片下载） */
  appKey?: string
  /** 上传接口鉴权 token；不填则上传接口不鉴权（不推荐） */
  token?: string
  /** 允许跨域的来源（可选） */
  allowedOrigin?: string
  /** 控制台首页状态数据提供者（可选） */
  statusProvider?: StatusProvider
  /** 全量签到历史（导出 CSV 用） */
  historyProvider?: () => any[]
  /** 清空签到历史 */
  clearHistory?: () => string
  /** 发送测试通知 */
  sendTestNotify?: () => Promise<void>
  /** 重新拉取课程列表并重建轮询监听 */
  refreshCourses?: () => Promise<{ ok: boolean; count: number; message: string }>
  /**
   * 监听总开关（控制台「开启监听 / 停止监听」按钮）。
   * 这是原 IM 通道的替代物：IM 被学习通关掉后，用户需要一个随时能停、
   * 一眼能看懂的开关，而不是只能靠关掉整个软件来停止轮询。
   */
  setListening?: (on: boolean) => { ok: boolean; listening: boolean; listeningCount: number }
  /** 切换单门课程的监听开关，返回切换后的状态 */
  toggleCourse?: (courseId: string, on: boolean) => { ok: boolean; listening: boolean; listeningCount: number; message?: string }
  /** 恢复所有课程的监听（清除手动关闭） */
  resetCourses?: () => { ok: boolean; listeningCount: number }
  /**
   * 批量设置监听课程（控制台「保存监听设置」）。
   * 传入要监听的 courseId 列表；由宿主决定如何落到运行时状态，返回生效后的门数。
   */
  applyWatchCourses?: (ids: string[]) => { ok: boolean; listeningCount: number }
  /** 读取课表（含节次定义、可填课程、完整度状态） */
  getTimetablePayload?: () => any
  /** 依据签到观测时间生成课表填充建议（用于「自动填充」按钮） */
  suggestTimetable?: () => any
  /** 保存课表；未填满时返回 ok=false 与提示（不落盘） */
  saveTimetable?: (table: any) => { ok: boolean; message: string; status?: any }
  /** 免责声明：读取接受状态（含当前声明版本） */
  getConsent?: () => { accepted: boolean; acceptedAt?: string; version?: number; currentVersion: number }
  /** 免责声明：记录用户已接受（带时间与服务端持久化，便于事后举证） */
  acceptDisclaimer?: () => { accepted: boolean; acceptedAt: string; version: number }
  /** 「签到前确认」倒计时里用户点了取消链接：把 aid 交回给主流程的取消集合 */
  cancelCheckin?: (aid: string) => void
  /**
   * 立即扫描一次全部课程（忽略课表时段与监听开关）。
   * 手机端在教室外拿到二维码、或想立刻确认有没有新签到时用 ——
   * 课表驱动扫描上线后，非上课时段不再自动扫描，必须有这个手动入口兜底。
   */
  scanNow?: () => Promise<{ ok: boolean; scanned: number; found: number; message: string }>
  /** 日志文件路径（软件内日志查看页用） */
  getLogFile?: () => string
  /** 主账号 Cookie（网络诊断用） */
  getPrimaryCookie?: () => string
}

/**
 * 钉钉机器人消息回调服务器
 * 接收群内消息（文字、图片），用于二维码签到流程
 *
 * 优化点：
 * - 真正实现了「钉钉群内发图 → 通过钉钉 API 下载图片 → OCR → 签到」链路；
 * - 为 /upload/image 增加了可选 token 鉴权，防止外人任意上传；
 * - 上传页面自动携带 token。
 */
/**
 * 需要完全退出软件才生效的提示。
 * 界面上的 location.reload() 只刷新页面，不会重启内置的签到服务，
 * 所以措辞必须把「刷新页面」和「退出重开」区分开，否则用户以为已经生效。
 */
const RESTART_HINT = '需完全退出软件后重新打开才生效（关闭窗口不会退出，请在系统托盘右键选择「退出」）'

export class DingTalkServer {
  private server: http.Server | null = null
  private imageHandler: ImageHandler | null = null
  private rateBuckets = new Map<string, { count: number; resetAt: number }>()
  private appSecret: string
  private appKey?: string
  private token?: string
  private allowedOrigin?: string
  private statusProvider?: StatusProvider
  private historyProvider?: () => any[]
  private clearHistory?: () => string
  private sendTestNotify?: () => Promise<void>
  private refreshCourses?: () => Promise<{ ok: boolean; count: number; message: string }>
  private setListening?: (on: boolean) => { ok: boolean; listening: boolean; listeningCount: number }
  private toggleCourse?: (courseId: string, on: boolean) => { ok: boolean; listening: boolean; listeningCount: number; message?: string }
  private resetCourses?: () => { ok: boolean; listeningCount: number }
  private applyWatchCourses?: (ids: string[]) => { ok: boolean; listeningCount: number }
  private getTimetablePayload?: () => any
  private suggestTimetable?: () => any
  private saveTimetable?: (table: any) => { ok: boolean; message: string; status?: any }
  private getConsent?: () => { accepted: boolean; acceptedAt?: string; version?: number; currentVersion: number }
  private acceptDisclaimer?: () => { accepted: boolean; acceptedAt: string; version: number }
  private cancelCheckin?: (aid: string) => void
  private scanNow?: () => Promise<{ ok: boolean; scanned: number; found: number; message: string }>
  private getLogFile?: () => string
  private getPrimaryCookie?: () => string

  constructor(
    private port: number,
    appSecret: string,
    options: DingTalkServerOptions = {},
  ) {
    this.appSecret = appSecret
    this.appKey = options.appKey
    this.token = options.token
    this.allowedOrigin = options.allowedOrigin
    this.statusProvider = options.statusProvider
    this.historyProvider = options.historyProvider
    this.clearHistory = options.clearHistory
    this.sendTestNotify = options.sendTestNotify
    this.refreshCourses = options.refreshCourses
    this.setListening = options.setListening
    this.toggleCourse = options.toggleCourse
    this.resetCourses = options.resetCourses
    this.applyWatchCourses = options.applyWatchCourses
    this.getTimetablePayload = options.getTimetablePayload
    this.suggestTimetable = options.suggestTimetable
    this.saveTimetable = options.saveTimetable
    this.getConsent = options.getConsent
    this.acceptDisclaimer = options.acceptDisclaimer
    this.cancelCheckin = options.cancelCheckin
    this.scanNow = options.scanNow
    this.getLogFile = options.getLogFile
    this.getPrimaryCookie = options.getPrimaryCookie
  }

  /**
   * 注册图片消息处理器（收到图片 → OCR → 签到）
   */
  onImage(handler: ImageHandler) {
    this.imageHandler = handler
  }

  private clientKey(req: http.IncomingMessage): string {
    return req.socket.remoteAddress || 'unknown'
  }

  private allowRequest(req: http.IncomingMessage, limit: number, windowMs: number): boolean {
    const key = `${this.clientKey(req)}:${req.url?.split('?')[0] || ''}`
    const now = Date.now()
    if (this.rateBuckets.size > 1000) {
      for (const [bucketKey, bucket] of this.rateBuckets) {
        if (bucket.resetAt <= now) this.rateBuckets.delete(bucketKey)
      }
    }
    const bucket = this.rateBuckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      this.rateBuckets.set(key, { count: 1, resetAt: now + windowMs })
      return true
    }
    bucket.count++
    return bucket.count <= limit
  }

  private extractToken(req: http.IncomingMessage): string {
    const header = String(req.headers['authorization'] || '').replace(/^Bearer\s+/i, '')
    if (header) return header
    const custom = String(req.headers['x-web-token'] || '')
    if (custom) return custom
    try {
      return new URL(req.url || '/', `http://localhost:${this.port}`).searchParams.get('token') || ''
    } catch {
      return ''
    }
  }

  private authorize(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    const path = (req.url || '').split('?')[0]
    const protectedPath =
      path.startsWith('/api/') ||
      path === '/' ||
      path === '/console' ||
      path === '/upload' ||
      path.startsWith('/upload/image') ||
      path.startsWith('/dingtalk/callback')
    if (!protectedPath) return true

    const provided = this.extractToken(req)
    const expected = this.token || ''
    const ok = !!expected && !!provided &&
      provided.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
    if (ok) return true

    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: false, error: '未授权，请在 URL 或 Authorization 头中提供控制台 token' }))
    return false
  }

  /**
   * 启动 HTTP 服务器
   */
  start() {
    this.server = http.createServer(async (req, res) => {
      this.applyCors(res)

      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Referrer-Policy', 'no-referrer')
      // 页面/接口全部同源自用：CSP 主要防 XSS 后外联或加载远程脚本（页面只有内联脚本与样式，
      // 因此 script/style 允许 unsafe-inline；渲染进程本身有 sandbox+contextIsolation 兜底）
      res.setHeader('X-Frame-Options', 'DENY')
      res.setHeader('Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")

      // CORS 预检请求：浏览器在跨域 POST 前会先发 OPTIONS，必须直接返回
      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      // 所有数据和状态修改接口必须带 token；控制台页面本身不包含业务数据。
      if (!this.authorize(req, res)) return

      const routePath = (req.url || '').split('?')[0]

      // 图标静态资源（软件界面 logo 用）
      if (req.method === 'GET' && (routePath === '/assets/app-icon.png' || routePath === '/icon.png' || routePath === '/favicon.ico')) {
        try {
          const iconPath = require('path').join(__dirname, '..', '..', 'assets', 'app-icon.png')
          if (fs.existsSync(iconPath)) {
            const data = fs.readFileSync(iconPath)
          res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' })
            res.end(data)
          } else {
            res.writeHead(404); res.end()
          }
        } catch (e) { res.writeHead(500); res.end() }
        return
      }

      // PWA 清单：手机浏览器据此提供「添加到主屏幕」，以独立 App 形态打开
      if (req.method === 'GET' && routePath === '/manifest.webmanifest') {
        res.writeHead(200, {
          'Content-Type': 'application/manifest+json; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        })
        res.end(JSON.stringify({
          name: '学习通自动签到',
          short_name: '学习通签到',
          description: '学习通（超星）自动签到助手 · 手机控制台',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#F6F5F1',
          theme_color: '#F27B34',
          lang: 'zh-CN',
          icons: [
            { src: '/assets/app-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/assets/app-icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/assets/app-icon.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        }))
        return
      }

      // 192×192 图标（PWA 安装所需的小尺寸）
      if (req.method === 'GET' && routePath === '/assets/app-icon-192.png') {
        try {
          const p192 = require('path').join(__dirname, '..', '..', 'assets', 'app-icon-192.png')
          const fallback = require('path').join(__dirname, '..', '..', 'assets', 'app-icon.png')
          const target = fs.existsSync(p192) ? p192 : fallback
          if (fs.existsSync(target)) {
            res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' })
            res.end(fs.readFileSync(target))
          } else {
            res.writeHead(404); res.end()
          }
        } catch (e) { res.writeHead(500); res.end() }
        return
      }

      // Service Worker：让控制台可安装、并在断网时回退到缓存壳
      // 注意：/api/* 一律直连不缓存——控制台数据必须实时，缓存会导致看到过期状态
      if (req.method === 'GET' && routePath === '/sw.js') {
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Service-Worker-Allowed': '/',
        })
        res.end([
          "const CACHE = 'checkin-console-v2'",
          "const PRECACHE = ['/', '/assets/app-icon.png', '/assets/app-icon-192.png', '/manifest.webmanifest']",
          "self.addEventListener('install', (e) => {",
          "  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).catch(() => {}).then(() => self.skipWaiting()))",
          "})",
          "self.addEventListener('activate', (e) => {",
          "  e.waitUntil(caches.keys()",
          "    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))",
          "    .then(() => self.clients.claim()))",
          "})",
          "self.addEventListener('fetch', (e) => {",
          "  const req = e.request",
          "  if (req.method !== 'GET') return",
          "  const url = new URL(req.url)",
          "  if (url.origin !== self.location.origin) return",
          "  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return",
          "  e.respondWith(fetch(req).catch(() => caches.match(req).then((r) => r || caches.match('/'))))",
          "})",
        ].join('\n'))
        return
      }

    // 健康检查
      if (req.method === 'GET' && routePath === '/health') {        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }))
        return
      }


      // 状态 API（控制台数据）
      if (req.method === 'GET' && routePath === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(this.getStatus()))
        return
      }

      // 账号保存/添加（首次运行引导；已存在同账号则更新密码，否则追加 → 支持多账号）
      if (req.method === 'POST' && routePath === '/api/config') {
        try {
          const body = await this.parseJsonBody(req)
          // 长度上限：超长的「账号/密码」会原样写进 config.yaml（实测 5000 字符可写入，
          // 配置文件膨胀到 8KB 且后续每次读写都带着它），控制字符/换行会破坏 YAML 结构。
          const username = requiredText(body.username, '账号', 64)
          // 密码不 trim 首尾空格（可能是真实密码的一部分），只去控制字符并限长
          const password = requiredText(body.password, '密码', 128, { trim: false })
          const existing = readConfigDoc()
          const accounts = Array.isArray(existing.accounts) ? existing.accounts : []
          const idx = accounts.findIndex((a: any) => String(a.username) === username)
          // 密码加密存储（DPAPI，绑定当前 Windows 用户；加密失败降级明文并告警）
          const encPwd = encryptPassword(password) || password
          let action = '新增'
          if (idx >= 0) {
            accounts[idx] = { ...accounts[idx], username, password: encPwd }
            action = '更新'
          } else {
            accounts.push({ username, password: encPwd })
          }
          existing.accounts = accounts
          writeFileAtomic(CONFIG_FILE_PATH, YAML.stringify(existing))
          logger.info(`账号已${action}到 ${CONFIG_FILE_PATH}（用户名: ${username}），当前共 ${accounts.length} 个账号，${RESTART_HINT}`)
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, message: `账号已${action}（当前 ${accounts.length} 个），${RESTART_HINT}` }))
        } catch (e: any) {
          this.fail(res, e, '保存账号失败: ')
        }
        return
      }

      // 删除账号
      if (req.method === 'POST' && routePath === '/api/accounts/remove') {
        try {
          const body = await this.parseJsonBody(req)
          const username = requiredText(body.username, '账号', 64)
          const existing = readConfigDoc()
          const before = Array.isArray(existing.accounts) ? existing.accounts.length : 0
          existing.accounts = (Array.isArray(existing.accounts) ? existing.accounts : [])
            .filter((a: any) => String(a.username) !== username)
          if (existing.accounts.length === before) {
            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, message: '未找到该账号' }))
            return
          }
          writeFileAtomic(CONFIG_FILE_PATH, YAML.stringify(existing))
          logger.info(`账号已删除: ${username}`)
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, message: '账号已删除，' + RESTART_HINT }))
        } catch (e: any) {
          this.fail(res, e, '删除账号失败: ')
        }
        return
      }

      // 设为主账号（移到数组首位 = 课程轮询监听使用该账号）
      if (req.method === 'POST' && routePath === '/api/accounts/primary') {
        try {
          const body = await this.parseJsonBody(req)
          const username = requiredText(body.username, '账号', 64)
          const existing = readConfigDoc()
          const accounts = Array.isArray(existing.accounts) ? existing.accounts : []
          const idx = accounts.findIndex((a: any) => String(a.username) === username)
          if (idx < 0) {
            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, message: '未找到该账号' }))
            return
          }
          const [acc] = accounts.splice(idx, 1)
          accounts.unshift(acc)
          existing.accounts = accounts
          writeFileAtomic(CONFIG_FILE_PATH, YAML.stringify(existing))
          logger.info(`主账号已切换为: ${username}`)
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, message: `已将 ${username} 设为主账号，${RESTART_HINT}` }))
        } catch (e: any) {
          this.fail(res, e, '切换主账号失败: ')
        }
        return
      }

      // 运行设置（轮询间隔 / 桌面通知 / 免打扰时段 → 写 config.yaml → 重启生效）
      if (req.method === 'POST' && routePath === '/api/settings') {
        try {
          const body = await this.parseJsonBody(req)
          const existing = readConfigDoc()
          // 界面上每个字段都填了值就必须被采纳或明确报错；旧写法是「越界静默丢弃 + 回 ok:true」，
          // 实测 pollInterval 填 0/-1/abc 都提示保存成功，实际存的还是旧值。
          const pollSec = intInRange(body.pollInterval, '轮询间隔（秒）', 10, 600)
          if (pollSec !== null) {
            existing.listener = { ...(existing.listener || {}), pollInterval: pollSec * 1000 }
          }
          if (body.desktop !== undefined) {
            existing.notify = { ...(existing.notify || {}), desktop: boolFlag(body.desktop, "桌面通知") }
          }
          if (body.quietEnabled !== undefined || body.quietStart !== undefined || body.quietEnd !== undefined) {
            existing.notify = {
              ...(existing.notify || {}),
              quiet: {
                enabled: boolFlag(body.quietEnabled, "免打扰开关"),
                start: timeOfDay(body.quietStart, '免打扰开始时间') || '23:00',
                end: timeOfDay(body.quietEnd, '免打扰结束时间') || '07:00',
              },
            }
          }
          // 轮询随机抖动（秒，0=关闭）
          const jitter = intInRange(body.pollJitter, '轮询随机抖动（秒）', 0, 120)
          if (jitter !== null) {
            existing.listener = { ...(existing.listener || {}), pollJitter: jitter }
          }
          // 签到重试（同一次签到内的请求重试次数与间隔）
          const retryAttempts = intInRange(body.retryMaxAttempts, '签到重试次数', 1, 10)
          if (retryAttempts !== null) {
            existing.checkin = { ...(existing.checkin || {}), retry: { ...((existing.checkin || {}).retry || {}), maxAttempts: retryAttempts } }
          }
          const retryDelay = intInRange(body.retryDelayMs, '签到重试间隔（毫秒）', 1000, 120000)
          if (retryDelay !== null) {
            existing.checkin = { ...(existing.checkin || {}), retry: { ...((existing.checkin || {}).retry || {}), delayMs: retryDelay } }
          }
          // 位置签到半径（米）
          const radius = intInRange(body.locationRadius, '位置签到半径（米）', 1, 500)
          if (radius !== null) {
            existing.geo = { ...(existing.geo || {}), locationRadius: radius }
          }
          // 签到后二次核对（提交成功后查询平台确认已签到）
          if (body.verifyEnabled !== undefined) {
            existing.checkin = { ...(existing.checkin || {}), verify: { enabled: boolFlag(body.verifyEnabled, "签到后二次核对") } }
          }
          // 每日签到日报（注意 hour 允许 0 = 零点，旧写法 `Number(x) || 22` 会把 0 变成 22）
          if (body.reportEnabled !== undefined || body.reportHour !== undefined) {
            const reportHour = intInRange(body.reportHour, '日报推送小时', 0, 23)
            existing.report = {
              enabled: body.reportEnabled !== undefined ? boolFlag(body.reportEnabled, "每日日报开关") : !!((existing.report || {}).enabled),
              hour: reportHour !== null ? reportHour : (((existing.report || {}).hour ?? 22)),
            }
          }
          // 每周签到周报（每周日推送本周统计）
          if (body.weeklyReport !== undefined) {
            existing.report = {
              ...(existing.report || {}),
              weekly: boolFlag(body.weeklyReport, "每周周报开关"),
            }
          }
          // 每日课前预检查
          if (body.preCheckEnabled !== undefined || body.preCheckHour !== undefined) {
            const preCheckHour = intInRange(body.preCheckHour, '课前预检查小时', 0, 23)
            existing.preCheck = {
              enabled: body.preCheckEnabled !== undefined ? boolFlag(body.preCheckEnabled, "课前预检查开关") : !!((existing.preCheck || {}).enabled),
              hour: preCheckHour !== null ? preCheckHour : (((existing.preCheck || {}).hour ?? 7)),
            }
          }
          // 智能轮询
          if (body.smartPollEnabled !== undefined) {
            existing.smartPoll = {
              ...(existing.smartPoll || { dayStart: 8, dayEnd: 22, nightMultiplier: 3 }),
              enabled: boolFlag(body.smartPollEnabled, "智能轮询开关"),
            }
          }
          // 模拟人类延迟
          if (body.humanDelayEnabled !== undefined || body.humanDelayMin !== undefined || body.humanDelayMax !== undefined) {
            existing.checkin = existing.checkin || {}
            const hdMin = intInRange(body.humanDelayMin, '人类模拟延迟下限（秒）', 5, 600)
            const hdMax = intInRange(body.humanDelayMax, '人类模拟延迟上限（秒）', 10, 900)
            const minSeconds = hdMin !== null ? hdMin : ((existing.checkin.humanDelay || {}).minSeconds ?? 30)
            const maxSeconds = hdMax !== null ? hdMax : ((existing.checkin.humanDelay || {}).maxSeconds ?? 300)
            if (minSeconds > maxSeconds) throw new BadRequestError('人类模拟延迟的下限不能大于上限')
            existing.checkin.humanDelay = {
              enabled: body.humanDelayEnabled !== undefined ? boolFlag(body.humanDelayEnabled, "人类模拟延迟开关") : !!((existing.checkin.humanDelay || {}).enabled),
              minSeconds,
              maxSeconds,
            }
          }
          // 签到前确认
          if (body.confirmBeforeEnabled !== undefined || body.confirmBeforeWait !== undefined) {
            existing.checkin = existing.checkin || {}
            const wait = intInRange(body.confirmBeforeWait, '签到前确认等待（秒）', 3, 120)
            existing.checkin.confirmBefore = {
              enabled: body.confirmBeforeEnabled !== undefined ? boolFlag(body.confirmBeforeEnabled, "签到前确认开关") : !!((existing.checkin.confirmBefore || {}).enabled),
              waitSeconds: wait !== null ? wait : ((existing.checkin.confirmBefore || {}).waitSeconds ?? 10),
            }
          }
          writeFileAtomic(CONFIG_FILE_PATH, YAML.stringify(existing))
          logger.info('运行设置已保存，' + RESTART_HINT)
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, message: '设置已保存，' + RESTART_HINT }))
        } catch (e: any) {
          this.fail(res, e, '保存设置失败: ')
        }
        return
      }

      // 历史记录：导出 CSV
      if (req.method === 'GET' && routePath === '/api/history/export') {
        const rows = this.historyProvider ? this.historyProvider() : []
        let csv = '\uFEFF时间,课程,类型,结果,账号\n'
        for (const r of rows) {
          const cell = (v: any) => `"${String(v ?? '').replace(/"/g, '""').replace(/\n/g, ' ')}"`
          csv += [cell(r.time || r.timestamp || ''), cell(r.courseName || ''), cell(r.type || ''), cell(r.result || ''), cell(r.accountName || r.account || '')].join(',') + '\n'
        }
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="checkin-history.csv"',
        })
        res.end(csv)
        return
      }

      // 历史记录：清空（清空前自动备份到 data/history-backups，保留最近 5 份）
      if (req.method === 'POST' && routePath === '/api/history/clear') {
        try {
          const backup = this.clearHistory ? this.clearHistory() : ''
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({
            ok: true,
            backup,
            message: backup
              ? `签到历史已清空，原记录备份为 ${backup.split(/[\\/]/).pop()}`
              : '签到历史已清空',
          }))
        } catch (e: any) {
          this.fail(res, e, '清空历史失败: ')
        }
        return
      }

      // 运行日志（软件内查看，默认最近 200 行）
      if (req.method === 'GET' && routePath.startsWith('/api/logs')) {
        try {
          const url = new URL(req.url || '/', `http://localhost:${this.port}`)
          const want = Math.min(Number(url.searchParams.get('lines') || 200) || 200, 1000)
          const file = this.getLogFile ? this.getLogFile() : ''
          if (!file || !fs.existsSync(file)) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: true, file: file || '', lines: [], message: '暂无日志文件' }))
            return
          }
          const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/).filter(Boolean)
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, file, lines: lines.slice(-want) }))
        } catch (e: any) {
          logger.error(`读取日志失败: ${e.message}`)
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: `读取日志失败: ${e.message}` }))
        }
        return
      }

      // 配置导出
      if (req.method === 'GET' && routePath === '/api/config/export') {
        try {
          const raw = readConfigDoc()
          const safe = JSON.parse(JSON.stringify(raw))
          const SENSITIVE_KEYS = new Set([
            'password', 'cookie', 'token', 'secret', 'secretId', 'secretKey',
            'appSecret', 'webhook', 'key', 'smtpPass', 'smtpPassword', 'accessKey',
            'botToken', 'sendKey', 'amapKey', 'baiduKey',
          ])
          const scrub = (value: any): any => {
            if (Array.isArray(value)) return value.map(scrub)
            if (value && typeof value === 'object') {
              for (const [key, child] of Object.entries(value)) {
                if (SENSITIVE_KEYS.has(key)) delete value[key]
                else value[key] = scrub(child)
              }
            }
            return value
          }
          scrub(safe)
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="checkin-config.json"' })
          res.end(JSON.stringify(safe, null, 2))
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: '导出失败: ' + e.message }))
        }
        return
      }

      // 配置导入
      if (req.method === 'POST' && routePath === '/api/config/import') {
        const CONFIG_FILE_PATH = process.env.CONFIG_FILE || 'config.yaml'
        try {
          const imported = await this.parseJsonBody(req)
          const existing = YAML.parse(fs.readFileSync(CONFIG_FILE_PATH, 'utf-8')) || {}
          // 只接受已知的顶层配置键：导入文件可能来自别人，盲合并等于把任意内容写进 config.yaml
          const ALLOWED = new Set([
            'proxy', 'accounts', 'listener', 'checkin', 'geo', 'notify', 'ocr', 'dingtalk',
            'web', 'storage', 'log', 'ignoreCourses', 'watchCourses', 'courseNotes',
            'preCheck', 'report', 'smartPoll', 'timetable',
          ])
          const picked: any = {}
          const skipped: string[] = []
          for (const k of Object.keys(imported)) {
            if (ALLOWED.has(k)) picked[k] = imported[k]
            else skipped.push(k)
          }
          // 导入的代理地址同样要过校验，否则 file:// 之类的值会绕过设置页的白名单直接进入网络层
          if (typeof picked.proxy === 'string' && picked.proxy) picked.proxy = proxyUrl(picked.proxy, '导入配置里的代理地址')
          const merged = { ...existing, ...picked }
          if (existing.accounts) merged.accounts = existing.accounts
          if (existing.dingtalk?.appSecret) merged.dingtalk = { ...merged.dingtalk, appSecret: existing.dingtalk.appSecret }
          if (existing.web?.token) merged.web = { ...merged.web, token: existing.web.token }
          if (existing.notify?.channels) merged.notify = { ...merged.notify, channels: existing.notify.channels }
          if (existing.ocr) merged.ocr = existing.ocr
          writeFileAtomic(CONFIG_FILE_PATH, YAML.stringify(merged))
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({
            ok: true,
            message: '配置已导入，' + RESTART_HINT
              + (skipped.length ? `（忽略了 ${skipped.length} 个无法识别的项：${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? ' 等' : ''}）` : ''),
          }))
        } catch (e: any) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: '导入失败: ' + e.message }))
        }
        return
      }

      // 课表数据
      if (req.method === 'GET' && routePath === '/api/schedule') {
        try {
          const status = this.statusProvider ? this.statusProvider() : {}
          const courses = (status as any).courses || []
          const watchCourses = (status as any).watchCourses || []
          const courseStats = (status as any).courseStats || []
          const courseHealth = (status as any).courseHealth || {}
          const wset = new Set(watchCourses.map(String))
          const allOn = watchCourses.length === 0
          const statsMap: Map<string, { success: number; fail: number }> = new Map(courseStats.map((s: any) => [s.course, s]))
          const schedule = courses.map((c: any) => {
            const cid = String(c.courseId)
            const st = statsMap.get(c.courseName) || { success: 0, fail: 0 }
            return { courseId: cid, classId: c.classId, courseName: c.courseName, teacherName: c.teacherName || '', watching: allOn || wset.has(cid), isRetired: c.isRetired || false, success: st.success, fail: st.fail, healthFail: courseHealth[cid] || 0 }
          })
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, schedule }))
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: '获取课表失败: ' + e.message }))
        }
        return
      }

      // 取消签到：用户点击通知里的取消链接
      if (req.method === 'GET' && routePath.startsWith('/api/confirm/cancel')) {
        try {
          const u = new URL(req.url || '', 'http://localhost')
          const aid = u.searchParams.get('aid') || ''
          if (aid) {
            // 必须交回主流程的取消集合：此前写的是本类自己的临时 Set，没人读，链接点了没反应
            if (this.cancelCheckin) this.cancelCheckin(aid)
            logger.info('用户取消签到: aid=' + aid)
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end('<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f6f4f1"><div style="text-align:center;padding:40px;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08)"><div style="font-size:48px;margin-bottom:12px">✋</div><h2 style="color:#333;margin:0 0 8px">已取消签到</h2><p style="color:#888;margin:0">可以关闭此页面了</p></div></body></html>')
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: e.message }))
        }
        return
      }

      // 课程备注：获取
      if (req.method === 'GET' && routePath === '/api/course-notes') {
        try {
          const existing = readConfigDoc()
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, notes: existing.courseNotes || {} }))
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: e.message }))
        }
        return
      }

      // 课程备注：保存
      if (req.method === 'POST' && routePath === '/api/course-notes') {
        try {
          const body = await this.parseJsonBody(req)
          const entries = Object.entries(body)
          if (entries.length > 100) throw new BadRequestError(`一次最多保存 100 条课程备注（当前 ${entries.length} 条）`)
          const cleaned: Record<string, string> = {}
          for (const [courseId, value] of entries) {
            if (typeof value !== 'string' && typeof value !== 'number') {
              throw new BadRequestError('课程备注内容格式不正确（应为文本）')
            }
            const cid = textField(courseId, '课程标识', 64)
            if (!cid) throw new BadRequestError('课程标识不能为空')
            const note = textField(value, '课程备注', 200, { multiline: true })
            // 键与值都取清理后的结果：旧写法把外部传入的任意键名直接写进 config.yaml
            if (note) cleaned[cid] = note
          }
          const existing = readConfigDoc()
          existing.courseNotes = { ...(existing.courseNotes || {}), ...cleaned }
          for (const k of Object.keys(existing.courseNotes)) {
            if (!existing.courseNotes[k] || String(existing.courseNotes[k]).trim() === '') delete existing.courseNotes[k]
          }
          writeFileAtomic(CONFIG_FILE_PATH, YAML.stringify(existing))
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, message: '备注已保存' }))
        } catch (e: any) {
          this.fail(res, e, '保存备注失败: ')
        }
        return
      }

      // 课程签到详情：获取某门课的所有签到记录
      if (req.method === 'GET' && routePath.startsWith('/api/course-detail')) {
        try {
          const u = new URL(req.url || '', 'http://localhost')
          const courseName = decodeURIComponent(u.searchParams.get('course') || '')
          const history = this.historyProvider ? this.historyProvider() : []
          const records = history.filter((r: any) => (r.courseName || '') === courseName)
            .slice(0, 100)
            .map((r: any) => ({
              time: r.time || '',
              type: r.type || '',
              result: r.message || r.result || '',
              account: r.accountName || r.account || '',
              timestamp: r.timestamp || 0,
            }))
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, courseName, records, total: records.length }))
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: e.message }))
        }
        return
      }

      // 日志导出（设置页「导出日志」：下载完整 app.log）
      if (req.method === 'GET' && routePath === '/api/logs/export') {
        try {
          const file = this.getLogFile ? this.getLogFile() : ''
          const content = file && fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '(暂无日志内容)'
          res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': 'attachment; filename="app.log"',
          })
          res.end(content)
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: '导出失败: ' + e.message }))
        }
        return
      }

      // 一键网络诊断：依次检测各关键接口连通性，失败给原因与建议
      if (req.method === 'GET' && routePath === '/api/diag') {
        try {
          const cookie = this.getPrimaryCookie ? this.getPrimaryCookie() : ''
          const proxyCfg = getProxyConfig()
          const results: any[] = []
          const probe = async (name: string, url: string) => {
            const start = Date.now()
            try {
              const r = await axios.get(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', ...(cookie ? { Cookie: cookie } : {}) },
                proxy: proxyCfg,
                timeout: 8000,
              })
              results.push({ name, ok: true, ms: Date.now() - start, status: r.status, detail: '' })
            } catch (e: any) {
              const status = e.response?.status
              const code = e.code || ''
              let detail = ''
              if (status) detail = 'HTTP ' + status + (status === 502 || status === 503 ? '（网关临时故障，重试即可）' : status === 401 ? '（未登录，需重新登录）' : '')
              else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') detail = '域名解析失败（DNS/网络不可达）'
              else if (code === 'ETIMEDOUT' || code === 'ECONNABORTED') detail = '连接超时（网络慢或被限制，可配置代理）'
              else if (code === 'ECONNREFUSED') detail = '连接被拒绝'
              else if (code === 'ECONNRESET') detail = '连接被重置（可能被防火墙拦截）'
              else detail = String(e.message || '未知错误').substring(0, 80)
              results.push({ name, ok: false, ms: Date.now() - start, status: status || 0, detail })
            }
          }
          await probe('公网出口', 'https://www.baidu.com')
          await probe('学习通登录域', 'https://passport2-api.chaoxing.com/v11/loginregister')
          await probe('课程列表接口', 'https://mooc1-api.chaoxing.com/mycourse/backclazzdata?view=json&rss=1&pageIndex=1&pageSize=5')
          await probe('签到接口', 'https://mobilelearn.chaoxing.com/newsign/preSign')
          await probe('IM 实时通道', 'https://im.chaoxing.com/webim/me')
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          // 诊断结果常被整段贴给别人求助，代理里的 user:pass 必须先抹掉
          res.end(JSON.stringify({ ok: true, cookie: !!cookie, proxy: maskProxyUrl(getProxy() || ''), results }))
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: '诊断失败: ' + e.message }))
        }
        return
      }

      // 代理配置：读取当前值
      if (req.method === 'GET' && routePath === '/api/proxy') {
        const existing = readConfigDoc()
        const pv = String(existing.proxy || '')
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: true, proxy: pv, enabled: !!pv }))
        return
      }

      // 代理配置：保存（写 config.yaml + 运行时立即生效，无需重启）
      if (req.method === 'POST' && routePath === '/api/proxy') {
        try {
          const body = await this.parseJsonBody(req)
          // 旧写法接受任意字符串，实测 `file:///etc/passwd` 会被写进配置并交给网络层
          const pv = proxyUrl(body.proxy)
          const existing = readConfigDoc()
          existing.proxy = pv
          writeFileAtomic(CONFIG_FILE_PATH, YAML.stringify(existing))
          setProxy(pv)
          logger.info('代理配置已保存并立即生效: ' + (pv ? maskProxyUrl(pv) : '(直连)'))
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, message: pv ? '代理已保存并立即生效' : '已切换为直连（不使用代理）' }))
        } catch (e: any) {
          this.fail(res, e, '保存代理配置失败: ')
        }
        return
      }

      // 代理配置：测试连通性（不改变当前代理设置）
      if (req.method === 'POST' && routePath === '/api/proxy/test') {
        let pv = ''
        try {
          pv = proxyUrl((await this.parseJsonBody(req)).proxy)
        } catch (e: any) {
          this.fail(res, e)
          return
        }
        try {
          let proxyCfg: any = false
          if (pv) {
            const u = new URL(pv.includes('://') ? pv : 'http://' + pv)
            // https 代理省略端口时按 443，旧写法一律当 80 会把正常代理误判为连不上
            proxyCfg = { protocol: u.protocol.replace(':', ''), host: u.hostname, port: u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80) }
          }
          const start = Date.now()
          const r = await axios.get('https://passport2-api.chaoxing.com/v11/loginregister', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            proxy: proxyCfg,
            timeout: 8000,
          })
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, ms: Date.now() - start, status: r.status, message: '连接成功（' + (Date.now() - start) + 'ms）' }))
        } catch (e: any) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: '连接失败: ' + String(e.message || '未知错误').substring(0, 120) }))
        }
        return
      }

      // 签到日历：?month=YYYY-MM 返回当月每日签到统计（历史记录月历视图）
      if (req.method === 'GET' && routePath.startsWith('/api/calendar')) {
        try {
          const url = new URL(req.url || '/', 'http://localhost:' + this.port)
          const month = url.searchParams.get('month') || ''
          const m = /^(\d{4})-(\d{2})$/.exec(month)
          if (!m) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, message: 'month 格式应为 YYYY-MM' }))
            return
          }
          const year = Number(m[1])
          const mon = Number(m[2])
          const rows = this.historyProvider ? this.historyProvider() : []
          const okRe = /成功|✅|已签到/
          const days: any = {}
          for (const r of rows) {
            const ts = r.timestamp || Date.parse(r.time || '') || 0
            if (!ts) continue
            const d = new Date(ts)
            if (d.getFullYear() !== year || d.getMonth() + 1 !== mon) continue
            const day = String(d.getDate())
            const e = days[day] || { success: 0, fail: 0, items: [] }
            if (okRe.test(r.message || r.result || '')) e.success++
            else e.fail++
            if (e.items.length < 20) e.items.push({ course: r.courseName || '未知课程', type: r.type || '普通', result: r.message || r.result || '', time: r.time || '' })
            days[day] = e
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, days }))
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: '日历获取失败: ' + e.message }))
        }
        return
      }

      // 测试通知
      if (req.method === 'POST' && routePath === '/api/notify/test') {
        try {
          if (this.sendTestNotify) await this.sendTestNotify()
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, message: '测试通知已发送（免打扰时段内桌面通知不会弹出）' }))
        } catch (e: any) {
          logger.error(`测试通知失败: ${e.message}`)
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: `发送失败: ${e.message}` }))
        }
        return
      }

      // 重新拉取课程列表（解决小课程/新课程未出现的问题）
      if (req.method === 'POST' && routePath === '/api/courses/refresh') {
        try {
          if (!this.refreshCourses) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, message: '课程刷新暂不可用（未配置账号？）' }))
            return
          }
          const r = await this.refreshCourses()
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: !!r.ok, message: r.message, count: r.count || 0 }))
        } catch (e: any) {
          logger.error(`刷新课程失败: ${e.message}`)
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: `刷新失败: ${e.message}` }))
        }
        return
      }

      // 钉钉图片通道设置（写 config.yaml；Stream 长连接需重启后建立）
      if (req.method === 'POST' && routePath === '/api/dingtalk/stream') {
        try {
          const body = await this.parseJsonBody(req)
          const existing = readConfigDoc()
          const appKey = textField(body.appKey ?? existing.dingtalk?.appKey, '钉钉 AppKey', 64).trim()
          // 密钥字段：留空 = 保持已存值（UI 承诺「留空则不修改」；旧实现的 `??` 会把
          // 空字符串当新值，保存时把已配好的 AppSecret 抹掉）
          const inputSecret = textField(body.appSecret ?? '', '钉钉 AppSecret', 128).trim()
          const prevSecret = typeof existing.dingtalk?.appSecret === 'string' ? existing.dingtalk.appSecret : ''
          let appSecret = inputSecret || prevSecret
          // 落盘前 DPAPI 加密（绑定当前 Windows 用户）；载入时在 config 层统一解密回内存
          if (appSecret && !isEncrypted(appSecret)) {
            const enc = encryptPassword(appSecret)
            if (enc) appSecret = enc
            else logger.warn('AppSecret DPAPI 加密不可用，将明文写入 config.yaml')
          }
          const enabled = body.enabled !== undefined ? boolFlag(body.enabled, '钉钉图片通道开关') : !!existing.dingtalk?.stream?.enabled

          existing.dingtalk = {
            ...(existing.dingtalk || {}),
            appKey,
            appSecret,
            stream: { ...(existing.dingtalk?.stream || {}), enabled },
          }
          writeFileAtomic(CONFIG_FILE_PATH, YAML.stringify(existing))

          const missing: string[] = []
          if (!appKey) missing.push('AppKey')
          if (!appSecret) missing.push('AppSecret')
          const message = enabled && missing.length
            ? `已保存，但缺少 ${missing.join(' 和 ')}，图片通道无法连接`
            : enabled
              ? '已保存。请重启软件以建立钉钉长连接（重启后在顶部状态条查看是否"已连接"）'
              : '已保存（图片通道已关闭）'
          logger.info(`钉钉图片通道设置已保存：enabled=${enabled} 凭据${missing.length ? '不完整' : '完整'}`)
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({
            ok: true,
            message,
            needsRestart: enabled && !missing.length,
            // 回显 appKey 便于核对；appSecret 一律不回显
            appKey,
            hasSecret: !!appSecret,
          }))
        } catch (e: any) {
          this.fail(res, e, '保存钉钉设置失败: ')
        }
        return
      }

      // 钉钉图片通道设置：读取（appKey 回显、appSecret 只报是否存在）
      if (req.method === 'GET' && routePath === '/api/dingtalk/settings') {
        try {
          const cfg = readConfigDoc()
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({
            ok: true,
            appKey: cfg.dingtalk?.appKey || '',
            hasSecret: !!cfg.dingtalk?.appSecret,
            enabled: !!cfg.dingtalk?.stream?.enabled,
          }))
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: e.message }))
        }
        return
      }

      // 监听课程设置（保存 → 立即生效；此前是「写配置 + 提示重启」，实际点了没反应）
      if (req.method === 'POST' && routePath === '/api/watch') {
        try {
          const body = await this.parseJsonBody(req)
          if (body.watchCourses !== undefined && body.watchCourses !== null && !Array.isArray(body.watchCourses)) {
            throw new BadRequestError('监听课程应为列表')
          }
          const rawWatch = Array.isArray(body.watchCourses) ? body.watchCourses : []
          if (rawWatch.length > 200) throw new BadRequestError(`一次最多监听 200 门课程（当前 ${rawWatch.length} 门）`)
          const watchCourses: string[] = rawWatch
            .map((c: any) => textField(c, '课程名称', 200))
            .filter(Boolean)
          // 仍写回配置，保证重启后保持同样的监听范围
          const existing = readConfigDoc()
          existing.watchCourses = watchCourses
          writeFileAtomic(CONFIG_FILE_PATH, YAML.stringify(existing))

          let listeningCount: number | undefined
          if (this.applyWatchCourses) {
            listeningCount = this.applyWatchCourses(watchCourses).listeningCount
            logger.info(`监听课程设置已保存并立即生效（在监听 ${listeningCount} 门）`)
          } else {
            logger.info(`监听课程设置已保存（${watchCourses.length} 门）`)
          }

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({
            ok: true,
            listeningCount,
            message: watchCourses.length
              ? `已生效：只监听 ${watchCourses.length} 门课程（无需重启）`
              : `已生效：监听全部课程${listeningCount !== undefined ? `（${listeningCount} 门）` : ''}（无需重启）`,
          }))
        } catch (e: any) {
          this.fail(res, e, '保存监听课程失败: ')
        }
        return
      }

      // 监听总开关：开启/停止轮询监听（运行时立即生效，无需重启）
      if (req.method === 'POST' && routePath === '/api/listen') {
        try {
          const body = await this.parseJsonBody(req)
          if (!this.setListening) throw new Error('监听开关未接入')
          const on = boolFlag(body.on, '监听开关')
          const r = this.setListening(on)
          logger.info(`监听已${on ? '开启' : '停止'}（在监听 ${r.listeningCount} 门课程）`)
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ...r, message: on ? `已开启监听（${r.listeningCount} 门课程）` : '已停止监听（不再轮询，二维码上传仍可用）' }))
        } catch (e: any) {
          this.fail(res, e, '监听开关操作失败: ')
        }
        return
      }

      // 单门课程监听开关（运行时立即生效）
      if (req.method === 'POST' && routePath === '/api/courses/toggle') {
        try {
          const body = await this.parseJsonBody(req)
          // 参数缺失属客户端错误：BadRequestError → 400（500 应只表示服务端自身失败）
          const courseId = requiredText(body.courseId, '课程标识', 64)
          if (!this.toggleCourse) throw new Error('课程开关未接入')
          const on = boolFlag(body.on, '课程监听开关')
          const r = this.toggleCourse(courseId, on)
          // 失败时保留 toggleCourse 给出的原因，不要用成功文案覆盖掉
          const message = r.ok ? (on ? '已开启该课程监听' : '已关闭该课程监听') : (r.message || '操作失败')
          if (r.ok) logger.info(`课程 ${courseId} 监听已${on ? '开启' : '关闭'}`)
          else logger.warn(`课程开关被拒绝（courseId=${courseId}）：${message}`)
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ...r, message }))
        } catch (e: any) {
          this.fail(res, e, '课程开关操作失败: ')
        }
        return
      }

      // 恢复全部课程监听
      if (req.method === 'POST' && routePath === '/api/courses/reset') {
        try {
          if (!this.resetCourses) throw new Error('课程开关未接入')
          const r = this.resetCourses()
          logger.info(`已恢复全部课程监听（${r.listeningCount} 门）`)
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ...r, message: `已恢复全部课程监听（${r.listeningCount} 门）` }))
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: `操作失败: ${e.message}` }))
        }
        return
      }

      // 课表：读取（含节次定义、可填课程、完整度）
      if (req.method === 'GET' && routePath === '/api/timetable') {
        try {
          if (!this.getTimetablePayload) throw new Error('课表未接入')
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, ...this.getTimetablePayload() }))
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: `读取课表失败: ${e.message}` }))
        }
        return
      }

      // 课表：按「最近签到时间」生成填充建议
      if (req.method === 'POST' && routePath === '/api/timetable/suggest') {
        try {
          if (!this.suggestTimetable) throw new Error('课表未接入')
          const r = this.suggestTimetable()
          logger.info(`课表自动填充建议：${r.filled} 个格子（依据最近签到时间）`)
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, ...r }))
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: `生成建议失败: ${e.message}` }))
        }
        return
      }

      // 课表：保存（必须填满，否则拒绝并提示）
      if (req.method === 'POST' && routePath === '/api/timetable/save') {
        try {
          const body = await this.parseJsonBody(req, { allowEmpty: true })
          if (!this.saveTimetable) throw new Error('课表未接入')
          const r = this.saveTimetable(body.table || body)
          if (!r.ok) logger.warn(`课表未保存：${r.message}`)
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(r))
        } catch (e: any) {
          this.fail(res, e, '保存课表失败: ')
        }
        return
      }

      // 立即扫描一次（手机端手动催扫；忽略课表时段与监听开关）
      if (req.method === 'POST' && routePath === '/api/scan-now') {
        try {
          if (!this.scanNow) throw new Error('扫描功能未接入')
          const r = await this.scanNow()
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(r))
        } catch (e: any) {
          logger.error(`立即扫描失败: ${e.message}`)
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: `扫描失败: ${e.message}` }))
        }
        return
      }

      // 免责声明：读取接受状态（客户端据此决定是否弹窗）
      if (req.method === 'GET' && routePath === '/api/disclaimer') {
        try {
          const r = this.getConsent ? this.getConsent() : { accepted: false, currentVersion: 1 }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, ...r }))
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, accepted: false, message: e.message }))
        }
        return
      }

      // 免责声明：记录已接受（服务端持久化，留存时间与版本）
      if (req.method === 'POST' && routePath === '/api/disclaimer/accept') {
        try {
          const r = this.acceptDisclaimer ? this.acceptDisclaimer() : { accepted: true, acceptedAt: new Date().toISOString(), version: 1 }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, ...r }))
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: e.message }))
        }
        return
      }

      // 控制台首页（软件主界面）
      if (req.method === 'GET' && (routePath === '/' || routePath === '/console')) {
        const scriptNonce = crypto.randomBytes(18).toString('base64url')
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          // 不给缓存：否则升级后浏览器仍拿旧界面（实测出现过改版后页面纹丝不动）
          'Cache-Control': 'no-store',
          'Content-Security-Policy': `default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'nonce-${scriptNonce}'; connect-src 'self'`,
          'X-Frame-Options': 'DENY',
        })
        res.end(getConsolePage(this.getStatus(), this.token || '', { scriptNonce }))
        return
      }

      // 钉钉回调
      if (req.method === 'POST' && routePath.startsWith('/dingtalk/callback')) {
        try {
          const body = await this.readBody(req)
          const data = JSON.parse(body) as DingTalkMessage

          logger.debug(`钉钉消息: ${data.msgtype}`)

          // 处理图片消息（富文本中的图片 或 直接发图）
          // 兼容三种形态：{ richText: [...] }、{ content: { richText: [...] } }、{ content: { downloadCode } }
          const robotCode = (data as any).robotCode || undefined
          const imageCodes: string[] = []
          const collect = (item: any) => {
            const code = item?.pictureDownloadCode || item?.downloadCode
            if (code && typeof code === 'string') imageCodes.push(code)
          }
          if (Array.isArray((data as any).richText)) (data as any).richText.forEach(collect)
          if (Array.isArray((data as any).content?.richText)) (data as any).content.richText.forEach(collect)
          if ((data as any).msgtype === 'picture') collect((data as any).content)

          for (const code of imageCodes) {
            await this.handleImageCode(code, robotCode)
          }

          // 处理文字指令
          if (data.msgtype === 'text' && data.text?.content) {
            logger.info(`钉钉文字消息: ${data.text.content}`)
          }

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } catch (e: any) {
          logger.error(`钉钉回调处理失败: ${e.message}`)
          res.writeHead(500)
          res.end('error')
        }
        return
      }

      // 上传页面（手机端，仅二维码签到上传）
      if (req.method === 'GET' && routePath.startsWith('/upload')) {
        if (!this.allowRequest(req, 30, 60000)) {
          res.writeHead(429, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: '请求过于频繁' }))
          return
        }
        const scriptNonce = crypto.randomBytes(18).toString('base64url')
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'nonce-${scriptNonce}'; connect-src 'self'`,
          'X-Frame-Options': 'DENY',
        })
        res.end(this.getUploadPage('qr', scriptNonce))
        return
      }

      // 二维码图片上传接口
      if (req.method === 'POST' && routePath.startsWith('/upload/image')) {
        if (!this.allowRequest(req, 10, 60000)) {
          res.writeHead(429, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: '上传过于频繁' }))
          return
        }
        const contentLength = Number(req.headers['content-length'] || 0)
        if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > 15 * 1024 * 1024) {
          res.writeHead(413, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: '图片必须小于 15MB' }))
          return
        }

        try {
          const chunks: Buffer[] = []
          let received = 0
          await new Promise((resolve, reject) => {
            req.on('data', (chunk: Buffer) => {
              received += chunk.length
              if (received > 15 * 1024 * 1024) {
                req.destroy()
                reject(new Error('图片超过 15MB 限制'))
                return
              }
              chunks.push(chunk)
            })
            req.on('end', resolve)
            req.on('error', reject)
          })
          const buffer = Buffer.concat(chunks)
          if (!this.isSupportedImage(buffer)) {
            res.writeHead(415, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: '仅支持 PNG、JPEG、BMP 或 WebP 图片' }))
            return
          }

          if (this.imageHandler && buffer.length > 0) {
            // 把处理结果回给上传页：此前一律返回"正在处理"，用户在手机上
            // 既看不到识别失败，也看不到签到成功与否，只能回来翻日志
            const r = String((await (this.imageHandler as any)(buffer)) || '')
            const ok = !r || !/❌|⚠️|失败|未能/.test(r)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(ok
              ? { success: true, message: r || '图片已接收' }
              : { success: false, error: r || '处理失败' }))
            return
          }

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, message: '图片已接收，正在处理...' }))
        } catch (e: any) {
          logger.error(`上传图片处理失败: ${e.message}`)
          res.writeHead(500)
          res.end(JSON.stringify({ error: e.message }))
        }
        return
      }

      res.writeHead(404)
      res.end('not found')
    })

    const host = process.env.WEB_HOST || '127.0.0.1'
    // 没有 error 处理时，端口冲突会以未捕获异常退出，用户只看到「软件打不开」
    this.server.on('error', (e: any) => {
      if (e?.code === 'EADDRINUSE') {
        logger.error(`端口 ${this.port} 已被占用：可能同时开着两份本软件，或别的服务占用了 ${host}:${this.port}。关掉多余的一份，或在 config.yaml 改 web.port 后重启`)
      } else {
        logger.error(`本地服务监听失败: ${e?.message || e}`)
      }
    })
    this.server.listen(this.port, host, () => {
      logger.success(`本地服务已启动: http://${host}:${this.port}`)
      logger.info(`消息回调: POST /dingtalk/callback${this.token ? ' （需 token）' : ''}`)
      logger.info(`手机上传: GET  /upload${this.token ? ' （已开启 token 鉴权）' : ''}`)
      logger.info(`健康检查: GET  /health`)
    })
  }

  /**
   * 通过钉钉 API 下载图片（企业内部机器人）
   *
   * 链路：gettoken(appKey+appSecret) → messageFiles/download(downloadCode, robotCode)
   *       → downloadUrl → 下载为 Buffer
   *
   * robotCode 优先用调用方传入的值（Stream 模式的消息里自带 robotCode，比 appKey 准确）；
   * 未传时退回 appKey（HTTP 回调场景下多数企业内部机器人两者相等）。
   */
  async downloadImageByCode(downloadCode: string, robotCode?: string): Promise<Buffer | null> {
    if (!this.appKey || !this.appSecret) {
      logger.warn('未配置 appKey/appSecret，无法从钉钉下载图片，请改用 /upload 页面上传')
      return null
    }
    const tokenResp = await axios.get('https://oapi.dingtalk.com/gettoken', {
      params: { appkey: this.appKey, appsecret: this.appSecret },
      proxy: getProxyConfig(),
    })
    const accessToken: string = tokenResp.data?.access_token
    if (!accessToken) throw new Error('获取钉钉 access_token 失败: ' + JSON.stringify(tokenResp.data))

    const dl = await axios.post(
      'https://oapi.dingtalk.com/robot/messageFiles/download',
      { downloadCode, robotCode: robotCode || this.appKey },
      {
        headers: { 'x-acs-dingtalk-access-token': accessToken },
        proxy: getProxyConfig(),
      },
    )
    const downloadUrl: string | undefined = dl.data?.downloadUrl
    if (!downloadUrl) throw new Error('钉钉未返回图片下载地址: ' + JSON.stringify(dl.data))

    const imgResp = await axios.get(downloadUrl, { responseType: 'arraybuffer', proxy: getProxyConfig() })
    return Buffer.from(imgResp.data)
  }

  /** HTTP 回调入口：下载后交给 imageHandler（Stream 模式不走这里，见 dingtalk-listener.ts） */
  private async handleImageCode(downloadCode: string, robotCode?: string) {
    try {
      logger.info(`收到钉钉图片: ${downloadCode}`)
      const buffer = await this.downloadImageByCode(downloadCode, robotCode)
      if (buffer && this.imageHandler) await this.imageHandler(buffer)
    } catch (e: any) {
      logger.error(`下载钉钉图片失败: ${e.message}`)
      logger.warn('图片下载失败，请改用手机 /upload 页面直接上传二维码')
    }
  }

  private applyCors(res: http.ServerResponse) {
    if (this.allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', this.allowedOrigin)
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Web-Token')
    }
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: string[] = []
      let size = 0
      req.on('data', (chunk: string) => {
        size += Buffer.byteLength(chunk)
        if (size > 1024 * 1024) {
          req.destroy()
          reject(new BadRequestError('请求体超过 1MB 限制'))
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(chunks.join('')))
      req.on('error', reject)
    })
  }

  /**
   * 解析 JSON 请求体。
   * 旧写法在每个路由里裸调 `JSON.parse(await this.readBody(req))`，客户端送来坏 JSON 时
   * 被外层 catch 当成服务端故障回了 500（实测 `/api/settings` 空 body/坏 JSON → HTTP 500）。
   * 这里统一成 400 + 可读原因；同时要求顶层是对象，避免 `[1,2]` 之类让 `body.xxx` 全 undefined
   * 却仍报「保存成功」。
   */
  private async parseJsonBody(req: http.IncomingMessage, opts: { allowEmpty?: boolean } = {}): Promise<Record<string, any>> {
    const raw = await this.readBody(req)
    if (!raw.trim()) {
      if (opts.allowEmpty) return {}
      throw new BadRequestError('请求体为空，未提交任何内容')
    }
    let parsed: any
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new BadRequestError('请求体不是合法的 JSON')
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequestError('请求体应为 JSON 对象')
    }
    return parsed
  }

  /** 统一的失败响应：入参问题 400 且不写错误日志，服务端故障 500 并记日志 */
  private fail(res: http.ServerResponse, e: any, prefix = ''): void {
    if (e instanceof BadRequestError) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, message: e.message }))
      return
    }
    logger.error(`${prefix}${e && e.message ? e.message : e}`)
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: false, message: `${prefix}${(e && e.message) || '未知错误'}` }))
  }

  private isSupportedImage(buffer: Buffer): boolean {
    if (buffer.length < 12) return false
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return true
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true
    if (buffer[0] === 0x42 && buffer[1] === 0x4d) return true
    return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
  }

  /**
   * 手机端上传页面（二维码签到专用，自动携带 token）
   *
   * 设计（模块 9）：与桌面控制台复用同一套 Design Tokens（暖白画布 + 超星暖橙）；
   *   · 不加 capture 属性 —— 二维码常常是群里分享的截图 / 相册原图，强制开摄像头会让人传不了；
   *   · 选中即上传（一步完成），状态直接回显成功或具体失败原因，不做「正在处理」静默遮蔽。
   */
  private getUploadPage(_type: 'qr' = 'qr', scriptNonce = ''): string {
    const token = this.token || ''
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>超星签到码快捷上传</title>
<style>
:root {
  --bg-canvas: #F8F7F4;
  --bg-surface: #FFFFFF;
  --bg-surface-sub: #F2EFE9;
  --ink-primary: #1C1917;
  --ink-secondary: #57534E;
  --ink-tertiary: #A8A29E;
  --brand-50: #FFF7ED;
  --brand-500: #F78A46;
  --brand-600: #EF7429;
  --brand-700: #C25E1A;
  --line-dim: #E7E5E0;
  --status-ok-bg: #EDFDF5;
  --status-ok-ink: #065F46;
  --status-ok-line: #A7F3D0;
  --status-err-bg: #FEF2F2;
  --status-err-ink: #991B1B;
  --status-err-line: #FECACA;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 20px 16px calc(20px + env(safe-area-inset-bottom));
  background: var(--bg-canvas);
  color: var(--ink-primary);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  -webkit-font-smoothing: antialiased;
}
.upload-card {
  background: var(--bg-surface);
  border: 1px solid var(--line-dim);
  border-radius: 16px;
  padding: 24px 20px;
  box-shadow: 0 4px 12px rgba(28,25,23,0.05);
  text-align: center;
}
.app-icon { width: 44px; height: 44px; margin: 0 auto 12px; display: block; }
h1 { font-size: 18px; margin: 0 0 6px; letter-spacing: -0.01em; }
p.sub { font-size: 13px; color: var(--ink-secondary); margin: 0 0 20px; line-height: 1.6; }
.file-btn {
  display: block;
  width: 100%;
  height: 48px;
  line-height: 48px;
  background: var(--brand-600);
  color: #FFF;
  font-size: 16px;
  font-weight: 600;
  border-radius: 12px;
  border: none;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(239,116,41,0.30);
  transition: filter .15s ease, transform .12s ease;
}
.file-btn:active { transform: scale(.98); filter: brightness(.97); }
.file-btn.disabled { opacity: .6; pointer-events: none; }
#fileInput { display: none; }
.hint { font-size: 12px; color: var(--ink-tertiary); margin-top: 12px; line-height: 1.6; }
.result-box {
  margin-top: 16px;
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 14px;
  line-height: 1.6;
  display: none;
  word-break: break-all;
  text-align: left;
}
.result-box.ok { background: var(--status-ok-bg); color: var(--status-ok-ink); border: 1px solid var(--status-ok-line); }
.result-box.err { background: var(--status-err-bg); color: var(--status-err-ink); border: 1px solid var(--status-err-line); }
.result-box.loading { background: var(--brand-50); color: var(--brand-700); border: 1px solid var(--brand-500); }
.preview { max-width: 100%; max-height: 200px; border-radius: 10px; margin-top: 14px; display: none; }
</style>
</head>
<body>
  <div class="upload-card">
    <svg class="app-icon" viewBox="0 0 512 512" fill="none" aria-hidden="true">
      <rect width="512" height="512" rx="104" fill="#EF7429"/>
      <path d="M148 264l74 78 142-168" stroke="#FFFFFF" stroke-width="78" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <h1>提交二维码签到</h1>
    <p class="sub">从相册选择群内同学分享的签到二维码截图，选中后自动识别并完成签到</p>
    <label class="file-btn" id="pickBtn" for="fileInput">从手机相册选取</label>
    <input type="file" id="fileInput" accept="image/*">
    <img id="preview" class="preview" alt="预览">
    <div id="resultBox" class="result-box"></div>
    <div class="hint">支持 PNG / JPG / BMP · 本地纯 JS 解码，无需联网</div>
  </div>

  <script${scriptNonce ? ` nonce="${scriptNonce}"` : ''}>
    var UPLOAD_TOKEN = ${JSON.stringify(token).replace(/<\//g, '<\\/')}
    var UPLOAD_TYPE = 'qr'
    var fileInput = document.getElementById('fileInput')
    var pickBtn = document.getElementById('pickBtn')
    var preview = document.getElementById('preview')
    var resultBox = document.getElementById('resultBox')

    function setResult(kind, text) {
      resultBox.style.display = 'block'
      resultBox.className = 'result-box ' + kind
      resultBox.textContent = text
    }

    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0]
      if (!file) return
      if (file.type.indexOf('image/') !== 0) { setResult('err', '❌ 请选择图片文件'); return }

      if (window.URL && window.URL.createObjectURL) {
        preview.src = window.URL.createObjectURL(file)
        preview.style.display = 'block'
      }
      pickBtn.classList.add('disabled')
      setResult('loading', '正在上传并识别解码…')

      var qs = UPLOAD_TOKEN ? ('?token=' + encodeURIComponent(UPLOAD_TOKEN)) : ''
      // 直接以原始字节上传（服务端按图片魔数校验），不使用 multipart 表单
      fetch('/upload/image' + qs, { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } })
        .then(function (r) { return r.json() })
        .then(function (data) {
          pickBtn.classList.remove('disabled')
          if (data.success) { setResult('ok', '✅ ' + (data.message || '签到成功！')) }
          else { setResult('err', '❌ ' + (data.error || data.message || '未能在图中检测到有效签到码，请传原图')) }
        })
        .catch(function (err) {
          pickBtn.classList.remove('disabled')
          setResult('err', '❌ 网络请求异常：' + err.message)
        })
    })
  </script>
</body>
</html>`
  }

  /**
   * 控制台状态数据（实时获取）
   */
  getStatus(): ConsoleStatus {
    return this.statusProvider ? (this.statusProvider() as ConsoleStatus) : {}
  }

  stop() {
    this.server?.close()
  }
}
