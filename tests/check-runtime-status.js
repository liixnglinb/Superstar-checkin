// 读取运行中服务的状态，确认钉钉图片通道与其它开关
const fs = require('fs')

const token = (fs.readFileSync('config.yaml', 'utf-8').match(/^ {2}token: (.+)$/m) || [])[1].trim()

;(async () => {
  const r = await fetch(`http://127.0.0.1:3456/api/status?token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(8000) })
  const s = await r.json()
  console.log('=== 运行状态 ===')
  console.log('  版本            :', s.version)
  console.log('  监听模式        :', s.mode, '· 轮询间隔', Math.round(s.pollInterval / 1000) + 's')
  console.log('  账号            :', (s.accounts || []).map(a => a.name || a.username).join(', '))
  console.log('  Cookie          :', s.cookieValid ? '有效' : '失效')
  console.log('  IM 通道         :', s.imConnected ? '已连接' : '不可用（学习通已关闭）')
  console.log('')
  console.log('  --- 钉钉图片通道 ---')
  console.log('  已启用          :', s.dingtalkStreamEnabled)
  console.log('  凭据已配置      :', s.dingtalkStreamConfigured)
  console.log('  ★ 长连接已建立  :', s.dingtalkStreamConnected)
  console.log('  最近收到消息    :', s.dingtalkLastMessageAt ? new Date(s.dingtalkLastMessageAt).toLocaleString('zh-CN') : '还没收到过')
  console.log('')
  console.log('  --- 扫描与课表 ---')
  console.log('  监听总开关      :', s.listening, '· 在监听', s.listeningCount, '门')
  console.log('  可监听课程      :', (s.courses || []).length, '门（已结课已排除）')
  const st = { total: (s.courses || []).length }
  console.log('  课表状态        :', s.timetableComplete === undefined ? '(由 /api/timetable 提供)' : s.timetableComplete)
  const ok = s.dingtalkStreamEnabled && s.dingtalkStreamConfigured && s.dingtalkStreamConnected
  console.log(ok ? '\n✅ 钉钉图片通道已连接，可以发图测试了' : '\n⚠️ 通道未就绪，见上')
})().catch(e => console.log('请求失败:', e.message))
