import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRentalService } from '../lib/rental-api.mjs';

const scope=vm.createContext({window:{},Intl,Date,Map,Number,structuredClone});
vm.runInContext(readFileSync(new URL('../area-report.js',import.meta.url),'utf8'),scope);
const reports=scope.window.AreaReports;
test('relatório separa mensalidade, evento, vencidos e valores desconhecidos',()=>{
  const rows=[{item:'Andaime',status:'Em uso',billing:'Mensal',value:200,due:'2026-08-28',documentNumber:'06319'},
    {item:'Caçamba',status:'Entregue',billing:'Por evento',value:300,due:'2026-08-27'},
    {item:'Devolvida',status:'Finalizado',billing:'Mensal',value:500},
    {item:'Sem preço',status:'Solicitado',value:null,due:'2026-09-04'}];
  const m=reports.rentalModel(rows,'Todos','2026-08-28');
  assert.equal(m.kpis[1][1],3);assert.equal(m.kpis[2][1],2);assert.equal(m.kpis[5][1],1);
  assert.match(m.kpis[4][1],/200,00/);
  assert.match(reports.render(m,{clientName:'Obra <teste>'}),/06319/);
  assert.match(reports.render(m,{clientName:'Obra <teste>'}),/Obra &lt;teste&gt;/);
});
test('datas ausentes ou inválidas não quebram relatório nem são excluídas das pendências',()=>{
  const rows=[{item:'A',sent:'2026-02-30'},{item:'B',sent:'Retirada em 27/08'},{item:'C',sent:'2026-08-27'},{item:'D',sent:'2026-07-01'}];
  const filtered=reports.filterRows(rows,'rentals','2026-08-01','2026-08-31');
  assert.equal(filtered.length,3);
  assert.equal(reports.rentalModel(filtered,'Agosto','2026-08-28').timeline.length,1);
  assert.equal(reports.formatDate('2026-99-01'),'Não informado');
  assert.doesNotThrow(()=>reports.render(reports.rentalModel([],'Todos')));
});

function fixture(){
  const rows=[['Carimbo de data/hora','Descrição','Categoria De Solicitação','Nº do Pedido','Status','Fornecedor','Valor','Controle de locação'],['2026-08-20','Pedido anterior','Civil','10','Entregue','Outra empresa',900,'']];
  const folders=[],writes=[];let failAppend=false;
  const response=body=>({ok:true,json:async()=>body});
  const driveFetch=async(url,options)=>{
    const body=options?JSON.parse(options.body):null;
    if(url.includes('/drive/v3/files?')&&!options)return response({files:folders});
    if(url.includes('/drive/v3/files?')&&options){const f={id:'folder-1',...body};folders.push(f);return response(f);}
    if(url.includes('?fields=sheets'))return response({sheets:[{properties:{sheetId:7,title:'Pedidos',gridProperties:{columnCount:26}}}]});
    if(!options)return response({values:structuredClone(rows)});
    writes.push({url,body});
    if(url.includes(':append')){if(failAppend){failAppend=false;throw new Error('Indisponível');}rows.push(body.values[0]);return response({});}
    if(url.endsWith('/values:batchUpdate')){for(const entry of body.data){const match=entry.range.match(/!([A-Z]+)(\d+)$/);let col=0;for(const c of match[1])col=col*26+c.charCodeAt(0)-64;rows[Number(match[2])-1][col-1]=entry.values[0][0];}return response({});}
    throw new Error('Unexpected write '+url);
  };
  return {rows,folders,writes,fail:()=>{failAppend=true;},service:createRentalService({driveFetch,spreadsheetBases:{obra:{id:'sheet',gid:'7'}},driveRoots:{obra:'root-obra'}})};
}
const rental={id:'test-rental-0001',item:'Caçamba madeira',supplier:'Transdetritos',documentNumber:'06319',sent:'2026-08-27',due:'2026-08-31',status:'Entregue',billing:'Por evento',value:250};
test('novo cadastro cria pasta na obra, pedido e preserva número textual do MTR',async()=>{
  const f=fixture();const saved=await f.service.save('obra',rental);
  assert.equal(f.rows.length,3);assert.equal(f.folders.length,1);
  assert.deepEqual(f.folders[0].parents,['root-obra']);assert.equal(saved.documentNumber,'06319');
  assert.equal(saved.orderNumber,'LOC-TESTRENTAL00');
  assert.equal(saved.folderId,'folder-1');assert.equal(f.rows[1][1],'Pedido anterior');
});
test('reenvio usa o mesmo pedido e pasta; edição preserva financeiro e detecta conflito',async()=>{
  const f=fixture();const first=await f.service.save('obra',rental);
  await f.service.save('obra',rental);
  assert.equal(f.rows.length,3);assert.equal(f.folders.length,1);
  const now=(await f.service.list('obra'))[0];
  const edited=await f.service.save('obra',{...now,item:'Caçamba de madeira – troca',value:400});
  assert.equal(edited.item,'Caçamba de madeira – troca');assert.equal(f.rows[2][6],250);
  await assert.rejects(()=>f.service.save('obra',{...first,item:'Nome antigo'}),/alterada/);
});
test('falha após pasta permite retomar sem pasta ou pedido duplicado',async()=>{
  const f=fixture();f.fail();await assert.rejects(()=>f.service.save('obra',rental),/Indisponível/);
  await f.service.save('obra',rental);assert.equal(f.folders.length,1);assert.equal(f.rows.length,3);
});
test('validação e cliente inválido não gravam',async()=>{
  const f=fixture();await assert.rejects(()=>f.service.save('obra',{...rental,due:'2026-02-30'}),/datas/);
  await assert.rejects(()=>f.service.save('outra',rental),/configurada/);
  assert.equal(f.writes.length,0);assert.equal(f.folders.length,0);
});
