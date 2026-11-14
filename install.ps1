# Установка SFSS и Anti-Fire на Windows из клона репозитория.
#
#   powershell -ExecutionPolicy Bypass -File install.ps1              поставить и проверить
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Yes         не задавать вопросов
#   powershell -ExecutionPolicy Bypass -File install.ps1 -NoLlm       не трогать нейросеть
#   powershell -ExecutionPolicy Bypass -File install.ps1 -NoApp       не ставить Anti-Fire
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall   убрать всё, что поставил скрипт
#
# Python и библиотеки ставит uv: один файл, без прав администратора, Python сам
# скачивает, если его нет. Повторный запуск безопасен. macOS и Linux: install.sh.
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
function Fail($text) { Write-Host ""; Write-Host "Ошибка: $text" -ForegroundColor Red; exit 1 }
function Ask($text) {
    if ($Yes) { return $true }
    if (-not [Environment]::UserInteractive -or [Console]::IsInputRedirected) { return $false }
    $answer = Read-Host "    $text [Д/н]"
    return ($answer -eq "" -or $answer -match "^(д|да|y|yes)$")
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

# --- Удаление ----------------------------------------------------------------

if ($Uninstall) {
    Step "Останавливаю SFSS"
    if (Test-Path $VenvSfss) { Run $VenvSfss stop | Out-Null; Note "остановлен" } else { Note "не установлен" }
    Step "Убираю команду sfss"
    if (Test-Path $Bin) { Remove-Item $Bin -Recurse -Force; Note "удалена $Shim" } else { Note "её и не было" }
    $kept = ((UserPath) -split ";" | Where-Object { $_ -and $_ -ne $Bin }) -join ";"
    [Environment]::SetEnvironmentVariable("Path", $kept, "User")
    Step "Убираю окружение, модель поиска и состояние демона"
    $ToolsUv = Join-Path $Tools "uv.exe"
    if (Test-Path $ToolsUv) {
        # uv ставил этот скрипт, значит его кэш и скачанный Python тоже наши
        Run $ToolsUv cache clean | Out-Null
        Run $ToolsUv python uninstall --all | Out-Null
        Note "кэш uv и скачанный им Python удалены"
    }
    foreach ($path in @($Venv, $Tools, (Join-Path $Sfss "data\embedding"), (Join-Path $Sfss "data\run"), (Join-Path $Sfss "data\chroma"))) {
        if (Test-Path $path) { Remove-Item $path -Recurse -Force }
    }
    Note "готово"
    Step "Убираю Anti-Fire"
    Get-Process anti-fire, Anti-Fire -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    $found = $false
    foreach ($path in @($AppDir, $Shortcut, (Join-Path $env:LOCALAPPDATA "org.twinbyte.antifire"))) {
        if (Test-Path $path) { Remove-Item $path -Recurse -Force; Note "удалено: $path"; $found = $true }
    }
    if (-not $found) { Note "её и не было" }
    Write-Host ""
    Write-Host "Готово. Остались: клон в $Root, отчёты NASA, индекс, sfss\.env и настройки нейросети."
    Note "Нейросеть в LM Studio или Ollama не тронута: её удаляют там же."
    exit 0
}

Write-Host "Установка SFSS из $Root"

# --- 1. uv -------------------------------------------------------------------

Step "Установщик пакетов uv"
$Uv = (Get-Command uv -ErrorAction SilentlyContinue).Source
if (-not $Uv -and (Test-Path (Join-Path $Tools "uv.exe"))) { $Uv = Join-Path $Tools "uv.exe" }
if (-not $Uv) {
    Note "скачиваю uv $UvVersion, около 20 МБ, в $Tools"
    # UV_UNMANAGED_INSTALL: только в эту папку, PATH не трогается
    $env:UV_UNMANAGED_INSTALL = $Tools
    try {
        Invoke-RestMethod "https://astral.sh/uv/$UvVersion/install.ps1" | Invoke-Expression | Out-Null
    } catch { Fail "uv не скачался. Проверьте сеть и запустите установку снова." }
    Remove-Item Env:UV_UNMANAGED_INSTALL
    $Uv = Join-Path $Tools "uv.exe"
}
Note (& $Uv --version)

# --- 2. Python и библиотеки --------------------------------------------------

Step "Python $PythonVersion и библиотеки SFSS, около 100 МБ"
if (Test-Path $Py) {
    & $Py -c "import sys; sys.exit(sys.version_info[:2] != (3, 12))" 2>$null
    if ($LASTEXITCODE -ne 0) { Note "окружение от другой версии Python, пересоздаю"; Remove-Item $Venv -Recurse -Force }
}
if (-not (Test-Path $Py)) {
    # Если Python 3.12 на машине нет, uv скачает его сам, около 20 МБ
    if ((Run $Uv venv --python $PythonVersion $Venv) -ne 0) { Fail "Не создалось окружение Python. Проверьте сеть и запустите установку снова." }
}
if ((Run $Uv pip install --python $Py -e $Sfss) -ne 0) {
    Fail "Библиотеки не поставились. Проверьте сеть и запустите установку снова: скачанное не пропадёт."
}
Note "готово: $Venv"

# --- 3. Настройки ------------------------------------------------------------

Step "Настройки"
$EnvFile = Join-Path $Sfss ".env"
if (Test-Path $EnvFile) { Note "sfss\.env уже есть, не трогаю" }
else { Copy-Item (Join-Path $Sfss ".env.example") $EnvFile; Note "создан sfss\.env" }

# --- 4. Модель поиска --------------------------------------------------------

Step "Модель поиска по отчётам, 130 МБ, один раз"
Push-Location $Sfss
$code = Run $Py -m app.services.embedder
Pop-Location
if ($code -ne 0) { Fail "Модель поиска не скачалась. Проверьте сеть и запустите установку снова." }

# --- 5. Индекс ---------------------------------------------------------------

Step "Индекс по отчётам NASA"
if (Test-Path (Join-Path $Sfss "data\index\chunks.jsonl")) { Note "готовый, из репозитория" }
else {
    Note "его нет в папке, собираю, около минуты"
    Push-Location $Sfss
    $code = Run $Py scripts\ingest_documents.py
    Pop-Location
    if ($code -ne 0) { Fail "Индекс не собрался. Вручную: cd sfss; .venv\Scripts\python scripts\ingest_documents.py" }
}

# --- 6. Команда sfss ---------------------------------------------------------

Step "Команда sfss"
New-Item -ItemType Directory -Force $Bin | Out-Null
# PYTHONUTF8: консоль и файлы Windows по умолчанию не в UTF-8, а sfss пишет по-русски
Set-Content -Path $Shim -Encoding ASCII -Value "@echo off`r`nset PYTHONUTF8=1`r`n`"$VenvSfss`" %*"
if (((UserPath) -split ";") -notcontains $Bin) {
    [Environment]::SetEnvironmentVariable("Path", ((UserPath).TrimEnd(";") + ";" + $Bin), "User")
    Note "папка $Bin добавлена в PATH: откройте новый терминал, чтобы команда появилась"
}
Note $Shim

# --- 7. Anti-Fire ------------------------------------------------------------

$AppState = "пропущена"
if (-not $NoApp) {
    Step "Программа Anti-Fire"
    $Zip = Join-Path $Release "Anti-Fire-windows-x64.zip"
    if (-not (Test-Path $Zip)) { Note "готовой сборки в $Release нет" }
    elseif (Ask "Поставить Anti-Fire в $AppDir?") {
        Get-Process anti-fire, Anti-Fire -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        if (Test-Path $AppDir) { Remove-Item $AppDir -Recurse -Force }
        $Unpack = Join-Path $env:TEMP "anti-fire-unpack"
        if (Test-Path $Unpack) { Remove-Item $Unpack -Recurse -Force }
        Expand-Archive -Path $Zip -DestinationPath $Unpack
        Move-Item (Join-Path $Unpack "Anti-Fire") $AppDir
        Remove-Item $Unpack -Recurse -Force
        $Exe = Join-Path $AppDir "Anti-Fire.exe"
        $link = (New-Object -ComObject WScript.Shell).CreateShortcut($Shortcut)
        $link.TargetPath = $Exe
        $link.WorkingDirectory = $AppDir
        $link.Save()
        $AppState = "$Exe, есть в меню «Пуск»"
        Note $AppState
    }
}

# --- 8. Нейросеть ------------------------------------------------------------

$LlmState = "пропущена"
if (-not $NoLlm) {
    Step "Нейросеть для ответов на вопросы"
    $Lms = (Get-Command lms -ErrorAction SilentlyContinue).Source
    $LmsDefault = Join-Path $HOME ".lmstudio\bin\lms.exe"
    if (-not $Lms -and (Test-Path $LmsDefault)) { $Lms = $LmsDefault }
    $Ollama = (Get-Command ollama -ErrorAction SilentlyContinue).Source
    $OllamaDefault = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
    if (-not $Ollama -and (Test-Path $OllamaDefault)) { $Ollama = $OllamaDefault }

    if ($Lms) {
        Note "найден LM Studio: $Lms"
        if ((& $Lms ls 2>$null | Out-String) -match [regex]::Escape($ModelId)) {
            Note "модель $ModelId уже скачана"; $LlmState = "LM Studio, $ModelId"
        } elseif (Ask "Скачать Ministral 3B, около 3 ГБ?") {
            if ((Run $Lms get $ModelGguf --yes) -eq 0) { $LlmState = "LM Studio, $ModelId" }
            else { Note "не скачалась. Вручную: lms get $ModelGguf"; $LlmState = "LM Studio без модели" }
        } else { Note "позже: lms get $ModelGguf"; $LlmState = "LM Studio без модели" }
    } elseif ($Ollama) {
        Note "найдена Ollama: $Ollama"
        $have = ((& $Ollama list 2>$null | Out-String) -match [regex]::Escape($ModelOllama))
        if (-not $have -and (Ask "Скачать $ModelOllama, около 3 ГБ?")) { $have = ((Run $Ollama pull $ModelOllama) -eq 0) }
        Run $VenvSfss config runtime ollama | Out-Null
        if ($have) { Run $VenvSfss config model $ModelOllama | Out-Null; $LlmState = "Ollama, $ModelOllama" }
        else { Note "позже: ollama pull $ModelOllama; sfss config model $ModelOllama"; $LlmState = "Ollama без модели" }
    } else {
        Note "LM Studio и Ollama не найдены. Расчёт, CSV и Площадка работают и без нейросети."
        Note "Для ответов на вопросы поставьте одно из двух и запустите установку ещё раз:"
        Note "    LM Studio  https://lmstudio.ai"
        Note "    Ollama     https://ollama.com"
        $LlmState = "не найдена"
    }
}

# --- 9. Проверка -------------------------------------------------------------

Step "Запускаю и проверяю"
if ((Run $VenvSfss start) -ne 0) { Fail "SFSS не запустился. Причина в логе: sfss logs" }
if ((Run $VenvSfss predict --o2 0.30 --psi 8.2) -ne 0) { Fail "Расчёт не ответил. Лог: sfss logs" }

Write-Host @"

Готово. SFSS установлен и работает.
    Anti-Fire:  $AppState
    Нейросеть:  $LlmState

    sfss status                      что запущено
    sfss predict --o2 0.30 --psi 8.2 расчёт
    sfss ask "Как гелий в атмосфере влияет на горение?"
    sfss playground                  Площадка в браузере
    sfss stop                        остановить
    install.ps1 -Uninstall           удалить всё

Подробности: INSTALL.md
"@
