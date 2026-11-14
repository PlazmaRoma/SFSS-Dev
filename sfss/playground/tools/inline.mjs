import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

const dir = process.argv[2];
const out = process.argv[3];

let html = readFileSync(join(dir, process.argv[4] ?? "app.html"), "utf8");
const js = readFileSync(join(dir, "program.js"), "utf8");
const css = readFileSync(join(dir, "program.css"), "utf8");

html = html.replace(/<link[^>]+href="\.?\/?program\.css"[^>]*>/, `<style>\n${css}\n</style>`);
html = html.replace(/<script[^>]+src="\.?\/?program\.js"[^>]*><\/script>/, () => `<script type="module">\n${js}\n</script>`);
html = html.replace(/<link[^>]+rel="icon"[^>]*>/, "");

if (/src="\.?\/?program\.js"|href="\.?\/?program\.css"/.test(html)) {
  console.error("links were not inlined, check the build file names");
  process.exit(1);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
rmSync(dir, { recursive: true, force: true });
console.log(`→ ${out}  (${Math.round(Buffer.byteLength(html) / 1024)} KB)`);
