import type { Lang } from "@sfss/types";
import { load, save } from "./storage";

/** Язык программы. По умолчанию английский, выбор человека запоминается между запусками.
 *  Раньше по умолчанию брался язык системы, но программу показывают международному жюри.
 *
 *  Значение общее на модуль: условия, команды и ошибки разбираются чистыми
 *  функциями, и протаскивать язык через каждую незачем. Смену языка перерисовывает App. */
export const DEFAULT_LANG: Lang = "en";

let current: Lang = load<Lang | null>("antifire.lang", null) ?? DEFAULT_LANG;

if (typeof document !== "undefined") document.documentElement.lang = current;

export const getLang = (): Lang => current;

export function setLang(lang: Lang, remember = true): void {
  current = lang;
  if (remember) save("antifire.lang", lang);
  if (typeof document !== "undefined") document.documentElement.lang = lang;
}

const TEXT = {
  // Общее
  screen: { ru: "Экран", en: "Screen" },
  tabWork: { ru: "Работа", en: "Work" },
  tabData: { ru: "Данные", en: "Data" },
  language: { ru: "Язык программы", en: "Program language" },
  connectionTitle: { ru: "Подключение к SFSS", en: "Connection to SFSS" },
  model: { ru: "Модель", en: "Model" },
  modelLoading: { ru: "{model} загружается", en: "{model} is loading" },
  modelNotLoaded: { ru: "{model} не в памяти", en: "{model} is not in memory" },
  lmDown: { ru: "{runtime} не запущен", en: "{runtime} is not running" },
  aiSettings: { ru: "Настройки AI", en: "AI settings" },
  aiSettingsTitle: { ru: "Рантайм и модель: LM Studio или Ollama, адрес, порт", en: "Runtime and model: LM Studio or Ollama, host, port" },
  dotOk: { ru: "работает", en: "running" },
  dotWarn: { ru: "внимание", en: "attention" },
  dotBad: { ru: "не работает", en: "not running" },
  offline: { ru: "SFSS не отвечает на {base}. Запустите сервис:", en: "SFSS does not answer at {base}. Start the service:" },
  offlineNative: { ru: "SFSS не запущен на {base}.", en: "SFSS is not running at {base}." },
  serviceStart: { ru: "Запустить SFSS", en: "Start SFSS" },
  serviceStop: { ru: "Остановить SFSS", en: "Stop SFSS" },
  serviceStarting: { ru: "Запускаю SFSS, это до минуты...", en: "Starting SFSS, up to a minute..." },
  serviceStopping: { ru: "Останавливаю SFSS...", en: "Stopping SFSS..." },
  serviceStopTitle: {
    ru: "Остановить сервис и выгрузить модель из памяти",
    en: "Stop the service and unload the model from memory",
  },
  serviceNotFound: {
    ru: "Команда sfss не найдена. Установите её: sfss/docs/INTEGRATION.md",
    en: "The sfss command was not found. Install it: sfss/docs/INTEGRATION.md",
  },
  serviceStillUp: {
    ru: "SFSS всё ещё отвечает: он запущен не командой sfss. Остановите его там, где запускали.",
    en: "SFSS still answers: it was not started with the sfss command. Stop it where it was started.",
  },
  serviceNotUp: {
    ru: "SFSS не отвечает на {base}: возможно, он работает на другом порту. Статус выше.",
    en: "SFSS does not answer at {base}: it may be on another port. See the status above.",
  },
  serviceBrowserOnly: {
    ru: "В браузере это недоступно: выполните sfss {action} в обычном терминале.",
    en: "A browser cannot do this: run sfss {action} in a regular terminal.",
  },
  serviceRemote: {
    ru: "Сервис на другой машине: запускайте его там.",
    en: "The service is on another machine: control it there.",
  },
  otherAddress: { ru: "Другой адрес", en: "Another address" },
  address: { ru: "Адрес SFSS", en: "SFSS address" },
  keyLabel: { ru: "Ключ, если сервис на другой машине", en: "Key, if the service is on another machine" },
  connect: { ru: "Подключить", en: "Connect" },
  cancel: { ru: "Отмена", en: "Cancel" },
  noReply: { ru: "SFSS не ответил", en: "SFSS did not answer" },
  noConnection: { ru: "Нет связи с SFSS", en: "No connection to SFSS" },
  terminalHeight: { ru: "Высота терминала", en: "Terminal height" },
  terminalHandle: {
    ru: "Потяните, чтобы изменить высоту терминала. Двойной клик вернёт обычную",
    en: "Drag to change the terminal height. Double-click to reset",
  },

  // Единицы
  burnUnit: { ru: "мм²/с", en: "mm²/s" },
  mmHg: { ru: "мм рт. ст.", en: "mmHg" },
  mm: { ru: "мм", en: "mm" },
  page: { ru: "стр.", en: "p." },

  // Расчёт
  calc: { ru: "Расчёт", en: "Calculation" },
  conditions: { ru: "Условия", en: "Conditions" },
  pressure: { ru: "Давление", en: "Pressure" },
  pressureUnit: { ru: "Единица давления", en: "Pressure unit" },
  auto: { ru: "авто", en: "auto" },
  droplet: { ru: "Капля", en: "Droplet" },
  fuel: { ru: "Топливо", en: "Fuel" },
  methanol: { ru: "Метанол", en: "Methanol" },
  heptane: { ru: "Гептан", en: "Heptane" },
  toTable: { ru: "В таблицу", en: "Add to table" },
  air: { ru: "Воздух", en: "Air" },
  burnRate: { ru: "Скорость горения", en: "Burning rate" },
  calculating: { ru: "Считаю...", en: "Calculating..." },
  vsAir: { ru: "от обычного воздуха", en: "of normal air" },
  modelError: { ru: "средняя ошибка модели", en: "mean model error" },
  heuristic: {
    ru: "Это оценка эвристикой, а не предсказание обученной модели",
    en: "This is a heuristic estimate, not a prediction of the trained model",
  },
  table: { ru: "Таблица", en: "Table" },
  uploadCsv: { ru: "Загрузить CSV", en: "Load CSV" },
  downloadCsv: { ru: "Выгрузить CSV", en: "Save CSV" },
  copy: { ru: "Скопировать", en: "Copy" },
  copiedDone: { ru: "Скопировано", en: "Copied" },
  clear: { ru: "Очистить", en: "Clear" },
  tableEmpty: {
    ru: "Enter в условиях добавляет расчёт сюда. CSV с колонками oxygen_level, n2, pressure_mmhg... считается целиком:",
    en: "Enter in the conditions adds a result here. A CSV with columns oxygen_level, n2, pressure_mmhg... is calculated whole:",
  },
  inTerminal: { ru: "в терминале.", en: "in the terminal." },
  columnDroplet: { ru: "капля, мм", en: "droplet, mm" },
  columnFuel: { ru: "топливо", en: "fuel" },
  columnRemarks: { ru: "замечания", en: "remarks" },
  csvCounted: { ru: "{name}: посчитано {done} из {total}", en: "{name}: calculated {done} of {total}" },
  csvSaved: { ru: "anti-fire-results.csv сохранён в папку «Загрузки»", en: "anti-fire-results.csv saved to Downloads" },
  needNumber: { ru: "нужно число", en: "enter a number" },
  range0to100: { ru: "от 0 до 100", en: "from 0 to 100" },
  aboveZero: { ru: "больше нуля", en: "above zero" },
  mixOver: { ru: "сумма газов больше 100 %", en: "gases add up to more than 100 %" },
  outOfRange: { ru: "{value} вне диапазона опытов: {range}.", en: "{value} is outside the experiments: {range}." },
  plateau: { ru: " Здесь модель выходит на плато.", en: " The model plateaus here." },
  gasSum: { ru: "Сумма газов {sum} %, а не 100 %.", en: "Gases add up to {sum} %, not 100 %." },

  // График
  chartCaption: { ru: "Если менять только кислород", en: "If only oxygen changes" },
  chartSummary: {
    ru: "Скорость горения от {low} до {high} мм²/с при кислороде от {from} до {to} %",
    en: "Burning rate from {low} to {high} mm²/s at oxygen from {from} to {to} %",
  },
  noExperiments: { ru: "нет опытов", en: "no experiments" },

  // AI
  aiPanel: { ru: "Вопросы по отчётам", en: "Questions about the reports" },
  aiTitle: { ru: "Вопрос по отчётам NASA", en: "Ask the NASA reports" },
  newChat: { ru: "Новый чат", en: "New chat" },
  allChats: { ru: "Все чаты", en: "All chats" },
  backToCalc: { ru: "← К расчёту", en: "← Back to calculation" },
  chats: { ru: "Чаты", en: "Chats" },
  deleteChat: { ru: "Удалить чат", en: "Delete chat" },
  confirmDelete: { ru: "Удалить?", en: "Delete?" },
  aiIntro: {
    ru: "Отвечает только по 16 отчётам NASA, со ссылками на страницы. Ответ занимает 30–60 с.",
    en: "Answers only from 16 NASA reports, with links to pages. An answer takes 30–60 s.",
  },
  askPlaceholder: { ru: "Задайте вопрос и нажмите Enter", en: "Type a question and press Enter" },
  question: { ru: "Вопрос", en: "Question" },
  answerLanguage: { ru: "Язык ответа", en: "Answer language" },
  langAuto: { ru: "язык вопроса", en: "question language" },
  stop: { ru: "Стоп", en: "Stop" },
  stopped: { ru: "Остановлено", en: "Stopped" },
  ask: { ru: "Спросить", en: "Ask" },
  openPage: { ru: "Открыть страницу отчёта", en: "Open the report page" },
  stageLoading: { ru: "Загружаю модель", en: "Loading the model" },
  stageSearching: { ru: "Ищу в отчётах", en: "Searching the reports" },
  stageAnswering: { ru: "Модель пишет ответ", en: "The model is writing" },
  stageTranslating: { ru: "Перевожу", en: "Translating" },
  seconds: { ru: "с", en: "s" },
  loadingNow: { ru: "Загружаю модель, это до минуты...", en: "Loading the model, up to a minute..." },
  hintServerDown: {
    ru: "{runtime} не запущен. Запущу и загружу модель при первом вопросе или сейчас.",
    en: "{runtime} is not running. It will start with the first question, or now.",
  },
  hintNotLoaded: {
    ru: "Модель не в памяти. Загрузится при первом вопросе или сейчас.",
    en: "The model is not in memory. It will load with the first question, or now.",
  },
  hintContext: {
    ru: "Контекст модели {context}: на 8 ГБ это своп. Нужен {limit}.",
    en: "Model context is {context}: on 8 GB this swaps. {limit} is needed.",
  },
  load: { ru: "Загрузить модель", en: "Load model" },
  reload: { ru: "Перезагрузить модель", en: "Reload model" },
  unload: { ru: "Выгрузить модель", en: "Unload model" },
  unloadTitle: { ru: "Выгрузить модель из памяти", en: "Unload the model from memory" },
  loadTitle: { ru: "Загрузить модель в память", en: "Load the model into memory" },

  // Страница отчёта
  reportPage: { ru: "Страница отчёта", en: "Report page" },
  openSeparately: { ru: "Открыть отдельно", en: "Open separately" },
  close: { ru: "Закрыть", en: "Close" },
  openingPage: { ru: "Открываю страницу...", en: "Opening the page..." },

  // Данные
  dataScreen: { ru: "Данные", en: "Data" },
  experiments: { ru: "Опыты", en: "Experiments" },
  datasetSource: {
    ru: "FLEX (Flame Extinguishment Experiment), МКС: матрица опытов из отчёта {report}, стр. {pages}",
    en: "FLEX (Flame Extinguishment Experiment), ISS: test matrix from report {report}, pages {pages}",
  },
  columnTest: { ru: "опыт", en: "test" },
  columnExtinction: { ru: "погасла, мм", en: "extinction, mm" },
  columnEnd: { ru: "конец", en: "end" },
  endExtinction: { ru: "погасла", en: "extinction" },
  endCompletion: { ru: "сгорела", en: "completion" },
  endDisruption: { ru: "разрушилась", en: "disruption" },
  modelTitle: { ru: "Модель", en: "Model" },
  modelAbout: {
    ru: "Предсказывает скорость горения капли топлива по составу атмосферы. Материалов (ткань, пластик, кабели) в ней нет.",
    en: "Predicts the burning rate of a fuel droplet from the atmosphere. Materials (fabric, plastic, cables) are not in it.",
  },
  meanError: { ru: "Средняя ошибка", en: "Mean error" },
  constantError: { ru: "У константы", en: "Constant baseline" },
  validation: { ru: "Проверка", en: "Validation" },
  validationValue: { ru: "{folds} фолдов, {rows} опытов", en: "{folds} folds, {rows} experiments" },
  whatMatters: { ru: "Что влияет", en: "What matters" },
  loading: { ru: "Загружаю...", en: "Loading..." },
  reports: { ru: "Отчёты", en: "Reports" },
  columnReport: { ru: "Отчёт", en: "Report" },
  columnChunks: { ru: "фрагментов", en: "fragments" },
  columnMb: { ru: "МБ", en: "MB" },
  indexing: { ru: "Индексирую, это минуты...", en: "Indexing, this takes minutes..." },
  addPdf: { ru: "Добавить PDF", en: "Add PDF" },
  added: { ru: "Добавлен {id}: {chunks} фрагментов", en: "Added {id}: {chunks} fragments" },
  featureOxygen: { ru: "кислород", en: "oxygen" },
  featureDroplet: { ru: "диаметр капли", en: "droplet diameter" },
  featureHe: { ru: "гелий", en: "helium" },
  featureCo2: { ru: "углекислый газ", en: "carbon dioxide" },
  featurePressure: { ru: "давление", en: "pressure" },
  featureN2: { ru: "азот", en: "nitrogen" },
  featureHeptane: { ru: "гептан", en: "heptane" },
  featureMethanol: { ru: "метанол", en: "methanol" },

  // Терминал
  terminal: { ru: "Терминал", en: "Terminal" },
  command: { ru: "Команда", en: "Command" },
  noResponse: { ru: "нет ответа", en: "no response" },
  copiedLower: { ru: "скопировано", en: "copied" },
  termWelcome: { ru: "Терминал SFSS. Команды: help. Документация: docs.", en: "SFSS terminal. Commands: help. Documentation: docs." },
  termBurn: { ru: "Скорость горения  {value} мм²/с", en: "Burning rate  {value} mm²/s" },
  termRisk: { ru: "Оценка риска  {value}", en: "Risk estimate  {value}" },
  termWarning: { ru: "Внимание: {text}", en: "Warning: {text}" },
  termDefaults: { ru: "По умолчанию: {names}", en: "Defaults: {names}" },
  termLoading: { ru: "Загружаю модель, это до минуты...", en: "Loading the model, up to a minute..." },
  termStageLoading: { ru: "Загружаю модель...", en: "Loading the model..." },
  termStageSearching: { ru: "Ищу в отчётах...", en: "Searching the reports..." },
  termStageAnswering: { ru: "Модель пишет ответ...", en: "The model is writing..." },
  termStageTranslating: { ru: "Перевожу...", en: "Translating..." },
  termModelLoaded: { ru: "Модель     {model}, загружена, контекст {context}", en: "Model      {model}, loaded, context {context}" },
  termUnloaded: { ru: "Модель     {model}, выгружена", en: "Model      {model}, unloaded" },
  termServiceUp: { ru: "SFSS       работает, {base}", en: "SFSS       running, {base}" },
  termIndexOk: { ru: "Индекс     ok, {count} фрагментов", en: "Index      ok, {count} fragments" },
  termIndexDown: { ru: "Индекс     недоступен", en: "Index      unavailable" },
  termLmOk: { ru: "{runtime}ok, {address}", en: "{runtime}ok, {address}" },
  termLmDown: { ru: "{runtime}не отвечает на {address}", en: "{runtime}not responding at {address}" },
  termConfigRuntime: { ru: "Рантайм    {name}, {address}, {state}", en: "Runtime    {name}, {address}, {state}" },
  termConfigUp: { ru: "отвечает", en: "responding" },
  termConfigDown: { ru: "не отвечает", en: "not responding" },
  termConfigModel: { ru: "Модель     {name}", en: "Model      {name}" },
  termConfigMissing: { ru: "Модель     {name}, нет у рантайма: config models", en: "Model      {name}, not in the runtime: config models" },
  termConfigContext: { ru: "Контекст   {value}", en: "Context    {value}" },
  termConfigContextOwn: { ru: "Контекст   задаётся в {name}: OLLAMA_CONTEXT_LENGTH", en: "Context    set in {name}: OLLAMA_CONTEXT_LENGTH" },
  termConfigTokens: { ru: "Ответ до   {value} токенов", en: "Answer up to {value} tokens" },
  termConfigEmbedding: { ru: "Эмбеддинги {name} (смена только в .env и с новой индексацией)", en: "Embeddings {name} (changed only in .env, with a new indexing run)" },
  termConfigNoModels: { ru: "У рантайма нет доступных моделей", en: "The runtime has no models available" },
  termConfigChosen: { ru: "выбрана", en: "selected" },
  termConfigLoaded: { ru: "загружена", en: "loaded" },
  cmdConfig: { ru: "config: runtime, model, models или reset. Справка: help config", en: "config: runtime, model, models or reset. See: help config" },
  cmdConfigRuntime: { ru: "Укажите, что менять: config runtime ollama --port 11434", en: "Say what to change: config runtime ollama --port 11434" },
  cmdConfigKind: { ru: "Рантайм: lmstudio или ollama", en: "Runtime: lmstudio or ollama" },
  cmdConfigModel: { ru: "Укажите, что менять: config model ИМЯ --context 8192. Список: config models", en: "Say what to change: config model NAME --context 8192. List: config models" },
  termModel: { ru: "Модель     {model}{state}", en: "Model      {model}{state}" },
  termStateLoaded: { ru: ", загружена, контекст {context}", en: ", loaded, context {context}" },
  termStateNotLoaded: { ru: ", не загружена", en: ", not loaded" },
  termNoCommand: { ru: "Нет такой команды: {name}", en: "No such command: {name}" },
  termNoCommandList: { ru: "Нет такой команды: {name}. Список: help", en: "No such command: {name}. List: help" },
  termNoDocs: { ru: "Нет такого раздела: {name}. Разделы: docs", en: "No such section: {name}. Sections: docs" },
  termIndexing: { ru: "Индексирую {name}, большой отчёт займёт минуты...", en: "Indexing {name}, a large report takes minutes..." },

  // Разбор команд
  cmdUnknownFlag: { ru: "Нет такого параметра: {flag}. Справка: help", en: "No such option: {flag}. See: help" },
  cmdNeedValue: { ru: "После {flag} нужно значение", en: "{flag} needs a value" },
  cmdNeedNumber: { ru: "{flag}: нужно число, а не {raw}", en: "{flag}: enter a number, not {raw}" },
  cmdExtra: { ru: "Лишнее: {rest}. Справка: help predict", en: "Unexpected: {rest}. See: help predict" },
  cmdTwoPressures: { ru: "Давление задаётся либо --pressure, либо --psi", en: "Set the pressure with either --pressure or --psi" },
  cmdFraction: {
    ru: "{flag} это доля от 0 до 1, например 0.30, а не {value}",
    en: "{flag} is a fraction from 0 to 1, for example 0.30, not {value}",
  },
  cmdGasSum: { ru: "Сумма долей газов больше единицы", en: "Gas fractions add up to more than one" },
  cmdFuel: { ru: "--fuel: methanol или heptane", en: "--fuel: methanol or heptane" },
  cmdNeedQuestion: { ru: 'Нужен вопрос: ask "Как гелий влияет на горение?"', en: 'A question is needed: ask "How does helium affect burning?"' },
  cmdLang: { ru: "--lang: ru или en", en: "--lang: ru or en" },
} as const;

