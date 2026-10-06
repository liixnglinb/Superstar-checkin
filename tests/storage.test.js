/**
 * 存储层容错测试（build/providers/storage.js）。
 *
 * 为什么留这些用例：模块三实测发现 superstar-data.json 损坏成 null 时服务完全起不来、
 * 损坏成 []/"hello"/123 时下次落盘把原件静默覆盖。这里固化「先隔离原件再重置」的行为。
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const os = require('os')

const storage = require('../build/providers/storage.js')

function makeDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cx-store-'))
}

function writeDataFile(dir, content) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'superstar-data.json'), content, 'utf8')
}

function quarantines(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.includes('.corrupt-')) : []
}

test('损坏成 null：能启动、get 不炸、原件留隔离副本', () => {
  const dir = makeDataDir()
  writeDataFile(dir, 'null')
  storage.initStorage(dir)
  assert.equal(storage.get('anything'), null)
  assert.equal(quarantines(dir).length, 1)
})

test('损坏成 [] / "hello" / 123 / 截断 JSON：都隔离并可用', () => {
  for (const bad of ['[]', '"hello"', '123', '{"a":']) {
    const dir = makeDataDir()
    writeDataFile(dir, bad)
    storage.initStorage(dir)
    assert.equal(quarantines(dir).length, 1, `应隔离: ${bad}`)
    storage.set('k', 'v')
    assert.equal(storage.get('k'), 'v')
  }
})

test('空文件：视为空数据，不算损坏（无隔离副本）', () => {
  const dir = makeDataDir()
  writeDataFile(dir, '')
  storage.initStorage(dir)
  assert.equal(quarantines(dir).length, 0)
})

test('合法对象：不误隔离，读写往返正常，落盘带 __schema 版本', async () => {
  const dir = makeDataDir()
  writeDataFile(dir, JSON.stringify({ cookie_a: 'v1:AAAA', keep: 1 }))
  storage.initStorage(dir)
  assert.equal(quarantines(dir).length, 0)
  assert.equal(storage.get('keep'), 1)
  storage.set('k2', { x: 1 })
  await new Promise((r) => setTimeout(r, 1400)) // 等防抖落盘（1s）
  const doc = JSON.parse(fs.readFileSync(path.join(dir, 'superstar-data.json'), 'utf8'))
  assert.equal(doc.__schema, 1)
  assert.equal(doc.keep, 1, '原有键不能丢')
  assert.equal(doc.cookie_a, 'v1:AAAA', 'cookie 键不能丢')
})

test('内存状态异常时 set 自修复：不静默丢写入', () => {
  const dir = makeDataDir()
  storage.initStorage(dir)
  storage.set('k', 'v')
  assert.equal(storage.get('k'), 'v')
})

test('cookie_ 键：存明文自动加密，读出仍是明文（DPAPI 往返）', async () => {
  const dir = makeDataDir()
  storage.initStorage(dir)
  storage.set('cookie_t', 'plain-cookie-value')
  await new Promise((r) => setTimeout(r, 1400)) // 等防抖落盘（1s）
  const raw = fs.readFileSync(path.join(dir, 'superstar-data.json'), 'utf8')
  assert.ok(!raw.includes('plain-cookie-value'), '明文不应直接落盘')
  assert.equal(storage.get('cookie_t'), 'plain-cookie-value')
})

test('initStorage 重复调用：SIGINT/SIGTERM 监听器不堆积', () => {
  const dir = makeDataDir()
  for (let i = 0; i < 50; i++) storage.initStorage(dir)
  assert.equal(process.listenerCount('SIGINT'), 1)
  assert.equal(process.listenerCount('SIGTERM'), 1)
})
