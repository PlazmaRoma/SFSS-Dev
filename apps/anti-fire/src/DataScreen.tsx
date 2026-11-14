import { useCallback, useEffect, useRef, useState } from "react";
import type { Client } from "@sfss/client";
import { reportTitle } from "@sfss/data/reports";
import { errorText } from "./errors";
import { tr, type TextKey } from "./lang";
import type { DashboardInfo, DocumentInfo } from "./types";

const FEATURE_NAMES: Record<string, TextKey> = {
  oxygen_level: "featureOxygen",
  d_initial_mm: "featureDroplet",
  he: "featureHe",
  co2: "featureCo2",
  pressure_mmhg: "featurePressure",
  n2: "featureN2",
  fuel_heptane: "featureHeptane",
  fuel_methanol: "featureMethanol",
};
const FUEL_NAMES: Record<string, TextKey> = { heptane: "featureHeptane", methanol: "featureMethanol" };
const END_NAMES: Record<string, TextKey> = {
  extinction: "endExtinction",
  completion: "endCompletion",
  disruption: "endDisruption",
};

const label = (names: Record<string, TextKey>, value: string | null) =>
  value !== null && names[value] ? tr(names[value]) : value;

function sourceText(source: string): string {
  const match = source.match(/report (\S+), pages (\S+)$/);
  return match ? tr("datasetSource", { report: match[1], pages: match[2].replace("-", "–") }) : source;
}

const fmt = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined ? "" : value.toFixed(digits);

export function DataScreen({ client, online, dashboard, print }: {
  client: Client;
  online: boolean;
  dashboard: DashboardInfo | null;
  print: (kind: "in" | "out" | "err", text: string) => number;
}) {
  const [documents, setDocuments] = useState<DocumentInfo[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const { documents: next } = await client.get<{ documents: DocumentInfo[] }>("/documents", 15_000);
      setDocuments(next);
      setFailure(null);
    } catch (error) {
      setFailure(errorText(error));
    }
  }, [client]);

  useEffect(() => {
    if (online) void refresh();
  }, [online, refresh]);

  const upload = async (file: File) => {
    setUploading(true);
    setFailure(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const document = await client.send<DocumentInfo>(
        "POST", "/documents", { body: form, ms: 900_000 }, (res) => res.json() as Promise<DocumentInfo>,
      );
      print("out", tr("added", { id: document.doc_id, chunks: document.chunks }));
      await refresh();
    } catch (error) {
      setFailure(`${file.name}: ${errorText(error)}`);
    } finally {
      setUploading(false);
    }
  };

  const model = dashboard?.model;
  const importance = Object.entries(model?.feature_importance ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <section className="data" aria-label={tr("dataScreen")}>
      <div className="data-block data-flex">
        <h2>{tr("experiments")} {dashboard?.dataset.name}{dashboard ? ` · ${dashboard.dataset.rows}` : ""}</h2>
        {dashboard && <p className="muted">{sourceText(dashboard.dataset.source)}</p>}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{tr("columnTest")}</th><th>{tr("columnFuel")}</th><th className="num">O₂</th><th className="num">{tr("mmHg")}</th>
                <th className="num">{tr("columnDroplet")}</th><th className="num">{tr("burnUnit")}</th><th className="num">{tr("columnExtinction")}</th><th>{tr("columnEnd")}</th>
              </tr>
            </thead>
            <tbody>
              {dashboard?.dataset.experiments.map((point, i) => (
                <tr key={`${point.test}-${i}`}>
                  <td>{point.test}</td>
                  <td>{label(FUEL_NAMES, point.fuel)}</td>
                  <td className="num">{fmt(point.oxygen_level)}</td>
                  <td className="num">{fmt(point.pressure_mmhg, 0)}</td>
                  <td className="num">{fmt(point.d_initial_mm)}</td>
                  <td className="num">{fmt(point.burn_rate_mm2s)}</td>
                  <td className="num">{fmt(point.d_extinction_mm)}</td>
                  <td>{label(END_NAMES, point.test_end)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="data-side">
        <div className="data-block">
          <h2>{tr("modelTitle")}</h2>
          {model ? (
            <>
              <p>{tr("modelAbout")}</p>
              <dl className="metrics">
                <dt>{tr("meanError")}</dt><dd>{fmt(model.metrics.mae, 3)} {tr("burnUnit")}</dd>
                <dt>{tr("constantError")}</dt><dd>{fmt(model.metrics.mae_baseline, 3)} {tr("burnUnit")}</dd>
                <dt>R²</dt><dd>{fmt(model.metrics.r2)}</dd>
                <dt>{tr("validation")}</dt><dd>{tr("validationValue", { folds: model.metrics.folds, rows: model.metrics.rows })}</dd>
              </dl>
              <h3>{tr("whatMatters")}</h3>
              <table>
                <tbody>
                  {importance.map(([feature, share]) => (
                    <tr key={feature}><td>{label(FEATURE_NAMES, feature)}</td><td className="num">{(share * 100).toFixed(0)} %</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="muted">{online ? tr("loading") : tr("noConnection")}</p>
          )}
        </div>

        <div className="data-block">
          <div className="table-bar">
            <h2>{tr("reports")}{documents ? ` · ${documents.length}` : ""}</h2>
            <input
              ref={fileInput}
              type="file"
              accept=".pdf,application/pdf"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void upload(file);
              }}
            />
            <button onClick={() => fileInput.current?.click()} disabled={!online || uploading}>
              {uploading ? tr("indexing") : tr("addPdf")}
            </button>
          </div>
          {failure && <p className="notice bad">{failure}</p>}
          <div>
            <table>
              <thead><tr><th>{tr("columnReport")}</th><th className="num">{tr("columnChunks")}</th><th className="num">{tr("columnMb")}</th></tr></thead>
              <tbody>
                {(documents ?? []).map((document) => (
                  <tr key={document.doc_id}>
                    <td title={document.filename}>{reportTitle(document.doc_id)}</td>
                    <td className="num">{document.chunks}</td>
                    <td className="num">{(document.size_bytes / 1048576).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
