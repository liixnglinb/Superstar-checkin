import * as fs from 'fs'
import * as path from 'path'
import { logger } from '../utils/logger'
import { writeFileAtomic } from '../utils/fs'
import { decryptPassword, encryptPassword, isEncrypted } from '../utils/crypto'

let data: Record<string, any> = {}
let filePath = ''
let persistTimer: NodeJS.Timeout | null = null

export function initStorage(dataDir: string) {
  filePath = path.join(dataDir, 'superstar-data.json')
  fs.mkdirSync(dataDir, { recursive: true })
  try {
    if (fs.existsSync(filePath)) {
      data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    }
  } catch (e) {
    logger.warn('读取数据文件失败，使用空数据')
  }

  // 优雅退出时保存
  process.on('SIGINT', () => { persist(); process.exit(0) })
  process.on('SIGTERM', () => { persist(); process.exit(0) })
}

export function get<T>(key: string): T | null {
  const value = data[key]
  if (key.startsWith('cookie_') && typeof value === 'string' && isEncrypted(value)) {
    const plain = decryptPassword(value)
    return (plain || '') as unknown as T
  }
  return value ?? null
}

export function set<T>(key: string, value: T) {
  if (key.startsWith('cookie_') && typeof value === 'string' && value && !isEncrypted(value)) {
    const encrypted = encryptPassword(value)
    if (encrypted) value = encrypted as unknown as T
  }
  data[key] = value
  schedulePersist()
}

export function remove(key: string) {
  delete data[key]
  schedulePersist()
}

export function getAll(): Record<string, any> {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [
    key,
    key.startsWith('cookie_') ? '[REDACTED]' : value,
  ]))
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
  try {
    writeFileAtomic(filePath, JSON.stringify(data, null, 2))
  } catch (e) {
    logger.error('保存数据文件失败', e)
  }
}
