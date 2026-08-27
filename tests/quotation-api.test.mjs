import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { handleQuotationTool } from '../lib/quotation-api.mjs';
import { normalizeDocument } from '../lib/quotation-core.mjs';
const root='root_test_123', folder='folder_test_123', file='file_test_123';
const d=()=>({id:'draft_test_123',clientId:'test',folderId:folder,request:normalizeDocument({number:'TESTE',items:[{description:'Material fictício',quantity:1,unit:'UN'}]},'request'),suppliers:[normalizeDocument({name:'Fornecedor fictício',items:[{description:'Material fictício',quantity:1,unit:'UN',unitPrice:10,lineTotal:10}]},'supplier')],matches:[]});
async function call(route,body,driveFetch){
  const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.method='POST';req.headers={host:'localhost'};
  let status,headers,buffer;const res={writeHead(s,h){status=s;headers=h},end(b){buffer=Buffer.from(b)}};
  await handleQuotationTool(req,res,new URL('http://localhost/api/quotation-tool/'+route),{driveFetch,driveConfigured:()=>true,driveRoots:{test:root}});
  return {status,headers,data:headers['Content-Type'].startsWith('application/json')?JSON.parse(buffer):buffer};
}
function driveMock(existing){
  const calls=[];const respond=data=>({json:async()=>data});
  const drive=async(address,options={})=>{
    calls.push({address,options});
    if(address.includes('/upload/'))return respond({id:file,name:'Mapa teste',version:'4'});
    const url=new URL(address);
    if(url.pathname.endsWith('/'+root))return respond({id:root,mimeType:'application/vnd.google-apps.folder'});
    if(url.pathname.endsWith('/'+folder))return respond({id:folder,parents:[root],mimeType:'application/vnd.google-apps.folder'});
    if(url.pathname.endsWith('/'+file))return respond({id:file,parents:[folder],webViewLink:'https://docs.google.com/spreadsheets/d/'+file,version:'4'});
    if(url.searchParams.has('q'))return respond({files:existing?[{id:file,version:'3'}]:[]});
    throw new Error('Unexpected Drive URL');
  };return {calls,drive};
}
test('export Google cria planilha nativa na pasta da obra, sem apagar arquivos',async()=>{
  const mock=driveMock(false),result=await call('export',{draft:d(),format:'sheets'},mock.drive);
  assert.equal(result.status,200);assert.match(result.data.url,/docs.google.com\/spreadsheets/);
  const upload=mock.calls.find(c=>c.address.includes('/upload/'));assert.equal(upload.options.method,'POST');
  const body=upload.options.body.toString('utf8');assert.ok(body.includes('application/vnd.google-apps.spreadsheet'));assert.ok(body.includes('"parents":["'+folder+'"]'));
  assert.ok(!mock.calls.some(c=>c.options.method==='DELETE'));
});
test('export posterior atualiza o mesmo arquivo de mapa',async()=>{
  const mock=driveMock(true),result=await call('export',{draft:d(),format:'sheets'},mock.drive);
  assert.equal(result.status,200);const upload=mock.calls.find(c=>c.address.includes('/upload/'));assert.equal(upload.options.method,'PATCH');assert.ok(upload.address.includes('/'+file+'?'));
});
test('salvar rascunho sem versão atual não sobrescreve alterações de outro computador',async()=>{
  const mock=driveMock(true);assert.equal((await call('save',{draft:d()},mock.drive)).status,409);assert.ok(!mock.calls.some(c=>c.address.includes('/upload/')));
  assert.equal((await call('save',{draft:d(),version:'3'},mock.drive)).status,200);
});
test('Drive fora da obra é rejeitado antes de exportar',async()=>{
  const draft=d();draft.folderId='outside_test_123';
  const result=await call('export',{draft,format:'sheets'},async()=>({json:async()=>({id:draft.folderId,mimeType:'application/vnd.google-apps.folder',parents:[]})}));
  assert.equal(result.status,403);
});
