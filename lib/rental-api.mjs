import { createHash } from 'node:crypto';

const norm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const aliases = {
  description: ['Descrição'], category: ['Categoria De Solicitação', 'Categoria'],
  number: ['Nº do Pedido', 'Numero do Pedido'], date: ['Carimbo de data/hora', 'Coluna 1'],
  supplier: ['Fornecedor'], value: ['Valor'], status: ['Status'], requester: ['Solicitante'],
  needDate: ['Previsão de Entrega - minimo 15 dias', 'Previsão de Entrega', 'Entrega Prevista'],
  notes: ['Ocorrências do Pedido', 'Ocorrências', 'Observações']
};
const columnName = i => { let s = ''; for (let n = i + 1; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
const revision = row => createHash('sha256').update(JSON.stringify(row)).digest('hex');
const validDate = v => !v || (/^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(new Date(v+'T12:00:00Z').getTime()) && new Date(v+'T12:00:00Z').toISOString().slice(0,10) === v);
const sheetDate = v => {const text=String(v||'').split(' ')[0],br=text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);const d=br?`${br[3]}-${br[2].padStart(2,'0')}-${br[1].padStart(2,'0')}`:text;return validDate(d)?d:'';};
const sheetValue = v => {if(v===''||v===undefined||v===null)return null;if(typeof v==='number')return v;const n=Number(String(v).replace(/R\$|\s/g,'').replace(/\./g,'').replace(',','.'));return Number.isFinite(n)?n:null;};
function normalize(input) {
  const row = {};
  for (const key of ['id','item','supplier','documentNumber','sent','due','exchange','returnedDate','status','label','notes','billing','requester','needDate']) row[key] = String(input[key] ?? '').trim();
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(row.id)) throw new Error('Identificador da locação inválido.');
  if (!row.item || row.item.length > 500) throw new Error('Informe um nome de até 500 caracteres.');
  if (row.documentNumber.length > 80 || row.notes.length > 4000 || row.supplier.length > 240 || row.requester.length > 240) throw new Error('Um dos campos excede o tamanho permitido.');
  for (const k of ['sent','due','exchange','returnedDate','needDate']) if (!validDate(row[k])) throw new Error('Informe datas válidas.');
  row.value = input.value === '' || input.value === null || input.value === undefined ? null : Number(input.value);
  if (row.value !== null && (!Number.isFinite(row.value) || row.value < 0)) throw new Error('Valor inválido.');
  if (!['Solicitado','Entregue','Em uso','Trocado','Finalizado','Ativa','Chegou na obra'].includes(row.status)) throw new Error('Situação inválida.');
  if (!['Mensal','Por evento','Não informado'].includes(row.billing)) row.billing = 'Não informado';
  return row;
}

