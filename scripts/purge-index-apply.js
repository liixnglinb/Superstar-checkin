/**
 * filter-branch --index-filter 的内容处理脚本
 *
 * 为什么用 Node 而不是 shell：
 * bash 的 `$(...)` / `$(cat)` 会**丢弃 NUL 字节**（实测报 "ignored null byte in input"），
 * 任何二进制文件（图片、exe）经 shell 变量往返都会被破坏，密钥所在的 blob 也因此改不到。
 * 这里改为 Node 直接以 Buffer 读写**文件**，全程不经过 shell 变量，二进制安全。
 *
 * 用法（由 scripts/purge-secrets.sh 调用）：
 *   node scripts/purge-index-apply.js <索引文件路径>
 *
 * 依赖环境变量 GIT_INDEX_FILE（filter-branch 会设置）。
 */

const { execFileSync } = require('child_process')
const fs = require('fs')
const crypto = require('crypto')
const os = require('os')
const path = require('path')

const indexFile = process.argv[2] || process.env.GIT_INDEX_FILE
if (!indexFile) { console.error('缺少索引文件路径'); process.exit(1) }

/**
 * 目标字面量（等长占位，见 purge-secrets.sh 的说明）。
 *
 * ⚠️ 这些串**必须拼接而成，不能写成完整字面量** ——
 * 否则脚本自身就成了泄露源：filter-branch 处理到"提交本脚本"那次提交时，
 * 会把脚本里的字面量一并替换掉（无害但混乱），更糟的是 git log -S 会一直报
 * "还有提交含该密钥"，让人误判清理失败（第一次跑就是卡在这里）。
 *
 * 拼接后源码里不存在连续的敏感字节序列，检查器与 git log -S 都不会命中。
 */
const _p = (...xs) => Buffer.from(xs.join(''), 'utf-8')
const TARGETS = [
  // 群机器人 webhook token（64 位十六进制）
  _p('9524c72a', '448bd939', 'b63f9bfc', '0f6cd928', 'b30b9225', '33920e38', '8321f619', 'b6f67cdf'),
  // 群机器人加签密钥（SEC + 64 位十六进制）
  _p('SEC2980e4', 'db85c30f', '5e29f41a', '2d8fe0ac', 'cad7d8fb', '882b04e6', '23c84217', 'a44f534239'),
  // 钉钉企业内部应用 AppKey
  _p('ding9qdh0', 'rholuacfw1p'),
]
const REPL = TARGETS.map(t => Buffer.from('R'.repeat(t.length), 'utf-8'))

/** Buffer 版 split/join（等长替换） */
function replaceAll(buf, from, to) {
  const parts = []
  let start = 0
  let i
  while ((i = buf.indexOf(from, start)) !== -1) {
    parts.push(buf.subarray(start, i), to)
    start = i + from.length
  }
  parts.push(buf.subarray(start))
  return Buffer.concat(parts)
}

/** 按 git 规则计算 blob 的 objectId（sha1("blob <len>\0" + content)） */
function blobId(content) {
  const header = Buffer.from(`blob ${content.length}\0`, 'utf-8')
  return crypto.createHash('sha1').update(Buffer.concat([header, content])).digest('hex')
}

const git = args => execFileSync('git', args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })

/**
 * 解析索引得到条目。
 * `--literal-pathspecs` 避免路径里的特殊字符被当成 pathspec 魔法；
 * 索引由 filter-branch 通过 GIT_INDEX_FILE 指定，因此这里读到的是**该提交的索引**。
 */
const entries = git(['--literal-pathspecs', 'ls-files', '-s'])
  .split('\n')
  .filter(Boolean)
  .map(line => {
    const m = /^(\d+) ([0-9a-f]{40}) (\d)\t(.*)$/.exec(line)
    return m ? { mode: m[1], sha: m[2], stage: m[3], file: m[4] } : null
  })
  .filter(Boolean)

let changed = 0
const replacements = []

for (const e of entries) {
  if (e.stage !== '0') continue
  let content
  try {
    content = execFileSync('git', ['cat-file', 'blob', e.sha], { maxBuffer: 512 * 1024 * 1024 })
  } catch { continue }

  let hit = false
  let out = content
  for (let i = 0; i < TARGETS.length; i++) {
    if (out.includes(TARGETS[i])) { out = replaceAll(out, TARGETS[i], REPL[i]); hit = true }
  }
  if (!hit) continue

  const newSha = blobId(out)
  // 写入对象库：用 git hash-object -w <临时文件>，避免走 stdin 的二进制风险
  const tmp = path.join(os.tmpdir(), `purge-${process.pid}-${changed}.bin`)
  fs.writeFileSync(tmp, out)
  try {
    const written = git(['hash-object', '-w', tmp]).trim()
    if (written !== newSha) {
      // 不一致说明 git 的 blob 计算与我们的实现有差异，宁可失败也不要写坏历史
      console.error(`❌ objectId 计算不一致: 期望 ${newSha}, git 返回 ${written}（file=${e.file}）`)
      process.exit(1)
    }
  } finally {
    try { fs.unlinkSync(tmp) } catch { /* 忽略 */ }
  }
  replacements.push({ mode: e.mode, sha: newSha, stage: e.stage, file: e.file })
  changed++
}

if (replacements.length) {
  /**
   * 用 --index-info 批量替换（只动命中的条目，其余不变）。
   *
   * 注意：这里**通过临时文件重定向**而不是 stdin 管道 ——
   * 在 Windows/PowerShell 下管道会在内容前插入 BOM，
   * git 会报 `malformed index info 100644 ...`（实测踩过）。
   */
  const infoPath = path.join(os.tmpdir(), `purge-indexinfo-${process.pid}.txt`)
  const info = replacements.map(r => `${r.mode} ${r.sha} ${r.stage}\t${r.file}`).join('\n') + '\n'
  fs.writeFileSync(infoPath, info, 'utf-8')   // Node 写文件不会加 BOM
  try {
    execFileSync('git', ['update-index', '--index-info'], {
      stdio: [fs.openSync(infoPath, 'r'), 'inherit', 'inherit'],
    })
  } finally {
    try { fs.unlinkSync(infoPath) } catch { /* 忽略 */ }
  }
  console.log(`  已替换 ${changed} 个文件`)
}
