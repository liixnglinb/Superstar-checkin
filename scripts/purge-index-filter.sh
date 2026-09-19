#!/bin/bash
# git filter-branch --index-filter 使用的清理脚本
#
# 作用：把历史上所有 blob 中出现的敏感字符串替换为**等长**占位符。
#   - 只改索引，不检出工作区（因此绝不会把未跟踪的 config.yaml 卷进历史）
#   - 不产生新提交（--index-filter 保留原提交信息与父子关系）
#   - 等长替换：blob 长度不变，最安全
#
# 内容处理交给 Node（scripts/purge-index-apply.js）：
#   最初用纯 shell 写，但 `$(...)` 会丢弃 NUL 字节（实测报 "ignored null byte in input"），
#   二进制文件经 shell 变量往返会被破坏，密钥所在的 blob 因此永远改不到。
#
# 用法（由 scripts/purge-secrets.sh 调用，一般不需要手跑）

# 找 Node：PATH 里可能没有，退回常见安装位置
NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ]; then
  for c in "D:/Node/node.exe" "/c/Program Files/nodejs/node.exe" "/d/Node/node.exe"; do
    if [ -x "$c" ]; then NODE_BIN="$c"; break; fi
  done
fi
if [ -z "$NODE_BIN" ]; then
  echo "❌ 找不到 node，无法处理索引内容" >&2
  exit 1
fi

exec "$NODE_BIN" "$(cd "$(dirname "$0")" && pwd)/purge-index-apply.js" "$GIT_INDEX_FILE"

