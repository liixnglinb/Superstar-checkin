// 生成开关测试用的独立配置（与真实 config.yaml 隔离）
const fs = require('fs')
const YAML = require('yaml')

const OUT = 'config.switchtest.yaml'
const src = YAML.parse(fs.readFileSync('config.yaml', 'utf-8'))
console.log('原始配置读取成功: port=%s dataDir=%s pollInterval=%s accounts=%d',
  src.web?.port, src.storage?.dataDir, src.listener?.pollInterval, (src.accounts || []).length)

const c = { ...src }
c.web = { ...(src.web || {}), port: 3458 }
c.storage = { ...(src.storage || {}), dataDir: './data-switchtest' }
c.listener = { ...(src.listener || {}), pollInterval: 8000, pollJitter: 0 }
c.smartPoll = { ...(src.smartPoll || {}), enabled: false }
c.report = { ...(src.report || {}), enabled: false, weekly: false }
c.preCheck = { ...(src.preCheck || {}), enabled: false }

fs.writeFileSync(OUT, YAML.stringify(c), 'utf-8')

// 立刻回读校验，避免"写了但没生效"这类静默失败
const back = YAML.parse(fs.readFileSync(OUT, 'utf-8'))
console.log('回读校验: port=%s dataDir=%s pollInterval=%s smartPoll=%s token=%s',
  back.web?.port, back.storage?.dataDir, back.listener?.pollInterval, back.smartPoll?.enabled,
  String(back.web?.token || '').slice(0, 8))
if (back.web?.port !== 3458 || back.storage?.dataDir !== './data-switchtest') {
  console.error('❌ 配置生成为生效，退出')
  process.exit(1)
}
console.log('✅ 测试配置已生成:', OUT)
