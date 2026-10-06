import * as fs from 'fs'
import * as path from 'path'
import YAML from 'yaml'
import { writeFileAtomic } from '../utils/fs'
import type { AppConfig } from '../types'
import { DEFAULTS } from '../constants'
import { logger } from '../utils/logger'
import { decryptPassword, encryptPassword, isEncrypted } from '../utils/crypto'
import { asTimeString } from '../utils/validate'

/**
 * 打包为独立 exe 时，由 build-sea.js 通过 esbuild define 注入当前 config.yaml 的 base64。
 * 源码直接运行时该变量不存在（undefined），走内置默认配置。
 * 作用：用户拿到单个 exe 后首次双击，无需手动准备配置文件即可开箱即用。
 */
declare const __EMBEDDED_CONFIG_B64__: string | undefined

const DEFAULT_CONFIG: Partial<AppConfig> = {
  accounts: [],
  watchCourses: [],
  listener: {
    mode: 'hybrid',
    pollInterval: DEFAULTS.POLL_INTERVAL,
    pollJitter: DEFAULTS.POLL_JITTER,
  },
  checkin: {
    delay: { min: DEFAULTS.CHECKIN_DELAY_MIN, max: DEFAULTS.CHECKIN_DELAY_MAX },
    retry: { maxAttempts: DEFAULTS.RETRY_MAX, delayMs: DEFAULTS.RETRY_DELAY },
    antiDetect: {
      enabled: true,
      randomDelay: true,
      useragentRotation: false,
      gpsDrift: true,
    },
    verify: { enabled: DEFAULTS.VERIFY_ENABLED },
    humanDelay: { enabled: false, minSeconds: 30, maxSeconds: 300 },
    confirmBefore: { enabled: false, waitSeconds: 10 },
  },
  geo: {
    locations: [],
    providers: {},
    locationRadius: DEFAULTS.GEO_RADIUS,
  },
  notify: {
    channels: [],
    desktop: true,
    quiet: { enabled: false, start: '23:00', end: '07:00' },
  },
  report: { enabled: true, hour: DEFAULTS.REPORT_HOUR, weekly: true },
  courseNotes: {},
  preCheck: { enabled: true, hour: 7 },
  smartPoll: { enabled: true, dayStart: 8, dayEnd: 22, nightMultiplier: 3 },
  web: {
    port: 3456,
    host: '127.0.0.1',
    openBrowser: true,
  },
  storage: { dataDir: './data' },
  log: { level: 'info' },
}

/**
 * 加载并合并配置
 */
