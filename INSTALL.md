# Установка

Ставятся две вещи. **SFSS** — сервис, он считает и отвечает; без него ничего не работает.
**Anti-Fire** — программа с окном, клиент сервиса. Обе ставит один скрипт.

```bash
git clone --depth 1 https://github.com/PlazmaRoma/SFSS-Dev.git
cd SFSS-Dev
./install.sh
```

Windows, в PowerShell:

```powershell
git clone --depth 1 https://github.com/PlazmaRoma/SFSS-Dev.git
cd SFSS-Dev
powershell -ExecutionPolicy Bypass -File install.ps1
```

Нужен только **git**. Python ставить не надо: установщик скачает его сам, если на машине нет
версии 3.12. Права администратора не нужны.

| | macOS | Linux | Windows |
|---|---|---|---|
| Установка | `./install.sh` | `./install.sh` | `install.ps1` |
| Anti-Fire | в «Программы» | `~/.local/share/anti-fire`, ярлык в меню | `%LOCALAPPDATA%\Programs\Anti-Fire`, ярлык в «Пуске» |
| Проверено | вживую, с чистой установки | вживую на Fedora 44, без нейросети; GitHub Actions на Ubuntu | вживую на Windows 10, без нейросети; GitHub Actions |

## 1. Что скачивается

| Что | Объём | Откуда |
|---|---|---|
| Репозиторий: код, 16 отчётов NASA, готовый индекс, модель расчёта, Anti-Fire | около 150 МБ | GitHub |
| uv — установщик пакетов, если его ещё нет | около 20 МБ | astral.sh |
| Python 3.12, если его нет | около 20 МБ | через uv |
| Библиотеки SFSS, 56 пакетов | около 100 МБ, на диске 330 МБ | через uv |
| Модель поиска по отчётам | 130 МБ | Hugging Face |
| Нейросеть Ministral 3B, по желанию | около 3 ГБ | через LM Studio или Ollama |

Без нейросети это около 400 МБ, на быстром соединении несколько минут. После установки сеть не
нужна. Если связь оборвалась, запустите установку снова: скачанное не пропадёт, готовые шаги
пропускаются.

## 2. Что делает установщик

Шаги пронумерованы на экране, у каждой загрузки видно, сколько осталось.

1. Находит или скачивает uv, в папку `.tools` внутри клона. Файлы оболочки не трогает.
2. Ставит Python 3.12 и библиотеки в `sfss/.venv`.
3. Создаёт `sfss/.env` с настройками по умолчанию.
4. Скачивает модель поиска в `sfss/data/embedding`.
5. Индекс по отчётам уже готов, он лежит в репозитории.
6. Даёт команду `sfss`: ссылка в `~/.local/bin`, на Windows — `%LOCALAPPDATA%\sfss\bin`.
7. Ставит Anti-Fire из готовой сборки в `apps/anti-fire/release`. Старая версия на macOS
   уходит в Корзину.
8. Ищет LM Studio или Ollama и предлагает скачать нейросеть.
9. Запускает сервис и делает один расчёт.

| Параметр | Что делает |
|---|---|
| `--yes` (`-Yes`) | не задаёт вопросов |
| `--no-llm` (`-NoLlm`) | не трогает нейросеть |
| `--no-app` (`-NoApp`) | не ставит Anti-Fire |
| `--uninstall` (`-Uninstall`) | убирает всё, что поставил |

Если установщик пишет, что папки `~/.local/bin` нет в `PATH`, добавьте в `~/.zshrc` или
`~/.bashrc` строку, которую он напечатал, и откройте новый терминал. На Windows новый
терминал нужен в любом случае.

### Проверка

```bash
sfss status
sfss predict --o2 0.30 --psi 8.2
sfss playground
```

Ожидается: 1131 фрагмент в индексе, скорость горения 0.676 мм²/с, в 1,33 раза быстрее
обычного воздуха; в браузере открывается Площадка. Anti-Fire открывается из «Программ», меню
или «Пуска» и сам находит команду `sfss`.

## 3. Нейросеть

Нейросеть работает в LM Studio или Ollama на этой же машине. Установщик находит их сам.
Если он ничего не нашёл или вы ставили их позже, запустите его ещё раз или подключите вручную.

**LM Studio.** Открывать его не нужно, достаточно установить и один раз запустить.

```bash
lms get https://huggingface.co/mlx-community/Ministral-3-3B-Instruct-2512-4bit        # Mac на Apple Silicon
lms get https://huggingface.co/lmstudio-community/Ministral-3-3B-Instruct-2512-GGUF   # остальные
sfss load
```

**Ollama.**

```bash
ollama pull ministral-3:3b
sfss config runtime ollama
sfss config model ministral-3:3b
```

