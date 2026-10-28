const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const storage = require('../build/providers/storage.js')
const { CheckinHandler } = require('../build/handlers/checkin-handler.js')
const { CheckinEngine } = require('../build/core/checkin-engine.js')

test('普通及二维码签到提交失败时，不进行成功后的核对或补交', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-verify-'))
  storage.initStorage(dir)
  const config = {
    checkin: { verify: { enabled: true }, antiDetect: { enabled: false }, retry: { maxAttempts: 1, delayMs: 0 } },
    geo: { locations: [], providers: {}, locationRadius: 10 },
  }
  const accounts = { getAccounts: () => [{ username: 'test' }], getMeta: () => ({ name: 'test', cookie: '' }) }
  const handler = new CheckinHandler(config, accounts)
  let verifyCalls = 0
  handler.verifyAfterCheckin = async () => { verifyCalls++; return 'should not be called' }
  handler.executeCheckin = async () => '签到失败'
  const original = CheckinEngine.qrCheckin
  CheckinEngine.qrCheckin = async () => '二维码已过期'
  try {
    const normal = await handler.handle('1', 1, 1, '课程', { type: 'normal' })
    const qr = await handler.handleQr('2', 'enc')
    assert.equal(verifyCalls, 0)
    assert.equal(normal[0].success, false)
    assert.equal(normal[0].message, '签到失败')
    assert.equal(qr[0].success, false)
    assert.equal(qr[0].message, '二维码已过期')
  } finally {
    CheckinEngine.qrCheckin = original
  }
})
