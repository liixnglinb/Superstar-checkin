/**
 * Voyra UI foundation v2 · 学习通自动签到专属设计系统
 *
 * 定位：Grounded Quiet Utility（克制、静默的专业工具）。
 * 参考系：Apple macOS 系统设置（Ventura/Sonoma）+ CleanMyMac 状态监视器 + Home Assistant Dashboard。
 *
 * 说明（Voyra 个人网站说明 §2.7，2026-10-03）：五款软件自 2026-10-03 起不再共用任何 UI 源文件或生成副本，
 * 每款软件的设计系统由各自仓库独立维护。本文件即本软件自己的唯一 UI 数值来源，
 * 不再是任何源的副本；是否改名 / 内联由本软件自行决定。
 *
 * 本文件只承载三样东西：
 *   1. 完整 Design Tokens（冷暖双模）——色彩 / 字阶 / 间距 / 圆角 / 阴影 / 动效；
 *   2. 无障碍基础层——focus-visible 默认、reduced-motion、sr-only；
 *   3. 模态框无障碍契约脚本（聚焦管理 / Esc 关闭 / Tab 循环）。
 * 组件样式一律写在 console-ui.ts 里，使用这里的 Token，不再有第二份数值。
 */

export const VOYRA_UI_CSS = `/* ============================================================
   Voyra UI foundation v2 · Design Tokens
   ============================================================ */
:root {
  /* ================= 色彩体系 (Light Mode) ================= */
  --bg-canvas: #F8F7F4;       /* 画布底色：暖白 */
  --bg-surface: #FFFFFF;      /* 一级卡片/面板底色 */
  --bg-surface-sub: #F2EFE9;  /* 二级沉底背景/输入框未聚焦底色 */
  --bg-surface-hover: #ECE8E0;/* 悬停浅底 */

  --ink-primary: #1C1917;    /* 正文字体色：极深暖墨 */
  --ink-secondary: #57534E;  /* 次级文本：石板灰 */
  --ink-tertiary: #A8A29E;   /* 占位/弱化文本 */
  --ink-inverse: #FFFFFF;    /* 反白文字 */

  --line-dim: #E7E5E0;       /* 微弱分隔线 */
  --line-strong: #D6D3CD;    /* 结构描边/输入框外边框 */
  --line-focus: #F78A46;     /* 聚焦高亮线 */
  --ring-focus: 0 0 0 2px rgba(239, 116, 41, 0.30);  /* 焦点环（输入框/课表格） */

  /* 单一品牌色（超星暖橙） */
  --brand-50: #FFF7ED;
  --brand-100: #FFEDD5;
  --brand-500: #F78A46;      /* 主品牌高亮 */
  --brand-600: #EF7429;      /* 主品牌强调/按压态 */
  --brand-700: #C25E1A;

  /* 语义色（仅用于状态与警告）。
     无障碍约束（Voyra 说明 §0.9 第 3 条）：-dot 系列是低对比度色
     （--status-ok-dot #10B981 约 2.3:1、--status-warn-dot #F59E0B 约 2.0:1，均低于 WCAG AA 正文 4.5:1），
     只可用于色块 / 描边 / 圆点 / 图标 / SVG 填充，**不承载小字**；
     需要给文字着色时一律用对应的 -ink（深色高对比，如 #065F46 / #92400E）。 */
  --status-ok-bg: #EDFDF5;
  --status-ok-line: #A7F3D0;
  --status-ok-ink: #065F46;
  --status-ok-dot: #10B981;

  --status-warn-bg: #FFFBEB;
  --status-warn-line: #FDE68A;
  --status-warn-ink: #92400E;
  --status-warn-dot: #F59E0B;

  --status-err-bg: #FEF2F2;
  --status-err-line: #FECACA;
  --status-err-ink: #991B1B;
  --status-err-dot: #EF4444;

  --status-idle-bg: #F5F5F4;
  --status-idle-line: #E7E5E4;
  --status-idle-ink: #78716C;
  --status-idle-dot: #A8A29E;

  /* ================= 字阶体系 (Modular Type Scale) ================= */
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;

  --text-2xs: 11px;
  --text-xs: 12px;
  --text-sm: 13px;
  --text-base: 14px;
  --text-md: 16px;
  --text-lg: 18px;
  --text-xl: 22px;
  --text-2xl: 28px;

  /* ================= 间距系统 (8pt 网格) ================= */
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 20px;
  --sp-6: 24px;
  --sp-8: 32px;
  --sp-10: 40px;

  /* ================= 圆角体系 ================= */
  --r-xs: 4px;
  --r-sm: 6px;
  --r-md: 10px;
  --r-lg: 14px;
  --r-xl: 20px;
  --r-full: 9999px;

  /* ================= 阴影体系 ================= */
  --shadow-sm: 0 1px 2px rgba(28, 25, 23, 0.04);
  --shadow-md: 0 3px 6px -1px rgba(28, 25, 23, 0.06), 0 2px 4px -2px rgba(28, 25, 23, 0.04);
  --shadow-lg: 0 10px 15px -3px rgba(28, 25, 23, 0.08), 0 4px 6px -4px rgba(28, 25, 23, 0.03);
  --shadow-modal: 0 20px 25px -5px rgba(28, 25, 23, 0.12), 0 8px 10px -6px rgba(28, 25, 23, 0.08);

  /* ================= 动效时长与曲线 ================= */
  --ease-spring: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --dur-fast: 120ms;
  --dur-base: 180ms;
  --dur-slow: 240ms;

  color-scheme: light;
}

/* ================= Dark Mode Overrides ================= */
[data-theme="dark"] {
  --bg-canvas: #141210;
  --bg-surface: #211E1B;
  --bg-surface-sub: #282420;
  --bg-surface-hover: #332F2A;

  --ink-primary: #F5F5F4;
  --ink-secondary: #A8A29E;
  /* 原 #78716C 在卡面上只有 3.58:1，承载的是节次/时间等小字，提到 4.9:1 才过 WCAG AA */
  --ink-tertiary: #8E8880;
  --ink-inverse: #1C1917;

  --line-dim: #33302C;
  --line-strong: #44403C;
  --line-focus: #F78A46;
  /* 焦点环：2px 实边比 3px 半透明晕圈更清晰，也不会在深色底上糊成一片光晕 */
  --ring-focus: 0 0 0 2px rgba(247, 138, 70, 0.42);

  --brand-50: #241B14;
  --brand-100: #322117;
  --brand-500: #F78A46;
  --brand-600: #EF7429;
  --brand-700: #FF9B5E;

  /* 语义底色降彩度：深色模式下高彩度的橙/绿/红底会把整块面板照成"发光"，
     这里只保留可辨识的色相倾向，状态本身由 -dot / -ink 承担。 */
  --status-ok-bg: #16241E;
  --status-ok-line: #2E463C;
  --status-ok-ink: #6EE7B7;
  --status-ok-dot: #34D399;

  --status-warn-bg: #26201A;
  --status-warn-line: #4A3A26;
  --status-warn-ink: #FCD34D;
  --status-warn-dot: #FBBF24;

  --status-err-bg: #271918;
  --status-err-line: #4A2C29;
  --status-err-ink: #FCA5A5;
  --status-err-dot: #F87171;

  --status-idle-bg: #292524;
  --status-idle-line: #44403C;
  --status-idle-ink: #A8A29E;
  --status-idle-dot: #78716C;

  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.25);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.35);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.45);
  --shadow-modal: 0 20px 25px -5px rgba(0, 0, 0, 0.6);

  color-scheme: dark;
}

/* ============================================================
   基础层与无障碍
   ============================================================ */
*, *::before, *::after { box-sizing: border-box; }

html { -webkit-text-size-adjust: 100%; }

/* 键盘焦点可见：统一走品牌聚焦环；鼠标点击不显示（:focus-visible 语义） */
:focus-visible {
  outline: 2px solid var(--line-focus);
  outline-offset: 2px;
  border-radius: var(--r-xs);
}

/* 屏幕阅读器专用：视觉隐藏但可被读屏读取 */
.sr-only {
  position: absolute !important;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0);
  white-space: nowrap; border: 0;
}

/* 文本选择与滚动条主题化（Chromium） */
::selection { background: rgba(247, 138, 70, 0.18); }

/* 统一滚动条：与画布同族，弱化存在感 */
*::-webkit-scrollbar { width: 10px; height: 10px; }
*::-webkit-scrollbar-track { background: transparent; }
*::-webkit-scrollbar-thumb {
  background: var(--line-strong);
  border-radius: var(--r-full);
  border: 2px solid var(--bg-canvas);
}
*::-webkit-scrollbar-thumb:hover { background: var(--ink-tertiary); }

/* ============================================================
   动效规范（模块 12）：强制遵循 prefers-reduced-motion
   ============================================================ */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`

