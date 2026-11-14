import type { Lang } from "../shared/types";
import { tr } from "../shared/i18n";

/** Главная находка — первое, что видно на странице базы.
 *
 *  Без неё судья попадает в шесть одинаковых модулей и сам ищет, где
 *  интересное. Здесь сразу сказано, что нашли и откуда цифра. */
export function Finding({ lang, onJump }: { lang: Lang; onJump: () => void }) {
  return (
    <section className="finding">
      <b>1.40×</b>
      <div>
        <h2>{tr("findH", lang)}</h2>
        <p>{tr("findBody", lang)}</p>
      </div>
      <button className="linkish" onClick={onJump}>{tr("findJump", lang)}</button>
    </section>
  );
}
