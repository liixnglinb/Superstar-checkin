const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const YAML = require('yaml')
const { verifyRelease } = require('../scripts/verify-release')

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-release-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const data = Buffer.from('test installer')
  const version = '3.14.0'
  const name = `SuperstarCheckin-Setup-${version}.exe`
  const sha512 = crypto.createHash('sha512').update(data).digest('base64')
  const info = { version, path: name, sha512, files: [{ url: name, size: data.length, sha512 }] }
  fs.writeFileSync(path.join(dir, name), data)
  fs.writeFileSync(path.join(dir, 'SuperstarCheckin-Setup.exe'), data)
  fs.writeFileSync(path.join(dir, name + '.blockmap'), 'blockmap')
  fs.writeFileSync(path.join(dir, 'latest.yml'), YAML.stringify(info))
  return { dir, version, info }
}

test('发布清单、固定名安装包和版本安装包一致时通过', async (t) => {
  const { dir, version } = fixture(t)
  assert.equal((await verifyRelease(dir, version)).version, version)
})

test('发布版本、安装包哈希或固定名副本不一致时拒绝', async (t) => {
  const { dir, version, info } = fixture(t)
  await assert.rejects(verifyRelease(dir, '3.14.1'), /版本/)
  info.sha512 = 'invalid'
  fs.writeFileSync(path.join(dir, 'latest.yml'), YAML.stringify(info))
  await assert.rejects(verifyRelease(dir, version), /SHA-512/)
  info.sha512 = info.files[0].sha512
  fs.writeFileSync(path.join(dir, 'latest.yml'), YAML.stringify(info))
  fs.writeFileSync(path.join(dir, 'SuperstarCheckin-Setup.exe'), 'different')
  await assert.rejects(verifyRelease(dir, version), /固定名/)
})
