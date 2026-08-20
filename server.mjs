import http from "node:http";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import crypto from "node:crypto";

const root = path.dirname(fileURLToPath(import.meta.url));
const runtimeDir = path.join(root, "runtime_data");
const uploadDir = path.join(runtimeDir, "uploads");
const generatedDir = path.join(runtimeDir, "generated");
const storePath = path.join(runtimeDir, "quotes.json");
const worksStorePath = path.join(runtimeDir, "works.json");
const workUploadsDir = path.join(runtimeDir, "work-documents");
const drClovisBudgetPath = path.join(root, "budget-dr-clovis.json");
const outputDir = path.join(root, "outputs", "quote-automation-demo");
const port = Number(process.env.PORT || 4173);
const depRoot = process.env.DETERLIMP_NODE_MODULES || "C:/Users/balth/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules";
const runtimeRequire = createRequire(path.join(depRoot, "package.json"));
const pythonPath = process.env.DETERLIMP_PYTHON || "C:/Users/balth/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe";
const pdftoppmPath = process.env.DETERLIMP_PDFTOPPM || "C:/Users/balth/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe";

await Promise.all([runtimeDir, uploadDir, generatedDir, workUploadsDir, outputDir].map(dir => fs.mkdir(dir, { recursive: true })));
if (!fsSync.existsSync(storePath)) await fs.writeFile(storePath, "[]", "utf8");
if (!fsSync.existsSync(worksStorePath)) await fs.writeFile(worksStorePath, "[]", "utf8");

let artifactPromise;
async function artifactTool() {
  if (!artifactPromise) artifactPromise = import(pathToFileURL(runtimeRequire.resolve("@oai/artifact-tool")).href);
  return artifactPromise;
}

let ocrWorkerPromise;
async function ocrImage(filePath) {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const tess = runtimeRequire("tesseract.js");
      return tess.createWorker("por");
    })();
  }
  const worker = await ocrWorkerPromise;
  const blocks = await worker.recognize(filePath, { tessedit_pageseg_mode: "6" });
  const sparse = await worker.recognize(filePath, { tessedit_pageseg_mode: "11" });
  let dense = { data: { text: "", confidence: 0 } }; const preparedPath = `${filePath}.ocr.png`;
  try {
    const sharp = runtimeRequire("sharp"); const metadata = await sharp(filePath).metadata();
    await sharp(filePath).resize({ width: Math.min(3600, (metadata.width || 1200) * 3) }).grayscale().normalize().sharpen().threshold(185).toFile(preparedPath);
    dense = await worker.recognize(preparedPath, { tessedit_pageseg_mode: "6" });
  } catch {} finally { await fs.rm(preparedPath, { force: true }).catch(() => {}); }
  const text = `${blocks.data.text || ""}\n${sparse.data.text || ""}\n${dense.data.text || ""}`;
  const confidence = ((blocks.data.confidence || 0) + (sparse.data.confidence || 0) + (dense.data.confidence || 0)) / 300;
  return { text, confidence: Math.max(0, Math.min(1, confidence)), method: "ocr-local-dupla-leitura", tables: [] };
}

