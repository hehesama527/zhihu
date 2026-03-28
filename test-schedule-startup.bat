@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo 知乎自动化 - 定时任务启动测试
echo ========================================
echo.

REM 检查 .env 文件
if not exist ".env" (
    echo [ERROR] .env 文件不存在，请从 .env.example 复制并配置
    exit /b 1
)

echo [INFO] .env 文件检查通过
echo.

REM 停止之前的进程
echo [INFO] 停止之前运行的服务...
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul

REM 清理旧日志
del tmp-test-startup.out 2>nul
del tmp-test-startup.err 2>nul

REM 启动 backend (API + Worker)
echo [INFO] 启动 API 和 Worker 服务...
start /b cmd /c "npm run dev:backend > tmp-test-startup.out 2> tmp-test-startup.err"

REM 等待服务启动
echo [INFO] 等待服务启动 (15 秒)...
timeout /t 15 /nobreak >nul

REM 检查 API 是否启动
echo.
echo [INFO] 检查 API 健康状态...
curl -s http://localhost:8787/health > tmp-health.json 2>nul
if exist "tmp-health.json" (
    findstr /c:"ok" tmp-health.json >nul
    if !errorlevel! equ 0 (
        echo [INFO] API 启动成功
        type tmp-health.json
        echo.
    ) else (
        echo [ERROR] API 响应异常
        type tmp-health.json
        goto :check_logs
    )
) else (
    echo [ERROR] API 未响应，请检查日志
    goto :check_logs
)

REM 检查 Worker 是否启动
echo.
echo [INFO] 检查 Worker 运行状态...
findstr /c:"[worker] tick" tmp-test-startup.out >nul
if !errorlevel! equ 0 (
    echo [INFO] Worker 已启动并开始执行 tick 循环
) else (
    echo [WARN] Worker 可能正在初始化，继续等待...
    timeout /t 10 /nobreak >nul
    findstr /c:"[worker] tick" tmp-test-startup.out >nul
    if !errorlevel! equ 0 (
        echo [INFO] Worker 已启动并开始执行 tick 循环
    ) else (
        echo [WARN] Worker 尚未输出 tick 日志，可能在初始化中
    )
)

echo.
echo ========================================
echo 服务启动测试完成
echo ========================================
echo.

REM 检查排期生成
echo [INFO] 检查定时排期生成情况...
curl -s http://localhost:8787/schedule/today > tmp-schedule-today.json 2>nul
if exist "tmp-schedule-today.json" (
    echo [INFO] 今日排期数据:
    type tmp-schedule-today.json
    echo.
) else (
    echo [WARN] 无法获取排期数据
)

REM 检查账号状态
echo.
echo [INFO] 检查账号状态...
curl -s http://localhost:8787/accounts > tmp-accounts.json 2>nul
if exist "tmp-accounts.json" (
    echo [INFO] 账号列表:
    type tmp-accounts.json
    echo.
) else (
    echo [WARN] 无法获取账号数据
)

REM 检查 Dashboard
echo.
echo [INFO] 检查 Dashboard 状态...
curl -s http://localhost:8787/dashboard/summary > tmp-dashboard.json 2>nul
if exist "tmp-dashboard.json" (
    echo [INFO] Dashboard 状态:
    type tmp-dashboard.json
    echo.
) else (
    echo [WARN] 无法获取 Dashboard 数据
)

echo.
echo ========================================
echo 测试完成
echo ========================================
echo.
echo 日志文件位置:
echo - 输出日志：tmp-test-startup.out
echo - 错误日志：tmp-test-startup.err
echo.
echo 停止服务：关闭所有 node.exe 进程
echo.

del tmp-health.json 2>nul
del tmp-schedule-today.json 2>nul
del tmp-accounts.json 2>nul
del tmp-dashboard.json 2>nul

exit /b 0

:check_logs
echo.
echo [INFO] 查看错误日志:
if exist "tmp-test-startup.err" (
    type tmp-test-startup.err
)
exit /b 1
