// 更新说明的纯文本化：GitHub Release 正文是 markdown，而软件内的「更新说明」面板
// 是 white-space:pre-wrap 的纯文本（见 src/server/console-ui.ts 的 updHoverBody / notes 渲染），
// 不转就是屏幕上出现 ### 和 ** 这些装饰符。
// 只做"去掉装饰、不丢内容"的降级：链接保留文字，文字与地址不同时把地址放括号里。
//
// 两个顺序坑（都是拿线上真实 Release 正文测出来的，改这里前先跑 tests/update-notes.test.js）：
//   1. 行内代码与围栏代码里的 * 、# 是字面量（正文里就写过 "`**`" 来解释装饰符本身），
//      必须先换成占位符保护、最后还原，否则会被斜体规则啃掉。
//   2. 强调规则不能跨行：字符类一旦允许换行，前一个小标题的结尾 ** 会和后一个小标题的
//      开头 ** 配对，中间整段被当成加粗内容，最后留下一个孤立的 **。

function updateNotesToPlainText(md) {
  let s = String(md == null ? '' : md).replace(/\r\n/g, '\n')
  if (!s.trim()) return ''
  const keep = []
  const stash = (txt) => { keep.push(txt); return '@@UPDK' + (keep.length - 1) + 'KPDU@@' }

  s = s.replace(/```[^\n]*\n([\s\S]*?)```/g, (m, code) => stash(code.replace(/\n+$/, '')))
  s = s.replace(/`([^`\n]+)`/g, (m, code) => stash(code))
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  s = s.replace(/\[([^\]]+)\]\(([^)]*)\)/g, (m, text, url) => {
    const t = text.trim()
    const u = String(url || '').trim()
    return stash(!u || u === t ? t : t + '（' + u + '）')
  })
  s = s.replace(/^#{1,6}[ \t]+/gm, '')            // 标题井号
  s = s.replace(/^[ \t]*> ?/gm, '')               // 引用竖线
  s = s.replace(/^[ \t]*([-*_])[ \t]*\1[ \t]*\1[ \t-]*$/gm, '') // 分割线
  s = s.replace(/\*\*([^\n*]+)\*\*/g, '$1')       // 粗体（不跨行）
  s = s.replace(/__([^\n_]+)__/g, '$1')
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1$2') // 斜体（不动列表项的 "- *"）
  s = s.replace(/(^|[^_\w])_([^_\n]+)_(?![_\w])/g, '$1$2')
  s = s.replace(/@@UPDK(\d+)KPDU@@/g, (m, i) => (keep[Number(i)] == null ? m : keep[Number(i)]))
  s = s.replace(/[ \t]+\n/g, '\n')
  s = s.replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

module.exports = { updateNotesToPlainText }
