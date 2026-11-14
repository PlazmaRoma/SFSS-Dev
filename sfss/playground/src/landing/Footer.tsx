import type { Lang } from "../shared/types";
import { tr } from "../shared/i18n";
import twinbyte from "../shared/media/twinbyte.png";
// Отметка участия, не знак поддержки: оговорка стоит последней строкой подвала
import spaceapps from "../shared/media/spaceapps.png";

/** Подвал: кто сделал, откуда данные, чего инструмент не умеет и как
 *  это проверить. Порядок именно такой: сначала происхождение данных,
 *  потом границы применимости. Для этого проекта они и есть аргумент.
 */
const SOURCES = [
  { name: "NASA NTRS", detail: "16 reports · 998 pages", href: "https://ntrs.nasa.gov/" },
  { name: "NASA PSI", detail: "PSI-25 · BASS-II · 129 runs", href: "https://psi.nasa.gov/" },
  { name: "NASA FLEX", detail: "droplet matrix · 259 runs", href: "https://ntrs.nasa.gov/citations/20150023456" },
];

export function Footer({ lang }: { lang: Lang }) {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-top">
          <div>
            <span className="footer-mark">SFSS Playground</span>
            <p>{tr("footLine", lang)}</p>
          </div>
          <img className="event-logo" src={spaceapps} alt="NASA Space Apps Challenge" width={180} height={72} />
        </div>

        <div className="credit">
          {/* Эмблемы NASA здесь нет: правила Space Apps запрещают фирменный
              стиль NASA в созданном с ИИ. Чьи это данные, говорят названия. */}
          <h4>{tr("footSources", lang)}</h4>
          <ul>
            {SOURCES.map((s) => (
              <li key={s.name}>
                <a href={s.href} target="_blank" rel="noreferrer">{s.name}</a>
                <span>{s.detail}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="footer-rows">
          <div>
            <h4>{tr("footTeam", lang)}</h4>
            {/* Логотип уже говорит «TwinByte», поэтому в тексте рядом
                название команды не повторяем. */}
            <img className="team-logo" src={twinbyte} alt="TwinByte" width={132} height={39} />
            <p>{tr("footTeamNote", lang)}</p>
          </div>
          <div>
            <h4>{tr("footScope", lang)}</h4>
            <p>{tr("footScopeNote", lang)}</p>
          </div>
          <div>
            <h4>{tr("footCheck", lang)}</h4>
            <p>{tr("footCheckNote", lang)}</p>
          </div>
        </div>

        <div className="footer-fine">
          <p>{tr("footFine", lang)}</p>
        </div>
      </div>
    </footer>
  );
}
