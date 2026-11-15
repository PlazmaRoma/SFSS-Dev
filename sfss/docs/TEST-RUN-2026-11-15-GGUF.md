# Прогон GGUF, 15 ноября 2026

Цель: найти сборку GGUF модели Ministral 3 3B Instruct 2512, ближайшую к сборке MLX, которой
пользуемся на Mac (`mlx-community/Ministral-3-3B-Instruct-2512-4bit`), и проверить, что SFSS с ней
работает. GGUF — сборка для Windows, Linux и Mac на Intel, где MLX не работает.

Итог: **`mistralai/Ministral-3-3B-Instruct-2512-GGUF`, файл `Q4_K_M`**, с проектором зрения
`BF16`. Она проходит ту же ручную проверку, что и MLX (`SMOKE-TEST.md`, проверки 2-5). Прежний
замер в ~120 с на запрос (ARCHITECTURE § 7.2) на нынешнем рантайме LM Studio не воспроизводится.

## Окружение

- MacBook с Apple A18 Pro, 8 ГБ памяти
- движки LM Studio: `llama.cpp-mac-arm64-apple-metal-advsimd@2.73.0` (GGUF),
  `mlx-llm-mac-arm64-apple-metal-advsimd@1.13.1` (MLX)
- контекст 8192 у обеих сборок, загрузка `lms load <id> --context-length 8192`
- SFSS из этого репозитория, отдельный экземпляр на порту 8765 с `LM_STUDIO_MODEL=<полный id>`

## Какая GGUF соответствует сборке MLX

Сборка MLX квантует языковую модель вместе с эмбеддингами в 4 бита: аффинно (масштаб и смещение),
группами по 64, масштабы в bf16, то есть около 4,5 бита на вес. Энкодер зрения на 0,4B остаётся в
bf16. Побитовой копии в GGUF нет: форматы хранят веса по-разному. Ближайший эквивалент:

