// Leitura da planilha de andamento do cronograma (planilha do Bravo).
// Fonte EXTRA de andamento: não substitui a planilha financeira/fornecedores.
// Módulo puro (sem rede) para poder ser testado isoladamente.

export const normHeader = value => String(value ?? "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/\s+/g, " ").trim();

export function parseCsv(text) {
  const rows = []; let row = [], cell = "", quoted = false;
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index], next = source[index + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Campo de saída -> nomes de cabeçalho aceitos (já normalizados: sem acento, minúsculos, espaços simples).
// Cabeçalhos que começam com "fonte" (ex.: "Fonte (mensagem do mestre de obras)") também são aceitos.
export const PROGRESS_HEADERS = {
  item: ["item", "n", "no", "nº", "numero", "n item"],
  budgetCodes: ["codigo orcamento", "codigo do orcamento", "codigos orcamento", "codigos do orcamento", "cod orcamento", "cod. orcamento"],
  name: ["etapa", "nome da etapa"],
  description: ["descricao"],
  owner: ["responsavel"],
  plannedStart: ["inicio previsto"],
  plannedEnd: ["termino previsto", "fim previsto"],
  actualStart: ["inicio real"],
  actualEnd: ["termino real", "fim real"],
  progress: ["% concluido", "concluido", "% concluida", "percentual concluido", "% de conclusao", "progresso"],
  status: ["status", "situacao"],
  done: ["o que foi feito"],
  missingMaterial: ["material faltando", "materiais faltando"],
  infoDate: ["data da informacao"],
  source: ["fonte", "fonte (mensagem do mestre de obras)"],
  notes: ["observacoes", "observacao", "obs"]
};

export function mapHeaders(headerRow) {
  const normalized = (headerRow || []).map(normHeader), map = {};
  for (const [field, names] of Object.entries(PROGRESS_HEADERS)) {
    let index = normalized.findIndex(cell => names.includes(cell));
    if (index < 0 && field === "source") index = normalized.findIndex(cell => cell.startsWith("fonte"));
    if (index >= 0) map[field] = index;
  }
  return map;
}

// Datas: dd/mm/aaaa, dd/mm/aa, aaaa-mm-dd ou serial do Sheets. Retorna "aaaa-mm-dd" ou "".
export function parseSheetDate(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || /^\d{4,6}(\.\d+)?$/.test(String(value).trim())) {
    const serial = Number(value);
    if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return "";
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000).toISOString().slice(0, 10);
  }
  const text = String(value).trim(); if (!text) return "";
  let match = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (match) {
    const day = Number(match[1]), month = Number(match[2]); let year = Number(match[3]); if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return "";
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

// Percentual: "45%", "45", "45,5", "0,45" (fração), 0.45. Retorna 0–100 ou null quando vazio/ inválido.
export function parseProgress(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") { if (!Number.isFinite(value)) return null; const n = value > 0 && value <= 1 ? value * 100 : value; return clamp(n); }
  const raw = String(value).trim(); if (!raw) return null;
  const hasPercent = raw.includes("%");
  let text = raw.replace(/[%\s]/g, "");
  if (text.includes(",") && text.includes(".")) text = text.replaceAll(".", "").replace(",", ".");
  else text = text.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  let n = Number(text);
  if (!hasPercent && n > 0 && n <= 1 && /[.,]/.test(raw)) n *= 100; // "0,45" = 45%; "1" = 1%
  return clamp(n);
}
const clamp = n => Math.round(Math.max(0, Math.min(100, n)) * 100) / 100;

// Códigos do orçamento: "2.1.2, 2.1.3, 2.1.17-2.1.29". Intervalos são expandidos pela ordem dos
// itens do orçamento; sem orçamento (ou código fora dele), expande numericamente o último segmento
// quando o prefixo é igual. Aceita também "orc_2_1_2". Retorna { codes, warnings }.
export function expandBudgetCodes(value, budgetItems = []) {
  const codes = [], warnings = [], order = budgetItems.map(row => String(row.code));
  const clean = token => token.trim().replace(/^orc_/i, "").replaceAll("_", ".").replace(/\.$/, "");
  const push = code => { if (code && !codes.includes(code)) codes.push(code); };
  for (const part of String(value ?? "").split(/[;,\n]/)) {
    const token = part.trim(); if (!token) continue;
    const range = token.match(/^(.+?)\s*(?:-|–|—|\ba\b|\bate\b|\baté\b)\s*(.+)$/i);
    if (range && /\d/.test(range[1]) && /\d/.test(range[2]) && range[1].includes(".")) {
      const from = clean(range[1]), to = clean(range[2]);
      const a = order.indexOf(from), b = order.indexOf(to);
      if (a >= 0 && b >= 0 && a <= b) { order.slice(a, b + 1).forEach(push); continue; }
      const pa = from.split("."), pb = to.split(".");
      const prefixA = pa.slice(0, -1).join("."), prefixB = pb.slice(0, -1).join(".");
      const na = Number(pa.at(-1)), nb = Number(pb.at(-1));
      if (prefixA === prefixB && Number.isInteger(na) && Number.isInteger(nb) && na <= nb && nb - na <= 500) {
        for (let n = na; n <= nb; n += 1) push(`${prefixA}.${n}`);
        continue;
      }
      warnings.push(`Intervalo de códigos não reconhecido: "${token}".`);
      continue;
    }
    const code = clean(token);
    if (/^\d+(\.\d+)*$/.test(code)) push(code); else warnings.push(`Código de orçamento inválido: "${token}".`);
  }
  if (order.length) for (const code of codes) if (!order.includes(code)) warnings.push(`Código ${code} não existe no orçamento.`);
  return { codes, warnings };
}

export const budgetIdFromCode = code => `orc_${String(code).replaceAll(".", "_")}`;

const PROGRESS_FIELDS = ["actualStart", "actualEnd", "progress", "status", "done", "missingMaterial", "infoDate", "source"];
export const rowHasProgress = row => PROGRESS_FIELDS.some(field => row[field] !== null && row[field] !== undefined && row[field] !== "");

// values: matriz (CSV já parseado). Retorna { rows, warnings, hasItemColumn, hasProgress, latestInfoDate }.
export function parseProgressRows(values, { budgetItems = [] } = {}) {
  const warnings = [];
  const headerIndex = (values || []).findIndex(row => { const m = mapHeaders(row); return m.name !== undefined || m.item !== undefined; });
  if (headerIndex < 0) return { rows: [], warnings: ["Cabeçalho da planilha de andamento não encontrado (esperado ao menos \"Etapa\" ou \"Item\")."], hasItemColumn: false, hasProgress: false, latestInfoDate: "" };
  const map = mapHeaders(values[headerIndex]);
  const hasItemColumn = map.item !== undefined;
  if (!hasItemColumn) warnings.push("Planilha sem coluna \"Item\": casamento feito pelo nome da etapa, apenas quando o nome é único.");
  const get = (cells, field) => map[field] === undefined ? "" : String(cells[map[field]] ?? "").trim();
  const rows = [];
  values.slice(headerIndex + 1).forEach((cells, offset) => {
    if (!cells || cells.every(cell => !String(cell ?? "").trim())) return;
    const itemRaw = get(cells, "item"), name = get(cells, "name");
    const item = /^\d+$/.test(itemRaw) ? String(Number(itemRaw)) : "";
    if (!item && !name) return;
    if (hasItemColumn && !item) { warnings.push(`Linha ${headerIndex + offset + 2}: "Item" vazio ou inválido; linha ignorada.`); return; }
    const budget = expandBudgetCodes(get(cells, "budgetCodes"), budgetItems);
    budget.warnings.forEach(message => warnings.push(`Item ${item || name}: ${message}`));
    rows.push({
      item: item || null, sheetRow: headerIndex + offset + 2,
      budgetCodes: budget.codes, budgetItemIds: budget.codes.map(budgetIdFromCode),
      name, description: get(cells, "description"), owner: get(cells, "owner"),
      plannedStart: parseSheetDate(get(cells, "plannedStart")), plannedEnd: parseSheetDate(get(cells, "plannedEnd")),
      actualStart: parseSheetDate(get(cells, "actualStart")), actualEnd: parseSheetDate(get(cells, "actualEnd")),
      progress: parseProgress(get(cells, "progress")), status: get(cells, "status"),
      done: get(cells, "done"), missingMaterial: get(cells, "missingMaterial"),
      infoDate: parseSheetDate(get(cells, "infoDate")), source: get(cells, "source"), notes: get(cells, "notes")
    });
  });
  if (hasItemColumn) {
    const seen = new Map(); rows.forEach(row => seen.set(row.item, (seen.get(row.item) || 0) + 1));
    for (const [item, count] of seen) if (count > 1) warnings.push(`Item ${item} aparece ${count} vezes; vale a última linha.`);
  } else {
    const counts = new Map(); rows.forEach(row => { const key = normHeader(row.name); counts.set(key, (counts.get(key) || 0) + 1); });
    rows.forEach(row => { row.uniqueName = counts.get(normHeader(row.name)) === 1; if (!row.uniqueName) warnings.push(`Etapa "${row.name}" repetida na planilha sem "Item"; ignorada.`); });
  }
  const latestInfoDate = rows.map(row => row.infoDate).filter(Boolean).sort().at(-1) || "";
  return { rows, warnings, hasItemColumn, hasProgress: rows.some(rowHasProgress), latestInfoDate };
}

export const parseProgressCsv = (text, options) => parseProgressRows(parseCsv(text), options);
