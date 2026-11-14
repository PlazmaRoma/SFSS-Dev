# Installs SFSS and Anti-Fire on Windows from a clone of the repository.
#
#   powershell -ExecutionPolicy Bypass -File install.ps1              install and check
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Yes         answer yes to every question
#   powershell -ExecutionPolicy Bypass -File install.ps1 -NoLlm       leave the language model alone
#   powershell -ExecutionPolicy Bypass -File install.ps1 -NoApp       skip the Anti-Fire app
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall   remove everything this script installed
#
# Python and libraries come through uv: one file, no admin rights, and it downloads
# Python itself if needed. Safe to run again. macOS and Linux: install.sh.
param([switch]$Yes, [switch]$NoLlm, [switch]$NoApp, [switch]$Uninstall)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # иначе Invoke-WebRequest качает в разы медленнее
$env:PYTHONUTF8 = "1"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Root = $PSScriptRoot
$Sfss = Join-Path $Root "sfss"
$Venv = Join-Path $Sfss ".venv"
$Py = Join-Path $Venv "Scripts\python.exe"
$VenvSfss = Join-Path $Venv "Scripts\sfss.exe"
$Tools = Join-Path $Root ".tools"
$Bin = Join-Path $env:LOCALAPPDATA "sfss\bin"
$Shim = Join-Path $Bin "sfss.cmd"
$AppDir = Join-Path $env:LOCALAPPDATA "Programs\Anti-Fire"
$Shortcut = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Anti-Fire.lnk"
$Release = Join-Path $Root "apps\anti-fire\release"
$PythonVersion = "3.12"
$UvVersion = "0.12.5"
$ModelId = "ministral-3-3b-instruct-2512"
$ModelGguf = "https://huggingface.co/lmstudio-community/Ministral-3-3B-Instruct-2512-GGUF"
$ModelOllama = "ministral-3:3b"

$script:StepNo = 0
function Step($text) { $script:StepNo++; Write-Host ""; Write-Host "[$($script:StepNo)] $text" }
function Note($text) { Write-Host "    $text" }
function Fail($text) { Write-Host ""; Write-Host "Error: $text" -ForegroundColor Red; exit 1 }
function Ask($text) {
    if ($Yes) { return $true }
    if (-not [Environment]::UserInteractive -or [Console]::IsInputRedirected) { return $false }
    $answer = Read-Host "    $text [Y/n]"
    return ($answer -eq "" -or $answer -match "^(y|yes|д|да)$")
}
function UserPath { [Environment]::GetEnvironmentVariable("Path", "User") }
function Run {
    # Внешняя команда: ошибка — по коду выхода, а не по строкам в stderr. Именованных
    # параметров нет намеренно: иначе PowerShell принимает ключи вроде -e из
    # «uv pip install -e» за свои и подменяет ими саму команду
    $exe = $args[0]
    $rest = @($args | Select-Object -Skip 1)
    $global:LASTEXITCODE = 0
    try {
        # Stop: «команда не найдена» становится ошибкой, а не строкой в выводе.
        # stderr внешней команды не перенаправлен, поэтому его строки ошибкой не считаются
        $ErrorActionPreference = "Stop"
        # Вывод сразу на экран: иначе он смешался бы с кодом выхода в ответе функции
        & $exe @rest | Out-Host
    } catch {
        Write-Host "    $_" -ForegroundColor Red
        return 1
    }
    return $LASTEXITCODE
}

function Capture {
    # Вывод команды строкой. Под Stop Windows PowerShell 5 превращает любую строку
    # stderr в ошибку, если stderr перенаправлен: так «lms ls» с его «Waking up
    # LM Studio service...» обрывал установку. Здесь stderr просто отбрасывается
    $exe = $args[0]
    $rest = @($args | Select-Object -Skip 1)
    $ErrorActionPreference = "Continue"
    try { return (& $exe @rest 2>$null | Out-String) } catch { return "" }
}

# --- Удаление ----------------------------------------------------------------

