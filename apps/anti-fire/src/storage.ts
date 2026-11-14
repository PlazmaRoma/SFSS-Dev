/** localStorage может быть недоступен: приватное окно или запрет в настройках.
 *  Программа тогда просто ничего не помнит между запусками. */
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* см. выше */
  }
}
