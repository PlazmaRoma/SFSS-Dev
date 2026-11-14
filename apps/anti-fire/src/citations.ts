/** Ссылки в тексте ответа: куски текста и ссылки на страницы отчётов.
 *
 *  Модель пишет [NTRS-20000030678, p. 97], в одних скобках бывает несколько через
 *  точку с запятой, а подпись страницы зависит от языка. Ссылка из текста самого
 *  отчёта, вроде [Olson 1988], открыть нечего, поэтому это просто текст. */
export type Part =
  | { kind: "text"; text: string }
  | { kind: "cite"; text: string; docId: string; page: number };

// Перевод ответа иногда пишет номер кириллицей или ставит круглые скобки
const BRACKETS = /\[[^\]]*\]|\((?:NTRS|НТРС)-[^)]*\)/g;
const CITE = /(?:NTRS|НТРС)-(\d+)[^;]*?(?:p\.|стр\.|с\.)\s*(\d+)/g;
const BOLD_CITE = /\*\*(\[[^\]]*\])\*\*/g;
const BOLD = /\*\*(.+?)\*\*/g;

/** Модель выделяет термины как в Markdown. Нечётные куски жирные. */
export const splitBold = (text: string): string[] => text.split(BOLD);

export function splitCitations(raw: string): Part[] {
  const answer = raw.replace(BOLD_CITE, "$1");
  const parts: Part[] = [];
  let last = 0;
  for (const match of answer.matchAll(BRACKETS)) {
    const cites = [...match[0].matchAll(CITE)];
    if (!cites.length) continue;
    if (match.index > last) parts.push({ kind: "text", text: answer.slice(last, match.index) });
    for (const cite of cites) {
      parts.push({ kind: "cite", text: `[${cite[0]}]`, docId: `NTRS-${cite[1]}`, page: Number(cite[2]) });
    }
    last = match.index + match[0].length;
  }
  if (last < answer.length) parts.push({ kind: "text", text: answer.slice(last) });
  return parts;
}

export const detectLanguage = (question: string): "ru" | "en" => (/[а-яё]/i.test(question) ? "ru" : "en");
