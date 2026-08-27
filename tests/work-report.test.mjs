import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const context=vm.createContext({window:{},Intl,Date});
vm.runInContext(readFileSync(new URL("../work-report.js",import.meta.url),"utf8"),context);
const {buildModel,reportHTML}=context.window.WorkReport;
const work={details:{name:"Teste <obra>"},budget:{items:[{id:"a",plannedTotal:100,category:"A"},{id:"b",plannedTotal:200,category:"B"}],actuals:[{itemId:"a",value:30,orderRef:"ref",orderNumber:"1"},{itemId:"a",value:10,source:"Manual"},{itemId:"b",value:90}]}};
test("seleção de itens determina totais, sem incluir itens desmarcados",()=>{
  const m=buildModel(work,[{reportRef:"ref",invoice:"123",supplier:"Loja"}],["a"]);
  assert.equal(m.items.length,1);assert.equal(m.planned,100);assert.equal(m.actual,40);
  assert.equal(m.items[0].entries[0].invoice,"123");
  assert.equal(m.items[0].entries[1].invoice,"Não informada");
  assert.equal(buildModel(work,[],[]).items.length,0);
});
test("números ambíguos não atribuem NF e relatório escapa texto",()=>{
  const m=buildModel(work,[{number:"1",invoice:"x"},{number:"1",invoice:"y"}],["a"]);
  assert.equal(m.items[0].entries[0].linked,false);
  assert.ok(reportHTML(m).includes("Teste &lt;obra&gt;"));
});
test("número com zero à esquerda recupera NF quando o pedido é único",()=>{
  const m=buildModel(work,[{number:"01",invoice:"456",supplier:"Fornecedor"}],["a"]);
  assert.equal(m.items[0].entries[0].invoice,"456");
});