export function loadConfig(filePath?: string): AppConfig {
  const file = filePath || process.env.CONFIG_FILE || 'config.yaml'

  // 配置文件不存在：用内嵌配置（打包时注入）或内置默认配置自动生成，保证开箱即用
  if (!fs.existsSync(file)) {
    const config = bootstrapConfig(file)
    logger.info(`未找到配置文件，已自动生成: ${file}`)
    return config
  }

  const raw = YAML.parse(fs.readFileSync(file, 'utf-8'))

  // 深度合并
  const config = deepMerge(DEFAULT_CONFIG, raw) as AppConfig
  normalizeQuiet(config)

  // 账号可为空：首次运行在软件内引导填写（支持多用户各自登录自己的账号）
  if (!config.accounts) config.accounts = []

  // 密码解密 + 明文自动迁移加密（DPAPI 不可用时保持明文并告警）
  // 内存中为明文（登录用），config.yaml 文件中为 DPAPI 加密串
  let needRewrite = false
  for (const acc of config.accounts) {
    if (!isEncrypted(acc.password)) {
      if (acc.password) {
        const enc = encryptPassword(acc.password)
        if (enc) {
          needRewrite = true // 内存保持明文供登录，文件由下方 raw 写回加密串
          logger.info(`账号 ${acc.username} 密码已自动加密存储`)
        } else {
          logger.warn(`账号 ${acc.username} 密码加密不可用，继续使用明文（不影响运行）`)
        }
      }
    } else {
      const plain = decryptPassword(acc.password)
      if (plain) {
        acc.password = plain
      } else {
        logger.error(`账号 ${acc.username} 密码解密失败，登录将无法进行，请在设置页重新保存密码`)
      }
    }
  }

  // 钉钉 AppSecret 与账号密码同等待遇：盘上 DPAPI 加密，内存明文
  const ding: any = config.dingtalk
  if (ding && typeof ding.appSecret === 'string' && ding.appSecret) {
    if (isEncrypted(ding.appSecret)) {
      const plain = decryptPassword(ding.appSecret)
      if (plain) {
        ding.appSecret = plain
      } else {
        logger.error('钉钉 AppSecret 解密失败，图片通道将无法连接，请在设置页重新保存')
      }
    } else if (encryptPassword(ding.appSecret)) {
      needRewrite = true
    }
  }

  if (needRewrite) {
    try {
      // 基于文件原始内容写回，仅把明文密码/AppSecret 替换为加密串，不落内存明文
      const rawAccounts = Array.isArray(raw.accounts) ? raw.accounts : []
      for (const ra of rawAccounts) {
        if (ra && ra.password && !isEncrypted(ra.password)) {
          const enc = encryptPassword(ra.password)
          if (enc) ra.password = enc
        }
      }
      const rawDing: any = raw.dingtalk
      if (rawDing && typeof rawDing.appSecret === 'string' && rawDing.appSecret && !isEncrypted(rawDing.appSecret)) {
        const enc = encryptPassword(rawDing.appSecret)
        if (enc) rawDing.appSecret = enc
      }
      writeFileAtomic(file, YAML.stringify(raw))
      logger.info('config.yaml 已更新（敏感字段加密存储）')
    } catch (e: any) {
      logger.warn(`敏感字段加密写回失败: ${e.message}`)
    }
  }

  return config
}

/**
 * 首次运行引导：无配置文件时生成一份。
 * 优先使用打包时内嵌的配置（含账号，开箱即用）；没有内嵌配置则用默认值生成空模板。
 */
/** 免打扰时段容错：本软件写出的 `start: 23:00` 不带引号，YAML 1.1 工具（实测 PyYAML）会读成 1380 */
function normalizeQuiet(config: AppConfig): void {
  const q: any = (config.notify as any)?.quiet
  if (!q) return
  const start = asTimeString(q.start, '23:00')
  const end = asTimeString(q.end, '07:00')
  if (start !== q.start || end !== q.end) {
    logger.warn(`免打扰时段不是标准 HH:MM（读到 ${q.start}~${q.end}），已按 ${start}~${end} 处理`)
    q.start = start
    q.end = end
  }
}

function bootstrapConfig(filePath: string): AppConfig {
  let embedded: any = null
  if (typeof __EMBEDDED_CONFIG_B64__ !== 'undefined' && __EMBEDDED_CONFIG_B64__) {
    try {
      const text = Buffer.from(__EMBEDDED_CONFIG_B64__, 'base64').toString('utf-8')
      embedded = YAML.parse(text)
      logger.info('已载入内置配置（首次运行自动写入 config.yaml）')
    } catch (e: any) {
      logger.warn(`内置配置解析失败，使用默认模板: ${e.message}`)
      embedded = null
    }
  }

  // Electron 打包版：从 asar 内 build/embedded-config.json 读取内嵌配置
  if (!embedded) {
    try {
      const ep = path.join(__dirname, '..', 'embedded-config.json')
      if (fs.existsSync(ep)) {
        const raw = JSON.parse(fs.readFileSync(ep, 'utf-8'))
        if (raw && raw.b64) {
          embedded = YAML.parse(Buffer.from(raw.b64, 'base64').toString('utf-8'))
          logger.info('已载入 asar 内置配置（首次运行自动写入 config.yaml）')
        }
      }
    } catch (e: any) {
      logger.warn(`asar 内置配置读取失败，使用默认模板: ${e.message}`)
      embedded = null
    }
  }

  const merged = deepMerge(DEFAULT_CONFIG, embedded || {}) as AppConfig
  if (!merged.accounts) merged.accounts = []

  writeFileAtomic(filePath, YAML.stringify(merged))
  return merged
}

function deepMerge(target: any, source: any): any {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key])
    } else {
      result[key] = source[key]
    }
  }
  return result
}
