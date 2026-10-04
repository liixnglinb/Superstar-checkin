/**
 * 控制台 UI（软件主界面）—— 重构版
 *
 * 设计气质：Grounded Quiet Utility（克制、静默的专业工具）。
 * 参考系：Apple macOS 系统设置（Ventura/Sonoma）+ CleanMyMac 状态监视器 + Home Assistant Dashboard。
 *
 * 三条重构原则：
 *   1. 状态透明，责任清楚 —— 引擎状态 / 网络与凭据健康 / 课表时段命中，分层级展现；
 *   2. 零依赖自绘 —— 严守 SSR 模板字符串架构，图表与进度环一律轻量内联 SVG 计算；
 *   3. 无缝无障碍与动效克制 —— 过渡收敛在 120~240ms，优先 transform/opacity，完整支持 reduced-motion。
 *
 * 结构（模块 1-14）：
 *   · 布局框架：无边框自绘标题栏 + 左侧导航 + 侧栏「引擎心脏监视器」
 *   · 总览：统计方块 + 内联 SVG 趋势图 + 账号/最近活动双栏
 *   · 课程：状态 Pill 语义闭环 + 乐观开关
 *   · 课表：5×8 网格 + 完整度进度
 *   · 历史：类型/结果筛选 + 紧凑流水
 *   · 日志：级别过滤 + 自动滚屏锁
 *   · 设置：分组卡片 + 危险区隔离
 *   · 二维码签到弹窗 / 手机上传页（dingtalk-server）
 *
 * Design Tokens 全部来自 voyra-ui.ts（本软件唯一 UI 数值来源）。
 */

import { VOYRA_UI_CSS, VOYRA_UI_JS } from './voyra-ui'
import {
  ICONS,
  esc,
  modeText,
  renderStatCard,
  renderTrendSvg,
  renderRecentRows,
  renderCourseRow,
  renderAccountRow,
} from './components'

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
  /** 多账号独立统计（服务端计算） */
  accountStats?: Array<{ username: string; name?: string; success: number; fail: number; lastTime: number }>
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
  const version = status.version || '—'

  /**
   * 手机端访问地址：直接给出带 token 的完整 URL（页面本身已在 token 保护下，不存在额外泄露面），
   * 用户扫码/输入即可在手机上传签到码，不必手拼 token。
   */
  const webPort = status.port || 3456
  const lanHost = status.lanIp || '电脑IP'
  const mobileUploadUrl = `http://${lanHost}:${webPort}/upload${token ? '?token=' + encodeURIComponent(token) : ''}`
  /** 仅监听本机时手机连不上（最常见的新手问题），界面直接提示改法 */
  const loopbackOnly = !status.webHost || /^(127\.0\.0\.1|localhost|::1)$/.test(status.webHost)

  // ---------- 派生状态 ----------
  const total = (status.successCount || 0) + (status.failCount || 0)
  const successRate = total > 0 ? ((status.successCount || 0) / total * 100).toFixed(1) + '%' : '—'
  const todayStats = status.todayStats || { total: 0, success: 0, fail: 0 }
  const quiet = status.quiet || { enabled: false, start: '23:00', end: '07:00' }
  const listeningOn = status.listening !== false
  const accountsEmpty = accounts.length === 0
  const cookieOk = status.cookieValid === true
  const runtimeReady = !accountsEmpty && status.cookieValid !== false && listeningOn

  // 引擎心跳文案
  const engineState = accountsEmpty ? '未配置账号' : status.cookieValid === false ? '登录异常' : !listeningOn ? '已暂停监听' : '后台监听运转中'
  const engineTone = accountsEmpty || status.cookieValid === false ? 'is-warn' : !listeningOn ? 'is-idle' : 'is-running'

  // ---------- 总览：统计方块 ----------
  const statCards = [
    renderStatCard({ label: '监控课程', value: courses.length, sub: `当前监听 ${status.listeningCount ?? courses.length} 门`, icon: ICONS.courses, tone: 'brand' }),
    renderStatCard({ label: '累计记录', value: status.recordCount ?? 0, sub: `今日 ${todayStats.total} 条`, icon: ICONS.history, tone: 'neutral' }),
    renderStatCard({ label: '签到成功', value: status.successCount ?? 0, sub: `成功率 ${successRate}`, icon: ICONS.check, tone: 'ok' }),
    renderStatCard({ label: '签到失败', value: status.failCount ?? 0, sub: todayStats.fail > 0 ? `今日失败 ${todayStats.fail}` : '暂无失败', icon: ICONS.x, tone: 'err' }),
  ].join('')

  // ---------- 总览：账号运行卡片 ----------
  const accountCards = accounts.length
    ? accounts.map((a, i) => renderAccountRow(a, { primary: i === 0 })).join('')
    : `<div class="empty"><p>未配置账号</p><p class="empty-sub">首次使用请在"设置"页填写你的学习通账号（支持多用户各自登录）</p><a class="btn btn-secondary" href="#settings">去配置账号</a></div>`

  // ---------- 课程行 ----------
  const courseRows = courses.length
    ? courses.map(c => {
        const watching = !disabledSet.has(String(c.courseId)) && (watchSet.size === 0 || watchSet.has(String(c.courseId)))
        const fails = (status.courseHealth || {})[String(c.courseId)] || 0
        return renderCourseRow(c, {
          watching,
          fails,
          runtimeReady,
          accountsEmpty,
          cookieValid: status.cookieValid,
          listening: listeningOn,
          window: (status.signinWindows || {})[String(c.courseId)],
        })
      }).join('')
    : `<tr><td colspan="4" class="cell-empty">暂无课程数据</td></tr>`

  // ---------- 账号管理（设置页） ----------
  const accountManageRows = accounts.length
    ? accounts.map((a, i) => `
      <div class="acct-row">
        <span class="acct-avatar">${esc((a.name || a.username || '?').slice(0, 1))}</span>
        <div class="acct-info">
          <div class="acct-name">${esc(a.name || a.username)}${i === 0 ? ' <span class="status-pill is-ok"><span class="pill-dot"></span><span class="pill-text">主账号</span></span>' : ''}</div>
          <div class="acct-sub">${esc(a.schoolname || '')} · ${esc(a.username)}</div>
        </div>
        ${i === 0 ? '' : `<button type="button" class="btn btn-secondary btn-sm" data-primary="${esc(a.username)}">设为主账号</button>`}
        <button type="button" class="btn btn-secondary btn-sm btn-danger-hover" data-remove="${esc(a.username)}">${ICONS.trash}<span>删除</span></button>
      </div>`).join('')
    : `<div class="empty"><p>未配置账号</p><p class="empty-sub">添加学习通账号后，软件会用它自动签到（支持多账号，全部账号都会签到）</p></div>`

  // ---------- 时间字段（滚轮选择器） ----------
  const tpField = (id: string, mode: 'hm' | 'h', value: string, extra = '') =>
    `<input class="field-input tp-field" id="${id}" type="text" readonly data-tp="${mode}" inputmode="none" aria-haspopup="dialog" value="${esc(value)}" ${extra}>`

  // ---------- 开关 ----------
  const sw = (id: string, on: boolean, label: string) =>
    `<button class="switch ${on ? 'on' : ''}" id="${id}" type="button" role="switch" aria-checked="${on}" aria-label="${esc(label)}"><span class="knob"></span></button>`

  const s = status
  const settingsCards = `
    <!-- 区域 1：监听与防风控 -->
    <div class="card settings-card">
      <div class="card-head">
        <div><h3 class="card-title">扫描机制与防风控</h3><p class="card-desc">配置轮询心跳与行为仿真，降低被平台识别为自动脚本的概率</p></div>
      </div>
      <div class="card-body form-grid">
        <div class="form-item">
          <label class="form-label" for="setPoll">基础轮询间隔（秒）</label>
          <input class="field-input" id="setPoll" type="number" min="10" max="600" value="${Math.round((s.pollInterval || 30000) / 1000)}">
          <span class="form-help">单门课程轮询活动的时间周期；越小发现越快，越频繁越可能被风控（默认 30）</span>
        </div>
        <div class="form-item">
          <label class="form-label" for="setJitter">随机抖动范围（秒）</label>
          <input class="field-input" id="setJitter" type="number" min="0" max="120" value="${Math.round(s.pollJitter || 15)}">
          <span class="form-help">每轮轮询在此范围内随机加减延迟，消除机械规律（0 = 关闭）</span>
        </div>
        <div class="form-item">
          <label class="form-label" for="setHumanDelayMin">人工仿真延迟区间（秒）</label>
          <div class="input-range-group">
            ${sw('setHumanDelay', !!s.humanDelay?.enabled, '模拟人类延迟')}
            <input class="field-input" id="setHumanDelayMin" type="number" min="5" max="600" value="${s.humanDelay?.minSeconds ?? 30}">
            <span class="range-sep">至</span>
            <input class="field-input" id="setHumanDelayMax" type="number" min="10" max="900" value="${s.humanDelay?.maxSeconds ?? 300}">
          </div>
          <span class="form-help">发现签到后等待此时间再提交，避免发布瞬间「秒签」被怀疑</span>
        </div>
        <div class="form-item">
          <label class="form-label" for="setConfirmWait">签到前确认（秒）</label>
          <div class="input-range-group">
            ${sw('setConfirmBefore', !!s.confirmBefore?.enabled, '签到前确认')}
            <input class="field-input" id="setConfirmWait" type="number" min="3" max="120" value="${s.confirmBefore?.waitSeconds ?? 10}">
          </div>
          <span class="form-help">检测到签到后先弹通知倒计时，可点击取消，超时自动签</span>
        </div>
        <div class="form-item">
          <label class="form-label" for="setRetry">失败重试</label>
          <div class="input-range-group">
            <input class="field-input" id="setRetry" type="number" min="1" max="10" value="${s.retryMaxAttempts || 3}">
            <span class="range-sep">次 ·</span>
            <input class="field-input" id="setRetryDelay" type="number" min="1" max="120" value="${Math.round((s.retryDelayMs || 5000) / 1000)}">
            <span class="range-sep">秒间隔</span>
          </div>
          <span class="form-help">签到失败后自动重试的次数与间隔</span>
        </div>
        <div class="form-item">
          <label class="form-label" for="setVerify">签到后二次核对</label>
          <div class="input-range-group">${sw('setVerify', s.verifyEnabled !== false, '签到后二次核对')}<span class="form-help" style="margin:0">提交成功后再次查询平台确认已签到，避免「显示成功实际没签上」</span></div>
        </div>
        <div class="form-item">
          <label class="form-label" for="setSmartPoll">智能轮询</label>
          <div class="input-range-group">${sw('setSmartPoll', s.smartPoll?.enabled !== false, '智能轮询')}<span class="form-help" style="margin:0">白天短间隔轮询，夜间 3 倍长间隔，减少无效请求</span></div>
        </div>
      </div>
    </div>

    <!-- 区域 2：钉钉群图通道 -->
    <div class="card settings-card">
      <div class="card-head">
        <div><h3 class="card-title">钉钉群图通道（Stream 模式）</h3><p class="card-desc">群里发二维码图片即自动签到，走长连接，无需公网地址与端口映射</p></div>
        <span class="status-chip ${s.dingtalkStreamConnected ? 'ok' : s.dingtalkStreamEnabled ? 'warn' : ''}" id="dingChip">${s.dingtalkStreamConnected ? '已连接' : s.dingtalkStreamEnabled ? '连接中' : '未启用'}</span>
      </div>
      <div class="card-body form-grid">
        <div class="form-item">
          <label class="form-label" for="dingKeyInput">AppKey</label>
          <input class="field-input" id="dingKeyInput" type="text" placeholder="钉钉企业内部应用的 ClientID(AppKey)" spellcheck="false">
          <span class="form-help">在钉钉开放平台创建企业内部应用 → 应用能力里添加机器人（接收模式选 Stream）→ 发布并拉进群</span>
        </div>
        <div class="form-item">
          <label class="form-label" for="dingSecretInput">AppSecret</label>
          <input class="field-input" id="dingSecretInput" type="password" placeholder="钉钉企业内部应用的 ClientSecret(AppSecret)" spellcheck="false">
          <span class="form-help" id="dingStateHint"></span>
        </div>
        <div class="form-item">
          <label class="form-label">启用状态</label>
          <div class="input-range-group">
            <label class="check-line"><input type="checkbox" id="dingEnabledInput"> 启用钉钉图片通道</label>
            <button class="btn btn-primary" id="dingSaveBtn">保存钉钉设置</button>
            <span class="cfg-msg" id="dingMsg"></span>
          </div>
          <span class="form-help">保存后需重启软件建立连接</span>
        </div>
      </div>
    </div>

    <!-- 区域 3：地理位置与网络 -->
    <div class="card settings-card">
      <div class="card-head">
        <div><h3 class="card-title">地理位置与网络</h3><p class="card-desc">位置签到坐标生成半径与出网代理；代理保存后立即生效，无需重启</p></div>
      </div>
      <div class="card-body form-grid">
        <div class="form-item">
          <label class="form-label" for="setRadius">位置半径（米）</label>
          <input class="field-input" id="setRadius" type="number" min="1" max="500" value="${Math.round(s.locationRadius || 10)}">
          <span class="form-help">以老师发布坐标为中心生成签到点（默认 10）</span>
        </div>
        <div class="form-item">
          <label class="form-label" for="proxyInput">HTTP 代理</label>
          <div class="input-range-group">
            <input class="field-input" id="proxyInput" type="text" placeholder="http://127.0.0.1:7890（留空 = 直连）" spellcheck="false" style="flex:1;min-width:180px">
            <button class="btn btn-secondary" id="proxyTestBtn">测试连接</button>
            <button class="btn btn-primary" id="proxySaveBtn">保存</button>
            <span class="cfg-msg" id="proxyMsg"></span>
          </div>
        </div>
        <div class="form-item">
          <label class="form-label">网络诊断</label>
          <div class="input-range-group">
            <button class="btn btn-secondary" id="diagBtn">${ICONS.refresh}<span>一键网络诊断</span></button>
            <span class="form-help" style="margin:0">依次检测公网 / 登录 / 课程 / 签到 / IM 通道，失败会给出原因与建议</span>
          </div>
          <div id="diagResult" class="diag-result" hidden></div>
        </div>
      </div>
    </div>

    <!-- 区域 4：推送通知与免打扰 -->
    <div class="card settings-card">
      <div class="card-head">
        <div><h3 class="card-title">推送通知与免打扰</h3><p class="card-desc">签到结果通知渠道与静默时段；免打扰期间不弹通知，签到照常进行</p></div>
      </div>
      <div class="card-body form-grid">
        <div class="form-item">
          <label class="form-label" for="setDesktop">桌面通知</label>
          <div class="input-range-group">${sw('setDesktop', s.notifyDesktop !== false, '桌面通知')}<span class="form-help" style="margin:0">签到成功 / 失败 / 二维码待签时弹出系统通知</span></div>
        </div>
        <div class="form-item">
          <label class="form-label" for="setQuietStart">免打扰时段</label>
          <div class="input-range-group">
            ${sw('setQuiet', !!quiet.enabled, '免打扰时段')}
            ${tpField('setQuietStart', 'hm', quiet.start, 'style="width:96px"')}
            <span class="range-sep">至</span>
            ${tpField('setQuietEnd', 'hm', quiet.end, 'style="width:96px"')}
          </div>
          <span class="form-help">期间不弹桌面通知，签到照常进行</span>
        </div>
        <div class="form-item">
          <label class="form-label" for="setReportHour">每日签到日报</label>
          <div class="input-range-group">
            ${sw('setReport', s.report?.enabled !== false, '每日签到日报')}
            ${tpField('setReportHour', 'h', String(s.report?.hour ?? 22), 'style="width:72px"')}
            <span class="range-sep">时推送当天签到总结</span>
          </div>
          <span class="form-help">点推送当天签到总结（成功 / 失败 / 未成功课程）</span>
        </div>
        <div class="form-item">
          <label class="form-label" for="setWeeklyReport">每周签到周报</label>
          <div class="input-range-group">${sw('setWeeklyReport', s.report?.weekly !== false, '每周签到周报')}<span class="form-help" style="margin:0">每周日推送本周签到统计与漏签课程名单</span></div>
        </div>
        <div class="form-item">
          <label class="form-label" for="setPreCheckHour">课前预检查</label>
          <div class="input-range-group">
            ${sw('setPreCheck', s.preCheck?.enabled !== false, '课前预检查')}
            ${tpField('setPreCheckHour', 'h', String(s.preCheck?.hour ?? 7), 'style="width:72px"')}
            <span class="range-sep">时</span>
          </div>
          <span class="form-help">每天指定时间检查账号登录和网络，有问题提前推送</span>
        </div>
        <div class="form-item">
          <label class="form-label" for="setAutoLaunch">开机自启</label>
          <div class="input-range-group">${sw('setAutoLaunch', false, '开机自启')}<span class="form-help" style="margin:0">开机后自动在后台运行，保证签到不中断</span></div>
        </div>
      </div>
      <div class="card-foot">
        <button class="btn btn-primary" id="settingsSaveBtn">保存设置</button>
        <button class="btn btn-secondary" id="notifyTestBtn">${ICONS.bell}<span>发送测试通知</span></button>
        <span class="cfg-msg" id="settingsMsg"></span>
      </div>
    </div>

    <!-- 区域 5：账号管理 -->
    <div class="card settings-card">
      <div class="card-head">
        <div><h3 class="card-title">账号管理</h3><p class="card-desc">支持多账号，全部账号都会自动签到；第一个账号（主账号）负责课程轮询监听</p></div>
      </div>
      <div id="accountList">${accountManageRows}</div>
      <div class="card-body" style="border-top:1px solid var(--line-dim)">
        <div class="form-grid">
          <div class="form-item"><label class="form-label" for="cfgUsername">学习通账号（手机号）</label><input class="field-input" id="cfgUsername" type="text" placeholder="学习通账号（手机号）" autocomplete="off"></div>
          <div class="form-item"><label class="form-label" for="cfgPassword">密码</label><input class="field-input" id="cfgPassword" type="password" placeholder="密码"></div>
        </div>
        <div class="input-range-group" style="margin-top:var(--sp-3)">
          <button class="btn btn-primary" id="cfgSaveBtn">添加账号</button>
          <span class="cfg-msg" id="accountMsg"></span>
        </div>
        <p class="form-help" style="margin-top:var(--sp-2)">添加 / 删除 / 切换主账号后需重启软件生效。账号保存在 config.yaml，密码使用 Windows DPAPI 加密，请妥善保管。</p>
      </div>
    </div>

    <!-- 区域 6：数据与维护（危险区） -->
    <div class="card settings-card is-danger-zone">
      <div class="card-head">
        <div><h3 class="card-title">数据与维护</h3><p class="card-desc">导出的配置文件已对密码使用 Windows DPAPI 脱敏保护；危险操作请谨慎执行</p></div>
      </div>
      <div class="card-body action-row">
        <button class="btn btn-secondary" id="cfgExportBtn">${ICONS.download}<span>导出当前配置</span></button>
        <button class="btn btn-secondary" id="cfgImportBtn">${ICONS.upload}<span>从文件恢复配置</span></button>
        <input type="file" id="cfgFileInput" accept=".json,.yaml,.yml" style="display:none">
        <button class="btn btn-danger" id="dangerResetCoursesBtn">重置所有课程为默认监听</button>
        <button class="btn btn-danger" id="dangerClearHistoryBtn">${ICONS.trash}<span>清空全部签到记录</span></button>
        <span class="cfg-msg" id="cfgMsg"></span>
      </div>
    </div>`

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>学习通自动签到</title>
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#EF7429">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="学习通签到">
<link rel="apple-touch-icon" href="/assets/app-icon-192.png">
<style>
/* ============================================================
   Design Tokens 见 voyra-ui.ts（本文件只写组件样式，不再定义第二份数值）
   ============================================================ */
*,*::before,*::after{box-sizing:border-box}
html,body{height:100%}
body{margin:0;font-family:var(--font-sans);background:var(--bg-canvas);color:var(--ink-primary);font-size:var(--text-base);line-height:1.55;overflow:hidden;-webkit-font-smoothing:antialiased}
[hidden]{display:none!important}
button{font-family:inherit}

