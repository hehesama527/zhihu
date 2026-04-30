$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "=== Start X Traditional Services ===" -ForegroundColor Cyan

if (-not (Test-Path ".env")) {
    Write-Host "Missing .env file" -ForegroundColor Red
    exit 1
}

Write-Host "[1/3] Starting hotspot-api..." -ForegroundColor Yellow
$hotspotJob = Start-Job -ScriptBlock {
    Set-Location $using:PSScriptRoot
    npm run dev -w @zhihu-mvp/hotspot-api
} -Name "hotspot-api"

Start-Sleep -Seconds 2

Write-Host "[2/3] Starting x-traditional-api..." -ForegroundColor Yellow
$apiJob = Start-Job -ScriptBlock {
    Set-Location $using:PSScriptRoot
    npm run dev -w @zhihu-mvp/x-traditional-api
} -Name "x-traditional-api"

Start-Sleep -Seconds 2

Write-Host "[3/3] Starting x-traditional-worker..." -ForegroundColor Yellow
$workerJob = Start-Job -ScriptBlock {
    Set-Location $using:PSScriptRoot
    npm run dev -w @zhihu-mvp/x-traditional-worker
} -Name "x-traditional-worker"

Write-Host ""
Write-Host "Services:" -ForegroundColor Cyan
Write-Host "  Hotspot API: http://localhost:8789" -ForegroundColor White
Write-Host "  X Traditional API: http://localhost:8791" -ForegroundColor White
Write-Host "  Web: http://localhost:3000" -ForegroundColor White
Write-Host ""
Write-Host "Press Ctrl+C to stop all services." -ForegroundColor Gray

try {
    while ($true) {
        Start-Sleep -Seconds 2

        $hotspotStatus = Get-Job -Name "hotspot-api" -ErrorAction SilentlyContinue
        $apiStatus = Get-Job -Name "x-traditional-api" -ErrorAction SilentlyContinue
        $workerStatus = Get-Job -Name "x-traditional-worker" -ErrorAction SilentlyContinue

        if (-not $hotspotStatus -or -not $apiStatus -or -not $workerStatus) {
            Write-Host "A service job disappeared." -ForegroundColor Yellow
            break
        }

        if ($hotspotStatus.State -eq "Failed" -or $apiStatus.State -eq "Failed" -or $workerStatus.State -eq "Failed") {
            Write-Host "A service failed." -ForegroundColor Red
            break
        }
    }
}
finally {
    Write-Host "Stopping services..." -ForegroundColor Yellow
    Get-Job -Name "hotspot-api" -ErrorAction SilentlyContinue | Stop-Job
    Get-Job -Name "x-traditional-api" -ErrorAction SilentlyContinue | Stop-Job
    Get-Job -Name "x-traditional-worker" -ErrorAction SilentlyContinue | Stop-Job
    Get-Job | Remove-Job -Force -ErrorAction SilentlyContinue
}
