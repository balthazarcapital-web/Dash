(function(){
  "use strict";
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const norm=v=>String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toLowerCase();
  const money=v=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(v)||0);
  function iso(v){
    const text=String(v||"").trim(), br=text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const value=br?br[3]+"-"+br[2]+"-"+br[1]:text;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return "";
    const parsed=new Date(value+"T12:00:00Z");
    return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value?value:"";
  }
  const formatDate=v=>iso(v)?iso(v).split("-").reverse().join("/"):"Não informado";
  const today=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const amount=v=>v===null||v===undefined||v===""?null:Number.isFinite(Number(v))?Number(v):null;
  const total=rows=>rows.reduce((s,r)=>s+(amount(r.value)||0),0);
  function grouped(rows,key,value=()=>1){
    const groups=new Map();
    rows.forEach(r=>{const label=String(r[key]||"Não informado");groups.set(label,(groups.get(label)||0)+value(r))});
    return [...groups].map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value||a.label.localeCompare(b.label,"pt-BR"));
  }
  function series(rows,key,value=()=>1){
    const groups=new Map();
    rows.forEach(r=>{const d=iso(r[key]);if(d){const month=d.slice(0,7);groups.set(month,(groups.get(month)||0)+value(r))}});
    return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([label,value])=>({label:label.slice(5)+"/"+label.slice(0,4),value}));
  }
  function events(rows,fields,label){
    return rows.flatMap(r=>fields.map(([key,name])=>({label:label(r)+" · "+name,value:iso(r[key])}))).filter(r=>r.value).sort((a,b)=>a.value.localeCompare(b.value));
  }
  function rentalModel(rows,period,reference=today()){
    const active=rows.filter(r=>!["finalizado","devolvido","concluido"].includes(norm(r.status)));
    const limit=new Date(reference+"T12:00:00Z");limit.setUTCDate(limit.getUTCDate()+7);const end=limit.toISOString().slice(0,10);
    const due=active.filter(r=>iso(r.due)&&iso(r.due)>=reference&&iso(r.due)<=end);
    const late=active.filter(r=>iso(r.due)&&iso(r.due)<reference);
    const monthly=active.filter(r=>r.billing==="Mensal"&&amount(r.value)!==null);
    const unknown=rows.filter(r=>amount(r.value)===null);
    const missingDates=rows.filter(r=>!iso(r.sent));
    return {
      module:"Locações",title:"Relatório gerencial de locações",period,rows,
      kpis:[["Total de locações",rows.length],["Locações ativas",active.length],["Vencendo em 7 dias",due.length],["Devoluções pendentes",active.filter(r=>!iso(r.returnedDate)).length],["Mensal contratado · ativas",money(total(monthly))],["Locações vencidas",late.length]],
      alerts:[late.length&&late.length+" locação(ões) vencida(s)",due.length&&due.length+" vencendo em até 7 dias",active.filter(r=>!iso(r.returnedDate)).length+" ativa(s) sem devolução registrada",rows.filter(r=>!r.supplier).length&&rows.filter(r=>!r.supplier).length+" sem fornecedor",unknown.length&&unknown.length+" sem valor informado",rows.filter(r=>!r.documentNumber).length&&rows.filter(r=>!r.documentNumber).length+" sem número de documento",missingDates.length&&missingDates.length+" sem data de envio válida"].filter(Boolean),
      note:"Valor mensal: somente locações ativas com cobrança mensal identificada. Valores por evento e sem periodicidade não entram nesse total. Vencimento de boleto não é assumido como vencimento da locação. "+missingDates.length+" registro(s) sem data de envio permanecem nos indicadores, mas não na evolução temporal.",
      charts:[{title:"Distribuição por situação",rows:grouped(rows,"status")},{title:"Locações por fornecedor",rows:grouped(rows,"supplier")},{title:"Equipamentos / serviços",rows:grouped(rows,"item")},{title:"Envios por mês",rows:series(rows,"sent"),temporal:true}],
      timeline:events(rows,[["sent","envio"],["exchange","próxima troca"],["due","vencimento"],["returnedDate","devolução realizada"]],r=>r.item+(r.documentNumber?" · Doc. "+r.documentNumber:"")),
      table:{headers:["Locação / documento","Fornecedor / pedido","Envio / troca","Vencimento / devolução","Valor / cobrança","Situação"],rows:rows.map(r=>[r.item+"\nDocumento: "+(r.documentNumber||"Não informado"),(r.supplier||"Não informado")+"\nPedido: "+(r.orderNumber||"Não criado"),formatDate(r.sent)+"\nTroca: "+formatDate(r.exchange),formatDate(r.due)+"\nDevolução: "+formatDate(r.returnedDate),(amount(r.value)===null?"Não informado":money(r.value))+"\n"+(r.billing||"Periodicidade não informada"),(r.status||"Não informado")+(r.sync==="local"?"\nSomente neste dispositivo":"")])}
    };
  }
  function fiscalModel(rows,period){
    const has=r=>Boolean(r.nfFile||r.invoice&&norm(r.invoice)!=="solicitar");
    const issued=rows.filter(has),payments=rows.filter(r=>norm(r.payment).includes("falta pagar"));
    const pending=rows.filter(r=>!has(r)),late=payments.filter(r=>iso(r.due)&&iso(r.due)<today());
    return {module:"Notas fiscais",title:"Relatório gerencial de notas fiscais",period,rows,
      kpis:[["Pedidos analisados",rows.length],["Pedidos com NF",issued.length],["Valor vinculado a NF",money(total(issued))],["Pendentes de NF",pending.length],["Pagamentos pendentes",payments.length],["Valor em aberto informado",money(total(payments))],["Cobertura documental",rows.length?Math.round(issued.length/rows.length*100)+"%":"—"]],
      alerts:[pending.length&&pending.length+" pedido(s) sem NF",late.length&&late.length+" pagamento(s) vencido(s)",issued.filter(r=>!iso(r.issue)).length&&issued.filter(r=>!iso(r.issue)).length+" registro(s) com NF sem data de emissão válida"].filter(Boolean),
      note:"Contagem por pedido com NF vinculada, não por documentos únicos: a base pode relacionar várias notas a um pedido. Pagamento sem situação não é considerado pago nem em aberto confirmado.",
      charts:[{title:"Notas por fornecedor",rows:grouped(issued,"supplier")},{title:"Valor por categoria",rows:grouped(issued,"category",r=>amount(r.value)||0),money:true},{title:"Emissões por mês",rows:series(issued,"issue"),temporal:true},{title:"Valor emitido por mês",rows:series(issued,"issue",r=>amount(r.value)||0),temporal:true,money:true}],
      timeline:events(rows,[["date","pedido"],["issue","emissão"],["due","vencimento"]],r=>r.description||"Pedido"),
      table:{headers:["Emissão","NF","Descrição","Fornecedor","Valor","Pagamento"],rows:rows.map(r=>[formatDate(r.issue),r.invoice||"Pendente",r.description,r.supplier||"Não informado",money(r.value),r.payment||"Não informado"])}
    };
  }
  function chartHTML(chart){
    let rows=chart.rows;
    if(!chart.temporal&&rows.length>8)rows=[...rows.slice(0,8),{label:"Outros ("+(rows.length-8)+")",value:rows.slice(8).reduce((s,r)=>s+r.value,0)}];
    const max=Math.max(1,...rows.map(r=>r.value));
    return '<section><h3>'+esc(chart.title)+'</h3>'+ (rows.length?rows.map(r=>'<div class="ar-bar-row"><span title="'+esc(r.label)+'">'+esc(r.label)+'</span><i><b style="width:'+Math.max(0,r.value/max*100)+'%"></b></i><strong>'+esc(chart.money?money(r.value):r.value)+'</strong></div>').join(""):'<p class="ar-muted">Sem dados datados para este gráfico.</p>')+'</section>';
  }
  function render(m,options={}){
    if(m.module==="Pedidos")return window.OrderExecutive.render(m,options);
    if(m.module==="Locações"&&window.RentalExecutive)return window.RentalExecutive.render(m,options);
    return '<header class="ar-cover"><small>ABSOLUTTA · RELATÓRIO GERENCIAL</small><h1>'+esc(m.title)+'</h1><h2>'+esc(options.clientName||"Obra selecionada")+'</h2><p>'+esc(m.period)+' · Emitido em '+formatDate(today())+'</p><p>'+esc(options.source||"Dados disponíveis no painel")+'</p></header>'+
      '<nav class="ar-index">01 · Indicadores &nbsp; 02 · Situação &nbsp; 03 · Gráficos &nbsp; 04 · Linha do tempo &nbsp; 05 · Detalhamento</nav>'+
      '<div class="ar-kpis">'+m.kpis.map(([label,value])=>'<div><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>').join("")+'</div>'+
      '<p class="ar-muted">'+esc(m.note)+'</p>'+
      (m.alerts.length?'<section class="ar-alerts"><strong>Atenção e qualidade dos dados</strong><p>'+m.alerts.map(esc).join(" • ")+'</p></section>':'<p class="ar-muted">Nenhum alerta identificado no recorte.</p>')+
      '<div class="ar-charts">'+m.charts.map(chartHTML).join("")+'</div>'+
      '<section class="ar-section"><h3>Linha do tempo · eventos com data informada</h3><div class="ar-timeline">'+(m.timeline.map(r=>'<div><b></b><span>'+esc(r.label)+'</span><small>'+formatDate(r.value)+'</small></div>').join("")||'<p class="ar-muted">Sem eventos datados.</p>')+'</div></section>'+
      '<section class="ar-section"><h3>Detalhamento · '+m.rows.length+' registros</h3><div class="ar-table-wrap"><table><thead><tr>'+m.table.headers.map(h=>'<th>'+esc(h)+'</th>').join("")+'</tr></thead><tbody>'+(m.table.rows.map(row=>'<tr>'+row.map(v=>'<td>'+esc(v).replace(/\n/g,"<br>")+'</td>').join("")+'</tr>').join("")||'<tr><td colspan="'+m.table.headers.length+'">Nenhum registro no período.</td></tr>')+'</tbody></table></div></section><footer class="ar-muted">ABSOLUTTA · Relatório gerencial · '+esc(m.module)+'</footer>';
  }
  function filterRows(rows,module,start,end,filters={}){const matches=(selection,value)=>Array.isArray(selection)?selection.includes(value||""):!selection||selection===value;return rows.filter(r=>{if(module==="orders"&&(!matches(filters.category,r.category)||!matches(filters.status,r.status)))return false;const d=iso(module==="rentals"?r.sent:module==="orders"?r.date:r.issue);return !d||(!start||d>=start)&&(!end||d<=end)})}
  let dismiss;
  function open(module,rows,period="Todos os registros",options={}){
    dismiss?.();
    const originalFocus=document.activeElement,overlay=document.createElement("div"),originalOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const source=structuredClone(rows);
    overlay.id="area-report-overlay";
    if(module==="rentals"||module==="orders")overlay.classList.add("rental-report-overlay");
    overlay.innerHTML='<div class="ar-dialog" role="dialog" aria-modal="true" aria-labelledby="ar-title"><header><div><small>RELATÓRIO GERENCIAL</small><h2 id="ar-title">'+(module==="rentals"?"Relatório de locações":"Relatório de notas fiscais")+'</h2></div><button data-close aria-label="Fechar relatório">×</button></header><form class="ar-filters"><label>Data inicial<input type="date" name="start"></label><label>Data final<input type="date" name="end"></label><button class="button button-secondary">Aplicar período</button><button type="button" class="button button-secondary" data-reset>Todo período</button><p class="ar-muted">Data de referência: '+(module==="rentals"?"envio":"emissão")+'. Registros sem data permanecem destacados.</p><p role="alert" class="ar-error"></p></form><article class="ar-preview"></article><footer><span data-count></span><div><button class="button button-secondary" data-close>Fechar</button><button class="button button-primary" data-print>Imprimir / salvar PDF</button></div></footer></div>';
    document.body.append(overlay);
    if(module==="orders"){
      overlay.querySelector("#ar-title").textContent="Relatório de pedidos";
      overlay.querySelector(".ar-filters .ar-muted").textContent="Referência: data do pedido. Filtros da aba preservados; datas sem informação continuam incluídas.";
    }
    const preview=overlay.querySelector(".ar-preview"),form=overlay.querySelector("form");
    if(module==="orders"){
      const choices=(key,label)=>'<details class="ar-multi" data-multi="'+key+'"><summary>'+label+' <span data-selection-count></span></summary><fieldset><legend>'+label+'</legend><div class="ar-multi-actions"><button type="button" data-all="'+key+'">Selecionar todos</button><button type="button" data-none="'+key+'">Limpar seleção</button></div>'+[...new Set([...source.map(r=>r[key]||""),...(options[key]?[options[key]]:[])])].sort((a,b)=>a.localeCompare(b,"pt-BR")).map(v=>'<label><input type="checkbox" name="'+key+'" value="'+esc(v)+'" '+(!options[key]||options[key]===v?'checked':'')+'>'+esc(v||"Não informado")+'</label>').join("")+'</fieldset></details>';
      form.insertAdjacentHTML("afterbegin",choices("category","Categoria")+choices("status","Status"));
      form.querySelector('button:not([type="button"])').textContent="Aplicar filtros";
      form.querySelector(".ar-muted").textContent="Pedidos incluem locações da base para análise de valores, NF e pagamentos. Categoria e status podem ser alterados aqui. Referência: data do pedido.";
      form.addEventListener("change",e=>{if(e.target.matches('[type="checkbox"]'))generate()});
      form.querySelectorAll('.ar-multi fieldset').forEach(fieldset=>fieldset.insertAdjacentHTML('beforeend','<button type="button" class="ar-multi-done">Concluir seleção</button>'));
      form.addEventListener("click",e=>{if(e.target.closest('.ar-multi-done')){const menu=e.target.closest('details');menu.open=false;menu.querySelector('summary').focus();return}const b=e.target.closest('[data-all],[data-none]');if(!b)return;const key=b.dataset.all||b.dataset.none;form.querySelectorAll('input[name="'+key+'"]').forEach(input=>input.checked=b.hasAttribute("data-all"));generate()});
    }
    if(options.start)form.elements.start.value=options.start;
    function generate(){
      const start=form.elements.start.value,end=form.elements.end.value;
      if((start&&!iso(start))||(end&&!iso(end))||(start&&end&&start>end)){overlay.querySelector(".ar-error").textContent="Informe um período válido.";return false;}
      overlay.querySelector(".ar-error").textContent="";
      const filters={};
      if(module==="orders")for(const key of ["category","status"]){
        const inputs=[...form.querySelectorAll('input[name="'+key+'"]')],selected=inputs.filter(input=>input.checked).map(input=>input.value);
        filters[key]=selected.length===inputs.length?undefined:selected;
        form.querySelector('[data-multi="'+key+'"] [data-selection-count]').textContent=selected.length===inputs.length?"Todos":selected.length+" selecionados";
      }
      const selected=filterRows(source,module,start,end,filters),label=start||end?(start?formatDate(start):"Início")+" a "+(end?formatDate(end):"Sem limite final")+" · sem data incluídos":period;
      const m=module==="orders"?{module:"Pedidos",rows:selected,period:label}:module==="rentals"?rentalModel(selected,label):fiscalModel(selected,label);
      const selectionLabel=(values,all)=>values===undefined?all:values.length?values.map(v=>v||"Não informado").join(", "):"Nenhum selecionado";
      const renderOptions=module==="orders"?{...options,source:[options.source,"Categorias: "+selectionLabel(filters.category,"Todas"),"Status: "+selectionLabel(filters.status,"Todos")].filter(Boolean).join(" · ")}:options;
      preview.innerHTML=render(m,renderOptions);overlay.querySelector("[data-count]").textContent=selected.length+" registros";return true;
    }
    const close=()=>{document.removeEventListener("keydown",keyboard,true);overlay.remove();document.body.style.overflow=originalOverflow;originalFocus?.focus();dismiss=null;};
    const keyboard=e=>{
      if(e.key==="Escape"&&overlay.querySelector('.ar-multi[open]')){e.preventDefault();e.stopImmediatePropagation();const menu=overlay.querySelector('.ar-multi[open]');menu.open=false;menu.querySelector('summary').focus();return}
      if(e.key==="Escape"){e.stopImmediatePropagation();close();}
      if(e.key==="Tab"){const nodes=[...overlay.querySelectorAll("button,input,select,summary,a[href]")].filter(n=>!n.disabled&&n.getClientRects().length),first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}
    };
    dismiss=close;document.addEventListener("keydown",keyboard,true);
    form.onsubmit=e=>{e.preventDefault();generate();};
    overlay.addEventListener("click",e=>{
      overlay.querySelectorAll('.ar-multi[open]').forEach(menu=>{if(!menu.contains(e.target))menu.open=false});
      if(e.target===overlay||e.target.closest("[data-close]"))close();
      if(e.target.closest("[data-reset]")){form.elements.start.value="";form.elements.end.value="";generate();}
      if(e.target.closest("[data-print]")&&generate()){
        document.querySelector("#area-report-print")?.remove();
        const frame=document.createElement("iframe");frame.id="area-report-print";frame.title="Impressão do relatório";frame.style.cssText="position:fixed;width:1px;height:1px;bottom:0;border:0";
        frame.onload=()=>{frame.contentWindow.focus();frame.contentWindow.print()};
        const cssUrl=new URL("area-report.css",location.href).href;
        frame.srcdoc='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>'+esc(options.clientName||"Obra")+' - Relatório</title><link rel="stylesheet" href="'+esc(cssUrl)+'"><style>body{margin:0;padding:0;font:12px Arial;color:#17243b;--navy:#17243b;--lime:#a5b954;--line:#e0e5eb;--muted:#667387}.ar-table-wrap{overflow:visible}.ar-table-wrap table{min-width:0;table-layout:fixed}td,th{overflow-wrap:anywhere}.ar-kpis{grid-template-columns:repeat(3,1fr)}.ar-charts{grid-template-columns:1fr 1fr}.ar-bar-row span{white-space:normal}thead{display:table-header-group}tr,.ar-kpis>div,.ar-charts>section{break-inside:avoid}h3{break-after:avoid}*{print-color-adjust:exact;-webkit-print-color-adjust:exact}@page{size:A4;margin:14mm}</style></head><body>'+preview.innerHTML+'</body></html>';
        document.body.append(frame);
      }
    });
    generate();overlay.querySelector("[data-close]").focus();
  }
  window.AreaReports={open,rentalModel,fiscalModel,formatDate,iso,filterRows,render};
})();
