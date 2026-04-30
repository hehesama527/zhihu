# X 流程测试脚本 - 创建账号和 5 个不同的测试任务
# 不实际发布，只走到写作完成

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$X_API_BASE = "http://127.0.0.1:8788"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  X 流程测试 - 创建账号和任务" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 创建测试账号
Write-Host "[1/6] 创建测试账号..." -ForegroundColor Cyan
$accountPayload = @{
    handle = "crypto_trader_zh"
    name = "加密交易手记"
    persona = "一个专注于币圈交易的老手，分享实战经验和踩坑记录"
    targetAudience = "币圈新手和有一定经验的交易者"
    styleGuide = "碎碎念风格，像朋友圈，不要教育用户，分享个人经验为主"
    learningTargets = @()
    manualNotes = "测试账号，用于验证 X 流程"
    status = "active"
    writerPromptSource = "main_agent"
    publishStyleRatios = @{
        casualNote = 40
        smallInsight = 25
        pitfallLog = 15
        toolMention = 10
        industryTalk = 5
        interactiveQa = 3
        quoteRepost = 2
    }
} | ConvertTo-Json -Depth 10

$accountResponse = Invoke-RestMethod -Uri "$X_API_BASE/accounts" -Method POST -Body $accountPayload -ContentType "application/json"
$accountId = $accountResponse.account.id
Write-Host "✓ 账号创建成功：@$($accountResponse.account.handle) (ID: $accountId)" -ForegroundColor Green
Write-Host ""

# 2. 创建 5 个不同的测试任务
$tasks = @(
    @{
        title = "新手最容易犯的 5 个交易错误"
        brief = "分享新手在币圈交易中最容易犯的错误，帮助读者避坑"
        goal = "让新手读者产生共鸣，同时感受到作者的经验价值"
        preferredMode = "thread"
        forceResearch = $false
    },
    @{
        title = "今天止盈了一笔，聊聊我的止盈策略"
        brief = "分享最近一次成功的止盈操作，以及背后的思考逻辑"
        goal = "展示交易策略的实战应用，不炫耀，重点在思考过程"
        preferredMode = "single"
        forceResearch = $false
    },
    @{
        title = "如何判断趋势和震荡？我的两个简单方法"
        brief = "分享判断市场状态的实用方法，不需要复杂指标"
        goal = "提供可立即使用的交易技巧，降低学习门槛"
        preferredMode = "thread"
        forceResearch = $false
    },
    @{
        title = "回测了一个策略，结果有点意外"
        brief = "分享策略回测的过程和发现，可能反直觉"
        goal = "用数据说话，但不过度堆数字，重点在洞察"
        preferredMode = "single"
        forceResearch = $false
    },
    @{
        title = "为什么我不建议新手用高杠杆？"
        brief = "从个人经验出发，讲述高杠杆的风险和教训"
        goal = "用真实经历警示风险，避免说教感"
        preferredMode = "single"
        forceResearch = $false
    }
)

Write-Host "[2/6] 创建 5 个测试任务..." -ForegroundColor Cyan
Write-Host ""

$createdTasks = @()
for ($i = 0; $i -lt $tasks.Count; $i++) {
    $task = $tasks[$i]
    $taskPayload = @{
        accountId = $accountId
        title = $task.title
        brief = $task.brief
        goal = $task.goal
        preferredMode = $task.preferredMode
        forceResearch = $task.forceResearch
    } | ConvertTo-Json -Depth 10
    
    Write-Host "  创建任务 $($i + 1)/5: $($task.title)" -ForegroundColor Gray
    $taskResponse = Invoke-RestMethod -Uri "$X_API_BASE/tasks" -Method POST -Body $taskPayload -ContentType "application/json"
    $createdTasks += $taskResponse.task
    Write-Host "  ✓ 任务创建成功 (ID: $($taskResponse.task.id))" -ForegroundColor Green
}

Write-Host ""
Write-Host "✓ 所有任务创建成功!" -ForegroundColor Green
Write-Host ""

# 3. 输出任务摘要
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  任务摘要" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

foreach ($task in $createdTasks) {
    Write-Host "任务 ID: $($task.id)" -ForegroundColor Yellow
    Write-Host "  标题：$($task.title)" -ForegroundColor White
    Write-Host "  模式：$($task.preferredMode)" -ForegroundColor White
    Write-Host "  状态：$($task.status)" -ForegroundColor White
    Write-Host ""
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  下一步操作" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "现在可以使用以下命令运行任务：" -ForegroundColor Cyan
Write-Host ""
foreach ($task in $createdTasks) {
    Write-Host "  curl -X POST http://127.0.0.1:8788/tasks/$($task.id)/run-now" -ForegroundColor Gray
}
Write-Host ""
Write-Host "或者启动 x-worker 自动处理这些任务：" -ForegroundColor Cyan
Write-Host "  npm run dev -w @zhihu-mvp/x-worker" -ForegroundColor Gray
Write-Host ""

# 保存任务 ID 到文件，方便后续使用
$createdTasks | Select-Object -Property id, title, status | ConvertTo-Json | Out-File -FilePath ".\test-tasks.json" -Encoding UTF8
Write-Host "✓ 任务信息已保存到 test-tasks.json" -ForegroundColor Green
Write-Host ""
