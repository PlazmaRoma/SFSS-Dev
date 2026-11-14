import { useEffect, useState } from "react";
import type { Lang } from "../types";

/** Язык Площадки: по умолчанию английский, выбор запоминается между запусками.
 *  localStorage может быть недоступен (приватное окно, запрет в настройках): тогда
 *  язык просто не запоминается, а страница работает. */
const KEY = "sfss.lang";
export const DEFAULT_LANG: Lang = "en";

export function loadLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === "ru" || saved === "en" ? saved : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

export function useLang(): [Lang, (lang: Lang) => void] {
  const [lang, setLang] = useState<Lang>(loadLang);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, lang);
    } catch {
      // без памяти о языке страница всё равно работает
    }
    document.documentElement.lang = lang;
  }, [lang]);
  return [lang, setLang];
}
