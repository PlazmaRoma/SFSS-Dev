import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Две сборки из одного кода: лендинг (index.html) и сама программа
// (app.html). Компоненты и данные общие, дублировать их незачем.
//
// base: "./" — программа запускается из файла или из любой папки на диске,
// абсолютные пути к ассетам там не работают.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    rollupOptions: {
      input: {
        landing: resolve(__dirname, "index.html"),
        program: resolve(__dirname, "app.html"),
      },
    },
  },
});
