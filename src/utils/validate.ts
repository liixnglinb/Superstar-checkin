/**
 * HTTP 边界的入参校验。
 *
 * 为什么需要：实测发现 `/api/settings` 接受 `quietStart:"99:99"`、5000 字符用户名、
 * `proxy:"file:///etc/passwd"` 并原样写进 config.yaml；非法轮询间隔被静默丢弃后接口还回
 * `ok:true`，用户以为保存成功了。这里把所有写入 config.yaml / 外部调用前的入参收敛一次。
 */

/** 客户端输入不合法：路由据此回 400，而不是当成服务端异常回 500 */
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BadRequestError'
  }
}

// 控制字符（含 NUL/ESC）会破坏 YAML 与日志；\r\n 会破坏单行字段
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

/**
 * 收拢一段用户文本：去控制字符、按字段决定是否压平换行、限长。
 * 超长直接报错而不是截断——静默截断会让用户以为保存的是全文。
 * `trim: false` 用于密码这类首尾空格有意义的字段（只去控制字符，不动空格）。
 */
export function textField(
  value: unknown,
  field: string,
  max: number,
  opts: { multiline?: boolean; trim?: boolean } = {},
): string {
  const trim = opts.trim !== false
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new BadRequestError(`${field}格式不正确，应为文本`)
  }
  let s = String(value).replace(CONTROL_CHARS, '')
  s = opts.multiline ? s.replace(/\r/g, '') : s.replace(/[\r\n]+/g, ' ')
  if (trim) s = s.trim()
  if (s.length > max) throw new BadRequestError(`${field}最长 ${max} 个字符（当前 ${s.length} 个）`)
  return s
}

/** 必填文本 */
export function requiredText(value: unknown, field: string, max: number, opts: { trim?: boolean } = {}): string {
  const s = textField(value, field, max, opts)
  if (!s.trim()) throw new BadRequestError(`${field}不能为空`)
  return s
}

/**
 * 区间内的整数。空值（''/null/undefined）返回 null 表示「本次未提交该字段」，
 * 越界/非数字一律报错——不返回默认值，否则 UI 会把被吞掉的输入当成保存成功。
 */
export function intInRange(value: unknown, field: string, min: number, max: number): number | null {
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) throw new BadRequestError(`${field}必须是数字`)
  const r = Math.round(n)
  if (r < min || r > max) throw new BadRequestError(`${field}应在 ${min}~${max} 之间（当前 ${r}）`)
  return r
}

/**
 * 布尔开关。`!!body.on` 的旧写法会把字符串 "false" 当真（非空字符串恒为真），
 * 外部客户端/PWA 形态下等于「叫它停止监听却开始了监听」。
 */
export function boolFlag(value: unknown, field: string): boolean {
  if (typeof value === 'boolean') return value
  if (value === undefined || value === null || value === '') return false
  if (value === 'true' || value === '1' || value === 1) return true
  if (value === 'false' || value === '0' || value === 0) return false
  throw new BadRequestError(`${field}应为 true/false`)
}

/** 24 小时制 HH:MM；空值返回 null */
export function timeOfDay(value: unknown, field: string): string | null {
  const s = textField(value, field, 5)
  if (!s) return null
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(s)
  if (!m) throw new BadRequestError(`${field}格式应为 HH:MM，例如 23:00`)
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) throw new BadRequestError(`${field}不是有效时间（小时 0-23，分钟 0-59）`)
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/** 把 HH:MM 转成当日分钟数；格式或取值非法返回 NaN（调用方必须处理，别参与比较） */
export function minutesOf(time: unknown): number {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(String(time ?? '').trim())
  if (!m) return NaN
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return NaN
  return h * 60 + min
}

/**
 * 把配置里的时间收回成 'HH:MM'。
 * 为什么需要：本软件写出的 `start: 23:00` 是不带引号的，按 YAML 1.2 是字符串，
 * 但任何 YAML 1.1 工具（实测 PyYAML 把它读成 1380）会把它当成六十进制整数；
 * 这类值一旦流回比较逻辑，免打扰时段就会算错。数字按「当日分钟数」还原。
 */
export function asTimeString(value: unknown, fallback: string): string {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1440) {
    const total = Math.round(value)
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  }
  const s = String(value ?? '').trim()
  return Number.isNaN(minutesOf(s)) ? fallback : s
}

/** 代理地址：只允许 http/https，防止 file:// 之类的地址被写进配置后交给网络层 */
export function proxyUrl(value: unknown, field = '代理地址'): string {
  const s = textField(value, field, 256)
  if (!s) return ''
  let u: URL
  try {
    u = new URL(s.includes('://') ? s : 'http://' + s)
  } catch {
    throw new BadRequestError(`${field}不是合法地址，例如 http://127.0.0.1:7890`)
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new BadRequestError(`${field}只支持 http/https 代理`)
  }
  if (!u.hostname) throw new BadRequestError(`${field}缺少主机名`)
  const port = Number(u.port)
  if (u.port && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new BadRequestError(`${field}端口应在 1~65535 之间`)
  }
  return s
}
