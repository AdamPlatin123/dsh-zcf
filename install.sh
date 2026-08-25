#!/usr/bin/env bash
# dsh-zcf installer — 零配置安装：Node >= 22.12（缺失或不达标时经 nvm 用户级安装，
# 不使用 sudo），然后全局安装 dsh-zcf。安装后直接运行 `dsh-zcf`。
# English: one-shot installer. Brings Node >= 22.12 (user-level nvm when
# missing, never sudo), then installs dsh-zcf globally.
#
# Usage:  curl -fsSL https://raw.githubusercontent.com/AdamPlatin123/dsh-zcf/master/install.sh | bash
# Mirror: ZCF_REGISTRY=https://registry.npmmirror.com curl -fsSL ... | bash
set -euo pipefail

MIN_MAJOR=22
MIN_MINOR=12
NVM_VERSION=v0.40.3
ZCF_REGISTRY="${ZCF_REGISTRY:-}"

say() { printf '%s\n' "$*"; }

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  [ "$(node -p "const [a,b]=process.versions.node.split('.').map(Number);(a>${MIN_MAJOR}||(a===${MIN_MAJOR}&&b>=${MIN_MINOR}))?'ok':'no'" 2>/dev/null)" = "ok" ]
}

load_nvm() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
}

if ! node_ok; then
  say "==> Node >= ${MIN_MAJOR}.${MIN_MINOR} required (current: $(command -v node >/dev/null 2>&1 && node -v || echo none))"
  say "==> 需要先装 Node（经 nvm，用户级、不用 sudo）/ installing Node via nvm (user-level, no sudo)"
  load_nvm
  if ! command -v nvm >/dev/null 2>&1; then
    say '==> Installing nvm ...'
    curl -o- "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" | bash
    load_nvm
  fi
  say '==> nvm install 22 ...'
  nvm install 22
fi

say "==> Node $(node -v) OK"
say '==> npm install -g dsh-zcf （全局安装，装一次后续免确认）/ global install, no per-run prompts afterwards'
if ! npm install -g dsh-zcf@latest ${ZCF_REGISTRY:+--registry="$ZCF_REGISTRY"}; then
  say '!! 全局安装失败（常见于系统 Node 的权限限制）。'
  say '!! Global install failed (typical when npm needs elevated rights).'
  say '   两个选择 / two options:'
  say "   1) sudo npm install -g dsh-zcf@latest ${ZCF_REGISTRY:+--registry=$ZCF_REGISTRY }# 系统级"
  say '   2) 退回免安装用法 / fallback without installing: npx -y dsh-zcf'
  exit 1
fi

say ''
say "已安装 / installed: $(dsh-zcf --version)"
say '开始使用 / start with:  dsh-zcf'
