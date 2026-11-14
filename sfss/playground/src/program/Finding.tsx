import type { Lang } from "../shared/types";
import { tr } from "../shared/i18n";

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
