$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$taskNode = (Get-Command node).Source
if (-not (Test-Path -LiteralPath 'desktop-build/server.mjs')) { throw 'Run pnpm desktop:build first.' }
$taskStatic = Join-Path $taskRoot 'desktop-build/static'
$taskServer = Join-Path $taskRoot 'desktop-build/server.mjs'
node scripts/collect-licenses.mjs
if ($LASTEXITCODE -ne 0) { throw 'License collection failed.' }
$taskLicenses = Join-Path $taskRoot 'desktop-build/licenses'
$taskPythonLicense = python -c "import sys,pathlib; print(pathlib.Path(sys.base_prefix)/'LICENSE.txt')"
Copy-Item -LiteralPath $taskPythonLicense -Destination (Join-Path $taskLicenses 'PYTHON-LICENSE.txt')
python -m PyInstaller --noconfirm --clean --windowed --onefile --name DasiNanum --distpath artifacts --workpath desktop-build/pyinstaller --specpath desktop-build --add-binary "$taskNode;runtime" --add-data "$taskStatic;desktop-build/static" --add-data "$taskServer;desktop-build" --add-data "$taskLicenses;licenses" desktop/launcher.py
if ($LASTEXITCODE -ne 0) { throw 'Windows packaging failed.' }
Compress-Archive -LiteralPath 'artifacts/DasiNanum.exe','README.md','docs/발표.md',$taskLicenses -DestinationPath 'artifacts/DasiNanum-Windows.zip' -Force
Get-FileHash -LiteralPath 'artifacts/DasiNanum.exe' -Algorithm SHA256
