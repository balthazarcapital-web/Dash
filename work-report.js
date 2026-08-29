(function(){
  "use strict";
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const money=v=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(v)||0);
  const norm=v=>String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
  const numberKey=v=>String(v??"").trim().replace(/^#/, "").replace(/^0+(?=\d)/,"");
  function costBreakdown(item,entries){
    const groups=[{label:"Material",planned:Number(item.plannedMaterial)||0,actual:0},{label:"Mão de obra",planned:Number(item.plannedLabor)||0,actual:0},{label:"Outros / não classificado",planned:null,actual:0}];
    for(const row of entries){const type=norm(row.type),index=type==="material"?0:type==="mao de obra"?1:2;groups[index].actual+=Number(row.value)||0}
    return groups;
  }
  function costHTML(item,entries,compact=false){
    return '<div class="cost-split'+(compact?' compact':'')+'">'+costBreakdown(item,entries).filter((g,i)=>i<2||g.actual!==0).map(g=>{
      const over=g.planned!==null&&g.actual>g.planned,width=g.planned>0?Math.max(0,Math.min(100,g.actual/g.planned*100)):g.actual>0?100:0;
      return '<section class="cost-part'+(over?' over':'')+'"><strong>'+esc(g.label)+'</strong><div class="cost-values"><span>Orçado <b>'+(g.planned===null?'Não separado':money(g.planned))+'</b></span><span>Realizado <b>'+money(g.actual)+'</b></span>'+(g.planned===null?'':'<span>Saldo <b>'+money(g.planned-g.actual)+'</b></span>')+'</div>'+(g.planned===null?'':'<div class="cost-track" aria-label="'+esc(g.label)+': '+money(g.actual)+' realizado de '+money(g.planned)+' orçado"><i style="width:'+width+'%"></i></div>'+(over?'<small class="cost-alert">Acima do orçado em '+money(g.actual-g.planned)+'</small>':''))+'</section>';
    }).join('')+'</div>';
  }
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
    const climate=climateFor(work);
    return {title:work.details?.name||work.budget?.project||"Gestão de obra",items,planned:items.reduce((s,i)=>s+i.planned,0),actual:items.reduce((s,i)=>s+i.actual,0),journal:[...(work.journal||[])],climate};
  }
  function climateFor(work){
    const climateData=window.AbsoluttaClimateData||[];
    // Todos os clientes atuais ficam em Curitiba. Use a base geral enquanto
    // um cliente ainda não tiver uma estação/base climática própria.
    const own=climateData.filter(entry=>entry.clientId===work.clientId);
    const entries=own.length?own:climateData.filter(entry=>entry.clientId==='dr_clovis_cmfs');
    return entries
      .flatMap(entry=>entry.businessRows||[]).sort((a,b)=>a.date.localeCompare(b.date));
  }
  function climateRange(rows){
    const dates=rows.map(row=>row.date).filter(Boolean).sort();
    return {start:dates[0]||"",end:dates.at(-1)||""};
  }
  function filterClimate(rows,start,end){
    return rows.filter(row=>(!start||row.date>=start)&&(!end||row.date<=end));
  }
  function climateSymbol(row){
    const known=v=>v!==null&&v!==undefined&&v!==""&&Number.isFinite(Number(v));
    if(known(row.prcp)&&Number(row.prcp)>0)return {kind:"rain",label:"Precipitação registrada"};
    if(known(row.tavg)||known(row.tmin)||known(row.tmax))return {kind:"temperature",label:"Temperatura registrada; condição do céu não informada"};
    return {kind:"unknown",label:"Condição não informada"};
  }
  function temperatureColor(value){
    if(value===null||value===undefined||String(value).trim()===''||!Number.isFinite(Number(value)))return null;
    // Escala fixa: a mesma temperatura mantém a cor ao trocar o período.
    const stops=[[10,[49,113,187]],[15,[99,160,201]],[20,[193,164,105]],[25,[221,117,71]],[30,[192,64,65]]];
    const t=Math.max(10,Math.min(30,Number(value))),i=Math.min(3,Math.floor((t-10)/5));
    const ratio=(t-stops[i][0])/5;
    const rgb=stops[i][1].map((v,k)=>Math.round(v+(stops[i+1][1][k]-v)*ratio));
    const tint=amount=>'rgb('+rgb.map(v=>Math.round(255+(v-255)*amount)).join(',')+')';
    return {accent:tint(1),background:tint(.14),border:tint(.4)};
  }
  function rainSummary(rows=[]){
    const validDate=date=>/^\d{4}-\d{2}-\d{2}$/.test(date||'')&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date;
    const days=[...new Map(rows.filter(row=>validDate(row.date)).map(row=>[row.date,row])).values()];
    const measured=days.filter(row=>row.prcp!==null&&row.prcp!==undefined&&String(row.prcp).trim()!==''&&Number.isFinite(Number(row.prcp))&&Number(row.prcp)>=0);
    const rainy=measured.filter(row=>Number(row.prcp)>0).sort((a,b)=>a.date.localeCompare(b.date)).map(row=>({...row,weekday:new Date(row.date+'T12:00:00Z').getUTCDay()}));
    return {total:days.length,measured:measured.length,missing:days.length-measured.length,rainy,workdays:rainy.filter(row=>row.weekday>=1&&row.weekday<=5).length};
  }
  function rainSummaryHTML(rows){
    const s=rainSummary(rows),weekdays=['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
    const message=!s.measured?'Dados de chuva não informados no arquivo. Não é possível identificar quais dias choveu.':!s.rainy.length?'Nenhum dia com precipitação positiva entre os registros informados.':'';
    const dates=s.rainy.map(row=>'<li><time datetime="'+row.date+'">'+row.date.split('-').reverse().join('/')+'</time><span>'+weekdays[row.weekday]+'</span><b class="'+(row.weekday>=1&&row.weekday<=5?'wc-business':'wc-weekend')+'">'+(row.weekday>=1&&row.weekday<=5?'Seg–sex':'Fim de semana')+'</b></li>').join('');
    return '<section class="wc-rain-summary" aria-label="Resumo dos dias com chuva"><h3>Chuva no expediente · 8h às 17h</h3><div class="wc-rain-metrics"><div><strong>'+(s.measured?s.rainy.length:'—')+'</strong><span>Dias com chuva entre 8h e 17h</span></div><div><strong>'+(s.measured?s.workdays:'—')+'</strong><span>Em dias úteis, no expediente*</span></div></div>'+(message?'<p>'+message+'</p>':'')+(dates?'<ul>'+dates+'</ul>':'')+'<p class="wc-rain-foot">'+s.measured+' de '+s.total+' dias com medição de precipitação'+(s.missing?' · '+s.missing+' sem informação':'')+'. Chuva: precipitação maior que zero dentro do expediente. Não comprova paralisação da obra.<br>* Dias úteis: segunda a sexta, sem descontar feriados ou considerar o calendário de trabalho da obra.</p></section>';
  }
  const climateCalendarCSS=`
    #climate .panel-header{flex-wrap:wrap;gap:12px}
    #climate .panel-header label{display:flex;align-items:center;gap:10px;font-size:12px;color:#596a7e}
    #climate-page-month{max-width:100%;padding:10px 14px;border:1px solid #dce3eb;border-radius:9px;background:#fff;color:#17243b;font:inherit}
    #climate-page-month:focus-visible{outline:2px solid #315678;outline-offset:2px}
    .wc-month{margin:16px 0 22px;break-inside:avoid}
    .wc-month-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;border-bottom:1px solid #dce3eb;padding-bottom:9px}
    .wc-month-head strong{text-transform:capitalize;font-size:15px;color:#17243b}
    .wc-month-head span{font-size:10px;color:#748093}
    .wc-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px}
    .wc-weekday{text-align:center;text-transform:uppercase;letter-spacing:.7px;font-size:9px;color:#7a8494;padding:3px}
    .wc-day{min-width:0;padding:7px 6px;background:var(--wc-bg,#fff);border:1px solid var(--wc-border,#e4e8ed);border-top:3px solid var(--wc-accent,#e4e8ed);border-radius:8px;break-inside:avoid;print-color-adjust:exact;-webkit-print-color-adjust:exact}
    .wc-day-head{display:flex;justify-content:space-between;align-items:center;color:#8d754b}
    .wc-day time{font-size:11px;font-weight:700;color:#17243b}
    .wc-icon{width:17px;height:17px;flex-shrink:0}
    .wc-reading{font-size:14px;font-weight:700;color:#17243b;margin:5px 0 3px;line-height:1.1}
    .wc-range,.wc-extra{display:block;font-size:9px;color:#68778a;line-height:1.55}
    .wc-range b{font-weight:500;color:#17243b}
    .wc-muted{background:#f4f6f8;border-color:transparent}
    .wc-muted time{color:#a7afba}
    .wc-muted small{font-size:8px;color:#929cac;display:block;margin-top:10px}
    .wc-day-head{color:var(--wc-accent,#748093)}
    .wc-thermal-legend{margin:10px 0 15px;color:#68778a;font-size:10px;max-width:300px}
    .wc-thermal-legend i{display:block;height:6px;border-radius:5px;margin:6px 0;background:linear-gradient(90deg,rgb(49,113,187),rgb(99,160,201),rgb(193,164,105),rgb(221,117,71),rgb(192,64,65));print-color-adjust:exact;-webkit-print-color-adjust:exact}
    .wc-thermal-legend span{display:flex;justify-content:space-between}
    .wc-legend{font-size:10px;color:#68778a;line-height:1.5}
    .wc-rain-summary{margin-top:16px;padding:16px;background:#f2f6fa;border:1px solid #dce5ed;border-radius:12px;break-inside:avoid;color:#17243b}
    .wc-rain-summary h3{font-size:14px;margin:0 0 12px}.wc-rain-summary p{font-size:11px;line-height:1.6;color:#596a7e}
    .wc-rain-metrics{display:flex;gap:28px}.wc-rain-metrics strong{display:block;font-size:24px}.wc-rain-metrics span{font-size:10px;color:#596a7e}
    .wc-rain-summary ul{list-style:none;margin:12px 0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:6px}
    .wc-rain-summary li{display:flex;flex-wrap:wrap;gap:5px 8px;align-items:center;padding:9px;background:#fff;border-radius:6px;font-size:10px;break-inside:avoid}
    .wc-rain-summary time{font-weight:700}.wc-rain-summary li span{color:#596a7e}.wc-rain-summary li b{padding:3px 5px;border-radius:4px;font-size:9px}.wc-business{background:#e4edf7;color:#315678}.wc-weekend{background:#eeeef0;color:#626773}
    .wc-rain-summary .wc-rain-foot{margin:12px 0 0;font-size:10px}
    @media(max-width:520px){.wc-grid{gap:3px}.wc-day{padding:5px 3px}.wc-reading{font-size:11px}.wc-range,.wc-extra{font-size:8px}.wc-icon{width:13px;height:13px}.wc-day time{font-size:9px}.wc-weekday{font-size:8px;letter-spacing:0}.wc-month-head strong{font-size:13px}.wc-month-head span{font-size:9px}}
  `;
  function climateHTML(rows=[],options={}){
    const value=v=>v===null||v===undefined||v===""?"—":esc(typeof v==="number"?v.toLocaleString("pt-BR",{maximumFractionDigits:1}):v);
    const paths={
      temperature:'<path d="M9 14.5V5a3 3 0 0 1 6 0v9.5a5 5 0 1 1-6 0Z"/><path d="M12 8v10"/><circle cx="12" cy="18" r="1.5"/>',
      rain:'<path d="M6 15a4 4 0 1 1 1-7.9A6 6 0 0 1 19 10a3 3 0 0 1-1 5"/><path d="m8 17-1 3m6-3-1 3m6-3-1 3"/>',
      unknown:'<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>'
    };
    const months=[...new Set(rows.map(row=>row.date.slice(0,7)))].sort();
    const byDate=new Map(rows.map(row=>[row.date,row]));
    const calendar=months.map(month=>{
      const [year,m]=month.split("-").map(Number),first=new Date(Date.UTC(year,m-1,1)),days=new Date(Date.UTC(year,m,0)).getUTCDate();
      let cells='<div aria-hidden="true"></div>'.repeat(first.getUTCDay());
      for(let day=1;day<=days;day++){
        const date=month+"-"+String(day).padStart(2,"0"),row=byDate.get(date),label=date.split("-").reverse().join("/");
        if(!row){cells+='<div class="wc-day wc-muted"><time datetime="'+date+'">'+day+'</time><small>Sem registro<br>no filtro</small></div>';continue;}
        const symbol=climateSymbol(row),tone=temperatureColor(row.tavg);
        const thermalStyle=tone?' style="--wc-bg:'+tone.background+';--wc-border:'+tone.border+';--wc-accent:'+tone.accent+'"':'';
        cells+='<article class="wc-day wc-'+symbol.kind+'"'+thermalStyle+' aria-label="'+label+'"><div class="wc-day-head"><time datetime="'+date+'">'+String(day).padStart(2,"0")+'</time><svg class="wc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" role="img" aria-label="'+symbol.label+'"><title>'+symbol.label+'</title>'+paths[symbol.kind]+'</svg></div><div class="wc-reading">'+value(row.tavg)+'°</div><span class="wc-range">↓ '+value(row.tmin)+'° <b>↑ '+value(row.tmax)+'°</b></span><span class="wc-extra">Vento '+value(row.wspd)+' '+esc(row.windUnit||'')+'</span><span class="wc-extra">Chuva '+value(row.prcp)+' '+esc(row.rainUnit||'')+'</span>'+(row.humidity!=null?'<span class="wc-extra">Umidade '+value(row.humidity)+'%</span>':'')+(row.rainHours!=null?'<span class="wc-extra">'+(row.rainHours<(row.expectedRainHours||24)?'Parcial · ':'')+'Chuva '+row.rainHours+'/'+(row.expectedRainHours||24)+' h</span>':'')+'</article>';
      }
      return '<div class="wc-month"><div class="wc-month-head"><strong>'+first.toLocaleDateString("pt-BR",{month:"long",year:"numeric",timeZone:"UTC"})+'</strong><span>'+rows.filter(row=>row.date.startsWith(month)).length+' dias registrados</span></div><div class="wc-grid">'+["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"].map(d=>'<div class="wc-weekday">'+d+'</div>').join("")+cells+'</div></div>';
    }).join("");
    const hourly=rows.filter(row=>row.timeBasis==='America/Sao_Paulo'),partial=hourly.filter(row=>row.rainHours<9);
    const provenance=hourly.length?'<p class="wc-legend">Fonte: '+esc([...new Set(hourly.map(row=>row.source))].join(', '))+'. Curitiba informada pelo usuário; estação não identificada no arquivo. Horário de Curitiba (America/Sao_Paulo). Todos os cartões: 8h às 17h. Chuva e extremos horários: adotada a convenção de intervalo encerrado na hora indicada (leituras das 9h às 17h, cobrindo 8h–17h); confirmar essa convenção com a fonte do CSV. Temperatura, vento e umidade: amostras instantâneas das 8h às 17h. Chuva fora do expediente não entra nos indicadores. '+(partial.length?partial.length+' dia(s) com chuva parcialmente medida; zero parcial não comprova expediente inteiro sem chuva.':'')+'</p>':'';
    return '<section class="wr-climate" id="'+esc(options.id||'wr-climate-live')+'"><style>'+climateCalendarCSS+'</style><h2>Clima — expediente das 8h às 17h</h2>'+(rows.length?'<div class="wc-thermal-legend">Cor pela temperatura média no expediente (°C)<i aria-hidden="true"></i><span><b>≤ 10°</b><b>20°</b><b>≥ 30°</b></span></div>'+calendar+rainSummaryHTML(rows)+provenance+'<p class="wc-legend">Temperatura média em destaque · ↓ mínima · ↑ máxima (°C). Termômetro: apenas dados de temperatura; não indica sol. Precipitação ausente não significa ausência de chuva. — = não informado. Unidades exibidas quando identificadas no arquivo.</p>':'<p class="wr-note">Nenhum registro horário no período selecionado.</p>')+'</section>';
  }
  function reportHTML(model){
    return `<header class="wr-cover"><small>ABSOLUTTA · GESTÃO DE OBRA</small><h1>${esc(model.title)}</h1><p>Orçado × realizado · Período inteiro</p><p>${model.items.length} itens selecionados · Emitido em ${new Date().toLocaleDateString("pt-BR")}</p></header>
      <div class="wr-kpis"><div><span>ORÇADO</span><strong>${money(model.planned)}</strong></div><div><span>REALIZADO</span><strong>${money(model.actual)}</strong></div><div><span>SALDO</span><strong>${money(model.planned-model.actual)}</strong></div></div>
      <p class="wr-note">Valores realizados correspondem aos lançamentos atribuídos aos itens selecionados, não necessariamente a pagamentos. Orçamento direto, sem taxa administrativa adicional. Notas fiscais são informadas a partir dos pedidos vinculados.</p>${climateHTML(model.climate)}
      ${model.items.map(item=>`<section class="wr-item ${item.actual>item.planned?"over-budget":""}"><small>${esc(item.category)}</small><h2>${esc(item.code)} · ${esc(item.description)}</h2><div class="wr-values"><span>Orçado <b>${money(item.planned)}</b></span><span>Realizado <b>${money(item.actual)}</b></span><span>Saldo <b>${money(item.balance)}</b></span></div>${costHTML(item,item.entries)}
      ${item.entries.length?`<table><thead><tr><th>Pedido / lançamento</th><th>Fornecedor / NF</th><th>Realizado</th></tr></thead><tbody>${item.entries.map(row=>`<tr><td>${esc(row.description||row.reference||"Lançamento manual")}<small>${esc(row.date||"")} · ${esc(row.type||"")}</small></td><td>${esc(row.supplier)}<small>NF: ${esc(row.invoice)}</small>${row.invoiceUrl?`<a href="${esc(row.invoiceUrl)}" target="_blank" rel="noopener">Abrir nota fiscal ↗</a>`:""}${!row.linked?`<small>${row.source==="Pedido"?"Vínculo não confirmado na base atual":"Lançamento sem pedido vinculado"}</small>`:""}</td><td>${money(row.value)}</td></tr>`).join("")}</tbody></table>`:'<p class="wr-note">Nenhum realizado atribuído a este item.</p>'}</section>`).join("")}<footer class="wr-note">ABSOLUTTA · Relatório gerencial · Valores em reais</footer>`;
  }
  const printCSS=`.cost-split{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0}.cost-part{flex:1;min-width:200px;padding:12px;background:#f5f7fa;border-radius:10px;break-inside:avoid}.cost-values{display:flex;gap:12px;margin:10px 0;font-size:12px;flex-wrap:wrap}.cost-values b{display:block}.cost-track{height:8px;background:#dfe5ec;border-radius:8px;overflow:hidden}.cost-track i{display:block;height:100%;background:#9fb44b}.cost-part.over .cost-track i{background:#d8564c}.cost-part.over .cost-values span:last-child b,.cost-alert{color:#b3433d}.cost-alert{font-size:11px}.wr-progress.over i{background:#d8564c}@page{size:A4;margin:15mm}*{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#18243b;margin:0}.wr-cover{background:#17243b;color:white;padding:24px;border-radius:12px}.wr-cover small{color:#d3e899;letter-spacing:2px}.wr-cover h1{font-size:26px}.wr-kpis{display:flex;gap:12px;margin:22px 0}.wr-kpis>div{flex:1;background:#f1f4f7;padding:16px;border-radius:10px}.wr-kpis span,.wr-kpis strong{display:block}.wr-kpis strong{font-size:20px;margin-top:8px}.wr-kpis span,.wr-note{font-size:11px;color:#607086;line-height:1.6}.wr-item{margin-top:26px}.wr-item h2{font-size:16px}.wr-values{display:flex;gap:18px;flex-wrap:wrap}.wr-values b{display:block}.wr-progress{height:7px;background:#e7ebf0;margin:14px 0;border-radius:9px}.wr-progress i{height:100%;display:block;background:#9fb44b}table{width:100%;border-collapse:collapse;min-width:0}th,td{padding:10px 6px;border-bottom:1px solid #e4e9ef;text-align:left;font-size:11px;overflow-wrap:anywhere}th{background:#f4f6f8}td small{display:block;color:#607086;margin-top:4px}tr{break-inside:avoid}h2{break-after:avoid}a{color:#315a97}*{print-color-adjust:exact;-webkit-print-color-adjust:exact}`;
  function open({work,orders=[],toast=()=>{}}){
    document.querySelector("#wr-overlay")?.remove();
    if(!work?.budget?.items?.length){toast("Esta obra não tem itens orçados disponíveis.");return}
    const selected=new Set(work.budget.items.map(i=>i.id)), categories=[...new Set(work.budget.items.map(i=>i.category||"Sem categoria"))];
    const overlay=document.createElement("div");overlay.id="wr-overlay";
    overlay.innerHTML=`<section class="wr-drawer" role="dialog" aria-modal="true" aria-labelledby="wr-title"><header class="wr-head"><div><small>RELATÓRIO GERENCIAL</small><h2 id="wr-title">Relatório da obra</h2><p>Selecione categorias, itens e período climático</p></div><button type="button" data-wr-close aria-label="Fechar relatório">×</button></header><div class="wr-scroll"><div id="wr-filters"><div class="wr-tools"><button type="button" data-wr-all>Selecionar todos</button><button type="button" data-wr-none>Limpar seleção</button></div><div class="wr-date-filter"><label>Clima desde<input type="date" id="wr-climate-start"></label><label>Clima até<input type="date" id="wr-climate-end"></label></div>${categories.map((category,index)=>`<details class="wr-category" open><summary><label><input type="checkbox" data-wr-category="${index}" checked> ${esc(category)}</label></summary><div>${work.budget.items.filter(i=>(i.category||"Sem categoria")===category).map(item=>`<label class="wr-choice"><input type="checkbox" data-wr-item="${esc(item.id)}" data-category-index="${index}" checked><span><b>${esc(item.code)} · ${esc(item.description)}</b><small>${money(item.plannedTotal)} orçado</small></span></label>`).join("")}</div></details>`).join("")}</div><article id="wr-preview" hidden></article></div><footer class="wr-actions"><span id="wr-count"></span><button type="button" id="wr-back" hidden>Alterar seleção</button><button type="button" id="wr-generate">Gerar prévia</button><button type="button" id="wr-print" hidden>Imprimir / salvar PDF</button></footer></section>`;
    document.body.append(overlay);
    const find=s=>overlay.querySelector(s), filters=find("#wr-filters"),preview=find("#wr-preview"),generate=find("#wr-generate"),back=find("#wr-back"),print=find("#wr-print");
    const availableClimate=climateFor(work), bounds=climateRange(availableClimate);
    for(const [selector,value] of [["#wr-climate-start",bounds.start],["#wr-climate-end",bounds.end]]){
      const input=find(selector);
      input.value=value;input.min=bounds.start;input.max=bounds.end;
      input.disabled=!availableClimate.length;
    }
    const notice=document.createElement("p");
    notice.className="wr-note";
    notice.textContent=availableClimate.length?availableClimate.length+" dias disponíveis no arquivo. Este filtro altera somente o clima.":"Nenhum arquivo climático cadastrado para esta obra.";
    find(".wr-date-filter").after(notice);
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
    generate.onclick=()=>{
      const climateStart=find("#wr-climate-start").value, climateEnd=find("#wr-climate-end").value;
      if(climateStart&&climateEnd&&climateStart>climateEnd){toast("A data inicial deve ser anterior ou igual à final.");find("#wr-climate-start").focus();return;}
      const model=buildModel(work,orders,[...selected]);
      model.climate=filterClimate(model.climate,climateStart,climateEnd);
      preview.innerHTML=reportHTML(model);
      preview.hidden=false;filters.hidden=true;generate.hidden=true;back.hidden=false;print.hidden=false;
      find(".wr-scroll").scrollTop=0;
    };
    back.onclick=()=>{preview.hidden=true;filters.hidden=false;generate.hidden=false;back.hidden=true;print.hidden=true};
    print.onclick=()=>{
      const frame=document.createElement("iframe");frame.title="Impressão do relatório";frame.style.cssText="position:fixed;width:1px;height:1px;bottom:0;border:0";
      frame.onload=()=>{frame.contentWindow.focus();frame.contentWindow.print()};
      frame.srcdoc='<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Relatório da obra</title><style>'+printCSS+'</style><body>'+preview.innerHTML+'</body></html>';
      document.querySelector("#wr-print-frame")?.remove();frame.id="wr-print-frame";document.body.append(frame);
    };
    sync();find("[data-wr-close]").focus();
  }
  window.WorkReport={open,buildModel,reportHTML,costBreakdown,costHTML,climateHTML,climateFor,climateRange,filterClimate,temperatureColor,rainSummary,rainSummaryHTML};
})();
