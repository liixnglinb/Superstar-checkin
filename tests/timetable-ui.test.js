const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { JSDOM } = require('jsdom')

test('课表建议保留未保存和请求期间的编辑，并标记实际新增课程', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/server/console-ui.ts'), 'utf8')
  const script = source.slice(source.indexOf('  var ttState={'), source.indexOf('  /* ===== 课表页：课程网格 ===== */'))
  const dom = new JSDOM('<div id="ttCount"></div><div id="ttCompleteBadge"></div><div id="ttProgressWrap"><div id="ttProgressBar"></div></div><div id="ttWarn"></div><div id="ttOk"></div><div id="ttMsg"></div><table><tbody id="ttBody"></tbody></table><button id="ttAutoBtn"></button><button id="ttSaveBtn"></button><button id="ttClearBtn"></button>', { runScripts: 'outside-only' })
  const { window } = dom
  window.$ = id => window.document.getElementById(id)
  window.esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
  let resolveSuggestion, submitted, saves = 0
  const response = data => ({ json: async () => data })
  window.apiFetch = (url, options) => {
    if (url === '/api/timetable') return Promise.resolve(response({ ok: true, table: { 1: [null, null] }, slots: [{ index: 0, half: 'morning', label: '1', startText: '1', endText: '2' }, { index: 1, half: 'morning', label: '2', startText: '2', endText: '3' }], weekdays: [{ value: 1 }], courses: [{ courseId: 'a', courseName: 'A' }, { courseId: 'b', courseName: 'B' }], status: { complete: false } }))
    if (url === '/api/timetable/suggest') { submitted = JSON.parse(options.body); return new Promise(resolve => { resolveSuggestion = resolve }) }
    if (url === '/api/timetable/save') { saves++; return Promise.resolve(response({ ok: true })) }
    throw new Error('Unexpected request: ' + url)
  }
  window.eval(script)
  const settle = () => new Promise(resolve => setImmediate(resolve))
  await settle()
  const cell = index => window.document.querySelector('select[data-slot="' + index + '"]')
  cell(0).value = 'a'
  cell(0).dispatchEvent(new window.Event('change', { bubbles: true }))
  window.$('ttAutoBtn').click()
  assert.equal(submitted.table['1'][0], 'a')
  cell(0).value = 'b'
  cell(0).dispatchEvent(new window.Event('change', { bubbles: true }))
  resolveSuggestion(response({ ok: true, details: [{ weekday: 1, slot: 0, courseId: 'a' }, { weekday: 1, slot: 1, courseId: 'b' }] }))
  await settle()
  assert.equal(cell(0).value, 'b')
  assert.equal(cell(1).value, 'b')
  assert.ok(cell(1).classList.contains('tt-suggested'))
  assert.match(window.$('ttCompleteBadge').textContent, /未保存/)
  assert.match(window.$('ttCompleteBadge').textContent, /兜底轮询/)
  cell(1).value = ''
  cell(1).dispatchEvent(new window.Event('change', { bubbles: true }))
  window.$('ttSaveBtn').click()
  assert.equal(saves, 0)
  assert.match(window.$('ttMsg').textContent, /填满后保存/)
  dom.window.close()
})

test('课表建议基于草稿而不修改已保存课表', () => {
  const os = require('node:os')
  const { initTimetable, suggestFromObservations, getTimetable } = require('../build/providers/timetable')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-suggest-'))
  try {
    initTimetable(dir)
    const monday = new Date()
    monday.setDate(monday.getDate() + ((1 - monday.getDay() + 7) % 7))
    monday.setHours(8, 0, 0, 0)
    const draft = { 1: ['manual', null] }
    const result = suggestFromObservations({ suggestion: [monday.getTime()] }, id => id, draft)
    assert.equal(result.table['1'][0], 'manual')
    assert.equal(result.filled, 0)
    assert.equal(getTimetable()['1'][0], null)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
