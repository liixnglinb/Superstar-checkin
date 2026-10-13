/**
 * Voyra UI foundation v3 · 学习通自动签到专属设计系统
 *
 * 定位：深空工作台（Deep Desk）—— 中性近黑画布 + 发丝线卡片 + 侧栏三段式 + 页头四要素，
 * 保留超星暖橙作为品牌 accent。契约见主仓库 D:/Voyra 个人网站/docs/voyra-suite-design-language.md
 * （Voyra 套件设计语言 v1），本文件落地该契约的「学习通自动签到」一份：
 * 中性色阶 / 字阶 / 间距 / 圆角 / 动效按 §3 全套件规范，accent 暖橙按 §4 保留。
 *
 * 说明（Voyra 个人网站说明 §2.7，2026-10-03）：五款软件自 2026-10-03 起不再共用任何 UI 源文件或生成副本，
 * 每款软件的设计系统由各自仓库独立维护。本文件即本软件自己的唯一 UI 数值来源，
 * 不再是任何源的副本；是否改名 / 内联由本软件自行决定。
 *
 * 本文件只承载三样东西：
 *   1. 完整 Design Tokens（深浅双模，深色为默认档）——色彩 / 字阶 / 间距 / 圆角 / 阴影 / 动效；
 *   2. 无障碍基础层——focus-visible 默认、reduced-motion、sr-only；
 *   3. 模态框无障碍契约脚本（聚焦管理 / Esc 关闭 / Tab 循环）。
 * 组件样式一律写在 console-ui.ts 里，使用这里的 Token，不再有第二份数值。
 *
 * 对比度（按套件规范 §3 核算，WCAG AA）：正文 ≥ 4.5:1、图形 ≥ 3:1；
 * 弱文字档（--ink-tertiary）是核算后刚好过线的值，不许再降。
 */