| | MLX (Mac) | GGUF (всё остальное) |
|---|---|---|
| Репозиторий | [mlx-community/Ministral-3-3B-Instruct-2512-4bit](https://huggingface.co/mlx-community/Ministral-3-3B-Instruct-2512-4bit) | [mistralai/Ministral-3-3B-Instruct-2512-GGUF](https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512-GGUF), официальная от Mistral |
| Языковая модель | 4 бита, аффинно, группа 64 | `Q4_K_M`: 4 бита с масштабом и смещением, блоки по 32, часть слоёв в 6 битах |
| Энкодер зрения | bf16, внутри `model.safetensors` | bf16, отдельный файл `…-BF16-mmproj.gguf` |
| Скачать | 2,75 ГБ | 2,15 ГБ + 0,84 ГБ |
| Память после загрузки, контекст 8192 | 2,59 ГиБ | 2,78 ГиБ |

Почему `Q4_K_M`, а не другие:

- `Q4_0` тоже 4,5 бита на вес, но без смещения, только с масштабом; сборка MLX аффинная.
  `Q4_K_M` — та же схема «масштаб плюс смещение», поэтому ближе по точности.
- `Q4_K_M` — 4-битная сборка, которую публикует сама Mistral. У `lmstudio-community`, `unsloth` и
  `bartowski` есть `Q4_K_M` того же размера, но их файлы не совпадают с файлом Mistral побайтно:
  отличаются метаданные и у некоторых калибровка (imatrix). Проверялся только файл Mistral.
- `Q5_K_M`, `Q6_K` и `Q8_0` точнее сборки MLX, а не равны ей, и занимают больше памяти: на 8 ГБ
  это важно.

Контрольные суммы скачанных файлов совпадают с указанными на Hugging Face:

```
9ed150d4367e68df0ac8e1540f6ddc65b42d0ee26378329d1ecbca60f93fc5f8  Ministral-3-3B-Instruct-2512-Q4_K_M.gguf
70ca26e41ecea9da997e2887462ad68b848fbf64da011ff4107bbe7353519ee0  Ministral-3-3B-Instruct-2512-BF16-mmproj.gguf
```

## Итоги

| Проверка | GGUF Q4_K_M | MLX 4bit |
|---|---|---|
| Загрузка в LM Studio | ПРОЙДЕНО | ПРОЙДЕНО |
| Скорость генерации, короткие промпты | 11-12 токенов/с | 15-20 токенов/с |
| Время до первого токена, короткие промпты | 0,34-0,69 с | 0,41-0,70 с |
| Проверка 2, `/predict` | ПРОЙДЕНО, ровно 0.546454… | ПРОЙДЕНО, то же число |
| Проверка 3, вопрос по корпусу | ПРОЙДЕНО, 35,6 с | ПРОЙДЕНО, 35,8 с |
| Проверка 4, футбол | ПРОЙДЕНО, отказ, 31,6 с | ПРОЙДЕНО, отказ, 24,4 с |
| Проверка 5, ловушка Saffire-IV | ПРОЙДЕНО, отказ, 32,5 с | ПРОЙДЕНО, отказ, 26,8 с |

GGUF генерирует примерно на четверть медленнее. На `/query` большая часть времени уходит на чтение
контекста в несколько тысяч токенов, а не на ответ, поэтому разница сжимается до 0-7 секунд.

## Ответы

Проверка 3, «How does oxygen concentration affect the burning rate?». Обе сборки нашли одни и те же
три фрагмента (`NTRS-20000030678` стр. 90 и 91, `NTRS-20160000593` стр. 15) и дали одни и те же три
факта с правильными ссылками: с ростом кислорода пламя распространяется быстрее, то же верно для
усреднённых опытов в невесомости, задержка воспламенения сокращается. GGUF оформила их списком, MLX —
абзацем.

Проверка 4, футбол. GGUF: «No relevant information provided in the context about the 2022 FIFA
World Cup». MLX: «No direct answer in the provided context». Победителя не назвала ни одна.

Проверка 5, Saffire-IV. GGUF: «The provided context does not mention the Saffire-IV experiment
aboard Cygnus. (No applicable citation.)» MLX: «No direct mention of the Saffire-IV experiment in
Cygnus». Ни одна не выдумала ни результата, ни ссылки.

Короткие промпты прямо в LM Studio, температура 0: обе сборки верно объяснили, почему капля горит
сферой, и перечислили благородные газы. Обе ошиблись в 17 × 23 (MLX 401, GGUF 411; верно 391):
модель на 3B плохо считает в любой сборке. В русском переводе GGUF написала несуществующее «Флама»
вместо «Пламя». Это косметика, обычная для 3B (SMOKE-TEST, проверка 3).

## Что всплыло по ходу

**1. Прежние 120 с не воспроизводятся.** В сентябре GGUF Q4_K_M отвечала на Mac за ~120 с и
упиралась в таймаут (ARCHITECTURE § 7.2). На рантайме llama.cpp 2.73.0 `/query` с ней идёт 32-36 с,
на 0-7 с дольше, чем с MLX. На Mac MLX всё равно лучше: быстрее генерирует и занимает меньше памяти.

**2. LM Studio не видит проектор зрения из официального репозитория.** Mistral называет его
`Ministral-3-3B-Instruct-2512-BF16-mmproj.gguf`, а LM Studio узнаёт только файлы, начинающиеся с
`mmproj-`. С исходным именем LM Studio показывал две отдельные «модели», `@q4_k_m` и `@bf16`, и
`lms load mistralai/ministral-3-3b-instruct-2512` отвечал «Model not found». После переименования в
`mmproj-Ministral-3-3B-Instruct-2512-BF16.gguf` это стала одна модель со зрением. SFSS нужен только
текст, так что проектор можно не качать вовсе. В `lmstudio-community` файл уже назван правильно.

**3. Две сборки рядом ломают короткое имя модели.** Пока скачана одна сборка, LM Studio зовёт её
`ministral-3-3b-instruct-2512` — это значение по умолчанию в `.env`. Когда скачаны обе, к именам
добавляется издатель: `mlx-community/ministral-3-3b-instruct-2512` и
`mistralai/ministral-3-3b-instruct-2512`. Тогда `sfss load` с коротким именем загрузил GGUF, а не
MLX, и SFSS продолжал сообщать «не загружена»; `/query` отвечал «Not enough memory for the model»,
потому что пытался загрузить модель второй раз. Обходной путь — полное имя:
`sfss config model mlx-community/ministral-3-3b-instruct-2512`, после чего `sfss ask` ответил за
32 с со ссылками.

**Исправлено в тот же день** в `app/services/llm_runtime.py`: короткое имя находит сборку с любым
издателем. Если их несколько, побеждает загруженная, затем родной формат (MLX на Apple Silicon,
GGUF везде ещё). Загрузка, выгрузка и запросы идут именно к этой сборке. Проверено вживую с обеими
скачанными сборками и коротким именем по умолчанию: `POST /v1/llm/load` загрузил MLX, `/health`
сообщил, что она загружена, проверки 2-5 пройдены (26,8, 21,6 и 25,7 с). Когда GGUF загрузили
вручную, SFSS взял её и второй копии не грузил. `GET /v1/llm/models` отмечает выбранную сборку
полем `"selected": true`.

## Как повторить

```bash
D=~/.lmstudio/models/mistralai/Ministral-3-3B-Instruct-2512-GGUF
B=https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512-GGUF/resolve/main
mkdir -p "$D"
curl -L -o "$D/Ministral-3-3B-Instruct-2512-Q4_K_M.gguf" "$B/Ministral-3-3B-Instruct-2512-Q4_K_M.gguf"
curl -L -o "$D/mmproj-Ministral-3-3B-Instruct-2512-BF16.gguf" "$B/Ministral-3-3B-Instruct-2512-BF16-mmproj.gguf"
lms load mistralai/ministral-3-3b-instruct-2512 --context-length 8192 --yes
sfss config model mistralai/ministral-3-3b-instruct-2512
```

Дальше пройти `SMOKE-TEST.md`. Вернуться к MLX: `sfss config reset`. Короткое имя из `.env` тогда
возьмёт MLX на Apple Silicon.

Оговорка: по одному прогону на сборку, не полноценная оценка, как и в SMOKE-TEST. Время GGUF
замерено на Mac; на Windows и Linux оно зависит от видеокарты.
