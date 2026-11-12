@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 启动 FDE Customer Agent 后端服务...

:: 优先使用项目自带虚拟环境
set "PY=python"
if exist ".venv\Scripts\python.exe" set "PY=.venv\Scripts\python.exe"

%PY% app.py
pause
