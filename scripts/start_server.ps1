<#
.SYNOPSIS
    スマホや同じWi-Fi内の別端末からアクセスできる軽量ローカルWebサーバーを起動します。
.EXAMPLE
    .\start_server.ps1
    .\start_server.ps1 -Port 8080
#>

param(
    [int]$Port = 8080
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

$MimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".webp" = "image/webp"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
}

# ローカルIPv4アドレスを取得
$LocalIPs = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
        $_.IPAddress -ne "127.0.0.1" -and
        $_.IPAddress -notlike "169.254.*" -and
        $_.InterfaceAlias -notlike "*Loopback*" -and
        $_.InterfaceAlias -notlike "*WSL*" -and
        $_.InterfaceAlias -notlike "*vEthernet*"
    } |
    Select-Object -ExpandProperty IPAddress

$Listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $Port)
$Listener.Start()

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Morning Briefing ローカルサーバーを起動しました" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  PCから開く    : http://localhost:$Port/" -ForegroundColor Green
if ($LocalIPs) {
    foreach ($ip in $LocalIPs) {
        Write-Host "  スマホから開く: http://${ip}:$Port/" -ForegroundColor Yellow
    }
} else {
    Write-Host "  スマホから開く: http://<このPCのIPアドレス>:$Port/" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  ※ 同じWi-Fiに接続したスマホのブラウザで上記URLを開いてください。"
Write-Host "  ※ 接続できない場合は Windows ファイアウォールでポート $Port を許可してください。"
Write-Host "  終了するには Ctrl + C を押してください。"
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

try {
    while ($true) {
        if (-not $Listener.Pending()) {
            Start-Sleep -Milliseconds 50
            continue
        }

        $Client = $Listener.AcceptTcpClient()
        try {
            $Stream = $Client.GetStream()
            $Reader = New-Object System.IO.StreamReader($Stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
            $RequestLine = $Reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($RequestLine)) {
                $Client.Close()
                continue
            }

            # 残りのヘッダーを読み飛ばす
            while ($true) {
                $Line = $Reader.ReadLine()
                if ([string]::IsNullOrEmpty($Line)) { break }
            }

            $Parts = $RequestLine.Split(" ")
            $RawUrl = if ($Parts.Length -ge 2) { $Parts[1] } else { "/" }
            $UrlPath = $RawUrl.Split("?")[0]
            $UrlPath = [System.Uri]::UnescapeDataString($UrlPath)

            if ($UrlPath -eq "/") { $UrlPath = "/index.html" }

            $RelativePath = $UrlPath.TrimStart("/").Replace("/", [System.IO.Path]::DirectorySeparatorChar)
            $FullPath = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot $RelativePath))

            # パストラバーサル防止
            $RootFull = [System.IO.Path]::GetFullPath($ProjectRoot)
            if (-not $FullPath.StartsWith($RootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
                $Status = "403 Forbidden"
                $Body = [System.Text.Encoding]::UTF8.GetBytes("403 Forbidden")
                $ContentType = "text/plain; charset=utf-8"
            } elseif (Test-Path $FullPath -PathType Leaf) {
                $Status = "200 OK"
                $Body = [System.IO.File]::ReadAllBytes($FullPath)
                $Ext = [System.IO.Path]::GetExtension($FullPath).ToLowerInvariant()
                $ContentType = if ($MimeTypes.ContainsKey($Ext)) { $MimeTypes[$Ext] } else { "application/octet-stream" }
            } else {
                $Status = "404 Not Found"
                $Body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
                $ContentType = "text/plain; charset=utf-8"
            }

            $HeaderStr = "HTTP/1.1 $Status`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nConnection: close`r`nCache-Control: no-cache`r`n`r`n"
            $HeaderBytes = [System.Text.Encoding]::ASCII.GetBytes($HeaderStr)
            $Stream.Write($HeaderBytes, 0, $HeaderBytes.Length)
            $Stream.Write($Body, 0, $Body.Length)
            $Stream.Flush()
        } catch {
            # 個別リクエストエラーは無視して継続
        } finally {
            $Client.Close()
        }
    }
} finally {
    $Listener.Stop()
    Write-Host "サーバーを停止しました。"
}
