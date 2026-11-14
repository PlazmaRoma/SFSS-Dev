import type { Lang } from "../shared/types";
import { tr } from "../shared/i18n";

/** Пожар на «Мире», 23 февраля 1997.
 *
 *  Важная оговорка внутри текста: горела кислородная шашка, у неё свой
 *  окислитель, и наша модель такой пожар не описывает. Она считает
 *  горение в атмосфере отсека. Поэтому случай приведён не как проверка
 *  модели, а как ответ на вопрос, зачем всё это считать: даже в обычном
 *  воздухе пожар на станции шёл 14 минут.
 */
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