/**
 * 模态框无障碍契约（跨页面复用，绝不执行任何业务动作）。
 *
 * 职责：自动识别可见弹窗 → 标注 role/aria-modal → 聚焦首个安全元素 → Tab 焦点闭环 →
 * Esc 触发关闭按钮 → 关闭后把焦点归还给打开它的元素。MutationObserver 自动跟踪。
 * 业务侧的打开 / 关闭逻辑仍由 console-ui.ts 自己负责，这里只做「焦点与语义」。
 */
export const VOYRA_UI_JS = `/* Shared modal contract for server-rendered apps. Never performs business actions. */
(() => {
  'use strict';
  const records = new Map();
  let stack = [], stamp = 0, frame = 0;
  const selector = '.modal-mask .modal,.modal.open .modal-box,.detail-modal-box,.up-card';
  const isVisible = (node) => node.isConnected && !node.closest('[hidden]') && node.getClientRects().length > 0;
  const items = (node) => [...node.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter(isVisible);
  const safelyFocus = (node) => {
    const safe = node.querySelector('[data-safe-focus],.modal-close:not(:disabled),.modal-x:not(:disabled),#disclaimerReject:not(:disabled),#updateLater:not(:disabled)');
    (safe && isVisible(safe) ? safe : node).focus({preventScroll:true});
  };
  const sync = () => {
    frame = 0;
    for (const [node, record] of records) {
      if (!isVisible(node)) {
        records.delete(node);
        if (record.restore?.isConnected) record.restore.focus({preventScroll:true});
      }
    }
    document.querySelectorAll(selector).forEach((node) => {
      if (!isVisible(node) || records.has(node)) return;
      node.setAttribute('role',node.getAttribute('role')||'dialog');
      node.setAttribute('aria-modal','true');node.tabIndex=-1;
      const heading=node.querySelector('h1,h2,h3,.modal-title,.detail-modal-title');
      if (heading) {if(!heading.id)heading.id='voyra-dialog-heading-'+(++stamp);node.setAttribute('aria-labelledby',heading.id);}
      else if (!node.getAttribute('aria-label') && !node.getAttribute('aria-labelledby')) node.setAttribute('aria-label','操作详情');
      node.querySelectorAll('.modal-close,.modal-x').forEach((button)=>{if(!button.getAttribute('aria-label'))button.setAttribute('aria-label','关闭弹窗');});
      records.set(node,{restore:document.activeElement instanceof HTMLElement?document.activeElement:null});
      safelyFocus(node);
    });
    stack=[...records.keys()];
  };
  const requestSync = () => {if(!frame)frame=requestAnimationFrame(sync);};
  const observer=new MutationObserver(requestSync);
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class','hidden','disabled']});
  document.addEventListener('keydown',(event)=>{
    const node=stack[stack.length-1];if(!node||!isVisible(node))return;
    if(event.key==='Tab'){
      const options=items(node),first=options[0],last=options[options.length-1];
      if(!first){event.preventDefault();node.focus();return;}
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===node)){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||!node.contains(document.activeElement))){event.preventDefault();first.focus();}
    }
    if(event.key==='Escape'){
      const close=node.querySelector('.modal-close:not(:disabled),.modal-x:not(:disabled),[data-dialog-close]:not(:disabled)');
      if(node.getAttribute('aria-busy')==='true') {event.preventDefault();event.stopImmediatePropagation();return;}
      if(close){event.preventDefault();event.stopImmediatePropagation();close.click();}
    }
  },true);
  sync();
})();`
