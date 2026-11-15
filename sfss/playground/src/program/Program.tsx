import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Atmosphere, Dashboard, Health, PredictResponse } from "../shared/types";
import { BASELINE, HABITAT } from "../shared/data/habitat";
import type { MaterialKey } from "../shared/lib/bass";
import {
  fetchDashboard, fetchHealth, offlineDashboard, offlineHealth, predict, predictOffline, v1Client,
} from "../shared/api";
import { TopBar } from "../shared/TopBar";
import { LlmSettings } from "../shared/LlmSettings";
import { tr } from "../shared/i18n";
import { Finding } from "./Finding";
import { MirCase } from "./MirCase";
import { ModuleRank } from "./ModuleRank";
import { Conditions } from "./Conditions";
import { RoomMaterials } from "./RoomMaterials";
import { TimeToAct } from "./TimeToAct";
import { RoomView } from "./RoomView";
import { Explain } from "./Explain";
import { ModelQuality } from "./ModelQuality";
import { NextExperiment } from "./NextExperiment";
import "../shared/app.css";
import { useLang } from "../shared/lib/lang";

const TABS = ["time", "mats", "trust", "next"] as const;
type Tab = (typeof TABS)[number];

const initialAtmospheres = () =>
  Object.fromEntries(HABITAT.map((m) => [m.id, { ...m.atmosphere }])) as Record<string, Atmosphere>;

