import ExcelJS from 'exceljs';
import { buildMap, buildPurchaseOrder, round } from './quotation-core.mjs';
const currency = '"R$" #,##0.00';
const yellow = 'FFFFF2CC', navy = 'FF172638';
function style(sheet, widths) {
  sheet.columns = widths.map(width => ({ width }));
  sheet.views = [{ state: 'frozen', ySplit: 6, xSplit: 2 }];
  sheet.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, repeatRows: '1:6' };
  sheet.headerFooter.oddFooter = 'ABSOLUTTA | &P / &N';
  sheet.eachRow(row => row.eachCell(cell => { cell.font = { name: 'Calibri', size: 11 }; cell.alignment = { vertical: 'middle', wrapText: true }; }));
  for (const n of [1, 6]) {
    sheet.getRow(n).height = n === 1 ? 30 : 34;
    sheet.getRow(n).eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: navy } }; cell.font = { name: 'Calibri', size: n === 1 ? 16 : 10, bold: true, color: { argb: 'FFFFFFFF' } }; });
  }
}
function moneyCells(row, start, end) { for (let col = start; col <= end; col++) row.getCell(col).numFmt = currency; }
export async function exportQuotationWorkbook(draft, kind = 'map', approval) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Absolutta'; workbook.created = new Date(); workbook.calcProperties.fullCalcOnLoad = true;
  if (kind === 'oc') {
    const oc = buildPurchaseOrder(draft, approval), sheet = workbook.addWorksheet('Ordem de Compra');
    sheet.addRow(['ABSOLUTTA | ORDEM DE COMPRA']); sheet.mergeCells('A1:G1');
    sheet.addRow([`O.C. ${approval.number || 'Sem número'} | Pedido ${draft.request.category || ''} ${draft.request.number || ''}`]); sheet.mergeCells('A2:G2');
    sheet.addRow([`Obra: ${draft.request.work || draft.clientName || ''} | Cliente: ${draft.request.clientName || draft.clientName || 'Não informado'}`]); sheet.mergeCells('A3:G3');
    sheet.addRow([`Fornecedor: ${oc.supplier.name || 'Não informado'} | CNPJ: ${oc.supplier.taxId || 'Não informado'}`]); sheet.mergeCells('A4:G4');
    sheet.addRow([`Aprovação: ${approval.approvedBy} | ${approval.reference}`]); sheet.mergeCells('A5:G5');
    sheet.addRow(['ITEM', 'DESCRIÇÃO / ESPECIFICAÇÃO APROVADA', 'UN.', 'QTDE.', 'V. UNITÁRIO', 'V. TOTAL', 'OBSERVAÇÃO']);
    oc.lines.forEach((line, i) => {
      const n = i + 7;
      const row = sheet.addRow([i + 1, line.description, line.unit, line.quantity, line.unitPrice, { formula: `ROUND(D${n}*E${n},2)`, result: line.total }, `${line.officialDescription ? 'Pedido: ' + line.officialDescription + '. ' : 'EXTRA aprovado. '}${line.note}`]);
      row.height = 50; moneyCells(row, 5, 6);
    });
    const last = sheet.rowCount;
    sheet.addRow(['', 'Subtotal', '', '', '', { formula: `SUM(F7:F${last})`, result: oc.subtotal }]);
    sheet.addRow(['', 'Frete aprovado', '', '', '', oc.freight]);
    sheet.addRow(['', 'Desconto adicional aprovado', '', '', '', oc.discount]);
    sheet.addRow(['', 'Outras despesas aprovadas', '', '', '', oc.other]);
    const totalRow = sheet.addRow(['', 'TOTAL DA O.C.', '', '', '', { formula: `F${last+1}+F${last+2}-F${last+3}+F${last+4}`, result: oc.total }]); totalRow.font = { bold: true };
    for (let n = last + 1; n <= last + 5; n++) sheet.getRow(n).getCell(6).numFmt = currency;
    const notes = [
      ['Pagamento', oc.supplier.payment || 'Não informado'], ['Prazo de entrega', oc.supplier.delivery || 'Não informado'],
      ['Orçamento / data / validade', [oc.supplier.number, oc.supplier.date, oc.supplier.validityText || oc.supplier.validUntil].filter(Boolean).join(' | ') || 'Não informado'],
      ['Fornecedor / contato', [oc.supplier.address, oc.supplier.phone, oc.supplier.email, oc.supplier.seller].filter(Boolean).join(' | ') || 'Não informado'],
      ['Faturamento definido pelo operador', [approval.billingName, approval.billingTaxId, approval.billingAddress].filter(Boolean).join(' | ') || 'Não informado — confirmar antes do envio'],
      ['Local de entrega', approval.deliveryAddress || 'Não informado'], ['Instrução de NF', oc.notice],
      ['Observações', [approval.notes, approval.discountNote, ...oc.warnings].filter(Boolean).join(' | ') || '—']
    ];
    for (const [label, value] of notes) { const row = sheet.addRow(['', label, value]); sheet.mergeCells(row.number, 3, row.number, 7); row.height = 35; }
    style(sheet, [8, 58, 12, 12, 17, 20, 60]);
  } else {
    const map = buildMap(draft), sheet = workbook.addWorksheet('Mapa de Cotação'), audit = workbook.addWorksheet('Conferência'), source = workbook.addWorksheet('Propostas originais');
    const end = 4 + draft.suppliers.length * 2, unitCol = end + 1, totalCol = end + 2, noteCol = end + 3;
    sheet.addRow(['ABSOLUTTA | MAPA DE COTAÇÃO']); sheet.mergeCells(1, 1, 1, noteCol);
    sheet.addRow([`Pedido: ${draft.request.category || ''} ${draft.request.number || ''} | Obra: ${draft.request.work || draft.clientName || ''}`]); sheet.mergeCells(2, 1, 2, noteCol);
    sheet.addRow([`Cliente: ${draft.request.clientName || draft.clientName || 'Não informado'} | Documento: ${draft.request.source?.filename || 'Preenchimento manual'}`]); sheet.mergeCells(3, 1, 3, noteCol);
    sheet.addRow(['Itens oficiais preservados. Amarelo = menor valor comparável. Valores pendentes não participam dos mínimos.']); sheet.mergeCells(4, 1, 4, noteCol);
    sheet.addRow(['PRÉVIA PARA CONFERÊNCIA / SEM AUTORIZAÇÃO DE COMPRA AUTOMÁTICA']); sheet.mergeCells(5, 1, 5, noteCol);
    const header = ['ITEM', 'DESCRIÇÃO OFICIAL', 'UN.', 'QTDE.'];
    draft.suppliers.forEach(s => header.push(`${s.name || 'Fornecedor'} | UNIT.`, `${s.name || 'Fornecedor'} | TOTAL`));
    header.push('MENOR UNIT.', 'MENOR TOTAL', 'OBSERVAÇÕES'); sheet.addRow(header);
    audit.addRow(['ITEM', 'FORNECEDOR', 'STATUS', 'JUSTIFICATIVA', 'UNIT. COMPARÁVEL', 'TOTAL COMPARÁVEL']);
    map.rows.forEach((row, index) => {
      const values = [row.request.code || index + 1, row.request.description, row.request.unit, row.request.quantity], validUnitRefs = [], validTotalRefs = [];
      const n = index + 7;
      row.cells.forEach((cell, s) => {
        const unitLetter = sheet.getColumn(5 + 2*s).letter, totalLetter = sheet.getColumn(6 + 2*s).letter;
        values.push(cell?.unitPrice ?? null, cell?.total === null || cell?.total === undefined ? null : {formula:`ROUND(D${n}*${unitLetter}${n},2)`,result:cell.total});
        const a = audit.addRow([row.request.code, draft.suppliers[s].name, cell?.comparable ? 'Comparável' : cell ? 'Conferir equivalência' : 'Não cotado', cell?.reason || '', cell?.comparable ? { formula: `'Mapa de Cotação'!${unitLetter}${n}`, result: cell.unitPrice } : null, cell?.comparable ? { formula: `'Mapa de Cotação'!${totalLetter}${n}`, result: cell.total } : null]);
        validUnitRefs.push(`'Conferência'!E${a.number}`); validTotalRefs.push(`'Conferência'!F${a.number}`);
      });
      const minFormula = refs => `IF(COUNT(${refs.join(',')})=0,"",MIN(${refs.join(',')}))`;
      values.push({ formula: minFormula(validUnitRefs), result: row.minimumUnit ?? '' }, { formula: minFormula(validTotalRefs), result: row.minimumTotal ?? '' }, row.cells.map((cell, s) => cell?.reason ? `${draft.suppliers[s].name}: ${cell.reason}` : '').filter(Boolean).join('\n'));
      const data = sheet.addRow(values); data.height = 60; moneyCells(data, 5, totalCol);
      row.cells.forEach((cell, s) => {
        if (cell?.comparable) for (const [col,minCol] of [[5+2*s,unitCol],[6+2*s,totalCol]]) {
          const address=data.getCell(col).address, minimum=sheet.getCell(n,minCol).address;
          sheet.addConditionalFormatting({ref:address,rules:[{type:'expression',formulae:[`AND(ISNUMBER(${address}),ISNUMBER(${minimum}),${address}=${minimum})`],style:{fill:{type:'pattern',pattern:'solid',fgColor:{argb:yellow}}}}]});
        }
      });
    });
    for (const extra of map.extras) {
      const values = ['', `EXTRA - ${extra.item.description}`, extra.item.unit, extra.item.quantity];
      draft.suppliers.forEach((s, i) => values.push(i === extra.supplierIndex ? extra.item.unitPrice : null, i === extra.supplierIndex ? extra.item.lineTotal : null));
      values.push(null, null, extra.reason); const row = sheet.addRow(values); row.height = 42; row.getCell(2).font = { underline: true }; moneyCells(row, 5, totalCol);
    }
    sheet.addRow([]);
    for (const [label, field] of [['Subtotal real da proposta', 'productsTotal'], ['Frete informado', 'freight'], ['Condição literal do frete', 'freightText'], ['Desconto informado (não descontar novamente se líquido)', 'discount'], ['Outras despesas', 'other'], ['TOTAL FINAL REAL DO FORNECEDOR', 'finalTotal'], ['Pagamento', 'payment'], ['Prazo de entrega', 'delivery'], ['Validade da proposta', 'validityText'], ['Número do orçamento', 'number'], ['Data do orçamento', 'date'], ['Destinatário da proposta', 'clientName'], ['CPF/CNPJ do destinatário', 'clientTaxId']]) {
      const values = ['', label, '', '']; draft.suppliers.forEach(s => values.push(null, s[field] ?? null));
      const row = sheet.addRow(values); row.height = 32;
      if (['productsTotal','freight','discount','other','finalTotal'].includes(field)) moneyCells(row, 5, end);
    }
    const combined = sheet.addRow(['', 'SOMA DOS MENORES ITENS — compra combinada, sem fretes', '', '']);
    const totalLetter = sheet.getColumn(totalCol).letter;
    combined.getCell(totalCol).value = { formula: `IF(COUNT(${totalLetter}7:${totalLetter}${map.rows.length+6})=0,"",SUM(${totalLetter}7:${totalLetter}${map.rows.length+6}))`, result: map.combinedMinimum ?? '' }; combined.getCell(totalCol).numFmt = currency;
    const real = sheet.addRow(['', 'MENOR TOTAL REAL INFORMADO — conferir cobertura e escopo', '', '', map.lowestRealProposal]); real.getCell(5).numFmt = currency;
    const warning = sheet.addRow(['', map.warnings.join('\n') || 'Conferir antes de apresentar ao cliente.']); sheet.mergeCells(warning.number, 2, warning.number, noteCol); warning.height = Math.min(160, Math.max(35, map.warnings.length * 17));
    source.addRow(['FORNECEDOR', 'ITEM', 'DESCRIÇÃO COTADA', 'UN.', 'QTDE.', 'UNIT. IMPRESSO', 'TOTAL IMPRESSO', 'FONTE / EVIDÊNCIA']);
    draft.suppliers.forEach(s => s.items.forEach(i => { const row = source.addRow([s.name, i.code, i.description, i.unit, i.quantity, i.unitPrice, i.lineTotal, [s.source?.filename, i.page, i.evidence].filter(Boolean).join(' | ')]); row.height = 45; moneyCells(row, 6, 7); }));
    style(sheet, [8, 58, 10, 10, ...draft.suppliers.flatMap(() => [17,19]), 17,19,65]);
    // Preserve explicit extra formatting after general font styling.
    sheet.eachRow(row => { if (String(row.getCell(2).value).startsWith('EXTRA -')) row.getCell(2).font = { name:'Calibri',size:11,underline:true }; });
    audit.columns = [10,25,24,75,22,22].map(width=>({width})); source.columns = [25,10,60,10,12,19,19,65].map(width=>({width}));
    for (const tab of [audit,source]) { tab.views=[{state:'frozen',ySplit:1}];tab.eachRow(row=>row.eachCell(cell=>{cell.alignment={wrapText:true,vertical:'middle'};cell.font={name:'Calibri',size:11}}));tab.getRow(1).font={bold:true}; }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
