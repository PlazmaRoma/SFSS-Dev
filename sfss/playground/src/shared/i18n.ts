import type { Lang } from "../shared/types";

type Dict = Record<string, Record<Lang, string>>;

export const t: Dict = {
  title: { en: "Flame in Freefall", ru: "Flame in Freefall" },
  tagline: {
    en: "Fire risk across a lunar habitat, read from NASA's microgravity combustion experiments.",
    ru: "Пожарный риск по модулям лунной базы, посчитанный по экспериментам NASA о горении в невесомости.",
  },
  live: { en: "Backend live", ru: "Бэкенд на связи" },
  offline: { en: "Offline, showing captured data", ru: "Оффлайн, показаны снятые данные" },
  findH: {
    en: "NASA's own EVA atmosphere burns 40% faster",
    ru: "Разведочная атмосфера NASA горит на 40% быстрее",
  },
  findBody: {
    en: "To cut the hours a crew breathes pure oxygen before a spacewalk, NASA proposes 8.2 psi at 34% oxygen for the airlock. Run that atmosphere through 259 FLEX droplet burns and a fire moves 1.40 times faster than in sea-level air. That is the trade, priced.",
    ru: "Чтобы сократить часы дыхания чистым кислородом перед выходом, NASA предлагает для шлюза 8.2 psi при 34% кислорода. Прогоните эту атмосферу через 259 опытов FLEX, и огонь пойдёт в 1.40 раза быстрее земного. Это цена решения.",
  },
  findJump: { en: "Open EVA Prep", ru: "Открыть шлюз" },
  habitat: { en: "Habitat section", ru: "Разрез базы" },
  sens: {
    en: "whole range moves it {p}%",
    ru: "весь диапазон меняет её на {p} %",
  },
  sensFlat: {
    en: "whole range moves it under 3%: barely varied in FLEX",
    ru: "весь диапазон меняет её меньше чем на 3 %: в FLEX почти не варьировали",
  },
  sensShort: { en: "effect {p}%", ru: "влияние {p} %" },
  sensFlatShort: { en: "effect < 3%", ru: "влияние < 3 %" },
  vsEarth: { en: "vs sea-level air", ru: "к земному воздуху" },
  conditions: { en: "Conditions", ru: "Условия" },
  oxygen: { en: "Oxygen", ru: "Кислород" },
  pressure: { en: "Pressure", ru: "Давление" },
  droplet: { en: "Fuel droplet", ru: "Капля топлива" },
  burnRate: { en: "Predicted burn rate", ru: "Предсказанная скорость горения" },
  reset: { en: "Reset to design values", ru: "Вернуть проектные значения" },
  matEmpty: {
    en: "Nothing in this module yet. Add a material to see what NASA measured.",
    ru: "В модуле пока пусто. Добавьте материал, чтобы увидеть измерения NASA.",
  },
  matRuns: { en: "{n} NASA runs near this oxygen", ru: "{n} опытов NASA при таком кислороде" },
  matKept: {
    en: "The flame kept going in {burned} of {near} runs at about {o2}% oxygen.",
    ru: "Пламя удержалось в {burned} опытах из {near} примерно при {o2}% кислорода.",
  },
  matSample: { en: "See run {test}.", ru: "Например, опыт {test}." },
  matNoRuns: {
    en: "Nothing measured at {o2}% oxygen.",
    ru: "При {o2} % кислорода не измеряли.",
  },
  matGap: {
    en: "BASS-II burned solids only between {lo}% and {hi}% oxygen. Above that an outcome would be a guess, so the tool leaves it blank. That gap is the finding.",
    ru: "Твёрдые материалы в BASS-II жгли только при {lo}…{hi} % кислорода. Выше исход был бы догадкой, поэтому мы его не показываем. Этот пробел и есть находка.",
  },
  matTested: { en: "tested at {lo} to {hi}% oxygen", ru: "испытан при {lo}…{hi} % кислорода" },
  matSwap: {
    en: "{other} held better here: {burned} of {near} runs kept burning.",
    ru: "{other} держался лучше: горел в {burned} опытах из {near}.",
  },
  mirH: { en: "Why this gets counted: Mir, 1997", ru: "Зачем это считать: «Мир», 1997" },
  mirWhen: { en: "Date", ru: "Дата" },
  mirBurn: { en: "Burned for", ru: "Горело" },
  mirMin: { en: "min", ru: "мин" },
  mirAir: { en: "Cabin air", ru: "Воздух отсека" },
  mirBody: {
    en: "A lithium perchlorate oxygen candle ignited aboard Mir. The flame ran for about fourteen minutes, smoke filled the station, and the crew readied the Soyuz to leave. The cabin held ordinary sea-level air, the safest column in this whole tool.",
    ru: "На «Мире» загорелась кислородная шашка на перхлорате лития. Пламя шло около четырнадцати минут, станцию заполнил дым, экипаж готовил «Союз» к отходу. В отсеке был обычный земной воздух, самый безопасный столбец во всём этом инструменте.",
  },
  mirLimit: {
    en: "This model does not predict that fire: an oxygen candle carries its own oxidiser, so cabin atmosphere barely governs it. The case is here for the other reason. If fourteen minutes happened at 21% oxygen, the 34% an airlock is planned to hold deserves a number rather than a guess.",
    ru: "Эта модель тот пожар не предсказывает: у кислородной шашки свой окислитель, и атмосфера отсека на неё почти не влияет. Случай приведён для другого. Если четырнадцать минут случились при 21% кислорода, то 34%, которые планируют держать в шлюзе, заслуживают числа, а не догадки.",
  },
  tab_time: { en: "Timing", ru: "Время" },
  tab_mats: { en: "Materials", ru: "Материалы" },
  tab_trust: { en: "Model", ru: "Модель" },
  rankH: { en: "Modules ranked by fire risk", ru: "Модули по уровню пожарного риска" },
  roomH: { en: "Inside the module", ru: "Внутри модуля" },
  roomBase: { en: "at sea-level air", ru: "в земном воздухе" },
  roomNow: { en: "here: {r}× faster", ru: "здесь: {r}× быстрее" },
  roomSame: { en: "here: the same", ru: "здесь: столько же" },
  roomSlower: { en: "here: {r}× as fast", ru: "здесь: {r}× от земной" },
  roomAir: { en: "{o2}% oxygen", ru: "{o2}% кислорода" },
  clockH: { en: "How long you have", ru: "Сколько у вас времени" },
  clockSec: { en: "s", ru: "с" },
  clockPlay: { en: "Run it in real time", ru: "Прогнать в реальном времени" },
  clockAgain: { en: "Again", ru: "Ещё раз" },
  clockFar: {
    en: "The nearest runs sit at {lo} to {hi}% oxygen: FLEX stops at 34%.",
    ru: "Ближайшие опыты при {lo}…{hi} % кислорода: FLEX заканчивается на 34 %.",
  },
  clockNote: {
    en: "Median of {n} NASA runs. Each tick is one run.",
    ru: "Медиана по {n} опытам NASA. Каждая засечка — один опыт.",
  },
  materials: { en: "Materials in this module", ru: "Материалы в модуле" },
  tests: { en: "NASA tests", ru: "опытов NASA" },
  askNasa: { en: "Ask the NASA reports", ru: "Вопрос по отчётам NASA" },
  whatNasaFound: { en: "What NASA measured", ru: "Что измерила NASA" },
  askLive: { en: "Ask the model now", ru: "Спросить модель сейчас" },
  asking: { en: "Reading the reports…", ru: "Читаю отчёты…" },
  stageAnswering: { en: "Writing the answer…", ru: "Пишу ответ…" },
  // Русский ответ модель пишет по-английски и переводит: так меньше ошибок
  stageTranslating: { en: "Translating…", ru: "Перевожу на русский…" },
  more: { en: "Read the full answer", ru: "Показать ответ целиком" },
  less: { en: "Collapse", ru: "Свернуть" },
  sources: { en: "Sources", ru: "Источники" },
  page: { en: "p.", ru: "стр." },
  modelQuality: { en: "How much to trust this", ru: "Насколько этому верить" },
  drives: { en: "What drives burning", ru: "Что влияет на горение" },
  errorVsConst: {
    en: "Average error {mae}, against {base} for always answering the mean. Half the error of a constant guess.",
    ru: "Средняя ошибка {mae} против {base} у постоянного ответа: вдвое точнее константы.",
  },
  heuristic: {
    en: "Model artefacts missing. This is a placeholder, not a prediction.",
    ru: "Артефакты модели не найдены. Это заглушка, а не предсказание.",
  },
  defaultsNote: {
    en: "Other gases at standard air. The fuel is the FLEX droplet set: heptane and methanol.",
    ru: "Остальные газы как в стандартном воздухе. Топливо то же, что в FLEX: гептан и метанол.",
  },
  offlinePredictNote: {
    en: "Offline: interpolated from a 5950 point snapshot of the model.",
    ru: "Оффлайн: интерполяция по снятому срезу модели, 5950 точек.",
  },
  bassCaveat: {
    en: "Test outcomes, not a safety rating: crew lowered airflow until the flame went out.",
    ru: "Исходы опытов, а не оценка безопасности: экипаж снижал поток до срыва пламени.",
  },
  outcomes: { en: "Outcomes", ru: "Исходы" },
  legend: { en: "Blue burns slow and soot-free. White-hot burns fast.", ru: "Синее горит медленно и без сажи. Добела горит быстро." },
  indexed: { en: "{n} passages indexed from 16 NASA reports", ru: "{n} фрагментов из 16 отчётов NASA" },
  backHome: { en: "Back to overview", ru: "Назад на главную" },
  // Это площадка, а не готовый продукт: иначе первый же вопрос будет «где здесь
  // ввести свои данные?». Настоящая работа идёт через сервис SFSS и программу Anti-Fire.
  playgroundNote: {
    en: "A playground: see the idea and try it. The real thing is the SFSS service you connect your own software to, and the Anti-Fire program built on it.",
    ru: "Это площадка: посмотреть идею и поиграться. Настоящая работа идёт через сервис SFSS, к которому подключается ваше ПО, и программу Anti-Fire на нём.",
  },
  playgroundDocs: { en: "How to connect", ru: "Как подключиться" },
  grabH: { en: "Try the playground", ru: "Попробуйте площадку" },
  grabBody: {
    en: "One file, double-click to open. No install, no server, works offline: every figure comes from responses recorded off a live backend, so the numbers are real with nothing running. Start the backend and predictions go live. Sources included.",
    ru: "Один файл, открывается двойным кликом. Без установки, без сервера, работает офлайн: каждая цифра взята из ответов живого бэкенда, поэтому числа настоящие даже когда ничего не запущено. Поднимете бэкенд — предсказания станут живыми. Исходники внутри.",
  },
  grabBtn: { en: "Download the playground", ru: "Скачать площадку" },
  grabMeta: { en: "ZIP · 425 KB · no install, runs offline", ru: "ZIP · 425 КБ · без установки, работает офлайн" },
  footLine: {
    en: "Fire risk across a crewed habitat, read from NASA's own combustion experiments.",
    ru: "Пожарный риск обитаемой базы, прочитанный по собственным экспериментам NASA.",
  },
  footSources: { en: "Data from", ru: "Данные" },
  footTeam: { en: "Who built it", ru: "Кто сделал" },
  footTeamNote: {
    en: "Azamat Serik and Roman Bushuyev, two sixteen-year-old developers, for the NASA Space Apps Challenge 2026 and its Flame in Freefall brief.",
    ru: "Азамат Серик и Роман Бушуев, шестнадцатилетние разработчики. Сделано для NASA Space Apps Challenge 2026, задание Flame in Freefall.",
  },
  footScope: { en: "What it does not do", ru: "Чего инструмент не делает" },
  footScopeNote: {
    en: "The model predicts burn rate from atmosphere alone. Material outcomes are quoted from individual NASA runs, never predicted.",
    ru: "Модель считает скорость горения только по атмосфере. Исходы по материалам процитированы из конкретных опытов NASA, а не предсказаны.",
  },
  footCheck: { en: "How to check any number", ru: "Как проверить любую цифру" },
  footCheckNote: {
    en: "Download the same NASA files, run the scripts in this repository, and you get the same numbers. Every AI answer carries the report and the page it came from.",
    ru: "Скачайте те же файлы NASA, запустите скрипты из репозитория и получите те же цифры. У каждого ответа ИИ указан отчёт и страница, откуда он взят.",
  },
  footFine: {
    en: "Not affiliated with or endorsed by NASA. Built for the Space Apps Challenge using public NASA data.",
    ru: "Проект не связан с NASA и не поддержан им. Сделан для Space Apps Challenge на открытых данных NASA.",
  },
  navDemo: { en: "Demo", ru: "Демо" },
  navPremise: { en: "Why it differs", ru: "В чём разница" },
  navHabitat: { en: "Habitat", ru: "База" },
  heroH1: {
    en: "Where a habitat burns fastest",
    ru: "Где на базе горит быстрее всего",
  },
  heroDesc: {
    en: "SFSS Playground reads NASA's microgravity combustion experiments, 388 runs across 16 reports, and turns them into a live risk map of a crewed habitat. Every number traces back to the test that produced it.",
    ru: "SFSS Playground читает эксперименты NASA о горении в невесомости: 388 опытов из 16 отчётов. Всё это превращается в живую карту риска обитаемой базы, и за каждым числом стоит опыт, из которого оно взято.",
  },
  scrollCue: { en: "Scroll", ru: "Листайте" },
  ledeH: {
    en: "Thirty years of orbital fire tests, in one screen",
    ru: "Тридцать лет орбитальных опытов с огнём на одном экране",
  },
  ledeBody: {
    en: "Pick a module, set its oxygen and pressure, and the burn rate updates against sea-level air. Click through to the NASA run behind any number: the report, the page, the exact test. Nothing here is generated. The model is trained on 259 droplet runs from FLEX, and material outcomes are quoted from 129 BASS-II runs aboard the ISS.",
    ru: "Выберите модуль, задайте кислород и давление, и скорость горения пересчитается относительно земного воздуха. За любым числом открывается опыт NASA: отчёт, страница, номер теста. Ничего не выдумано: модель обучена на 259 опытах FLEX с каплями, а исходы по материалам процитированы из 129 опытов BASS-II на МКС.",
  },
  play: { en: "Play", ru: "Играть" },
  pause: { en: "Pause", ru: "Пауза" },
  sound: { en: "Sound", ru: "Звук" },
  fullscreen: { en: "Fullscreen", ru: "Во весь экран" },
  heroWatch: { en: "Watch the demo", ru: "Смотреть демо" },
  demoMissing: {
    en: "Drop a screen recording at public/demo.mp4 and it appears here.",
    ru: "Положите запись экрана в public/demo.mp4, и она появится здесь.",
  },
  heroLine: {
    en: "Fire behaves differently when nothing rises. We read NASA's microgravity combustion data to show where a lunar habitat is most at risk.",
    ru: "Огонь ведёт себя иначе, когда ничто не поднимается вверх. Мы читаем данные NASA о горении в невесомости и показываем, где на лунной базе опаснее всего.",
  },
  heroCta: { en: "Open the habitat", ru: "Открыть базу" },
  replay: { en: "Replay the ignition", ru: "Повторить поджиг" },
  covH: {
    en: "Where NASA has data, and where it stops",
    ru: "Где у NASA есть данные, а где они кончаются",
  },
  covDroplets: { en: "Fuel droplets", ru: "Капли топлива" },
  covSolids: { en: "Solid materials", ru: "Твёрдые материалы" },
  covGaps: {
    en: "empty cells. Habitats are planned at {o2}% oxygen, and above 24% no solid material has ever been burned in orbit.",
    ru: "пустых клеток. Базы планируют на {o2}% кислорода, а выше 24% твёрдые материалы на орбите не жгли ни разу.",
  },
  covNote: {
    en: "Counts are NASA runs, not estimates. The empty cells are the useful part: they bound what this tool may claim, and they are a list of experiments still worth running.",
    ru: "В клетках опыты NASA, а не оценки. Полезны как раз пустые: они очерчивают, о чём этот инструмент вправе говорить, и это же список опытов, которые стоит поставить.",
  },
  premiseH: {
    en: "Why fire in orbit is a different problem",
    ru: "Почему огонь на орбите это другая задача",
  },
  onEarth: { en: "On Earth", ru: "На Земле" },
  onEarthNote: {
    en: "hot gas is lighter, so buoyancy pulls the flame into a teardrop and makes it flicker.",
    ru: "горячий газ легче, конвекция вытягивает пламя в каплю и заставляет его дрожать.",
  },
  inOrbit: { en: "In orbit", ru: "На орбите" },
  inOrbitNote: {
    en: "nothing pulls. Oxygen arrives evenly from every side, so the flame is a dim, steady blue sphere.",
    ru: "тянуть нечему. Кислород приходит равномерно со всех сторон, и пламя остаётся тусклым неподвижным синим шаром.",
  },
  cached: { en: "Pre-computed answer", ru: "Готовый ответ" },
  answeredNow: { en: "Answered just now", ru: "Ответ получен сейчас" },
  // Колонка узкая: подсказка короткая, полная формулировка — для экранного диктора
  askPlaceholder: { en: "Your own question", ru: "Свой вопрос" },
  askLabel: {
    en: "Ask your own question about the NASA reports",
    ru: "Свой вопрос по отчётам NASA",
  },
  askSend: { en: "Ask", ru: "Спросить" },
  seconds: { en: "{s} s", ru: "{s} с" },
  noAnswer: { en: "No answer yet.", ru: "Ответа пока нет." },
  askNeedsBackend: {
    en: "Your own questions need the backend running. The topics above work offline.",
    ru: "Для своего вопроса нужен запущенный бэкенд. Темы выше работают и без него.",
  },
  llmOff: {
    en: "The AI runtime is not responding, so live answers are off. Start it or check the address in AI settings at the top.",
    ru: "Рантайм AI не отвечает, живые ответы недоступны. Запустите его или проверьте адрес в настройках AI вверху.",
  },
  askFailed: {
    en: "The model did not answer. Check the AI runtime in AI settings at the top.",
    ru: "Модель не ответила. Проверьте рантайм в настройках AI вверху.",
  },
  aiSettings: { en: "AI settings", ru: "Настройки AI" },
  askFailedCached: {
    en: "backend did not answer, showing the captured one",
    ru: "бэкенд не ответил, показан снятый",
  },
};

