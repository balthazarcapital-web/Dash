import test from "node:test";
import assert from "node:assert/strict";
import { montarDadosLocacoes, naObraPelasObservacoes } from "../lib/locacoes-mapa.mjs";

const CAB = ["Data do pedido", "Locadora", "Obra/Cliente", "O que foi pedido", "Conversa (WhatsApp)", "Recebido/Enviado (NF e boleto)", "Data da baixa", "Aviso ao Billy enviado em", "Observações", "Data da solicitação da entrega", "Data da entrega", "Data da solicitação da retirada/troca", "Data da retirada/troca", "Dias locado", "Data de chegada da NF/boleto", "Data do envio ao cliente", "Valor/Vencimento"];
const linha = o => CAB.map(c => o[c] || "");
const EXEMPLO = [CAB,
  linha({ "Data do pedido": "15/10/2026", "Locadora": "Locadora X", "Obra/Cliente": "Dr. Clóvis", "O que foi pedido": "Caçamba", "Observações": "Na obra: caçamba entregue em 16/10/2026." }),
  linha({ "Obra/Cliente": "Carlos Bezerra", "O que foi pedido": "Locação de betoneira 400L", "Observações": "NÃO É LOCAÇÃO" }),
  linha({ "Obra/Cliente": "Deterlimp", "O que foi pedido": "Andaime", "Observações": "Pedido cancelado pelo cliente" }),
  linha({ "Obra/Cliente": "Solon", "O que foi pedido": "Andaime", "Valor/Vencimento": "R$ 900,00 – venc. 28/10/2026", "Recebido/Enviado (NF e boleto)": "boleto pago" }),
  linha({ "Obra/Cliente": "Obra desconhecida", "O que foi pedido": "Gerador" }),
  ["", "", ""]
];

test("monta o mapa de locações a partir das linhas da planilha", () => {
  const d = montarDadosLocacoes(EXEMPLO, new Date("2026-10-19T14:00:00Z"));
  assert.equal(d.gerado_em, "19/10/2026 11:00");
  const por = Object.fromEntries(d.obras.map(o => [o.id, o.itens]));
  assert.equal(por.clovis.length, 1);
  assert.equal(por.clovis[0].linha_tempo[1][1], "16/10/2026");
  assert.equal(por.clovis[0].data_pedido_iso, "2026-10-15");
  assert.equal(por.carlos.length, 0);
  assert.equal(por.deterlimp.length, 0);
  assert.deepEqual(d.excluidas.map(e => e.linha), [3, 4]);
  assert.equal(por.solon[0].valor, "R$ 900,00");
  assert.equal(por.solon[0].vencimento_iso, "2026-10-28");
  assert.equal(por.solon[0].pago, true);
  assert.deepEqual(d.nao_mapeadas.map(r => r.linha), [6]);
});

test("infere 'Na obra' pelas Observações", () => {
  assert.equal(naObraPelasObservacoes("Na obra desde ontem"), "Na obra");
  assert.equal(naObraPelasObservacoes("Ainda não está na obra"), "");
  assert.equal(naObraPelasObservacoes("Sem informação"), "");
});

test("rejeita planilha vazia ou sem cabeçalho", () => {
  assert.throws(() => montarDadosLocacoes([]));
  assert.throws(() => montarDadosLocacoes([["a", "b"]]));
});

import { lerCsv, lerCsvPublico } from "../lib/locacoes-mapa.mjs";
const csvDe = linhas => linhas.map(l => l.map(c => /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(",")).join("\r\n");
const resp = (corpo, tipo = "text/csv", status = 200, url = "https://docs.google.com/x") => ({ ok: status < 400, status, url, headers: { get: () => tipo }, text: async () => corpo });

test("CSV público: lê aspas, vírgulas e quebras de linha e monta o mesmo resultado", async () => {
  const comQuebra = EXEMPLO.map(l => l.slice()); comQuebra[1][8] = 'Na obra: caçamba entregue em 16/10/2026,\n"ok"';
  assert.deepEqual(lerCsv(csvDe(comQuebra)).slice(0, 2), comQuebra.slice(0, 2));
  const linhas = await lerCsvPublico(async () => resp("\uFEFF" + csvDe(EXEMPLO)));
  const d = montarDadosLocacoes(linhas);
  assert.equal(d.obras.find(o => o.id === "clovis").itens[0].linha_tempo[1][1], "16/10/2026");
  assert.deepEqual(d.excluidas.map(e => e.linha), [3, 4]);
});

test("CSV público: HTML, 401 ou login contam como falha", async () => {
  await assert.rejects(lerCsvPublico(async () => resp("<!DOCTYPE html>", "text/html; charset=utf-8", 401)));
  await assert.rejects(lerCsvPublico(async () => resp("<html>", "text/html", 200, "https://accounts.google.com/ServiceLogin")));
  await assert.rejects(lerCsvPublico(async () => resp("<!doctype html>", "text/plain")));
});
