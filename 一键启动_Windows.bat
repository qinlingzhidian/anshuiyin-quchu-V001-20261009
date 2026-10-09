@echo off
chcp 65001 >nul
title AI 暗水印与明水印消除系统 - 本地启动器

echo ========================================================
echo        AI 暗水印与明水印消除系统 · 本地一键启动器
echo ========================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo 【提示】未检测到 Node.js 环境。
    echo 正在为您自动启动【免安装单文件离线版 HTML】...
    echo (无需配置环境，支持所有浏览器，完全离线运行)
    echo.
    start "" "%~dp0ai_watermark_remover_offline.html"
    pause
    exit /b 0
)

echo [1/3] 检测到 Node.js 环境，准备启动开发服务...

if not exist "%~dp0node_modules" (
    echo [2/3] 正在安装依赖包 (首次运行需要几秒钟)...
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo 依赖安装遇到网络问题，正在切换打开【单文件免安装离线版】...
        start "" "%~dp0ai_watermark_remover_offline.html"
        pause
        exit /b 0
    )
) else (
    echo [2/3] 依赖已就绪。
)

echo [3/3] 启动本地 Vite 服务并打开浏览器...
start "" "http://localhost:3000"
call npm run dev

pause