/* ===== 布局框架（模块 1） ===== */
.app-shell{display:flex;flex-direction:column;width:100vw;height:100vh;background:var(--bg-canvas);color:var(--ink-primary);overflow:hidden}
.app-titlebar{display:flex;align-items:center;height:38px;flex-shrink:0;background:var(--bg-surface);border-bottom:1px solid var(--line-dim);padding:0 var(--sp-2) 0 var(--sp-3);z-index:100}
.titlebar-drag{flex:1;display:flex;align-items:center;-webkit-app-region:drag;height:100%;min-width:0}
.app-branding{display:inline-flex;align-items:center;gap:var(--sp-2)}
.app-mark{width:16px;height:16px;flex-shrink:0;display:block}
.app-title{font-size:var(--text-xs);font-weight:600;color:var(--ink-primary);letter-spacing:-.01em;white-space:nowrap}
.app-ver{font-size:var(--text-2xs);color:var(--ink-tertiary);font-family:var(--font-mono);background:var(--bg-surface-sub);padding:1px 5px;border-radius:var(--r-xs)}
.titlebar-status-strip{display:flex;align-items:center;gap:6px;flex:0 1 auto;min-width:0;overflow:hidden;margin-right:var(--sp-2);-webkit-app-region:no-drag}
.titlebar-controls{display:flex;align-items:center;gap:2px;-webkit-app-region:no-drag}
.win-btn{width:30px;height:24px;display:inline-flex;align-items:center;justify-content:center;background:transparent;border:none;border-radius:var(--r-xs);color:var(--ink-secondary);cursor:pointer;transition:background var(--dur-fast) var(--ease-out),color var(--dur-fast) var(--ease-out)}
.win-btn:hover{background:var(--bg-surface-sub);color:var(--ink-primary)}
.win-btn.win-close:hover{background:var(--status-err-dot);color:#FFF}

/* ===== 状态芯片（模块 10） ===== */
.status-chip{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 9px;border-radius:var(--r-full);font-size:var(--text-2xs);font-weight:600;white-space:nowrap;color:var(--status-idle-ink);background:var(--status-idle-bg);border:1px solid var(--status-idle-line);flex-shrink:0}
.chip-dot{width:6px;height:6px;border-radius:50%;background:var(--status-idle-dot);flex-shrink:0}
.status-chip.ok{background:var(--status-ok-bg);border-color:var(--status-ok-line);color:var(--status-ok-ink)}
.status-chip.ok .chip-dot{background:var(--status-ok-dot)}
.status-chip.warn{background:var(--status-warn-bg);border-color:var(--status-warn-line);color:var(--status-warn-ink)}
.status-chip.warn .chip-dot{background:var(--status-warn-dot)}
.status-chip.err{background:var(--status-err-bg);border-color:var(--status-err-line);color:var(--status-err-ink)}
.status-chip.err .chip-dot{background:var(--status-err-dot)}
.status-chip.subtle{color:var(--ink-tertiary)}
.status-chip.pulse-orange{background:var(--brand-100);border-color:var(--brand-500);color:var(--brand-700);cursor:pointer}
.status-chip.pulse-orange .chip-dot{background:var(--brand-600);animation:pulseDot 1.6s var(--ease-out) infinite}
.status-chip.chip-update{background:var(--brand-100);border-color:var(--brand-500);color:var(--brand-700);cursor:pointer}
.status-chip.chip-update:hover{background:var(--brand-50)}
@keyframes pulseDot{0%,100%{transform:scale(.85);opacity:.7}50%{transform:scale(1.25);opacity:1}}

/* ===== 侧栏（模块 1） ===== */
.app-body{display:flex;flex:1;overflow:hidden;min-height:0}
.app-sidebar{width:200px;flex-shrink:0;background:var(--bg-surface);border-right:1px solid var(--line-dim);display:flex;flex-direction:column;justify-content:space-between;padding:var(--sp-3) var(--sp-2)}
.nav-group{display:flex;flex-direction:column;gap:3px}
.nav-item{display:flex;align-items:center;gap:var(--sp-3);height:36px;padding:0 var(--sp-3);border-radius:var(--r-md);border:1px solid transparent;background:transparent;color:var(--ink-secondary);font-size:var(--text-sm);font-weight:500;cursor:pointer;transition:background var(--dur-fast) var(--ease-out),color var(--dur-fast) var(--ease-out),border-color var(--dur-fast) var(--ease-out);text-align:left;width:100%}
.nav-item:hover{background:var(--bg-surface-sub);color:var(--ink-primary)}
.nav-item.active{background:var(--bg-canvas);border-color:var(--line-strong);color:var(--brand-600);font-weight:600}
.nav-icon{width:16px;height:16px;flex-shrink:0}
.nav-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* 引擎心脏监视器 */
.sidebar-heartbeat{background:var(--bg-surface-sub);border:1px solid var(--line-dim);border-radius:var(--r-md);padding:var(--sp-3)}
.hb-status-row{display:flex;align-items:center;gap:var(--sp-2);margin-bottom:var(--sp-2)}
.hb-indicator{width:7px;height:7px;border-radius:50%;background:var(--status-idle-dot);flex-shrink:0}
.hb-indicator.is-running{background:var(--status-ok-dot);box-shadow:0 0 0 2px var(--status-ok-line);animation:hbPulse 2.4s var(--ease-out) infinite}
.hb-indicator.is-warn{background:var(--status-warn-dot);box-shadow:0 0 0 2px var(--status-warn-line)}
.hb-indicator.is-idle{background:var(--status-idle-dot)}
@keyframes hbPulse{0%,100%{box-shadow:0 0 0 2px var(--status-ok-line)}50%{box-shadow:0 0 0 4px var(--status-ok-line)}}
.hb-state-text{font-size:var(--text-xs);font-weight:600;color:var(--ink-primary)}
.hb-meta-row{display:flex;flex-wrap:wrap;justify-content:space-between;gap:2px 8px;font-size:var(--text-2xs);color:var(--ink-tertiary);font-family:var(--font-mono)}
.hb-meta-item{display:inline-flex;align-items:center;gap:3px}
.hb-meta-item svg{width:12px;height:12px}

/* ===== 主区 ===== */
.app-main{flex:1;overflow-y:auto;overflow-x:hidden;padding:var(--sp-5) var(--sp-6);position:relative;min-width:0}
.page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:var(--sp-4);margin-bottom:var(--sp-5)}
.page-title{font-size:var(--text-xl);font-weight:700;letter-spacing:-.02em;line-height:1.2}
.page-sub{font-size:var(--text-sm);color:var(--ink-tertiary);margin-top:2px}
.top-actions{display:flex;gap:var(--sp-2);flex-shrink:0}
.view{display:none}
.view.active{display:block;animation:fadeIn var(--dur-base) var(--ease-out)}
@keyframes fadeIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}

/* ===== 服务通告（模块 10） ===== */
.service-notice{display:flex;align-items:center;gap:var(--sp-4);padding:var(--sp-4) var(--sp-5);margin-bottom:var(--sp-5);border:1px solid var(--status-warn-line);border-radius:var(--r-lg);background:var(--status-warn-bg);box-shadow:var(--shadow-sm)}
.service-notice[hidden]{display:none}
.service-notice>div{flex:1;min-width:0}
.service-notice strong{font-size:var(--text-base);color:var(--ink-primary)}
.service-notice p{margin:5px 0 0;font-size:var(--text-sm);line-height:1.7;color:var(--ink-secondary);overflow-wrap:anywhere}
.service-notice[data-kind=offline]{border-color:var(--status-err-line);background:var(--status-err-bg)}
.service-notice :is(button,a){flex-shrink:0}

/* ===== 按钮 ===== */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:36px;padding:0 var(--sp-4);border-radius:var(--r-sm);border:1px solid transparent;font-size:var(--text-sm);font-weight:600;cursor:pointer;transition:transform var(--dur-fast) var(--ease-out),background var(--dur-fast) var(--ease-out),border-color var(--dur-fast) var(--ease-out),color var(--dur-fast) var(--ease-out),box-shadow var(--dur-fast) var(--ease-out);text-decoration:none;white-space:nowrap}
.btn svg{width:15px;height:15px;flex-shrink:0}
.btn:active{transform:scale(.97)}
.btn:disabled{opacity:.55;cursor:not-allowed;transform:none}
.btn-primary{background:var(--brand-600);color:var(--ink-inverse);box-shadow:var(--shadow-sm)}
.btn-primary:hover{background:var(--brand-500)}
.btn-primary:active{background:var(--brand-700)}
.btn-secondary{background:var(--bg-surface);color:var(--ink-secondary);border-color:var(--line-strong)}
.btn-secondary:hover{background:var(--bg-surface-sub);color:var(--ink-primary);border-color:var(--ink-tertiary)}
.btn-danger{background:var(--bg-surface);color:var(--status-err-ink);border-color:var(--status-err-line)}
.btn-danger:hover{background:var(--status-err-bg);border-color:var(--status-err-dot)}
.btn-danger-hover:hover{background:var(--status-err-bg);color:var(--status-err-ink);border-color:var(--status-err-line)}
.btn-sm{height:30px;padding:0 var(--sp-3);font-size:var(--text-xs);border-radius:var(--r-xs)}
.btn-ghost{background:transparent;color:var(--ink-secondary);border-color:transparent}
.btn-ghost:hover{background:var(--bg-surface-sub);color:var(--ink-primary)}
.btn-subtle-icon{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;border-radius:var(--r-sm);color:var(--ink-tertiary);cursor:pointer;transition:background var(--dur-fast),color var(--dur-fast)}
.btn-subtle-icon:hover{background:var(--bg-surface-sub);color:var(--ink-primary)}
.btn-subtle-icon svg{width:15px;height:15px}

/* ===== 表单 ===== */
.field-input{height:36px;padding:0 var(--sp-3);border:1px solid var(--line-strong);border-radius:var(--r-sm);font-size:var(--text-sm);font-family:inherit;color:var(--ink-primary);background:var(--bg-surface);outline:none;transition:border-color var(--dur-fast) var(--ease-out),box-shadow var(--dur-fast) var(--ease-out);min-width:0}
.field-input:focus{border-color:var(--brand-500);box-shadow:0 0 0 3px rgba(247,138,70,.18)}
.field-input::placeholder{color:var(--ink-tertiary)}
.form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:var(--sp-4) var(--sp-5)}
.form-item{display:flex;flex-direction:column;gap:6px;min-width:0}
.form-label{font-size:var(--text-xs);font-weight:600;color:var(--ink-secondary)}
.form-help{font-size:var(--text-xs);color:var(--ink-tertiary);line-height:1.6;margin:0}
.input-range-group{display:flex;align-items:center;gap:var(--sp-2);flex-wrap:wrap}
.range-sep{font-size:var(--text-xs);color:var(--ink-tertiary);white-space:nowrap}
.check-line{display:inline-flex;align-items:center;gap:6px;font-size:var(--text-sm);color:var(--ink-secondary)}

/* ===== 开关 ===== */
.switch{width:40px;height:22px;border-radius:var(--r-full);border:1px solid var(--line-strong);background:var(--bg-surface-sub);position:relative;cursor:pointer;transition:background var(--dur-fast) var(--ease-out),border-color var(--dur-fast) var(--ease-out);flex-shrink:0;padding:0}
.switch .knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#FFF;box-shadow:0 1px 3px rgba(0,0,0,.22);transition:left var(--dur-fast) var(--ease-spring)}
.switch.on{background:var(--brand-600);border-color:var(--brand-600)}
.switch.on .knob{left:20px}
/* 课程行开关（原生 checkbox + 轨道） */
.switch-control{position:relative;display:inline-block;width:36px;height:20px;flex-shrink:0}
.switch-control input{opacity:0;width:0;height:0;position:absolute}
.switch-track{position:absolute;inset:0;cursor:pointer;background-color:var(--line-strong);transition:background-color var(--dur-fast) var(--ease-out);border-radius:var(--r-full)}
.switch-track::before{position:absolute;content:"";height:16px;width:16px;left:2px;bottom:2px;background-color:#FFF;transition:transform var(--dur-fast) var(--ease-spring);border-radius:var(--r-full);box-shadow:0 1px 2px rgba(0,0,0,.2)}
.switch-control input:checked + .switch-track{background-color:var(--brand-600)}
.switch-control input:checked + .switch-track::before{transform:translateX(16px)}
.switch-control input:focus-visible + .switch-track{outline:2px solid var(--brand-500);outline-offset:2px}

/* ===== 卡片 / 面板 ===== */
.card{background:var(--bg-surface);border:1px solid var(--line-dim);border-radius:var(--r-lg);box-shadow:var(--shadow-sm);margin-bottom:var(--sp-5);overflow:hidden}
.card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--sp-3);padding:var(--sp-4) var(--sp-5);border-bottom:1px solid var(--line-dim)}
.card-title{font-size:var(--text-md);font-weight:600;margin:0}
.card-desc{font-size:var(--text-xs);color:var(--ink-secondary);margin:3px 0 0}
.card-body{padding:var(--sp-4) var(--sp-5)}
.card-foot{display:flex;align-items:center;gap:var(--sp-3);flex-wrap:wrap;padding:var(--sp-3) var(--sp-5);border-top:1px solid var(--line-dim)}
.action-row{display:flex;align-items:center;gap:var(--sp-3);flex-wrap:wrap}
.is-danger-zone{border-color:var(--status-err-line)}
.is-danger-zone .card-title{color:var(--status-err-ink)}

/* ===== 统计方块（模块 2） ===== */
.stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:var(--sp-4);margin-bottom:var(--sp-5)}
.stat-box{background:var(--bg-surface);border:1px solid var(--line-dim);border-radius:var(--r-lg);padding:var(--sp-4);box-shadow:var(--shadow-sm);transition:transform var(--dur-base) var(--ease-out),box-shadow var(--dur-base) var(--ease-out),border-color var(--dur-base) var(--ease-out)}
.stat-box:hover{transform:translateY(-2px);box-shadow:var(--shadow-md);border-color:var(--line-strong)}
.stat-box-label{display:flex;justify-content:space-between;align-items:center;gap:var(--sp-2);font-size:var(--text-xs);color:var(--ink-secondary);font-weight:500}
.stat-box-ico{width:26px;height:26px;border-radius:var(--r-sm);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
.stat-box-ico svg{width:14px;height:14px}
.stat-box-val{font-size:var(--text-2xl);font-weight:700;font-family:var(--font-mono);font-variant-numeric:tabular-nums;color:var(--ink-primary);margin-top:var(--sp-2);line-height:1}
.stat-box-sub{font-size:var(--text-xs);color:var(--ink-tertiary);margin-top:6px}

/* ===== 趋势图（模块 2） ===== */
.trend-card{background:var(--bg-surface);border:1px solid var(--line-dim);border-radius:var(--r-lg);padding:var(--sp-5);box-shadow:var(--shadow-sm);margin-bottom:var(--sp-5)}
.trend-header{display:flex;justify-content:space-between;align-items:flex-start;gap:var(--sp-3);margin-bottom:var(--sp-3)}
.trend-title{font-size:var(--text-base);font-weight:600;margin:0}
.trend-sub{font-size:var(--text-xs);color:var(--ink-secondary);margin:2px 0 0}
.trend-legend{font-size:var(--text-xs);color:var(--ink-secondary);display:flex;align-items:center;gap:var(--sp-3);flex-shrink:0}
.trend-legend span{display:inline-flex;align-items:center;gap:5px}
.legend-dot{width:8px;height:8px;border-radius:2px;display:inline-block}
.legend-dot.ok{background:var(--status-ok-dot)}
.legend-dot.err{background:var(--status-err-dot)}
.svg-container{overflow:hidden}
.trend-svg{width:100%;height:auto;display:block;overflow:visible}

/* ===== 总览下半区（模块 2） ===== */
.overview-lower-grid{display:grid;grid-template-columns:340px 1fr;gap:var(--sp-5);align-items:start}
@media (max-width:1120px){.overview-lower-grid{grid-template-columns:1fr}}

/* ===== 账号行 ===== */
.acct-row{display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-3) var(--sp-5);border-bottom:1px solid var(--line-dim)}
.acct-row:last-child{border-bottom:none}
.acct-avatar{width:34px;height:34px;border-radius:var(--r-sm);background:var(--brand-100);color:var(--brand-700);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:var(--text-md);flex-shrink:0}
.acct-info{flex:1;min-width:0}
.acct-name{font-weight:600;font-size:var(--text-sm);display:flex;align-items:center;gap:6px}
.acct-sub{font-size:var(--text-xs);color:var(--ink-secondary);margin-top:1px}
.acct-stat-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:var(--sp-3);padding:0 var(--sp-5) var(--sp-4)}
.acct-stat-card{background:var(--bg-surface-sub);border:1px solid var(--line-dim);border-radius:var(--r-md);padding:var(--sp-3)}
.acct-stat-name{font-size:var(--text-sm);font-weight:600;margin-bottom:4px}
.acct-stat-meta{font-size:var(--text-2xs);color:var(--ink-tertiary);margin-bottom:6px}
.acct-stat-nums{display:flex;gap:var(--sp-3);font-size:var(--text-xs);flex-wrap:wrap}

/* ===== 表格 ===== */
.data-table{width:100%;border-collapse:collapse;font-size:var(--text-sm)}
.data-table th{text-align:left;padding:10px var(--sp-5);font-size:var(--text-xs);font-weight:600;color:var(--ink-secondary);border-bottom:1px solid var(--line-dim);background:var(--bg-surface-sub);letter-spacing:.02em;white-space:nowrap}
.data-table td{padding:11px var(--sp-5);border-bottom:1px solid var(--line-dim);vertical-align:middle}
.data-table tr:last-child td{border-bottom:none}
.data-table tbody tr:hover td{background:var(--bg-surface-sub)}
.cell-main{font-weight:500}
.cell-sub{color:var(--ink-secondary)}
.cell-mono{font-family:var(--font-mono);font-size:var(--text-xs);color:var(--ink-secondary);font-variant-numeric:tabular-nums}
.cell-empty{text-align:center;color:var(--ink-tertiary);padding:32px 0}

/* ===== 状态胶囊 ===== */
.status-pill{display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border-radius:var(--r-full);font-size:var(--text-xs);font-weight:500;line-height:1;border:1px solid transparent;white-space:nowrap}
.pill-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.status-pill.is-ok{background:var(--status-ok-bg);color:var(--status-ok-ink);border-color:var(--status-ok-line)}
.status-pill.is-ok .pill-dot{background:var(--status-ok-dot)}
.status-pill.is-warn{background:var(--status-warn-bg);color:var(--status-warn-ink);border-color:var(--status-warn-line)}
.status-pill.is-warn .pill-dot{background:var(--status-warn-dot)}
.status-pill.is-err{background:var(--status-err-bg);color:var(--status-err-ink);border-color:var(--status-err-line)}
.status-pill.is-err .pill-dot{background:var(--status-err-dot)}
.status-pill.is-idle{background:var(--status-idle-bg);color:var(--status-idle-ink);border-color:var(--status-idle-line)}
.status-pill.is-idle .pill-dot{background:var(--status-idle-dot)}

/* ===== 课程表（模块 3） ===== */
.watch-bar{display:flex;align-items:center;gap:var(--sp-3);flex-wrap:wrap;padding:var(--sp-3) var(--sp-5);font-size:var(--text-sm);color:var(--ink-secondary);border-bottom:1px solid var(--line-dim)}
.watch-bar:last-of-type{border-bottom:none}
.course-name-line{display:flex;align-items:center;gap:var(--sp-2);flex-wrap:wrap}
.course-title{font-weight:600;font-size:var(--text-base);color:var(--ink-primary)}
.course-sub-line{display:flex;gap:var(--sp-3);margin-top:3px;flex-wrap:wrap}
.mono-meta{border:none;background:transparent;padding:0;font-family:var(--font-mono);font-size:var(--text-2xs);color:var(--ink-tertiary);cursor:pointer;transition:color var(--dur-fast)}
.mono-meta:hover{color:var(--brand-600);text-decoration:underline}
.window-pill{display:inline-flex;align-items:center;gap:5px;font-size:var(--text-xs);color:var(--ink-secondary);background:var(--bg-surface-sub);border:1px solid var(--line-dim);border-radius:var(--r-full);padding:3px 9px;font-variant-numeric:tabular-nums}
.window-pill svg{width:12px;height:12px;flex-shrink:0}
.window-pill.is-soft{color:var(--ink-tertiary)}
.col-course-actions{display:flex;align-items:center;gap:var(--sp-2);justify-content:flex-end}

/* ===== 课表网格（模块 4） ===== */
.tt-toolbar{display:flex;align-items:center;justify-content:space-between;gap:var(--sp-3);flex-wrap:wrap;padding:var(--sp-4) var(--sp-5);border-bottom:1px solid var(--line-dim)}
.tt-status-info{display:flex;flex-direction:column;gap:6px;min-width:240px;flex:1}
.tt-badge{font-size:var(--text-xs);color:var(--ink-secondary);font-weight:500}
.tt-progress{height:6px;border-radius:var(--r-full);background:var(--bg-surface-sub);overflow:hidden;border:1px solid var(--line-dim)}
.tt-progress>i{display:block;height:100%;background:var(--brand-600);transition:width var(--dur-base) var(--ease-out)}
.tt-progress.is-warn>i{background:var(--status-warn-dot)}
.tt-progress.is-ok>i{background:var(--status-ok-dot)}
.tt-btn-group{display:flex;gap:var(--sp-2);flex-wrap:wrap}
.tt-wrap{overflow-x:auto;padding:var(--sp-3) var(--sp-5) var(--sp-4)}
.tt-table{border-collapse:separate;border-spacing:6px;width:100%;min-width:720px}
.tt-table th{font-size:var(--text-xs);color:var(--ink-tertiary);font-weight:600;padding:6px 4px;text-align:center;white-space:nowrap;background:transparent;border:none}
.tt-table th.tt-slot-col{text-align:left;min-width:132px}
.tt-table td{padding:0;border:none}
.tt-slot{font-size:var(--text-xs);color:var(--ink-secondary);white-space:nowrap;padding:6px 8px}
.tt-slot b{display:block;font-size:var(--text-sm);color:var(--ink-primary)}
.tt-slot span{color:var(--ink-tertiary);font-size:var(--text-2xs)}
.tt-half td{background:var(--bg-surface-sub);font-size:var(--text-2xs);color:var(--ink-tertiary);font-weight:600;text-align:center;padding:5px;border-radius:var(--r-xs)}
.tt-cell{width:100%;box-sizing:border-box;font-family:var(--font-sans);font-size:var(--text-xs);height:34px;padding:0 6px;border:1px solid var(--line-strong);border-radius:var(--r-sm);background:var(--bg-surface);color:var(--ink-primary);cursor:pointer;transition:border-color var(--dur-fast),background var(--dur-fast)}
.tt-cell:focus{outline:none;box-shadow:0 0 0 3px rgba(247,138,70,.18);border-color:var(--brand-500)}
.tt-cell.tt-filled{border-color:var(--brand-500);background:var(--brand-50);color:var(--ink-primary)}
.tt-cell.tt-empty{border-color:var(--status-err-line);background:var(--status-err-bg);color:var(--status-err-ink)}
.tt-cell.tt-suggested{border-color:var(--status-warn-dot);background:var(--status-warn-bg);box-shadow:0 0 0 2px var(--status-warn-line)}
.tt-warn{background:var(--status-err-bg);border:1px solid var(--status-err-line);color:var(--status-err-ink);border-radius:var(--r-md);padding:var(--sp-3) var(--sp-4);margin:var(--sp-3) var(--sp-5) 0;font-size:var(--text-sm);line-height:1.7}
.tt-warn b{display:block;margin-bottom:4px}
.tt-ok{background:var(--status-ok-bg);border:1px solid var(--status-ok-line);color:var(--status-ok-ink);border-radius:var(--r-md);padding:var(--sp-3) var(--sp-4);margin:var(--sp-3) var(--sp-5) 0;font-size:var(--text-sm)}
.tt-legend{display:flex;gap:var(--sp-4);flex-wrap:wrap;font-size:var(--text-xs);color:var(--ink-tertiary);padding:var(--sp-3) var(--sp-5) 0}
.tt-legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:5px;vertical-align:-1px;border:1px solid var(--line-dim)}

/* ===== 课表页统计卡 ===== */
.stat-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:var(--sp-3);padding:var(--sp-4) var(--sp-5)}
.stat-card{background:var(--bg-surface-sub);border-radius:var(--r-md);padding:var(--sp-3);text-align:center;border:1px solid var(--line-dim)}
.stat-num{font-size:var(--text-xl);font-weight:700;color:var(--brand-600);line-height:1.2;font-variant-numeric:tabular-nums}
.stat-label{font-size:var(--text-xs);color:var(--ink-tertiary);margin-top:4px}
.course-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:var(--sp-3);padding:var(--sp-4) var(--sp-5)}
.course-card{background:var(--bg-surface);border:1px solid var(--line-dim);border-radius:var(--r-md);padding:var(--sp-4);cursor:pointer;transition:border-color var(--dur-base),box-shadow var(--dur-base),transform var(--dur-base);position:relative;box-shadow:var(--shadow-sm)}
.course-card:hover{border-color:var(--brand-500);box-shadow:var(--shadow-md);transform:translateY(-2px)}
.course-card.watching{border-left:3px solid var(--brand-600)}
.course-card.retired{opacity:.55;border-left:3px solid var(--ink-tertiary)}
.course-card-name{font-size:var(--text-sm);font-weight:600;margin-bottom:4px;line-height:1.3}
.course-card-teacher{font-size:var(--text-xs);color:var(--ink-tertiary);margin-bottom:10px}
.course-card-stats{display:flex;gap:var(--sp-3);font-size:var(--text-xs);align-items:center}
.course-card-stat-ok{color:var(--status-ok-ink);font-weight:600}
.course-card-stat-fail{color:var(--status-err-ink);font-weight:600}
.course-card-badge{position:absolute;top:10px;right:10px;font-size:var(--text-2xs);padding:2px 8px;border-radius:var(--r-sm);font-weight:600}
.badge-on{background:var(--brand-100);color:var(--brand-700)}
.badge-off{background:var(--status-idle-bg);color:var(--status-idle-ink)}
.badge-retired{background:var(--status-idle-bg);color:var(--status-idle-ink)}
.grid-empty{grid-column:1/-1;text-align:center;color:var(--ink-tertiary);padding:40px 0;font-size:var(--text-sm)}
.course-note{font-size:var(--text-2xs);color:var(--brand-700);background:var(--brand-50);padding:3px 8px;border-radius:var(--r-xs);margin:6px 0;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border:1px solid var(--brand-100)}
.course-note:hover{background:var(--brand-100)}

