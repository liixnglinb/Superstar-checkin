/**
 * HTTP 边界入参校验的单元测试（build/utils/validate.js）。
 *
 * 为什么留这些用例：模块三实测发现 /api/settings 接受 99:99、5000 字符用户名、
 * file:/// 代理并静默丢弃越界值还回 ok:true；这批函数是所有写配置路由的统一闸门，
 * 任何一个放宽都会让当时的实测缺陷回归。
 */
const test = require('node:test')
const assert = require('node:assert')

const {
  textField, requiredText, intInRange, timeOfDay,
  minutesOf, asTimeString, boolFlag, proxyUrl, BadRequestError,
} = require('../build/utils/validate.js')

test('textField：去掉控制字符与换行（换行会破坏单行字段与 YAML）', () => {
  assert.equal(textField('a\u0000b\u001Fc', '字段', 10), 'abc')
  assert.equal(textField('a\r\nb', '字段', 10), 'a b')
  assert.equal(textField('  x  ', '字段', 10), 'x')
})

test('textField：超长必须报错而不是静默截断（截断会让用户以为存了全文）', () => {
  assert.throws(() => textField('x'.repeat(65), '账号', 64), /最长 64/)
})

test('textField：密码模式不 trim 首尾空格（可能是真实密码的一部分）', () => {
  assert.equal(textField(' p ', '密码', 10, { trim: false }), ' p ')
})

test('textField：数字可以接受，对象不行', () => {
  assert.equal(textField(13800000000, '账号', 64), '13800000000')
  assert.throws(() => textField({ a: 1 }, '账号', 64), BadRequestError)
})

test('requiredText：空与纯空格都拒绝', () => {
  assert.throws(() => requiredText('', '账号', 64), /账号不能为空/)
  assert.throws(() => requiredText('   ', '账号', 64), /账号不能为空/)
})

test('intInRange：空值返回 null 表示「本次未提交」，而不是当成 0', () => {
  assert.equal(intInRange('', '字段', 1, 10), null)
  assert.equal(intInRange(undefined, '字段', 1, 10), null)
  assert.equal(intInRange(null, '字段', 1, 10), null)
})

test('intInRange：小数四舍五入、越界与非法值明确报错（旧实现静默丢弃还报保存成功）', () => {
  assert.equal(intInRange('25.4', '字段', 10, 600), 25)
  assert.throws(() => intInRange(0, '轮询间隔', 10, 600), /10~600/)
  assert.throws(() => intInRange('abc', '字段', 1, 10), /必须是数字/)
  assert.throws(() => intInRange({ a: 1 }, '字段', 1, 10), /必须是数字/)
})

test('timeOfDay：合法时间归一化为两位 HH:MM', () => {
  assert.equal(timeOfDay('23:00', '开始'), '23:00')
  assert.equal(timeOfDay('9:05', '开始'), '09:05')
  assert.equal(timeOfDay('', '开始'), null)
})

test('timeOfDay：99:99 / abc / 25:00 都拒绝（旧实现照收，免打扰窗口被算错）', () => {
  assert.throws(() => timeOfDay('99:99', '开始'), /有效时间/)
  assert.throws(() => timeOfDay('abc', '开始'), /HH:MM/)
  assert.throws(() => timeOfDay('23:60', '开始'), /有效时间/)
})

test('minutesOf：非法值返回 NaN（调用方必须显式处理，不能参与比较）', () => {
  assert.equal(minutesOf('23:00'), 1380)
  assert.equal(minutesOf('00:00'), 0)
  assert.ok(Number.isNaN(minutesOf('99:99')))
  assert.ok(Number.isNaN(minutesOf('abc')))
  assert.ok(Number.isNaN(minutesOf(undefined)))
})

test('asTimeString：YAML 1.1 把 23:00 读成 1380 的场景要还原（实测 PyYAML 行为）', () => {
  assert.equal(asTimeString(1380, '07:00'), '23:00')
  assert.equal(asTimeString(0, '07:00'), '00:00')
  assert.equal(asTimeString('7:00', '07:00'), '7:00', '合法但非两位的输入按原样透传（minutesOf 认可）')
  assert.equal(asTimeString('25:00', '07:00'), '07:00')
  assert.equal(asTimeString(undefined, '07:00'), '07:00')
})

test('boolFlag：字符串 "false" 必须是 false（!! 写法会把非空字符串当 true）', () => {
  assert.equal(boolFlag(false, '开关'), false)
  assert.equal(boolFlag('false', '开关'), false)
  assert.equal(boolFlag('0', '开关'), false)
  assert.equal(boolFlag(0, '开关'), false)
  assert.equal(boolFlag('', '开关'), false)
  assert.equal(boolFlag(undefined, '开关'), false)
  assert.equal(boolFlag('true', '开关'), true)
  assert.equal(boolFlag('1', '开关'), true)
  assert.equal(boolFlag(1, '开关'), true)
  assert.throws(() => boolFlag('yes', '开关'), /true\/false/)
})

test('proxyUrl：host:port 简写与带凭据的 http(s) 都接受，file:// 与非法端口拒绝', () => {
  assert.equal(proxyUrl('127.0.0.1:7890'), '127.0.0.1:7890')
  assert.equal(proxyUrl('http://user:pass@1.2.3.4:8080'), 'http://user:pass@1.2.3.4:8080')
  assert.equal(proxyUrl(''), '')
  assert.throws(() => proxyUrl('file:///etc/passwd'), /http\/https/)
  assert.throws(() => proxyUrl('ftp://x'), /http\/https/)
  assert.throws(() => proxyUrl('http://h:99999'), BadRequestError, 'URL 解析层就拒绝越界端口（无论哪条错误文案）')
  assert.throws(() => proxyUrl('http://' + 'x'.repeat(300)), /最长 256/)
})
