$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $projectRoot 'backend'
$frontendDir = Join-Path $projectRoot 'frontend'
$envFile = Join-Path $projectRoot '.env'

if (-not (Test-Path $envFile)) {
  throw "Missing .env at $envFile"
}

Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([^#=\s]+)\s*=(.*)$') {
    [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
  }
}

$env:PYTHONPATH = $backendDir
$env:API_PROXY_TARGET = 'http://127.0.0.1:8000'

Write-Host 'Starting API on http://127.0.0.1:8000'
Start-Process -FilePath 'python' -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000') -WorkingDirectory $backendDir -NoNewWindow

Set-Location $frontendDir
Write-Host 'Starting frontend on http://127.0.0.1:5173'
npm run dev -- --mode http --host 127.0.0.1
