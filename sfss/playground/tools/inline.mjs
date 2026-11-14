// Склеивает сборку программы в один HTML: скрипт и стили внутрь файла.
// Так программа открывается двойным кликом, без сервера и без npm.
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const out = process.argv[3];

// У Площадки страница app.html, у Anti-Fire — antifire.html
let html = readFileSync(join(dir, process.argv[4] ?? "app.html"), "utf8");
const js = readFileSync(join(dir, "program.js"), "utf8");
const css = readFileSync(join(dir, "program.css"), "utf8");

html = html.replace(/<link[^>]+href="\.?\/?program\.css"[^>]*>/, `<style>\n${css}\n</style>`);
html = html.replace(/<script[^>]+src="\.?\/?program\.js"[^>]*><\/script>/, () => `<script type="module">\n${js}\n</script>`);
// Иконка лежит отдельным файлом, а программа должна быть одним файлом
html = html.replace(/<link[^>]+rel="icon"[^>]*>/, "");

if (/src="\.?\/?program\.js"|href="\.?\/?program\.css"/.test(html)) {
  console.error("ссылки не вклеились, проверьте имена файлов сборки");
  process.exit(1);
}

writeFileSync(out, html);
rmSync(dir, { recursive: true, force: true });
console.log(`→ ${out}  (${Math.round(Buffer.byteLength(html) / 1024)} КБ)`);