/* ===== 历史（模块 5） ===== */
.table-toolbar{display:flex;align-items:center;justify-content:space-between;gap:var(--sp-3);flex-wrap:wrap;padding:var(--sp-3) var(--sp-5);border-bottom:1px solid var(--line-dim)}
.filter-pills{display:flex;gap:4px;flex-wrap:wrap;background:var(--bg-surface-sub);border:1px solid var(--line-dim);border-radius:var(--r-full);padding:3px}
.filter-pill{border:none;background:transparent;color:var(--ink-secondary);font-size:var(--text-xs);font-weight:600;padding:5px 12px;border-radius:var(--r-full);cursor:pointer;transition:background var(--dur-fast),color var(--dur-fast)}
.filter-pill:hover{color:var(--ink-primary)}
.filter-pill.active{background:var(--bg-surface);color:var(--brand-600);box-shadow:var(--shadow-sm)}
.toolbar-actions{display:flex;gap:var(--sp-2);flex-wrap:wrap}

/* ===== 日历 ===== */
.cal-week{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:6px}
.cal-week span{text-align:center;font-size:var(--text-2xs);color:var(--ink-tertiary);font-weight:600;padding:4px 0}
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.cal-cell{min-height:56px;border:1px solid var(--line-dim);border-radius:var(--r-sm);padding:6px;background:var(--bg-surface);cursor:pointer;transition:border-color var(--dur-fast),background var(--dur-fast)}
.cal-cell:hover{border-color:var(--brand-500)}
.cal-other{opacity:.35;cursor:default;background:var(--bg-surface-sub)}
.cal-today{border-color:var(--brand-500);box-shadow:0 0 0 1px var(--brand-500) inset}
.cal-sel{background:var(--brand-50);border-color:var(--brand-500)}
.cal-day-num{font-size:var(--text-xs);font-weight:600;color:var(--ink-secondary)}
.cal-badges{display:flex;flex-direction:column;gap:3px;margin-top:5px}
.cal-badges span{font-size:var(--text-2xs);font-weight:600;line-height:1.2}
.cal-ok{color:var(--status-ok-ink)}
.cal-err{color:var(--status-err-ink)}
.cal-detail-item{display:flex;gap:var(--sp-3);padding:8px 0;border-bottom:1px solid var(--line-dim);font-size:var(--text-sm);align-items:baseline}
.cal-detail-item:last-child{border-bottom:none}

