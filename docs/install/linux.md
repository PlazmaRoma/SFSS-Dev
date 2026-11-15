# Установка на Linux

Ставятся две вещи: **SFSS** — сервис, который считает и отвечает, и **Anti-Fire** — программа
с окном. Обе ставит один скрипт, без sudo: всё ложится в домашнюю папку.

Проверено вживую на Fedora 44 Workstation (GNOME, Wayland, NVIDIA): с нуля 44 секунды. В GitHub
Actions установка и удаление проверяются на чистой Ubuntu. Готовая сборка Anti-Fire есть для
x86_64.

## Что нужно заранее

- **git** и **curl** (или wget):

  ```bash
  sudo dnf install git curl                # Fedora
  ```

  ```bash
  sudo apt install git curl                # Ubuntu, Debian
  ```

- **WebKitGTK 4.1** — для окна Anti-Fire. На Fedora Workstation и Ubuntu Desktop он обычно уже
  есть, установщик проверит и подскажет:

  ```bash
  sudo dnf install webkit2gtk4.1           # Fedora
  ```

  ```bash
  sudo apt install libwebkit2gtk-4.1-0     # Ubuntu, Debian
  ```

Python ставить не нужно: установщик скачает Python 3.12, если его нет. Системный Python не
используется и не трогается.

## Что скачается

| Что | Объём |
|---|---|
| Репозиторий: код, 16 отчётов NASA, готовый индекс, модель расчёта, Anti-Fire | около 150 МБ |
| uv — установщик пакетов, если его ещё нет | около 20 МБ |
| Python 3.12, если его нет | около 35 МБ |
| Библиотеки SFSS, 56 пакетов | около 100 МБ, на диске 330 МБ |
| Модель поиска по отчётам | 130 МБ |
| Нейросеть Ministral 3B, по желанию | около 3 ГБ |

После установки сеть не нужна.

## Установка

```bash
git clone --depth 1 https://github.com/PlazmaRoma/SFSS-Dev.git ~/SFSS-Dev
```

```bash
cd ~/SFSS-Dev && ./install.sh
```

Шаги пронумерованы, у каждой загрузки видно, сколько осталось. Установщик задаст два вопроса,
на оба можно нажать Enter:

1. **Поставить Anti-Fire в `~/.local/share/anti-fire`?** Появятся команда `anti-fire` и ярлык
   в меню программ.
2. **Скачать Ministral 3B?** Вопрос будет, только если стоит LM Studio или Ollama.

В конце установщик запускает сервис и делает один расчёт. Если связь оборвалась, запустите
`./install.sh` снова: скачанное не пропадёт, готовые шаги пропускаются.

Если установщик пишет, что `~/.local/bin` нет в `PATH`, добавьте в `~/.bashrc` (или `~/.zshrc`)
строку, которую он напечатал, и откройте новый терминал.

| Параметр | Что делает |
|---|---|
| `--yes` | отвечает «да» на все вопросы |
| `--no-llm` | не трогает нейросеть |
| `--no-app` | не ставит Anti-Fire |
| `--uninstall` | убирает всё, что поставил |

## Проверка

```bash
sfss status
sfss predict --o2 0.30 --psi 8.2
sfss playground
```

Ожидается: в индексе 1131 фрагмент, скорость горения 0.676 мм²/с, в 1,33 раза быстрее
обычного воздуха; в браузере открывается Площадка.

**Anti-Fire** — в меню программ или командой `anti-fire`. Программа сама находит команду
`sfss`, поэтому кнопки «Start SFSS» и «Stop SFSS» работают сразу.

Под Wayland окно открывается через XWayland: иначе с WebKitGTK на картах NVIDIA не нажимались
кнопки окна и окно долго оставалось белым. Вернуть родной Wayland: `GDK_BACKEND=wayland anti-fire`.
При запуске окно на мгновение бывает белым — это WebKitGTK, на работу не влияет.

## Нейросеть

Ответы на вопросы пишет нейросеть на этой же машине, в Ollama или LM Studio. Без неё работает
всё остальное: расчёт, CSV, Площадка. Модели нужно около 3 ГБ видеопамяти или памяти.

