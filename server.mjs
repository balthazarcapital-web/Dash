import http from "node:http";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import os from "node:os";
import ExcelJS from "exceljs";
import pdfParse from "pdf-parse";
import XLSX from "xlsx";

const root = path.dirname(fileURLToPath(import.meta.url));
const isVercel = Boolean(process.env.VERCEL);
const runtimeDir = isVercel ? path.join(os.tmpdir(), "absolutta-dashboard") : path.join(root, "runtime_data");
const uploadDir = path.join(runtimeDir, "uploads");
const generatedDir = path.join(runtimeDir, "generated");
const storePath = path.join(runtimeDir, "quotes.json");
const worksStorePath = path.join(runtimeDir, "works.json");
const workUploadsDir = path.join(runtimeDir, "work-documents");
const drClovisBudgetPath = path.join(root, "budget-dr-clovis.json");
const publishedWorksPath = path.join(root, "works-data.json");
const outputDir = isVercel ? path.join(runtimeDir, "quote-automation-demo") : path.join(root, "outputs", "quote-automation-demo");
const driveRoots = {
  deterlimp: process.env.GOOGLE_DRIVE_ROOT_DETERLIMP || "1F5mfcQ6STExZHtbbCr_QCYV1FUjznw3z",
  carlos_bezerra: process.env.GOOGLE_DRIVE_ROOT_CARLOS_BEZERRA || "1ShnoGQbYwC947ZKN1ziV43az5AJrd94d",
  dr_clovis_cmfs: process.env.GOOGLE_DRIVE_ROOT_DR_CLOVIS_CMFS || "1MenF8_QQ52eg1pRP39fiQv2n1hP9pRFc",
  clinica_gianna: process.env.GOOGLE_DRIVE_ROOT_CLINICA_GIANNA || "1FErPPJh_DK3VdoOXIMPQpL5MCuZ1oxfF"
};
// Estado compartilhado do dashboard fica em uma pasta normal do Drive. Isso
// evita depender do escopo appDataFolder, mantendo leitura e gravação com o
// mesmo OAuth já usado para localizar os pedidos.
const driveStateFolderId = process.env.GOOGLE_DRIVE_STATE_FOLDER_ID || driveRoots.deterlimp;
const spreadsheetBases = {
  deterlimp: { id: "13Kmg41VDV8KUijPucj2TxCFdElFD6Vfb1WY4WwB7msU", gid: "1856239408" },
  carlos_bezerra: { id: "1PE6KUaEEshp2Kk1d9eExIFp53DzNTJST7mJc4pMZEuw", gid: "1856239408" },
  clinica_gianna: { id: "1_LTDwN25pSKXfofahLgFiRGndb79cWNHxi8iR3v_VHM", gid: "1856239408" },
  dr_clovis_cmfs: { id: "1Myr3_i6bWDCI9dq--3x3ndH3QWqFfmdlKvE-YhRZ0lU", gid: "1856239408" }
};
const drivePilot = {
  clientId: "deterlimp", number: "5", category: "Hidráulica", folderId: "1xon5pJF9nxvWZHqKY3IpWOcVcrjRwz1a",
  files: [
    { id: "1yzfP6frvgUNTbVA8rHZRBVZCgv18rUmr", role: "request", name: "01 - Pedido - Hidráulica 05.pdf" },
    { id: "1FxZ7N0qZfVuPNU4NpL7IHfYmarlaU0kE", role: "supplier", supplier: "Balaroti", name: "02 - Orçamento - Balaroti - 392160.pdf" },
    { id: "16LSJsZJHMmFPgV6d2Wt_SucUwJ2vurGD", role: "supplier", supplier: "Nichele", name: "02 - Orçamento - Nichele - 1803376.pdf" }
  ],
  requestItems: [
    [1,1,"UN","MICTÓRIO SANITÁRIO BRANCO GELO DECA"],[2,3,"UN","BACIA SANITÁRIA COM CAIXA ACOPLADA DECA"],[3,2,"UN","CUBA DE EMBUTIR OVAL BRANCA PARA BANCADA DECA 49CM X 36,5CM"],[4,8,"UN","ENGATE FLEXÍVEL DE 40 CM"],[5,1,"UN","CANO PARA CHUVEIRO DE 40 CM"],[6,1,"UN","CHUVEIRO 220 V FAME"],[7,8,"UN","CANOPLA PARA REGISTRO DECA 3/4"],[8,2,"UN","TORNEIRA BICA ALTA CROMADA DE BANCADA DECA"],[9,12,"UN","SIFÃO UNIVERSAL SANFONADO"],[10,3,"UN","ANEL DE VEDAÇÃO PARA VASO SANITÁRIO"],[11,1,"UN","SPUD PARA MICTÓRIO DECA"],[12,1,"UN","TUBO DE LIGAÇÃO AJUSTÁVEL PARA MICTÓRIO DECA"],[13,3,"UN","ASSENTO SANITÁRIO VASO DECA"],[14,2,"UN","VÁLVULA DECA PARA ESCOAMENTO LAVATÓRIO"],[15,12,"UN","PARAFUSO 10MM COM BUCHA PARA VASO SANITÁRIO"],[16,2,"UN","FITA VEDA ROSCA 18MM X 25M"],[17,11,"BR","TUBO SOLDÁVEL MARROM 25MM"]
  ],
  supplierTexts: {
    Balaroti: `Balaroti Pedido 392160 Vendedor Moreira. Validade 20/08/2026. Plano: A VISTA. Entrega: 24/08/2026.
8 PC ENGATE FLEXIVEL 40CM TIGRE 8,90 71,20
1 PC BRACO PARA CHUVEIRO 40CM ASTRA 29,90 29,90
12 PC SIFAO SANFONADO UNIVERSAL BLUKIT 7,90 94,80
1 PC ESPUDE 1.1/2 ASTRA 10,90 10,90
3 PC KIT BACIA COM CAIXA ACOPLADA DECA 959,90 2.879,70
1 PC VALVULA MICTORIO DOCOL 796,90 796,90
2 PC TORNEIRA LAVATORIO MESA LINK DECA 403,90 807,80
2 PC CUBA EMBUTIR 49X36,5 OVAL DECA 136,90 273,80
1 UN DUCHA 220V ZAGONEL 149,90 149,90
2 PC VEDA ROSCA 18MMX25M TIGRE 11,90 23,80
11 TB TUBO 25MM SOLDAVEL 6M TIGRE 25,90 284,90
1 PC MICTORIO COM SIFAO INTEGRADO DECA 815,90 815,90
8 UN ACABAMENTO REGISTRO 3/4 REAL 33,90 271,20
Frete R$ 86,44. Total do Orçamento R$ 6.597,14.`,
    Nichele: `NICHELE Orçamento 1.803.376. Validade 22/08/2026. Condição de pagamento CARTAO CREDITO. Vendedora ANGELICA.
1 PC MICTORIO GELO DECA 816,65 816,65
3 PC KIT BACIA CAIXA ACOPLADA ASPEN DECA 954,90 2.864,70
2 PC CUBA EMBUTIR OVAL 49X36,5 DECA 133,80 267,60
8 PC ENGATE FLEX 40CM DECA 55,96 447,68
1 PC CANO CHUVEIRO 40CM ENERBRAS 23,26 23,26
1 PC DUCHA 220V LORENZETTI 113,30 113,30
8 PC ACABAMENTO REGISTRO 3/4 DECA 85,15 681,20
2 PC TORNEIRA LAVATORIO MESA ALTA DECA 393,04 786,08
12 PC SIFAO SANFONADO TIGRE 8,92 107,04
3 PC ANEL VEDACAO BACIA TIGRE 18,51 55,53
1 PC ESPUDE BACIA TIGRE 9,23 9,23
1 PC TUBO LIGACAO DECA 257,68 257,68
3 PC ASSENTO SANITARIO ASPEN DECA 153,98 461,94
2 PC VALVULA ESCOAMENTO DECA 61,65 123,30
12 PC PARAFUSO WC COM BUCHA 10MM 22,22 266,64
2 PC VEDA ROSCA 18X25M TIGRE 11,49 22,98
11 BR TUBO SOLDAVEL 25MM TIGRE 27,58 303,38
Outras despesas R$ 200,00. Total geral R$ 7.808,19.`
  }
};
const port = Number(process.env.PORT || 4173);
const depRoot = process.env.DETERLIMP_NODE_MODULES || "C:/Users/balth/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules";
const runtimeRequire = isVercel ? createRequire(import.meta.url) : createRequire(path.join(depRoot, "package.json"));
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

const driveConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
let googleAccessToken = "";
let googleAccessTokenExpiresAt = 0;
const driveStateIds = new Map();

async function getGoogleAccessToken() {
  if (!driveConfigured()) throw new Error("Google Drive ainda não foi conectado no servidor.");
  if (googleAccessToken && Date.now() < googleAccessTokenExpiresAt - 60_000) return googleAccessToken;
  const form = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    grant_type: "refresh_token"
  });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) throw new Error(payload.error_description || "Não foi possível renovar o acesso ao Google Drive.");
  googleAccessToken = payload.access_token;
  googleAccessTokenExpiresAt = Date.now() + Number(payload.expires_in || 3600) * 1000;
  return googleAccessToken;
}

async function driveFetch(url, options = {}) {
  const token = await getGoogleAccessToken();
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`Google Drive (${response.status}): ${message.slice(0, 500) || response.statusText}`);
  }
  return response;
}

