$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $projectRoot 'backend'
$apiDir = $backendDir
$envFile = Join-Path $backendDir '.env'

if (-not (Test-Path $envFile)) {
  throw "Missing .env. Put your local API settings in $envFile (see $(Join-Path $apiDir '.env.example'))."
}

if (-not (Test-Path (Join-Path $apiDir 'app\main.py'))) {
  throw "Could not find the API app at $(Join-Path $apiDir 'app\main.py')"
}

$pythonExe = Join-Path $apiDir '.venv\Scripts\python.exe'
if (-not (Test-Path $pythonExe)) {
  $pythonExe = 'python'
}

$uvicornCheck = & $pythonExe -c "import uvicorn" 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Backend Python dependencies are missing from $pythonExe. Install them on Windows with: backend\.venv\Scripts\python.exe -m pip install --isolated --index-url https://pypi.org/simple -r backend\requirements.txt --no-deps; backend\.venv\Scripts\python.exe -m pip install --isolated --index-url https://pypi.org/simple fastapi==0.143.1 starlette==1.0.0 'uvicorn==0.46.0' gunicorn==26.2.0 'psycopg[binary,pool]==3.3.6' psycopg-binary==3.3.6 psycopg-pool==3.3.3 orjson==3.13.0 pydantic==2.13.3 pydantic_core==2.46.3 cryptography==46.0.7 anyio==4.13.0 httptools==0.9.0 h11==0.16.0"
}

$apiScript = @'
Set-Location '__APIDIR__'
Get-Content '__ENVFILE__' | ForEach-Object {
  if ($_ -match '^\s*([^#=\s]+)\s*=(.*)$') {
    [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
  }
}
$env:PYTHONPATH = '.'
'__PYTHON__' -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
'@
$apiScript = $apiScript.Replace('__APIDIR__', $apiDir).Replace('__ENVFILE__', $envFile).Replace('__PYTHON__', $pythonExe)

$webScript = @'
Set-Location '__FRONTEND__'
$env:API_PROXY_TARGET = 'http://127.0.0.1:8000'
npm run dev -- --mode http --host 127.0.0.1
'@
$webScript = $webScript.Replace('__FRONTEND__', (Join-Path $projectRoot 'frontend'))

Start-Process powershell.exe -ArgumentList @('-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $apiScript) -WindowStyle Hidden
Start-Sleep -Seconds 2
Start-Process powershell.exe -ArgumentList @('-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $webScript) -WindowStyle Hidden

Write-Host 'Backend:  http://127.0.0.1:8000'
Write-Host 'Frontend: http://127.0.0.1:5173'
