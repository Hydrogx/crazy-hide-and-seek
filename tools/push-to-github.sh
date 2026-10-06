#!/usr/bin/env bash
# 一键把本项目推送到 GitHub。
#
#   bash tools/push-to-github.sh                 # 用 gh 登录态（或 GITHUB_TOKEN）创建/推送
#   bash tools/push-to-github.sh <仓库名> [private]
#
# 说明：
#   - 未登录时会提示你运行 gh auth login，或设置 GITHUB_TOKEN；
#   - 仓库已存在时只做 push，不会重复创建；
#   - 通过 SSH 推送（本机 SSH key 已验证可用）。
set -euo pipefail

REPO_NAME="${1:-疯狂捉迷藏}"
VISIBILITY_FLAG="--public"
if [[ "${2:-}" == "private" ]]; then VISIBILITY_FLAG="--private"; fi

OWNER="Hydrogx"
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
echo "项目目录: $ROOT"
echo "目标仓库: ${OWNER}/${REPO_NAME} (${VISIBILITY_FLAG#--})"

# --- 1. 确保有一个提交 ---
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git init -b main >/dev/null
fi
if ! git rev-parse HEAD >/dev/null 2>&1; then
  git add -A
  git commit -m "feat: 疯狂捉迷藏 —— three.js 固定斜俯瞰视角 3D 捉迷藏"
fi
git branch -M main

# --- 2. 得到创建仓库的能力 ---
if gh auth status >/dev/null 2>&1; then
  echo "✅ 使用 gh 登录态创建/推送"
  if gh repo view "${OWNER}/${REPO_NAME}" >/dev/null 2>&1; then
    echo "仓库已存在，跳过创建"
  else
    gh repo create "${OWNER}/${REPO_NAME}" ${VISIBILITY_FLAG} \
      --description "three.js 固定斜俯瞰视角的 3D 捉迷藏游戏（疯狂捉迷藏）" >/dev/null
    echo "✅ 已创建仓库"
  fi
elif [[ -n "${GITHUB_TOKEN:-}" || -n "${GH_TOKEN:-}" ]]; then
  echo "✅ 使用 GITHUB_TOKEN 调 API 创建仓库"
  TOKEN="${GITHUB_TOKEN:-$GH_TOKEN}"
  HTTP=$(curl -s -o /tmp/hs-create-repo.json -w '%{http_code}' \
    -X POST -H "Authorization: Bearer ${TOKEN}" -H "Accept: application/vnd.github+json" \
    https://api.github.com/user/repos \
    -d "{\"name\":\"${REPO_NAME}\",\"description\":\"three.js 3D hide and seek game\",\"private\":$([[ "$VISIBILITY_FLAG" == "--private" ]] && echo true || echo false)}")
  if [[ "$HTTP" == "201" ]]; then echo "✅ 已创建仓库";
  elif [[ "$HTTP" == "422" ]]; then echo "仓库已存在，继续推送";
  else echo "❌ 建库失败 (HTTP $HTTP):"; cat /tmp/hs-create-repo.json; exit 1; fi
else
  cat <<'EOF'
❌ 还没有 GitHub 授权。任选其一：

  A) 交互登录（推荐，浏览器授权一次即可）：
       gh auth login --hostname github.com --git-protocol ssh --web
     然后再跑一次本脚本。

  B) 用 Personal Access Token（需 repo 权限）：
       GITHUB_TOKEN=ghp_xxx bash tools/push-to-github.sh

  C) 自己到 https://github.com/new 建一个空仓库（名字：疯狂捉迷藏，不要勾选 README），
     然后跑：
       git remote add origin git@github.com:Hydrogx/疯狂捉迷藏.git
       git push -u origin main
EOF
  exit 1
fi

# --- 3. 推送 ---
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "git@github.com:${OWNER}/${REPO_NAME}.git"
else
  git remote add origin "git@github.com:${OWNER}/${REPO_NAME}.git"
fi
git push -u origin main
echo
echo "🎉 完成：https://github.com/${OWNER}/${REPO_NAME}"
git ls-files | sed 's/^/   /'
