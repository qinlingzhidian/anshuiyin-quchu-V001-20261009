#!/bin/bash
echo "========================================================"
echo "       AI 暗水印与明水印消除系统 · 本地一键启动器"
echo "========================================================"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node &> /dev/null; then
    echo "【提示】未检测到 Node.js 环境。"
    echo "正在为您自动打开【免安装单文件离线版 HTML】..."
    if command -v open &> /dev/null; then
        open "$SCRIPT_DIR/ai_watermark_remover_offline.html"
    elif command -v xdg-open &> /dev/null; then
        xdg-open "$SCRIPT_DIR/ai_watermark_remover_offline.html"
    fi
    exit 0
fi

echo "[1/3] 检测到 Node.js 环境..."
cd "$SCRIPT_DIR"

if [ ! -d "node_modules" ]; then
    echo "[2/3] 正在安装本地依赖包..."
    npm install
fi

echo "[3/3] 启动本地 Vite 离线服务..."
if command -v open &> /dev/null; then
    open "http://localhost:3000" &
elif command -v xdg-open &> /dev/null; then
    xdg-open "http://localhost:3000" &
fi

npm run dev
