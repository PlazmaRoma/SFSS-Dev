# Установка на Windows

Ставятся две вещи: **SFSS** — сервис, который считает и отвечает, и **Anti-Fire** — программа
с окном. Обе ставит один скрипт PowerShell, права администратора не нужны.

Проверено вживую на Windows 10: с нуля 106 секунд. В GitHub Actions установка и удаление
проверяются на чистой Windows. Готовая сборка Anti-Fire — для x64.

## Что нужно заранее

- **Git for Windows**: [git-scm.com](https://git-scm.com/download/win).
- **WebView2** — для окна Anti-Fire. В Windows 10 и 11 он уже есть.

Python ставить не нужно: установщик скачает Python 3.12, если его нет. Уже стоящий Python не
используется и не трогается.

## Что скачается

| Что | Объём |
|---|---|
| Репозиторий: код, 16 отчётов NASA, готовый индекс, модель расчёта, Anti-Fire | около 150 МБ |
| uv — установщик пакетов, если его ещё нет | около 20 МБ |
| Python 3.12, если его нет | около 20 МБ |
| Библиотеки SFSS, 56 пакетов | около 100 МБ, на диске 330 МБ |
| Модель поиска по отчётам | 130 МБ |
| Нейросеть Ministral 3B, по желанию | около 3 ГБ |

После установки сеть не нужна.

## Установка

Откройте **PowerShell** (не обязательно от администратора) и выполните по очереди:

```powershell
git clone --depth 1 https://github.com/PlazmaRoma/SFSS-Dev.git $HOME\SFSS-Dev
```

```powershell
cd $HOME\SFSS-Dev; powershell -ExecutionPolicy Bypass -File install.ps1
```

`-ExecutionPolicy Bypass` разрешает запустить этот один скрипт и не меняет настройки Windows.

Шаги пронумерованы, у загрузок видно, сколько осталось. Установщик задаст два вопроса, на оба
можно нажать Enter:

1. **Поставить Anti-Fire в `%LOCALAPPDATA%\Programs\Anti-Fire`?** Появится ярлык в меню «Пуск».
2. **Скачать Ministral 3B?** Вопрос будет, только если стоит LM Studio или Ollama. Если
   видеокарта слабая, отвечайте «n».

В конце установщик запускает сервис и делает один расчёт. Если связь оборвалась, запустите
`install.ps1` снова: скачанное не пропадёт, готовые шаги пропускаются.

**Команда `sfss` появится только в новом окне PowerShell:** установщик добавляет её папку в
`PATH`, а уже открытые окна этого не видят.

| Параметр | Что делает |
|---|---|
| `-Yes` | отвечает «да» на все вопросы |
| `-NoLlm` | не трогает нейросеть |
| `-NoApp` | не ставит Anti-Fire |
| `-Uninstall` | убирает всё, что поставил |

## Проверка

В новом окне PowerShell:

```powershell
sfss status
sfss predict --o2 0.30 --psi 8.2
sfss playground
```

Ожидается: в индексе 1131 фрагмент, скорость горения 0.676 мм²/с, в 1,33 раза быстрее
обычного воздуха; в браузере открывается Площадка.

**Anti-Fire** — в меню «Пуск». При первом запуске SmartScreen может предупредить о неизвестном
издателе: «Подробнее» → «Выполнить в любом случае», сборка без подписи. Программа сама находит
команду `sfss`, поэтому кнопки «Start SFSS» и «Stop SFSS» работают сразу.

## Нейросеть

Ответы на вопросы пишет нейросеть на этом же компьютере, в LM Studio или Ollama. Без неё
работает всё остальное: расчёт, CSV, Площадка. Модели нужно около 3 ГБ видеопамяти или памяти.

**LM Studio.** Установить с [lmstudio.ai](https://lmstudio.ai) и один раз открыть.

```powershell
lms get https://huggingface.co/lmstudio-community/Ministral-3-3B-Instruct-2512-GGUF
sfss load
```

**Ollama.** Установить с [ollama.com](https://ollama.com).

```powershell
ollama pull ministral-3:3b
sfss config runtime ollama
sfss config model ministral-3:3b
```

Проще всего — запустить `install.ps1` ещё раз: он найдёт LM Studio или Ollama и предложит
скачать модель сам. Проверка: `sfss ask "How does helium in the atmosphere affect combustion?"`.

## Удаление

```powershell
cd $HOME\SFSS-Dev; powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall
```

Убирает:

- сервис: останавливает его;
- команду `sfss` и её папку из `PATH`;
- Python с библиотеками, модель поиска;
- uv из `.tools` вместе с его кэшем и скачанным Python, если uv ставил установщик;
- Anti-Fire: программу, ярлык в «Пуске» и её данные.

Остаются клон с отчётами NASA и индексом, `sfss\.env` и настройки нейросети. Клон после этого
можно удалить: `Remove-Item -Recurse -Force $HOME\SFSS-Dev`. Нейросеть в LM Studio или Ollama
не трогается: её удаляют там же.

В «Программах и компонентах» Windows Anti-Fire нет. Там показывается только то, что ставилось
установщиком Windows (MSI или EXE), а Anti-Fire — файлы в папке пользователя. Поэтому её
убирает та же команда, что и ставила.

## Обновление

```powershell
cd $HOME\SFSS-Dev; git pull; powershell -ExecutionPolicy Bypass -File install.ps1
```

## Если что-то пошло не так

| Что видно | Что делать |
|---|---|
| «Could not download uv» | проверить сеть; за прокси uv ставится вручную: https://docs.astral.sh/uv/ |
| `sfss` не распознано как команда | открыть новое окно PowerShell |
| «Port 8000 is taken» | `sfss start --port 8010` |
| «Could not download the search model» | проверить сеть и запустить `install.ps1` снова |
| LM Studio «not answering» | открыть LM Studio один раз, затем `sfss load` |
| Anti-Fire долго открывается | нормально для первого запуска: WebView2 и проверка Defender |
| Anti-Fire: «The sfss command was not found» | сначала поставить SFSS |

Лог сервиса: `sfss logs`.

## Сборка Anti-Fire из исходников

На Windows для сборки нужны Visual Studio Build Tools (несколько гигабайт), Rust и Node, и
скрипт сборки — bash. Проще взять готовую сборку: её собирает GitHub Actions, вкладка Actions →
`release` → Run workflow.
