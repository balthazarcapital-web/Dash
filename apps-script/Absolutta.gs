/**
 * ABSOLUTTA PEDIDOS v6.2 — Gestão de Obra detalhada + sincronização resiliente
 * Google Apps Script backend
 */
const ABS_CONFIG = {
  'Deterlimp': {
    spreadsheetId: '13Kmg41VDV8KUijPucj2TxCFdElFD6Vfb1WY4WwB7msU',
    responseSheet: 'Respostas ao formulário 1',
    itemsSheet: 'BASE ITENS PEDIDOS',
    quotationRootId: '1HJoLK0wSLnU5XopoukTj6aQ3fx5iXdHk',
    timestampHeader: 'Coluna 1',
    orderHeader: 'Numero do Pedido',
    costCenter: 'DETERLIMP'
  },
  'Carlos Bezerra': {
    spreadsheetId: '1PE6KUaEEshp2Kk1d9eExIFp53DzNTJST7mJc4pMZEuw',
    responseSheet: 'Respostas ao formulário 1',
    quotationRootId: '1qvdDub1O40VfLpMTTGlFoo22r1VzHgF6',
    timestampHeader: 'Carimbo de data/hora',
    orderHeader: 'Nº do Pedido',
    costCenter: 'CARLOS BEZERRA'
  },
  'CMFS / Dr. Clovis': {
    spreadsheetId: '1Myr3_i6bWDCI9dq--3x3ndH3QWqFfmdlKvE-YhRZ0lU',
    responseSheet: 'Respostas ao formulário 1',
    quotationRootId: '1hYLnDdPomkTDi-1vndhBA2CwMDginaAV',
    timestampHeader: 'Carimbo de data/hora',
    orderHeader: 'Nº do Pedido',
    costCenter: 'CMFS / DR. CLOVIS'
  },
  'Santa Gianna': {
    spreadsheetId: '1_LTDwN25pSKXfofahLgFiRGndb79cWNHxi8iR3v_VHM',
    responseSheet: 'Respostas ao formulário 1',
    quotationRootId: '1gUPtJBabhJ4b8S6dCXbiqADMEmb2gj3Y',
    timestampHeader: 'Carimbo de data/hora',
    orderHeader: 'Numero do Pedido',
    costCenter: 'SANTA GIANNA'
  }
};

// Front-end oficial + rota isolada do MVP Deterlimp.
const WEB_INDEX_FILE_ID = '1YLAnpsqwXoV3emYY_QMRekSd6vSxq-Ai';
const WEB_MVP_DETERLIMP_FILE_ID = '1h_cA_ox7FGlgDgEcOB0t41D8UrSse7Qy';

