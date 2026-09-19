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
  // 真实 AppKey 形如 RRRRRRRRRRRRRRRRRRRR（ding + 全小写字母数字）。
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

/** 允许出现的白名单（示例值、占位符、文档中的字段名） */
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
]

/** 不检查这些路径（文档里的字段名说明、检查脚本自身、构建产物） */
const SKIP_PATH = [
  /^scripts\/check-secrets\.js$/,
  /^node_modules\//,
  /^build\//,
  /^dist/,
  /^\.git\//,
  /^data\//,
  /^config\.yaml$/,
  /package-lock\.json$/,
]

function listFiles() {
  if (MODE_ALL) {
    return execFileSync('git', ['ls-files'], { encoding: 'utf-8' }).split('\n').filter(Boolean)
  }
  // 暂存区：只检查将要提交的内容
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], { encoding: 'utf-8' })
  return out.split('\n').filter(Boolean)
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
