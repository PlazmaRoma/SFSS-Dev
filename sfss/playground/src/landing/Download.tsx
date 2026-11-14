import type { Lang } from "../shared/types";
import { tr } from "../shared/i18n";

const INTEGRATION_DOCS = "https://github.com/PlazmaRoma/SFSS-Dev/blob/main/sfss/docs/INTEGRATION.md";

/** Последний блок лендинга перед подвалом.
 *  Архив лежит в public и собирается скриптом tools/make_source_zip.sh —
 *  так он не расходится с кодом после правок. */
export function Download({ lang }: { lang: Lang }) {
  return (
    <section className="grab" id="download">
      <h2>{tr("grabH", lang)}</h2>
      <p>{tr("grabBody", lang)}</p>
      <p>
        {tr("playgroundNote", lang)}{" "}
        <a href={INTEGRATION_DOCS} target="_blank" rel="noreferrer">{tr("playgroundDocs", lang)}</a>
      </p>

      <div className="grab-row">
        <a className="btn-solid" href="/sfss.zip" download>
          {tr("grabBtn", lang)}
        </a>
        <span>{tr("grabMeta", lang)}</span>
      </div>
    </section>
  );
}
