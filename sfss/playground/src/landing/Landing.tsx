import { type RefObject, useEffect, useRef, useState } from "react";
import type { Lang } from "../shared/types";
import { DemoPlayer } from "./DemoPlayer";
import { Download } from "./Download";
import { Intro } from "./Intro";
import { P, clamp01 } from "./heroSequence";
import { tr } from "../shared/i18n";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Лендинг: сцена с огнём → демо-видео → описание → в чём разница.
 *  Холст живёт выше по дереву, здесь только содержимое.
 *
 *  Прокрутку холст читает через ref, а не через состояние: она меняется
 *  каждый кадр, и перерисовывать ради неё дерево React незачем. Имена с
 *  окончанием Ref — не украшение: по ним анализатор React отличает ref,
 *  в который писать можно, от обычного пропса, который менять нельзя. */
export function Landing({
  lang, progressRef, stageBottomRef,
}: {
  lang: Lang;
  progressRef: RefObject<number>;
  stageBottomRef: RefObject<number>;
}) {
  const stage = useRef<HTMLDivElement>(null);
  // Без анимации текст виден сразу, а не после первого кадра эффекта
  const [revealed, setRevealed] = useState(reducedMotion);

  useEffect(() => {
    if (reducedMotion()) {
      progressRef.current = 1;
      if (stage.current) stageBottomRef.current = stage.current.offsetHeight - window.innerHeight;
      return;
    }
    let raf = 0;
    const read = () => {
      const el = stage.current;
      if (el) {
        const travel = el.offsetHeight - window.innerHeight;
        stageBottomRef.current = travel;
        const p = travel > 0 ? clamp01(-el.getBoundingClientRect().top / travel) : 1;
        progressRef.current = p;
        setRevealed(p >= P.content);
      }
      raf = requestAnimationFrame(read);
    };
    raf = requestAnimationFrame(read);
    return () => cancelAnimationFrame(raf);
  }, [progressRef, stageBottomRef]);

  return (
    <>
      <div className="stage" ref={stage}>
        <div className="stage-sticky">
          <div className={revealed ? "hero-center in" : "hero-center"}>
            <h1>{tr("heroH1", lang)}</h1>
          </div>

          <div className={revealed ? "scroll-cue gone" : "scroll-cue"} aria-hidden="true">
            <span>{tr("scrollCue", lang)}</span>
          </div>
        </div>
      </div>

      <section className="demo-band" id="demo">
        <DemoPlayer lang={lang} />

        <div className="lede">
          <h2>{tr("ledeH", lang)}</h2>
          <p>{tr("heroDesc", lang)}</p>
          <p>{tr("ledeBody", lang)}</p>
        </div>
      </section>

      <Intro lang={lang} />

      <Download lang={lang} />
    </>
  );
}
