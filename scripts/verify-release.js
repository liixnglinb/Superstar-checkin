#!/usr/bin/env node
// 校验 Release 中的清单、安装包及固定名副本确实属于同一版本。
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const YAML = require('yaml')

async function digest(file) {
  const hash = crypto.createHash('sha512')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('base64')
}

async function verifyRelease(dir, expectedVersion) {
  if (!/^\d+\.\d+\.\d+$/.test(expectedVersion || '')) throw new Error('发布版本号必须为 x.y.z')
  const manifest = YAML.parse(fs.readFileSync(path.join(dir, 'latest.yml'), 'utf8'))
  const filename = `SuperstarCheckin-Setup-${expectedVersion}.exe`
  if (!manifest || String(manifest.version) !== expectedVersion) throw new Error('latest.yml 版本与发布版本不一致')
  if (manifest.path !== filename || !Array.isArray(manifest.files) || manifest.files.length !== 1 || manifest.files[0].url !== filename) {
    throw new Error('latest.yml 的安装包路径不匹配')
  }
  const installer = path.join(dir, filename)
  const fixed = path.join(dir, 'SuperstarCheckin-Setup.exe')
  const blockmap = path.join(dir, filename + '.blockmap')
  const stat = fs.statSync(installer)
  if (!stat.isFile() || stat.size === 0 || Number(manifest.files[0].size) !== stat.size) throw new Error('安装包大小与清单不一致')
  if (!fs.statSync(blockmap).isFile() || fs.statSync(blockmap).size === 0) throw new Error('缺少有效的 blockmap')
  const checksum = await digest(installer)
  if (manifest.sha512 !== checksum || manifest.files[0].sha512 !== checksum) throw new Error('安装包 SHA-512 与清单不一致')
  if (await digest(fixed) !== checksum) throw new Error('固定名安装包和版本安装包内容不一致')
  return { version: expectedVersion, filename, size: stat.size }
}

if (require.main === module) {
  verifyRelease(process.argv[2] || 'dist-electron', process.argv[3]).then((r) => {
    console.log(`更新发布资产校验通过：${r.filename}（${r.size} 字节）`)
  }).catch((e) => { console.error(`更新发布资产校验失败：${e.message}`); process.exitCode = 1 })
}
module.exports = { verifyRelease }