export const VOYRA_UI_CSS = `/* ============================================================
   Voyra UI foundation v3 · Design Tokens（深空工作台 Deep Desk）
   默认深色档由 <html data-theme="dark"> + initTheme() 落定（见 console-ui.ts）
   ============================================================ */
:root {
  /* ================= 色彩体系（浅色档 · 对等档，不是深色的反转） ================= */
  --bg-canvas: #F5F5F6;       /* 画布底色 */
  --bg-surface: #FFFFFF;      /* 一级卡片/面板/侧栏 */
  --bg-surface-sub: #EFEFF1;  /* 二级沉底背景/输入框未聚焦底色 */
  --bg-surface-hover: #E9E9EC;/* 悬停提亮 */

  --ink-primary: #18181B;    /* 主文字 */
  --ink-secondary: #55565C;  /* 次级文本 */
  --ink-tertiary: #77777F;   /* 弱化文本/元信息（4.6:1 on white，下限值不许再降） */
  --ink-inverse: #FFFFFF;    /* 反白文字 */

  --line-dim: #E3E3E7;       /* 发丝线（分区） */
  --line-strong: #D4D4D9;    /* 结构描边/输入框外边框 */
  --line-focus: rgba(24, 24, 27, 0.45);   /* 键盘聚焦描边 */
  --ring-focus: 0 0 0 2px rgba(24, 24, 27, 0.45);  /* 焦点环：2px 实边 */

  /* 单一品牌色（超星暖橙，产品身份；浅色沿用已校对的深橙文字档） */
  --brand-50: #FFF7ED;
  --brand-100: #FFEDD5;
  --brand-500: #F78A46;
  --brand-600: #EF7429;
  --brand-700: #C25E1A;

  /* 语义色（仅用于状态与警告）。
     无障碍约束（Voyra 说明 §0.9 第 3 条）：-dot 系列是低对比度色，只可用于
     色块 / 描边 / 圆点 / 图标 / SVG 填充，**不承载小字**；
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

  /* ================= 字阶体系（套件规范 §3.3：8 档，不造第 9 档） ================= */
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;

  --text-2xs: 11px;   /* 元信息 */
  --text-xs: 12px;    /* 卡标题辅助/标签 */
  --text-sm: 13px;    /* 正文 */
  --text-base: 14px;  /* 卡标题 */
  --text-md: 16px;
  --text-lg: 20px;    /* 页标题 */
  --text-xl: 24px;    /* 统计数字 */
  --text-2xl: 28px;

  /* ================= 间距系统（套件规范 §3.3） ================= */
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 20px;
  --sp-6: 24px;
  --sp-8: 32px;
  --sp-10: 40px;

  /* ================= 圆角体系（控件8 / 卡12 / 浮层16 / 胶囊999） ================= */
  --r-xs: 8px;    /* 控件 */
  --r-sm: 8px;    /* 控件 */
  --r-md: 12px;   /* 卡片/卡内沉底 */
  --r-lg: 12px;   /* 卡片 */
  --r-xl: 16px;   /* 浮层（弹窗/抽屉/浮出卡片） */
  --r-full: 999px;/* 胶囊 */

  /* ================= 阴影体系（仅浮层允许阴影 + 1px 结构线；卡片只靠发丝线） ================= */
  --shadow-sm: 0 1px 2px rgba(24, 24, 27, 0.05);
  --shadow-md: 0 8px 24px -12px rgba(24, 24, 27, 0.18);
  --shadow-lg: 0 16px 40px -12px rgba(24, 24, 27, 0.22);
  --shadow-modal: 0 24px 60px -12px rgba(24, 24, 27, 0.24), 0 0 0 1px #D4D4D9;

  /* ================= 动效时长与曲线（120 状态 / 180 入场显隐 / 240 浮层） ================= */
  --ease-spring: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --dur-fast: 120ms;
  --dur-base: 180ms;
  --dur-slow: 240ms;

  color-scheme: light;
}

/* ================= 深色档（默认主题 · 旗舰档） ================= */
[data-theme="dark"] {
  --bg-canvas: #0B0B0E;      /* 应用画布：中性近黑 */
  --bg-surface: #131318;     /* 卡片/面板/侧栏 */
  --bg-surface-sub: #1A1B20; /* 卡内沉底、输入框、表头 */
  --bg-surface-hover: #22242B;/* 悬停/按压提亮 */

  --ink-primary: #F4F4F5;    /* 主文字（15.8:1 on canvas） */
  --ink-secondary: #A7AAB1;  /* 次文字（8.5:1） */
  --ink-tertiary: #80828B;   /* 弱文字/元信息（5.1:1 on canvas，下限值不许再降） */
  --ink-inverse: #0B0B0E;    /* 实心面上的反相文字 */

  --line-dim: rgba(255, 255, 255, 0.07);     /* 发丝线（分区） */
  --line-strong: rgba(255, 255, 255, 0.13);  /* 输入框/结构描边 */
  --line-focus: rgba(255, 255, 255, 0.55);
  --ring-focus: 0 0 0 2px rgba(255, 255, 255, 0.55);

  /* 品牌暖橙（产品身份）：深色档主 accent 提到 #F5884A 量级 */
  --brand-50: #241B14;
  --brand-100: #322117;
  --brand-500: #F5884A;
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

  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.30);
  --shadow-md: 0 8px 24px -12px rgba(0, 0, 0, 0.60);
  --shadow-lg: 0 16px 40px -12px rgba(0, 0, 0, 0.66);
  --shadow-modal: 0 24px 60px -12px rgba(0, 0, 0, 0.72), 0 0 0 1px rgba(255, 255, 255, 0.13);

  color-scheme: dark;
}

/* ============================================================
   基础层与无障碍
   ============================================================ */
*, *::before, *::after { box-sizing: border-box; }

html { -webkit-text-size-adjust: 100%; }

/* 键盘焦点可见：2px 实边聚焦环；鼠标点击不显示（:focus-visible 语义） */
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
   动效规范：强制遵循 prefers-reduced-motion（降为 0.01ms，
   入场动画元素随之落到终态 keyframe）
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
