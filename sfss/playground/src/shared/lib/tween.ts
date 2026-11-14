import { useEffect, useRef, useState } from "react";

export function useTween(target: number, ms = 420) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  const raf = useRef(0);
  const [still] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    if (still) return;
    const a = from.current;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const cur = a + (target - a) * e;
      setV(cur);
      from.current = cur;
      if (p < 1) raf.current = requestAnimationFrame(step);
      else from.current = target;
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms, still]);

  return still ? target : v;
}
