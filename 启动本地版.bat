@echo off
chcp 936 >nul
title 实习生招聘数据复盘工具（本地版）
cd /d "%~dp0"

echo ============================================================
echo   实习生招聘数据复盘工具 - 本地版
echo ============================================================
echo.
echo   数据只在你自己的浏览器里处理：不联网、不上传、没有服务器。
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有找到 Node.js。请先安装 Node.js 后重试：
  echo        https://nodejs.org/  ^(选 LTS 版本，一路下一步即可^)
  echo.
  pause
  exit /b 1
)

if not exist "dist\index.html" (
  if not exist "site\index.html" (
    echo   第一次运行，正在生成页面文件，请稍等（大约 10 秒）...
    call npm.cmd run build
    if errorlevel 1 (
      echo.
      echo [错误] 生成页面文件失败。请把上面的红字截图发给我。
      pause
      exit /b 1
    )
  )
)

echo   正在启动本地服务，随后会自动打开浏览器...
echo   使用完毕后：关闭本窗口即可停止服务。
echo.

start "" http://127.0.0.1:4173/
node "scripts\serve-dist.mjs" dist 4173

echo.
echo 服务已停止。按任意键关闭窗口。
pause >nul