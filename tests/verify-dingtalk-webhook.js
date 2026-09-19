// 验证钉钉群机器人 webhook（含加签）是否可用
const crypto = require('crypto')

const WEBHOOK = 'https://oapi.dingtalk.com/robot/send?access_token=RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR'
const SECRET = 'RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR'

function signedUrl() {
  const timestamp = Date.now()
  const stringToSign = `${timestamp}\n${SECRET}`
  const sign = crypto.createHmac('sha256', SECRET).update(stringToSign).digest('base64')
  return `${WEBHOOK}&timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`
}

;(async () => {
  // 先测不带签名（若机器人设了加签，这样应当被拒，可用来确认加签确实生效）
  console.log('=== ① 不带签名（预期被拒，用以确认加签生效）===')
  try {
    const r = await fetch(WEBHOOK, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content: '测试（未加签）' } }),
    })
    console.log('  HTTP', r.status, await r.text())
  } catch (e) { console.log('  异常:', e.message) }

  console.log('\n=== ② 带签名（预期成功）===')
  try {
    const r = await fetch(signedUrl(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'text',
        text: { content: '【学习通自动签到】通知渠道测试\n如果你在手机上看到这条消息，说明钉钉通知已配置成功。' },
      }),
    })
    const body = await r.text()
    console.log('  HTTP', r.status, body)
    try {
      const j = JSON.parse(body)
      console.log(j.errcode === 0 ? '  ✅ 发送成功，请查看手机钉钉' : `  ❌ 发送失败: errcode=${j.errcode} ${j.errmsg}`)
    } catch { /* 非 JSON */ }
  } catch (e) { console.log('  异常:', e.message) }
})()