if ($Uninstall) {
    Step "Stopping SFSS"
    if (Test-Path $VenvSfss) { Run $VenvSfss stop | Out-Null; Note "stopped" } else { Note "not installed" }
    Step "Removing the sfss command"
    if (Test-Path $Bin) { Remove-Item $Bin -Recurse -Force; Note "removed $Shim" } else { Note "it was not there" }
    $kept = ((UserPath) -split ";" | Where-Object { $_ -and $_ -ne $Bin }) -join ";"
    [Environment]::SetEnvironmentVariable("Path", $kept, "User")
    Step "Removing the environment, search model and daemon state"
    $ToolsUv = Join-Path $Tools "uv.exe"
    if (Test-Path $ToolsUv) {
        # uv ставил этот скрипт, значит его кэш и скачанный Python тоже наши
        Run $ToolsUv cache clean | Out-Null
        Run $ToolsUv python uninstall --all | Out-Null
        Note "removed the uv cache and the Python it downloaded"
    }
    foreach ($path in @($Venv, $Tools, (Join-Path $Sfss "data\embedding"), (Join-Path $Sfss "data\run"), (Join-Path $Sfss "data\chroma"))) {
        if (Test-Path $path) { Remove-Item $path -Recurse -Force }
    }
    Note "done"
    Step "Removing Anti-Fire"
    Get-Process anti-fire, Anti-Fire -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    $found = $false
    foreach ($path in @($AppDir, $Shortcut, (Join-Path $env:LOCALAPPDATA "org.twinbyte.antifire"))) {
        if (Test-Path $path) { Remove-Item $path -Recurse -Force; Note "removed: $path"; $found = $true }
    }
    if (-not $found) { Note "it was not there" }
    Write-Host ""
    Write-Host "Done. Kept: the clone in $Root, NASA reports, the index, sfss\.env and model settings."
    Note "The language model in LM Studio or Ollama is untouched: remove it there."
    exit 0
}

Write-Host "Installing SFSS from $Root"

# --- 1. uv -------------------------------------------------------------------

Step "Package installer uv"
$Uv = (Get-Command uv -ErrorAction SilentlyContinue).Source
if (-not $Uv -and (Test-Path (Join-Path $Tools "uv.exe"))) { $Uv = Join-Path $Tools "uv.exe" }
if (-not $Uv) {
    Note "downloading uv $UvVersion, about 20 MB, into $Tools"
    # UV_UNMANAGED_INSTALL: только в эту папку, PATH не трогается
    $env:UV_UNMANAGED_INSTALL = $Tools
    try {
        Invoke-RestMethod "https://astral.sh/uv/$UvVersion/install.ps1" | Invoke-Expression | Out-Null
    } catch { Fail "Could not download uv. Check the network and run the installer again." }
    Remove-Item Env:UV_UNMANAGED_INSTALL
    $Uv = Join-Path $Tools "uv.exe"
}
Note (& $Uv --version)

# --- 2. Python и библиотеки --------------------------------------------------

Step "Python $PythonVersion and SFSS libraries, about 100 MB"
if (Test-Path $Py) {
    $version = (Capture $Py -c "import sys; print('%d.%d' % sys.version_info[:2])").Trim()
    if ($version -ne "3.12") { Note "the environment uses another Python version, recreating it"; Remove-Item $Venv -Recurse -Force }
}
if (-not (Test-Path $Py)) {
    # Если Python 3.12 на машине нет, uv скачает его сам, около 20 МБ
    if ((Run $Uv venv --python $PythonVersion $Venv) -ne 0) { Fail "Could not create the Python environment. Check the network and run the installer again." }
}
if ((Run $Uv pip install --python $Py -e $Sfss) -ne 0) {
    Fail "Libraries did not install. Check the network and run the installer again: downloads are kept."
}
Note "done: $Venv"

# --- 3. Настройки ------------------------------------------------------------

Step "Settings"
$EnvFile = Join-Path $Sfss ".env"
if (Test-Path $EnvFile) { Note "sfss\.env already exists, leaving it" }
else { Copy-Item (Join-Path $Sfss ".env.example") $EnvFile; Note "created sfss\.env" }

# --- 4. Модель поиска --------------------------------------------------------

Step "Search model for the reports, 130 MB, once"
Push-Location $Sfss
$code = Run $Py -m app.services.embedder
Pop-Location
if ($code -ne 0) { Fail "Could not download the search model. Check the network and run the installer again." }

# --- 5. Индекс ---------------------------------------------------------------

Step "Index of the NASA reports"
if (Test-Path (Join-Path $Sfss "data\index\chunks.jsonl")) { Note "ready, from the repository" }
else {
    Note "not found, building it, about a minute"
    Push-Location $Sfss
    $code = Run $Py scripts\ingest_documents.py
    Pop-Location
    if ($code -ne 0) { Fail "Could not build the index. By hand: cd sfss; .venv\Scripts\python scripts\ingest_documents.py" }
}

# --- 6. Команда sfss ---------------------------------------------------------

