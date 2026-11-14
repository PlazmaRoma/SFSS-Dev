type Invoke = (command: string, args?: Record<string, unknown>) => Promise<string>;
type Listen = (event: string, handler: (event: { payload: string }) => void) => Promise<() => void>;

declare global {
  interface Window { __TAURI__?: { core: { invoke: Invoke }; event?: { listen: Listen } } }
}

const OUTPUT_EVENT = "sfss-output";

export const SFSS_NOT_FOUND = "sfss-not-found";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

export function localPort(base: string): number | null {
  try {
    const url = new URL(base);
    if (!LOCAL_HOSTS.includes(url.hostname)) return null;
    return Number(url.port || (url.protocol === "https:" ? 443 : 80));
  } catch {
    return null;
  }
}

const invoke = (): Invoke | undefined =>
  typeof window === "undefined" ? undefined : window.__TAURI__?.core.invoke;

export const canControl = (base: string) => invoke() !== undefined && localPort(base) !== null;

export async function controlService(
  action: "start" | "stop", base: string, onLine?: (line: string) => void,
): Promise<string> {
  const run = invoke();
  const port = localPort(base);
  if (!run || port === null) throw new Error("no control");
  const listen = window.__TAURI__?.event?.listen;
  const stop = onLine && listen ? await listen(OUTPUT_EVENT, (event) => onLine(event.payload)).catch(() => null) : null;
  try {
    return await (action === "start" ? run("sfss_start", { port }) : run("sfss_stop"));
  } finally {
    stop?.();
  }
}