Проверка: `sfss ask "Как гелий в атмосфере влияет на горение?"`. Первый ответ идёт до
минуты. Другой адрес, порт или модель: `sfss config`, подробности в
[`sfss/README.md`](sfss/README.md), раздел «Настройки нейросети». Китайские модели сервис
не принимает: они запрещены регламентом.

## 4. Anti-Fire

Установщик ставит готовую сборку из `apps/anti-fire/release`: Rust и Node для этого не нужны.

| Система | Файл | Куда ставится |
|---|---|---|
| macOS, Intel и Apple Silicon | `Anti-Fire-macos-universal.dmg` | «Программы» |
| Linux x86_64 | `Anti-Fire-linux-x86_64.tar.gz` | `~/.local/share/anti-fire`, команда `anti-fire`, ярлык в меню |
| Windows x64 | `Anti-Fire-windows-x64.zip` | `%LOCALAPPDATA%\Programs\Anti-Fire`, ярлык в «Пуске» |

- **Linux:** окну нужен WebKitGTK 4.1. Установщик проверит и подскажет команду:
  `sudo dnf install webkit2gtk4.1` или `sudo apt install libwebkit2gtk-4.1-0`.
- **Windows:** нужен WebView2, в Windows 10 и 11 он уже есть. SmartScreen может предупредить
  о неизвестном издателе: «Подробнее» → «Выполнить в любом случае».

Сборки без подписи Apple и Microsoft. Из клона на macOS приложение открывается сразу; если
скачать `.dmg` отдельно через браузер, первый запуск — правый клик → «Открыть».

Программа сама находит команду `sfss`, поэтому кнопки «Запустить SFSS» и «Остановить SFSS»
работают сразу после установки.

### Сборка из исходников

Нужен Node 22+. Rust скрипт поставит сам, в `~/.cargo`, без sudo.

```bash
bash apps/anti-fire/build.sh --install    # macOS: собрать и положить в «Программы»
bash apps/anti-fire/build.sh              # Linux: файл в apps/anti-fire/src-tauri/target/release
```

На Linux до сборки:

```bash
sudo dnf install webkit2gtk4.1-devel gtk3-devel librsvg2-devel libappindicator-gtk3-devel   # Fedora
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev   # Ubuntu
```

Готовые файлы для `apps/anti-fire/release` собирает GitHub Actions под все три системы:
вкладка Actions → `release` → Run workflow. Файлы появятся в артефактах запуска, а по тегу
`v*` — и в Releases.

## 5. Удаление

```bash
./install.sh --uninstall                                   # macOS, Linux
powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall   # Windows
```

Останавливает сервис и убирает всё, что поставил установщик: команду `sfss`, окружение
Python, модель поиска, uv из `.tools`, Anti-Fire вместе с её кэшем и ярлыками. На macOS
Anti-Fire уходит в Корзину. Остаются клон с отчётами NASA и индексом, `sfss/.env` и
настройки нейросети. Если на машине осталась модель поиска от прежней версии SFSS
(470 МБ в `~/.cache/huggingface`), установщик предложит удалить и её.

Нейросеть в LM Studio или Ollama не трогается: она может быть нужна не только SFSS.

## 6. Тесты

```bash
cd sfss && ../.tools/uv pip install --python .venv/bin/python pytest && .venv/bin/python -m pytest -q   # сервис; или uv из PATH
npm ci && npm test && npm run typecheck                                    # Площадка и Anti-Fire
npm run page -w anti-fire && cd apps/anti-fire/src-tauri && cargo test     # окно Anti-Fire
```

## 7. Если что-то пошло не так

| Что видно | Что делать |
|---|---|
| «uv не скачался» | проверить сеть; за прокси uv ставится вручную: https://docs.astral.sh/uv/ |
| `sfss: command not found` | открыть новый терминал; проверить `PATH`, см. раздел 2 |
| «Порт 8000 занят» | `sfss start --port 8010` |
| «Модель поиска не скачалась» | проверить сеть и запустить установку снова, она продолжит с этого шага |
| Нейросеть «не отвечает» | открыть LM Studio один раз или `ollama serve`; затем `sfss load` |
| Anti-Fire: «Команда sfss не найдена» | сначала установить SFSS, раздел 2 |

Лог сервиса: `sfss logs`.

## 8. Что не проверено

- **Ответы нейросети на Windows и Linux.** Установка проверена вживую: Windows 10 — 106 секунд
  с нуля, Fedora 44 — 44 секунды. Anti-Fire открывается из «Пуска» и меню программ и
  подключается к сервису, на Fedora установщик находит Ollama. Сами ответы нейросети там не
  проверялись: видеокарта не тянет модель.
- **Скачивание нейросети установщиком** на чистой машине: на машине разработки модель уже была.
- **Ollama** на настоящей установке: поддержка проверена тестами и на имитации её API.