/** Бэкенд отдаёт единицы ASCII-строкой (контракт API), показываем типографски. */
export const prettyUnits = (u: string) => u.replace("^2", "\u00B2");

/** Короткие ярлыки тем: полный вопрос в кнопку не влезает и рвётся на полуслове. */
export const TOPIC_LABEL: Record<string, Record<Lang, string>> = {
  oxygen: { en: "Oxygen", ru: "Кислород" },
  pressure: { en: "Pressure", ru: "Давление" },
  solids: { en: "Solids vs Earth", ru: "Твёрдые тела" },
  airflow: { en: "Airflow", ru: "Поток воздуха" },
  materials: { en: "BASS-II findings", ru: "Итоги BASS-II" },
  helium: { en: "Helium", ru: "Гелий" },
  safety: { en: "Crew safety", ru: "Безопасность экипажа" },
  droplet: { en: "Droplet size", ru: "Размер капли" },
};

export const tr = (key: string, lang: Lang, vars: Record<string, string> = {}) => {
  let s = t[key]?.[lang] ?? key;
  // split/join, а не replace: replace меняет только первое вхождение и
  // трактует $& в значении как ссылку на совпадение
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v);
  return s;
};

export const OUTCOME_LABEL: Record<string, Record<Lang, string>> = {
  extinction: { en: "extinguished", ru: "погасло" },
  sustained_burn: { en: "kept burning", ru: "устойчиво горело" },
  blowoff: { en: "blown off", ru: "сорвало потоком" },
  no_ignition: { en: "would not ignite", ru: "не зажглось" },
  unknown: { en: "not recorded", ru: "не установлено" },
};

export const FEATURE_LABEL: Record<string, Record<Lang, string>> = {
  oxygen_level: { en: "Oxygen fraction", ru: "Доля кислорода" },
  d_initial_mm: { en: "Droplet diameter", ru: "Диаметр капли" },
  he: { en: "Helium", ru: "Гелий" },
  co2: { en: "Carbon dioxide", ru: "Углекислый газ" },
  pressure_mmhg: { en: "Pressure", ru: "Давление" },
  n2: { en: "Nitrogen", ru: "Азот" },
  fuel_heptane: { en: "Heptane fuel", ru: "Топливо: гептан" },
  fuel_methanol: { en: "Methanol fuel", ru: "Топливо: метанол" },
};
