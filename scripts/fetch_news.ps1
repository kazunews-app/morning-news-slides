<#
.SYNOPSIS
    毎朝のトレンドニュースをGoogle News RSSから取得し、data/news.js を更新します。
#>

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$DataDir = Join-Path $ProjectRoot "data"
$OutputJsPath = Join-Path $DataDir "news.js"
$OutputJsonPath = Join-Path $DataDir "news.json"

if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

$Feeds = @(
    @{
        Category = "domestic"
        Label    = "国内・総合"
        Url      = "https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja"
        Limit    = 3
    },
    @{
        Category = "tech"
        Label    = "テクノロジー・AI"
        Url      = "https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=ja&gl=JP&ceid=JP:ja"
        Limit    = 3
    },
    @{
        Category = "business"
        Label    = "ビジネス・経済"
        Url      = "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=ja&gl=JP&ceid=JP:ja"
        Limit    = 3
    }
)

function Clean-HtmlText {
    param([string]$RawText)
    if ([string]::IsNullOrWhiteSpace($RawText)) { return "" }
    $decoded = [System.Net.WebUtility]::HtmlDecode($RawText)
    $noTags = [regex]::Replace($decoded, "<[^>]+>", " ")
    $normalized = [regex]::Replace($noTags, "\s+", " ").Trim()
    return $normalized
}

function Format-JapaneseDate {
    param([datetime]$Dt)
    $days = @("日", "月", "火", "水", "木", "金", "土")
    $dow = $days[[int]$Dt.DayOfWeek]
    return $Dt.ToString("yyyy年M月d日") + " ($dow)"
}

$now = Get-Date
$newsItems = New-Object System.Collections.Generic.List[object]
$keywords = New-Object System.Collections.Generic.List[string]

foreach ($feed in $Feeds) {
    Write-Host "Fetching [$($feed.Label)] from $($feed.Url) ..."
    try {
        $response = Invoke-WebRequest -Uri $feed.Url -UseBasicParsing -TimeoutSec 20 -Headers @{
            "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MorningNewsSlides/1.0"
        }
        [xml]$xml = $response.Content
        $items = $xml.rss.channel.item | Select-Object -First $feed.Limit

        foreach ($item in $items) {
            $rawTitle = [string]$item.title
            $sourceName = if ($item.source.'#text') { [string]$item.source.'#text' } elseif ($item.source) { [string]$item.source } else { $feed.Label }

            # Google Newsのタイトル末尾にある " - メディア名" を分離
            $cleanTitle = $rawTitle
            if ($rawTitle -match "^(.*)\s+-\s+([^-]+)$") {
                $cleanTitle = $Matches[1].Trim()
                if ([string]::IsNullOrWhiteSpace($sourceName)) {
                    $sourceName = $Matches[2].Trim()
                }
            }

            $descText = Clean-HtmlText ([string]$item.description)
            if ([string]::IsNullOrWhiteSpace($descText) -or $descText.Length -lt 15) {
                $descText = "$cleanTitle に関する最新報道です。詳細は元記事リンクから確認できます。"
            } elseif ($descText.Length -gt 160) {
                $descText = $descText.Substring(0, 157) + "..."
            }

            $pubDateStr = $now.ToString("yyyy-MM-dd HH:mm")
            try {
                if ($item.pubDate) {
                    $parsedDate = [datetime]::Parse([string]$item.pubDate)
                    $pubDateStr = $parsedDate.ToLocalTime().ToString("yyyy-MM-dd HH:mm")
                }
            } catch {}

            $newsObj = [ordered]@{
                category    = $feed.Category
                title       = $cleanTitle
                source      = $sourceName
                publishedAt = $pubDateStr
                summary     = $descText
                points      = @(
                    "カテゴリ: $($feed.Label) の注目トレンド",
                    "報道元: $sourceName ($pubDateStr)",
                    "詳細は下部のリンクから元記事を参照できます"
                )
                impact      = "$($feed.Label)分野での主要トピックとして注目を集めています。関連する市場やサービスへの影響をチェックしておきましょう。"
                tags        = @($feed.Label, $sourceName)
                url         = [string]$item.link
            }

            $newsItems.Add($newsObj)
            if ($keywords.Count -lt 5) {
                $shortKw = if ($cleanTitle.Length -gt 18) { $cleanTitle.Substring(0, 18) + "…" } else { $cleanTitle }
                $keywords.Add($shortKw)
            }
        }
    } catch {
        Write-Warning "Failed to fetch $($feed.Label): $_"
    }
}

if ($newsItems.Count -eq 0) {
    throw "ニュースを1件も取得できませんでした。ネットワーク接続を確認してください。"
}

$payload = [ordered]@{
    date      = Format-JapaneseDate $now
    updatedAt = $now.ToString("yyyy-MM-dd HH:mm")
    title     = "今日のトレンドニュース ブリーフィング"
    keywords  = $keywords.ToArray()
    items     = $newsItems.ToArray()
}

$jsonString = $payload | ConvertTo-Json -Depth 6
$jsContent = "window.NEWS_DATA = $jsonString;`n"

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutputJsonPath, $jsonString, $utf8NoBom)
[System.IO.File]::WriteAllText($OutputJsPath, $jsContent, $utf8NoBom)

Write-Host "Successfully updated $($newsItems.Count) news items -> $OutputJsPath"
