// 验证钉钉企业应用凭据是否配对正确（只调 gettoken，不写任何配置）
const CLIENT_ID = 'RRRRRRRRRRRRRRRRRRRR'
const CLIENT_SECRET = process.env.DT_SECRET || ''

;(async () => {
  if (!CLIENT_SECRET) { console.log('缺少 DT_SECRET'); process.exit(1) }
  console.log(`ClientID: ${CLIENT_ID}`)
  console.log(`Secret 长度: ${CLIENT_SECRET.length}，首尾: ${CLIENT_SECRET.slice(0, 6)}…${CLIENT_SECRET.slice(-6)}`)
  try {
    const r = await fetch(`https://oapi.dingtalk.com/gettoken?appkey=${encodeURIComponent(CLIENT_ID)}&appsecret=${encodeURIComponent(CLIENT_SECRET)}`)
    const t = await r.text()
    let j = null
    try { j = JSON.parse(t) } catch { /* 非 JSON */ }
    if (j && j.errcode === 0 && j.access_token) {
      console.log('\n✅ 凭据正确，成功换取 access_token')
      console.log(`   access_token 长度: ${j.access_token.length}，有效期: ${j.expires_in} 秒`)
      // 顺带验证：用这个 token 能否访问 Stream 网关所需的接口（只读，不建立连接）
      console.log('\n=== 顺带验证：机器人相关接口可达性（只读）===')
      try {
        const g = await fetch('https://api.dingtalk.com/v1.0/gateway/connections/open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // 故意用不完整的 body，只为看错误码是否指向"参数/鉴权"而非"域名不可达"
          body: JSON.stringify({ clientId: CLIENT_ID, clientSecret: 'x', subscriptions: [] }),
        })
        const gt = await g.text()
        console.log(`   Stream 网关 HTTP ${g.status}: ${gt.slice(0, 200)}`)
        console.log('   （能返回结构化错误即说明网关可达、且 SDK 走的正是这个接口）')
      } catch (e) {
        console.log(`   Stream 网关请求异常: ${e.message}`)
      }
    } else {
      console.log(`\n❌ 凭据不正确: errcode=${j?.errcode} ${j?.errmsg}`)
      console.log('   40096/40089 = appKey 或 appSecret 不对（请确认复制的是 Client Secret 完整值）')
      process.exit(1)
    }
  } catch (e) {
    console.log('请求异常:', e.message)
    process.exit(1)
  }
})()
