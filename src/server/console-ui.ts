/**
 * 控制台 UI（软件主界面）
 *
 * 设计依据：taste-skill（反 AI 味设计）+ impeccable（Operate 模式质量底线）
 * - 色彩：暖白底 + 单一橙色主强调（与软件图标同款 #F78A46）；成功/错误/警告为语义色
 * - 无：渐变文字、玻璃拟态、彩色左边框、等大图标卡墙、眉毛标签、emoji 图标
 * - 图标：内联 SVG，统一 1.5 描边
 * - 动效：克制的 hover 过渡与按压反馈
 */

import { VOYRA_UI_CSS, VOYRA_UI_JS } from './voyra-ui'

export interface ConsoleStatus {
  version?: string
  mode?: string
  pollInterval?: number
  port?: number
  /** 本机局域网 IPv4（手机端访问控制台/上传页用），取不到则为空 */
  lanIp?: string
  /** 服务监听地址：127.0.0.1 时手机无法访问，界面会给出提示 */
  webHost?: string
  uptime?: number
  accounts?: Array<{ username: string; name?: string; schoolname?: string }>
  courses?: Array<{ courseName: string; courseId: number; classId: number }>
  watchCourses?: string[]
  /** 监听总开关：false 时轮询完全停止（控制台「停止监听」按钮的替代物） */
  listening?: boolean
  /** 被手动关掉监听的 courseId 列表 */
  disabledCourses?: string[]
  /** 当前实际在监听的课程数（已排除已结课与手动关闭的） */
  listeningCount?: number
  /** 每门课学到的签到活跃时段摘要（courseId -> 描述）。仅用于展示与课表自动填充，不参与扫描决策 */
  signinWindows?: Record<string, { known: boolean; text: string; samples: number }>
  /** 课程扫描健康：courseId -> 连续轮询失败次数（≥3 时 UI 显示"扫描异常"） */
  courseHealth?: Record<string, number>
  /** 签到趋势（近 14 天逐日成功/失败） */
  trend?: Array<{ date: string; success: number; fail: number }>
  courseStats?: Array<{ course: string; success: number; fail: number }>
  recent?: Array<{ time: string; courseName: string; type: string; result: string; accountName: string; timestamp?: number }>
  recordCount?: number
  successCount?: number
  failCount?: number
  cookieValid?: boolean
  imConnected?: boolean
  /** 钉钉图片通道（Stream 模式）：是否启用 / 凭据是否齐全 / 长连接是否已建立 */
  dingtalkStreamEnabled?: boolean
  dingtalkStreamConfigured?: boolean
  dingtalkStreamConnected?: boolean
  /** 最近一次收到钉钉消息的时间戳（0 表示还没收到过） */
  dingtalkLastMessageAt?: number
  qrPending?: boolean
  notifyDesktop?: boolean
  quiet?: { enabled: boolean; start: string; end: string }
  todayStats?: { total: number; success: number; fail: number }
  pollJitter?: number
  locationRadius?: number
  retryMaxAttempts?: number
  retryDelayMs?: number
  verifyEnabled?: boolean
  report?: { enabled: boolean; hour: number; weekly?: boolean }
  preCheck?: { enabled: boolean; hour: number }
  smartPoll?: { enabled: boolean; dayStart: number; dayEnd: number; nightMultiplier: number }
  humanDelay?: { enabled: boolean; minSeconds: number; maxSeconds: number }
  confirmBefore?: { enabled: boolean; waitSeconds: number }
}

const ICONS = {
  // 应用标记：与安装图标同源的小尺寸版（实心橙块 + 粗白勾）。
  // 界面里一律内联矢量，不再用 512px 位图缩到 16px —— 那正是「图标发糊」的根因。
  appMark: '<svg class="app-mark" viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="104" fill="#EF7429"/><path d="M148 264l74 78 142-168" fill="none" stroke="#fff" stroke-width="78" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  courses: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  qr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14h1M14 20h1M18 18h3v3h-3z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/></svg>',
  radio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>',
  server: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
  // 窗口控制（自绘标题栏）
  winMin: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1"><path d="M2 6h8"/></svg>',
  winMax: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1"><rect x="2.5" y="2.5" width="7" height="7"/></svg>',
  winRestore: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1"><path d="M4.5 4.5V2.5h5v5h-2"/><rect x="2.5" y="4.5" width="5" height="5"/></svg>',
  winClose: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1"><path d="M2.8 2.8l6.4 6.4M9.2 2.8l-6.4 6.4"/></svg>',
  location: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>',
  log: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h16v18H4z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/></svg>',
  // 更新：方框加号（刻意不用下载箭头——用户明确要求更新提示里不要出现下载小箭头）
  update: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8 12h8M12 8v8"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
  power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 5v6c0 5.5 3.8 9.7 8 11 4.2-1.3 8-5.5 8-11V5z"/><path d="m9 12 2 2 4-4"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
}

function esc(s: any): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fmtTime(ts: any): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (sameDay) return `今天 ${hm}`
  const yest = new Date(now.getTime() - 86400000)
  if (d.toDateString() === yest.toDateString()) return `昨天 ${hm}`
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
}

function modeText(mode: string): string {
  if (mode === 'im') return 'IM 实时监听'
  if (mode === 'poll') return '轮询监听'
  return '混合模式（轮询兜底）'
}

function typeText(t: string): string {
  const map: Record<string, string> = { normal: '普通', qr: '二维码', location: '位置' }
  return map[t] || t
}

