import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Anti-Fire собирается в один HTML, как и Площадка: окно Tauri получает один файл,
 *  без внешних шрифтов и отдельных ассетов.
 *
 *  Общий с Площадкой код (клиент API, типы, окно настроек AI) лежит один раз, в
 *  sfss/playground/src/shared, и подключается как @sfss. React один на обе программы:
 *  npm workspaces поднимают его в корневой node_modules, dedupe страхует. */
const SHARED = resolve(__dirname, "../../sfss/playground/src/shared");

export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: { "@sfss": SHARED },
    dedupe: ["react", "react-dom"],
  },
  server: { fs: { allow: [resolve(__dirname, "../.."), SHARED] } },
  build: {
    outDir: "dist-build",
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(__dirname, "index.html"),
      output: {
        inlineDynamicImports: true,
        entryFileNames: "program.js",
        assetFileNames: "program.[ext]",
      },
    },
  },
});
