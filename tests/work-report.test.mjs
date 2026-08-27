import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const context=vm.createContext({window:{},Intl,Date});
vm.runInContext(readFileSync(new URL("../work-report.js",import.meta.url),"utf8"),context);
const {buildModel,reportHTML}=context.window.WorkReport;
const {costBreakdown,costHTML}=context.window.WorkReport;
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
test("material e mão de obra têm valores separados e outros não são distribuídos",()=>{
  const item={plannedMaterial:100,plannedLabor:200},rows=[{type:"Material",value:120},{type:"Mão de obra",value:50},{type:"Outros",value:15},{value:5}];
  const groups=costBreakdown(item,rows);
  assert.equal(groups[0].actual,120);assert.equal(groups[1].actual,50);assert.equal(groups[2].actual,20);
  const html=costHTML(item,rows);
  assert.equal((html.match(/class="cost-part over"/g)||[]).length,1);
  assert.ok(html.includes("Acima do orçado"));
});
test("realizado sem orçamento tem barra cheia e vermelha; igualdade não é estouro",()=>{
  assert.ok(costHTML({plannedMaterial:0,plannedLabor:20},[{type:"Material",value:1}]).includes('width:100%'));
  assert.equal(costHTML({plannedMaterial:20,plannedLabor:20},[{type:"Material",value:20}]).includes('cost-part over'),false);
});
