/**
 * 钉钉图片通道的消息解析测试。
 *
 * 为什么单独测这个：钉钉机器人消息有多种形态（官方 FAQ 的 richText、Stream 模式常见的
 * content.richText、单图 picture），解析错的后果是**静默收不到图片** ——
 * 日志里什么都没，你在群里发了图却毫无反应，很难排查。
 */
const test = require('node:test')
const assert = require('node:assert')

const { extractImageCodes } = require('../build/listeners/dingtalk-listener.js')

test('形态①：官方 FAQ 的富文本结构 { richText: [...] }', () => {
  const msg = {
    msgtype: 'richText',
    senderNick: '小明',
    richText: [
      { text: '@机器人' },
      { pictureDownloadCode: 'CODE_A', downloadCode: 'DL_A', type: 'picture' },
    ],
  }
  const imgs = extractImageCodes(msg)
  assert.equal(imgs.length, 1)
  assert.equal(imgs[0].pictureDownloadCode, 'CODE_A')
  assert.equal(imgs[0].from, '小明')
})

test('形态②：Stream 模式常见的 { content: { richText: [...] } }', () => {
  const msg = {
    msgtype: 'richText',
    senderStaffId: 'staff-1',
    content: {
      richText: [
        { text: '看这个' },
        { pictureDownloadCode: 'CODE_B', type: 'picture' },
      ],
    },
  }
  const imgs = extractImageCodes(msg)
  assert.equal(imgs.length, 1, '应能从 content.richText 里取到图片')
  assert.equal(imgs[0].pictureDownloadCode, 'CODE_B')
  assert.equal(imgs[0].from, 'staff-1', '没有昵称时应退回 senderStaffId')
})

test('形态③：单张图片消息 { msgtype: "picture", content: { downloadCode } }', () => {
  const msg = { msgtype: 'picture', senderNick: '小红', content: { downloadCode: 'DL_C' } }
  const imgs = extractImageCodes(msg)
  assert.equal(imgs.length, 1)
  assert.equal(imgs[0].pictureDownloadCode, 'DL_C')
})

test('一条消息里的多张图片全部取出（同学连发几张的场景）', () => {
  const msg = {
    msgtype: 'richText',
    senderNick: '同学',
    content: {
      richText: [
        { pictureDownloadCode: 'C1' },
        { text: '还有这张' },
        { pictureDownloadCode: 'C2' },
        { downloadCode: 'C3' },
      ],
    },
  }
  const imgs = extractImageCodes(msg)
  assert.deepEqual(imgs.map(i => i.pictureDownloadCode), ['C1', 'C2', 'C3'])
})

test('纯文字消息不产生图片项（不应误判）', () => {
  const msg = { msgtype: 'text', senderNick: '老师', text: { content: '大家签到' } }
  assert.deepEqual(extractImageCodes(msg), [])
})

test('异常输入不抛错（消息格式变了也不能把服务打挂）', () => {
  for (const bad of [null, undefined, '', 0, 'not-json', [], { richText: 'nope' }, { content: null }]) {
    assert.deepEqual(extractImageCodes(bad), [], `输入 ${JSON.stringify(bad)} 应返回空数组`)
  }
})

test('downloadCode 缺失或非字符串时跳过（避免把 undefined 传去下载）', () => {
  const msg = {
    msgtype: 'richText',
    richText: [
      { pictureDownloadCode: '' },
      { pictureDownloadCode: 123 },
      { pictureDownloadCode: null },
      { text: '只有文字' },
    ],
  }
  assert.deepEqual(extractImageCodes(msg), [])
})
