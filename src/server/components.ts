/**
 * 控制台无状态纯组件函数（模块 14：SSR 模板函数式拆分）
 *
 * 设计原则：
 *   · 每个函数只负责「把数据变成一段 HTML 字符串」，无副作用、无状态、不读全局；
 *   · 统一走 esc() 转义，杜绝 XSS 与标签错位；
 *   · 交互一律用 data-* 钩子 + 事件委托，绝不写内联 onclick（CSP 是 script-src 'nonce-…'，
 *     内联处理器会被静默拦死）。
 */

export const ICONS = {
  // 应用标记：与安装图标同源的小尺寸矢量版（实心橙块 + 粗白勾）。
  appMark: '<svg class="app-mark" viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="104" fill="#EF7429"/><path d="M148 264l74 78 142-168" fill="none" stroke="#fff" stroke-width="78" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  courses: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  qr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14h1M14 20h1M18 18h3v3h-3z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/></svg>',
  server: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
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
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg>',
} as const

export function esc(s: any): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function fmtTime(ts: any): string {
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

export function modeText(mode: string): string {
  if (mode === 'im') return 'IM 实时监听'
  if (mode === 'poll') return '轮询监听'
  return '混合模式（轮询兜底）'
}

export function typeText(t: string): string {
  const map: Record<string, string> = { normal: '普通', qr: '二维码', location: '位置' }
  return map[t] || t
}

export function isSuccess(result: any): boolean {
  return /成功|✅|已签到/.test(String(result ?? ''))
}

/** 统计方块：数值用等宽数字，配轻量次级上下文（如「成功率 98.4%」） */
export function renderStatCard(opts: { label: string; value: string | number; sub?: string; icon?: string; tone?: 'brand' | 'ok' | 'err' | 'neutral' }): string {
  const tone = opts.tone || 'neutral'
  const toneStyle: Record<string, string> = {
    brand: 'color:var(--brand-600);background:var(--brand-100)',
    ok: 'color:var(--status-ok-ink);background:var(--status-ok-bg)',
    err: 'color:var(--status-err-ink);background:var(--status-err-bg)',
    neutral: 'color:var(--ink-secondary);background:var(--bg-surface-sub)',
  }
  const ico = opts.icon
    ? `<span class="stat-box-ico" style="${toneStyle[tone]}">${opts.icon}</span>`
    : ''
  return `
    <div class="stat-box">
      <div class="stat-box-label"><span>${esc(opts.label)}</span>${ico}</div>
      <div class="stat-box-val">${esc(String(opts.value))}</div>
      ${opts.sub ? `<div class="stat-box-sub">${esc(opts.sub)}</div>` : ''}
    </div>`
}

/** 状态胶囊：is-ok / is-warn / is-err / is-idle */
export function renderStatusPill(type: 'ok' | 'warn' | 'err' | 'idle', text: string, title?: string): string {
  const t = title ? ` title="${esc(title)}"` : ''
  return `<span class="status-pill is-${type}"${t}><span class="pill-dot"></span><span class="pill-text">${esc(text)}</span></span>`
}

/**
 * 服务端纯函数：渲染近 14 天内联 SVG 柱状图（零依赖自绘）。
 * 双柱（成功=语义绿 / 失败=语义红）+ 中线虚线 + 底部日期基线；
 * 空数据与极端密集数据都有兜底（maxVal 下限 5，柱宽有最小值）。
 */
export function renderTrendSvg(trend: Array<{ date: string; success: number; fail: number }> = []): string {
  const width = 640
  const height = 150
  const padLeft = 32
  const padBottom = 24
  const padTop = 16
  const padRight = 16

  const plotW = width - padLeft - padRight
  const plotH = height - padTop - padBottom

  const days = (trend || []).slice(-14)
  const hasData = days.some(d => (d.success || 0) + (d.fail || 0) > 0)

  const head = `
    <div class="trend-header">
      <div>
        <h3 class="trend-title">近 14 天签到走势</h3>
        <p class="trend-sub">绿色代表自动成功，红色代表需人工介入或失败</p>
      </div>
      <div class="trend-legend">
        <span><i class="legend-dot ok"></i>成功</span>
        <span><i class="legend-dot err"></i>异常/失败</span>
      </div>
    </div>`

  if (!hasData) {
    return `<div class="trend-card">${head}<div class="cell-empty" style="padding:26px 0">暂无签到数据，产生签到记录后自动生成趋势图</div></div>`
  }

  const maxVal = Math.max(5, ...days.map(d => (d.success || 0) + (d.fail || 0)))
  const stepX = plotW / Math.max(1, days.length)

  const gridY1 = padTop + plotH * 0.5
  const gridY0 = padTop + plotH

  let barsHtml = ''
  let labelsHtml = ''

  days.forEach((d, i) => {
    const x = padLeft + i * stepX + (stepX * 0.15)
    const colW = Math.max(4, stepX * 0.7)
    const total = (d.success || 0) + (d.fail || 0)
    const totalH = (total / maxVal) * plotH
    const succH = total > 0 ? ((d.success || 0) / maxVal) * plotH : 0
    const failH = totalH - succH

    const yBase = gridY0
    const ySucc = yBase - succH
    const yFail = ySucc - failH

    if (succH > 0) {
      barsHtml += `<rect x="${x.toFixed(1)}" y="${ySucc.toFixed(1)}" width="${colW.toFixed(1)}" height="${succH.toFixed(1)}" rx="1.5" style="fill:var(--status-ok-dot)"/>`
    }
    if (failH > 0) {
      barsHtml += `<rect x="${x.toFixed(1)}" y="${yFail.toFixed(1)}" width="${colW.toFixed(1)}" height="${failH.toFixed(1)}" rx="1.5" style="fill:var(--status-err-dot)"/>`
    }

    const dateLabel = (d.date || '').slice(5) || String(i + 1)
    if (i % 2 === 0 || i === days.length - 1) {
      labelsHtml += `<text x="${(x + colW / 2).toFixed(1)}" y="${height - 6}" font-size="10" style="fill:var(--ink-tertiary)" font-family="var(--font-mono)" text-anchor="middle">${esc(dateLabel)}</text>`
    }
  })

  return `
    <div class="trend-card">
      ${head}
      <div class="svg-container">
        <svg viewBox="0 0 ${width} ${height}" class="trend-svg" role="img" aria-label="近 14 天签到走势柱状图">
          <line x1="${padLeft}" y1="${gridY1}" x2="${width - padRight}" y2="${gridY1}" stroke="var(--line-dim)" stroke-dasharray="3 3"/>
          <line x1="${padLeft}" y1="${gridY0}" x2="${width - padRight}" y2="${gridY0}" stroke="var(--line-strong)"/>
          <text x="${padLeft - 6}" y="${gridY1 + 3}" font-size="9" font-family="var(--font-mono)" style="fill:var(--ink-tertiary)" text-anchor="end">${Math.round(maxVal / 2)}</text>
          <text x="${padLeft - 6}" y="${padTop + 6}" font-size="9" font-family="var(--font-mono)" style="fill:var(--ink-tertiary)" text-anchor="end">${maxVal}</text>
          ${barsHtml}
          ${labelsHtml}
        </svg>
      </div>
    </div>`
}

/** 最近活动流水表行（总览页与历史页共用） */
export function renderRecentRows(recent: Array<any>): string {
  const list = recent || []
  if (!list.length) return `<tr><td colspan="4" class="cell-empty">还没有签到记录</td></tr>`
  return list.map((r: any) => {
    const ok = isSuccess(r.result)
    const badge = ok
      ? '<span class="status-pill is-ok"><span class="pill-dot"></span><span class="pill-text">成功</span></span>'
      : '<span class="status-pill is-err"><span class="pill-dot"></span><span class="pill-text">失败</span></span>'
    return `
      <tr class="history-row" data-ok="${ok ? '1' : '0'}" data-type="${esc(String(r.type || ''))}">
        <td class="cell-sub" data-label="时间">${esc(fmtTime(r.timestamp))}</td>
        <td class="cell-main" data-label="课程">${esc(r.courseName || '未知课程')}</td>
        <td class="cell-sub" data-label="类型">${esc(typeText(r.type))}</td>
        <td class="cell-sub" data-label="结果">${badge}</td>
      </tr>`
  }).join('')
}

export interface CourseRowCtx {
  watching: boolean
  fails: number
  runtimeReady: boolean
  accountsEmpty: boolean
  cookieValid?: boolean
  listening?: boolean
  window?: { known: boolean; text: string; samples: number }
  isRetired?: boolean
}

/**
 * 课程行：状态 Pill 完整语义闭环 + 静音开关（乐观更新由客户端处理）。
 * 技术 ID 收敛为次级可复制标签，释放主视线给「上课时段 / 状态」。
 */
export function renderCourseRow(course: { courseName: string; courseId: number | string; classId: number | string }, ctx: CourseRowCtx): string {
  const cid = String(course.courseId)
  let pill: string
  if (!ctx.watching) {
    pill = renderStatusPill('idle', ctx.isRetired ? '已结课停用' : '已手动暂停')
  } else if (!ctx.runtimeReady) {
    pill = renderStatusPill('warn', ctx.accountsEmpty ? '未配置账号' : ctx.cookieValid === false ? '登录需核验' : '已暂停监听')
  } else if (ctx.fails >= 3) {
    pill = renderStatusPill('err', `扫描异常 (${ctx.fails})`, '近期轮询多次失败，多为瞬时网络或网关限流，已自动重试；持续异常可点击「重新拉取课程列表」')
  } else if (ctx.window && ctx.window.known) {
    pill = renderStatusPill('ok', '监控中')
  } else {
    pill = renderStatusPill('ok', '监控中')
  }

  const w = ctx.window
  const windowCell = w
    ? (w.known
      ? `<span class="window-pill" title="共 ${w.samples} 次观测；仅此时段轮询（另有每日兜底扫描）">${ICONS.clock}<span>${esc(w.text)}</span></span>`
      : `<span class="window-pill is-soft" title="观测不足，暂按全天轮询；积累 ${w.samples} 次后自动收敛">${ICONS.clock}<span>${esc(w.text)}</span></span>`)
    : '<span class="cell-sub">—</span>'

  return `
    <tr class="course-row" data-course-id="${esc(cid)}">
      <td class="col-course-main">
        <div class="course-name-line"><span class="course-title">${esc(course.courseName)}</span></div>
        <div class="course-sub-line">
          <button type="button" class="mono-meta" data-copy="${esc(cid)}" title="点击复制 CourseID">CID: ${esc(cid)}</button>
          <button type="button" class="mono-meta" data-copy="${esc(String(course.classId))}" title="点击复制 ClassID">班级: ${esc(String(course.classId))}</button>
        </div>
      </td>
      <td class="col-course-window" data-label="签到时段">${windowCell}</td>
      <td class="col-course-status" data-label="状态">${pill}</td>
      <td class="col-course-actions" data-label="监听">
        <label class="switch-control" title="切换此课程监听状态">
          <input type="checkbox" ${ctx.watching ? 'checked' : ''} data-cid="${esc(cid)}" aria-label="切换课程监听">
          <span class="switch-track"></span>
        </label>
        <button type="button" class="btn-subtle-icon" data-detail="${esc(course.courseName)}" title="查看历史记录与备注" aria-label="查看课程详情">${ICONS.more}</button>
      </td>
    </tr>`
}

/** 账号行（总览页运行卡片） */
export function renderAccountRow(a: { username: string; name?: string; schoolname?: string }, opts?: { primary?: boolean }): string {
  const nm = a.name || a.username || '?'
  return `
    <div class="acct-row">
      <span class="acct-avatar">${esc(nm.slice(0, 1))}</span>
      <div class="acct-info">
        <div class="acct-name">${esc(nm)}${opts?.primary ? ' <span class="status-pill is-ok"><span class="pill-dot"></span><span class="pill-text">主账号</span></span>' : ''}</div>
        <div class="acct-sub">${esc(a.schoolname || '')} · ${esc(a.username)}</div>
      </div>
    </div>`
}