/* ===== 日志（模块 6） ===== */
.log-toolbar{display:flex;align-items:center;justify-content:space-between;gap:var(--sp-3);flex-wrap:wrap;padding:var(--sp-3) var(--sp-5);border-bottom:1px solid var(--line-dim)}
.log-levels{display:flex;gap:4px;flex-wrap:wrap}
.log-lvl-btn{border:1px solid var(--line-dim);background:var(--bg-surface);color:var(--ink-secondary);font-size:var(--text-2xs);font-weight:600;padding:4px 10px;border-radius:var(--r-full);cursor:pointer;font-family:var(--font-mono);transition:background var(--dur-fast),color var(--dur-fast),border-color var(--dur-fast)}
.log-lvl-btn:hover{color:var(--ink-primary)}
.log-lvl-btn.active{background:var(--ink-primary);color:var(--bg-surface);border-color:var(--ink-primary)}
.log-scroll{position:relative}
.log-box{background:#16130F;color:#D8D2C8;font-family:var(--font-mono);font-size:var(--text-xs);line-height:1.75;padding:var(--sp-4) var(--sp-5);max-height:56vh;overflow-y:auto;white-space:pre-wrap;word-break:break-all}
.log-box::-webkit-scrollbar-thumb{background:#3A342C;border-color:#16130F}
.log-line{padding:1px 0}
.log-line .log-ts{color:#8A8175;margin-right:8px}
.log-line .log-lvl{font-weight:700;margin-right:8px}
.log-line.level-debug .log-lvl{color:#8A8175}
.log-line.level-info .log-lvl{color:#7FB3E8}
.log-line.level-warn .log-lvl{color:#F0C040}
.log-line.level-error .log-lvl{color:#FF8A80}
.log-line.level-warn .log-msg{color:#F3DFA8}
.log-line.level-error .log-msg{color:#FFB4AE}
.log-empty{color:#6B7280;text-align:center;padding:24px 0}
.log-pin{position:absolute;right:18px;bottom:18px;display:none;align-items:center;gap:6px;height:32px;padding:0 14px;border-radius:var(--r-full);border:1px solid var(--line-strong);background:var(--bg-surface);color:var(--ink-secondary);font-size:var(--text-xs);font-weight:600;cursor:pointer;box-shadow:var(--shadow-md);z-index:5}
.log-pin.show{display:inline-flex}
.log-pin:hover{color:var(--ink-primary)}

/* ===== 空态 ===== */
.empty{padding:36px var(--sp-5);text-align:center}
.empty p{color:var(--ink-secondary);font-size:var(--text-sm)}
.empty-sub{font-size:var(--text-xs);color:var(--ink-tertiary);margin-top:4px}
.empty .btn{margin-top:var(--sp-3)}

/* ===== 网络诊断 ===== */
.diag-result{margin-top:var(--sp-2);border:1px solid var(--line-dim);border-radius:var(--r-sm);overflow:hidden}
.diag-item{display:flex;align-items:center;gap:var(--sp-3);padding:10px var(--sp-4);font-size:var(--text-sm);border-bottom:1px solid var(--line-dim);flex-wrap:wrap}
.diag-item:last-child{border-bottom:none}
.diag-name{font-weight:600;width:104px;flex-shrink:0}
.diag-ms{font-size:var(--text-xs);color:var(--ink-tertiary);width:64px;text-align:right;flex-shrink:0;font-variant-numeric:tabular-nums}
.diag-detail{font-size:var(--text-xs);color:var(--ink-secondary);line-height:1.5;flex:1;min-width:120px}

/* ===== 功能总览 ===== */
.feature-grid{display:flex;flex-direction:column;padding:var(--sp-2) var(--sp-5)}
.feature-item{display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-3) 0}
.feature-item+.feature-item{border-top:1px solid var(--line-dim)}
.feature-ico{width:34px;height:34px;border-radius:var(--r-sm);background:var(--brand-100);color:var(--brand-700);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.feature-ico svg{width:16px;height:16px}
.feature-name{font-size:var(--text-sm);font-weight:600}
.feature-desc{font-size:var(--text-xs);color:var(--ink-secondary);margin-top:2px;line-height:1.6}

/* ===== 关于 ===== */
.about-box{padding:var(--sp-1) var(--sp-5)}
.about-line{display:flex;gap:var(--sp-3);padding:9px 0;font-size:var(--text-sm);border-bottom:1px solid var(--line-dim);line-height:1.6;align-items:center}
.about-line:last-child{border-bottom:none}
.about-key{width:56px;flex-shrink:0;color:var(--ink-tertiary);font-size:var(--text-xs)}

/* ===== 时刻滚轮选择器 ===== */
.tp-field{cursor:pointer;user-select:none;padding-right:28px;background-repeat:no-repeat;background-position:right 8px center;background-size:14px 14px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23EF7429' stroke-width='1.7' stroke-linecap='round'%3E%3Ccircle cx='12' cy='12' r='9'/%3E%3Cpath d='M12 7.5v5l3 2'/%3E%3C/svg%3E")}
.tp-mask{position:fixed;inset:0;z-index:1200;display:none;background:rgba(20,18,16,.06)}
.tp-mask.show{display:block}
.tp-pop{position:absolute;width:236px;background:var(--bg-surface);border:1px solid var(--line-dim);border-radius:var(--r-lg);box-shadow:var(--shadow-lg);padding:10px;animation:tpIn var(--dur-base) var(--ease-spring)}
@keyframes tpIn{from{opacity:0;transform:translateY(-6px) scale(.98)}to{opacity:1;transform:none}}
.tp-head{display:flex;align-items:baseline;justify-content:space-between;padding:2px 4px 8px;font-size:var(--text-xs);color:var(--ink-tertiary)}
.tp-head b{font-size:var(--text-md);color:var(--ink-primary);font-variant-numeric:tabular-nums}
.tp-cols{position:relative;display:flex;gap:6px;height:188px}
.tp-band{position:absolute;left:0;right:0;top:80px;height:28px;border-radius:var(--r-sm);background:var(--brand-50);pointer-events:none;border-top:1px solid var(--brand-100);border-bottom:1px solid var(--brand-100)}
.tp-col{flex:1;height:100%;overflow-y:auto;scroll-snap-type:y mandatory;scrollbar-width:none;padding:80px 0;-webkit-mask-image:linear-gradient(180deg,transparent,#000 24%,#000 76%,transparent);mask-image:linear-gradient(180deg,transparent,#000 24%,#000 76%,transparent)}
.tp-col:focus-visible{outline:none}
.tp-col::-webkit-scrollbar{display:none}
.tp-item{height:28px;line-height:28px;text-align:center;scroll-snap-align:center;font-size:var(--text-md);font-variant-numeric:tabular-nums;color:var(--ink-tertiary)}
.tp-item.sel{color:var(--brand-600);font-weight:600}
.tp-foot{display:flex;gap:var(--sp-2);margin-top:10px}
.tp-foot .btn{flex:1;height:32px;font-size:var(--text-xs);padding:0 8px}

/* ===== 弹窗 / 对话框 ===== */
.modal-mask{position:fixed;inset:0;z-index:990;display:none;align-items:center;justify-content:center;background:rgba(20,18,16,.46);backdrop-filter:blur(3px)}
.modal-mask.show{display:flex}
.modal{width:460px;max-width:92vw;max-height:86dvh;background:var(--bg-surface);border:1px solid var(--line-dim);border-radius:var(--r-xl);box-shadow:var(--shadow-modal);display:flex;flex-direction:column;overflow:hidden;animation:modalIn var(--dur-base) var(--ease-spring)}
@keyframes modalIn{from{opacity:0;transform:scale(.96) translateY(6px)}to{opacity:1;transform:none}}
.modal-head{display:flex;align-items:center;justify-content:space-between;padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--line-dim);flex:none}
.modal-title{display:flex;align-items:center;gap:var(--sp-2);font-size:var(--text-md);font-weight:600}
.modal-title svg{width:17px;height:17px;color:var(--brand-600)}
.modal-close{width:30px;height:30px;display:flex;align-items:center;justify-content:center;border:none;background:none;border-radius:var(--r-sm);color:var(--ink-secondary);cursor:pointer}
.modal-close:hover{background:var(--bg-surface-sub);color:var(--ink-primary)}
.modal-close svg{width:16px;height:16px}
.modal-body{padding:var(--sp-5) var(--sp-4);overflow:auto;min-height:0}
.modal-foot{display:flex;align-items:center;justify-content:flex-end;gap:var(--sp-3);padding:var(--sp-3) var(--sp-4);border-top:1px solid var(--line-dim);font-size:var(--text-xs);color:var(--ink-tertiary);flex:none}
.dlg-text{margin:0;font-size:var(--text-sm);color:var(--ink-secondary);line-height:1.7;white-space:pre-wrap}
.dlg .modal-body{display:flex;flex-direction:column;gap:var(--sp-3)}
.disclaimer-modal{max-width:680px;width:min(680px,92vw)}
.disclaimer-scroll{max-height:52vh;overflow-y:auto;padding-right:4px;line-height:1.8;font-size:var(--text-sm);color:var(--ink-primary)}
.disclaimer-scroll h3{font-size:var(--text-md);font-weight:700;margin:0 0 10px}
.disclaimer-scroll h4{font-size:var(--text-sm);font-weight:600;margin:14px 0 6px;color:var(--brand-700)}
.disclaimer-scroll p{margin:4px 0;text-align:justify}
.disclaimer-modal .modal-foot .btn{flex:1;justify-content:center}
.update-modal{max-width:540px;width:min(540px,92vw)}
.spinner{width:15px;height:15px;border:2px solid var(--line-strong);border-top-color:var(--brand-500);border-radius:50%;animation:spin .8s linear infinite;flex-shrink:0}
@keyframes spin{to{transform:rotate(360deg)}}
.detail-modal{position:fixed;inset:0;background:rgba(20,18,16,.46);backdrop-filter:blur(3px);z-index:1000;display:none;align-items:center;justify-content:center}
.detail-modal.show{display:flex}
.detail-modal-box{background:var(--bg-surface);border-radius:var(--r-xl);width:90%;max-width:620px;max-height:82dvh;overflow:hidden;box-shadow:var(--shadow-modal);display:flex;flex-direction:column}
.detail-modal-head{display:flex;align-items:center;justify-content:space-between;padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--line-dim);flex:none}
.detail-modal-title{font-size:var(--text-md);font-weight:600}
.detail-modal-close{background:none;border:none;font-size:var(--text-xl);color:var(--ink-tertiary);cursor:pointer;padding:2px 8px;line-height:1}
.detail-modal-body{padding:var(--sp-4);overflow-y:auto;min-height:0}

/* ===== 二维码弹窗 ===== */
.qr-drop{border:2px dashed var(--brand-500);border-radius:var(--r-md);background:var(--brand-50);padding:32px 22px;text-align:center;color:var(--brand-700);transition:border-color var(--dur-base),background var(--dur-base),transform var(--dur-base)}
.qr-drop.drag{border-color:var(--brand-600);background:var(--brand-100);transform:scale(1.01)}
.qr-drop>svg{width:44px;height:44px;margin-bottom:10px}
.qr-drop-text{font-size:var(--text-sm);font-weight:600;color:var(--ink-primary)}
.qr-drop-sub{font-size:var(--text-xs);color:var(--ink-secondary);margin-top:5px}
.qr-status{margin-top:var(--sp-3);font-size:var(--text-sm);color:var(--ink-secondary);text-align:center;min-height:20px}
.qr-status.ok{color:var(--status-ok-ink);font-weight:600}
.qr-status.err{color:var(--status-err-ink);font-weight:600}
.qr-mobile{margin-top:var(--sp-4);padding:var(--sp-3);border:1px solid var(--line-dim);border-radius:var(--r-md);background:var(--bg-surface-sub)}
.qr-mobile-title{font-size:var(--text-xs);font-weight:600;color:var(--ink-secondary);margin-bottom:var(--sp-2)}
.qr-mobile-url{display:flex;align-items:center;gap:var(--sp-2)}
.qr-mobile-url .cell-mono{flex:1;min-width:0;word-break:break-all;line-height:1.5}
.qr-mobile-hint{font-size:var(--text-xs);color:var(--ink-tertiary);margin-top:var(--sp-2);line-height:1.6}
.qr-mobile-warn{font-size:var(--text-xs);color:var(--status-warn-ink);background:var(--status-warn-bg);border-radius:var(--r-xs);padding:8px 10px;margin-top:var(--sp-2);line-height:1.65}

/* ===== 拖拽遮罩 ===== */
.drag-mask{position:fixed;inset:0;z-index:999;display:none;align-items:center;justify-content:center;background:rgba(247,138,70,.07);pointer-events:none}
.drag-mask.show{display:flex}
.drag-box{border:2px dashed var(--brand-600);border-radius:var(--r-lg);background:var(--bg-surface);padding:36px 60px;text-align:center;color:var(--brand-700);font-size:var(--text-lg);font-weight:600;box-shadow:var(--shadow-lg)}
.drag-box small{display:block;margin-top:6px;font-size:var(--text-sm);font-weight:400;color:var(--ink-secondary)}

/* ===== 更新小框（模块 10） ===== */
.upd-box{position:fixed;right:22px;bottom:22px;z-index:900;display:none;align-items:center;gap:10px;padding:10px 14px 10px 10px;border-radius:var(--r-lg);background:var(--bg-surface);border:1px solid var(--line-dim);box-shadow:var(--shadow-lg);cursor:pointer;transition:transform var(--dur-base) var(--ease-spring),box-shadow var(--dur-base)}
.upd-box.show{display:flex}
.upd-box:hover{transform:translateY(-2px)}
.upd-box.ready{border-color:var(--brand-500)}
.upd-ring{position:relative;width:42px;height:42px;flex-shrink:0}
.upd-ring svg{width:42px;height:42px;transform:rotate(-90deg);display:block}
.upd-ring .bg{fill:none;stroke:var(--brand-100);stroke-width:5}
.upd-ring .fg{fill:none;stroke:var(--brand-600);stroke-width:5;stroke-linecap:round;transition:stroke-dashoffset .3s ease}
.upd-ring .txt{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;color:var(--brand-700);font-variant-numeric:tabular-nums}
.upd-meta{display:flex;flex-direction:column;gap:2px;min-width:0}
.upd-title{font-size:var(--text-xs);font-weight:600;color:var(--ink-primary);white-space:nowrap}
.upd-sub{font-size:var(--text-2xs);color:var(--ink-tertiary);white-space:nowrap}
.upd-hover{position:fixed;z-index:901;width:330px;max-width:min(88vw,380px);display:none;padding:12px 14px;border-radius:var(--r-lg);background:var(--bg-surface);border:1px solid var(--line-dim);box-shadow:var(--shadow-lg);animation:tpIn var(--dur-fast) var(--ease-spring)}
.upd-hover.show{display:block}
.upd-hover h4{margin:0 0 6px;font-size:var(--text-sm);color:var(--ink-primary)}
.upd-hover .upd-hover-meta{font-size:var(--text-2xs);color:var(--ink-tertiary);margin:0 0 8px}
.upd-hover pre{margin:0;max-height:230px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:var(--text-xs);line-height:1.7;color:var(--ink-secondary)}

/* ===== Toast ===== */
.toast-wrap{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:1400;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none}
.toast{max-width:min(80vw,420px);padding:10px 16px;border-radius:var(--r-full);background:var(--ink-primary);color:var(--bg-surface);font-size:var(--text-sm);line-height:1.5;box-shadow:var(--shadow-lg);animation:toastIn var(--dur-base) var(--ease-spring)}
.toast-ok{background:var(--status-ok-ink)}
.toast-err{background:var(--status-err-ink)}
@keyframes toastIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

/* ===== 移动端 FAB ===== */
.fab{display:none;position:fixed;right:18px;bottom:calc(78px + env(safe-area-inset-bottom,0px));z-index:70;width:54px;height:54px;border-radius:50%;border:none;background:var(--brand-600);color:var(--ink-inverse);align-items:center;justify-content:center;cursor:pointer;box-shadow:var(--shadow-lg);transition:transform var(--dur-fast) var(--ease-out)}
.fab svg{width:24px;height:24px}
.fab:active{transform:scale(.94)}

/* ===== 滚动条（浏览器表面） ===== */
.app-main::-webkit-scrollbar{width:10px}
.app-main::-webkit-scrollbar-thumb{background:var(--line-strong);border-radius:var(--r-full);border:2px solid var(--bg-canvas)}

/* ===== 窄桌面窗口：状态芯片按优先级收窄 ===== */
@media (max-width:1180px){.status-chip{font-size:var(--text-2xs);padding:0 7px}#chipMode{display:none}}
@media (max-width:1040px){#chipIm{display:none}}
@media (max-width:1240px){#chipDing{display:none}}

/* ============================================================
   移动端（模块 1 / 9）：侧栏 → 底部标签栏，表格 → 卡片列表
   ============================================================ */
@media (max-width:720px){
  .app-titlebar{display:none}
  .app-shell{height:100vh;height:100dvh}
  .app-body{flex-direction:column}
  .app-sidebar{position:fixed;left:0;right:0;bottom:0;top:auto;z-index:60;width:100%;flex-direction:row;align-items:stretch;padding:0 2px;padding-bottom:env(safe-area-inset-bottom,0px);border-right:0;border-top:1px solid var(--line-dim);background:var(--bg-surface)}
  .sidebar-heartbeat{display:none}
  .nav-group{flex-direction:row;flex:1;gap:0;justify-content:space-around;align-items:stretch;min-width:0;overflow-x:auto;scrollbar-width:none}
  .nav-group::-webkit-scrollbar{display:none}
  .nav-item{flex:1 0 auto;flex-direction:column;gap:3px;justify-content:center;align-items:center;height:auto;min-width:52px;min-height:56px;padding:8px 2px 6px;font-size:var(--text-2xs);border-radius:0;text-align:center;border:none}
  .nav-item .nav-icon{width:20px;height:20px}
  .nav-item.active{background:none;color:var(--brand-600)}
  .app-main{padding:var(--sp-4) var(--sp-4) calc(76px + env(safe-area-inset-bottom,0px))}
  .stats-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--sp-3)}
  .stat-box-val{font-size:var(--text-xl)}
  /* 表格 → 卡片列表 */
  .data-table,.data-table thead,.data-table tbody,.data-table tr,.data-table td{display:block}
  .data-table thead{display:none}
  .data-table tr{background:var(--bg-surface);border:1px solid var(--line-dim);border-radius:var(--r-md);padding:var(--sp-3);margin-bottom:var(--sp-3);box-shadow:var(--shadow-sm)}
  .data-table td{display:flex;align-items:baseline;justify-content:space-between;gap:var(--sp-3);padding:5px 0;border:0;text-align:right}
  .data-table td::before{content:attr(data-label);color:var(--ink-tertiary);font-size:var(--text-xs);text-align:left;flex:0 0 auto}
  .data-table td:first-child{justify-content:flex-start;font-size:var(--text-base);font-weight:600;padding-bottom:8px;margin-bottom:5px;border-bottom:1px solid var(--line-dim)}
  .data-table td:first-child::before{display:none}
  .data-table td[colspan]{justify-content:center;color:var(--ink-tertiary)}
  .data-table td[colspan]::before{display:none}
  .col-course-actions{justify-content:space-between}
  .btn{min-height:40px}
  .field-input{min-height:40px;font-size:16px}
  input,select,textarea{font-size:16px}
  .modal-mask.show,.detail-modal.show{align-items:flex-end;padding:0}
  .modal,.disclaimer-modal,.detail-modal-box,.update-modal{width:100%;max-width:100%;border-radius:var(--r-xl) var(--r-xl) 0 0;max-height:90dvh;animation:sheetIn .26s var(--ease-out)}
  @keyframes sheetIn{from{transform:translateY(100%);opacity:.6}to{transform:translateY(0);opacity:1}}
  .modal-head,.detail-modal-head{position:relative;padding-top:16px}
  .modal-head::before,.detail-modal-head::before{content:'';position:absolute;top:6px;left:50%;transform:translateX(-50%);width:36px;height:4px;border-radius:var(--r-full);background:var(--line-strong)}
  .modal-body{padding-bottom:calc(var(--sp-4) + env(safe-area-inset-bottom,0px))}
  .modal-foot{padding-bottom:calc(var(--sp-3) + env(safe-area-inset-bottom,0px))}
  .modal-close{min-width:44px;min-height:44px}
  .fab{display:inline-flex}
  .tp-mask.show{display:flex;align-items:flex-end;background:rgba(20,18,16,.32)}
  .tp-pop{position:relative!important;width:100%;border-radius:var(--r-xl) var(--r-xl) 0 0;padding:22px 16px calc(18px + env(safe-area-inset-bottom));animation:sheetIn .26s var(--ease-out)}
  .tp-field{min-height:44px;font-size:16px}
  .tp-cols{height:252px}
  .tp-band{top:108px;height:36px}
  .tp-col{padding:108px 0}
  .tp-item{height:36px;line-height:36px;font-size:17px}
  .upd-box{left:14px;right:auto;bottom:calc(78px + env(safe-area-inset-bottom,0px));padding:8px;border-radius:var(--r-md)}
  .upd-meta{display:none}
  .upd-hover{display:none!important}
  .log-box{max-height:50vh}
  .tt-toolbar,.table-toolbar,.log-toolbar{flex-direction:column;align-items:stretch}
  .service-notice{flex-direction:column;align-items:stretch}
}
@media (max-width:400px){
  .stats-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--sp-2)}
  .stat-box-val{font-size:var(--text-lg)}
  .app-main{padding-left:var(--sp-3);padding-right:var(--sp-3)}
}

${VOYRA_UI_CSS}
</style>
</head>
<body>
<div class="app-shell">
  <!-- 自绘无边框标题栏 -->
  <header class="app-titlebar">
    <div class="titlebar-drag">
      <div class="app-branding">
        ${ICONS.appMark}
        <span class="app-title">学习通自动签到</span>
        <span class="app-ver">v${esc(version)}</span>
      </div>
    </div>
    <div class="titlebar-status-strip" id="statusStrip" role="status" aria-live="polite">
      <span class="status-chip" id="chipMode">${esc(modeText(mode))}</span>
      <span class="status-chip ${accountsEmpty ? '' : cookieOk ? 'ok' : 'warn'}" id="chipCookie">${accountsEmpty ? '未配置账号' : cookieOk ? '账号已连接' : status.cookieValid === false ? '登录失效' : '待核验'}</span>
      <span class="status-chip ${status.imConnected ? 'ok' : 'subtle'}" id="chipIm">${status.imConnected ? 'IM 实时' : '轮询扫描'}</span>
      <span class="status-chip ${status.dingtalkStreamConnected ? 'ok' : status.dingtalkStreamEnabled ? 'warn' : ''}" id="chipDing"${status.dingtalkStreamEnabled ? '' : ' style="display:none"'}>${status.dingtalkStreamConnected ? '钉钉通道' : '钉钉连接中'}</span>
      <button type="button" class="status-chip pulse-orange" id="chipQr"${status.qrPending ? '' : ' style="display:none"'}>有二维码待签</button>
      <button type="button" class="status-chip chip-update" id="chipUpdate" style="display:none" title="有新版本可用，点击查看">有新版本</button>
    </div>
    <div class="titlebar-controls no-drag">
      <button class="win-btn" id="btnMin" title="最小化" aria-label="最小化">${ICONS.winMin}</button>
      <button class="win-btn" id="btnMax" title="最大化/还原" aria-label="最大化">${ICONS.winMax}</button>
      <button class="win-btn win-close" id="btnClose" title="关闭（后台继续运行）" aria-label="关闭">${ICONS.winClose}</button>
    </div>
  </header>

  <div class="app-body">
    <!-- 左侧导航 -->
    <aside class="app-sidebar">
      <nav class="nav-group" id="nav" aria-label="主功能导航">
        <button class="nav-item active" data-view="overview">${ICONS.appMark.replace('class="app-mark"', 'class="nav-icon app-mark"')}<span class="nav-label">总览</span></button>
        <button class="nav-item" data-view="courses">${ICONS.courses.replace('<svg', '<svg class="nav-icon"')}<span class="nav-label">课程清单</span></button>
        <button class="nav-item" data-view="schedule">${ICONS.calendar.replace('<svg', '<svg class="nav-icon"')}<span class="nav-label">课表扫描</span></button>
        <button class="nav-item" data-view="history">${ICONS.history.replace('<svg', '<svg class="nav-icon"')}<span class="nav-label">历史记录</span></button>
        <button class="nav-item" data-view="logs">${ICONS.log.replace('<svg', '<svg class="nav-icon"')}<span class="nav-label">实时日志</span></button>
        <button class="nav-item" data-view="settings">${ICONS.settings.replace('<svg', '<svg class="nav-icon"')}<span class="nav-label">运行设置</span></button>
      </nav>

      <!-- 引擎心脏监视器 -->
      <div class="sidebar-heartbeat" id="sidebarHeartbeat" role="status" aria-live="polite">
        <div class="hb-status-row">
          <span class="hb-indicator ${engineTone}" id="footDot"></span>
          <span class="hb-state-text" id="footState">${esc(engineState)}</span>
        </div>
        <div class="hb-meta-row">
          <span class="hb-meta-item" title="有效账号数">${ICONS.user}<span id="footAccounts">${accounts.length} 账号</span></span>
          <span class="hb-meta-item" title="服务端口">${ICONS.server}<span id="footPort">:${esc(String(status.port || 3456))}</span></span>
          <span class="hb-meta-item" title="轮询周期">${ICONS.clock}<span id="hbCountdown">${Math.round((status.pollInterval || 30000) / 1000)}s</span></span>
        </div>
      </div>
    </aside>

    <!-- 主展示区 -->
    <main class="app-main" id="mainContentScroll">
      <div class="page-head">
        <div>
          <div class="page-title" id="pageTitle">总览</div>
          <div class="page-sub" id="pageSub">自动监听签到活动，发现后自动完成签到</div>
        </div>
        <div class="top-actions">
          <button type="button" class="btn btn-primary" id="btnQrModal" aria-label="打开二维码上传与签到">${ICONS.qr}<span>二维码签到</span></button>
        </div>
      </div>
      <section class="service-notice" id="serviceNotice" hidden aria-label="运行状态">
        <div><strong id="serviceNoticeTitle"></strong><p id="serviceNoticeText"></p></div>
        <button type="button" class="btn btn-secondary" id="serviceRetry">重新连接</button>
        <a class="btn btn-secondary" id="serviceSettings" href="#settings" hidden>查看账号设置</a>
        <span class="sr-only" id="serviceAnnouncement" role="status" aria-live="polite"></span>
      </section>

      <!-- ===== 总览（模块 2） ===== -->
      <section class="view active" data-view="overview" id="panel-overview">
        <div class="stats-grid">${statCards}</div>
        <div id="trendChart">${renderTrendSvg(status.trend || [])}</div>
        <div class="overview-lower-grid">
          <div class="card">
            <div class="card-head"><div><h3 class="card-title">账号</h3><p class="card-desc">多账号独立运行</p></div></div>
            <div id="accountsBox">${accountCards}</div>
          </div>
          <div class="card">
            <div class="card-head"><div><h3 class="card-title">最近活动</h3><p class="card-desc">自动签到 · 失败自动重试</p></div></div>
            <table class="data-table">
              <thead><tr><th>时间</th><th>课程</th><th>类型</th><th>结果</th></tr></thead>
              <tbody id="recentBody">${renderRecentRows(recent)}</tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3 class="card-title">各账号签到统计</h3><p class="card-desc">按历史记录实时统计</p></div></div>
          <div class="acct-stat-row" id="acctStatsBox"><div class="cell-empty" style="padding:16px 0">加载中…</div></div>
        </div>
      </section>

      <!-- ===== 课程（模块 3） ===== -->
      <section class="view" data-view="courses" id="panel-courses">
        <div class="card">
          <div class="card-head">
            <div><h3 class="card-title">监控课程</h3><p class="card-desc" id="courseCount">${courses.length} 门 · 轮询发现签到活动</p></div>
          </div>
          <div class="watch-bar">
            <button class="btn ${listeningOn ? 'btn-secondary' : 'btn-primary'}" id="listenToggleBtn">${listeningOn ? '⏸ 停止监听' : '▶ 开启监听'}</button>
            <button class="btn btn-secondary" id="scanNowBtn">⚡ 立即扫描一次</button>
            <span id="listenState" class="cell-sub">${listeningOn ? `正在监听 ${status.listeningCount ?? courses.length} 门课程` : '已停止监听（不会发送任何轮询请求，二维码上传仍可用）'}</span>
          </div>
          <div class="watch-bar">
            扫描严格按课表进行（只在周一~周五 07:30–12:30、14:00–21:00 的对应节次查对应课程）。课表之外临时想确认有没有新签到，点「⚡ 立即扫描一次」——它会立刻查一遍全部课程，不受课表限制。
          </div>
          <table class="data-table">
            <thead><tr><th>课程</th><th>签到时段</th><th>状态</th><th style="text-align:right">监听</th></tr></thead>
            <tbody id="coursesBody">${courseRows}</tbody>
          </table>
          <div class="card-foot">
            <button class="btn btn-primary" id="watchSaveBtn">保存并立即生效</button>
            <button class="btn btn-secondary" id="coursesResetBtn">全部恢复监听</button>
            <button class="btn btn-secondary" id="refreshCoursesBtn">${ICONS.refresh}<span>重新拉取课程列表</span></button>
            <span class="cfg-msg" id="watchMsg"></span>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3 class="card-title">课程签到统计</h3><p class="card-desc">按历史记录实时统计</p></div></div>
          <table class="data-table">
            <thead><tr><th>课程</th><th>签到成功</th><th>签到失败</th><th>成功率</th></tr></thead>
            <tbody id="courseStatsBody"></tbody>
          </table>
        </div>
      </section>

      <!-- ===== 课表（模块 4） ===== -->
      <section class="view" data-view="schedule" id="panel-schedule">
        <div class="card">
          <div class="tt-toolbar">
            <div class="tt-status-info">
              <span class="tt-badge" id="ttCompleteBadge">正在读取课表…</span>
              <div class="tt-progress" id="ttProgressWrap"><i id="ttProgressBar" style="width:0%"></i></div>
            </div>
            <div class="tt-btn-group">
              <button class="btn btn-secondary" id="ttAutoBtn">${ICONS.spark}<span>智能推断填空</span></button>
              <button class="btn btn-primary" id="ttSaveBtn">保存课表</button>
              <button class="btn btn-secondary" id="ttClearBtn">清空重填</button>
            </div>
          </div>
          <div class="tt-warn" id="ttWarn" style="display:none"></div>
          <div class="tt-ok" id="ttOk" style="display:none"></div>
          <div class="tt-legend">
            <span><i style="background:var(--status-err-bg);border-color:var(--status-err-line)"></i>未填（必须填完）</span>
            <span><i style="background:var(--brand-50);border-color:var(--brand-500)"></i>已填</span>
            <span><i style="background:var(--status-warn-bg);border-color:var(--status-warn-dot)"></i>推断建议（请核对）</span>
          </div>
          <div class="tt-wrap">
            <table class="tt-table">
              <thead><tr><th class="tt-slot-col">节次 / 时间</th><th>周一</th><th>周二</th><th>周三</th><th>周四</th><th>周五</th></tr></thead>
              <tbody id="ttBody"><tr><td colspan="6" class="cell-empty">加载中…</td></tr></tbody>
            </table>
          </div>
          <div class="card-foot">
            <span class="cfg-msg tt-count" id="ttCount"></span>
            <span class="cfg-msg" id="ttMsg"></span>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3 class="card-title">扫描时段说明</h3><p class="card-desc">软件只在这些时段扫描</p></div></div>
          <div class="tt-legend" style="padding-bottom:var(--sp-4)">
            <span>周一~周五 · 上午 <b>07:30–12:30</b>（4 节） · 下午 <b>14:00–21:00</b>（4 节）</span>
            <span>其余时间（含周末）不发送任何请求</span>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3 class="card-title">本周课表概览</h3><p class="card-desc">课程监听状态与签到统计</p></div></div>
          <div class="stat-row" id="scheduleStats">
            <div class="stat-card"><div class="stat-num" id="schTotal">0</div><div class="stat-label">总课程</div></div>
            <div class="stat-card"><div class="stat-num" id="schWatching">0</div><div class="stat-label">监听中</div></div>
            <div class="stat-card"><div class="stat-num" id="schRetired">0</div><div class="stat-label">已结课</div></div>
            <div class="stat-card"><div class="stat-num" id="schSuccess">0</div><div class="stat-label">累计成功</div></div>
            <div class="stat-card"><div class="stat-num" id="schFail">0</div><div class="stat-label">累计失败</div></div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3 class="card-title">课程列表</h3><p class="card-desc">点击卡片切换监听状态</p></div></div>
          <div class="course-grid" id="scheduleGrid"><div class="grid-empty">加载中...</div></div>
        </div>
      </section>

      <!-- ===== 历史（模块 5） ===== -->
      <section class="view" data-view="history" id="panel-history">
        <div class="card">
          <div class="card-head">
            <div><h3 class="card-title">签到日历</h3><p class="card-desc" id="calTitle">—</p></div>
            <div class="tt-btn-group">
              <button class="btn btn-secondary btn-sm" id="calPrev">‹ 上月</button>
              <button class="btn btn-secondary btn-sm" id="calNext">下月 ›</button>
            </div>
          </div>
          <div class="card-body">
            <div class="cal-week"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>
            <div class="cal-grid" id="calGrid"></div>
            <div id="calDetail" style="margin-top:var(--sp-4)"></div>
          </div>
        </div>
        <div class="card">
          <div class="table-toolbar">
            <div class="filter-pills" role="tablist" aria-label="签到记录筛选">
              <button class="filter-pill active" data-filter="all" role="tab">全部记录</button>
              <button class="filter-pill" data-filter="success" role="tab">成功</button>
              <button class="filter-pill" data-filter="fail" role="tab">异常/失败</button>
              <button class="filter-pill" data-filter="qr" role="tab">二维码</button>
            </div>
            <div class="toolbar-actions">
              <span class="cell-sub" id="historyCount"></span>
              <a class="btn btn-secondary btn-sm" href="/api/history/export${qs}" download="checkin-history.csv">${ICONS.download}<span>导出 CSV</span></a>
              <button class="btn btn-secondary btn-sm btn-danger-hover" id="clearHistoryBtn">${ICONS.trash}<span>清空记录</span></button>
            </div>
          </div>
          <table class="data-table">
            <thead><tr><th>时间</th><th>课程</th><th>类型</th><th>结果</th></tr></thead>
            <tbody id="historyBody">${renderRecentRows(recent)}</tbody>
          </table>
          <div class="card-foot"><span class="cfg-msg" id="historyMsg"></span></div>
        </div>
      </section>

      <!-- ===== 日志（模块 6） ===== -->
      <section class="view" data-view="logs" id="panel-logs">
        <div class="card">
          <div class="log-toolbar">
            <div class="log-levels" role="tablist" aria-label="日志级别筛选">
              <button class="log-lvl-btn active" data-level="all">ALL</button>
              <button class="log-lvl-btn" data-level="debug">DEBUG</button>
              <button class="log-lvl-btn" data-level="info">INFO</button>
              <button class="log-lvl-btn" data-level="warn">WARN</button>
              <button class="log-lvl-btn" data-level="error">ERROR</button>
            </div>
            <div class="toolbar-actions">
              <span class="cell-sub" id="logFile">自动刷新 · 最近 200 行</span>
              <a class="btn btn-secondary btn-sm" href="/api/logs/export${qs}" download="app.log">${ICONS.download}<span>导出日志</span></a>
              <button class="btn btn-secondary btn-sm" id="logRefreshBtn">${ICONS.refresh}<span>刷新日志</span></button>
            </div>
          </div>
          <div class="log-scroll">
            <div class="log-box" id="logBox"><div class="log-empty">加载中…</div></div>
            <button class="log-pin" id="logPinBtn" type="button">↓ 滚动至最新</button>
          </div>
          <div class="card-foot"><span class="cfg-msg" id="logMsg"></span></div>
        </div>
      </section>

      <!-- ===== 设置（模块 7） ===== -->
      <section class="view" data-view="settings" id="panel-settings">
        ${settingsCards}

        <div class="card">
          <div class="card-head"><div><h3 class="card-title">支持的签到方式</h3></div></div>
          <div class="feature-grid">
            <div class="feature-item">
              <div class="feature-ico">${ICONS.check}</div>
              <div><div class="feature-name">普通签到</div><div class="feature-desc">检测到老师发布签到后自动完成，无需任何操作</div></div>
            </div>
            <div class="feature-item">
              <div class="feature-ico">${ICONS.location}</div>
              <div><div class="feature-name">位置签到</div><div class="feature-desc">读取老师发布的位置坐标，在设定半径内自动生成签到点并完成</div></div>
            </div>
            <div class="feature-item">
              <div class="feature-ico">${ICONS.qr}</div>
              <div><div class="feature-name">二维码签到</div><div class="feature-desc">把任意签到二维码图片直接拖入本窗口即可自动识别签到，二维码更新后拖入新码即可</div></div>
            </div>
          </div>
          <div class="card-foot" style="border-top:1px solid var(--line-dim);color:var(--ink-tertiary);display:block;font-size:var(--text-xs);line-height:1.7">
            也可点击右上角「二维码签到」按钮，或手机在同一 Wi-Fi 下访问 <span class="cell-mono">${esc(mobileUploadUrl)}</span> 上传。签到失败会自动重试；检测到手势 / 拍照类签到会推送提醒（请在学习通 APP 手动完成）。
          </div>
        </div>

        <div class="card">
          <div class="card-head"><div><h3 class="card-title">关于</h3></div></div>
          <div class="about-box">
            <div class="about-line"><span class="about-key">版本</span><span>学习通自动签到 v${esc(version)}</span><button class="btn btn-secondary btn-sm" id="updateCheckBtn" style="margin-left:auto">${ICONS.refresh}<span>检查更新</span></button></div>
            <div class="about-line"><span class="about-key">仓库</span><span class="cell-mono">github.com/liixnglinb/superstar-checkin</span></div>
            <div class="about-line"><span class="about-key">说明</span><span>仅用于个人学习场景的自动签到辅助，请遵守学校考勤规定。</span></div>
            <div class="about-line"><span class="about-key">声明</span><button class="btn btn-secondary btn-sm" id="disclaimerView">${ICONS.shield}<span>查看免责声明</span></button></div>
          </div>
        </div>
      </section>
    </main>
  </div>
</div>

<div class="drag-mask" id="dragMask"><div class="drag-box">松开即可上传二维码签到图片<small>支持任意签到二维码，识别后自动完成签到</small></div></div>

<!-- 更新小框：常驻界面，环形进度表示下载进度（刻意不用下载箭头图标） -->
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

<div class="modal-mask" id="updateModal">
  <div class="modal update-modal">
    <div class="modal-head"><span class="modal-title">${ICONS.update}<span>软件更新</span></span><button class="modal-close" id="updateClose" type="button" aria-label="关闭">${ICONS.x}</button></div>
    <div class="modal-body" style="min-height:110px">
      <div id="updateBody" style="font-size:var(--text-sm);color:var(--ink-primary);line-height:1.8"></div>
      <div id="updateBar" style="display:none;margin-top:14px">
        <div style="height:8px;background:var(--line-dim);border-radius:4px;overflow:hidden"><div id="updateBarFill" style="height:100%;width:0%;background:var(--brand-600);transition:width .2s"></div></div>
        <div id="updateBarText" style="font-size:var(--text-xs);color:var(--ink-tertiary);margin-top:6px">正在下载安装包…</div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-secondary" id="updateLater">以后再说</button>
      <button class="btn btn-primary" id="updateGo" style="display:none">立即下载安装</button>
    </div>
  </div>
</div>

<!-- 免责声明：首次进入软件时显示，同意后进入，不同意退出 -->
<div class="modal-mask" id="disclaimerModal">
  <div class="modal disclaimer-modal">
    <div class="modal-head"><span class="modal-title">${ICONS.shield}<span>免责声明</span></span></div>
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
      <button class="btn btn-danger" id="disclaimerRefuse">不同意并退出</button>
      <button class="btn btn-primary" id="disclaimerAgree">同意并继续</button>
    </div>
  </div>
</div>

<!-- 课程签到记录详情 -->
<div class="detail-modal" id="courseDetailModal" role="dialog" aria-modal="true" aria-label="课程签到记录">
  <div class="detail-modal-box">
    <div class="detail-modal-head">
      <span class="detail-modal-title" id="detailTitle">签到记录</span>
      <button class="detail-modal-close" id="detailClose" type="button" aria-label="关闭">×</button>
    </div>
    <div class="detail-modal-body" id="detailBody"></div>
  </div>
</div>

<!-- 应用内确认/输入对话框（替代系统 confirm 与 prompt） -->
<div class="modal-mask" id="dialogMask">
  <div class="modal dlg" role="dialog" aria-modal="true" aria-labelledby="dlgTitle">
    <div class="modal-head"><span id="dlgTitle">请确认</span><button class="modal-close" id="dlgClose" type="button" aria-label="关闭">${ICONS.x}</button></div>
    <div class="modal-body">
      <p class="dlg-text" id="dlgText"></p>
      <input class="field-input" id="dlgInput" style="width:100%;display:none" autocomplete="off">
    </div>
    <div class="modal-foot">
      <button class="btn btn-secondary" id="dlgCancel" type="button">取消</button>
      <button class="btn btn-primary" id="dlgOk" type="button">确定</button>
    </div>
  </div>
</div>
<div class="toast-wrap" id="toastWrap" aria-live="polite"></div>

<!-- 二维码签到弹窗 -->
<div class="modal-mask" id="qrModal">
  <div class="modal">
    <div class="modal-head">
      <span class="modal-title">${ICONS.qr}<span>二维码签到</span></span>
      <button class="modal-close" id="qrModalClose" aria-label="关闭">${ICONS.x}</button>
    </div>
    <div class="modal-body">
      <div class="qr-drop" id="qrDrop">
        ${ICONS.qr}
        <div class="qr-drop-text">把签到二维码图片拖到这里</div>
        <div class="qr-drop-sub">支持任意签到码，识别后自动完成签到</div>
        <div style="margin-top:14px"><button class="btn btn-secondary" id="btnPickFile">或选择图片文件</button></div>
        <input type="file" id="qrFileInput" accept="image/*" style="display:none">
      </div>
      <div class="qr-status" id="qrStatus"></div>
      <div class="qr-mobile">
        <div class="qr-mobile-title">用手机拍二维码？打开这个地址上传</div>
        <div class="qr-mobile-url">
          <span class="cell-mono" id="qrMobileUrl">${esc(mobileUploadUrl)}</span>
          <button class="btn btn-secondary btn-sm" id="qrCopyBtn" type="button">${ICONS.copy}<span id="qrCopyLabel">复制</span></button>
        </div>
        ${loopbackOnly
          ? `<div class="qr-mobile-warn">当前服务仅监听本机（config.yaml 中 <b>web.host: 127.0.0.1</b>），手机连不上。把该项改为 <b>0.0.0.0</b> 并重启软件后即可用手机访问（已开启 token 鉴权，仅同一 Wi-Fi 可见）。</div>`
          : `<div class="qr-mobile-hint">手机与电脑需连同一 Wi-Fi；地址含访问令牌，请勿发给他人。</div>`}
      </div>
    </div>
    <div class="modal-foot" style="justify-content:flex-start">签到二维码会随时间更新，更新后拖入新码即可</div>
  </div>
</div>

<!-- 移动端主操作浮动按钮 -->
<button class="fab" id="fabQr" title="二维码签到" aria-label="二维码签到">${ICONS.qr}</button>

<script${scriptNonce ? ` nonce="${scriptNonce}"` : ''}>
(function(){
  'use strict'
  var API_TOKEN = ${JSON.stringify(token)}
  var VIEWS = ['overview','courses','schedule','history','logs','settings']
  var TITLES = {overview:'总览',courses:'课程清单',schedule:'课表扫描',history:'历史记录',logs:'实时日志',settings:'运行设置'}
  var SUBS = {overview:'自动监听签到活动，发现后自动完成签到',courses:'逐课管控监听范围，状态一眼可辨',schedule:'课表是扫描的唯一依据，请务必填满',history:'签到日历与全部签到记录',logs:'服务运行日志，排查问题时查看',settings:'监听参数、通道与通知配置'}
  function $(id){return document.getElementById(id)}
  function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
  function fmtTime(ts){if(!ts)return '—';var d=new Date(ts),n=new Date();var hm=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');if(d.toDateString()===n.toDateString())return '今天 '+hm;var y=new Date(n.getTime()-86400000);if(d.toDateString()===y.toDateString())return '昨天 '+hm;return (d.getMonth()+1)+'月'+d.getDate()+'日 '+hm}
  function typeText(t){var m={normal:'普通',qr:'二维码',location:'位置'};return m[t]||t}
  function isOk(r){return /成功|✅|已签到/.test(String(r==null?'':r))}
  function apiFetch(url, options){
    options=options||{}
    options.headers=Object.assign({},options.headers||{},{Authorization:'Bearer '+API_TOKEN})
    return fetch(url,options)
  }

  /* ===== 视图切换 ===== */
  function show(v){
    if(VIEWS.indexOf(v)<0)v='overview'
    document.querySelectorAll('.view').forEach(function(el){el.classList.toggle('active',el.dataset.view===v)})
    document.querySelectorAll('.nav-item').forEach(function(el){el.classList.toggle('active',el.dataset.view===v);el.setAttribute('aria-current',el.dataset.view===v?'page':'false')})
    var pt=$('pageTitle');if(pt)pt.textContent=TITLES[v]
    var ps=$('pageSub');if(ps)ps.textContent=SUBS[v]||''
    if(v==='logs')loadLogs()
    if(v==='schedule')loadSchedule()
  }
  var navEl=$('nav')
  if(navEl)navEl.addEventListener('click',function(e){
    var btn=e.target.closest('.nav-item');if(!btn)return
    show(btn.dataset.view)
    if(history.replaceState)history.replaceState(null,'','#'+btn.dataset.view)
  })
  if(location.hash&&VIEWS.indexOf(location.hash.slice(1))>=0)show(location.hash.slice(1))
  window.addEventListener('hashchange',function(){var v=location.hash.slice(1);if(VIEWS.indexOf(v)>=0)show(v)})

  /* ===== 主题系统（模块 11） ===== */
  function applyTheme(pref){
    var dark = pref==='dark' || (pref==='auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.setAttribute('data-theme', dark?'dark':'light')
  }
  function initTheme(){
    var saved='auto'
    try{saved=localStorage.getItem('theme_preference')||'auto'}catch(e){}
    applyTheme(saved)
    try{window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',function(){if((localStorage.getItem('theme_preference')||'auto')==='auto')applyTheme('auto')})}catch(e){}
  }
  initTheme()

  /* ===== 免责声明 ===== */
  function ensureDisclaimer(){
    var box=$('disclaimerModal');if(!box)return
    apiFetch('/api/disclaimer').then(function(r){return r.json()}).then(function(d){if(!d.accepted)box.classList.add('show')}).catch(function(){box.classList.add('show')})
  }
  function closeDisclaimer(){var box=$('disclaimerModal');if(box)box.classList.remove('show')}
  var disAgree=$('disclaimerAgree')
  if(disAgree)disAgree.addEventListener('click',function(){
    disAgree.disabled=true
    apiFetch('/api/disclaimer/accept',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).catch(function(){}).then(function(){disAgree.disabled=false;closeDisclaimer()})
  })
  var disRefuse=$('disclaimerRefuse')
  if(disRefuse)disRefuse.addEventListener('click',function(){
    closeDisclaimer()
    if(window.appCtl&&window.appCtl.quit){window.appCtl.quit()}else{window.close()}
  })
  var disView=$('disclaimerView')
  if(disView)disView.addEventListener('click',function(){var box=$('disclaimerModal');if(box)box.classList.add('show')})
  ensureDisclaimer()

  /* ===== 轻提示与应用内对话框 ===== */
  function toast(msg,kind){
    var wrap=$('toastWrap');if(!wrap)return
    var t=document.createElement('div')
    t.className='toast'+(kind==='ok'?' toast-ok':kind==='err'?' toast-err':'')
    t.textContent=msg
    wrap.appendChild(t)
    setTimeout(function(){t.style.transition='opacity .25s ease';t.style.opacity='0';setTimeout(function(){if(t.parentNode)t.parentNode.removeChild(t)},280)},kind==='err'?4200:2600)
  }
  function askDialog(o){
    return new Promise(function(resolve){
      var mask=$('dialogMask');if(!mask){resolve(null);return}
      var title=$('dlgTitle'),text=$('dlgText'),input=$('dlgInput'),ok=$('dlgOk'),cancel=$('dlgCancel'),close=$('dlgClose')
      title.textContent=o.title||'请确认'
      text.textContent=o.text||''
      text.style.display=o.text?'':'none'
      var wantInput=!!o.input
      input.style.display=wantInput?'':'none'
      if(wantInput){input.value=o.value||'';input.placeholder=o.placeholder||''}
      ok.textContent=o.okText||'确定'
      ok.className='btn '+(o.danger?'btn-danger':'btn-primary')
      cancel.style.display=o.cancel===false?'none':''
      mask.classList.add('show')
      function done(v){mask.classList.remove('show');mask.onkeydown=ok.onclick=cancel.onclick=close.onclick=mask.onclick=null;resolve(v)}
      ok.onclick=function(){done(wantInput?input.value:true)}
      cancel.onclick=function(){done(null)}
      close.onclick=function(){done(null)}
      mask.onclick=function(e){if(e.target===mask)done(null)}
      mask.onkeydown=function(e){if(wantInput&&e.key==='Enter'){e.preventDefault();done(input.value)}}
      setTimeout(function(){if(wantInput){input.focus();input.select()}else{ok.focus()}},60)
    })
  }
  function askConfirm(o){return askDialog(o).then(function(v){return v===true})}

  /* ===== 软件更新 ===== */
  var updBox=$('updBox'),updRing=$('updRing'),updPct=$('updPct'),updTitle=$('updTitle'),updSub=$('updSub')
  var updHover=$('updHover'),updHoverTitle=$('updHoverTitle'),updHoverMeta=$('updHoverMeta'),updHoverBody=$('updHoverBody')
  var chipUpdate=$('chipUpdate'),updateModal=$('updateModal'),updateBody=$('updateBody'),updateGo=$('updateGo'),updateLater=$('updateLater')
  var updateBar=$('updateBar'),updateBarFill=$('updateBarFill'),updateBarText=$('updateBarText')
  var RING_LEN=113.1
  var upd={phase:'idle',current:'',latest:'',notes:'',source:'',pct:0,speedBps:0,transferred:0,total:0,message:'',lastResult:null}
  var updInstallIntent=false
  function fmtSize(b){if(!b||b<0)return '';if(b<1048576)return Math.round(b/1024)+'KB';return (b/1048576).toFixed(b<10485760?1:0)+'MB'}
  function hasNewVersion(s){return s.phase==='available'||s.phase==='downloading'||s.phase==='ready'}
  function updSubText(s){
    if(s.phase==='downloading'){var parts=[(s.pct||0)+'%'];if(s.speedBps)parts.push((s.speedBps/1048576).toFixed(1)+'MB/s');return parts.join(' · ')}
    if(s.phase==='ready')return '已下载完成，点击更新'
    if(s.phase==='available')return '准备下载…'
    if(s.phase==='error')return s.message||'更新失败，可重试'
    return '正在检查…'
  }
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
    var head=s.phase==='ready'?'<div style="font-size:var(--text-sm);font-weight:600;margin-bottom:8px">更新包已就绪</div>'
      :s.phase==='error'?'<div style="font-size:var(--text-sm);font-weight:600;margin-bottom:8px;color:var(--status-err-ink)">更新失败</div>'
      :'<div style="font-size:var(--text-sm);font-weight:600;margin-bottom:8px">发现新版本 <b>v'+esc(s.latest||'')+'</b>（当前 v'+esc(s.current||'')+'）</div>'
    var hint=s.phase==='ready'?'<div style="color:var(--ink-tertiary);font-size:var(--text-xs);margin-bottom:8px">点击「重启并更新」，软件会自动完成安装并重新打开，无需重走安装向导。</div>'
      :s.phase==='downloading'?'<div style="color:var(--ink-tertiary);font-size:var(--text-xs);margin-bottom:8px">正在后台下载（自动差分，只下载变化的块），可以关掉这个窗口，下载不会中断。</div>':''
    var msg=s.message?'<div style="color:'+(s.phase==='error'?'var(--status-err-ink)':'var(--ink-tertiary)')+';font-size:var(--text-xs);margin-bottom:8px">'+esc(s.message)+'</div>':''
    var notes='<div style="max-height:220px;overflow-y:auto;white-space:pre-wrap;background:var(--bg-surface-sub);border:1px solid var(--line-dim);border-radius:var(--r-sm);padding:10px 12px;font-size:var(--text-xs);color:var(--ink-secondary)">'+esc((s.notes||'').trim()||'暂无更新说明')+'</div>'
    var srcLine=s.source?'<div style="font-size:var(--text-xs);color:var(--ink-tertiary);margin-top:8px">下载源：'+esc(s.source)+'</div>':''
    return '<div style="padding:4px 0">'+head+msg+hint+notes+srcLine+'</div>'
  }
  function renderUpdateModal(s){
    if(!updateModal||!updateModal.classList.contains('show'))return
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
    var showBox=hasNewVersion(s)||s.phase==='error'
    if(chipUpdate){
      chipUpdate.style.display=hasNewVersion(s)?'':'none'
      if(hasNewVersion(s))chipUpdate.textContent=(s.phase==='ready'?'更新已就绪 v':'有新版本 v')+(s.latest||'')
    }
    if(updBox){
      updBox.style.display=showBox?'flex':'none'
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
    if(s.phase==='ready'&&updInstallIntent){updInstallIntent=false;doInstallNow()}
  }
  function showUpdHover(){
    if(!updHover||!updBox||window.matchMedia('(pointer: coarse)').matches)return
    if(!hasNewVersion(upd))return
    updHover.classList.add('show')
    var r=updBox.getBoundingClientRect(),w=updHover.offsetWidth,h=updHover.offsetHeight
    var left=Math.max(8,Math.min(r.right-w,window.innerWidth-w-8))
    var top=r.top-h-10
    if(top<8)top=Math.min(r.bottom+10,window.innerHeight-h-8)
    updHover.style.left=left+'px';updHover.style.top=top+'px'
  }
  function hideUpdHover(){if(updHover)updHover.classList.remove('show')}
  function doInstallNow(){
    if(!window.updateCtl)return
    toast('正在重启并安装更新…','ok')
    window.updateCtl.install().then(function(r){if(!r||!r.ok)toast('安装启动失败：'+((r&&r.message)||'未知错误'),'err')}).catch(function(){toast('安装启动失败，请稍后重试','err')})
  }
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
    askConfirm({title:upd.phase==='ready'?'安装更新并重启':'更新并重启',text:head,okText:upd.phase==='ready'?'安装并重启':'下载并重启'}).then(function(yes){
      if(!yes)return
      if(upd.phase==='ready'){doInstallNow();return}
      updInstallIntent=true
      openUpdateModal()
      window.updateCtl.download().then(function(r){if(r&&!r.ok){updInstallIntent=false;toast(r.message||'下载失败，请稍后重试','err')}}).catch(function(){updInstallIntent=false;toast('下载失败，请稍后重试','err')})
    })
  }
  function openUpdateModal(){if(!updateModal)return;updateModal.classList.add('show');renderUpdateModal(upd)}
  function refreshUpdState(){if(window.updateCtl&&window.updateCtl.getState){window.updateCtl.getState().then(renderUpd).catch(function(){})}}
  if(updBox){
    updBox.addEventListener('click',function(){showUpdateConfirm()})
    updBox.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();updBox.click()}})
    updBox.addEventListener('mouseenter',showUpdHover)
    updBox.addEventListener('mouseleave',hideUpdHover)
    updBox.addEventListener('focus',showUpdHover)
    updBox.addEventListener('blur',hideUpdHover)
  }
  if(chipUpdate)chipUpdate.addEventListener('click',function(){showUpdateConfirm()})
  if(updateGo)updateGo.addEventListener('click',function(){var a=updateActionFor(upd);if(!a||a.disabled)return;showUpdateConfirm()})
  if(updateLater)updateLater.addEventListener('click',function(){if(updateModal)updateModal.classList.remove('show');hideUpdHover()})
  var updateClose=$('updateClose')
  if(updateClose)updateClose.addEventListener('click',function(){if(updateModal)updateModal.classList.remove('show');hideUpdHover()})
  var updateCheckBtn=$('updateCheckBtn')
  if(updateCheckBtn)updateCheckBtn.addEventListener('click',function(){
    if(!window.updateCtl){toast('自动更新只在安装版里可用（浏览器打开时无效）','err');return}
    openUpdateModal()
    renderUpd({phase:'checking',current:upd.current,latest:upd.latest,notes:upd.notes,source:upd.source})
    window.updateCtl.check().then(function(){refreshUpdState()}).catch(function(){toast('检查更新失败，请检查网络后重试','err');refreshUpdState()})
  })
  if(window.updateCtl&&window.updateCtl.onState)window.updateCtl.onState(function(s){renderUpd(s)})
  refreshUpdState()
  setInterval(refreshUpdState,20000)
  setTimeout(function(){
    var lr=upd.lastResult
    if(!lr)return
    if(lr.ok)toast('已更新到 v'+lr.now,'ok')
    else toast('上次更新未生效（仍是 v'+lr.now+'，目标 v'+lr.to+'），可以再更新一次','err')
  },500)

  /* ===== 趋势图（客户端重绘，与服务端 renderTrendSvg 保持一致） ===== */
  function trendHtml(trend){
    var days=(trend||[]).slice(-14)
    var head='<div class="trend-header"><div><h3 class="trend-title">近 14 天签到走势</h3><p class="trend-sub">绿色代表自动成功，红色代表需人工介入或失败</p></div><div class="trend-legend"><span><i class="legend-dot ok"></i>成功</span><span><i class="legend-dot err"></i>异常/失败</span></div></div>'
    var hasData=days.some(function(d){return (d.success||0)+(d.fail||0)>0})
    if(!hasData)return '<div class="trend-card">'+head+'<div class="cell-empty" style="padding:26px 0">暂无签到数据，产生签到记录后自动生成趋势图</div></div>'
    var W=640,H=150,PL=32,PB=24,PT=16,PR=16
    var iw=W-PL-PR,ih=H-PT-PB
    var max=5
    days.forEach(function(d){var tot=(d.success||0)+(d.fail||0);if(tot>max)max=tot})
    var n=Math.max(1,days.length),step=iw/n
    var gy1=PT+ih*0.5,gy0=PT+ih
    var bars='',labels=''
    days.forEach(function(d,i){
      var x=PL+i*step+step*0.15
      var colW=Math.max(4,step*0.7)
      var total=(d.success||0)+(d.fail||0)
      var totalH=(total/max)*ih
      var succH=total>0?((d.success||0)/max)*ih:0
      var failH=totalH-succH
      var ySucc=gy0-succH
      var yFail=ySucc-failH
      if(succH>0)bars+='<rect x="'+x.toFixed(1)+'" y="'+ySucc.toFixed(1)+'" width="'+colW.toFixed(1)+'" height="'+succH.toFixed(1)+'" rx="1.5" style="fill:var(--status-ok-dot)"/>'
      if(failH>0)bars+='<rect x="'+x.toFixed(1)+'" y="'+yFail.toFixed(1)+'" width="'+colW.toFixed(1)+'" height="'+failH.toFixed(1)+'" rx="1.5" style="fill:var(--status-err-dot)"/>'
      var dl=(d.date||'').slice(5)||String(i+1)
      if(i%2===0||i===days.length-1)labels+='<text x="'+(x+colW/2).toFixed(1)+'" y="'+(H-6)+'" font-size="10" style="fill:var(--ink-tertiary)" font-family="var(--font-mono)" text-anchor="middle">'+esc(dl)+'</text>'
    })
    return '<div class="trend-card">'+head+'<div class="svg-container"><svg viewBox="0 0 '+W+' '+H+'" class="trend-svg" role="img" aria-label="近 14 天签到走势柱状图">'
      +'<line x1="'+PL+'" y1="'+gy1+'" x2="'+(W-PR)+'" y2="'+gy1+'" stroke="var(--line-dim)" stroke-dasharray="3 3"/>'
      +'<line x1="'+PL+'" y1="'+gy0+'" x2="'+(W-PR)+'" y2="'+gy0+'" stroke="var(--line-strong)"/>'
      +'<text x="'+(PL-6)+'" y="'+(gy1+3)+'" font-size="9" font-family="var(--font-mono)" style="fill:var(--ink-tertiary)" text-anchor="end">'+Math.round(max/2)+'</text>'
      +'<text x="'+(PL-6)+'" y="'+(PT+6)+'" font-size="9" font-family="var(--font-mono)" style="fill:var(--ink-tertiary)" text-anchor="end">'+max+'</text>'
      +bars+labels+'</svg></div></div>'
  }
  function courseRowHtml(c,s){
    var cid=String(c.courseId)
    var ws=(s.watchCourses||[]).map(String),wset={};ws.forEach(function(id){wset[id]=true})
    var dis={};(s.disabledCourses||[]).map(String).forEach(function(id){dis[id]=true})
    var allOn=ws.length===0
    var watching=watchLocal[cid]!==undefined?watchLocal[cid]:(!dis[cid]&&(allOn||wset[cid]))
    var fails=(s.courseHealth||{})[cid]||0
    var runtimeReady=(s.accounts||[]).length>0&&s.cookieValid!==false&&s.listening!==false
    var pill
    if(!watching)pill='<span class="status-pill is-idle"><span class="pill-dot"></span><span class="pill-text">已手动暂停</span></span>'
    else if(!runtimeReady)pill='<span class="status-pill is-warn"><span class="pill-dot"></span><span class="pill-text">'+(!(s.accounts||[]).length?'未配置账号':s.cookieValid===false?'登录需核验':'已暂停监听')+'</span></span>'
    else if(fails>=3)pill='<span class="status-pill is-err" title="近期轮询多次失败，多为瞬时网络或网关限流，已自动重试"><span class="pill-dot"></span><span class="pill-text">扫描异常 ('+fails+')</span></span>'
    else pill='<span class="status-pill is-ok"><span class="pill-dot"></span><span class="pill-text">监控中</span></span>'
    var w=(s.signinWindows||{})[cid]
    var wc=w?(w.known?'<span class="window-pill"><span>'+esc(w.text)+'</span></span>':'<span class="window-pill is-soft"><span>'+esc(w.text)+'</span></span>'):'<span class="cell-sub">—</span>'
    return '<tr class="course-row" data-course-id="'+esc(cid)+'">'
      +'<td class="col-course-main"><div class="course-name-line"><span class="course-title">'+esc(c.courseName)+'</span></div>'
      +'<div class="course-sub-line"><button type="button" class="mono-meta" data-copy="'+esc(cid)+'" title="点击复制 CourseID">CID: '+esc(cid)+'</button>'
      +'<button type="button" class="mono-meta" data-copy="'+esc(String(c.classId))+'" title="点击复制 ClassID">班级: '+esc(String(c.classId))+'</button></div></td>'
      +'<td class="col-course-window" data-label="签到时段">'+wc+'</td>'
      +'<td class="col-course-status" data-label="状态">'+pill+'</td>'
      +'<td class="col-course-actions" data-label="监听"><label class="switch-control" title="切换此课程监听状态"><input type="checkbox" '+(watching?'checked':'')+' data-cid="'+esc(cid)+'" aria-label="切换课程监听"><span class="switch-track"></span></label>'
      +'<button type="button" class="btn-subtle-icon" data-detail="'+esc(c.courseName)+'" title="查看历史记录与备注" aria-label="查看课程详情">'+MORE_ICON+'</button></td></tr>'
  }
  var MORE_ICON='<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/></svg>'

  /* ===== 主渲染 ===== */
  var lastServiceStatus=null,pollInFlight=null,serviceOnline=true
  var lastTrendJson=''
  var watchLocal={}
  function render(s){
    lastServiceStatus=s
    serviceConnection(true)
    var accs=s.accounts||[]
    var cs=s.courses||[]
    var ok=s.successCount||0, fail=s.failCount||0, tot=ok+fail
    var rate=tot>0?((ok/tot*100).toFixed(1)+'%'):'—'
    var today=s.todayStats||{total:0,success:0,fail:0}
    var sc=document.getElementById('stat-courses');if(sc)sc.textContent=cs.length
    var sr=document.getElementById('stat-records');if(sr)sr.textContent=s.recordCount||0
    var so=document.getElementById('stat-ok');if(so)so.textContent=ok
    var sf=document.getElementById('stat-fail');if(sf)sf.textContent=fail
    // 状态芯片
    var chipCookie=$('chipCookie')
    if(chipCookie){
      var hasAcc=accs.length>0, cOk=s.cookieValid===true
      chipCookie.textContent=!hasAcc?'未配置账号':cOk?'账号已连接':s.cookieValid===false?'登录失效':'待核验'
      chipCookie.className='status-chip '+(!hasAcc?'':cOk?'ok':s.cookieValid===false?'err':'warn')
    }
    var chipIm=$('chipIm')
    if(chipIm){chipIm.textContent=s.imConnected?'IM 实时':'轮询扫描';chipIm.className='status-chip '+(s.imConnected?'ok':'subtle')}
    var chipDing=$('chipDing')
    if(chipDing){
      if(s.dingtalkStreamConnected){chipDing.textContent='钉钉通道';chipDing.className='status-chip ok';chipDing.style.display=''}
      else if(s.dingtalkStreamEnabled){chipDing.textContent=s.dingtalkStreamConfigured?'钉钉连接中':'钉钉缺凭据';chipDing.className='status-chip warn';chipDing.style.display=''}
      else{chipDing.style.display='none'}
    }
    var chipQr=$('chipQr')
    if(chipQr)chipQr.style.display=s.qrPending?'':'none'
    // 侧栏心跳
    var fd=$('footDot')
    if(fd)fd.className='hb-indicator '+(accs.length===0||s.cookieValid===false?'is-warn':s.listening===false?'is-idle':'is-running')
    var fs=$('footState')
    if(fs)fs.textContent=accs.length===0?'未配置账号':s.cookieValid===false?'登录异常':s.listening===false?'已暂停监听':'后台监听运转中'
    var fa=$('footAccounts');if(fa)fa.textContent=accs.length+' 账号'
    var fp=$('footPort');if(fp)fp.textContent=':'+(s.port||3456)
    var hc=$('hbCountdown');if(hc)hc.textContent=Math.round((s.pollInterval||30000)/1000)+'s'
    // 监听按钮
    var lt=$('listenToggleBtn')
    if(lt&&lt.dataset.busy!=='true'){
      var on=s.listening!==false
      lt.dataset.listening=String(on)
      lt.setAttribute('aria-pressed',String(on))
      lt.textContent=on?'⏸ 停止监听':'▶ 开启监听'
      lt.className='btn '+(on?'btn-secondary':'btn-primary')
      var ls=$('listenState')
      if(ls&&!on)ls.textContent='已暂停监听；手动上传二维码仍可用。'
    }
    // 最近活动
    var rows=(s.recent||[]).map(function(r){
      return '<tr class="history-row" data-ok="'+(isOk(r.result)?'1':'0')+'" data-type="'+esc(String(r.type||''))+'"><td class="cell-sub" data-label="时间">'+esc(fmtTime(r.timestamp))+'</td><td class="cell-main" data-label="课程">'+esc(r.courseName||'未知课程')+'</td><td class="cell-sub" data-label="类型">'+esc(typeText(r.type))+'</td><td class="cell-sub" data-label="结果">'+(isOk(r.result)?'<span class="status-pill is-ok"><span class="pill-dot"></span><span class="pill-text">成功</span></span>':'<span class="status-pill is-err"><span class="pill-dot"></span><span class="pill-text">失败</span></span>')+'</td></tr>'
    }).join('')||'<tr><td colspan="4" class="cell-empty">还没有签到记录</td></tr>'
    if($('recentBody'))$('recentBody').innerHTML=rows
    if($('historyBody'))$('historyBody').innerHTML=rows
    applyHistoryFilter()
    var hc2=$('historyCount');if(hc2)hc2.textContent='共 '+(s.recordCount||0)+' 条'
    // 账号区
    var ab=$('accountsBox')
    if(ab){
      ab.innerHTML=accs.length?accs.map(function(a,i){
        var nm=a.name||a.username||'?'
        return '<div class="acct-row"><span class="acct-avatar">'+esc(nm.slice(0,1))+'</span><div class="acct-info"><div class="acct-name">'+esc(nm)+(i===0?' <span class="status-pill is-ok"><span class="pill-dot"></span><span class="pill-text">主账号</span></span>':'')+'</div><div class="acct-sub">'+esc(a.schoolname||'')+' · '+esc(String(a.username))+'</div></div></div>'
      }).join(''):'<div class="empty"><p>未配置账号</p><p class="empty-sub">首次使用请在"设置"页填写你的学习通账号</p><a class="btn btn-secondary" href="#settings">去配置账号</a></div>'
    }
    var asb=$('acctStatsBox')
    if(asb){
      var asts=s.accountStats||[]
      asb.innerHTML=asts.length?asts.map(function(a){
        var t2=(a.success||0)+(a.fail||0)
        var rt=t2>0?Math.round((a.success||0)/t2*100):0
        var lt2=a.lastTime?new Date(a.lastTime):null
        var ltStr=lt2?(lt2.getMonth()+1)+'/'+lt2.getDate()+' '+String(lt2.getHours()).padStart(2,'0')+':'+String(lt2.getMinutes()).padStart(2,'0'):'从未'
        return '<div class="acct-stat-card"><div class="acct-stat-name">'+esc(a.name||a.username||'?')+'</div><div class="acct-stat-meta">最近签到: '+ltStr+'</div><div class="acct-stat-nums"><span style="color:var(--status-ok-ink);font-weight:600">成功 '+(a.success||0)+'</span><span style="color:var(--status-err-ink);font-weight:600">失败 '+(a.fail||0)+'</span><span style="color:var(--ink-tertiary)">成功率 '+rt+'%</span></div></div>'
      }).join(''):'<div class="cell-empty" style="padding:16px 0">暂无签到记录</div>'
    }
    // 课程表
    var cb=$('coursesBody')
    if(cb)cb.innerHTML=cs.length?cs.map(function(c){return courseRowHtml(c,s)}).join(''):'<tr><td colspan="4" class="cell-empty">暂无课程数据</td></tr>'
    var cc=$('courseCount');if(cc)cc.textContent=cs.length+' 门 · 轮询发现签到活动'
    var csb=$('courseStatsBody')
    if(csb){
      var stats=s.courseStats||[]
      csb.innerHTML=stats.length?stats.map(function(st){
        var t3=st.success+st.fail, rt=Math.round(st.success/(t3||1)*100)
        return '<tr><td class="cell-main" data-label="课程">'+esc(st.course)+'</td><td class="cell-sub" data-label="签到成功" style="color:var(--status-ok-ink)">'+st.success+'</td><td class="cell-sub" data-label="签到失败" style="color:'+(st.fail?'var(--status-err-ink)':'var(--ink-tertiary)')+'">'+st.fail+'</td><td class="cell-sub" data-label="成功率" style="font-weight:600">'+rt+'%</td></tr>'
      }).join(''):'<tr><td colspan="4" class="cell-empty">暂无统计数据（产生签到记录后显示）</td></tr>'
    }
    // 趋势图
    var tj=JSON.stringify(s.trend||[])
    if(tj!==lastTrendJson){lastTrendJson=tj;var tr=$('trendChart');if(tr)tr.innerHTML=trendHtml(s.trend||[])}
  }

  /* ===== 历史筛选（模块 5） ===== */
  var historyFilter='all'
  function applyHistoryFilter(){
    var body=$('historyBody');if(!body)return
    var rows=body.querySelectorAll('tr.history-row')
    rows.forEach(function(tr){
      var ok=tr.getAttribute('data-ok')==='1'
      var type=tr.getAttribute('data-type')||''
      var vis=historyFilter==='all'?true:historyFilter==='success'?ok:historyFilter==='fail'?!ok:historyFilter==='qr'?(type==='qr'):true
      tr.style.display=vis?'':'none'
    })
  }
  document.querySelectorAll('.filter-pill').forEach(function(btn){
    btn.addEventListener('click',function(){
      document.querySelectorAll('.filter-pill').forEach(function(b){b.classList.remove('active')})
      btn.classList.add('active')
      historyFilter=btn.getAttribute('data-filter')||'all'
      applyHistoryFilter()
    })
  })

  /* ===== 服务连接通告 ===== */
  function serviceConnection(online,message){
    serviceOnline=online
    var box=$('serviceNotice'),title='',detail=''
    var accs=(lastServiceStatus&&lastServiceStatus.accounts)||[]
    if(!online){title='无法连接本地服务';detail='当前展示上次读取的状态，不能确认监听仍在运行。请检查服务后重新连接。'+(message||'')}
    else if(lastServiceStatus&&!accs.length){title='尚未配置学习通账号';detail='先在设置中配置你有权使用的账号，再开启课程监听。'}
    else if(lastServiceStatus&&lastServiceStatus.cookieValid===false){title='登录状态已过期';detail='课程和记录已保留；请在设置中重新登录，必要时在官方 App 完成人工验证。'}
    if(!box)return
    box.hidden=!title
    box.dataset.kind=online?'account':'offline'
    $('serviceNoticeTitle').textContent=title
    $('serviceNoticeText').textContent=detail
    $('serviceRetry').hidden=online
    $('serviceSettings').hidden=!online
    var ann=$('serviceAnnouncement');if(ann.textContent!==title)ann.textContent=title
    var canListen=accs.length>0&&lastServiceStatus&&lastServiceStatus.cookieValid!==false
    ;['listenToggleBtn','scanNowBtn'].forEach(function(id){var b=$(id);if(!b)return;var canStop=id==='listenToggleBtn'&&lastServiceStatus&&lastServiceStatus.listening!==false;b.disabled=!online||b.dataset.busy==='true'||(!canListen&&!canStop)})
    if(!online){var foot=$('footState');if(foot)foot.textContent='服务连接中断'}
  }
  function poll(){
    if(pollInFlight)return pollInFlight
    pollInFlight=apiFetch('/api/status').then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(render).catch(function(e){serviceConnection(false,String(e.message))}).finally(function(){pollInFlight=null})
    return pollInFlight
  }
  var serviceRetry=$('serviceRetry')
  if(serviceRetry)serviceRetry.addEventListener('click',function(){poll()})

  /* ===== 二维码图片拖拽签到 ===== */
  var dragMask=$('dragMask')
  var qrModal=$('qrModal'),qrStatus=$('qrStatus')
  function showToast2(msg){
    var t=$('dragToast')
    if(!t){
      t=document.createElement('div');t.id='dragToast'
      t.style.cssText='position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:var(--ink-primary);color:var(--bg-surface);padding:10px 18px;border-radius:var(--r-sm);font-size:var(--text-sm);z-index:1400;box-shadow:var(--shadow-lg);max-width:70vw'
      document.body.appendChild(t)
    }
    t.textContent=msg;t.style.display='block'
    clearTimeout(showToast2._t);showToast2._t=setTimeout(function(){t.style.display='none'},5000)
  }
  window.addEventListener('dragover',function(e){e.preventDefault();if(qrModal&&qrModal.classList.contains('show'))return;if(dragMask&&!dragMask.classList.contains('show'))dragMask.classList.add('show')},{capture:true})
  window.addEventListener('dragleave',function(e){if(dragMask&&e.target===document.documentElement)dragMask.classList.remove('show')},{capture:true})
  window.addEventListener('drop',function(e){
    e.preventDefault()
    if(qrModal&&qrModal.classList.contains('show'))return
    if(dragMask)dragMask.classList.remove('show')
    var f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0]
    if(!f)return
    if(f.type.indexOf('image/')!==0){showToast2('请拖入二维码图片文件');return}
    showToast2('二维码图片已接收，正在识别签到…')
    apiFetch('/upload/image?type=qr',{method:'POST',body:f,headers:{'Content-Type':f.type}}).then(function(r){return r.json()}).then(function(d){
      if(d.success){showToast2('✅ '+d.message);setTimeout(function(){location.reload()},1500)}
      else{showToast2('❌ '+(d.error||'处理失败'))}
    }).catch(function(err){showToast2('❌ 上传失败: '+err.message)})
  })

  /* ===== 添加账号 ===== */
  var saveBtn=$('cfgSaveBtn')
  if(saveBtn)saveBtn.addEventListener('click',function(){
    var u=$('cfgUsername').value.trim(),p=$('cfgPassword').value,msg=$('accountMsg')
    if(!u||!p){msg.textContent='账号和密码不能为空';msg.style.color='var(--status-err-ink)';return}
    saveBtn.disabled=true;saveBtn.textContent='保存中…'
    apiFetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})}).then(function(r){return r.json()}).then(function(d){
      msg.textContent=(d.ok?'✅ ':'❌ ')+(d.message||(d.ok?'已保存':'保存失败'))
      msg.style.color=d.ok?'var(--status-ok-ink)':'var(--status-err-ink)'
      saveBtn.disabled=false;saveBtn.textContent='添加账号'
      if(d.ok)setTimeout(function(){location.reload()},1500)
    }).catch(function(){msg.textContent='❌ 保存失败，请重试';msg.style.color='var(--status-err-ink)';saveBtn.disabled=false;saveBtn.textContent='添加账号'})
  })

  /* ===== 自绘标题栏窗口控制 ===== */
  var wc=window.winCtl
  if(wc){
    var btnMin=$('btnMin'),btnMax=$('btnMax'),btnClose=$('btnClose')
    var icoMax='<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1"><rect x="2.5" y="2.5" width="7" height="7"/></svg>'
    var icoRestore='<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1"><path d="M4.5 4.5V2.5h5v5h-2"/><rect x="2.5" y="4.5" width="5" height="5"/></svg>'
    if(btnMin)btnMin.addEventListener('click',function(){wc.minimize()})
    if(btnMax)btnMax.addEventListener('click',function(){wc.maximizeToggle()})
    if(btnClose)btnClose.addEventListener('click',function(){wc.close()})
    function syncMax(){wc.isMaximized().then(function(m){if(btnMax){btnMax.innerHTML=m?icoRestore:icoMax;btnMax.title=m?'还原':'最大化'}}).catch(function(){})}
    window.addEventListener('resize',syncMax);syncMax()
  } else {
    var tb=document.querySelector('.app-titlebar');if(tb)tb.style.display='none'
  }

  /* ===== 课程监听开关（乐观更新，模块 3） ===== */
  var coursesBody=$('coursesBody')
  if(coursesBody){
    coursesBody.addEventListener('change',function(e){
      var input=e.target.closest('input[type="checkbox"][data-cid]');if(!input)return
      var cid=input.getAttribute('data-cid')
      var next=input.checked
      watchLocal[cid]=next
      var msg=$('watchMsg')
      apiFetch('/api/courses/toggle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({courseId:cid,on:next})}).then(function(r){return r.json()}).then(function(d){
        if(!d.ok){input.checked=!next;watchLocal[cid]=!next;toast(d.message||'切换失败','err');return}
        toast(next?'已启用该课程监听':'已暂停该课程监听','ok')
        if(lastServiceStatus){lastServiceStatus.listeningCount=d.listeningCount;render(lastServiceStatus)}
      }).catch(function(){input.checked=!next;watchLocal[cid]=!next;toast('网络异常，已回退','err')})
    })
    coursesBody.addEventListener('click',function(e){
      var copy=e.target.closest('[data-copy]')
      if(copy){copyText(copy.getAttribute('data-copy'));return}
      var det=e.target.closest('[data-detail]')
      if(det){showCourseDetail(det.getAttribute('data-detail'));return}
    })
  }
  function copyText(txt){
    function done(ok){toast(ok?'已复制：'+txt:'复制失败',ok?'ok':'err')}
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(txt).then(function(){done(true)},function(){done(false)})}
    else{try{var ta=document.createElement('textarea');ta.value=txt;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);done(true)}catch(e){done(false)}}
  }
  var watchSaveBtn=$('watchSaveBtn')
  if(watchSaveBtn)watchSaveBtn.addEventListener('click',function(){
    var rows=document.querySelectorAll('#coursesBody input[type="checkbox"][data-cid]')
    var onList=[],allOn=true
    rows.forEach(function(inp){var cid=inp.getAttribute('data-cid');if(inp.checked)onList.push(cid);else allOn=false})
    var msg=$('watchMsg')
    if(!allOn&&onList.length===0){msg.textContent='⚠️ 至少要保留一门监听的课程';msg.style.color='var(--status-warn-ink)';return}
    watchSaveBtn.disabled=true;watchSaveBtn.textContent='保存中…'
    apiFetch('/api/watch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({watchCourses:allOn?[]:onList})}).then(function(r){return r.json()}).then(function(d){
      msg.textContent=(d.ok?'✅ ':'❌ ')+(d.message||'保存失败')
      msg.style.color=d.ok?'var(--status-ok-ink)':'var(--status-err-ink)'
      watchSaveBtn.disabled=false;watchSaveBtn.textContent='保存并立即生效'
      if(d.ok){watchLocal={};var st=$('listenState');if(st&&d.listeningCount!==undefined)st.textContent='正在监听 '+d.listeningCount+' 门课程';setTimeout(function(){location.reload()},1200)}
    }).catch(function(){msg.textContent='❌ 保存失败，请重试';msg.style.color='var(--status-err-ink)';watchSaveBtn.disabled=false;watchSaveBtn.textContent='保存并立即生效'})
  })

  /* ===== 立即扫描一次 ===== */
  var scanNowBtn=$('scanNowBtn')
  if(scanNowBtn)scanNowBtn.addEventListener('click',function(){
    var st=$('listenState')
    scanNowBtn.disabled=true;scanNowBtn.dataset.busy='true';scanNowBtn.setAttribute('aria-busy','true')
    var old=scanNowBtn.textContent
    scanNowBtn.textContent='⚡ 扫描中…'
    if(st)st.textContent='正在逐门课程查询签到活动，请稍候…'
    apiFetch('/api/scan-now',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(function(r){return r.json()}).then(function(d){
      scanNowBtn.dataset.busy='false';scanNowBtn.setAttribute('aria-busy','false');scanNowBtn.disabled=!serviceOnline;scanNowBtn.textContent=old
      if(st){st.textContent=(d.ok?'✅ ':'❌ ')+(d.message||'扫描完成');st.style.color=d.ok?'var(--status-ok-ink)':'var(--status-err-ink)'}
      if(d.ok&&d.found>0)poll()
    }).catch(function(){scanNowBtn.dataset.busy='false';scanNowBtn.setAttribute('aria-busy','false');scanNowBtn.disabled=!serviceOnline;scanNowBtn.textContent=old;if(st){st.textContent='❌ 扫描失败，请重试';st.style.color='var(--status-err-ink)'}})
  })

  /* ===== 监听总开关 ===== */
  var listenToggleBtn=$('listenToggleBtn')
  if(listenToggleBtn)listenToggleBtn.addEventListener('click',function(){
    var turningOff=listenToggleBtn.dataset.listening==='true'||listenToggleBtn.textContent.indexOf('停止')>=0
    var st=$('listenState')
    listenToggleBtn.disabled=true;listenToggleBtn.dataset.busy='true';listenToggleBtn.setAttribute('aria-busy','true')
    var prev=listenToggleBtn.textContent
    listenToggleBtn.textContent=turningOff?'正在停止监听…':'正在开启监听…'
    apiFetch('/api/listen',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({on:!turningOff})}).then(function(r){return r.json()}).then(function(d){
      listenToggleBtn.dataset.busy='false';listenToggleBtn.setAttribute('aria-busy','false');listenToggleBtn.disabled=!serviceOnline
      if(!d.ok){listenToggleBtn.textContent=prev;if(st)st.textContent='未能改变监听状态：'+(d.message||'请重试');return}
      listenToggleBtn.dataset.listening=String(d.listening);listenToggleBtn.setAttribute('aria-pressed',String(d.listening))
      if(lastServiceStatus)lastServiceStatus.listening=d.listening
      listenToggleBtn.textContent=d.listening?'⏸ 停止监听':'▶ 开启监听'
      listenToggleBtn.className='btn '+(d.listening?'btn-secondary':'btn-primary')
      if(st)st.textContent=d.listening?('正在监听 '+d.listeningCount+' 门课程'):'已停止监听（不会发送任何轮询请求，二维码上传仍可用）'
      serviceConnection(serviceOnline)
    }).catch(function(){listenToggleBtn.dataset.busy='false';listenToggleBtn.setAttribute('aria-busy','false');listenToggleBtn.disabled=!serviceOnline;listenToggleBtn.textContent=prev;if(st)st.textContent='无法确认监听状态，原显示已保留；请重新连接服务。';poll()})
  })

  /* ===== 全部恢复监听 ===== */
  var coursesResetBtn=$('coursesResetBtn')
  if(coursesResetBtn)coursesResetBtn.addEventListener('click',function(){
    var msg=$('watchMsg');coursesResetBtn.disabled=true
    apiFetch('/api/courses/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(function(r){return r.json()}).then(function(d){
      coursesResetBtn.disabled=false
      if(msg){msg.textContent=(d.ok?'✅ ':'❌ ')+(d.message||'');msg.style.color=d.ok?'var(--status-ok-ink)':'var(--status-err-ink)'}
      if(d.ok)setTimeout(function(){location.reload()},1200)
    }).catch(function(){coursesResetBtn.disabled=false;if(msg)msg.textContent='❌ 操作失败，请重试'})
  })

  /* ===== 账号管理（设为主账号 / 删除） ===== */
  var accountList=$('accountList')
  if(accountList)accountList.addEventListener('click',function(e){
    var pBtn=e.target.closest('[data-primary]'),dBtn=e.target.closest('[data-remove]')
    var msg=$('accountMsg')
    if(pBtn){
      var un=pBtn.getAttribute('data-primary');pBtn.disabled=true
      apiFetch('/api/accounts/primary',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:un})}).then(function(r){return r.json()}).then(function(d){
        msg.textContent=(d.ok?'✅ ':'❌ ')+(d.message||'操作失败');msg.style.color=d.ok?'var(--status-ok-ink)':'var(--status-err-ink)'
        if(d.ok)setTimeout(function(){location.reload()},1200)
      }).catch(function(){msg.textContent='❌ 操作失败';msg.style.color='var(--status-err-ink)';pBtn.disabled=false})
      return
    }
    if(dBtn){
      var un2=dBtn.getAttribute('data-remove')
      askConfirm({title:'删除账号',text:'确定删除账号 '+un2+' 吗？该账号保存在本地的加密密码会一并移除。',okText:'删除',danger:true}).then(function(yes){
        if(!yes)return
        dBtn.disabled=true
        apiFetch('/api/accounts/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:un2})}).then(function(r){return r.json()}).then(function(d){
          msg.textContent=(d.ok?'✅ ':'❌ ')+(d.message||'操作失败');msg.style.color=d.ok?'var(--status-ok-ink)':'var(--status-err-ink)'
          if(d.ok)setTimeout(function(){location.reload()},1200)
        }).catch(function(){msg.textContent='❌ 操作失败';msg.style.color='var(--status-err-ink)';dBtn.disabled=false})
      })
    }
  })

  /* ===== 清空历史 / 危险区 ===== */
  function doClearHistory(btn,msgId){
    askConfirm({title:'清空签到记录',text:'确定清空全部签到记录吗？此操作不可恢复。',okText:'清空',danger:true}).then(function(yes){
      if(!yes)return
      var msg=$(msgId);if(btn)btn.disabled=true
      apiFetch('/api/history/clear',{method:'POST'}).then(function(r){return r.json()}).then(function(d){
        if(msg){msg.textContent=(d.ok?'✅ ':'❌ ')+(d.message||'操作失败');msg.style.color=d.ok?'var(--status-ok-ink)':'var(--status-err-ink)'}
        if(d.ok)setTimeout(function(){location.reload()},800)
        else if(btn)btn.disabled=false
      }).catch(function(){if(msg){msg.textContent='❌ 清空失败';msg.style.color='var(--status-err-ink)'}if(btn)btn.disabled=false})
    })
  }
  var clearHistoryBtn=$('clearHistoryBtn')
  if(clearHistoryBtn)clearHistoryBtn.addEventListener('click',function(){doClearHistory(clearHistoryBtn,'historyMsg')})
  var dangerClearHistoryBtn=$('dangerClearHistoryBtn')
  if(dangerClearHistoryBtn)dangerClearHistoryBtn.addEventListener('click',function(){doClearHistory(dangerClearHistoryBtn,'cfgMsg')})
  var dangerResetCoursesBtn=$('dangerResetCoursesBtn')
  if(dangerResetCoursesBtn)dangerResetCoursesBtn.addEventListener('click',function(){
    askConfirm({title:'重置课程监听',text:'确定把所有课程恢复为默认监听吗？（等于清空逐课暂停记录）',okText:'重置',danger:true}).then(function(yes){
      if(!yes)return
      var msg=$('cfgMsg');dangerResetCoursesBtn.disabled=true
      apiFetch('/api/courses/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(function(r){return r.json()}).then(function(d){
        dangerResetCoursesBtn.disabled=false
        if(msg){msg.textContent=(d.ok?'✅ ':'❌ ')+(d.message||'');msg.style.color=d.ok?'var(--status-ok-ink)':'var(--status-err-ink)'}
        if(d.ok)setTimeout(function(){location.reload()},1200)
      }).catch(function(){dangerResetCoursesBtn.disabled=false;if(msg){msg.textContent='❌ 操作失败，请重试';msg.style.color='var(--status-err-ink)'}})
    })
  })

  /* ===== 钉钉图片通道设置 ===== */
  function dingLoad(){
    var keyEl=$('dingKeyInput'),enEl=$('dingEnabledInput'),hint=$('dingStateHint')
    if(!keyEl)return
    apiFetch('/api/dingtalk/settings').then(function(r){return r.json()}).then(function(d){
      if(!d.ok)return
      keyEl.value=d.appKey||''
      if(enEl)enEl.checked=!!d.enabled
      var sec=$('dingSecretInput')
      if(sec&&d.hasSecret)sec.placeholder='已保存（留空则不修改）'
      if(hint)hint.textContent=d.hasSecret?'已配置 AppSecret（出于安全不回显，留空即保持不变）':'尚未配置 AppSecret'
    }).catch(function(){})
  }
  dingLoad()
  var dingSaveBtn=$('dingSaveBtn')
  if(dingSaveBtn)dingSaveBtn.addEventListener('click',function(){
    var msg=$('dingMsg')
    var key=($('dingKeyInput')||{}).value||'',sec=($('dingSecretInput')||{}).value||'',en=!!($('dingEnabledInput')||{}).checked
    dingSaveBtn.disabled=true;dingSaveBtn.textContent='保存中…'
    apiFetch('/api/dingtalk/stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({appKey:key,appSecret:sec,enabled:en})}).then(function(r){return r.json()}).then(function(d){
      dingSaveBtn.disabled=false;dingSaveBtn.textContent='保存钉钉设置'
      if(msg){msg.textContent=(d.ok?'✅ ':'❌ ')+(d.message||'');msg.style.color=d.ok?'var(--status-ok-ink)':'var(--status-err-ink)'}
      if(d.ok){var sx=$('dingSecretInput');if(sx)sx.value='';dingLoad()}
    }).catch(function(){dingSaveBtn.disabled=false;dingSaveBtn.textContent='保存钉钉设置';if(msg){msg.textContent='❌ 保存失败，请重试';msg.style.color='var(--status-err-ink)'}})
  })

  /* ===== 运行设置保存 ===== */
  function swOn(id){var el=$(id);return el?el.classList.contains('on'):false}
  var settingsSaveBtn=$('settingsSaveBtn')
  if(settingsSaveBtn)settingsSaveBtn.addEventListener('click',function(){
    var msg=$('settingsMsg')
    settingsSaveBtn.disabled=true;settingsSaveBtn.textContent='保存中…'
    apiFetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      pollInterval:$('setPoll').value,pollJitter:$('setJitter').value,retryMaxAttempts:$('setRetry').value,retryDelayMs:$('setRetryDelay').value*1000,
      locationRadius:$('setRadius').value,desktop:swOn('setDesktop'),quietEnabled:swOn('setQuiet'),quietStart:$('setQuietStart').value,quietEnd:$('setQuietEnd').value,
      reportEnabled:swOn('setReport'),reportHour:$('setReportHour').value,verifyEnabled:swOn('setVerify'),weeklyReport:swOn('setWeeklyReport'),
      preCheckEnabled:swOn('setPreCheck'),preCheckHour:$('setPreCheckHour').value,smartPollEnabled:swOn('setSmartPoll'),
      humanDelayEnabled:swOn('setHumanDelay'),humanDelayMin:$('setHumanDelayMin').value,humanDelayMax:$('setHumanDelayMax').value,
      confirmBeforeEnabled:swOn('setConfirmBefore'),confirmBeforeWait:$('setConfirmWait').value
    })}).then(function(r){return r.json()}).then(function(d){
      msg.textContent=(d.ok?'✅ ':'❌ ')+(d.message||'保存失败');msg.style.color=d.ok?'var(--status-ok-ink)':'var(--status-err-ink)'
      settingsSaveBtn.disabled=false;settingsSaveBtn.textContent='保存设置'
      if(d.ok)setTimeout(function(){location.reload()},1200)
    }).catch(function(){msg.textContent='❌ 保存失败';msg.style.color='var(--status-err-ink)';settingsSaveBtn.disabled=false;settingsSaveBtn.textContent='保存设置'})
  })
  function bindSwitch(id){var el=$(id);if(el)el.addEventListener('click',function(){var on=!el.classList.contains('on');el.classList.toggle('on',on);el.setAttribute('aria-checked',String(on))})}
  ;['setDesktop','setQuiet','setReport','setVerify','setWeeklyReport','setPreCheck','setSmartPoll','setHumanDelay','setConfirmBefore'].forEach(bindSwitch)

  /* ===== 时刻滚轮选择器 ===== */
  var tpState=null
  function tpPad(n){return (n<10?'0':'')+n}
  function tpIndex(col){var ih=col.__ih||28;return Math.max(0,Math.min((col.__n||24)-1,Math.round(col.scrollTop/ih)))}
  function tpSync(){
    var m=$('tpMask');if(!m||!tpState)return
    var cols=m.querySelectorAll('.tp-col'),idx=[]
    for(var i=0;i<cols.length;i++){var col=cols[i],sel=tpIndex(col),items=col.children;for(var j=0;j<items.length;j++)items[j].classList.toggle('sel',j===sel);idx.push(sel)}
    tpState.idx=idx
    var read=$('tpRead');if(read)read.textContent=tpState.mode==='hm'?tpPad(idx[0]||0)+':'+tpPad(idx[1]||0):tpPad(idx[0]||0)+' 时'
  }
  function tpSnap(col){var ih=col.__ih||28;col.scrollTo({top:tpIndex(col)*ih,behavior:'smooth'})}
  function tpStep(col,d){var ih=col.__ih||28;var i=Math.max(0,Math.min((col.__n||24)-1,tpIndex(col)+d));col.scrollTo({top:i*ih,behavior:'smooth'});tpSync()}
  function tpBindCol(col){
    var drag=false,sy=0,ss=0
    col.addEventListener('pointerdown',function(e){drag=true;sy=e.clientY;ss=col.scrollTop;try{col.setPointerCapture(e.pointerId)}catch(_){}col.style.scrollSnapType='none'})
    col.addEventListener('pointermove',function(e){if(drag)col.scrollTop=ss-(e.clientY-sy)})
    col.addEventListener('pointerup',function(){if(!drag)return;drag=false;col.style.scrollSnapType='';tpSnap(col);tpSync()})
    col.addEventListener('pointercancel',function(){drag=false;col.style.scrollSnapType=''})
    col.addEventListener('scroll',tpSync,{passive:true})
    col.addEventListener('keydown',function(e){var d=e.key==='ArrowDown'?1:e.key==='ArrowUp'?-1:0;if(!d)return;e.preventDefault();tpStep(col,d)})
  }
  function tpCommit(){
    if(!tpState)return
    var f=tpState.field,idx=tpState.idx||[0,0]
    f.value=tpState.mode==='hm'?tpPad(idx[0])+':'+tpPad(idx[1]||0):String(idx[0])
    try{f.dispatchEvent(new Event('input',{bubbles:true}));f.dispatchEvent(new Event('change',{bubbles:true}))}catch(_){}
  }
  function tpClose(commit){
    var m=$('tpMask');if(!m)return
    if(commit)tpCommit()
    m.classList.remove('show')
    var f=tpState&&tpState.field;tpState=null
    if(f){try{f.focus({preventScroll:true})}catch(_){}}
  }
  function tpEl(){
    var m=$('tpMask');if(m)return m
    m=document.createElement('div');m.id='tpMask';m.className='tp-mask'
    m.innerHTML='<div class="tp-pop" role="dialog" aria-modal="true" aria-label="选择时间"><div class="tp-head"><span>选择时间</span><b id="tpRead">--:--</b></div><div class="tp-cols"><div class="tp-band"></div><div class="tp-col" tabindex="0" role="listbox" aria-label="时"></div><div class="tp-col" tabindex="0" role="listbox" aria-label="分"></div></div><div class="tp-foot"><button type="button" class="btn btn-secondary" id="tpNow">现在</button><button type="button" class="btn btn-secondary" id="tpCancel">取消</button><button type="button" class="btn btn-primary" id="tpOk">确定</button></div></div>'
    document.body.appendChild(m)
    var cols=m.querySelectorAll('.tp-col');tpBindCol(cols[0]);tpBindCol(cols[1])
    m.addEventListener('pointerdown',function(e){if(e.target===m)tpClose(false)})
    m.addEventListener('keydown',function(e){if(e.key==='Escape'){e.preventDefault();tpClose(false)}else if(e.key==='Enter'){e.preventDefault();tpClose(true)}})
    $('tpOk').addEventListener('click',function(){tpClose(true)})
    $('tpCancel').addEventListener('click',function(){tpClose(false)})
    $('tpNow').addEventListener('click',function(){var d=new Date();cols[0].scrollTo({top:d.getHours()*(cols[0].__ih||28),behavior:'smooth'});cols[1].scrollTo({top:d.getMinutes()*(cols[1].__ih||28),behavior:'smooth'});setTimeout(tpSync,160)})
    return m
  }
  function tpColumn(col,n){var html='';for(var k=0;k<n;k++)html+='<div class="tp-item" role="option">'+tpPad(k)+'</div>';col.innerHTML=html;col.__n=n}
  function tpOpen(field){
    var mode=field.getAttribute('data-tp')==='h'?'h':'hm'
    var m=tpEl(),cols=m.querySelectorAll('.tp-col'),pop=m.querySelector('.tp-pop')
    tpColumn(cols[0],24);tpColumn(cols[1],60)
    cols[1].style.display=mode==='hm'?'':'none'
    $('tpNow').style.display=mode==='hm'?'':'none'
    var raw=String(field.value||'').trim(),h=0,mi=0
    if(mode==='hm'){var p=raw.split(':');h=Math.max(0,Math.min(23,parseInt(p[0],10)||0));mi=Math.max(0,Math.min(59,parseInt(p[1],10)||0))}
    else{h=Math.max(0,Math.min(23,parseInt(raw,10)||0))}
    tpState={field:field,mode:mode,idx:[h,mi]}
    m.classList.add('show')
    var ih=parseFloat(getComputedStyle(cols[0].firstChild).height)||28
    cols[0].__ih=ih;cols[1].__ih=ih
    cols[0].scrollTop=h*ih;cols[1].scrollTop=mi*ih
    if(window.matchMedia('(pointer: coarse)').matches){pop.style.left='';pop.style.top=''}
    else{var r=field.getBoundingClientRect(),pw=pop.offsetWidth,ph=pop.offsetHeight;var left=Math.max(8,Math.min(r.left,window.innerWidth-pw-8));var top=r.bottom+6;if(top+ph>window.innerHeight-8)top=Math.max(8,r.top-ph-6);pop.style.left=left+'px';pop.style.top=top+'px'}
    tpSync()
    try{cols[0].focus({preventScroll:true})}catch(_){}
    requestAnimationFrame(function(){if(!tpState||tpState.field!==field)return;cols[0].scrollTop=h*ih;cols[1].scrollTop=mi*ih;tpSync()})
  }
  function tpBindFields(){
    var list=document.querySelectorAll('.tp-field')
    for(var i=0;i<list.length;i++){(function(f){
      f.setAttribute('aria-haspopup','dialog')
      f.addEventListener('mousedown',function(e){e.preventDefault();tpOpen(f)})
      f.addEventListener('touchstart',function(e){e.preventDefault();tpOpen(f)},{passive:false})
      f.addEventListener('click',function(e){e.preventDefault()})
      f.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '||e.key==='ArrowDown'){e.preventDefault();tpOpen(f)}})
    })(list[i])}
  }
  tpBindFields()

  /* ===== 配置导出 / 导入 ===== */
  var cfgExportBtn=$('cfgExportBtn')
  if(cfgExportBtn)cfgExportBtn.addEventListener('click',function(){window.location.href='/api/config/export${qs}'})
  var cfgImportBtn=$('cfgImportBtn'),cfgFileInput=$('cfgFileInput')
  if(cfgImportBtn&&cfgFileInput)cfgImportBtn.addEventListener('click',function(){cfgFileInput.click()})
  if(cfgFileInput)cfgFileInput.addEventListener('change',function(){
    var f=cfgFileInput.files[0];if(!f)return
    var reader=new FileReader()
    reader.onload=function(){
      apiFetch('/api/config/import',{method:'POST',headers:{'Content-Type':'application/json'},body:reader.result}).then(function(r){return r.json()}).then(function(d){
        var msg=$('cfgMsg');if(msg){msg.textContent=(d.ok?'✅ ':'❌ ')+(d.message||'操作失败');msg.style.color=d.ok?'var(--status-ok-ink)':'var(--status-err-ink)'}
        if(d.ok)setTimeout(function(){location.reload()},1500)
      }).catch(function(){var msg=$('cfgMsg');if(msg){msg.textContent='❌ 导入失败';msg.style.color='var(--status-err-ink)'}})
    }
    reader.readAsText(f)
  })

  /* ===== 签到日历 ===== */
  var calState={y:0,m:0,sel:null,data:{}}
  function calInit(){var n=new Date();calState.y=n.getFullYear();calState.m=n.getMonth()+1}
  function renderCal(){
    var y=calState.y,m=calState.m
    var t=$('calTitle');if(t)t.textContent=y+' 年 '+m+' 月'
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
        if(e&&(e.success||e.fail)){body+='<div class="cal-badges">';if(e.success)body+='<span class="cal-ok">'+e.success+' 成功</span>';if(e.fail)body+='<span class="cal-err">'+e.fail+' 失败</span>';body+='</div>'}
        cells+='<div class="'+cls+'" data-day="'+day+'">'+body+'</div>'
      }
      var grid=$('calGrid');if(grid)grid.innerHTML=cells
      showCalDetail(calState.sel)
    }).catch(function(){})
  }
  function showCalDetail(day){
    var box=$('calDetail');if(!box)return
    if(!day){box.innerHTML='';return}
    var e=calState.data[String(day)]
    if(!e||!e.items||!e.items.length){box.innerHTML='<div class="cell-empty" style="padding:14px 0">当天暂无签到记录，点击有记录的日期查看详情</div>';return}
    var rows=e.items.map(function(it){
      return '<div class="cal-detail-item"><span class="cell-sub">'+esc(it.time||'')+'</span><span class="cell-main">'+esc(it.course)+'</span><span class="cell-sub">'+esc(typeText(it.type))+'</span>'+(isOk(it.result)?'<span class="status-pill is-ok"><span class="pill-dot"></span><span class="pill-text">成功</span></span>':'<span class="status-pill is-err"><span class="pill-dot"></span><span class="pill-text">失败</span></span>')+'</div>'
    }).join('')
    box.innerHTML='<div style="font-size:var(--text-xs);font-weight:600;color:var(--ink-secondary);margin-bottom:6px">'+calState.y+' 年 '+calState.m+' 月 '+day+' 日 · 共 '+(e.success+e.fail)+' 次签到</div>'+rows
  }
  var calGridEl=$('calGrid')
  if(calGridEl)calGridEl.addEventListener('click',function(ev){var cell=ev.target.closest('.cal-cell[data-day]');if(!cell)return;var day=Number(cell.getAttribute('data-day'));calState.sel=calState.sel===day?null:day;renderCal()})
  var calPrev=$('calPrev'),calNext=$('calNext')
  if(calPrev)calPrev.addEventListener('click',function(){calState.m--;if(calState.m<1){calState.m=12;calState.y--}calState.sel=null;renderCal()})
  if(calNext)calNext.addEventListener('click',function(){calState.m++;if(calState.m>12){calState.m=1;calState.y++}calState.sel=null;renderCal()})
  calInit();renderCal()

  /* ===== 网络与代理 ===== */
  var proxyInput=$('proxyInput'),proxyMsg=$('proxyMsg')
  if(proxyInput)apiFetch('/api/proxy').then(function(r){return r.json()}).then(function(d){proxyInput.value=d.proxy||''}).catch(function(){})
  var proxySaveBtn=$('proxySaveBtn')
  if(proxySaveBtn)proxySaveBtn.addEventListener('click',function(){
    proxySaveBtn.disabled=true;proxyMsg.textContent='保存中…';proxyMsg.style.color='var(--ink-tertiary)'
    apiFetch('/api/proxy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({proxy:proxyInput.value.trim()})}).then(function(r){return r.json()}).then(function(d){
      proxyMsg.textContent=(d.ok?'✅ ':'❌ ')+(d.message||'保存失败');proxyMsg.style.color=d.ok?'var(--status-ok-ink)':'var(--status-err-ink)';proxySaveBtn.disabled=false
    }).catch(function(){proxyMsg.textContent='❌ 保存失败';proxyMsg.style.color='var(--status-err-ink)';proxySaveBtn.disabled=false})
  })
  var proxyTestBtn=$('proxyTestBtn')
  if(proxyTestBtn)proxyTestBtn.addEventListener('click',function(){
    proxyTestBtn.disabled=true;proxyMsg.textContent='测试中…';proxyMsg.style.color='var(--ink-tertiary)'
    apiFetch('/api/proxy/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({proxy:proxyInput.value.trim()})}).then(function(r){return r.json()}).then(function(d){
      proxyMsg.textContent=(d.ok?'✅ ':'❌ ')+(d.message||'测试失败');proxyMsg.style.color=d.ok?'var(--status-ok-ink)':'var(--status-err-ink)';proxyTestBtn.disabled=false
    }).catch(function(){proxyMsg.textContent='❌ 测试失败';proxyMsg.style.color='var(--status-err-ink)';proxyTestBtn.disabled=false})
  })
  var diagBtn=$('diagBtn'),diagResult=$('diagResult')
  if(diagBtn)diagBtn.addEventListener('click',function(){
    diagBtn.disabled=true;diagBtn.textContent='诊断中…'
    diagResult.hidden=false
    diagResult.innerHTML='<div class="cell-empty" style="padding:20px 0">正在逐项检测，约需 5~15 秒…</div>'
    apiFetch('/api/diag').then(function(r){return r.json()}).then(function(d){
      var head=''
      if(d.cookie===false)head='<div class="diag-item"><span class="diag-name">提示</span><span class="diag-detail">未配置账号或 Cookie 为空，课程 / 签到接口检测结果仅供参考</span></div>'
      if(d.proxy)head+='<div class="diag-item"><span class="diag-name">当前代理</span><span class="diag-detail cell-mono">'+esc(d.proxy)+'</span></div>'
      var rows=(d.results||[]).map(function(r){
        return '<div class="diag-item"><span class="diag-name">'+esc(r.name)+'</span>'+(r.ok?'<span class="status-pill is-ok"><span class="pill-dot"></span><span class="pill-text">正常</span></span>':'<span class="status-pill is-err"><span class="pill-dot"></span><span class="pill-text">异常</span></span>')+'<span class="diag-ms">'+(r.ms>0?r.ms+'ms':'')+'</span><span class="diag-detail">'+esc(r.detail)+'</span></div>'
      }).join('')
      diagResult.innerHTML=head+rows
      diagBtn.disabled=false;diagBtn.innerHTML='一键网络诊断'
    }).catch(function(){diagResult.innerHTML='<div class="cell-empty" style="padding:20px 0">诊断失败，请稍后重试</div>';diagBtn.disabled=false;diagBtn.innerHTML='一键网络诊断'})
  })

  /* ===== 测试通知 / 开机自启 ===== */
  var notifyTestBtn=$('notifyTestBtn')
  if(notifyTestBtn)notifyTestBtn.addEventListener('click',function(){
    var msg=$('settingsMsg');msg.textContent='正在发送…';msg.style.color='var(--ink-tertiary)'
    apiFetch('/api/notify/test',{method:'POST'}).then(function(r){return r.json()}).then(function(d){
      msg.textContent=(d.ok?'✅ ':'❌ ')+(d.message||'发送失败');msg.style.color=d.ok?'var(--status-ok-ink)':'var(--status-err-ink)'
    }).catch(function(){msg.textContent='❌ 发送失败';msg.style.color='var(--status-err-ink)'})
  })
  var alBtn=$('setAutoLaunch')
  if(alBtn&&window.appCtl){
    window.appCtl.getAutoLaunch().then(function(v){alBtn.classList.toggle('on',!!v);alBtn.setAttribute('aria-checked',String(!!v))}).catch(function(){})
    alBtn.addEventListener('click',function(){
      var next=!alBtn.classList.contains('on')
      alBtn.classList.toggle('on',next);alBtn.setAttribute('aria-checked',String(next))
      window.appCtl.setAutoLaunch(next).then(function(r){
        if(!r||!r.ok){alBtn.classList.toggle('on',!next);var msg=$('settingsMsg');msg.textContent='❌ '+((r&&r.message)||'设置失败，请安装版重试');msg.style.color='var(--status-err-ink)'}
      }).catch(function(){alBtn.classList.toggle('on',!next)})
    })
  }

  /* ===== 重新拉取课程列表 ===== */
  var refreshCoursesBtn=$('refreshCoursesBtn')
  if(refreshCoursesBtn)refreshCoursesBtn.addEventListener('click',function(){
    var msg=$('watchMsg')
    refreshCoursesBtn.disabled=true
    var lbl=refreshCoursesBtn.innerHTML
    refreshCoursesBtn.textContent='正在拉取…'
    apiFetch('/api/courses/refresh',{method:'POST'}).then(function(r){return r.json()}).then(function(d){
      msg.textContent=(d.ok?'✅ ':'❌ ')+(d.message||'刷新失败');msg.style.color=d.ok?'var(--status-ok-ink)':'var(--status-err-ink)'
      refreshCoursesBtn.disabled=false;refreshCoursesBtn.innerHTML=lbl
      if(d.ok)setTimeout(function(){location.reload()},1500)
    }).catch(function(){msg.textContent='❌ 刷新失败';msg.style.color='var(--status-err-ink)';refreshCoursesBtn.disabled=false;refreshCoursesBtn.innerHTML=lbl})
  })

  /* ===== 填写课表（模块 4） ===== */
  var ttState={table:null,slots:[],weekdays:[],courses:[],suggested:{}}
  function ttEsc(s){return esc(String(s==null?'':s))}
  function ttRender(){
    var body=$('ttBody');if(!body)return
    var slots=ttState.slots||[],days=ttState.weekdays||[]
    if(!slots.length||!days.length){body.innerHTML='<tr><td colspan="6" class="cell-empty">课表数据加载失败</td></tr>';return}
    var opts='<option value="">— 请选择课程 —</option>'+ttState.courses.map(function(c){return '<option value="'+ttEsc(c.courseId)+'">'+ttEsc(c.courseName)+'</option>'}).join('')
    var html='',lastHalf=''
    slots.forEach(function(s){
      if(s.half!==lastHalf){lastHalf=s.half;html+='<tr class="tt-half"><td colspan="6">'+(s.half==='morning'?'上午 07:30–12:30':'下午 14:00–21:00')+'</td></tr>'}
      html+='<tr><td class="tt-slot"><b>'+ttEsc(s.label)+'</b><span>'+ttEsc(s.startText)+'–'+ttEsc(s.endText)+'</span></td>'
      days.forEach(function(d){
        var cur=(ttState.table&&ttState.table[String(d.value)])?ttState.table[String(d.value)][s.index]:''
        var sug=ttState.suggested[String(d.value)+'-'+s.index]
        var cls='tt-cell '+(cur?'tt-filled':'tt-empty')+(sug&&String(sug)===String(cur)?' tt-suggested':'')
        html+='<td><select class="'+cls+'" data-dow="'+d.value+'" data-slot="'+s.index+'">'+opts+'</select></td>'
      })
      html+='</tr>'
    })
    body.innerHTML=html
    body.querySelectorAll('select.tt-cell').forEach(function(sel){
      var d=sel.getAttribute('data-dow'),i=Number(sel.getAttribute('data-slot'))
      var v=(ttState.table&&ttState.table[d])?ttState.table[d][i]:''
      if(v)sel.value=v
    })
    ttUpdateCount()
  }
  function ttCollect(){
    var table={}
    var body=$('ttBody');if(!body)return table
    body.querySelectorAll('select.tt-cell').forEach(function(sel){
      var d=sel.getAttribute('data-dow'),i=Number(sel.getAttribute('data-slot'))
      if(!table[d])table[d]=[]
      table[d][i]=sel.value||null
    })
    return table
  }
  function ttUpdateCount(){
    var body=$('ttBody');if(!body)return
    var all=body.querySelectorAll('select.tt-cell'),filled=0
    all.forEach(function(s){if(s.value)filled++})
    var el=$('ttCount');if(el)el.innerHTML='已填 <b style="color:var(--brand-600)">'+filled+'</b> / '+all.length+' 格'
    var badge=$('ttCompleteBadge'),bar=$('ttProgressBar'),wrap=$('ttProgressWrap')
    var pct=all.length?Math.round(filled/all.length*100):0
    if(bar)bar.style.width=pct+'%'
    if(wrap)wrap.className='tt-progress '+(filled===all.length&&all.length?'is-ok':pct>0?'is-warn':'')
    if(badge)badge.textContent=all.length?(filled===all.length?(all.length+'/'+all.length+' 已填满 · 严格按节扫描'):('未填满（'+filled+'/'+all.length+'）· 当前走全天兜底轮询')):'正在读取课表…'
    var warn=$('ttWarn'),ok=$('ttOk')
    if(warn)warn.style.display=(all.length&&filled<all.length)?'':'none'
    if(ok)ok.style.display=(all.length>0&&filled===all.length)?'':'none'
  }
  function ttLoad(){
    apiFetch('/api/timetable').then(function(r){return r.json()}).then(function(d){
      if(!d.ok){var b=$('ttBody');if(b)b.innerHTML='<tr><td colspan="6" class="cell-empty">'+ttEsc(d.message||'加载失败')+'</td></tr>';return}
      ttState.table=d.table||{};ttState.slots=d.slots||[];ttState.weekdays=d.weekdays||[];ttState.courses=d.courses||[]
      ttState.suggested={}
      ttRender()
      var st=d.status||{}
      var warn=$('ttWarn'),ok=$('ttOk')
      if(warn){
        warn.style.display=st.complete?'none':''
        if(!st.complete){
          var names=(st.emptySlots||[]).slice(0,12).map(function(e){return e.weekdayName+e.label}).join('、')
          var more=(st.emptySlots||[]).length>12?' 等 '+(st.emptySlots.length-12)+' 处':''
          warn.innerHTML='<b>⚠ 课表未填完（'+st.filled+'/'+st.total+'）</b>务必把所有格子填完，否则该时段的签到无法被识别，只能手动签到。<br>未填：'+ttEsc(names)+ttEsc(more)
        }
      }
      if(ok&&st.complete)ok.innerHTML='✅ 课表已填完（'+st.filled+'/'+st.total+'），扫描将严格按这张课表进行'
    }).catch(function(){var b=$('ttBody');if(b)b.innerHTML='<tr><td colspan="6" class="cell-empty">加载失败</td></tr>'})
  }
  var ttBodyEl=$('ttBody')
  if(ttBodyEl){
    ttBodyEl.addEventListener('change',function(e){
      var sel=e.target.closest('select.tt-cell');if(!sel)return
      sel.className='tt-cell '+(sel.value?'tt-filled':'tt-empty')
      ttUpdateCount()
    })
    ttLoad()
  }
  var ttAutoBtn=$('ttAutoBtn')
  if(ttAutoBtn)ttAutoBtn.addEventListener('click',function(){
    var msg=$('ttMsg')
    ttAutoBtn.disabled=true
    apiFetch('/api/timetable/suggest',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(function(r){return r.json()}).then(function(d){
      ttAutoBtn.disabled=false
      if(!d.ok){if(msg){msg.textContent='❌ '+(d.message||'生成失败');msg.style.color='var(--status-err-ink)'}return}
      ttState.table=d.table||ttState.table
      var det=(d.details||[])
      ttState.suggested={}
      det.forEach(function(x){ttState.suggested[String(x.weekday)+'-'+x.slot]=true})
      ttRender()
      if(msg){
        msg.style.color='var(--status-ok-ink)'
        msg.textContent=det.length?('✅ 已按最近签到时间填了 '+det.length+' 格，新增格带金色描边，请核对并补全剩余空格后保存。'):'ℹ 没有可用的签到记录来推断课表（或对应格子已被占用）。请手动选择课程并填完所有格子。'
      }
    }).catch(function(){ttAutoBtn.disabled=false;if(msg){msg.textContent='❌ 生成失败';msg.style.color='var(--status-err-ink)'}})
  })
  var ttSaveBtn=$('ttSaveBtn')
  if(ttSaveBtn)ttSaveBtn.addEventListener('click',function(){
    var msg=$('ttMsg')
    var table=ttCollect()
    var all=0,filled=0
    Object.keys(table).forEach(function(k){table[k].forEach(function(v){all++;if(v)filled++})})
    function doSave(){
      ttSaveBtn.disabled=true;ttSaveBtn.textContent='保存中…'
      apiFetch('/api/timetable/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table:table})}).then(function(r){return r.json()}).then(function(d){
        ttSaveBtn.disabled=false;ttSaveBtn.textContent='保存课表'
        if(msg){msg.textContent=(d.ok?'✅ ':'❌ ')+(d.message||'');msg.style.color=d.ok?'var(--status-ok-ink)':'var(--status-err-ink)'}
        if(d.ok){ttState.table=table;ttState.suggested={};ttLoad()}
      }).catch(function(){ttSaveBtn.disabled=false;ttSaveBtn.textContent='保存课表';if(msg){msg.textContent='❌ 保存失败，请重试';msg.style.color='var(--status-err-ink)'}})
    }
    if(filled<all){
      askConfirm({title:'课表尚未填满',text:'当前仍有 '+(all-filled)+' 个时段未选择课程。保存未填满的课表将导致轮询无法按节次精确锁定，只能走全天兜底轮询。是否仍要提交？',okText:'仍要保存',danger:true}).then(function(yes){if(yes)doSave()})
      return
    }
    doSave()
  })
  var ttClearBtn=$('ttClearBtn')
  if(ttClearBtn)ttClearBtn.addEventListener('click',function(){
    var body=$('ttBody');if(!body)return
    body.querySelectorAll('select.tt-cell').forEach(function(s){s.value='';s.className='tt-cell tt-empty'})
    ttState.suggested={}
    ttUpdateCount()
    var msg=$('ttMsg');if(msg){msg.textContent='已清空，请重新选择课程后点「保存课表」（必须全部填完）';msg.style.color='var(--status-err-ink)'}
  })

  /* ===== 课表页：课程网格 ===== */
  function loadSchedule(){
    var grid=$('scheduleGrid');if(!grid)return
    grid.innerHTML='<div class="grid-empty">加载中...</div>'
    Promise.all([apiFetch('/api/schedule').then(function(r){return r.json()}),apiFetch('/api/course-notes').then(function(r){return r.json()}).catch(function(){return{notes:{}}})]).then(function(results){
      var d=results[0],notesData=results[1]
      if(!d.ok||!d.schedule){grid.innerHTML='<div class="grid-empty">加载失败</div>';return}
      var list=d.schedule,notes=notesData.notes||{}
      var total2=list.length,watching=list.filter(function(c){return c.watching&&!c.isRetired}).length,retired=list.filter(function(c){return c.isRetired}).length
      var succ=list.reduce(function(a,c){return a+(c.success||0)},0),fail=list.reduce(function(a,c){return a+(c.fail||0)},0)
      var el
      el=$('schTotal');if(el)el.textContent=total2
      el=$('schWatching');if(el)el.textContent=watching
      el=$('schRetired');if(el)el.textContent=retired
      el=$('schSuccess');if(el)el.textContent=succ
      el=$('schFail');if(el)el.textContent=fail
      if(total2===0){grid.innerHTML='<div class="grid-empty">暂无课程，请先在设置页登录账号</div>';return}
      grid.innerHTML=list.map(function(c){
        var badge=c.isRetired?'<span class="course-card-badge badge-retired">已结课</span>':(c.watching?'<span class="course-card-badge badge-on">监听中</span>':'<span class="course-card-badge badge-off">已停用</span>')
        var cls='course-card'+(c.watching&&!c.isRetired?' watching':'')+(c.isRetired?' retired':'')
        var note=notes[c.courseId]?'<div class="course-note" title="点击编辑备注">📝 '+esc(notes[c.courseId])+'</div>':''
        return '<div class="'+cls+'" data-cid="'+esc(c.courseId)+'" data-cname="'+esc(c.courseName)+'">'+badge+'<div class="course-card-name">'+esc(c.courseName)+'</div><div class="course-card-teacher">'+esc(c.teacherName||'未知老师')+'</div>'+note+'<div class="course-card-stats"><span class="course-card-stat-ok">成功 '+(c.success||0)+'</span><span class="course-card-stat-fail">失败 '+(c.fail||0)+'</span><button class="btn btn-secondary btn-sm detail-btn" data-cname="'+esc(c.courseName)+'" style="margin-left:auto">详情</button></div></div>'
      }).join('')
      grid.querySelectorAll('.course-note').forEach(function(el2){
        el2.addEventListener('click',function(e){
          e.stopPropagation()
          var card=el2.closest('.course-card'),cid=card.dataset.cid,cname=card.dataset.cname,cur=notes[cid]||''
          askDialog({title:cname+' 的备注',input:true,value:cur,placeholder:'例如：周三第 3 节，教学楼 B203',okText:'保存'}).then(function(val){
            if(val===null)return
            var payload={};payload[cid]=String(val).trim()
            apiFetch('/api/course-notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(function(){loadSchedule()}).catch(function(){toast('❌ 备注保存失败','err')})
          })
        })
      })
      grid.querySelectorAll('.detail-btn').forEach(function(btn){btn.addEventListener('click',function(e){e.stopPropagation();showCourseDetail(btn.dataset.cname)})})
      grid.querySelectorAll('.course-card').forEach(function(card){
        card.style.cursor='pointer'
        card.addEventListener('click',function(){
          var cid=card.dataset.cid;if(!cid)return
          var list2=[],allOn=true
          grid.querySelectorAll('.course-card').forEach(function(c2){
            var id2=c2.dataset.cid,on2=c2.classList.contains('watching')&&!c2.classList.contains('retired')
            if(id2===cid)on2=!on2
            if(on2)list2.push(id2);else allOn=false
          })
          if(!allOn&&list2.length===0){toast('至少要保留一门监听的课程','err');return}
          apiFetch('/api/watch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({watchCourses:allOn?[]:list2})}).then(function(r){return r.json()}).then(function(dd){
            toast((dd.ok?'✅ ':'❌ ')+(dd.message||'保存失败'),dd.ok?'ok':'err')
            if(dd.ok)loadSchedule()
          }).catch(function(){toast('❌ 保存失败，请检查网络','err')})
        })
      })
    }).catch(function(){grid.innerHTML='<div class="grid-empty">加载失败，请检查服务状态</div>'})
  }

  /* ===== 课程签到详情弹窗 ===== */
  function showCourseDetail(courseName){
    var modal=$('courseDetailModal');if(!modal)return
    modal.classList.add('show')
    $('detailTitle').textContent=courseName+' - 签到记录'
    $('detailBody').innerHTML='<div style="text-align:center;padding:30px;color:var(--ink-tertiary)">加载中...</div>'
    apiFetch('/api/course-detail?course='+encodeURIComponent(courseName)).then(function(r){return r.json()}).then(function(d){
      if(!d.ok||!d.records||d.records.length===0){$('detailBody').innerHTML='<div style="text-align:center;padding:30px;color:var(--ink-tertiary)">暂无签到记录</div>';return}
      var rows=d.records.map(function(r){
        var ok2=isOk(r.result||'')
        return '<tr><td class="cell-mono" data-label="时间">'+esc(r.time||'')+'</td><td data-label="类型">'+esc(r.type||'普通')+'</td><td data-label="账号">'+esc(r.account||'')+'</td><td data-label="结果">'+(ok2?'<span class="status-pill is-ok"><span class="pill-dot"></span><span class="pill-text">'+esc(r.result||'')+'</span></span>':'<span class="status-pill is-idle"><span class="pill-dot"></span><span class="pill-text">'+esc(r.result||'')+'</span></span>')+'</td></tr>'
      }).join('')
      $('detailBody').innerHTML='<div style="margin-bottom:10px;font-size:var(--text-xs);color:var(--ink-tertiary)">共 '+d.total+' 条记录（最近100条）</div><table class="data-table"><thead><tr><th>时间</th><th>类型</th><th>账号</th><th>结果</th></tr></thead><tbody>'+rows+'</tbody></table>'
    }).catch(function(){$('detailBody').innerHTML='<div style="text-align:center;padding:30px;color:var(--ink-tertiary)">加载失败</div>'})
  }

  /* ===== 日志（模块 6） ===== */
  var logAutoScroll=true,logLines=[]
  function logLevelOf(line){
    if(/\\[ERROR\\]/.test(line))return 'error'
    if(/\\[WARN\\]/.test(line))return 'warn'
    if(/\\[DEBUG\\]/.test(line))return 'debug'
    return 'info'
  }
  var logLevel='all'
  function renderLogLines(){
    var box=$('logBox');if(!box)return
    var filtered=logLines.filter(function(line){return logLevel==='all'?true:logLevelOf(line)===logLevel})
    if(!filtered.length){box.innerHTML='<div class="log-empty">'+(logLines.length?'当前级别没有日志':'暂无日志')+'</div>';return}
    box.innerHTML=filtered.map(function(line){
      var lv=logLevelOf(line)
      // 按第一个 [LEVEL] 标记切分：前为时间戳、中为级别、后为正文
      var open=line.indexOf('[')
      var close=open>=0?line.indexOf(']',open):-1
      var ts=(open>0?line.slice(0,open):'').trim()
      var lvl=(open>=0&&close>open)?line.slice(open,close+1):'['+lv.toUpperCase()+']'
      var msg=(close>=0?line.slice(close+1):line).trim()
      return '<div class="log-line level-'+lv+'"><span class="log-ts">'+esc(ts)+'</span><span class="log-lvl">'+esc(lvl)+'</span><span class="log-msg">'+esc(msg)+'</span></div>'
    }).join('')
    if(logAutoScroll)box.scrollTop=box.scrollHeight
  }
  function loadLogs(){
    var box=$('logBox');if(!box)return
    apiFetch('/api/logs?lines=200').then(function(r){return r.json()}).then(function(d){
      if(!d.ok||!d.lines){logLines=[];box.innerHTML='<div class="log-empty">'+esc(d.message||'暂无日志')+'</div>';return}
      var lf=$('logFile');if(lf)lf.textContent=(d.file||'')+' · 最近 '+d.lines.length+' 行'
      logLines=d.lines||[]
      renderLogLines()
    }).catch(function(){box.innerHTML='<div class="log-empty">日志读取失败</div>'})
  }
  var logBoxEl=$('logBox')
  if(logBoxEl)logBoxEl.addEventListener('scroll',function(){
    var atBottom=logBoxEl.scrollHeight-logBoxEl.scrollTop-logBoxEl.clientHeight<40
    logAutoScroll=atBottom
    var pin=$('logPinBtn');if(pin)pin.classList.toggle('show',!atBottom)
  })
  var logPinBtn=$('logPinBtn')
  if(logPinBtn)logPinBtn.addEventListener('click',function(){logAutoScroll=true;if(logBoxEl)logBoxEl.scrollTop=logBoxEl.scrollHeight;logPinBtn.classList.remove('show')})
  document.querySelectorAll('.log-lvl-btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      document.querySelectorAll('.log-lvl-btn').forEach(function(b){b.classList.remove('active')})
      btn.classList.add('active')
      logLevel=btn.getAttribute('data-level')||'all'
      renderLogLines()
    })
  })
  var logRefreshBtn=$('logRefreshBtn')
  if(logRefreshBtn)logRefreshBtn.addEventListener('click',loadLogs)
  loadLogs()

  /* ===== 二维码弹窗 ===== */
  function openQrModal(){if(dragMask)dragMask.classList.remove('show');if(qrModal)qrModal.classList.add('show');if(qrStatus){qrStatus.textContent='';qrStatus.className='qr-status'}}
  function closeQrModal(){if(qrModal)qrModal.classList.remove('show')}
  var btnQrModal=$('btnQrModal')
  if(btnQrModal)btnQrModal.addEventListener('click',openQrModal)
  var fabQr=$('fabQr')
  if(fabQr)fabQr.addEventListener('click',openQrModal)
  var chipQrBtn=$('chipQr')
  if(chipQrBtn)chipQrBtn.addEventListener('click',openQrModal)
  var qrCopyBtn=$('qrCopyBtn')
  if(qrCopyBtn)qrCopyBtn.addEventListener('click',function(){
    var el=$('qrMobileUrl'),label=$('qrCopyLabel'),txt=el?el.textContent:''
    function done(ok){if(label){label.textContent=ok?'已复制':'复制失败';setTimeout(function(){label.textContent='复制'},1800)}}
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(txt).then(function(){done(true)},function(){done(false)})}
    else{try{var ta=document.createElement('textarea');ta.value=txt;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);done(true)}catch(e){done(false)}}
  })
  var qrModalClose=$('qrModalClose')
  if(qrModalClose)qrModalClose.addEventListener('click',closeQrModal)
  if(qrModal)qrModal.addEventListener('click',function(e){if(e.target===qrModal)closeQrModal()})
  function uploadQrFile(file){
    if(!file)return
    if(file.type.indexOf('image/')!==0){qrStatus.textContent='请选择图片文件';qrStatus.className='qr-status err';return}
    qrStatus.textContent='正在识别签到…';qrStatus.className='qr-status'
    apiFetch('/upload/image?type=qr',{method:'POST',body:file,headers:{'Content-Type':file.type}}).then(function(r){return r.json()}).then(function(d){
      if(d.success){qrStatus.textContent='✅ '+d.message;qrStatus.className='qr-status ok'}
      else{qrStatus.textContent='❌ '+(d.error||'处理失败');qrStatus.className='qr-status err'}
    }).catch(function(err){qrStatus.textContent='❌ 上传失败: '+err.message;qrStatus.className='qr-status err'})
  }
  var qrDrop=$('qrDrop')
  if(qrDrop){
    qrDrop.addEventListener('dragover',function(e){e.preventDefault();e.stopPropagation();qrDrop.classList.add('drag')})
    qrDrop.addEventListener('dragleave',function(){qrDrop.classList.remove('drag')})
    qrDrop.addEventListener('drop',function(e){e.preventDefault();e.stopPropagation();qrDrop.classList.remove('drag');var f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];if(f)uploadQrFile(f)})
  }
  var btnPickFile=$('btnPickFile'),qrFileInput=$('qrFileInput')
  if(btnPickFile&&qrFileInput){
    btnPickFile.addEventListener('click',function(){qrFileInput.click()})
    qrFileInput.addEventListener('change',function(){if(qrFileInput.files&&qrFileInput.files[0])uploadQrFile(qrFileInput.files[0]);qrFileInput.value=''})
  }

  /* ===== 浮层统一关闭 ===== */
  var detailModal=$('courseDetailModal'),detailClose=$('detailClose')
  if(detailClose)detailClose.addEventListener('click',function(){detailModal.classList.remove('show')})
  if(detailModal)detailModal.addEventListener('click',function(e){if(e.target===detailModal)detailModal.classList.remove('show')})
  if(updateModal)updateModal.addEventListener('click',function(e){if(e.target===updateModal)updateModal.classList.remove('show')})
  function closeTopOverlay(){
    var uhp=$('updHover');if(uhp&&uhp.classList.contains('show')){uhp.classList.remove('show');return true}
    var tp=$('tpMask');if(tp&&tp.classList.contains('show')){tpClose(false);return true}
    var dlg=$('dialogMask');if(dlg&&dlg.classList.contains('show')){var b=$('dlgCancel');if(b)b.click();return true}
    if(detailModal&&detailModal.classList.contains('show')){detailModal.classList.remove('show');return true}
    if(qrModal&&qrModal.classList.contains('show')){closeQrModal();return true}
    if(updateModal&&updateModal.classList.contains('show')){updateModal.classList.remove('show');return true}
    if(dragMask&&dragMask.classList.contains('show')){dragMask.classList.remove('show');return true}
    return false
  }
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&closeTopOverlay())e.preventDefault()})
  window.addEventListener('unhandledrejection',function(e){toast('操作失败：'+((e.reason&&e.reason.message)||e.reason||'未知错误'),'err')})

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
