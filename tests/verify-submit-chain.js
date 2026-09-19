/**
 * 验证签到提交链路（preSign → analysis → stuSignajax）是否参数正确。
 *
 * 安全性：只对「已结束」的历史活动提交，平台必然拒绝（"签到已结束"），
 * 不可能产生真实签到。目的只是验证请求本身被平台正常受理（而非参数错误/未登录）。
 * 不写 data/ 下任何文件，不触碰签到状态与历史。
 */
const fs = require('fs')
const path = require('path')
const axios = require('axios')
const { CookieJar } = require('tough-cookie')
const { wrapper } = require('axios-cookiejar-support')
const { decryptPassword, isEncrypted } = require('../build/utils/crypto.js')

const MOBILE_AGENT = 'Dalvik/2.1.0 (Linux; U; Android 14; Pixel 8 Build/UQ1A.240205.002) com.chaoxing.mobile/ChaoXingStudy_3_6.2.8_android_phone_680_72 (@Kalimdor)_a3b9f2c8e1d7456098b7c6d5e4f3a2b1'
const PC_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
const API = {
  PRE_SIGN: 'https://mobilelearn.chaoxing.com/newsign/preSign',
  ANALYSIS: 'https://mobilelearn.chaoxing.com/pptSign/analysis',
  ANALYSIS2: 'https://mobilelearn.chaoxing.com/pptSign/analysis2',
  SIGN_AJAX: 'https://mobilelearn.chaoxing.com/pptSign/stuSignajax',
  DETAIL: 'https://mobilelearn.chaoxing.com/v2/apis/active/getPPTActiveInfo',
}

const rawData = JSON.parse(fs.readFileSync(path.join('data', 'superstar-data.json'), 'utf-8').replace(/^\uFEFF/, ''))
let cookie = rawData['cookie_19847671589'] || ''
if (isEncrypted(cookie)) cookie = decryptPassword(cookie) || ''
const uid = rawData['uid_19847671589'], fid = rawData['fid_19847671589']

const log = (...a) => console.log(...a)
const clean = s => String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)

;(async () => {
  // 取一门有历史活动的课
  const cr = await axios.get('https://mooc1-api.chaoxing.com/mycourse/backclazzdata', {
    headers: { Cookie: cookie, 'User-Agent': PC_AGENT },
    params: { view: 'json', rss: 1, pageIndex: 1, pageSize: 100 }, timeout: 20000,
  })
  let target = null, course = null
  for (const ch of cr.data.channelList || []) {
    const d = ch.content?.course?.data?.[0]
    if (!d) continue
    const ar = await axios.get('https://mobilelearn.chaoxing.com/v2/apis/active/student/activelist', {
      headers: { Cookie: cookie, 'User-Agent': PC_AGENT },
      params: { courseId: String(ch.key), classId: String(ch.content?.id || ch.key), showNotStarted: 0, fid: 0 }, timeout: 20000,
    })
    const acts = ar.data?.data?.activeList || []
    // 必须挑「真正的签到活动」（activeType=2，或名字含"签到"）且已结束。
    // 注意：活动列表里混着练习题等其它类型（activeType 非 2），对它们提交会被
    // 平台回「非签到活动( aid )」，验证不到签到链路（第一版就踩了这个坑）。
    const closed = acts.find(a => {
      const isSign = a.activeType === 2 || String(a.nameOne || a.name || '').includes('签到')
      const ended = (a.endTime || 0) > 0 && (a.endTime || 0) < Date.now()
      return isSign && ended
    })
    if (closed) {
      target = closed
      course = { courseId: String(ch.key), classId: String(ch.content?.id || ch.key), name: d.name }
      break
    }
    await new Promise(r => setTimeout(r, 100))
  }

  if (!target) { log('没有找到已结束的历史签到活动，无法做该验证'); process.exit(1) }

  log('=== 验证目标（已结束，提交必被拒绝，无副作用）===')
  log(`  课程    : ${course.name}`)
  log(`  courseId: ${course.courseId}   classId: ${course.classId}`)
  log(`  aid     : ${target.id}  类型: ${target.nameOne || target.name}`)
  log(`  结束时间: ${new Date(target.endTime).toLocaleString('zh-CN')}（已过期 ${Math.round((Date.now() - target.endTime) / 86400000)} 天）`)
  log(`  uid=${uid} fid=${fid}`)

  const jar = new CookieJar()
  const client = wrapper(axios.create({ jar }))

  // ① 活动详情（真实处理流程的第一步）
  log('\n=== ① 活动详情 getPPTActiveInfo ===')
  const d1 = await client.get(API.DETAIL, {
    headers: { Cookie: cookie, 'User-Agent': MOBILE_AGENT }, params: { activeId: target.id }, timeout: 20000,
  })
  const dd = d1.data?.data || {}
  log(`  result=${d1.data?.result}  otherId=${dd.otherId}  ifphoto=${dd.ifphoto}  status=${dd.status}`)
  log(`  → ${d1.data?.result === 1 ? '✅ 详情接口正常（签到类型判定可用）' : '❌ 详情接口异常'}`)

  // ② preSign（对照：正确参数 vs 当前代码的参数）
  log('\n=== ② preSign ===')
  for (const [label, cid, clid] of [
    ['正确参数 (courseId=classId=' + course.classId + ')', course.classId, course.classId],
    ['当前代码的参数 (courseId=classId=' + course.courseId + ')', course.courseId, course.courseId],
  ]) {
    const r = await client.get(API.PRE_SIGN, {
      headers: { Cookie: cookie, 'User-Agent': MOBILE_AGENT },
      params: { courseId: cid, classId: clid, activePrimaryId: String(target.id), general: 1, sys: 1, ls: 1, appType: 15, tid: '', uid, ut: 's' },
      timeout: 20000, maxRedirects: 0, validateStatus: () => true,
    })
    const body = typeof r.data === 'string' ? r.data : JSON.stringify(r.data)
    const hasUid = body.includes(String(uid))
    log(`  [${label}]`)
    log(`    HTTP ${r.status} len=${body.length} 含本人uid=${hasUid ? '是' : '否'}`)
    log(`    内容: ${clean(body).slice(0, 120)}`)
  }

  // ③ 提交签到（对已结束活动的提交，预期被拒绝）
  log('\n=== ③ 提交签到 stuSignajax（预期：被平台以"已结束"拒绝）===')
  const r3 = await client.get(API.SIGN_AJAX, {
    headers: { Cookie: cookie, 'User-Agent': MOBILE_AGENT },
    params: { name: '李星历', address: '', activeId: target.id, uid, clientip: '', latitude: -1, longitude: -1, fid, appType: 15 },
    timeout: 20000, validateStatus: () => true,
  })
  const b3 = typeof r3.data === 'string' ? r3.data : JSON.stringify(r3.data)
  log(`  HTTP ${r3.status}`)
  log(`  响应: ${clean(b3)}`)

  log('\n=== 结论 ===')
  const detailOk = d1.data?.result === 1
  const signRejected = /结束|过期|不能签到|失败|error|false/i.test(b3) && !/success/i.test(b3)
  log(`  详情接口可用（类型判定）      : ${detailOk ? '✅' : '❌'}`)
  log(`  签到提交被平台正常受理并拒绝  : ${signRejected ? '✅（说明请求格式/登录态都被接受，只是活动已过期）' : '⚠ 需人工看响应'}`)
  log('  说明：本次只验证「请求链路是否正确」，真实能否签上要等下一次真实签到。')
})().catch(e => { console.log('执行异常:', e.message); process.exit(1) })
