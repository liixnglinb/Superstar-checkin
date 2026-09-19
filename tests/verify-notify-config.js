// 用真实 config.yaml 验证：通知渠道是否被正确加载，并通过软件自身的通知模块发一条
const fs = require('fs')
const YAML = require('yaml')

const c = YAML.parse(fs.readFileSync('config.yaml', 'utf-8'))
console.log('=== 配置核对 ===')
console.log('  YAML 解析成功；账号', c.accounts.length, '个；web.host =', c.web.host)
const on = c.notify.channels.filter(x => x.enabled)
console.log('  已启用渠道:', on.map(x => x.type).join(', ') || '(无)')
const d = c.notify.channels.find(x => x.type === 'dingtalk')
console.log('  钉钉 webhook 尾部:', String(d.config.webhook).slice(-12))
console.log('  钉钉 secret 前缀:', String(d.config.secret).slice(0, 8))
console.log('  中文完好（pushplus 示例）:', c.notify.channels.find(x => x.type === 'pushplus').config.token)

const { NotificationManager } = require('../build/notifiers')
const m = new NotificationManager(c.notify.channels, { desktop: c.notify.desktop, quiet: c.notify.quiet })
console.log('\n=== 通知模块加载结果 ===')
console.log('  已注册通道:', Array.from(m.notifiers.keys()).join(', '))

console.log('\n=== 通过软件自身的通知模块发送测试 ===')
m.notify('【学习通自动签到】通知已接入', '检测到签到、签到结果、日报都会推送到这里。')
  .then(() => {
    console.log('  ✅ 发送完成，请查看手机钉钉')
    process.exit(0)
  })
  .catch(e => {
    console.error('  ❌ 发送失败:', e.message)
    process.exit(1)
  })