async function sheetsFetch(pathname, options = {}) {
  const token = await getGoogleAccessToken();
  const response = await fetch(`https://sheets.googleapis.com/v4/${pathname}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`Google Planilhas (${response.status}): ${message.slice(0, 500) || response.statusText}`);
  }
  return response;
}

function quoteSheetValues(quote) {
  const suppliers = quote.suppliers || [];
  const header = ["ITEM", "DESCRIÇÃO", "UN.", "QTDE."];
  suppliers.forEach(supplier => header.push(`${supplier.name || "FORNECEDOR"} | UNIT.`, `${supplier.name || "FORNECEDOR"} | TOTAL`));
  header.push("MENOR TOTAL", "MELHOR FORNECEDOR");
  const rows = [[quote.clientName || quote.request.work || "ABSOLUTTA"], ["MAPA DE COTAÇÃO"], [`Pedido ${quote.request.category || ""} ${quote.request.number || ""}`], [`Solicitante: ${quote.request.requester || "Não informado"}`], [`Data: ${displayDate(quote.request.date)}`], [], header];
  (quote.request.items || []).forEach((requestItem, index) => {
    const row = [requestItem.number || index + 1, requestItem.description || "", requestItem.unit || "UN", Number(requestItem.quantity || 0)];
    const prices = [];
    suppliers.forEach(supplier => {
      const item = relatedSupplierItem(supplier, requestItem);
      const unit = item ? effectiveUnitPrice(item, requestItem) : 0, total = item ? effectiveItemTotal(item, requestItem) : "";
      row.push(unit || "", total); if (total) prices.push({ total, name: supplier.name || "Fornecedor" });
    });
    const best = prices.length ? prices.reduce((current, entry) => entry.total < current.total ? entry : current) : null;
    row.push(best?.total || "", best?.name || ""); rows.push(row);
  });
  const totals = ["", "TOTAL POR FORNECEDOR"];
  suppliers.forEach(supplier => totals.push("", Number(supplierTotalForQuote(supplier, quote).toFixed(2))));
  return [...rows, totals];
}

function supplierTotalForQuote(supplier, quote) {
  const itemsTotal = (quote.request.items || []).reduce((sum, requestItem) => {
    const item = relatedSupplierItem(supplier, requestItem);
    return sum + Number(item?.quotedTotal || Number(item?.unitPrice || 0) * Number(requestItem.quantity || 0));
  }, 0);
  return itemsTotal + Number(supplier.freightIncluded ? 0 : supplier.freight || 0) + Number(supplier.otherCharges || 0) - Number(supplier.discount || 0);
}

async function createQuoteGoogleSheet(quote) {
  const title = `Mapa de Cotação - ${quote.request.category || "Pedido"} ${quote.request.number || ""}`.trim();
  const created = await sheetsFetch("spreadsheets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ properties: { title }, sheets: [{ properties: { title: "Mapa de Cotação" } }] }) }).then(response => response.json());
  const range = encodeURIComponent("Mapa de Cotação!A1");
  await sheetsFetch(`spreadsheets/${created.spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ majorDimension: "ROWS", values: quoteSheetValues(quote) }) });
  await sheetsFetch(`spreadsheets/${created.spreadsheetId}:batchUpdate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requests: [{ repeatCell: { range: { sheetId: 0, startRowIndex: 0, endRowIndex: 2 }, cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 14 }, backgroundColor: { red: 0.09, green: 0.13, blue: 0.2 }, foregroundColor: { red: 1, green: 1, blue: 1 } } }, fields: "userEnteredFormat(textFormat,backgroundColor,foregroundColor)" } }, { repeatCell: { range: { sheetId: 0, startRowIndex: 6, endRowIndex: 7 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.91, green: 0.95, blue: 0.85 } } }, fields: "userEnteredFormat(textFormat,backgroundColor)" } }, { updateSheetProperties: { properties: { sheetId: 0, gridProperties: { frozenRowCount: 7 } }, fields: "gridProperties.frozenRowCount" } }] }) });
  if (quote.request.driveFolderId) await driveFetch(`https://www.googleapis.com/drive/v3/files/${created.spreadsheetId}?addParents=${encodeURIComponent(quote.request.driveFolderId)}&supportsAllDrives=true&fields=id`, { method: "PATCH" }).catch(() => {});
  return { id: created.spreadsheetId, url: created.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${created.spreadsheetId}/edit`, title, createdAt: isoNow() };
}

async function findDriveStateFile(name) {
  if (driveStateIds.has(name)) return driveStateIds.get(name);
  const q = encodeURIComponent(`name='${name.replaceAll("'", "\\'")}' and '${driveStateFolderId}' in parents and trashed=false`);
  const response = await driveFetch(`https://www.googleapis.com/drive/v3/files?spaces=drive&q=${q}&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name)&pageSize=10`);
  const id = (await response.json()).files?.[0]?.id || "";
  if (id) driveStateIds.set(name, id);
  return id;
}

async function readDriveState(name, fallback) {
  const id = await findDriveStateFile(name);
  if (!id) return fallback;
  const response = await driveFetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
  try { return JSON.parse(await response.text()); } catch { return fallback; }
}

async function writeDriveState(name, value) {
  const body = JSON.stringify(value, null, 2);
  let id = await findDriveStateFile(name);
  if (!id) {
    const boundary = `dash_${crypto.randomUUID()}`;
    const multipart = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [driveStateFolderId], mimeType: "application/json" })}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`)
    ]);
    const response = await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id", { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: multipart });
    id = (await response.json()).id;
    driveStateIds.set(name, id);
  } else {
    await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body });
  }
}

async function readStore() {
  if (isVercel && driveConfigured()) return readDriveState("absolutta-dashboard-quotes.json", []);
  try { return JSON.parse(await fs.readFile(storePath, "utf8")); } catch { return []; }
}
async function writeStore(rows) {
  if (isVercel && driveConfigured()) return writeDriveState("absolutta-dashboard-quotes.json", rows);
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
  if (isVercel && driveConfigured()) return readDriveState("absolutta-dashboard-works.json", []);
  try { return JSON.parse(await fs.readFile(worksStorePath, "utf8")); } catch { return []; }
}
async function writeWorks(rows) {
  if (isVercel && driveConfigured()) return writeDriveState("absolutta-dashboard-works.json", rows);
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
let publishedWorksPromise;
async function publishedWork(clientId) {
  if (!publishedWorksPromise) publishedWorksPromise = fs.readFile(publishedWorksPath, "utf8").then(JSON.parse).catch(() => []);
  const seed = (await publishedWorksPromise).find(row => row.clientId === clientId);
  return seed ? structuredClone(seed) : null;
}
function mergeById(seedRows = [], localRows = [], fallbackKey = "id") {
  const result = seedRows.map(seed => {
    const local = localRows.find(row => row.id === seed.id || (fallbackKey && row[fallbackKey] && row[fallbackKey] === seed[fallbackKey]));
    return local ? { ...seed, ...local } : seed;
  });
  const known = new Set(result.map(row => row.id));
  result.push(...localRows.filter(row => !known.has(row.id)));
  return result;
}
function restorePublishedWork(local, seed) {
  if (!seed) return { work: local, changed: false };
  let changed = false;
  const work = structuredClone(local);
  const localBudgetItems = work.budget?.items?.length || 0;
  const seedBudgetItems = seed.budget?.items?.length || 0;
  if (seedBudgetItems > localBudgetItems) {
    const actuals = mergeById(seed.budget.actuals || [], work.budget?.actuals || [], "orderRef");
    work.budget = { ...seed.budget, actuals };
    changed = true;
  } else if (seed.budget && work.budget) {
    const actuals = mergeById(seed.budget.actuals || [], work.budget.actuals || [], "orderRef");
    if (actuals.length > (work.budget.actuals || []).length) { work.budget.actuals = actuals; changed = true; }
  }
  const documentKey = row => norm(row.title);
  const localDocuments = new Map((work.documents || []).map(row => [documentKey(row), row]));
  const mergedDocuments = (seed.documents || []).map(row => {
    const localDocument = localDocuments.get(documentKey(row));
    if (!localDocument) return row;
    const pristine = ["", "Pendente"].includes(localDocument.status || "") && !localDocument.expiry && !localDocument.owner && !localDocument.notes && !localDocument.driveUrl && !(localDocument.files || []).length;
    return pristine ? { ...localDocument, ...row } : { ...row, ...localDocument };
  });
  const seedDocumentKeys = new Set((seed.documents || []).map(documentKey));
  mergedDocuments.push(...(work.documents || []).filter(row => !seedDocumentKeys.has(documentKey(row))));
  if (mergedDocuments.length > (work.documents || []).length) { work.documents = mergedDocuments; changed = true; }
  for (const field of ["journal", "tasks", "contacts"]) {
    const merged = mergeById(seed[field] || [], work[field] || []);
    if (merged.length > (work[field] || []).length) { work[field] = merged; changed = true; }
  }
  return { work, changed };
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
  if (!work) { work = (await publishedWork(clientId)) || newWork(clientId, clientName || clientId); rows.unshift(work); await writeWorks(rows); }
  else {
    let changed = false;
    const restored = restorePublishedWork(work, await publishedWork(clientId));
    work = restored.work;
    if (restored.changed) { rows[rows.findIndex(row => row.clientId === clientId)] = work; changed = true; }
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

function driveIdFromUrl(value) {
  return String(value || "").match(/(?:\/d\/|\/folders\/)([-\w]+)/)?.[1] || "";
}

async function syncWorkDocumentsFromDrive(work) {
  if (!driveConfigured()) throw new Error("Google Drive ainda não foi conectado no servidor.");
  const folderIds = [...new Set((work.documents || []).map(row => String(row.driveUrl || "")).filter(url => /\/folders\//i.test(url)).map(driveIdFromUrl).filter(Boolean))];
  if (!folderIds.length) throw new Error("Vincule uma pasta do Google Drive em um documento da obra antes de atualizar.");
  const knownIds = new Set((work.documents || []).map(row => driveIdFromUrl(row.driveUrl)).filter(Boolean));
  const files = [];
  for (const folderId of folderIds) files.push(...await listDriveTree(folderId));
  const uniqueFiles = [...new Map(files.filter(file => !file.mimeType?.endsWith("folder")).map(file => [file.id, file])).values()];
  const newFiles = uniqueFiles.filter(file => !knownIds.has(file.id));
  const importedAt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date());
  for (const file of newFiles) {
    work.documents.push({ id: uid("doc"), title: file.name || "Documento do Drive", required: false, status: "Aprovado", expiry: "", owner: "", notes: `Importado automaticamente do Google Drive em ${importedAt}.`, driveUrl: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`, files: [] });
  }
  work.updatedAt = isoNow();
  await saveWork(work);
  return { work, added: newFiles.length, checked: uniqueFiles.length };
}

function newQuote(options = {}) {
  const work = String(options.work || options.clientName || "Deterlimp");
  return {
    id: uid("cot"), status: "rascunho", createdAt: isoNow(), updatedAt: isoNow(),
    clientId: String(options.clientId || "deterlimp"), clientName: String(options.clientName || work),
    request: { number: "", category: "", date: new Date().toISOString().slice(0, 10), neededDate: "", costCenter: work.toUpperCase(), requester: "", work, items: [] },
    suppliers: [], files: [], divergences: [], generated: [], approval: null, purchaseOrders: []
  };
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" });
  res.end(body);
}

