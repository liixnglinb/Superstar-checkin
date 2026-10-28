// 模拟 Electron 网络与安装器：覆盖更新的信任边界、重试和并发状态，不联网、不启动安装器。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const crypto = require('node:crypto')
const { EventEmitter } = require('node:events')
const YAML = require('yaml')
const utils = require('../electron/update-utils.cjs')

function harness(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-update-test-'))
  const installer = path.join(dir, 'test.exe')
  const bytes = Buffer.from('verified installer fixture')
  fs.writeFileSync(installer, options.badFile ? 'different contents' : bytes)
  const digest = crypto.createHash('sha512').update(bytes).digest('base64')
  const manifest = { version: options.version || '2.0.0', path: 'test.exe', sha512: digest, files: [{ url: 'test.exe', sha512: digest }] }
  const forged = { ...manifest, sha512: crypto.createHash('sha512').update('forged').digest('base64'), files: [{ url: 'test.exe', sha512: crypto.createHash('sha512').update('forged').digest('base64') }] }
  const calls = { official: 0, checks: 0, downloads: 0, spawns: 0, feeds: 0 }
  const net = { request({ url }) {
    const req = new EventEmitter()
    req.setHeader = () => {}
    req.abort = () => {}
    req.end = () => setImmediate(() => {
      const response = new EventEmitter()
      const official = url.includes('github.com/') && !url.includes('gh-proxy.com') && !url.includes('ghfast.top')
      if (official && url.endsWith('/latest.yml')) calls.official++
      response.statusCode = options.offline && official ? 503 : 200
      req.emit('response', response)
      const info = url.includes('gh-proxy.com') ? forged : manifest
      response.emit('data', Buffer.from(url.endsWith('latest.yml') ? YAML.stringify(info) : 'probe'))
      response.emit('end')
    })
    return req
  } }
  const updater = new EventEmitter()
  updater.setFeedURL = () => { calls.feeds++; if (options.firstFeedFails && calls.feeds === 1) throw new Error('模拟源初始化失败') }
  updater.checkForUpdates = async () => {
    calls.checks++
    return { isUpdateAvailable: true, updateInfo: options.firstMismatch && calls.checks === 1 ? forged : manifest }
  }
  updater.downloadUpdate = async () => { calls.downloads++; if (!fs.existsSync(installer)) fs.writeFileSync(installer, bytes); return [installer] }
  const handlers = {}
  const ipcMain = { handle(name, fn) { handlers[name] = fn } }
  const app = { getVersion: () => options.currentVersion || '1.0.0', getPath: () => dir, quit() {} }
  const updateState = { phase: 'idle', current: '1.0.0', latest: '', notes: '', message: '', installerPath: '' }
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8')
  const start = source.indexOf("  const { autoUpdater } = require('electron-updater')")
  const end = source.indexOf('  // 启动签到服务', start)
  assert.ok(start > 0 && end > start)
  const localUtils = { ...utils, spawnInstaller: async () => { calls.spawns++; if (options.spawnFails) throw new Error('模拟安装器启动失败') } }
  const context = vm.createContext({
    require(name) { if (name === 'electron-updater') return { autoUpdater: updater }; if (name === 'electron') return { net }; return require(name) },
    ...localUtils, app, ipcMain, path, Buffer, updateState, rankedSources: [], silentLogger: {},
    pushUpdateState() {}, setTimeout, clearTimeout, setImmediate, console, quitting: false,
  })
  vm.runInContext(source.slice(start, end), context)
  return { handlers, updateState, calls, manifest, updater }
}

test('官方清单不可达时拒绝信任镜像，且可重新检查', async () => {
  const h = harness({ offline: true })
  const result = await h.handlers['update-check']()
  assert.equal(result.ok, false)
  assert.match(result.message, /官方更新清单/)
  assert.equal(h.calls.downloads, 0)
})

test('忽略不匹配的镜像，并拒绝下载时发生变化的清单后切换可信备用源', async () => {
  const h = harness({ firstMismatch: true })
  const [first, second] = await Promise.all([h.handlers['update-check'](), h.handlers['update-check']()])
  assert.equal(first.hasUpdate, true)
  assert.equal(second.hasUpdate, true)
  const state = h.handlers['update-state']()
  assert.equal(state.ranked.length, 2)
  assert.ok(!state.ranked.some((s) => s.includes('gh-proxy')))
  const [a, b] = await Promise.all([h.handlers['update-download'](), h.handlers['update-download']()])
  assert.equal(a.ok, true)
  assert.equal(b.ok, true)
  assert.equal(h.calls.checks, 2)
  assert.equal(h.calls.downloads, 1)
  assert.equal(h.updateState.phase, 'ready')
  const check = await h.handlers['update-check']()
  assert.equal(check.phase, 'ready')
})

test('下载文件校验失败不进入可安装状态', async () => {
  const h = harness({ badFile: true })
  await h.handlers['update-check']()
  const result = await h.handlers['update-download']()
  assert.equal(result.ok, false)
  assert.equal(h.updateState.phase, 'error')
  assert.match(result.message, /校验失败/)
  const install = await h.handlers['update-install']()
  assert.equal(install.ok, false)
  assert.equal(h.calls.spawns, 0)
})

test('安装器启动失败时保留已验证更新包并可再次安装', async () => {
  const h = harness({ spawnFails: true })
  await h.handlers['update-check']()
  await h.handlers['update-download']()
  const result = await h.handlers['update-install']()
  assert.equal(result.ok, false)
  assert.equal(h.updateState.phase, 'ready')
  assert.ok(fs.existsSync(h.updateState.installerPath))
  const again = await h.handlers['update-install']()
  assert.equal(again.ok, false)
  assert.equal(h.calls.spawns, 2)
  assert.equal(h.updater.autoInstallOnAppQuit, false)
})

test('安装包被删除后允许重新下载', async () => {
  const h = harness()
  await h.handlers['update-check']()
  await h.handlers['update-download']()
  fs.unlinkSync(h.updateState.installerPath)
  const install = await h.handlers['update-install']()
  assert.equal(install.ok, false)
  assert.equal(h.updateState.phase, 'error')
  assert.equal((await h.handlers['update-download']()).ok, true)
  assert.equal(h.calls.downloads, 2)
})

test('设置下载源失败时继续尝试可信备用源', async () => {
  const h = harness({ firstFeedFails: true })
  await h.handlers['update-check']()
  assert.equal((await h.handlers['update-download']()).ok, true)
  assert.equal(h.calls.feeds, 2)
  assert.equal(h.calls.downloads, 1)
})

test('预发布版本不应被误判为比同版本正式版更新', async () => {
  const h = harness({ currentVersion: '2.0.0', version: '2.0.0-beta.1' })
  const result = await h.handlers['update-check']()
  assert.equal(result.phase, 'uptodate')
  assert.equal(result.hasUpdate, false)
})

test('清单拒绝缺失校验值、异常版本和带路径的安装包', () => {
  assert.throws(() => utils.parseUpdateManifest({ version: 'bad', path: 'test.exe' }))
  assert.throws(() => utils.parseUpdateManifest({ version: '1.2.3', path: '../test.exe' }))
  assert.throws(() => utils.parseUpdateManifest({ version: '1.2.3', path: 'test.exe', sha512: 'invalid' }))
})
