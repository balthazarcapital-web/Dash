import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseProgressCsv, parseProgress, parseSheetDate, expandBudgetCodes, mapHeaders, parseCsv } from "../lib/schedule-progress.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = fs.readFileSync(path.join(here, "fixtures", "andamento-exemplo.csv"), "utf8");
const budget = JSON.parse(fs.readFileSync(path.join(here, "..", "budget-dr-clovis.json"), "utf8"));

test("andamento: mapeia colunas pelo cabeçalho, ignorando acento, caixa e espaços", () => {
  const map = mapHeaders(["  ITEM ", "Codigo   Orçamento", "etapa", "% Concluído", "Fonte (mensagem do mestre de obras)", "OBSERVAÇÕES", "Início Real"]);
  assert.equal(map.item, 0); assert.equal(map.budgetCodes, 1); assert.equal(map.name, 2);
  assert.equal(map.progress, 3); assert.equal(map.source, 4); assert.equal(map.notes, 5); assert.equal(map.actualStart, 6);
  assert.equal(map.status, undefined);
});

test("andamento: percentual em formatos variados", () => {
  assert.equal(parseProgress("45%"), 45);
  assert.equal(parseProgress("45"), 45);
  assert.equal(parseProgress("0,45"), 45);
  assert.equal(parseProgress("45,5%"), 45.5);
  assert.equal(parseProgress(0.45), 45);
  assert.equal(parseProgress("100%"), 100);
  assert.equal(parseProgress("150"), 100);
  assert.equal(parseProgress(""), null);
  assert.equal(parseProgress("abc"), null);
});

test("andamento: datas dd/mm/aaaa, serial do Sheets e vazias", () => {
  assert.equal(parseSheetDate("08/09/2026"), "2026-09-08");
  assert.equal(parseSheetDate("8/9/26"), "2026-09-08");
  assert.equal(parseSheetDate(46273), "2026-09-08");
  assert.equal(parseSheetDate("2026-09-08"), "2026-09-08");
  assert.equal(parseSheetDate(""), "");
  assert.equal(parseSheetDate("32/13/2026"), "");
});

test("andamento: códigos do orçamento com intervalo expandem pela ordem do orçamento", () => {
  const { codes, warnings } = expandBudgetCodes("2.1.9, 2.1.17-2.1.29", budget.items);
  assert.equal(codes.length, 14);
  assert.equal(codes[0], "2.1.9"); assert.equal(codes[1], "2.1.17"); assert.equal(codes.at(-1), "2.1.29");
  assert.deepEqual(warnings, []);
  // sem orçamento: expansão numérica do último segmento quando o prefixo é igual
  assert.deepEqual(expandBudgetCodes("2.2.4-2.2.6").codes, ["2.2.4", "2.2.5", "2.2.6"]);
  assert.deepEqual(expandBudgetCodes("orc_2_1_2").codes, ["2.1.2"]);
  assert.equal(expandBudgetCodes("9.9.9", budget.items).warnings.length, 1);
  assert.deepEqual(expandBudgetCodes("").codes, []);
});

test("andamento: CSV de exemplo é lido por linha, ignorando linhas vazias", () => {
  const result = parseProgressCsv(fixture, { budgetItems: budget.items });
  assert.equal(result.hasItemColumn, true);
  assert.equal(result.rows.length, 5);
  assert.equal(result.hasProgress, true);
  assert.equal(result.latestInfoDate, "2026-10-16");
  const demolicao = result.rows.find(row => row.item === "3");
  assert.equal(demolicao.progress, 80);
  assert.equal(demolicao.actualStart, "2026-09-16");
  assert.equal(demolicao.actualEnd, "");
  assert.equal(demolicao.status, "Em andamento");
  assert.equal(demolicao.missingMaterial, "EXEMPLO: caçamba extra");
  assert.deepEqual(demolicao.budgetItemIds, ["orc_1_1"]);
  assert.equal(result.rows.find(row => row.item === "2").progress, 1); // "1" sem decimal = 1%
  const tirantes = result.rows.find(row => row.item === "8");
  assert.equal(tirantes.budgetCodes.length, 14);
  assert.equal(tirantes.budgetItemIds.at(-1), "orc_2_1_29");
  assert.equal(tirantes.progress, null);
  assert.equal(result.rows.find(row => row.item === "6").source, "EXEMPLO - mensagem fictícia");
});

test("andamento: tolerante a colunas faltando e sem coluna Item casa só nomes únicos", () => {
  const csv = "Etapa,Status\nDemolição,Concluída\nEscavação e bota-fora,Em andamento\nEscavação e bota-fora,Não iniciada\n,\n";
  const result = parseProgressCsv(csv);
  assert.equal(result.hasItemColumn, false);
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows[0].uniqueName, true);
  assert.equal(result.rows[1].uniqueName, false);
  assert.equal(result.rows[0].progress, null);
  assert.ok(result.warnings.some(message => message.includes("sem coluna")));
});

test("andamento: sem cabeçalho reconhecido retorna lista vazia com aviso", () => {
  const result = parseProgressCsv("<html>login</html>");
  assert.deepEqual(result.rows, []);
  assert.equal(result.warnings.length, 1);
  assert.equal(parseCsv('a,"b,c"\n').at(0).length, 2);
});
