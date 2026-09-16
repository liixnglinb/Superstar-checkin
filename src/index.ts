import { logger } from './utils/logger'
import { loadConfig } from './providers/config'
import { initStorage } from './providers/storage'
import { AccountManager } from './providers/account-manager'
import { ImListener } from './listeners/im-listener'
import { PollListener } from './listeners/poll-listener'
import { CheckinHandler } from './handlers/checkin-handler'
import { NotificationManager } from './notifiers'
import { CheckinEngine } from './core/checkin-engine'
import { getCourseList, type CourseInfo } from './core/course'
import { initLocationStore } from './utils/location'
import { DingTalkServer } from './server/dingtalk-server'
import { decodeQrFromBuffer } from './utils/qr-decoder'
import { setProxy } from './providers/runtime-config'
import {
  markProcessed,
  unmarkProcessed,
  recordFail,
  clearFail,
  shouldRetryFail,
  setPendingQr,
  initSignState,
  takeLatestPendingQr,
  hasPendingQr,
  setPendingPhoto,
  takeLatestPendingPhoto,
  hasPendingPhoto,
} from './providers/sign-state'
import type { ImMessage, CheckinInfo } from './types'
import { DEFAULTS } from './constants'
import YAML from 'yaml'
import axios from 'axios'
import { encryptPassword, isEncrypted } from './utils/crypto'
import * as storage from './providers/storage'

import * as readline from 'readline'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { writeFileAtomic } from './utils/fs'

// 全局错误兜底
process.on('unhandledRejection', (reason) => logger.error('未处理的 Promise 拒绝:', reason))
// uncaughtException 后进程状态不确定，记录后退出 1（Node 官方推荐）
process.on('uncaughtException', (err) => {
  logger.error('未捕获的异常，进程将退出:', err)
  process.exit(1)
})

/** 全部账号签到失败时：撤销标记允许重试（带次数上限），避免一次性漏签 */
function allowRetryOnFailure(aid: string) {
  const n = recordFail(aid)
  if (shouldRetryFail(aid)) {
    logger.warn(`aid ${aid} 签到失败（第 ${n} 次），将允许下一轮重试`)
    unmarkProcessed(aid)
  } else {
    logger.error(`aid ${aid} 连续 ${n} 次失败，放弃重试`)
  }
}

function openBrowser(url: string) {
  const cp = require('child_process')
  const cmd =
    process.platform === 'win32'
      ? `cmd /c start "" "${url}"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`
  cp.exec(cmd, (err: any) => { if (err) logger.warn(`自动打开浏览器失败: ${err.message}`) })
}

