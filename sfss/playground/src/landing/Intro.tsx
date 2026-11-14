import type { Lang } from "../shared/types";
import { FlameComparison } from "./FlameComparison";
import { Coverage } from "./Coverage";
import { tr } from "../shared/i18n";

/** Одна мысль: почему огонь в невесомости ведёт себя иначе.
 *
 *  Текста здесь намеренно мало. Про тридцать лет опытов и 388 запусков
 *  уже сказано в колонке над видео, и повторять это второй раз незачем.
 *  Остаётся физика, которой больше нигде на странице нет. */
export function Intro({ lang }: { lang: Lang }) {
  return (
    <section className="intro" id="premise">
      <h2>{tr("premiseH", lang)}</h2>

      <figure className="intro-figure">
        <FlameComparison />
        <figcaption>
          <span><b>{tr("onEarth", lang)}</b> {tr("onEarthNote", lang)}</span>
          <span><b>{tr("inOrbit", lang)}</b> {tr("inOrbitNote", lang)}</span>
        </figcaption>
      </figure>

      <Coverage lang={lang} />
    </section>
  );
}
