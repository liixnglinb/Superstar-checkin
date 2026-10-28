const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { JSDOM } = require('jsdom')
const { initDisclaimer, getConsent, acceptDisclaimer } = require('../build/providers/disclaimer')

test('同意记录写入失败时不报告已接受', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-consent-'))
  initDisclaimer(dir)
  const rename = fs.renameSync
  try {
    fs.renameSync = () => { throw new Error('模拟磁盘故障') }
    assert.throws(() => acceptDisclaimer(), /模拟磁盘故障/)
    assert.equal(getConsent().accepted, false)
  } finally {
    fs.renameSync = rename
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('同意记录保存失败时弹窗保持打开并提示重试', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/server/console-ui.ts'), 'utf8')
  const script = source.slice(source.indexOf('  function ensureDisclaimer(){'), source.indexOf('  /* ===== 轻提示与应用内对话框 ===== */'))
  const dom = new JSDOM('<div id="disclaimerModal"><div id="disclaimerError"></div><button id="disclaimerAgree"></button><button id="disclaimerRefuse"></button></div>', { runScripts: 'outside-only' })
  const { window } = dom
  window.$ = id => window.document.getElementById(id)
  let success = false
  window.apiFetch = url => Promise.resolve({ json: async () => url.endsWith('/accept') ? (success ? { ok: true, accepted: true } : { ok: false, message: '磁盘故障' }) : { ok: true, accepted: false } })
  window.eval(script)
  const settle = () => new Promise(resolve => setImmediate(resolve))
  await settle()
  window.$('disclaimerAgree').click()
  await settle()
  assert.ok(window.$('disclaimerModal').classList.contains('show'))
  assert.match(window.$('disclaimerError').textContent, /磁盘故障/)
  success = true
  window.$('disclaimerAgree').click()
  await settle()
  assert.equal(window.$('disclaimerModal').classList.contains('show'), false)
  dom.window.close()
})
