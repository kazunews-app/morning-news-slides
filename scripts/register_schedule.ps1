<#
.SYNOPSIS
    毎朝指定時刻にニュースを自動収集するWindowsタスクスケジューラを登録します。
.EXAMPLE
    .\register_schedule.ps1 -Time "07:00"
    .\register_schedule.ps1 -Unregister
#>

param(
    [string]$Time = "07:00",
    [switch]$Unregister
)

$TaskName = "MorningNewsSlides_AutoFetch"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$FetchScript = Join-Path $ScriptDir "fetch_news.ps1"

if ($Unregister) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "タスク '$TaskName' を削除しました。"
    } else {
        Write-Host "タスク '$TaskName' は登録されていません。"
    }
    exit 0
}

if (-not (Test-Path $FetchScript)) {
    throw "スクリプトが見つかりません: $FetchScript"
}

$Action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$FetchScript`""

$Trigger = New-ScheduledTaskTrigger -Daily -At $Time

$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Description "Morning Briefing 用のトレンドニュースを毎朝自動収集します。" `
    -Force | Out-Null

Write-Host "✅ タスク '$TaskName' を登録しました（毎日 $Time に自動実行）。"
Write-Host "   実行対象: $FetchScript"
