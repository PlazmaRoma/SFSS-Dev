import { useRef } from "react";
import { HeroCanvas } from "./HeroCanvas";
import { Landing } from "./Landing";
import { TopBar } from "../shared/TopBar";
import { Footer } from "./Footer";
import "../shared/app.css";
import { useLang } from "../shared/lib/lang";

export default function App() {
  const [lang, setLang] = useLang();
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
