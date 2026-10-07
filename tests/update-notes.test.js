// 更新说明纯文本化 + 下载前必须先 check 的静态回归守卫
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { updateNotesToPlainText } = require('../electron/update-utils.cjs')

const MD = [
  '### v3.11.0（数据不丢 + 安全加固 + 启动提速）',
  '',
  '**你的数据更难丢了**',
  '',
  '- 数据文件损坏时不再启动失败：原文件另存为 `superstar-data.json.corrupt-<时间>`',
  '- 详情见 [更新日志](https://lxlrwxs.top/checkin/) 与 ![截图](http://x/y.png)',
  '',
  '> 提示：备份保留最近 5 份',
  '',
  '---',
  '',
  '```',
  'npm run build',
  '```',
].join('\n')

test('markdown 装饰全部去掉', () => {
  const out = updateNotesToPlainText(MD)
  for (const bad of ['###', '**', '`', '> ', '```', '![', '[更新日志]']) {
    assert.ok(!out.includes(bad), `残留 ${bad}：\n${out}`)
  }
})

test('内容不丢：标题文字、列表项、链接地址都还在', () => {
  const out = updateNotesToPlainText(MD)
  assert.ok(out.includes('v3.11.0（数据不丢 + 安全加固 + 启动提速）'))
  assert.ok(out.includes('- 数据文件损坏时不再启动失败'))
  assert.ok(out.includes('更新日志（https://lxlrwxs.top/checkin/）'))
  assert.ok(out.includes('提示：备份保留最近 5 份'))
  assert.ok(out.includes('npm run build'))
  assert.ok(!out.includes('y.png'), '图片应整段去掉')
  assert.ok(!out.includes('---'), '分割线应去掉')
})

test('纯文本原样通过且幂等', () => {
  const plain = '修了两个崩溃。\n- 第一条\n- 第二条'
  assert.equal(updateNotesToPlainText(plain), plain)
  assert.equal(updateNotesToPlainText(updateNotesToPlainText(MD)), updateNotesToPlainText(MD))
})

test('空值与非字符串不炸', () => {
  for (const v of ['', null, undefined, 0, {}, []]) {
    assert.equal(typeof updateNotesToPlainText(v), 'string')
  }
  assert.equal(updateNotesToPlainText('   \n  '), '')
})

test('斜体不吞掉列表符号', () => {
  assert.equal(updateNotesToPlainText('- *强调* 内容'), '- 强调 内容')
  assert.equal(updateNotesToPlainText('*单星号斜体*'), '单星号斜体')
})

// 下面两条是拿 v3.11.1 自己的发布正文测出来的：第一版实现把这两处做错了。
test('行内代码里的字面装饰符要原样留着（正文就是在解释装饰符本身）', () => {
  const src = '以前说明里会出现 `###`、`**` 这类记号，看着像乱码。'
  const out = updateNotesToPlainText(src)
  assert.ok(out.includes('###'), out)
  assert.ok(out.includes('**'), out)
  assert.ok(!out.includes('`'), '反引号本身要去掉：' + out)
  assert.ok(out.includes('这类记号'), out)
})

test('两个小标题的 ** 不许跨行配对（否则结尾会剩一个孤立 **）', () => {
  const src = '**标题一**\n\n中间提到 `**` 这个记号。\n\n**标题二**'
  const out = updateNotesToPlainText(src)
  assert.ok(out.startsWith('标题一'), out)
  assert.ok(out.includes('标题二'), '标题二 前不该被当成加粗内容吞掉：' + out)
  assert.ok(!out.includes('标题二**'), '结尾残留孤立 **：' + out)
  assert.equal(out.split('\n').filter((l) => /\*\*$/.test(l)).length, 0, out)
})

// —— 下载链守卫：v3.8.0~v3.11.0 的实测故障就是少了这一步 ——
test('main.js 里 downloadUpdate 之前必须先 checkForUpdates', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8')
  const at = src.indexOf('async function startUpdateDownload')
  assert.ok(at > 0, '找不到 startUpdateDownload')
  const body = src.slice(at, src.indexOf('\n  autoUpdater.on(', at))
  const c = body.indexOf('autoUpdater.checkForUpdates()')
  const d = body.indexOf('autoUpdater.downloadUpdate()')
  assert.ok(c > 0, '下载前没有调用 checkForUpdates —— electron-updater 会直接抛 "Please check update first"')
  assert.ok(d > 0, '没有 downloadUpdate 调用')
  assert.ok(c < d, 'checkForUpdates 必须在 downloadUpdate 之前')
  assert.ok(body.includes('setFeedURL'), '换源时应重设 feed')
  assert.ok(/isUpdateAvailable/.test(body), 'check 无结果时要能降级到下一个源')
})