/** 生成完整控制台单页界面 */
export function getConsolePage(status: ConsoleStatus, token: string, options?: { scriptNonce?: string }): string {
  const accounts = status.accounts || []
  const courses = status.courses || []
  const watchSet = new Set((status.watchCourses || []).map((c: any) => String(c)))
  /** 服务端已关闭监听的课程（运行时状态，优先于配置文件白名单） */
  const disabledSet = new Set((status.disabledCourses || []).map((c: any) => String(c)))
  const recent = status.recent || []
  const mode = status.mode || '-'
  const qs = token ? '?token=' + encodeURIComponent(token) : ''
  const scriptNonce = options?.scriptNonce || ''
  /**
   * 手机端访问地址：直接给出带 token 的完整 URL（页面本身已在 token 保护下，不存在额外泄露面），
   * 用户扫码/输入即可在手机上传签到码，不必手拼 token。
   */
  const webPort = status.port || 3456
  const lanHost = status.lanIp || '电脑IP'
  const mobileUploadUrl = `http://${lanHost}:${webPort}/upload${token ? '?token=' + encodeURIComponent(token) : ''}`
  /** 仅监听本机时手机连不上（最常见的新手问题），界面直接提示改法 */
  const loopbackOnly = !status.webHost || /^(127\.0\.0\.1|localhost|::1)$/.test(status.webHost)

  const accountRows = accounts.length
    ? accounts.map(a => `
      <div class="acct-row">
        <span class="acct-avatar">${esc((a.name || a.username || '?').slice(0, 1))}</span>
        <div class="acct-info">
          <div class="acct-name">${esc(a.name || a.username)}</div>
          <div class="acct-sub">${esc(a.schoolname || '')} · ${esc(a.username)}</div>
        </div>
        <span class="pill">账号已配置</span>
      </div>`).join('')
    : `<div class="empty"><p>未配置账号</p><p class="empty-sub">首次使用请在"设置"页填写你的学习通账号（支持多用户各自登录）</p><a class="btn btn-ghost" href="#settings" style="margin-top:12px">去配置账号</a></div>`

  const courseRows = courses.length
    ? courses.map(c => {
        const watching = !disabledSet.has(String(c.courseId)) && (watchSet.size === 0 || watchSet.has(String(c.courseId)))
        // 课程扫描健康：连续轮询失败 ≥3 次时提示"扫描异常"（多为瞬时网络/网关抖动，重试后自动恢复）
        const fails = (status.courseHealth || {})[String(c.courseId)] || 0
        const monitoringReady = accounts.length > 0 && status.cookieValid !== false && status.listening !== false
        const statePill = watching && !monitoringReady
          ? '<span class="pill pill-off">' + (accounts.length === 0 ? '未配置账号' : status.cookieValid === false ? '登录需核验' : '已暂停监听') + '</span>'
          : !watching
          ? '<span class="pill pill-off">已停用</span>'
          : fails >= 3
            ? '<span class="pill pill-warn" title="近期轮询多次失败，多为瞬时网络或网关限流，已自动重试；持续异常可点击「重新拉取课程列表」">扫描异常</span>'
            : '<span class="pill pill-ok">监控中</span>'
        const w = (status.signinWindows || {})[String(c.courseId)]
        const winCell = w
          ? (w.known
            ? `<span class="cell-mono" title="共 ${w.samples} 次观测；仅此时段轮询（另有每日兜底扫描）">${esc(w.text)}</span>`
            : `<span class="cell-sub" title="观测不足，暂按全天轮询；积累 ${w.samples} 次后自动收敛">${esc(w.text)}</span>`)
          : '<span class="cell-sub">—</span>'
        return `
      <tr>
        <td class="cell-main" data-label="课程">${esc(c.courseName)}</td>
        <td class="cell-mono" data-label="Course ID">${c.courseId}</td>
        <td class="cell-mono" data-label="Class ID">${c.classId}</td>
        <td data-label="签到时段">${winCell}</td>
        <td data-label="状态">${statePill}</td>
        <td data-label="监听"><button class="watch-toggle ${watching ? 'on' : ''}" data-cid="${esc(String(c.courseId))}">${watching ? '关闭监听' : '开启监听'}</button></td>
      </tr>`
      }).join('')
    : `<tr><td colspan="6" class="cell-empty">暂无课程数据</td></tr>`

  const recent2 = recent.map((r: any) => ({ ...r, timestamp: r.timestamp || r.time }))
  const recentRows = recent2.length
    ? recent.map(r => {
        const ok = /成功|✅|已签到/.test(r.result)
        const badge = ok ? '<span class="pill pill-ok">成功</span>' : '<span class="pill pill-err">失败</span>'
        return `
        <tr>
          <td class="cell-sub" data-label="时间">${esc(fmtTime(r.timestamp))}</td>
          <td class="cell-main" data-label="课程">${esc(r.courseName || '未知课程')}</td>
          <td class="cell-sub" data-label="类型">${esc(typeText(r.type))}</td>
          <td class="cell-sub" data-label="结果">${badge}</td>
        </tr>`
      }).join('')
    : `<tr><td colspan="4" class="cell-empty">还没有签到记录</td></tr>`

  const statCards = `
    <div class="stat-card">
      <div class="stat-ico" style="color:#0E7C66;background:#E3F2EC;">${ICONS.courses}</div>
      <div class="stat-num" id="stat-courses">${courses.length}</div>
      <div class="stat-label">监控课程</div>
    </div>
    <div class="stat-card">
      <div class="stat-ico" style="color:#2563EB;background:#E8EFFC;">${ICONS.history}</div>
      <div class="stat-num" id="stat-records">${status.recordCount ?? 0}</div>
      <div class="stat-label">累计记录</div>
    </div>
    <div class="stat-card">
      <div class="stat-ico" style="color:#178A5B;background:#E4F4EC;">${ICONS.check}</div>
      <div class="stat-num" id="stat-ok">${status.successCount ?? 0}</div>
      <div class="stat-label">签到成功</div>
    </div>
    <div class="stat-card">
      <div class="stat-ico" style="color:#D64545;background:#FBEBEB;">${ICONS.x}</div>
      <div class="stat-num" id="stat-fail">${status.failCount ?? 0}</div>
      <div class="stat-label">签到失败</div>
    </div>`

  const quiet = status.quiet || { enabled: false, start: '23:00', end: '07:00' }
  const settingsRows = `
    <div class="set-row"><span class="set-label">监听模式</span><span class="set-value">${esc(modeText(mode))}</span></div>
    <div class="set-row"><span class="set-label">轮询间隔</span><span class="set-value">${status.pollInterval ? status.pollInterval / 1000 + ' 秒' : '—'}</span></div>
    <div class="set-row"><span class="set-label">服务端口</span><span class="set-value">${esc(String(status.port || '—'))}</span></div>
    <div class="set-row"><span class="set-label">登录状态</span><span class="set-value">${status.cookieValid === false ? '<span class="pill pill-err">Cookie 失效</span>' : '<span class="pill pill-ok">Cookie 有效</span>'}</span></div>
    <div class="set-row"><span class="set-label">IM 通道</span><span class="set-value">${status.imConnected ? '<span class="pill pill-ok">已连接</span>' : '<span class="pill pill-warn">不可用（轮询兜底）</span>'}</span></div>
    <div class="set-row"><span class="set-label">配置文件</span><span class="set-value cell-mono">config.yaml（软件同目录，修改后重启生效）</span></div>`

  // 运行设置表单（保存到 config.yaml，重启生效）
  const settingsForm = `
    <div style="padding:16px 18px;display:flex;flex-direction:column;gap:12px;max-width:620px;box-sizing:border-box">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <label class="field-label" for="setPoll" style="width:104px">轮询间隔（秒）</label>
        <input class="field-input" id="setPoll" type="number" min="10" max="600" value="${Math.round((status.pollInterval || 30000) / 1000)}" style="width:120px">
        <span class="field-hint" style="line-height:1.5">10~600，越小发现签到越快，越频繁越可能被风控（默认 30）</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <label class="field-label" for="setJitter" style="width:104px">轮询抖动（秒）</label>
        <input class="field-input" id="setJitter" type="number" min="0" max="120" value="${Math.round(status.pollJitter || 15)}" style="width:120px">
        <span class="field-hint" style="line-height:1.5">每次轮询叠加 0~抖动 的随机延迟，避免固定节奏被风控识别（0 = 关闭）</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <label class="field-label" for="setRetry" style="width:104px">失败重试次数</label>
        <input class="field-input" id="setRetry" type="number" min="1" max="10" value="${status.retryMaxAttempts || 3}" style="width:120px">
        <label class="field-label" for="setRetryDelay" style="width:90px;margin-left:2px">重试间隔（秒）</label>
        <input class="field-input" id="setRetryDelay" type="number" min="1" max="120" value="${Math.round((status.retryDelayMs || 5000) / 1000)}" style="width:120px">
        <span class="field-hint" style="line-height:1.5">签到失败后自动重试的次数与间隔</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <label class="field-label" for="setRadius" style="width:104px">位置半径（米）</label>
        <input class="field-input" id="setRadius" type="number" min="1" max="500" value="${Math.round(status.locationRadius || 10)}" style="width:120px">
        <span class="field-hint" style="line-height:1.5">以老师发布坐标为中心生成签到点（默认 10）</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <label class="field-label" for="setDesktop" style="width:104px">桌面通知</label>
        <button class="switch ${status.notifyDesktop === false ? '' : 'on'}" id="setDesktop" type="button" role="switch"><span class="knob"></span></button>
        <span class="field-hint" style="line-height:1.5">签到成功/失败/二维码待签时弹出系统通知</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <label class="field-label" for="setQuiet" style="width:104px">免打扰时段</label>
        <button class="switch ${quiet.enabled ? 'on' : ''}" id="setQuiet" type="button" role="switch"><span class="knob"></span></button>
        <input class="field-input tp-field" id="setQuietStart" type="time" readonly data-tp="hm" inputmode="none" aria-haspopup="dialog" value="${esc(quiet.start)}" style="width:110px">
        <span class="field-hint">至</span>
        <input class="field-input tp-field" id="setQuietEnd" type="time" readonly data-tp="hm" inputmode="none" aria-haspopup="dialog" value="${esc(quiet.end)}" style="width:110px">
        <span class="field-hint" style="line-height:1.5">期间不弹桌面通知，签到照常进行</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <label class="field-label" for="setReport" style="width:104px">每日签到日报</label>
        <button class="switch ${status.report && status.report.enabled !== false ? 'on' : ''}" id="setReport" type="button" role="switch"><span class="knob"></span></button>
        <input class="field-input tp-field" id="setReportHour" type="number" readonly data-tp="h" inputmode="none" aria-haspopup="dialog" min="0" max="23" value="${(status.report && status.report.hour) || 22}" style="width:80px">
        <span class="field-hint">点推送当天签到总结（成功/失败/未成功课程）</span>
      </div>

      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <label class="field-label" for="setVerify" style="width:104px">签到后二次核对</label>
        <button class="switch ${status.verifyEnabled === false ? '' : 'on'}" id="setVerify" type="button" role="switch"><span class="knob"></span></button>
        <span class="field-hint" style="line-height:1.5">提交成功后再次查询平台确认已签到，避免"显示成功实际没签上"（默认开启）</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <label class="field-label" for="setHumanDelay" style="width:104px">模拟人类延迟</label>
        <button class="switch ${status.humanDelay?.enabled ? 'on' : ''}" id="setHumanDelay" type="button" role="switch"><span class="knob"></span></button>
        <span class="field-hint" style="line-height:1.5">检测到签到后随机等待一段时间再提交，避免秒签被怀疑</span>
        <input type="number" id="setHumanDelayMin" min="5" max="600" value="${status.humanDelay?.minSeconds ?? 30}" style="width:52px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--r-xs);font-size:var(--fs-base)">
        <span class="field-hint">~</span>
        <input type="number" id="setHumanDelayMax" min="10" max="900" value="${status.humanDelay?.maxSeconds ?? 300}" style="width:52px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--r-xs);font-size:var(--fs-base)">
        <span class="field-hint">秒</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <label class="field-label" for="setConfirmBefore" style="width:104px">签到前确认</label>
        <button class="switch ${status.confirmBefore?.enabled ? 'on' : ''}" id="setConfirmBefore" type="button" role="switch"><span class="knob"></span></button>
        <span class="field-hint" style="line-height:1.5">检测到签到后先弹通知倒计时，可点击取消，超时自动签</span>
        <input type="number" id="setConfirmWait" min="3" max="120" value="${status.confirmBefore?.waitSeconds ?? 10}" style="width:52px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--r-xs);font-size:var(--fs-base)">
        <span class="field-hint">秒</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <label class="field-label" for="setWeeklyReport" style="width:104px">每周签到周报</label>
        <button class="switch ${status.report?.weekly !== false ? 'on' : ''}" id="setWeeklyReport" type="button" role="switch"><span class="knob"></span></button>
        <span class="field-hint" style="line-height:1.5">每周日推送本周签到统计与漏签课程名单</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <label class="field-label" for="setPreCheck" style="width:104px">课前预检查</label>
        <button class="switch ${status.preCheck?.enabled !== false ? 'on' : ''}" id="setPreCheck" type="button" role="switch"><span class="knob"></span></button>
        <span class="field-hint" style="line-height:1.5">每天指定时间检查账号登录和网络，有问题提前推送</span>
        <input class="field-input tp-field" type="number" id="setPreCheckHour" readonly data-tp="h" inputmode="none" aria-haspopup="dialog" min="0" max="23" value="${status.preCheck?.hour ?? 7}" style="width:64px">
        <span class="field-hint">时</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <label class="field-label" for="setSmartPoll" style="width:104px">智能轮询</label>
        <button class="switch ${status.smartPoll?.enabled !== false ? 'on' : ''}" id="setSmartPoll" type="button" role="switch"><span class="knob"></span></button>
        <span class="field-hint" style="line-height:1.5">白天短间隔轮询，夜间3倍长间隔，减少无效请求</span>
      </div>

      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <label class="field-label" for="setAutoLaunch" style="width:104px">开机自启</label>
        <button class="switch" id="setAutoLaunch" type="button" role="switch"><span class="knob"></span></button>
        <span class="field-hint" style="line-height:1.5">开机后自动在后台运行，保证签到不中断</span>
      </div>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:4px">
        <button class="btn btn-primary" id="settingsSaveBtn">保存设置</button>
        <button class="btn btn-ghost" id="notifyTestBtn">${ICONS.bell}<span>发送测试通知</span></button>
        <button class="btn btn-ghost" id="cfgExportBtn">${ICONS.download}<span>导出配置</span></button>
        <button class="btn btn-ghost" id="cfgImportBtn">${ICONS.upload}<span>导入配置</span></button>
        <input type="file" id="cfgFileInput" accept=".json" style="display:none">
        <span class="cfg-msg" id="cfgMsg"></span>
        <span class="cfg-msg" id="settingsMsg"></span>
      </div>
    </div>`

  // 账号管理：列表 + 添加表单
  const accountRows2 = accounts.length
    ? accounts.map((a, i) => `
      <div class="acct-row">
        <span class="acct-avatar">${esc((a.name || a.username || '?').slice(0, 1))}</span>
        <div class="acct-info">
          <div class="acct-name">${esc(a.name || a.username)}${i === 0 ? ' <span class="pill pill-ok">主账号</span>' : ''}</div>
          <div class="acct-sub">${esc(a.schoolname || '')} · ${esc(a.username)}</div>
        </div>
        ${i === 0 ? '' : `<button class="btn btn-ghost btn-sm" data-primary="${esc(a.username)}">设为主账号</button>`}
        <button class="btn btn-ghost btn-sm btn-danger" data-remove="${esc(a.username)}">${ICONS.trash}<span>删除</span></button>
      </div>`).join('')
    : `<div class="empty"><p>未配置账号</p><p class="empty-sub">添加学习通账号后，软件会用它自动签到（支持多账号，全部账号都会签到）</p></div>`

  const accountManageBox = `
    <div id="accountList">${accountRows2}</div>
    <div style="padding:16px 18px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:12px;max-width:520px;box-sizing:border-box">
      <div style="font-size:var(--fs-sm);font-weight:var(--fw-semibold);color:var(--text-2)">添加账号</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <input class="field-input" id="cfgUsername" type="text" placeholder="学习通账号（手机号）" autocomplete="off" style="width:100%">
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <input class="field-input" id="cfgPassword" type="password" placeholder="密码" style="width:100%">
      </div>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <button class="btn btn-primary" id="cfgSaveBtn">添加账号</button>
        <span class="cfg-msg" id="accountMsg"></span>
      </div>
      <p class="field-hint">添加/删除/切换主账号后需重启软件生效。第一个账号（主账号）负责课程轮询监听，所有账号都会自动签到。账号保存在 config.yaml，请妥善保管。</p>
    </div>`

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>学习通自动签到</title>
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#F27B34">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="学习通签到">
<link rel="apple-touch-icon" href="/assets/app-icon-192.png">
<style>
*{margin:0;padding:0;box-sizing:border-box}
/* ===================================================================
   设计系统 v2 —— 命名与层次参照 Design Tokens 规范
   风格定位：Clean UI / Flat 3.0 为基底（信息密度优先），
   以「克制的玻璃拟态（仅导航/浮层模糊）+ 多层精细阴影 + 顶部内高光」提供质感。
   刻意不采用 Neumorphism —— 其对比度接近 1:1，不可用于主操作按钮与表单标签。
   GPU 成本已控制：全页面仅 2 处 backdrop-filter。
   =================================================================== */
:root{
  /* --- 中性色阶：暖白底 + 柔和灰阶 --- */
  --n-0:#FFFFFF;    /* 卡片表面（最高层） */
  --n-25:#FBFAF7;
  --n-50:#F6F5F1;   /* 页面画布 */
  --n-100:#EFEDE7;  /* 次级表面 */
  --n-150:#E6E3DB;  /* 三级表面 / 悬停 */
  --n-200:#DDD9CF;  /* 边框 */
  --n-250:#CFC9BC;
  --n-300:#BDB6A6;  /* 强边框 */
  --n-400:#9C9482;  /* 禁用 / 占位文字 */
  --n-500:#7C7463;  /* 三级文字 */
  --n-600:#5A5344;  /* 二级文字 */
  --n-700:#3A352B;  /* 次级标题 */
  --n-800:#191712;  /* 主文字 */

  /* --- 主色（暖橙）完整色阶：50 → 800 --- */
  --a-50:#FFF8F2;
  --a-100:#FFEEDD;
  --a-200:#FFD8B8;
  --a-300:#FCBB8B;
  --a-400:#F79C5D;
  --a-500:#F27B34;  /* 品牌主色 */
  --a-600:#DD661F;
  --a-700:#B95317;
  --a-800:#8E4112;

  /* --- 语义色：各含 weak / normal / strong 三档 --- */
  --ok-weak:#E6F5EC;   --ok:#14804A;   --ok-strong:#0E6136;
  --err-weak:#FDECEC;  --err:#CE3B3B;  --err-strong:#A62B2B;
  --warn-weak:#FDF3E0; --warn:#A96D0F; --warn-strong:#7F5108;
  --info-weak:#E9F0FC; --info:#2A63B8; --info-strong:#1D4A8C;

  /* --- 旧变量名映射（保持既有样式可用，逐步迁移）--- */
  --canvas:var(--n-50);
  --surface:var(--n-0);
  --surface-2:var(--n-100);
  --surface-3:var(--n-150);
  --text:var(--n-800);
  --text-2:var(--n-600);
  --text-3:var(--n-500);
  --border:var(--n-200);
  --border-strong:var(--n-300);
  --accent:var(--a-500);
  --accent-strong:var(--a-600);
  --accent-deep:var(--a-700);
  --accent-weak:var(--a-100);

  /* --- 字阶：替代此前 15 种零散字号 --- */
  --fs-2xs:10px; --fs-xs:11px; --fs-sm:12px; --fs-base:13px; --fs-md:14px;
  --fs-lg:15px; --fs-xl:17px; --fs-2xl:20px; --fs-3xl:25px;
  --lh-tight:1.25; --lh-normal:1.5; --lh-relaxed:1.75;
  --fw-normal:400; --fw-medium:500; --fw-semibold:600; --fw-bold:700;

  /* --- 间距：8px 网格 + 4px 半格 --- */
  --sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px;
  --sp-5:20px; --sp-6:24px; --sp-8:32px; --sp-10:40px;

  /* --- 圆角：对齐 Material 3 档位 --- */
  --r-xs:6px; --r-sm:8px; --r-md:12px; --r-lg:16px; --r-xl:20px; --r-full:999px;
  --radius-sm:var(--r-sm);
  --radius:var(--r-md);
  --radius-lg:var(--r-lg);

  /* --- 阴影：多层叠加（环境光 + 定向光），配合 --gloss 形成质感 --- */
  --shadow-xs:0 1px 2px rgba(28,25,21,.04);
  --shadow-sm:0 1px 3px rgba(28,25,21,.06),0 1px 2px rgba(28,25,21,.04);
  --shadow-md:0 4px 12px rgba(28,25,21,.07),0 2px 4px rgba(28,25,21,.04);
  --shadow-lg:0 12px 32px rgba(28,25,21,.09),0 4px 8px rgba(28,25,21,.04);
  --shadow-xl:0 24px 64px rgba(28,25,21,.14),0 8px 16px rgba(28,25,21,.06);
  --gloss:inset 0 1px 0 rgba(255,255,255,.65);
  --gloss-strong:inset 0 1px 0 rgba(255,255,255,.28);

  /* --- 动效 --- */
  --dur-fast:150ms; --dur:200ms; --dur-slow:300ms;
  --ease:cubic-bezier(.4,0,.2,1);
  --ease-out:cubic-bezier(0,0,.2,1);
  --ease-spring:cubic-bezier(.34,1.4,.64,1);

  --font:-apple-system,"Segoe UI Variable","Segoe UI","Microsoft YaHei UI","Microsoft YaHei",sans-serif;
  --font-mono:ui-monospace,"Cascadia Mono",Consolas,"Microsoft YaHei",monospace;
  --focus:0 0 0 3px rgba(242,123,52,.20);
}
html,body{height:100%}
body{font-family:var(--font);background:
  radial-gradient(circle at 82% -8%, rgba(242,123,52,.09), transparent 28rem),
  radial-gradient(circle at -8% 72%, rgba(22,133,90,.06), transparent 28rem),
  var(--canvas);
  color:var(--text);font-size:var(--fs-md);line-height:1.55;overflow:hidden;-webkit-font-smoothing:antialiased}
.shell{display:flex;flex-direction:column;height:100vh}
/* ===== 自绘标题栏（替代系统深色标题栏） ===== */
.titlebar{height:40px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,.78);border-bottom:1px solid var(--border);-webkit-app-region:drag;user-select:none;backdrop-filter:blur(18px)}
.titlebar-title{display:flex;align-items:center;gap:8px;padding-left:14px;font-size:var(--fs-sm);font-weight:var(--fw-medium);color:var(--text-2);letter-spacing:.01em}
.titlebar-controls{display:flex;height:100%;-webkit-app-region:no-drag}
.win-btn{width:46px;height:100%;display:flex;align-items:center;justify-content:center;border:none;background:none;color:var(--text-2);cursor:pointer;transition:background .1s ease,color .1s ease}
.win-btn svg{width:11px;height:11px}
.win-btn:hover{background:var(--surface-2);color:var(--text)}
.win-close:hover{background:#E5484D;color:#fff}
/* 键盘焦点可见（可访问性） */
.btn:focus-visible,.watch-toggle:focus-visible,.switch:focus-visible,.nav-item:focus-visible,.win-btn:focus-visible,.modal-close:focus-visible,.field-input:focus-visible{outline:none;box-shadow:var(--focus)}
.app{flex:1;display:flex;min-height:0}
/* ===== 左侧栏 ===== */
.side{width:232px;flex-shrink:0;background:rgba(255,255,255,.82);border-right:1px solid var(--border);display:flex;flex-direction:column;padding:16px 12px;backdrop-filter:blur(18px)}
.app-mark{width:18px;height:18px;flex-shrink:0;display:block}
/* 浏览器里打开（没有自绘标题栏）时，才在侧栏底部补一份软件身份与版本 */
.foot-brand{display:none}
body.no-titlebar .foot-brand{display:flex;gap:8px;align-items:center;font-weight:var(--fw-medium)}
body.no-titlebar .foot-brand .app-mark{width:16px;height:16px}
.nav{display:flex;flex-direction:column;gap:2px;flex:1}
.nav-item{position:relative;display:flex;align-items:center;gap:10px;padding:10px 10px;border-radius:var(--radius-sm);color:var(--text-2);font-size:var(--fs-base);cursor:pointer;border:none;background:none;width:100%;text-align:left;transition:background .16s ease,color .16s ease,transform .16s ease}
.nav-item svg{width:17px;height:17px;flex-shrink:0}
.nav-item:hover{background:var(--surface-2);color:var(--text);transform:translateX(1px)}
.nav-item.active{background:var(--accent-weak);color:var(--accent);font-weight:var(--fw-semibold)}
.nav-item.active::after{content:'';position:absolute;left:-12px;top:50%;width:3px;height:18px;border-radius:0 3px 3px 0;background:var(--accent);transform:translateY(-50%)}
.side-foot{border-top:1px solid var(--border);padding-top:12px;margin-top:12px;display:flex;flex-direction:column;gap:1px}
.foot-row{display:flex;align-items:center;gap:8px;padding:3px 8px;font-size:var(--fs-sm);color:var(--text-2)}
.foot-row svg{width:13px;height:13px;color:var(--text-3);flex-shrink:0}
/* 运行指示：缓慢呼吸的绿色光点，表示服务在跑（不做夸张动效） */
.dot{width:8px;height:8px;border-radius:50%;background:var(--ok);flex-shrink:0;position:relative}
.dot::after{content:'';position:absolute;inset:-3px;border-radius:50%;background:var(--ok);opacity:.28;animation:pulse 2.4s var(--ease) infinite}
.dot.off{background:var(--text-3)}
.dot.off::after{display:none}
@keyframes pulse{0%,100%{transform:scale(.85);opacity:.3}50%{transform:scale(1.25);opacity:.08}}
.foot-port{font-family:ui-monospace,Consolas,monospace;font-size:var(--fs-xs);color:var(--text-3)}
/* ===== 主区 ===== */
.main{flex:1;display:flex;flex-direction:column;min-width:0}
.topbar{height:64px;flex-shrink:0;display:flex;align-items:center;gap:18px;padding:0 30px;background:rgba(255,255,255,.72);border-bottom:1px solid var(--border);backdrop-filter:blur(18px)}
.topbar-lead{min-width:0;flex-shrink:0}
.page-title{font-size:var(--fs-2xl);font-weight:var(--fw-bold);letter-spacing:-.02em;line-height:1.2}
.page-sub{font-size:var(--fs-sm);color:var(--text-3);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* 顶部实时状态条：一屏内看清「监听模式 / 登录 / IM / 待签」四态，不必翻设置页 */
.status-strip{display:flex;align-items:center;gap:8px;flex:1;min-width:0;overflow:hidden}
.chip{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:var(--r-full);font-size:var(--fs-sm);font-weight:var(--fw-medium);color:var(--text-2);background:var(--n-100);border:1px solid var(--border);white-space:nowrap}
.chip::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.75}
.chip-ok{color:var(--ok);background:var(--ok-weak);border-color:transparent}
.chip-warn{color:var(--warn);background:var(--warn-weak);border-color:transparent}
.chip-err{color:var(--err);background:var(--err-weak);border-color:transparent}
.top-actions{display:flex;gap:10px;margin-left:auto;flex-shrink:0}
/* 移动端主操作 FAB：仅手机显示，悬浮于底部标签栏之上 */
.fab{display:none;position:fixed;right:18px;bottom:calc(78px + env(safe-area-inset-bottom,0px));z-index:70;width:54px;height:54px;border-radius:50%;border:none;background:linear-gradient(180deg,#F98A44 0%,#E56920 100%);color:#fff;align-items:center;justify-content:center;cursor:pointer;box-shadow:var(--gloss-strong),0 2px 6px rgba(150,66,14,.26),0 12px 28px rgba(229,105,32,.32);transition:transform var(--dur-fast) var(--ease),filter var(--dur) var(--ease)}
.fab svg{width:24px;height:24px}
.fab:active{transform:scale(.94);filter:brightness(.97)}
/* 窄桌面窗口：状态条按优先级收窄，优先保留「登录 / 待签」两类关键信息 */
@media (max-width:1180px){.chip{font-size:var(--fs-xs);padding:4px 9px}#chipMode{display:none}}
@media (max-width:1040px){#chipIm{display:none}.page-sub{display:none}}
@media (max-width:1240px){#chipDing{display:none}}
.btn{display:inline-flex;align-items:center;gap:7px;padding:9px 15px;border-radius:var(--radius-sm);border:none;font-size:var(--fs-base);font-weight:var(--fw-semibold);cursor:pointer;font-family:var(--font);transition:transform var(--dur-fast) var(--ease),background var(--dur) var(--ease),box-shadow var(--dur) var(--ease),opacity var(--dur) var(--ease),filter var(--dur) var(--ease)}
.btn svg{width:15px;height:15px}
.btn:active{transform:scale(.97);transition-duration:80ms}
.btn-primary{background:linear-gradient(180deg,#F98A44 0%,#E56920 100%);color:#fff;box-shadow:var(--gloss-strong),0 1px 2px rgba(150,66,14,.22),0 6px 16px rgba(229,105,32,.20)}
.btn-primary:hover{filter:brightness(1.03);box-shadow:var(--gloss-strong),0 2px 4px rgba(150,66,14,.24),0 10px 24px rgba(229,105,32,.26)}
.btn-primary:active{box-shadow:var(--gloss-strong),0 1px 2px rgba(150,66,14,.26),0 3px 8px rgba(229,105,32,.20);filter:brightness(.98)}
.btn-ghost{background:linear-gradient(180deg,var(--n-0) 0%,var(--n-25) 100%);color:var(--text-2);border:1px solid var(--border-strong);box-shadow:var(--gloss),var(--shadow-sm)}
.btn-ghost:hover{background:var(--n-100);color:var(--text);border-color:var(--n-400)}
.btn-ghost:hover{background:var(--surface-2)}
.content{flex:1;overflow-y:auto;padding:28px 30px}
.view{display:none;animation:fadeIn .16s ease}
.view.active{display:block}
@keyframes fadeIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
/* ===== 总览 ===== */
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:20px}
.stat-card{background:linear-gradient(180deg,var(--n-0) 0%,var(--n-25) 100%);border:1px solid var(--border);border-radius:var(--radius-lg);padding:var(--sp-5);display:flex;flex-direction:column;gap:2px;box-shadow:var(--gloss),var(--shadow-sm);transition:transform var(--dur) var(--ease),box-shadow var(--dur) var(--ease),border-color var(--dur) var(--ease)}
.stat-card:hover{transform:translateY(-2px);border-color:var(--a-300);box-shadow:var(--shadow-md)}
.stat-ico{width:34px;height:34px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;margin-bottom:10px}
.stat-ico svg{width:17px;height:17px}
.stat-num{font-size:var(--fs-3xl);font-weight:var(--fw-bold);letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.stat-label{font-size:var(--fs-sm);color:var(--text-2)}
.section{background:var(--n-0);border:1px solid var(--border);border-radius:var(--radius-lg);margin-bottom:var(--sp-5);overflow:hidden;box-shadow:var(--gloss),var(--shadow-sm)}
.section-head{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border)}
.section-title{font-size:var(--fs-md);font-weight:var(--fw-semibold)}
.section-more{font-size:var(--fs-sm);color:var(--text-3)}
.field-label{font-size:var(--fs-sm);font-weight:var(--fw-semibold);color:var(--text-2)}
.field-input{height:40px;padding:0 12px;border:1px solid var(--border-strong);border-radius:var(--radius-sm);font-size:var(--fs-base);color:var(--text);background:#fff;outline:none;transition:border-color .16s ease,box-shadow .16s ease;box-sizing:border-box}
.field-input:focus{border-color:var(--accent);box-shadow:var(--focus)}
.field-hint{font-size:var(--fs-sm);color:var(--text-3);line-height:1.7;margin:0}
/* ===== 时刻滚轮选择器 =====
   自绘而不用系统弹层：系统弹层是白底直角 + 蓝色选中，与本软件的暖橙材质/语义色不一致；
   列用 scroll-snap，滚轮、拖拽、方向键都能改值，触屏下改为底部弹层。 */
.tp-field{cursor:pointer;user-select:none;padding-right:30px;background-repeat:no-repeat;background-position:right 9px center;background-size:14px 14px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23B95317' stroke-width='1.7' stroke-linecap='round'%3E%3Ccircle cx='12' cy='12' r='9'/%3E%3Cpath d='M12 7.5v5l3 2'/%3E%3C/svg%3E")}
.tp-field::-webkit-calendar-picker-indicator{display:none}
.tp-mask{position:fixed;inset:0;z-index:1200;display:none;background:rgba(29,26,22,.06)}
.tp-mask.show{display:block}
.tp-pop{position:absolute;width:236px;background:linear-gradient(180deg,var(--surface),#FFFBF5);border:1px solid var(--border);border-radius:var(--r-lg);box-shadow:var(--shadow-lg),inset 0 1px 0 rgba(255,255,255,.6);padding:10px;animation:tpIn .16s cubic-bezier(.2,.8,.2,1)}
@keyframes tpIn{from{opacity:0;transform:translateY(-6px) scale(.98)}to{opacity:1;transform:none}}
@keyframes tpSheetIn{from{transform:translateY(100%);opacity:.6}to{transform:none;opacity:1}}
.tp-head{display:flex;align-items:baseline;justify-content:space-between;padding:2px 4px 8px;font-size:var(--fs-sm);color:var(--text-3)}
.tp-head b{font-size:var(--fs-md);color:var(--text);font-variant-numeric:tabular-nums}
.tp-cols{position:relative;display:flex;gap:6px;height:188px}
.tp-band{position:absolute;left:0;right:0;top:80px;height:28px;border-radius:var(--r-sm);background:var(--accent-weak);pointer-events:none}
.tp-col{flex:1;height:100%;overflow-y:auto;scroll-snap-type:y mandatory;scrollbar-width:none;padding:80px 0;box-sizing:border-box;-webkit-mask-image:linear-gradient(180deg,transparent,#000 24%,#000 76%,transparent);mask-image:linear-gradient(180deg,transparent,#000 24%,#000 76%,transparent)}
.tp-col:focus-visible{outline:none}
.tp-col:focus-visible~.tp-band,.tp-cols.act .tp-band{background:var(--a-200)}
.tp-col::-webkit-scrollbar{display:none}
.tp-item{height:28px;line-height:28px;text-align:center;scroll-snap-align:center;font-size:var(--fs-md);font-variant-numeric:tabular-nums;color:var(--text-3)}
.tp-item.sel{color:var(--accent-strong);font-weight:var(--fw-semibold)}
.tp-foot{display:flex;gap:8px;margin-top:10px}
.tp-foot .btn{flex:1;height:32px;font-size:var(--fs-sm);padding-left:8px;padding-right:8px}
/* ===== 应用内对话框与轻提示（替代系统 confirm/prompt） =====
   系统弹窗标题会露出「127.0.0.1:3456 显示」、按钮是系统蓝，和本软件的材质/语义色无关；
   统一收进自家浮层，手机端自动走底部弹层（复用 .modal-mask/.modal 的既有规则）。 */
.dlg-text{margin:0;font-size:var(--fs-base);color:var(--text-2);line-height:1.7;white-space:pre-wrap}
.dlg .modal-body{display:flex;flex-direction:column;gap:12px}
.btn-danger{border:1px solid #E6B8B8;background:#FDF6F6;color:#B42318}
.btn-danger:hover{background:#FBEDED;border-color:#D9A2A2}
.toast-wrap{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:1400;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none}
.toast{max-width:min(80vw,420px);padding:10px 16px;border-radius:var(--r-full);background:rgba(29,26,22,.92);color:#FFF6EE;font-size:var(--fs-sm);line-height:1.5;box-shadow:var(--shadow-lg);animation:toastIn .2s cubic-bezier(.2,.8,.2,1)}
.toast-ok{background:rgba(18,84,52,.94)}
.toast-err{background:rgba(140,32,28,.94)}
/* ===== 更新提示：状态条固定芯片 + 常驻下载小框（环形进度，不用下载箭头） ===== */
.chip-update{cursor:pointer;background:var(--a-100);color:var(--a-700);border:1px solid var(--a-200);font-weight:var(--fw-semibold)}
.chip-update:hover{background:var(--a-200)}
.upd-box{position:fixed;right:22px;bottom:22px;z-index:900;display:none;align-items:center;gap:10px;padding:10px 14px 10px 10px;border-radius:var(--r-lg);background:linear-gradient(180deg,var(--surface),#FFFBF5);border:1px solid var(--border);box-shadow:var(--shadow-lg),inset 0 1px 0 rgba(255,255,255,.6);cursor:pointer;transition:transform .16s var(--ease-spring),box-shadow .16s ease}
.upd-box.show{display:flex}
.upd-box:hover{transform:translateY(-2px);box-shadow:var(--shadow-lg),0 6px 18px rgba(28,25,21,.10)}
.upd-box:focus-visible{outline:none;box-shadow:var(--focus)}
.upd-box.ready{border-color:var(--a-300)}
.upd-ring{position:relative;width:42px;height:42px;flex-shrink:0}
.upd-ring svg{width:42px;height:42px;transform:rotate(-90deg);display:block}
.upd-ring .bg{fill:none;stroke:var(--a-100);stroke-width:5}
.upd-ring .fg{fill:none;stroke:var(--accent);stroke-width:5;stroke-linecap:round;transition:stroke-dashoffset .3s ease}
.upd-ring .txt{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:var(--fw-semibold);color:var(--a-700);font-variant-numeric:tabular-nums}
.upd-meta{display:flex;flex-direction:column;gap:2px;min-width:0}
.upd-title{font-size:var(--fs-sm);font-weight:var(--fw-semibold);color:var(--text);white-space:nowrap}
.upd-sub{font-size:var(--fs-xs);color:var(--text-3);white-space:nowrap}
.upd-hover{position:fixed;z-index:901;width:330px;max-width:min(88vw,380px);display:none;padding:12px 14px;border-radius:var(--r-lg);background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow-lg);animation:tpIn .14s cubic-bezier(.2,.8,.2,1)}
.upd-hover.show{display:block}
.upd-hover h4{margin:0 0 6px;font-size:var(--fs-md);color:var(--text)}
.upd-hover .upd-hover-meta{font-size:var(--fs-xs);color:var(--text-3);margin:0 0 8px}
.upd-hover pre{margin:0;max-height:230px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:var(--fs-sm);line-height:1.7;color:var(--text-2)}
@media (pointer:coarse){
  /* 触屏没有 hover，且右下角被悬浮按钮占着：小框挪到左下，只留环形进度 */
  .upd-box{left:14px;right:auto;bottom:calc(78px + env(safe-area-inset-bottom,0px));padding:8px;border-radius:var(--r-md)}
  .upd-meta{display:none}
  .upd-hover{display:none!important}
  .upd-ring,.upd-ring svg{width:46px;height:46px}
}
@keyframes toastIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media (pointer:coarse){
  .tp-mask.show{display:flex;align-items:flex-end;background:rgba(29,26,22,.32)}
  .tp-pop{position:relative;width:100%;border-radius:var(--r-xl) var(--r-xl) 0 0;border-left:none;border-right:none;border-bottom:none;padding:22px 16px calc(18px + env(safe-area-inset-bottom));animation:tpSheetIn .26s cubic-bezier(.2,.8,.2,1)}
  .tp-pop::before{content:'';position:absolute;top:8px;left:50%;transform:translateX(-50%);width:36px;height:4px;border-radius:var(--r-full);background:var(--n-250)}
  .tp-field{min-height:44px;font-size:16px}
  .tp-cols{height:252px}
  .tp-band{top:108px;height:36px}
  .tp-col{padding:108px 0}
  .tp-item{height:36px;line-height:36px;font-size:17px}
  .tp-foot .btn{height:44px;font-size:var(--fs-md)}
  .toast-wrap{bottom:calc(28px + env(safe-area-inset-bottom,0px))}
  .toast{font-size:var(--fs-md);padding:12px 18px}
}
.cfg-msg{font-size:var(--fs-sm);font-weight:var(--fw-semibold)}
.drag-mask{position:fixed;inset:0;z-index:999;display:none;align-items:center;justify-content:center;background:rgba(247,138,70,.07);pointer-events:none}
.drag-mask.show{display:flex}
.drag-box{border:2px dashed var(--accent);border-radius:var(--r-lg);background:var(--surface);padding:36px 60px;text-align:center;color:var(--accent);font-size:var(--fs-lg);font-weight:var(--fw-semibold);box-shadow:0 8px 32px rgba(0,0,0,.12)}
.drag-box small{display:block;margin-top:6px;font-size:var(--fs-sm);font-weight:var(--fw-normal);color:var(--text-2)}
/* ===== 表格 ===== */
table{width:100%;border-collapse:collapse;font-size:var(--fs-base)}
th{text-align:left;padding:10px 18px;font-size:var(--fs-sm);font-weight:var(--fw-semibold);color:var(--text-2);border-bottom:1px solid var(--border);background:var(--surface-2);letter-spacing:.02em}
td{padding:11px 18px;border-bottom:1px solid var(--border);vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:var(--n-25)}
.cell-main{font-weight:var(--fw-medium)}
.cell-sub{color:var(--text-2);font-size:var(--fs-base)}
.cell-mono{font-family:ui-monospace,Consolas,monospace;font-size:var(--fs-sm);color:var(--text-2);font-variant-numeric:tabular-nums}
.cell-empty{text-align:center;color:var(--text-3);padding:32px 0}
/* ===== 徽章/药丸 ===== */
.pill{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:var(--r-full);font-size:var(--fs-sm);font-weight:var(--fw-semibold)}
.pill::before{content:'';width:5px;height:5px;border-radius:50%;background:currentColor}
.pill-ok{color:var(--ok);background:var(--ok-weak)}
.pill-err{color:var(--err);background:var(--err-weak)}
.pill-warn{color:var(--warn);background:var(--warn-weak)}
/* ===== 账号 ===== */
.acct-row{display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid var(--border)}
.acct-row:last-child{border-bottom:none}
.acct-avatar{width:36px;height:36px;border-radius:var(--r-sm);background:var(--accent-weak);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:var(--fw-bold);font-size:var(--fs-lg);flex-shrink:0}
.acct-info{flex:1;min-width:0}
.acct-name{font-weight:var(--fw-semibold);font-size:var(--fs-md)}
.acct-sub{font-size:var(--fs-sm);color:var(--text-2);margin-top:1px}
/* ===== 设置 ===== */
.set-row{display:flex;align-items:center;justify-content:space-between;padding:13px 18px;border-bottom:1px solid var(--border);font-size:var(--fs-base)}
.set-row:last-child{border-bottom:none}
.set-label{color:var(--text-2)}
.set-value{font-weight:var(--fw-medium);text-align:right}
/* ===== 功能总览卡 ===== */
.feature-grid{display:flex;flex-direction:column;gap:2px;padding:10px 18px}
.feature-item{display:flex;align-items:center;gap:12px;padding:10px 4px}
.feature-item+.feature-item{border-top:1px solid var(--border)}
.feature-ico{width:36px;height:36px;border-radius:var(--r-sm);background:var(--accent-weak);color:var(--accent);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.feature-ico svg{width:17px;height:17px}
.feature-name{font-size:var(--fs-base);font-weight:var(--fw-semibold)}
.feature-desc{font-size:var(--fs-sm);color:var(--text-2);margin-top:2px;line-height:1.6}
/* ===== 课程监听开关 ===== */
.watch-bar{padding:10px 18px;font-size:var(--fs-sm);color:var(--text-3);border-bottom:1px solid var(--border);background:var(--surface)}
.watch-toggle{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:var(--r-full);border:1px solid var(--border);background:var(--surface);color:var(--text-2);font-size:var(--fs-sm);font-weight:var(--fw-semibold);cursor:pointer;transition:all .12s ease;font-family:var(--font)}
.watch-toggle:hover{border-color:var(--accent);color:var(--accent)}
.watch-toggle.on{background:var(--accent-weak);border-color:var(--accent);color:var(--accent)}
.pill-off{color:var(--text-3);background:var(--surface-2)}
.section-foot{display:flex;align-items:center;gap:14px;padding:12px 18px}
/* ===== 开关 ===== */
.switch{width:44px;height:24px;border-radius:var(--r-full);border:1px solid var(--border);background:var(--surface-2);position:relative;cursor:pointer;transition:background .15s ease,border-color .15s ease;flex-shrink:0;padding:0}
.switch .knob{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.22);transition:left .15s ease,transform .15s ease}
.switch:active .knob{transform:scale(.92)}
.switch.on{background:var(--accent);border-color:var(--accent)}
.switch.on .knob{left:22px}
/* ===== 小按钮 / 危险按钮 ===== */
.btn-sm{padding:5px 10px;font-size:var(--fs-sm)}
.btn-danger{color:var(--err);border-color:#F0D4D4}
.btn-danger:hover{background:#FBEBEB}
/* ===== 日志视图 ===== */
.log-box{background:#1B1F24;color:#D7DDE3;font-family:ui-monospace,Consolas,monospace;font-size:var(--fs-sm);line-height:1.75;padding:14px 18px;max-height:56vh;overflow-y:auto;white-space:pre-wrap;word-break:break-all}
.log-box::-webkit-scrollbar{width:10px}
.log-box::-webkit-scrollbar-thumb{background:#3A4048;border-radius:var(--r-xs)}
.log-line{padding:1px 0}
.log-line.err{color:#FF8A80}
.log-line.warn{color:#FFD54F}
.log-line.ok{color:#69F0AE}
.log-empty{color:#6B7280;text-align:center;padding:24px 0}
/* ===== 关于 ===== */
.about-box{padding:6px 18px}
.about-line{display:flex;gap:14px;padding:9px 0;font-size:var(--fs-base);border-bottom:1px solid var(--border);line-height:1.6}
.about-line:last-child{border-bottom:none}
.about-key{width:56px;flex-shrink:0;color:var(--text-3);font-size:var(--fs-sm)}
/* ===== 免责声明弹窗 ===== */
.disclaimer-modal{max-width:680px;width:min(680px,92vw)}
.disclaimer-scroll{max-height:56vh;overflow-y:auto;padding:2px 4px 2px 0;line-height:1.8;font-size:var(--fs-base);color:var(--text)}
.disclaimer-scroll::-webkit-scrollbar{width:10px}
.disclaimer-scroll::-webkit-scrollbar-thumb{background:#D8CFC6;border-radius:var(--r-xs)}
.disclaimer-scroll h3{font-size:var(--fs-lg);font-weight:var(--fw-bold);margin:0 0 10px;color:var(--text)}
.disclaimer-scroll h4{font-size:var(--fs-base);font-weight:var(--fw-semibold);margin:14px 0 6px;color:var(--accent-deep,#C2601F)}
.disclaimer-scroll p{margin:4px 0;text-align:justify}
/* ===== 检查更新弹窗 ===== */
.update-modal{max-width:540px;width:min(540px,92vw)}
.spinner{width:15px;height:15px;border:2px solid rgba(0,0,0,0.14);border-top-color:var(--accent,#F78A46);border-radius:50%;animation:spin .8s linear infinite;flex-shrink:0}
@keyframes spin{to{transform:rotate(360deg)}}
/* ===== 二维码签到弹窗 ===== */
.modal-mask{position:fixed;inset:0;z-index:990;display:flex;align-items:center;justify-content:center;background:rgba(29,26,22,.46);backdrop-filter:blur(3px)}
.modal{width:460px;max-width:92vw;background:var(--surface);border:1px solid rgba(255,255,255,.38);border-radius:var(--r-xl);box-shadow:var(--shadow-lg);display:flex;flex-direction:column;overflow:hidden;animation:modalIn .18s cubic-bezier(.2,.8,.2,1)}
@keyframes modalIn{from{opacity:0;transform:scale(.96) translateY(6px)}to{opacity:1;transform:none}}
.modal-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border)}
.modal-title{display:flex;align-items:center;gap:8px;font-size:var(--fs-md);font-weight:var(--fw-semibold)}
.modal-title svg{width:17px;height:17px;color:var(--accent)}
.modal-close{width:30px;height:30px;display:flex;align-items:center;justify-content:center;border:none;background:none;border-radius:var(--r-sm);color:var(--text-2);cursor:pointer}
.modal-close:hover{background:var(--surface-2);color:var(--text)}
.modal-body{padding:20px 18px}
.qr-drop{border:2px dashed var(--a-300);border-radius:var(--radius);background:var(--accent-weak);padding:32px 22px;text-align:center;color:var(--accent);transition:border-color .16s ease,background .16s ease,transform .16s ease}
.qr-drop.drag{border-color:var(--accent-strong);background:var(--a-100);transform:scale(1.01)}
.qr-drop>svg{width:44px;height:44px;margin-bottom:10px}
.qr-drop-text{font-size:var(--fs-md);font-weight:var(--fw-semibold);color:var(--text)}
.qr-drop-sub{font-size:var(--fs-sm);color:var(--text-2);margin-top:5px}
.qr-status{margin-top:14px;font-size:var(--fs-base);color:var(--text-2);text-align:center;min-height:20px}
.qr-status.ok{color:var(--ok);font-weight:var(--fw-semibold)}
.qr-status.err{color:var(--err);font-weight:var(--fw-semibold)}
/* 弹窗内的手机上传地址块：给出带 token 的完整 URL，省去用户手拼 */
.qr-mobile{margin-top:16px;padding:14px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface-2)}
.qr-mobile-title{font-size:var(--fs-sm);font-weight:var(--fw-semibold);color:var(--text-2);margin-bottom:8px}
.qr-mobile-url{display:flex;align-items:center;gap:10px}
.qr-mobile-url .cell-mono{flex:1;min-width:0;word-break:break-all;line-height:1.5}
.qr-mobile-hint{font-size:var(--fs-sm);color:var(--text-3);margin-top:8px;line-height:1.6}
.qr-mobile-warn{font-size:var(--fs-sm);color:var(--warn);background:var(--warn-weak);border-radius:var(--r-xs);padding:8px 10px;margin-top:10px;line-height:1.65}
.modal-foot{display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:14px 18px;border-top:1px solid var(--border);font-size:var(--fs-sm);color:var(--text-3)}
/* 免责声明：底部操作区撑满整行（左侧不同意、右侧同意并继续） */
.disclaimer-modal .modal-foot{padding:16px 18px;gap:12px}
.disclaimer-modal .modal-foot .btn{flex:1;justify-content:center;padding:11px 14px;font-size:var(--fs-base);border-radius:var(--r-sm)}
/* ===== 空态 ===== */
.empty{padding:36px 18px;text-align:center}
.empty p{color:var(--text-2);font-size:var(--fs-md)}
.empty-sub{font-size:var(--fs-sm);color:var(--text-3);margin-top:4px}
/* ===== 滚动条（浏览器表面也主题化） ===== */
.content::-webkit-scrollbar{width:10px}
.content::-webkit-scrollbar-thumb{background:#DCD0C6;border-radius:var(--r-xs);border:2px solid var(--canvas)}
.content::-webkit-scrollbar-thumb:hover{background:#C8B8AC}
::selection{background:rgba(247,138,70,.15)}

/* ===== 签到趋势 ===== */
#trendChart svg{display:block;width:100%;max-height:180px}
.trend-legend{display:flex;gap:14px;justify-content:flex-end;font-size:var(--fs-sm);color:var(--text-2);padding:2px 18px 12px}
.trend-legend span{display:inline-flex;align-items:center;gap:5px}
.trend-legend i{width:9px;height:9px;border-radius:2px;display:inline-block}
/* ===== 签到日历 ===== */
.cal-week{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:6px}
.cal-week span{text-align:center;font-size:var(--fs-xs);color:var(--text-3);font-weight:var(--fw-semibold);padding:4px 0}
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.cal-cell{min-height:58px;border:1px solid var(--border);border-radius:var(--r-sm);padding:6px;background:var(--surface);cursor:pointer;transition:border-color .12s ease,background .12s ease}
.cal-cell:hover{border-color:var(--accent)}
.cal-other{opacity:.35;cursor:default;background:var(--surface-2)}
.cal-today{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}
.cal-sel{background:var(--accent-weak);border-color:var(--accent)}
.cal-day-num{font-size:var(--fs-sm);font-weight:var(--fw-semibold);color:var(--text-2)}
.cal-badges{display:flex;flex-direction:column;gap:3px;margin-top:5px}
.cal-badges span{font-size:var(--fs-xs);font-weight:var(--fw-semibold);line-height:1.2}
.cal-ok{color:var(--ok)}
.cal-err{color:var(--err)}
.cal-detail-item{display:flex;gap:12px;padding:8px 0;border-bottom:1px solid var(--border);font-size:var(--fs-base);align-items:baseline}
.cal-detail-item:last-child{border-bottom:none}
/* ===== 网络诊断 ===== */
.diag-item{display:flex;align-items:center;gap:12px;padding:10px 14px;font-size:var(--fs-base);border-bottom:1px solid var(--border)}
.diag-item:last-child{border-bottom:none}
.diag-name{font-weight:var(--fw-semibold);width:112px;flex-shrink:0}
.diag-ms{font-size:var(--fs-sm);color:var(--text-3);width:70px;text-align:right;flex-shrink:0}
.diag-detail{font-size:var(--fs-sm);color:var(--text-2);line-height:1.5}


/* 课表页 */
/* 课表填充网格：5 天（周一~周五）× 8 节，每格一个下拉框（每节仅一门课） */
.tt-wrap{overflow-x:auto;padding:4px 18px 10px}
.tt-table{border-collapse:separate;border-spacing:6px;width:100%;min-width:720px}
.tt-table th{font-size:var(--fs-sm);color:var(--text-3);font-weight:var(--fw-semibold);padding:6px 4px;text-align:center;white-space:nowrap}
.tt-table th.tt-slot-col{text-align:left;min-width:132px}
.tt-table td{padding:0}
.tt-slot{font-size:var(--fs-sm);color:var(--text-2);white-space:nowrap;padding:6px 8px}
.tt-slot b{display:block;font-size:var(--fs-base);color:var(--text)}
.tt-slot span{color:var(--text-3);font-size:var(--fs-xs)}
.tt-half td{background:var(--surface-2);font-size:var(--fs-xs);color:var(--text-3);font-weight:var(--fw-semibold);text-align:center;padding:4px;border-radius:var(--r-xs)}
.tt-cell{width:100%;box-sizing:border-box;font-family:var(--font);font-size:var(--fs-sm);padding:7px 6px;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface);color:var(--text);cursor:pointer}
.tt-cell:focus{outline:none;box-shadow:var(--focus)}
.tt-cell.tt-filled{border-color:var(--a-300);background:var(--accent-weak);color:var(--text)}
.tt-cell.tt-empty{border-color:#E6B8B8;background:#FDF6F6;color:#B42318}
.tt-cell.tt-suggested{border-color:#7BC47F;background:#EAF7EC}
.tt-count{font-size:var(--fs-sm);color:var(--text-3)}
.tt-count b{color:var(--accent);font-size:var(--fs-lg)}
.tt-warn{background:#FDF6F6;border:1px solid #E6B8B8;color:#B42318;border-radius:var(--radius);padding:12px 14px;margin:4px 18px 0;font-size:var(--fs-base);line-height:1.7}
.tt-warn b{display:block;margin-bottom:4px}
.tt-ok{background:#EAF7EC;border:1px solid #A9D8B0;color:#178A5B;border-radius:var(--radius);padding:12px 14px;margin:4px 18px 0;font-size:var(--fs-base)}
.tt-legend{display:flex;gap:16px;flex-wrap:wrap;font-size:var(--fs-sm);color:var(--text-3);padding:8px 18px 0}
.tt-legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:5px;vertical-align:-1px;border:1px solid var(--border)}
.stat-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;padding:16px 18px}
.stat-card{background:rgba(255,255,255,.88);border-radius:var(--radius);padding:16px 12px;text-align:center;border:1px solid var(--border);box-shadow:var(--shadow-sm);transition:transform .18s ease,box-shadow .18s ease}
.stat-row .stat-card:hover{transform:translateY(-2px);box-shadow:var(--shadow-md)}
.stat-num{font-size:var(--fs-3xl);font-weight:var(--fw-bold);color:var(--accent);line-height:1.2}
.stat-label{font-size:var(--fs-sm);color:var(--text-3);margin-top:4px}
.course-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;padding:14px 18px}
.course-card{background:rgba(255,255,255,.88);border:1px solid var(--border);border-radius:var(--radius);padding:16px;cursor:pointer;transition:border-color .18s ease,box-shadow .18s ease,transform .18s ease;position:relative;box-shadow:var(--shadow-sm)}
.course-card:hover{border-color:var(--a-300);box-shadow:var(--shadow-md);transform:translateY(-2px)}
.course-card.watching{border-left:3px solid var(--accent)}
.course-card.retired{opacity:.55;border-left:3px solid var(--text-3)}
.course-card-name{font-size:var(--fs-md);font-weight:var(--fw-semibold);color:var(--text);margin-bottom:4px;line-height:1.3}
.course-card-teacher{font-size:var(--fs-sm);color:var(--text-3);margin-bottom:10px}
.course-card-stats{display:flex;gap:14px;font-size:var(--fs-sm)}
.course-card-stat-ok{color:#2e9e5b;font-weight:var(--fw-semibold)}
.course-card-stat-fail{color:#d45050;font-weight:var(--fw-semibold)}
.course-card-badge{position:absolute;top:10px;right:10px;font-size:var(--fs-xs);padding:2px 8px;border-radius:var(--r-sm);font-weight:var(--fw-semibold)}
.badge-on{background:var(--accent-weak);color:var(--accent)}
.badge-off{background:var(--surface-3);color:var(--text-3)}
.badge-retired{background:#eee;color:#999}
.grid-empty{grid-column:1/-1;text-align:center;color:var(--text-3);padding:40px 0;font-size:var(--fs-base)}
.course-note{font-size:var(--fs-xs);color:var(--accent);background:var(--accent-weak);padding:3px 8px;border-radius:var(--r-xs);margin:6px 0;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.course-note:hover{background:var(--accent);color:#fff}
.detail-modal{display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(29,26,22,.46);backdrop-filter:blur(3px);z-index:1000;align-items:center;justify-content:center}
.detail-modal-box{background:var(--surface);border-radius:var(--r-xl);width:90%;max-width:600px;max-height:80vh;overflow:hidden;box-shadow:var(--shadow-lg)}
.detail-modal-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border)}
.detail-modal-title{font-size:var(--fs-lg);font-weight:var(--fw-semibold);color:var(--text)}
.detail-modal-close{background:none;border:none;font-size:var(--fs-2xl);color:var(--text-3);cursor:pointer;padding:4px 8px}
.detail-modal-body{padding:14px 18px;overflow-y:auto;max-height:calc(80vh - 60px)}
/* 多账号统计 */
.acct-stat-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;padding:12px 18px}
.acct-stat-card{background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px}
.acct-stat-name{font-size:var(--fs-base);font-weight:var(--fw-semibold);color:var(--text);margin-bottom:6px}
.acct-stat-meta{font-size:var(--fs-xs);color:var(--text-3);margin-bottom:8px}
.acct-stat-nums{display:flex;gap:14px;font-size:var(--fs-sm)}
@media (max-width:960px){
  .side{width:188px;padding:14px 9px}
  .content,.topbar{padding-left:20px;padding-right:20px}
  .stat-grid,.acct-stat-row{grid-template-columns:repeat(2,minmax(0,1fr))}
  .cal-cell{min-height:50px}
}
/* ===== 移动端界面 =====
   设计依据（来自 GitHub / 官方规范的学习成果）：
   · Material Design 3 —— 圆角体系（Large=16dp）、底部导航、卡片三态（Elevated/Filled/Outlined）、
     「同质内容用列表而非卡片」、动效 200-300ms 自然缓动
   · iOS Human Interface Guidelines —— 触控目标最小 44×44pt、Tab bar 49pt、
     安全区（刘海 / Home Indicator）、Clarity/Deference/Depth 三原则
   · 移动端通用最佳实践 —— 屏幕边距 16px、分区间距 24px、交互元素间距 ≥12px、
     输入框 16px 字号（避免 iOS 聚焦时自动放大）、底部拇指可达区放主操作
   手机端的核心改造：表格 → 卡片列表（表格在窄屏上横向挤压严重，可读性差）。 */
@media (max-width:720px){
  /* 手机浏览器里不需要 Electron 的窗口控件 */
  .titlebar{display:none}
  .shell{height:100vh;height:100dvh}

  /* ---------- 底部标签栏（HIG：49pt + 安全区） ---------- */
  .app{flex-direction:column}
  .side{
    position:fixed;left:0;right:0;bottom:0;top:auto;z-index:60;
    width:100%;flex-direction:row;align-items:stretch;
    padding:0 2px;
    padding-bottom:env(safe-area-inset-bottom,0px);
    border-right:0;border-top:1px solid var(--border);
    background:rgba(255,255,255,.93);
    backdrop-filter:blur(24px) saturate(180%);
    box-shadow:0 -1px 16px rgba(28,25,21,.07);
  }
  .side-foot{display:none}
  .nav{flex-direction:row;flex:1;gap:0;justify-content:space-around;align-items:stretch;min-width:0;overflow-x:auto;scrollbar-width:none}
  .nav::-webkit-scrollbar{display:none}
  .nav-item{
    flex:1 0 auto;flex-direction:column;gap:3px;justify-content:center;align-items:center;
    min-width:54px;min-height:56px;padding:8px 2px 6px;
    font-size:var(--fs-2xs);font-weight:var(--fw-medium);
    border-radius:0;text-align:center;
    -webkit-tap-highlight-color:transparent;
    transition:color .2s ease,background .2s ease;
  }
  /* 极窄屏（≤360px）允许标签栏横向滑动，避免 6 个入口被压缩到不可点 */
  .nav-item span{white-space:nowrap}
  .nav-item svg{width:22px;height:22px;transition:transform .2s var(--ease-spring)}
  .nav-item.active{background:none;color:var(--accent);font-weight:var(--fw-semibold)}
  /* 选中态：图标上浮 + 顶部小横条，比整块底色更轻，也更符合 M3 导航指示器 */
  .nav-item.active svg{transform:translateY(-1px)}
  .nav-item.active::before{content:'';position:absolute;top:0;width:26px;height:3px;border-radius:0 0 3px 3px;background:var(--accent)}
  .nav-item.active::after{display:none}
  .nav-item:active{background:var(--surface-2)}
  .nav-item:active svg{transform:scale(.9)}

  /* ---------- 顶部标题区：标题行 + 状态条折行（HIG：导航栏 44pt） ---------- */
  .topbar{
    height:auto;position:sticky;top:0;z-index:50;
    flex-wrap:wrap;row-gap:8px;gap:12px;
    padding:10px 16px 11px;
    background:rgba(255,255,255,.9);
  }
  .topbar-lead{flex:1 1 auto;order:1}
  .page-title{font-size:var(--fs-xl);font-weight:var(--fw-semibold);letter-spacing:-.02em}
  /* 手机屏幕窄，副标题省略；状态条独占第二行并允许横向滑动 */
  .page-sub{display:none}
  .status-strip{
    order:3;flex:1 1 100%;overflow-x:auto;overflow-y:hidden;
    -webkit-overflow-scrolling:touch;scrollbar-width:none;
    padding-bottom:1px;
  }
  .status-strip::-webkit-scrollbar{display:none}
  .chip{flex-shrink:0}
  .top-actions{order:2;margin-left:0;flex-shrink:0}
  /* 手机上主操作改为右下 FAB，标题行只留紧凑按钮 */
  .top-actions .btn span{display:none}
  .top-actions .btn{padding:9px 12px}
  .fab{display:inline-flex}

  /* ---------- 内容区（边距 16px / 分区间距 24px / 底部避开标签栏） ---------- */
  .content{padding:16px 16px calc(76px + env(safe-area-inset-bottom,0px))}
  .section{margin-bottom:24px}
  .section-head{margin-bottom:12px;gap:10px}
  .section-title{font-size:var(--fs-lg);font-weight:var(--fw-semibold)}
  .section-more{font-size:var(--fs-xs)}

  /* ---------- 卡片：M3 Large 圆角（16dp） ---------- */
  .card,.stat-card,.drag-box,.req-grid{border-radius:var(--r-lg)}

  /* ---------- 表格 → 卡片列表（移动端关键改造） ---------- */
  table{display:block;font-size:var(--fs-md);border-collapse:separate}
  thead{display:none}
  tbody{display:block}
  tbody tr{
    display:block;
    background:var(--surface);
    border:1px solid var(--border);
    border-radius:var(--r-md);
    padding:12px 14px;
    margin-bottom:10px;
    box-shadow:var(--shadow-sm);
    transition:background .2s ease,transform .2s ease;
  }
  tbody tr:active{background:var(--surface-2);transform:scale(.995)}
  tbody td{
    display:flex;align-items:baseline;justify-content:space-between;gap:14px;
    padding:5px 0;border:0;text-align:right;white-space:normal;
  }
  tbody td::before{
    content:attr(data-label);
    flex:0 0 auto;
    color:var(--text-3);
    font-size:var(--fs-sm);font-weight:var(--fw-normal);
    text-align:left;
  }
  tbody td.cell-main{font-size:var(--fs-md);font-weight:var(--fw-semibold)}
  tbody td.cell-mono{font-size:var(--fs-sm);word-break:break-all}
  tbody td[colspan]{justify-content:center;color:var(--text-3)}
  tbody td[colspan]::before{display:none}
  /* 主标题行：整行独占、下方加分隔线，形成卡片标题 */
  tbody td:first-child{
    justify-content:flex-start;
    font-size:var(--fs-lg);font-weight:var(--fw-semibold);
    padding-bottom:8px;margin-bottom:5px;
    border-bottom:1px solid var(--border);
  }
  tbody td:first-child::before{display:none}

  /* ---------- 统计卡片（双列网格） ---------- */
  .stat-grid,.acct-stat-row{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .stat-card{padding:14px 15px}
  .stat-num{font-size:var(--fs-3xl);font-weight:var(--fw-bold);letter-spacing:-.02em}
  .stat-label{font-size:var(--fs-xs)}

  /* ---------- 表单与按钮（HIG：触控目标 ≥44pt） ---------- */
  .btn{min-height:44px;padding-left:18px;padding-right:18px;border-radius:var(--r-md);font-size:var(--fs-md)}
  .btn-sm{min-height:36px;font-size:var(--fs-base);padding-left:14px;padding-right:14px}
  .field-input{min-height:44px;border-radius:var(--r-md)}
  input,select,textarea{font-size:16px}
  .watch-toggle{min-height:38px;padding:0 14px;border-radius:var(--r-sm)}
  .pill{font-size:var(--fs-xs);padding:3px 9px}
  /* 操作按钮区：手机上纵向堆叠并占满宽度，避免文字被挤断成两行 */
  .section-foot{flex-direction:column;gap:10px;align-items:stretch}
  .section-foot .btn{width:100%}

  /* ---------- 弹窗 → 底部弹层（Bottom Sheet） ----------
     手机上把居中弹窗改为从底部升起的面板：拇指区可达、内容可滚动、
     顶部圆角与底部安全区对齐 iOS / M3 的 Sheet 规范。 */
  .modal-mask,.detail-modal{align-items:flex-end;padding:0}
  .modal,.disclaimer-modal,.detail-modal-box{
    width:100%;max-width:100%;
    border-radius:var(--r-xl) var(--r-xl) 0 0;
    max-height:88dvh;
    animation:sheetIn .26s cubic-bezier(.2,.8,.2,1);
  }
  @keyframes sheetIn{from{transform:translateY(100%);opacity:.6}to{transform:translateY(0);opacity:1}}
  /* 顶部拖拽提示条（纯视觉指示） */
  .modal-head::before,.detail-modal-head::before{
    content:'';position:absolute;top:6px;left:50%;transform:translateX(-50%);
    width:36px;height:4px;border-radius:var(--r-full);background:var(--n-250);
  }
  .modal-head,.detail-modal-head{position:relative;padding-top:16px}
  .modal-body,.detail-modal-body{padding-bottom:calc(16px + env(safe-area-inset-bottom,0px))}
  .modal-foot{padding-bottom:calc(14px + env(safe-area-inset-bottom,0px))}
  .modal-close,.win-btn{min-width:44px;min-height:44px}
  .qr-drop{padding:34px 18px}

  /* ---------- 设置项：值过长时自动换行，避免挤压折行 ---------- */
  .set-row{flex-wrap:wrap;row-gap:2px}
  .set-label{flex:0 0 auto}
  .set-value{flex:1 1 auto;min-width:0;text-align:right;word-break:break-word;overflow-wrap:anywhere}

  /* ---------- 触控反馈 ---------- */
  button,.nav-item,.card,.watch-toggle{touch-action:manipulation}
  .drag-box{padding:24px 18px}
}
@media (max-width:400px){
  /* 375px 级窄屏仍保持双列 —— 单列会让统计区过长，需滚动很久才能看到签到趋势 */
  .stat-grid,.acct-stat-row{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  .stat-card{padding:12px 13px}
  .stat-num{font-size:var(--fs-2xl)}
  .stat-label{font-size:var(--fs-xs)}
  .nav-item{font-size:var(--fs-2xs)}
  .nav-item svg{width:20px;height:20px}
  .content{padding-left:14px;padding-right:14px}
}

${VOYRA_UI_CSS}
</style>
</head>
<body>
<div class="shell">
  <div class="titlebar">
    <div class="titlebar-title">${ICONS.appMark}<span>学习通自动签到 · v${esc(status.version || '—')}</span></div>
    <div class="titlebar-controls">
      <button class="win-btn" id="btnMin" title="最小化">${ICONS.winMin}</button>
      <button class="win-btn" id="btnMax" title="最大化">${ICONS.winMax}</button>
      <button class="win-btn win-close" id="btnClose" title="关闭（后台继续运行）">${ICONS.winClose}</button>
    </div>
  </div>
  <div class="app">
  <aside class="side">
    <nav class="nav" id="nav">
      <button class="nav-item active" data-view="overview">${ICONS.appMark}<span>总览</span></button>
      <button class="nav-item" data-view="courses">${ICONS.courses}<span>课程</span></button>
      <button class="nav-item" data-view="schedule">${ICONS.calendar}<span>课表</span></button>
      <button class="nav-item" data-view="history">${ICONS.history}<span>历史记录</span></button>
      <button class="nav-item" data-view="logs">${ICONS.log}<span>日志</span></button>
      <button class="nav-item" data-view="settings">${ICONS.settings}<span>设置</span></button>
    </nav>
    <div class="side-foot">
      <div class="foot-row foot-brand">${ICONS.appMark}<span>学习通自动签到</span><span class="muted">v${esc(status.version || '—')}</span></div>
      <div class="foot-row"><span class="dot" id="footDot"></span><span id="footState">运行中</span></div>
      <div class="foot-row">${ICONS.user}<span id="footAccounts">${accounts.length} 个账号</span></div>
      <div class="foot-row">${ICONS.server}<span class="foot-port">端口 ${esc(String(status.port || '3456'))}</span></div>
    </div>
  </aside>

  <div class="main">
    <header class="topbar">
      <div class="topbar-lead">
        <div class="page-title" id="pageTitle">总览</div>
        <div class="page-sub" id="pageSub">自动监听签到活动，发现后自动完成签到</div>
      </div>
      <div class="status-strip" id="statusStrip">
        <span class="chip" id="chipMode">${esc(modeText(mode))}</span>
        <span class="chip ${accounts.length === 0 ? '' : status.cookieValid === true ? 'chip-ok' : 'chip-warn'}" id="chipCookie">${accounts.length === 0 ? '未配置账号' : status.cookieValid === true ? 'Cookie 有效' : status.cookieValid === false ? '登录已过期' : '登录状态待确认'}</span>
        <span class="chip ${status.imConnected ? 'chip-ok' : 'chip-warn'}" id="chipIm">${status.imConnected ? 'IM 已连接' : 'IM 不可用'}</span>
        <span class="chip ${status.dingtalkStreamConnected ? 'chip-ok' : (status.dingtalkStreamEnabled ? 'chip-warn' : '')}" id="chipDing">${
          status.dingtalkStreamConnected
            ? '钉钉图片通道已连接'
            : status.dingtalkStreamEnabled
              ? (status.dingtalkStreamConfigured ? '钉钉连接中' : '钉钉缺凭据')
              : '钉钉图片通道未启用'
        }</span>
        ${status.qrPending ? '<span class="chip chip-warn" id="chipQr">有二维码待签</span>' : '<span class="chip chip-warn" id="chipQr" style="display:none">有二维码待签</span>'}
        <span class="chip chip-update" id="chipUpdate" style="display:none" role="button" tabindex="0" title="有新版本可用，点击查看">有新版本</span>
      </div>
      <div class="top-actions">
        <button type="button" class="btn btn-primary" id="btnQrModal" aria-label="打开二维码上传与签到">${ICONS.qr}<span>二维码签到</span></button>
      </div>
    </header>

    <main class="content">
      <section class="service-notice" id="serviceNotice" hidden aria-label="运行状态">
        <div><strong id="serviceNoticeTitle"></strong><p id="serviceNoticeText"></p></div>
        <button type="button" class="btn btn-ghost" id="serviceRetry">重新连接</button>
        <a class="btn btn-ghost" id="serviceSettings" href="#settings" hidden>查看账号设置</a>
        <span class="sr-only" id="serviceAnnouncement" role="status" aria-live="polite"></span>
      </section>
      <!-- 总览 -->
      <section class="view active" data-view="overview">
        <div class="stat-grid">${statCards}</div>

        <div class="section">
          <div class="section-head"><span class="section-title">签到趋势</span><span class="section-more">近 14 天 · 成功 / 失败</span></div>
          <div id="trendChart" style="padding:14px 18px 4px"><div class="cell-empty" style="padding:26px 0">加载中…</div></div>
          <div class="trend-legend"><span><i style="background:#178A5B"></i>成功</span><span><i style="background:#D64545"></i>失败</span></div>
        </div>

        <div class="section">
          <div class="section-head"><span class="section-title">最近活动</span><span class="section-more">自动签到 · 失败自动重试</span></div>
          <table>
            <thead><tr><th>时间</th><th>课程</th><th>类型</th><th>结果</th></tr></thead>
            <tbody id="recentBody">${recentRows}</tbody>
          </table>
        </div>
        <div class="section">
          <div class="section-head"><span class="section-title">账号</span></div>
          <div id="accountsBox">${accountRows}</div>
          <div style="padding:0 18px 14px">
            <div style="font-size:var(--fs-sm);color:var(--text-3);margin-bottom:8px;font-weight:var(--fw-semibold)">各账号签到统计</div>
            <div class="acct-stat-row" id="acctStatsBox"><div style="color:var(--text-3);font-size:var(--fs-sm)">加载中...</div></div>
          </div>
        </div>
      </section>

      <!-- 课程 -->
      <section class="view" data-view="courses">
        <div class="section">
          <div class="section-head"><span class="section-title">监控课程</span><span class="section-more" id="courseCount">${courses.length} 门 · 轮询发现签到活动</span></div>
          <div class="watch-bar">
            <button class="btn ${status.listening === false ? 'btn-primary' : 'btn-ghost'}" id="listenToggleBtn">${status.listening === false ? '▶ 开启监听' : '⏸ 停止监听'}</button>
            <button class="btn btn-ghost" id="scanNowBtn">⚡ 立即扫描一次</button>
            <span id="listenState">${status.listening === false ? '已停止监听（不会发送任何轮询请求，二维码上传仍可用）' : `正在监听 ${status.listeningCount ?? courses.length} 门课程`}</span>
          </div>
          <div class="watch-bar" style="color:var(--text-3)">
            扫描严格按课表进行（只在周一~周五 07:30–12:30、14:00–21:00 的对应节次查对应课程）。
            课表之外临时想确认有没有新签到，点「⚡ 立即扫描一次」——它会立刻查一遍全部课程，不受课表限制。
          </div>
          <div class="watch-bar">逐课开关：点按钮切换后点「保存并立即生效」；已结课的课程已自动排除</div>
          <table>
            <thead><tr><th>课程名称</th><th>Course ID</th><th>Class ID</th><th>签到时段</th><th>状态</th><th>监听</th></tr></thead>
            <tbody id="coursesBody">${courseRows}</tbody>
          </table>
          <div class="section-foot">
            <button class="btn btn-primary" id="watchSaveBtn">保存并立即生效</button>
            <button class="btn btn-ghost" id="coursesResetBtn">全部恢复监听</button>
            <button class="btn btn-ghost" id="refreshCoursesBtn">${ICONS.refresh}<span>重新拉取课程列表</span></button>
            <span class="cfg-msg" id="watchMsg"></span>
          </div>
        </div>
        <div class="section">
          <div class="section-head"><span class="section-title">课程签到统计</span><span class="section-more">按历史记录实时统计</span></div>
          <table>
            <thead><tr><th>课程</th><th>签到成功</th><th>签到失败</th><th>成功率</th></tr></thead>
            <tbody id="courseStatsBody"></tbody>
          </table>
        </div>
      </section>

      <!-- 课表 -->
      <section class="view" data-view="schedule">
        <div class="section">
          <div class="section-head">
            <span class="section-title">填写课表</span>
            <span class="section-more">扫描将严格按这张课表进行 · 每节只能放一门课</span>
          </div>
          <div class="tt-warn" id="ttWarn" style="display:none"></div>
          <div class="tt-ok" id="ttOk" style="display:none"></div>
          <div class="tt-legend">
            <span><i style="background:#FDF6F6;border-color:#E6B8B8"></i>未填（必须填完）</span>
            <span><i style="background:var(--accent-weak);border-color:var(--a-300)"></i>已填</span>
            <span><i style="background:#EAF7EC;border-color:#7BC47F"></i>自动填充建议</span>
          </div>
          <div class="tt-wrap">
            <table class="tt-table">
              <thead><tr><th class="tt-slot-col">节次</th><th>周一</th><th>周二</th><th>周三</th><th>周四</th><th>周五</th></tr></thead>
              <tbody id="ttBody"><tr><td colspan="6" class="cell-empty">加载中…</td></tr></tbody>
            </table>
          </div>
          <div class="section-foot">
            <button class="btn btn-ghost" id="ttAutoBtn">按最近签到时间自动填充</button>
            <button class="btn btn-primary" id="ttSaveBtn">保存课表</button>
            <button class="btn btn-ghost" id="ttClearBtn">清空重填</button>
            <span class="cfg-msg tt-count" id="ttCount"></span>
          </div>
          <div class="cfg-msg" id="ttMsg" style="padding:0 18px 14px"></div>
        </div>
        <div class="section">
          <div class="section-head"><span class="section-title">扫描时段说明</span><span class="section-more">软件只在这些时段扫描</span></div>
          <div class="tt-legend" style="padding-bottom:14px">
            <span>周一~周五 · 上午 <b>07:30–12:30</b>（4 节） · 下午 <b>14:00–21:00</b>（4 节）</span>
            <span>其余时间（含周末）不发送任何请求</span>
          </div>
        </div>
        <div class="section">
          <div class="section-head"><span class="section-title">本周课表概览</span><span class="section-more">课程监听状态与签到统计</span></div>
          <div class="stat-row" id="scheduleStats">
            <div class="stat-card"><div class="stat-num" id="schTotal">0</div><div class="stat-label">总课程</div></div>
            <div class="stat-card"><div class="stat-num" id="schWatching">0</div><div class="stat-label">监听中</div></div>
            <div class="stat-card"><div class="stat-num" id="schRetired">0</div><div class="stat-label">已结课</div></div>
            <div class="stat-card"><div class="stat-num" id="schSuccess">0</div><div class="stat-label">累计签到成功</div></div>
            <div class="stat-card"><div class="stat-num" id="schFail">0</div><div class="stat-label">累计签到失败</div></div>
          </div>
        </div>
        <div class="section">
          <div class="section-head"><span class="section-title">课程列表</span><span class="section-more">点击卡片切换监听状态</span></div>
          <div class="course-grid" id="scheduleGrid"><div class="grid-empty">加载中...</div></div>
        </div>
      </section>

      <!-- 历史 -->
      <section class="view" data-view="history">

        <div class="section">
          <div class="section-head"><span class="section-title">签到日历</span><span class="section-more" id="calTitle">—</span>
            <div style="display:flex;gap:6px">
              <button class="btn btn-ghost btn-sm" id="calPrev">‹ 上月</button>
              <button class="btn btn-ghost btn-sm" id="calNext">下月 ›</button>
            </div>
          </div>
          <div style="padding:14px 18px">
            <div class="cal-week"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>
            <div class="cal-grid" id="calGrid"></div>
            <div id="calDetail" style="margin-top:14px"></div>
          </div>
        </div>

        <div class="section">
          <div class="section-head"><span class="section-title">签到记录</span><span class="section-more" id="historyCount"></span></div>
          <table>
            <thead><tr><th>时间</th><th>课程</th><th>类型</th><th>结果</th></tr></thead>
            <tbody id="historyBody">${recentRows}</tbody>
          </table>
          <div class="section-foot">
            <a class="btn btn-ghost" href="/api/history/export${qs}" download="checkin-history.csv">${ICONS.download}<span>导出 CSV</span></a>
            <button class="btn btn-ghost btn-danger" id="clearHistoryBtn">${ICONS.trash}<span>清空记录</span></button>
            <span class="cfg-msg" id="historyMsg"></span>
          </div>
        </div>
      </section>

      <!-- 日志 -->
      <section class="view" data-view="logs">
        <div class="section">
          <div class="section-head"><span class="section-title">运行日志</span><span class="section-more" id="logFile">自动刷新 · 最近 200 行</span></div>
          <div class="log-box" id="logBox"><div class="log-empty">加载中…</div></div>
          <div class="section-foot">

            <a class="btn btn-ghost" href="/api/logs/export${qs}" download="app.log">${ICONS.download}<span>导出日志</span></a>

            <button class="btn btn-ghost" id="logRefreshBtn">${ICONS.refresh}<span>刷新日志</span></button>
            <span class="cfg-msg" id="logMsg"></span>
          </div>
        </div>
      </section>

      <!-- 设置 -->
      <section class="view" data-view="settings">
        <div class="section">
          <div class="section-head"><span class="section-title">运行配置</span></div>
          ${settingsRows}
          ${settingsForm}
        </div>
        <div class="section">
          <div class="section-head"><span class="section-title">账号管理</span><span class="section-more">支持多账号，全部账号都会自动签到</span></div>
          ${accountManageBox}
        </div>

        <div class="section">
          <div class="section-head"><span class="section-title">网络与代理</span><span class="section-more">代理保存后立即生效，无需重启</span></div>
          <div style="padding:14px 18px;display:flex;flex-direction:column;gap:12px">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <label class="field-label" for="proxyInput" style="width:104px">HTTP 代理</label>
              <input class="field-input" id="proxyInput" type="text" placeholder="http://127.0.0.1:7890（留空 = 直连）" style="width:250px" spellcheck="false">
              <button class="btn btn-ghost" id="proxyTestBtn">测试连接</button>
              <button class="btn btn-primary" id="proxySaveBtn">保存</button>
              <span class="cfg-msg" id="proxyMsg"></span>
            </div>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:12px">
              <button class="btn btn-ghost" id="diagBtn">${ICONS.refresh}<span>一键网络诊断</span></button>
              <span class="field-hint">依次检测公网 / 登录 / 课程 / 签到 / IM 通道，失败会给出原因与建议</span>
            </div>
            <div id="diagResult" style="display:none;border:1px solid var(--border);border-radius:var(--r-sm);overflow:hidden"></div>
          </div>
        </div>

        <div class="section">
          <div class="section-head"><span class="section-title">钉钉图片通道（二维码签到）</span><span class="section-more">群里发二维码图片即自动签到</span></div>
          <div style="padding:14px 18px;display:flex;flex-direction:column;gap:12px">
            <div class="field-hint" style="line-height:1.8">
              用法：在钉钉开放平台创建<b>企业内部应用</b> → 应用能力里添加<b>机器人</b>（接收模式选 <b>Stream</b>）→ 发布并把机器人拉进群。<br>
              之后同学把签到二维码发到群里，软件会自动下载识别并签到，<b>你不需要做任何操作</b>。<br>
              走长连接，<b>不需要公网地址、不需要端口映射</b>。保存后需重启软件生效。
            </div>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <label class="field-label" for="dingKeyInput" style="width:104px">AppKey</label>
              <input class="field-input" id="dingKeyInput" type="text" placeholder="钉钉企业内部应用的 ClientID(AppKey)" style="width:320px" spellcheck="false">
            </div>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <label class="field-label" for="dingSecretInput" style="width:104px">AppSecret</label>
              <input class="field-input" id="dingSecretInput" type="password" placeholder="钉钉企业内部应用的 ClientSecret(AppSecret)" style="width:320px" spellcheck="false">
            </div>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <label class="field-label" style="width:104px">启用状态</label>
              <label style="display:flex;align-items:center;gap:6px;font-size:var(--fs-base)">
                <input type="checkbox" id="dingEnabledInput"> 启用钉钉图片通道
              </label>
              <button class="btn btn-primary" id="dingSaveBtn">保存钉钉设置</button>
              <span class="cfg-msg" id="dingMsg"></span>
            </div>
            <div class="field-hint" id="dingStateHint"></div>
          </div>
        </div>

        <div class="section">
          <div class="section-head"><span class="section-title">支持的签到方式</span></div>
          <div class="feature-grid">
            <div class="feature-item">
              <div class="feature-ico">${ICONS.check}</div>
              <div>
                <div class="feature-name">普通签到</div>
                <div class="feature-desc">检测到老师发布签到后自动完成，无需任何操作</div>
              </div>
            </div>
            <div class="feature-item">
              <div class="feature-ico">${ICONS.location}</div>
              <div>
                <div class="feature-name">位置签到</div>
                <div class="feature-desc">读取老师发布的位置坐标，在 10 米范围内自动生成签到点并完成</div>
              </div>
            </div>
            <div class="feature-item">
              <div class="feature-ico">${ICONS.qr}</div>
              <div>
                <div class="feature-name">二维码签到</div>
                <div class="feature-desc">把任意签到二维码图片直接拖入本窗口即可自动识别签到，二维码更新后拖入新码即可</div>
              </div>
            </div>
          </div>
          <div style="padding:2px 18px 14px;font-size:var(--fs-sm);color:var(--text-3);line-height:1.7">
            也可点击右上角「二维码签到」按钮，或手机在同一 Wi-Fi 下访问 <span class="cell-mono">${esc(mobileUploadUrl)}</span> 上传。签到失败会自动重试；检测到手势/拍照类签到会推送提醒（请在学习通 APP 手动完成）。
          </div>
        </div>
        <div class="section">
          <div class="section-head"><span class="section-title">关于</span></div>
          <div class="about-box">
            <div class="about-line"><span class="about-key">版本</span><span>学习通自动签到 v${esc(status.version || '—')}</span><button class="btn btn-ghost btn-sm" id="updateCheckBtn" style="margin-left:auto">${ICONS.refresh}<span>检查更新</span></button></div>
            <div class="about-line"><span class="about-key">仓库</span><span class="cell-mono">github.com/liixnglinb/superstar-checkin</span></div>
            <div class="about-line"><span class="about-key">说明</span><span>仅用于个人学习场景的自动签到辅助，请遵守学校考勤规定。</span></div>
            <div class="about-line"><span class="about-key">声明</span><button class="btn btn-ghost btn-sm" id="disclaimerView">${ICONS.shield}<span>查看免责声明</span></button></div>
          </div>
        </div>
      </section>
    </main>
  </div>
</div>
<div class="drag-mask" id="dragMask"><div class="drag-box">松开即可上传二维码签到图片<small>支持任意签到二维码，识别后自动完成签到</small></div></div>

<!-- 检查更新：设置页「检查更新」按钮弹出 -->
<!-- 更新小框：常驻在界面里，环形进度表示下载进度（刻意不用下载箭头图标） -->
<div class="upd-box" id="updBox" style="display:none" role="button" tabindex="0" aria-label="软件更新">
  <div class="upd-ring">
    <svg viewBox="0 0 44 44" aria-hidden="true"><circle class="bg" cx="22" cy="22" r="18"/><circle class="fg" id="updRing" cx="22" cy="22" r="18" stroke-dasharray="113.1" stroke-dashoffset="113.1"/></svg>
    <span class="txt" id="updPct">0%</span>
  </div>
  <div class="upd-meta">
    <span class="upd-title" id="updTitle">发现新版本</span>
    <span class="upd-sub" id="updSub">正在准备…</span>
  </div>
</div>
<div class="upd-hover" id="updHover" role="tooltip">
  <h4 id="updHoverTitle">更新内容</h4>
  <p class="upd-hover-meta" id="updHoverMeta"></p>
  <pre id="updHoverBody">—</pre>
</div>

<div class="modal-mask" id="updateModal" style="display:none">
  <div class="modal update-modal">
    <div class="modal-head">
      <span class="modal-title">${ICONS.update}<span>软件更新</span></span>
    </div>
    <div class="modal-body" style="min-height:110px">
      <div id="updateBody" style="font-size:var(--fs-base);color:var(--text);line-height:1.8"></div>
      <div id="updateBar" style="display:none;margin-top:14px">
        <div style="height:8px;background:var(--border);border-radius:4px;overflow:hidden">
          <div id="updateBarFill" style="height:100%;width:0%;background:var(--accent,#F78A46);transition:width .2s"></div>
        </div>
        <div id="updateBarText" style="font-size:var(--fs-sm);color:var(--text-3);margin-top:6px">正在下载安装包…</div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" id="updateLater">以后再说</button>
      <button class="btn btn-primary" id="updateGo" style="display:none">立即下载安装</button>
    </div>
  </div>
</div>

<!-- 免责声明：首次进入软件时显示，同意后进入，不同意退出 -->
<div class="modal-mask" id="disclaimerModal" style="display:none">
  <div class="modal disclaimer-modal">
    <div class="modal-head">
      <span class="modal-title">${ICONS.shield}<span>免责声明</span></span>
    </div>
    <div class="modal-body">
      <div class="disclaimer-scroll">
        <h3>学习通自动签到助手 免责声明</h3>
        <p>感谢使用学习通自动签到助手（以下简称"本软件"）。在使用本软件前，请仔细阅读并充分理解以下全部条款。您点击下方「同意并继续」按钮，即表示您已阅读、理解并自愿接受本声明的全部内容，并自愿承担使用本软件的全部风险与后果。</p>
        <h4>一、软件性质与使用范围</h4>
        <p>1. 本软件是一款免费、开源的个人学习辅助工具，用于协助使用者在本人已选课程中完成学习通平台的签到操作，以减轻重复性操作负担。</p>
        <p>2. 本软件不提供任何商业服务、不收取任何费用、不附带任何形式的技术支持承诺或可用性承诺。作者与使用者之间不构成任何服务合同关系。</p>
        <p>3. 本软件仅限使用者本人使用，不得转售、出租、出借，不得用于任何商业用途或任何违反法律法规、平台规则的目的。</p>
        <h4>二、合规与责任声明</h4>
        <p>1. 使用者所在学校、学院可能对课堂考勤、签到行为有明确管理规定（包括但不限于：使用第三方工具自动签到可能被认定为违反考勤纪律的情形）。使用者应在使用前了解并遵守所在学校、学院及任课教师的相关规定。</p>
        <p>2. <b>本软件不得用于代替本人到场、伪造出勤记录、规避学校考勤管理或任何形式的学术不端行为。</b>是否使用、如何使用本软件，完全由使用者自行判断并决定，使用者应对自己的行为及其全部后果独立负责。</p>
        <p>3. 因使用或无法使用本软件而导致的考勤记录异常、课程成绩影响、纪律处分、学业处理、账号受限或其他任何直接或间接后果，<b>均由使用者本人自行承担，本软件作者不承担任何责任</b>。</p>
        <p>4. 本软件仅辅助完成签到操作，不代替使用者对课程内容的学习与掌握，使用者仍应正常参与课堂学习，按时完成学习任务。</p>
        <h4>三、平台条款与账号安全</h4>
        <p>1. 使用者应遵守学习通平台（超星学习通）的用户协议、隐私政策及相关法律法规，不得利用本软件从事违反平台规则的操作，如账号共享、批量注册、恶意刷课等。</p>
        <p>2. 使用者应妥善保管自己的学习通账号与密码。本软件对账号密码采用本地加密存储（Windows DPAPI 加密，与当前系统用户绑定），不会明文保存；但使用者仍不得将账号出借给他人，并应对自己账号下的全部操作负责。</p>
        <p>3. 因账号保管不善、密码泄露或被他人冒用所导致的任何损失，由使用者自行承担；本软件及作者不对账号安全承担担保责任。</p>
        <p>4. 使用者理解并同意：使用自动化工具访问平台接口，存在被平台风控识别、限流或账号受限的可能性，该风险由使用者自行评估并承担。</p>
        <h4>四、服务可用性与技术限制</h4>
        <p>1. 本软件依赖学习通平台的公开接口与网络环境。平台接口变更、网络波动、服务器异常、登录状态失效、课程安排调整等情况均可能导致签到失败或功能异常，<b>本软件不保证签到 100% 成功，也不保证任何成功率</b>。</p>
        <p>2. 使用者应留意签到结果通知（建议配置至少一个推送渠道）。如发现签到失败或漏签，应及时通过学习通 APP 手动补签，避免影响考勤。<b>本软件不承担漏签导致的任何后果。</b></p>
        <p>3. 本软件按"现状"提供，不提供任何明示或默示的担保，包括但不限于适销性、特定用途适用性及不侵权担保。</p>
        <h4>五、数据与隐私</h4>
        <p>1. 本软件的所有配置数据、签到记录均存储于使用者本地设备，默认不会上传至任何第三方服务器；除使用者主动配置的通知通道（如钉钉、邮件、PushPlus、Bark 等）外，本软件不向外部发送任何数据。</p>
        <p>2. 使用者如将本软件安装包、配置文件或软件目录分享给他人，需自行评估风险；本软件及作者不对因分享造成的账号、密码或数据泄露承担任何责任。</p>
        <h4>六、开源与责任限制</h4>
        <p>1. 本软件以开源方式发布，使用者可自行审阅全部源代码。下载、安装、运行本软件的行为，即视为使用者已理解并接受其全部功能与风险。</p>
        <p>2. 在适用法律允许的最大范围内，作者对因本软件产生的任何索赔、损害或其他责任（无论基于合同、侵权或其他）概不负责。</p>
        <p>3. 若使用者所在地区的法律不允许上述部分免责内容，则该部分以法律规定为准，其余条款仍然有效。</p>
        <h4>七、其他</h4>
        <p>1. 本声明内容可能随软件功能更新而调整，更新后以软件内展示的最新版本为准。</p>
        <p>2. 如使用者不同意本声明的任何条款，请点击「不同意并退出」，停止使用并卸载本软件。</p>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost btn-danger" id="disclaimerRefuse">不同意并退出</button>
      <button class="btn btn-primary" id="disclaimerAgree">同意并继续</button>
    </div>
  </div>
</div>

<!-- 移动端主操作浮动按钮（拇指可达区）：手机上没有鼠标拖拽，扫码签到是最常用的手动动作 -->
<button class="fab" id="fabQr" title="二维码签到" aria-label="二维码签到">${ICONS.qr}</button>

<!-- 二维码签到弹窗：拖入任意签到码图片即完成签到 -->
<!-- 课程签到记录详情 -->
<div class="detail-modal" id="courseDetailModal" style="display:none" role="dialog" aria-modal="true" aria-label="课程签到记录">
  <div class="detail-modal-box">
    <div class="detail-modal-head">
      <span class="detail-modal-title" id="detailTitle">签到记录</span>
      <button class="detail-modal-close" id="detailClose" type="button" aria-label="关闭">×</button>
    </div>
    <div class="detail-modal-body" id="detailBody"></div>
  </div>
</div>

<!-- 应用内确认/输入对话框（替代系统 confirm 与 prompt） -->
<div class="modal-mask" id="dialogMask" style="display:none">
  <div class="modal dlg" role="dialog" aria-modal="true" aria-labelledby="dlgTitle">
    <div class="modal-head"><span id="dlgTitle">请确认</span><button class="modal-close" id="dlgClose" type="button" aria-label="关闭">${ICONS.x}</button></div>
    <div class="modal-body">
      <p class="dlg-text" id="dlgText"></p>
      <input class="field-input" id="dlgInput" style="width:100%;display:none" autocomplete="off">
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" id="dlgCancel" type="button">取消</button>
      <button class="btn btn-primary" id="dlgOk" type="button">确定</button>
    </div>
  </div>
</div>
<div class="toast-wrap" id="toastWrap" aria-live="polite"></div>

<div class="modal-mask" id="qrModal" style="display:none">
  <div class="modal">
    <div class="modal-head">
      <span class="modal-title">${ICONS.qr}<span>二维码签到</span></span>
      <button class="modal-close" id="qrModalClose" title="关闭">${ICONS.x}</button>
    </div>
    <div class="modal-body">
      <div class="qr-drop" id="qrDrop">
        ${ICONS.qr}
        <div class="qr-drop-text">把签到二维码图片拖到这里</div>
        <div class="qr-drop-sub">支持任意签到码，识别后自动完成签到</div>
        <div style="margin-top:14px">
          <button class="btn btn-ghost" id="btnPickFile">或选择图片文件</button>
          <input type="file" id="qrFileInput" accept="image/*" style="display:none">
        </div>
      </div>
      <div class="qr-status" id="qrStatus"></div>
      <!-- 手机端上传入口：教室二维码用手机拍最方便，这里给出可直接打开的完整地址 -->
      <div class="qr-mobile">
        <div class="qr-mobile-title">用手机拍二维码？打开这个地址上传</div>
        <div class="qr-mobile-url">
          <span class="cell-mono" id="qrMobileUrl">${esc(mobileUploadUrl)}</span>
          <button class="btn btn-ghost btn-sm" id="qrCopyBtn" type="button">${ICONS.copy}<span id="qrCopyLabel">复制</span></button>
        </div>
        ${loopbackOnly
          ? `<div class="qr-mobile-warn">当前服务仅监听本机（config.yaml 中 <b>web.host: 127.0.0.1</b>），手机连不上。把该项改为 <b>0.0.0.0</b> 并重启软件后即可用手机访问（已开启 token 鉴权，仅同一 Wi-Fi 可见）。</div>`
          : `<div class="qr-mobile-hint">手机与电脑需连同一 Wi-Fi；地址含访问令牌，请勿发给他人。</div>`}
      </div>
    </div>
    <div class="modal-foot" style="justify-content:flex-start">签到二维码会随时间更新，更新后拖入新码即可</div>
  </div>
</div>

<script${scriptNonce ? ` nonce="${scriptNonce}"` : ''}>
(function(){
  const API_TOKEN = ${JSON.stringify(token)}
  var views=['overview','courses','schedule','history','logs','settings']
  var titles={overview:'总览',courses:'课程',schedule:'课表',history:'历史记录',logs:'运行日志',settings:'设置'}
  var subs={overview:'自动监听签到活动，发现后自动完成签到',courses:'勾选要监听的课程，未勾选即全部监听',schedule:'课程监听状态与签到统计一览',history:'签到日历与全部签到记录',logs:'服务运行日志，排查问题时查看',settings:'账号、监听参数与通知配置'}
  function show(v){
    if(views.indexOf(v)<0)v='overview'
    document.querySelectorAll('.view').forEach(function(el){el.classList.toggle('active',el.dataset.view===v)})
    document.querySelectorAll('.nav-item').forEach(function(el){el.classList.toggle('active',el.dataset.view===v);el.setAttribute('aria-current',el.dataset.view===v?'page':'false')})
    document.getElementById('pageTitle').textContent=titles[v]
    var subEl=document.getElementById('pageSub');if(subEl)subEl.textContent=subs[v]||''
    if(v==='logs')loadLogs();if(v==='schedule')loadSchedule()
  }
  document.getElementById('nav').addEventListener('click',function(e){
    var btn=e.target.closest('.nav-item');if(!btn)return
    show(btn.dataset.view)
    if(history.replaceState)history.replaceState(null,'','#'+btn.dataset.view)
  })

  // ===== 免责声明（首次进入显示，同意后不再打扰；不同意则退出软件） =====
  // 接受状态存在**服务端**（data/disclaimer.json），不再用 localStorage：
  // localStorage 是每个浏览器独立的，换浏览器/清缓存就会重复弹窗，
  // 而手机端与桌面端本应是同一份状态。服务端记录还留了接受时间与版本，便于事后举证。
  function ensureDisclaimer(){
    var box=document.getElementById('disclaimerModal')
    if(!box)return
    apiFetch('/api/disclaimer').then(function(r){return r.json()}).then(function(d){
      if(!d.accepted)box.style.display='flex'
    }).catch(function(){
      // 读不到状态时保守处理：宁可多弹一次，也不要漏掉声明的展示
      box.style.display='flex'
    })
  }
  function closeDisclaimer(){
    var box=document.getElementById('disclaimerModal')
    if(box)box.style.display='none'
  }
  var disAgree=document.getElementById('disclaimerAgree')
  if(disAgree)disAgree.addEventListener('click',function(){
    disAgree.disabled=true
    apiFetch('/api/disclaimer/accept',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
      .catch(function(){})
      .then(function(){ disAgree.disabled=false; closeDisclaimer() })
  })
  var disRefuse=document.getElementById('disclaimerRefuse')
  if(disRefuse)disRefuse.addEventListener('click',function(){
    closeDisclaimer()
    if(window.appCtl&&window.appCtl.quit){window.appCtl.quit()}
    else{window.close()}
  })
  var disView=document.getElementById('disclaimerView')
  if(disView)disView.addEventListener('click',function(){
    var box=document.getElementById('disclaimerModal')
    if(box)box.style.display='flex'
  })
  ensureDisclaimer()

  // ===== 软件更新（electron-updater：测速选源 + 差分下载 + 静默安装） =====
  // 主进程是唯一真源：界面只渲染它推来的状态，这样关掉面板也不会丢「已下载好」。
  var updBox=document.getElementById('updBox')
  var updRing=document.getElementById('updRing')
  var updPct=document.getElementById('updPct')
  var updTitle=document.getElementById('updTitle')
  var updSub=document.getElementById('updSub')
  var updHover=document.getElementById('updHover')
  var updHoverTitle=document.getElementById('updHoverTitle')
  var updHoverMeta=document.getElementById('updHoverMeta')
  var updHoverBody=document.getElementById('updHoverBody')
  var chipUpdate=document.getElementById('chipUpdate')
  var updateModal=document.getElementById('updateModal')
  var updateBody=document.getElementById('updateBody')
  var updateGo=document.getElementById('updateGo')
  var updateLater=document.getElementById('updateLater')
  var updateBar=document.getElementById('updateBar')
  var updateBarFill=document.getElementById('updateBarFill')
  var updateBarText=document.getElementById('updateBarText')
  var RING_LEN=113.1
  var upd={phase:'idle',current:'',latest:'',notes:'',source:'',pct:0,speedBps:0,transferred:0,total:0,message:'',lastResult:null}
  /** 用户在确认框里点了「下载并重启」：下载完成的那一刻自动接上安装 */
  var updInstallIntent=false
  function fmtSize(b){
    if(!b||b<0)return ''
    if(b<1048576)return Math.round(b/1024)+'KB'
    return (b/1048576).toFixed(b<10485760?1:0)+'MB'
  }
  function hasNewVersion(s){return s.phase==='available'||s.phase==='downloading'||s.phase==='ready'}
  function updSubText(s){
    if(s.phase==='downloading'){
      var parts=[(s.pct||0)+'%']
      if(s.speedBps)parts.push((s.speedBps/1048576).toFixed(1)+'MB/s')
      return parts.join(' · ')
    }
    if(s.phase==='ready')return '已下载完成，点击更新'
    if(s.phase==='available')return '准备下载…'
    if(s.phase==='error')return s.message||'更新失败，可重试'
    return '正在检查…'
  }
  /** 面板里那颗主按钮该显示什么、点了做什么 */
  function updateActionFor(s){
    if(s.phase==='downloading')return{label:'下载中…',disabled:true}
    if(s.phase==='ready')return{label:'安装并重启',disabled:false,act:'install'}
    if(s.phase==='error')return{label:'重试更新',disabled:false,act:'download'}
    if(s.phase==='available')return{label:'更新并重启',disabled:false,act:'download'}
    return null
  }
  function updateBodyHtml(s){
    if(s.phase==='checking')return '<div style="display:flex;gap:10px;align-items:center"><span class="spinner"></span>正在检查更新，并实测各下载源速度…</div>'
    if(s.phase==='idle')return '<div class="cell-empty">尚未检查过更新</div>'
    if(s.phase==='uptodate')return '<div style="padding:6px 0">当前已是最新版本 <b>v'+esc(s.current||'')+'</b>，无需更新。</div>'
    var head=s.phase==='ready'
      ? '<div style="font-size:var(--fs-md);font-weight:var(--fw-semibold);margin-bottom:8px">更新包已就绪</div>'
      : s.phase==='error'
        ? '<div style="font-size:var(--fs-md);font-weight:var(--fw-semibold);margin-bottom:8px;color:#B42318">更新失败</div>'
        : '<div style="font-size:var(--fs-md);font-weight:var(--fw-semibold);margin-bottom:8px">发现新版本 <b>v'+esc(s.latest||'')+'</b>（当前 v'+esc(s.current||'')+'）</div>'
    var hint=s.phase==='ready'
      ? '<div style="color:var(--text-3);font-size:var(--fs-sm);margin-bottom:8px">点击「重启并更新」，软件会自动完成安装并重新打开，无需重走安装向导。</div>'
      : s.phase==='downloading'
        ? '<div style="color:var(--text-3);font-size:var(--fs-sm);margin-bottom:8px">正在后台下载（自动差分，只下载变化的块），可以关掉这个窗口，下载不会中断。</div>'
        : ''
    var msg=s.message?'<div style="color:'+(s.phase==='error'?'#B42318':'var(--text-3)')+';font-size:var(--fs-sm);margin-bottom:8px">'+esc(s.message)+'</div>':''
    var notes='<div style="max-height:220px;overflow-y:auto;white-space:pre-wrap;background:var(--bg2,#FBF9F7);border:1px solid var(--border);border-radius:var(--r-sm);padding:10px 12px;font-size:var(--fs-sm);color:var(--text-2)">'+esc((s.notes||'').trim()||'暂无更新说明')+'</div>'
    var srcLine=s.source?'<div style="font-size:var(--fs-sm);color:var(--text-3);margin-top:8px">下载源：'+esc(s.source)+'</div>':''
    return '<div style="padding:4px 0">'+head+msg+hint+notes+srcLine+'</div>'
  }
  function renderUpdateModal(s){
    if(!updateModal||updateModal.style.display!=='flex')return
    if(updateBar){
      var busy=s.phase==='downloading'
      updateBar.style.display=busy?'':'none'
      if(busy){
        updateBarFill.style.width=(s.pct||0)+'%'
        var extra=[]
        if(s.transferred&&s.total)extra.push(fmtSize(s.transferred)+' / '+fmtSize(s.total))
        if(s.speedBps)extra.push((s.speedBps/1048576).toFixed(1)+'MB/s')
        updateBarText.textContent='正在下载更新… '+(s.pct||0)+'%'+(extra.length?'（'+extra.join(' · ')+'）':'')
      }
    }
    if(updateBody)updateBody.innerHTML=updateBodyHtml(s)
    if(!updateGo)return
    var a=updateActionFor(s)
    if(!a){updateGo.style.display='none';return}
    updateGo.style.display=''
    updateGo.disabled=!!a.disabled
    updateGo.textContent=a.label
    if(updateLater)updateLater.textContent=(s.phase==='ready'?'稍后再说':'关闭')
  }
  function renderUpd(s){
    if(!s)return
    upd=s
    var show=hasNewVersion(s)||s.phase==='error'
    if(chipUpdate){
      chipUpdate.style.display=hasNewVersion(s)?'':'none'
      if(hasNewVersion(s))chipUpdate.textContent=(s.phase==='ready'?'更新已就绪 v':'有新版本 v')+(s.latest||'')
    }
    if(updBox){
      updBox.style.display=show?'flex':'none'
      updBox.classList.toggle('ready',s.phase==='ready')
      var pct=s.phase==='ready'?100:(s.pct||0)
      if(updRing)updRing.setAttribute('stroke-dashoffset',String(RING_LEN*(1-pct/100)))
      if(updPct)updPct.textContent=s.phase==='ready'?'✓':(pct+'%')
      if(updTitle)updTitle.textContent=s.phase==='ready'?'更新已就绪':(s.phase==='error'?'更新失败':'正在下载 v'+(s.latest||''))
      if(updSub)updSub.textContent=updSubText(s)
    }
    if(updHoverBody){
      updHoverTitle.textContent='v'+(s.latest||'')+' 更新内容'
      updHoverMeta.textContent=(s.current?'当前 v'+s.current:'')+(s.source?' · '+s.source:'')
      updHoverBody.textContent=(s.notes||'').trim()||'本次更新没有附带说明。'
    }
    renderUpdateModal(s)
    // 用户确认过「下载并重启」：下载一完成就自动接上安装，不用再点一次
    if(s.phase==='ready'&&updInstallIntent){updInstallIntent=false;doInstallNow()}
  }
  function showUpdHover(){
    if(!updHover||!updBox||window.matchMedia('(pointer: coarse)').matches)return
    if(!hasNewVersion(upd))return
    updHover.classList.add('show')
    var r=updBox.getBoundingClientRect()
    var w=updHover.offsetWidth,h=updHover.offsetHeight
    var left=Math.max(8,Math.min(r.right-w,window.innerWidth-w-8))
    var top=r.top-h-10
    if(top<8)top=Math.min(r.bottom+10,window.innerHeight-h-8)
    updHover.style.left=left+'px';updHover.style.top=top+'px'
  }
  function hideUpdHover(){if(updHover)updHover.classList.remove('show')}
  function doInstallNow(){
    if(!window.updateCtl)return
    toast('正在重启并安装更新…','ok')
    window.updateCtl.install().then(function(r){
      if(!r||!r.ok)toast('安装启动失败：'+((r&&r.message)||'未知错误'),'err')
    }).catch(function(){toast('安装启动失败，请稍后重试','err')})
  }
  /** 点按钮 → 直接问「是否安装并重启」；确认后才开始下载/安装（下载进度在小框与面板里看） */
  function showUpdateConfirm(){
    if(!window.updateCtl){toast('自动更新只在安装版里可用（浏览器打开时无效）','err');return}
    if(!hasNewVersion(upd)&&upd.phase!=='error'){openUpdateModal();return}
    var size=upd.total?'（更新包约 '+fmtSize(upd.total)+'）':''
    var head=upd.phase==='ready'
      ? '新版本 v'+(upd.latest||'')+' 已下载完成'+size+'。\\n\\n是否现在安装并重启？软件会自动完成安装并重新打开，无需重走安装向导。'
      : '发现新版本 v'+(upd.latest||'')+'（当前 v'+(upd.current||'')+'）'+size+'。\\n\\n是否现在更新并重启？确认后软件会自动下载、安装并重新打开。'
    var notes=(upd.notes||'').trim()
    if(notes)head+='\\n\\n更新内容：\\n'+notes.slice(0,600)+(notes.length>600?'…':'')
    if(upd.phase==='error'&&upd.message)head+='\\n\\n上次失败原因：'+upd.message
    askConfirm({
      title:upd.phase==='ready'?'安装更新并重启':'更新并重启',
      text:head,
      okText:upd.phase==='ready'?'安装并重启':'下载并重启',
    }).then(function(yes){
      if(!yes)return
      if(upd.phase==='ready'){doInstallNow();return}
      // 还没下载：确认即视为同意「下完就装」，下完自动接上安装
      updInstallIntent=true
      openUpdateModal()
      window.updateCtl.download().then(function(r){
        if(r&&!r.ok){updInstallIntent=false;toast(r.message||'下载失败，请稍后重试','err')}
      }).catch(function(){updInstallIntent=false;toast('下载失败，请稍后重试','err')})
    })
  }
  function openUpdateModal(){
    if(!updateModal)return
    updateModal.style.display='flex'
    renderUpdateModal(upd)
  }
  function refreshUpdState(){
    if(window.updateCtl&&window.updateCtl.getState){
      window.updateCtl.getState().then(renderUpd).catch(function(){})
    }
  }
  if(updBox){
    updBox.addEventListener('click',function(){showUpdateConfirm()})
    updBox.addEventListener('keydown',function(e){
      if(e.key==='Enter'||e.key===' '){e.preventDefault();updBox.click()}
    })
    updBox.addEventListener('mouseenter',showUpdHover)
    updBox.addEventListener('mouseleave',hideUpdHover)
    updBox.addEventListener('focus',showUpdHover)
    updBox.addEventListener('blur',hideUpdHover)
  }
  if(chipUpdate){
    chipUpdate.addEventListener('click',function(){showUpdateConfirm()})
    chipUpdate.addEventListener('keydown',function(e){
      if(e.key==='Enter'||e.key===' '){e.preventDefault();showUpdateConfirm()}
    })
  }
  if(updateGo)updateGo.addEventListener('click',function(){
    var a=updateActionFor(upd)
    if(!a||a.disabled)return
    showUpdateConfirm()
  })
  if(updateLater)updateLater.addEventListener('click',function(){
    if(updateModal)updateModal.style.display='none'
    hideUpdHover()
  })
  if(updateCheckBtn)updateCheckBtn.addEventListener('click',function(){
    if(!window.updateCtl){toast('自动更新只在安装版里可用（浏览器打开时无效）','err');return}
    openUpdateModal()
    renderUpd({phase:'checking',current:upd.current,latest:upd.latest,notes:upd.notes,source:upd.source})
    window.updateCtl.check().then(function(){
      refreshUpdState()
    }).catch(function(){
      toast('检查更新失败，请检查网络后重试','err')
      refreshUpdState()
    })
  })
  if(window.updateCtl&&window.updateCtl.onState)window.updateCtl.onState(function(s){renderUpd(s)})
  refreshUpdState()
  // 兜底轮询：页面比主进程的检查晚加载、或推送丢了，也能自己收敛到真实状态
  setInterval(refreshUpdState,20000)
  // 上次「更新并重启」的结果：成功/失败都给一次明确回执（失败时用户只会看到版本没变，必须说话）
  setTimeout(function(){
    var lr=upd.lastResult
    if(!lr)return
    if(lr.ok)toast('已更新到 v'+lr.now,'ok')
    else toast('上次更新未生效（仍是 v'+lr.now+'，目标 v'+lr.to+'），可以再更新一次','err')
  },500)

  function render(s){
    document.getElementById('stat-courses').textContent=(s.courses||[]).length
    document.getElementById('stat-records').textContent=s.recordCount||0
    document.getElementById('stat-ok').textContent=s.successCount||0
    document.getElementById('stat-fail').textContent=s.failCount||0
    lastServiceStatus=s
    serviceConnection(true)
    document.getElementById('historyCount').textContent='共 '+(s.recordCount||0)+' 条'
    // 顶部状态条 + 侧栏运行指示：每次轮询刷新，异常状态一眼可见
    var chipCookie=document.getElementById('chipCookie')
    if(chipCookie){
      var hasAccounts=(s.accounts||[]).length>0
      var cookieOk=s.cookieValid===true
      chipCookie.textContent=!hasAccounts?'未配置账号':cookieOk?'Cookie 有效':s.cookieValid===false?'登录已过期':'登录状态待确认'
      chipCookie.className='chip '+(!hasAccounts?'':cookieOk?'chip-ok':s.cookieValid===false?'chip-err':'chip-warn')
    }
    var chipIm=document.getElementById('chipIm')
    if(chipIm){
      chipIm.textContent=s.imConnected?'IM 已连接':'IM 不可用'
      chipIm.className='chip '+(s.imConnected?'chip-ok':'chip-warn')
    }
    var chipDing=document.getElementById('chipDing')
    if(chipDing){
      if(s.dingtalkStreamConnected){
        chipDing.textContent='钉钉图片通道已连接'
        chipDing.className='chip chip-ok'
      }else if(s.dingtalkStreamEnabled){
        chipDing.textContent=s.dingtalkStreamConfigured?'钉钉连接中':'钉钉缺凭据'
        chipDing.className='chip chip-warn'
      }else{
        chipDing.textContent='钉钉图片通道未启用'
        chipDing.className='chip'
      }
    }
    var chipQr=document.getElementById('chipQr')
    if(chipQr)chipQr.style.display=s.qrPending?'':'none'
    var footDot=document.getElementById('footDot')
    if(footDot)footDot.className='dot'+((s.cookieValid===false)?' off':'')
    var footState=document.getElementById('footState')
    if(footState)footState.textContent=!(s.accounts||[]).length?'未配置账号':s.cookieValid===false?'登录异常':s.listening===false?'已暂停监听':'运行中'
    var listenControl=document.getElementById('listenToggleBtn')
    if(listenControl&&listenControl.dataset.busy!=='true'){
      listenControl.dataset.listening=String(s.listening!==false)
      listenControl.setAttribute('aria-pressed',String(s.listening!==false))
      listenControl.textContent=s.listening===false?'▶ 开启监听':'⏸ 停止监听'
      var listeningMessage=document.getElementById('listenState')
      if(listeningMessage&&s.listening===false)listeningMessage.textContent='已暂停监听；手动上传二维码仍可用。'
    }
    var footAccounts=document.getElementById('footAccounts')
    if(footAccounts)footAccounts.textContent=((s.accounts||[]).length||0)+' 个账号'
    var rows=(s.recent||[]).map(function(r){
      var ok=/成功|✅|已签到/.test(r.result)
      var badge=ok?'<span class="pill pill-ok">成功</span>':'<span class="pill pill-err">失败</span>'
      return '<tr><td class="cell-sub" data-label="时间">'+esc(fmtTime(r.timestamp))+'</td><td class="cell-main" data-label="课程">'+esc(r.courseName||'未知课程')+'</td><td class="cell-sub" data-label="类型">'+esc(typeText(r.type))+'</td><td class="cell-sub" data-label="结果">'+badge+'</td></tr>'
    }).join('')
    if(!rows)rows='<tr><td colspan="4" class="cell-empty">还没有签到记录</td></tr>'
    if(document.getElementById('recentBody'))document.getElementById('recentBody').innerHTML=rows
    if(document.getElementById('historyBody'))document.getElementById('historyBody').innerHTML=rows
    // 账号区
    var ab=document.getElementById('accountsBox')
    if(ab){
      var accs=s.accounts||[]
      ab.innerHTML=accs.length
        ? accs.map(function(a){
            var nm=a.name||a.username||'?'
            return '<div class="acct-row"><span class="acct-avatar">'+esc(nm.slice(0,1))+'</span><div class="acct-info"><div class="acct-name">'+esc(nm)+'</div><div class="acct-sub">'+esc(a.schoolname||'')+' · '+esc(String(a.username))+'</div></div><span class="pill">账号已配置</span></div>'
          }).join('')
        : '<div class="empty"><p>未配置账号</p><p class="empty-sub">首次使用请在"设置"页填写你的学习通账号</p><a class="btn btn-ghost" href="#settings" style="margin-top:12px">去配置账号</a></div>'
    }
    // 多账号独立统计
    var asb=document.getElementById('acctStatsBox')
    if(asb){
      var asts=s.accountStats||[]
      asb.innerHTML=asts.length
        ? asts.map(function(a){
            var total=(a.success||0)+(a.fail||0)
            var rate=total>0?Math.round((a.success||0)/total*100):0
            var lt=a.lastTime?new Date(a.lastTime):null
            var ltStr=lt?(lt.getMonth()+1)+'/'+lt.getDate()+' '+String(lt.getHours()).padStart(2,'0')+':'+String(lt.getMinutes()).padStart(2,'0'):'从未'
            return '<div class="acct-stat-card"><div class="acct-stat-name">'+esc(a.name||a.username||'?')+'</div><div class="acct-stat-meta">最近签到: '+ltStr+'</div><div class="acct-stat-nums"><span style="color:#2e9e5b;font-weight:var(--fw-semibold)">成功 '+(a.success||0)+'</span><span style="color:#d45050;font-weight:var(--fw-semibold)">失败 '+(a.fail||0)+'</span><span style="color:var(--text-3)">成功率 '+rate+'%</span></div></div>'
          }).join('')
        : '<div style="color:var(--text-3);font-size:var(--fs-sm)">暂无签到记录</div>'
    }
    // 课程表（含监听开关）
    var cb=document.getElementById('coursesBody')
    if(cb){
      var cs2=s.courses||[]
      var ws2=(s.watchCourses||[]).map(String)
      var wset2={};ws2.forEach(function(id){wset2[id]=true})
      var dis2={};(s.disabledCourses||[]).map(String).forEach(function(id){dis2[id]=true})
      var allOn2=ws2.length===0
      // 与服务端一致的判定：未被手动关闭，且（无白名单 或 在白名单内）
      var watchingOf=function(id){return !dis2[id] && (allOn2 || wset2[id])}
      var wins=s.signinWindows||{}
      var health=s.courseHealth||{}
      cb.innerHTML=cs2.length
        ? cs2.map(function(c){
            var cid=String(c.courseId)
            var watching=watchLocal[cid]!==undefined?watchLocal[cid]:watchingOf(cid)
            var w2=wins[cid]
            var wc=w2
              ? (w2.known
                ? '<span class="cell-mono" title="共 '+esc(String(w2.samples))+' 次观测；仅此时段轮询（另有每日兜底扫描）">'+esc(w2.text)+'</span>'
                : '<span class="cell-sub" title="观测不足，暂按全天轮询；积累 '+esc(String(w2.samples))+' 次后自动收敛">'+esc(w2.text)+'</span>')
              : '<span class="cell-sub">—</span>'
            // 与服务端同一套状态胶囊：轮询连续失败要显示「扫描异常」，否则每 5 秒重绘会把它抹掉
            var fails=health[cid]||0
            var runtimeReady=(s.accounts||[]).length>0&&s.cookieValid!==false&&s.listening!==false
            var pill=watching&&!runtimeReady
              ? '<span class="pill pill-off">'+(!(s.accounts||[]).length?'未配置账号':s.cookieValid===false?'登录需核验':'已暂停监听')+'</span>'
              : !watching
              ? '<span class="pill pill-off">已停用</span>'
              : (fails>=3
                ? '<span class="pill pill-warn" title="近期轮询多次失败，多为瞬时网络或网关限流，已自动重试；持续异常可点击「重新拉取课程列表」">扫描异常</span>'
                : '<span class="pill pill-ok">监控中</span>')
            return '<tr><td class="cell-main" data-label="课程">'+esc(c.courseName)+'</td><td class="cell-mono" data-label="Course ID">'+esc(cid)+'</td><td class="cell-mono" data-label="Class ID">'+esc(String(c.classId))+'</td><td data-label="签到时段">'+wc+'</td><td data-label="状态">'+pill+'</td><td data-label="监听"><button class="watch-toggle '+(watching?'on':'')+'" data-cid="'+esc(cid)+'">'+(watching?'关闭监听':'开启监听')+'</button></td></tr>'
          }).join('')
        : '<tr><td colspan="6" class="cell-empty">暂无课程数据</td></tr>'
    }
    var cc=document.getElementById('courseCount')
    if(cc)cc.textContent=(s.courses||[]).length+' 门 · 轮询发现签到活动'
    // 课程签到统计
    var csb=document.getElementById('courseStatsBody')
    if(csb){
      var stats=s.courseStats||[]
      csb.innerHTML=stats.length
        ? stats.map(function(st){
            var total=st.success+st.fail
            var rate=total?Math.round(st.success/total*100):0
            var rc=rate>=90?'#178A5B':(rate>=60?'#B7791F':'#D64545')
            return '<tr><td class="cell-main" data-label="课程">'+esc(st.course)+'</td><td class="cell-sub" data-label="签到成功" style="color:#178A5B">'+st.success+'</td><td class="cell-sub" data-label="签到失败" style="color:'+(st.fail?'#D64545':'#9A8B80')+'">'+st.fail+'</td><td class="cell-sub" data-label="成功率" style="color:'+rc+';font-weight:var(--fw-semibold)">'+rate+'%</td></tr>'
          }).join('')
        : '<tr><td colspan="4" class="cell-empty">暂无统计数据（产生签到记录后显示）</td></tr>'
    }

    // 签到趋势（近 14 天柱状图）
    var tr=document.getElementById('trendChart')
    if(tr){
      var t=s.trend||[]
      if(!t.some(function(d){return d.success||d.fail})){
        tr.innerHTML='<div class="cell-empty" style="padding:24px 0">暂无签到数据，产生签到记录后自动生成趋势图</div>'
      }else{
        var max=1;t.forEach(function(d){if(d.success+d.fail>max)max=d.success+d.fail})
        var W=820,H=150,PL=10,PR=10,PT=14,PB=26
        var iw=W-PL-PR,ih=H-PT-PB
        var n=t.length,step=iw/n,bw=Math.min(step*0.5,18),gap=Math.max(3,step*0.14)
        var bars='',labels=''
        t.forEach(function(d,i){
          var x=PL+i*step+step/2
          var sh=Math.round(d.success/max*ih),fh=Math.round(d.fail/max*ih)
          var by=PT+ih
          if(d.success)bars+='<rect x="'+(x-bw-gap/2)+'" y="'+(by-sh)+'" width="'+bw+'" height="'+sh+'" rx="2" fill="#178A5B"/>'
          if(d.fail)bars+='<rect x="'+(x+gap/2)+'" y="'+(by-fh)+'" width="'+bw+'" height="'+fh+'" rx="2" fill="#D64545"/>'
          if(i%2===0||i===n-1)labels+='<text x="'+x+'" y="'+(H-7)+'" text-anchor="middle" font-size="10" fill="#9A8B80">'+d.date+'</text>'
        })
        tr.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMid meet">'+bars+labels+'</svg>'
      }
    }

  }
  function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
  function fmtTime(ts){if(!ts)return '—';var d=new Date(ts),n=new Date();var hm=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');if(d.toDateString()===n.toDateString())return '今天 '+hm;var y=new Date(n.getTime()-86400000);if(d.toDateString()===y.toDateString())return '昨天 '+hm;return (d.getMonth()+1)+'月'+d.getDate()+'日 '+hm}
  function typeText(t){var m={normal:'普通',qr:'二维码',location:'位置'};return m[t]||t}
  function apiFetch(url, options){
    options=options||{}
    options.headers=Object.assign({},options.headers||{},{Authorization:'Bearer '+API_TOKEN})
    return fetch(url,options)
  }
  var lastServiceStatus=null,pollInFlight=null,serviceOnline=true
  function serviceConnection(online,message){
    serviceOnline=online
    var box=document.getElementById('serviceNotice'),title='',detail=''
    var accounts=lastServiceStatus&&lastServiceStatus.accounts||[]
    if(!online){title='无法连接本地服务';detail='当前展示上次读取的状态，不能确认监听仍在运行。请检查服务后重新连接。'+(message||'')}
    else if(lastServiceStatus&&!accounts.length){title='尚未配置学习通账号';detail='先在设置中配置你有权使用的账号，再开启课程监听。'}
    else if(lastServiceStatus&&lastServiceStatus.cookieValid===false){title='登录状态已过期';detail='课程和记录已保留；请在设置中重新登录，必要时在官方 App 完成人工验证。'}
    box.hidden=!title;box.dataset.kind=online?'account':'offline'
    document.getElementById('serviceNoticeTitle').textContent=title
    document.getElementById('serviceNoticeText').textContent=detail
    document.getElementById('serviceRetry').hidden=online
    document.getElementById('serviceSettings').hidden=!online
    var announce=document.getElementById('serviceAnnouncement');if(announce.textContent!==title)announce.textContent=title
    var canListen=accounts.length>0&&lastServiceStatus.cookieValid!==false
    ;['listenToggleBtn','scanNowBtn'].forEach(function(id){var b=document.getElementById(id);if(!b)return;var canStop=id==='listenToggleBtn'&&lastServiceStatus&&lastServiceStatus.listening!==false;b.disabled=!online||b.dataset.busy==='true'||(!canListen&&!canStop)})
    if(!online){var foot=document.getElementById('footState');if(foot)foot.textContent='服务连接中断'}
  }
  function poll(){
    if(pollInFlight)return pollInFlight
    pollInFlight=apiFetch('/api/status').then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(render).catch(function(e){serviceConnection(false,String(e.message))}).finally(function(){pollInFlight=null})
    return pollInFlight
  }
  document.getElementById('serviceRetry').addEventListener('click',function(){poll()})
  if(location.hash&&views.indexOf(location.hash.slice(1))>=0)show(location.hash.slice(1))
  window.addEventListener('hashchange',function(){var v=location.hash.slice(1);if(views.indexOf(v)>=0)show(v)})
  // 二维码图片拖拽签到：任意签到码拖入窗口即解析并签到（二维码更新后拖新码即可）
  var dragMask=document.getElementById('dragMask')
  var toastTimer=null
  function showToast(msg){
    var t=document.getElementById('dragToast')
    if(!t){
      t=document.createElement('div');t.id='dragToast'
      t.style.cssText='position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#1B1F24;color:#fff;padding:10px 18px;border-radius:var(--r-sm);font-size:var(--fs-base);z-index:1000;box-shadow:0 6px 20px rgba(0,0,0,.2);max-width:70vw'
      document.body.appendChild(t)
    }
    t.textContent=msg;t.style.display='block'
    clearTimeout(toastTimer);toastTimer=setTimeout(function(){t.style.display='none'},5000)
  }
  // 弹窗打开时，窗口级拖拽交给弹窗处理（避免双重上传）
  window.addEventListener('dragover',function(e){e.preventDefault();if(qrModal&&qrModal.style.display==='flex')return;if(dragMask&&!dragMask.classList.contains('show'))dragMask.classList.add('show')},{capture:true})
  window.addEventListener('dragleave',function(e){if(dragMask&&e.target===document.documentElement)dragMask.classList.remove('show')},{capture:true})
  window.addEventListener('drop',function(e){
    e.preventDefault()
    if(qrModal&&qrModal.style.display==='flex')return
    if(dragMask)dragMask.classList.remove('show')
    var f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0]
    if(!f)return
    if(f.type.indexOf('image/')!==0){showToast('请拖入二维码图片文件');return}
    showToast('二维码图片已接收，正在识别签到…')
    apiFetch('/upload/image?type=qr',{method:'POST',body:f,headers:{'Content-Type':f.type}})
      .then(function(r){return r.json()})
      .then(function(d){
        if(d.success){showToast('✅ '+d.message);setTimeout(function(){location.reload()},1500)}
        else{showToast('❌ '+(d.error||'处理失败'))}
      })
      .catch(function(err){showToast('❌ 上传失败: '+err.message)})
  })
  var saveBtn=document.getElementById('cfgSaveBtn')
  if(saveBtn)saveBtn.addEventListener('click',function(){
    var u=document.getElementById('cfgUsername').value.trim()
    var p=document.getElementById('cfgPassword').value
    var msg=document.getElementById('accountMsg')
    if(!u||!p){msg.textContent='账号和密码不能为空';msg.style.color='#B42318';return}
    saveBtn.disabled=true;saveBtn.textContent='保存中…'
    apiFetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})})
      .then(function(r){return r.json()})
      .then(function(d){
        msg.textContent=(d.ok?'✅ ':'❌ ')+(d.message||(d.ok?'已保存':'保存失败'))
        msg.style.color=d.ok?'#0E7C66':'#B42318'
        saveBtn.disabled=false;saveBtn.textContent='添加账号'
        if(d.ok)setTimeout(function(){location.reload()},1500)
      })
      .catch(function(){msg.textContent='❌ 保存失败，请重试';msg.style.color='#B42318';saveBtn.disabled=false;saveBtn.textContent='添加账号'})
  })
  // 自绘标题栏：窗口控制（最小化/最大化/关闭）
  var wc=window.winCtl
  if(wc){
    var btnMin=document.getElementById('btnMin')
    var btnMax=document.getElementById('btnMax')
    var btnClose=document.getElementById('btnClose')
    var icoMax='<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1"><rect x="2.5" y="2.5" width="7" height="7"/></svg>'
    var icoRestore='<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1"><path d="M4.5 4.5V2.5h5v5h-2"/><rect x="2.5" y="4.5" width="5" height="5"/></svg>'
    if(btnMin)btnMin.addEventListener('click',function(){wc.minimize()})
    if(btnMax)btnMax.addEventListener('click',function(){wc.maximizeToggle()})
    if(btnClose)btnClose.addEventListener('click',function(){wc.close()})
    function syncMax(){
      wc.isMaximized().then(function(m){
        if(btnMax){btnMax.innerHTML=m?icoRestore:icoMax;btnMax.title=m?'还原':'最大化'}
      }).catch(function(){})
    }
    window.addEventListener('resize',syncMax)
    syncMax()
  } else {
    // 非 Electron（浏览器调试）时隐藏自绘标题栏：此时软件名与版本号改由侧栏底部承担，
    // 否则整个界面里就没有任何地方说明「这是哪个软件、什么版本」。
    var tb=document.querySelector('.titlebar');if(tb)tb.style.display='none'
    document.body.classList.add('no-titlebar')
  }
  // ===== 课程监听开关 =====
  var watchLocal={}  // 本地未保存的开关修改（{courseId: bool}）
  var coursesBody=document.getElementById('coursesBody')
  if(coursesBody){
    coursesBody.addEventListener('click',function(e){
      var btn=e.target.closest('.watch-toggle');if(!btn)return
      var cid=btn.getAttribute('data-cid')
      var cur=btn.classList.contains('on')
      watchLocal[cid]=!cur
      // 重绘课程表以同步状态列与按钮
      apiFetch('/api/status').then(function(r){return r.json()}).then(function(s){
        var cb=document.getElementById('coursesBody')
        var cs2=s.courses||[],ws2=(s.watchCourses||[]).map(String)
        var wset2={};ws2.forEach(function(id){wset2[id]=true})
        var dis2={};(s.disabledCourses||[]).map(String).forEach(function(id){dis2[id]=true})
        var allOn2=ws2.length===0
        var watchingOf=function(id){return !dis2[id] && (allOn2 || wset2[id])}
        cb.innerHTML=cs2.length
          ? cs2.map(function(c){
              var id2=String(c.courseId)
              var w=watchLocal[id2]!==undefined?watchLocal[id2]:watchingOf(id2)
              var f2=(s.courseHealth||{})[id2]||0
              var sp=!w
                ? '<span class="pill pill-off">已停用</span>'
                : (f2>=3
                    ? '<span class="pill pill-warn" title="近期轮询多次失败，多为瞬时网络或网关限流，已自动重试">扫描异常</span>'
                    : '<span class="pill pill-ok">监控中</span>')
              var w2=(s.signinWindows||{})[id2]
              var wc=w2?('<span class="cell-mono">'+esc(w2.text)+'</span>'):'<span class="cell-sub">—</span>'
              return '<tr><td class="cell-main">'+esc(c.courseName)+'</td><td class="cell-mono">'+esc(String(c.courseId))+'</td><td class="cell-mono">'+esc(String(c.classId))+'</td><td>'+wc+'</td><td>'+sp+'</td><td><button class="watch-toggle '+(w?'on':'')+'" data-cid="'+esc(id2)+'">'+(w?'关闭监听':'开启监听')+'</button></td></tr>'
            }).join('')
          : '<tr><td colspan="6" class="cell-empty">暂无课程数据</td></tr>'
      }).catch(function(){})
    })
  }
  var watchSaveBtn=document.getElementById('watchSaveBtn')
  if(watchSaveBtn)watchSaveBtn.addEventListener('click',function(){
    var rows=document.querySelectorAll('#coursesBody .watch-toggle')
    var onList=[],allOn=true
    rows.forEach(function(btn){
      var cid=btn.getAttribute('data-cid')
      var on=btn.classList.contains('on')
      if(on)onList.push(cid);else allOn=false
    })
    var msg=document.getElementById('watchMsg')
    if(!allOn&&onList.length===0){
      // 空数组 = 监听全部，直接发会把用户刚关掉的全打开
      msg.textContent='⚠️ 至少要保留一门监听的课程'
      msg.style.color='#B7791F'
      return
    }
    watchSaveBtn.disabled=true;watchSaveBtn.textContent='保存中…'
    apiFetch('/api/watch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({watchCourses:allOn?[]:onList})})
      .then(function(r){return r.json()})
      .then(function(d){
        msg.textContent=(d.ok?'✅ ':'❌ ')+(d.message||'保存失败')
        msg.style.color=d.ok?'#178A5B':'#B42318'
        watchSaveBtn.disabled=false;watchSaveBtn.textContent='保存并立即生效'
        if(d.ok){
          watchLocal={}
          // 立即生效、无需重启：刷新状态即可看到新的门数与状态列
          var st=document.getElementById('listenState')
          if(st&&d.listeningCount!==undefined)st.textContent='正在监听 '+d.listeningCount+' 门课程'
          setTimeout(function(){location.reload()},1200)
        }
      })
      .catch(function(){msg.textContent='❌ 保存失败，请重试';msg.style.color='#B42318';watchSaveBtn.disabled=false;watchSaveBtn.textContent='保存并立即生效'})
  })

  // ===== 立即扫描一次（课表之外的手动兜底；手机端在教室外也常用） =====
  var scanNowBtn=document.getElementById('scanNowBtn')
  if(scanNowBtn)scanNowBtn.addEventListener('click',function(){
    var st=document.getElementById('listenState')
    scanNowBtn.disabled=true
    scanNowBtn.dataset.busy='true';scanNowBtn.setAttribute('aria-busy','true')
    var old=scanNowBtn.textContent
    scanNowBtn.textContent='⚡ 扫描中…'
    if(st)st.textContent='正在逐门课程查询签到活动，请稍候…'
    apiFetch('/api/scan-now',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
      .then(function(r){return r.json()})
      .then(function(d){
        scanNowBtn.dataset.busy='false';scanNowBtn.setAttribute('aria-busy','false');scanNowBtn.disabled=!serviceOnline;scanNowBtn.textContent=old
        if(st){
          st.textContent=(d.ok?'✅ ':'❌ ')+(d.message||'扫描完成')
          st.style.color=d.ok?'#178A5B':'#B42318'
        }
        if(d.ok&&d.found>0)poll()
      })
      .catch(function(){
        scanNowBtn.dataset.busy='false';scanNowBtn.setAttribute('aria-busy','false');scanNowBtn.disabled=!serviceOnline;scanNowBtn.textContent=old
        if(st){st.textContent='❌ 扫描失败，请重试';st.style.color='#B42318'}
      })
  })

  // ===== 监听总开关（原 IM 通道的替代：随时能停，随时能开） =====
  var listenToggleBtn=document.getElementById('listenToggleBtn')
  if(listenToggleBtn)listenToggleBtn.addEventListener('click',function(){
    var turningOff=listenToggleBtn.dataset.listening==='true'||listenToggleBtn.textContent.indexOf('停止')>=0
    var st=document.getElementById('listenState')
    listenToggleBtn.disabled=true
    listenToggleBtn.dataset.busy='true';listenToggleBtn.setAttribute('aria-busy','true')
    var previousListenLabel=listenToggleBtn.textContent
    listenToggleBtn.textContent=turningOff?'正在停止监听…':'正在开启监听…'
    apiFetch('/api/listen',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({on:!turningOff})})
      .then(function(r){return r.json()})
      .then(function(d){
        listenToggleBtn.dataset.busy='false';listenToggleBtn.setAttribute('aria-busy','false');listenToggleBtn.disabled=!serviceOnline
        if(!d.ok){listenToggleBtn.textContent=previousListenLabel;if(st)st.textContent='未能改变监听状态：'+(d.message||'请重试');return}
        listenToggleBtn.dataset.listening=String(d.listening);listenToggleBtn.setAttribute('aria-pressed',String(d.listening))
        if(lastServiceStatus)lastServiceStatus.listening=d.listening
        listenToggleBtn.textContent=d.listening?'⏸ 停止监听':'▶ 开启监听'
        listenToggleBtn.className='btn '+(d.listening?'btn-ghost':'btn-primary')
        if(st)st.textContent=d.listening?('正在监听 '+d.listeningCount+' 门课程'):'已停止监听（不会发送任何轮询请求，二维码上传仍可用）'
        serviceConnection(serviceOnline)
      })
      .catch(function(){listenToggleBtn.dataset.busy='false';listenToggleBtn.setAttribute('aria-busy','false');listenToggleBtn.disabled=!serviceOnline;listenToggleBtn.textContent=previousListenLabel;if(st)st.textContent='无法确认监听状态，原显示已保留；请重新连接服务。';poll()})
  })

  // ===== 全部恢复监听 =====
  var coursesResetBtn=document.getElementById('coursesResetBtn')
  if(coursesResetBtn)coursesResetBtn.addEventListener('click',function(){
    var msg=document.getElementById('watchMsg')
    coursesResetBtn.disabled=true
    apiFetch('/api/courses/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
      .then(function(r){return r.json()})
      .then(function(d){
        coursesResetBtn.disabled=false
        if(msg){msg.textContent=(d.ok?'✅ ':'❌ ')+(d.message||'');msg.style.color=d.ok?'#178A5B':'#B42318'}
        if(d.ok)setTimeout(function(){location.reload()},1200)
      })
      .catch(function(){coursesResetBtn.disabled=false;if(msg)msg.textContent='❌ 操作失败，请重试'})
  })

  // ===== 账号管理（设为主账号 / 删除） =====
  var accountList=document.getElementById('accountList')
  if(accountList)accountList.addEventListener('click',function(e){
    var pBtn=e.target.closest('[data-primary]')
    var dBtn=e.target.closest('[data-remove]')
    var msg=document.getElementById('accountMsg')
    if(pBtn){
      var un=pBtn.getAttribute('data-primary')
      pBtn.disabled=true
      apiFetch('/api/accounts/primary',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:un})})
        .then(function(r){return r.json()})
        .then(function(d){
          msg.textContent=(d.ok?'✅ ':'❌ ')+(d.message||'操作失败')
          msg.style.color=d.ok?'#178A5B':'#B42318'
          if(d.ok)setTimeout(function(){location.reload()},1200)
        })
        .catch(function(){msg.textContent='❌ 操作失败';msg.style.color='#B42318';pBtn.disabled=false})
      return
    }
    if(dBtn){
      var un2=dBtn.getAttribute('data-remove')
      askConfirm({title:'删除账号',text:'确定删除账号 '+un2+' 吗？该账号保存在本地的加密密码会一并移除。',okText:'删除',danger:true}).then(function(yes){
        if(!yes)return
        dBtn.disabled=true
        apiFetch('/api/accounts/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:un2})})
          .then(function(r){return r.json()})
          .then(function(d){
            msg.textContent=(d.ok?'✅ ':'❌ ')+(d.message||'操作失败')
            msg.style.color=d.ok?'#178A5B':'#B42318'
            if(d.ok)setTimeout(function(){location.reload()},1200)
          })
          .catch(function(){msg.textContent='❌ 操作失败';msg.style.color='#B42318';dBtn.disabled=false})
      })
    }
  })

  // ===== 历史记录：清空 =====
  var clearHistoryBtn=document.getElementById('clearHistoryBtn')
  if(clearHistoryBtn)clearHistoryBtn.addEventListener('click',function(){
    askConfirm({title:'清空签到记录',text:'确定清空全部签到记录吗？此操作不可恢复。',okText:'清空',danger:true}).then(function(yes){
      if(!yes)return
      var msg=document.getElementById('historyMsg')
      clearHistoryBtn.disabled=true
      apiFetch('/api/history/clear',{method:'POST'})
        .then(function(r){return r.json()})
        .then(function(d){
          msg.textContent=(d.ok?'✅ ':'❌ ')+(d.message||'操作失败')
          msg.style.color=d.ok?'#178A5B':'#B42318'
          if(d.ok)setTimeout(function(){location.reload()},800)
        })
        .catch(function(){msg.textContent='❌ 清空失败';msg.style.color='#B42318';clearHistoryBtn.disabled=false})
    })
  })

  // ===== 钉钉图片通道设置 =====
  // 走 Stream 长连接，不需要公网地址；凭据保存到 config.yaml 后需重启建立连接。
  function dingLoad(){
    var keyEl=document.getElementById('dingKeyInput')
    var enEl=document.getElementById('dingEnabledInput')
    var hint=document.getElementById('dingStateHint')
    if(!keyEl)return
    apiFetch('/api/dingtalk/settings').then(function(r){return r.json()}).then(function(d){
      if(!d.ok)return
      keyEl.value=d.appKey||''
      if(enEl)enEl.checked=!!d.enabled
      var sec=document.getElementById('dingSecretInput')
      if(sec&&d.hasSecret)sec.placeholder='已保存（留空则不修改）'
      if(hint)hint.textContent=d.hasSecret
        ? '已配置 AppSecret（出于安全不回显，留空即保持不变）'
        : '尚未配置 AppSecret'
    }).catch(function(){})
  }
  dingLoad()
  var dingSaveBtn=document.getElementById('dingSaveBtn')
  if(dingSaveBtn)dingSaveBtn.addEventListener('click',function(){
    var msg=document.getElementById('dingMsg')
    var key=(document.getElementById('dingKeyInput')||{}).value||''
    var sec=(document.getElementById('dingSecretInput')||{}).value||''
    var en=!!(document.getElementById('dingEnabledInput')||{}).checked
    dingSaveBtn.disabled=true;dingSaveBtn.textContent='保存中…'
    apiFetch('/api/dingtalk/stream',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({appKey:key,appSecret:sec,enabled:en})})
      .then(function(r){return r.json()})
      .then(function(d){
        dingSaveBtn.disabled=false;dingSaveBtn.textContent='保存钉钉设置'
        if(msg){msg.textContent=(d.ok?'✅ ':'❌ ')+(d.message||'');msg.style.color=d.ok?'#178A5B':'#B42318'}
        if(d.ok){var s=document.getElementById('dingSecretInput');if(s)s.value='';dingLoad()}
      })
      .catch(function(){dingSaveBtn.disabled=false;dingSaveBtn.textContent='保存钉钉设置';if(msg){msg.textContent='❌ 保存失败，请重试';msg.style.color='#B42318'}})
  })

  // ===== 运行设置（轮询/抖动/重试/半径/通知/免打扰/日报） =====
  var settingsSaveBtn=document.getElementById('settingsSaveBtn')
  if(settingsSaveBtn)settingsSaveBtn.addEventListener('click',function(){
    var poll=document.getElementById('setPoll').value
    var jitter=document.getElementById('setJitter').value
    var retry=document.getElementById('setRetry').value
    var retryDelay=document.getElementById('setRetryDelay').value
    var radius=document.getElementById('setRadius').value
    var desktop=document.getElementById('setDesktop').classList.contains('on')
    var quietOn=document.getElementById('setQuiet').classList.contains('on')
    var qs=document.getElementById('setQuietStart').value
    var qe=document.getElementById('setQuietEnd').value
    var reportOn=document.getElementById('setReport').classList.contains('on')
    var reportHour=document.getElementById('setReportHour').value
    var verify=document.getElementById('setVerify').classList.contains('on')
    var msg=document.getElementById('settingsMsg')
    settingsSaveBtn.disabled=true;settingsSaveBtn.textContent='保存中…'
    apiFetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      pollInterval:poll,pollJitter:jitter,retryMaxAttempts:retry,retryDelayMs:retryDelay*1000,
      locationRadius:radius,desktop:desktop,quietEnabled:quietOn,quietStart:qs,quietEnd:qe,

      reportEnabled:reportOn,reportHour:reportHour,verifyEnabled:verify,weeklyReport:document.getElementById('setWeeklyReport').classList.contains('on'),preCheckEnabled:document.getElementById('setPreCheck').classList.contains('on'),preCheckHour:document.getElementById('setPreCheckHour').value,smartPollEnabled:document.getElementById('setSmartPoll').classList.contains('on'),humanDelayEnabled:document.getElementById('setHumanDelay').classList.contains('on'),humanDelayMin:document.getElementById('setHumanDelayMin').value,humanDelayMax:document.getElementById('setHumanDelayMax').value,confirmBeforeEnabled:document.getElementById('setConfirmBefore').classList.contains('on'),confirmBeforeWait:document.getElementById('setConfirmWait').value

    })})
      .then(function(r){return r.json()})
      .then(function(d){
        msg.textContent=(d.ok?'✅ ':'❌ ')+(d.message||'保存失败')
        msg.style.color=d.ok?'#178A5B':'#B42318'
        settingsSaveBtn.disabled=false;settingsSaveBtn.textContent='保存设置'
        if(d.ok)setTimeout(function(){location.reload()},1200)
      })
      .catch(function(){msg.textContent='❌ 保存失败';msg.style.color='#B42318';settingsSaveBtn.disabled=false;settingsSaveBtn.textContent='保存设置'})
  })
  function bindSwitch(id){
    var el=document.getElementById(id)
    if(el)el.addEventListener('click',function(){el.classList.toggle('on')})
  }

  bindSwitch('setDesktop');bindSwitch('setQuiet');bindSwitch('setReport');bindSwitch('setVerify');bindSwitch('setWeeklyReport');bindSwitch('setPreCheck');bindSwitch('setSmartPoll');bindSwitch('setHumanDelay');bindSwitch('setConfirmBefore')

  /* ---------- 时刻滚轮选择器 ----------
     不用系统弹层：它是白底直角 + 蓝色选中，与本软件的暖橙材质、圆角与语义色都不一致，
     而且必须先点到「时/分」分段里才能改值。这里点字段即弹出滚轮，滚动/拖拽/方向键都能选。 */
  var tpState=null
  function tpPad(n){return (n<10?'0':'')+n}
  function tpIndex(col){
    var ih=col.__ih||28
    return Math.max(0,Math.min((col.__n||24)-1,Math.round(col.scrollTop/ih)))
  }
  function tpSync(){
    var m=document.getElementById('tpMask')
    if(!m||!tpState)return
    var cols=m.querySelectorAll('.tp-col'),idx=[]
    for(var i=0;i<cols.length;i++){
      var col=cols[i],sel=tpIndex(col),items=col.children
      for(var j=0;j<items.length;j++)items[j].classList.toggle('sel',j===sel)
      idx.push(sel)
    }
    tpState.idx=idx
    var read=document.getElementById('tpRead')
    if(read)read.textContent=tpState.mode==='hm'?tpPad(idx[0]||0)+':'+tpPad(idx[1]||0):tpPad(idx[0]||0)+' 时'
  }
  function tpSnap(col){
    var ih=col.__ih||28
    col.scrollTo({top:tpIndex(col)*ih,behavior:'smooth'})
  }
  function tpStep(col,d){
    var ih=col.__ih||28
    var i=Math.max(0,Math.min((col.__n||24)-1,tpIndex(col)+d))
    col.scrollTo({top:i*ih,behavior:'smooth'})
    tpSync()
  }
  function tpBindCol(col){
    var drag=false,sy=0,ss=0
    col.addEventListener('pointerdown',function(e){
      drag=true;sy=e.clientY;ss=col.scrollTop
      try{col.setPointerCapture(e.pointerId)}catch(_){}
      col.style.scrollSnapType='none'
    })
    col.addEventListener('pointermove',function(e){if(drag)col.scrollTop=ss-(e.clientY-sy)})
    col.addEventListener('pointerup',function(){
      if(!drag)return
      drag=false;col.style.scrollSnapType='';tpSnap(col)
      // 拖动结束时往往已经在目标格上，scrollTo 不再产生 scroll 事件，这里必须自己同步一次
      tpSync()
    })
    col.addEventListener('pointercancel',function(){
      drag=false;col.style.scrollSnapType=''
    })
    col.addEventListener('scroll',tpSync,{passive:true})
    col.addEventListener('keydown',function(e){
      var d=e.key==='ArrowDown'?1:e.key==='ArrowUp'?-1:0
      if(!d)return
      e.preventDefault();tpStep(col,d)
    })
  }
  function tpCommit(){
    if(!tpState)return
    var f=tpState.field,idx=tpState.idx||[0,0]
    f.value=tpState.mode==='hm'?tpPad(idx[0])+':'+tpPad(idx[1]||0):String(idx[0])
    try{
      f.dispatchEvent(new Event('input',{bubbles:true}))
      f.dispatchEvent(new Event('change',{bubbles:true}))
    }catch(_){}
  }
  function tpClose(commit){
    var m=document.getElementById('tpMask')
    if(!m)return
    if(commit)tpCommit()
    m.classList.remove('show')
    var f=tpState&&tpState.field
    tpState=null
    if(f){try{f.focus({preventScroll:true})}catch(_){}}
  }
  function tpEl(){
    var m=document.getElementById('tpMask')
    if(m)return m
    m=document.createElement('div')
    m.id='tpMask';m.className='tp-mask'
    m.innerHTML='<div class="tp-pop" role="dialog" aria-modal="true" aria-label="选择时间">'
      +'<div class="tp-head"><span>选择时间</span><b id="tpRead">--:--</b></div>'
      +'<div class="tp-cols"><div class="tp-band"></div>'
      +'<div class="tp-col" tabindex="0" role="listbox" aria-label="时"></div>'
      +'<div class="tp-col" tabindex="0" role="listbox" aria-label="分"></div></div>'
      +'<div class="tp-foot">'
      +'<button type="button" class="btn btn-ghost" id="tpNow">现在</button>'
      +'<button type="button" class="btn btn-ghost" id="tpCancel">取消</button>'
      +'<button type="button" class="btn btn-primary" id="tpOk">确定</button></div></div>'
    document.body.appendChild(m)
    var cols=m.querySelectorAll('.tp-col')
    tpBindCol(cols[0]);tpBindCol(cols[1])
    m.addEventListener('pointerdown',function(e){if(e.target===m)tpClose(false)})
    m.addEventListener('keydown',function(e){
      if(e.key==='Escape'){e.preventDefault();tpClose(false)}
      else if(e.key==='Enter'){e.preventDefault();tpClose(true)}
    })
    document.getElementById('tpOk').addEventListener('click',function(){tpClose(true)})
    document.getElementById('tpCancel').addEventListener('click',function(){tpClose(false)})
    document.getElementById('tpNow').addEventListener('click',function(){
      var d=new Date()
      cols[0].scrollTo({top:d.getHours()*(cols[0].__ih||28),behavior:'smooth'})
      cols[1].scrollTo({top:d.getMinutes()*(cols[1].__ih||28),behavior:'smooth'})
      setTimeout(tpSync,160)
    })
    return m
  }
  function tpColumn(col,n){
    var html=''
    for(var k=0;k<n;k++)html+='<div class="tp-item" role="option">'+tpPad(k)+'</div>'
    col.innerHTML=html
    col.__n=n
  }
  function tpOpen(field){
    var mode=field.getAttribute('data-tp')==='h'?'h':'hm'
    var m=tpEl(),cols=m.querySelectorAll('.tp-col'),pop=m.querySelector('.tp-pop')
    tpColumn(cols[0],24)
    tpColumn(cols[1],60)
    cols[1].style.display=mode==='hm'?'':'none'
    document.getElementById('tpNow').style.display=mode==='hm'?'':'none'
    var raw=String(field.value||'').trim(),h=0,mi=0
    if(mode==='hm'){
      // 整页 HTML 是 TS 模板字符串，正则里的反斜杠+d 会被模板吃掉，所以这里用 split 解析
      var p=raw.split(':')
      h=Math.max(0,Math.min(23,parseInt(p[0],10)||0))
      mi=Math.max(0,Math.min(59,parseInt(p[1],10)||0))
    }else{
      h=Math.max(0,Math.min(23,parseInt(raw,10)||0))
    }
    tpState={field:field,mode:mode,idx:[h,mi]}
    m.classList.add('show')
    // 用计算样式而不是 getBoundingClientRect：弹层正在跑入场动画（scale .98）时
    // 量到的是缩放后的高度，snap 会漂移、松手后跳回上一格
    var ih=parseFloat(getComputedStyle(cols[0].firstChild).height)||28
    cols[0].__ih=ih;cols[1].__ih=ih
    cols[0].scrollTop=h*ih
    cols[1].scrollTop=mi*ih
    if(window.matchMedia('(pointer: coarse)').matches){
      pop.style.left='';pop.style.top=''
    }else{
      var r=field.getBoundingClientRect(),pw=pop.offsetWidth,ph=pop.offsetHeight
      var left=Math.max(8,Math.min(r.left,window.innerWidth-pw-8))
      var top=r.bottom+6
      if(top+ph>window.innerHeight-8)top=Math.max(8,r.top-ph-6)
      pop.style.left=left+'px';pop.style.top=top+'px'
    }
    tpSync()
    try{cols[0].focus({preventScroll:true})}catch(_){}
    // 弹层刚由 display:none 转 block，这一帧的布局还不稳，直接赋 scrollTop 会被吞掉
    // （表现为永远从 00:00 开始）。下一帧再定位一次。
    requestAnimationFrame(function(){
      if(!tpState||tpState.field!==field)return
      cols[0].scrollTop=h*ih
      cols[1].scrollTop=mi*ih
      tpSync()
    })
  }
  function tpBindFields(){
    var list=document.querySelectorAll('.tp-field')
    for(var i=0;i<list.length;i++){
      (function(f){
        f.setAttribute('aria-haspopup','dialog')
        f.addEventListener('mousedown',function(e){e.preventDefault();tpOpen(f)})
        f.addEventListener('touchstart',function(e){e.preventDefault();tpOpen(f)},{passive:false})
        f.addEventListener('click',function(e){e.preventDefault()})
        f.addEventListener('keydown',function(e){
          if(e.key==='Enter'||e.key===' '||e.key==='ArrowDown'){e.preventDefault();tpOpen(f)}
        })
      })(list[i])
    }
  }
  tpBindFields()

  /* ---------- 轻提示与应用内对话框 ---------- */
  function toast(msg,kind){
    var wrap=document.getElementById('toastWrap')
    if(!wrap)return
    var t=document.createElement('div')
    t.className='toast'+(kind==='ok'?' toast-ok':kind==='err'?' toast-err':'')
    t.textContent=msg
    wrap.appendChild(t)
    setTimeout(function(){
      t.style.transition='opacity .25s ease';t.style.opacity='0'
      setTimeout(function(){if(t.parentNode)t.parentNode.removeChild(t)},280)
    },kind==='err'?4200:2600)
  }
  function askDialog(o){
    return new Promise(function(resolve){
      var mask=document.getElementById('dialogMask')
      if(!mask){resolve(null);return}
      var title=document.getElementById('dlgTitle'),text=document.getElementById('dlgText')
      var input=document.getElementById('dlgInput'),ok=document.getElementById('dlgOk')
      var cancel=document.getElementById('dlgCancel'),close=document.getElementById('dlgClose')
      title.textContent=o.title||'请确认'
      text.textContent=o.text||''
      text.style.display=o.text?'':'none'
      var wantInput=!!o.input
      input.style.display=wantInput?'':'none'
      if(wantInput){input.value=o.value||'';input.placeholder=o.placeholder||''}
      ok.textContent=o.okText||'确定'
      ok.className='btn '+(o.danger?'btn-danger':'btn-primary')
      cancel.style.display=o.cancel===false?'none':''
      mask.style.display='flex'
      function done(v){
        mask.style.display='none'
        mask.onkeydown=ok.onclick=cancel.onclick=close.onclick=mask.onclick=null
        resolve(v)
      }
      ok.onclick=function(){done(wantInput?input.value:true)}
      cancel.onclick=function(){done(null)}
      close.onclick=function(){done(null)}
      mask.onclick=function(e){if(e.target===mask)done(null)}
      mask.onkeydown=function(e){
        if(wantInput&&e.key==='Enter'){e.preventDefault();done(input.value)}
      }
      setTimeout(function(){
        if(wantInput){input.focus();input.select()}else{ok.focus()}
      },60)
    })
  }
  function askConfirm(o){return askDialog(o).then(function(v){return v===true})}

  /* ---------- 监听范围：从课程页的开关算出目标集合，再提交 ---------- */
  function watchListFromDom(skipCid,flip){
    var on=[],allOn=true
    document.querySelectorAll('#coursesBody .watch-toggle').forEach(function(btn){
      var id=btn.getAttribute('data-cid')
      var s=btn.classList.contains('on')
      if(id===skipCid&&flip)s=!s
      if(s)on.push(id);else allOn=false
    })
    return {on:on,allOn:allOn}
  }
  function applyWatchList(list,allOn,done){
    if(!allOn&&list.length===0){
      // /api/watch 里空数组的语义是「监听全部」，照发会把所有课程都打开，与用户意图相反
      toast('至少要保留一门监听的课程','err')
      if(done)done(null)
      return
    }
    apiFetch('/api/watch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({watchCourses:allOn?[]:list})})
      .then(function(r){return r.json()})
      .then(function(d){
        toast((d.ok?'✅ ':'❌ ')+(d.message||'保存失败'),d.ok?'ok':'err')
        if(done)done(d)
      })
      .catch(function(){toast('❌ 保存失败，请检查网络','err');if(done)done(null)})
  }
  // 配置导出
  var cfgExportBtn=document.getElementById('cfgExportBtn')
  if(cfgExportBtn)cfgExportBtn.addEventListener('click',function(){
    window.location.href='/api/config/export${qs}'
  })
  // 配置导入
  var cfgImportBtn=document.getElementById('cfgImportBtn')
  var cfgFileInput=document.getElementById('cfgFileInput')
  if(cfgImportBtn&&cfgFileInput)cfgImportBtn.addEventListener('click',function(){cfgFileInput.click()})
  if(cfgFileInput)cfgFileInput.addEventListener('change',function(){
    var f=cfgFileInput.files[0];if(!f)return
    var reader=new FileReader()
    reader.onload=function(){
      apiFetch('/api/config/import',{method:'POST',headers:{'Content-Type':'application/json'},body:reader.result})
        .then(function(r){return r.json()})
        .then(function(d){
          var msg=document.getElementById('cfgMsg')
          if(msg){msg.textContent=(d.ok?'✅ ':'❌ ')+(d.message||'操作失败');msg.style.color=d.ok?'#178A5B':'#B42318'}
          if(d.ok)setTimeout(function(){location.reload()},1500)
        })
        .catch(function(){var msg=document.getElementById('cfgMsg');if(msg){msg.textContent='❌ 导入失败';msg.style.color='#B42318'}})
    }
    reader.readAsText(f)
  })



  // ===== 签到日历（月历视图） =====
  var calState={y:0,m:0,sel:null,data:{}}
  function calInit(){var n=new Date();calState.y=n.getFullYear();calState.m=n.getMonth()+1}
  function renderCal(){
    var y=calState.y,m=calState.m
    var t=document.getElementById('calTitle')
    if(t)t.textContent=y+' 年 '+m+' 月'
    apiFetch('/api/calendar?month='+y+'-'+String(m).padStart(2,'0')).then(function(r){return r.json()}).then(function(d){
      calState.data=d.days||{}
      var first=new Date(y,m-1,1)
      var startDay=(first.getDay()+6)%7
      var dim=new Date(y,m,0).getDate()
      var cells=''
      for(var i=0;i<startDay;i++)cells+='<div class="cal-cell cal-other"></div>'
      var today=new Date()
      for(var day=1;day<=dim;day++){
        var e=calState.data[String(day)]
        var isToday=today.getFullYear()===y&&today.getMonth()+1===m&&today.getDate()===day
        var cls='cal-cell'+(isToday?' cal-today':'')+(calState.sel===day?' cal-sel':'')
        var body='<div class="cal-day-num">'+day+'</div>'
        if(e&&(e.success||e.fail)){
          body+='<div class="cal-badges">'
          if(e.success)body+='<span class="cal-ok">'+e.success+' 成功</span>'
          if(e.fail)body+='<span class="cal-err">'+e.fail+' 失败</span>'
          body+='</div>'
        }
        cells+='<div class="'+cls+'" data-day="'+day+'">'+body+'</div>'
      }
      var grid=document.getElementById('calGrid')
      if(grid)grid.innerHTML=cells
      showCalDetail(calState.sel)
    }).catch(function(){})
  }
  function showCalDetail(day){
    var box=document.getElementById('calDetail')
    if(!box)return
    if(!day){box.innerHTML='';return}
    var e=calState.data[String(day)]
    if(!e||!e.items||!e.items.length){box.innerHTML='<div class="cell-empty" style="padding:14px 0">当天暂无签到记录，点击有记录的日期查看详情</div>';return}
    var rows=e.items.map(function(it){
      var ok=/成功|✅|已签到/.test(it.result)
      return '<div class="cal-detail-item"><span class="cell-sub">'+esc(it.time||'')+'</span><span class="cell-main">'+esc(it.course)+'</span><span class="cell-sub">'+esc(typeText(it.type))+'</span><span class="pill '+(ok?'pill-ok':'pill-err')+'">'+(ok?'成功':'失败')+'</span></div>'
    }).join('')
    box.innerHTML='<div style="font-size:var(--fs-sm);font-weight:var(--fw-semibold);color:var(--text-2);margin-bottom:6px">'+calState.y+' 年 '+calState.m+' 月 '+day+' 日 · 共 '+(e.success+e.fail)+' 次签到</div>'+rows
  }
  var calGridEl=document.getElementById('calGrid')
  if(calGridEl)calGridEl.addEventListener('click',function(ev){
    var cell=ev.target.closest('.cal-cell[data-day]')
    if(!cell)return
    var day=Number(cell.getAttribute('data-day'))
    calState.sel=calState.sel===day?null:day
    renderCal()
  })
  var calPrev=document.getElementById('calPrev'),calNext=document.getElementById('calNext')
  if(calPrev)calPrev.addEventListener('click',function(){calState.m--;if(calState.m<1){calState.m=12;calState.y--}calState.sel=null;renderCal()})
  if(calNext)calNext.addEventListener('click',function(){calState.m++;if(calState.m>12){calState.m=1;calState.y++}calState.sel=null;renderCal()})
  calInit();renderCal()

  // ===== 网络与代理 =====
  var proxyInput=document.getElementById('proxyInput')
  var proxyMsg=document.getElementById('proxyMsg')
  if(proxyInput)apiFetch('/api/proxy').then(function(r){return r.json()}).then(function(d){proxyInput.value=d.proxy||''}).catch(function(){})
  var proxySaveBtn=document.getElementById('proxySaveBtn')
  if(proxySaveBtn)proxySaveBtn.addEventListener('click',function(){
    proxySaveBtn.disabled=true;proxyMsg.textContent='保存中…';proxyMsg.style.color='#0E7C66'
    apiFetch('/api/proxy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({proxy:proxyInput.value.trim()})})
      .then(function(r){return r.json()})
      .then(function(d){
        proxyMsg.textContent=(d.ok?'✅ ':'❌ ')+(d.message||'保存失败')
        proxyMsg.style.color=d.ok?'#178A5B':'#B42318'
        proxySaveBtn.disabled=false
      })
      .catch(function(){proxyMsg.textContent='❌ 保存失败';proxyMsg.style.color='#B42318';proxySaveBtn.disabled=false})
  })
  var proxyTestBtn=document.getElementById('proxyTestBtn')
  if(proxyTestBtn)proxyTestBtn.addEventListener('click',function(){
    proxyTestBtn.disabled=true;proxyMsg.textContent='测试中…';proxyMsg.style.color='#0E7C66'
    apiFetch('/api/proxy/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({proxy:proxyInput.value.trim()})})
      .then(function(r){return r.json()})
      .then(function(d){
        proxyMsg.textContent=(d.ok?'✅ ':'❌ ')+(d.message||'测试失败')
        proxyMsg.style.color=d.ok?'#178A5B':'#B42318'
        proxyTestBtn.disabled=false
      })
      .catch(function(){proxyMsg.textContent='❌ 测试失败';proxyMsg.style.color='#B42318';proxyTestBtn.disabled=false})
  })
  var diagBtn=document.getElementById('diagBtn'),diagResult=document.getElementById('diagResult')
  if(diagBtn)diagBtn.addEventListener('click',function(){
    diagBtn.disabled=true;diagBtn.textContent='诊断中…'
    diagResult.style.display='block'
    diagResult.innerHTML='<div class="cell-empty" style="padding:20px 0">正在逐项检测，约需 5~15 秒…</div>'
    apiFetch('/api/diag').then(function(r){return r.json()}).then(function(d){
      var head=''
      if(d.cookie===false)head='<div class="diag-item"><span class="diag-name">提示</span><span class="diag-detail">未配置账号或 Cookie 为空，课程 / 签到接口检测结果仅供参考</span></div>'
      if(d.proxy)head+='<div class="diag-item"><span class="diag-name">当前代理</span><span class="diag-detail cell-mono">'+esc(d.proxy)+'</span></div>'
      var rows=(d.results||[]).map(function(r){
        return '<div class="diag-item"><span class="diag-name">'+esc(r.name)+'</span><span class="pill '+(r.ok?'pill-ok':'pill-err')+'">'+(r.ok?'正常':'异常')+'</span><span class="diag-ms">'+(r.ms>0?r.ms+'ms':'')+'</span><span class="diag-detail">'+esc(r.detail)+'</span></div>'
      }).join('')
      diagResult.innerHTML=head+rows
      diagBtn.disabled=false;diagBtn.textContent='一键网络诊断'
    }).catch(function(){
      diagResult.innerHTML='<div class="cell-empty" style="padding:20px 0">诊断失败，请稍后重试</div>'
      diagBtn.disabled=false;diagBtn.textContent='一键网络诊断'
    })
  })

  // 测试通知
  var notifyTestBtn=document.getElementById('notifyTestBtn')
  if(notifyTestBtn)notifyTestBtn.addEventListener('click',function(){
    var msg=document.getElementById('settingsMsg')
    msg.textContent='正在发送…';msg.style.color='#0E7C66'
    apiFetch('/api/notify/test',{method:'POST'})
      .then(function(r){return r.json()})
      .then(function(d){
        msg.textContent=(d.ok?'✅ ':'❌ ')+(d.message||'发送失败')
        msg.style.color=d.ok?'#178A5B':'#B42318'
      })
      .catch(function(){msg.textContent='❌ 发送失败';msg.style.color='#B42318'})
  })
  // 开机自启
  var alBtn=document.getElementById('setAutoLaunch')
  if(alBtn&&window.appCtl){
    window.appCtl.getAutoLaunch().then(function(v){alBtn.classList.toggle('on',!!v)}).catch(function(){})
    alBtn.addEventListener('click',function(){
      var next=!alBtn.classList.contains('on')
      alBtn.classList.toggle('on',next)
      window.appCtl.setAutoLaunch(next).then(function(r){
        if(!r||!r.ok){
          alBtn.classList.toggle('on',!next)
          var msg=document.getElementById('settingsMsg')
          msg.textContent='❌ '+(r&&r.message||'设置失败，请安装版重试')
          msg.style.color='#B42318'
        }
      }).catch(function(){alBtn.classList.toggle('on',!next)})
    })
  }

  // ===== 重新拉取课程列表 =====
  var refreshCoursesBtn=document.getElementById('refreshCoursesBtn')
  if(refreshCoursesBtn)refreshCoursesBtn.addEventListener('click',function(){
    var msg=document.getElementById('watchMsg')
    refreshCoursesBtn.disabled=true;refreshCoursesBtn.textContent='正在拉取…'
    apiFetch('/api/courses/refresh',{method:'POST'})
      .then(function(r){return r.json()})
      .then(function(d){
        msg.textContent=(d.ok?'✅ ':'❌ ')+(d.message||'刷新失败')
        msg.style.color=d.ok?'#178A5B':'#B42318'
        refreshCoursesBtn.disabled=false;refreshCoursesBtn.textContent='重新拉取课程列表'
        if(d.ok)setTimeout(function(){location.reload()},1500)
      })
      .catch(function(){msg.textContent='❌ 刷新失败';msg.style.color='#B42318';refreshCoursesBtn.disabled=false;refreshCoursesBtn.textContent='重新拉取课程列表'})
  })

  // ===== 填写课表（扫描的唯一依据） =====
  // 课表是 5 天 × 8 节的下拉网格：每节只能放一门课。未填满时后端拒绝保存，
  // 界面同步给出"务必全部填完，否则识别不到、只能手动签到"的提示。
  var ttState={table:null,slots:[],weekdays:[],courses:[],suggested:{}}
  function ttEsc(s){return esc(String(s==null?'':s))}
  function ttRender(){
    var body=document.getElementById('ttBody');if(!body)return
    var slots=ttState.slots||[],days=ttState.weekdays||[]
    if(!slots.length||!days.length){body.innerHTML='<tr><td colspan="6" class="cell-empty">课表数据加载失败</td></tr>';return}
    var opts='<option value="">— 请选择课程 —</option>'+ttState.courses.map(function(c){
      return '<option value="'+ttEsc(c.courseId)+'">'+ttEsc(c.courseName)+'</option>'
    }).join('')
    var html='',lastHalf=''
    slots.forEach(function(s){
      if(s.half!==lastHalf){
        lastHalf=s.half
        html+='<tr class="tt-half"><td colspan="6">'+(s.half==='morning'?'上午 07:30–12:30':'下午 14:00–21:00')+'</td></tr>'
      }
      html+='<tr><td class="tt-slot"><b>'+ttEsc(s.label)+'</b><span>'+ttEsc(s.startText)+'–'+ttEsc(s.endText)+'</span></td>'
      days.forEach(function(d){
        var cur=(ttState.table&&ttState.table[String(d.value)])?ttState.table[String(d.value)][s.index]:''
        var cls=cur?'tt-filled':'tt-empty'
        html+='<td><select class="tt-cell '+cls+'" data-dow="'+d.value+'" data-slot="'+s.index+'">'
          +opts.replace('value="'+ttEsc(cur||'')+'"','value="'+ttEsc(cur||'')+'" selected')
          +'</select></td>'
      })
      html+='</tr>'
    })
    body.innerHTML=html
    ttUpdateCount()
    // 选中值用 JS 明确设置，避免字符串替换在课程名含特殊字符时出错
    body.querySelectorAll('select.tt-cell').forEach(function(sel){
      var d=sel.getAttribute('data-dow'),i=Number(sel.getAttribute('data-slot'))
      var v=(ttState.table&&ttState.table[d])?ttState.table[d][i]:''
      if(v)sel.value=v
    })
  }
  function ttCollect(){
    var table={}
    var body=document.getElementById('ttBody')
    if(!body)return table
    body.querySelectorAll('select.tt-cell').forEach(function(sel){
      var d=sel.getAttribute('data-dow'),i=Number(sel.getAttribute('data-slot'))
      if(!table[d])table[d]=[]
      table[d][i]=sel.value||null
    })
    return table
  }
  function ttUpdateCount(){
    var body=document.getElementById('ttBody');if(!body)return
    var all=body.querySelectorAll('select.tt-cell'),filled=0
    all.forEach(function(s){if(s.value)filled++})
    var el=document.getElementById('ttCount')
    if(el)el.innerHTML='已填 <b>'+filled+'</b> / '+all.length+' 格'
    var warn=document.getElementById('ttWarn'),ok=document.getElementById('ttOk')
    if(warn)warn.style.display=filled<all.length?'':'none'
    if(ok)ok.style.display=(all.length>0&&filled===all.length)?'':'none'
  }
  function ttLoad(){
    apiFetch('/api/timetable').then(function(r){return r.json()}).then(function(d){
      if(!d.ok){var b=document.getElementById('ttBody');if(b)b.innerHTML='<tr><td colspan="6" class="cell-empty">'+ttEsc(d.message||'加载失败')+'</td></tr>';return}
      ttState.table=d.table||{}
      ttState.slots=d.slots||[]
      ttState.weekdays=d.weekdays||[]
      ttState.courses=d.courses||[]
      ttRender()
      var st=d.status||{}
      var warn=document.getElementById('ttWarn'),ok=document.getElementById('ttOk')
      if(warn){
        warn.style.display=st.complete?'none':''
        if(!st.complete){
          var names=(st.emptySlots||[]).slice(0,12).map(function(e){return e.weekdayName+e.label}).join('、')
          var more=(st.emptySlots||[]).length>12?' 等 '+(st.emptySlots.length-12)+' 处':''
          warn.innerHTML='<b>⚠ 课表未填完（'+st.filled+'/'+st.total+'）</b>'
            +'务必把所有格子填完，否则该时段的签到无法被识别，只能手动签到。<br>未填：'+ttEsc(names)+ttEsc(more)
        }
      }
      if(ok&&st.complete)ok.innerHTML='✅ 课表已填完（'+st.filled+'/'+st.total+'），扫描将严格按这张课表进行'
    }).catch(function(){
      var b=document.getElementById('ttBody');if(b)b.innerHTML='<tr><td colspan="6" class="cell-empty">加载失败</td></tr>'
    })
  }
  var ttBodyEl=document.getElementById('ttBody')
  if(ttBodyEl){
    ttBodyEl.addEventListener('change',function(e){
      var sel=e.target.closest('select.tt-cell');if(!sel)return
      sel.className='tt-cell '+(sel.value?'tt-filled':'tt-empty')
      ttUpdateCount()
    })
    ttLoad()
  }
  var ttAutoBtn=document.getElementById('ttAutoBtn')
  if(ttAutoBtn)ttAutoBtn.addEventListener('click',function(){
    var msg=document.getElementById('ttMsg')
    ttAutoBtn.disabled=true;ttAutoBtn.textContent='生成中…'
    apiFetch('/api/timetable/suggest',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
      .then(function(r){return r.json()})
      .then(function(d){
        ttAutoBtn.disabled=false;ttAutoBtn.textContent='按最近签到时间自动填充'
        if(!d.ok){if(msg){msg.textContent='❌ '+(d.message||'生成失败');msg.style.color='#B42318'}return}
        ttState.table=d.table||ttState.table
        ttRender()
        var det=(d.details||[])
        if(msg){
          msg.style.color='#178A5B'
          msg.textContent=det.length
            ? '✅ 已按最近签到时间填了 '+det.length+' 格：'+det.slice(0,6).map(function(x){return x.courseName+'→周'+x.weekday+'第'+(x.slot+1)+'节('+x.from+')'}).join('；')+(det.length>6?' 等':'')+'。请核对并补全剩余空格后保存。'
            : 'ℹ 没有可用的签到记录来推断课表（或对应格子已被占用）。请手动选择课程并填完所有格子。'
        }
      })
      .catch(function(){ttAutoBtn.disabled=false;ttAutoBtn.textContent='按最近签到时间自动填充';if(msg){msg.textContent='❌ 生成失败';msg.style.color='#B42318'}})
  })
  var ttSaveBtn=document.getElementById('ttSaveBtn')
  if(ttSaveBtn)ttSaveBtn.addEventListener('click',function(){
    var msg=document.getElementById('ttMsg')
    var table=ttCollect()
    ttSaveBtn.disabled=true;ttSaveBtn.textContent='保存中…'
    apiFetch('/api/timetable/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table:table})})
      .then(function(r){return r.json()})
      .then(function(d){
        ttSaveBtn.disabled=false;ttSaveBtn.textContent='保存课表'
        if(msg){msg.textContent=(d.ok?'✅ ':'❌ ')+(d.message||'');msg.style.color=d.ok?'#178A5B':'#B42318'}
        if(d.ok){ttState.table=table;ttLoad()}
      })
      .catch(function(){ttSaveBtn.disabled=false;ttSaveBtn.textContent='保存课表';if(msg){msg.textContent='❌ 保存失败，请重试';msg.style.color='#B42318'}})
  })
  var ttClearBtn=document.getElementById('ttClearBtn')
  if(ttClearBtn)ttClearBtn.addEventListener('click',function(){
    var body=document.getElementById('ttBody');if(!body)return
    body.querySelectorAll('select.tt-cell').forEach(function(s){s.value='';s.className='tt-cell tt-empty'})
    ttUpdateCount()
    var msg=document.getElementById('ttMsg')
    if(msg){msg.textContent='已清空，请重新选择课程后点「保存课表」（必须全部填完）';msg.style.color='#B42318'}
  })

  // ===== 运行日志查看 =====
  function loadSchedule(){
    var grid=document.getElementById('scheduleGrid');if(!grid)return
    grid.innerHTML='<div class="grid-empty">加载中...</div>'
    Promise.all([apiFetch('/api/schedule').then(function(r){return r.json()}),apiFetch('/api/course-notes').then(function(r){return r.json()}).catch(function(){return{notes:{}}})]).then(function(results){
      var d=results[0],notesData=results[1]
      if(!d.ok||!d.schedule){grid.innerHTML='<div class="grid-empty">加载失败</div>';return}
      var list=d.schedule
      var notes=notesData.notes||{}
      var total=list.length,watching=list.filter(function(c){return c.watching&&!c.isRetired}).length,retired=list.filter(function(c){return c.isRetired}).length
      var succ=list.reduce(function(a,c){return a+(c.success||0)},0),fail=list.reduce(function(a,c){return a+(c.fail||0)},0)
      document.getElementById('schTotal').textContent=total
      document.getElementById('schWatching').textContent=watching
      document.getElementById('schRetired').textContent=retired
      document.getElementById('schSuccess').textContent=succ
      document.getElementById('schFail').textContent=fail
      if(total===0){grid.innerHTML='<div class="grid-empty">暂无课程，请先在设置页登录账号</div>';return}
      grid.innerHTML=list.map(function(c){
        var badge=c.isRetired?'<span class="course-card-badge badge-retired">已结课</span>':(c.watching?'<span class="course-card-badge badge-on">监听中</span>':'<span class="course-card-badge badge-off">已停用</span>')
        var cls='course-card'+(c.watching&&!c.isRetired?' watching':'')+(c.isRetired?' retired':'')
        var note=notes[c.courseId]?'<div class="course-note" title="点击编辑备注">📝 '+esc(notes[c.courseId])+'</div>':''
        return '<div class="'+cls+'" data-cid="'+esc(c.courseId)+'" data-cname="'+esc(c.courseName)+'">'+badge+'<div class="course-card-name">'+esc(c.courseName)+'</div><div class="course-card-teacher">'+esc(c.teacherName||'未知老师')+'</div>'+note+'<div class="course-card-stats"><span class="course-card-stat-ok">成功 '+(c.success||0)+'</span><span class="course-card-stat-fail">失败 '+(c.fail||0)+'</span><button class="btn btn-ghost btn-sm detail-btn" data-cname="'+esc(c.courseName)+'" style="margin-left:auto;padding:2px 8px;font-size:var(--fs-xs)">详情</button></div></div>'
      }).join('')
      // 备注点击编辑
      grid.querySelectorAll('.course-note').forEach(function(el){
        el.addEventListener('click',function(e){
          e.stopPropagation()
          var card=el.closest('.course-card')
          var cid=card.dataset.cid
          var cname=card.dataset.cname
          var cur=notes[cid]||''
          askDialog({title:cname+' 的备注',input:true,value:cur,placeholder:'例如：周三第 3 节，教学楼 B203',okText:'保存'}).then(function(val){
            if(val===null)return
            var payload={};payload[cid]=String(val).trim()
            apiFetch('/api/course-notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
              .then(function(){loadSchedule()})
              .catch(function(){toast('❌ 备注保存失败','err')})
          })
        })
      })
      // 详情按钮
      grid.querySelectorAll('.detail-btn').forEach(function(btn){
        btn.addEventListener('click',function(e){
          e.stopPropagation()
          showCourseDetail(btn.dataset.cname)
        })
      })
      // 卡片点击切换监听：直接落到 /api/watch（此前只写 localStorage，没人读，点了等于没点）
      grid.querySelectorAll('.course-card').forEach(function(card){
        card.style.cursor='pointer'
        card.addEventListener('click',function(){
          var cid=card.dataset.cid;if(!cid)return
          var w=watchListFromDom(cid,true)
          applyWatchList(w.on,w.allOn,function(d){if(d&&d.ok)loadSchedule()})
        })
      })
    }).catch(function(){grid.innerHTML='<div class="grid-empty">加载失败，请检查服务状态</div>'})
  }

  // 课程签到详情弹窗
  function showCourseDetail(courseName){
    var modal=document.getElementById('courseDetailModal')
    if(!modal)return
    modal.style.display='flex'
    document.getElementById('detailTitle').textContent=courseName+' - 签到记录'
    document.getElementById('detailBody').innerHTML='<div style="text-align:center;padding:30px;color:var(--text-3)">加载中...</div>'
    apiFetch('/api/course-detail?course='+encodeURIComponent(courseName)).then(function(r){return r.json()}).then(function(d){
      if(!d.ok||!d.records||d.records.length===0){
        document.getElementById('detailBody').innerHTML='<div style="text-align:center;padding:30px;color:var(--text-3)">暂无签到记录</div>'
        return
      }
      var rows=d.records.map(function(r){
        var ok=/成功|✅|已签到/.test(r.result||'')
        return '<tr><td class="cell-mono" data-label="时间">'+esc(r.time||'')+'</td><td data-label="类型">'+esc(r.type||'普通')+'</td><td data-label="账号">'+esc(r.account||'')+'</td><td data-label="结果"><span class="pill '+(ok?'pill-ok':'pill-off')+'">'+esc(r.result||'')+'</span></td></tr>'
      }).join('')
      document.getElementById('detailBody').innerHTML='<div style="margin-bottom:10px;font-size:var(--fs-sm);color:var(--text-3)">共 '+d.total+' 条记录（最近100条）</div><table><thead><tr><th>时间</th><th>类型</th><th>账号</th><th>结果</th></tr></thead><tbody>'+rows+'</tbody></table>'
    }).catch(function(){document.getElementById('detailBody').innerHTML='<div style="text-align:center;padding:30px;color:var(--text-3)">加载失败</div>'})
  }

function loadLogs(){
    var box=document.getElementById('logBox')
    if(!box)return
    apiFetch('/api/logs?lines=200')
      .then(function(r){return r.json()})
      .then(function(d){
        if(!d.ok||!d.lines){box.innerHTML='<div class="log-empty">'+esc(d.message||'暂无日志')+'</div>';return}
        var lf=document.getElementById('logFile')
        if(lf)lf.textContent=(d.file||'')+' · 最近 '+d.lines.length+' 行'
        if(!d.lines.length){box.innerHTML='<div class="log-empty">暂无日志</div>';return}
        box.innerHTML=d.lines.map(function(line){
          var cls=''
          if(/\[ERROR\]/.test(line))cls='err'
          else if(/\[WARN\]/.test(line))cls='warn'
          else if(/\[OK\]/.test(line))cls='ok'
          return '<div class="log-line '+cls+'">'+esc(line)+'</div>'
        }).join('')
        box.scrollTop=box.scrollHeight
      })
      .catch(function(){box.innerHTML='<div class="log-empty">日志读取失败</div>'})
  }
  var logRefreshBtn=document.getElementById('logRefreshBtn')
  if(logRefreshBtn)logRefreshBtn.addEventListener('click',loadLogs)
  loadLogs()

  // ===== 二维码签到弹窗（拖入/选择图片即签） =====
  var qrModal=document.getElementById('qrModal')
  var qrStatus=document.getElementById('qrStatus')
  function openQrModal(){if(dragMask)dragMask.classList.remove('show');qrModal.style.display='flex';if(qrStatus){qrStatus.textContent='';qrStatus.className='qr-status'}}
  function closeQrModal(){qrModal.style.display='none'}
  var btnQrModal=document.getElementById('btnQrModal')
  if(btnQrModal)btnQrModal.addEventListener('click',openQrModal)
  // 移动端 FAB：与右上角「二维码签到」同一入口
  var fabQr=document.getElementById('fabQr')
  if(fabQr)fabQr.addEventListener('click',openQrModal)
  // 复制手机上传地址（手机端输入长 URL 很麻烦，桌面端点一下复制再发过去即可）
  var qrCopyBtn=document.getElementById('qrCopyBtn')
  if(qrCopyBtn)qrCopyBtn.addEventListener('click',function(){
    var el=document.getElementById('qrMobileUrl')
    var label=document.getElementById('qrCopyLabel')
    var txt=el?el.textContent:''
    function done(ok){if(label){label.textContent=ok?'已复制':'复制失败';setTimeout(function(){label.textContent='复制'},1800)}}
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(txt).then(function(){done(true)},function(){done(false)})
    }else{
      try{
        var ta=document.createElement('textarea')
        ta.value=txt;ta.style.position='fixed';ta.style.opacity='0'
        document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta)
        done(true)
      }catch(e){done(false)}
    }
  })
  var qrModalClose=document.getElementById('qrModalClose')
  if(qrModalClose)qrModalClose.addEventListener('click',closeQrModal)
  if(qrModal)qrModal.addEventListener('click',function(e){if(e.target===qrModal)closeQrModal()})

  /* ---------- 浮层统一关闭（Esc / 点遮罩） ---------- */
  var detailModal=document.getElementById('courseDetailModal')
  var detailClose=document.getElementById('detailClose')
  if(detailClose)detailClose.addEventListener('click',function(){detailModal.style.display='none'})
  if(detailModal)detailModal.addEventListener('click',function(e){if(e.target===detailModal)detailModal.style.display='none'})
  if(updateModal)updateModal.addEventListener('click',function(e){if(e.target===updateModal)updateModal.style.display='none'})
  function closeTopOverlay(){
    var uhp=document.getElementById('updHover')
    if(uhp&&uhp.classList.contains('show')){uhp.classList.remove('show');return true}
    var tp=document.getElementById('tpMask')
    if(tp&&tp.classList.contains('show')){tpClose(false);return true}
    var dlg=document.getElementById('dialogMask')
    if(dlg&&dlg.style.display==='flex'){var b=document.getElementById('dlgCancel');if(b)b.click();return true}
    if(detailModal&&detailModal.style.display==='flex'){detailModal.style.display='none';return true}
    if(qrModal&&qrModal.style.display==='flex'){closeQrModal();return true}
    if(updateModal&&updateModal.style.display==='flex'){updateModal.style.display='none';return true}
    // 免责声明是同意闸门，不给 Esc 绕过
    if(dragMask&&dragMask.classList.contains('show')){dragMask.classList.remove('show');return true}
    return false
  }
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'&&closeTopOverlay())e.preventDefault()
  })
  // 兜底：未捕获的 Promise 失败必须可见，否则用户点了按钮只是「静默没反应」
  window.addEventListener('unhandledrejection',function(e){
    toast('操作失败：'+((e.reason&&e.reason.message)||e.reason||'未知错误'),'err')
  })
  function uploadQrFile(file){
    if(!file)return
    if(file.type.indexOf('image/')!==0){qrStatus.textContent='请选择图片文件';qrStatus.className='qr-status err';return}
    qrStatus.textContent='正在识别签到…';qrStatus.className='qr-status'
    apiFetch('/upload/image?type=qr',{method:'POST',body:file,headers:{'Content-Type':file.type}})
      .then(function(r){return r.json()})
      .then(function(d){
        if(d.success){qrStatus.textContent='✅ '+d.message;qrStatus.className='qr-status ok'}
        else{qrStatus.textContent='❌ '+(d.error||'处理失败');qrStatus.className='qr-status err'}
      })
      .catch(function(err){qrStatus.textContent='❌ 上传失败: '+err.message;qrStatus.className='qr-status err'})
  }
  var qrDrop=document.getElementById('qrDrop')
  if(qrDrop){
    qrDrop.addEventListener('dragover',function(e){e.preventDefault();e.stopPropagation();qrDrop.classList.add('drag')})
    qrDrop.addEventListener('dragleave',function(){qrDrop.classList.remove('drag')})
    qrDrop.addEventListener('drop',function(e){
      e.preventDefault();e.stopPropagation();qrDrop.classList.remove('drag')
      var f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0]
      if(f)uploadQrFile(f)
    })
  }
  var btnPickFile=document.getElementById('btnPickFile')
  var qrFileInput=document.getElementById('qrFileInput')
  if(btnPickFile&&qrFileInput){
    btnPickFile.addEventListener('click',function(){qrFileInput.click()})
    qrFileInput.addEventListener('change',function(){
      if(qrFileInput.files&&qrFileInput.files[0])uploadQrFile(qrFileInput.files[0])
      qrFileInput.value=''
    })
  }
  poll()
  setInterval(function(){if(!document.hidden)poll()},5000)
  document.addEventListener('visibilitychange',function(){if(!document.hidden)poll()})
})();
</script>
<script${scriptNonce ? ` nonce="${scriptNonce}"` : ''}>
/* PWA：注册 Service Worker，让手机浏览器可「添加到主屏幕」并以独立 App 形态打开。
   注册失败静默忽略，不影响控制台任何功能。 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  });
}
</script>
<script nonce="${esc(scriptNonce)}">${VOYRA_UI_JS}</script>
</body>
</html>`
}
