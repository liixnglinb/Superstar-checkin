// 更新说明的纯文本化：GitHub Release 正文是 markdown，而软件内的「更新说明」面板
// 是 white-space:pre-wrap 的纯文本（见 src/server/console-ui.ts 的 updHoverBody / notes 渲染），
// 不转就是屏幕上出现 ### 和 ** 这些装饰符。
// 只做"去掉装饰、不丢内容"的降级：链接保留文字，文字与地址不同时把地址放括号里。

function updateNotesToPlainText(md) {
  let s = String(md == null ? '' : md).replace(/\r\n/g, '\n')
  if (!s.trim()) return ''

  s = s.replace(/^```[^\n]*\n?/gm, '')            // 代码围栏标记行
  s = s.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, '')  // 图片：纯文本里没意义，整段去掉
  s = s.replace(/\[([^\]]+)\]\(([^)]*)\)/g, (m, text, url) => {
    const t = text.trim()
    const u = String(url || '').trim()
    if (!u || u === t) return t
    return `${t}（${u}）`
  })
  s = s.replace(/^#{1,6}[ \t]+/gm, '')            // 标题井号
  s = s.replace(/^[ \t]*> ?/gm, '')               // 引用竖线
  s = s.replace(/^[ \t]*([-*_])[ \t]*\1[ \t]*\1[ \t-]*$/gm, '') // 分割线
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1')         // 粗体
  s = s.replace(/__([^_]+)__/g, '$1')
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1$2') // 斜体（不动列表项的 "- *"）
  s = s.replace(/`([^`\n]+)`/g, '$1')             // 行内代码反引号
  s = s.replace(/[ \t]+\n/g, '\n')
  s = s.replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

module.exports = { updateNotesToPlainText }