async function main() {
  // 1. 加载配置
  logger.info('=== ChaoXing Auto Sign v3.1 ===')
  const config = loadConfig()

  // 2. 初始化
  logger.configure(config.log.level, config.log.file)
  /** 保存配置到 config.yaml（密码自动 DPAPI 加密） */
  function saveConfig(cfg: any) {
    try {
      const toSave = JSON.parse(JSON.stringify(cfg))
      for (const acc of toSave.accounts || []) {
        if (acc.password && !isEncrypted(acc.password)) {
          acc.password = encryptPassword(acc.password)
        }
      }
      writeFileAtomic(process.env.CONFIG_FILE || 'config.yaml', YAML.stringify(toSave))
      logger.info('配置已保存到 config.yaml')
    } catch (e: any) {
      logger.error('保存配置失败: ' + e.message)
    }
  }

  if (!config.web?.token) {
    config.web = {
      ...config.web,
      port: config.web?.port || 3456,
      token: crypto.randomBytes(24).toString('base64url'),
    }
    saveConfig(config)
    logger.info('已生成本地控制台访问 token，外部访问需携带该 token')
  }

  initStorage(config.storage.dataDir)
  initSignState(config.storage.dataDir)
  initLocationStore(config.storage.dataDir)
  const photoDir = path.join(config.storage.dataDir, 'photos')
  fs.mkdirSync(photoDir, { recursive: true })
  const savePhotoBuffer = (buffer: Buffer) => {
    const photoPath = path.join(photoDir, `upload_${Date.now()}.jpg`)
    fs.writeFileSync(photoPath, buffer)
    return photoPath
  }
  setProxy(config.proxy) // 代理全局生效（登录/签到请求均可走）

  // 控制台状态数据提供者（每次请求实时计算；闭包引用后续初始化的模块）
  // 注意：上传页服务先于业务模块启动，早期请求可能命中 TDZ，故全部包 try/catch
  // 版本号从 package.json 动态读取——此前这里硬编码为 '3.1'，
  // 导致控制台侧边栏一直显示旧版本（实际已迭代到 3.4.x）。
  // 编译产物位于 build/，require('../package.json') 指向项目根，打包进 asar 后同样成立。
  let appVersion = ''
  try {
    appVersion = String(require('../package.json').version || '')
  } catch {
    appVersion = ''
  }

  const getConsoleStatus = () => {
    const base: any = {
      version: appVersion,
      mode: config.listener.mode,
      pollInterval: config.listener.pollInterval,
      port: config.web?.port || 3456,
      uptime: process.uptime(),
    }
    try {
      const history = checkinHandler.getHistory()
      const okRe = /成功|✅|已签到/
      const successCount = history.filter((r: any) => okRe.test(r.message || r.result)).length
      // 课程签到统计（每门课成功/失败次数，供课程页展示）
      const statsMap = new Map<string, { success: number; fail: number }>()
      for (const r of history as any[]) {
        const k = r.courseName || '未知课程'
        const e = statsMap.get(k) || { success: 0, fail: 0 }
        if (okRe.test((r as any).message || (r as any).result)) e.success++
        else e.fail++
        statsMap.set(k, e)
      }
      const courseStats = Array.from(statsMap.entries()).map(([course, s]) => ({
        course,
        success: s.success,
        fail: s.fail,
      }))
      // 多账号独立统计（每个账号的成功/失败/最近签到时间）
      const acctStatsMap = new Map<string, { username: string; name: string; success: number; fail: number; lastTime: number }>()
      for (const r of history as any[]) {
        const uname = r.account || r.accountName || '未知账号'
        const e = acctStatsMap.get(uname) || { username: uname, name: uname, success: 0, fail: 0, lastTime: 0 }
        if (okRe.test(r.message || r.result)) e.success++
        else e.fail++
        if ((r.timestamp || 0) > e.lastTime) e.lastTime = r.timestamp || 0
        acctStatsMap.set(uname, e)
      }
      const accountStats = Array.from(acctStatsMap.values())
      // 签到趋势（近 14 天逐日成功/失败，供总览页图表）
      const trend: Array<{ date: string; success: number; fail: number }> = []
      const dayMap = new Map<string, { success: number; fail: number }>()
      for (const r of history as any[]) {
        const ts = r.timestamp || 0
        if (!ts) continue
        const d = new Date(ts)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        const e = dayMap.get(key) || { success: 0, fail: 0 }
        if (okRe.test(r.result)) e.success++
        else e.fail++
        dayMap.set(key, e)
      }
      for (let i = 13; i >= 0; i--) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        const e = dayMap.get(key) || { success: 0, fail: 0 }
        trend.push({ date: key.slice(5), success: e.success, fail: e.fail })
      }
      // 补全前端需要展示的字段（result/timestamp/accountName）
      const recent = history.slice(0, 10).map((r: any) => ({
        time: r.time || '',
        courseName: r.courseName || '',
        type: r.type || '',
        result: r.message || r.result || '',
        accountName: r.accountName || r.account || '',
        timestamp: r.timestamp || Date.now(),
      }))
      // 今日签到统计（托盘菜单/日报用）：按当天 0 点起算
      const dayStart = new Date()
      dayStart.setHours(0, 0, 0, 0)
      const dayStartTs = dayStart.getTime()
      const todayRecords = history.filter((r: any) => (r.timestamp || 0) >= dayStartTs)
      const todaySuccess = todayRecords.filter((r: any) => okRe.test(r.message || r.result)).length
      const todayStats = { total: todayRecords.length, success: todaySuccess, fail: todayRecords.length - todaySuccess }
      return {
        ...base,
        accounts: config.accounts.map((a: any) => {
          const meta = accountManager.getMeta(a.username)
          return { username: a.username, name: meta?.name || '', schoolname: meta?.schoolname || '' }
        }),
        courses,
        watchCourses: config.watchCourses || [],
        courseHealth: Object.fromEntries(courseHealth),
        courseStats,
        accountStats,
        trend,
        preCheck: config.preCheck,
        smartPoll: config.smartPoll,
        humanDelay: config.checkin?.humanDelay,
        confirmBefore: config.checkin?.confirmBefore,
        recent,
        recordCount: history.length,
        successCount,
        failCount: history.length - successCount,
        todayStats,
        cookieValid: !!primaryMeta.cookie,
        imConnected: watchdog.imConnected,
        qrPending: hasPendingQr(),
        notifyDesktop: config.notify.desktop !== false,
        quiet: config.notify.quiet,
        pollJitter: config.listener.pollJitter || 0,
        locationRadius: config.geo.locationRadius || 10,
        retryMaxAttempts: config.checkin.retry.maxAttempts,
        retryDelayMs: config.checkin.retry.delayMs,
        verifyEnabled: config.checkin.verify?.enabled !== false,
        report: config.report,
      }
    } catch (e) {
      // 业务模块尚未初始化完成（服务刚启动被立即访问），返回基础信息
      return base
    }
  }

  // 重新拉取课程列表：小课程/新课程未出现时手动刷新，并重建轮询监听
  async function refreshCourses(): Promise<{ ok: boolean; count: number; message: string }> {
    if (!config.accounts.length || !primaryMeta.cookie) {
      return { ok: false, count: 0, message: '未配置账号，无法刷新课程列表' }
    }
    try {
      const freshResults = await Promise.allSettled(
        configuredMetas.filter(meta => meta.cookie).map(meta => getCourseList(meta.cookie)),
      )
      const refreshMap = new Map<string, CourseInfo>()
      for (const result of freshResults) {
        if (result.status !== 'fulfilled') {
          logger.warn(`刷新账号课程失败: ${result.reason?.message || result.reason}`)
          continue
        }
        for (const course of result.value) refreshMap.set(`${course.courseId}:${course.classId}`, course)
      }
      const fresh = Array.from(refreshMap.values())
      courses = fresh
      // 结课自动停用：已退休课程从监听列表移除，避免无效轮询和误报
      const retiredIds = fresh.filter(c => c.isRetired).map(c => String(c.courseId))
      if (retiredIds.length > 0 && config.watchCourses && config.watchCourses.length > 0) {
        const before = config.watchCourses.length
        config.watchCourses = config.watchCourses.filter(id => !retiredIds.includes(String(id)))
        if (config.watchCourses.length < before) {
          logger.info('结课自动停用：已移除 ' + (before - config.watchCourses.length) + ' 门已结课课程的监听')
          saveConfig(config)
        }
      }
      applyWatchFilter()
      for (const listener of pollListeners) listener.stop()
      pollListeners.length = 0
      if (config.listener.mode === 'poll' || config.listener.mode === 'hybrid') {
        for (const meta of configuredMetas.filter(item => item.cookie)) {
          const pl = new PollListener(config.listener.pollInterval, (config.listener.pollJitter || 0) * 1000)
          pl.onActivity((aid, courseId, classId, courseName) => {
            watchdog.lastActivityAt = Date.now()
            processCheckin(aid, courseId, classId, courseName)
          })
          attachHealth(pl)
          pl.start(meta.cookie, watchedCourses)
          pollListeners.push(pl)
        }
        pollListener = pollListeners[0] || null
      }
      logger.success(`课程列表已刷新: ${fresh.length} 门，监听 ${watchedCourses.length} 门`)
      return { ok: true, count: fresh.length, message: `已刷新课程列表（${fresh.length} 门），监听 ${watchedCourses.length} 门` }
    } catch (e: any) {
      logger.error(`刷新课程列表失败: ${e.message}`)
      return { ok: false, count: 0, message: `刷新失败: ${e.message}` }
    }
  }

  // 上传页服务：独立于登录，先启动，保证 3456 随时可用（不受代理/登录成败影响）
  let dtServer: DingTalkServer | null = null
  process.env.WEB_HOST = config.web?.host || '127.0.0.1'
  const dtPort = config.web?.port || 3456
  dtServer = new DingTalkServer(dtPort, config.dingtalk?.appSecret || '', {
    appKey: config.dingtalk?.appKey || '',
    token: config.web?.token,
    allowedOrigin: config.web?.allowedOrigin,
    statusProvider: getConsoleStatus,
    historyProvider: () => checkinHandler.getHistory(),
    clearHistory: () => checkinHandler.clearHistory(),
    sendTestNotify: () =>
      notifier.notify('✅ 测试通知', '通知通道工作正常\n（免打扰时段内桌面通知不会弹出）').catch(() => {}),
    refreshCourses,
    getLogFile: () => config.log.file || '',
    getPrimaryCookie: () => primaryMeta.cookie || '',
  })
  dtServer.start()
  logger.info(`上传页服务已启动: http://${config.web?.host || '127.0.0.1'}:${dtPort}`)

  // 3. 通知管理器（先初始化，供账号刷新失败等回调引用，避免 TDZ）
  const notifier = new NotificationManager(config.notify.channels, {
    desktop: config.notify.desktop,
    quiet: config.notify.quiet,
  })

  // 4. 账号管理（无账号时以"未配置"状态启动，软件内引导填写；登录失败不致命：上传页/二维码通道仍应可用）
  const accountManager = new AccountManager(config.accounts)
  if (config.accounts.length === 0) {
    logger.warn('未配置账号：请在软件"设置"页填写学习通账号后重启（支持多用户各自登录）')
  } else {
    try {
      await accountManager.checkAll()
    } catch (e: any) {
      logger.error(`账号登录校验失败（上传页仍可用，待代理/网络恢复后重试）: ${e.message}`)
    }
  }

  // Cookie 定时自动刷新（运行中途过期也不怕）
  accountManager.onRefreshFail = (username, err) => {
    notifier.notify('⚠️ Cookie 刷新失败', `账号 ${username} 刷新失败: ${err.message}`)
      .catch(() => {})
  }
  accountManager.startAutoRefresh()

  // 5. 签到处理器
  const checkinHandler = new CheckinHandler(config, accountManager)

  // 6. 获取课程列表（courses/watchedCourses 可被「重新拉取课程列表」运行时刷新）
  const configuredMetas = config.accounts.map(a => accountManager.getMeta(a.username))
  const primaryMeta = configuredMetas.find(meta => meta.cookie) ||
    { cookie: '', name: '', schoolname: '', uid: 0, fid: 0 }
  const courseResults = await Promise.allSettled(
    configuredMetas.filter(meta => meta.cookie).map(meta => getCourseList(meta.cookie)),
  )
  const courseMap = new Map<string, CourseInfo>()
  for (const result of courseResults) {
    if (result.status !== 'fulfilled') {
      logger.error(`获取课程列表失败（不影响上传页）: ${result.reason?.message || result.reason}`)
      continue
    }
    for (const course of result.value) {
      courseMap.set(`${course.courseId}:${course.classId}`, course)
    }
  }
  let courses = Array.from(courseMap.values())

  // 按「监听课程」配置过滤：watchCourses 为空 = 监听全部；否则只监听勾选的课程
  let watchedCourses: typeof courses = []
  function applyWatchFilter() {
    const watchSet = new Set((config.watchCourses || []).map((c: any) => String(c)))
    watchedCourses = watchSet.size > 0
      ? courses.filter(c => watchSet.has(String(c.courseId)))
      : courses
    if (watchSet.size > 0) {
      logger.info(`按监听配置过滤课程: ${courses.length} 门 → 监听 ${watchedCourses.length} 门`)
    }
  }
  applyWatchFilter()

  // 看门狗状态
  const watchdog = {
    lastActivityAt: Date.now(),
    imConnected: false,
    alerted: false,
  }

  // 7. 处理签到事件的统一函数（IM 与轮询共用，内部已做全局去重）
  const processCheckin = async (
    aid: string,
    courseId: number,
    classId: number,
    courseName: string,
  ) => {
    // 跨监听器去重：IM 与轮询可能同时捕获同一次签到
    if (markProcessed(aid)) {
      logger.info(`aid ${aid} 已处理，跳过重复签到`)
      return
    }

    try {
      const detailMetas = configuredMetas.filter(meta => meta.cookie)
      let checkinInfo: CheckinInfo | null = null
      let detailError: Error | null = null
      for (const meta of detailMetas) {
        try {
          checkinInfo = await CheckinEngine.getDetail(meta.cookie, aid)
          break
        } catch (e: any) {
          detailError = e
        }
      }
      if (!checkinInfo) throw detailError || new Error('无法读取签到详情')
      logger.info(`签到类型: ${checkinInfo.type}`)

      if (checkinInfo.type === 'qr') {
        setPendingQr(aid, { courseName })
        clearFail(aid)
        logger.warn(`${courseName} 是二维码签到，等待上传图片`)

        const baseUrl = config.dingtalk?.publicUrl || `http://127.0.0.1:${config.web?.port || 3456}`
        const uploadUrl = `${baseUrl}/upload?type=qr${config.web?.token ? `&token=${encodeURIComponent(config.web.token)}` : ''}`

        await notifier.notify(
          `⚠️ ${courseName} - 二维码签到`,
          `请拍教室里的签到二维码上传\naid: ${aid}\n\n手机上传: ${uploadUrl}`,
        )
        return
      }

      if (checkinInfo.type === 'photo') {
        const configuredPhoto = String(storage.get<string>('currentPhoto') || config.photo?.path || '')
        if (configuredPhoto && fs.existsSync(configuredPhoto)) {
          logger.info(`${courseName} 是拍照签到，使用照片: ${configuredPhoto}`)
          const results = await checkinHandler.handlePhoto(aid, configuredPhoto, { courseName, courseId, classId })
          const summary = results.map(r => `${r.accountName}: ${r.success ? '✅' : '❌'} ${r.message}`).join('\n')
          await notifier.notify(`✅ ${courseName} 拍照签到结果`, summary)
          if (results.length && results.every(r => !r.success)) allowRetryOnFailure(aid)
          else clearFail(aid)
          return
        }

        setPendingPhoto(aid, { courseName, courseId, classId })
        const baseUrl = config.dingtalk?.publicUrl || `http://127.0.0.1:${config.web?.port || 3456}`
        const uploadUrl = `${baseUrl}/upload?type=photo${config.web?.token ? `&token=${encodeURIComponent(config.web.token)}` : ''}`
        await notifier.notify(
          `⚠️ ${courseName} - 拍照签到`,
          `请上传一张照片完成签到\naid: ${aid}\n\n手机上传: ${uploadUrl}`,
        )
        return
      }

      if (checkinInfo.type === 'gesture') {
        logger.warn(`${courseName} 是手势签到，请在学习通中手动完成`)
        await notifier.notify(
          `⚠️ ${courseName} - 手势签到`,
          '手势轨迹无法由本软件自动完成，请在学习通 APP 中手动签到\naid: ' + aid,
        )
        return
      }

      // 签到前确认：先弹通知倒计时，用户可取消，超时自动签
      let confirmed = true
      if (config.checkin.confirmBefore?.enabled) {
        const waitSec = Math.max(3, config.checkin.confirmBefore.waitSeconds || 10)
        const cancelUrl = (config.dingtalk?.publicUrl || `http://127.0.0.1:${config.web?.port || 3456}`) + '/api/confirm/cancel?aid=' + encodeURIComponent(aid) +
          (config.web?.token ? `&token=${encodeURIComponent(config.web.token)}` : '')
        cancelledAids.delete(aid)
        await notifier.notify(
          `⏳ ${courseName} - 即将自动签到`,
          `检测到签到活动，${waitSec} 秒后自动签到\n不想签？点击取消：${cancelUrl}`,
        ).catch(() => {})
        logger.info(`${courseName} 签到确认中：等待 ${waitSec} 秒，用户可取消`)
        await new Promise(r => setTimeout(r, waitSec * 1000))
        if (cancelledAids.has(aid)) {
          cancelledAids.delete(aid)
          logger.warn(`${courseName} 用户取消了签到`)
          await notifier.notify(`已取消签到`, `${courseName} 的签到已取消（aid: ${aid}）`).catch(() => {})
          markProcessed(aid)
          return
        }
      }

      // 模拟人类延迟：随机等待一段时间再提交，避免秒签被怀疑
      if (config.checkin.humanDelay?.enabled) {
        const min = Math.max(5, config.checkin.humanDelay.minSeconds || 30)
        const max = Math.max(min, config.checkin.humanDelay.maxSeconds || 300)
        const delay = Math.floor(Math.random() * (max - min + 1) + min)
        logger.info(`${courseName} 模拟人类延迟：等待 ${delay} 秒后签到`)
        await new Promise(r => setTimeout(r, delay * 1000))
      }

      const results = await checkinHandler.handle(aid, courseId, classId, courseName, checkinInfo)
      const summary = results.map(r => `${r.accountName}: ${r.success ? '✅' : '❌'} ${r.message}`).join('\n')
      await notifier.notify(`✅ ${courseName} 签到结果`, summary)

      // 失败重试：任一账号失败都允许下一轮重试；已成功账号重复提交通常会返回“已签到”
      const anyFailed = results.some(r => !r.success)
      if (anyFailed) allowRetryOnFailure(aid)
      else clearFail(aid)
    } catch (e: any) {
      logger.error(`处理签到失败: ${e.message}`)
      await notifier.notify('❌ 签到异常', `${courseName} aid:${aid}\n${e.message}`).catch(() => {})
      // 异常（getDetail 失败/Cookie 失效等）同样允许重试，带次数上限
      allowRetryOnFailure(aid)
    }
  }

  // 8. 启动监听器
  const cancelledAids = new Set<string>()
  let imListener: ImListener | null = null
  if (config.listener.mode === 'im' || config.listener.mode === 'hybrid') {
    imListener = new ImListener()
    imListener.onStatusChange = (connected) => {
      watchdog.imConnected = connected
      if (connected) watchdog.lastActivityAt = Date.now()
    }
    imListener.onMessage(async (message: ImMessage, cookie: string) => {
      try {
        if (!message.ext?.attachment) return
        if (message.ext.attachment.attachmentType !== 15) return

        const att = message.ext.attachment.att_chat_course
        const aid = String(att.aid)
        const courseName = att.courseInfo.coursename
        const courseId = Number(att.courseInfo.courseid)
        const classId = Number(att.courseInfo.classid)

        // 判断是否为签到
        const isCheckin = att.atype === 2 ||
          (att.atype === 0 && (
            att.pcUrl?.toLowerCase().includes('sign') ||
            att.url?.toLowerCase().includes('sign') ||
            att.logo?.toLowerCase().includes('qd3.png') ||
            att.title?.includes('签到')
          ))

        if (isCheckin) {
          logger.info(`IM 收到签到: ${courseName} (aid: ${aid})`)
          watchdog.lastActivityAt = Date.now()
          await processCheckin(aid, courseId, classId, courseName)
        } else if (att.atypeName) {
          logger.info(`IM 收到活动: ${courseName} - ${att.atypeName} (aid: ${aid})`)
        }
      } catch (e: any) {
        logger.error('处理 IM 消息异常:', e)
      }
    })

    if (config.accounts.length > 0) {
      try {
        await imListener.connect(primaryMeta.cookie, primaryMeta.uid)
      } catch (e: any) {
        logger.error(`IM 连接失败（轮询/上传页仍可用）: ${e.message}`)
      }
    }
  }

  // 轮询监听器（模块级可变：支持「重新拉取课程列表」时重建）
  // 课程扫描健康状态：courseId -> 连续失败次数（成功清零），供 UI 状态列显示"扫描异常"
  const courseHealth = new Map<string, number>()
  function attachHealth(pl: PollListener) {
    pl.onHealth((courseId, ok) => {
      if (ok) courseHealth.delete(courseId)
      else courseHealth.set(courseId, (courseHealth.get(courseId) || 0) + 1)
    })
  }

  let pollListener: PollListener | null = null
  const pollListeners: PollListener[] = []
  if (config.listener.mode === 'poll' || config.listener.mode === 'hybrid') {
    if (courses.length === 0) {
      logger.error('课程列表为空，轮询监听器将以空列表启动（无法发现任何签到），请检查登录/Cookie 是否正常')
      await notifier.notify('⚠️ 轮询监听异常', '课程列表为空，轮询无法发现签到活动，请检查登录状态')
        .catch(() => {})
    }
    for (const meta of configuredMetas.filter(item => item.cookie)) {
      const pl = new PollListener(config.listener.pollInterval, (config.listener.pollJitter || 0) * 1000)
      pl.onActivity((aid, courseId, classId, courseName) => {
        watchdog.lastActivityAt = Date.now()
        processCheckin(aid, courseId, classId, courseName)
      })
      attachHealth(pl)
      try {
        pl.start(meta.cookie, watchedCourses)
        pollListeners.push(pl)
      } catch (e: any) {
        logger.error(`轮询监听器启动失败（不影响上传页）: ${e.message}`)
      }
    }
    pollListener = pollListeners[0] || null
    if (pollListeners.length === 0) {
      logger.error('没有可用账号启动轮询监听，请检查登录状态')
      await notifier.notify('⚠️ 轮询监听异常', '没有可用账号启动轮询监听，请检查登录状态').catch(() => {})
    }
  }

  // 9. 钉钉回调服务器图片处理（服务已在启动早期创建并启动，这里仅绑定 onImage 回调）
  if (dtServer) {
    dtServer.onPhoto(async (imageBuffer: Buffer) => {
      const savedPath = savePhotoBuffer(imageBuffer)
      storage.set('currentPhoto', savedPath)
      const pending = hasPendingPhoto() ? takeLatestPendingPhoto() : null
      if (!pending) {
        logger.info(`已保存默认拍照签到照片: ${savedPath}`)
        await notifier.notify('📷 默认照片已更新', savedPath).catch(() => {})
        return
      }
      logger.info(`收到拍照签到照片，开始签到: ${pending.aid}`)
      const results = await checkinHandler.handlePhoto(pending.aid, savedPath, pending.info)
      const summary = results.map(r => `${r.accountName}: ${r.success ? '✅' : '❌'} ${r.message}`).join('\n')
      await notifier.notify('✅ 拍照签到结果', summary)
      if (results.length && results.every(r => !r.success)) allowRetryOnFailure(pending.aid)
      else clearFail(pending.aid)
    })

    dtServer.onImage(async (imageBuffer: Buffer) => {
      // 二维码签到：解析图片中的二维码（enc + aid），支持拖拽/上传任意签到码
      const payload = await decodeQrFromBuffer(imageBuffer, config.ocr)

      if (!payload) {
        logger.error('未能从图片中解析出二维码 enc 参数')
        await notifier.notify('❌ 二维码解析失败', '请确认拖入/上传的是学习通签到二维码图片')
        return
      }

      // 优先使用软件已检测到的待处理签到；否则直接使用二维码自带的 aid（二维码更新后任意拖入即可）
      const pending = hasPendingQr() ? takeLatestPendingQr() : null
      const aid = pending?.aid || payload.aid
      if (!aid) {
        logger.warn('未检测到待处理签到，且二维码未包含活动编号，无法确定签到活动')
        await notifier.notify(
          '⚠️ 无法确定签到活动',
          '当前没有检测到待处理的签到，且该二维码未包含活动编号，请等签到发布后再拖入二维码',
        )
        return
      }

      logger.info(`解析到二维码 enc（aid=${aid}），开始签到...`)
      const results = await checkinHandler.handleQr(aid, payload.enc)
      const summary = results
        .map(r => `${r.accountName}: ${r.success ? '✅' : '❌'} ${r.message}`)
        .join('\n')
      await notifier.notify('✅ 二维码签到结果', summary)
      const allFailed = results.length > 0 && results.every(r => !r.success)
      if (allFailed) allowRetryOnFailure(aid)
      else clearFail(aid)
    })
  }

  // 9.5 看门狗：检测「漏签风险」并告警
  // - IM 模式但连接已断开（且没有开 poll 兜底）
  // - 长时间未收到任何活动（可能进程假死 / 网络中断）
  const WATCHDOG_INTERVAL = 5 * 60 * 1000
  const ACTIVITY_TIMEOUT = 30 * 60 * 1000
  setInterval(() => {
    const now = Date.now()
    const imDown = config.listener.mode === 'im' && !watchdog.imConnected
    const stale = now - watchdog.lastActivityAt > ACTIVITY_TIMEOUT

    if ((imDown || stale) && !watchdog.alerted) {
      const reasons: string[] = []
      if (imDown) reasons.push('IM 连接已断开且未开启轮询兜底')
      if (stale) reasons.push(`已超过 ${ACTIVITY_TIMEOUT / 60000} 分钟无活动`)
      const reason = reasons.join('；')
      logger.error(`看门狗告警: ${reason}`)
      notifier.notify('🚨 签到看门狗告警', `${reason}\n请检查服务是否正常运行，避免漏签。`)
        .catch(() => {})
      watchdog.alerted = true
    } else if (!imDown && !stale) {
      watchdog.alerted = false // 恢复正常后允许下次再告警
    }
  }, WATCHDOG_INTERVAL)

  // 9.55 每日签到日报：每天固定时间推送当日签到总结（桌面通知 + 已配置的外部通道）
  async function sendDailyReport() {
    try {
      const history = checkinHandler.getHistory()
      const dayStart = new Date()
      dayStart.setHours(0, 0, 0, 0)
      const okRe2 = /成功|✅|已签到/
      const today = history.filter((r: any) => (r.timestamp || 0) >= dayStart.getTime())
      const okCount = today.filter((r: any) => okRe2.test(r.message || r.result)).length
      const failList = today.filter((r: any) => !okRe2.test(r.message || r.result)).slice(0, 10)
      if (today.length === 0) {
        logger.info('日报：今天还没有签到记录')
        await notifier.notify('📊 今日签到日报', `今天（${dayStart.getMonth() + 1}月${dayStart.getDate()}日）还没有签到记录\n一切正常时表示今天无签到活动`)
        return
      }
      let content = `今日共处理 ${today.length} 次签到，成功 ${okCount} 次`
      if (failList.length > 0) {
        content += `，失败 ${failList.length} 次\n\n未成功签到：\n`
        content += failList.map((r: any) => `· ${r.courseName || '未知课程'} (${r.type || '普通'})`).join('\n')
      } else {
        content += '，全部成功 🎉'
      }
      // 漏签预警：监听中的课程最近 3 天零签到
      try {
        const threeDaysAgo = new Date()
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
        threeDaysAgo.setHours(0, 0, 0, 0)
        const recentNames = new Set(
          history.filter((r: any) => (r.timestamp || 0) >= threeDaysAgo.getTime()).map((r: any) => r.courseName)
        )
        const watchedNames = new Set(watchedCourses.map(c => c.courseName))
        const missed = Array.from(watchedNames).filter(n => !recentNames.has(n))
        if (missed.length > 0) {
          content += '\n\n⚠️ 漏签预警（近3天监听但零签到）：\n' + missed.slice(0, 8).map(n => '· ' + n).join('\n')
          if (missed.length > 8) content += '\n· 等共 ' + missed.length + ' 门'
        }
      } catch (e: any) { logger.warn('漏签预警计算失败: ' + e.message) }
      await notifier.notify('📊 今日签到日报', content)
      logger.success('今日签到日报已推送')
    } catch (e: any) {
      logger.error(`日报发送失败: ${e.message}`)
    }
  }

  // 9.55b 每周签到周报：每周日推送本周签到统计（成功率 + 漏签课程名单）
  async function sendWeeklyReport() {
    try {
      const history = checkinHandler.getHistory()
      const now = new Date()
      // 本周一 0 点
      const weekStart = new Date(now)
      const dow = (now.getDay() + 6) % 7 // 周一=0
      weekStart.setDate(now.getDate() - dow)
      weekStart.setHours(0, 0, 0, 0)
      const okRe2 = /成功|✅|已签到/
      const week = history.filter((r: any) => (r.timestamp || 0) >= weekStart.getTime())
      if (week.length === 0) {
        logger.info('周报：本周还没有签到记录')
        await notifier.notify('📈 本周签到周报', `本周（${weekStart.getMonth() + 1}月${weekStart.getDate()}日起）还没有签到记录\n一切正常时表示本周暂无签到活动`)
        return
      }
      const okCount = week.filter((r: any) => okRe2.test(r.result)).length
      // 本周有签到记录的课程里，按课程统计
      const perCourse = new Map<string, { ok: number; fail: number }>()
      for (const r of week as any[]) {
        const k = r.courseName || '未知课程'
        const e = perCourse.get(k) || { ok: 0, fail: 0 }
        if (okRe2.test(r.result)) e.ok++
        else e.fail++
        perCourse.set(k, e)
      }
      const rate = Math.round((okCount / week.length) * 100)
      let content = `本周共处理 ${week.length} 次签到，成功 ${okCount} 次（${rate}%）`
      const missCourses = Array.from(perCourse.entries())
        .filter(([, e]) => e.fail > 0)
        .map(([name, e]) => `· ${name}（失败 ${e.fail} 次）`)
      if (missCourses.length > 0) {
        content += `\n\n需要留意：\n${missCourses.slice(0, 8).join('\n')}`
      } else {
        content += '\n全部成功 🎉'
      }
      await notifier.notify('📈 本周签到周报', content)
      logger.success('本周签到周报已推送')
    } catch (e: any) {
      logger.error(`周报发送失败: ${e.message}`)
    }
  }

  function scheduleWeeklyReport() {
    const now = new Date()
    const hour = Math.max(0, Math.min(23, config.report?.hour ?? DEFAULTS.REPORT_HOUR))
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0)
    // 下一个周日（getDay()===0）的 hour 点
    const daysToSunday = (7 - now.getDay()) % 7
    next.setDate(next.getDate() + daysToSunday)
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 7)
    const delay = next.getTime() - now.getTime()
    setTimeout(() => {
      if (config.report?.weekly !== false) {
        sendWeeklyReport().catch(() => {})
      }
      scheduleWeeklyReport()
    }, delay)
    logger.info(`每周签到周报已启用（每周日 ${hour}:00 推送，当前${config.report?.weekly === false ? '关闭' : '开启'}）`)
  }
  if (config.report?.weekly !== false) scheduleWeeklyReport()

  function scheduleDailyReport() {
    const now = new Date()
    const hour = Math.max(0, Math.min(23, config.report?.hour ?? DEFAULTS.REPORT_HOUR))
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0)
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
    const delay = next.getTime() - now.getTime()
    setTimeout(() => {
      if (config.report?.enabled !== false) {
        sendDailyReport().catch(() => {})
      }
      scheduleDailyReport()
    }, delay)
    logger.info(`每日签到日报已启用（每天 ${hour}:00 推送，当前${config.report?.enabled === false ? '关闭' : '开启'}）`)
  }
  if (config.report?.enabled !== false) scheduleDailyReport()

  // 9.5.1 每日课前预检查：检查 Cookie 有效性和网络连通性
  async function runPreCheck() {
    try {
      const problems: string[] = []
      try { await accountManager.checkAll() } catch (e: any) { problems.push('账号登录校验失败: ' + e.message) }
      try {
        const r = await axios.get('https://passport2-api.chaoxing.com/', { timeout: 8000, validateStatus: () => true })
        if (r.status >= 500) problems.push('学习通服务异常 (HTTP ' + r.status + ')')
      } catch (e: any) { problems.push('无法连接学习通: ' + e.message) }
      if (problems.length > 0) {
        notifier.notify('⚠️ 课前预检查发现问题', problems.join('\n') + '\n\n请在上课前检查账号和网络，避免漏签。').catch(() => {})
        logger.warn('课前预检查发现问题: ' + problems.join('; '))
      } else {
        logger.info('课前预检查通过：所有账号正常，网络连通')
      }
    } catch (e: any) { logger.error('课前预检查异常: ' + e.message) }
  }
  function schedulePreCheck() {
    const now = new Date()
    const hour = Math.max(0, Math.min(23, config.preCheck?.hour ?? 7))
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0)
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
    setTimeout(() => { runPreCheck().catch(() => {}); schedulePreCheck() }, next.getTime() - now.getTime())
    logger.info('每日课前预检查已启用（每天 ' + hour + ':00 检查账号和网络）')
  }
  if (config.preCheck?.enabled !== false) schedulePreCheck()

  // 9.5.2 智能轮询：白天短间隔，夜间长间隔，每小时检查一次
  function applySmartPoll() {
    if (config.smartPoll?.enabled === false || pollListeners.length === 0) return
    const now = new Date()
    const h = now.getHours()
    const dayStart = config.smartPoll?.dayStart ?? 8
    const dayEnd = config.smartPoll?.dayEnd ?? 22
    const mult = config.smartPoll?.nightMultiplier ?? 3
    const isDay = h >= dayStart && h < dayEnd
    const baseInterval = config.listener.pollInterval
    for (const listener of pollListeners) {
      listener.setInterval(isDay ? baseInterval : baseInterval * mult)
    }
  }
  function scheduleSmartPoll() {
    applySmartPoll()
    setInterval(applySmartPoll, 60 * 60 * 1000)
    logger.info('智能轮询已启用（白天 ' + (config.smartPoll?.dayStart ?? 8) + ':00-' + (config.smartPoll?.dayEnd ?? 22) + ':00 短间隔，夜间 ' + (config.smartPoll?.nightMultiplier ?? 3) + ' 倍间隔）')
  }
  if (config.smartPoll?.enabled !== false) scheduleSmartPoll()

  // 9.6 自动打开控制台（GUI 打包环境通过 NO_OPEN_BROWSER 禁用）
  if (config.web?.openBrowser !== false && !process.env.NO_OPEN_BROWSER) {
    const servicePort = config.web?.port || 3456
    const tokenQuery = config.web?.token ? `?token=${encodeURIComponent(config.web.token)}` : ''
    openBrowser(`http://127.0.0.1:${servicePort}/${tokenQuery}`)
  }

  logger.success('系统初始化完毕')
  logger.info('')
  logger.info('手动签到: 输入 签到 <aid> [enc|courseId]')
  logger.info('查看历史: 输入 历史')
  logger.info('查看课程: 输入 课程')
  logger.info('')

  // 10. 终端交互
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  rl.on('line', async (line) => {
    const parts = line.trim().split(/\s+/)
    const cmd = parts[0]

    switch (cmd) {
      case '签到':
      case 'sign':
      case 'checkin': {
        const aid = parts[1]
        if (!aid) { logger.info('用法: 签到 <aid> [enc|courseId]'); return }
        const checkinInfo = await CheckinEngine.getDetail(primaryMeta.cookie, aid)
        if (checkinInfo.type === 'qr' && parts[2]) {
          const results = await checkinHandler.handleQr(aid, parts[2])
          results.forEach(r => logger.info(`${r.accountName}: ${r.message}`))
        } else {
          const courseId = parts[2] ? Number(parts[2]) : 0
          await processCheckin(aid, courseId, 0, '手动签到')
        }
        break
      }

      case '历史':
      case 'history': {
        const history = checkinHandler.getHistory()
        if (history.length === 0) { logger.info('暂无签到记录'); break }
        for (const r of history.slice(0, 10)) {
          logger.info(`${r.courseName || '未知'} | ${r.type} | ${r.success ? '✅' : '❌'} ${r.accountName}`)
        }
        break
      }

      case '课程':
      case 'courses': {
        for (const c of courses) {
          logger.info(`${c.courseName} | ID: ${c.courseId} | Class: ${c.classId}`)
        }
        break
      }

      default:
        if (cmd) logger.info('可用命令: 签到, 历史, 课程')
    }
  })

  // 11. 二维码文件夹监听（把签到二维码图片放进 qrcode 目录即可自动识别签到）
  const qrDir = path.join(process.cwd(), 'qrcode')
  if (!fs.existsSync(qrDir)) fs.mkdirSync(qrDir, { recursive: true })

  const watched = new Set<string>()
  fs.watch(qrDir, async (_event, filename) => {
    if (!filename) return
    // 安全校验：只取文件名部分，防止路径穿越（如 ../evil.png 跳出 qrcode 目录）
    const safeName = path.basename(filename)
    if (!/\.(png|jpg|jpeg|bmp)$/i.test(safeName)) return
    const filePath = path.join(qrDir, safeName)
    if (watched.has(filePath)) return
    watched.add(filePath)
    if (watched.size > 100) watched.clear()

    await new Promise(r => setTimeout(r, 500))
    if (!fs.existsSync(filePath)) return

    try {
      logger.info(`检测到图片: ${filename}`)
      const buffer = fs.readFileSync(filePath)

      // 二维码签到：解析图片中的二维码（enc + aid）
      const payload = await decodeQrFromBuffer(buffer, config.ocr)
      if (!payload) {
        logger.error('未能从文件夹图片中解析出二维码 enc 参数')
        return
      }
      const pending = hasPendingQr() ? takeLatestPendingQr() : null
      const aid = pending?.aid || payload.aid
      if (!aid) {
        logger.warn('未检测到待处理签到，且二维码未包含活动编号，无法确定签到活动')
        return
      }
      logger.info(`解析到二维码 enc（aid=${aid}），开始签到...`)
      const results = await checkinHandler.handleQr(aid, payload.enc)
      const summary = results.map(r => `${r.accountName}: ${r.success ? '✅' : '❌'} ${r.message}`).join('\n')
      await notifier.notify('✅ 二维码签到结果', summary)
      const allFailed = results.length > 0 && results.every(r => !r.success)
      if (allFailed) allowRetryOnFailure(aid)
      else clearFail(aid)
    } catch (e: any) {
      logger.error(`图片处理失败: ${e.message}`)
    }
  })
}

main().catch(e => {
  logger.error('启动失败:', e)
  process.exit(1)
})
