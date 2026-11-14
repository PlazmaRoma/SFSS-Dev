import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Сборка программы в один файл.
 *
 *  Программу скачивают и открывают двойным кликом, поэтому ей нельзя
 *  зависеть ни от сервера, ни от npm. Отсюда три настройки: один чанк
 *  вместо разбиения, все картинки в data-URI и относительные пути.
 */
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist-program",
    emptyOutDir: true,
    // Всё в base64: иначе рядом с HTML пришлось бы таскать папку assets
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(__dirname, "app.html"),
      output: {
        inlineDynamicImports: true,
        entryFileNames: "program.js",
        assetFileNames: "program.[ext]",
      },
    },
  },
});
