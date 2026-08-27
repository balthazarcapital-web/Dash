import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
const saveSource = app.slice(app.indexOf("async function saveOrderNotes("), app.indexOf("\n  function ", app.indexOf("async function saveOrderNotes(")));
const updateSource = server.slice(server.indexOf("async function updateOrderInSheet("), server.indexOf("async function normalizeOrderStatusesInSheet("));
const norm = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

function fixture({fail = false, duplicate = false} = {}) {
  const rows = [
    ["Nº do Pedido", "Descrição", "Status", "Observação interna", "Ocorrências do pedido"],
    ["28", "Outro pedido", "Aprovado", "Não alterar", "Outra ocorrência"],
    ["29", "Materiais da obra", "Em cotação", "Não alterar", "Histórico anterior"]
  ];
  if (duplicate) rows.push([...rows[2]]);
  const writes = [], messages = [];
  const context = vm.createContext({
    spreadsheetBases: {test: {id: "sheet-test", gid: "123"}},
    cleanName: value => value, norm,
    driveFetch: async (url, options) => {
      if (url.includes("?fields=")) return {json: async () => ({sheets: [{properties: {sheetId: 123, title: "Pedidos da obra"}}]})};
      if (options) {if (fail) throw new Error("Falha de teste"); writes.push(JSON.parse(options.body)); return {ok:true};}
      assert.ok(decodeURIComponent(url).includes("'Pedidos da obra'!A:ZZ"));
      return {json: async () => ({values: rows})};
    },
    state: {clientId: "test"}, showToast: message => messages.push(message), renderTable: () => {}
  });
  vm.runInContext(updateSource, context);
  context.fetch = async (_, options) => {
    const input = JSON.parse(options.body);
    try {const result = await context.updateOrderInSheet(input.clientId, input.order); return {ok: true, json: async () => result};}
    catch(error) {return {ok:false, json:async () => ({error: error.message})};}
  };
  vm.runInContext(saveSource, context);
  const note = {value: "Nova ocorrência"}, button = {};
  const root = {querySelector: selector => selector === "[data-order-note]" ? note : button};
  return {context, writes, messages, note, button, root};
}

test("envio completo identifica pedido, preserva histórico e limpa somente após sucesso", async () => {
  const f = fixture(), order = {number: "29", description: "Materiais da obra", notes: "Histórico anterior"};
  await f.context.saveOrderNotes(order, 2, f.root);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].data.length, 1);
  assert.equal(f.writes[0].data[0].range, "'Pedidos da obra'!E3");
  assert.equal(f.writes[0].data[0].values[0][0], "Histórico anterior\n\nNova ocorrência");
  assert.equal(f.writes[0].valueInputOption, "RAW");
  assert.equal(order.notes, "Histórico anterior\n\nNova ocorrência");
  assert.equal(f.note.value, "");
  assert.equal(f.button.disabled, false);
});

test("erro preserva rascunho e observação confirmada", async () => {
  const f = fixture({fail:true}), order = {number:"29",description:"Materiais da obra",notes:"Histórico anterior"};
  await f.context.saveOrderNotes(order, 2, f.root);
  assert.equal(f.note.value,"Nova ocorrência");
  assert.equal(order.notes,"Histórico anterior");
  assert.equal(f.writes.length,0);
});

test("pedido sem identidade ou duplicado nunca escreve", async () => {
  const f = fixture({duplicate:true});
  await assert.rejects(f.context.updateOrderInSheet("test",{notes:"Texto"}),/identificação/);
  await assert.rejects(f.context.updateOrderInSheet("test",{number:"29",description:"Materiais da obra",notes:"Texto"}),/Mais de um/);
  assert.equal(f.writes.length,0);
});
