# Установка SFSS на Windows из клона репозитория.
#
#   powershell -ExecutionPolicy Bypass -File install.ps1              поставить и проверить
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Yes         не задавать вопросов
#   powershell -ExecutionPolicy Bypass -File install.ps1 -NoLlm       не трогать нейросеть
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall   убрать установку
#
# Повторный запуск безопасен. macOS и Linux: install.sh. Подробности: INSTALL.md.
# На настоящей Windows вживую не проверялось: только в GitHub Actions, без нейросети.
param([switch]$Yes, [switch]$NoLlm, [switch]$Uninstall)

$ErrorActionPreference = "Stop"
$env:PYTHONUTF8 = "1"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Root = $PSScriptRoot
$Sfss = Join-Path $Root "sfss"
$Venv = Join-Path $Sfss ".venv"
$VenvPython = Join-Path $Venv "Scripts\python.exe"
$VenvSfss = Join-Path $Venv "Scripts\sfss.exe"
$Bin = Join-Path $env:LOCALAPPDATA "sfss\bin"
$Shim = Join-Path $Bin "sfss.cmd"
$ModelId = "ministral-3-3b-instruct-2512"
$ModelGguf = "https://huggingface.co/lmstudio-community/Ministral-3-3B-Instruct-2512-GGUF"
$ModelOllama = "ministral-3:3b"

function Step($text) { Write-Host ""; Write-Host "-> $text" }
function Note($text) { Write-Host "  $text" }
function Fail($text) { Write-Host ""; Write-Host "Ошибка: $text" -ForegroundColor Red; exit 1 }
function Ask($text) {
    if ($Yes) { return $true }
    if (-not [Environment]::UserInteractive) { return $false }
    $answer = Read-Host "  $text [Д/н]"
    return ($answer -eq "" -or $answer -match "^(д|да|y|yes)$")
}
function UserPath { [Environment]::GetEnvironmentVariable("Path", "User") }

# --- Удаление ----------------------------------------------------------------

if ($Uninstall) {
    Step "Останавливаю SFSS"
    if (Test-Path $VenvSfss) { & $VenvSfss stop } else { Note "не установлен" }
    Step "Убираю команду sfss"
    if (Test-Path $Shim) { Remove-Item $Shim; Note "удалена $Shim" } else { Note "её и не было" }
    $kept = ((UserPath) -split ";" | Where-Object { $_ -and $_ -ne $Bin }) -join ";"
    [Environment]::SetEnvironmentVariable("Path", $kept, "User")
    Step "Убираю окружение, индекс и состояние демона"
    foreach ($path in @($Venv, (Join-Path $Sfss "data\chroma"), (Join-Path $Sfss "data\run"))) {
        if (Test-Path $path) { Remove-Item $path -Recurse -Force }
    }
    Write-Host ""
    Write-Host "Готово. Остались: клон в $Root, отчёты NASA, модель расчёта, sfss\.env и настройки нейросети."
    exit 0
}

# --- 1. Python ---------------------------------------------------------------

Step "Ищу Python 3.10 или новее"
$Python = $null
# Сначала python из PATH, потом проверенные версии: под самый новый Python библиотек
# может ещё не быть, а py -3 выбирает именно его
$candidates = @(@("python"), @("py", "-3.13"), @("py", "-3.12"), @("py", "-3.11"), @("py", "-3.10"), @("py", "-3"), @("python3"))
foreach ($candidate in $candidates) {
    $exe = $candidate[0]
    $rest = @($candidate | Select-Object -Skip 1)
    if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { continue }
    & $exe @rest -c "import sys; sys.exit(sys.version_info < (3, 10))" 2>$null
    if ($LASTEXITCODE -eq 0) { $Python = $candidate; break }
}
if (-not $Python) {
    Fail "Python 3.10+ не найден. Поставьте его с https://www.python.org/downloads/ (галочка «Add python.exe to PATH») и запустите установку снова."
}
$PythonExe = $Python[0]
$PythonArgs = @($Python | Select-Object -Skip 1)
Note (& $PythonExe @PythonArgs --version)

# --- 2. Окружение ------------------------------------------------------------

Step "Ставлю SFSS и его библиотеки (первый раз несколько минут)"
if (-not (Test-Path $VenvPython)) {
    & $PythonExe @PythonArgs -m venv $Venv
    if ($LASTEXITCODE -ne 0) { Fail "Не создалось окружение." }
}
# Как и на Linux: без этого адреса pip может взять PyTorch с CUDA, это гигабайты
& $VenvPython -m pip install --quiet --disable-pip-version-check --extra-index-url https://download.pytorch.org/whl/cpu -e $Sfss
if ($LASTEXITCODE -ne 0) { Fail "Библиотеки не поставились. Проверьте сеть. Если pip пишет о конфликте версий, поставьте Python 3.12: под самый новый Python библиотек может ещё не быть." }
Note "готово: $Venv"

# --- 3. Настройки ------------------------------------------------------------