export default function Program() {
  const [lang, setLang] = useLang();
  const [online, setOnline] = useState(false);
  const [health, setHealth] = useState<Health>(offlineHealth);
  const [dashboard, setDashboard] = useState<Dashboard>(offlineDashboard);
  const [atmos, setAtmos] = useState<Record<string, Atmosphere>>(initialAtmospheres);
  const [mats, setMats] = useState<Record<string, MaterialKey[]>>(() =>
    Object.fromEntries(HABITAT.map((m) => [m.id, [...m.materials]])),
  );
  const [results, setResults] = useState<Record<string, PredictResponse>>({});
  const [baseline, setBaseline] = useState<number | null>(null);
  const [selected, setSelected] = useState(HABITAT[0].id);
  const [tab, setTab] = useState<Tab>("time");
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [h, d] = await Promise.all([fetchHealth(), fetchDashboard()]);
        if (!alive) return;
        setHealth(h);
        setDashboard(d);
        setOnline(true);
      } catch {
        if (alive) setOnline(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const probe = useRef({ wait: 8000, tries: 0 });
  useEffect(() => {
    if (online) return;
    if (probe.current.tries > 0) {
      probe.current.wait = Math.min(probe.current.wait * 2, 60_000);
    }
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (stop) return;
      probe.current.tries += 1;
      try {
        const [h, d] = await Promise.all([fetchHealth(), fetchDashboard()]);
        if (stop) return;
        setHealth(h);
        setDashboard(d);
        setOnline(true);
        return;
      } catch {
        probe.current.wait = Math.min(probe.current.wait * 2, 60_000);
      }
      if (!stop && probe.current.tries < 3) timer = setTimeout(tick, probe.current.wait);
    };

    timer = setTimeout(tick, probe.current.wait);
    const onFocus = () => {
      probe.current = { wait: 8000, tries: 0 };
      clearTimeout(timer);
      timer = setTimeout(tick, 200);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      stop = true;
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [online]);

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await fetchHealth());
    } catch {
    }
  }, []);

  const runPredict = useCallback(
    async (a: Atmosphere): Promise<PredictResponse> => {
      if (!online) return predictOffline(a);
      try {
        return await predict(a);
      } catch {
        setOnline(false);
        return predictOffline(a);
      }
    },
    [online],
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      const b = await runPredict(BASELINE);
      if (alive) setBaseline(b.predicted_value);
    })();
    return () => { alive = false; };
  }, [runPredict]);

  const seen = useRef(new Map<string, Promise<PredictResponse>>());
  const keyOf = useCallback(
    (a: Atmosphere) =>
      `${online ? "live" : "off"}|${a.oxygen_level}|${a.pressure_psi}|${a.droplet_mm}`,
    [online],
  );

  useEffect(() => {
    let alive = true;
    for (const m of HABITAT) {
      const a = atmos[m.id];
      const key = keyOf(a);
      let pending = seen.current.get(key);
      if (!pending) {
        pending = runPredict(a);
        seen.current.set(key, pending);
        pending.catch(() => seen.current.delete(key));
      }
      void pending.then((fresh) => {
        if (alive) setResults((prev) => (prev[m.id] === fresh ? prev : { ...prev, [m.id]: fresh }));
      });
    }
    return () => { alive = false; };
  }, [atmos, runPredict, keyOf]);

  const model = dashboard.model;
  const ratios = useMemo(() => {
    const out: Record<string, number> = {};
    for (const m of HABITAT) {
      const v = results[m.id]?.predicted_value;
      out[m.id] = v && baseline ? v / baseline : 1;
    }
    return out;
  }, [results, baseline]);

  const values = useMemo(() => {
    const out: Record<string, number> = {};
    for (const m of HABITAT) {
      const v = results[m.id]?.predicted_value;
      if (v !== undefined) out[m.id] = v;
    }
    return out;
  }, [results]);

  const current = HABITAT.find((m) => m.id === selected)!;

  return (
    <>
      <TopBar
        lang={lang}
        setLang={setLang}
        variant="program"
        actions={<button className="topbar-action" onClick={() => setShowSettings(true)}>{tr("aiSettings", lang)}</button>}
      />
      {showSettings && (
        <LlmSettings
          client={v1Client}
          lang={lang}
          onClose={() => setShowSettings(false)}
          onChanged={() => void refreshHealth()}
        />
      )}

      <main className="desk" id="habitat">
        <ModuleRank
          modules={HABITAT}
          ratios={ratios}
          values={values}
          units={model.units}
          selected={selected}
          onSelect={setSelected}
          lang={lang}
        />

        <div className="bench">
          <div className="bench-cond scrolly">
            <Conditions
              module={current}
              atmosphere={atmos[selected]}
              onChange={(next) => setAtmos((prev) => ({ ...prev, [selected]: next }))}
              onReset={() =>
                setAtmos((prev) => ({ ...prev, [selected]: { ...current.atmosphere } }))
              }
              result={results[selected] ?? null}
              ratio={ratios[selected] ?? 1}
              units={model.units}
              lang={lang}
              offline={!online}
            />
          </div>

          <div className="bench-room">
            <RoomView
              module={current}
              materials={mats[selected] ?? []}
              oxygenPct={atmos[selected].oxygen_level * 100}
              ratio={ratios[selected] ?? 1}
              lang={lang}
            />
          </div>

          <aside className="bench-ai scrolly" aria-label={tr("askNasa", lang)}>
            <Explain lang={lang} online={online} llm={health.lm_studio} onCheck={refreshHealth} />
          </aside>

          <div className="bench-tabs">
            <div className="tabs">
              {TABS.map((t) => (
                <button key={t} className={tab === t ? "on" : undefined} onClick={() => setTab(t)}>
                  {tr(`tab_${t}`, lang)}
                </button>
              ))}
            </div>

            <div className="tab-body scrolly">
              {tab === "time" && (
                <TimeToAct oxygenPct={atmos[selected].oxygen_level * 100} lang={lang} />
              )}
              {tab === "mats" && (
                <RoomMaterials
                  materials={mats[selected] ?? []}
                  oxygenPct={atmos[selected].oxygen_level * 100}
                  onChange={(next) => setMats((prev) => ({ ...prev, [selected]: next }))}
                  lang={lang}
                />
              )}
              {tab === "trust" && (
                <>
                  <Finding lang={lang} onJump={() => setSelected("eva")} />
                  <ModelQuality model={model} lang={lang} />
                  <MirCase lang={lang} />
                </>
              )}
              {tab === "next" && <NextExperiment lang={lang} />}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
