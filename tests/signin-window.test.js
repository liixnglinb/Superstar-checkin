const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { initWindowStore, recordSigninTime, getObservations } = require('../build/providers/signin-window.js')

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'cx-window-')) }

test('切换数据目录时不会沿用之前的观测', () => {
  const first = tempDir()
  const second = tempDir()
  initWindowStore(first)
  recordSigninTime('course', Date.now())
  assert.equal(getObservations().course.length, 1)
  initWindowStore(second)
  assert.deepEqual(getObservations(), {})
})

test('损坏的观测数据备份原件、保留有效记录，并可继续记录', () => {
  const dir = tempDir()
  const file = path.join(dir, 'signin-windows.json')
  const validTime = Date.now() - 120000
  const raw = JSON.stringify({ good: { samples: [validTime, 'bad'], updatedAt: 1 }, bad: { samples: 'bad' } })
  fs.writeFileSync(file, raw)
  initWindowStore(dir)
  assert.deepEqual(getObservations().good, [validTime])
  assert.equal(getObservations().bad, undefined)
  const backup = fs.readdirSync(dir).find(name => name.startsWith('signin-windows.json.corrupt-'))
  assert.ok(backup)
  assert.equal(fs.readFileSync(path.join(dir, backup), 'utf8'), raw)
  recordSigninTime('bad', Date.now())
  assert.equal(getObservations().bad.length, 1)
  recordSigninTime('bad', NaN)
  assert.equal(getObservations().bad.length, 1)
})
