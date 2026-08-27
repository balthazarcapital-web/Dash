// New quotation domain. No dependency on the previous quotation parser or state.
export const text = value => String(value ?? '').trim();
export const number = value => value === null || value === undefined || value === '' ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
export const round = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
export const norm = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function unit(value) {
  const u = norm(value).replace(/[.\s]/g, '');
  return ({ un: 'un', und: 'un', unidade: 'un', unidades: 'un', pc: 'un', pç: 'un', pca: 'un', peca: 'un', pecas: 'un', kg: 'kg', quilo: 'kg', quilograma: 'kg', m: 'm', mt: 'm', metro: 'm', metros: 'm', l: 'l', lt: 'l', litro: 'l', litros: 'l', g: 'g', gr: 'g' })[u] || u;
}
export function normalizeDocument(input, id = 'document') {
  if (!input || !Array.isArray(input.items)) throw new Error('O documento precisa ter uma lista de itens.');
  if (input.items.length > 200) throw new Error('Limite de 200 itens por documento. Separe o arquivo.');
  const doc = { ...input, id, items: input.items.map((item, index) => ({
    id: `${id}-${index + 1}`, code: text(item.code) || String(index + 1), description: text(item.description),
    quantity: number(item.quantity), unit: text(item.unit), unitPrice: number(item.unitPrice), lineTotal: number(item.lineTotal),
    packageQuantity: number(item.packageQuantity), packageUnit: text(item.packageUnit), attributes: text(item.attributes),
    evidence: text(item.evidence), page: text(item.page)
  })) };
  for (const field of ['freight', 'discount', 'other', 'productsTotal', 'finalTotal']) doc[field] = number(doc[field]);
  doc.notes = Array.isArray(doc.notes) ? doc.notes.map(text) : [];
  return doc;
}
export function documentWarnings(doc) {
  const warnings = [...(doc.notes || [])];
  doc.items.forEach(item => {
    if (!item.description || !(item.quantity > 0) || !item.unit) warnings.push(`Item ${item.code}: conferir descrição, quantidade e unidade.`);
    if (item.unitPrice !== null && item.lineTotal !== null && item.quantity > 0 && Math.abs(round(item.quantity * item.unitPrice) - item.lineTotal) > .05) warnings.push(`Item ${item.code}: quantidade × unitário difere do total informado (possível desconto ou arredondamento).`);
  });
  const sum = round(doc.items.reduce((total, item) => total + (item.lineTotal || 0), 0));
  if (doc.productsTotal !== null && doc.items.every(i => i.lineTotal !== null) && Math.abs(sum - doc.productsTotal) > .05) warnings.push(`Soma dos itens (${sum}) difere do subtotal informado (${doc.productsTotal}).`);
  if (doc.productsTotal !== null && doc.finalTotal !== null && doc.freight !== null && doc.other !== null && doc.discount !== null) {
    const calculated = round(doc.productsTotal + doc.freight + doc.other - (doc.discountMode === 'included' ? 0 : doc.discount));
    if (Math.abs(calculated - doc.finalTotal) > .05) warnings.push(`Total calculado (${calculated}) difere do total final informado (${doc.finalTotal}). Conferir desconto e despesas.`);
  }
  return [...new Set(warnings)];
}
function effectivePrice(item) {
  // A printed line total already includes any per-item reduction; do not discount it again.
  return number(item.lineTotal) !== null && item.quantity > 0 ? number(item.lineTotal) / item.quantity : number(item.unitPrice);
}
export function evaluateMatch(request, supplier, match, allMatches = []) {
  if (!match || !match.parts?.length) return null;
  const sources = match.parts.map(part => ({ item: supplier.items.find(item => item.id === part.sourceId), factor: number(part.factor) }));
  if (sources.some(({ item, factor }) => !item || !(factor > 0))) return { comparable: false, status: 'review', reason: 'Vínculo ou conversão inválidos.', unitPrice: null, total: null, sources: [] };
  const reasons = [text(match.reason)].filter(Boolean);
  let comparable = match.status === 'equivalent' || match.status === 'confirmed';
  if (match.status === 'confirmed' && !text(match.reason)) { comparable = false; reasons.push('Confirmação manual precisa de justificativa.'); }
  if (new Set(sources.map(s => s.item.id)).size !== sources.length) { comparable = false; reasons.push('Linha do fornecedor repetida no vínculo.'); }
  const duplicated = sources.some(({ item }) => allMatches.some(m => m !== match && m.requestId !== request.id && m.parts?.some(p => p.sourceId === item.id)));
  if (duplicated) { comparable = false; reasons.push('A mesma linha foi atribuída a mais de um item. Revise para não duplicar custos.'); }
  let coverage, value;
  if (match.mode === 'kit') {
    coverage = Math.min(...sources.map(s => s.item.quantity * s.factor));
    value = sources.reduce((sum, s) => sum + (effectivePrice(s.item) ?? 0) / s.factor, 0);
  } else {
    coverage = sources.reduce((sum, s) => sum + s.item.quantity * s.factor, 0);
    value = sources.reduce((sum, s) => sum + (s.item.lineTotal ?? (s.item.quantity * (s.item.unitPrice ?? 0))), 0) / coverage;
  }
  if (!(request.quantity > 0) || !sources.every(s => s.item.quantity > 0 && effectivePrice(s.item) !== null && effectivePrice(s.item) >= 0)) { comparable = false; reasons.push('Quantidade ou preço ausentes.'); }
  if (Math.abs(coverage - request.quantity) > .001 && match.status !== 'confirmed') { comparable = false; reasons.push(`Quantidade equivalente: ${coverage} ${request.unit}; pedido: ${request.quantity}. Confirmar diferença antes de comparar.`); }
  for (const s of sources) {
    const sameUnit = unit(s.item.unit) === unit(request.unit) && Math.abs(s.factor - 1) < .0001;
    const pack = unit(s.item.packageUnit) === unit(request.unit) && Math.abs((s.item.packageQuantity || 0) - s.factor) < .0001;
    const metric = (unit(s.item.unit) === 'g' && unit(request.unit) === 'kg' && s.factor === .001) || (unit(s.item.unit) === 'kg' && unit(request.unit) === 'g' && s.factor === 1000);
    if (!sameUnit && !pack && !metric && match.status !== 'confirmed') { comparable = false; reasons.push(`Conversão de ${s.item.unit} para ${request.unit} sem embalagem comprovada; confirmar.`); }
    // Numerical specification contradictions must not be promoted by semantic similarity alone.
    const thickness = desc => [...norm(desc).matchAll(/(\d+(?:[.,]\d+)?)\s*mm\b/g)].map(m => Number(m[1].replace(',', '.')));
    const a = thickness(request.description), b = thickness(s.item.description);
    if (a.length && b.length && !a.some(n => b.includes(n)) && match.status !== 'confirmed') { comparable = false; reasons.push('Medidas em mm divergentes.'); }
  }
  if (match.status === 'incompatible') comparable = false;
  const validValue = Number.isFinite(value) && value >= 0 && sources.every(s => effectivePrice(s.item) !== null && effectivePrice(s.item) >= 0 && s.item.quantity > 0);
  return { comparable: comparable && validValue, status: comparable && validValue ? 'equivalent' : 'review', reason: reasons.join(' '), coverage,
    unitPrice: validValue ? Number(value.toFixed(8)) : null, total: validValue ? round(value * request.quantity) : null,
    sources: sources.map(s => ({ ...s.item, factor: s.factor })), quotedTotal: round(sources.reduce((sum, s) => sum + (s.item.lineTotal ?? s.item.quantity * (s.item.unitPrice || 0)), 0)) };
}
export function validateDraft(draft) {
  if (!draft?.request?.items?.length) throw new Error('Importe e confira o pedido oficial primeiro.');
  if (!Array.isArray(draft.suppliers) || draft.suppliers.length < 1 || draft.suppliers.length > 8) throw new Error('Adicione de 1 a 8 propostas.');
  if (draft.request.items.some(item => !text(item.description) || !(item.quantity > 0) || !text(item.unit))) throw new Error('Complete descrição, quantidade e unidade de todos os itens do pedido.');
  const ids = [draft.request.id, ...draft.suppliers.map(s => s.id)];
  if (new Set(ids).size !== ids.length) throw new Error('Documentos duplicados no rascunho.');
  for (const doc of [draft.request, ...draft.suppliers]) {
    if (!Array.isArray(doc.items) || doc.items.length > 200 || new Set(doc.items.map(i => i.id)).size !== doc.items.length) throw new Error('Lista de itens inválida.');
  }
}
export function buildMap(draft) {
  validateDraft(draft);
  const rows = draft.request.items.map(request => {
    const cells = draft.suppliers.map(supplier => {
      const matches = (draft.matches || []).filter(m => m.supplierId === supplier.id);
      return evaluateMatch(request, supplier, matches.find(m => m.requestId === request.id), matches);
    });
    const valid = cells.filter(c => c?.comparable && c.total !== null);
    return { request, cells, minimumUnit: valid.length ? Math.min(...valid.map(c => c.unitPrice)) : null, minimumTotal: valid.length ? Math.min(...valid.map(c => c.total)) : null };
  });
  const extras = draft.suppliers.flatMap((supplier, supplierIndex) => {
    const used = new Set((draft.matches || []).filter(m => m.supplierId === supplier.id).flatMap(m => (m.parts || []).map(p => p.sourceId)));
    return supplier.items.filter(i => !used.has(i.id)).map(item => ({ supplierIndex, supplierId: supplier.id, item, reason: 'Item adicional do fornecedor e não constante no pedido original, ou ainda sem relação confirmada.' }));
  });
  const totals = draft.suppliers.map(supplier => ({ id: supplier.id, name: supplier.name, productsTotal: supplier.productsTotal, finalTotal: supplier.finalTotal, freight: supplier.freight, discount: supplier.discount, other: supplier.other, warnings: documentWarnings(supplier) }));
  const known = totals.filter(t => number(t.finalTotal) !== null);
  const fiscalWarnings = draft.suppliers.flatMap(s => {
    const tax = value => text(value).replace(/\D/g, '');
    return [tax(draft.request.clientTaxId) && tax(s.clientTaxId) && tax(draft.request.clientTaxId) !== tax(s.clientTaxId) ? `${s.name}: CPF/CNPJ do destinatário diverge do pedido. Conferir cadastro fiscal.` : '',
      text(draft.request.clientName) && text(s.clientName) && norm(draft.request.clientName) !== norm(s.clientName) ? `${s.name}: destinatário impresso “${s.clientName}” difere de “${draft.request.clientName}”. Conferir; nomes abreviados não comprovam divergência fiscal.` : ''].filter(Boolean);
  });
  const minimumCoverage = rows.filter(r => r.minimumTotal !== null).length;
  return { rows, extras, totals, combinedMinimum: minimumCoverage ? round(rows.reduce((n, r) => n + (r.minimumTotal || 0), 0)) : null, minimumCoverage, lowestRealProposal: known.length ? Math.min(...known.map(t => t.finalTotal)) : null,
    warnings: [...(draft.suppliers.length < 3 ? ['Menos de 3 fornecedores. Conferir a liberação de fornecedor único antes de aprovar.'] : []), ...fiscalWarnings, ...totals.flatMap(t => t.warnings.map(w => `${t.name}: ${w}`))] };
}
export function buildPurchaseOrder(draft, approval, now = new Date()) {
  validateDraft(draft);
  if (!text(draft.request.number)) throw new Error('Informe o número do pedido oficial antes de gerar a O.C. e a referência da Nota Fiscal.');
  if (!approval?.confirmed || !text(approval.approvedBy) || !text(approval.reference) || !approval.items?.length) throw new Error('Aguardando definição dos itens aprovados e registro da aprovação do cliente.');
  const supplier = draft.suppliers.find(s => s.id === approval.supplierId);
  if (!supplier) throw new Error('Selecione um único fornecedor para esta O.C.');
  if (!approval.feesConfirmed) throw new Error('Confirme frete, desconto e despesas aplicáveis a esta compra, inclusive se for parcial.');
  const expired = /^\d{4}-\d{2}-\d{2}$/.test(supplier.validUntil || '') && supplier.validUntil < now.toISOString().slice(0, 10);
  if (expired && !approval.validityConfirmed) throw new Error('Proposta vencida. Reconfirme as condições com o fornecedor antes da O.C.');
  const map = buildMap(draft), seen = new Set();
  const lines = approval.items.map(selected => {
    const source = supplier.items.find(i => i.id === selected.sourceId);
    if (!source || seen.has(source.id)) throw new Error('A O.C. contém item inexistente ou repetido.');
    seen.add(source.id);
    const price = effectivePrice(source), quantity = number(selected.quantity);
    if (price === null || price < 0 || !(quantity > 0) || !text(source.description) || !text(source.unit)) throw new Error('Item aprovado sem descrição, unidade, preço cotado ou quantidade válidos.');
    const linked = map.rows.filter(row => row.cells[draft.suppliers.indexOf(supplier)]?.sources.some(s => s.id === source.id));
    const uncertain = !linked.length || linked.some(r => !r.cells[draft.suppliers.indexOf(supplier)].comparable);
    if (uncertain && !text(selected.note)) throw new Error(`Explique a aprovação do item extra ou divergente: ${source.description}`);
    return { sourceId: source.id, description: source.description, officialDescription: linked.map(r => r.request.description).join(' / '), quantity, unit: source.unit, unitPrice: price, total: round(quantity * price), note: text(selected.note), extra: !linked.length };
  });
  const amounts = ['freight', 'discount', 'other'].map(k => number(approval[k]));
  if (amounts.some(n => n === null || n < 0)) throw new Error('Informe frete, desconto e despesas desta O.C.; use zero somente quando confirmado.');
  const subtotal = round(lines.reduce((sum, i) => sum + i.total, 0));
  if (supplier.discountMode === 'included' && amounts[1] > 0 && !text(approval.discountNote)) throw new Error('Os preços já são líquidos. Explique o novo desconto para não descontar duas vezes.');
  if (amounts[1] > subtotal + amounts[0] + amounts[2]) throw new Error('Desconto maior que o valor da O.C.');
  return { supplier, request: draft.request, lines, approval: { ...approval, items: undefined }, subtotal, freight: amounts[0], discount: amounts[1], other: amounts[2], total: round(subtotal + amounts[0] - amounts[1] + amounts[2]),
    notice: `Solicitamos informar o número do pedido ${draft.request.number || '(não informado)'} da Absolutta na Nota Fiscal.`,
    warnings: [expired ? 'Proposta vencida: condições reconfirmadas pelo operador.' : '', !text(approval.billingTaxId) ? 'Cadastro fiscal não informado; conferir antes do envio.' : '', !text(supplier.payment) ? 'Condição de pagamento não informada.' : ''].filter(Boolean) };
}
