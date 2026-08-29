import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const context=vm.createContext({window:{},Intl,Date});
vm.runInContext(readFileSync(new URL("../work-report.js",import.meta.url),"utf8"),context);
const {buildModel,reportHTML}=context.window.WorkReport;
const {costBreakdown,costHTML}=context.window.WorkReport;
test('chuva distingue ausência, zero e datas úteis no período filtrado',()=>{
  const api=context.window.WorkReport;
  const rows=[{date:'2026-08-03',prcp:2},{date:'2026-08-01',prcp:.1},{date:'2026-08-04',prcp:0},{date:'2026-08-05',prcp:null},{date:'2026-08-06',prcp:''},{date:'2026-08-07',prcp:-999}];
  const s=api.rainSummary(rows);
  assert.equal(s.measured,3);assert.equal(s.missing,3);assert.equal(s.rainy.length,2);assert.equal(s.workdays,1);
  assert.equal(api.rainSummary(api.filterClimate(rows,'2026-08-01','2026-08-02')).workdays,0);
  assert.match(api.rainSummaryHTML(rows),/Fim de semana/);assert.match(api.rainSummaryHTML(rows),/Segunda-feira/);
  const missing=api.rainSummaryHTML([{date:'2026-08-01',prcp:null}]);
  assert.match(missing,/Dados de chuva não informados/);assert.doesNotMatch(missing,/<strong>0<\/strong>/);
  assert.match(api.rainSummaryHTML([{date:'2026-08-01',prcp:0}]),/<strong>0<\/strong>/);
  assert.match(api.climateHTML(rows),/Resumo dos dias com chuva/);
});
test('cores do calendário usam escala fixa e deixam média ausente neutra',()=>{
  const {temperatureColor,climateHTML}=context.window.WorkReport;
  assert.equal(temperatureColor(10).accent,'rgb(49,113,187)');
  assert.equal(temperatureColor(30).accent,'rgb(192,64,65)');
  assert.equal(temperatureColor(0).accent,temperatureColor(10).accent);
  assert.equal(temperatureColor(45).accent,temperatureColor(30).accent);
  for(const v of [null,undefined,'',' ',NaN])assert.equal(temperatureColor(v),null);
  assert.notEqual(temperatureColor(16).accent,temperatureColor(22).accent);
  const rows=[{date:'2026-08-01',tavg:16},{date:'2026-08-02',tavg:22}];
  const style='--wc-accent:'+temperatureColor(16).accent;
  assert.ok(climateHTML(rows).includes(style));
  assert.ok(climateHTML(rows.slice(0,1)).includes(style));
});
test('clima publicado carrega 28 dias, preserva ausências e isola cliente',()=>{
  const local=vm.createContext({window:{},Intl,Date});
  vm.runInContext(readFileSync(new URL('../climate-data.js',import.meta.url),'utf8'),local);
  vm.runInContext(readFileSync(new URL('../work-report.js',import.meta.url),'utf8'),local);
  const api=local.window.WorkReport;
  const rows=api.climateFor({clientId:'dr_clovis_cmfs'});
  assert.equal(rows.length,28);assert.equal(rows[0].prcp,0);
  assert.equal(api.rainSummary(rows).rainy.length,7);
  assert.equal(api.rainSummary(rows).workdays,4);
  assert.equal(rows.at(-1).rainHours,8);
  assert.equal(Math.round(rows.reduce((s,r)=>s+r.prcp,0)*10)/10,14);
  assert.equal(api.climateFor({clientId:'deterlimp'}).length,0);
  assert.equal(api.climateRange(rows).end,'2026-08-28');
  const selected=api.filterClimate(rows,'2026-08-10','2026-08-11');
  assert.equal(selected.length,2);
  const html=api.climateHTML(selected);
  assert.match(html,/10\/08\/2026/);assert.match(html,/America\/Sao_Paulo/);assert.match(html,/wc-grid/);
  assert.match(html,/wc-rain/);assert.match(html,/mm/);
  assert.match(api.climateHTML(rows),/Parcial/);
  assert.match(api.climateHTML(rows,{id:'overview-climate-calendar'}),/id="overview-climate-calendar"/);
  assert.match(api.climateHTML([{date:'2026-08-01',prcp:2}]),/class="wc-day wc-rain"/);
  assert.doesNotMatch(html,/Sem chuva|☁|☀|Consulta|NaN/);
  assert.match(api.climateHTML([]),/Nenhum registro/);
  assert.doesNotMatch(readFileSync(new URL('../work-report.js',import.meta.url),'utf8'),/\/api\/weather/);
});
test('expediente converte UTC e exclui madrugada e intervalos fora de 8–17h',async()=>{
  const {aggregateBusinessHours}=await import('../scripts/import-climate.mjs');
  const sample=(hour,prcp,tavg=20)=>({timestamp:`2026-08-14T${hour}:00:00Z`,prcp,tavg,tmin:tavg-1,tmax:tavg+1});
  const rows=aggregateBusinessHours([sample('05',50),sample('11',9),sample('12',1),sample('19',2),sample('20',3),sample('21',40)]);
  assert.equal(rows.length,1);assert.equal(rows[0].date,'2026-08-14');
  assert.equal(rows[0].prcp,6);assert.equal(rows[0].rainHours,3);assert.equal(rows[0].tempHours,4);
  assert.equal(rows[0].expectedRainHours,9);assert.equal(rows[0].timeBasis,'America/Sao_Paulo');
  assert.equal(aggregateBusinessHours([sample('05',50)]).length,0);
  const missing=aggregateBusinessHours([{...sample('12',null)}])[0];assert.equal(missing.prcp,null);
  const overnight=aggregateBusinessHours([sample('05',50),sample('12',0)])[0];assert.equal(overnight.prcp,0);
});
test('CSV horário: decimais, ausências, cobertura, extremos e atualização sem duplicar',async()=>{
  const {normalizeHourlyRows,mergeHours,aggregateHours}=await import('../scripts/import-climate.mjs');
  const row={Data:'01/08/2026','Hora (UTC)':'0000','Temp. Ins. (C)':'10,5','Temp. Min. (C)':'9','Temp. Max. (C)':'12','Chuva (mm)':'0,2','Vel. Vento (m/s)':'1','Raj. Vento (m/s)':'3','Umi. Ins. (%)':'90','Pressao Ins. (hPa)':'900'};
  const a=normalizeHourlyRows([row,{...row,'Hora (UTC)':'0100','Temp. Ins. (C)':'11,5','Chuva (mm)':''}]);
  assert.equal(a[1].prcp,null);
  const day=aggregateHours(a)[0];assert.equal(day.tavg,11);assert.equal(day.prcp,.2);assert.equal(day.rainHours,1);assert.equal(day.tmin,9);
  assert.equal(mergeHours(a,a).length,2);
  const update=normalizeHourlyRows([{...row,'Chuva (mm)':''}]);
  assert.equal(aggregateHours(mergeHours(a,update))[0].prcp,.2);
  assert.throws(()=>normalizeHourlyRows([row,row]),/duplicada/);
  assert.throws(()=>normalizeHourlyRows([{...row,'Hora (UTC)':'2400'}]),/inválida/);
  assert.throws(()=>normalizeHourlyRows([{...row,Data:'30/02/2026'}]),/inválida/);
  assert.throws(()=>normalizeHourlyRows([{...row,'Chuva (mm)':'-2'}]),/faixa/);
  assert.equal(normalizeHourlyRows([{...row,'Chuva (mm)':'-9999'}])[0].prcp,null);
  assert.equal(aggregateHours([{timestamp:'2026-08-02T00:00:00Z'}]).length,0);
});
test('importação climática atualiza datas sem duplicar e preserva zero versus vazio',async()=>{
  const {normalizeRows,mergeRows}=await import('../scripts/import-climate.mjs');
  const original=normalizeRows([{date:'2026-08-28 00:00:00',tavg:22,prcp:null}]);
  const incoming=normalizeRows([{date:'2026-08-28',tavg:23,prcp:0},{date:'2026-08-29',tavg:24,prcp:''}]);
  assert.equal(original[0].prcp,null);
  const merged=mergeRows(original,incoming);
  assert.equal(merged.length,2);assert.equal(merged[0].tavg,23);assert.equal(merged[0].prcp,0);assert.equal(merged[1].prcp,null);
  assert.equal(context.window.WorkReport.climateRange(merged).end,'2026-08-29');
  assert.throws(()=>normalizeRows([{date:'2026-02-30',tavg:1}]),/Data inválida/);
});
vm.runInContext(readFileSync(new URL("../area-report.js",import.meta.url),"utf8"),context);
vm.runInContext(readFileSync(new URL("../rental-executive.js",import.meta.url),"utf8"),context);
vm.runInContext(readFileSync(new URL("../order-executive.js",import.meta.url),"utf8"),context);
test("pedidos: pendências respeitam status, cancelamento e vencimentos",()=>{
  const rows=[{status:"Entregue",value:100,payment:"Falta pagar",due:"2026-08-27"},
    {status:"Cancelado",value:50,payment:"Falta pagar",due:"2026-08-20"},
    {status:"Em cotação",invoice:"solicitar"},{status:"Concluído",nfFile:"arquivo",value:20}];
  const m=context.window.OrderExecutive.model(rows,"2026-08-28");
  assert.equal(m.total,170);assert.equal(m.open,100);assert.equal(m.pendingNF.length,1);
  assert.equal(m.late.length,1);assert.equal(m.invoices.length,1);
});
test("ranking exclui cancelados, agrupa fornecedores e pendências não duplicam pedidos",()=>{
  const api=context.window.OrderExecutive;
  const rows=[{number:"1",supplier:"A",value:100,status:"Entregue",payment:"Falta pagar",date:"2026-08-01",due:"2026-08-20"},{number:"2",supplier:"A",value:50,status:"Em cotação",date:"2026-09-01"},{value:900,status:"Cancelado"},{status:"Em cotação"}];
  const m=api.model(rows,"2026-08-28"),a=api.analysis(m);
  assert.equal(a.base,150);assert.equal(a.ranked[0].number,"1");assert.equal(a.supplierRanking[0][1],150);
  assert.equal(a.pending.length,3);assert.equal(a.pending[0].reasons.length,2);assert.equal(a.pending[0].overdue,8);assert.equal(a.pending[0].age,27);
  assert.equal(a.pending.find(p=>p.row.number==="2").age,null);
  assert.equal(api.analysis(api.model([],"2026-08-28")).pending.length,0);
  assert.ok(api.analysisHTML(m).includes("dias de atraso financeiro"));
});
test("pedidos: período usa data de pedido, vazio e campos livres são seguros",()=>{
  const rows=[{date:"2026-08-10",issue:"2026-09-10"},{date:"2026-09-10",issue:"2026-08-10"},{date:"inválida"}];
  assert.equal(context.window.AreaReports.filterRows(rows,"orders","2026-08-01","2026-08-31").length,2);
  const render=context.window.OrderExecutive.render;
  assert.ok(render({rows:[],period:"Todos"}).includes("Nenhum pedido"));
  const html=render({rows:[{description:"<script>",notes:"A & B",value:null}],period:"Todos"});
  assert.ok(html.includes("&lt;script&gt;"));assert.ok(html.includes("A &amp; B"));assert.ok(!html.includes("NaN"));
});
test("pedidos: categoria e status combinam com período e podem ser removidos",()=>{
  const rows=[{category:"Locação",status:"Concluído",date:"2026-08-01"},{category:"Locação",status:"Em cotação"},{category:"Civil",status:"Concluído",date:"2026-08-03"}];
  const filter=context.window.AreaReports.filterRows;
  assert.equal(filter(rows,"orders","","",{category:"Locação"}).length,2);
  assert.equal(filter(rows,"orders","","",{category:"Locação",status:"Concluído"}).length,1);
  assert.equal(filter(rows,"orders","2026-09-01","",{category:"Locação"}).length,1);
  assert.equal(filter(rows,"orders","","",{category:"",status:""}).length,3);
  assert.equal(filter(rows,"orders","","",{category:"Civil",status:"Em cotação"}).length,0);
  assert.equal(filter(rows,"orders","","",{category:["Civil","Locação"],status:["Concluído"]}).length,2);
  assert.equal(filter(rows,"orders","","",{category:["Locação"],status:["Concluído","Em cotação"]}).length,2);
  assert.equal(filter(rows,"orders","","",{category:[],status:["Concluído"]}).length,0);
});
test("relatório de locações separa prazo financeiro, vencidos e próximos e não presume mensalidade",()=>{
  const rows=[{status:"Ativa",sent:"2026-08-01",financialDue:"2026-08-01",value:150},
    {status:"Em uso",due:"2026-08-27",value:100,billing:"Mensal"},
    {status:"Solicitado",due:"2026-09-04"},{status:"Finalizado",due:"2026-08-20"}];
  const m=context.window.RentalExecutive.model(rows,"2026-08-28");
  assert.equal(m.active.length,3);assert.equal(m.late.length,1);assert.equal(m.soon.length,1);
  assert.equal(m.monthly.length,1);assert.equal(m.undated,3);
  assert.equal(context.window.AreaReports.filterRows(rows,"rentals","2026-09-01","").length,3);
});
test("prévia executiva trata vazio, escapa nomes e mantém cronologia individual",()=>{
  const api=context.window.RentalExecutive;
  const empty=api.render({rows:[],period:"Todos"});assert.ok(empty.includes("Nenhuma locação"));assert.ok(!empty.includes("NaN"));
  const html=api.render({rows:[{item:"<script>",status:"Ativa",sent:"2026-08-01",exchange:"2026-09-01",due:"2026-08-20"}],period:"Todos"},{clientName:"A & B"});
  assert.ok(html.includes("&lt;script&gt;"));assert.ok(html.includes("A &amp; B"));
  assert.ok(html.indexOf("20/08/2026")<html.indexOf("01/09/2026"));
  assert.ok(html.includes("Troca prevista"));assert.ok(html.includes("Periodicidade não informada"));
});
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
