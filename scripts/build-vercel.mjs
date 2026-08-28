import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "public");
const files = ["index.html", "locacoes.html", "locacoes.js", "styles.css", "data.js", "quotation-tool.js", "quotation-tool.css", "works.js", "app.js", "work-report.js", "work-report.css", "web-demo.js", "works-data.json", "budget-dr-clovis.json"];
const directories = ["comparativo-cli-inova", "erp-compras"];
files.push('area-report.js', 'area-report.css');

await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });
for (const file of files) await fs.copyFile(path.join(root, file), path.join(output, file));
for (const directory of directories) await fs.cp(path.join(root, directory), path.join(output, directory), { recursive: true });