**Ollama.** Установить с [ollama.com](https://ollama.com). Если установщик её нашёл, он уже
переключил SFSS на Ollama; останется скачать модель:

```bash
ollama pull ministral-3:3b
sfss config model ministral-3:3b
```

**LM Studio.** Установить с [lmstudio.ai](https://lmstudio.ai) и один раз открыть.

```bash
lms get https://huggingface.co/lmstudio-community/Ministral-3-3B-Instruct-2512-GGUF   # выбрать Q4_K_M
sfss load
```

Берите вариант `Q4_K_M`, 2,15 ГБ: он ближе всего к сборке MLX 4bit на Mac, и проверяли именно его.
`Q6_K` и `Q8_0` точнее, но занимают больше памяти. Оригинал от Mistral с той же квантизацией —
[mistralai/Ministral-3-3B-Instruct-2512-GGUF](https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512-GGUF);
как скачать его вручную и что проверено: [TEST-RUN-2026-11-15-GGUF](../../sfss/docs/TEST-RUN-2026-11-15-GGUF.md).
`ministral-3:3b` в Ollama — тот же `Q4_K_M`.

Если в LM Studio несколько сборок модели, SFSS берёт уже загруженную, иначе GGUF. Чтобы закрепить
сборку, укажите её полное имя, например
`sfss config model lmstudio-community/ministral-3-3b-instruct-2512`; все имена — в
`sfss config models`.

Проще всего — запустить `./install.sh` ещё раз: он найдёт Ollama или LM Studio и предложит
скачать модель сам. Проверка: `sfss ask "How does helium in the atmosphere affect combustion?"`.

## Удаление

```bash
cd ~/SFSS-Dev && ./install.sh --uninstall
```

Убирает:

- сервис: останавливает его;
- команду `sfss`;
- Python с библиотеками, модель поиска;
- uv из `.tools` вместе с его кэшем и скачанным Python, если uv ставил установщик;
- Anti-Fire: программу, команду `anti-fire`, ярлык в меню и её данные.

Остаются клон с отчётами NASA и индексом, `sfss/.env` и настройки нейросети. Клон после этого
можно удалить: `rm -rf ~/SFSS-Dev`. Нейросеть в Ollama или LM Studio не трогается: её удаляют
там же.

В меню программ GNOME у Anti-Fire нет кнопки «Удалить». Такая кнопка есть только у того, что
поставил менеджер пакетов (dnf, apt, Flatpak), а Anti-Fire — файлы в домашней папке. Поэтому
её убирает та же команда, что и ставила.

## Обновление

```bash
cd ~/SFSS-Dev && git pull && ./install.sh
```

## Если что-то пошло не так

| Что видно | Что делать |
|---|---|
| «Could not download uv» | проверить сеть; за прокси uv ставится вручную: https://docs.astral.sh/uv/ |
| `sfss: command not found` | открыть новый терминал; проверить `PATH`, см. «Установка» |
| «Port 8000 is taken» | `sfss start --port 8010` |
| «Could not download the search model» | проверить сеть и запустить `./install.sh` снова |
| «The window needs the WebKitGTK 4.1 library» | поставить WebKitGTK, см. «Что нужно заранее» |
| Ollama «not answering» | `ollama serve` или `systemctl start ollama`, затем `sfss load` |
| Anti-Fire: «The sfss command was not found» | сначала поставить SFSS |
| Готовой сборки под вашу архитектуру нет (ARM) | собрать из исходников, см. ниже |

Лог сервиса: `sfss logs`.

## Сборка Anti-Fire из исходников

Нужна для ARM или тем, кто меняет программу. Нужен Node 22+, Rust скрипт поставит сам, в
`~/.cargo`, без sudo. Сначала библиотеки для сборки:

```bash
sudo dnf install webkit2gtk4.1-devel gtk3-devel librsvg2-devel libappindicator-gtk3-devel   # Fedora
```

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev   # Ubuntu
```

```bash
npm ci
bash apps/anti-fire/build.sh
```

Готовый файл — `apps/anti-fire/src-tauri/target/release/anti-fire`.
