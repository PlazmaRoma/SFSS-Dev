/** Иконки модулей: тонкая линия, 24×24, тот же язык, что у разреза базы.
 *  Каждая читается по назначению отсека, а не по абстрактному символу. */
import type { ReactNode } from "react";

const PATHS: Record<string, ReactNode> = {
  // Койка: спинка, лежак, ножка
  crew: (
    <>
      <path d="M3 17h18M3 17v-4h11a3 3 0 0 1 3 3v1M3 13V8M21 17v-5" />
      <circle cx="8" cy="10" r="1.6" />
    </>
  ),
  // Колба
  lab: (
    <>
      <path d="M9 3h6M10.5 3v6.2L6 18.4A1.6 1.6 0 0 0 7.4 21h9.2a1.6 1.6 0 0 0 1.4-2.6L13.5 9.2V3" />
      <path d="M8 15h8" />
    </>
  ),
  // Кастрюля с паром
  galley: (
    <>
      <path d="M4 11h16v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-5Z" />
      <path d="M2 11h20M9 7c0-1.2 1-1.6 1-2.6S9 3 9 3M15 7c0-1.2 1-1.6 1-2.6S15 3 15 3" />
    </>
  ),
  // Шлем скафандра
  eva: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M7 10.5a5.2 5.2 0 0 1 8.6-1.6M20.5 12h1.5M2 12h1.5" />
    </>
  ),
  // Коробки
  storage: (
    <>
      <path d="M3 9h8v6H3zM13 9h8v6h-8zM8 15h8v6H8z" />
      <path d="M6 9V5h12v4" />
    </>
  ),
  // Росток в горшке
  greenhouse: (
    <>
      <path d="M12 21v-7M12 14c0-3 2.2-5 5-5 0 3-2.2 5-5 5ZM12 14c0-3-2.2-5-5-5 0 3 2.2 5 5 5Z" />
      <path d="M7 21h10" />
    </>
  ),
};

export function ModuleIcon({ id, size = 22 }: { id: string; size?: number }) {
  const d = PATHS[id];
  if (!d) return null;
  return (
    <svg
      className="mod-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {d}
    </svg>
  );
}
