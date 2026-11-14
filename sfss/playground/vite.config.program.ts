import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist-program",
    emptyOutDir: true,
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
