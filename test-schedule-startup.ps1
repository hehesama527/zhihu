#!/usr/bin/env pwsh
# 知乎自动化 - 定时任务启动测试脚本

Write-Host "========================================"
Write-Host "知乎自动化 - 定时任务启动测试"
Write-Host "========================================"
Write-Host ""

# 检查 .env 文件
if (-not (Test-Path ".env")) {
    Write-Host "[ERROR] .env 文件不存在，请从 .env.example 复制并配置" -ForegroundColor Red
    exit 1
}

Write-Host "[INFO] .env 文件检查通过" -ForegroundColor Green
Write-Host ""

# 停止之前的进程
Write-Host "[INFO] 停止之前运行的服务..." -ForegroundColor Yellow
Stop-Process -Name "node" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# 清理旧日志
Remove-Item "tmp-test-startup.out" -Force -ErrorAction SilentlyContinue
Remove-Item "tmp-test-startup.err" -Force -ErrorAction SilentlyContinue

# 启动 backend (API + Worker)
Write-Host "[INFO] 启动 API 和 Worker 服务..." -ForegroundColor Yellow
$env:FORCE_COLOR = "1"
$backendJob = Start-Job -ScriptBlock {
    Set-Location $using:PWD
    & npm run dev:backend 2>&1 | Out-File -FilePath "tmp-test-startup.out" -Encoding utf8
}

Write-Host "[INFO] 等待服务启动 (15 秒)..." -ForegroundColor Yellow
Start-Sleep -Seconds 15

# 检查 API 是否启动
Write-Host ""
Write-Host "[INFO] 检查 API 健康状态..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8787/health" -TimeoutSec 5 -UseBasicParsing
    $json = $response.Content | ConvertFrom-Json
    if ($json.ok) {
        Write-Host "[INFO] API 启动成功" -ForegroundColor Green
        Write-Host "      响应：$($response.Content)"
    } else {
        Write-Host "[ERROR] API 响应异常" -ForegroundColor Red
        Write-Host "        $($response.Content)"
    }
} catch {
    Write-Host "[ERROR] API 未响应，请检查日志" -ForegroundColor Red
    Write-Host "        $_"
}

# 等待 Worker 初始化
Write-Host ""
Write-Host "[INFO] 检查 Worker 运行状态..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# 检查日志中是否有 worker tick
if (Test-Path "tmp-test-startup.out") {
    $logContent = Get-Content "tmp-test-startup.out" -Raw -ErrorAction SilentlyContinue
    if ($logContent -match '\[worker\] tick') {
        Write-Host "[INFO] Worker 已启动并开始执行 tick 循环" -ForegroundColor Green
    } else {
        Write-Host "[WARN] Worker 尚未输出 tick 日志，可能在初始化中" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "========================================"
Write-Host "服务启动测试完成"
Write-Host "========================================"
Write-Host ""

# 检查排期生成
Write-Host "[INFO] 检查定时排期生成情况..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8787/schedule/today" -TimeoutSec 10 -UseBasicParsing
    $json = $response.Content | ConvertFrom-Json
    Write-Host "[INFO] 今日排期数据:" -ForegroundColor Green
    if ($json.slots) {
        Write-Host "      排期数量：$($json.slots.Count)"
        if ($json.slots.Count -gt 0) {
            $first = $json.slots[0]
            Write-Host "      首个排期：$($first.scheduledAt)"
        }
    }
} catch {
    Write-Host "[WARN] 无法获取排期数据：$_" -ForegroundColor Yellow
}

# 检查账号状态
Write-Host ""
Write-Host "[INFO] 检查账号状态..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8787/accounts" -TimeoutSec 10 -UseBasicParsing
    $json = $response.Content | ConvertFrom-Json
    Write-Host "[INFO] 账号列表:" -ForegroundColor Green
    if ($json.accounts) {
        foreach ($account in $json.accounts) {
            $status = if ($account.status -eq "active") { "✓" } else { "!" }
            Write-Host "      $status $($account.name) (ID: $($account.id), Status: $($account.status))"
        }
    }
} catch {
    Write-Host "[WARN] 无法获取账号数据：$_" -ForegroundColor Yellow
}

# 检查 Dashboard
Write-Host ""
Write-Host "[INFO] 检查 Dashboard 状态..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8787/dashboard/summary" -TimeoutSec 10 -UseBasicParsing
    $json = $response.Content | ConvertFrom-Json
    Write-Host "[INFO] Dashboard 状态:" -ForegroundColor Green
    if ($json.summary) {
        $total = if ($null -ne $json.summary.totalAccounts) { $json.summary.totalAccounts } else { 0 }
        $active = if ($null -ne $json.summary.activeAccounts) { $json.summary.activeAccounts } else { 0 }
        $today = if ($null -ne $json.summary.todaySlots) { $json.summary.todaySlots } else { 0 }
        Write-Host "      账号总数：$total"
        Write-Host "      活跃账号：$active"
        Write-Host "      今日排期：$today"
    }
} catch {
    Write-Host "[WARN] 无法获取 Dashboard 数据：$_" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================"
Write-Host "测试完成"
Write-Host "========================================"
Write-Host ""
Write-Host "日志文件位置:" -ForegroundColor Cyan
Write-Host "  - 输出日志：tmp-test-startup.out"
Write-Host "  - 错误日志：tmp-test-startup.err"
Write-Host ""
Write-Host "停止服务命令：Stop-Process -Name 'node' -Force" -ForegroundColor Cyan
Write-Host ""
