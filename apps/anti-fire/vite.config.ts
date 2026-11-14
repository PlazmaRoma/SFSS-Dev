import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
