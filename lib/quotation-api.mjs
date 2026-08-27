import crypto from 'node:crypto';
import { aiStatus, extractDocumentV2, matchSupplierV2 } from './quotation-ai.mjs';
import { buildMap, buildPurchaseOrder, validateDraft, text } from './quotation-core.mjs';
import { exportQuotationWorkbook } from './quotation-export.mjs';

const LIMIT = 4 * 1024 * 1024;
const json = (res, status, data) => { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' }); res.end(JSON.stringify(data)); };
const safe = value => text(value).replace(/[\\/:*?"<>|\r\n]/g,' ').slice(0,160);
const escapeQuery = value => String(value).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
async function readBody(req) {
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>LIMIT+100000)throw Object.assign(new Error('Arquivo muito grande para envio pelo navegador. Use o Drive ou um arquivo de até 4 MB.'),{status:413});chunks.push(chunk)}
  return Buffer.concat(chunks);
}
function checkDraft(draft, roots) {
  if (!draft || !/^[a-zA-Z0-9_-]{8,80}$/.test(draft.id || '') || !roots[draft.clientId]) throw new Error('Rascunho ou obra inválidos.');
}
async function metadata(id, drive) {
  if (!/^[a-zA-Z0-9_-]{8,150}$/.test(id || '')) throw new Error('Identificador do Drive inválido.');
  return (await drive(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType,parents,size,webViewLink,appProperties,version&supportsAllDrives=true`)).json();
}
async function inRoot(id, root, drive) {
  let current = await metadata(id,drive), seen=new Set();const original=current;
  for(let depth=0;depth<20;depth++){
    if(current.id===root)return original;
    if(seen.has(current.id)||!current.parents?.length)break;seen.add(current.id);current=await metadata(current.parents[0],drive);
  }
  throw Object.assign(new Error('Escolha um arquivo ou pasta dentro do Drive da obra selecionada.'),{status:403});
}
async function upload(drive, { folderId, name, mime, bytes, properties, existingId }) {
  const boundary='abs_'+crypto.randomUUID();
  const meta={name,mimeType:mime,appProperties:properties,...(!existingId?{parents:[folderId]}:{})};
  const payload=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime==='application/vnd.google-apps.spreadsheet'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':mime}\r\n\r\n`),bytes,Buffer.from(`\r\n--${boundary}--`)]);
  return (await drive(`https://www.googleapis.com/upload/drive/v3/files${existingId?'/'+existingId:''}?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink,version`,{method:existingId?'PATCH':'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body:payload})).json();
}
async function findFile(drive,folderId,key,value) {
  const q=`trashed=false and '${escapeQuery(folderId)}' in parents and appProperties has { key='${escapeQuery(key)}' and value='${escapeQuery(value)}' }`;
  return (await (await drive(`https://www.googleapis.com/drive/v3/files?${new URLSearchParams({q,fields:'files(id,name,version)',pageSize:'100',supportsAllDrives:'true',includeItemsFromAllDrives:'true'})}`)).json()).files?.[0];
}
export async function handleQuotationTool(req,res,url,{driveFetch:drive,driveConfigured,driveRoots:roots}) {
  if(!url.pathname.startsWith('/api/quotation-tool/'))return false;
  try{
    const route=url.pathname.slice('/api/quotation-tool/'.length);
    if(req.method!=='GET' && req.headers.origin && new URL(req.headers.origin).host!==req.headers.host) throw Object.assign(new Error('Origem da solicitação não permitida.'),{status:403});
    if(route==='status') {json(res,200,{version:2,ai:aiStatus(),drive:driveConfigured(),localUploadLimit:LIMIT});return true}
    const clientId=url.searchParams.get('clientId');
    if(route==='drive' && req.method==='GET'){
      if(!roots[clientId])throw new Error('Obra inválida.');
      const folderId=url.searchParams.get('folderId')||roots[clientId],folder=await inRoot(folderId,roots[clientId],drive);
      if(folder.mimeType!=='application/vnd.google-apps.folder')throw new Error('Selecione uma pasta.');
      const q=`trashed=false and '${escapeQuery(folderId)}' in parents`;
      const result=await (await drive(`https://www.googleapis.com/drive/v3/files?${new URLSearchParams({q,pageSize:'100',fields:'nextPageToken,files(id,name,mimeType,size)',orderBy:'folder,name',pageToken:url.searchParams.get('pageToken')||'',supportsAllDrives:'true',includeItemsFromAllDrives:'true'})}`)).json();
      json(res,200,{...result,folder,root:roots[clientId]});return true;
    }
    const body=await readBody(req);
    if(route==='extract' && req.method==='POST'){
      if(!roots[clientId])throw new Error('Obra inválida.');
      let bytes,filename,mime,inputText,driveSource;
      const kind=url.searchParams.get('kind');
      if(req.headers['content-type']?.includes('multipart/form-data')){
        const form=await new Request('http://localhost',{method:'POST',headers:{'Content-Type':req.headers['content-type']},body}).formData();
        const file=form.get('file');if(!file?.arrayBuffer)throw new Error('Selecione um arquivo.');
        bytes=Buffer.from(await file.arrayBuffer());filename=file.name;mime=file.type;
      }else{
        const data=JSON.parse(body.toString()||'{}');inputText=data.text;
        if(data.driveId){
          driveSource=await inRoot(data.driveId,roots[clientId],drive);filename=driveSource.name;mime=driveSource.mimeType;
          if(Number(driveSource.size)>12*1024*1024)throw new Error('Arquivo do Drive acima de 12 MB. Divida o documento.');
          let address=`https://www.googleapis.com/drive/v3/files/${driveSource.id}?alt=media&supportsAllDrives=true`;
          if(mime==='application/vnd.google-apps.spreadsheet'){address=`https://www.googleapis.com/drive/v3/files/${driveSource.id}/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`;filename+='.xlsx'}
          else if(mime==='application/vnd.google-apps.document'){address=`https://www.googleapis.com/drive/v3/files/${driveSource.id}/export?mimeType=application/pdf`;filename+='.pdf';mime='application/pdf'}
          bytes=Buffer.from(await (await drive(address)).arrayBuffer());
          if(bytes.length>12*1024*1024)throw new Error('Arquivo acima de 12 MB.');
        }
      }
      if(!bytes?.length&&!inputText)throw new Error('Envie o arquivo ou o texto do documento.');
      const doc=await extractDocumentV2({bytes,filename,mime,kind,inputText});
      if(driveSource)doc.source.driveId=driveSource.id;
      const folderId=url.searchParams.get('folderId');
      if(folderId&&bytes&&!driveSource){
        await inRoot(folderId,roots[clientId],drive);
        const sourceKey=`${url.searchParams.get('draftId')}:${kind}:${doc.id}`;
        const old=await findFile(drive,folderId,'quotationSource',sourceKey);
        const file=await upload(drive,{folderId,name:`${kind==='request'?'01 - Pedido':'02 - Orçamento - '+safe(doc.name||'Fornecedor')} - ${safe(filename)}`,mime:mime||'application/octet-stream',bytes,properties:{quotationSource:sourceKey},existingId:old?.id});
        doc.source.driveId=file.id;
      }
      json(res,200,{document:doc});return true;
    }
    const input=JSON.parse(body.toString()||'{}'),draft=input.draft;
    if(route==='match'){
      checkDraft(draft,roots);validateDraft(draft);
      const supplier=draft.suppliers.find(s=>s.id===input.supplierId);if(!supplier)throw new Error('Fornecedor inválido.');
      const matches=await matchSupplierV2(draft.request,supplier);json(res,200,{matches});return true;
    }
    if(route==='preview'){checkDraft(draft,roots);json(res,200,input.kind==='oc'?buildPurchaseOrder(draft,input.approval):buildMap(draft));return true}
    if(route==='save'){
      checkDraft(draft,roots);if(!draft.folderId)throw new Error('Selecione a pasta oficial do pedido no Drive.');
      await inRoot(draft.folderId,roots[draft.clientId],drive);
      const existing=await findFile(drive,draft.folderId,'quotationDraft',draft.id);
      if(existing&&String(existing.version)!==String(input.version))throw Object.assign(new Error('Este rascunho já tem uma versão no Drive. Reabra a versão atual antes de salvar, para não sobrescrever mudanças de outro computador.'),{status:409});
      const file=await upload(drive,{folderId:draft.folderId,name:`Cotação - rascunho - ${safe(draft.request?.number||draft.id.slice(0,8))}.json`,mime:'application/json',bytes:Buffer.from(JSON.stringify(draft)),properties:{quotationDraft:draft.id,quotationClient:draft.clientId},existingId:existing?.id});
      json(res,200,file);return true;
    }
    if(route==='load'){
      if(!roots[input.clientId])throw new Error('Obra inválida.');
      const file=await inRoot(input.fileId,roots[input.clientId],drive);
      if(!file.appProperties?.quotationDraft)throw new Error('O arquivo selecionado não é um rascunho desta ferramenta.');
      const data=await (await drive(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`)).json();checkDraft(data,roots);
      if(data.clientId!==input.clientId)throw new Error('O rascunho pertence a outra obra.');
      json(res,200,{draft:data,version:file.version});return true;
    }
    if(route==='export'){
      checkDraft(draft,roots);const kind=input.kind==='oc'?'oc':'map';
      const buffer=await exportQuotationWorkbook(draft,kind,input.approval);
      const supplier=draft.suppliers.find(s=>s.id===input.approval?.supplierId);
      const name=`${kind==='oc'?'04 - O.C. - '+safe(supplier?.name||'Fornecedor'):'03 - Mapa de Cotação'} - ${safe(draft.request.category||'Pedido')} ${safe(draft.request.number)} - ${safe(draft.request.work||draft.clientName||'Obra')}`;
      if(input.format==='sheets'){
        if(!draft.folderId)throw new Error('Selecione a pasta oficial do pedido para salvar a planilha Google.');
        const folder=await inRoot(draft.folderId,roots[draft.clientId],drive);if(folder.mimeType!=='application/vnd.google-apps.folder')throw new Error('Destino não é uma pasta.');
        const key=`${draft.id}:${kind}:${kind==='oc'?supplier.id:''}`;
        const old=await findFile(drive,draft.folderId,'quotationExport',key);
        const saved=await upload(drive,{folderId:draft.folderId,name,mime:'application/vnd.google-apps.spreadsheet',bytes:buffer,properties:{quotationExport:key},existingId:old?.id});
        const verified=await metadata(saved.id,drive);json(res,200,{id:verified.id,name:verified.name,url:verified.webViewLink});return true;
      }
      res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(name+'.xlsx')}`,'Cache-Control':'no-store'});res.end(buffer);return true;
    }
    json(res,404,{error:'Rota da ferramenta de cotação não encontrada.'});return true;
  }catch(error){json(res,error.status||400,{error:error.name==='TimeoutError'?'A leitura excedeu o tempo. Tente um documento menor.':error.message});return true}
}
