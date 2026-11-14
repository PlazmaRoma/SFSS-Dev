import { useEffect, useMemo, useRef, useState } from "react";
import type { Client } from "@sfss/client";
import { AIR, airParameters, COLUMNS, switchUnit, toParameters, warningText, type Conditions } from "./conditions";
import { csvRecords, toCsv } from "./csv";
import { errorText } from "./errors";
import { getLang, serviceText, tr } from "./lang";
import { SweepChart } from "./SweepChart";
import { load, save } from "./storage";
import type { BatchResult, DashboardInfo, PredictResult } from "./types";

const RECALC_DELAY_MS = 120;
const tableColumns = (): { key: string; label: string }[] => [
  { key: "oxygen_level", label: "O₂" },
  { key: "n2", label: "N₂" },
  { key: "co2", label: "CO₂" },
  { key: "he", label: "He" },
  { key: "pressure_mmhg", label: tr("mmHg") },
  { key: "d_initial_mm", label: tr("columnDroplet") },
];

interface TableRow {
  id: number;
  params: Record<string, string>;
  value: number | null;
  warnings: string[];
  error: string | null;
}

const fuelName = (params: Record<string, string>) =>
  params.fuel_heptane === "1" ? tr("featureHeptane") : params.fuel_methanol === "1" ? tr("featureMethanol") : "";

