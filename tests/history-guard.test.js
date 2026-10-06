/**
 * 签到历史字段容错与清空备份测试（build/handlers/checkin-handler.js）。
 *
 * 为什么留这些用例：模块三实测发现 checkinHistory 被改坏成字符串后
 * this.history.push 会抛 TypeError（签到流程中途炸），且「清空记录」原本不可恢复。
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const os = require('os')

const storage = require('../build/providers/storage.js')
const { CheckinHandler } = require('../build/handlers/checkin-handler.js')

function makeEnv(seedHistory) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-hist-'))
  fs.writeFileSync(
    path.join(dataDir, 'superstar-data.json'),
    JSON.stringify(seedHistory === undefined ? {} : { checkinHistory: seedHistory }),
    'utf8',
  )
  storage.initStorage(dataDir)
  const config = {
    storage: { dataDir },
    checkin: { verify: { enabled: false }, antiDetect: { enabled: false } },
    geo: { locations: [], providers: {}, locationRadius: 10 },
  }
  return { dataDir, handler: new CheckinHandler(config, {}) }
}

const rec = (name) => ({ courseName: name, success: true, message: '签到成功', type: 'normal', timestamp: Date.now(), time: 't' })

test('checkinHistory 是字符串：不炸、按空记录启动、原件隔离', () => {
  const { dataDir, handler } = makeEnv('not-a-list')
  assert.deepEqual(handler.getHistory(), [])
  const quarantines = fs.readdirSync(dataDir).filter((f) => f.includes('.corrupt-'))
  assert.equal(quarantines.length, 1)
})

test('checkinHistory 混入坏元素：好的保留、坏的忽略', () => {
  const { handler } = makeEnv([rec('正常课'), '垃圾', null, 3])
  const list = handler.getHistory()
  assert.equal(list.length, 1)
  assert.equal(list[0].courseName, '正常课')
})

test('合法历史：原样加载，倒序返回', () => {
  const { handler } = makeEnv([rec('课A'), rec('课B')])
  const list = handler.getHistory()
  assert.equal(list.length, 2)
  assert.equal(list[0].courseName, '课B', '最新在前')
})

test('清空历史：先备份且备份可读，然后内存与存储都清零', async () => {
  const { dataDir, handler } = makeEnv([rec('课A'), rec('课B')])
  const backup = handler.clearHistory()
  assert.ok(backup && fs.existsSync(backup), '必须返回备份文件路径')
  const backupList = JSON.parse(fs.readFileSync(backup, 'utf8'))
  assert.equal(backupList.length, 2)
  assert.deepEqual(handler.getHistory(), [])
})

test('没有历史时清空：无需备份，返回空串', () => {
  const { handler } = makeEnv(undefined)
  assert.equal(handler.clearHistory(), '')
  assert.deepEqual(handler.getHistory(), [])
})
