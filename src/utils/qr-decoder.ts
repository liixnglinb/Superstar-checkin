import axios from 'axios'
import * as crypto from 'crypto'
import { logger } from './logger'
import { QR_REGEX } from '../constants'
import { decodeImage } from './image-decode'

/**
 * 从图片 Buffer 中解析二维码，返回 enc 参数
 * 支持腾讯云 OCR 和本地 jsQR 两种方式
 */

// sharp 为可选增强（原生模块，pkg 打包 exe 时不内嵌）。
// 用变量形式 require，避免打包器把它静态收集进产物（原生二进制无法内联）。
const SHARP_MOD = 'sharp'

export interface QrPayload {
  /** 二维码内容中携带的活动编号（部分签到码包含；不含时需配合待处理签到使用） */
  aid?: string
  /** 签到会话密钥 enc（必含） */
  enc: string
}

export async function decodeQrFromBuffer(
  buffer: Buffer,
  ocrConfig?: { provider: string; tencent?: { secretId: string; secretKey: string } },
): Promise<QrPayload | null> {
  // 方式1：腾讯云 OCR（显式配置时优先）
  if (ocrConfig?.provider === 'tencent' && ocrConfig.tencent) {
    return decodeViaTencentOcr(buffer, ocrConfig.tencent)
  }

  // 方式2：本地 jsQR（纯 JS 图片解码 + jsQR，无需原生模块）
  return decodeViaJsQR(buffer)
}

/**
 * 腾讯云 QrcodeOCR API
 * https://cloud.tencent.com/document/api/866/35715
 */
async function decodeViaTencentOcr(
  buffer: Buffer,
  credentials: { secretId: string; secretKey: string },
): Promise<QrPayload | null> {
  try {
    const base64 = buffer.toString('base64')
    const timestamp = Math.floor(Date.now() / 1000)
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
    const service = 'ocr'
    const host = 'ocr.tencentcloudapi.com'
    const action = 'QrcodeOCR'
    const version = '2018-11-19'

    const payload = JSON.stringify({ ImageBase64: base64 })

    // TC3-HMAC-SHA256 签名
    const hashedPayload = crypto.createHash('sha256').update(payload).digest('hex')
    const canonicalRequest = [
      'POST', '/', '', `content-type:application/json\nhost:${host}\n`,
      'content-type;host', hashedPayload,
    ].join('\n')

    const credentialScope = `${date}/${service}/tc3_request`
    const hashedCanonical = crypto.createHash('sha256').update(canonicalRequest).digest('hex')
    const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${hashedCanonical}`

    // TC3-HMAC-SHA256 签名：每轮 HMAC 的密钥应为原始 Buffer（digest()），
    // 而非 hex 字符串。参考腾讯云官方 Node.js 示例。
    const signKey = (key: string | Buffer, msg: string) =>
      crypto.createHmac('sha256', key).update(msg).digest()

    const secretDate = signKey(`TC3${credentials.secretKey}`, date)
    const secretService = signKey(secretDate, service)
    const secretSigning = signKey(secretService, 'tc3_request')
    const signature = crypto
      .createHmac('sha256', secretSigning)
      .update(stringToSign)
      .digest('hex')

    const authorization = `TC3-HMAC-SHA256 Credential=${credentials.secretId}/${credentialScope}, SignedHeaders=content-type;host, Signature=${signature}`

    const resp = await axios.post(`https://${host}`, payload, {
      headers: {
        'Content-Type': 'application/json',
        Host: host,
        'X-TC-Action': action,
        'X-TC-Version': version,
        'X-TC-Timestamp': String(timestamp),
        'X-TC-Region': 'ap-shanghai',
        Authorization: authorization,
      },
    })

    const results = resp.data?.Response?.CodeResults || []
    for (const item of results) {
      const url = item.Url || item.Symbol || ''
      const payload = extractPayload(url)
      if (payload) {
        logger.info(`腾讯云 OCR 解析成功: enc=${payload.enc} aid=${payload.aid || '无'}`)
        return payload
      }
      // 也检查原始文本内容
      const text = JSON.stringify(item)
      const textMatch = text.match(/enc=([\dA-Fa-f]+)/)
      if (textMatch) {
        logger.info(`腾讯云 OCR 解析成功(文本): enc=${textMatch[1]}`)
        return { aid: undefined, enc: textMatch[1] }
      }
    }

    logger.warn('腾讯云 OCR 未识别到签到二维码内容')
    return null
  } catch (e: any) {
    logger.error(`腾讯云 OCR 解析失败: ${e.message}`)
    return null
  }
}

/** 提取 jsQR 解码文本中的 aid + enc 参数 */
function extractPayload(text: string): { aid?: string; enc: string } | null {
  const content = String(text || '').trim()
  try {
    const url = new URL(content)
    const enc = url.searchParams.get('enc') || ''
    const aid = url.searchParams.get('activeId') || url.searchParams.get('aid') || url.searchParams.get('id') || undefined
    if (enc) return { aid: aid || undefined, enc }
  } catch { /* 非 URL 内容，继续使用签到串解析 */ }

  const signinMatch = content.match(/SIGNIN:.*?aid=(\d+).*?enc=([\dA-Fa-f]+)/i)
  if (signinMatch) return { aid: signinMatch[1], enc: signinMatch[2] }

  const urlMatch = content.match(/[?&](?:activeId|aid|id)=(\d+).*?[?&]enc=([\dA-Fa-f]+)/i)
  if (urlMatch) return { aid: urlMatch[1], enc: urlMatch[2] }

  const legacy = content.match(QR_REGEX)
  if (legacy) return { aid: legacy[3] || undefined, enc: legacy[5] || legacy[1] }

  const encOnly = content.match(/enc=([\dA-Fa-f]+)/i)
  return encOnly ? { enc: encOnly[1] } : null
}

/**
 * 本地 jsQR 解码：默认纯 JS 图片解码（pngjs/jpeg-js/BMP 手动解析）+ jsqr，
 * 不依赖 sharp 原生模块；若环境已安装 sharp 则优先使用（解码更快、格式更全）。
 */
async function decodeViaJsQR(buffer: Buffer): Promise<QrPayload | null> {
  // jsqr 为纯 JS，可随打包产物内联
  const jsQR = require('jsqr')

  // sharp 增强：仅在真实 node_modules 存在时可用（打包 exe 时不内嵌，变量 require 防静态收集）
  let sharp: any = null
  try {
    sharp = require(SHARP_MOD)
  } catch {
    sharp = null
  }

  try {
    let data: Buffer
    let width: number
    let height: number

    if (sharp) {
      const raw = await sharp(buffer)
        .ensureAlpha()
        .raw({ channels: 4 })
        .toBuffer({ resolveWithObject: true })
      data = raw.data
      width = raw.info.width
      height = raw.info.height
    } else {
      const img = decodeImage(buffer)
      data = img.data
      width = img.width
      height = img.height
    }

    const code = jsQR(
      new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
      width,
      height,
    )

    if (code?.data) {
      logger.info(`jsQR 解析结果: ${code.data.slice(0, 100)}`)
      const payload = extractPayload(code.data)
      if (payload) return payload
    }

    logger.warn('jsQR 未识别到二维码内容')
    return null
  } catch (e: any) {
    logger.error(`jsQR 解码失败: ${e.message}`)
    return null
  }
}