export function Calculator({ client, online, dashboard, print }: {
  client: Client;
  online: boolean;
  dashboard: DashboardInfo | null;
  print: (kind: "in" | "out" | "err", text: string) => number;
}) {
  const [conditions, setConditions] = useState<Conditions>(() => load("antifire.conditions", AIR));
  const [result, setResult] = useState<PredictResult | null>(null);
  const [baseline, setBaseline] = useState<number | null>(null);
  const [resultKey, setResultKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [rows, setRows] = useState<TableRow[]>(() => load("antifire.rows", []));
  const [importing, setImporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const nextRow = useRef(rows.reduce((max, row) => Math.max(max, row.id), 0) + 1);
  const sequence = useRef(0);

  const lang = getLang();
  const parsed = useMemo(() => toParameters(conditions), [conditions, lang]);
  const paramsKey = parsed.params ? JSON.stringify(parsed.params) : null;

  useEffect(() => save("antifire.conditions", conditions), [conditions]);
  useEffect(() => save("antifire.rows", rows), [rows]);

  useEffect(() => {
    if (!paramsKey || !online) return;
    const params = JSON.parse(paramsKey) as Record<string, number>;
    const mine = ++sequence.current;
    const timer = setTimeout(async () => {
      try {
        const [next, air] = await Promise.all([
          client.post<PredictResult>("/predict", { parameters: params }, 5000),
          client.post<PredictResult>("/predict", { parameters: airParameters(params) }, 5000, true),
        ]);
        if (mine !== sequence.current) return;
        setResult(next);
        setBaseline(air.predicted_value);
        setResultKey(paramsKey);
        setFailure(null);
      } catch (error) {
        if (mine === sequence.current) setFailure(errorText(error));
      }
    }, RECALC_DELAY_MS);
    return () => clearTimeout(timer);
  }, [client, online, paramsKey]);

  const set = (field: keyof Conditions, value: string) => setConditions((c) => ({ ...c, [field]: value }));

  const addToTable = () => {
    if (!parsed.params || !result || failure) return;
    const params = Object.fromEntries(Object.entries(parsed.params).map(([k, v]) => [k, String(v)]));
    setRows((all) => [
      ...all,
      { id: nextRow.current++, params, value: result.predicted_value, warnings: result.warnings, error: null },
    ]);
  };

  const importCsv = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      const batch = await client.send<BatchResult>(
        "POST", "/predict/batch",
        { body: text, contentType: "text/csv", ms: 120_000 },
        (res) => res.json() as Promise<BatchResult>,
      );
      const records = csvRecords(text);
      setRows((all) => [
        ...all,
        ...batch.rows.map((row, i) => ({
          id: nextRow.current++,
          params: records[i] ?? {},
          value: row.predicted_value,
          warnings: row.warnings,
          error: row.error,
        })),
      ]);
      print("out", tr("csvCounted", { name: file.name, done: batch.total - batch.failed, total: batch.total }));
    } catch (error) {
      print("err", `${file.name}: ${errorText(error)}`);
    } finally {
      setImporting(false);
    }
  };

  const tableCsv = () => toCsv([
    [...COLUMNS, "predicted_value", "warnings", "error"],
    ...rows.map((row) => [
      ...COLUMNS.map((column) => row.params[column] ?? ""),
      row.value === null ? "" : String(row.value),
      row.warnings.join("; "),
      row.error ?? "",
    ]),
  ]);

  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([tableCsv()], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "anti-fire-results.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    print("out", tr("csvSaved"));
  };

  const copyCsv = async () => {
    await navigator.clipboard.writeText(tableCsv());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const value = result?.predicted_value ?? null;
  const stale = Boolean(failure) || !parsed.params || !online || resultKey !== paramsKey;
  const units = tr("burnUnit");
  const columns = tableColumns();
  const mae = dashboard?.model.metrics.mae;

  return (
    <section className="calc" aria-label={tr("calc")}>
      <form
        className="conditions"
        onSubmit={(event) => {
          event.preventDefault();
          addToTable();
        }}
      >
        <h2>{tr("conditions")}</h2>
        <NumberField label="O₂" unit="%" value={conditions.o2} error={parsed.errors.o2} onChange={(v) => set("o2", v)} />
        <label className="field">
          <span>{tr("pressure")}</span>
          <span className="control">
            <input inputMode="decimal" value={conditions.pressure} aria-invalid={Boolean(parsed.errors.pressure)} onChange={(e) => set("pressure", e.target.value)} />
            <select
              aria-label={tr("pressureUnit")}
              value={conditions.unit}
              onChange={(e) => setConditions((c) => switchUnit(c, e.target.value as Conditions["unit"]))}
            >
              <option value="mmHg">{tr("mmHg")}</option>
              <option value="psi">psi</option>
            </select>
          </span>
          {parsed.errors.pressure && <em className="field-error">{parsed.errors.pressure}</em>}
        </label>
        <NumberField
          label="N₂" unit="%" value={conditions.n2} error={parsed.errors.n2}
          placeholder={parsed.nitrogenAuto === null ? "" : `${parsed.nitrogenAuto} ${tr("auto")}`}
          onChange={(v) => set("n2", v)}
        />
        <NumberField label="CO₂" unit="%" value={conditions.co2} error={parsed.errors.co2} onChange={(v) => set("co2", v)} />
        <NumberField label="He" unit="%" value={conditions.he} error={parsed.errors.he} onChange={(v) => set("he", v)} />
        <NumberField label={tr("droplet")} unit={tr("mm")} value={conditions.droplet} error={parsed.errors.droplet} onChange={(v) => set("droplet", v)} />
        <label className="field">
          <span>{tr("fuel")}</span>
          <span className="control">
            <select value={conditions.fuel} onChange={(e) => set("fuel", e.target.value)}>
              <option value="methanol">{tr("methanol")}</option>
              <option value="heptane">{tr("heptane")}</option>
            </select>
          </span>
        </label>
        {parsed.errors.mix && <em className="field-error">{parsed.errors.mix}</em>}
        <div className="form-actions">
          <button type="submit" disabled={stale || !result}>{tr("toTable")}</button>
          <button type="button" onClick={() => setConditions(AIR)}>{tr("air")}</button>
        </div>
      </form>

      <div className="result" aria-live="polite">
        <h2>{tr("burnRate")}</h2>
        {value === null ? (
          <p className="muted">{online ? tr("calculating") : tr("noConnection")}</p>
        ) : (
          <div className={stale ? "numbers stale" : "numbers"}>
            <p className="value">{value.toFixed(3)} <small>{units}</small></p>
            {baseline ? <p>×{(value / baseline).toFixed(2)} {tr("vsAir")}</p> : null}
            {mae !== undefined && <p className="muted">{tr("modelError")} ±{mae.toFixed(3)} {units}</p>}
          </div>
        )}
        {failure && <p className="notice bad">{failure}</p>}
        {result?.is_heuristic && <p className="notice warn">{tr("heuristic")}</p>}
        {result?.warnings.map((warning) => <p key={warning} className="notice warn">{warningText(warning)}</p>)}
        {result && result.chart_data.x.length > 0 && parsed.params && (
          <SweepChart
            x={result.chart_data.x}
            risk={result.chart_data.y}
            range={dashboard?.model.target_range ?? null}
            current={parsed.params.oxygen_level}
            currentValue={value}
          />
        )}
      </div>

      <div className="table-area">
        <div className="table-bar">
          <h2>{tr("table")}{rows.length ? ` · ${rows.length}` : ""}</h2>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void importCsv(file);
            }}
          />
          <button onClick={() => fileInput.current?.click()} disabled={!online || importing}>
            {importing ? tr("calculating") : tr("uploadCsv")}
          </button>
          <button onClick={exportCsv} disabled={!rows.length}>{tr("downloadCsv")}</button>
          <button onClick={() => void copyCsv()} disabled={!rows.length}>{copied ? tr("copiedDone") : tr("copy")}</button>
          <button onClick={() => setRows([])} disabled={!rows.length}>{tr("clear")}</button>
        </div>
        {rows.length === 0 ? (
          <p className="muted empty">{tr("tableEmpty")} <code>docs csv</code> {tr("inTerminal")}</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {columns.map((column) => <th key={column.key} className="num">{column.label}</th>)}
                  <th>{tr("columnFuel")}</th>
                  <th className="num">{units}</th>
                  <th>{tr("columnRemarks")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={row.error ? "row-error" : undefined}>
                    {columns.map((column) => <td key={column.key} className="num">{row.params[column.key] ?? ""}</td>)}
                    <td>{fuelName(row.params)}</td>
                    <td className="num strong">{row.value === null ? "" : row.value.toFixed(3)}</td>
                    <td className="remarks">{row.error ? serviceText(row.error) : row.warnings.map(warningText).join(" ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function NumberField({ label, unit, value, error, placeholder, onChange }: {
  label: string;
  unit: string;
  value: string;
  error?: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="control">
        <input
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          aria-invalid={Boolean(error)}
          onFocus={(event) => event.target.select()}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="unit">{unit}</span>
      </span>
      {error && <em className="field-error">{error}</em>}
    </label>
  );
}
