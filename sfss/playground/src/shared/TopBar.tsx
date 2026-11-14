import type { ReactNode } from "react";
import type { Lang } from "../shared/types";
import { tr } from "../shared/i18n";

const NAV: { href: string; key: string }[] = [
  { href: "#demo", key: "navDemo" },
  { href: "#premise", key: "navPremise" },
];

export function TopBar({
  lang, setLang, variant = "landing", actions,
}: {
  lang: Lang;
  setLang: (l: Lang) => void;
  variant?: "landing" | "program";
  actions?: ReactNode;
}) {
  const go = (href: string) => {
    document.getElementById(href.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <a
          className="brand"
          href="#"
          onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}
        >
          <span>SFSS Playground</span>
        </a>
        {variant === "landing" && (
          <nav>
            {NAV.map((n) => (
              <button key={n.href} onClick={() => go(n.href)}>{tr(n.key, lang)}</button>
            ))}
          </nav>
        )}
      </div>

      <div className="topbar-right">
        {actions}
        <div className="pill-group">
          {(["en", "ru"] as Lang[]).map((l) => (
            <button key={l} aria-pressed={lang === l} onClick={() => setLang(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
        {variant === "landing" && (
          <a className="pill-solid" href="#download">{tr("grabBtn", lang)}</a>
        )}
      </div>
    </header>
  );
}
