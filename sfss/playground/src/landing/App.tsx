import { useRef, useState } from "react";
import type { Lang } from "../shared/types";
import { HeroCanvas } from "./HeroCanvas";
import { Landing } from "./Landing";
import { TopBar } from "../shared/TopBar";
import { Footer } from "./Footer";
import "../shared/app.css";

/** Лендинг. Сам рабочий стол переехал в отдельную сборку (app.html):
 *  это и есть «программа», которую скачивают кнопкой внизу страницы. */
export default function App() {
  const [lang, setLang] = useState<Lang>("en");
  const heroProgress = useRef(0);
  const stageBottom = useRef(0);

  return (
    <>
      <HeroCanvas progress={heroProgress} stageBottom={stageBottom} />
      <TopBar lang={lang} setLang={setLang} />
      <Landing lang={lang} progressRef={heroProgress} stageBottomRef={stageBottom} />
      <Footer lang={lang} />
    </>
  );
}