export type TextKey = keyof typeof TEXT;

export function tr(key: TextKey, vars?: Record<string, string | number>): string {
  let text: string = TEXT[key][current];
  for (const [name, value] of Object.entries(vars ?? {})) text = text.replace(`{${name}}`, String(value));
  return text;
}

/** Причины от сервиса приходят по-английски: это ответ API, а не интерфейс.
 *  Частые показываем на языке программы, остальные как есть, чтобы не потерять. */
const SERVICE_ERRORS: [RegExp, string][] = [
  [/^Not enough memory for the model/, "Модели не хватает памяти: закройте тяжёлые программы и повторите"],
  [/^The lms command was not found/, "Не найдена команда lms: установите LM Studio"],
  [/^The ollama command was not found/, "Не найдена команда ollama: установите Ollama"],
  [/^LM Studio runs on (\S+): load the model there/, "LM Studio работает на $1: загрузите модель там"],
  [/^Ollama runs on (\S+): start it there/, "Ollama работает на $1: запустите её там"],
  [/^(LM Studio|Ollama) is unreachable/, "$1 не отвечает или вернул ошибку"],
  [/^(LM Studio|Ollama) is not responding at (\S+)/, "$1 не отвечает на $2"],
  [/^Model (\S+) is not in LM Studio/, "Модели $1 нет в LM Studio: скачайте её там"],
  [/^Model (\S+) is not in Ollama: ollama pull (\S+)/, "Модели $1 нет в Ollama: ollama pull $2"],
  [/^Model (\S+) is banned by the Space Apps rules/, "Модель $1 запрещена правилами Space Apps"],
  [/^port: .*/, "Порт должен быть от 1 до 65535"],
  // Строки пакетного расчёта: таблица в программе на её языке, выгрузка CSV как есть
  [/^(\w+): not a number: (.+)/, "$1: не число: $2"],
  [/^(\w+): not a finite number: (.+)/, "$1: не конечное число: $2"],
  [/^Missing required parameters without defaults: (.+)/, "Не хватает параметров: $1"],
  [/^The model is loading/, "Модель загружается: повторите, когда закончится"],
  [/^Document already exists/, "Такой документ уже есть"],
  [/^API key required/, "Нужен ключ доступа: укажите его в подключении"],
];

export function serviceText(detail: string): string {
  if (current !== "ru") return detail;
  for (const [pattern, text] of SERVICE_ERRORS) if (pattern.test(detail)) return detail.replace(pattern, text).split("\n")[0];
  return detail;
}
