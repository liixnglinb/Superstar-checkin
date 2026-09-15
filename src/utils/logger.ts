import chalk from 'chalk'
import * as fs from 'fs'
import * as path from 'path'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

class Logger {
  private level: LogLevel = 'info'
  private logFile?: string
  private stream?: fs.WriteStream

  configure(level: LogLevel, logFile?: string) {
    this.level = level
    if (logFile) {
      this.logFile = logFile
      fs.mkdirSync(path.dirname(logFile), { recursive: true })
      try {
        if (fs.existsSync(logFile) && fs.statSync(logFile).size > 10 * 1024 * 1024) {
          const backup = `${logFile}.1`
          if (fs.existsSync(backup)) fs.unlinkSync(backup)
          fs.renameSync(logFile, backup)
        }
      } catch { /* 日志轮转失败不应影响业务启动 */ }
      this.stream = fs.createWriteStream(logFile, { flags: 'a' })
    }
  }

  private redact(value: any): any {
    if (typeof value !== 'string') return value
    return value
      .replace(/(Cookie:\s*).+?(?=\s|$)/gi, '$1[REDACTED]')
      .replace(/([?&](?:token|access_token|password|secret|key)=)[^&\s]+/gi, '$1[REDACTED]')
      .replace(/((?:password|secretKey|secretId|smtpPassword)\s*[:=]\s*)([^\s,;]+)/gi, '$1[REDACTED]')
  }

  private timestamp(): string {
    const now = new Date()
    return now.toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    })
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level]
  }

  private writeToFile(prefix: string, ...args: any[]) {
    if (!this.stream) return
    const line = `[${this.timestamp()}][${prefix}] ${args.map(a =>
      this.redact(typeof a === 'object' ? JSON.stringify(a) : String(a)),
    ).join(' ')}\n`
    this.stream.write(line)
  }

  debug(...args: any[]) {
    if (!this.shouldLog('debug')) return
    const ts = this.timestamp()
    console.log(chalk.gray(`[${ts}][DEBUG]`), ...args)
    this.writeToFile('DEBUG', ...args)
  }

  info(...args: any[]) {
    if (!this.shouldLog('info')) return
    const ts = this.timestamp()
    console.info(`[${ts}][INFO]`, ...args)
    this.writeToFile('INFO', ...args)
  }

  warn(...args: any[]) {
    if (!this.shouldLog('warn')) return
    const ts = this.timestamp()
    console.warn(chalk.yellow(`[${ts}][WARN]`), ...args)
    this.writeToFile('WARN', ...args)
  }

  error(...args: any[]) {
    if (!this.shouldLog('error')) return
    const ts = this.timestamp()
    console.error(chalk.red(`[${ts}][ERROR]`), ...args)
    this.writeToFile('ERROR', ...args)
  }

  success(...args: any[]) {
    if (!this.shouldLog('info')) return
    const ts = this.timestamp()
    console.info(chalk.green(`[${ts}][OK]`), ...args)
    this.writeToFile('OK', ...args)
  }
}

export const logger = new Logger()