Step "The sfss command"
New-Item -ItemType Directory -Force $Bin | Out-Null
# PYTHONUTF8: консоль и файлы Windows по умолчанию не в UTF-8, а sfss пишет по-русски
Set-Content -Path $Shim -Encoding ASCII -Value "@echo off`r`nset PYTHONUTF8=1`r`n`"$VenvSfss`" %*"
if (((UserPath) -split ";") -notcontains $Bin) {
    [Environment]::SetEnvironmentVariable("Path", ((UserPath).TrimEnd(";") + ";" + $Bin), "User")
    Note "added $Bin to PATH: open a new terminal to get the command"
}
Note $Shim

# --- 7. Anti-Fire ------------------------------------------------------------

$AppState = "skipped"
if (-not $NoApp) {
    Step "Anti-Fire app"
    $Zip = Join-Path $Release "Anti-Fire-windows-x64.zip"
    if (-not (Test-Path $Zip)) { Note "no ready build in $Release" }
    elseif (Ask "Install Anti-Fire into $AppDir?") {
        Get-Process anti-fire, Anti-Fire -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        if (Test-Path $AppDir) { Remove-Item $AppDir -Recurse -Force }
        $Unpack = Join-Path $env:TEMP "anti-fire-unpack"
        if (Test-Path $Unpack) { Remove-Item $Unpack -Recurse -Force }
        Expand-Archive -Path $Zip -DestinationPath $Unpack
        # На чистой Windows папки Programs в LOCALAPPDATA ещё нет
        New-Item -ItemType Directory -Force (Split-Path $AppDir) | Out-Null
        Move-Item (Join-Path $Unpack "Anti-Fire") $AppDir
        Remove-Item $Unpack -Recurse -Force
        $Exe = Join-Path $AppDir "Anti-Fire.exe"
        New-Item -ItemType Directory -Force (Split-Path $Shortcut) | Out-Null
        $link = (New-Object -ComObject WScript.Shell).CreateShortcut($Shortcut)
        $link.TargetPath = $Exe
        $link.WorkingDirectory = $AppDir
        $link.Save()
        $AppState = "$Exe, also in the Start menu"
        Note $AppState
    }
    else { Note "skipped" }
}

# --- 8. Нейросеть ------------------------------------------------------------

$LlmState = "skipped"
if (-not $NoLlm) {
    Step "Language model for answering questions"
    $Lms = (Get-Command lms -ErrorAction SilentlyContinue).Source
    $LmsDefault = Join-Path $HOME ".lmstudio\bin\lms.exe"
    if (-not $Lms -and (Test-Path $LmsDefault)) { $Lms = $LmsDefault }
    $Ollama = (Get-Command ollama -ErrorAction SilentlyContinue).Source
    $OllamaDefault = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
    if (-not $Ollama -and (Test-Path $OllamaDefault)) { $Ollama = $OllamaDefault }

    if ($Lms) {
        Note "found LM Studio: $Lms"
        if ((Capture $Lms ls) -match [regex]::Escape($ModelId)) {
            Note "model $ModelId is already downloaded"; $LlmState = "LM Studio, $ModelId"
        } elseif (Ask "Download Ministral 3B, about 3 GB?") {
            if ((Run $Lms get $ModelGguf --yes) -eq 0) { $LlmState = "LM Studio, $ModelId" }
            else { Note "download failed. By hand: lms get $ModelGguf"; $LlmState = "LM Studio, no model" }
        } else { Note "later: lms get $ModelGguf"; $LlmState = "LM Studio, no model" }
    } elseif ($Ollama) {
        Note "found Ollama: $Ollama"
        $have = ((Capture $Ollama list) -match [regex]::Escape($ModelOllama))
        if (-not $have -and (Ask "Download $ModelOllama, about 3 GB?")) { $have = ((Run $Ollama pull $ModelOllama) -eq 0) }
        Run $VenvSfss config runtime ollama | Out-Null
        if ($have) { Run $VenvSfss config model $ModelOllama | Out-Null; $LlmState = "Ollama, $ModelOllama" }
        else { Note "later: ollama pull $ModelOllama; sfss config model $ModelOllama"; $LlmState = "Ollama, no model" }
    } else {
        Note "Neither LM Studio nor Ollama found. Calculations, CSV and the Playground work without a model."
        Note "To answer questions, install one of them and run the installer again:"
        Note "    LM Studio  https://lmstudio.ai"
        Note "    Ollama     https://ollama.com"
        $LlmState = "not found"
    }
}

# --- 9. Проверка -------------------------------------------------------------

Step "Starting and checking"
if ((Run $VenvSfss start) -ne 0) { Fail "SFSS did not start. The reason is in the log: sfss logs" }
if ((Run $VenvSfss predict --o2 0.30 --psi 8.2) -ne 0) { Fail "The calculation did not answer. Log: sfss logs" }

Write-Host @"

Done. SFSS is installed and running.
    Anti-Fire:  $AppState
    Model:      $LlmState

    sfss status                      what is running
    sfss predict --o2 0.30 --psi 8.2 a calculation
    sfss ask "How does helium in the atmosphere affect combustion?"
    sfss playground                  the Playground in a browser
    sfss stop                        stop the service
    install.ps1 -Uninstall           remove everything

Details: INSTALL.md
"@
