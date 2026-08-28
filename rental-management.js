(function(){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>v===null||v===undefined||v===''?'Não informado':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  let context, remote=[], current=[], loadedClient='', loading=false, error='', editing=null, generation=0;
  const root=()=>document.querySelector('#rentals');
  const localRows=()=>{try{const saved=JSON.parse(localStorage.getItem('dashboard-rentals-'+context.clientId)||'[]'),statuses=JSON.parse(localStorage.getItem('dashboard-rental-status-'+context.clientId)||'{}');return saved.map((r,localIndex)=>({...r,localIndex,status:statuses[r.id]||r.status}));}catch{return []}};
  const draftKey=()=> 'rental-draft-'+context.clientId;
  const fmt=v=>window.AreaReports?.formatDate(v)||v||'Não informado';
  async function api(options={}) {const response=await fetch('/api/rentals'+(options.method?'':'?clientId='+encodeURIComponent(context.clientId)),options);const body=await response.json();if(!response.ok)throw new Error(body.error||'Não foi possível sincronizar.');return body;}
  function rows(){
    const shared=remote.length||!error?remote:(context.orders||[]).filter(r=>norm(r.category).includes('loca')).map(r=>({item:r.description,supplier:r.supplier,orderNumber:r.number,value:r.value,sent:'',status:/conclu|finaliz/.test(norm(r.status))?'Finalizado':/entregue/.test(norm(r.status))?'Entregue':'Solicitado',billing:'Não informado',sync:'snapshot'}));
    const local=localRows().filter(r=>!r.sharedId&&!shared.some(s=>s.id===(r.syncId||String(r.id))));
    return [...shared,...local.map(r=>({...r,localId:r.id,id:r.syncId||'',billing:r.billing||'Mensal',status:['Finalizado','Em uso','Trocado','Entregue','Solicitado'].includes(r.status)?r.status:'Entregue',sync:'local'}))];
  }
  function render(){
    if(!context)return;
    current=rows();
    const stats=window.AreaReports.rentalModel(current,'Todos os registros');
    root().innerHTML=`<header class="work-hero"><div><p class="eyebrow">CONTROLE DE LOCAÇÕES</p><h2>Locações da obra</h2><p>Pedido, documento de campo e acompanhamento em um só lugar.</p></div><div class="work-hero-actions"><button class="button button-report" data-rm-report>Gerar relatório</button><button class="button button-primary" data-rm-new>+ Nova locação</button></div></header>
      <section class="rm-sync ${error?'warning':''}" role="status"><div><strong>${loading?'Consultando planilha…':error?'Sincronização indisponível':'Planilha e Drive da obra'}</strong><p>${esc(error||'Novos cadastros criam um pedido na planilha e uma pasta vinculada no Drive. Registros locais precisam ser sincronizados.')}</p></div><button class="button button-secondary" data-rm-refresh ${loading?'disabled':''}>Atualizar</button></section>
      <div class="rental-kpis">${stats.kpis.slice(0,3).map(([label,value])=>`<article><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`).join('')}</div>
      <section class="panel rm-list"><div class="panel-header"><h3>Locações cadastradas</h3><span>${current.length} registros</span></div>${current.map((r,i)=>`<article class="rm-card"><div class="rm-card-head"><div><span class="rm-badge ${r.sync==='local'?'local':''}">${r.sync==='local'?'Somente neste dispositivo':'Na planilha'}</span><h3>${esc(r.item)}</h3><p>${esc(r.supplier||'Fornecedor não informado')}</p></div><button class="button button-secondary" data-rm-edit="${i}">${r.sync==='local'?'Editar / sincronizar':'Editar locação'}</button></div><div class="rm-info"><div><span>Nº documento / locação</span><strong>${esc(r.documentNumber||'Não informado')}</strong><small>MTR, contrato ou comprovante do fornecedor</small></div><div><span>Pedido interno</span><strong>${esc(r.orderNumber||'Ainda não criado')}</strong></div><div><span>Vencimento da locação</span><strong>${esc(fmt(r.due))}</strong></div><div><span>Valor · ${esc(r.billing||'Não informado')}</span><strong>${esc(money(r.value))}</strong></div></div><footer><span>${esc(r.status)} · Envio: ${esc(fmt(r.sent))} · Troca: ${esc(fmt(r.exchange))}</span>${/^https:\/\/drive.google.com\/drive\/folders\/[\w-]+$/.test(r.folderUrl||'')?`<a href="${esc(r.folderUrl)}" target="_blank" rel="noopener">Abrir pasta no Drive ↗</a>`:'<small>Pasta criada ao salvar a sincronização</small>'}</footer></article>`).join('')||'<p class="work-empty">Nenhuma locação carregada. Cadastre uma locação ou atualize a base.</p>'}</section>`;
    const list=root().querySelector('.rm-list');
    list.insertAdjacentHTML('beforebegin','<div class="rental-tabs"><button type="button" class="active" data-rm-view="list">Lista de locações</button><button type="button" data-rm-view="board">Kanban de pedidos</button></div>');
    const groups=['Solicitado','Entregue','Finalizado'];
    const group=r=>r.status==='Finalizado'?'Finalizado':r.status==='Solicitado'?'Solicitado':'Entregue';
    list.insertAdjacentHTML('afterend',`<section class="rental-kanban" data-rm-board hidden>${groups.map(status=>`<div class="rental-kanban-column" data-rm-drop="${status}"><h3>${status} · ${current.filter(r=>group(r)===status).length}</h3>${current.map((r,i)=>({r,i})).filter(({r})=>group(r)===status).map(({r,i})=>`<article class="rental-kanban-card" draggable="${r.sync==='shared'}" data-rm-drag="${i}"><strong>${esc(r.item)}</strong><small>${esc(r.supplier||'Fornecedor não informado')}</small><span>Documento: ${esc(r.documentNumber||'Não informado')}</span><button class="button button-secondary" data-rm-edit="${i}">Alterar situação</button></article>`).join('')}</div>`).join('')}</section>`);
    root().querySelectorAll('[data-rm-view]').forEach(b=>b.onclick=()=>{const board=b.dataset.rmView==='board';list.hidden=board;root().querySelector('[data-rm-board]').hidden=!board;root().querySelectorAll('[data-rm-view]').forEach(n=>n.classList.toggle('active',n===b))});
    root().querySelectorAll('[data-rm-drag]').forEach(card=>card.ondragstart=e=>{if(current[Number(card.dataset.rmDrag)].sync!=='shared'){e.preventDefault();return;}e.dataTransfer.setData('text/plain','rental:'+card.dataset.rmDrag)});
    root().querySelectorAll('[data-rm-drop]').forEach(column=>{column.ondragover=e=>e.preventDefault();column.ondrop=async e=>{e.preventDefault();const value=e.dataTransfer.getData('text/plain');if(!/^rental:\d+$/.test(value))return;const row=current[Number(value.split(':')[1])];if(!row||row.sync!=='shared')return;const key='dashboard-rental-status-'+context.clientId;const all=JSON.parse(localStorage.getItem(key)||'{}');all[row.id]=column.dataset.rmDrop;localStorage.setItem(key,JSON.stringify(all));success='Locação movida para '+column.dataset.rmDrop+'.';render();};});
    document.querySelector('#nav-rental-count').textContent=stats.kpis[1][1];
    root().querySelector('[data-rm-new]').onclick=()=>openEditor();
    root().querySelector('[data-rm-refresh]').onclick=()=>load();
    root().querySelector('[data-rm-report]').onclick=()=>window.AreaReports.open('rentals',current,'Todos os registros',{clientName:context.clientName,source:error?'Base local / última leitura disponível':'Planilha da obra + registros locais identificados'});
    root().querySelectorAll('[data-rm-edit]').forEach(b=>{const row=current[Number(b.dataset.rmEdit)];b.disabled=row.sync==='snapshot';b.onclick=()=>openEditor(row);});
    root().querySelectorAll('.rm-card').forEach((card,i)=>{if(current[i].sync==='snapshot'){card.querySelector('.rm-badge').textContent='Retrato da base · sem conexão';card.querySelector('.rm-badge').classList.add('local');}});
  }
  async function load(){
    const token=++generation; loading=true;error='';render();
    try{const data=await api();if(token!==generation)return;remote=data.rows;}
    catch(e){if(token!==generation)return;error=e.message;}
    finally{if(token===generation){loading=false;render();}}
  }
  function openEditor(row){
    let draft;try{draft=JSON.parse(localStorage.getItem(draftKey())||'null')}catch{}
    editing=row?{...row}:draft||{id:crypto.randomUUID(),item:'',supplier:'',documentNumber:'',sent:'',due:'',exchange:'',returnedDate:'',status:'Solicitado',billing:'Por evento',value:'',notes:''};
    if(!editing.id){editing.id=crypto.randomUUID();if(row?.sync==='local'){const locals=localRows();const target=editing.localId!==undefined?locals.find(r=>r.id===editing.localId):locals[editing.localIndex];if(target){target.syncId=editing.id;localStorage.setItem('dashboard-rentals-'+context.clientId,JSON.stringify(locals));}}}
    const previous=document.activeElement, overflow=document.body.style.overflow,overlay=document.createElement('div');overlay.className='rm-overlay';document.body.style.overflow='hidden';
    const field=(key,label,type='text')=>`<label>${label}<input name="${key}" type="${type}" value="${esc(editing[key]??'')}" ${key==='item'?'required maxlength="500"':''} ${key==='value'?'min="0" step="0.01"':''} ${key==='documentNumber'?'maxlength="80" placeholder="Ex.: 06319"':''}></label>`;
    overlay.innerHTML=`<form class="rm-editor" role="dialog" aria-modal="true" aria-labelledby="rm-title"><header><div><p class="eyebrow">PLANILHA + DRIVE</p><h2 id="rm-title">${row?'Editar locação':'Nova locação'}</h2></div><button type="button" data-close aria-label="Fechar">×</button></header><p>O número do documento recebido na obra é independente do número do pedido interno.</p><div class="rm-form">${field('item','Nome da locação')}${field('supplier','Fornecedor')}${field('documentNumber','Nº documento / locação (MTR, contrato)')}<label>Tipo de movimentação<select name="label">${['Inicial','Troca','Retirada','Manutenção'].map(v=>`<option ${editing.label===v?'selected':''}>${v}</option>`).join('')}</select></label><label>Pedido interno<input readonly value="${esc(editing.orderNumber||'Gerado ao sincronizar')}"></label>${field('sent','Data de envio','date')}${field('due','Vencimento da locação','date')}${field('exchange','Próxima troca','date')}${field('returnedDate','Devolução realizada','date')}${field('value','Valor (R$)','number')}<label>Forma de cobrança<select name="billing">${['Por evento','Mensal','Não informado'].map(v=>`<option ${editing.billing===v?'selected':''}>${v}</option>`).join('')}</select></label><label>Situação<select name="status">${['Solicitado','Entregue','Em uso','Trocado','Finalizado'].map(v=>`<option ${editing.status===v?'selected':''}>${v}</option>`).join('')}</select></label></div><label>Observações<textarea name="notes" maxlength="4000" rows="3">${esc(editing.notes||'')}</textarea></label><p class="rm-error" role="alert"></p><footer><button type="button" class="button button-secondary" data-close>Cancelar</button><button class="button button-primary" type="submit">Salvar na planilha e no Drive</button></footer></form>`;
    document.body.append(overlay);
    const form=overlay.querySelector('form');let saving=false;
    const collect=()=>({...editing,...Object.fromEntries(new FormData(form))});
    const close=()=>{if(saving)return;document.removeEventListener('keydown',keyboard,true);overlay.remove();document.body.style.overflow=overflow;previous?.focus()};
    const keyboard=e=>{if(e.key==='Escape'){e.stopImmediatePropagation();close();}if(e.key==='Tab'){const controls=[...form.querySelectorAll('button,input,select,textarea')].filter(n=>!n.disabled),first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}};
    document.addEventListener('keydown',keyboard,true);
    overlay.addEventListener('click',e=>{if(e.target===overlay||e.target.closest('[data-close]'))close()});
    form.addEventListener('input',()=>{if(!row)localStorage.setItem(draftKey(),JSON.stringify(collect()))});
    form.onsubmit=async e=>{
      e.preventDefault();if(saving)return;
      const rental=collect(),clientId=context.clientId;
      // A legacy local record can link only to a single matching un-managed order.
      if(row?.sync==='local'){
        const matches=remote.filter(r=>!r.id&&norm(r.item)===norm(rental.item)&&norm(r.supplier)===norm(rental.supplier));
        if(matches.length>1){form.querySelector('.rm-error').textContent='Há pedidos semelhantes na base. Edite o pedido da planilha para evitar duplicação.';return;}
        if(matches.length===1){rental.reference=matches[0].reference;rental.revision=matches[0].revision;}
      }
      saving=true;form.querySelectorAll('button').forEach(b=>b.disabled=true);form.querySelector('.rm-error').textContent='Salvando e conferindo na planilha…';
      try{
        const data=await api({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId,rental})});
        if(row?.sync==='local'){const locals=localRows();const target=locals.find(r=>r.syncId===rental.id||String(r.id)===rental.id);if(target){target.sharedId=data.row.id;localStorage.setItem('dashboard-rentals-'+clientId,JSON.stringify(locals));}}
        if(!row)localStorage.removeItem(draftKey());
        remote=[...remote.filter(r=>r.id!==data.row.id&&r.sheetRow!==data.row.sheetRow),data.row];
        saving=false;close();render();context.onSaved?.();
      }catch(err){form.querySelector('.rm-error').textContent=err.message+' Os dados preenchidos foram mantidos.';}
      finally{saving=false;form.querySelectorAll('button').forEach(b=>b.disabled=false);}
    };
    form.querySelector('[name=item]').focus();
  }
  window.RentalManagement={update(next){const changed=loadedClient!==next.clientId,ordersChanged=context?.orders!==next.orders;context=next;if(changed){loadedClient=next.clientId;remote=[];load();}else if(ordersChanged||!root().querySelector('.rm-list'))render();},refresh:load};
})();
