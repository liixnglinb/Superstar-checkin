import * as http from 'http'
import * as crypto from 'crypto'
import * as fs from 'fs'
import YAML from 'yaml'
import axios from 'axios'
import { logger } from '../utils/logger'
import { getProxyConfig, getProxy, setProxy } from '../providers/runtime-config'
import { encryptPassword } from '../utils/crypto'
import { getConsolePage, ConsoleStatus } from './console-ui'
import { writeFileAtomic } from '../utils/fs'

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

type ImageHandler = (imageBuffer: Buffer) => Promise<void>

/** 控制台首页数据提供者（每次请求时实时获取） */
export type StatusProvider = () => Record<string, any>

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
  clearHistory?: () => void
  /** 发送测试通知 */
  sendTestNotify?: () => Promise<void>
  /** 重新拉取课程列表并重建轮询监听 */
  refreshCourses?: () => Promise<{ ok: boolean; count: number; message: string }>
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
  private clearHistory?: () => void
  private sendTestNotify?: () => Promise<void>
  private refreshCourses?: () => Promise<{ ok: boolean; count: number; message: string }>
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
          const body = JSON.parse(await this.readBody(req))
          const username = String(body.username || '').trim()
          const password = String(body.password || '')
          if (!username || !password) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, message: '账号和密码不能为空' }))
            return
          }
          const cfgFile = process.env.CONFIG_FILE || 'config.yaml'
          const existing = fs.existsSync(cfgFile)
            ? YAML.parse(fs.readFileSync(cfgFile, 'utf-8')) || {}
            : {}
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
          writeFileAtomic(cfgFile, YAML.stringify(existing))
          logger.info(`账号已${action}到 ${cfgFile}（用户名: ${username}），当前共 ${accounts.length} 个账号，重启后生效`)
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, message: `账号已${action}（当前 ${accounts.length} 个），重启后生效` }))
        } catch (e: any) {
          logger.error(`保存账号失败: ${e.message}`)
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: `保存失败: ${e.message}` }))
        }
        return
      }

      // 删除账号
      if (req.method === 'POST' && routePath === '/api/accounts/remove') {
        try {
          const body = JSON.parse(await this.readBody(req))
          const username = String(body.username || '').trim()
          if (!username) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, message: '缺少账号' }))
            return
          }
          const cfgFile = process.env.CONFIG_FILE || 'config.yaml'
          const existing = fs.existsSync(cfgFile)
            ? YAML.parse(fs.readFileSync(cfgFile, 'utf-8')) || {}
            : {}
          const before = Array.isArray(existing.accounts) ? existing.accounts.length : 0
          existing.accounts = (Array.isArray(existing.accounts) ? existing.accounts : [])
            .filter((a: any) => String(a.username) !== username)
          if (existing.accounts.length === before) {
            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, message: '未找到该账号' }))
            return
          }
          writeFileAtomic(cfgFile, YAML.stringify(existing))
          logger.info(`账号已删除: ${username}`)
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, message: '账号已删除，重启后生效' }))
        } catch (e: any) {
          logger.error(`删除账号失败: ${e.message}`)
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: `删除失败: ${e.message}` }))
        }
        return
      }

      // 设为主账号（移到数组首位 = 课程轮询监听使用该账号）
      if (req.method === 'POST' && routePath === '/api/accounts/primary') {
        try {
          const body = JSON.parse(await this.readBody(req))
          const username = String(body.username || '').trim()
          const cfgFile = process.env.CONFIG_FILE || 'config.yaml'
          const existing = fs.existsSync(cfgFile)
            ? YAML.parse(fs.readFileSync(cfgFile, 'utf-8')) || {}
            : {}
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
          writeFileAtomic(cfgFile, YAML.stringify(existing))
          logger.info(`主账号已切换为: ${username}`)
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, message: `已将 ${username} 设为主账号，重启后生效` }))
        } catch (e: any) {
          logger.error(`切换主账号失败: ${e.message}`)
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: `切换失败: ${e.message}` }))
        }
        return
      }

      // 运行设置（轮询间隔 / 桌面通知 / 免打扰时段 → 写 config.yaml → 重启生效）
      if (req.method === 'POST' && routePath === '/api/settings') {
        try {
          const body = JSON.parse(await this.readBody(req))
          const cfgFile = process.env.CONFIG_FILE || 'config.yaml'
          const existing = fs.existsSync(cfgFile)
            ? YAML.parse(fs.readFileSync(cfgFile, 'utf-8')) || {}
            : {}
          if (body.pollInterval !== undefined && body.pollInterval !== null && body.pollInterval !== '') {
            const sec = Number(body.pollInterval)
            if (sec >= 10 && sec <= 600) {
              existing.listener = { ...(existing.listener || {}), pollInterval: Math.round(sec * 1000) }
            }
          }
          if (body.desktop !== undefined) {
            existing.notify = { ...(existing.notify || {}), desktop: !!body.desktop }
          }
          if (body.quietEnabled !== undefined || body.quietStart !== undefined || body.quietEnd !== undefined) {
            existing.notify = {
              ...(existing.notify || {}),
              quiet: {
                enabled: !!body.quietEnabled,
                start: String(body.quietStart || '23:00'),
                end: String(body.quietEnd || '07:00'),
              },
            }
          }
          // 轮询随机抖动（秒，0=关闭）
          if (body.pollJitter !== undefined && body.pollJitter !== null && body.pollJitter !== '') {
            const j = Number(body.pollJitter)
            if (j >= 0 && j <= 120) {
              existing.listener = { ...(existing.listener || {}), pollJitter: Math.round(j) }
            }
          }
          // 签到重试（同一次签到内的请求重试次数与间隔）
          if (body.retryMaxAttempts !== undefined && body.retryMaxAttempts !== null && body.retryMaxAttempts !== '') {
            const n = Number(body.retryMaxAttempts)
            if (n >= 1 && n <= 10) {
              existing.checkin = { ...(existing.checkin || {}), retry: { ...((existing.checkin || {}).retry || {}), maxAttempts: Math.round(n) } }
            }
          }
          if (body.retryDelayMs !== undefined && body.retryDelayMs !== null && body.retryDelayMs !== '') {
            const d = Number(body.retryDelayMs)
            if (d >= 1000 && d <= 120000) {
              existing.checkin = { ...(existing.checkin || {}), retry: { ...((existing.checkin || {}).retry || {}), delayMs: Math.round(d) } }
            }
          }
          // 位置签到半径（米）
          if (body.locationRadius !== undefined && body.locationRadius !== null && body.locationRadius !== '') {
            const r = Number(body.locationRadius)
            if (r >= 1 && r <= 500) {
              existing.geo = { ...(existing.geo || {}), locationRadius: Math.round(r) }
            }
          }
          // 签到后二次核对（提交成功后查询平台确认已签到）
          if (body.verifyEnabled !== undefined) {
            existing.checkin = { ...(existing.checkin || {}), verify: { enabled: !!body.verifyEnabled } }
          }
          // 每日签到日报
          if (body.reportEnabled !== undefined || body.reportHour !== undefined) {
            existing.report = {
              enabled: body.reportEnabled !== undefined ? !!body.reportEnabled : !!((existing.report || {}).enabled),
              hour: body.reportHour !== undefined && body.reportHour !== null && body.reportHour !== ''
                ? Math.max(0, Math.min(23, Number(body.reportHour) || 22))
                : ((existing.report || {}).hour || 22),
            }
          }
          // 每周签到周报（每周日推送本周统计）
          if (body.weeklyReport !== undefined) {
            existing.report = {
              ...(existing.report || {}),
              weekly: !!body.weeklyReport,
            }
          }
          // 每日课前预检查
          if (body.preCheckEnabled !== undefined || body.preCheckHour !== undefined) {
            existing.preCheck = {
              enabled: body.preCheckEnabled !== undefined ? !!body.preCheckEnabled : !!((existing.preCheck || {}).enabled),
              hour: body.preCheckHour !== undefined && body.preCheckHour !== null && body.preCheckHour !== ''
                ? Math.max(0, Math.min(23, Number(body.preCheckHour) || 7))
                : ((existing.preCheck || {}).hour || 7),
            }
          }
          // 智能轮询
          if (body.smartPollEnabled !== undefined) {
            existing.smartPoll = {
              ...(existing.smartPoll || { dayStart: 8, dayEnd: 22, nightMultiplier: 3 }),
              enabled: !!body.smartPollEnabled,
            }
          }
          // 模拟人类延迟
          if (body.humanDelayEnabled !== undefined || body.humanDelayMin !== undefined || body.humanDelayMax !== undefined) {
            existing.checkin = existing.checkin || {}
            existing.checkin.humanDelay = {
              enabled: body.humanDelayEnabled !== undefined ? !!body.humanDelayEnabled : !!((existing.checkin.humanDelay || {}).enabled),
              minSeconds: body.humanDelayMin !== undefined && body.humanDelayMin !== null && body.humanDelayMin !== '' ? Math.max(5, Number(body.humanDelayMin) || 30) : ((existing.checkin.humanDelay || {}).minSeconds || 30),
              maxSeconds: body.humanDelayMax !== undefined && body.humanDelayMax !== null && body.humanDelayMax !== '' ? Math.max(10, Number(body.humanDelayMax) || 300) : ((existing.checkin.humanDelay || {}).maxSeconds || 300),
            }
          }
          // 签到前确认
          if (body.confirmBeforeEnabled !== undefined || body.confirmBeforeWait !== undefined) {
            existing.checkin = existing.checkin || {}
            existing.checkin.confirmBefore = {
              enabled: body.confirmBeforeEnabled !== undefined ? !!body.confirmBeforeEnabled : !!((existing.checkin.confirmBefore || {}).enabled),
              waitSeconds: body.confirmBeforeWait !== undefined && body.confirmBeforeWait !== null && body.confirmBeforeWait !== '' ? Math.max(3, Number(body.confirmBeforeWait) || 10) : ((existing.checkin.confirmBefore || {}).waitSeconds || 10),
            }
          }
          writeFileAtomic(cfgFile, YAML.stringify(existing))
          logger.info('运行设置已保存，重启后生效')
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, message: '设置已保存，重启后生效' }))
        } catch (e: any) {
          logger.error(`保存设置失败: ${e.message}`)
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: `保存失败: ${e.message}` }))
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

      // 历史记录：清空
      if (req.method === 'POST' && routePath === '/api/history/clear') {
        try {
          if (this.clearHistory) this.clearHistory()
          logger.info('签到历史已清空')
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, message: '签到历史已清空' }))
        } catch (e: any) {
          logger.error(`清空历史失败: ${e.message}`)
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: `清空失败: ${e.message}` }))
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
          const cfgFile = process.env.CONFIG_FILE || 'config.yaml'
          const raw = YAML.parse(fs.readFileSync(cfgFile, 'utf-8'))
          const safe = JSON.parse(JSON.stringify(raw))
          const SENSITIVE_KEYS = new Set([
            'password', 'cookie', 'token', 'secret', 'secretId', 'secretKey',
            'appSecret', 'webhook', 'key', 'smtpPass', 'smtpPassword', 'accessKey',
            'botToken', 'sendKey',
          ])
          const scrub = (value: any) => {
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
        const cfgFile = process.env.CONFIG_FILE || 'config.yaml'
        try {
          const imported = JSON.parse(await this.readBody(req))
          const existing = YAML.parse(fs.readFileSync(cfgFile, 'utf-8'))
          const merged = { ...existing, ...imported }
          if (existing.accounts) merged.accounts = existing.accounts
          if (existing.dingtalk?.appSecret) merged.dingtalk = { ...merged.dingtalk, appSecret: existing.dingtalk.appSecret }
          if (existing.web?.token) merged.web = { ...merged.web, token: existing.web.token }
          if (existing.notify?.channels) merged.notify = { ...merged.notify, channels: existing.notify.channels }
          if (existing.ocr) merged.ocr = existing.ocr
          writeFileAtomic(cfgFile, YAML.stringify(merged))
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, message: '配置已导入，重启后生效' }))
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
            ;(this as any)._cancelledAids = (this as any)._cancelledAids || new Set()
            ;(this as any)._cancelledAids.add(aid)
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
          const cfgFile = process.env.CONFIG_FILE || 'config.yaml'
          const existing = fs.existsSync(cfgFile) ? YAML.parse(fs.readFileSync(cfgFile, 'utf-8')) || {} : {}
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
        let bodyStr = ''
        req.on('data', (c) => { bodyStr += c })
        req.on('end', () => {
          try {
            const body = JSON.parse(bodyStr)
            const cfgFile = process.env.CONFIG_FILE || 'config.yaml'
            const existing = fs.existsSync(cfgFile) ? YAML.parse(fs.readFileSync(cfgFile, 'utf-8')) || {} : {}
            existing.courseNotes = { ...(existing.courseNotes || {}), ...body }
            for (const k of Object.keys(existing.courseNotes)) {
              if (!existing.courseNotes[k] || String(existing.courseNotes[k]).trim() === '') delete existing.courseNotes[k]
            }
            writeFileAtomic(cfgFile, YAML.stringify(existing))
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: true, message: '备注已保存' }))
          } catch (e: any) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, message: e.message }))
          }
        })
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
          res.end(JSON.stringify({ ok: true, cookie: !!cookie, proxy: getProxy() || '', results }))
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: '诊断失败: ' + e.message }))
        }
        return
      }

      // 代理配置：读取当前值
      if (req.method === 'GET' && routePath === '/api/proxy') {
        const cfgFile = process.env.CONFIG_FILE || 'config.yaml'
        const existing = fs.existsSync(cfgFile) ? YAML.parse(fs.readFileSync(cfgFile, 'utf-8')) || {} : {}
        const pv = String(existing.proxy || '')
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: true, proxy: pv, enabled: !!pv }))
        return
      }

      // 代理配置：保存（写 config.yaml + 运行时立即生效，无需重启）
      if (req.method === 'POST' && routePath === '/api/proxy') {
        try {
          const body = JSON.parse(await this.readBody(req))
          const pv = String(body.proxy || '').trim()
          const cfgFile = process.env.CONFIG_FILE || 'config.yaml'
          const existing = fs.existsSync(cfgFile) ? YAML.parse(fs.readFileSync(cfgFile, 'utf-8')) || {} : {}
          existing.proxy = pv
          writeFileAtomic(cfgFile, YAML.stringify(existing))
          setProxy(pv)
          logger.info('代理配置已保存并立即生效: ' + (pv || '(直连)'))
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, message: pv ? '代理已保存并立即生效' : '已切换为直连（不使用代理）' }))
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: '保存失败: ' + e.message }))
        }
        return
      }

      // 代理配置：测试连通性（不改变当前代理设置）
      if (req.method === 'POST' && routePath === '/api/proxy/test') {
        try {
          const body = JSON.parse(await this.readBody(req))
          const raw = String(body.proxy || '').trim()
          let proxyCfg: any = false
          if (raw) {
            const u = new URL(raw.includes('://') ? raw : 'http://' + raw)
            proxyCfg = { protocol: u.protocol.replace(':', ''), host: u.hostname, port: u.port ? Number(u.port) : 80 }
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

      // 监听课程设置（勾选要监控的课程 → 写 config.yaml → 重启生效）
      if (req.method === 'POST' && routePath === '/api/watch') {
        try {
          const body = JSON.parse(await this.readBody(req))
          const watchCourses: string[] = Array.isArray(body.watchCourses)
            ? body.watchCourses.map((c: any) => String(c)).filter(Boolean)
            : []
          const cfgFile = process.env.CONFIG_FILE || 'config.yaml'
          const existing = fs.existsSync(cfgFile)
            ? YAML.parse(fs.readFileSync(cfgFile, 'utf-8')) || {}
            : {}
          existing.watchCourses = watchCourses
          writeFileAtomic(cfgFile, YAML.stringify(existing))
          logger.info(`监听课程设置已保存（${watchCourses.length} 门），重启后生效`)
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, message: watchCourses.length ? `已保存，将只监听 ${watchCourses.length} 门课程，重启后生效` : '已保存，将监听全部课程，重启后生效' }))
        } catch (e: any) {
          logger.error(`保存监听课程失败: ${e.message}`)
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: `保存失败: ${e.message}` }))
        }
        return
      }

      // 控制台首页（软件主界面）
      if (req.method === 'GET' && (routePath === '/' || routePath === '/console')) {
        const scriptNonce = crypto.randomBytes(18).toString('base64url')
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
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

          // 处理图片消息（rich text 中的图片 或 直接发图）
          if (data.msgtype === 'richText' && data.richText?.richText) {
            for (const item of data.richText.richText) {
              if (item.pictureDownloadCode) {
                await this.handleImageCode(item.pictureDownloadCode)
              }
            }
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
            await this.imageHandler(buffer)
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
   *       → downloadUrl → 下载为 Buffer → imageHandler
   *
   * 说明：robotCode 在多数企业内部机器人场景下等于 appKey；若下载失败，
   * 钉钉会返回具体错误，此时请改用 /upload 页面直接上传图片。
   */
  private async handleImageCode(downloadCode: string) {
    if (!this.appKey || !this.appSecret) {
      logger.warn('未配置 appKey/appSecret，无法从钉钉下载图片，请改用 /upload 页面上传')
      return
    }

    try {
      logger.info(`收到钉钉图片: ${downloadCode}`)

      const tokenResp = await axios.get('https://oapi.dingtalk.com/gettoken', {
        params: { appkey: this.appKey, appsecret: this.appSecret },
        proxy: getProxyConfig(),
      })
      const accessToken: string = tokenResp.data?.access_token
      if (!accessToken) throw new Error('获取钉钉 access_token 失败: ' + JSON.stringify(tokenResp.data))

      const dl = await axios.post(
        'https://oapi.dingtalk.com/robot/messageFiles/download',
        { downloadCode, robotCode: this.appKey },
        {
          headers: { 'x-acs-dingtalk-access-token': accessToken },
          proxy: getProxyConfig(),
        },
      )
      const downloadUrl: string | undefined = dl.data?.downloadUrl
      if (!downloadUrl) throw new Error('钉钉未返回图片下载地址: ' + JSON.stringify(dl.data))

      const imgResp = await axios.get(downloadUrl, { responseType: 'arraybuffer', proxy: getProxyConfig() })
      const buffer = Buffer.from(imgResp.data)

      if (this.imageHandler) await this.imageHandler(buffer)
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
          reject(new Error('请求体超过 1MB 限制'))
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(chunks.join('')))
      req.on('error', reject)
    })
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
   */
  private getUploadPage(_type: 'qr' = 'qr', scriptNonce = ''): string {
    const token = this.token || ''
    const title = '学习通签到 - 二维码上传'
    const tip = '拍一张教室里的签到二维码，点击上传（软件会自动识别并完成签到）'
    const placeholder = '📷 点击拍照或选择图片'
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei UI",sans-serif;background:radial-gradient(circle at 84% -6%,rgba(242,123,52,.12),transparent 24rem),#f6f5f1;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;color:#191712}
.card{background:rgba(255,255,255,.9);border:1px solid #e7e4de;border-radius:20px;padding:30px;width:100%;max-width:410px;box-shadow:0 18px 44px rgba(28,25,21,.09);backdrop-filter:blur(18px)}
h1{font-size:20px;text-align:center;margin-bottom:8px;color:#1d1a16;letter-spacing:-.02em}
p{font-size:14px;color:#635b52;text-align:center;margin-bottom:24px;line-height:1.55}
.upload-area{border:2px dashed #FCBB8B;border-radius:14px;padding:42px 20px;text-align:center;cursor:pointer;transition:border-color .18s,background .18s,transform .18s;background:#FFF8F2}
.upload-area:hover,.upload-area.drag{border-color:#F27B34;background:#FFEEDD;transform:scale(1.01)}
.upload-area img{max-width:100%;max-height:200px;border-radius:10px;margin-top:12px}
.btn{display:block;width:100%;padding:14px;background:linear-gradient(180deg,#F98A44,#E56920);color:#fff;border:none;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer;margin-top:20px;box-shadow:0 1px 2px rgba(150,66,14,.2),0 8px 20px rgba(229,105,32,.22);transition:filter .18s,transform .12s}
.btn:hover:not(:disabled){filter:brightness(.97)}
.btn:active{transform:scale(.99)}
.btn:disabled{background:#d9d5cd;color:#8d857c;cursor:not-allowed;box-shadow:none}
.status{text-align:center;margin-top:16px;font-size:14px;padding:10px;border-radius:10px;font-weight:600}
.status.ok{background:#e5f4ec;color:#16855a}
.status.err{background:#fcecec;color:#d24343}
.status.loading{background:#fff0e4;color:#b95a18}
input[type=file]{display:none}
</style>
</head>
<body>
<div class="card">
  <h1>${title}</h1>
  <p>${tip}</p>
  <div class="upload-area" id="dropZone">
    <div id="placeholder">${placeholder}</div>
    <img id="preview" style="display:none">
  </div>
  <input type="file" id="fileInput" accept="image/*" capture="environment">
  <button class="btn" id="submitBtn" disabled>上传并签到</button>
  <div id="status"></div>
</div>
<script${scriptNonce ? ` nonce="${scriptNonce}"` : ''}>
const UPLOAD_TOKEN = ${JSON.stringify(token)}
const UPLOAD_TYPE = 'qr'
const fileInput=document.getElementById('fileInput')
const preview=document.getElementById('preview')
const placeholder=document.getElementById('placeholder')
const submitBtn=document.getElementById('submitBtn')
const dropZone=document.getElementById('dropZone')
const status=document.getElementById('status')
let selectedFile=null

dropZone.addEventListener('click',()=>fileInput.click())
submitBtn.addEventListener('click',upload)

fileInput.addEventListener('change',e=>{
  const file=e.target.files[0]
  if(!file)return
  selectedFile=file
  const reader=new FileReader()
  reader.onload=ev=>{preview.src=ev.target.result;preview.style.display='block';placeholder.style.display='none'}
  reader.readAsDataURL(file)
  submitBtn.disabled=false
  status.textContent=''
})

dropZone.addEventListener('dragover',e=>{e.preventDefault();dropZone.classList.add('drag')})
dropZone.addEventListener('dragleave',()=>dropZone.classList.remove('drag'))
dropZone.addEventListener('drop',e=>{e.preventDefault();dropZone.classList.remove('drag');const file=e.dataTransfer.files[0];if(file){const dt=new DataTransfer();dt.items.add(file);fileInput.files=dt.files;fileInput.dispatchEvent(new Event('change'))}})

async function upload(){
  if(!selectedFile)return
  submitBtn.disabled=true
  status.className='status loading'
  status.textContent='正在上传识别中...'
  try{
    const qs = UPLOAD_TOKEN ? ('?token=' + encodeURIComponent(UPLOAD_TOKEN)) : ''
    const resp=await fetch('/upload/image?type=' + encodeURIComponent(UPLOAD_TYPE) + qs,{method:'POST',body:selectedFile,headers:{'Content-Type':selectedFile.type}})
    const data=await resp.json()
    if(data.success){status.className='status ok';status.textContent='✅ '+data.message}
    else{status.className='status err';status.textContent='❌ '+(data.error||'未知错误')}
  }catch(e){status.className='status err';status.textContent='❌ 网络错误: '+e.message}
  submitBtn.disabled=false
}
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
