import * as fs from 'fs'
import * as path from 'path'
import { logger } from '../utils/logger'
import { writeFileAtomic } from '../utils/fs'
import { decryptPassword, encryptPassword, isEncrypted } from '../utils/crypto'

/**
 * 本地存储：superstar-data.json（cookie / uid / history 等键值）。
 *
 * 为什么这么写（实测出来的问题）：
 * - 旧实现 `data = JSON.parse(...)` 不校验形状。文件损坏成 `null` 时后续 `data[key]`
 *   直接抛 TypeError，整个服务起不来；损坏成 `[]` / `"hello"` / `123` 时能启动，
 *   但所有写入静默丢失，接口还回 `ok:true "已保存"`（用户以为存上了）。
 * - 旧实现 catch 后直接 `data = {}`，下一次落盘就把原文件覆盖掉，用户数据永久丢失且无回退。
 * 现在：形状不合法就先把原件另存为 .corrupt-<时间>，再重置；写入路径统一保证 data 一定是普通对象。
 */
const SCHEMA_VERSION = 1
const SCHEMA_KEY = '__schema'

let data: Record<string, any> = {}
let filePath = ''
let persistTimer: NodeJS.Timeout | null = null
let signalsBound = false

function isPlainObject(v: any): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** 把不可用的数据文件原件留一份副本，绝不静默覆盖用户数据 */
function quarantine(reason: string): string | null {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const target = `${filePath}.corrupt-${stamp}`
    fs.copyFileSync(filePath, target)
    logger.error(`数据文件不可用（${reason}），原件已保留为 ${path.basename(target)}，本次以空数据启动`)
    return target
  } catch (e: any) {
    logger.error(`保留损坏数据副本失败: ${e.message}`)
    return null
  }
}

/** 字段级坏数据（顶层仍合法）在修复前留一份原件，用户想手工捞回内容时有据可依 */
export function preserveCorruptFile(reason: string): void {
  quarantine(reason)
}

export function initStorage(dataDir: string) {
  filePath = path.join(dataDir, 'superstar-data.json')
  fs.mkdirSync(dataDir, { recursive: true })
  data = {}
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8')
      if (raw.trim()) {
        const parsed = JSON.parse(raw)
        if (isPlainObject(parsed)) {
          if (typeof parsed[SCHEMA_KEY] === 'number' && parsed[SCHEMA_KEY] > SCHEMA_VERSION) {
            logger.warn(`数据文件版本 ${parsed[SCHEMA_KEY]} 高于当前程序支持的 ${SCHEMA_VERSION}，只按已知字段读取`)
          }
          data = parsed
        } else {
          quarantine('顶层不是对象（数组/标量/null）')
        }
      }
    }
  } catch (e: any) {
    quarantine(e?.message || 'JSON 解析失败')
    data = {}
  }

  // 优雅退出时保存（只绑一次，避免重复 initStorage 时监听器堆积）
  if (!signalsBound) {
    signalsBound = true
    process.on('SIGINT', () => { persist(); process.exit(0) })
    process.on('SIGTERM', () => { persist(); process.exit(0) })
  }
}

export function get<T>(key: string): T | null {
  if (!isPlainObject(data)) return null
  const value = data[key]
  if (key.startsWith('cookie_') && typeof value === 'string' && isEncrypted(value)) {
    const plain = decryptPassword(value)
    return (plain || '') as unknown as T
  }
  return value ?? null
}

export function set<T>(key: string, value: T) {
  // 兜底：任何情况下都保证写入目标是普通对象，否则写入会静默丢失
  if (!isPlainObject(data)) {
    logger.error('存储内部状态异常（data 不是对象），已重置后再写入')
    data = {}
  }
  if (key.startsWith('cookie_') && typeof value === 'string' && value && !isEncrypted(value)) {
    const encrypted = encryptPassword(value)
    if (encrypted) value = encrypted as unknown as T
  }
  data[key] = value
  schedulePersist()
}

/** 防抖落盘：1 秒内多次写入只实际写一次，避免频繁 IO 阻塞事件循环 */
function schedulePersist() {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    persist()
  }, 1000)
}

function persist() {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  if (!filePath) return
  if (!isPlainObject(data)) {
    logger.error('拒绝落盘：内存中的数据不是对象，避免把用户文件写成坏格式')
    return
  }
  try {
    writeFileAtomic(filePath, JSON.stringify(Object.assign({}, data, { [SCHEMA_KEY]: SCHEMA_VERSION }), null, 2))
  } catch (e) {
    logger.error('保存数据文件失败', e)
  }
}
