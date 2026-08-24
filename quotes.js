(function(){
  "use strict";
  const $=selector=>document.querySelector(selector);
  const $$=selector=>[...document.querySelectorAll(selector)];
  const money=new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"});
  const escapeHtml=value=>String(value??"").replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
  const uid=prefix=>{const random=globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}${Math.random().toString(36).slice(2,10)}`;return`${prefix}_${random.replaceAll("-","").slice(0,16)}`};
  const toISO=value=>{const match=String(value||"").match(/(\d{2})\/(\d{2})\/(\d{4})/);return match?`${match[3]}-${match[2]}-${match[1]}`:String(value||"").slice(0,10)};
  const toNumber=value=>{const raw=String(value??"").replace(/[^\d,.-]/g,"");return Number(raw.includes(",")?raw.replace(/\./g,"").replace(",","."):raw)||0};
  const qstate={quote:null,history:[],step:1,initialized:false,orders:()=>[],toast:()=>{},saveTimer:null,busy:false,service:false,client:{id:"deterlimp",name:"Deterlimp",work:"Deterlimp"}};

  async function api(path,options={}){
    const response=await fetch(path,options);let payload={};
    try{payload=await response.json()}catch{}
    if(!response.ok)throw Object.assign(new Error(payload.error||"Não foi possível concluir a operação."),{status:response.status,payload});
    return payload;
  }
  function setBusy(button,busy,label="Processando..."){
    if(!button)return; if(busy){button.dataset.original=button.innerHTML;button.disabled=true;button.textContent=label}else{button.disabled=false;if(button.dataset.original)button.innerHTML=button.dataset.original}
  }
  function statusLabel(status){return({rascunho:"Rascunho","aguardando orçamentos":"Aguardando orçamentos","conferência":"Em conferência",pronto:"Pronto para gerar","mapa gerado":"Mapa gerado",aprovado:"Fornecedor aprovado","ordem de compra":"Ordem de compra gerada"})[status]||status||"Rascunho"}
  function showFeedback(target,message,type="success"){
    target.hidden=false;target.className=`import-feedback ${type}`;target.textContent=message;
  }
  async function checkService(){
    const box=$("#quote-service-status");
    try{await api("/api/health");qstate.service=true;box.classList.add("online");box.querySelector("strong").textContent="Serviço local conectado";box.querySelector("small").textContent="PDF, Excel, imagem e texto • arquivos mantidos neste computador"}
    catch{qstate.service=false;box.classList.add("offline");box.querySelector("strong").textContent="Abra pelo serviço local";box.querySelector("small").textContent="Execute start-dashboard.ps1 para importar arquivos e gerar o Excel."}
  }
  async function loadHistory(){
    if(!qstate.service)return;
    try{qstate.history=await api(`/api/quotes?clientId=${encodeURIComponent(qstate.client.id)}`);renderHistory();$("#nav-quote-count").textContent=qstate.history.length||""}catch{}
  }
  function renderHistory(){
    const target=$("#quote-history-list");
    target.innerHTML=qstate.history.length?qstate.history.map(row=>`<button class="history-row" data-load-quote="${row.id}"><span class="history-avatar">${escapeHtml((row.request.category||"MC").slice(0,2).toUpperCase())}</span><span><strong>${escapeHtml(row.request.number?`Pedido ${row.request.number}`:"Cotação sem número")}</strong><small>${escapeHtml(row.request.category||"Categoria não informada")} • ${row.suppliersCount} fornecedor(es)</small></span><span class="history-status">${escapeHtml(statusLabel(row.status))}${row.unresolved?`<small>${row.unresolved} pendência(s)</small>`:""}</span></button>`).join(""):'<div class="history-empty">Nenhuma cotação salva ainda.</div>';
  }
  async function createQuote(){
    if(!qstate.service){qstate.toast("Inicie o serviço local para criar uma cotação");return}
    const buttons=[$("#quote-new"),$("[data-create-quote]")];buttons.forEach(button=>setBusy(button,true,"Criando..."));
    try{qstate.quote=await api("/api/quotes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({clientId:qstate.client.id,clientName:qstate.client.name,work:qstate.client.work})});qstate.step=1;render();await loadHistory();qstate.toast("Nova cotação criada")}
    catch(error){qstate.toast(error.message)}finally{buttons.forEach(button=>setBusy(button,false))}
  }
  async function loadQuote(id){
    try{qstate.quote=await api(`/api/quotes/${id}`);qstate.step=1;render();$("#quote-history").hidden=true}
    catch(error){qstate.toast(error.message)}
  }
  async function saveNow(){
    if(!qstate.quote||!qstate.service)return;
    $("#quote-save-status").textContent="Salvando...";
    try{qstate.quote=await api(`/api/quotes/${qstate.quote.id}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(qstate.quote)});$("#quote-save-status").textContent="Salvo localmente";renderStatus();renderReviewSummary();await loadHistory()}
    catch(error){$("#quote-save-status").textContent="Não foi possível salvar";qstate.toast(error.message)}
  }
  function scheduleSave(){clearTimeout(qstate.saveTimer);$("#quote-save-status").textContent="Alterações pendentes";qstate.saveTimer=setTimeout(saveNow,450)}

  function render(){
    const has=!!qstate.quote;$("#quote-empty").hidden=has;$("#quote-workspace").hidden=!has;if(!has)return;
    renderStatus();renderRequest();renderSuppliers();renderReview();renderApproval();renderPurchase();goStep(qstate.step,false);
  }
  function renderStatus(){
    if(!qstate.quote)return;const quote=qstate.quote;
    $("#quote-status-chip").textContent=statusLabel(quote.status);$("#quote-status-chip").dataset.status=quote.status;
    $("#quote-workspace-title").textContent=quote.request.number?`Pedido ${quote.request.number} • ${quote.request.category||"Cotação"}`:"Nova cotação";
  }
  function populateOrders(){
    const select=$("#quote-existing-order");if(select.options.length>1)return;
    qstate.orders().forEach((order,index)=>select.add(new Option(`${order.number?`#${order.number}`:`Pedido ${index+1}`} • ${order.category} • ${order.description}`,String(index))));
  }
  function renderRequest(){
    const request=qstate.quote.request;populateOrders();
    $("#request-number").value=request.number||"";$("#request-category").value=request.category||"";$("#request-work").value=request.work||request.costCenter||qstate.client.work||qstate.client.name;$("#request-requester").value=request.requester||"";$("#request-date").value=toISO(request.date);$("#request-needed").value=toISO(request.neededDate);
    const ready=(request.items||[]).length>0;$("#request-ready").textContent=ready?`${request.items.length} itens`:"Pendente";$("#request-ready").classList.toggle("ready",ready);
    $("#request-items-body").innerHTML=ready?request.items.map((item,index)=>`<tr data-request-item="${item.id}"><td><input data-item-field="number" value="${escapeHtml(item.number||index+1)}"></td><td><input class="number-input" data-item-field="quantity" inputmode="decimal" value="${escapeHtml(item.quantity)}"></td><td><input data-item-field="unit" value="${escapeHtml(item.unit||"UN")}"></td><td><input data-item-field="description" value="${escapeHtml(item.description)}"></td><td><input data-item-field="neededDate" value="${escapeHtml(item.neededDate||request.neededDate||"")}" placeholder="dd/mm/aaaa"></td><td><button class="row-remove" data-remove-request-item="${item.id}" aria-label="Remover item">×</button></td></tr>`).join(""):'<tr><td colspan="6" class="empty-table">Importe o pedido ou adicione o primeiro item.</td></tr>';
  }
  function supplierCard(supplier,index){
    const file=qstate.quote.files.find(row=>row.id===supplier.sourceFileId);
    return `<article class="panel supplier-card" data-supplier="${supplier.id}">
      <div class="supplier-card-head"><span class="supplier-number">${index+1}</span><div><strong>${escapeHtml(supplier.name||`Fornecedor ${index+1}`)}</strong><small>${supplier.items?.length||0} item(ns) reconhecido(s)</small></div><button class="row-remove" data-remove-supplier="${supplier.id}" aria-label="Remover fornecedor">×</button></div>
      <div class="form-grid"><label class="field-label">Fornecedor<input data-supplier-field="name" value="${escapeHtml(supplier.name||"")}"></label><label class="field-label">Vendedor<input data-supplier-field="seller" value="${escapeHtml(supplier.seller||"")}"></label></div>
      <label class="supplier-upload"><input type="file" data-supplier-file accept=".pdf,.xlsx,.xls,.csv,.txt,.png,.jpg,.jpeg" hidden><span>↑</span><strong>${file?escapeHtml(file.originalName):"Importar proposta"}</strong><small>${file?`${escapeHtml(file.method)} • ${Math.round((file.confidence||0)*100)}% confiança`:"PDF, Excel ou imagem"}</small></label>
      <textarea class="quote-textarea compact" data-supplier-text placeholder="Ou cole aqui os dados do orçamento"></textarea>
      <button class="button button-secondary full-width" data-import-supplier>Interpretar orçamento</button>
      <div class="supplier-meta-grid">
        <label class="field-label">Frete<input data-supplier-field="freight" inputmode="decimal" value="${supplier.freight||""}" placeholder="0,00"></label>
        <label class="check-label"><input type="checkbox" data-supplier-field="freightIncluded" ${supplier.freightIncluded?"checked":""}>Frete incluso</label>
        <label class="field-label">Outras despesas<input data-supplier-field="otherCharges" inputmode="decimal" value="${supplier.otherCharges||""}" placeholder="0,00"></label>
        <label class="field-label span-2">Condição de pagamento<input data-supplier-field="payment" value="${escapeHtml(supplier.payment||"")}"></label>
        <label class="field-label">Prazo de entrega<input data-supplier-field="delivery" value="${escapeHtml(supplier.delivery||"")}"></label>
        <label class="field-label">Validade<input data-supplier-field="validity" value="${escapeHtml(supplier.validity||"")}"></label>
        <label class="field-label">Desconto em R$<input data-supplier-field="discount" inputmode="decimal" value="${supplier.discount||""}" placeholder="0,00"></label>
        <label class="field-label">Total oficial do orçamento<input data-supplier-field="officialTotal" inputmode="decimal" value="${supplier.officialTotal||""}" placeholder="0,00"></label>
        <label class="field-label span-2">Observações<input data-supplier-field="notes" value="${escapeHtml(supplier.notes||supplier.discounts?.map(row=>row.label).join(" • ")||"")}"></label>
      </div>
      <div class="supplier-reconciliation ${supplier.officialTotal&&Math.abs(toNumber(supplier.reconciliationDifference))>.05?"attention":""}"><span>Itens relacionados: <strong>${money.format(toNumber(supplier.mappedItemsTotal))}</strong></span><span>Total oficial: <strong>${supplier.officialTotal?money.format(toNumber(supplier.officialTotal)):"Não identificado"}</strong></span>${supplier.officialTotal?`<span>Diferença: <strong>${money.format(toNumber(supplier.reconciliationDifference))}</strong></span>`:""}</div>
      ${supplier.items?.length?`<details class="supplier-items"><summary>Conferir ${supplier.items.length} item(ns) extraído(s)</summary><div>${supplier.items.map(item=>`<div class="supplier-item-row" data-supplier-item="${item.id}"><input data-qitem-field="description" value="${escapeHtml(item.description)}"><input data-qitem-field="quantity" inputmode="decimal" value="${item.quantity||""}" title="Quantidade"><input data-qitem-field="unitPrice" inputmode="decimal" value="${item.unitPrice||""}" title="Valor unitário"></div>`).join("")}</div></details>`:""}
    </article>`;
  }
  function renderSuppliers(){
    const suppliers=qstate.quote.suppliers||[];$("#supplier-grid").innerHTML=suppliers.length?suppliers.map(supplierCard).join(""):'<div class="supplier-empty"><span>＋</span><strong>Nenhum fornecedor adicionado</strong><p>Adicione a primeira proposta recebida.</p></div>';
    $("#supplier-add").disabled=suppliers.length>=5;$("#supplier-add").textContent=suppliers.length>=5?"Limite de 5 fornecedores":"＋ Adicionar fornecedor";
  }
  function supplierTotal(supplier){
    const request=qstate.quote.request.items||[];
    const itemTotal=(supplier.items||[]).reduce((sum,item)=>{const req=request.find(row=>row.id===item.requestItemId);return sum+itemTotalForRequest(item,req)},0);
    return itemTotal+(supplier.freightIncluded?0:toNumber(supplier.freight))+toNumber(supplier.otherCharges)-toNumber(supplier.discount);
  }
  function mappedSupplierItemsTotal(supplier){return toNumber(supplier.mappedItemsTotal)||(supplier.items||[]).reduce((sum,item)=>item.requestItemId?sum+toNumber(item.quotedTotal||toNumber(item.quantity)*toNumber(item.unitPrice)):sum,0)}
  function itemTotalForRequest(item,requestItem){
    if(!item||!requestItem||!item.unitPrice)return 0;
    const sameQuantity=!item.quantity||Math.abs(toNumber(item.quantity)-toNumber(requestItem.quantity))<0.0001;
    return sameQuantity&&toNumber(item.quotedTotal)>0?toNumber(item.quotedTotal):toNumber(requestItem.quantity)*toNumber(item.unitPrice);
  }
  function renderReview(){
    const quote=qstate.quote,blocking=(quote.divergences||[]).filter(row=>row.severity==="blocking"&&!row.resolved);
    $("#review-counter").innerHTML=`<strong>${blocking.length}</strong><span>pendência${blocking.length===1?"":"s"}</span>`;
    $("#supplier-review-summary").innerHTML=(quote.suppliers||[]).map(supplier=>{const difference=toNumber(supplier.reconciliationDifference),hasOfficial=toNumber(supplier.officialTotal)>0;return `<article class="supplier-review-card ${hasOfficial&&Math.abs(difference)>.05?"attention":""}"><strong>${escapeHtml(supplier.name||"Fornecedor")}</strong><span>Itens mapeados <b>${money.format(mappedSupplierItemsTotal(supplier))}</b></span><span>Total oficial <b>${hasOfficial?money.format(toNumber(supplier.officialTotal)):"Não identificado"}</b></span><span>Frete <b>${supplier.freightIncluded?"Incluso":money.format(toNumber(supplier.freight))}</b></span><span>Pagamento <b>${escapeHtml(supplier.payment||"Não informado")}</b></span>${hasOfficial?`<small>Diferença: ${money.format(difference)}</small>`:""}</article>`}).join("");
    $("#divergence-list").innerHTML=quote.divergences?.length?quote.divergences.map(div=>`<article class="divergence ${div.severity} ${div.resolved?"resolved":""}"><span>${div.resolved?"✓":div.severity==="blocking"?"!":"i"}</span><div><strong>${div.type==="quantity"?"Quantidade divergente":div.type==="unmatched"?"Item não relacionado":div.type==="extra"?"Item extra do fornecedor":div.type==="confidence"?"Correspondência incerta":div.type==="total"?"Totais não reconciliados":"Item não cotado"}</strong><p>${escapeHtml(div.message)}</p></div>${div.severity==="blocking"?`<label><input type="checkbox" data-resolve-divergence="${escapeHtml(div.id)}" ${div.resolved?"checked":""}>Conferido</label>`:""}</article>`).join(""):'<div class="review-success"><span>✓</span><div><strong>Nenhuma divergência encontrada</strong><p>Os itens e quantidades podem seguir para o mapa.</p></div></div>';
    renderComparison();renderReviewSummary();
  }
  function renderReviewSummary(){
    if(!qstate.quote)return;const quote=qstate.quote,blocking=(quote.divergences||[]).filter(row=>row.severity==="blocking"&&!row.resolved);
    $("#comparison-total-label").textContent=`${quote.request.items?.length||0} itens • ${quote.suppliers?.length||0} fornecedores`;
    const warning=$("#generate-warning");warning.hidden=!blocking.length;warning.innerHTML=blocking.length?`<strong>Geração bloqueada</strong><span>Resolva ${blocking.length} divergência(s) na etapa de conferência.</span>`:"";
    $("#generate-map").disabled=blocking.length>0||!quote.request.items?.length||!quote.suppliers?.length;
  }
  function renderComparison(){
    const quote=qstate.quote,suppliers=quote.suppliers||[],items=quote.request.items||[];
    let html=`<thead><tr><th rowspan="2">Item solicitado</th><th rowspan="2">Qtd.</th>${suppliers.map(s=>`<th colspan="2">${escapeHtml(s.name||"Fornecedor")}</th>`).join("")}<th colspan="2" class="best-col">Menor valor</th></tr><tr>${suppliers.map(()=>"<th>Unit.</th><th>Total</th>").join("")}<th class="best-col">Unit.</th><th class="best-col">Total</th></tr></thead><tbody>`;
    for(const requestItem of items){
      const values=suppliers.map(s=>s.items?.find(item=>item.requestItemId===requestItem.id));const valid=values.filter(item=>item?.unitPrice>0&&(item.confidence>=.62||quote.divergences?.find(div=>div.itemId===item.id&&div.type==="confidence")?.resolved));const best=valid.length?Math.min(...valid.map(item=>item.unitPrice)):0;
      const bestItem=valid.find(item=>item.unitPrice===best);
      html+=`<tr><td><strong>${escapeHtml(requestItem.description)}</strong><small>${escapeHtml(requestItem.unit||"UN")}</small></td><td>${requestItem.quantity}</td>${values.map(item=>item?.unitPrice?`<td class="${item.unitPrice===best&&valid.includes(item)?"lowest":""}" title="${escapeHtml(item.description||"")}">${money.format(item.unitPrice)}<small class="match-confidence ${item.confidence>=.62?"high":"review"}">${item.confidence>=.62?"Alta":"Revisar"} ${Math.round((item.confidence||0)*100)}%</small></td><td>${money.format(itemTotalForRequest(item,requestItem))}<small>${escapeHtml(item.quantity||requestItem.quantity)} ${escapeHtml(item.unit||requestItem.unit||"UN")}</small></td>`:'<td class="missing">NÃO COTADO</td><td class="missing">—</td>').join("")}<td class="best-col lowest">${best?money.format(best):"—"}</td><td class="best-col">${bestItem?money.format(itemTotalForRequest(bestItem,requestItem)):"—"}</td></tr>`;
    }
    html+=`<tr class="comparison-total-row"><td colspan="2">TOTAL FINAL</td>${suppliers.map(s=>`<td colspan="2">${money.format(supplierTotal(s))}</td>`).join("")}<td colspan="2" class="best-col">${suppliers.length?money.format(Math.min(...suppliers.map(supplierTotal))):"—"}</td></tr></tbody>`;
    $("#comparison-table").innerHTML=html;
    const unmatched=suppliers.flatMap(s=>(s.items||[]).filter(item=>!item.requestItemId).map(item=>({...item,supplier:s})));
    const panel=$("#unmatched-panel");panel.hidden=!unmatched.length;panel.innerHTML=unmatched.length?`<strong>Itens ainda não relacionados</strong>${unmatched.map(item=>`<p>${escapeHtml(item.supplier.name)}: ${escapeHtml(item.description)}</p>`).join("")}`:"";
  }
  function renderApproval(){
    const quote=qstate.quote,suppliers=quote.suppliers||[],selected=quote.approval?.supplierId||"";
    $("#approval-supplier-grid").innerHTML=suppliers.length?suppliers.map((supplier,index)=>`<label class="approval-option"><input type="radio" name="approved-supplier" value="${escapeHtml(supplier.id)}" ${supplier.id===selected?"checked":""}><strong>${escapeHtml(supplier.name||`Fornecedor ${index+1}`)}</strong><small>${escapeHtml(supplier.payment||"Pagamento não informado")}${supplier.delivery?` • ${escapeHtml(supplier.delivery)}`:""}</small><b>${money.format(supplierTotal(supplier))}</b></label>`).join(""):'<div class="supplier-empty"><strong>Nenhum fornecedor disponível</strong><p>Adicione propostas na etapa Arquivos.</p></div>';
    $("#approval-notes").value=quote.approval?.notes||"";
  }
  async function openFromOrder(order){
    if(!order)return;if(!qstate.service)await checkService();await loadHistory();
    const existing=qstate.history.find(row=>String(row.request.number||"")===String(order.number||"")&&String(row.request.category||"").localeCompare(String(order.category||""),"pt-BR",{sensitivity:"base"})===0);
    if(existing){await loadQuote(existing.id);if(qstate.quote.request.items?.length&&qstate.quote.suppliers?.length&&qstate.quote.request.mapTemplate?.driveId){goStep(3);qstate.toast("Pedido, orçamentos e modelo carregados");return}try{const result=await api(`/api/quotes/${qstate.quote.id}/drive-search`,{method:"POST"});qstate.quote=result.quote;render();const complete=qstate.quote.request.items?.length&&qstate.quote.suppliers?.length;goStep(complete?3:2);qstate.toast(complete?"Pedido e arquivos relacionados automaticamente":"Pasta incompleta: complete os arquivos manualmente")}catch(error){goStep(2);qstate.toast(error.message)}return}
    try{qstate.quote=await api("/api/quotes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({clientId:qstate.client.id,clientName:qstate.client.name,work:qstate.client.work})});qstate.quote.request={...qstate.quote.request,number:order.number||"",category:order.category||"",date:order.date||qstate.quote.request.date,neededDate:order.delivery||"",requester:order.requester||"",work:qstate.client.work||qstate.client.name,sourceOrderKey:`${qstate.client.id}|${order.date||""}|${order.number||""}|${order.description||""}`,driveFolderId:order.driveAssets?.folderId||"",items:(order.items?.length?order.items:[]).map((item,index)=>({id:item.id||uid("item"),number:item.number||index+1,quantity:toNumber(item.quantity)||1,unit:item.unit||"UN",description:item.description||"",neededDate:item.neededDate||order.delivery||""}))};await saveNow();const result=await api(`/api/quotes/${qstate.quote.id}/drive-search`,{method:"POST"});qstate.quote=result.quote;const complete=qstate.quote.request.items?.length&&qstate.quote.suppliers?.length;qstate.step=complete?3:2;render();await loadHistory();qstate.toast(complete?"Pedido e arquivos relacionados automaticamente":"Pasta incompleta: complete os arquivos manualmente")}
    catch(error){if(qstate.quote){qstate.step=2;render();await loadHistory()}qstate.toast(error.message)}
  }
  function approvedSupplier(){return qstate.quote.suppliers?.find(row=>row.id===qstate.quote.approval?.supplierId)}
  function renderPurchase(){
    const quote=qstate.quote,supplier=approvedSupplier(),requestItems=quote.request.items||[],link=$("#download-purchase-order"),latest=quote.purchaseOrders?.at(-1);
    const priced=supplier?(supplier.items||[]).filter(item=>item.requestItemId&&toNumber(item.unitPrice)>0).map(item=>({item,request:requestItems.find(row=>row.id===item.requestItemId)})).filter(row=>row.request):[];
    $("#purchase-title").textContent=supplier?`Comprar de ${supplier.name||"fornecedor aprovado"}`:"Aguardando fornecedor";
    $("#purchase-description").textContent=supplier?"A O.C. inclui somente os itens cotados por este fornecedor.":"Escolha e aprove um fornecedor na etapa anterior.";
    $("#purchase-summary").innerHTML=supplier?`<div><span>Cliente / obra</span><strong>${escapeHtml(quote.request.work||qstate.client.name)}</strong></div><div><span>Pedido</span><strong>${escapeHtml(quote.request.number||"Sem número")}</strong></div><div><span>Fornecedor</span><strong>${escapeHtml(supplier.name||"Não informado")}</strong></div><div><span>Total</span><strong>${money.format(supplierTotal(supplier))}</strong></div>`:"";
    $("#purchase-items").innerHTML=priced.length?priced.map(({item,request})=>`<div class="purchase-item"><div><strong>${escapeHtml(request.description)}</strong><small>${escapeHtml(`${request.quantity} ${request.unit||"UN"}${item.brand?` • ${item.brand}`:""}`)}</small></div><b>${money.format(itemTotalForRequest(item,request))}</b></div>`).join(""):'<div class="purchase-empty">Nenhum item com valor no fornecedor escolhido.</div>';
    $("#generate-purchase-order").disabled=!supplier||!priced.length;
    if(latest){link.hidden=false;link.href=`/api/quotes/${quote.id}/files/${encodeURIComponent(latest.filename)}`;link.setAttribute("download",latest.filename)}else link.hidden=true;
    const map=quote.generated?.at(-1),mapLink=$("#download-map"),finalMapLink=$("#download-map-final"),sheetsLink=$("#open-google-sheets");if(map){const href=`/api/quotes/${quote.id}/files/${encodeURIComponent(map.filename)}`;mapLink.hidden=false;mapLink.href=href;mapLink.setAttribute("download",map.filename);finalMapLink.hidden=false;finalMapLink.href=href;finalMapLink.setAttribute("download",map.filename);sheetsLink.hidden=false}else{mapLink.hidden=true;finalMapLink.hidden=true;sheetsLink.hidden=true}
  }

  function goStep(step,scroll=true){
    qstate.step=Number(step);$$('[data-quote-step]').forEach(button=>{const value=Number(button.dataset.quoteStep);button.classList.toggle("active",value===qstate.step);button.classList.toggle("done",value<qstate.step)});$$('[data-step-panel]').forEach(panel=>{const active=Number(panel.dataset.stepPanel)===qstate.step;panel.hidden=!active;panel.classList.toggle("active",active)});if(qstate.step===3)renderReview();if(qstate.step===4)renderApproval();if(qstate.step===5)renderPurchase();if(scroll)$("#quote-workspace").scrollIntoView({behavior:"smooth",block:"start"})
  }
  function addRequestItem(){qstate.quote.request.items.push({id:uid("item"),number:qstate.quote.request.items.length+1,quantity:1,unit:"UN",description:"",neededDate:qstate.quote.request.neededDate||""});renderRequest();scheduleSave()}
  function addSupplier(){
    if(qstate.quote.suppliers.length>=5)return;qstate.quote.suppliers.push({id:uid("forn"),name:"",seller:"",items:[],freight:0,otherCharges:0,freightIncluded:false,payment:"",delivery:"",validity:"",discount:0,notes:""});renderSuppliers();scheduleSave();setTimeout(()=>$("#supplier-grid").lastElementChild?.scrollIntoView({behavior:"smooth",block:"center"}),50)
  }
  async function importDocument(role,supplierId=""){
    const isRequest=role==="request";const fileInput=isRequest?$("#request-file"):$(`[data-supplier="${supplierId}"] [data-supplier-file]`);const textarea=isRequest?$("#request-text"):$(`[data-supplier="${supplierId}"] [data-supplier-text]`);const button=isRequest?$("#request-import"):$(`[data-supplier="${supplierId}"] [data-import-supplier]`);const feedback=isRequest?$("#request-import-feedback"):null;
    if(!fileInput.files.length&&!textarea.value.trim()){qstate.toast("Selecione um arquivo ou cole o conteúdo");return}
    const form=new FormData();form.set("role",role);if(supplierId)form.set("supplierId",supplierId);if(textarea.value.trim())form.set("text",textarea.value.trim());[...fileInput.files].forEach(file=>form.append("files",file));setBusy(button,true,isRequest?"Lendo pedido...":"Interpretando...");
    try{qstate.quote=await api(`/api/quotes/${qstate.quote.id}/import`,{method:"POST",body:form});render();if(isRequest){showFeedback(feedback,`${qstate.quote.request.items.length} itens reconhecidos. Confira quantidades e descrições.`);qstate.toast("Pedido importado")}else{const supplier=qstate.quote.suppliers.find(row=>row.id===supplierId);const count=supplier?.items?.length||0;qstate.toast(count?`${count} item(ns) reconhecido(s) no orçamento`:"Nenhum item reconhecido. Tente outro arquivo ou preencha manualmente.")}}
    catch(error){if(isRequest)showFeedback(feedback,error.message,"error");qstate.toast(error.message)}finally{setBusy(button,false)}
  }
  async function generateMap(){
    const button=$("#generate-map");setBusy(button,true,"Gerando planilha...");
    try{const result=await api(`/api/quotes/${qstate.quote.id}/generate`,{method:"POST"});qstate.quote=result.quote;render();qstate.toast("Mapa de cotação gerado e salvo no histórico")}
    catch(error){qstate.toast(error.message);if(error.status===409)goStep(3)}finally{setBusy(button,false)}
  }
  async function searchDrive(){
    const button=$("#quote-drive-search"),feedback=$("#quote-drive-feedback");setBusy(button,true,"Buscando no Drive...");
    try{const result=await api(`/api/quotes/${qstate.quote.id}/drive-search`,{method:"POST"});qstate.quote=result.quote;render();const proposals=(qstate.quote.files||[]).filter(file=>file.role==="quote"),parsed=proposals.reduce((sum,file)=>sum+toNumber(file.parsedItems),0),failed=proposals.filter(file=>file.error||!toNumber(file.parsedItems));showFeedback(feedback,`${result.files?.length||0} arquivo(s) encontrado(s) • ${parsed} item(ns) interpretado(s)${failed.length?` • ${failed.length} orçamento(s) precisam de revisão`:""}`,failed.length?"error":"success");qstate.toast(parsed?"Orçamentos interpretados e relacionados":"Arquivos encontrados, mas sem itens interpretados")}
    catch(error){showFeedback(feedback,error.message,"error");qstate.toast(error.message)}finally{setBusy(button,false)}
  }
  async function saveApproval(){
    const selected=document.querySelector('input[name="approved-supplier"]:checked');if(!selected){qstate.toast("Escolha um fornecedor");return}
    qstate.quote.approval={supplierId:selected.value,notes:$("#approval-notes").value.trim(),approvedAt:new Date().toISOString()};qstate.quote.status="aprovado";await saveNow();render();qstate.toast("Fornecedor aprovado e registrado")
  }
  async function generatePurchaseOrder(){
    const button=$("#generate-purchase-order");setBusy(button,true,"Gerando O.C....");
    try{const result=await api(`/api/quotes/${qstate.quote.id}/purchase-order`,{method:"POST"});qstate.quote=result.quote;render();qstate.toast("Ordem de Compra gerada")}
    catch(error){qstate.toast(error.message)}finally{setBusy(button,false)}
  }

  function bind(){
    $("#quote-new").addEventListener("click",createQuote);$("[data-create-quote]").addEventListener("click",createQuote);$("#quote-history-toggle").addEventListener("click",()=>{$("#quote-history").hidden=!$("#quote-history").hidden;loadHistory()});$("#quote-history-close").addEventListener("click",()=>$("#quote-history").hidden=true);$("#quote-close-workspace").addEventListener("click",()=>{qstate.quote=null;render()});
    $("#request-import").addEventListener("click",()=>importDocument("request"));$("#request-add-item").addEventListener("click",addRequestItem);$("#supplier-add").addEventListener("click",addSupplier);$("#generate-map").addEventListener("click",generateMap);$("#quote-drive-search").addEventListener("click",searchDrive);$("#save-approval").addEventListener("click",saveApproval);$("#generate-purchase-order").addEventListener("click",generatePurchaseOrder);
    $("#quote-existing-order").addEventListener("change",event=>{const order=qstate.orders()[Number(event.target.value)];if(!order)return;qstate.quote.request={...qstate.quote.request,number:order.number||"",category:order.category||"",date:order.date||"",requester:order.requester||"",items:[{id:uid("item"),number:1,quantity:1,unit:"UN",description:order.description||"",neededDate:order.delivery||""}]};renderRequest();scheduleSave()});
    const requestFields={"request-number":"number","request-category":"category","request-work":"work","request-requester":"requester","request-date":"date","request-needed":"neededDate"};Object.entries(requestFields).forEach(([id,field])=>$("#"+id).addEventListener("input",event=>{qstate.quote.request[field]=event.target.value;scheduleSave()}));
    document.addEventListener("click",event=>{
      const step=event.target.closest("[data-next-step],[data-quote-step]");if(step&&qstate.quote){goStep(step.dataset.nextStep||step.dataset.quoteStep);return}
      const history=event.target.closest("[data-load-quote]");if(history){loadQuote(history.dataset.loadQuote);return}
      const removeItem=event.target.closest("[data-remove-request-item]");if(removeItem){qstate.quote.request.items=qstate.quote.request.items.filter(item=>item.id!==removeItem.dataset.removeRequestItem);renderRequest();scheduleSave();return}
      const removeSupplier=event.target.closest("[data-remove-supplier]");if(removeSupplier){qstate.quote.suppliers=qstate.quote.suppliers.filter(s=>s.id!==removeSupplier.dataset.removeSupplier);renderSuppliers();scheduleSave();return}
      const importSupplier=event.target.closest("[data-import-supplier]");if(importSupplier){importDocument("quote",importSupplier.closest("[data-supplier]").dataset.supplier);return}
    });
    document.addEventListener("input",event=>{
      const requestRow=event.target.closest("[data-request-item]");if(requestRow&&event.target.dataset.itemField){const item=qstate.quote.request.items.find(row=>row.id===requestRow.dataset.requestItem);if(item){const field=event.target.dataset.itemField;item[field]=field==="quantity"?toNumber(event.target.value):event.target.value;scheduleSave()}return}
      const supplierCard=event.target.closest("[data-supplier]");if(!supplierCard)return;const supplier=qstate.quote.suppliers.find(row=>row.id===supplierCard.dataset.supplier);if(!supplier)return;
      if(event.target.dataset.supplierField){const field=event.target.dataset.supplierField;supplier[field]=event.target.type==="checkbox"?event.target.checked:["freight","otherCharges","discount","officialTotal"].includes(field)?toNumber(event.target.value):event.target.value;scheduleSave();return}
      const itemRow=event.target.closest("[data-supplier-item]");if(itemRow&&event.target.dataset.qitemField){const item=supplier.items.find(row=>row.id===itemRow.dataset.supplierItem);if(item){const field=event.target.dataset.qitemField;item[field]=["quantity","unitPrice"].includes(field)?toNumber(event.target.value):event.target.value;if(["quantity","unitPrice"].includes(field))item.quotedTotal=toNumber(item.quantity)*toNumber(item.unitPrice);scheduleSave()}}
    });
    document.addEventListener("change",event=>{
      if(event.target.matches("[data-resolve-divergence]")){const divergence=qstate.quote.divergences.find(row=>row.id===event.target.dataset.resolveDivergence);if(divergence){divergence.resolved=event.target.checked;saveNow().then(()=>renderReview())}}
      if(event.target.matches("[data-supplier-file]")){const label=event.target.closest(".supplier-upload");if(event.target.files[0]){label.querySelector("strong").textContent=event.target.files[0].name;label.querySelector("small").textContent="Pronto para interpretar"}}
    });
    const drop=$("#request-dropzone");["dragenter","dragover"].forEach(type=>drop.addEventListener(type,event=>{event.preventDefault();drop.classList.add("dragging")}));["dragleave","drop"].forEach(type=>drop.addEventListener(type,event=>{event.preventDefault();drop.classList.remove("dragging")}));drop.addEventListener("drop",event=>{if(event.dataTransfer.files.length){const dt=new DataTransfer();dt.items.add(event.dataTransfer.files[0]);$("#request-file").files=dt.files;drop.querySelector("strong").textContent=event.dataTransfer.files[0].name;drop.querySelector("small").textContent="Pronto para leitura"}});$("#request-file").addEventListener("change",event=>{if(event.target.files[0]){drop.querySelector("strong").textContent=event.target.files[0].name;drop.querySelector("small").textContent="Pronto para leitura"}});
  }
  async function init(options={}){if(qstate.initialized)return;qstate.initialized=true;qstate.orders=options.orders||qstate.orders;qstate.toast=options.toast||qstate.toast;qstate.client=options.client||qstate.client;bind();await checkService();await loadHistory()}
  function enter(){if(!qstate.initialized)init({orders:()=>window.DETERLIMP_DATA||[]});populateOrders();loadHistory()}
  function setClient(client){qstate.client=client||qstate.client;qstate.quote=null;qstate.history=[];qstate.step=1;const select=$("#quote-existing-order");while(select?.options.length>1)select.remove(1);render();loadHistory()}
  function hasActiveQuote(){return!!qstate.quote}
  window.DeterlimpQuotes={init,enter,loadQuote,openFromOrder,setClient,hasActiveQuote};
})();
