import { useCallback, useEffect, useState } from "react";
import type { Client } from "@sfss/client";
import { reportTitle } from "@sfss/data/reports";
import { errorText } from "./errors";
import { tr } from "./lang";

export interface ViewerState { docId: string; page: number; url: string | null; error: string | null }

export function usePageViewer(client: Client) {
  const [viewer, setViewer] = useState<ViewerState | null>(null);

  useEffect(() => () => { if (viewer?.url) URL.revokeObjectURL(viewer.url); }, [viewer?.url]);

  const open = useCallback(async (docId: string, page: number) => {
    setViewer({ docId, page, url: null, error: null });
    try {
      const blob = await client.send(
        "GET", `/documents/${encodeURIComponent(docId)}/pages/${page}`,
        { ms: 30_000 },
        (res) => res.blob(),
      );
      setViewer({ docId, page, url: URL.createObjectURL(blob), error: null });
    } catch (error) {
      setViewer({ docId, page, url: null, error: errorText(error) });
    }
  }, [client]);

  const close = useCallback(() => setViewer(null), []);
  return { viewer, open, close };
}

export function PageViewer({ viewer, onClose }: { viewer: ViewerState; onClose: () => void }) {
  const title = `${reportTitle(viewer.docId)}, ${tr("page")} ${viewer.page}`;
  return (
    <aside className="viewer" aria-label={tr("reportPage")}>
      <div className="viewer-bar">
        <span title={title}>{title}</span>
        {viewer.url && <a href={viewer.url} target="_blank" rel="noreferrer">{tr("openSeparately")}</a>}
        <button onClick={onClose}>{tr("close")}</button>
      </div>
      {viewer.error && <p className="notice bad">{viewer.error}</p>}
      {!viewer.url && !viewer.error && <p className="muted">{tr("openingPage")}</p>}
      {viewer.url && <iframe title={title} src={viewer.url} />}
    </aside>
  );
}