async function supabaseSyncRecords(records) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !records.length) return { synced: 0, configured: Boolean(url && key) };
  const response = await fetch(`${url}/rest/v1/drive_sync_records?on_conflict=client_id,drive_id`, {
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(records)
  });
  if (!response.ok) throw new Error(`Supabase respondeu ${response.status}`);
  return { synced: records.length, configured: true };
}
async function updateOrderInSheet(clientId, order) {
  const base = spreadsheetBases[cleanName(clientId)]; if (!base) throw new Error("Base deste cliente não configurada.");
  const read = await driveFetch(`https://sheets.googleapis.com/v4/spreadsheets/${base.id}/values/${encodeURIComponent("A:Z")}?majorDimension=ROWS`);
  const payload = await read.json(); const rows = payload.values || [], headers = rows.findIndex(row => row.some(cell => /status/i.test(String(cell))) && row.some(cell => /descri[cç][aã]o/i.test(String(cell))));
  if (headers < 0) throw new Error("Não encontrei os cabeçalhos da planilha.");
  const header = rows[headers].map(cell => norm(cell)); const col = name => header.findIndex(cell => cell === norm(name) || cell.includes(norm(name)));
  const numberCol = col("Nº do Pedido") >= 0 ? col("Nº do Pedido") : col("Numero do Pedido"), descriptionCol = col("Descrição"), statusCol = col("Status");
  const rowIndex = rows.findIndex((row, index) => index > headers && ((order.number && String(row[numberCol] || "").replace(/^0+/, "") === String(order.number).replace(/^0+/, "")) || (!order.number && norm(row[descriptionCol]) === norm(order.description))));
  if (rowIndex < 0) throw new Error("Não encontrei esse pedido na planilha.");
  const canonicalStatus = value => { const status = norm(value); if (["finalizado", "concluido", "concluida"].includes(status)) return "Concluído"; if (["cotacao", "em cotacao"].includes(status)) return "Em cotação"; return value || ""; };
  const updates = [{ range: `${String.fromCharCode(65 + statusCol)}${rowIndex + 1}`, values: [[canonicalStatus(order.status)]]}];
  for (const [field, label] of [["supplier","Fornecedor"],["delivery","Data da Entrega do Material"],["invoice","Nota Fiscal"],["payment","Pagamento"]]) { const index = col(label); if (index >= 0 && order[field] !== undefined) updates.push({ range: `${String.fromCharCode(65 + index)}${rowIndex + 1}`, values: [[order[field] || ""]] }); }
  const write = await driveFetch(`https://sheets.googleapis.com/v4/spreadsheets/${base.id}/values:batchUpdate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: updates }) });
  if (!write.ok) throw new Error(`Google Sheets respondeu ${write.status}.`); return { ok: true, row: rowIndex + 1, updated: updates.length };
}
async function normalizeOrderStatusesInSheet(clientId) {
  const base = spreadsheetBases[cleanName(clientId)]; if (!base) throw new Error("Base deste cliente não configurada.");
  const read = await driveFetch(`https://sheets.googleapis.com/v4/spreadsheets/${base.id}/values/${encodeURIComponent("A:Z")}?majorDimension=ROWS`);
  const payload = await read.json(), rows = payload.values || [], headers = rows.findIndex(row => row.some(cell => /status/i.test(String(cell))) && row.some(cell => /descri[cç][aã]o/i.test(String(cell))));
  if (headers < 0) throw new Error("Não encontrei os cabeçalhos da planilha.");
  const header = rows[headers].map(cell => norm(cell)), statusCol = header.findIndex(cell => cell === "status" || cell.includes("status"));
  if (statusCol < 0) throw new Error("Não encontrei a coluna Status.");
  const canonicalStatus = value => { const status = norm(value); if (["finalizado", "concluido", "concluida"].includes(status)) return "Concluído"; if (["cotacao", "em cotacao"].includes(status)) return "Em cotação"; return String(value || "").trim(); };
  const data = []; rows.slice(headers + 1).forEach((row, index) => { const oldValue = String(row[statusCol] || "").trim(), nextValue = canonicalStatus(oldValue); if (oldValue && nextValue !== oldValue) data.push({ range: `${String.fromCharCode(65 + statusCol)}${headers + index + 2}`, values: [[nextValue]] }); });
  if (data.length) { const write = await driveFetch(`https://sheets.googleapis.com/v4/spreadsheets/${base.id}/values:batchUpdate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }) }); if (!write.ok) throw new Error(`Google Sheets respondeu ${write.status}.`); }
  return { ok: true, clientId, updated: data.length };
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
  if (isVercel) {
    const workbook = XLSX.read(await fs.readFile(filePath), { type: "buffer", cellDates: true });
    const tables = workbook.SheetNames.map(name => XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: false, defval: "" }));
    return { text: tables.map(table => table.map(row => row.join(" | ")).join("\n")).join("\n"), tables, method: "planilha-node", confidence: 0.98 };
  }
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
  if (isVercel && ext === ".pdf") {
    const parsed = await pdfParse(await fs.readFile(filePath));
    const text = parsed.text || "";
    return { text, tables: [], method: text.replace(/\s/g, "").length >= 50 ? "pdf-texto-node" : "pdf-sem-texto", confidence: text.replace(/\s/g, "").length >= 50 ? 0.9 : 0.15 };
  }
  if (isVercel && [".txt", ".csv", ".tsv"].includes(ext)) {
    const text = await fs.readFile(filePath, "utf8");
    const separator = ext === ".tsv" ? "\t" : ",";
    const tables = ext === ".txt" ? [] : [text.split(/\r?\n/).filter(Boolean).map(line => line.split(separator))];
    return { text, tables, method: ext.slice(1), confidence: 0.95 };
  }
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

function compactTextRequestItems(text) {
  const items = [];
  const source = String(text);
  let cursor = 0;
  for (let expected = 1; expected <= 250; expected++) {
    const pattern = new RegExp(`^${expected}(\\d+(?:[.,]\\d+))\\s*(UN|BR|PC|PÇ|PCA|CX|KG|G|M|M2|M3|L|LT|RL|PAR)\\s*([\\s\\S]*?)(\\d{2}\\/\\d{2}\\/\\d{4})\\s*$`, "gmi");
    pattern.lastIndex = cursor;
    const match = pattern.exec(source);
    if (!match) break;
    const description = match[3].replace(/\s+/g, " ").trim();
    cursor = pattern.lastIndex;
    if (!description || /itemquantidade|descricao dos materiais/i.test(description)) continue;
    items.push({ id: uid("item"), number: expected, quantity: parseNumber(match[1]), unit: match[2].toUpperCase(), description, neededDate: match[4] });
  }
  return items;
}

function parseRequest(extraction) {
  const text = extraction.text || "";
  const n = norm(text);
  const extractedField = value => String(value || "").split("|").map(part => part.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const number = text.match(/N[°ºO]?\s*[:.-]?\s*(\d{1,5})/i)?.[1] || "";
  const date = text.match(/DATA\s*[:.-]?\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1] || "";
  const category = extractedField(text.match(/(?:AREA|ÁREA)\s+DE\s+SOLICITA(?:CAO|ÇÃO)\s*[:.-]?\s*([^\n]+)/i)?.[1]);
  const requester = text.match(/SOLICIT(?:ADO|DO)\s+POR\s*:?\s*\n?\s*([A-ZÁ-Ú ]{3,40})/i)?.[1]?.trim() || "";
  const costCenter = extractedField(text.match(/CENTRO\s+DE\s+CUSTO\s*[:.-]?\s*([^\n]+)/i)?.[1]) || "DETERLIMP";
  const items = tableRequestItems(extraction.tables);
  const normalizedCategory = category
    ? category[0].toUpperCase() + category.slice(1).toLowerCase()
    : (n.includes("hidraulica") ? "Hidráulica" : "");
  return {
    number, category: /^hidraulica$/i.test(normalizedCategory) ? "Hidráulica" : normalizedCategory,
    date, neededDate: items.find(item => item.neededDate)?.neededDate || "", costCenter, requester,
    work: costCenter || "Deterlimp", items: items.length ? items : (textRequestItems(text).length ? textRequestItems(text) : compactTextRequestItems(text)), rawText: text, extractionMethod: extraction.method, extractionConfidence: extraction.confidence
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
  const addItem = (description, quantity, unit, unitPrice, quotedTotal, confidence = 0, brand = "") => {
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
    items.push({ id: uid("qitem"), description: cleanDescription, quantity: qty, unit: resolvedUnit, unitPrice: resolvedUnitPrice, quotedTotal: resolvedTotal, brand, requestItemId: "", confidence, _key: key });
  };

  const splitTrailingBrand = value => {
    const clean = String(value || "").replace(/\s+/g, " ").trim();
    const match = clean.match(/(LORENZET(?:TI)?(?:\s+ELETRO)?|IMPERATRIZ|ENERBRAS|TIGRE|DECA|DOCOL|AMANCO|ASTRA|BLUKIT|ZAGONEL|FAME|REAL)(?:\s+[LM])?$/i);
    return match ? { description: clean.slice(0, match.index).trim(), brand: match[1].trim() } : { description: clean, brand: "" };
  };

  // O PDF da Nichele perde os espaços entre as colunas ao ser convertido em
  // texto. A sequência final permanece estável: unidade, quantidade, peso,
  // valor unitário e valor total. O número sequencial da linha evita confundir
  // o item 1 com o começo do código 112.796.
  if (/NICHELE\s+FILIAL|nichele\.com\.br/i.test(text)) {
    let expectedItem = 1;
    for (const line of lines) {
      if (!line.startsWith(String(expectedItem))) continue;
      const remainder = line.slice(String(expectedItem).length);
      const match = remainder.match(/^(\d{1,3}(?:\.\d{3})*)(.*?)(PC|UN|BR|PR|KT|TB|SC|CX)(\d+,\d{3})(\d+,\d{3})(\d{1,3}(?:\.\d{3})*,\d{2})(\d{1,3}(?:\.\d{3})*,\d{2})$/i);
      if (!match) continue;
      const product = splitTrailingBrand(match[2]);
      addItem(product.description, match[4], match[3].toUpperCase(), match[6], match[7], 0.97, product.brand);
      expectedItem += 1;
    }
    if (items.length) return items.map(({ _key, ...item }) => item);
  }

  // No PDF do Balaroti os valores podem ficar na linha anterior à descrição.
  // Este leitor une as linhas até o marcador de desconto 0,00 e preserva os
  // valores unitário/total que aparecem imediatamente após a unidade.
  if (/BALAROTI|SAC BALAROTI/i.test(text)) {
    const normalizedSource = norm(text);
    const sourcePosition = item => {
      const signature = norm(item.description || "").split(/\s+/).filter(Boolean).slice(0, 3).join(" ");
      return signature ? normalizedSource.indexOf(signature) : -1;
    };
    const finishBalarotiItems = () => items
      .sort((a, b) => {
        const aIndex = sourcePosition(a);
        const bIndex = sourcePosition(b);
        return (aIndex < 0 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex < 0 ? Number.MAX_SAFE_INTEGER : bIndex);
      })
      .map(({ _key, ...item }) => item);
    // Alguns PDFs recentes da Balaroti removem os espaços entre tamanho/marca,
    // quantidade, unidade e preço. Ex.: "5kgSuvinil2 GL234,91469,82".
    const compactPattern = /^(.*?)(\d+(?:[.,]\d+)?)\s+(PC|UN|TB|KT|BR|PR|SC|CX|RL|GL)\s*(\d{1,3}(?:\.\d{3})*,\d{2})(\d{1,3}(?:\.\d{3})*,\d{2})(?:\d+)?\s*-\s*(.*)$/i;
    for (let index = 0; index < lines.length; index++) {
      const compact = lines[index].match(compactPattern);
      if (!compact) continue;
      let description = compact[6].replace(/0,00\s*$/, "").trim();
      if (/^\d+\s*-/.test(description) && lines[index + 1]) description += ` ${lines[index + 1].trim()}`;
      addItem(description, compact[2], compact[3].toUpperCase(), compact[4], compact[5], 0.96, splitTrailingBrand(compact[1]).brand);
    }
    // Quando o código/descrição fica na linha seguinte, reaproveita os valores
    // da linha compacta e une até o marcador de desconto.
    const compactHeader = /^(.*?)(\d+(?:[.,]\d+)?)\s+(PC|UN|TB|KT|BR|PR|SC|CX|RL|GL)\s*(\d{1,3}(?:\.\d{3})*,\d{2})(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/i;
    for (let index = 0; index < lines.length; index++) {
      const header = lines[index].match(compactHeader);
      if (!header) continue;
      const parts = [];
      while (index + 1 < lines.length && parts.length < 5) {
        const next = lines[++index];
        if (/^0,00$/.test(next)) break;
        parts.push(next);
      }
      const description = parts.join(" ").replace(/^\d+\s*-\s*/, "").trim();
      if (description) addItem(description, header[2], header[3].toUpperCase(), header[4], header[5], 0.96, splitTrailingBrand(header[1]).brand);
    }
    if (items.length) return finishBalarotiItems();
    const headerPattern = /^(.*?)(\d+(?:[.,]\d+)?)\s+(PC|UN|TB|KT|BR|PR|SC|CX)\s*(\d{1,3}(?:\.\d{3})*,\d{2})(\d{1,3}(?:\.\d{3})*,\d{2})(.*)$/i;
    for (let index = 0; index < lines.length; index++) {
      const match = lines[index].match(headerPattern);
      if (!match) continue;
      const product = splitTrailingBrand(match[1]);
      const descriptionParts = [];
      let tail = String(match[6] || "").trim();
      let ended = /0,00\s*$/.test(tail);
      if (tail) descriptionParts.push(tail);
      while (!ended && index + 1 < lines.length && descriptionParts.length < 5) {
        const next = lines[index + 1];
        if (headerPattern.test(next) || /^(?:Hora Emiss[aã]o|Data Emiss[aã]o|P[aá]gina:|Loja:|Pedido:|Cliente:)/i.test(next)) break;
        index += 1;
        if (/^0,00$/.test(next)) { ended = true; break; }
        descriptionParts.push(next);
        ended = /0,00\s*$/.test(next);
      }
      const description = descriptionParts.join(" ").replace(/^\d+\s*-\s*/, "").replace(/0,00\s*$/, "").trim();
      if (description) addItem(description, match[2], match[3].toUpperCase(), match[4], match[5], 0.97, product.brand);
    }
    if (items.length) return finishBalarotiItems();
  }

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
  const balarotiSummary = text.match(/Frete:\s*(?:Total\s+do\s+Or[çc]amento:\s*)?(?:R\$\s*)?([\d.]+,\d{2})[\s\r\n]+(?:Total\s+do\s+Or[çc]amento:\s*)?R\$\s*([\d.]+,\d{2})/i);
  const nicheleCharges = text.match(/Valor\s+TC\s+Out\.\s*desp\.\s*man\s*([\d.]+,\d{2})\s+([\d.]+,\d{2})/i);
  const parsedFreight = balarotiSummary ? money(balarotiSummary[1]) : (freightIncluded ? 0 : money(freightMatch?.[1]));
  const otherCharges = nicheleCharges ? money(nicheleCharges[2]) : money(text.match(/(?:OUTRAS|OUTRAS\s+DESPESAS|ACR[EÉ]SCIMOS)\s*:?\s*(?:R\$\s*)?([\d.]+,\d{2})/i)?.[1]);
  const officialTotalMatch = text.match(/TOTAL\s+GERAL\s*:?\s*(?:R\$|A\$)?\s*([\d.]+,\d{2})/i) || text.match(/(?:TOTAL\s+(?:DA\s+PROPOSTA|DO\s+OR[CÇ]AMENTO|L[IÍ]QUIDO)|VALOR\s+TOTAL)\s*:?\s*(?:R\$|A\$)?\s*([\d.]+,\d{2})/i);
  const officialTotal = balarotiSummary ? money(balarotiSummary[2]) : (money(officialTotalMatch?.[1]) || Number(current.officialTotal || 0));
  const discounts = [...text.matchAll(/(?:DESCONTO(?:\s+(?:PIX|D[EÉ]BITO|A VISTA))?|PIX|D[EÉ]BITO|A VISTA)\s*(\d+(?:[.,]\d+)?)\s*%[^\n]*(?:R\$\s*)?([\d.]+,\d{2})?/gi)].map(match => ({ label: match[0].trim(), percent: parseNumber(match[1]), amount: match[2] ? money(match[2]) : 0 }));
  return {
    ...current,
    name: current.name || firstMeaningfulLine(text), seller,
    payment, delivery, validity, freight: parsedFreight, freightIncluded, otherCharges, officialTotal,
    discount: current.discount || 0, discounts, notes: current.notes || "", rawText: text,
    extractionMethod: extraction.method, extractionConfidence: extraction.confidence,
    items: items.length ? items : textQuoteItems(text)
  };
}

function canonicalMatchText(value) {
  return norm(value)
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:mm|cm|m)?\s*x\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?/g, "$1x$2$3")
    .replace(/(\d+)\s*(v|w)\b/g, "$1$2")
    .replace(/\bengante\b|\beng\b/g, "engate")
    .replace(/\bflex\b/g, "flexivel")
    .replace(/\bemb\b/g, "embutir")
    .replace(/\buniv\b/g, "universal")
    .replace(/\bbraco\b/g, "cano")
    .replace(/\bducha\b/g, "chuveiro")
    .replace(/\bchuv\b/g, "chuveiro")
    .replace(/\bacab\b/g, "acabamento")
    .replace(/\breg\b/g, "registro")
    .replace(/\btorn\b/g, "torneira")
    .replace(/\blavat\b/g, "lavatorio")
    .replace(/\bsanf\b/g, "sanfonado")
    .replace(/\bajust\b/g, "ajustavel")
    .replace(/\bespude\b/g, "spud")
    .replace(/\btb\b/g, "tubo")
    .replace(/\blig\b/g, "ligacao")
    .replace(/\bvalv\b/g, "valvula")
    .replace(/\bescoam\b/g, "escoamento")
    .replace(/\bplast\b/g, "plastico")
    .replace(/\bparaf\b/g, "parafuso")
    .replace(/\bbuc\b/g, "bucha")
    .replace(/\bwc\b/g, "vaso sanitario")
    .replace(/\bsold\b/g, "soldavel")
    .replace(/\bveda rosca\b/g, "fita veda rosca")
    .replace(/\bbco\b|\bbr\b/g, "branco")
    .replace(/\bcr\b/g, "cromado")
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
function primaryProductKind(value) {
  const canonical = canonicalMatchText(value);
  const kinds = ["engate", "cano", "chuveiro", "mictorio", "bacia", "cuba", "registro", "torneira", "sifao", "anel", "spud", "tubo", "assento", "valvula", "parafuso", "fita"];
  return kinds.map(kind => ({ kind, index: canonical.search(new RegExp(`\\b${kind}\\b`)) })).filter(row => row.index >= 0).sort((a, b) => a.index - b.index)[0]?.kind || "";
}
function technicalQualifier(value) {
  const canonical = canonicalMatchText(value).replace(/\bespude\b/g, "spud");
  return ["mictorio", "lavatorio", "bacia", "chuveiro", "cuba"].find(kind => new RegExp(`\\b${kind}\\b`).test(canonical)) || "";
}
function incompatibleProducts(a, b) {
  const kindA = primaryProductKind(a), kindB = primaryProductKind(b);
  if (kindA && kindB && kindA !== kindB) return true;
  if (kindA === "valvula" && kindA === kindB) {
    const qualifierA = technicalQualifier(a), qualifierB = technicalQualifier(b);
    return Boolean(qualifierA && qualifierB && qualifierA !== qualifierB);
  }
  return false;
}
function similarity(a, b) {
  const ta = tokens(a), tb = tokens(b); if (!ta.size || !tb.size) return 0;
  const intersection = [...ta].filter(token => tb.has(token)).length;
  const union = new Set([...ta, ...tb]).size;
  const specsA = canonicalMatchText(a).match(/\d+(?:[.,]\d+)?\s*(?:mm|cm|m|kg|v|w)|\d+(?:[.,]\d+)?x\d+(?:[.,]\d+)?/g) || [];
  const specsB = canonicalMatchText(b).match(/\d+(?:[.,]\d+)?\s*(?:mm|cm|m|kg|v|w)|\d+(?:[.,]\d+)?x\d+(?:[.,]\d+)?/g) || [];
  const sharedSpecs = specsA.filter(spec => specsB.includes(spec)).length;
  const lexicalScore = intersection / union;
  let score = lexicalScore;
  if (specsA.length && specsB.length) score = sharedSpecs ? lexicalScore * 0.7 + sharedSpecs / Math.min(specsA.length, specsB.length) * 0.3 : Math.min(0.18, lexicalScore * 0.35);
  const kindA = primaryProductKind(a), kindB = primaryProductKind(b);
  if (kindA && kindB && kindA !== kindB) return Math.min(0.18, score * 0.3);
  if (kindA && kindA === kindB) score += 0.12;
  return Math.min(1, score);
}

function comparableUnit(unit) {
  return norm(unit).replace(/^(?:kgs?|quilo(?:s)?)$/, "kg").replace(/^(?:gr?|grama(?:s)?)$/, "g").replace(/^(?:me|mt|ml|m|metro(?:s)?)$/, "m").replace(/^(?:cm|centimetro(?:s)?)$/, "cm").replace(/^(?:mm|milimetro(?:s)?)$/, "mm").replace(/^(?:pc|un|und|pca)$/, "un");
}

function productFamily(value) {
  const text = canonicalMatchText(value);
  if (/cimento queimado/.test(text)) return "cimento-queimado";
  if (/\blona\b/.test(text)) return "lona";
  if (/fita crepe/.test(text)) return "fita-crepe";
  if (/(?:silicone|selante).*\bpu\b|\bpu\b.*(?:silicone|selante)/.test(text)) return "selante-pu";
  return "";
}

function quantityFactor(fromUnit, toUnit) {
  const from = comparableUnit(fromUnit), to = comparableUnit(toUnit);
  if (from === to) return 1;
  const factors = { kg: 1000, g: 1, m: 1000, cm: 10, mm: 1 };
  if (!(from in factors) || !(to in factors)) return 0;
  const sameDimension = (["kg", "g"].includes(from) && ["kg", "g"].includes(to)) || (["m", "cm", "mm"].includes(from) && ["m", "cm", "mm"].includes(to));
  return sameDimension ? factors[from] / factors[to] : 0;
}

function commercialEquivalence(item, requestItem) {
  const requestedUnit = comparableUnit(requestItem.unit), description = canonicalMatchText(item.description);
  const dimension = description.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(mm|cm|m)\b/i);
  if (dimension && requestedUnit === "m") {
    const sides = [Number(dimension[1]), Number(dimension[2])];
    const equivalentQuantity = Math.max(...sides) * quantityFactor(dimension[3], requestedUnit);
    const equivalentUnitPrice = equivalentQuantity ? Number((Number(item.quotedTotal || Number(item.quantity || 0) * Number(item.unitPrice || 0)) / equivalentQuantity).toFixed(4)) : null;
    const status = Math.abs(equivalentQuantity - Number(requestItem.quantity || 0)) < 0.0001 ? "SATISFIED" : "REVIEW_REQUIRED";
    return { status, packageQuantity: null, packageUnit: "", equivalentQuantity, equivalentUnit: requestItem.unit, equivalentUnitPrice, note: `${item.quantity} ${item.unit} de ${item.description} (${dimension[1]} × ${dimension[2]} ${dimension[3]}) equivale a ${equivalentQuantity} ${requestItem.unit}.` };
  }
  const packageMatch = description.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(kg|g|m|cm|mm|l|ml)\b/i);
  if (packageMatch) {
    const packageQuantity = Number(packageMatch[1]), packageUnit = comparableUnit(packageMatch[2]), factor = quantityFactor(packageUnit, requestedUnit);
    if (factor) {
      const equivalentQuantity = Number((Number(item.quantity || 0) * packageQuantity * factor).toFixed(4));
      const equivalentUnitPrice = equivalentQuantity ? Number((Number(item.quotedTotal || Number(item.quantity || 0) * Number(item.unitPrice || 0)) / equivalentQuantity).toFixed(4)) : null;
      const status = Math.abs(equivalentQuantity - Number(requestItem.quantity || 0)) < 0.0001 ? "SATISFIED" : equivalentQuantity < Number(requestItem.quantity || 0) ? "INSUFFICIENT" : "EXCESS";
      return { status, packageQuantity, packageUnit, equivalentQuantity, equivalentUnit: requestItem.unit, equivalentUnitPrice, note: `${item.quantity} ${item.unit} × ${packageQuantity} ${packageUnit} = ${equivalentQuantity} ${requestItem.unit} solicitados.` };
    }
  }
  if (comparableUnit(item.unit) === requestedUnit && Number(item.quantity || 0)) {
    const equivalentQuantity = Number(item.quantity), equivalentUnitPrice = Number(item.unitPrice || 0);
    return { status: Math.abs(equivalentQuantity - Number(requestItem.quantity || 0)) < 0.0001 ? "SATISFIED" : equivalentQuantity < Number(requestItem.quantity || 0) ? "INSUFFICIENT" : "EXCESS", packageQuantity: null, packageUnit: "", equivalentQuantity, equivalentUnit: requestItem.unit, equivalentUnitPrice, note: "Quantidade comercial na mesma unidade do pedido." };
  }
  return { status: "REVIEW_REQUIRED", packageQuantity: null, packageUnit: "", equivalentQuantity: null, equivalentUnit: requestItem.unit, equivalentUnitPrice: null, note: `Unidade comercial ${item.quantity} ${item.unit || ""} precisa de validação para atender ${requestItem.quantity} ${requestItem.unit}.` };
}

function effectiveUnitPrice(item, requestItem) {
  return Number(item?.equivalence?.equivalentUnitPrice || item?.unitPrice || 0);
}

function effectiveItemTotal(item, requestItem) {
  return Number((effectiveUnitPrice(item, requestItem) * Number(requestItem?.quantity || 0)).toFixed(2));
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
      let best = { score: -1, item: null };
      const lockedRequest = item.lockedMatch && item.requestItemId ? requestItems.find(row => row.id === item.requestItemId) : null;
      if (lockedRequest) best = { score: 1, item: lockedRequest };
      const compositeRequest = requestItems.length === 1 || requestItems.length < (supplier.items || []).length;
      for (const requestItem of lockedRequest ? [] : requestItems) {
        if (matched.has(requestItem.id) && !compositeRequest) continue;
        if (incompatibleProducts(item.description, requestItem.description)) continue;
        let score = similarity(item.description, requestItem.description);
        const itemFamily = productFamily(item.description), requestFamily = productFamily(requestItem.description);
        if (itemFamily && itemFamily === requestFamily) score += 0.42;
        if (item.quantity && requestItem.quantity && Math.abs(item.quantity - requestItem.quantity) < 0.0001) score += 0.12;
        if (item.unit && requestItem.unit && comparableUnit(item.unit) === comparableUnit(requestItem.unit)) score += 0.08;
        score = Math.min(1, score);
        if (score > best.score) best = { score, item: requestItem };
      }
      if (requestItems.length === 1 && supplier.items.length === 1) best = { score: Math.max(best.score, 0.88), item: requestItems[0] };
      item.requestItemId = (compositeRequest && best.item) || best.score >= 0.42 ? best.item?.id || "" : "";
      item.confidence = Number((compositeRequest && best.item ? Math.max(best.score, 0.72) : best.score).toFixed(2));
      if (!item.requestItemId) {
        divergences.push({ id: `${supplier.id}:${item.id}:unmatched`, supplierId: supplier.id, itemId: item.id, type: item.extra ? "extra" : "unmatched", severity: item.extra ? "warning" : "blocking", message: item.extra ? `Item extra de ${supplier.name || "fornecedor"}: “${item.description}”.` : `Item “${item.description}” não foi relacionado ao pedido.`, resolved: Boolean(item.extra) });
        continue;
      }
      matched.add(item.requestItemId);
      const requestItem = requestItems.find(row => row.id === item.requestItemId);
      const equivalence = commercialEquivalence(item, requestItem);
      item.equivalence = equivalence;
      if (equivalence.status === "REVIEW_REQUIRED") divergences.push({ id: `${supplier.id}:${item.id}:equivalence`, supplierId: supplier.id, itemId: item.id, requestItemId: requestItem.id, type: "equivalence", severity: "blocking", message: `${requestItem.description}: ${equivalence.note}`, resolved: false });
      if (["INSUFFICIENT", "EXCESS"].includes(equivalence.status)) divergences.push({ id: `${supplier.id}:${item.id}:quantity`, supplierId: supplier.id, itemId: item.id, requestItemId: requestItem.id, type: "quantity", severity: "blocking", message: `${requestItem.description}: pedido ${requestItem.quantity} ${requestItem.unit}; fornecedor atende ${equivalence.equivalentQuantity} ${requestItem.unit}. ${equivalence.status === "INSUFFICIENT" ? "Quantidade cotada insuficiente." : "Quantidade cotada superior à solicitada."}`, resolved: false });
      if (item.confidence < 0.62) divergences.push({ id: `${supplier.id}:${item.id}:confidence`, supplierId: supplier.id, itemId: item.id, requestItemId: requestItem.id, type: "confidence", severity: "blocking", message: `Confirme a correspondência de “${item.description}” com “${requestItem.description}”.`, resolved: false });
    }
    for (const requestItem of requestItems) if (!matched.has(requestItem.id)) divergences.push({ id: `${supplier.id}:${requestItem.id}:missing`, supplierId: supplier.id, requestItemId: requestItem.id, type: "missing", severity: "warning", message: `${supplier.name || "Fornecedor"} não cotou “${requestItem.description}”.`, resolved: true });
    const mappedItemsTotal = (supplier.items || []).reduce((sum, item) => item.requestItemId ? sum + Number(item.quotedTotal || (Number(item.quantity || 0) * Number(item.unitPrice || 0))) : sum, 0);
    supplier.mappedItemsTotal = Number(mappedItemsTotal.toFixed(2));
    if (supplier.officialTotal > 0) {
      const expected = mappedItemsTotal + (supplier.freightIncluded ? 0 : Number(supplier.freight || 0)) + Number(supplier.otherCharges || 0) - Number(supplier.discount || 0);
      supplier.reconciliationDifference = Number((supplier.officialTotal - expected).toFixed(2));
      if (Math.abs(supplier.reconciliationDifference) > 0.05) divergences.push({ id: `${supplier.id}:total-reconciliation`, supplierId: supplier.id, type: "total", severity: "warning", message: `${supplier.name || "Fornecedor"}: total oficial ${supplier.officialTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}, mas itens mapeados e ajustes somam ${expected.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}. Diferença de ${supplier.reconciliationDifference.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.`, resolved: true });
    } else supplier.reconciliationDifference = null;
  }
  const previous = new Map((quote.divergences || []).map(row => [row.id, row.resolved]));
  quote.divergences = divergences.map(row => ({ ...row, resolved: previous.get(row.id) ?? row.resolved }));
  quote.status = quote.request.items?.length ? (quote.suppliers.length ? (quote.divergences.some(row => row.severity === "blocking" && !row.resolved) ? "conferência" : "pronto") : "aguardando orçamentos") : "rascunho";
  return quote;
}

function relatedSupplierItem(supplier, requestItem) {
  const matches = (supplier.items || []).filter(item => item.requestItemId === requestItem.id);
  if (matches.length <= 1) return matches[0];
  const quotedTotal = matches.reduce((sum, item) => sum + Number(item.quotedTotal || Number(item.quantity || 0) * Number(item.unitPrice || 0)), 0);
  return { ...matches[0], description: matches.map(item => item.description).join(" • "), quotedTotal, unitPrice: quotedTotal / Math.max(1, Number(requestItem.quantity || 1)), quantity: Number(requestItem.quantity || 1), confidence: Math.min(...matches.map(item => Number(item.confidence || 0))) };
}

function excelCol(index) { let result = ""; for (let n = index; n; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result; return result; }
async function buildWorkbookFromDriveTemplate(quote, targetPath) {
  const template = quote.request.mapTemplate;
  const response = await driveFetch(`https://www.googleapis.com/drive/v3/files/${template.driveId}?alt=media`);
  await fs.writeFile(targetPath, Buffer.from(await response.arrayBuffer()));
  const workbook = XLSX.readFile(targetPath, { cellStyles: true, cellFormula: true, cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const originalCells = { ...sheet };
  const templateItemCount = 17, itemCount = Math.max(1, quote.request.items?.length || 0), delta = itemCount - templateItemCount;
  const moved = {};
  for (const [address, cell] of Object.entries(sheet)) {
    if (address.startsWith("!")) continue;
    const decoded = XLSX.utils.decode_cell(address);
    if (decoded.r >= 23) moved[XLSX.utils.encode_cell({ r: decoded.r + delta, c: decoded.c })] = cell;
    else if (decoded.r < 6) moved[address] = cell;
  }
  const styleCell = (source, value, type) => {
    const base = originalCells[source] || {};
    const cell = { ...base, v: value };
    delete cell.f; delete cell.w;
    if (type) cell.t = type; else if (typeof value === "number") cell.t = "n"; else cell.t = "s";
    return cell;
  };
  Object.keys(sheet).filter(key => !key.startsWith("!")).forEach(key => delete sheet[key]);
  Object.assign(sheet, moved);
  const summaryStart = 6 + itemCount;
  sheet.D1 = styleCell("D1", "PLANILHA ORÇAMENTÁRIA ");
  sheet.D2 = styleCell("D2", quote.request.date ? new Date(`${String(quote.request.date).slice(0,10)}T12:00:00`) : new Date(), "d");
  sheet.D3 = styleCell("D3", `OBRA: ${String(quote.request.work || quote.clientName || "ABSOLUTTA").toUpperCase()}`);
  const suppliers = (quote.suppliers || []).slice(0, 3);
  ["E3","G3","I3"].forEach((address, index) => { sheet[address] = styleCell("E3", suppliers[index]?.name || ""); });
  const itemStyles = ["A7","B7","C7","D7","E7","F7","G7","H7","I7","J7","K7","L7"];
  (quote.request.items || []).forEach((requestItem, index) => {
    const row = 7 + index;
    const values = [requestItem.number || index + 1, Number(requestItem.quantity || 0), requestItem.unit || "UN", requestItem.description || ""];
    suppliers.forEach(supplier => {
      const match = relatedSupplierItem(supplier, requestItem);
      const unit = match ? effectiveUnitPrice(match, requestItem) : 0; values.push(unit || "", unit ? effectiveItemTotal(match, requestItem) : "");
    });
    while (values.length < 10) values.push("", "");
    const totals = [values[5], values[7], values[9]].filter(value => typeof value === "number" && value > 0);
    const minimum = totals.length ? Math.min(...totals) : "";
    values.push(minimum ? minimum / Number(requestItem.quantity || 1) : "", minimum);
    values.forEach((value, column) => { sheet[XLSX.utils.encode_cell({ r: row - 1, c: column })] = styleCell(itemStyles[column], value); });
  });
  const labels = ["VALOR TOTAL","FRETE","CONDIÇÕES DE PAGAMENTO","DESCONTO À VISTA","VALOR PAGAMENTO À VISTA"];
  labels.forEach((label, index) => { sheet[`A${summaryStart + index}`] = styleCell(`A${24 + index}`, label); });
  suppliers.forEach((supplier, index) => {
    const column = ["E","G","I"][index];
    const itemTotal = (quote.request.items || []).reduce((sum, requestItem) => { const match = relatedSupplierItem(supplier, requestItem); return sum + Number(match?.quotedTotal || Number(match?.unitPrice || 0) * Number(requestItem.quantity || 0)); }, 0);
    const freight = supplier.freightIncluded ? 0 : Number(supplier.freight || 0), discount = Number(supplier.discount || 0), other = Number(supplier.otherCharges || 0);
    [itemTotal, freight + other, supplier.payment || "Não informado", discount, itemTotal + freight + other - discount].forEach((value, rowIndex) => { sheet[`${column}${summaryStart + rowIndex}`] = styleCell(`E${24 + rowIndex}`, value); });
    sheet[`${column}${summaryStart + 6}`] = styleCell("E30", supplier.notes || [supplier.delivery && `Entrega: ${supplier.delivery}`, supplier.validity && `Validade: ${supplier.validity}`].filter(Boolean).join(" • "));
  });
  sheet[`K${summaryStart}`] = styleCell("K24", "N/C"); sheet[`K${summaryStart + 4}`] = styleCell("K28", "N/C");
  sheet[`K${summaryStart + 6}`] = styleCell("K30", `Mapa gerado automaticamente a partir do pedido ${quote.request.number || ""} e dos orçamentos relacionados.`);
  sheet["!merges"] = (sheet["!merges"] || []).map(merge => merge.s.r >= 23 ? { s: { ...merge.s, r: merge.s.r + delta }, e: { ...merge.e, r: merge.e.r + delta } } : merge).filter(merge => merge.e.r < summaryStart + 8);
  sheet["!ref"] = `A1:L${summaryStart + 7}`;
  XLSX.writeFile(workbook, targetPath, { bookType: "xlsx", cellStyles: true });
  return { previewPath: "", errors: "", inspection: "modelo-drive" };
}
async function buildWorkbookNode(quote, targetPath) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Absolutta Dashboard";
  const sheet = workbook.addWorksheet("Mapa de Cotação", { views: [{ state: "frozen", ySplit: 7 }] });
  const suppliers = quote.suppliers || [];
  const columns = [
    { header: "ITEM", key: "item", width: 9 }, { header: "DESCRIÇÃO", key: "description", width: 52 },
    { header: "UNID.", key: "unit", width: 10 }, { header: "QTDE.", key: "quantity", width: 11 }
  ];
  suppliers.forEach((supplier, index) => { columns.push({ header: `${supplier.name || `FORNECEDOR ${index + 1}`} | UNIT.`, key: `s${index}u`, width: 17 }); columns.push({ header: "TOTAL", key: `s${index}t`, width: 17 }); });
  columns.push({ header: "MENOR TOTAL", key: "best", width: 18 }, { header: "MELHOR FORNECEDOR", key: "winner", width: 24 });
  sheet.columns = columns;
  sheet.insertRows(1, [[quote.clientName || quote.request.work || "ABSOLUTTA"], ["MAPA DE COTAÇÃO"], [`Pedido ${quote.request.category || ""} ${quote.request.number || ""}`], [`Solicitante: ${quote.request.requester || "Não informado"}`], [`Data: ${displayDate(quote.request.date)}`], []]);
  sheet.mergeCells(1, 1, 1, columns.length); sheet.mergeCells(2, 1, 2, columns.length); sheet.mergeCells(3, 1, 3, columns.length); sheet.mergeCells(4, 1, 4, columns.length); sheet.mergeCells(5, 1, 5, columns.length);
  const headerRow = 7;
  (quote.request.items || []).forEach((requestItem, index) => {
    const row = sheet.addRow({ item: requestItem.number || index + 1, description: requestItem.description, unit: requestItem.unit || "UN", quantity: Number(requestItem.quantity || 0) });
    const totalCells = [];
    suppliers.forEach((supplier, supplierIndex) => {
      const match = relatedSupplierItem(supplier, requestItem);
      const unitColumn = 5 + supplierIndex * 2, totalColumn = unitColumn + 1;
      const comparableUnitPrice = match ? effectiveUnitPrice(match, requestItem) : 0;
      if (match && comparableUnitPrice > 0) { row.getCell(unitColumn).value = comparableUnitPrice; row.getCell(totalColumn).value = { formula: `${row.getCell(4).address}*${row.getCell(unitColumn).address}` }; totalCells.push(row.getCell(totalColumn).address); }
    });
    const bestColumn = 5 + suppliers.length * 2;
    if (totalCells.length) { row.getCell(bestColumn).value = { formula: `MIN(${totalCells.join(",")})` }; row.getCell(bestColumn + 1).value = suppliers.map((supplier, supplierIndex) => `IF(${row.getCell(6 + supplierIndex * 2).address}=${row.getCell(bestColumn).address},"${String(supplier.name || "").replaceAll('"', '""')}","")`).join("&"); row.getCell(bestColumn + 1).value = { formula: row.getCell(bestColumn + 1).value }; }
  });
  const lastRow = sheet.lastRow.number;
  const total = sheet.addRow(["", "TOTAL POR FORNECEDOR"]);
  suppliers.forEach((supplier, index) => { const col = 6 + index * 2; total.getCell(col).value = { formula: `SUM(${sheet.getCell(headerRow + 1, col).address}:${sheet.getCell(lastRow, col).address})+${Number(supplier.freightIncluded ? 0 : supplier.freight || 0)}+${Number(supplier.otherCharges || 0)}-${Number(supplier.discount || 0)}` }; });
  sheet.getRow(1).font = { bold: true, size: 15, color: { argb: "FFFFFFFF" } }; sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF172033" } };
  sheet.getRow(2).font = { bold: true, size: 18, color: { argb: "FF172033" } }; sheet.getRow(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFA7C63B" } };
  sheet.getRow(headerRow).eachCell(cell => { cell.font = { bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF172033" } }; cell.alignment = { wrapText: true, vertical: "middle", horizontal: "center" }; });
  sheet.eachRow((row, number) => { if (number >= headerRow) row.eachCell(cell => { cell.border = { top: { style: "thin", color: { argb: "FFB8BEC8" } }, left: { style: "thin", color: { argb: "FFB8BEC8" } }, bottom: { style: "thin", color: { argb: "FFB8BEC8" } }, right: { style: "thin", color: { argb: "FFB8BEC8" } } }; }); });
  for (let col = 5; col <= columns.length - 2; col++) sheet.getColumn(col).numFmt = '"R$" #,##0.00';
  await workbook.xlsx.writeFile(targetPath);
  return { previewPath: "", errors: "", inspection: "exceljs" };
}

async function buildWorkbook(quote, targetPath) {
  if (quote.request.mapTemplate?.driveId && driveConfigured() && (quote.suppliers || []).length <= 3) return buildWorkbookFromDriveTemplate(quote, targetPath);
  if (isVercel) return buildWorkbookNode(quote, targetPath);
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
      const qItem = relatedSupplierItem(supplier, requestItem);
      const unitCol = excelCol(5 + supplierIndex * 2), totalCol = excelCol(6 + supplierIndex * 2);
      const comparableUnitPrice = qItem ? effectiveUnitPrice(qItem, requestItem) : 0;
      if (comparableUnitPrice > 0) {
        sheet.getRange(`${unitCol}${row}`).values = [[comparableUnitPrice]];
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

function purchaseOrderCustomer(quote) {
  if ((quote.clientId || "").toLowerCase() === "deterlimp") return {
    legalName: "DETERLIMP INDUSTRIAL LIMPEZA E COSMETICO LTDA",
    document: "01.300.954/0001-82",
    billingAddress: "Avenida das Cerejeiras, 619 - Capela Velha",
    deliveryAddress: "Avenida das Cerejeiras, 619 - Capela Velha",
    city: "Araucária - PR",
    zipCode: "83705-340",
    receiver: "A confirmar",
    buyer: "Brendon"
  };
  return {
    legalName: quote.clientName || quote.request.work || "Cliente",
    document: "A confirmar", billingAddress: "A confirmar",
    deliveryAddress: "A confirmar", city: "", zipCode: "",
    receiver: "A confirmar", buyer: "Brendon"
  };
}

async function buildPurchaseOrderWorkbookNode(quote, supplier, targetPath) {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Ordem de Compra", { views: [{ state: "frozen", ySplit: 18 }] });
  const customer = purchaseOrderCustomer(quote); const requestItems = quote.request.items || [];
  const selected = (supplier.items || []).map(item => ({ item, request: requestItems.find(row => row.id === item.requestItemId) })).filter(row => row.request && Number(row.item.unitPrice) > 0);
  sheet.columns = [{ width: 10 }, { width: 52 }, { width: 11 }, { width: 11 }, { width: 18 }, { width: 18 }];
  const mergeSet = (range, value) => { sheet.mergeCells(range); sheet.getCell(range.split(":")[0]).value = value; };
  mergeSet("A1:F1", customer.legalName); mergeSet("A2:F2", customer.billingAddress); mergeSet("A3:F3", `CNPJ/CPF: ${customer.document}`);
  sheet.getCell("E5").value = "DATA:"; sheet.getCell("F5").value = new Date(); sheet.getCell("F5").numFmt = "dd/mm/yyyy";
  sheet.getCell("E7").value = "COMPRADOR:"; sheet.getCell("F7").value = customer.buyer; sheet.getCell("E9").value = "N. SOLICITAÇÃO:"; sheet.getCell("F9").value = String(quote.request.number || quote.id);
  mergeSet("A11:F11", "ORDEM DE COMPRA");
  [[13,"OBRA:",quote.request.work || quote.clientName || ""],[14,"ENDEREÇO PARA ENTREGA:",`${customer.deliveryAddress}${customer.city ? ` — ${customer.city}` : ""}`],[15,"ADICIONAR NÚMERO DA O.C. NA NOTA FISCAL:",String(quote.request.number || quote.id)],[16,"RECEBIMENTO DE MATERIAL COM:",customer.receiver]].forEach(([row,label,value]) => { mergeSet(`A${row}:B${row}`, label); mergeSet(`C${row}:F${row}`, value); });
  sheet.getRow(18).values = ["ITEM","DESCRIÇÃO","UNID.","QTDE.","VALOR UNIT.","VALOR TOTAL"];
  let rowNumber = 19;
  selected.forEach(({ item, request }, index) => { const row = sheet.getRow(rowNumber++); row.values = [index + 1, `${request.description}${item.brand ? ` — ${item.brand}` : ""}`, request.unit || "UN", Number(request.quantity || 0), Number(item.unitPrice || 0), { formula: `D${row.number}*E${row.number}` }]; });
  const addCharge = (description, value) => { if (!Number(value)) return; const row = sheet.getRow(rowNumber++); row.values = [rowNumber - 19, description, "UN", 1, Number(value), { formula: `D${row.number}*E${row.number}` }]; };
  if (!supplier.freightIncluded) addCharge("FRETE", supplier.freight); addCharge("OUTRAS DESPESAS", supplier.otherCharges); addCharge("DESCONTO", -Number(supplier.discount || 0));
  const lastItemRow = rowNumber - 1, totalRow = Math.max(36, rowNumber + 1);
  sheet.getCell(`E${totalRow}`).value = "TOTAL GERAL"; sheet.getCell(`F${totalRow}`).value = { formula: `SUM(F19:F${lastItemRow})` };
  sheet.getCell(`E${totalRow + 2}`).value = "FORNECEDOR:"; sheet.getCell(`F${totalRow + 2}`).value = supplier.name || ""; sheet.getCell(`E${totalRow + 3}`).value = "CONTATO:"; sheet.getCell(`F${totalRow + 3}`).value = supplier.seller || ""; sheet.getCell(`E${totalRow + 4}`).value = "TELEFONE:"; sheet.getCell(`F${totalRow + 4}`).value = supplier.phone || "A confirmar";
  const commercialHeader = totalRow + 6; sheet.getRow(commercialHeader).values = ["O.C.","FORNECEDOR","VALOR","","DATA ENTREGA","PAGAMENTO"]; sheet.getRow(commercialHeader + 1).values = [String(quote.request.number || quote.id), supplier.name || "", { formula: `F${totalRow}` }, "", supplier.delivery || "Não informado", supplier.payment || "Não informado"];
  const notesRow = commercialHeader + 4; mergeSet(`A${notesRow}:F${notesRow}`, "OBSERVAÇÕES:"); [`Dados para faturamento: ${customer.legalName} — CNPJ/CPF: ${customer.document}`,`Prazo de entrega: ${supplier.delivery || "Não informado"}`,`Endereço para entrega: ${customer.deliveryAddress}${customer.city ? ` — ${customer.city}` : ""}`,`Validade do orçamento: ${supplier.validity || "Não informado"}`,`Observação da aprovação: ${quote.approval?.notes || "Sem observações"}`].forEach((note,index)=>mergeSet(`A${notesRow + 1 + index}:F${notesRow + 1 + index}`,note));
  [[1,"FF172033","FFFFFFFF",15],[11,"FFA7C63B","FF172033",18],[18,"FF172033","FFFFFFFF",10],[commercialHeader,"FFE8EBF0","FF172033",10],[notesRow,"FFE8EBF0","FF172033",10]].forEach(([row,fill,color,size])=>{ sheet.getRow(row).eachCell(cell=>{cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:fill}};cell.font={bold:true,size,color:{argb:color}};cell.alignment={vertical:"middle",horizontal:"center",wrapText:true};}); });
  sheet.getCell(`E${totalRow}`).font = sheet.getCell(`F${totalRow}`).font = { bold: true, size: 11 }; sheet.getCell(`E${totalRow}`).fill = sheet.getCell(`F${totalRow}`).fill = { type:"pattern",pattern:"solid",fgColor:{argb:"FFF3F8DF"} };
  for (let row = 18; row <= lastItemRow; row++) sheet.getRow(row).eachCell(cell=>cell.border={top:{style:"thin"},left:{style:"thin"},bottom:{style:"thin"},right:{style:"thin"}});
  sheet.getColumn(5).numFmt = sheet.getColumn(6).numFmt = '"R$" #,##0.00'; sheet.getRow(11).height = 30; sheet.getRow(14).height = 36;
  await workbook.xlsx.writeFile(targetPath); return { previewPath: "", errors: "", inspection: "exceljs" };
}

async function buildPurchaseOrderWorkbook(quote, supplier, targetPath) {
  if (isVercel) return buildPurchaseOrderWorkbookNode(quote, supplier, targetPath);
  const { Workbook, SpreadsheetFile } = await artifactTool();
  const workbook = Workbook.create();
  const sheet = workbook.worksheets.add("Ordem de Compra");
  sheet.showGridLines = false;
  const customer = purchaseOrderCustomer(quote);
  const requestItems = quote.request.items || [];
  const selectedItems = (supplier.items || [])
    .map(item => ({ item, request: requestItems.find(row => row.id === item.requestItemId) }))
    .filter(row => row.request && Number(row.item.unitPrice) > 0);
  const itemRows = selectedItems.map(({ item, request }, index) => [
    index + 1,
    `${request.description}${item.brand ? ` — ${item.brand}` : ""}`,
    request.unit || "UN",
    Number(request.quantity || 0),
    Number(item.unitPrice || 0),
    null
  ]);
  if (!supplier.freightIncluded && Number(supplier.freight || 0) > 0) itemRows.push([itemRows.length + 1, "FRETE", "UN", 1, Number(supplier.freight), null]);
  if (Number(supplier.otherCharges || 0) > 0) itemRows.push([itemRows.length + 1, "OUTRAS DESPESAS", "UN", 1, Number(supplier.otherCharges), null]);
  if (Number(supplier.discount || 0) > 0) itemRows.push([itemRows.length + 1, "DESCONTO", "UN", 1, -Number(supplier.discount), null]);
  const firstItemRow = 19;
  const lastItemRow = firstItemRow + itemRows.length - 1;
  const totalRow = Math.max(36, lastItemRow + 2);
  const supplierRow = totalRow + 2;
  const commercialHeaderRow = supplierRow + 4;
  const commercialRow = commercialHeaderRow + 1;
  const notesRow = commercialRow + 4;

  sheet.mergeCells("A1:F1"); sheet.getRange("A1").values = [[customer.legalName]];
  sheet.mergeCells("A2:F2"); sheet.getRange("A2").values = [[customer.billingAddress]];
  sheet.mergeCells("A3:F3"); sheet.getRange("A3").values = [[`CNPJ/CPF: ${customer.document}`]];
  sheet.getRange("E5:F9").values = [["DATA:", new Date()], ["", ""], ["COMPRADOR:", customer.buyer], ["", ""], ["N. SOLICITAÇÃO:", String(quote.request.number || quote.id)]];
  sheet.mergeCells("A11:F11"); sheet.getRange("A11").values = [["ORDEM DE COMPRA"]];
  for (const row of [13, 14, 15, 16]) { sheet.mergeCells(`A${row}:B${row}`); sheet.mergeCells(`C${row}:F${row}`); }
  sheet.getRange("A13:A16").values = [["OBRA:"], ["ENDEREÇO PARA ENTREGA:"], ["ADICIONAR NÚMERO DA O.C. NA NOTA FISCAL:"], ["RECEBIMENTO DE MATERIAL COM:"]];
  sheet.getRange("C13:C16").values = [[quote.request.work || quote.clientName || ""], [""], [String(quote.request.number || quote.id)], [customer.receiver]];
  sheet.mergeCells("C14:F14"); sheet.getRange("C14").values = [[`${customer.deliveryAddress}${customer.city ? `\n${customer.city}` : ""}${customer.zipCode ? `\nCEP: ${customer.zipCode}` : ""}`]];
  sheet.getRange("A18:F18").values = [["ITEM", "DESCRIÇÃO", "UNID.", "QTDE.", "VALOR UNIT.", "VALOR TOTAL"]];
  sheet.getRange(`A${firstItemRow}:F${lastItemRow}`).values = itemRows;
  for (let row = firstItemRow; row <= lastItemRow; row++) sheet.getRange(`F${row}`).formulas = [[`=D${row}*E${row}`]];
  sheet.getRange(`E${totalRow}:F${totalRow}`).values = [["TOTAL GERAL", null]];
  sheet.getRange(`F${totalRow}`).formulas = [[`=SUM(F${firstItemRow}:F${lastItemRow})`]];
  sheet.getRange(`E${supplierRow}:F${supplierRow + 2}`).values = [["FORNECEDOR:", supplier.name || ""], ["CONTATO:", supplier.seller || ""], ["TELEFONE:", supplier.phone || "A confirmar"]];
  sheet.getRange(`A${commercialHeaderRow}:F${commercialHeaderRow}`).values = [["O.C.", "FORNECEDOR", "VALOR", "", "DATA ENTREGA", "PAGAMENTO"]];
  sheet.getRange(`A${commercialRow}:F${commercialRow}`).values = [[String(quote.request.number || quote.id), supplier.name || "", null, "", supplier.delivery || "Não informado", supplier.payment || "Não informado"]];
  sheet.getRange(`C${commercialRow}`).formulas = [[`=F${totalRow}`]];
  sheet.mergeCells(`A${notesRow}:F${notesRow}`); sheet.getRange(`A${notesRow}`).values = [["OBSERVAÇÕES:"]];
  const notes = [
    `Dados para faturamento: ${customer.legalName} — CNPJ/CPF: ${customer.document}`,
    `Prazo de entrega: ${supplier.delivery || "Não informado"}`,
    `Endereço para entrega: ${customer.deliveryAddress}${customer.city ? ` — ${customer.city}` : ""}`,
    `Endereço de cobrança: ${customer.billingAddress}`,
    `Validade do orçamento: ${supplier.validity || "Não informado"}`,
    `Observação da aprovação: ${quote.approval?.notes || "Sem observações"}`
  ];
  notes.forEach((note, index) => { const row = notesRow + 1 + index; sheet.mergeCells(`A${row}:F${row}`); sheet.getRange(`A${row}`).values = [[note]]; });

  const usedEnd = notesRow + notes.length;
  sheet.getRange(`A1:F${usedEnd}`).format.font = { name: "Arial", size: 10, color: "#172033" };
  sheet.getRange("A1:F1").format = { fill: "#172033", font: { name: "Arial", size: 14, bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center" };
  sheet.getRange("A11:F11").format = { fill: "#A7C63B", font: { name: "Arial", size: 18, bold: true, color: "#172033" }, horizontalAlignment: "center", verticalAlignment: "center" };
  sheet.getRange("A18:F18").format = { fill: "#172033", font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true };
  sheet.getRange(`A${commercialHeaderRow}:F${commercialHeaderRow}`).format = { fill: "#E8EBF0", font: { name: "Arial", size: 9, bold: true, color: "#172033" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true };
  sheet.getRange(`A18:F${lastItemRow}`).format.borders = { preset: "all", style: "thin", color: "#9AA2AF" };
  sheet.getRange(`E${totalRow}:F${totalRow}`).format = { fill: "#F3F8DF", font: { name: "Arial", size: 11, bold: true, color: "#172033" }, borders: { preset: "all", style: "medium", color: "#172033" } };
  sheet.getRange(`A${commercialHeaderRow}:F${commercialRow}`).format.borders = { preset: "all", style: "thin", color: "#9AA2AF" };
  sheet.getRange(`A${notesRow}:F${notesRow}`).format = { fill: "#E8EBF0", font: { name: "Arial", size: 10, bold: true, color: "#172033" } };
  sheet.getRange(`B${firstItemRow}:B${lastItemRow}`).format.wrapText = true;
  sheet.getRange(`C${firstItemRow}:D${lastItemRow}`).format.horizontalAlignment = "center";
  sheet.getRange(`E${firstItemRow}:F${lastItemRow}`).format.numberFormat = '"R$" #,##0.00';
  sheet.getRange(`F${totalRow}`).format.numberFormat = '"R$" #,##0.00';
  sheet.getRange(`C${commercialRow}`).format.numberFormat = '"R$" #,##0.00';
  sheet.getRange("F5").format.numberFormat = "dd/mm/yyyy";
  sheet.getRange("A:A").format.columnWidth = 10; sheet.getRange("B:B").format.columnWidth = 50;
  sheet.getRange("C:C").format.columnWidth = 11; sheet.getRange("D:D").format.columnWidth = 11;
  sheet.getRange("E:F").format.columnWidth = 17;
  sheet.getRange("A1:F1").format.rowHeight = 28; sheet.getRange("A11:F11").format.rowHeight = 32;
  sheet.getRange("A14:F14").format.rowHeight = 48; sheet.getRange(`A${firstItemRow}:F${lastItemRow}`).format.rowHeight = 26;
  sheet.freezePanes.freezeRows(18);

  const keyRange = await workbook.inspect({ kind: "table", range: `Ordem de Compra!A1:F${usedEnd}`, include: "values,formulas", tableMaxRows: usedEnd, tableMaxCols: 6 });
  const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 100 }, summary: "erros finais" });
  const preview = await workbook.render({ sheetName: "Ordem de Compra", range: `A1:F${usedEnd}`, scale: 1.25, format: "png" });
  const previewPath = targetPath.replace(/\.xlsx$/i, ".png");
  await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(targetPath);
  return { previewPath, errors: errors.ndjson || "", inspection: keyRange.ndjson || "" };
}

async function importIntoQuote(quote, role, supplierId, extraction, fileRecord) {
  if (role === "request") quote.request = { ...quote.request, ...parseRequest(extraction) };
  else {
    let supplier = quote.suppliers.find(row => row.id === supplierId);
    if (!supplier) { supplier = { id: supplierId || uid("forn"), name: "", seller: "", items: [] }; quote.suppliers.push(supplier); }
    Object.assign(supplier, parseSupplier(extraction, supplier));
    if (fileRecord) { fileRecord.textLength = String(extraction.text || "").length; fileRecord.parsedItems = supplier.items?.length || 0; }
    console.log("[quotation-parser]", { file: fileRecord?.originalName || "texto-colado", method: extraction.method, textLength: String(extraction.text || "").length, parsedItems: supplier.items?.length || 0, officialTotal: supplier.officialTotal || 0 });
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

export async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.pathname === "/api/health") return json(res, 200, { ok: true, runtime: isVercel ? "vercel" : "local", driveConnected: driveConfigured(), supabaseConnected: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY), formats: ["pdf", "xlsx", "xls", "csv", "txt", "png", "jpg", "jpeg"] });
    if (url.pathname === "/api/sync/supabase" && req.method === "POST") {
      const input = await bodyJson(req), clientId = String(input.clientId || "deterlimp");
      const records = (input.records || []).map(row => ({ client_id: clientId, drive_id: String(row.driveId || row.id || ""), parent_drive_id: row.parentDriveId || null, record_type: row.recordType || "file", name: String(row.name || "Arquivo"), mime_type: row.mimeType || null, drive_url: row.driveUrl || null, payload: row.payload || row, content_hash: row.contentHash || null, drive_modified_at: row.modifiedTime || null })).filter(row => row.drive_id);
      try { return json(res, 200, await supabaseSyncRecords(records)); } catch (error) { return json(res, 502, { error: error.message }); }
    }
    if (url.pathname === "/api/order-update" && req.method === "PUT") {
      try { const input = await bodyJson(req); return json(res, 200, await updateOrderInSheet(input.clientId, input.order)); } catch (error) { return json(res, 502, { error: error.message }); }
    }
    if (url.pathname === "/api/order-status-normalize" && req.method === "POST") {
      try { const input = await bodyJson(req); return json(res, 200, await normalizeOrderStatusesInSheet(input.clientId || "dr_clovis_cmfs")); } catch (error) { return json(res, 502, { error: error.message }); }
    }
    if (url.pathname === "/api/base" && req.method === "GET") {
      const clientId = cleanName(url.searchParams.get("clientId")); const base = spreadsheetBases[clientId];
      if (!base) return json(res, 404, { error: "Base deste cliente não configurada." });
      if (!driveConfigured()) return json(res, 503, { error: "Google Drive ainda não conectado." });
      const response = await driveFetch(`https://docs.google.com/spreadsheets/d/${base.id}/export?format=csv&gid=${base.gid}`);
      const csv = await response.text(); res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "private, no-store" }); res.end(csv); return;
    }
    if (url.pathname === "/api/order-assets" && req.method === "GET") {
      const clientId = cleanName(url.searchParams.get("clientId")); const number = String(url.searchParams.get("number") || "").replace(/^0+/, ""); const category = norm(url.searchParams.get("category")); const description = norm(url.searchParams.get("description"));
      if (driveConfigured() && driveRoots[clientId]) {
        const folder = await findOrderFolder(driveRoots[clientId], { request: { number, category, description, work: url.searchParams.get("work") || "" } });
        if (!folder) return json(res, 404, { error: "Não encontrei uma pasta correspondente no Drive." });
        const files = await listDriveTree(folder.id);
        const requestFile = files.find(file => classifyDriveFile(file) === "request");
        const mapTemplate = files.find(file => classifyDriveFile(file) === "map");
        let request = null; let extractionError = "";
        if (requestFile) {
          try {
            const requestDir = path.join(uploadDir, "order-assets", folder.id);
            const savedPath = await downloadDriveFile(requestFile, requestDir);
            request = parseRequest(await extractDocument(savedPath, requestFile.name));
          } catch (error) { extractionError = error.message; }
        }
        return json(res, 200, {
          folderId: folder.id,
          folderUrl: `https://drive.google.com/drive/folders/${folder.id}`,
          items: request?.items || [], request,
          complete: Boolean(request?.items?.length),
          extractionError: requestFile && !request?.items?.length ? (extractionError || "O arquivo Pedido foi encontrado, mas nenhum item pôde ser reconhecido.") : "",
          template: mapTemplate ? { id: mapTemplate.id, name: mapTemplate.name, mimeType: mapTemplate.mimeType, url: mapTemplate.webViewLink || `https://drive.google.com/file/d/${mapTemplate.id}/view` } : null,
          files: files.filter(file => !file.mimeType?.endsWith("folder")).map(file => ({ ...file, role: classifyDriveFile(file), url: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view` }))
        });
      }
      const pilotMatch = clientId === drivePilot.clientId && number === drivePilot.number && (category.includes("hidraul") || description.includes("hidraul"));
      if (!pilotMatch) return json(res, 404, { error: "Ainda não há uma pasta do Drive vinculada com segurança a este pedido." });
      return json(res, 200, { folderId: drivePilot.folderId, folderUrl: `https://drive.google.com/drive/folders/${drivePilot.folderId}`, items: drivePilot.requestItems.map(([number, quantity, unit, description]) => ({ number, quantity, unit, description, neededDate: "2026-08-22" })), files: drivePilot.files.map(file => ({ ...file, url: `https://drive.google.com/file/d/${file.id}/view` })) });
    }
    if (parts[0] === "api" && parts[1] === "works" && parts[2]) {
      const clientId = cleanName(decodeURIComponent(parts[2]));
      const work = await getOrCreateWork(clientId, url.searchParams.get("clientName") || "");
      if (parts.length === 3 && req.method === "GET") return json(res, 200, work);
      if (parts.length === 3 && req.method === "PUT") return json(res, 200, await saveWork(normalizeWork(await bodyJson(req), work)));
      if (parts[3] === "documents" && parts[4] === "sync" && req.method === "POST") return json(res, 200, await syncWorkDocumentsFromDrive(work));
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
      if (parts[3] === "drive-search" && req.method === "POST") {
        const rootId = driveRoots[quote.clientId];
        if (!rootId) return json(res, 400, { error: "Este cliente ainda não possui uma raiz do Google Drive configurada." });
        if (driveConfigured()) {
          const linkedFolderId = quote.request.driveFolderId;
          const folder = linkedFolderId ? { id: linkedFolderId, name: "Pasta vinculada", score: 99 } : await findOrderFolder(rootId, quote);
          if (!folder) return json(res, 404, { error: "Não encontrei uma pasta que combine com o número e a categoria deste pedido.", rootId });
          return json(res, 200, await importOrderFolderFromDrive(quote, folder));
        }
        const pilotMatch = quote.clientId === drivePilot.clientId && String(quote.request.number || "").replace(/^0+/, "") === drivePilot.number && norm(quote.request.category).includes("hidraul");
        if (!pilotMatch) return json(res, 503, { error: "A busca automática está validada no piloto Hidráulica 05. Para generalizar a todas as pastas, falta conectar a credencial server-side do Google Drive neste computador.", rootId });
        quote.request = { ...quote.request, number: "5", category: "Hidráulica", date: "2026-08-19", neededDate: "2026-08-22", requester: "Marco Fabio Frederico", work: "Deterlimp", driveFolderId: drivePilot.folderId, items: drivePilot.requestItems.map(([number, quantity, unit, description]) => ({ id: uid("item"), number, quantity, unit, description, neededDate: "2026-08-22" })) };
        quote.suppliers = []; quote.files = [];
        const makeItems = rows => rows.map(([requestNumber, description, quantity, unitPrice, brand = ""]) => { const requestItem = quote.request.items.find(row => Number(row.number) === Number(requestNumber)); return { id: uid("qitem"), description, quantity, unit: requestItem?.unit || "UN", unitPrice, quotedTotal: Number((quantity * unitPrice).toFixed(2)), brand, requestItemId: requestItem?.id || "", lockedMatch: Boolean(requestItem), extra: !requestItem, confidence: requestItem ? 1 : 0 }; });
        const supplierSeeds = [
          { name: "Balaroti", seller: "Moreira", payment: "À vista", delivery: "24/08/2026", validity: "20/08/2026", freight: 86.44, otherCharges: 0, source: drivePilot.files[1], items: makeItems([[4,"ENGATE FLEXÍVEL 40CM TIGRE",8,8.90,"Tigre"],[5,"BRAÇO PARA CHUVEIRO 40CM",1,29.90,"Astra"],[9,"SIFÃO SANFONADO UNIVERSAL",12,7.90,"Blukit"],[11,"SPUD 1.1/2",1,10.90,"Astra"],[2,"KIT BACIA COM CAIXA ACOPLADA",3,959.90,"Deca"],[0,"VÁLVULA PARA MICTÓRIO PRESSMATIC",1,796.90,"Docol"],[8,"TORNEIRA LAVATÓRIO MESA LINK",2,403.90,"Deca"],[3,"CUBA EMBUTIR 49X36,5 OVAL",2,136.90,"Deca"],[6,"DUCHA 220V",1,149.90,"Zagonel"],[16,"VEDA ROSCA 18MMX25M",2,11.90,"Tigre"],[17,"TUBO 25MM SOLDÁVEL 6M",11,25.90,"Tigre"],[1,"MICTÓRIO COM SIFÃO INTEGRADO",1,815.90,"Deca"],[7,"ACABAMENTO REGISTRO 3/4",8,33.90,"Real"]]) },
          { name: "Nichele", seller: "Angelica da Costa Edoardo", payment: "Cartão de crédito", delivery: "", validity: "22/08/2026", freight: 0, otherCharges: 200, source: drivePilot.files[2], items: makeItems([[1,"MICTÓRIO GELO DECA",1,816.65,"Deca"],[2,"KIT BACIA COM CAIXA ACOPLADA ASPEN",3,954.90,"Deca"],[3,"CUBA EMBUTIR OVAL 49X36,5",2,133.80,"Deca"],[4,"ENGATE FLEXÍVEL 40CM",8,55.96,"Deca"],[5,"CANO CHUVEIRO 40CM",1,23.26,"Enerbras"],[6,"DUCHA 220V",1,113.30,"Lorenzetti"],[7,"ACABAMENTO REGISTRO 3/4",8,85.15,"Deca"],[8,"TORNEIRA LAVATÓRIO MESA ALTA",2,393.04,"Deca"],[9,"SIFÃO SANFONADO",12,8.92,"Tigre"],[10,"ANEL VEDAÇÃO PARA BACIA",3,18.51,"Tigre"],[11,"SPUD PARA BACIA",1,9.23,"Tigre"],[12,"TUBO DE LIGAÇÃO",1,257.68,"Deca"],[13,"ASSENTO SANITÁRIO ASPEN",3,153.98,"Deca"],[14,"VÁLVULA DE ESCOAMENTO",2,61.65,"Deca"],[15,"PARAFUSO WC COM BUCHA 10MM",12,22.22,"Imperatriz"],[16,"VEDA ROSCA 18X25M",2,11.49,"Tigre"],[17,"TUBO SOLDÁVEL 25MM",11,27.58,"Tigre"]]) }
        ];
        for (const seed of supplierSeeds) { const supplierId = uid("forn"); quote.suppliers.push({ id: supplierId, name: seed.name, seller: seed.seller, payment: seed.payment, delivery: seed.delivery, validity: seed.validity, freight: seed.freight, freightIncluded: false, otherCharges: seed.otherCharges, discount: 0, notes: "", items: seed.items, sourceFileId: "" }); const fileRecord = { id: uid("arq"), role: "quote", supplierId, originalName: seed.source.name, driveId: seed.source.id, driveUrl: `https://drive.google.com/file/d/${seed.source.id}/view`, method: "google-drive", confidence: 1, createdAt: isoNow() }; quote.files.push(fileRecord); quote.suppliers.at(-1).sourceFileId = fileRecord.id; }
        quote.files.unshift({ id: uid("arq"), role: "request", originalName: drivePilot.files[0].name, driveId: drivePilot.files[0].id, driveUrl: `https://drive.google.com/file/d/${drivePilot.files[0].id}/view`, method: "google-drive", confidence: 1, createdAt: isoNow() });
        quote.status = "conferência"; await saveQuote(reconcile(quote)); return json(res, 200, { quote, files: drivePilot.files.filter(file => !/mapa de cotação/i.test(file.name)).map(file => ({ ...file, url: `https://drive.google.com/file/d/${file.id}/view` })), folderId: drivePilot.folderId });
      }
      if (parts[3] === "generate" && req.method === "POST") {
        reconcile(quote);
        const blocking = quote.divergences.filter(row => row.severity === "blocking" && !row.resolved);
        if (!quote.request.items?.length) return json(res, 400, { error: "O pedido ainda não possui itens." });
        if (!quote.suppliers?.length) return json(res, 400, { error: "Adicione ao menos um fornecedor." });
        const mappedPrices = quote.suppliers.flatMap(supplier => supplier.items || []).filter(item => item.requestItemId && Number(item.unitPrice) > 0);
        if (!mappedPrices.length) return json(res, 409, { error: "Nenhum item de fornecedor foi interpretado e relacionado. Releia os arquivos antes de gerar o mapa." });
        if (blocking.length) return json(res, 409, { error: `Resolva ${blocking.length} divergência(s) antes de gerar o mapa.`, divergences: blocking });
        const filename = `mapa-cotacao-${cleanName(quote.request.category || "pedido")}-${cleanName(quote.request.number || quote.id)}-${Date.now()}.xlsx`;
        const targetPath = path.join(generatedDir, filename);
        const verification = await buildWorkbook(quote, targetPath);
        let driveFile = null;
        if (driveConfigured() && quote.request.driveFolderId) driveFile = await uploadFileToDrive(quote.request.driveFolderId, targetPath, `03 - Mapa de Cotação - ${quote.request.category || "Pedido"} ${quote.request.number || ""}.xlsx`);
        quote.generated.push({ id: uid("mapa"), filename, createdAt: isoNow(), preview: verification.previewPath ? path.basename(verification.previewPath) : "", verified: !verification.errors.includes("#"), driveId: driveFile?.id || "", driveUrl: driveFile?.webViewLink || "" });
        quote.status = "mapa gerado"; await saveQuote(quote);
        return json(res, 201, { quote, file: quote.generated.at(-1), downloadUrl: driveFile?.webViewLink || `/api/quotes/${quote.id}/files/${encodeURIComponent(filename)}`, previewUrl: verification.previewPath ? `/api/quotes/${quote.id}/files/${encodeURIComponent(path.basename(verification.previewPath))}` : "" });
      }
      if (parts[3] === "google-sheet" && req.method === "POST") {
        reconcile(quote);
        const blocking = quote.divergences.filter(row => row.severity === "blocking" && !row.resolved);
        if (!quote.request.items?.length) return json(res, 400, { error: "O pedido ainda não possui itens." });
        if (!quote.suppliers?.length) return json(res, 400, { error: "Adicione ao menos um fornecedor." });
        if (blocking.length) return json(res, 409, { error: `Resolva ${blocking.length} divergência(s) antes de criar a planilha.`, divergences: blocking });
        const mappedPrices = quote.suppliers.flatMap(supplier => supplier.items || []).filter(item => item.requestItemId && Number(item.unitPrice) > 0);
        if (!mappedPrices.length) return json(res, 409, { error: "Nenhum item de fornecedor foi interpretado e relacionado. Releia os arquivos antes de criar a planilha." });
        const sheet = await createQuoteGoogleSheet(quote);
        quote.googleSheets = quote.googleSheets || []; quote.googleSheets.push(sheet); await saveQuote(quote);
        return json(res, 201, { quote, ...sheet });
      }
      if (parts[3] === "purchase-order" && req.method === "POST") {
        const supplier = quote.suppliers.find(row => row.id === quote.approval?.supplierId);
        if (!supplier) return json(res, 400, { error: "Escolha e aprove um fornecedor antes de gerar a Ordem de Compra." });
        const requestItems = quote.request.items || [];
        const selectedItems = (supplier.items || []).map(item => ({ item, request: requestItems.find(row => row.id === item.requestItemId) })).filter(row => row.request && Number(row.item.unitPrice) > 0);
        if (!selectedItems.length) return json(res, 400, { error: "O fornecedor aprovado não possui itens relacionados com valor." });
        const itemsTotal = selectedItems.reduce((sum, { item, request }) => sum + Number(request.quantity || 0) * Number(item.unitPrice || 0), 0);
        const finalTotal = itemsTotal + (supplier.freightIncluded ? 0 : Number(supplier.freight || 0)) + Number(supplier.otherCharges || 0) - Number(supplier.discount || 0);
        const filename = `04-Ordem-de-Compra-${cleanName(quote.request.category || "pedido")}-${cleanName(quote.request.number || quote.id)}-${cleanName(supplier.name || "fornecedor")}-${Date.now()}.xlsx`;
        const targetPath = path.join(generatedDir, filename);
        const verification = await buildPurchaseOrderWorkbook(quote, supplier, targetPath);
        let driveFile = null;
        if (driveConfigured() && quote.request.driveFolderId) driveFile = await uploadFileToDrive(quote.request.driveFolderId, targetPath, `04 - Ordem de Compra - ${quote.request.category || "Pedido"} ${quote.request.number || ""} - ${supplier.name || "Fornecedor"}.xlsx`);
        quote.purchaseOrders = quote.purchaseOrders || []; quote.purchaseOrders.push({ id: uid("oc"), filename, supplierId: supplier.id, createdAt: isoNow(), total: finalTotal, preview: verification.previewPath ? path.basename(verification.previewPath) : "", verified: !verification.errors.includes("#"), driveId: driveFile?.id || "", driveUrl: driveFile?.webViewLink || "" }); quote.status = "ordem de compra";
        await saveQuote(quote); return json(res, 201, { quote, file: quote.purchaseOrders.at(-1), downloadUrl: driveFile?.webViewLink || `/api/quotes/${quote.id}/files/${encodeURIComponent(filename)}`, previewUrl: verification.previewPath ? `/api/quotes/${quote.id}/files/${encodeURIComponent(path.basename(verification.previewPath))}` : "" });
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
}

export { parseRequest, parseSupplier, reconcile, textQuoteItems };

const driveFields = "nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,parents)";
async function listDriveChildren(parentId) {
  const rows = []; let pageToken = "";
  do {
    const query = new URLSearchParams({ q: `'${parentId}' in parents and trashed=false`, fields: driveFields, pageSize: "1000", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
    if (pageToken) query.set("pageToken", pageToken);
    const response = await driveFetch(`https://www.googleapis.com/drive/v3/files?${query}`); const payload = await response.json();
    rows.push(...(payload.files || [])); pageToken = payload.nextPageToken || "";
  } while (pageToken);
  return rows;
}

async function listDriveTree(parentId, depth = 0, output = []) {
  const children = await listDriveChildren(parentId);
  for (const file of children) {
    output.push(file);
    if (file.mimeType === "application/vnd.google-apps.folder" && depth < 4) await listDriveTree(file.id, depth + 1, output);
  }
  return output;
}

function orderFolderScore(name, quote) {
  const folder = norm(name); const number = String(quote.request.number || "").replace(/^0+/, ""); const category = norm(quote.request.category); const description = norm(`${quote.request.description || ""} ${quote.request.work || ""}`);
  let score = 0;
  if (number && new RegExp(`(?:^|\\D)0*${number}(?:\\D|$)`).test(folder)) score += 8;
  if (category && folder.includes(category)) score += 6;
  for (const token of description.split(" ").filter(token => token.length >= 5)) if (folder.includes(token)) score += 1;
  if (/pedido|cotacao|or[cç]amento/.test(folder)) score += 2;
  return score;
}

async function findOrderFolder(rootId, quote) {
  const queue = [{ id: rootId, depth: 0 }]; const candidates = []; let inspected = 0;
  while (queue.length && inspected < 700) {
    const current = queue.shift(); const children = await listDriveChildren(current.id); inspected += children.length;
    for (const child of children) if (child.mimeType === "application/vnd.google-apps.folder") {
      const score = orderFolderScore(child.name, quote); if (score >= 8) candidates.push({ ...child, score, depth: current.depth + 1 });
      if (current.depth < 5) queue.push({ id: child.id, depth: current.depth + 1 });
    }
  }
  // Algumas pastas do Drive têm níveis extras ou atalhos e não aparecem na
  // árvore limitada. Como segunda tentativa, procura todas as pastas visíveis
  // e mantém apenas as que têm o número/categoria do pedido.
  if (!candidates.length) {
    const query = new URLSearchParams({
      q: "mimeType='application/vnd.google-apps.folder' and trashed=false",
      fields: driveFields,
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true"
    });
    const response = await driveFetch(`https://www.googleapis.com/drive/v3/files?${query}`);
    const payload = await response.json();
    for (const folder of payload.files || []) {
      const score = orderFolderScore(folder.name, quote);
      if (score >= 8) candidates.push({ ...folder, score, depth: 99 });
    }
  }
  candidates.sort((a, b) => b.score - a.score || b.modifiedTime?.localeCompare(a.modifiedTime || "") || a.depth - b.depth);
  return candidates[0] || null;
}

async function downloadDriveFile(file, targetDir) {
  let extension = path.extname(file.name || ""); let url;
  if (file.mimeType === "application/vnd.google-apps.spreadsheet") { url = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=${encodeURIComponent("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}`; extension ||= ".xlsx"; }
  else if (file.mimeType === "application/vnd.google-apps.document") { url = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=${encodeURIComponent("application/pdf")}`; extension ||= ".pdf"; }
  else url = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
  const response = await driveFetch(url); const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 30 * 1024 * 1024) throw new Error(`${file.name} é maior que 30 MB.`);
  await fs.mkdir(targetDir, { recursive: true }); const targetPath = path.join(targetDir, `${file.id}-${cleanName(path.basename(file.name || "arquivo", path.extname(file.name || "")))}${extension}`);
  await fs.writeFile(targetPath, buffer); return targetPath;
}

async function uploadFileToDrive(folderId, filePath, name, mimeType = contentType(filePath)) {
  const boundary = `dash_${crypto.randomUUID()}`; const fileBuffer = await fs.readFile(filePath);
  const multipart = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folderId] })}\r\n`),Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),fileBuffer,Buffer.from(`\r\n--${boundary}--`)]);
  const response = await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,webViewLink", { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: multipart });
  return response.json();
}

function classifyDriveFile(file) {
  const name = norm(file.name);
  if (/^(03|3)\b/.test(name) || name.includes("mapa de cotacao")) return "map";
  if (/^(04|4)\b/.test(name) || name.includes("ordem de compra")) return "purchase-order";
  if (/^(02|2)\b/.test(name) || name.includes("orcamento") || name.includes("proposta") || name.includes("cotacao")) return "quote";
  if (/^(01|1)\b/.test(name) || /pedido|solicitacao|requisicao|requisito|material solicitado|lista de materiais/.test(name)) return "request";
  return "unknown";
}

function supplierNameFromFile(name) {
  return String(name || "").replace(/\.[^.]+$/, "").replace(/^\s*0?2\s*[-–—_]\s*/i, "").replace(/^or[çc]amento\s*[-–—_]\s*/i, "").split(/\s+[-–—]\s+/)[0]?.trim() || "Fornecedor";
}

async function importOrderFolderFromDrive(quote, folder) {
  const files = await listDriveTree(folder.id); const supported = files.filter(file => !file.mimeType?.endsWith("folder") && ["request", "quote"].includes(classifyDriveFile(file)));
  // O documento do pedido é a fonte de verdade; a descrição informada na
  // tela serve apenas para localizar a pasta e nunca substitui o conteúdo
  // extraído do arquivo encontrado nela.
  if (!supported.length) throw new Error("A pasta foi encontrada, mas não contém pedido ou orçamento identificável.");
  const mapTemplate = files.find(file => classifyDriveFile(file) === "map");
  quote.request.driveFolderId = folder.id;
  quote.request.mapTemplate = mapTemplate ? { driveId: mapTemplate.id, name: mapTemplate.name, mimeType: mapTemplate.mimeType, driveUrl: mapTemplate.webViewLink || `https://drive.google.com/file/d/${mapTemplate.id}/view` } : null;
  quote.suppliers = []; quote.files = [];
  const quoteDir = path.join(uploadDir, quote.id); await fs.mkdir(quoteDir, { recursive: true });
  const ordered = supported.sort((a,b) => (classifyDriveFile(a) === "request" ? -1 : 1) - (classifyDriveFile(b) === "request" ? -1 : 1));
  for (const file of ordered) {
    const role = classifyDriveFile(file); let supplierId = "";
    if (role === "quote") { const supplier = { id: uid("forn"), name: supplierNameFromFile(file.name), seller: "", items: [] }; quote.suppliers.push(supplier); supplierId = supplier.id; }
    try {
      const savedPath = await downloadDriveFile(file, quoteDir); const extraction = await extractDocument(savedPath, path.basename(savedPath));
      const fileRecord = { id: uid("arq"), role, supplierId, originalName: file.name, savedName: path.basename(savedPath), driveId: file.id, driveUrl: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`, method: extraction.method, confidence: extraction.confidence, createdAt: isoNow() };
      await importIntoQuote(quote, role, supplierId, extraction, fileRecord);
    } catch (error) {
      quote.files.push({ id: uid("arq"), role, supplierId, originalName: file.name, driveId: file.id, driveUrl: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`, method: "falha", confidence: 0, error: error.message, createdAt: isoNow() });
    }
  }
  quote.status = "conferência"; await saveQuote(reconcile(quote));
  return { quote, files: files.map(file => ({ ...file, role: classifyDriveFile(file), url: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view` })), folderId: folder.id, folderUrl: `https://drive.google.com/drive/folders/${folder.id}` };
}

let server;
if (!isVercel) {
  server = http.createServer(handleRequest);
  server.listen(port, "0.0.0.0", () => console.log(`Dashboard de obras: http://localhost:${port}/ (rede local habilitada)`));
  process.on("SIGINT", async () => {
    try { if (ocrWorkerPromise) (await ocrWorkerPromise).terminate(); } catch {}
    server.close(() => process.exit(0));
  });
}
