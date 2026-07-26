$ErrorActionPreference = "Continue"

$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = "C:\Users\Liuhy\AppData\Local\Programs\Python\Python312\python.exe"
$outputDirectory = Join-Path $projectRoot "outputs"
$logPath = Join-Path $outputDirectory "scheduler.log"

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
Set-Location -LiteralPath $projectRoot
$env:PYTHONUNBUFFERED = "1"

$startedAt = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
Add-Content -LiteralPath $logPath -Value "[$startedAt] Scheduled PwC crawl started."

try {
    $crawlOutput = & $pythonPath -m big_four_monitor crawl --firm pwc 2>&1
    $exitCode = $LASTEXITCODE
    if ($crawlOutput) {
        $crawlOutput | Add-Content -LiteralPath $logPath
    }
    $finishedAt = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
    Add-Content -LiteralPath $logPath -Value "[$finishedAt] Scheduled PwC crawl finished with exit code $exitCode."
    exit $exitCode
}
catch {
    $failedAt = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
    Add-Content -LiteralPath $logPath -Value "[$failedAt] Scheduled PwC crawl failed: $($_.Exception.Message)"
    exit 1
}
