@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo  FDE 智能客户模拟中心
echo ========================================
echo.

:: 检查 .env（实际位于 backend 目录）
if not exist backend\.env (
    echo [INFO] 未找到 backend\.env，正在从 .env.example 复制...
    if exist backend\.env.example (
        copy backend\.env.example backend\.env >nul
        echo [INFO] 已创建 .env 文件，请编辑配置 API Key
    ) else (
        echo [WARN] 未找到 .env.example，请手动创建 backend\.env
    )
)

cd backend
:: 优先使用项目自带虚拟环境
set "PY=python"
if exist ".venv\Scripts\python.exe" set "PY=.venv\Scripts\python.exe"

echo [INFO] 安装后端依赖...
%PY% -m pip install -r requirements.txt -q

echo [INFO] 启动后端服务...
start "FDE Backend" cmd /c "%PY% app.py"

timeout /t 3 >nul

echo [INFO] 安装前端依赖...
cd ..\frontend
if not exist node_modules (
    call npm install --silent
)

echo [INFO] 启动前端开发服务器...
start "FDE Frontend" cmd /c "npm run dev"

echo.
echo ========================================
echo  服务已启动！
echo.
echo  后端: http://localhost:8765
echo  前端: http://localhost:3000
echo ========================================
echo.
pause
