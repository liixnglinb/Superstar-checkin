#!/bin/bash
# 清理 git 历史中的敏感字符串（一次性脚本）
#
# 用法：bash scripts/purge-secrets.sh [仓库目录]
#
# 实现：git filter-branch --index-filter
#   - **只在索引上操作**，不检出工作区 → 绝不会把未跟踪的 config.yaml（含真实密钥）
#     卷进历史。这一点很关键：用 --tree-filter 会产生这个风险。
#   - **不产生新提交**：保留原提交信息、作者、父子关系，提交数不变。
#
# 为什么不用 git filter-repo：本机没有 Python，装不了。
#
# ⚠️ 执行后必须强推（git push --force-with-lease），且所有克隆副本都需要重新克隆。

set -euo pipefail

REPO="${1:-$(pwd)}"
cd "$REPO"

echo "仓库: $(pwd)"
echo "清理前提交数: $(git rev-list --count HEAD)"
echo "当前分支: $(git branch --show-current)"
echo ""

# 拒绝在脏工作区上跑，避免误伤
if [ -n "$(git status --porcelain)" ]; then
  echo "❌ 工作区有未提交改动，请先提交或 stash 后再执行（避免误伤）"
  exit 1
fi

export FILTER_BRANCH_SQUELCH_WARNING=1

echo "开始改写历史（每提交只改索引，不检出文件）..."
echo "  预计需要几分钟，取决于提交与文件数量"
echo ""

git filter-branch -f --index-filter "bash '$(cd "$(dirname "$0")" && pwd)/purge-index-filter.sh'" -- --all

echo ""
echo "=== 改写完成，开始验证 ==="

FAIL=0
# ⚠️ 验证用的串必须**切碎后拼接**（每片 ≤8 字符），不能写成完整字面量、也不要用长片段：
# 否则本脚本自身会含密钥，git log -S 会一直报告"还有提交含密钥"，让人误判清理失败。
for s in \
  "9524c72a""448bd939""b63f9bfc""0f6cd928""b30b9225""33920e38""8321f619""b6f67cdf" \
  "SEC2980e4""db85c30f""5e29f41a""2d8fe0ac""cad7d8fb""882b04e6""23c84217""a44f534239" \
  "ding9qdh0""rholuacfw1p"
do
  n=$(git log --all --oneline -S "$s" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$n" = "0" ]; then
    echo "  ✅ 已抹除: ${s:0:12}…"
  else
    echo "  ❌ 仍存在: ${s:0:12}… （$n 个提交）"
    FAIL=1
  fi
done

echo ""
echo "清理后提交数: $(git rev-list --count HEAD)"

if [ "$FAIL" = "0" ]; then
  echo ""
  echo "✅ 历史清理成功。下一步（需要确认后再执行）："
  echo "   git push --force-with-lease origin main"
  echo "   并通知其他人重新克隆（旧克隆仍持有含密钥的历史）"
else
  echo ""
  echo "❌ 仍有残留，请检查 purge-index-filter.sh 的替换规则"
  exit 1
fi
