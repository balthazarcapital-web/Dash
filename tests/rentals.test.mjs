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

function fixture({withoutControl=false}={}){
  const rows=[['Carimbo de data/hora','Descrição','Categoria De Solicitação','Nº do Pedido','Status','Fornecedor','Valor','Controle de locação','Solicitante','Previsão de Entrega - minimo 15 dias','Ocorrências do Pedido'],['2026-08-20','Pedido anterior','Civil','10','Entregue','Outra empresa',900,'']];
  const folders=[],writes=[];let failAppend=false,loseResponse=false;
  if(withoutControl) rows[0].splice(7,1);
  const response=body=>({ok:true,json:async()=>body});
  const driveFetch=async(url,options)=>{
    const body=options?JSON.parse(options.body):null;
    assert.ok(url.startsWith('https://sheets.googleapis.com/'), 'Este piloto não pode chamar a API do Drive');
    if(url.includes('?fields=sheets'))return response({sheets:[{properties:{sheetId:7,title:'Respostas ao formulário 1',gridProperties:{columnCount:26}}}]});
    if(!options)return response({values:structuredClone(rows)});
    writes.push({url,body});
    if(url.includes(':batchUpdate') && body.requests){const start=body.requests[0].deleteDimension.range.startIndex;rows.splice(start,1);return response({});}
    if(options.method==='PUT') {const match=decodeURIComponent(url).match(/!([A-Z]+)(\d+)\?/);let col=0;for(const c of match[1])col=col*26+c.charCodeAt(0)-64;rows[Number(match[2])-1][col-1]=body.values[0][0];return response({});}
    if(url.includes(':append')){if(failAppend){failAppend=false;throw new Error('Indisponível');}rows.push(body.values[0]);if(loseResponse){loseResponse=false;throw new Error('Resposta perdida');}return response({});}
    if(url.endsWith('/values:batchUpdate')){for(const entry of body.data){const match=entry.range.match(/!([A-Z]+)(\d+)$/);let col=0;for(const c of match[1])col=col*26+c.charCodeAt(0)-64;rows[Number(match[2])-1][col-1]=entry.values[0][0];}return response({});}
    throw new Error('Unexpected write '+url);
  };
  return {rows,folders,writes,fail:()=>{failAppend=true;},lose:()=>{loseResponse=true;},service:createRentalService({driveFetch,spreadsheetBases:{obra:{id:'sheet',gid:'7'}},now:()=>new Date('2026-08-28T01:30:00Z')})};
}
const rental={id:'test-rental-0001',item:'Caçamba madeira',requester:'Brendon',needDate:'2026-08-29',notes:'Troca de caçamba',supplier:'Transdetritos',documentNumber:'06319',sent:'2026-08-27',due:'2026-08-31',status:'Solicitado',billing:'Por evento',value:250};
test('novo cadastro grava somente na base oficial, sem número ou Drive, preservando MTR e horário de São Paulo',async()=>{
  const f=fixture();const saved=await f.service.save('obra',rental);
  assert.equal(f.rows.length,3);assert.equal(f.folders.length,0);
  assert.equal(saved.documentNumber,'06319');
  assert.equal(saved.orderNumber,'');assert.equal(f.rows[2][3],'');
  assert.equal(saved.folderId,'');assert.equal(f.rows[1][1],'Pedido anterior');
  assert.equal(f.rows[2][0],'27/08/2026 22:30:00');
  assert.equal(f.rows[2][2],'Locação');assert.equal(f.rows[2][4],'Solicitado');
  assert.equal(f.rows[2][8],'Brendon');assert.equal(f.rows[2][9],'29/08/2026');assert.equal(f.rows[2][10],'Troca de caçamba');
});
test('reenvio usa a mesma linha; edição preserva financeiro, número oficial e detecta conflito',async()=>{
  const f=fixture();const first=await f.service.save('obra',rental);
  await f.service.save('obra',rental);
  assert.equal(f.rows.length,3);assert.equal(f.folders.length,0);
  f.rows[2][3]='7.1';
  const now=(await f.service.list('obra'))[0];
  const edited=await f.service.save('obra',{...now,item:'Caçamba de madeira – troca',value:400});
  assert.equal(edited.item,'Caçamba de madeira – troca');assert.equal(f.rows[2][6],250);
  assert.equal(edited.orderNumber,'7.1');
  await assert.rejects(()=>f.service.save('obra',{...first,item:'Nome antigo'}),/alterada/);
});
test('falha na planilha permite reenvio sem criar recursos no Drive',async()=>{
  const f=fixture();f.fail();await assert.rejects(()=>f.service.save('obra',rental),/Indisponível/);
  await f.service.save('obra',rental);assert.equal(f.folders.length,0);assert.equal(f.rows.length,3);
});
test('resposta perdida depois do append não duplica linha no reenvio',async()=>{
  const f=fixture();f.lose();await assert.rejects(()=>f.service.save('obra',rental),/Resposta perdida/);
  await f.service.save('obra',rental);assert.equal(f.rows.length,3);
});
test('primeiro cadastro acrescenta apenas o controle específico e preserva cabeçalhos oficiais',async()=>{
  const f=fixture({withoutControl:true});const before=[...f.rows[0]];
  const saved=await f.service.save('obra',rental);
  assert.deepEqual(f.rows[0].slice(0,before.length),before);
  assert.equal(f.rows[0].at(-1),'Controle de locação');
  assert.equal(saved.requester,'Brendon');assert.equal(saved.needDate,'2026-08-29');
  assert.equal(saved.orderNumber,'');
});
test('duplo envio concorrente no mesmo servidor usa o mesmo identificador',async()=>{
  const f=fixture();const [a,b]=await Promise.all([f.service.save('obra',rental),f.service.save('obra',rental)]);
  assert.equal(a.id,b.id);assert.equal(f.rows.length,3);
});
test('exclusão remove somente a linha oficial e respeita revisão',async()=>{
  const f=fixture();const saved=await f.service.save('obra',rental);
  const deleted=await f.service.delete('obra',saved);
  assert.equal(deleted.deleted,true);assert.equal(f.rows.length,2);assert.equal(f.folders.length,0);
  await assert.rejects(()=>f.service.delete('obra',saved),/não encontrada/);
});
test('validação e cliente inválido não gravam',async()=>{
  const f=fixture();await assert.rejects(()=>f.service.save('obra',{...rental,due:'2026-02-30'}),/datas/);
  await assert.rejects(()=>f.service.save('outra',rental),/configurada/);
  await assert.rejects(()=>f.service.save('obra',{...rental,requester:''}),/solicitante/);
  assert.equal(f.writes.length,0);assert.equal(f.folders.length,0);
});