// Google Sheets is authoritative. The extra column keeps rental-specific data
// without overloading invoice numbers or financial due dates.
export function createRentalService({ driveFetch, spreadsheetBases, now = () => new Date() }) {
  const locks = new Map();
  async function request(url, options) {
    const response = await driveFetch(url, options);
    if (!response.ok) throw new Error(`Google respondeu ${response.status}. Dados não confirmados; tente novamente.`);
    return response.json();
  }
  const write = (url, body, method='POST') => request(url, {method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  async function read(clientId) {
    const base = spreadsheetBases[clientId];
    if (!base) throw new Error('Obra sem planilha configurada.');
    const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${base.id}`;
    const meta = await request(endpoint+'?fields=sheets(properties)');
    const sheet = meta.sheets.find(s=>String(s.properties.sheetId)===String(base.gid))?.properties;
    if (!sheet) throw new Error('Aba de pedidos não encontrada.');
    if (sheet.title !== 'Respostas ao formulário 1') throw new Error('A configuração não aponta para a aba oficial Respostas ao formulário 1.');
    const prefix = "'"+sheet.title.replaceAll("'","''")+"'!";
    const data = await request(endpoint+'/values/'+encodeURIComponent(prefix+'A:'+columnName(sheet.gridProperties.columnCount-1)));
    const rows = data.values || [], headerIndex = rows.findIndex(r=>r.some(c=>norm(c)==='descricao') && r.some(c=>norm(c)==='status'));
    if (headerIndex < 0) throw new Error('Cabeçalhos de pedidos não encontrados.');
    const header = rows[headerIndex], columns = Object.fromEntries(Object.entries(aliases).map(([key,names])=>[key,header.findIndex(c=>names.some(n=>norm(c)===norm(n)))]));
    const rentalColumn = header.findIndex(c=>c==='Controle de locação');
    return {base,endpoint,sheet,prefix,rows,header,headerIndex,columns,rentalColumn};
  }
  function records(ctx) {
    return ctx.rows.flatMap((cells,index)=>{
      if(index<=ctx.headerIndex || !norm(cells[ctx.columns.category]).includes('loca')) return [];
      let rental = null;
      if(ctx.rentalColumn>=0 && cells[ctx.rentalColumn]) { try { rental=JSON.parse(cells[ctx.rentalColumn]); } catch { throw new Error('Controle de locação inválido na linha '+(index+1)+'. Nenhum dado foi substituído.'); } }
      const get = key=>String(cells[ctx.columns[key]] ?? '');
      return [{...rental,id:rental?.id || '',item:get('description'),supplier:get('supplier'),requester:get('requester'),needDate:sheetDate(get('needDate')),orderNumber:get('number'),status:rental?.status || (/conclu|finaliz/i.test(norm(get('status')))?'Finalizado':/entregue/i.test(get('status'))?'Entregue':'Solicitado'),billing:rental?.billing||'Não informado',value:rental?rental.value:sheetValue(cells[ctx.columns.value]),sent:rental?rental.sent:sheetDate(get('date')),sheetRow:index+1,revision:revision(cells),reference:{number:get('number'),description:get('description')},sync:'shared'}];
    });
  }
  async function saveUnlocked(clientId,input) {
    const row = normalize(input), ctx = await read(clientId);
    for(const k of ['description','category','number','date','supplier','value','status']) if(ctx.columns[k]<0) throw new Error(`Coluna obrigatória ausente: ${aliases[k][0]}.`);
    const all = records(ctx);
    let matches = all.filter(r=>r.id===row.id);
    if(!matches.length && input.reference) matches=all.filter(r=>!r.id && r.reference.number===String(input.reference.number) && r.reference.description===String(input.reference.description));
    if(matches.length>1) throw new Error('Pedido ambíguo. Nenhuma alteração gravada.');
    const existing = matches[0];
    if (!existing && !row.requester) throw new Error('Informe o solicitante da locação.');
    if (!existing) for (const k of ['requester','needDate','notes']) if(ctx.columns[k]<0) throw new Error(`Coluna obrigatória ausente: ${aliases[k][0]}.`);
    if(input.reference && !existing) throw new Error('Pedido original não encontrado. Atualize antes de editar.');
    if(existing && input.revision && input.revision!==existing.revision) throw new Error('Esta locação foi alterada. Atualize a lista antes de salvar.');
    // Pilot: register only in the official sheet. Do not allocate a number or
    // create Drive resources. Preserve existing links when editing older rows.
    row.orderNumber = existing?.orderNumber || '';
    row.folderId = existing?.folderId || '';
    row.folderUrl = existing?.folderUrl || '';
    row.source = existing?.source || 'PAINEL';
    row.createdAt = existing?.createdAt || now().toISOString();
    row.updatedAt = now().toISOString();
    let col = ctx.rentalColumn;
    if(col<0) {
      col=ctx.header.length;
      if(col>=ctx.sheet.gridProperties.columnCount) await write(ctx.endpoint+':batchUpdate',{requests:[{appendDimension:{sheetId:ctx.sheet.sheetId,dimension:'COLUMNS',length:col+1-ctx.sheet.gridProperties.columnCount}}]});
      await write(ctx.endpoint+'/values/'+encodeURIComponent(ctx.prefix+columnName(col)+(ctx.headerIndex+1))+'?valueInputOption=RAW',{values:[['Controle de locação']]},'PUT');
    }
    const values = {description:row.item,category:'Locação',supplier:row.supplier,status:row.status==='Finalizado'?'Concluído':row.status==='Solicitado'?'Solicitado':'Entregue'};
    const brDate = value => value ? value.split('-').reverse().join('/') : '';
    if(ctx.columns.requester>=0) values.requester=row.requester || existing?.requester || '';
    if(ctx.columns.needDate>=0) values.needDate=brDate(row.needDate);
    // Preserve order financial values when editing; rental price has its own basis.
    if(!existing) {
      values.value=row.value??'';
      values.date=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'medium'}).format(now()).replace(',', '');
      values.notes=row.notes;
    }
    if(existing) {
      const data=Object.entries(values).map(([k,v])=>({range:ctx.prefix+columnName(ctx.columns[k])+existing.sheetRow,values:[[v]]}));
      data.push({range:ctx.prefix+columnName(col)+existing.sheetRow,values:[[JSON.stringify(row)]]});
      await write(ctx.endpoint+'/values:batchUpdate',{valueInputOption:'RAW',data});
    } else {
      const cells=Array(col+1).fill('');
      for(const [k,v] of Object.entries(values)) cells[ctx.columns[k]]=v;
      cells[col]=JSON.stringify(row);
      await write(ctx.endpoint+'/values/'+encodeURIComponent(ctx.prefix+'A:'+columnName(col))+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',{values:[cells]});
    }
    const confirmed = records(await read(clientId)).filter(r=>r.id===row.id);
    if(confirmed.length!==1) throw new Error('Gravação não confirmada. Reenvie o mesmo cadastro para conferir.');
    if(confirmed[0].item!==row.item || confirmed[0].supplier!==row.supplier || confirmed[0].documentNumber!==row.documentNumber) throw new Error('Os dados lidos não correspondem ao cadastro enviado. Atualize a lista antes de continuar.');
    return confirmed[0];
  }
  async function deleteUnlocked(clientId,input) {
    const row = normalize(input), ctx = await read(clientId);
    const existing = records(ctx).find(r => r.id === row.id || (input.reference && r.sheetRow === Number(input.reference.sheetRow)));
    if (!existing) throw new Error('Locação não encontrada na planilha oficial. Atualize a lista antes de excluir.');
    if (input.revision && input.revision !== existing.revision) throw new Error('Esta locação foi alterada. Atualize a lista antes de excluir.');
    await write(ctx.endpoint + ':batchUpdate', {requests:[{deleteDimension:{range:{sheetId:ctx.sheet.sheetId,dimension:'ROWS',startIndex:existing.sheetRow-1,endIndex:existing.sheetRow}}}]});
    const confirmed = records(await read(clientId)).some(r=>r.id===row.id);
    if (confirmed) throw new Error('A exclusão não foi confirmada na planilha.');
    return {id:row.id,sheetRow:existing.sheetRow,deleted:true};
  }
  return {
    list:async clientId=>records(await read(clientId)),
    save:async (clientId,input)=>{
      const previous=locks.get(clientId)||Promise.resolve();
      const current=previous.catch(()=>{}).then(()=>saveUnlocked(clientId,input)); locks.set(clientId,current);
      try{return await current;}finally{if(locks.get(clientId)===current)locks.delete(clientId);}
    },
    delete:async (clientId,input)=>{
      const previous=locks.get(clientId)||Promise.resolve();
      const current=previous.catch(()=>{}).then(()=>deleteUnlocked(clientId,input)); locks.set(clientId,current);
      try{return await current;}finally{if(locks.get(clientId)===current)locks.delete(clientId);}
    }
  };
}
