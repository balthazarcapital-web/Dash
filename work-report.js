(function(){
  "use strict";
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const money=v=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(v)||0);
  const norm=v=>String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
  const numberKey=v=>String(v??"").trim().replace(/^#/, "").replace(/^0+(?=\d)/,"");
  function buildModel(work,orders,selected){
    const budget=work.budget||{}, ids=new Set(selected);
    const items=(budget.items||[]).filter(item=>ids.has(item.id)).map(item=>{
      const entries=(budget.actuals||[]).filter(row=>row.itemId===item.id).map(row=>{
        const exact=orders.filter(order=>order.reportRef===row.orderRef && row.orderRef);
        const candidates=exact.length?exact:orders.filter(order=>numberKey(row.orderNumber) && numberKey(order.number)===numberKey(row.orderNumber));
        const order=candidates.length===1?candidates[0]:null;
        return {...row,invoice:order?.invoice && norm(order.invoice)!=="solicitar"?order.invoice:"Não informada",supplier:order?.supplier||"Não informado",invoiceUrl:/^https:\/\//i.test(order?.nfFile||"")?order.nfFile:"",linked:!!order};
      });
      const planned=Number(item.plannedTotal)||0,actual=entries.reduce((sum,row)=>sum+(Number(row.value)||0),0);
      return {...item,entries,planned,actual,balance:planned-actual};
    });
    return {title:work.details?.name||work.budget?.project||"Gestão de obra",items,planned:items.reduce((s,i)=>s+i.planned,0),actual:items.reduce((s,i)=>s+i.actual,0)};
  }
  function reportHTML(model){
    return `<header class="wr-cover"><small>ABSOLUTTA · GESTÃO DE OBRA</small><h1>${esc(model.title)}</h1><p>Orçado × realizado · Período inteiro</p><p>${model.items.length} itens selecionados · Emitido em ${new Date().toLocaleDateString("pt-BR")}</p></header>
      <div class="wr-kpis"><div><span>ORÇADO</span><strong>${money(model.planned)}</strong></div><div><span>REALIZADO</span><strong>${money(model.actual)}</strong></div><div><span>SALDO</span><strong>${money(model.planned-model.actual)}</strong></div></div>
      <p class="wr-note">Valores realizados correspondem aos lançamentos atribuídos aos itens selecionados, não necessariamente a pagamentos. Orçamento direto, sem taxa administrativa adicional. Notas fiscais são informadas a partir dos pedidos vinculados.</p>
      ${model.items.map(item=>`<section class="wr-item"><small>${esc(item.category)}</small><h2>${esc(item.code)} · ${esc(item.description)}</h2><div class="wr-values"><span>Orçado <b>${money(item.planned)}</b></span><span>Realizado <b>${money(item.actual)}</b></span><span>Saldo <b>${money(item.balance)}</b></span></div><div class="wr-progress"><i style="width:${item.planned?Math.max(0,Math.min(100,item.actual/item.planned*100)):0}%"></i></div><p class="wr-note">Material orçado: ${money(item.plannedMaterial)} · Mão de obra orçada: ${money(item.plannedLabor)}</p>
      ${item.entries.length?`<table><thead><tr><th>Pedido / lançamento</th><th>Fornecedor / NF</th><th>Realizado</th></tr></thead><tbody>${item.entries.map(row=>`<tr><td>${esc(row.description||row.reference||"Lançamento manual")}<small>${esc(row.date||"")} · ${esc(row.type||"")}</small></td><td>${esc(row.supplier)}<small>NF: ${esc(row.invoice)}</small>${row.invoiceUrl?`<a href="${esc(row.invoiceUrl)}" target="_blank" rel="noopener">Abrir nota fiscal ↗</a>`:""}${!row.linked?`<small>${row.source==="Pedido"?"Vínculo não confirmado na base atual":"Lançamento sem pedido vinculado"}</small>`:""}</td><td>${money(row.value)}</td></tr>`).join("")}</tbody></table>`:'<p class="wr-note">Nenhum realizado atribuído a este item.</p>'}</section>`).join("")}<footer class="wr-note">ABSOLUTTA · Relatório gerencial · Valores em reais</footer>`;
  }
  const printCSS=`@page{size:A4;margin:15mm}*{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#18243b;margin:0}.wr-cover{background:#17243b;color:white;padding:24px;border-radius:12px}.wr-cover small{color:#d3e899;letter-spacing:2px}.wr-cover h1{font-size:26px}.wr-kpis{display:flex;gap:12px;margin:22px 0}.wr-kpis>div{flex:1;background:#f1f4f7;padding:16px;border-radius:10px}.wr-kpis span,.wr-kpis strong{display:block}.wr-kpis strong{font-size:20px;margin-top:8px}.wr-kpis span,.wr-note{font-size:11px;color:#607086;line-height:1.6}.wr-item{margin-top:26px}.wr-item h2{font-size:16px}.wr-values{display:flex;gap:18px;flex-wrap:wrap}.wr-values b{display:block}.wr-progress{height:7px;background:#e7ebf0;margin:14px 0;border-radius:9px}.wr-progress i{height:100%;display:block;background:#9fb44b}table{width:100%;border-collapse:collapse;min-width:0}th,td{padding:10px 6px;border-bottom:1px solid #e4e9ef;text-align:left;font-size:11px;overflow-wrap:anywhere}th{background:#f4f6f8}td small{display:block;color:#607086;margin-top:4px}tr{break-inside:avoid}h2{break-after:avoid}a{color:#315a97}*{print-color-adjust:exact;-webkit-print-color-adjust:exact}`;
  function open({work,orders=[],toast=()=>{}}){
    document.querySelector("#wr-overlay")?.remove();
    if(!work?.budget?.items?.length){toast("Esta obra não tem itens orçados disponíveis.");return}
    const selected=new Set(work.budget.items.map(i=>i.id)), categories=[...new Set(work.budget.items.map(i=>i.category||"Sem categoria"))];
    const overlay=document.createElement("div");overlay.id="wr-overlay";
    overlay.innerHTML=`<section class="wr-drawer" role="dialog" aria-modal="true" aria-labelledby="wr-title"><header class="wr-head"><div><small>RELATÓRIO GERENCIAL</small><h2 id="wr-title">Relatório da obra</h2><p>Selecione categorias e itens · Período inteiro</p></div><button type="button" data-wr-close aria-label="Fechar relatório">×</button></header><div class="wr-scroll"><div id="wr-filters"><div class="wr-tools"><button type="button" data-wr-all>Selecionar todos</button><button type="button" data-wr-none>Limpar seleção</button></div>${categories.map((category,index)=>`<details class="wr-category" open><summary><label><input type="checkbox" data-wr-category="${index}" checked> ${esc(category)}</label></summary><div>${work.budget.items.filter(i=>(i.category||"Sem categoria")===category).map(item=>`<label class="wr-choice"><input type="checkbox" data-wr-item="${esc(item.id)}" data-category-index="${index}" checked><span><b>${esc(item.code)} · ${esc(item.description)}</b><small>${money(item.plannedTotal)} orçado</small></span></label>`).join("")}</div></details>`).join("")}</div><article id="wr-preview" hidden></article></div><footer class="wr-actions"><span id="wr-count"></span><button type="button" id="wr-back" hidden>Alterar seleção</button><button type="button" id="wr-generate">Gerar prévia</button><button type="button" id="wr-print" hidden>Imprimir / salvar PDF</button></footer></section>`;
    document.body.append(overlay);
    const find=s=>overlay.querySelector(s), filters=find("#wr-filters"),preview=find("#wr-preview"),generate=find("#wr-generate"),back=find("#wr-back"),print=find("#wr-print");
    const previousFocus=document.activeElement;
    const close=()=>{document.removeEventListener("keydown",keyboard);overlay.remove();previousFocus?.focus()};
    const keyboard=e=>{if(e.key==="Escape")close();if(e.key==="Tab"){const focusable=[...overlay.querySelectorAll("button,input,summary,a[href]")].filter(n=>n.getClientRects().length&&!n.disabled);const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}};
    document.addEventListener("keydown",keyboard);
    overlay.addEventListener("click",e=>{if(e.target===overlay||e.target.closest("[data-wr-close]"))close()});
    function sync(){
      overlay.querySelectorAll("[data-wr-item]").forEach(input=>{input.checked=selected.has(input.dataset.wrItem)});
      overlay.querySelectorAll("[data-wr-category]").forEach(input=>{const group=[...overlay.querySelectorAll('[data-category-index="'+input.dataset.wrCategory+'"]')],count=group.filter(i=>i.checked).length;input.checked=count===group.length;input.indeterminate=count>0&&count<group.length});
      find("#wr-count").textContent=selected.size+" itens selecionados";generate.disabled=!selected.size;
    }
    filters.addEventListener("change",e=>{
      const input=e.target;
      if(input.dataset.wrItem){input.checked?selected.add(input.dataset.wrItem):selected.delete(input.dataset.wrItem)}
      if(input.dataset.wrCategory!==undefined){overlay.querySelectorAll('[data-category-index="'+input.dataset.wrCategory+'"]').forEach(i=>input.checked?selected.add(i.dataset.wrItem):selected.delete(i.dataset.wrItem))}
      sync();
    });
    find("[data-wr-all]").onclick=()=>{work.budget.items.forEach(i=>selected.add(i.id));sync()};
    find("[data-wr-none]").onclick=()=>{selected.clear();sync()};
    generate.onclick=()=>{preview.innerHTML=reportHTML(buildModel(work,orders,[...selected]));preview.hidden=false;filters.hidden=true;generate.hidden=true;back.hidden=false;print.hidden=false;find(".wr-scroll").scrollTop=0};
    back.onclick=()=>{preview.hidden=true;filters.hidden=false;generate.hidden=false;back.hidden=true;print.hidden=true};
    print.onclick=()=>{
      const frame=document.createElement("iframe");frame.title="Impressão do relatório";frame.style.cssText="position:fixed;width:1px;height:1px;bottom:0;border:0";
      frame.onload=()=>{frame.contentWindow.focus();frame.contentWindow.print()};
      frame.srcdoc='<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Relatório da obra</title><style>'+printCSS+'</style><body>'+preview.innerHTML+'</body></html>';
      document.querySelector("#wr-print-frame")?.remove();frame.id="wr-print-frame";document.body.append(frame);
    };
    sync();find("[data-wr-close]").focus();
  }
  window.WorkReport={open,buildModel,reportHTML};
})();
