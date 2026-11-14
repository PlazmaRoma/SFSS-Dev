import type { Lang } from "../shared/types";
import { tr } from "../shared/i18n";

export function MirCase({ lang }: { lang: Lang }) {
  return (
    <div className="panel mir">
      <h3>{tr("mirH", lang)}</h3>

      <dl className="mir-facts">
        <div>
          <dt>{tr("mirWhen", lang)}</dt>
          <dd>23.02.1997</dd>
        </div>
        <div>
          <dt>{tr("mirBurn", lang)}</dt>
          <dd>~14 {tr("mirMin", lang)}</dd>
        </div>
        <div>
          <dt>{tr("mirAir", lang)}</dt>
          <dd>21% O₂ · 14.7 psi</dd>
        </div>
      </dl>

      <p>{tr("mirBody", lang)}</p>
      <p className="footnote">{tr("mirLimit", lang)}</p>
    </div>
  );
}
