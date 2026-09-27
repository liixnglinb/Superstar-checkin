/**
 * UI 渲染校验（开发辅助脚本，不参与打包）
 *
 * 目的：控制台页面是一整段模板字符串生成的单页 HTML，CSS/JS 混在同一文件里，
 * 手改样式时很容易出现括号错位或脚本语法错误——这类问题在浏览器里表现为
 * 「页面能用但部分样式/交互悄悄失效」，不易察觉。此脚本直接构建页面并校验：
 *   1. <style> 块花括号是否配平（含 @media 嵌套）；
 *   2. 每个 <script> 块能否通过 Node 语法检查；
 *   3. 关键元素/钩子（FAB、状态条、导航项）是否存在于产物中。
 *
 * 用法: node scripts/validate-ui.js [--html-only]
 * 退出码 0 = 全部通过，1 = 存在问题。
 */
const { getConsolePage } = require('../build/server/console-ui')
const { DingTalkServer } = require('../build/server/dingtalk-server')

let failures = 0
function check(name, ok, detail) {
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`[${mark}] ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) failures++
}

/** 花括号配平检查（忽略字符串/注释内的括号，够用且不误报） */
function braceBalance(css) {
  const stripped = css
    .replace(/\/\*[\s\S]*?\*\//g, '')   // 注释
    .replace(/"[^"]*"/g, '""')
    .replace(/'[^']*'/g, "''")
  let depth = 0
  for (const ch of stripped) {
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth < 0) return -1 }
  }
  return depth
}

const status = {
  version: '0.0.0-test',
  mode: 'hybrid',
  port: 3456,
  accounts: [{ username: '13800000000', name: '测试账号', schoolname: '测试大学' }],
  courses: [{ courseName: '测试课程', courseId: 1, classId: 2 }],
  watchCourses: [],
  trend: [],
  courseStats: [],
  recent: [],
  recordCount: 0, successCount: 0, failCount: 0,
  cookieValid: true, imConnected: true, qrPending: true,
  todayStats: { total: 0, success: 0, fail: 0 },
  notifyDesktop: true,
  quiet: { enabled: false, start: '23:00', end: '07:00' },
  report: { enabled: true, hour: 22, weekly: true },
  preCheck: { enabled: true, hour: 7 },
  smartPoll: { enabled: true, dayStart: 8, dayEnd: 22, nightMultiplier: 3 },
  humanDelay: { enabled: false, minSeconds: 30, maxSeconds: 300 },
  confirmBefore: { enabled: false, waitSeconds: 10 },
}

// 服务端总会带 nonce，这里照做，否则校验的是「无 CSP 的另一种产物」
const html = getConsolePage(status, 'test-token', { scriptNonce: 'test-nonce' })

// 1. CSS 括号配平
const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1])
check('页面含 <style> 块', styles.length > 0, `${styles.length} 个`)
styles.forEach((css, i) => {
  const d = braceBalance(css)
  check(`CSS 第 ${i + 1} 块花括号配平`, d === 0, d === 0 ? '' : `未闭合层级=${d}`)
})

// 2. script 语法检查
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1])
check('页面含 <script> 块', scripts.length > 0, `${scripts.length} 个`)
scripts.forEach((code, i) => {
  try {
    // eslint-disable-next-line no-new-func
    new Function(code)
    check(`JS 第 ${i + 1} 块语法正确`, true)
  } catch (e) {
    check(`JS 第 ${i + 1} 块语法正确`, false, e.message)
  }
})

// 3. 关键钩子存在性
const hooks = [
  ['id="fabQr"', '移动端 FAB'],
  ['id="statusStrip"', '顶部状态条'],
  ['id="chipCookie"', '登录状态胶囊'],
  ['id="chipQr"', '二维码待签胶囊'],
  ['id="footDot"', '侧栏运行指示'],
  ['id="pageSub"', '页面副标题'],
  ['id="btnQrModal"', '二维码签到按钮'],
  ['id="qrModal"', '二维码签到弹窗'],
  ['data-view="overview"', '总览视图'],
  ['data-view="settings"', '设置视图'],
  ['class="fab"', 'FAB 样式类'],
  ['sheetIn', '移动端底部弹层动画'],
  ['id="qrMobileUrl"', '手机端上传地址'],
  ['id="qrCopyBtn"', '地址复制按钮'],
  ['id="disclaimerModal"', '免责声明弹窗'],
  ['id="disclaimerAgree"', '免责声明同意按钮'],
  ['id="disclaimerRefuse"', '免责声明拒绝按钮'],
  ['id="listenToggleBtn"', '监听总开关按钮'],
  ['id="scanNowBtn"', '立即扫描按钮'],
  ['id="ttBody"', '课表填写网格'],
]
for (const [needle, label] of hooks) {
  check(`产物包含${label}`, html.includes(needle))
}

// 4. 已移除功能不应残留在界面上
for (const [needle, label] of [['拍照', '拍照签到文案'], ['手势', '手势签到文案']]) {
  const hit = html.includes(needle)
  check(`界面不再出现「${label}」的功能入口（仅允许在 APP 手动提示中提及）`, !hit || /APP 手动|手动签到/.test(html))
}

// 5. 手机上传页（getUploadPage 为私有方法，仅用于校验渲染产物）
const uploadServer = new DingTalkServer(0, '', {})
const upload = uploadServer.getUploadPage('qr', 'nonce')
const uploadStyles = [...upload.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1])
uploadStyles.forEach((css, i) => {
  const d = braceBalance(css)
  check(`上传页 CSS 第 ${i + 1} 块配平`, d === 0, d === 0 ? '' : `未闭合层级=${d}`)
})
const uploadScripts = [...upload.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1])
uploadScripts.forEach((code, i) => {
  try {
    new Function(code)
    check(`上传页 JS 第 ${i + 1} 块语法正确`, true)
  } catch (e) {
    check(`上传页 JS 第 ${i + 1} 块语法正确`, false, e.message)
  }
})
check('上传页仅支持二维码（无 photo 分支）', !upload.includes("'photo'"))

// 6. 重复 id：getElementById 只命中第一个，第二个元素的反馈会串到别处（曾出现两个 cfgMsg）
{
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1])
  const dup = ids.filter((v, i) => ids.indexOf(v) !== i)
  check('整页无重复 id', dup.length === 0, dup.length ? `重复: ${[...new Set(dup)].join(', ')}` : '')
}

// 7. 导出类链接必须自带 token：/api/* 全在鉴权白名单里，裸链接点了就是 401
{
  const bad = [...html.matchAll(/href="(\/api\/[^"]*)"/g)].map(m => m[1]).filter(u => !u.includes('token='))
  check('导出/下载链接都带 token', bad.length === 0, bad.length ? bad.join(', ') : '')
}

// 8. 内联 <script> 必须带 nonce：CSP 是 script-src 'nonce-…'，漏了就被静默拦死（SW 注册曾因此从未生效）
{
  const noNonce = [...html.matchAll(/<script([^>]*)>/g)].filter(m => !/nonce=/.test(m[1]))
  check('所有内联 script 都带 nonce', noNonce.length === 0, `${noNonce.length} 个缺 nonce`)
}

// 9. 时刻字段必须挂到滚轮选择器（readonly + tp-field + data-tp），否则又回到「点分段才能改值」
{
  const fields = ['setQuietStart', 'setQuietEnd', 'setReportHour', 'setPreCheckHour']
  const bad = fields.filter(id => {
    const m = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))
    return !m || !/class="[^"]*tp-field/.test(m[0]) || !/readonly/.test(m[0]) || !/data-tp=/.test(m[0])
  })
  check('时刻字段全部接入滚轮选择器', bad.length === 0, bad.length ? bad.join(', ') : '')
  check('选择器实现存在', html.includes('function tpOpen') && html.includes('function tpSync'))
}

// 10. 模板字符串里的 \d \w \s 会被 TS 模板吃掉（曾让时间解析永远不匹配），源码里一律禁止
{
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'server', 'console-ui.ts'), 'utf8')
  const hits = src.match(/(^|[^\\])\\[dwsWSDWS]/g) || []
  check('源码未使用会被模板吞掉的反斜杠类', hits.length === 0, `${hits.length} 处`)
}

// 11. 更新提示：固定位置 + 小框（环形进度、无下载箭头）+ 悬停说明 + 安装前确认
{
  check('更新固定提示存在（状态条 chip）', html.includes('id="chipUpdate"'))
  check('更新小框存在（环形进度）', html.includes('id="updBox"') && html.includes('id="updRing"') && html.includes('id="updPct"'))
  check('更新悬停说明存在', html.includes('id="updHover"') && html.includes('id="updHoverBody"'))
  // 小框刻意不用下载箭头：它的 SVG 里只允许 circle（环形进度），不许出现 path
  const boxSvg = (html.match(/<div class="upd-box"[\s\S]*?<\/svg>/) || [''])[0]
  check('更新小框内没有下载箭头图标', boxSvg.length > 0 && !/<path/.test(boxSvg))
  const uiSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'server', 'console-ui.ts'), 'utf8')
  // 交互顺序：点小框/芯片 → 直接弹「是否现在更新并重启」确认 → 确认后才下载/安装
  check('点击更新入口直接弹确认框（不是先开面板）', /updBox\.addEventListener\('click',function\(\)\{showUpdateConfirm\(\)\}\)/.test(uiSrc))
  check('确认框问的是「是否现在更新并重启」', /是否现在更新并重启/.test(uiSrc))
  check('确认后才开始下载，下完自动接安装', /updInstallIntent=true/.test(uiSrc) && /if\(s\.phase==='ready'&&updInstallIntent\)/.test(uiSrc))
  const mainSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'electron', 'main.js'), 'utf8')
  check('下载源按实测速度排序（不是取第一个能连通的）', /sort\(\(a, b\) => b\.bps - a\.bps\)/.test(mainSrc))
  check('下载失败会降级到下一个源', /rankedSources\.length - 1\) continue/.test(mainSrc))
  check('检测到新版本不擅自下载', !/^\s*startUpdateDownload\(\)\.catch/m.test(mainSrc))
}

console.log(failures === 0 ? '\n全部校验通过 ✓' : `\n${failures} 项校验失败 ✗`)
process.exit(failures === 0 ? 0 : 1)
