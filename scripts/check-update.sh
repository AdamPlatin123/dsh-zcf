#!/usr/bin/env bash
# dsh-zcf 检查更新：对比本地与 npm 远程版本，提示升级命令
# 用法：check-update.sh
set -uo pipefail

echo "🔍 检查更新（$(date +%F)）"
echo ""

# dsh（DeepSeek Harness 核心）
LOCAL_DSH="$(dsh --version 2>/dev/null | head -1 | tr -d ' \n')"
REMOTE_DSH="$(timeout 15 npm view @deepseek-ai/dsh version 2>/dev/null | tr -d ' \n')"
printf "  dsh       本地 %-12s  远程 %-12s  " "${LOCAL_DSH:-未安装}" "${REMOTE_DSH:-离线}"
if [ -z "$REMOTE_DSH" ]; then
  echo "⚠️ 无法查询远程"
elif [ -z "$LOCAL_DSH" ]; then
  echo "→ 安装：npm i -g @deepseek-ai/dsh@$REMOTE_DSH"
elif [ "$LOCAL_DSH" = "$REMOTE_DSH" ]; then
  echo "✅ 最新"
else
  echo "⬆️  有更新：npm i -g @deepseek-ai/dsh@$REMOTE_DSH"
fi

# dsh-zcf（本向导）
LOCAL_ZCF="$(dsh-zcf --version 2>/dev/null | head -1 | tr -d ' \n')"
REMOTE_ZCF="$(timeout 15 npm view dsh-zcf version 2>/dev/null | tr -d ' \n')"
printf "  dsh-zcf   本地 %-12s  远程 %-12s  " "${LOCAL_ZCF:-未安装}" "${REMOTE_ZCF:-离线}"
if [ -z "$REMOTE_ZCF" ]; then
  echo "⚠️ 无法查询远程"
elif [ -z "$LOCAL_ZCF" ]; then
  echo "→ 安装：npm i -g dsh-zcf@$REMOTE_ZCF"
elif [ "$LOCAL_ZCF" = "$REMOTE_ZCF" ]; then
  echo "✅ 最新"
else
  echo "⬆️  有更新：npm i -g dsh-zcf@$REMOTE_ZCF"
fi

echo ""
echo "提示：加 -g 全局升级，或 npx dsh-zcf 临时跑最新版"
exit 0