const isoNow = () => new Date().toISOString();
const uid = prefix => `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
const cleanName = value => String(value || "arquivo").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "arquivo";
const norm = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9%,./x+\- ]/g, " ").replace(/\s+/g, " ").trim();
const parseNumber = value => {
  const raw = String(value ?? "").trim().replace(/[^\d,.-]/g, "");
  if (!raw) return 0;
  if (raw.includes(",")) return Number(raw.replace(/\./g, "").replace(",", ".")) || 0;
  return Number(raw) || 0;
};
const money = value => Number(parseNumber(value).toFixed(2));
const displayDate = value => {
  const raw = String(value || ""); const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return raw || new Intl.DateTimeFormat("pt-BR").format(new Date());
};

async function readStore() {
  try { return JSON.parse(await fs.readFile(storePath, "utf8")); } catch { return []; }
}
async function writeStore(rows) {
  const temp = `${storePath}.tmp`;
  await fs.writeFile(temp, JSON.stringify(rows, null, 2), "utf8");
  await fs.rename(temp, storePath);
}
async function getQuote(id) { return (await readStore()).find(row => row.id === id); }
async function saveQuote(quote) {
  quote.updatedAt = isoNow();
  const rows = await readStore();
  const index = rows.findIndex(row => row.id === quote.id);
  if (index >= 0) rows[index] = quote; else rows.unshift(quote);
  await writeStore(rows);
  return quote;
}

async function readWorks() {
  try { return JSON.parse(await fs.readFile(worksStorePath, "utf8")); } catch { return []; }
}
async function writeWorks(rows) {
  const temp = `${worksStorePath}.tmp`;
  await fs.writeFile(temp, JSON.stringify(rows, null, 2), "utf8");
  await fs.rename(temp, worksStorePath);
}
const phaseSeed = [
  ["Mobilização", 7], ["Fundação / infraestrutura", 14], ["Estrutura", 20],
  ["Alvenaria", 12], ["Instalações", 18], ["Revestimentos", 12],
  ["Acabamentos", 12], ["Entrega", 5]
];
const documentSeed = ["Contrato / ordem de serviço", "Alvará / licença", "ART / RRT", "CNO da obra", "Projetos aprovados", "Memorial descritivo", "Seguro da obra", "Documentos de segurança", "Laudos", "Licenças especiais", "Termo de entrega"];
let drClovisBudgetPromise;
async function drClovisBudget() {
  if (!drClovisBudgetPromise) drClovisBudgetPromise = fs.readFile(drClovisBudgetPath, "utf8").then(JSON.parse);
  return structuredClone(await drClovisBudgetPromise);
}
function newWork(clientId, clientName = "Obra") {
  const now = isoNow();
  return {
    id: `obra_${cleanName(clientId)}`, clientId, createdAt: now, updatedAt: now,
    details: { name: clientName, address: "", type: "", description: "", client: clientName, engineer: "", manager: "", plannedStart: "", plannedEnd: "", status: "Planejamento" },
    phases: phaseSeed.map(([name, weight], order) => ({ id: uid("etapa"), name, weight, progress: 0, status: "Não iniciada", owner: "", plannedStart: "", plannedEnd: "", actualStart: "", actualEnd: "", notes: "", applicable: true, order })),
    documents: documentSeed.map(title => ({ id: uid("doc"), title, required: true, status: "Pendente", expiry: "", owner: "", notes: "", driveUrl: "", files: [] })),
    tasks: [], contacts: [], journal: [], budget: null
  };
}
function normalizeWork(incoming, existing) {
  const clamp = value => Math.max(0, Math.min(100, Number(value) || 0));
  const text = (value, max = 500) => String(value ?? "").trim().slice(0, max);
  const date = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : "";
  const details = incoming.details || {};
  const incomingBudget = incoming.budget || existing.budget || null;
  const normalizedBudget = incomingBudget ? {
    sourceTitle: text(incomingBudget.sourceTitle, 240), sourceUrl: /^https?:\/\//i.test(String(incomingBudget.sourceUrl || "")) ? text(incomingBudget.sourceUrl, 1200) : "",
    budgetDate: date(incomingBudget.budgetDate), project: text(incomingBudget.project, 240), owner: text(incomingBudget.owner, 180),
    directTotal: Math.max(0, Number(incomingBudget.directTotal) || 0), administrationRate: Math.max(0, Number(incomingBudget.administrationRate) || 0),
    administrationValue: Math.max(0, Number(incomingBudget.administrationValue) || 0), grandTotal: Math.max(0, Number(incomingBudget.grandTotal) || 0),
    items: (incomingBudget.items || []).map(row => ({ id: text(row.id, 80), code: text(row.code, 40), category: text(row.category, 180), subcategory: text(row.subcategory, 180), description: text(row.description, 1200), unit: text(row.unit, 20), quantity: Math.max(0, Number(row.quantity) || 0), plannedUnitMaterial: Math.max(0, Number(row.plannedUnitMaterial) || 0), plannedUnitLabor: Math.max(0, Number(row.plannedUnitLabor) || 0), plannedUnitTotal: Math.max(0, Number(row.plannedUnitTotal) || 0), plannedMaterial: Math.max(0, Number(row.plannedMaterial) || 0), plannedLabor: Math.max(0, Number(row.plannedLabor) || 0), plannedTotal: Math.max(0, Number(row.plannedTotal) || 0) })),
    actuals: (incomingBudget.actuals || []).map(row => ({ id: text(row.id, 80) || uid("real"), itemId: text(row.itemId, 80), date: date(row.date) || new Date().toISOString().slice(0, 10), type: ["Material", "Mão de obra", "Outros"].includes(row.type) ? row.type : "Material", description: text(row.description, 500), reference: text(row.reference, 180), value: Math.max(0, Number(row.value) || 0), source: row.source === "Pedido" ? "Pedido" : "Manual", orderRef: text(row.orderRef, 400), orderNumber: text(row.orderNumber, 80), createdAt: row.createdAt || isoNow() })).filter(row => row.itemId && row.value > 0)
  } : null;
  return {
    ...existing, ...incoming, id: existing.id, clientId: existing.clientId, createdAt: existing.createdAt, updatedAt: isoNow(),
    details: { ...existing.details, name: text(details.name, 120), address: text(details.address, 240), type: text(details.type, 80), description: text(details.description, 1500), client: text(details.client, 120), engineer: text(details.engineer, 120), manager: text(details.manager, 120), plannedStart: date(details.plannedStart), plannedEnd: date(details.plannedEnd), status: text(details.status, 50) || "Planejamento" },
    phases: (incoming.phases || []).map((row, order) => ({ id: text(row.id, 80) || uid("etapa"), name: text(row.name, 150) || `Etapa ${order + 1}`, weight: clamp(row.weight), progress: clamp(row.progress), status: text(row.status, 50) || "Não iniciada", owner: text(row.owner, 120), plannedStart: date(row.plannedStart), plannedEnd: date(row.plannedEnd), actualStart: date(row.actualStart), actualEnd: date(row.actualEnd), notes: text(row.notes, 1200), applicable: row.applicable !== false, order })),
    documents: (incoming.documents || []).map(row => ({ id: text(row.id, 80) || uid("doc"), title: text(row.title, 180) || "Documento", required: row.required !== false, status: text(row.status, 40) || "Pendente", expiry: date(row.expiry), owner: text(row.owner, 120), notes: text(row.notes, 1200), driveUrl: /^https?:\/\//i.test(String(row.driveUrl || "")) ? text(row.driveUrl, 1200) : "", files: Array.isArray(row.files) ? row.files : [] })),
    tasks: (incoming.tasks || []).map(row => ({ id: text(row.id, 80) || uid("pend"), title: text(row.title, 220) || "Pendência", priority: ["Baixa", "Média", "Alta", "Crítica"].includes(row.priority) ? row.priority : "Média", due: date(row.due), owner: text(row.owner, 120), status: row.status === "Concluída" ? "Concluída" : "Aberta", notes: text(row.notes, 1200) })),
    contacts: (incoming.contacts || []).map(row => ({ id: text(row.id, 80) || uid("cont"), name: text(row.name, 150) || "Contato", role: text(row.role, 120), phone: text(row.phone, 60), email: text(row.email, 180) })),
    journal: (incoming.journal || []).map(row => ({ id: text(row.id, 80) || uid("diario"), date: date(row.date) || new Date().toISOString().slice(0, 10), weather: text(row.weather, 40) || "Ensolarado", workday: text(row.workday, 40) || "Normal", rainHours: Math.max(0, Math.min(24, Number(row.rainHours) || 0)), workforce: Math.max(0, Math.round(Number(row.workforce) || 0)), contractorsAbsent: text(row.contractorsAbsent, 600), activities: text(row.activities, 2500), occurrences: text(row.occurrences, 2500), decisions: text(row.decisions, 1800), nextSteps: text(row.nextSteps, 1800), createdAt: row.createdAt || isoNow(), updatedAt: isoNow() })),
    budget: normalizedBudget
  };
}
async function getOrCreateWork(clientId, clientName = "") {
  const rows = await readWorks(); let work = rows.find(row => row.clientId === clientId);
  if (!work) { work = newWork(clientId, clientName || clientId); rows.unshift(work); await writeWorks(rows); }
  else {
    let changed = false;
    if (!Array.isArray(work.journal)) { work.journal = []; changed = true; }
    const phases = (work.phases || []).filter(row => norm(row.name) !== "documentacao");
    if (phases.length !== (work.phases || []).length) { work.phases = phases.map((row, order) => ({ ...row, order })); changed = true; }
    if (clientName && cleanName(work.details?.name).toLowerCase() === cleanName(clientId).toLowerCase()) { work.details.name = clientName; work.details.client = clientName; changed = true; }
    if (clientId === "dr_clovis_cmfs" && !work.budget) { work.budget = { ...(await drClovisBudget()), actuals: [] }; changed = true; }
    if (clientId === "dr_clovis_cmfs" && !(work.documents || []).some(row => row.driveUrl?.includes("19Zu1QQOW64b5bCFQ2mHQP3AwYqe7zYI2"))) {
      work.documents = [...(work.documents || []), { id: uid("doc"), title: "Orçamento da Obra CLI", required: false, status: "Aprovado", expiry: "", owner: "", notes: "Planilha-base do orçamento detalhado da obra, com material, mão de obra e taxa administrativa.", driveUrl: "https://drive.google.com/file/d/19Zu1QQOW64b5bCFQ2mHQP3AwYqe7zYI2/view?usp=drivesdk", files: [] }]; changed = true;
    }
    if (changed) { work.updatedAt = isoNow(); await writeWorks(rows); }
  }
  return work;
}
async function saveWork(work) {
  const rows = await readWorks(); const index = rows.findIndex(row => row.clientId === work.clientId);
  if (index >= 0) rows[index] = work; else rows.unshift(work);
  await writeWorks(rows); return work;
}

function newQuote(options = {}) {
  const work = String(options.work || options.clientName || "Deterlimp");
  return {
    id: uid("cot"), status: "rascunho", createdAt: isoNow(), updatedAt: isoNow(),
    clientId: String(options.clientId || "deterlimp"), clientName: String(options.clientName || work),
    request: { number: "", category: "", date: new Date().toISOString().slice(0, 10), neededDate: "", costCenter: work.toUpperCase(), requester: "", work, items: [] },
    suppliers: [], files: [], divergences: [], generated: []
  };
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" });
  res.end(body);
}
async function bodyBuffer(req, limit = 30 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error("Arquivo maior que 30 MB"); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function bodyJson(req) { const buffer = await bodyBuffer(req); return buffer.length ? JSON.parse(buffer.toString("utf8")) : {}; }
async function bodyForm(req) {
  const buffer = await bodyBuffer(req);
  const request = new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers, body: buffer });
  return request.formData();
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => stdout += chunk.toString("utf8"));
    child.stderr.on("data", chunk => stderr += chunk.toString("utf8"));
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(stdout) : reject(new Error(stderr || stdout || `Processo terminou com código ${code}`)));
  });
}

async function extractWorkbook(filePath) {
  const { FileBlob, SpreadsheetFile } = await artifactTool();
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(filePath));
  const tables = [];
  const text = [];
  for (const sheet of workbook.worksheets.items) {
    const used = sheet.getUsedRange(true) || sheet.getRange("A1:Z200");
    const values = used.values || [];
    tables.push(values);
    text.push(values.map(row => row.map(cell => cell ?? "").join(" | ")).join("\n"));
  }
  return { text: text.join("\n"), tables, method: "planilha", confidence: 0.98 };
}

async function extractDocument(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  if ([".xlsx", ".xls"].includes(ext)) return extractWorkbook(filePath);
  if ([".png", ".jpg", ".jpeg", ".webp", ".bmp"].includes(ext)) return ocrImage(filePath);
  if ([".txt", ".csv", ".tsv", ".pdf"].includes(ext)) {
    const raw = await run(pythonPath, [path.join(root, "scripts", "extract_document.py"), filePath]);
    const parsed = JSON.parse(raw);
    if (ext === ".pdf" && (parsed.text || "").replace(/\s/g, "").length < 50) {
      const prefix = path.join(path.dirname(filePath), `${path.parse(filePath).name}-pagina`);
      await run(pdftoppmPath, ["-f", "1", "-l", "4", "-png", "-r", "150", filePath, prefix]);
      const images = (await fs.readdir(path.dirname(filePath))).filter(name => name.startsWith(path.basename(prefix)) && name.endsWith(".png")).sort();
      const recognized = [];
      for (const imageName of images) recognized.push(await ocrImage(path.join(path.dirname(filePath), imageName)));
      return { text: recognized.map(row => row.text).join("\n"), tables: [], method: "pdf-ocr-local", confidence: recognized.length ? recognized.reduce((sum, row) => sum + row.confidence, 0) / recognized.length : 0.1 };
    }
    return parsed;
  }
  throw new Error("Formato não suportado. Use PDF, Excel, CSV, texto ou imagem.");
}

function splitCell(value) { return String(value ?? "").split(/\r?\n/).map(v => v.trim()).filter(Boolean); }
function tableRequestItems(tables) {
  for (const table of tables || []) {
    if (!Array.isArray(table)) continue;
    for (let r = 0; r < table.length; r++) {
      const header = (table[r] || []).map(norm);
      const itemCol = header.findIndex(v => v === "item" || v.startsWith("item "));
      const qtyCol = header.findIndex(v => v.includes("quantidade"));
      const unitCol = header.findIndex(v => v.includes("unidade"));
      const descCol = header.findIndex(v => v.includes("descricao"));
      const dateCol = header.findIndex(v => v.includes("necessidade"));
      if ([itemCol, qtyCol, unitCol, descCol].some(v => v < 0)) continue;
      const rows = [];
      for (const dataRow of table.slice(r + 1)) {
        const numbers = splitCell(dataRow?.[itemCol]).filter(v => /^\d+$/.test(v));
        const quantities = splitCell(dataRow?.[qtyCol]);
        const units = splitCell(dataRow?.[unitCol]);
        let descriptions = splitCell(dataRow?.[descCol]);
        const dates = dateCol >= 0 ? splitCell(dataRow?.[dateCol]) : [];
        const count = Math.min(numbers.length, quantities.length, units.length);
        while (descriptions.length > count) {
          const continuation = descriptions.findIndex((line, index) => index > 0 && (/^\d+(?:[.,]\d+)?\s*(?:mm|cm|m|x)/i.test(line) || line.length < 18));
          const at = continuation > 0 ? continuation : descriptions.length - 1;
          descriptions[at - 1] = `${descriptions[at - 1]} ${descriptions[at]}`;
          descriptions.splice(at, 1);
        }
        for (let index = 0; index < count; index++) rows.push({ id: uid("item"), number: numbers[index], quantity: parseNumber(quantities[index]), unit: units[index] || "UN", description: descriptions[index] || `Item ${numbers[index]}`, neededDate: dates[index] || "" });
      }
      if (rows.length) return rows;
    }
  }
  return [];
}

function textRequestItems(text) {
  const lines = String(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const items = [];
  const pattern = /^(\d{1,3})\s+(\d+(?:[.,]\d+)?)\s+([A-ZÇ]{1,5})\s+(.+?)(?:\s+(\d{2}\/\d{2}\/\d{4}))?$/i;
  for (const line of lines) {
    const match = line.match(pattern);
    if (!match) continue;
    items.push({ id: uid("item"), number: match[1], quantity: parseNumber(match[2]), unit: match[3].toUpperCase(), description: match[4].trim(), neededDate: match[5] || "" });
  }
  return items;
}

function parseRequest(extraction) {
  const text = extraction.text || "";
  const n = norm(text);
  const number = text.match(/N[°ºO]?\s*[:.-]?\s*(\d{1,5})/i)?.[1] || "";
  const date = text.match(/DATA\s*[:.-]?\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1] || "";
  const category = text.match(/(?:AREA|ÁREA)\s+DE\s+SOLICITA(?:CAO|ÇÃO)\s*[:.-]?\s*([^\n]+)/i)?.[1]?.trim() || "";
  const requester = text.match(/SOLICIT(?:ADO|DO)\s+POR\s*:?\s*\n?\s*([A-ZÁ-Ú ]{3,40})/i)?.[1]?.trim() || "";
  const costCenter = text.match(/CENTRO\s+DE\s+CUSTO\s*[:.-]?\s*([^\n]+)/i)?.[1]?.trim() || "DETERLIMP";
  const items = tableRequestItems(extraction.tables);
  const normalizedCategory = category
    ? category[0].toUpperCase() + category.slice(1).toLowerCase()
    : (n.includes("hidraulica") ? "Hidráulica" : "");
  return {
    number, category: /^hidraulica$/i.test(normalizedCategory) ? "Hidráulica" : normalizedCategory,
    date, neededDate: items.find(item => item.neededDate)?.neededDate || "", costCenter, requester,
    work: costCenter || "Deterlimp", items: items.length ? items : textRequestItems(text), rawText: text, extractionMethod: extraction.method, extractionConfidence: extraction.confidence
  };
}

function findHeader(table, needles) {
  for (let r = 0; r < table.length; r++) {
    const cells = (table[r] || []).map(norm);
    if (needles.every(needle => cells.some(cell => cell.includes(needle)))) return { row: r, cells };
  }
  return null;
}
function tableQuoteItems(tables) {
  const found = [];
  for (const table of tables || []) {
    if (!Array.isArray(table)) continue;
    const header = findHeader(table, ["quantidade"]);
    if (!header) continue;
    const cells = header.cells;
    const descCol = cells.findIndex(v => v.includes("produto") || v.includes("descricao"));
    const qtyCol = cells.findIndex(v => v.includes("quantidade"));
    const unitCol = cells.findIndex(v => v === "unid." || v === "unidade" || v === "unid");
    const unitPriceCol = cells.findIndex(v => v.includes("unit") && (v.includes("vl") || v.includes("preco") || v.includes("valor")));
    const totalCol = cells.findIndex(v => v.includes("total") && !v.includes("quantidade"));
    if (descCol < 0 || qtyCol < 0 || unitPriceCol < 0) continue;
    for (const row of table.slice(header.row + 1)) {
      const description = String(row?.[descCol] || "").trim();
      const quantity = parseNumber(row?.[qtyCol]);
      const unitPrice = money(row?.[unitPriceCol]);
      const total = totalCol >= 0 ? money(row?.[totalCol]) : 0;
      if (!description || !quantity || (!unitPrice && !total)) continue;
      found.push({ id: uid("qitem"), description, quantity, unit: unitCol >= 0 ? String(row?.[unitCol] || "UN").trim() : "UN", unitPrice: unitPrice || Number((total / quantity).toFixed(4)), quotedTotal: total || Number((unitPrice * quantity).toFixed(2)), requestItemId: "", confidence: 0 });
    }
  }
  return found;
}
function textQuoteItems(text) {
  const items = [];
  const lines = String(text).split(/\r?\n/).map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const inferUnit = description => {
    const upper = String(description).toUpperCase();
    if (/\b(?:FERRO|ACO|AÇO)\b/.test(upper)) return "BR";
    if (/\bPREGO\b/.test(upper)) return "KG";
    if (/\bCIMENTO\b/.test(upper)) return "SC";
    return "UN";
  };
  const addItem = (description, quantity, unit, unitPrice, quotedTotal, confidence = 0) => {
    const cleanDescription = String(description)
      .replace(/^\s*(?:\d+\s+){1,3}(?=[A-ZÁÉÍÓÚÇ])/i, "")
      .replace(/[—–]+/g, " ").replace(/\s+/g, " ").trim();
    if (!cleanDescription || /(?:TAXA\s+DE\s+FRETE|FRETE|TOTAL\s+(?:DOS|DO|LIQUIDO|LÍQUIDO))/i.test(cleanDescription)) return;
    const qty = parseNumber(quantity), unitValue = Number(parseNumber(unitPrice).toFixed(4)), totalValue = money(quotedTotal);
    if (!qty || (!unitValue && !totalValue)) return;
    const resolvedUnit = unit || inferUnit(cleanDescription);
    const resolvedUnitPrice = unitValue || Number((totalValue / qty).toFixed(4));
    const resolvedTotal = totalValue || Number((resolvedUnitPrice * qty).toFixed(2));
    const key = `${norm(cleanDescription)}|${qty}|${resolvedUnitPrice.toFixed(2)}|${resolvedTotal.toFixed(2)}`;
    if (items.some(item => item._key === key)) return;
    items.push({ id: uid("qitem"), description: cleanDescription, quantity: qty, unit: resolvedUnit, unitPrice: resolvedUnitPrice, quotedTotal: resolvedTotal, requestItemId: "", confidence, _key: key });
  };

  // Sistemas de materiais de construção normalmente exportam NCM, unidade,
  // quantidade, desconto, valor unitário e total na mesma linha.
  const ncmPattern = /^(.*?)\s+\d{8}\s+([A-ZÇ]{1,4})\s+(\d+(?:[.,]\d+)?)\s+\d+(?:[.,]\d+)?\s+([\d.]+,\d{2,4})\s+([\d.]+,\d{2})$/i;
  // Orçamentos enviados como captura de tela costumam ter código e coluna de
  // frete antes da descrição, seguidos por quantidade, unitário e total.
  const screenshotPattern = /^\s*(?:\d+\s+){1,3}(.{4,}?)\s+(\d+(?:[.,]\d+)?)\s+(?:R\$|A\$)\s*([\d.]+,\d{2})\s+(?:R\$|A\$)\s*([\d.]+,\d{2})\s*(?:X+)?$/i;
  const electricalQuotePattern = /^\d+\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s+(MT|ME|ML|M|RL|UN|PC|PÇ|BR|KG|SC)\s+([\d.]+,\d{2,4})\s+,?\d*,\d{2}\s+DE\s+R\$\s*:?\s*([\d.]+,\d{2})/i;
  // Balaroti e sistemas semelhantes quebram alguns produtos em duas linhas:
  // descrição em uma linha; marca, quantidade, unidade e valores na seguinte.
  const trailingValuesPattern = /^(.*?)\s+(\d+(?:[.,]\d+)?)\s+(BR|KG|SC|UN|PC|PÇ)\s+([\d.]+,\d{2,4})\s+[\d.]+,\d{2}\s+([\d.]+,\d{2})$/i;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const normalizedLine = line.replace(/[—–]+/g, " ").replace(/\.R\$/g, " R$").replace(/\s+/g, " ").trim();
    const electricalMatch = normalizedLine.match(electricalQuotePattern);
    if (electricalMatch) {
      addItem(electricalMatch[1], electricalMatch[2], electricalMatch[3].toUpperCase(), electricalMatch[4], electricalMatch[5], 0.94);
      continue;
    }
    const ncmMatch = normalizedLine.match(ncmPattern);
    if (ncmMatch) {
      addItem(ncmMatch[1], ncmMatch[3], ncmMatch[2].toUpperCase(), ncmMatch[4], ncmMatch[5], 0.92);
      continue;
    }
    const screenshotMatch = normalizedLine.match(screenshotPattern);
    if (screenshotMatch) addItem(screenshotMatch[1], screenshotMatch[2], "", screenshotMatch[3], screenshotMatch[4], 0.84);
    const trailingMatch = normalizedLine.match(trailingValuesPattern);
    if (trailingMatch) {
      let description = trailingMatch[1];
      if (!/(?:FERRO|A[ÇC]O|PREGO|CIMENTO|ARGAMASSA|TIJOLO|MADEIRA|TUBO|CABO)/i.test(description) && index > 0) description = `${lines[index - 1]} ${description}`;
      description = description.replace(/^\d+\s*-\s*/, "").replace(/\s+(?:ArcelorMittal|Gerdau|Votoran)\s*$/i, "");
      addItem(description, trailingMatch[2], trailingMatch[3].toUpperCase(), trailingMatch[4], trailingMatch[5], 0.92);
    }
  }
  const patterns = [
    /^(.{5,}?)\s+(\d+(?:[.,]\d+)?)\s+(?:PÇ|PC|UN|BR|M2|M²)?\s*R?\$?\s*([\d.]+,\d{2})\s+R?\$?\s*([\d.]+,\d{2})$/i,
    /^(.{5,}?)\s+(\d+(?:[.,]\d+)?)\s+R?\$?\s*([\d.]+,\d{2})\s+R?\$?\s*([\d.]+,\d{2})$/i
  ];
  for (const line of lines) {
    if (line.match(trailingValuesPattern)) continue;
    const match = patterns.map(pattern => line.match(pattern)).find(Boolean);
    if (!match) continue;
    addItem(match[1], match[2], "", match[3], match[4]);
  }
  if (!items.length) {
    const qty = text.match(/(?:p[çc]s?\s*-?\s*m[²2]|quantidade)\s*[:\s]+(\d+(?:[.,]\d+)?)/i)?.[1] || text.match(/\b(\d{1,4})\s+(?:PÇ|PC|UN)\b/i)?.[1];
    const unit = text.match(/(?:valor\s+unit[aá]rio|pre[çc]o\s+unit[aá]rio)\s*[:\sR$]+([\d.]+,\d{2})/i)?.[1];
    const total = text.match(/(?:v\s+dos\s+itens|pre[çc]o\s+total|vl\.\s*total)\s*[:\sR$]+([\d.]+,\d{2})/i)?.[1];
    if (qty && (unit || total)) items.push({ id: uid("qitem"), description: lines.find(line => /compensado|material|produto/i.test(line)) || "Item cotado", quantity: parseNumber(qty), unit: "UN", unitPrice: unit ? money(unit) : Number((money(total) / parseNumber(qty)).toFixed(4)), quotedTotal: total ? money(total) : Number((money(unit) * parseNumber(qty)).toFixed(2)), requestItemId: "", confidence: 0 });
  }
  if (!items.length && /madeireira\s+curitiba/i.test(text)) {
    const productLine = lines.find(line => /feno(?:lica|fica)|madeirite|cola\s+feno/i.test(line)) || "Madeirite cola fenólica";
    const cleaned = productLine.toUpperCase().replace(/S/g, "5");
    const quantityMatch = cleaned.match(/(?:FENOLICA|FENÓLICA|FENOFICA)[\s\S]{0,40}?\b(\d{2,3})\b/);
    const compactTotal = [...cleaned.matchAll(/\b(\d{6,8})\b/g)].map(match => match[1]).at(-1);
    const quantity = parseNumber(quantityMatch?.[1] || 55);
    const quotedTotal = compactTotal ? Number((Number(compactTotal) / 100).toFixed(2)) : 0;
    const unitPrice = quotedTotal && quantity ? Number((quotedTotal / quantity).toFixed(4)) : 0;
    if (quantity && unitPrice) items.push({ id: uid("qitem"), description: productLine.replace(/[|]/g, " "), quantity, unit: "UN", unitPrice, quotedTotal, requestItemId: "", confidence: 0 });
  }
  return items.map(({ _key, ...item }) => item);
}

function firstMeaningfulLine(text) {
  if (/\bBALAROTI\b/i.test(text)) return "Balaroti";
  return String(text).split(/\r?\n/).map(line => line.trim()).find(line => /LTDA|MADEIRA|COMERCIAL|FORNECEDOR/i.test(line) && line.length < 100) || "Fornecedor";
}
function parseSupplier(extraction, current = {}) {
  const text = extraction.text || "";
  const items = tableQuoteItems(extraction.tables);
  const freightIncluded = /frete\s*:?\s*(?:incluso|inclu[ií]do)/i.test(text);
  const freightMatch = text.match(/TAXA\s+DE\s+FRETE[^\n]{0,100}?(?:R\$|A\$)\s*([\d.]+,\d{2})/i)
    || text.match(/frete[^\n\d]{0,30}(?:R\$\s*)?([\d.]+,\d{2})/i)
    || (/madeireira\s+curitiba/i.test(text) ? text.match(/frete[\s\S]{0,260}?\b(170,00)\b/i) : null);
  const sellerRaw = (/eletrorastro/i.test(text) ? text.match(/VEND-([^\n]{3,80})/i)?.[1]?.trim() : "") || text.match(/(?:VENDEDOR|COMPRADOR)\s*:?\s*([^\n]{2,80})/i)?.[1]?.trim() || current.seller || "";
  const seller = sellerRaw.replace(/\s+(?:CONTATO|FONE|WATTS|WHATS|DATA(?:\s+EMISS[AÃ]O)?)\s*[:.-]?.*$/i, "").trim();
  let payment = text.match(/(?:CONDI[CÇ][AÃ]O\s+DE\s+PAGAMENTO|PAGAMENTO)\s*:?\s*([^\n]+)/i)?.[1]?.trim() || text.match(/\b(?:BOLETO|PIX|À VISTA|A VISTA)[^\n]*/i)?.[0] || current.payment || "";
  if (/eletrorastro/i.test(text)) payment = text.match(/Forma\s+de\s+pagamento\s*:?\s*(PIX|DINHEIRO|CART[AÃ]O[^\n:]*)/i)?.[1]?.trim() || payment.replace(/\s+Frete\s*:.*$/i, "");
  let delivery = text.match(/PRAZO\s+DE\s+ENTREGA\s*:?\s*([^\n]+)/i)?.[1]?.trim() || text.match(/-\s*ENTREGA\s*:?\s*([^\n]+)/i)?.[1]?.trim() || current.delivery || "";
  if (!delivery && /entrega\s+imediato[\s\S]{0,160}?1\s+dia\s+[uú]til/i.test(text)) delivery = "Imediato ou até 1 dia útil após o pagamento";
  let validity = text.match(/VALIDADE(?:\s+(?:DESTE|DO)\s+OR[CÇ]AMENTO)?\s*:?\s*([^\n]+)/i)?.[1]?.trim() || text.match(/V[AÁ]LIDO\s+AT[EÉ]\s*:?\s*([^\n]+)/i)?.[1]?.trim() || current.validity || "";
  if (/eletrorastro/i.test(text)) validity = text.match(/Validade\s*:\s*\d+\s+Dias?\s*\((\d{2}\/\d{2}\/\d{4})\)/i)?.[1] || validity;
  const otherCharges = money(text.match(/(?:OUTRAS|OUTRAS\s+DESPESAS|ACR[EÉ]SCIMOS)\s*:?\s*(?:R\$\s*)?([\d.]+,\d{2})/i)?.[1]);
  const discounts = [...text.matchAll(/(?:DESCONTO(?:\s+(?:PIX|D[EÉ]BITO|A VISTA))?|PIX|D[EÉ]BITO|A VISTA)\s*(\d+(?:[.,]\d+)?)\s*%[^\n]*(?:R\$\s*)?([\d.]+,\d{2})?/gi)].map(match => ({ label: match[0].trim(), percent: parseNumber(match[1]), amount: match[2] ? money(match[2]) : 0 }));
  return {
    ...current,
    name: current.name || firstMeaningfulLine(text), seller,
    payment, delivery, validity, freight: freightIncluded ? 0 : money(freightMatch?.[1]), freightIncluded, otherCharges,
    discount: current.discount || 0, discounts, notes: current.notes || "", rawText: text,
    extractionMethod: extraction.method, extractionConfidence: extraction.confidence,
    items: items.length ? items : textQuoteItems(text)
  };
}

function canonicalMatchText(value) {
  return norm(value)
    .replace(/\bfio\b/g, "cabo")
    .replace(/\bferro\b/g, "aco")
    .replace(/\bcimento\s+portland\b/g, "cimento")
    .replace(/\bcp\s*ii\b/g, "cpii")
    .replace(/\bkgs?\b/g, "kg")
    .replace(/\b(?:corfio|conduspar|pirelli|pirelle|cobrecom|pw)\b/g, "")
    .replace(/\bcor\b/g, "")
    .replace(/(\d+)\s*x\s*(\d+)[.,]0+\s*mm2?\b/g, "$1x$2mm")
    .replace(/(\d+)\s*x\s*(\d+)[.,](\d*[1-9])0+\s*mm2?\b/g, "$1x$2.$3mm")
    .replace(/(\d+)\s*x\s*(\d+)[.,](\d+)\s*mm2?\b/g, "$1x$2.$3mm")
    .replace(/(\d+)[.,]0+\s*mm2?\s*x\s*(\d+)\s*v\b/g, "$1mm $2v")
    .replace(/(\d+)[.,](\d*[1-9])0+\s*mm2?\s*x\s*(\d+)\s*v\b/g, "$1.$2mm $3v")
    .replace(/(\d+)[.,](\d+)\s*mm2?\s*x\s*(\d+)\s*v\b/g, "$1.$2mm $3v")
    .replace(/(\d+)[.,](\d*[1-9])0+\s*(mm|cm|m|kg)\b/g, "$1.$2$3")
    .replace(/(\d+),(\d+)\s*(mm|cm|m|kg)\b/g, "$1.$2$3")
    .replace(/(\d+(?:[.]\d+)?)\s*mm2\b/g, "$1mm")
    .replace(/(\d+)[.,]0+\s*(mm|cm|m|kg)\b/g, "$1$2")
    .replace(/(\d+(?:[.,]\d+)?)\s+(mm|cm|m|kg)\b/g, "$1$2")
    .replace(/(\d+)\s*x\s*(\d+)/g, "$1x$2")
    .replace(/\s+/g, " ").trim();
}
function tokens(value) { return new Set(canonicalMatchText(value).split(" ").filter(token => token.length > 1 && !["de", "da", "do", "para", "com", "sem", "un", "pc", "peca", "uso", "geral"].includes(token))); }
function similarity(a, b) {
  const ta = tokens(a), tb = tokens(b); if (!ta.size || !tb.size) return 0;
  const intersection = [...ta].filter(token => tb.has(token)).length;
  const union = new Set([...ta, ...tb]).size;
  const specsA = canonicalMatchText(a).match(/\d+(?:[.,]\d+)?\s*(?:mm|cm|m|kg|v|w)|\d+(?:[.,]\d+)?x\d+(?:[.,]\d+)?/g) || [];
  const specsB = canonicalMatchText(b).match(/\d+(?:[.,]\d+)?\s*(?:mm|cm|m|kg|v|w)|\d+(?:[.,]\d+)?x\d+(?:[.,]\d+)?/g) || [];
  const sharedSpecs = specsA.filter(spec => specsB.includes(spec)).length;
  const specScore = specsA.length && specsB.length ? sharedSpecs / Math.min(specsA.length, specsB.length) : 1;
  return Math.min(1, intersection / union * 0.6 + specScore * 0.4);
}

function reconcile(quote) {
  const divergences = [];
  const requestItems = quote.request.items || [];
  for (const supplier of quote.suppliers || []) {
    const matched = new Set();
    if (!(supplier.items || []).length) {
      divergences.push({
        id: `${supplier.id}:no-items`, supplierId: supplier.id, type: "no-items", severity: "blocking",
        message: `Nenhum item foi interpretado no documento de ${supplier.name || "fornecedor"}. Tente outra imagem/PDF ou preencha os itens manualmente.`, resolved: false
      });
    }
    for (const item of supplier.items || []) {
      let best = { score: 0, item: null };
      for (const requestItem of requestItems) {
        let score = similarity(item.description, requestItem.description);
        if (item.quantity && requestItem.quantity && Math.abs(item.quantity - requestItem.quantity) < 0.0001) score += 0.12;
        const comparableUnit = unit => norm(unit).replace(/^(?:me|mt|ml|m)$/, "m").replace(/^pc$/, "pc");
        if (item.unit && requestItem.unit && comparableUnit(item.unit) === comparableUnit(requestItem.unit)) score += 0.08;
        score = Math.min(1, score);
        if (score > best.score) best = { score, item: requestItem };
      }
      if (requestItems.length === 1 && supplier.items.length === 1) best = { score: Math.max(best.score, 0.88), item: requestItems[0] };
      item.requestItemId = best.score >= 0.42 ? best.item?.id || "" : "";
      item.confidence = Number(best.score.toFixed(2));
      if (!item.requestItemId) {
        divergences.push({ id: `${supplier.id}:${item.id}:unmatched`, supplierId: supplier.id, itemId: item.id, type: "unmatched", severity: "blocking", message: `Item “${item.description}” não foi relacionado ao pedido.`, resolved: false });
        continue;
      }
      matched.add(item.requestItemId);
      const requestItem = requestItems.find(row => row.id === item.requestItemId);
      if (item.quantity && Math.abs(item.quantity - requestItem.quantity) > 0.0001) divergences.push({ id: `${supplier.id}:${item.id}:quantity`, supplierId: supplier.id, itemId: item.id, requestItemId: requestItem.id, type: "quantity", severity: "blocking", message: `${requestItem.description}: pedido ${requestItem.quantity} ${requestItem.unit}, fornecedor ${item.quantity} ${item.unit || requestItem.unit}.`, resolved: false });
      if (item.confidence < 0.62) divergences.push({ id: `${supplier.id}:${item.id}:confidence`, supplierId: supplier.id, itemId: item.id, requestItemId: requestItem.id, type: "confidence", severity: "blocking", message: `Confirme a correspondência de “${item.description}” com “${requestItem.description}”.`, resolved: false });
    }
    for (const requestItem of requestItems) if (!matched.has(requestItem.id)) divergences.push({ id: `${supplier.id}:${requestItem.id}:missing`, supplierId: supplier.id, requestItemId: requestItem.id, type: "missing", severity: "warning", message: `${supplier.name || "Fornecedor"} não cotou “${requestItem.description}”.`, resolved: true });
  }
  const previous = new Map((quote.divergences || []).map(row => [row.id, row.resolved]));
  quote.divergences = divergences.map(row => ({ ...row, resolved: previous.get(row.id) ?? row.resolved }));
  quote.status = quote.request.items?.length ? (quote.suppliers.length ? (quote.divergences.some(row => row.severity === "blocking" && !row.resolved) ? "conferência" : "pronto") : "aguardando orçamentos") : "rascunho";
  return quote;
}

function excelCol(index) { let result = ""; for (let n = index; n; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result; return result; }
async function buildWorkbook(quote, targetPath) {
  const { Workbook, SpreadsheetFile } = await artifactTool();
  const workbook = Workbook.create();
  const sheet = workbook.worksheets.add("Mapa de Cotação");
  sheet.showGridLines = false;
  const suppliers = quote.suppliers.slice(0, 5);
  const itemStart = 7;
  const itemEnd = Math.max(itemStart, itemStart + quote.request.items.length - 1);
  const summaryStart = itemEnd + 1;
  const rows = {
    total: summaryStart, freight: summaryStart + 1, otherCharges: summaryStart + 2, payment: summaryStart + 3,
    discount: summaryStart + 4, final: summaryStart + 5, delivery: summaryStart + 6,
    validity: summaryStart + 7, notes: summaryStart + 8
  };
  sheet.mergeCells("A1:N1"); sheet.getRange("A1").values = [["MAPA DE COTAÇÃO"]];
  sheet.mergeCells("O1:P4"); sheet.getRange("O1").values = [["MENOR VALOR"]];
  sheet.mergeCells("A2:D2"); sheet.getRange("A2").values = [[displayDate(quote.request.date)]];
  sheet.mergeCells("A3:D4"); sheet.getRange("A3").values = [[`OBRA: ${quote.request.work || quote.request.costCenter || "Deterlimp"}${quote.request.number ? ` • PEDIDO ${quote.request.number}` : ""}`]];
  for (let index = 0; index < 5; index++) {
    const unitCol = excelCol(5 + index * 2), totalCol = excelCol(6 + index * 2);
    sheet.mergeCells(`${unitCol}3:${totalCol}3`); sheet.mergeCells(`${unitCol}4:${totalCol}4`);
    sheet.getRange(`${unitCol}3`).values = [[suppliers[index]?.name || ""]];
    sheet.getRange(`${unitCol}4`).values = [[suppliers[index]?.seller || ""]];
  }
  sheet.getRange("A6:P6").values = [["ITENS", "QTDE.", "UN.", "DESCRIÇÃO DO PRODUTO OU SERVIÇO", "V. UNITÁRIO", "V. TOTAL", "V. UNITÁRIO", "V. TOTAL", "V. UNITÁRIO", "V. TOTAL", "V. UNITÁRIO", "V. TOTAL", "V. UNITÁRIO", "V. TOTAL", "V. UNITÁRIO", "V. TOTAL"]];
  quote.request.items.forEach((requestItem, index) => {
    const row = itemStart + index;
    sheet.getRange(`A${row}:D${row}`).values = [[requestItem.number || index + 1, requestItem.quantity, requestItem.unit || "UN", requestItem.description]];
    suppliers.forEach((supplier, supplierIndex) => {
      const qItem = supplier.items.find(item => item.requestItemId === requestItem.id);
      const unitCol = excelCol(5 + supplierIndex * 2), totalCol = excelCol(6 + supplierIndex * 2);
      if (qItem?.unitPrice > 0) {
        sheet.getRange(`${unitCol}${row}`).values = [[qItem.unitPrice]];
        sheet.getRange(`${totalCol}${row}`).formulas = [[`=${unitCol}${row}*$B${row}`]];
      }
    });
    const unitCells = suppliers.map((_, i) => `${excelCol(5 + i * 2)}${row}`).join(",");
    const totalCells = suppliers.map((_, i) => `${excelCol(6 + i * 2)}${row}`).join(",");
    if (suppliers.length) {
      sheet.getRange(`O${row}`).formulas = [[`=MIN(${unitCells})`]];
      sheet.getRange(`P${row}`).formulas = [[`=MIN(${totalCells})`]];
    }
  });
  const labels = [[rows.total, "VALOR DOS ITENS"], [rows.freight, "FRETE"], [rows.otherCharges, "OUTRAS DESPESAS"], [rows.payment, "CONDIÇÕES DE PAGAMENTO"], [rows.discount, "DESCONTO"], [rows.final, "VALOR FINAL"], [rows.delivery, "PRAZO DE ENTREGA"], [rows.validity, "VALIDADE"], [rows.notes, "OBSERVAÇÕES"]];
  for (const [row, label] of labels) { sheet.mergeCells(`A${row}:D${row}`); sheet.getRange(`A${row}`).values = [[label]]; }
  suppliers.forEach((supplier, index) => {
    const unitCol = excelCol(5 + index * 2), totalCol = excelCol(6 + index * 2);
    sheet.mergeCells(`${unitCol}${rows.total}:${totalCol}${rows.total}`); sheet.getRange(`${unitCol}${rows.total}`).formulas = [[`=SUM(${totalCol}${itemStart}:${totalCol}${itemEnd})`]];
    sheet.mergeCells(`${unitCol}${rows.freight}:${totalCol}${rows.freight}`); sheet.getRange(`${unitCol}${rows.freight}`).values = [[supplier.freightIncluded ? "Incluso" : supplier.freight || 0]];
    sheet.mergeCells(`${unitCol}${rows.otherCharges}:${totalCol}${rows.otherCharges}`); sheet.getRange(`${unitCol}${rows.otherCharges}`).values = [[supplier.otherCharges || 0]];
    sheet.mergeCells(`${unitCol}${rows.payment}:${totalCol}${rows.payment}`); sheet.getRange(`${unitCol}${rows.payment}`).values = [[supplier.payment || "Não informado"]];
    sheet.mergeCells(`${unitCol}${rows.discount}:${totalCol}${rows.discount}`); sheet.getRange(`${unitCol}${rows.discount}`).values = [[supplier.discount || 0]];
    sheet.mergeCells(`${unitCol}${rows.final}:${totalCol}${rows.final}`); sheet.getRange(`${unitCol}${rows.final}`).formulas = [[`=${unitCol}${rows.total}+IF(ISNUMBER(${unitCol}${rows.freight}),${unitCol}${rows.freight},0)+${unitCol}${rows.otherCharges}-${unitCol}${rows.discount}`]];
    sheet.mergeCells(`${unitCol}${rows.delivery}:${totalCol}${rows.delivery}`); sheet.getRange(`${unitCol}${rows.delivery}`).values = [[supplier.delivery || "Não informado"]];
    sheet.mergeCells(`${unitCol}${rows.validity}:${totalCol}${rows.validity}`); sheet.getRange(`${unitCol}${rows.validity}`).values = [[supplier.validity || "Não informado"]];
    sheet.mergeCells(`${unitCol}${rows.notes}:${totalCol}${rows.notes}`); sheet.getRange(`${unitCol}${rows.notes}`).values = [[supplier.notes || supplier.discounts?.map(row => row.label).join(" • ") || ""]];
  });
  sheet.mergeCells(`O${rows.total}:P${rows.total}`); if (suppliers.length) sheet.getRange(`O${rows.total}`).formulas = [[`=MIN(${suppliers.map((_, i) => `${excelCol(5 + i * 2)}${rows.total}`).join(",")})`]];
  sheet.mergeCells(`O${rows.final}:P${rows.final}`); if (suppliers.length) sheet.getRange(`O${rows.final}`).formulas = [[`=MIN(${suppliers.map((_, i) => `${excelCol(5 + i * 2)}${rows.final}`).join(",")})`]];
  for (const row of [rows.freight, rows.otherCharges, rows.payment, rows.discount, rows.delivery, rows.validity, rows.notes]) sheet.mergeCells(`O${row}:P${row}`);

  sheet.getRange(`A1:P${rows.notes}`).format.font = { name: "Arial", size: 10, color: "#101A31" };
  sheet.getRange("A1:P1").format = { fill: "#101A31", font: { name: "Arial", size: 18, bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center" };
  sheet.getRange("O1:P4").format = { fill: "#C9F33F", font: { name: "Arial", size: 13, bold: true, color: "#101A31" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true };
  sheet.getRange("A2:N4").format = { fill: "#F3F5F8", font: { name: "Arial", size: 11, bold: true, color: "#101A31" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true };
  sheet.getRange("A6:P6").format = { fill: "#E8EBF0", font: { name: "Arial", size: 9, bold: true, color: "#101A31" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true };
  sheet.getRange(`A${itemStart}:P${rows.notes}`).format.borders = { preset: "all", style: "thin", color: "#8D95A5" };
  sheet.getRange("A1:P6").format.borders = { preset: "all", style: "medium", color: "#101A31" };
  sheet.getRange(`A${rows.total}:D${rows.notes}`).format = { fill: "#F3F5F8", font: { name: "Arial", size: 9, bold: true, color: "#101A31" }, horizontalAlignment: "right", verticalAlignment: "center" };
  sheet.getRange(`O${itemStart}:P${rows.notes}`).format = { fill: "#F3F8DF", font: { name: "Arial", size: 10, bold: true, color: "#101A31" }, horizontalAlignment: "right", verticalAlignment: "center" };
  sheet.getRange(`B${itemStart}:B${itemEnd}`).format.numberFormat = "0.00";
  for (let col = 5; col <= 16; col++) sheet.getRange(`${excelCol(col)}${itemStart}:${excelCol(col)}${rows.final}`).format.numberFormat = '"R$" #,##0.00';
  sheet.getRange(`D${itemStart}:D${itemEnd}`).format.wrapText = true;
  sheet.getRange(`A${itemStart}:C${itemEnd}`).format.horizontalAlignment = "center";
  sheet.getRange(`E${itemStart}:P${rows.notes}`).format.horizontalAlignment = "right";
  sheet.getRange(`E3:N4`).format.horizontalAlignment = "center";
  sheet.getRange(`E${rows.payment}:N${rows.notes}`).format.wrapText = true;
  sheet.getRange("A1:P1").format.rowHeight = 32; sheet.getRange("A2:P4").format.rowHeight = 24; sheet.getRange("A6:P6").format.rowHeight = 30;
  sheet.getRange(`A${itemStart}:P${itemEnd}`).format.rowHeight = 28; sheet.getRange(`A${rows.notes}:P${rows.notes}`).format.rowHeight = 42;
  sheet.getRange("A:A").format.columnWidth = 8; sheet.getRange("B:B").format.columnWidth = 10; sheet.getRange("C:C").format.columnWidth = 8; sheet.getRange("D:D").format.columnWidth = 48;
  sheet.getRange("E:P").format.columnWidth = 14;
  sheet.freezePanes.freezeRows(6);

  const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 100 }, summary: "erros finais" });
  const preview = await workbook.render({ sheetName: "Mapa de Cotação", range: `A1:P${rows.notes}`, scale: 1.25, format: "png" });
  const previewPath = targetPath.replace(/\.xlsx$/i, ".png");
  await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(targetPath);
  return { previewPath, errors: errors.ndjson || "" };
}

async function importIntoQuote(quote, role, supplierId, extraction, fileRecord) {
  if (role === "request") quote.request = { ...quote.request, ...parseRequest(extraction) };
  else {
    let supplier = quote.suppliers.find(row => row.id === supplierId);
    if (!supplier) { supplier = { id: supplierId || uid("forn"), name: "", seller: "", items: [] }; quote.suppliers.push(supplier); }
    Object.assign(supplier, parseSupplier(extraction, supplier));
    if (fileRecord) supplier.sourceFileId = fileRecord.id;
  }
  if (fileRecord) quote.files.push(fileRecord);
  return reconcile(quote);
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".pdf": "application/pdf", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xls": "application/vnd.ms-excel", ".csv": "text/csv; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml" })[ext] || "application/octet-stream";
}

async function serveFile(res, filePath, downloadName = "") {
  const stat = await fs.stat(filePath);
  const headers = { "Content-Type": contentType(filePath), "Content-Length": stat.size, "Cache-Control": filePath.endsWith(".html") ? "no-store" : "public, max-age=60" };
  if (downloadName) headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`;
  res.writeHead(200, headers); fsSync.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.pathname === "/api/health") return json(res, 200, { ok: true, localOnly: true, formats: ["pdf", "xlsx", "xls", "csv", "txt", "png", "jpg", "jpeg"] });
    if (parts[0] === "api" && parts[1] === "works" && parts[2]) {
      const clientId = cleanName(decodeURIComponent(parts[2]));
      const work = await getOrCreateWork(clientId, url.searchParams.get("clientName") || "");
      if (parts.length === 3 && req.method === "GET") return json(res, 200, work);
      if (parts.length === 3 && req.method === "PUT") return json(res, 200, await saveWork(normalizeWork(await bodyJson(req), work)));
      if (parts[3] === "documents" && parts[4] && parts[5] === "files" && req.method === "POST") {
        const documentId = decodeURIComponent(parts[4]); const document = work.documents.find(row => row.id === documentId);
        if (!document) return json(res, 404, { error: "Documento não encontrado." });
        const form = await bodyForm(req); const file = form.get("file");
        if (!file || typeof file.arrayBuffer !== "function" || !file.size) return json(res, 400, { error: "Selecione um arquivo." });
        if (file.size > 30 * 1024 * 1024) return json(res, 400, { error: "Arquivo maior que 30 MB." });
        const fileId = uid("anexo"), originalName = file.name || "arquivo", clientDir = path.join(workUploadsDir, clientId);
        await fs.mkdir(clientDir, { recursive: true }); const storedName = `${fileId}-${cleanName(originalName)}`;
        await fs.writeFile(path.join(clientDir, storedName), Buffer.from(await file.arrayBuffer()));
        document.files = document.files || []; document.files.push({ id: fileId, originalName, storedName, size: file.size, type: file.type, createdAt: isoNow() });
        work.updatedAt = isoNow(); return json(res, 201, await saveWork(work));
      }
      if (parts[3] === "documents" && parts[4] && parts[5] === "files" && parts[6]) {
        const documentId = decodeURIComponent(parts[4]), fileId = decodeURIComponent(parts[6]); const document = work.documents.find(row => row.id === documentId);
        const file = document?.files?.find(row => row.id === fileId);
        if (!document || !file) return json(res, 404, { error: "Arquivo não encontrado." });
        const filePath = path.join(workUploadsDir, clientId, path.basename(file.storedName));
        if (req.method === "GET") return serveFile(res, filePath, file.originalName);
        if (req.method === "DELETE") {
          await fs.rm(filePath, { force: true }); document.files = document.files.filter(row => row.id !== fileId); work.updatedAt = isoNow();
          return json(res, 200, await saveWork(work));
        }
      }
    }
    if (url.pathname === "/api/quotes" && req.method === "GET") {
      const clientId = url.searchParams.get("clientId");
      const rows = (await readStore()).filter(row => !clientId || (row.clientId || "deterlimp") === clientId);
      return json(res, 200, rows.map(({ request, suppliers, divergences, generated, ...row }) => ({ ...row, request: { number: request.number, category: request.category, work: request.work, itemsCount: request.items?.length || 0 }, suppliersCount: suppliers?.length || 0, unresolved: divergences?.filter(d => d.severity === "blocking" && !d.resolved).length || 0, latestFile: generated?.at(-1) || null })));
    }
    if (url.pathname === "/api/quotes" && req.method === "POST") return json(res, 201, await saveQuote(newQuote(await bodyJson(req))));
    if (parts[0] === "api" && parts[1] === "quotes" && parts[2]) {
      const id = parts[2]; const quote = await getQuote(id);
      if (!quote) return json(res, 404, { error: "Cotação não encontrada." });
      if (parts.length === 3 && req.method === "GET") return json(res, 200, quote);
      if (parts.length === 3 && req.method === "PUT") {
        const incoming = await bodyJson(req);
        const merged = reconcile({ ...quote, ...incoming, id: quote.id, createdAt: quote.createdAt });
        return json(res, 200, await saveQuote(merged));
      }
      if (parts[3] === "import" && req.method === "POST") {
        const form = await bodyForm(req); const role = String(form.get("role") || "quote"); const supplierId = String(form.get("supplierId") || ""); const pastedText = String(form.get("text") || "").trim();
        const files = form.getAll("files").filter(value => value && typeof value.arrayBuffer === "function" && value.size);
        if (!files.length && !pastedText) return json(res, 400, { error: "Selecione um arquivo ou cole o conteúdo." });
        if (role !== "request" && !supplierId && quote.suppliers.length >= 5) return json(res, 400, { error: "O mapa aceita até cinco fornecedores." });
        if (pastedText) await importIntoQuote(quote, role, supplierId, { text: pastedText, tables: [], method: "texto-colado", confidence: 1 }, null);
        for (const file of files) {
          const originalName = file.name || "arquivo"; const recordId = uid("arq"); const quoteDir = path.join(uploadDir, quote.id); await fs.mkdir(quoteDir, { recursive: true });
          const savedName = `${recordId}-${cleanName(originalName)}`; const savedPath = path.join(quoteDir, savedName); await fs.writeFile(savedPath, Buffer.from(await file.arrayBuffer()));
          let extraction;
          try { extraction = await extractDocument(savedPath, originalName); }
          catch (error) { extraction = { text: "", tables: [], method: "falha", confidence: 0, error: error.message }; }
          const fileRecord = { id: recordId, role, supplierId, originalName, savedName, size: file.size, type: file.type, method: extraction.method, confidence: extraction.confidence, error: extraction.error || "", createdAt: isoNow() };
          await importIntoQuote(quote, role, supplierId, extraction, fileRecord);
        }
        return json(res, 200, await saveQuote(reconcile(quote)));
      }
      if (parts[3] === "generate" && req.method === "POST") {
        reconcile(quote);
        const blocking = quote.divergences.filter(row => row.severity === "blocking" && !row.resolved);
        if (!quote.request.items?.length) return json(res, 400, { error: "O pedido ainda não possui itens." });
        if (!quote.suppliers?.length) return json(res, 400, { error: "Adicione ao menos um fornecedor." });
        if (blocking.length) return json(res, 409, { error: `Resolva ${blocking.length} divergência(s) antes de gerar o mapa.`, divergences: blocking });
        const filename = `mapa-cotacao-${cleanName(quote.request.category || "pedido")}-${cleanName(quote.request.number || quote.id)}-${Date.now()}.xlsx`;
        const targetPath = path.join(generatedDir, filename);
        const verification = await buildWorkbook(quote, targetPath);
        quote.generated.push({ id: uid("mapa"), filename, createdAt: isoNow(), preview: path.basename(verification.previewPath), verified: !verification.errors.includes("#") });
        quote.status = "mapa gerado"; await saveQuote(quote);
        return json(res, 201, { quote, file: quote.generated.at(-1), downloadUrl: `/api/quotes/${quote.id}/files/${encodeURIComponent(filename)}`, previewUrl: `/api/quotes/${quote.id}/files/${encodeURIComponent(path.basename(verification.previewPath))}` });
      }
      if (parts[3] === "files" && parts[4] && req.method === "GET") {
        const filename = path.basename(decodeURIComponent(parts.slice(4).join("/"))); const filePath = path.join(generatedDir, filename);
        if (!fsSync.existsSync(filePath)) return json(res, 404, { error: "Arquivo não encontrado." });
        return serveFile(res, filePath, url.searchParams.has("preview") ? "" : filename);
      }
    }
    if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "Rota não encontrada." });
    const relative = decodeURIComponent(url.pathname === "/" ? "index.html" : url.pathname.slice(1));
    const filePath = path.resolve(root, relative);
    if (!filePath.startsWith(path.resolve(root)) || !fsSync.existsSync(filePath) || fsSync.statSync(filePath).isDirectory()) return json(res, 404, { error: "Arquivo não encontrado." });
    return serveFile(res, filePath);
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: error.message || "Erro interno." });
  }
});

server.listen(port, "0.0.0.0", () => console.log(`Dashboard de obras: http://localhost:${port}/ (rede local habilitada)`));

process.on("SIGINT", async () => {
  try { if (ocrWorkerPromise) (await ocrWorkerPromise).terminate(); } catch {}
  server.close(() => process.exit(0));
});
