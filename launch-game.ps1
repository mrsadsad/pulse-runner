param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$gameRoot = $PSScriptRoot
$gameUrl = 'http://127.0.0.1:4185/'
$gameEntry = Join-Path $gameRoot 'web\index.html'

function Test-GameServer {
    try {
        $response = Invoke-WebRequest -Uri $gameUrl -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200 -and $response.Content.Contains('PULSE RUNNER')
    } catch { return $false }
}

if (-not (Test-Path -LiteralPath $gameEntry)) { throw 'Game files are missing. Extract the entire source ZIP first.' }
if (-not (Test-GameServer)) {
    $gameNode = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($gameNode) {
        $gameLogs = Join-Path $gameRoot 'qa'
        New-Item -ItemType Directory -Path $gameLogs -Force | Out-Null
        Start-Process -FilePath $gameNode.Source -ArgumentList 'preview.cjs' -WorkingDirectory $gameRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $gameLogs 'preview-output.log') -RedirectStandardError (Join-Path $gameLogs 'preview-error.log') | Out-Null
        for ($attempt = 0; $attempt -lt 8; $attempt++) {
            if (Test-GameServer) { break }
            Start-Sleep -Milliseconds 250
        }
    }
}

if (-not (Test-GameServer)) {
    # Classic scripts also run directly from disk; Node is optional for playing.
    $gameUrl = ([System.Uri]::new($gameEntry)).AbsoluteUri
}
if (-not $NoBrowser) { Start-Process -FilePath $gameUrl }
Write-Output $gameUrl