Step "Настройки"
$EnvFile = Join-Path $Sfss ".env"
if (Test-Path $EnvFile) { Note "sfss\.env уже есть, не трогаю" }
else { Copy-Item (Join-Path $Sfss ".env.example") $EnvFile; Note "создан sfss\.env" }

# --- 4. Модель поиска --------------------------------------------------------

Step "Модель поиска по отчётам"
$LoadEmbeddings = @"
from app.config import get_settings
from sentence_transformers import SentenceTransformer
settings = get_settings()
SentenceTransformer(settings.embedding_model, local_files_only=settings.embedding_local_files_only)
print(settings.embedding_model)
"@
function LoadEmbeddings {
    Push-Location $Sfss
    try {
        $ErrorActionPreference = "Continue"
        $name = & $VenvPython -c $LoadEmbeddings 2>$null
        if ($LASTEXITCODE -eq 0) { return $name } else { return $null }
    } finally { $ErrorActionPreference = "Stop"; Pop-Location }
}
$name = LoadEmbeddings
if ($name) { Note "$name уже на диске" }
else {
    Note "скачиваю с Hugging Face, около 470 МБ, один раз"
    # Сервис работает без сети, поэтому скачивание разрешается только здесь
    $env:EMBEDDING_LOCAL_FILES_ONLY = "false"; $env:HF_HUB_OFFLINE = "0"
    $name = LoadEmbeddings
    Remove-Item Env:EMBEDDING_LOCAL_FILES_ONLY; Remove-Item Env:HF_HUB_OFFLINE
    if (-not $name) { Fail "Модель поиска не скачалась. Проверьте сеть и запустите установку снова." }
    Note "$name скачана"
}

# --- 5. Индекс ---------------------------------------------------------------

Step "Индекс по отчётам NASA"
function Chunks {
    Push-Location $Sfss
    try {
        $ErrorActionPreference = "Continue"
        $count = & $VenvPython -c "from app.dependencies import get_rag_service; print(get_rag_service().count())" 2>$null
        if ($LASTEXITCODE -eq 0) { return [int]$count } else { return 0 }
    } finally { $ErrorActionPreference = "Stop"; Pop-Location }
}
$count = Chunks
if ($count -gt 0) { Note "уже собран: $count фрагментов" }
else {
    Note "собираю, около минуты"
    Push-Location $Sfss
    try {
        $ErrorActionPreference = "Continue"
        & $VenvPython scripts\ingest_documents.py *> $null
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = "Stop"; Pop-Location }
    if ($code -ne 0) { Fail "Индекс не собрался. Запустите вручную: cd sfss; .venv\Scripts\python scripts\ingest_documents.py" }
    Note "собран: $(Chunks) фрагментов"
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

# --- 7. Нейросеть ------------------------------------------------------------

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
            & $Lms get $ModelGguf --yes
            if ($LASTEXITCODE -eq 0) { $LlmState = "LM Studio, $ModelId" }
            else { Note "не скачалась. Вручную: lms get $ModelGguf"; $LlmState = "LM Studio без модели" }
        } else { Note "позже: lms get $ModelGguf"; $LlmState = "LM Studio без модели" }
    } elseif ($Ollama) {
        Note "найдена Ollama: $Ollama"
        $have = ((& $Ollama list 2>$null | Out-String) -match [regex]::Escape($ModelOllama))
        if (-not $have -and (Ask "Скачать $ModelOllama, около 3 ГБ?")) {
            & $Ollama pull $ModelOllama
            $have = ($LASTEXITCODE -eq 0)
        }
        & $VenvSfss config runtime ollama | Out-Null
        if ($have) { & $VenvSfss config model $ModelOllama | Out-Null; $LlmState = "Ollama, $ModelOllama" }
        else { Note "позже: ollama pull $ModelOllama; sfss config model $ModelOllama"; $LlmState = "Ollama без модели" }
    } else {
        Note "LM Studio и Ollama не найдены. Расчёт, CSV и Площадка работают и без нейросети."
        Note "Для ответов на вопросы поставьте одно из двух и запустите установку ещё раз:"
        Note "    LM Studio  https://lmstudio.ai"
        Note "    Ollama     https://ollama.com"
        $LlmState = "не найдена"
    }
}

# --- 8. Проверка -------------------------------------------------------------

Step "Запускаю и проверяю"
& $VenvSfss start
if ($LASTEXITCODE -ne 0) { Fail "SFSS не запустился. Причина в логе: sfss logs" }
& $VenvSfss predict --o2 0.30 --psi 8.2
if ($LASTEXITCODE -ne 0) { Fail "Расчёт не ответил. Лог: sfss logs" }

Write-Host @"

Готово. SFSS установлен и работает. Нейросеть: $LlmState.

  sfss status                      что запущено
  sfss predict --o2 0.30 --psi 8.2 расчёт
  sfss ask "Как гелий в атмосфере влияет на горение?"
  sfss playground                  Площадка в браузере
  sfss stop                        остановить

Программа Anti-Fire и остальное: INSTALL.md
"@
