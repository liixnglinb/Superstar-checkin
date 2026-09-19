// 配置核对：确认钉钉凭据写入正确（不打印完整 secret）
const fs = require('fs')
const YAML = require('yaml')

const c = YAML.parse(fs.readFileSync('config.yaml', 'utf-8'))
const d = c.dingtalk || {}
const mask = s => String(s || '').length ? `${String(s).slice(0, 6)}…${String(s).slice(-6)}（长度 ${String(s).length}）` : '(空)'

console.log('=== config.yaml 核对 ===')
console.log('  YAML 解析成功；账号', c.accounts.length, '个；web.host =', c.web.host)
console.log('  dingtalk.appKey    :', d.appKey || '(空)')
console.log('  dingtalk.appSecret :', mask(d.appSecret))
console.log('  dingtalk.stream    :', JSON.stringify(d.stream))
console.log('  已启用通知渠道     :', c.notify.channels.filter(x => x.enabled).map(x => x.type).join(', ') || '(无)')
console.log('  中文完好（抽查）   :', c.notify.channels.find(x => x.type === 'pushplus').config.token)
console.log('  web.token          :', mask(c.web.token))
const ok = d.appKey === 'RRRRRRRRRRRRRRRRRRRR' && String(d.appSecret).length === 64 && d.stream?.enabled === true
console.log(ok ? '\n✅ 钉钉 Stream 配置已就绪' : '\n❌ 配置不完整')
process.exit(ok ? 0 : 1)
