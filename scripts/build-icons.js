/**
 * 图标构建：三档分级 SVG 母版 → 各尺寸原生栅格化 → PNG 资产 + BMP/DIB 版 ICO
 *
 * 为什么不用「512 大图缩小」：
 *   1. 缩放会把母版里的柔光、细内环、投影糊在一起，16–32px 直接变成一坨；
 *   2. 所以 16 / 24–32 / ≥48 各有一张母版（icon-16.svg、icon-24.svg、icon.svg），
 *      每个目标尺寸都用矢量在该尺寸下直接栅格化，不经过二次重采样。
 * 为什么 ICO 用 BMP/DIB 而不是 PNG-in-ICO：
 *   exe 内嵌图标（electron-builder 用 resedit 写资源）不认 PNG 压缩条目，
 *   Windows 资源管理器/快捷方式也可能取不到，全部按 32bpp DIB 存。
 *
 * 用法: node scripts/build-icons.js
 */
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const ROOT = path.join(__dirname, '..')
const ASSETS = path.join(ROOT, 'assets')

/** 尺寸 → 母版文件。≤20 用纯勾版，≤32 用加粗圆盘版，其余用完整质感版。 */
function masterFor(size) {
  if (size <= 20) return 'icon-16.svg'
  if (size <= 32) return 'icon-24.svg'
  return 'icon.svg'
}

/** 以目标像素尺寸原生栅格化，返回 RGBA 原始像素
 *  注意：librsvg 按 72dpi 解释 SVG 的 px，传 density:96 会先把 16px 渲染成 21px 再被我们缩放，
 *  等于偷偷重采样、直接毁掉小尺寸锐度。所以这里固定用默认 density，并断言输出尺寸就是目标尺寸。 */
async function renderSvg(file, size) {
  const src = fs.readFileSync(path.join(ASSETS, file), 'utf8')
    .replace(/width="\d+"/, `width="${size}"`)
    .replace(/height="\d+"/, `height="${size}"`)
  const r = await sharp(Buffer.from(src)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (r.info.width !== size || r.info.height !== size) {
    throw new Error(`${file} 未按原生尺寸渲染: 期望 ${size}x${size}, 实得 ${r.info.width}x${r.info.height}`)
  }
  return r
}

/** RGBA 原始像素 → PNG 缓冲 */
function pngFromRgba(rgba, size) {
  return sharp(rgba, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer()
}

/** 32bpp DIB（BGRA 自下而上 + 全 0 AND 掩码），供 ICO 使用 */
function dibFromRgba(rgba, size) {
  const xor = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    const srcOff = y * size * 4
    const dstOff = (size - 1 - y) * size * 4
    for (let x = 0; x < size; x++) {
      const s = srcOff + x * 4
      const d = dstOff + x * 4
      xor[d] = rgba[s + 2]      // B
      xor[d + 1] = rgba[s + 1]  // G
      xor[d + 2] = rgba[s]      // R
      xor[d + 3] = rgba[s + 3]  // A
    }
  }
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8)  // XOR + AND 合计高度
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(0, 16)       // BI_RGB
  const maskRow = Math.ceil(size / 32) * 4
  const mask = Buffer.alloc(maskRow * size)  // 全 0 = 不使用掩码，透明交给 alpha
  return Buffer.concat([header, xor, mask])
}

function buildIco(entries) {
  const count = entries.length
  const dirSize = 6 + count * 16
  let offset = dirSize
  const dir = Buffer.alloc(count * 16)
  const body = []
  entries.forEach((e, i) => {
    const at = i * 16
    dir[at] = e.size >= 256 ? 0 : e.size
    dir[at + 1] = e.size >= 256 ? 0 : e.size
    dir[at + 2] = 0
    dir[at + 3] = 0
    dir.writeUInt16LE(1, at + 4)
    dir.writeUInt16LE(32, at + 6)
    dir.writeUInt32LE(e.data.length, at + 8)
    dir.writeUInt32LE(offset, at + 12)
    offset += e.data.length
    body.push(e.data)
  })
  const head = Buffer.alloc(6)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(count, 4)
  return Buffer.concat([head, dir, ...body])
}

async function main() {
  const icoSizes = [16, 24, 32, 48, 64, 128, 256]
  const pngJobs = [
    ['app-icon.png', 512],
    ['app-icon-192.png', 192],
    ['favicon-checkin.png', 256],
  ]

  const cache = new Map()
  async function pixels(size) {
    const key = size
    if (!cache.has(key)) {
      const r = await renderSvg(masterFor(size), size)
      cache.set(key, { rgba: r.data, size })
    }
    return cache.get(key)
  }

  for (const [name, size] of pngJobs) {
    const p = await pixels(size)
    fs.writeFileSync(path.join(ASSETS, name), await pngFromRgba(p.rgba, p.size))
    console.log(`PNG  ${name.padEnd(22)} ${size}x${size}`)
  }

  const entries = []
  for (const size of icoSizes) {
    const p = await pixels(size)
    entries.push({ size, data: dibFromRgba(p.rgba, p.size) })
    console.log(`ICO  +${size}x${size} DIB`)
  }
  const ico = buildIco(entries)
  fs.writeFileSync(path.join(ASSETS, 'app-icon.ico'), ico)
  console.log(`ICO  app-icon.ico          ${ico.length} bytes / ${entries.length} entries`)

  // 自检：把每个尺寸按原样与 8 倍近邻放大拼成一张对照图，写进系统临时目录（不入库）
  const scale = 8
  const composite = []
  let x = 24
  let rowH = 0
  for (const size of icoSizes) {
    const p = await pixels(size)
    const png = await pngFromRgba(p.rgba, p.size)
    const k = size <= 48 ? scale : 2
    const zoom = await sharp(png).resize(size * k, size * k, { kernel: 'nearest' }).png().toBuffer()
    const flat = await sharp(png).resize(128, 128, { kernel: 'nearest' }).png().toBuffer()
    composite.push({ input: zoom, left: x, top: 24 })
    composite.push({ input: flat, left: x, top: 24 + size * k + 16 })
    rowH = Math.max(rowH, size * k + 16 + 128)
    x += Math.max(size * k, 128) + 24
  }
  const sheetW = x
  const sheetH = 24 + rowH + 24
  const sheet = await sharp({ create: { width: sheetW, height: sheetH, channels: 4, background: '#FFFFFF' } })
    .composite(composite).png().toBuffer()
  const out = path.join(require('os').tmpdir(), 'icon-sheet.png')
  fs.writeFileSync(out, sheet)
  console.log(`\n对照图（1x 与 8x 近邻放大）: ${out}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
