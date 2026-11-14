import { useCallback, useEffect, useRef, useState } from "react";
import type { Lang } from "../shared/types";
import { tr } from "../shared/i18n";
import demoSrc from "../shared/media/demo.mp4";
import posterSrc from "../shared/media/demo-poster.jpg";

const mmss = (s: number) => {
  if (!isFinite(s)) return "00:00";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
};

export function DemoPlayer({ lang }: { lang: Lang }) {
  const wrap = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [ok, setOk] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);

  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => setOk(false));
    else v.pause();
  }, []);

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = video.current;
    if (!v || !dur) return;
    const r = e.currentTarget.getBoundingClientRect();
    v.currentTime = ((e.clientX - r.left) / r.width) * dur;
  };

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const onT = () => setTime(v.currentTime);
    const onD = () => setDur(v.duration);
    const onP = () => setPlaying(!v.paused);
    v.addEventListener("timeupdate", onT);
    v.addEventListener("loadedmetadata", onD);
    v.addEventListener("play", onP);
    v.addEventListener("pause", onP);
    return () => {
      v.removeEventListener("timeupdate", onT);
      v.removeEventListener("loadedmetadata", onD);
      v.removeEventListener("play", onP);
      v.removeEventListener("pause", onP);
    };
  }, [ok]);

  if (!ok) {
    return (
      <figure className="player empty">
        <p>{tr("demoMissing", lang)}</p>
      </figure>
    );
  }

  const pct = dur ? (time / dur) * 100 : 0;

  return (
    <figure className="player" ref={wrap}>
      <video
        ref={video}
        playsInline
        preload="metadata"
        poster={posterSrc}
        onClick={toggle}
        onError={() => setOk(false)}
      >
        <source src={demoSrc} type="video/mp4" />
      </video>

      <div className="player-bar">
        <button onClick={toggle} aria-label={playing ? tr("pause", lang) : tr("play", lang)}>
          {playing ? (
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
              <path d="M7 4.5v15l13-7.5z" />
            </svg>
          )}
        </button>

        <span className="player-time">{mmss(time)} | {mmss(dur)}</span>

        <div className="player-track" onClick={seek} role="presentation">
          <i style={{ width: `${pct}%` }} />
        </div>

        <button
          onClick={() => {
            const v = video.current;
            if (!v) return;
            v.muted = !v.muted;
            setMuted(v.muted);
          }}
          aria-label={tr("sound", lang)}
        >
          {muted ? (
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
              <path d="M17 9l4 6M21 9l-4 6" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
              <path d="M17 9.5a3.5 3.5 0 0 1 0 5M19.5 7a7 7 0 0 1 0 10" />
            </svg>
          )}
        </button>

        <button
          onClick={() => {
            if (document.fullscreenElement) document.exitFullscreen();
            else wrap.current?.requestFullscreen?.();
          }}
          aria-label={tr("fullscreen", lang)}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
        </button>
      </div>
    </figure>
  );
}
