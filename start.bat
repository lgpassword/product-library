@echo off
chcp 65001 >nul
cd /d %~dp0
echo ============================================
echo   康复特教产品库 正在启动...
echo   启动后请用浏览器访问:  http://127.0.0.1:8000
echo   局域网内其他设备可访问:  http://本机IP:8000
echo   按 Ctrl+C 可停止服务
echo ============================================

REM 优先使用本地 venv 解释器；若不存在则回退到系统 python
set "PYEXE="
if exist "venv\Scripts\python.exe" set "PYEXE=venv\Scripts\python.exe"
if "%PYEXE%"=="" set "PYEXE=python"

%PYEXE% run_server.py
if errorlevel 1 (
    echo.
    echo 启动失败：请先安装依赖：
    echo     python -m venv venv ^&^& venv\Scripts\activate ^&^& pip install -r requirements.txt
)
pause