function doGet(e) {
  const mvp = e && e.parameter && normalize_(e.parameter.mvp) === 'deterlimp';
  const fileId = mvp ? WEB_MVP_DETERLIMP_FILE_ID : WEB_INDEX_FILE_ID;
  const html = DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8');
  return HtmlService.createHtmlOutput(html)
    .setTitle(mvp ? 'ABSOLUTTA • Deterlimp MVP' : 'ABSOLUTTA Pedidos')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getDashboardSnapshot(clientName) {
  const ctx = readClient_(clientName);
  return buildDashboardRows_(ctx.display, ctx.ix);
}



const ABS_BACKEND_VERSION = 'v6.2';
function getBackendHealth() {
  return {
    ok: true,
    version: ABS_BACKEND_VERSION,
    time: Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm:ss')
  };
}

const ABS_OCCURRENCE_TYPES = [
  'FALTA DE MATERIAL',
  'DIVERGÊNCIA',
  'TROCA DE MATERIAL',
  'DEVOLUÇÃO / NF DE DEVOLUÇÃO',
  'ENTREGA PARCIAL',
  'MATERIAL DANIFICADO',
  'RESOLVIDO',
  'OBSERVAÇÃO'
];

/** Registra histórico operacional sem alterar Status, Pagamento ou NF. */
function saveOrderOccurrence(clientName, rowNumber, payload) {
  const startedAt = Date.now();
  const cfg = ABS_CONFIG[clientName];
  if (!cfg) throw new Error('Cliente não configurado: ' + clientName);

  const row = Number(rowNumber || 0);
  const type = String(payload && payload.type || 'OBSERVAÇÃO').trim().toUpperCase();
  const text = String(payload && payload.text || '').trim();
  if (ABS_OCCURRENCE_TYPES.indexOf(type) < 0) throw new Error('Tipo de ocorrência inválido: ' + type);
  if (!text) throw new Error('Escreva uma informação antes de salvar.');

  const ss = SpreadsheetApp.openById(cfg.spreadsheetId);
  const main = ss.getSheetByName(cfg.responseSheet);
  if (!main) throw new Error('Aba não encontrada: ' + cfg.responseSheet);
  if (!Number.isInteger(row) || row < 2 || row > main.getMaxRows()) throw new Error('Linha do pedido inválida: ' + rowNumber);

  // Só lê o cabeçalho para localizar a coluna e grava uma única célula.
  let occurrenceCol = findHeaderColumn_(main, ['Ocorrências do Pedido','Ocorrencias do Pedido','Ocorrências']);
  if (!occurrenceCol) occurrenceCol = ensureOccurrenceColumn_(main);
  const cell = main.getRange(row, occurrenceCol);
  const previous = String(cell.getValue() || '').trim();
  const stamp = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm');
  const entry = stamp + ' • ' + type + ' — ' + text;
  const updated = previous ? previous + '\n' + entry : entry;

  // NÃO formata, NÃO chama flush, NÃO lê a planilha inteira.
  // Uma única escrita evita conflito com colunas de Table do Google Sheets.
  cell.setValue(updated);

  return {
    ok: true,
    backendVersion: ABS_BACKEND_VERSION,
    rowNumber: row,
    column: occurrenceCol,
    a1: cell.getA1Notation(),
    occurrences: updated,
    entry: entry,
    type: type,
    elapsedMs: Date.now() - startedAt
  };
}

/** Exclui somente um registro do histórico de ocorrências, sem alterar Status, NF ou Pagamento. */
function deleteOrderOccurrence(clientName, rowNumber, payload) {
  const startedAt = Date.now();
  const cfg = ABS_CONFIG[clientName];
  if (!cfg) throw new Error('Cliente não configurado: ' + clientName);

  const row = Number(rowNumber || 0);
  let index = Number(payload && payload.index);
  const expectedEntry = String(payload && payload.entry || '').trim();

  const ss = SpreadsheetApp.openById(cfg.spreadsheetId);
  const main = ss.getSheetByName(cfg.responseSheet);
  if (!main) throw new Error('Aba não encontrada: ' + cfg.responseSheet);
  if (!Number.isInteger(row) || row < 2 || row > main.getMaxRows()) throw new Error('Linha do pedido inválida: ' + rowNumber);

  const occurrenceCol = findHeaderColumn_(main, ['Ocorrências do Pedido','Ocorrencias do Pedido','Ocorrências']);
  if (!occurrenceCol) throw new Error('A coluna Ocorrências do Pedido não foi encontrada.');

  const cell = main.getRange(row, occurrenceCol);
  const lines = String(cell.getValue() || '').split(/\r?\n/).map(function(x){ return String(x || '').trim(); }).filter(Boolean);
  if (!lines.length) throw new Error('Não há ocorrência registrada para excluir.');

  if (!Number.isInteger(index) || index < 0 || index >= lines.length || (expectedEntry && lines[index] !== expectedEntry)) {
    if (!expectedEntry) throw new Error('Registro de ocorrência inválido. Atualize a gaveta e tente novamente.');
    const matches = [];
    for (let i = 0; i < lines.length; i++) if (lines[i] === expectedEntry) matches.push(i);
    if (matches.length !== 1) throw new Error('O histórico mudou desde que a gaveta foi aberta. Atualize o painel antes de excluir.');
    index = matches[0];
  }

  const removed = lines.splice(index, 1)[0];
  const updated = lines.join('\n');
  cell.setValue(updated);

  return {
    ok: true,
    backendVersion: ABS_BACKEND_VERSION,
    rowNumber: row,
    column: occurrenceCol,
    a1: cell.getA1Notation(),
    occurrences: updated,
    removed: removed,
    elapsedMs: Date.now() - startedAt
  };
}

function ensureOccurrenceColumn_(main) {
  const lastCol = Math.max(1, main.getLastColumn());
  const headers = main.getRange(1,1,1,lastCol).getDisplayValues()[0].map(String);
  for (let i=0;i<headers.length;i++) {
    if (normalize_(headers[i]) === normalize_('Ocorrências do Pedido')) return i + 1;
  }
  const col = lastCol + 1;
  if (col > main.getMaxColumns()) main.insertColumnAfter(main.getMaxColumns());
  const header = main.getRange(1,col), source = main.getRange(1,Math.max(1,col-1));
  source.copyTo(header, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  header.setValue('Ocorrências do Pedido').setWrap(true).setHorizontalAlignment('center').setFontWeight('bold');
  main.setColumnWidth(col,360);
  return col;
}


function findHeaderColumn_(main, names) {
  const lastCol = Math.max(1, main.getLastColumn());
  const headers = main.getRange(1,1,1,lastCol).getDisplayValues()[0].map(String);
  for (let n=0;n<names.length;n++) {
    const target = normalize_(names[n]);
    for (let i=0;i<headers.length;i++) if (normalize_(headers[i]) === target) return i + 1;
  }
  return 0;
}

function ensureTrackingDateColumn_(main, canonical, aliases) {
  const names = [canonical].concat(aliases || []);
  let col = findHeaderColumn_(main, names);
  if (col) return col;
  col = main.getLastColumn() + 1;
  if (col > main.getMaxColumns()) main.insertColumnAfter(main.getMaxColumns());
  const header = main.getRange(1,col), source = main.getRange(1,Math.max(1,col-1));
  source.copyTo(header, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  header.setValue(canonical).setWrap(true).setHorizontalAlignment('center').setFontWeight('bold');
  main.getRange(2,col,Math.max(1,main.getMaxRows()-1),1).setNumberFormat('dd/MM/yyyy');
  main.setColumnWidth(col,145);
  return col;
}

/** Marca ou limpa a data de envio de NF/boleto sem alterar Status ou Pagamento. */
function setDocumentSent(clientName, rowNumber, kind, sent) {
  const cfg = ABS_CONFIG[clientName];
  if (!cfg) throw new Error('Cliente não configurado: ' + clientName);
  const row = Number(rowNumber || 0);
  const ss = SpreadsheetApp.openById(cfg.spreadsheetId);
  const main = ss.getSheetByName(cfg.responseSheet);
  if (!main) throw new Error('Aba não encontrada: ' + cfg.responseSheet);
  if (!Number.isInteger(row) || row < 2 || row > main.getMaxRows()) throw new Error('Linha do pedido inválida: ' + rowNumber);

  const k = normalize_(kind).toUpperCase();
  let col = 0, field = '';
  if (k === 'NF') {
    field = 'Envio de NF';
    col = ensureTrackingDateColumn_(main, field, ['Data de Envio NF','NF Enviada']);
  } else if (k === 'BOLETO') {
    field = 'Envio de Boleto';
    col = ensureTrackingDateColumn_(main, field, ['Data de Envio boleto','Envio Boleto']);
  } else throw new Error('Documento inválido: ' + kind);

  const cell = main.getRange(row,col);
  if (sent === false) {
    cell.clearContent();
    SpreadsheetApp.flush();
    return {ok:true, kind:k, field:field, rowNumber:row, date:''};
  }
  const now = new Date();
  cell.setValue(now).setNumberFormat('dd/MM/yyyy');
  SpreadsheetApp.flush();
  return {ok:true, kind:k, field:field, rowNumber:row, date:Utilities.formatDate(now,'America/Sao_Paulo','dd/MM/yyyy')};
}

function cleanDocValue_(v) { return String(v == null ? '' : v).trim(); }
function documentValuePresent_(v) { const s=cleanDocValue_(v); return !!s && s !== '—' && s !== '-'; }
function invoiceExplicitMissing_(o) { return /falta\s*nf|solicitar\s*nf|^solicitar$|sem\s*nf/i.test(cleanDocValue_(o.invoice)); }
function hasInvoice_(o) {
  if (invoiceExplicitMissing_(o)) return false;
  return documentValuePresent_(o.invoice) || documentValuePresent_(o.invoiceFile);
}
function paymentIsClosedNoBoleto_(o) { return /pix|cart[aã]o|cancelado/i.test(normalize_(o.payment || o.finance || '')); }
function paymentIsPaid_(o) { return /^pago|quitado|liquidado/i.test(normalize_(o.payment || o.finance || '')); }
function paymentNeedsBoleto_(o) {
  if (paymentIsClosedNoBoleto_(o)) return false;
  const p = normalize_(o.payment || o.finance || '');
  return /falta pagar|faturado|boleto/.test(p) || documentValuePresent_(o.boletoFile) || documentValuePresent_(o.boletoDueDate) || documentValuePresent_(o.boletoSent);
}
function hasOpenOperationalOccurrence_(text) {
  const lines=String(text||'').split(/\n+/).map(function(x){return x.trim();}).filter(Boolean);
  const problem=/•\s*(FALTA DE MATERIAL|DIVERGÊNCIA|TROCA DE MATERIAL|DEVOLUÇÃO \/ NF DE DEVOLUÇÃO|ENTREGA PARCIAL|MATERIAL DANIFICADO)\s*—/i;
  const solved=/•\s*RESOLVIDO\s*—/i;
  for(let i=lines.length-1;i>=0;i--){ if(solved.test(lines[i])) return false; if(problem.test(lines[i])) return true; }
  return false;
}
function orderDocumentStage_(o) {
  const s=normalize_(o.status||'');
  if (/cotacao|aguardando aprov|solicitado/.test(s)) return false;
  return /documentacao pendente|recebido|entregue|faturado|concluido|finalizado|aprovado/.test(s) || Number(o.value||0)>0 || documentValuePresent_(o.deliveryDate);
}
function orderIsClosed_(o) { return /entregue|concluido|finalizado|cancelado/.test(normalize_(o.status||'')); }
function buildPendingState_(o) {
  const hasInvoice = hasInvoice_(o);
  const explicitNfMissing = invoiceExplicitMissing_(o);
  const stage = orderDocumentStage_(o);
  const closed = orderIsClosed_(o);
  const hasBoleto = documentValuePresent_(o.boletoFile);
  const boletoApplicable = paymentNeedsBoleto_(o);
  const issues=[];
  if (explicitNfMissing || (stage && !hasInvoice && documentValuePresent_(o.supplier) && !/nao informado/i.test(normalize_(o.supplier)))) {
    issues.push({key:'NF_MISSING',label:'Falta NF'});
  }
  // Para histórico antigo, ausência de data de envio não prova que o documento não foi enviado.
  // Só vira pendência ativa enquanto o pedido não estiver encerrado ou houver financeiro em aberto.
  if (hasInvoice && !documentValuePresent_(o.invoiceSent) && (!closed || /falta pagar|faturado|pendente/.test(normalize_(o.payment||o.finance||'')))) {
    issues.push({key:'NF_SEND',label:'Envio da NF não registrado'});
  }
  if (boletoApplicable) {
    if (!hasBoleto) issues.push({key:'BOLETO_MISSING',label:'Falta boleto/link anexado'});
    else if (!documentValuePresent_(o.boletoSent) && !paymentIsPaid_(o)) issues.push({key:'BOLETO_SEND',label:'Envio do boleto não registrado'});
  }
  if (paymentIsPaid_(o) && !documentValuePresent_(o.receipt)) issues.push({key:'RECEIPT_MISSING',label:'Falta comprovante'});
  if (hasOpenOperationalOccurrence_(o.occurrences)) issues.push({key:'OCCURRENCE',label:'Ocorrência operacional aberta'});
  return {
    hasInvoice:hasInvoice, explicitNfMissing:explicitNfMissing, invoiceSent:cleanDocValue_(o.invoiceSent),
    boletoApplicable:boletoApplicable, hasBoleto:hasBoleto, boletoSent:cleanDocValue_(o.boletoSent),
    paid:paymentIsPaid_(o), hasReceipt:documentValuePresent_(o.receipt), issues:issues
  };
}

function getPendingSnapshot(clientName) {
  const ctx=readClient_(clientName);
  const orders=buildFullOrderRows_(ctx.display);
  const rows=orders.map(function(o){ return {order:o,state:buildPendingState_(o)}; }).filter(function(x){ return x.state.issues.length; });
  return {clientName:clientName, generatedAt:now_(), rows:rows, summary:pendingSummary_(rows)};
}

function pendingSummary_(rows) {
  const s={orders:rows.length,nfMissing:0,nfSend:0,boletoMissing:0,boletoSend:0,receiptMissing:0,occurrence:0};
  rows.forEach(function(r){ (r.state.issues||[]).forEach(function(i){
    if(i.key==='NF_MISSING')s.nfMissing++; if(i.key==='NF_SEND')s.nfSend++; if(i.key==='BOLETO_MISSING')s.boletoMissing++;
    if(i.key==='BOLETO_SEND')s.boletoSend++; if(i.key==='RECEIPT_MISSING')s.receiptMissing++; if(i.key==='OCCURRENCE')s.occurrence++;
  }); });
  return s;
}

function pendingReportFolder_(cfg) {
  const source=DriveApp.getFileById(cfg.spreadsheetId), parents=source.getParents();
  const parent=parents.hasNext()?parents.next():DriveApp.getRootFolder();
  const found=parent.getFoldersByName('Relatórios de Pendências');
  return found.hasNext()?found.next():parent.createFolder('Relatórios de Pendências');
}
function shortReportText_(v, max) { const s=String(v||'').replace(/\s+/g,' ').trim(); return s.length>(max||80)?s.slice(0,(max||80)-1)+'…':s; }
function reportDocCell_(table,row,col,text,size,bold,color,bg) {
  const cell=table.getRow(row).getCell(col); cell.setText(String(text||'')); if(bg)cell.setBackgroundColor(bg);
  const t=cell.editAsText(); t.setFontFamily('Arial').setFontSize(size||8).setBold(Boolean(bold)); if(color)t.setForegroundColor(color);
  return cell;
}

/** Gera PDF profissional das pendências do cliente e arquiva ao lado da planilha oficial. */
function generatePendingReport(clientName) {
  const ctx=readClient_(clientName), orders=buildFullOrderRows_(ctx.display);
  const rows=orders.map(function(o){return {order:o,state:buildPendingState_(o)};}).filter(function(x){return x.state.issues.length;});
  const summary=pendingSummary_(rows), tz='America/Sao_Paulo', now=new Date();
  const stamp=Utilities.formatDate(now,tz,'dd-MM-yyyy_HHmm'), human=Utilities.formatDate(now,tz,'dd/MM/yyyy HH:mm');
  const safe=String(clientName||'Cliente').replace(/[^A-Za-zÀ-ÿ0-9_-]+/g,'_');
  const fileName='Relatorio_Pendencias_'+safe+'_'+stamp+'.pdf';
  const doc=DocumentApp.create('TEMP_'+fileName.replace(/\.pdf$/i,'')), body=doc.getBody();
  body.clear(); body.setPageWidth(842).setPageHeight(595).setMarginTop(28).setMarginBottom(28).setMarginLeft(30).setMarginRight(30);
  let p=body.appendParagraph('ABSOLUTTA ENGENHARIA'); p.setSpacingAfter(2); let tx=p.editAsText(); tx.setForegroundColor('#0F1D38').setFontFamily('Arial').setFontSize(9).setBold(true);
  p=body.appendParagraph('RELATÓRIO DE PENDÊNCIAS'); p.setSpacingAfter(2); tx=p.editAsText(); tx.setForegroundColor('#0F1D38').setFontFamily('Arial').setFontSize(22).setBold(true);
  p=body.appendParagraph(clientName+'  •  Gerado em '+human); p.setSpacingAfter(10); tx=p.editAsText(); tx.setForegroundColor('#66758C').setFontFamily('Arial').setFontSize(9);
  const sum=body.appendTable([
    ['PEDIDOS COM PENDÊNCIA',String(summary.orders),'FALTA NF',String(summary.nfMissing),'FALTA BOLETO/LINK',String(summary.boletoMissing)],
    ['ENVIO NF NÃO REG.',String(summary.nfSend),'ENVIO BOLETO NÃO REG.',String(summary.boletoSend),'FALTA COMPROVANTE',String(summary.receiptMissing)]
  ]);
  sum.setBorderColor('#DDE3EA').setBorderWidth(0.5);
  for(let r=0;r<2;r++)for(let c=0;c<6;c++){const cell=sum.getRow(r).getCell(c);cell.setBackgroundColor(c%2===0?'#F1F4F7':'#FFFFFF');const tx=cell.editAsText();tx.setFontFamily('Arial').setFontSize(c%2===0?7:12).setBold(c%2===1).setForegroundColor(c%2===0?'#66758C':'#0F1D38');}
  body.appendParagraph('').setSpacingAfter(2);
  if(!rows.length){
    p=body.appendParagraph('✓ Nenhuma pendência identificada pelos controles atuais da planilha.'); p.setSpacingBefore(12); tx=p.editAsText(); tx.setForegroundColor('#246B46').setFontFamily('Arial').setFontSize(12).setBold(true);
  } else {
    const data=[['PEDIDO / SOLICITAÇÃO','FORNECEDOR','STATUS OFICIAL','NOTA FISCAL','BOLETO / PAGAMENTO','PENDÊNCIAS']];
    rows.forEach(function(x){const o=x.order,st=x.state;
      const nf=st.hasInvoice?((o.invoice&&o.invoice!=='—'?'NF '+o.invoice:'NF anexada')+(o.invoiceDate?'\nEmissão '+o.invoiceDate:'')+(o.invoiceSent?'\nEnvio '+o.invoiceSent:'')):(st.explicitNfMissing?'Falta NF':'Não registrada');
      let bol='Não aplicável'; if(st.boletoApplicable)bol=(st.hasBoleto?'Boleto/link anexado':'Sem boleto/link')+(o.boletoDueDate?'\nVenc. '+o.boletoDueDate:'')+(o.boletoSent?'\nEnvio '+o.boletoSent:'')+(o.payment?'\n'+o.payment:'');
      data.push([(o.orderNumber?'Pedido '+o.orderNumber:'Registro '+o.rowNumber)+'\n'+shortReportText_(o.description,70),shortReportText_(o.supplier,35),o.status||'—',nf,bol,st.issues.map(function(i){return '• '+i.label;}).join('\n')]);
    });
    const table=body.appendTable(data); table.setBorderColor('#DDE3EA').setBorderWidth(0.5);
    for(let c=0;c<6;c++)reportDocCell_(table,0,c,data[0][c],7,true,'#FFFFFF','#0F1D38');
    for(let r=1;r<data.length;r++)for(let c=0;c<6;c++)reportDocCell_(table,r,c,data[r][c],7.2,c===0,'#26364F',r%2===0?'#F8FAFC':'#FFFFFF');
  }
  body.appendParagraph('').setSpacingAfter(1);
  p=body.appendParagraph('Critério: o relatório respeita o Status oficial da planilha e separa documento ausente de envio não registrado.'); tx=p.editAsText(); tx.setForegroundColor('#7A8798').setFontFamily('Arial').setFontSize(7).setItalic(true);
  doc.saveAndClose();
  const folder=pendingReportFolder_(ctx.cfg), temp=DriveApp.getFileById(doc.getId());
  const pdf=folder.createFile(temp.getAs(MimeType.PDF).setName(fileName)); temp.setTrashed(true);
  return {ok:true,url:pdf.getUrl(),fileId:pdf.getId(),fileName:fileName,count:summary.orders,summary:summary};
}

function runFullSync(clientName) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ctx = readClient_(clientName);
    const cfg = ctx.cfg, display = ctx.display, raw = ctx.raw, ix = ctx.ix;
    const props = PropertiesService.getScriptProperties();
    const key = 'ABS_LAST_ROW_' + normalize_(clientName).replace(/\s+/g,'_').toUpperCase();
    const lastNonEmpty = lastNonEmptyRow_(display);
    let saved = Number(props.getProperty(key) || 0);

    const result = {
      rowsChecked: countNonEmpty_(display),
      newRows: 0,
      foldersCreated: 0,
      filesCreated: 0,
      skipped: 0,
      conflicts: 0,
      errors: [],
      log: [],
      dashboardRows: buildDashboardRows_(display, ix),
      baselineInitialized: false
    };

    // Sempre reconcilia uma janela recente. Se o ponto de controle interno sumir
    // (por troca de versão, limpeza de propriedades ou outra falha), NÃO ignora o
    // pedido mais recente: entra em modo de recuperação e revisa as últimas linhas.
    const lookbackRows = 30;
    let scanStart;
    if (!saved) {
      saved = Math.max(1, lastNonEmpty - lookbackRows);
      props.setProperty(key, String(saved));
      result.baselineInitialized = true;
      scanStart = Math.max(2, saved + 1);
      result.log.push(`Ponto de controle de ${clientName} ausente; modo de recuperação ativado.`);
      result.log.push(`Revisando as últimas ${lookbackRows} linha(s) em vez de ignorar pedidos recentes.`);
    } else {
      // Algumas colunas (ex.: Nº do Pedido) podem ser preenchidas por fórmula
      // instantes depois da nova resposta do Forms. Reprocessar a janela recente
      // também corrige linhas que ficaram incompletas na primeira passagem.
      const firstNewRow = Math.max(2, saved + 1);
      scanStart = Math.max(2, Math.min(firstNewRow, lastNonEmpty) - lookbackRows);
    }

    const itemRows = ctx.items ? ctx.items.getDataRange().getDisplayValues() : [];
    const quotationRoot = DriveApp.getFolderById(cfg.quotationRootId);
    const duplicates = duplicateKeys_(display, ix);
    let hadHardError = false;

    result.recheckedRows = 0;
    result.pendingRows = 0;

    for (let sheetRow = scanStart; sheetRow <= lastNonEmpty; sheetRow++) {
      const r = sheetRow - 1; // array index
      const row = display[r];
      if (!row || isEmptyRow_(row)) continue;
      if (sheetRow > saved) result.newRows++;
      else result.recheckedRows++;

      const categoryRaw = cell_(row, ix.category);
      const orderRaw = cell_(row, ix.orderNumber);
      const sourceUrl = cell_(row, ix.requestFile);
      const description = cell_(row, ix.description);
      const requester = cell_(row, ix.requester);
      const needDate = cell_(row, ix.needDate);
      const statusLiteral = cell_(row, ix.status);
      const timestampValue = raw[r][ix.timestamp];

      if (!categoryRaw || !orderRaw) {
        result.skipped++;
        result.pendingRows++;
        result.log.push(`• Linha ${sheetRow}: aguardando Categoria + Nº Pedido; será revisada novamente nas próximas atualizações.`);
        continue;
      }

      const dupKey = normalize_(categoryRaw) + '|' + normalize_(orderRaw);
      if ((duplicates[dupKey] || []).length > 1) {
        result.conflicts++;
        result.log.push(`! Linha ${sheetRow}: chave repetida ${categoryRaw} / ${orderRaw}. Não arquivada automaticamente.`);
        continue;
      }

      try {
        const category = prettyCategory_(categoryRaw);
        const orderLabel = formatOrder_(orderRaw);
        const date = timestampValue instanceof Date ? timestampValue : parsePtDate_(cell_(row, ix.timestamp));
        const monthFolder = ensureMonthFolder_(quotationRoot, date, result);
        const folderName = `Pedido ${category} ${orderLabel}`;
        const orderFolder = ensureFolder_(monthFolder, folderName, result);

        const baseName = `01 - Pedido - ${category} ${orderLabel}`;
        if (sourceUrl) {
          const sourceId = extractDriveId_(sourceUrl);
          if (!sourceId) {
            result.conflicts++;
            result.log.push(`! ${folderName}: link do pedido não contém ID reconhecível.`);
            continue;
          }
          const sourceFile = DriveApp.getFileById(sourceId);
          if (looksLikeOfficialRequest_(sourceFile, category, orderRaw)) {
            const ext = extension_(sourceFile.getName());
            const targetName = `${baseName} - Absolutta Engenharia${ext ? '.' + ext : ''}`;
            if (!folderHasName_(orderFolder, targetName) && !folderHasBaseName_(orderFolder, baseName)) {
              sourceFile.makeCopy(targetName, orderFolder);
              result.filesCreated++;
              result.log.push(`✓ ${folderName}: pedido oficial arquivado.`);
            } else {
              result.skipped++;
              result.log.push(`• ${folderName}: pedido já arquivado.`);
            }
          } else {
            // O anexo existe, mas não é um pedido formal reconhecível. Preserva o anexo
            // e gera a Solicitação de Material padrão a partir da descrição/texto legível.
            archiveSourceAttachment_(sourceFile, orderFolder, category, orderLabel);
            let sourceText = '';
            try { sourceText = extractFileText_(sourceFile); } catch (e) { sourceText = ''; }
            if (!folderHasBaseName_(orderFolder, baseName)) {
              createOrderSpreadsheet_({
                orderFolder, targetName: baseName, category,
                orderRaw: String(orderRaw), orderLabel, description,
                requester, statusLiteral, date, itemRows, sourceText,
                needDate, clientName, costCenter: cfg.costCenter || clientName
              });
              result.filesCreated++;
              result.log.push(`✓ ${folderName}: pedido padrão criado a partir da descrição/anexo.`);
            } else {
              result.skipped++;
              result.log.push(`• ${folderName}: pedido padrão já existe.`);
            }
          }
        } else {
          if (!folderHasBaseName_(orderFolder, baseName)) {
            createOrderSpreadsheet_({
              orderFolder, targetName: baseName, category,
              orderRaw: String(orderRaw), orderLabel, description,
              requester, statusLiteral, date, itemRows, sourceText: '',
              needDate, clientName, costCenter: cfg.costCenter || clientName
            });
            result.filesCreated++;
            result.log.push(`✓ ${folderName}: pedido padrão criado.`);
          } else {
            result.skipped++;
            result.log.push(`• ${folderName}: arquivo de pedido já existe.`);
          }
        }
      } catch (err) {
        hadHardError = true;
        result.errors.push(`Linha ${sheetRow}: ${err.message || err}`);
        result.log.push(`✗ Linha ${sheetRow}: ${err.message || err}`);
      }
    }

    // Só avança a linha se não houve erro de execução.
    // Linhas incompletas não são perdidas: permanecem dentro da janela de lookback
    // e serão reconciliadas quando as fórmulas/campos terminarem de preencher.
    if (!hadHardError) props.setProperty(key, String(lastNonEmpty));
    else result.log.push('A linha de controle não avançou porque houve erro; a próxima execução tentará novamente.');

    result.finishedAt = now_();
    if (!result.newRows && !result.foldersCreated && !result.filesCreated) {
      result.log.push(`Nenhum pedido novo. ${result.recheckedRows} linha(s) recente(s) conferida(s).`);
    }
    result.log.unshift(`Sincronização concluída em ${result.finishedAt}.`);
    return result;
  } finally {
    lock.releaseLock();
  }
}

function resetSyncBaseline(clientName) {
  const key = 'ABS_LAST_ROW_' + normalize_(clientName).replace(/\s+/g,'_').toUpperCase();
  PropertiesService.getScriptProperties().deleteProperty(key);
  return true;
}

function readClient_(clientName) {
  const cfg = ABS_CONFIG[clientName];
  if (!cfg) throw new Error('Cliente não configurado: ' + clientName);
  const ss = SpreadsheetApp.openById(cfg.spreadsheetId);
  const main = ss.getSheetByName(cfg.responseSheet);
  if (!main) throw new Error('Aba não encontrada: ' + cfg.responseSheet);
  const range = main.getDataRange();
  const raw = range.getValues();
  const display = range.getDisplayValues();
  const ix = indexHeaders_(display[0].map(String), cfg);
  const items = cfg.itemsSheet ? ss.getSheetByName(cfg.itemsSheet) : null;
  return {cfg, ss, main, raw, display, ix, items};
}

function indexHeaders_(headers, cfg) {
  function exact(name, required=true) {
    const i = headers.findIndex(h => String(h).trim().toLowerCase() === String(name).trim().toLowerCase());
    if (i < 0 && required) throw new Error('Coluna obrigatória não encontrada: ' + name);
    return i;
  }
  function oneOf(names) {
    for (const name of names) {
      const i = exact(name, false);
      if (i >= 0) return i;
    }
    return -1;
  }
  return {
    timestamp: exact(cfg.timestampHeader),
    requester: exact('Solicitante'),
    description: exact('Descrição'),
    requestFile: exact('Arquivo'),
    category: exact('Categoria De Solicitação'),
    orderNumber: exact(cfg.orderHeader),
    status: exact('Status'),
    deliveryDate: oneOf(['Data da Entrega do Material','Data entrega','Entrega Prevista',' Entrega Prevista']),
    supplier: exact('Fornecedor'),
    invoice: exact('Nota Fiscal'),
    invoiceDate: exact('Emissão', false),
    invoiceFile: exact('Arquivo NF', false),
    boletoFile: oneOf(['Arquivo Boleto/ Link','Arquivo Boleto']),
    boletoDueDate: exact('Data de Vencimento Boleto', false),
    boletoDays: exact('Vencimento', false),
    boletoSent: oneOf(['Envio de Boleto','Data de Envio boleto']),
    invoiceSent: oneOf(['Envio de NF','Data de Envio NF','NF Enviada']),
    value: exact('Valor'),
    payment: exact('Pagamento'),
    receipt: exact('Comprovante', false),
    needDate: oneOf(['Previsão de Entrega','Entrega Prevista',' Entrega Prevista']),
    occurrences: oneOf(['Ocorrências do Pedido','Ocorrencias do Pedido','Ocorrências'])
  };
}

function duplicateKeys_(display, ix) {
  const m = {};
  for (let r=1;r<display.length;r++) {
    const row=display[r]; if (!row || isEmptyRow_(row)) continue;
    const c=cell_(row,ix.category), o=cell_(row,ix.orderNumber);
    if (!c || !o) continue;
    const k=normalize_(c)+'|'+normalize_(o);
    if (!m[k]) m[k] = [];
    m[k].push(r+1);
  }
  return m;
}

function buildDashboardRows_(display, ix) {
  const out=[];
  for (let r=1;r<display.length;r++) {
    const row=display[r]; if (!row || isEmptyRow_(row)) continue;
    // Número do pedido, timestamp ou valor isolados podem ser células técnicas/fórmulas.
    // Só entram no painel linhas com algum conteúdo operacional real.
    const hasOperationalData = [ix.requester, ix.description, ix.requestFile, ix.category, ix.status, ix.supplier, ix.invoice, ix.payment]
      .some(i => i >= 0 && String(row[i] == null ? '' : row[i]).trim() !== '');
    if (!hasOperationalData) continue;
    const categoryRaw=cell_(row,ix.category);
    const order=cell_(row,ix.orderNumber);
    const desc=cell_(row,ix.description);
    const statusRaw=cell_(row,ix.status);
    const supplierRaw=cell_(row,ix.supplier);
    const nfRaw=cell_(row,ix.invoice);
    const paymentRaw=cell_(row,ix.payment);
    // Não transforma linhas de total/linhas técnicas em pedidos do painel.
    if (!order && !desc && !categoryRaw && !statusRaw && !supplierRaw && !nfRaw && !paymentRaw) continue;
    const category=categoryRaw||'Sem categoria';
    const status=statusRaw||'Sem status informado';
    const supplier=supplierRaw||'Não informado';
    const nf=nfRaw||'—';
    const value=parseMoney_(cell_(row,ix.value));
    const payment=paymentRaw||'—';
    out.push({
      id:'row-'+(r+1),
      rowNumber:r+1,
      orderNumber:order,
      description:desc,
      requestFile:cell_(row,ix.requestFile),
      requester:cell_(row,ix.requester),
      timestamp:cell_(row,ix.timestamp),
      name: order ? `Pedido ${order}${desc?' • '+shorten_(desc,62):''}` : (desc?shorten_(desc,70):`Registro ${r+1}`),
      category,status,supplier,nf,value,finance:payment,
      deliveryDate:cell_(row,ix.deliveryDate),
      invoiceDate:cell_(row,ix.invoiceDate),
      invoiceFile:cell_(row,ix.invoiceFile),
      boletoFile:cell_(row,ix.boletoFile),
      boletoDueDate:cell_(row,ix.boletoDueDate),
      boletoDays:cell_(row,ix.boletoDays),
      boletoSent:cell_(row,ix.boletoSent),
      invoiceSent:cell_(row,ix.invoiceSent),
      receipt:cell_(row,ix.receipt),
      occurrences:cell_(row,ix.occurrences)
    });
  }
  return out;
}

function ensureMonthFolder_(root,date,result) {
  const d=date||new Date(),tz='America/Sao_Paulo',month=Number(Utilities.formatDate(d,tz,'M')),year=Utilities.formatDate(d,tz,'yyyy');
  const names=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  return ensureFolder_(root,`${names[month-1]} - ${year}`,result);
}
function ensureFolder_(parent,name,result){
  const exact=parent.getFoldersByName(name);
  if(exact.hasNext()) return exact.next();

  // Compatibilidade com pastas antigas que variam apenas em caixa/acentos
  // (ex.: "Pedido CIVIL 27" x "Pedido Civil 27").
  const target=normalize_(name);
  const folders=parent.getFolders();
  while(folders.hasNext()){
    const existing=folders.next();
    if(normalize_(existing.getName())===target) return existing;
  }

  const f=parent.createFolder(name);
  result.foldersCreated++;
  result.log.push(`✓ Pasta criada: ${name}`);
  return f;
}
function createOrderSpreadsheet_(p){
  const templateId = ABS_TEMPLATES.requestOrderId;
  if(!templateId) throw new Error('Modelo mestre de Solicitação de Material não configurado.');
  const file = DriveApp.getFileById(templateId).makeCopy(p.targetName, p.orderFolder);
  const ss = SpreadsheetApp.openById(file.getId());
  const first = ss.getSheets()[0];
  first.setName('SOLICITACAO');

  const items = autoRequestItems_(p);
  const chunks = [];
  for(let i=0;i<Math.max(items.length,1);i+=6) chunks.push(items.slice(i,i+6));
  if(!chunks.length) chunks.push([]);

  fillRequestTemplateSheet_(first,p,chunks[0],1,chunks.length);
  for(let n=1;n<chunks.length;n++){
    const sh = first.copyTo(ss).setName('SOLICITACAO '+(n+1));
    fillRequestTemplateSheet_(sh,p,chunks[n],n+1,chunks.length);
  }
  SpreadsheetApp.flush();
  return file;
}
function fillRequestTemplateSheet_(sh,p,items,page,totalPages){
  const tz='America/Sao_Paulo';
  const orderNo = String(p.orderRaw||p.orderLabel||'').replace(/^0+(?=\d)/,'');
  const dateText = p.date ? Utilities.formatDate(p.date,tz,'dd/MM/yyyy') : '';
  sh.getRange('F1').setValue('N°: '+orderNo);
  sh.getRange('F2').setValue('DATA: '+dateText);
  sh.getRange('A4').setValue('AREA DE SOLICITACAO: '+String(p.category||'').toUpperCase());

  // Mantém os números 1-6 do modelo; limpa somente os campos variáveis.
  sh.getRange('B6:F11').clearContent();
  for(let i=0;i<6;i++) sh.getRange(6+i,1).setValue((page-1)*6+i+1);
  for(let i=0;i<Math.min(items.length,6);i++){
    const it=items[i]||{};
    sh.getRange(6+i,2,1,5).setValues([[
      it.qty||'',
      String(it.unit||'').toUpperCase(),
      String(it.description||'').toUpperCase(),
      it.nickname||'',
      it.needDate||p.needDate||''
    ]]);
  }

  const obs = autoRequestObservations_(items,p,page,totalPages);
  sh.getRange('C14').setValue(obs);
  sh.getRange('A15').setValue('CENTRO DE CUSTO: '+String(p.costCenter||p.clientName||'').toUpperCase());
  sh.getRange('A22').setValue(String(p.requester||'').toUpperCase());
  sh.getRange('E22').setValue('');
}
function autoRequestItems_(p){
  const out=[];
  if(p.itemRows&&p.itemRows.length>1){
    for(let i=1;i<p.itemRows.length;i++){
      const r=p.itemRows[i];
      if(normalize_(r[0])===normalize_(p.category)&&normalize_(r[1])===normalize_(p.orderRaw)){
        out.push({
          qty:String(r[6]||''), unit:String(r[7]||''), description:String(r[8]||''),
          nickname:'', needDate:String(r[9]||p.needDate||''), observation:String(r[10]||'')
        });
      }
    }
  }
  if(out.length) return out;

  const combined=[];
  const descItems=parseAutoRequestText_(p.description||'');
  for(let i=0;i<descItems.length;i++) combined.push(descItems[i]);
  if(p.sourceText){
    const fileItems=parseAutoRequestText_(p.sourceText);
    for(let i=0;i<fileItems.length;i++){
      const key=normalize_((fileItems[i].qty||'')+' '+(fileItems[i].unit||'')+' '+(fileItems[i].description||''));
      if(!combined.some(function(x){return normalize_((x.qty||'')+' '+(x.unit||'')+' '+(x.description||''))===key})) combined.push(fileItems[i]);
    }
  }
  if(!combined.length && p.description) combined.push({qty:'',unit:'',description:p.description,needDate:p.needDate||'',observation:''});
  combined.forEach(function(x){if(!x.needDate)x.needDate=p.needDate||''});
  return combined;
}
function parseAutoRequestText_(text){
  const raw=String(text||'').split(/\r?\n/).map(function(x){return x.replace(/[\t;]+/g,' ').replace(/\s+/g,' ').trim()}).filter(Boolean);
  const out=[];
  const units='UN|UND|UNIDADE|UNIDADES|PC|PÇ|PECA|PECAS|BR|BARRA|BARRAS|ML|M|METRO|METROS|M2|M²|M3|M³|KG|SC|SACO|SACOS|RL|ROLO|ROLOS|PCT|PACOTE|PACOTES|GL|GALAO|GALOES|LTS|LT|LITRO|LITROS|CX|CAIXA|CAIXAS|JG|JOGO|JOGOS';
  for(let i=0;i<raw.length;i++){
    const line=raw[i];
    // Ignora cabeçalhos típicos quando o anexo é uma planilha/texto exportado.
    const n=normalize_(line);
    if(n==='item quantidade unidade descricao dos materiais apelido data da necessidade' || n.indexOf('solicitacao de material')>=0 || n.indexOf('area de solicitacao')===0 || n.indexOf('centro de custo')===0 || n.indexOf('observacoes')===0) continue;
    let m=line.match(new RegExp('^(?:\\d+\\s+)?(\\d+(?:[.,]\\d+)?)\\s+('+units+')\\s+(.+)$','i'));
    if(m){out.push({qty:m[1],unit:normalizeAutoUnit_(m[2]),description:cleanAutoDescription_(m[3]),needDate:'',observation:''});continue;}
    m=line.match(new RegExp('^(.+?)\\s+(\\d+(?:[.,]\\d+)?)\\s+('+units+')$','i'));
    if(m){out.push({qty:m[2],unit:normalizeAutoUnit_(m[3]),description:cleanAutoDescription_(m[1]),needDate:'',observation:''});continue;}
    // Linha simples: preserva como descrição somente quando parece item/material.
    if(line.length>=3 && !/^n[°ºo]?\s*[:\-]?\s*\d+/i.test(line) && !/^data\s*:/i.test(line) && !/^solicitad[oa]\s+por/i.test(line) && !/^autorizad[oa]\s+por/i.test(line)){
      out.push({qty:'',unit:'',description:line,needDate:'',observation:''});
    }
  }
  return out.slice(0,60);
}
function cleanAutoDescription_(s){return String(s||'').replace(/^(?:de|do|da|dos|das)\s+/i,'').trim()}
function normalizeAutoUnit_(u){
  const n=normalize_(u);
  const map={un:'UN',und:'UN',unidade:'UN',unidades:'UN',pc:'PC','pca':'PC',peca:'PC',pecas:'PC',br:'BR',barra:'BR',barras:'BR',ml:'ML',m:'M',metro:'METROS',metros:'METROS',m2:'M²',m3:'M³',kg:'KG',sc:'SC',saco:'SC',sacos:'SC',rl:'RL',rolo:'RL',rolos:'RL',pct:'PCT',pacote:'PCT',pacotes:'PCT',gl:'GL',galao:'GL',galoes:'GL',lts:'LT',lt:'LT',litro:'LT',litros:'LT',cx:'CX',caixa:'CX',caixas:'CX',jg:'JG',jogo:'JG',jogos:'JG'};
  return map[n]||String(u||'').toUpperCase();
}
function autoRequestObservations_(items,p,page,totalPages){
  const notes=[];
  (items||[]).forEach(function(x){if(x.observation&&notes.indexOf(x.observation)<0)notes.push(x.observation)});
  if(totalPages>1) notes.push('PÁGINA '+page+' DE '+totalPages+'.');
  return notes.join(' | ');
}
function looksLikeOfficialRequest_(file,category,orderRaw){
  const n=normalize_(file.getName());
  if(n.indexOf('pedido')>=0 || n.indexOf('solicitacao de material')>=0) return true;
  try{
    const text=extractFileText_(file),t=normalize_(text);
    const order=String(orderRaw||'').replace(/^0+(?=\d)/,'');
    const hasForm=t.indexOf('solicitacao de material')>=0;
    const hasCategory=!category || t.indexOf(normalize_(category))>=0;
    const hasOrder=!order || new RegExp('(?:^|\\s)0*'+order+'(?:\\s|$)').test(t);
    return hasForm && hasCategory && hasOrder;
  }catch(e){return false;}
}
function archiveSourceAttachment_(sourceFile,orderFolder,category,orderLabel){
  const ext=extension_(sourceFile.getName());
  const name=`00 - Anexo de origem - ${category} ${orderLabel}${ext?'.'+ext:''}`;
  if(!folderHasName_(orderFolder,name)) sourceFile.makeCopy(name,orderFolder);
}
function folderHasName_(folder,name){return folder.getFilesByName(name).hasNext()}
function folderHasBaseName_(folder,base){const f=folder.getFiles();while(f.hasNext()){if(normalize_(f.next().getName()).indexOf(normalize_(base))===0)return true}return false}
function cell_(row,idx){return idx>=0?String(row[idx]==null?'':row[idx]).trim():''}
function isEmptyRow_(row){return row.every(v=>String(v==null?'':v).trim()==='')}
function countNonEmpty_(display){let n=0;for(let r=1;r<display.length;r++)if(display[r]&&!isEmptyRow_(display[r]))n++;return n}
function lastNonEmptyRow_(display){for(let r=display.length-1;r>=1;r--)if(display[r]&&!isEmptyRow_(display[r]))return r+1;return 1}
function normalize_(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
function prettyCategory_(s){const n=normalize_(s);if(n==='hidraulica')return'Hidráulica';if(n==='eletrica')return'Elétrica';if(n==='civil'||n==='civel')return'Civil';if(n==='locacao')return'Locação';if(n==='servicos')return'Serviços';return String(s||'').trim()}
function formatOrder_(v){const s=String(v||'').trim();return /^\d+$/.test(s)?String(Number(s)).padStart(2,'0'):s}
function extractDriveId_(u){const m=String(u||'').match(/[-\w]{25,}/);return m?m[0]:''}
function extension_(n){const m=String(n||'').match(/\.([A-Za-z0-9]{1,8})$/);return m?m[1]:''}
function parseMoney_(s){const x=String(s||'').replace(/[^\d,.-]/g,'').replace(/\./g,'').replace(',','.');const n=Number(x);return Number.isFinite(n)?n:0}
function parsePtDate_(s){const m=String(s||'').match(/(\d{2})\/(\d{2})\/(\d{4})/);return m?new Date(Number(m[3]),Number(m[2])-1,Number(m[1])):new Date()}
function shorten_(s,n){const t=String(s||'').trim();return t.length>n?t.slice(0,n-1)+'…':t}
function now_(){return Utilities.formatDate(new Date(),'America/Sao_Paulo','dd/MM/yyyy HH:mm')}


/* =========================
 * ABSOLUTTA PEDIDOS v11
 * Cotação -> Mapa -> O.C.
 * ========================= */
const ABS_TEMPLATES = {
  requestOrderId: '1eJkw8ltGCyCQmBTWB9fnwy2i27Tg8BrYDzWYaF4iApQ',
  quotationMapId: '1rAePqgsqWbvT1Ypmx93TVrJfZcZ6zjkTRUZijtIvMQE',
  purchaseOrderId: '1LckCPk5nIUg3UNC7lrCoVOdTB3TF3SzCIFXFPiRm3r4'
};
const ABS_CLIENT_PROFILE = {
  'Deterlimp': {
    legalName:'DETERLIMP INDUSTRIAL LIMPEZA E COSMETICO LTDA',
    address:'Avenida das Cerejeiras, 619 - Capela Velha - Araucária/PR - CEP: 83705-340',
    delivery:'Avenida das Cerejeiras, 619 - Capela Velha\nAraucária - PR\nCEP: 83705-340',
    cnpj:'01.300.954/0001-82', phone:'(41) 3643-1920'
  },
  'Carlos Bezerra': {legalName:'Carlos Bezerra',address:'Dados cadastrais a confirmar',delivery:'A confirmar',cnpj:'A confirmar',phone:''},
  'CMFS / Dr. Clovis': {legalName:'CMFS / Dr. Clovis',address:'Dados cadastrais a confirmar',delivery:'A confirmar',cnpj:'A confirmar',phone:''},
  'Santa Gianna': {legalName:'Santa Gianna',address:'Dados cadastrais a confirmar',delivery:'A confirmar',cnpj:'A confirmar',phone:''}
};

function getBackendInfo(){return {version:'11',quotation:true,mapTemplate:ABS_TEMPLATES.quotationMapId,ocTemplate:ABS_TEMPLATES.purchaseOrderId};}

function getQuotationWorkspace(clientName, orderRef, force) {
  const ctx=readClient_(clientName), order=resolveOrder_(ctx,orderRef||{});
  const folder=findOrCreateOrderFolder_(ctx,order);
  const files=listOrderFiles_(folder,order);
  const requestFile=findRequestFile_(files,order);
  const itemPack=loadOrderItems_(ctx,order,requestFile,clientName);
  const warnings=[];
  if(!requestFile)warnings.push('Arquivo oficial do pedido não foi localizado na pasta; os itens dependem da base estruturada/descrição da planilha.');
  if(itemPack.warning)warnings.push(itemPack.warning);
  if(!files.some(function(f){return f.role==='quote';}))warnings.push('Nenhum arquivo de orçamento foi localizado na pasta do pedido.');
  return {
    orderRef:{rowNumber:order.sheetRow,orderNumber:order.orderNumber,category:order.category,name:order.name,status:order.status},
    folderId:folder.getId(),folderName:folder.getName(),folderUrl:folder.getUrl(),
    files:files,items:itemPack.items,itemSource:itemPack.source,warnings:warnings
  };
}

function analyzeQuotationFiles(clientName, orderRef) {
  const workspace=getQuotationWorkspace(clientName,orderRef,false);
  const folder=DriveApp.getFolderById(workspace.folderId);
  const suppliers=[],warnings=[];
  const files=workspace.files.filter(function(f){return f.role==='quote';});
  for(let i=0;i<files.length;i++){
    try{
      const file=DriveApp.getFileById(files[i].id);
      const text=extractFileText_(file);
      const supplier=parseSupplierQuotation_(workspace.items,text,file.getName(),file.getUrl());
      suppliers.push(supplier);
    }catch(err){warnings.push('Não foi possível ler '+files[i].name+': '+(err.message||err));}
  }
  if(!suppliers.length)warnings.push('Nenhum orçamento foi interpretado automaticamente. É possível adicionar uma cotação por texto/WhatsApp abaixo.');
  return {workspace:workspace,suppliers:suppliers,warnings:warnings};
}

function analyzeWrittenQuotation(clientName, orderRef, supplierName, text) {
  const workspace=getQuotationWorkspace(clientName,orderRef,false);
  const s=parseSupplierQuotation_(workspace.items,String(text||''),'Cotação escrita - '+supplierName,'');
  s.name=String(supplierName||'Fornecedor').trim();s.fileName='Cotação escrita / WhatsApp';s.fileUrl='';return s;
}

function generateOrUpdateQuotationMap(clientName, orderRef, analysis) {
  if(!analysis || !analysis.workspace)throw new Error('Leitura/revisão da cotação não foi enviada.');
  const ctx=readClient_(clientName), order=resolveOrder_(ctx,orderRef||{}), folder=findOrCreateOrderFolder_(ctx,order);
  const suppliers=analysis.suppliers||[],items=analysis.workspace.items||[];
  if(!suppliers.length)throw new Error('Nenhum fornecedor disponível para o mapa.');
  const name='03 - Mapa de Cotação - '+prettyCategory_(order.category)+' '+formatOrder_(order.orderNumber);
  let file=findFileByPrefix_(folder,'03 - Mapa de Cotação');
  if(!file)file=DriveApp.getFileById(ABS_TEMPLATES.quotationMapId).makeCopy(name,folder);else file.setName(name);
  const ss=SpreadsheetApp.openById(file.getId()),sh=ss.getSheetByName('Pedido')||ss.getSheets()[0];
  prepareMapSupplierColumns_(sh,suppliers.length);
  prepareMapItemRows_(sh,items.length);
  fillQuotationMap_(sh,clientName,order,items,suppliers);
  writeMapObservations_(ss,analysis);
  SpreadsheetApp.flush();
  return {id:file.getId(),name:file.getName(),url:file.getUrl(),supplierCount:suppliers.length,itemCount:items.length};
}

function generatePurchaseOrder(clientName, orderRef, analysis, approval) {
  if(!analysis || !analysis.workspace)throw new Error('Mapa/análise não disponível.');
  approval=approval||{};
  const idx=Number(approval.supplierIndex),supplier=(analysis.suppliers||[])[idx];
  if(!supplier)throw new Error('Fornecedor aprovado não encontrado.');
  const approved=approval.approvedIndexes||[];
  if(!approved.length)throw new Error('Nenhum item foi aprovado para a O.C.');
  const ctx=readClient_(clientName),order=resolveOrder_(ctx,orderRef||{}),folder=findOrCreateOrderFolder_(ctx,order),items=analysis.workspace.items||[];
  const lines=[];
  for(let i=0;i<approved.length;i++){
    const itemIndex=Number(approved[i]),item=items[itemIndex],m=(supplier.matches||[])[itemIndex]||{};
    if(!item || !(Number(m.totalPrice)>0))continue;
    lines.push({item:item,match:m});
  }
  if(!lines.length)throw new Error('Os itens aprovados não possuem preço confirmado para o fornecedor selecionado.');
  const includeFreight=!!approval.includeFreight && Number(supplier.freight)>0;
  const fileName='04 - Ordem de Compra - '+prettyCategory_(order.category)+' '+formatOrder_(order.orderNumber)+' - '+safeName_(supplier.name);
  let file=findFileByPrefix_(folder,fileName);
  if(!file)file=DriveApp.getFileById(ABS_TEMPLATES.purchaseOrderId).makeCopy(fileName,folder);else file.setName(fileName);
  const ss=SpreadsheetApp.openById(file.getId()),sh=ss.getSheetByName('Ordem de Compra')||ss.getSheets()[0];
  fillPurchaseOrder_(sh,clientName,order,supplier,lines,includeFreight);
  SpreadsheetApp.flush();
  return {id:file.getId(),name:file.getName(),url:file.getUrl(),supplier:supplier.name,approvedItems:lines.length,total:lines.reduce(function(a,x){return a+Number(x.match.totalPrice||0)},0)+(includeFreight?Number(supplier.freight||0):0)};
}

function resolveOrder_(ctx,ref){
  ref=ref||{};
  let sheetRow=Number(ref.rowNumber||0),matches=[];
  let refOrder=String(ref.orderNumber||'').trim();
  let refCategory=String(ref.category||'').trim();

  // Compatibilidade com registros antigos do frontend, ex.: "Hidráulica 05".
  if(!refOrder && ref.name){
    const fromName=extractOrderNumberFromLabel_(ref.name);
    if(fromName)refOrder=fromName;
  }
  if(!refCategory && ref.name){
    const fromNameCat=extractCategoryFromLabel_(ref.name);
    if(fromNameCat)refCategory=fromNameCat;
  }

  // rowNumber é a chave mais forte, mas só é aceito se realmente apontar
  // para o mesmo pedido/categoria quando esses dados vierem do frontend.
  if(sheetRow>=2 && sheetRow<=ctx.display.length && ctx.display[sheetRow-1] && !isEmptyRow_(ctx.display[sheetRow-1])){
    const rr=ctx.display[sheetRow-1];
    const rowOrder=cell_(rr,ctx.ix.orderNumber);
    const rowCat=cell_(rr,ctx.ix.category);
    const orderOk=!refOrder || sameOrderNumber_(rowOrder,refOrder);
    const catOk=!refCategory || normalize_(rowCat)===normalize_(refCategory);
    if(orderOk && catOk)matches=[sheetRow];
  }

  if(!matches.length && refOrder){
    for(let r=1;r<ctx.display.length;r++){
      const row=ctx.display[r];if(!row||isEmptyRow_(row))continue;
      const rowOrder=cell_(row,ctx.ix.orderNumber);
      const rowCat=cell_(row,ctx.ix.category);
      if(sameOrderNumber_(rowOrder,refOrder) && (!refCategory || normalize_(rowCat)===normalize_(refCategory)))matches.push(r+1);
    }
  }

  if(!matches.length)throw new Error('Pedido não localizado na planilha oficial. Referência recebida: '+(refCategory||'sem categoria')+' / '+(refOrder||ref.name||'sem número')+'.');
  if(matches.length>1)throw new Error('Há mais de um pedido com a mesma chave Categoria + Número. Selecione a linha correta antes de continuar.');

  sheetRow=matches[0];const row=ctx.display[sheetRow-1];
  const orderNumber=cell_(row,ctx.ix.orderNumber),category=cell_(row,ctx.ix.category),desc=cell_(row,ctx.ix.description),status=cell_(row,ctx.ix.status)||'Sem status informado';
  return {sheetRow:sheetRow,orderNumber:orderNumber,category:category,description:desc,status:status,requestFile:cell_(row,ctx.ix.requestFile),requester:cell_(row,ctx.ix.requester),timestamp:cell_(row,ctx.ix.timestamp),name:'Pedido '+orderNumber+(desc?' • '+shorten_(desc,62):'')};
}

function sameOrderNumber_(a,b){
  const sa=String(a==null?'':a).trim(), sb=String(b==null?'':b).trim();
  if(!sa || !sb)return false;
  if(/^\d+$/.test(sa) && /^\d+$/.test(sb))return Number(sa)===Number(sb);
  return normalize_(sa)===normalize_(sb);
}

function extractOrderNumberFromLabel_(label){
  const s=String(label||'').trim();
  let m=s.match(/\bPedido\s+0*(\d+)\b/i);
  if(m)return m[1];
  m=s.match(/(?:^|\s)0*(\d+)\s*(?:•|$)/);
  if(m)return m[1];
  m=s.match(/0*(\d+)\s*$/);
  return m?m[1]:'';
}

function extractCategoryFromLabel_(label){
  const s=String(label||'').trim();
  if(/^Pedido\s+/i.test(s))return '';
  const m=s.match(/^(.+?)\s+0*\d+\s*(?:•|$)/);
  return m?m[1].trim():'';
}

function findOrCreateOrderFolder_(ctx,order){
  const root=DriveApp.getFolderById(ctx.cfg.quotationRootId),expected=normalize_('Pedido '+prettyCategory_(order.category)+' '+formatOrder_(order.orderNumber));
  let exact=[],fallback=[];scanFolders_(root,2,function(f){const n=normalize_(f.getName());if(n===expected)exact.push(f);else if(hasOrderToken_(n,order.orderNumber) && (n.indexOf(normalize_(order.category))>=0 || normalize_(order.category)==='civil'))fallback.push(f)});
  if(exact.length===1)return exact[0];if(exact.length>1)throw new Error('Mais de uma pasta exata encontrada para o pedido.');if(fallback.length===1)return fallback[0];if(fallback.length>1)throw new Error('Mais de uma pasta possível encontrada para o pedido; não vou escolher automaticamente.');
  const date=parsePtDate_(order.timestamp),month=ensureMonthFolder_(root,date,{foldersCreated:0,log:[]});return month.createFolder('Pedido '+prettyCategory_(order.category)+' '+formatOrder_(order.orderNumber));
}
function scanFolders_(folder,depth,cb){if(depth<1)return;const it=folder.getFolders();while(it.hasNext()){const f=it.next();cb(f);scanFolders_(f,depth-1,cb)}}
function hasOrderToken_(name,num){const n=normalize_(num);return (' '+name+' ').indexOf(' '+n+' ')>=0 || name.endsWith(' '+n)}

function listOrderFiles_(folder,order){const out=[],it=folder.getFiles();while(it.hasNext()){const f=it.next(),name=f.getName(),role=classifyOrderFile_(name,f.getId(),order);out.push({id:f.getId(),name:name,url:f.getUrl(),mimeType:f.getMimeType(),role:role,roleLabel:role==='request'?'Pedido oficial':role==='quote'?'Orçamento fornecedor':role==='map'?'Mapa de cotação':role==='oc'?'Ordem de compra':'Arquivo'})}return out}
function classifyOrderFile_(name,id,order){const n=normalize_(name);if(n.indexOf('03 mapa de cotacao')===0||n.indexOf('mapa de cotacao')>=0)return'map';if(n.indexOf('04 ordem de compra')===0||n.indexOf('ordem de compra')>=0)return'oc';const reqId=extractDriveId_(order.requestFile||'');if(id===reqId||n.indexOf('01 pedido')===0)return'request';if(n.indexOf('orcamento')>=0||n.indexOf('02 ')===0||n.indexOf('cotacao fornecedor')>=0)return'quote';return'quote'}
function findRequestFile_(files,order){let f=files.find(function(x){return x.role==='request'});if(f)return f;const id=extractDriveId_(order.requestFile||'');if(id){try{const df=DriveApp.getFileById(id);return{id:df.getId(),name:df.getName(),url:df.getUrl(),mimeType:df.getMimeType(),role:'request',roleLabel:'Pedido oficial'}}catch(e){}}return null}

function loadOrderItems_(ctx,order,requestFile,clientName){
  if(ctx.items){const values=ctx.items.getDataRange().getDisplayValues(),h=(values[0]||[]).map(function(x){return normalize_(x)}),ci=h.indexOf('categoria'),oi=h.indexOf('n pedido'),ii=h.indexOf('item'),qi=h.indexOf('quantidade'),ui=h.indexOf('unidade'),di=h.indexOf('descricao do material'),ob=h.indexOf('observacoes');const found=[];for(let r=1;r<values.length;r++){const row=values[r];if(normalize_(row[ci])===normalize_(order.category)&&normalize_(row[oi])===normalize_(order.orderNumber))found.push({item:String(row[ii]||found.length+1),qty:String(row[qi]||''),unit:String(row[ui]||''),description:String(row[di]||''),observations:String(row[ob]||''),sourceLabel:'BASE ITENS PEDIDOS'})}if(found.length)return{items:found,source:'BASE ITENS PEDIDOS'}}
  if(requestFile){try{const rf=DriveApp.getFileById(requestFile.id),structured=structuredItemsFromFile_(rf,order);if(structured.length)return{items:structured,source:'Arquivo do pedido'};const text=extractFileText_(rf);if(!validateRequestText_(text,clientName,order))return{items:[{item:'1',qty:'',unit:'',description:order.description||'Descrição não informada',observations:'',sourceLabel:'Descrição da planilha'}],source:'Descrição da planilha',warning:'O arquivo anexado não confirmou com segurança o pedido/categoria/descrição. Ele NÃO foi adotado como pedido oficial.'};const parsed=parseRequestItemsFromText_(text);if(parsed.length)return{items:parsed,source:'Leitura do arquivo do pedido',warning:'Itens obtidos por leitura automática de um arquivo validado; revise descrições e quantidades antes do mapa.'}}catch(e){}}
  return{items:[{item:'1',qty:'',unit:'',description:order.description||'Descrição não informada',observations:'',sourceLabel:'Descrição da planilha'}],source:'Descrição da planilha',warning:'Não há base estruturada de itens para este pedido; a descrição da planilha foi usada como referência e deve ser revisada.'};
}
function structuredItemsFromFile_(file,order){if(file.getMimeType()!=='application/vnd.google-apps.spreadsheet')return[];const ss=SpreadsheetApp.openById(file.getId()),sh=ss.getSheets()[0],v=sh.getDataRange().getDisplayValues(),out=[];let catOk=false,orderOk=false;for(let r=0;r<Math.min(v.length,15);r++){if(normalize_(v[r][0])==='categoria'&&normalize_(v[r][1])===normalize_(order.category))catOk=true;if((normalize_(v[r][0])==='n pedido'||normalize_(v[r][0])==='numero do pedido')&&normalize_(v[r][1])===normalize_(order.orderNumber))orderOk=true}if(!(catOk&&orderOk))return[];for(let r=0;r<v.length;r++){if(normalize_(v[r][0])==='item'&&normalize_(v[r][1])==='quantidade'){for(let j=r+1;j<v.length;j++){if(!v[j][0]&&!v[j][3])break;out.push({item:String(v[j][0]||out.length+1),qty:String(v[j][1]||''),unit:String(v[j][2]||''),description:String(v[j][3]||''),observations:String(v[j][5]||''),sourceLabel:'Planilha do pedido'})}break}}return out}
function validateRequestText_(text,clientName,order){const n=normalize_(text),descTokens=itemTokens_(order.description||'').slice(0,6);let score=0;if(clientName&&n.indexOf(normalize_(clientName))>=0)score++;if(order.category&&n.indexOf(normalize_(order.category))>=0)score++;let common=0;for(let i=0;i<descTokens.length;i++)if(n.indexOf(descTokens[i])>=0)common++;if(common>=2)score+=2;else if(common===1)score++;return score>=2}
function parseRequestItemsFromText_(text){const lines=String(text||'').split(/\r?\n/).map(function(x){return x.replace(/\s+/g,' ').trim()}).filter(Boolean),out=[],units='UN|PC|PÇ|BR|M3|M²|M2|KG|SC|RL|PCT|GL|LTS|LT|M|CX|JG';for(let i=0;i<lines.length;i++){let m=lines[i].match(new RegExp('^(\\d+)\\s+(\\d+(?:[.,]\\d+)?)\\s+('+units+')\\s+(.+)$','i'));if(m){out.push({item:m[1],qty:m[2],unit:m[3],description:m[4],observations:'',sourceLabel:'Leitura do pedido'});continue}m=lines[i].match(new RegExp('^(\\d+(?:[.,]\\d+)?)\\s*('+units+')\\s+(.+)$','i'));if(m)out.push({item:String(out.length+1),qty:m[1],unit:m[2],description:m[3],observations:'',sourceLabel:'Leitura do pedido'})}return out}

function extractFileText_(file){
  const mime=file.getMimeType();
  if(mime==='application/vnd.google-apps.document')return DocumentApp.openById(file.getId()).getBody().getText();
  if(mime==='application/vnd.google-apps.spreadsheet'){const ss=SpreadsheetApp.openById(file.getId());return ss.getSheets().map(function(sh){return sh.getDataRange().getDisplayValues().map(function(r){return r.join(' | ')}).join('\n')}).join('\n')}
  if(mime.indexOf('text/')===0||mime==='text/csv')return file.getBlob().getDataAsString('UTF-8');
  const target=(mime.indexOf('spreadsheet')>=0||/excel|officedocument\.spreadsheet/.test(mime))?'application/vnd.google-apps.spreadsheet':'application/vnd.google-apps.document';
  const tmpId=convertBlobToGoogle_(file.getBlob(),target,'ABS_TMP_'+Date.now());
  try{Utilities.sleep(700);if(target==='application/vnd.google-apps.spreadsheet'){const ss=SpreadsheetApp.openById(tmpId);return ss.getSheets().map(function(sh){return sh.getDataRange().getDisplayValues().map(function(r){return r.join(' | ')}).join('\n')}).join('\n')}return DocumentApp.openById(tmpId).getBody().getText()}finally{DriveApp.getFileById(tmpId).setTrashed(true)}
}
function convertBlobToGoogle_(blob,targetMime,name){const boundary='abs_'+Date.now(),meta=JSON.stringify({name:name,mimeType:targetMime}),head='--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+meta+'\r\n--'+boundary+'\r\nContent-Type: '+(blob.getContentType()||'application/octet-stream')+'\r\n\r\n',tail='\r\n--'+boundary+'--',bytes=Utilities.newBlob(head).getBytes().concat(blob.getBytes()).concat(Utilities.newBlob(tail).getBytes()),res=UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'post',contentType:'multipart/related; boundary='+boundary,payload:bytes,headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true}),code=res.getResponseCode();if(code<200||code>=300)throw new Error('Falha na leitura/conversão do arquivo ('+code+'): '+res.getContentText().slice(0,220));return JSON.parse(res.getContentText()).id}

function parseSupplierQuotation_(items,text,fileName,fileUrl){const lines=String(text||'').split(/\r?\n/).map(function(x){return x.replace(/\s+/g,' ').trim()}).filter(Boolean),name=inferSupplierName_(text,fileName),matches=[],used={};for(let i=0;i<items.length;i++){let best={score:0,line:'',index:-1};for(let j=0;j<lines.length;j++){const score=itemLineScore_(items[i].description,lines[j]);if(score>best.score)best={score:score,line:lines[j],index:j}}let m={confidence:best.score,matchedLine:'',quotedDescription:'',unitPrice:0,totalPrice:0,manual:false};if(best.score>=0.62){const near=[lines[Math.max(0,best.index-1)]||'',best.line,lines[Math.min(lines.length-1,best.index+1)]||''].join(' | '),prices=moneyCandidates_(near),requestedQty=parseFloat(String(items[i].qty||'1').replace(',','.'))||1,quotedQty=extractQuotedQty_(best.line)||requestedQty,qty=quotedQty;m.quotedQty=quotedQty;if(Math.abs(quotedQty-requestedQty)>0.001)m.qtyWarning='Quantidade solicitada: '+requestedQty+' | quantidade cotada: '+quotedQty;m.matchedLine=best.line;m.quotedDescription=cleanQuotedDescription_(best.line);const reqBrand=findKnownBrand_(items[i].description),quoteBrand=findKnownBrand_(near);if(reqBrand&&quoteBrand&&reqBrand!==quoteBrand)m.warning='Marca solicitada: '+reqBrand+' | Marca cotada: '+quoteBrand;else if(reqBrand&&!quoteBrand)m.warning='Marca solicitada '+reqBrand+' não identificada claramente na linha cotada.';if(m.qtyWarning)m.warning=(m.warning?m.warning+' | ':'')+m.qtyWarning;const chosen=chooseQuotePrices_(prices,qty);m.unitPrice=chosen.unit;m.totalPrice=chosen.totalused[best.index]=true}else{m.confidence=best.score}matches.push(m)}const unmappedLines=[];for(let u=0;u<lines.length&&unmappedLines.length<12;u++){if(used[u])continue;const ln=lines[u],nn=normalize_(ln),mc=moneyCandidates_(ln);if(mc.length>=2&&ln.length>14&&nn.indexOf('total')<0&&nn.indexOf('frete')<0&&nn.indexOf('desconto')<0&&nn.indexOf('subtotal')<0&&nn.indexOf('pagamento')<0)unmappedLines.push(ln)}const itemSum=matches.reduce(function(a,m){return a+Number(m.totalPrice||0)},0),grand=findLabeledMoney_(lines,['valor liquido','valor líquido','total geral','total pedido','valor total','total']),freight=findLabeledMoney_(lines,['frete']),payment=findLabeledText_(lines,['condicoes de pagamento','condição de pagamento','pagamento','boleto','cartao','cartão']),delivery=findLabeledText_(lines,['prazo de entrega','entrega']),validity=findLabeledText_(lines,['validade','valido ate','válido até','valido por','válido por','precos e condicoes validos','preços e condições válidos']),contact=findLabeledText_(lines,['vendedor','contato']),phone=findPhone_(text),diff=grand?Math.abs(grand-itemSum-(freight||0)):0;return{name:name,fileName:fileName,fileUrl:fileUrl,grandTotal:grand||0,mappedTotal:Number((itemSum+(freight||0)).toFixed(2)),freight:freight||0,payment:payment||'',delivery:delivery||'',validity:validity||'',contact:contact||'',phone:phone||'',matches:matches,unmappedLines:unmappedLines,itemSum:itemSum,reconciliationWarning:grand&&diff>Math.max(2,grand*.02)?'Soma dos itens vinculados difere do total da proposta em '+brMoney_(diff)+'. Isso pode indicar itens extras, descontos, frete ou linhas ainda não vinculadas.':(!grand?'Total geral da proposta não foi identificado; o sistema mantém apenas a soma dos itens vinculados + frete como referência calculada.':'')}}
function inferSupplierName_(text,fileName){const known=['Acquafort','Hidrovar','Mafrei','Zzat','EletroRastro','Balaroti','Nichele','Inbraell','Arebril','Impermix','Expotrade','Pormade','Woodportas','Gralha Azul'];const n=normalize_(String(fileName||'')+' '+String(text||'').slice(0,1200));for(let i=0;i<known.length;i++)if(n.indexOf(normalize_(known[i]))>=0)return known[i];const f=String(fileName||'').replace(/\.[^.]+$/,'').replace(/^\d+\s*[-_]\s*/,'').replace(/or[cç]amento/ig,'').replace(/pedido.*/ig,'').replace(/[_-]+/g,' ').trim();return shorten_(f||'Fornecedor',40)}
function itemLineScore_(desc,line){const a=itemTokens_(desc),b=itemTokens_(line);if(!a.length)return 0;let common=0;for(let i=0;i<a.length;i++)if(b.indexOf(a[i])>=0)common++;let score=a.length===1?(b.indexOf(a[0])>=0?0.82:0):common/a.length;const rd=dimensionHints_(desc),qd=dimensionHints_(line);if(rd.length){if(!qd.length)score*=0.72;else{let dc=0;for(let i=0;i<rd.length;i++)if(qd.indexOf(rd[i])>=0)dc++;if(dc===0)score*=0.45;else if(dc/rd.length<0.5)score*=0.72}}if(normalize_(line).indexOf(normalize_(desc))>=0)score=1;return score}
function itemTokens_(s){let x=String(s||'').replace(/\d+\s*mm/ig,' ').replace(/\d+\s*[xX]\s*\d+(?:\/\d+)?/g,' ').replace(/\d+\/\d+/g,' ');const stop={para:1,com:1,sem:1,uma:1,unidade:1,material:1,de:1,do:1,da:1,marron:1,marrom:1,metalico:1,pvc:1};return normalize_(x).split(' ').filter(function(t){return t.length>=2&&!stop[t]})}
function extractQuotedQty_(line){const s=String(line||''),unit='(?:UN|PC|PÇ|BR|M3|M²|M2|KG|SC|RL|PCT|GL|LTS|LT|M|CX|JG|KT|TB)',a=new RegExp('\b'+unit+'\.?\s+(\d+(?:[.,]\d+)?)','i').exec(s),b=new RegExp('(?:^|\s)(\d+(?:[.,]\d+)?)\s+'+unit+'\.?\b','i').exec(s),m=a||b;if(!m)return 0;return Number(String(m[1]).replace(',','.'))||0}
function dimensionHints_(s){const t=String(s||'').toLowerCase(),out=[];let m,re=/([0-9]+(?:[.,][0-9]+)?)\s*mm/gi;while((m=re.exec(t)))out.push(String(Number(m[1].replace(',','.'))));re=/([0-9]+)\s*[xX]\s*([0-9]+)(?![,0-9])/g;while((m=re.exec(t))){out.push(String(Number(m[1])));out.push(String(Number(m[2])))}re=/([0-9]+)\s*[xX]\s*([0-9]+\/[0-9]+)/g;while((m=re.exec(t))){out.push(String(Number(m[1])));out.push(m[2])}re=/([0-9]+\/[0-9]+)/g;while((m=re.exec(t)))out.push(m[1]);re=/(?:soldavel|sold|esgoto|tubo|luva|te)\s+(?:pvc\s+)?([0-9]{2,3})\b/gi;while((m=re.exec(t)))out.push(String(Number(m[1])));return out.filter(function(v,i,a){return a.indexOf(v)===i})}
function chooseQuotePrices_(prices,qty){const arr=(prices||[]).filter(function(x){return Number(x)>=0}),q=Number(qty)||1;if(!arr.length)return{unit:0,total:0};if(arr.length===1)return{unit:Number((arr[0]/q).toFixed(4)),total:arr[0]};let total=0,totalIndex=-1;for(let i=arr.length-1;i>=0;i--){if(arr[i]>0){total=arr[i];totalIndex=i;break}}if(!total)return{unit:0,total:0};const target=total/q;let best=0,bestErr=Infinity;for(let i=0;i<totalIndex;i++){const v=arr[i];if(v<=0)continue;const err=Math.abs(v-target)/Math.max(target,.01);if(err<bestErr){bestErr=err;best=v}}if(bestErr>.12)best=Number(target.toFixed(4));return{unit:best,total:total}}
function findKnownBrand_(s){const aliases={DECA:['deca'],FAME:['fame'],TIGRE:['tigre'],DOCOL:['docol'],AMANCO:['amanco'],LORENZETTI:['lorenzetti','lorenzet'],ZAGONEL:['zagonel'],ASTRA:['astra'],BLUKIT:['blukit'],ENERBRAS:['enerbras'],SUVINIL:['suvinil'],REAL:['real'],IMPERATRIZ:['imperatriz']},n=normalize_(s);let best='',pos=1e9;Object.keys(aliases).forEach(function(brand){aliases[brand].forEach(function(a){const p=n.indexOf(normalize_(a));if(p>=0&&p<pos){pos=p;best=brand}})});return best}
function moneyCandidates_(s){const out=[],re=/(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+\.\d{2})/g;let m;while((m=re.exec(String(s||'')))){let x=m[1];if(x.indexOf(',')>=0)x=x.replace(/\./g,'').replace(',','.');const n=Number(x);if(Number.isFinite(n))out.push(n)}return out}
function findLabeledMoney_(lines,labels){for(let j=0;j<labels.length;j++){const lab=normalize_(labels[j]);for(let i=0;i<lines.length;i++){const n=normalize_(lines[i]);if(n.indexOf(lab)>=0){let m=moneyCandidates_(lines[i]);if(m.length)return m[m.length-1];if(lab.indexOf('frete')>=0&&n.indexOf('total geral')>=0&&i>0){const prev=moneyCandidates_(lines[i-1]);if(prev.length)return prev[prev.length-1]}const nearby=[];for(let k=i+1;k<=Math.min(lines.length-1,i+4);k++){const mm=moneyCandidates_(lines[k]);if(mm.length&&normalize_(lines[k]).length<45)nearby.push(mm[mm.length-1])}if(nearby.length){if(lab.indexOf('total')>=0||lab.indexOf('valor liquido')>=0)return nearby[nearby.length-1];return nearby[0]}}}}return 0}
function findLabeledText_(lines,labels){for(let i=0;i<lines.length;i++){const n=normalize_(lines[i]);for(let j=0;j<labels.length;j++)if(n.indexOf(normalize_(labels[j]))>=0)return shorten_(lines[i],90)}return''}
function findPhone_(text){const m=String(text||'').match(/\(?\d{2}\)?\s*\d{4,5}[-\s]?\d{4}/);return m?m[0]:''}
function cleanQuotedDescription_(line){return shorten_(String(line||'').replace(/R\$\s*[\d.,]+/g,'').replace(/\s+\d+[,.]\d{2}\s*/g,' ').replace(/\s+/g,' ').trim(),120)}
function brMoney_(n){return'R$ '+Number(n||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}

function prepareMapSupplierColumns_(sh,count){const finder=sh.createTextFinder('MENOR VALOR').matchEntireCell(true).findNext();if(!finder)throw new Error('Template do mapa sem coluna MENOR VALOR.');let current=finder.getColumn(),desired=5+2*count;if(desired>current){const diff=desired-current;sh.insertColumnsBefore(current,diff);sh.getRange(1,current-2,sh.getMaxRows(),2).copyFormatToRange(sh,current,current+diff-1,1,sh.getMaxRows())}else if(desired<current){sh.deleteColumns(desired,current-desired)}sh.getRange(2,desired,1,2).breakApart().mergeAcross().setValue('MENOR VALOR');sh.getRange(6,desired,1,2).setValues([['V. UNITÁRIO','V. TOTAL']])}
function prepareMapItemRows_(sh,itemCount){const start=7,totalCell=sh.createTextFinder('VALOR TOTAL').matchEntireCell(true).findNext();if(!totalCell)throw new Error('Template do mapa sem linha VALOR TOTAL.');let totalRow=totalCell.getRow(),capacity=totalRow-start-3;if(itemCount>capacity){const extra=itemCount-capacity,insertAt=totalRow-3;sh.insertRowsBefore(insertAt,extra);sh.getRange(insertAt-1,1,1,sh.getMaxColumns()).copyFormatToRange(sh,1,sh.getMaxColumns(),insertAt,insertAt+extra-1)}}
function fillQuotationMap_(sh,clientName,order,items,suppliers){const start=7,lowCol=5+2*suppliers.length;sh.getRange('D2').setValue(now_().split(' ')[0]);sh.getRange('D3').setValue('OBRA: '+clientName);const totalCell=sh.createTextFinder('VALOR TOTAL').matchEntireCell(true).findNext(),totalRow=totalCell.getRow(),clearRows=totalRow-start-3;sh.getRange(start,1,Math.max(clearRows,items.length),lowCol+1).clearContent();sh.getRange(start,5,Math.max(clearRows,items.length),Math.max(2,lowCol-4)).setBackground(null);for(let i=0;i<items.length;i++){const it=items[i];sh.getRange(start+i,1,1,4).setValues([[it.item||String(i+1),parseNumberLoose_(it.qty),it.unit||'',it.description||'']]);let best=0,bestCol=0,bestUnit=0;for(let s=0;s<suppliers.length;s++){const m=(suppliers[s].matches||[])[i]||{},c=5+s*2,unit=Number(m.unitPrice||0),tot=Number(m.totalPrice||0);if(unit)sh.getRange(start+i,c).setValue(unit);if(tot)sh.getRange(start+i,c+1).setValue(tot);if(tot>0&&(!best||tot<best)){best=tot;bestCol=c;bestUnit=unit}}if(best){sh.getRange(start+i,lowCol).setValue(bestUnit);sh.getRange(start+i,lowCol+1).setValue(best);sh.getRange(start+i,bestCol,1,2).setBackground('#c7f52d')}}for(let s=0;s<suppliers.length;s++){const c=5+s*2,sp=suppliers[s];sh.getRange(3,c,1,2).breakApart().mergeAcross().setValue(sp.name);setMapSummary_(sh,'VALOR TOTAL',c,Number(sp.itemSum||0));setMapSummary_(sh,'FRETE',c,Number(sp.freight||0));setMapSummary_(sh,'CONDICÕES DE PAGAMENTO',c,sp.payment||'Não informado');setMapSummary_(sh,'DESCONTO À VISTA',c,0);setMapSummary_(sh,'VALOR PAGAMENTO À VISTA',c,Number(sp.grandTotal||((sp.itemSum||0)+(sp.freight||0))))}const foot=sh.createTextFinder('Pedido:').matchCase(false).findNext();if(foot)foot.setValue('Pedido: '+formatOrder_(order.orderNumber)+'                                                                                                              Área : '+prettyCategory_(order.category));sh.getRange(start,5,Math.max(items.length,1),Math.max(2,lowCol-4)).setNumberFormat('R$ #,##0.00')}
function setMapSummary_(sh,label,col,val){const c=sh.createTextFinder(label).matchEntireCell(true).findNext();if(c)sh.getRange(c.getRow(),col).setValue(val)}
function writeMapObservations_(ss,analysis){let sh=ss.getSheetByName('Observações');if(!sh)sh=ss.insertSheet('Observações');sh.getRange(1,1,sh.getMaxRows(),Math.min(sh.getMaxColumns(),8)).clearContent();const rows=[['ANÁLISE / REVISÃO DO MAPA','FORNECEDOR / ORIGEM']];(analysis.warnings||[]).forEach(function(w){rows.push([w,'Sistema'])});(analysis.suppliers||[]).forEach(function(s){if(s.reconciliationWarning)rows.push([s.reconciliationWarning,s.name]);(s.unmappedLines||[]).forEach(function(x){rows.push(['Linha monetária não vinculada automaticamente: '+x,s.name])});(s.matches||[]).forEach(function(m,i){if(Number(m.confidence||0)<.62)rows.push(['Item '+(i+1)+' não vinculado automaticamente; revisar.',s.name]);if(m.warning)rows.push(['Item '+(i+1)+': '+m.warning,s.name])})});sh.getRange(1,1,rows.length,2).setValues(rows);sh.getRange(1,1,1,2).setFontWeight('bold')}

function fillPurchaseOrder_(sh,clientName,order,supplier,lines,includeFreight){const profile=ABS_CLIENT_PROFILE[clientName]||{legalName:clientName,address:'Dados cadastrais a confirmar',delivery:'A confirmar',cnpj:'A confirmar',phone:''};sh.getRange('A1').setValue(profile.legalName);sh.getRange('A2').setValue(profile.address);sh.getRange('A3').setValue('CNPJ: '+profile.cnpj);sh.getRange('A4').setValue(profile.phone?'Telefone: '+profile.phone:'');sh.getRange('F6').setValue(now_().split(' ')[0]);sh.getRange('F8').setValue('Compras Absolutta');sh.getRange('F10').setValue(order.orderNumber);sh.getRange('C14').setValue(clientName);sh.getRange('C15').setValue(profile.delivery);sh.getRange('C16').setValue(order.orderNumber);sh.getRange('C17').setValue('A confirmar');const itemHeader=sh.createTextFinder('ITEM').matchEntireCell(true).findNext(),totalCell=sh.createTextFinder('TOTAL GERAL').matchEntireCell(true).findNext();if(!itemHeader||!totalCell)throw new Error('Template da O.C. inválido.');const start=itemHeader.getRow()+1,need=lines.length+(includeFreight?1:0),capacity=totalCell.getRow()-start;if(need>capacity){const extra=need-capacity;sh.insertRowsBefore(totalCell.getRow(),extra);sh.getRange(start,1,1,6).copyFormatToRange(sh,1,6,totalCell.getRow(),totalCell.getRow()+extra-1)}const newTotal=sh.createTextFinder('TOTAL GERAL').matchEntireCell(true).findNext(),clearRows=newTotal.getRow()-start;sh.getRange(start,1,clearRows,6).clearContent();let total=0;for(let i=0;i<lines.length;i++){const it=lines[i].item,m=lines[i].match,desc=m.quotedDescription||it.description,qty=parseNumberLoose_(it.qty)||1;sh.getRange(start+i,1,1,6).setValues([[i+1,desc,it.unit||'',qty,Number(m.unitPrice||0),Number(m.totalPrice||0)]]);total+=Number(m.totalPrice||0)}if(includeFreight){sh.getRange(start+lines.length,1,1,6).setValues([[lines.length+1,'FRETE','UN',1,Number(supplier.freight||0),Number(supplier.freight||0)]]);total+=Number(supplier.freight||0)}sh.getRange(start,5,Math.max(need,1),2).setNumberFormat('R$ #,##0.00');sh.getRange(newTotal.getRow(),6).setValue(total).setNumberFormat('R$ #,##0.00');setNextToLabel_(sh,'FORNECEDOR:',supplier.name);setNextToLabel_(sh,'CONTATO:',supplier.contact||'Não informado');setNextToLabel_(sh,'TELEFONE:',supplier.phone||'Não informado');const summary=sh.createTextFinder('O.C.').matchEntireCell(true).findNext();if(summary){const r=summary.getRow()+1;sh.getRange(r,1,1,6).setValues([[order.orderNumber,supplier.name,total,'',supplier.delivery||'A confirmar',supplier.payment||'Não informado']]);sh.getRange(r,3).setNumberFormat('R$ #,##0.00')}const obs=sh.createTextFinder('OBS').matchEntireCell(true).findNext();if(obs){const r=obs.getRow()+2,notes=['Orçamento de referência: '+(supplier.fileName||'cotação revisada')+'.','Pagamento: '+(supplier.payment||'não informado')+' | Frete: '+brMoney_(includeFreight?supplier.freight:0)+'.','Validade do orçamento: '+(supplier.validity||'não informada')+'.','Entrega: '+(supplier.delivery||'a confirmar')+' | Recebimento de material: a confirmar.','Endereço de entrega: '+String(profile.delivery||'A confirmar').replace(/\n/g,' — ')+'.'];sh.getRange(r,1,Math.min(notes.length,sh.getMaxRows()-r+1),1).clearContent();sh.getRange(r,1,notes.length,1).setValues(notes.map(function(x){return[x]}))}}
function setNextToLabel_(sh,label,val){const c=sh.createTextFinder(label).matchEntireCell(true).findNext();if(c)sh.getRange(c.getRow(),c.getColumn()+1).setValue(val)}
function findFileByPrefix_(folder,prefix){const it=folder.getFiles();while(it.hasNext()){const f=it.next();if(normalize_(f.getName()).indexOf(normalize_(prefix))===0)return f}return null}
function parseNumberLoose_(x){const n=Number(String(x||'').replace(/\./g,'').replace(',','.').replace(/[^0-9.-]/g,''));return Number.isFinite(n)?n:0}
function safeName_(s){return String(s||'Fornecedor').replace(/[\\/:*?"<>|]/g,' ').replace(/\s+/g,' ').trim()}

/**
 * ABSOLUTTA PEDIDOS v5.4 — controle integrado de locações
 *
 * Regras do MVP:
 * - O pedido de locação continua sendo um pedido normal da planilha/Drive.
 * - O módulo de locações é apenas um espelho operacional do pedido-fonte.
 * - Excluir/ocultar no módulo de locações NUNCA apaga o pedido original nem sua pasta.
 * - O espelho de locações é habilitado para todos os clientes configurados.
 */
const ABS_RENTAL_MVP_CLIENTS = {
  'Deterlimp': true,
  'Carlos Bezerra': true,
  'CMFS / Dr. Clovis': true,
  'Santa Gianna': true
};
const ABS_RENTAL_SHEET = '_APP LOCAÇÕES';
const ABS_RENTAL_EVENTS_SHEET = '_APP HISTÓRICO LOCAÇÕES';

function getMvpData(clientName) {
  const ctx = readClient_(clientName);
  const orders = buildFullOrderRows_(ctx.display);
  let rentals = [];
  if (ABS_RENTAL_MVP_CLIENTS[clientName]) {
    syncRentalMirror_(clientName);
    rentals = getRentalDashboard_(clientName, true);
  }
  return {
    clientName: clientName,
    generatedAt: now_(),
    orders: orders,
    rentals: rentals,
    nfUnlinked: readUnlinkedInvoices_(ctx.ss),
    automation: {installed:null, triggers:[], status:'not_checked_in_webapp'}
  };
}

function buildFullOrderRows_(display) {
  if (!display || !display.length) return [];
  const headers = display[0].map(function(h){ return String(h || '').trim(); });
  const out = [];
  for (let r = 1; r < display.length; r++) {
    const row = display[r];
    if (!row || isEmptyRow_(row)) continue;
    const fields = {};
    headers.forEach(function(h, i) {
      if (h) fields[h] = String(row[i] == null ? '' : row[i]).trim();
    });
    const category = findField_(fields, ['Categoria De Solicitação','Categoria']);
    const orderNumber = findField_(fields, ['Numero do Pedido','Nº do Pedido']);
    const description = findField_(fields, ['Descrição']);
    const status = findField_(fields, ['Status']);
    const supplier = findField_(fields, ['Fornecedor']);
    const valueText = findField_(fields, ['Valor']);
    const hasOperational = [category, orderNumber, description, status, supplier, valueText,
      findField_(fields,['Solicitante']), findField_(fields,['Nota Fiscal'])]
      .some(function(v){return String(v||'').trim() !== '';});
    if (!hasOperational) continue;
    out.push({
      id: 'row-' + (r + 1),
      rowNumber: r + 1,
      timestamp: findField_(fields, ['Coluna 1','Carimbo de data/hora']),
      requester: findField_(fields, ['Solicitante']),
      description: description,
      needDate: findField_(fields, ['Previsão de Entrega - minimo 15 dias','Previsão de Entrega','Entrega Prevista']),
      requestFile: findField_(fields, ['Arquivo']),
      category: category || 'Sem categoria',
      orderNumber: orderNumber,
      status: status || 'Sem status informado',
      deliveryDate: findField_(fields, ['Data da Entrega do Material','Data entrega','Entrega Prevista']),
      supplier: supplier || 'Não informado',
      invoice: findField_(fields, ['Nota Fiscal']) || '—',
      invoiceDate: findField_(fields, ['Emissão']),
      value: parseMoney_(valueText),
      valueText: valueText,
      invoiceFile: findField_(fields, ['Arquivo NF']),
      boletoFile: findField_(fields, ['Arquivo Boleto/ Link','Arquivo Boleto','Boleto/link']),
      payment: findField_(fields, ['Pagamento']),
      receipt: findField_(fields, ['Comprovante']),
      boletoDueDate: findField_(fields, ['Data de Vencimento Boleto']),
      boletoDays: findField_(fields, ['Vencimento']),
      boletoSent: findField_(fields, ['Envio de Boleto','Data de Envio boleto']),
      invoiceSent: findField_(fields, ['Envio de NF','Data de Envio NF','NF Enviada']),
      report: findField_(fields, ['Relatorio','Relatorio ','Relatorio pedido']),
      occurrences: findField_(fields, ['Ocorrências do Pedido','Ocorrencias do Pedido','Ocorrências']),
      fields: fields
    });
  }
  return out;
}

function findField_(fields, names) {
  for (let i=0;i<names.length;i++) {
    const target = normalize_(names[i]);
    const keys = Object.keys(fields);
    for (let j=0;j<keys.length;j++) if (normalize_(keys[j]) === target) return fields[keys[j]];
  }
  return '';
}

function readUnlinkedInvoices_(ss) {
  const sh = ss.getSheetByName('NFs SEM VÍNCULO');
  if (!sh) return [];
  const v = sh.getDataRange().getDisplayValues();
  if (v.length < 2) return [];
  const h = v[0].map(function(x){return String(x||'').trim();});
  return v.slice(1).filter(function(r){return r && !isEmptyRow_(r);}).map(function(r){
    const o={}; h.forEach(function(k,i){if(k)o[k]=String(r[i] == null ? '' : r[i]).trim();}); return o;
  });
}

function syncRentalMirror_(clientName) {
  if (!ABS_RENTAL_MVP_CLIENTS[clientName]) return {enabled:false, created:0, updated:0};
  const ctx = readClient_(clientName);
  const sheets = ensureRentalSheets_(ctx.ss);
  const base = sheets.base;
  const source = ctx.display;
  const headers = source[0].map(function(h){return String(h||'').trim();});
  const ix = {
    timestamp: headerPos_(headers, ['Coluna 1','Carimbo de data/hora']),
    category: headerPos_(headers, ['Categoria De Solicitação','Categoria']),
    order: headerPos_(headers, [ctx.cfg.orderHeader,'Numero do Pedido','Nº do Pedido']),
    description: headerPos_(headers, ['Descrição']),
    supplier: headerPos_(headers, ['Fornecedor']),
    status: headerPos_(headers, ['Status']),
    delivery: headerPos_(headers, ['Data da Entrega do Material','Data entrega']),
    value: headerPos_(headers, ['Valor'])
  };
  const existing = base.getDataRange().getValues();
  const byId = {};
  for (let r=1;r<existing.length;r++) if (existing[r][0]) byId[String(existing[r][0])] = r + 1;
  let created = 0, updated = 0;
  const now = new Date();

  for (let r=1;r<source.length;r++) {
    const row = source[r]; if (!row || isEmptyRow_(row)) continue;
    const cat = ix.category >= 0 ? cell_(row, ix.category) : '';
    if (normalize_(cat) !== 'locacao') continue;
    const timestamp = ix.timestamp >= 0 ? cell_(row, ix.timestamp) : '';
    const description = ix.description >= 0 ? cell_(row, ix.description) : '';
    const rentalId = stableRentalId_(clientName, timestamp, description, r + 1);
    const order = ix.order >= 0 ? cell_(row, ix.order) : '';
    const supplier = ix.supplier >= 0 ? cell_(row, ix.supplier) : '';
    const sourceStatus = ix.status >= 0 ? cell_(row, ix.status) : '';
    const delivery = ix.delivery >= 0 ? cell_(row, ix.delivery) : '';
    const sourceValue = ix.value >= 0 ? parseMoney_(cell_(row, ix.value)) : 0;
    const startDefault = ptDateToIsoStrict_(delivery);
    const termDefault = normalize_(description).indexOf('cacamba') >= 0 ? 7 : '';

    if (!byId[rentalId]) {
      base.appendRow([
        rentalId, clientName, r + 1, order, description, supplier, timestamp,
        startDefault, termDefault, sourceValue || '', '', true, '', now,
        sourceStatus, cat, delivery, sourceValue || ''
      ]);
      byId[rentalId] = base.getLastRow();
      created++;
    } else {
      const rr = byId[rentalId];
      // Atualiza apenas dados derivados da fonte. Campos operacionais manuais (H:M) são preservados.
      base.getRange(rr, 2, 1, 6).setValues([[clientName, r + 1, order, description, supplier, timestamp]]);
      base.getRange(rr, 14, 1, 5).setValues([[now, sourceStatus, cat, delivery, sourceValue || '']]);
      const currentPeriod = base.getRange(rr,10).getValue();
      if (!currentPeriod && sourceValue) base.getRange(rr,10).setValue(sourceValue);
      updated++;
    }
  }
  return {enabled:true, created:created, updated:updated};
}

function ensureRentalSheets_(ss) {
  let base = ss.getSheetByName(ABS_RENTAL_SHEET);
  if (!base) {
    base = ss.insertSheet(ABS_RENTAL_SHEET);
    base.getRange(1,1,1,18).setValues([[
      'ID LOCAÇÃO','CLIENTE','LINHA ORIGEM','Nº PEDIDO','DESCRIÇÃO','FORNECEDOR','DATA PEDIDO',
      'DATA INÍCIO BASE','PRAZO BASE (DIAS)','VALOR PERÍODO','CUSTO RENOVAÇÃO','ATIVA NO PAINEL',
      'OBSERVAÇÕES','ÚLTIMA SINCRONIZAÇÃO','STATUS PEDIDO FONTE','CATEGORIA FONTE','DATA ENTREGA FONTE','VALOR FONTE'
    ]]);
    base.setFrozenRows(1);
    base.hideSheet();
  }
  let events = ss.getSheetByName(ABS_RENTAL_EVENTS_SHEET);
  if (!events) {
    events = ss.insertSheet(ABS_RENTAL_EVENTS_SHEET);
    events.getRange(1,1,1,9).setValues([[
      'ID EVENTO','ID LOCAÇÃO','DATA/HORA','TIPO','DESCRIÇÃO','DATA AÇÃO','DIAS','ATIVO','PAYLOAD'
    ]]);
    events.setFrozenRows(1);
    events.hideSheet();
  }
  return {base:base, events:events};
}

function headerPos_(headers, names) {
  for (let n=0;n<names.length;n++) {
    const target = normalize_(names[n]);
    for (let i=0;i<headers.length;i++) if (normalize_(headers[i]) === target) return i;
  }
  return -1;
}

function stableRentalId_(clientName, timestamp, description, rowNumber) {
  const src = [clientName,timestamp,description,rowNumber].join('|');
  const dig = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, src, Utilities.Charset.UTF_8);
  const hex = dig.map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
  return 'LOC-' + hex.slice(0,10).toUpperCase();
}

function ptDateToIsoStrict_(s) {
  const m = String(s||'').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return '';
  return m[3] + '-' + m[2] + '-' + m[1];
}

function parseIsoDate_(s) {
  const m = String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
}

function isoDate_(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, 'America/Sao_Paulo', 'yyyy-MM-dd');
}

function brDate_(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, 'America/Sao_Paulo', 'dd/MM/yyyy');
}

function getRentalDashboard_(clientName, includeHidden) {
  if (!ABS_RENTAL_MVP_CLIENTS[clientName]) return [];
  const ctx = readClient_(clientName);
  const sheets = ensureRentalSheets_(ctx.ss);
  const base = sheets.base.getDataRange().getValues();
  const ev = sheets.events.getDataRange().getValues();
  const eventsByRental = {};
  for (let r=1;r<ev.length;r++) {
    if (!ev[r][0] || !ev[r][1]) continue;
    const e = {
      eventId:String(ev[r][0]), rentalId:String(ev[r][1]), createdAt:ev[r][2], type:String(ev[r][3]||''),
      description:String(ev[r][4]||''), actionDate:ev[r][5] instanceof Date ? isoDate_(ev[r][5]) : String(ev[r][5]||''),
      days:Number(ev[r][6]||0), active:ev[r][7] !== false && String(ev[r][7]).toLowerCase() !== 'false', payload:String(ev[r][8]||'')
    };
    if (!eventsByRental[e.rentalId]) eventsByRental[e.rentalId]=[];
    eventsByRental[e.rentalId].push(e);
  }
  const today = new Date(); today.setHours(0,0,0,0);
  const out=[];
  for (let r=1;r<base.length;r++) {
    const row=base[r]; if(!row[0]) continue;
    const visible = row[11] !== false && String(row[11]).toLowerCase() !== 'false';
    if (!includeHidden && !visible) continue;
    const id=String(row[0]);
    let startIso = row[7] instanceof Date ? isoDate_(row[7]) : String(row[7]||'');
    let termDays = Number(row[8]||0);
    let status = visible ? 'Ativa' : 'Oculta';
    const allEvents=(eventsByRental[id]||[]).sort(function(a,b){return new Date(a.createdAt)-new Date(b.createdAt);});
    allEvents.filter(function(e){return e.active;}).forEach(function(e){
      if (e.type==='EXTEND') termDays += Number(e.days||0);
      if (e.type==='EXCHANGE') { startIso = e.actionDate || isoDate_(today); status='Ativa'; }
      if (e.type==='WITHDRAW') status='Encerrada';
      if (e.type==='REACTIVATE') status='Ativa';
    });
    let due=null, daysRemaining=null, alert='CONFIGURAR';
    const start=parseIsoDate_(startIso);
    if (status==='Oculta') alert='OCULTA';
    else if (status==='Encerrada') alert='ENCERRADA';
    else if (start && termDays>0) {
      due=new Date(start); due.setDate(due.getDate()+termDays); due.setHours(0,0,0,0);
      daysRemaining=Math.ceil((due.getTime()-today.getTime())/86400000);
      if(daysRemaining<0) alert='VENCIDA';
      else if(daysRemaining<=1) alert='AGIR HOJE';
      else if(daysRemaining<=3) alert='ATENÇÃO';
      else alert='OK';
    }
    out.push({
      rentalId:id, clientName:String(row[1]||''), sourceRow:Number(row[2]||0), orderNumber:String(row[3]||''),
      description:String(row[4]||''), supplier:String(row[5]||''), requestDate: row[6] instanceof Date ? brDate_(row[6]) : String(row[6]||''),
      startDate:startIso, baseTermDays:Number(row[8]||0), termDays:termDays, dueDate:due?isoDate_(due):'', daysRemaining:daysRemaining,
      valuePeriod:Number(row[9]||0), renewalCost:Number(row[10]||0), visible:visible, notes:String(row[12]||''),
      sourceStatus:String(row[14]||''), sourceCategory:String(row[15]||''), sourceDeliveryDate: row[16] instanceof Date ? brDate_(row[16]) : String(row[16]||''),
      sourceValue:Number(row[17]||0), status:status, alert:alert, events:allEvents
    });
  }
  return out;
}

function saveRentalSettings(clientName, rentalId, payload) {
  if (!ABS_RENTAL_MVP_CLIENTS[clientName]) throw new Error('Controle de locações não habilitado para este cliente.');
  syncRentalMirror_(clientName);
  const ctx=readClient_(clientName), sh=ensureRentalSheets_(ctx.ss).base;
  const vals=sh.getDataRange().getValues();
  const row=findRentalRow_(vals,rentalId); if(!row) throw new Error('Locação não encontrada: '+rentalId);
  const start=String((payload&&payload.startDate)||'').trim();
  const term=Number((payload&&payload.termDays)||0);
  const period=parseNumberLoose_((payload&&payload.valuePeriod)||0);
  const renewal=parseNumberLoose_((payload&&payload.renewalCost)||0);
  const notes=String((payload&&payload.notes)||'').trim();
  sh.getRange(row,8,1,6).setValues([[start,term||'',period||'',renewal||'',vals[row-1][11],notes]]);
  return getRentalDashboard_(clientName,true);
}

function performRentalAction(clientName, rentalId, action, payload) {
  if (!ABS_RENTAL_MVP_CLIENTS[clientName]) throw new Error('Controle de locações não habilitado para este cliente.');
  syncRentalMirror_(clientName);
  const ctx=readClient_(clientName), sheets=ensureRentalSheets_(ctx.ss), baseVals=sheets.base.getDataRange().getValues();
  if(!findRentalRow_(baseVals,rentalId)) throw new Error('Locação não encontrada: '+rentalId);
  const allowed={EXTEND:'Prorrogação',EXCHANGE:'Troca',WITHDRAW:'Retirada',REACTIVATE:'Reativação'};
  action=String(action||'').toUpperCase(); if(!allowed[action]) throw new Error('Ação inválida: '+action);
  const p=payload||{}, days=action==='EXTEND'?Math.max(1,Number(p.days||7)):0;
  const actionDate=String(p.actionDate||Utilities.formatDate(new Date(),'America/Sao_Paulo','yyyy-MM-dd'));
  const eventId='EVT-'+Utilities.getUuid();
  const desc=action==='EXTEND' ? 'Prazo prorrogado em '+days+' dia(s)' : allowed[action]+' registrada';
  sheets.events.appendRow([eventId,rentalId,new Date(),action,desc,actionDate,days,true,JSON.stringify(p)]);
  return getRentalDashboard_(clientName,true);
}

function deleteRentalEvent(clientName, eventId) {
  if (!ABS_RENTAL_MVP_CLIENTS[clientName]) throw new Error('Controle de locações não habilitado para este cliente.');
  const ctx=readClient_(clientName), sh=ensureRentalSheets_(ctx.ss).events, vals=sh.getDataRange().getValues();
  for(let r=1;r<vals.length;r++) if(String(vals[r][0])===String(eventId)) {
    sh.getRange(r+1,8).setValue(false);
    return getRentalDashboard_(clientName,true);
  }
  throw new Error('Evento não encontrado: '+eventId);
}

function undoLastRentalAction(clientName, rentalId) {
  const ctx=readClient_(clientName), sh=ensureRentalSheets_(ctx.ss).events, vals=sh.getDataRange().getValues();
  for(let r=vals.length-1;r>=1;r--) {
    if(String(vals[r][1])===String(rentalId) && vals[r][7] !== false && String(vals[r][7]).toLowerCase()!=='false') {
      sh.getRange(r+1,8).setValue(false);
      return getRentalDashboard_(clientName,true);
    }
  }
  return getRentalDashboard_(clientName,true);
}

function setRentalVisible(clientName, rentalId, visible) {
  const ctx=readClient_(clientName), sh=ensureRentalSheets_(ctx.ss).base, vals=sh.getDataRange().getValues();
  const row=findRentalRow_(vals,rentalId); if(!row) throw new Error('Locação não encontrada: '+rentalId);
  sh.getRange(row,12).setValue(Boolean(visible));
  return getRentalDashboard_(clientName,true);
}

function findRentalRow_(vals,rentalId) {
  for(let r=1;r<vals.length;r++) if(String(vals[r][0])===String(rentalId)) return r+1;
  return 0;
}

/**
 * Instala automação resiliente.
 * - O relógio de segurança a cada 5 minutos é criado primeiro e garante o fluxo
 *   mesmo se algum gatilho onFormSubmit não puder ser instalado.
 * - Os gatilhos instantâneos dos 4 clientes são tentados individualmente.
 * - Um erro em um cliente não cancela os demais.
 * - Inicializa o espelho de locações dos clientes habilitados sem alterar os pedidos-fonte.
 */
function installAutomationTriggers() {
  const report = {
    clock: {ok:false, message:''},
    forms: {},
    baselines: {},
    rental: {ok:false, message:''},
    errors: []
  };

  // Remove somente os gatilhos deste módulo; falha aqui não deve abortar tudo.
  try { removeAutomationTriggers_(); }
  catch (err) { report.errors.push('Limpeza de gatilhos: ' + String(err && err.message || err)); }

  const props = PropertiesService.getScriptProperties();

  // 1) Baselines independentes por cliente.
  Object.keys(ABS_CONFIG).forEach(function(clientName){
    try {
      const ctx = readClient_(clientName);
      const key = 'ABS_LAST_ROW_' + normalize_(clientName).replace(/\s+/g,'_').toUpperCase();
      if (!props.getProperty(key)) props.setProperty(key, String(lastNonEmptyRow_(ctx.display)));
      report.baselines[clientName] = {ok:true, row:Number(props.getProperty(key) || 0)};
    } catch (err) {
      report.baselines[clientName] = {ok:false, error:String(err && err.message || err)};
      report.errors.push(clientName + ' baseline: ' + String(err && err.message || err));
    }
  });

  // 2) Fallback principal: sempre tenta deixar uma reconciliação periódica ativa.
  try {
    ScriptApp.newTrigger('absSafetySync').timeBased().everyMinutes(5).create();
    report.clock = {ok:true, message:'Reconciliação automática a cada 5 minutos instalada.'};
  } catch (err) {
    report.clock = {ok:false, message:String(err && err.message || err)};
    report.errors.push('Relógio de segurança: ' + String(err && err.message || err));
  }

  // 3) Instantâneo por Forms: opcional e independente. Se falhar, o relógio mantém o sistema funcionando.
  Object.keys(ABS_CONFIG).forEach(function(clientName){
    const cfg = ABS_CONFIG[clientName];
    try {
      ScriptApp.newTrigger('absOnFormSubmit')
        .forSpreadsheet(cfg.spreadsheetId)
        .onFormSubmit()
        .create();
      report.forms[clientName] = {ok:true, message:'Gatilho instantâneo instalado.'};
    } catch (err) {
      report.forms[clientName] = {ok:false, error:String(err && err.message || err)};
      report.errors.push(clientName + ' onFormSubmit: ' + String(err && err.message || err));
    }
  });

  // 4) Inicializa/atualiza os espelhos de locações dos clientes habilitados.
  const rentalResults = {};
  let rentalOk = true;
  Object.keys(ABS_RENTAL_MVP_CLIENTS).forEach(function(clientName){
    if (!ABS_RENTAL_MVP_CLIENTS[clientName]) return;
    try {
      rentalResults[clientName] = {ok:true, result:syncRentalMirror_(clientName)};
    } catch (err) {
      rentalOk = false;
      rentalResults[clientName] = {ok:false, error:String(err && err.message || err)};
      report.errors.push('Locações ' + clientName + ': ' + String(err && err.message || err));
    }
  });
  report.rental = {ok:rentalOk, message:rentalOk?'Espelhos de locações sincronizados.':'Há falhas em um ou mais espelhos de locações.', clients:rentalResults};

  // Status final sem transformar uma falha opcional de Forms em erro fatal.
  let status = null;
  try { status = getAutomationStatus_(); }
  catch (err) { report.errors.push('Leitura de status: ' + String(err && err.message || err)); }
  report.status = status;
  report.ok = Boolean(report.clock.ok && report.rental.ok);
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

/** Diagnóstico simples para executar no editor sem criar/remover nada. */
function diagnoseAutomation() {
  const out = {clients:{}, triggers:[], rentalSheets:{}, errors:[]};
  Object.keys(ABS_CONFIG).forEach(function(clientName){
    try {
      const ctx = readClient_(clientName);
      out.clients[clientName] = {
        ok:true,
        spreadsheetId:ctx.cfg.spreadsheetId,
        lastRow:lastNonEmptyRow_(ctx.display)
      };
    } catch (err) {
      out.clients[clientName] = {ok:false, error:String(err && err.message || err)};
      out.errors.push(clientName + ': ' + String(err && err.message || err));
    }
  });
  try {
    out.triggers = ScriptApp.getProjectTriggers().map(function(t){
      let sourceId='';
      try { sourceId=(t.getTriggerSourceId && t.getTriggerSourceId()) || ''; } catch(e) {}
      return {handler:t.getHandlerFunction(), eventType:String(t.getEventType()), sourceId:sourceId};
    });
  } catch (err) { out.errors.push('Triggers: '+String(err && err.message || err)); }
  Object.keys(ABS_RENTAL_MVP_CLIENTS).forEach(function(clientName){
    if (!ABS_RENTAL_MVP_CLIENTS[clientName]) return;
    try {
      const ss=SpreadsheetApp.openById(ABS_CONFIG[clientName].spreadsheetId);
      out.rentalSheets[clientName] = {
        base:Boolean(ss.getSheetByName(ABS_RENTAL_SHEET)),
        history:Boolean(ss.getSheetByName(ABS_RENTAL_EVENTS_SHEET))
      };
    } catch(err) { out.errors.push('Locações '+clientName+': '+String(err&&err.message||err)); }
  });
  Logger.log(JSON.stringify(out,null,2));
  return out;
}

function removeAutomationTriggers() {
  removeAutomationTriggers_();
  return getAutomationStatus_();
}

function removeAutomationTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function(t){
    const f=t.getHandlerFunction();
    if(f==='absOnFormSubmit' || f==='absSafetySync') ScriptApp.deleteTrigger(t);
  });
}

function absOnFormSubmit(e) {
  const sourceId=e && e.source && e.source.getId ? e.source.getId() : '';
  const clientName=Object.keys(ABS_CONFIG).find(function(k){return ABS_CONFIG[k].spreadsheetId===sourceId;});
  if(!clientName) return;
  // Pequeno atraso para permitir que fórmulas de Nº Pedido terminem de preencher.
  Utilities.sleep(2000);
  runFullSync(clientName);
  if(ABS_RENTAL_MVP_CLIENTS[clientName]) syncRentalMirror_(clientName);
}

function absSafetySync() {
  const result={};
  Object.keys(ABS_CONFIG).forEach(function(clientName){
    try { result[clientName]=runFullSync(clientName); }
    catch(err){ result[clientName]={error:String(err&&err.message||err)}; }
  });
  Object.keys(ABS_RENTAL_MVP_CLIENTS).forEach(function(clientName){
    if (!ABS_RENTAL_MVP_CLIENTS[clientName]) return;
    try { result[clientName + ' • locações'] = syncRentalMirror_(clientName); }
    catch(e) { result[clientName + ' • locações'] = {error:String(e&&e.message||e)}; }
  });
  return result;
}

function getAutomationStatus() { return getAutomationStatus_(); }
function getAutomationStatus_() {
  try {
    const triggers=ScriptApp.getProjectTriggers().map(function(t){
      return {handler:t.getHandlerFunction(), eventType:String(t.getEventType()), sourceId:(t.getTriggerSourceId&&t.getTriggerSourceId())||''};
    });
    return {
      installed:triggers.some(function(t){return t.handler==='absOnFormSubmit';}) && triggers.some(function(t){return t.handler==='absSafetySync';}),
      triggers:triggers.filter(function(t){return t.handler==='absOnFormSubmit'||t.handler==='absSafetySync';}),
      status:'checked'
    };
  } catch (err) {
    return {installed:null, triggers:[], status:'permission_unavailable', error:String(err&&err.message||err)};
  }
}


// ============================================================
// GESTÃO DE OBRA — CMFS / DR. CLOVIS
// Base orçamentária: "Orçamento da Obra CLI_válido cliente.pdf" (12/06/2026)
// O orçamento detalhado (222 itens) fica no Index.html v40.
// A associação pedido -> item é SEMPRE explícita; nunca inferimos equivalência.
// ============================================================
const ABS_CONSTRUCTION_CLIENT = 'CMFS / Dr. Clovis';
const ABS_CONSTRUCTION_SHEET = '_APP GESTÃO OBRA';
const ABS_CONSTRUCTION_BUDGET_SOURCE = {
  fileId: '19Zu1QQOW64b5bCFQ2mHQP3AwYqe7zYI2',
  title: 'Orçamento da Obra CLI_válido cliente.pdf',
  date: '12/06/2026',
  budgetDate: '2026-06-12',
  project: 'Complexo Clínico - Clínica Médica',
  owner: 'Dr. Clóvis Arns da Cunha',
  url: 'https://drive.google.com/file/d/19Zu1QQOW64b5bCFQ2mHQP3AwYqe7zYI2/view'
};
const ABS_CONSTRUCTION_BUDGET = [
  {code:'1.0', name:'Serviços Preliminares', material:29711.57, labor:200001.70, total:229713.27},
  {code:'2.0', name:'Infraestrutura', material:861768.02, labor:994797.52, total:1856565.55},
  {code:'3.0', name:'Superestrutura', material:942603.78, labor:450832.86, total:1393436.64},
  {code:'4.0', name:'Alvenarias e Revestimentos', material:512139.22, labor:518420.59, total:1030559.81},
  {code:'5.0', name:'Impermeabilizações e Coberturas', material:65815.57, labor:49855.94, total:115671.51},
  {code:'6.0', name:'Pavimentações', material:491491.41, labor:169458.31, total:660949.73},
  {code:'7.0', name:'Esquadrias', material:496617.30, labor:30506.86, total:527124.15},
  {code:'8.0', name:'Instalações', material:541827.05, labor:290247.89, total:832074.94},
  {code:'9.0', name:'Serviços Complementares', material:107960.09, labor:82598.02, total:190558.10}
];
const ABS_CONSTRUCTION_BASE_BUDGET = 6836653.71;
const ABS_CONSTRUCTION_ADMIN_FEE = 1025498.06;
const ABS_CONSTRUCTION_TOTAL = 7862151.77;

function ensureConstructionSheet_(ss) {
  let sh = ss.getSheetByName(ABS_CONSTRUCTION_SHEET);
  if (!sh) sh = ss.insertSheet(ABS_CONSTRUCTION_SHEET);
  const headers = [
    'LINK_ID','SOURCE_ROW','ORDER_NUMBER','BUDGET_CODE','BUDGET_GROUP','NOTES','CREATED_AT','ACTIVE',
    'BUDGET_ITEM_ID','BUDGET_ITEM_CODE','BUDGET_ITEM_DESCRIPTION'
  ];
  if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  const current = sh.getRange(1,1,1,headers.length).getDisplayValues()[0];
  let needsHeader = false;
  for (let i=0;i<headers.length;i++) if (String(current[i]||'').trim() !== headers[i]) { needsHeader=true; break; }
  if (needsHeader) sh.getRange(1,1,1,headers.length).setValues([headers]);
  sh.setFrozenRows(1);
  if (!sh.isSheetHidden()) sh.hideSheet();
  return sh;
}

function constructionGroupFromItemCode_(itemCode) {
  const m = String(itemCode||'').trim().match(/^(\d+)/);
  if (!m) return null;
  const code = m[1] + '.0';
  return ABS_CONSTRUCTION_BUDGET.filter(function(g){return g.code===code;})[0] || null;
}

function constructionGroups_() {
  return ABS_CONSTRUCTION_BUDGET.map(function(g){ return {
    code:g.code, name:g.name, material:g.material, labor:g.labor, total:g.total,
    committed:0, balance:g.total, percent:0, linkedOrders:0
  }; });
}

function constructionActiveLinks_(sh) {
  const vals = sh.getDataRange().getValues();
  const out=[];
  for (let i=1;i<vals.length;i++) {
    const r=vals[i];
    if (!r || !String(r[0]||'').trim()) continue;
    const active = String(r[7]==null?'TRUE':r[7]).trim().toUpperCase();
    if (active === 'FALSE' || active === '0' || active === 'NÃO' || active === 'NAO') continue;
    out.push({
      sheetRow:i+1,
      linkId:String(r[0]||''),
      sourceRow:Number(r[1]||0),
      orderNumber:String(r[2]||''),
      budgetCode:String(r[3]||''),
      budgetGroup:String(r[4]||''),
      notes:String(r[5]||''),
      createdAt:String(r[6]||''),
      itemId:String(r[8]||''),
      itemCode:String(r[9]||''),
      itemDescription:String(r[10]||'')
    });
  }
  return out;
}

function constructionOrderDto_(o) {
  return {
    id:o.id,
    rowNumber:o.rowNumber,
    orderNumber:o.orderNumber,
    description:o.description,
    category:o.category,
    status:o.status,
    supplier:o.supplier,
    nf:o.nf,
    issueDate:o.issueDate,
    value:o.value,
    valueText:o.valueText
  };
}

function getConstructionManagement(clientName) {
  if (clientName !== ABS_CONSTRUCTION_CLIENT) {
    return {enabled:false, clientName:clientName, supportedClient:ABS_CONSTRUCTION_CLIENT, groups:[], links:[], orders:[]};
  }
  const ctx = readClient_(clientName);
  const orders = buildFullOrderRows_(ctx.display);
  const sh = ensureConstructionSheet_(ctx.ss);
  const rawLinks = constructionActiveLinks_(sh);
  const byRow = {};
  orders.forEach(function(o){ byRow[Number(o.rowNumber)] = o; });
  const groups = constructionGroups_();
  const byCode = {};
  groups.forEach(function(g){ byCode[g.code]=g; });
  const links=[];
  let committed=0;
  rawLinks.forEach(function(l){
    const o=byRow[l.sourceRow] || null;
    const g=byCode[l.budgetCode] || constructionGroupFromItemCode_(l.itemCode);
    const cancelled = o ? /cancelado/.test(normalize_(o.status||'')) : false;
    const value = o && !cancelled ? Number(o.value||0) : 0;
    if (g) {
      g.committed += value;
      g.linkedOrders += 1;
      committed += value;
    }
    links.push({
      linkId:l.linkId,
      sourceRow:l.sourceRow,
      budgetCode:l.budgetCode || (g&&g.code) || '',
      budgetGroup:l.budgetGroup || (g&&g.name) || '',
      itemId:l.itemId,
      itemCode:l.itemCode,
      itemDescription:l.itemDescription,
      notes:l.notes,
      createdAt:l.createdAt,
      order:o ? constructionOrderDto_(o) : null,
      counted:!!(o && g && !cancelled),
      value:value
    });
  });
  groups.forEach(function(g){
    g.balance = g.total - g.committed;
    g.percent = g.total > 0 ? (g.committed / g.total) * 100 : 0;
  });
  return {
    enabled:true,
    clientName:clientName,
    generatedAt:now_(),
    source:ABS_CONSTRUCTION_BUDGET_SOURCE,
    baseBudget:ABS_CONSTRUCTION_BASE_BUDGET,
    adminFee:ABS_CONSTRUCTION_ADMIN_FEE,
    totalBudget:ABS_CONSTRUCTION_TOTAL,
    committed:committed,
    balance:ABS_CONSTRUCTION_BASE_BUDGET-committed,
    percent:ABS_CONSTRUCTION_BASE_BUDGET>0?(committed/ABS_CONSTRUCTION_BASE_BUDGET)*100:0,
    groups:groups,
    links:links,
    orders:orders.map(constructionOrderDto_)
  };
}

/**
 * Salva/atualiza um vínculo explícito entre um pedido oficial e um item do orçamento.
 * payload: {sourceRow,itemId,itemCode,itemDescription,notes}
 * Compatibilidade: payload.budgetCode continua aceito para vínculos antigos por grupo.
 */
function linkOrderToConstruction(clientName, payload) {
  if (clientName !== ABS_CONSTRUCTION_CLIENT) throw new Error('Gestão de Obra habilitada apenas para CMFS / Dr. Clovis nesta etapa.');
  payload = payload || {};
  const sourceRow = Number(payload.sourceRow||0);
  const itemId = String(payload.itemId||'').trim();
  const itemCode = String(payload.itemCode||'').trim();
  const itemDescription = String(payload.itemDescription||'').trim();
  let group = null;

  if (!sourceRow) throw new Error('Selecione um pedido válido.');
  if (itemId || itemCode) {
    if (!itemId || !/^orc_[a-z0-9_]+$/i.test(itemId)) throw new Error('Selecione um item válido do orçamento.');
    if (!itemCode) throw new Error('Código do item do orçamento não informado.');
    group = constructionGroupFromItemCode_(itemCode);
    if (!group) throw new Error('Não foi possível identificar o grupo do item selecionado.');
  } else {
    const budgetCode = String(payload.budgetCode||'').trim();
    group = ABS_CONSTRUCTION_BUDGET.filter(function(g){return g.code===budgetCode;})[0];
    if (!group) throw new Error('Selecione um grupo válido do orçamento.');
  }

  const ctx=readClient_(clientName), orders=buildFullOrderRows_(ctx.display);
  const order=orders.filter(function(o){return Number(o.rowNumber)===sourceRow;})[0];
  if (!order) throw new Error('Pedido não encontrado na planilha oficial.');

  const sh=ensureConstructionSheet_(ctx.ss), vals=sh.getDataRange().getValues();
  let targetRow=0, linkId='';
  for(let i=1;i<vals.length;i++){
    const active=String(vals[i][7]==null?'TRUE':vals[i][7]).trim().toUpperCase();
    if(Number(vals[i][1]||0)===sourceRow && active!=='FALSE' && active!=='0') {
      targetRow=i+1; linkId=String(vals[i][0]||''); break;
    }
  }
  if(!linkId) linkId=Utilities.getUuid();
  const row=[
    linkId,
    sourceRow,
    String(order.orderNumber||''),
    group.code,
    group.name,
    String(payload.notes||'').trim(),
    now_(),
    true,
    itemId,
    itemCode,
    itemDescription
  ];
  if(targetRow) sh.getRange(targetRow,1,1,row.length).setValues([row]);
  else sh.appendRow(row);
  return getConstructionManagement(clientName);
}

function unlinkOrderFromConstruction(clientName, linkId) {
  if (clientName !== ABS_CONSTRUCTION_CLIENT) throw new Error('Gestão de Obra habilitada apenas para CMFS / Dr. Clovis nesta etapa.');
  const ctx=readClient_(clientName), sh=ensureConstructionSheet_(ctx.ss), vals=sh.getDataRange().getValues();
  for(let i=1;i<vals.length;i++){
    if(String(vals[i][0]||'')===String(linkId||'')){
      sh.getRange(i+1,8).setValue(false);
      return getConstructionManagement(clientName);
    }
  }
  throw new Error('Vínculo não encontrado.');
}
