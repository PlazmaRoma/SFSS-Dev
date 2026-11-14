import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
