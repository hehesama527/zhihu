$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "=== Start X Services ===" -ForegroundColor Cyan

if (-not (Test-Path ".env")) {
    Write-Host "Missing .env file" -ForegroundColor Red
    exit 1
}

$services = @(
    @{ Step = "1/5"; Name = "hotspot-api"; Workspace = "@zhihu-mvp/hotspot-api" },
    @{ Step = "2/5"; Name = "x-main-api"; Workspace = "@zhihu-mvp/x-api" },
    @{ Step = "3/5"; Name = "x-main-worker"; Workspace = "@zhihu-mvp/x-worker" },
    @{ Step = "4/5"; Name = "x-traditional-api"; Workspace = "@zhihu-mvp/x-traditional-api" },
    @{ Step = "5/5"; Name = "x-traditional-worker"; Workspace = "@zhihu-mvp/x-traditional-worker" }
)

foreach ($service in $services) {
    Write-Host "[$($service.Step)] Starting $($service.Name)..." -ForegroundColor Yellow
    $workspace = $service.Workspace
    Start-Job -ScriptBlock {
        Set-Location $using:PSScriptRoot
        npm run dev -w $using:workspace
    } -Name $service.Name | Out-Null
    Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "Services:" -ForegroundColor Cyan
Write-Host "  Hotspot API: http://localhost:8789" -ForegroundColor White
Write-Host "  X Main API: http://localhost:8788" -ForegroundColor White
Write-Host "  X Traditional API: http://localhost:8791" -ForegroundColor White
Write-Host "  X Main Web: http://localhost:3000/twitter" -ForegroundColor White
Write-Host "  X Traditional Web: http://localhost:3000/twitter/traditional" -ForegroundColor White
Write-Host ""
Write-Host "Press Ctrl+C to stop all services." -ForegroundColor Gray

try {
    while ($true) {
        Start-Sleep -Seconds 2

        $missingJob = $false
        $failedJob = $false

        foreach ($service in $services) {
            $job = Get-Job -Name $service.Name -ErrorAction SilentlyContinue
            if (-not $job) {
                $missingJob = $true
                break
            }

            if ($job.State -eq "Failed") {
                $failedJob = $true
                break
            }
        }

        if ($missingJob) {
            Write-Host "A service job disappeared." -ForegroundColor Yellow
            break
        }

        if ($failedJob) {
            Write-Host "A service failed." -ForegroundColor Red
            break
        }
    }
}
finally {
    Write-Host "Stopping services..." -ForegroundColor Yellow
    foreach ($service in $services) {
        Get-Job -Name $service.Name -ErrorAction SilentlyContinue | Stop-Job
    }
    Get-Job | Remove-Job -Force -ErrorAction SilentlyContinue
}
