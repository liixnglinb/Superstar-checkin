#!/usr/bin/env node
/**
 * 提交前敏感信息检查（防再犯）
 *
 * 背景：2026-09-19 排查钉钉图片通道时，我把用户给我的群机器人 webhook 与加签密钥
 * 硬编码进了一个验证脚本并提交到**公开仓库**（commit e023445，含在 v3.7.0 发布里）。
 * 事后删文件也没用 —— 历史仍然可查。这次加自动检查，从机制上避免同类事故。
 *
 * 注意：本文件内的示例串必须保持"不匹配真实密钥格式"（见下方 dingExampleAppKeyHere），
 * 否则检查器自身会变成泄露源 —— 第一版就犯过这个错。
 *
 * 用法：
 *   node scripts/check-secrets.js          # 检查暂存区（pre-commit 用）
 *   node scripts/check-secrets.js --all    # 检查工作区所有受版本控制的文件
 *
 * 退出码非 0 即表示发现疑似密钥，提交会被阻止。
 */

const { execFileSync } = require('child_process')
const fs = require('fs')

const MODE_ALL = process.argv.includes('--all')

/** 命中的规则 */
const RULES = [
  { name: '钉钉群机器人 token', re: /oapi\.dingtalk\.com\/robot\/send\?access_token=[a-f0-9]{32,}/i },
  { name: '钉钉加签密钥', re: /SEC[0-9a-f]{40,}/i },
  // 真实 AppKey 形如 ding + 一长串小写字母数字（此处不写真实值，避免检查器自身成为泄露源）。
  // 后接驼峰（dingtalkStream、DingTalkListener）是标识符，不是密钥，故用 (?![A-Z]) 排除。
  { name: '钉钉企业内部应用 AppKey', re: /\bding[a-z0-9]{14,}(?![A-Za-z0-9])/ },
  { name: '钉钉 AppSecret 赋值', re: /["']?appSecret["']?\s*[:=]\s*["'][A-Za-z0-9_-]{40,}["']/i },
  { name: 'GitHub PAT', re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/ },
  { name: 'GitHub fine-grained PAT', re: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/ },
  { name: '私有密钥块', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'AWS Access Key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: '腾讯云 SecretId', re: /\bAKID[0-9A-Za-z]{20,}\b/ },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: '疑似密钥硬编码赋值', re: /\b(token|secret|password|passwd|apikey|api_key)\b\s*[:=]\s*["'][A-Za-z0-9_\-]{24,}["']/i },
]

/** 不检查这些路径（文档里的字段名说明、构建产物、依赖与本地配置） */
const SKIP_PATH = [
  /^node_modules\//,
  /^build\//,
  /^dist/,
  /^\.git\//,
  /^data\//,
  /^config\.yaml$/,
  /package-lock\.json$/,
]

/**
 * 允许出现的白名单（示例值、占位符、文档中的字段名）。
 * 注意：本文件自身**不**在 SKIP_PATH 里 —— 整文件跳过会让检查器内部若混入真实密钥
 * 也永远查不出来（第一版就是这么写的，属设计缺陷）。这里用白名单精确放过自己的示例串。
 */
const ALLOW = [
  /你的\s*(PushPlus|Bark|Token|Key|邮箱|密码)/,
  /xxx+/i,
  /placeholder/i,
  /example\.com/i,
  /<[^>]+>/,
  /\.\.\./,
  /appKey:\s*""/,
  /appSecret:\s*""/,
  /token:\s*""/,
  /YOUR_|MY_|_HERE/i,
  /REPLACED_LEAKED_/,            // 历史清理后的占位
  /dingExampleAppKeyHere/,       // 本文档/检查器用的示例 AppKey
  /ding\[a-z0-9\]/,              // 检查器自身的正则字面量
  /SEC\[0-9a-f\]/,
  /ding\[0-9a-f\]/,
]

/**
 * 取受检文件清单。三条路，按优先级：
 *   1. 命令行传一个 .txt 清单文件 —— scripts/pre-commit（shell 钩子）就是这条：
 *      本机 node 无法 spawn 任何子进程（spawnSync git EBUSY，cmd.exe 同样），
 *      所以清单必须由 shell 侧 `git diff --cached --name-only` 生成后再交给本脚本；
 *   2. 自己 spawn git —— CI 与正常环境走这条；
 *   3. git 拿不到时遍历工作区源码 —— 只影响手动执行的范围（多查不少查）。
 *
 * 为什么要兜底而不是让钩子崩：钩子一崩，提交被拒的原因显示成一段 Node 堆栈，
 *      看不出是"检查没过"还是"检查器自己坏了"，人会习惯性 --no-verify，
 *      防线就废了。兜底后检查语义不变（同一份 RULES / SKIP_PATH / ALLOW）。
 *
 * 用法：
 *      git diff --cached --name-only --diff-filter=ACM > /tmp/staged.txt
 *      node scripts/check-secrets.js /tmp/staged.txt
 *      node scripts/check-secrets.js            # 暂存区（需要能 spawn git）
 *      node scripts/check-secrets.js --all      # 全仓
 */
function listFiles() {
  // 任意非选项的位置参数都当作清单文件路径（scripts/pre-commit 传的是 mktemp
  // 生成的临时文件，后缀不一定是 .txt，所以不能按扩展名认）
  const listArg = process.argv.slice(2).find((a) => !a.startsWith('-'))
  if (listArg) return readList(listArg)
  const gitArgs = MODE_ALL
    ? ['ls-files']
    : ['diff', '--cached', '--name-only', '--diff-filter=ACM']
  try {
    return execFileSync('git', gitArgs, { encoding: 'utf-8' }).split('\n').filter(Boolean)
  } catch (e) {
    if (e && (e.code === 'EBUSY' || e.status === null || /EBUSY/.test(String(e)))) {
      // 本机 node 无法 spawn git（spawnSync git EBUSY）。
      // 提交路径由 scripts/pre-commit（shell 钩子）负责生成清单再传进来；
      // 走到这里说明是直接 `node scripts/check-secrets.js` / `npm run security:check`，
      // 此时退化为遍历工作区源码 —— 宁可多查，也不能让门禁自己崩掉（崩了就会被 --no-verify）。
      console.error('⚠️  本机 node 无法 spawn git（spawnSync EBUSY），退化为遍历工作区源码。')
      console.error('    提交前的检查请交给 scripts/pre-commit：清单由 shell 生成，检查语义一致。')
      return walkWorktree()
    }
    throw e
  }
}

function readList(file) {
  if (!fs.existsSync(file)) {
    console.error(`❌ 清单文件不存在: ${file}`)
    process.exit(2)
  }
  return fs.readFileSync(file, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)
}

/**
 * git 不可用时的兜底：直接遍历工作区源码文件。
 * 只用于 `node scripts/check-secrets.js` / `npm run security:check` 这类手动执行；
 * 提交钩子走 scripts/pre-commit，拿的是精确的暂存区清单，不经过这里。
 */
function walkWorktree() {
  const out = []
  const skipDirs = [/^\.git$/, /^node_modules$/, /^build$/, /^dist$/, /^\.qoder-credits$/, /^release$/]
  const stack = ['.']
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const ent of entries) {
      const rel = dir === '.' ? ent.name : `${dir}/${ent.name}`
      if (ent.isDirectory()) {
        if (skipDirs.some(re => re.test(ent.name))) continue
        stack.push(rel)
      } else if (ent.isFile()) {
        out.push(rel)
      }
    }
  }
  return out.sort()
}

const files = listFiles().filter(f => !SKIP_PATH.some(re => re.test(f)))
const findings = []

for (const f of files) {
  if (!fs.existsSync(f)) continue
  let text
  try { text = fs.readFileSync(f, 'utf-8') } catch { continue }
  if (text.length > 800 * 1024) continue // 跳过超大文件
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (ALLOW.some(re => re.test(line))) continue
    for (const rule of RULES) {
      const m = line.match(rule.re)
      if (m) {
        const hit = m[0]
        findings.push({
          file: f,
          line: i + 1,
          rule: rule.name,
          // 只回显前 8 个字符，避免检查日志本身泄露完整密钥
          sample: hit.slice(0, 8) + '…',
        })
      }
    }
  }
}

if (findings.length) {
  console.error('\n❌ 检测到疑似敏感信息，提交已阻止：\n')
  for (const x of findings) {
    console.error(`   ${x.file}:${x.line}  [${x.rule}]  ${x.sample}`)
  }
  console.error('\n处理建议：')
  console.error('   1) 把密钥移到 config.yaml（已被 .gitignore 覆盖）或环境变量，不要写进源码')
  console.error('   2) 验证脚本里需要凭据时，从 config.yaml 或 process.env 读取')
  console.error('   3) 若该密钥已经提交过，必须去对应平台**重置密钥**——删文件无法撤回历史')
  console.error('   4) 确认是误报时，可把值改成占位符，或把该路径加入本脚本的 SKIP_PATH\n')
  process.exit(1)
}

console.log(`✅ 敏感信息检查通过（检查了 ${files.length} 个文件）`)
if (files.length === 0) {
  console.log('⚠️  受检数为 0 —— 清单是空的。空清单不等于干净，请确认清单生成命令是否用对。')
  process.exitCode = 0
}
