import type { Lang } from "../shared/types";
import { FlameComparison } from "./FlameComparison";
import { Coverage } from "./Coverage";
import { tr } from "../shared/i18n";

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
