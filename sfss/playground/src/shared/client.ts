import type { Answer, Source } from "./types";

/** Сетевая часть, общая для Площадки и программы Anti-Fire.
 *
 *  Без фикстур и без офлайна: Площадке они нужны, а настоящая программа должна
 *  честно сказать, что сервис не запущен. Адрес и ключ задаются при создании,
 *  потому что Anti-Fire может работать с SFSS на другой машине. */

/** Событие потока /query/stream, по одному на строку (NDJSON). */
export type StreamEvent =
  | { type: "sources"; sources: Source[]; search_query: string | null }
  | { type: "stage"; stage: "loading" | "searching" | "answering" | "translating" }
  | { type: "delta"; text: string }
  | { type: "done"; answer: string }
  | { type: "error"; detail: string };

/** Режет поток байт на строки JSON. Кусок может оборваться посреди строки
 *  и даже посреди буквы, поэтому хвост копится до следующего куска. */
export async function readEvents(body: ReadableStream<Uint8Array>, onEvent: (e: StreamEvent) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let tail = "";
  for (;;) {
    const { value, done } = await reader.read();
    tail += decoder.decode(value, { stream: !done });
    const lines = tail.split("\n");
    tail = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as StreamEvent);
    if (done) break;
  }
  if (tail.trim()) onEvent(JSON.parse(tail) as StreamEvent);
}

export interface Progress { sources: Source[] | null; stage: "loading" | "searching" | "answering" | "translating"; text: string }

/** Что ушло в API: из этого программа показывает журнал и команду curl. */
export interface RequestRecord {
  method: string;
  path: string;
  url: string;
  status: number | null;
  ms: number;
  body?: string;
  contentType?: string;
}

export interface ClientOptions {
  base: string;
  key?: string;
  prefix?: string;
  onRequest?: (record: RequestRecord) => void;
}

export interface RequestOptions {
  body?: BodyInit;
  contentType?: string;
  ms?: number;
  /** Не записывать в журнал: фоновый опрос заглушил бы всё остальное. */
  quiet?: boolean;
}

/** Ответ с кодом ошибки. detail — причина от сервиса, её можно показать человеку. */
export class ApiError extends Error {
  status: number;
  detail: string | null;
  constructor(path: string, status: number, detail: string | null) {
    super(`${path} → ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

async function readDetail(res: Response): Promise<string | null> {
  try {
    const detail = ((await res.json()) as { detail?: unknown }).detail;
    return typeof detail === "string" ? detail : null;
  } catch {
    return null;
  }
}

export function createClient({ base, key, prefix = "", onRequest }: ClientOptions) {
  const auth = (): Record<string, string> => (key ? { "X-API-Key": key } : {});

  const record = (
    method: string, path: string, startedAt: number, status: number | null, options: RequestOptions,
  ) => {
    if (options.quiet) return;
    onRequest?.({
      method,
      path: prefix + path,
      url: base + prefix + path,
      status,
      ms: Math.round(performance.now() - startedAt),
      body: typeof options.body === "string" ? options.body : undefined,
      contentType: options.contentType,
    });
  };

  async function call<T>(
    method: string, path: string, options: RequestOptions, read: (res: Response) => Promise<T>,
  ): Promise<T> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), options.ms ?? 8000);
    const startedAt = performance.now();
    try {
      const res = await fetch(base + prefix + path, {
        method,
        headers: { ...auth(), ...(options.contentType ? { "Content-Type": options.contentType } : {}) },
        body: options.body,
        signal: ctl.signal,
      }).catch((error: unknown) => {
        record(method, path, startedAt, null, options);
        throw error;
      });
      record(method, path, startedAt, res.status, options);
      if (!res.ok) throw new ApiError(path, res.status, await readDetail(res));
      return await read(res);
    } finally {
      clearTimeout(timer);
    }
  }

  const get = <T,>(path: string, ms = 8000, quiet = false) =>
    call<T>("GET", path, { ms, quiet }, (res) => res.json() as Promise<T>);

  const post = <T,>(path: string, body: unknown, ms = 90_000, quiet = false) =>
    call<T>(
      "POST", path,
      { body: JSON.stringify(body), contentType: "application/json", ms, quiet },
      (res) => res.json() as Promise<T>,
    );

  const patch = <T,>(path: string, body: unknown, ms = 8000) =>
    call<T>(
      "PATCH", path,
      { body: JSON.stringify(body), contentType: "application/json", ms },
      (res) => res.json() as Promise<T>,
    );

  const del = <T,>(path: string, ms = 8000) =>
    call<T>("DELETE", path, { ms }, (res) => res.json() as Promise<T>);

  /** Тело не JSON: CSV и PDF, а также загрузка страницы отчёта. */
  const send = <T,>(method: string, path: string, options: RequestOptions, read: (res: Response) => Promise<T>) =>
    call<T>(method, path, options, read);

  /** Язык ответа — отдельное поле, а не просьба в тексте вопроса: вопрос целиком
   *  уходит в поиск, и приписка уводила его на чужие страницы. */
  const askLive = (question: string, lang: "en" | "ru") =>
    post<Answer>("/query", { question, language: lang });

  /** Тот же вопрос, но ответ показывается по мере генерации.
   *
   *  Полминуты пустого экрана — главное, что портило живой вопрос. Тайм-аут
   *  здесь не на весь ответ, а на тишину: длинный русский ответ идёт дольше
   *  90 секунд, но пока куски приходят, ждать есть чего.
   *
   *  Бэкенд без /query/stream отвечает 404 — тогда обычный /query. */
  async function askStream(
    question: string,
    lang: "en" | "ru",
    onProgress: (p: Progress) => void,
    silenceMs = 90_000,
    signal?: AbortSignal,
  ): Promise<Answer> {
    const ctl = new AbortController();
    const stop = () => ctl.abort();
    signal?.addEventListener("abort", stop);
    let timer = setTimeout(stop, silenceMs);
    const alive = () => {
      clearTimeout(timer);
      timer = setTimeout(stop, silenceMs);
    };
    const body = JSON.stringify({ question, language: lang });
    const startedAt = performance.now();
    const options = { body, contentType: "application/json" };
    try {
      const res = await fetch(base + prefix + "/query/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth() },
        body,
        signal: ctl.signal,
      }).catch((error: unknown) => {
        record("POST", "/query/stream", startedAt, null, options);
        throw error;
      });
      record("POST", "/query/stream", startedAt, res.status, options);
      if (res.status === 404) return askLive(question, lang);
      if (!res.ok || !res.body) throw new ApiError("/query/stream", res.status, await readDetail(res));

      const p: Progress = { sources: null, stage: "searching", text: "" };
      let answer: string | null = null;
      await readEvents(res.body, (e) => {
        alive();
        if (e.type === "sources") p.sources = e.sources;
        else if (e.type === "stage") p.stage = e.stage;
        else if (e.type === "delta") p.text += e.text;
        else if (e.type === "done") answer = e.answer;
        else if (e.type === "error") throw new Error(e.detail);
        onProgress({ ...p });
      });
      if (answer === null) throw new Error("/query/stream оборвался без done");
      return { answer, sources: p.sources ?? [] };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      // После ошибки посреди потока соединение иначе висело бы открытым
      ctl.abort();
    }
  }

  return { base, prefix, hasKey: Boolean(key), get, post, patch, del, send, askLive, askStream };
}

export type Client = ReturnType<typeof createClient>;
