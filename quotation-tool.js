(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => value === null || value === undefined ? '—' : Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const id = () => crypto.randomUUID();
  const state = { client:null, draft:null, step:1, busy:false, map:null, oc:null, status:null, version:null, orders:()=>[], toast:()=>{} };
  const root = () => document.querySelector('#quotation-tool');
  const query = selector => root().querySelector(selector);
  function newDocument(name='') { return {id:'doc_'+id(),name,number:'',category:'',work:state.client?.name||'',clientName:state.client?.name||'',items:[],notes:[],freight:null,discount:null,other:null,productsTotal:null,finalTotal:null,discountMode:'unknown',source:{filename:'Preenchimento manual',method:'Manual'}}; }
  function blank() { return {id:id(),clientId:state.client.id,clientName:state.client.name,request:newDocument(),suppliers:[],matches:[],folderId:'',folderName:''}; }
  function remember() { try {localStorage.setItem('abs-quotation-v2-'+state.client.id,JSON.stringify({...state.draft,_driveVersion:state.version}));} catch {state.toast('Não foi possível guardar o rascunho neste navegador. Salve no Drive.')} }
  function invalidateApproval(resetConfirmation=true) {state.oc=null;query('.qt-oc')?.remove();if(resetConfirmation&&state.draft.approval){state.draft.approval.confirmed=false;const check=query('[data-field="approval.confirmed"]');if(check)check.checked=false;}}
  function changed() { state.map=null;state.oc=null;delete state.draft.approval;state.draft.matches=[];remember(); }
  async function api(route, data, params={}) {
    const response=await fetch('/api/quotation-tool/'+route+'?'+new URLSearchParams(params),{method:data===undefined?'GET':'POST',...(data instanceof FormData?{body:data}:data===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Não foi possível concluir.');return result;
  }
  async function run(message, action) {
    if(state.busy)return;state.busy=true;setBusy(message);
    try {await action()}catch(error){state.toast(error.message);const area=query('[data-feedback]');if(area){area.textContent=error.message;area.hidden=false}}
    finally {state.busy=false;setBusy('');}
  }
  function setBusy(message) { const banner=query('[data-progress]');if(banner){banner.hidden=!message;banner.textContent=message;}const controls=[...root().querySelectorAll('button,input,textarea,select'),document.querySelector('#client-select')].filter(Boolean);controls.forEach(el=>{if(message){if(el.dataset.wasDisabled===undefined)el.dataset.wasDisabled=el.disabled?'1':'0';el.disabled=true}else{el.disabled=el.dataset.wasDisabled==='1';delete el.dataset.wasDisabled}}); }
  function btn(label,action,extra='',primary=false) {return `<button type="button" class="qt-button ${primary?'qt-primary':''}" data-action="${action}" ${extra}>${label}</button>`}
  function input(label,field,value='',extra='') {return `<label>${label}<input data-field="${field}" value="${esc(value)}" ${extra}></label>`}
  function render() {
    if(!state.draft)return;const d=state.draft;
    root().innerHTML=`<header class="qt-header"><div><span class="qt-eyebrow">COMPRAS · ABSOLUTTA</span><h2>Ferramenta de cotação</h2><p>Pedido oficial, propostas e decisão — com cada valor rastreável.</p></div><div class="qt-actions">${btn('Nova cotação','new')}${btn('Salvar rascunho no Drive','save')}</div></header>
      <div class="qt-service ${state.status?.ai?.configured?'':'qt-notice'}">${serviceHTML()}</div>
      <nav class="qt-steps" aria-label="Etapas da nova cotação">${['Importar documentos','Mapa de cotação','Aprovação e O.C.'].map((label,i)=>`<button data-action="step" data-step="${i+1}" class="${state.step===i+1?'active':''}"><b>${i+1}</b>${label}</button>`).join('')}</nav>
      <div data-progress class="qt-progress" role="status" hidden></div><div data-feedback class="qt-feedback" role="alert" hidden></div>
      <div class="qt-folder"><span><b>Pasta oficial do pedido</b><small>${esc(d.folderName||'Selecione antes de importar para arquivar os originais e exportar ao Google Planilhas.')}<br>Rascunho automático neste navegador. Use “Salvar rascunho no Drive” para abrir em outro computador.</small></span><div class="qt-actions">${btn('Escolher pasta','folder')}${btn('Abrir rascunho do Drive','load')}</div></div>
      ${state.step===1?imports():state.step===2?mapHTML():approvalHTML()}`;
    if(state.busy)setBusy('Processando…');
  }
  function serviceHTML(){return `${state.status?state.status.ai.configured?'IA configurada · leitura visual + busca semântica':'IA aguardando OPENAI_API_KEY no Vercel · edição manual disponível':'Verificando conexão com o servidor…'} <small>Os arquivos importados são processados pela API de IA configurada; não são enviados aos fornecedores.</small>`;}
  function imports() {
    const d=state.draft;
    return `<div class="qt-columns"><article class="qt-panel"><div class="qt-panel-title"><span class="qt-number">01</span><div><h3>Pedido oficial</h3><p>A referência para descrições e quantidades.</p></div></div>
      <div class="qt-fields">${input('Número do pedido','request.number',d.request.number)}${input('Categoria','request.category',d.request.category)}${input('Obra','request.work',d.request.work)}${input('Cliente','request.clientName',d.request.clientName)}</div>
      <div class="qt-import-zone"><strong>Importe o pedido completo</strong><span>PDF, imagem, Excel, CSV ou TXT</span><div class="qt-actions">${btn('↑ Computador','file','data-kind="request"')}${btn('▱ Google Drive','drive','data-kind="request"')}${btn('Colar texto','text','data-kind="request"')}</div><small>Até 4 MB pelo computador; 12 MB pelo Drive.</small></div>
      ${d.request.items.length?`<div class="qt-document-summary"><b>${d.request.items.length} itens lidos</b><span>${esc(d.request.source?.filename)}</span>${btn('Conferir e editar itens','edit','data-kind="request"')}</div>`:'<p class="qt-muted">Ainda não há itens. A descrição resumida do painel não será usada como pedido oficial.</p>'}
      <div class="qt-actions">${btn('+ Item manual','add-item','data-kind="request"')}</div>
      ${d.request.warnings?.length?`<div class="qt-notice">${d.request.warnings.map(esc).join('<br>')}</div>`:''}</article>
      <article class="qt-panel"><div class="qt-panel-title"><span class="qt-number">02</span><div><h3>Orçamentos dos fornecedores</h3><p>Importe cada proposta ou preencha manualmente.</p></div></div>
      <div class="qt-import-zone"><strong>Adicione as propostas</strong><span>Uma proposta por arquivo · até 8 fornecedores</span><div class="qt-actions">${btn('↑ Computador','file','data-kind="supplier"')}${btn('▱ Google Drive','drive','data-kind="supplier"')}${btn('Colar texto','text','data-kind="supplier"')}</div></div>
      <div class="qt-suppliers">${d.suppliers.map(s=>`<div class="qt-supplier"><div><b>${esc(s.name||'Fornecedor sem nome')}</b><small>${s.items.length} itens · ${esc(s.source?.filename||'Manual')}</small><strong>${money(s.finalTotal)} <small>total informado</small></strong></div><div class="qt-actions">${btn('Conferir','edit',`data-doc="${esc(s.id)}"`)}${btn('×','remove',`data-doc="${esc(s.id)}" aria-label="Remover ${esc(s.name)}"`)}</div></div>`).join('')||'<p class="qt-muted">As propostas aparecem aqui após a leitura.</p>'}</div>${btn('+ Fornecedor manual','manual-supplier')}</article></div>
      <footer class="qt-bar"><div><b>Pronto para comparar?</b><span>O mapa mantém os itens oficiais e mostra as relações sugeridas para conferência.</span></div><div class="qt-actions">${btn('Relacionar manualmente','manual-map')}${btn('Gerar mapa de cotação →','generate','',true)}</div></footer>`;
  }
  function mapHTML() {
    if(!state.map)return `<div class="qt-panel qt-empty"><h3>Gere a prévia a partir dos documentos</h3><p>Importe o pedido e pelo menos uma proposta.</p>${btn('Voltar aos documentos','step','data-step="1"')}</div>`;
    const m=state.map,d=state.draft;
    return `<div class="qt-map-top"><div><h3>Mapa de cotação</h3><p>${m.rows.length} itens oficiais · ${d.suppliers.length} fornecedores · ${m.minimumCoverage} itens comparáveis</p></div><div class="qt-actions">${btn('Baixar Excel','export','data-kind="map" data-format="xlsx"')}${btn('Google Planilhas','export','data-kind="map" data-format="sheets"')}</div></div>
      <div class="qt-notice">Amarelo identifica o menor valor válido. “Conferir” não participa dos mínimos. Clique no vínculo para ajustar itens e conversões.</div>
      <div class="qt-table-wrap"><table class="qt-map"><thead><tr><th>Item / pedido oficial</th><th>Qtd. / un.</th>${d.suppliers.map(s=>`<th>${esc(s.name||'Fornecedor')}<small>Unitário · total</small></th>`).join('')}<th>Menor valor<small>Unitário · total</small></th></tr></thead><tbody>
      ${m.rows.map((r,ri)=>`<tr><td><b>${esc(r.request.code)} · ${esc(r.request.description)}</b></td><td>${r.request.quantity} ${esc(r.request.unit)}</td>${r.cells.map((c,si)=>`<td class="${c?.comparable&&c.total===r.minimumTotal?'qt-winner':''}"><b>${c?money(c.unitPrice):'—'}</b><strong>${c?money(c.total):'—'}</strong><button class="qt-link" data-action="match" data-row="${ri}" data-supplier="${si}">${c?c.comparable?'Relacionado ✓':'Conferir equivalência':'Relacionar item'}</button>${c?`<small>${esc(c.reason)}</small>`:'<small>Não cotado / sem vínculo</small>'}</td>`).join('')}<td class="qt-minimum"><b>${money(r.minimumUnit)}</b><strong>${money(r.minimumTotal)}</strong></td></tr>`).join('')}
      ${m.extras.map(e=>`<tr class="qt-extra"><td><u>EXTRA — ${esc(e.item.description)}</u><small>Adicional ou ainda sem vínculo com o pedido.</small></td><td>${e.item.quantity??'—'} ${esc(e.item.unit)}</td>${d.suppliers.map((s,i)=>`<td>${i===e.supplierIndex?money(e.item.unitPrice)+'<strong>'+money(e.item.lineTotal)+'</strong>':'—'}</td>`).join('')}<td>—</td></tr>`).join('')}</tbody></table></div>
      <div class="qt-total-grid">${d.suppliers.map(s=>`<article class="qt-panel"><h4>${esc(s.name)}</h4><small>Total real da proposta</small><h3>${money(s.finalTotal)}</h3><p>Produtos: ${money(s.productsTotal)}<br>Frete: ${s.freight===null?esc(s.freightText||'Não informado'):money(s.freight)}<br>Desconto: ${money(s.discount)} (${esc(s.discountMode==='included'?'já incluído nos preços':s.discountMode==='global'?'geral':'conferir')})</p><small>Pagamento: ${esc(s.payment||'Não informado')}<br>Entrega: ${esc(s.delivery||'Não informado')}<br>Validade: ${esc(s.validityText||s.validUntil||'Não informada')}</small></article>`).join('')}</div>
      <div class="qt-panel"><b>Compra combinada: ${money(m.combinedMinimum)}</b><p>Soma dos menores valores de ${m.minimumCoverage}/${m.rows.length} itens, sem fretes. Não é uma proposta de fornecedor.</p><b>Menor total real informado: ${money(m.lowestRealProposal)}</b><p>Conferir cobertura e escopo antes de comparar propostas completas e parciais.</p>${m.warnings.map(w=>`<p class="qt-notice">${esc(w)}</p>`).join('')}</div>
      <footer class="qt-bar"><span>A seleção do fornecedor e dos itens é feita por você, após a autorização do cliente.</span>${btn('Escolher fornecedor e itens →','step','data-step="3"',true)}</footer>`;
  }
  function approvalHTML() {
    const d=state.draft,a=d.approval||{},supplier=d.suppliers.find(s=>s.id===a.supplierId);
    return `<article class="qt-panel"><h3>Aprovação e Ordem de Compra</h3><p>Uma O.C. por fornecedor. Nenhum item é selecionado automaticamente.</p><label>Fornecedor aprovado<select data-approval-supplier><option value="">Selecione o fornecedor</option>${d.suppliers.map(s=>`<option value="${esc(s.id)}" ${s.id===a.supplierId?'selected':''}>${esc(s.name||'Fornecedor')}</option>`).join('')}</select></label>
      ${supplier?`<div class="qt-notice">As quantidades abaixo estão na unidade comercial do fornecedor. Confira embalagens e selecione somente o que foi aprovado.</div>
      <div class="qt-table-wrap"><table><thead><tr><th>Incluir</th><th>Item cotado</th><th>Qtd. aprovada</th><th>Unitário líquido</th><th>Observação da aprovação</th></tr></thead><tbody>${supplier.items.map(i=>{const selected=a.items?.find(x=>x.sourceId===i.id);return `<tr><td><input type="checkbox" data-approve-item="${esc(i.id)}" ${selected?'checked':''} aria-label="Aprovar ${esc(i.description)}"></td><td>${esc(i.description)}<small>${esc(i.unit)}</small></td><td><input type="number" step="any" min="0.001" data-approve-qty="${esc(i.id)}" value="${selected?.quantity??i.quantity??''}" aria-label="Quantidade aprovada ${esc(i.code)}"></td><td>${money(i.lineTotal!==null&&i.quantity>0?i.lineTotal/i.quantity:i.unitPrice)}</td><td><input data-approve-note="${esc(i.id)}" value="${esc(selected?.note||'')}" placeholder="Obrigatória para extra ou divergência" aria-label="Observação do item ${esc(i.code)}"></td></tr>`}).join('')}</tbody></table></div>
      <div class="qt-fields">${input('Nome de quem aprovou (cliente)','approval.approvedBy',a.approvedBy)}${input('Registro da aprovação (data / mensagem / referência)','approval.reference',a.reference)}${input('Número da O.C.','approval.number',a.number)}${input('Frete aprovado (R$)','approval.freight',a.freight,'type="number" min="0" step="0.01"')}${input('Desconto adicional (R$)','approval.discount',a.discount,'type="number" min="0" step="0.01"')}${input('Outras despesas (R$)','approval.other',a.other,'type="number" min="0" step="0.01"')}${input('Explicação do desconto adicional','approval.discountNote',a.discountNote)}${input('Destinatário fiscal — nome/razão social','approval.billingName',a.billingName)}${input('CPF/CNPJ para faturamento','approval.billingTaxId',a.billingTaxId)}${input('Endereço de faturamento','approval.billingAddress',a.billingAddress)}${input('Local de entrega','approval.deliveryAddress',a.deliveryAddress)}${input('Observações da O.C.','approval.notes',a.notes)}</div>
      <p>Pagamento: <b>${esc(supplier.payment||'Não informado')}</b> · Entrega: <b>${esc(supplier.delivery||'Não informada')}</b> · Validade: <b>${esc(supplier.validityText||supplier.validUntil||'Não informada')}</b></p>
      <label class="qt-check"><input type="checkbox" data-field="approval.feesConfirmed" ${a.feesConfirmed?'checked':''}> Conferi frete, desconto e despesas para os itens selecionados, inclusive em compra parcial.</label>
      <label class="qt-check"><input type="checkbox" data-field="approval.validityConfirmed" ${a.validityConfirmed?'checked':''}> Se a proposta venceu, reconfirmei as condições com o fornecedor.</label>
      <label class="qt-check"><input type="checkbox" data-field="approval.confirmed" ${a.confirmed?'checked':''}> Confirmo que o cliente aprovou este fornecedor, os itens marcados e suas quantidades.</label>
      ${btn('Gerar prévia da O.C.','purchase','',true)}`:''}</article>
      ${state.oc?`<article class="qt-panel qt-oc"><div class="qt-map-top"><h3>Ordem de Compra ${esc(a.number||'—')}</h3><div class="qt-actions">${btn('Baixar Excel','export','data-kind="oc" data-format="xlsx"')}${btn('Google Planilhas','export','data-kind="oc" data-format="sheets"')}</div></div><p>${esc(state.oc.supplier.name)} · ${state.oc.lines.length} itens aprovados</p>${state.oc.lines.map(l=>`<div class="qt-oc-line"><span><b>${esc(l.description)}</b><small>${l.quantity} ${esc(l.unit)} × ${money(l.unitPrice)} · ${esc(l.note)}</small></span><strong>${money(l.total)}</strong></div>`).join('')}<h3>Total: ${money(state.oc.total)}</h3><p>Subtotal ${money(state.oc.subtotal)} · Frete ${money(state.oc.freight)} · Desconto ${money(state.oc.discount)} · Outras despesas ${money(state.oc.other)}</p><div class="qt-notice">${esc(state.oc.notice)}</div>${state.oc.warnings.map(w=>`<p>${esc(w)}</p>`).join('')}</article>`:''}`;
  }
  function modal(title,html) {
    document.querySelector('#qt-dialog')?.remove();
    const dialog=document.createElement('dialog');dialog.id='qt-dialog';dialog.className='qt-dialog';dialog.innerHTML=`<header><h3>${esc(title)}</h3><button type="button" data-close aria-label="Fechar janela">×</button></header><div class="qt-dialog-body">${html}</div>`;document.body.append(dialog);dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();return dialog;
  }
  async function importDoc(kind,data) {
    const draftId=state.draft.id;
    const result=await api('extract',data,{clientId:state.client.id,kind,draftId,folderId:state.draft.folderId||''});
    if(state.draft.id!==draftId)return;
    const doc=result.document;doc.original=JSON.parse(JSON.stringify(doc.items));
    if(kind==='request'){
      doc.number=doc.number||state.draft.request.number;doc.category=doc.category||state.draft.request.category;doc.work=doc.work||state.draft.request.work;
      state.draft.request=doc;
    }else{
      const index=state.draft.suppliers.findIndex(s=>s.id===doc.id);
      if(index>=0)state.draft.suppliers[index]=doc;else if(state.draft.suppliers.length<8)state.draft.suppliers.push(doc);else throw new Error('Limite de 8 fornecedores.');
    }
    changed();render();state.toast(`${doc.items.length} itens lidos. Confira antes de gerar o mapa.`);
  }
  function chooseFile(kind) { const input=document.createElement('input');input.type='file';input.accept='.pdf,.xlsx,.xls,.csv,.txt,.png,.jpg,.jpeg,.webp';input.multiple=kind==='supplier';input.onchange=()=>run('Lendo documentos com IA…',async()=>{for(const file of input.files){if(file.size>4*1024*1024)throw new Error('Use arquivo de até 4 MB ou importe pelo Drive.');const form=new FormData();form.set('file',file);await importDoc(kind,form)}});input.click(); }
  function pasteText(kind) { const dialog=modal('Importar texto do '+(kind==='request'?'pedido':'orçamento'),'<p>Cole o conteúdo completo, incluindo unidades, quantidades e condições comerciais.</p><textarea aria-label="Texto do documento" rows="12"></textarea>'+btn('Ler com IA','read-text','',true));dialog.querySelector('[data-action]').onclick=()=>{const value=dialog.querySelector('textarea').value;if(!value.trim())return;dialog.close();run('Interpretando o texto…',()=>importDoc(kind,{text:value}))}; }
  async function drivePicker(mode,kind) {
    const dialog=modal(mode==='folder'?'Pasta oficial do pedido':mode==='load'?'Abrir rascunho':'Importar do Google Drive','<p>Carregando pastas…</p>');let stack=[],current;
    const show=async(folderId,pageToken='')=>{
      try{
        const data=await api('drive',undefined,{clientId:state.client.id,...(folderId?{folderId}:{}),...(pageToken?{pageToken}:{})});current=data.folder;
        const body=dialog.querySelector('.qt-dialog-body');body.innerHTML=`<div class="qt-actions">${stack.length?btn('← Voltar','back'):''}<b>${esc(current.name)}</b>${mode==='folder'?btn('Usar esta pasta','use-folder','',true):''}</div><label>Filtrar nomes nesta pasta<input data-filter placeholder="Nome do arquivo ou pasta"></label><div class="qt-drive-list">${data.files.map(f=>`<button type="button" data-drive-file="${esc(f.id)}"><span>${f.mimeType==='application/vnd.google-apps.folder'?'▱':'▤'}</span>${esc(f.name)}</button>`).join('')||'<p>Pasta vazia.</p>'}</div>${data.nextPageToken?btn('Próxima página','next'):''}<p class="qt-muted">Arquivos da obra ${esc(state.client.name)}.</p>`;
        body.querySelector('[data-filter]').oninput=e=>body.querySelectorAll('[data-drive-file]').forEach(b=>b.hidden=!b.textContent.toLowerCase().includes(e.target.value.toLowerCase()));
        body.querySelector('[data-action="back"]')?.addEventListener('click',()=>show(stack.pop()));
        body.querySelector('[data-action="next"]')?.addEventListener('click',()=>show(current.id,data.nextPageToken));
        body.querySelector('[data-action="use-folder"]')?.addEventListener('click',()=>{state.draft.folderId=current.id;state.draft.folderName=current.name;state.version=null;remember();dialog.close();render()});
        body.querySelectorAll('[data-drive-file]').forEach(button=>button.onclick=()=>{const file=data.files.find(f=>f.id===button.dataset.driveFile);if(file.mimeType==='application/vnd.google-apps.folder'){stack.push(current.id);show(file.id);return}if(mode==='folder')return;dialog.close();run(mode==='load'?'Abrindo rascunho…':'Lendo arquivo do Drive…',async()=>{if(mode==='load'){const result=await api('load',{clientId:state.client.id,fileId:file.id});state.draft=result.draft;state.version=result.version;state.map=null;state.oc=null;state.step=1;remember();render()}else await importDoc(kind,{driveId:file.id})})});
      }catch(error){dialog.querySelector('.qt-dialog-body').textContent=error.message}
    };await show(state.draft.folderId||'');
  }
  function editDocument(doc) {
    const supplier=doc!==state.draft.request;
    const columns=[['description','Descrição','text'],['quantity','Quantidade','number'],['unit','Unidade','text'],...(supplier?[['unitPrice','Unitário','number'],['lineTotal','Total impresso','number']]:[])];
    const meta=supplier?['name','number','payment','delivery','validityText','validUntil','freight','discount','other','productsTotal','finalTotal','taxId']:[];
    const labels={name:'Fornecedor',number:'Número do orçamento',payment:'Pagamento (literal)',delivery:'Entrega (literal)',validityText:'Validade (literal)',validUntil:'Válido até (AAAA-MM-DD)',freight:'Frete',discount:'Desconto',other:'Despesas',productsTotal:'Subtotal informado',finalTotal:'Total final informado',taxId:'CNPJ do fornecedor'};
    const dialog=modal('Conferir '+(supplier?'proposta':'pedido oficial'),`<p>${esc(doc.source?.filename||'Manual')} · Correções aqui serão registradas como edição manual.</p><div class="qt-fields">${meta.map(f=>`<label>${labels[f]}<input data-meta="${f}" value="${esc(doc[f]??'')}" ${['freight','discount','other','productsTotal','finalTotal'].includes(f)?'type="number" min="0" step="0.01"':''}></label>`).join('')}${supplier?`<label>Desconto<select data-meta="discountMode"><option value="unknown">Conferir</option><option value="included" ${doc.discountMode==='included'?'selected':''}>Já incluído nos preços</option><option value="global" ${doc.discountMode==='global'?'selected':''}>Geral, fora dos preços</option><option value="none" ${doc.discountMode==='none'?'selected':''}>Sem desconto</option></select></label>`:''}</div><div class="qt-table-wrap"><table><thead><tr><th>#</th>${columns.map(c=>`<th>${c[1]}</th>`).join('')}<th>Fonte</th></tr></thead><tbody>${doc.items.map((item,index)=>`<tr><td>${esc(item.code)}</td>${columns.map(([field,label,type])=>`<td><input data-item="${index}" data-key="${field}" value="${esc(item[field]??'')}" type="${type}" ${type==='number'?'step="any" min="0"':''} aria-label="${label} item ${index+1}"></td>`).join('')}<td><small>${esc(item.evidence||'Preenchimento manual')} ${esc(item.page||'')}</small></td></tr>`).join('')}</tbody></table></div><div class="qt-actions">${btn('Adicionar linha','append')}${btn('Salvar conferência','save-doc','',true)}</div>`);
    const apply=()=>{
      dialog.querySelectorAll('[data-meta]').forEach(el=>doc[el.dataset.meta]=el.type==='number'?(el.value===''?null:Number(el.value)):el.value);
      dialog.querySelectorAll('[data-item]').forEach(el=>doc.items[Number(el.dataset.item)][el.dataset.key]=el.type==='number'?(el.value===''?null:Number(el.value)):el.value);
      doc.editedAt=new Date().toISOString();changed();
    };
    dialog.querySelector('[data-action="append"]').onclick=()=>{apply();doc.items.push(manualItem(doc));dialog.close();editDocument(doc)};
    dialog.querySelector('[data-action="save-doc"]').onclick=()=>{apply();dialog.close();render()};
  }
  function manualItem(doc){return {id:doc.id+'-'+id(),code:String(doc.items.length+1),description:'',quantity:null,unit:'UN',unitPrice:null,lineTotal:null,packageQuantity:null,packageUnit:'',evidence:'Inserido manualmente'}}
  function editMatch(ri,si) {
    const d=state.draft,request=d.request.items[ri],supplier=d.suppliers[si],existing=d.matches.find(m=>m.requestId===request.id&&m.supplierId===supplier.id);
    const dialog=modal('Relacionar: '+request.description,`<p>Pedido: <b>${request.quantity} ${esc(request.unit)}</b>. Selecione a linha correspondente. Para embalagem, informe quanto existe na unidade do pedido por uma unidade vendida (ex.: galão de 5 kg → fator 5).</p><div class="qt-table-wrap"><table><thead><tr><th>Usar</th><th>Item do fornecedor</th><th>Fator</th></tr></thead><tbody>${supplier.items.map(item=>{const part=existing?.parts?.find(p=>p.sourceId===item.id);return `<tr><td><input type="checkbox" data-source="${esc(item.id)}" ${part?'checked':''} aria-label="Vincular ${esc(item.description)}"></td><td>${esc(item.description)}<small>${item.quantity} ${esc(item.unit)} · ${money(item.lineTotal)}</small></td><td><input type="number" min="0.000001" step="any" data-factor="${esc(item.id)}" value="${part?.factor||1}" aria-label="Fator ${esc(item.code)}"></td></tr>`}).join('')}</tbody></table></div><label>Como agrupar<select data-mode><option value="sum">Mesmo material — somar linhas</option><option value="kit" ${existing?.mode==='kit'?'selected':''}>Componentes de um conjunto / kit</option></select></label><label>Justificativa / evidência<textarea data-reason rows="3">${esc(existing?.reason||'')}</textarea></label><label class="qt-check"><input type="checkbox" data-confirm> Conferi as especificações e a conversão. Os valores podem ser comparados.</label>${btn('Salvar relação','save-match','',true)}`);
    dialog.querySelector('[data-action="save-match"]').onclick=()=>run('Atualizando relações…',async()=>{
      const parts=[...dialog.querySelectorAll('[data-source]:checked')].map(el=>({sourceId:el.dataset.source,factor:Number(dialog.querySelector(`[data-factor="${el.dataset.source}"]`).value)}));
      const reason=dialog.querySelector('[data-reason]').value,confirmed=dialog.querySelector('[data-confirm]').checked;
      if(confirmed&&!reason.trim())throw new Error('Descreva a justificativa da equivalência.');
      d.matches=d.matches.filter(m=>!(m.requestId===request.id&&m.supplierId===supplier.id));d.matches.push({requestId:request.id,supplierId:supplier.id,parts,mode:dialog.querySelector('[data-mode]').value,reason,status:parts.length?confirmed?'confirmed':'review':'missing'});
      state.oc=null;delete d.approval;remember();state.map=await api('preview',{draft:d});dialog.close();render();
    });
  }
  async function generate(manual=false) {
    if(!state.draft.request.items.length||!state.draft.suppliers.length)throw new Error('Importe o pedido e pelo menos uma proposta.');
    if(!manual){for(const supplier of state.draft.suppliers){setBusy('Relacionando '+(supplier.name||'fornecedor')+' — conferindo unidades e especificações…');const result=await api('match',{draft:state.draft,supplierId:supplier.id});state.draft.matches=state.draft.matches.filter(m=>m.supplierId!==supplier.id).concat(result.matches);remember()}}
    state.map=await api('preview',{draft:state.draft});state.step=2;state.oc=null;delete state.draft.approval;remember();render();
  }
  async function exportFile(kind,format) {
    const response=await fetch('/api/quotation-tool/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({draft:state.draft,kind,format,approval:state.draft.approval})});
    if(!response.ok){const result=await response.json();throw new Error(result.error||'Erro na exportação')}
    if(format==='sheets'){const result=await response.json();const area=query('[data-feedback]');area.hidden=false;area.innerHTML=`Planilha salva. <a href="${esc(result.url)}" target="_blank" rel="noopener">Abrir ${esc(result.name)}</a>`;state.toast('Planilha Google criada na pasta do pedido.');}
    else{const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;const header=response.headers.get('Content-Disposition');a.download=header?.includes("UTF-8''")?decodeURIComponent(header.split("UTF-8''")[1]):kind+'.xlsx';a.textContent='Baixar novamente: '+a.download;const area=query('[data-feedback]');area.hidden=false;area.replaceChildren(a);a.click();state.toast('Excel gerado. Se o download não iniciou, use o link na tela.');}
  }
  function bind() {
    const fieldChange=event=>{
      const el=event.target;
      if(event.type==='input'&&(el.type==='checkbox'||el.tagName==='SELECT'))return;
      if(el.dataset.field){const [parent,key]=el.dataset.field.split('.');state.draft[parent]??={};state.draft[parent][key]=el.type==='checkbox'?el.checked:el.type==='number'?(el.value===''?null:Number(el.value)):el.value;if(parent==='request')changed();else{invalidateApproval(key!=='confirmed');remember()}}
      if(el.matches('[data-approval-supplier]')){state.draft.approval={supplierId:el.value,items:[],freight:null,discount:null,other:null};state.oc=null;remember();render()}
      if(el.matches('[data-approve-item],[data-approve-qty],[data-approve-note]')){state.draft.approval.items=[...root().querySelectorAll('[data-approve-item]:checked')].map(c=>({sourceId:c.dataset.approveItem,quantity:Number(query(`[data-approve-qty="${c.dataset.approveItem}"]`).value),note:query(`[data-approve-note="${c.dataset.approveItem}"]`).value}));invalidateApproval();remember()}
    };
    root().addEventListener('input',fieldChange);root().addEventListener('change',fieldChange);
    root().addEventListener('click',event=>{
      const button=event.target.closest('[data-action]');if(!button||state.busy)return;const a=button.dataset.action,d=state.draft;
      if(a==='new'){if(!confirm('Começar uma nova cotação? Salve o rascunho no Drive se quiser retomá-lo.'))return;state.draft=blank();state.step=1;state.version=null;state.map=null;state.oc=null;remember();render()}
      if(a==='step'){state.step=Number(button.dataset.step);render()}
      if(a==='file')chooseFile(button.dataset.kind);
      if(a==='text')pasteText(button.dataset.kind);
      if(a==='folder'||a==='drive'||a==='load')drivePicker(a,button.dataset.kind);
      if(a==='edit')editDocument(button.dataset.kind==='request'?d.request:d.suppliers.find(s=>s.id===button.dataset.doc));
      if(a==='add-item'){d.request.items.push(manualItem(d.request));changed();editDocument(d.request)}
      if(a==='manual-supplier'){if(d.suppliers.length>=8)return;const doc=newDocument('Novo fornecedor');doc.items.push(manualItem(doc));d.suppliers.push(doc);changed();editDocument(doc)}
      if(a==='remove'){if(!confirm('Remover esta proposta do rascunho? O arquivo original no Drive não será apagado.'))return;d.suppliers=d.suppliers.filter(s=>s.id!==button.dataset.doc);changed();render()}
      if(a==='generate'||a==='manual-map')run('Preparando mapa…',()=>generate(a==='manual-map'));
      if(a==='match')editMatch(Number(button.dataset.row),Number(button.dataset.supplier));
      if(a==='save')run('Salvando no Drive…',async()=>{const result=await api('save',{draft:d,version:state.version});state.version=result.version;state.toast('Rascunho salvo no Drive.');remember()});
      if(a==='purchase')run('Conferindo itens aprovados e totais…',async()=>{state.oc=await api('preview',{draft:d,kind:'oc',approval:d.approval});render()});
      if(a==='export')run('Gerando arquivo…',()=>exportFile(button.dataset.kind,button.dataset.format));
    });
  }
  function setClient(client) {document.querySelector('#qt-dialog')?.close();state.client=client;try{state.draft=JSON.parse(localStorage.getItem('abs-quotation-v2-'+client.id))}catch{state.draft=null}if(!state.draft||state.draft.clientId!==client.id)state.draft=blank();state.map=null;state.oc=null;state.step=1;state.version=state.draft._driveVersion||null;render();}
  async function enter() {render();try{state.status=await api('status');const banner=query('.qt-service');if(banner){banner.innerHTML=serviceHTML();banner.classList.toggle('qt-notice',!state.status.ai.configured)}}catch(error){state.toast(error.message)}}
  // Compatibility with dashboard navigation only; all quotation behavior above is new.
  window.DeterlimpQuotes={init({client,orders,toast}){state.orders=orders;state.toast=toast;setClient(client);bind();enter()},setClient,enter,hasActiveQuote:()=>Boolean(state.draft?.request.items.length),openFromOrder(order){if(!order)return;if(state.draft.request.items.length&&!confirm('Iniciar cotação para este pedido? Salve o rascunho atual antes.'))return;state.draft=blank();Object.assign(state.draft.request,{number:order.number,category:order.category,requester:order.requester,date:order.date});state.map=null;state.oc=null;state.step=1;remember();render();state.toast('Pedido selecionado. Importe o documento oficial para ler os itens.')}};
})();
