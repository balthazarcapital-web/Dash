import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { normalizeDocument, buildMap, buildPurchaseOrder, documentWarnings } from '../lib/quotation-core.mjs';
import { exportQuotationWorkbook } from '../lib/quotation-export.mjs';
const request = () => normalizeDocument({number:'29',category:'Civil',work:'Obra de teste',items:[
  {description:'Cimento queimado',quantity:10,unit:'kg'},
  {description:'Lona com comprimento de 6m',quantity:6,unit:'m'},
  {description:'Silicone acético incolor',quantity:2,unit:'un'},
  {description:'Madeirite 14 mm',quantity:5,unit:'un'},
  {description:'Item não cotado',quantity:1,unit:'un'}
]},'request');
const supplier = (id='supplier') => normalizeDocument({name:'Fornecedor '+id,number:'123',payment:'PIX',validUntil:'2027-01-01',productsTotal:180,finalTotal:190,freight:10,discount:0,other:0,discountMode:'none',items:[
  {description:'CIMENTO QUEIMADO GALAO 5KG',quantity:2,unit:'GAL',unitPrice:50,lineTotal:100,packageQuantity:5,packageUnit:'kg'},
  {description:'LONA PECA COM 6M DE COMPRIMENTO',quantity:1,unit:'PC',unitPrice:60,lineTotal:60,packageQuantity:6,packageUnit:'m'},
  {description:'SELANTE SILICONE ACETICO INCOLOR',quantity:2,unit:'PC',unitPrice:10,lineTotal:20},
  {description:'Madeirite 11 mm',quantity:5,unit:'un',unitPrice:2,lineTotal:10},
  {description:'Extra fornecedor',quantity:1,unit:'un',unitPrice:3,lineTotal:3}
]},id);
function draft() {
  const r=request(),s=supplier();return {id:'draft-test-123',clientId:'deterlimp',request:r,suppliers:[s],matches:[0,1,2,3].map((n)=>({requestId:r.items[n].id,supplierId:s.id,parts:[{sourceId:s.items[n].id,factor:[5,6,1,1][n]}],mode:'sum',status:'equivalent',reason:'Evidência do documento.'}))};
}
test('10kg / 2 galões de 5kg, 6m / 1 peça e nomes distintos preservam relações no mapa',()=>{
  const d=draft(),before=structuredClone(d.request),m=buildMap(d);
  assert.deepEqual(d.request,before);
  assert.equal(m.rows[0].cells[0].comparable,true);assert.equal(m.rows[0].minimumUnit,10);assert.equal(m.rows[0].minimumTotal,100);
  assert.equal(m.rows[1].minimumTotal,60);assert.equal(m.rows[2].minimumTotal,20);
  assert.equal(m.rows[3].cells[0].comparable,false);assert.equal(m.rows[3].minimumTotal,null);
  assert.equal(m.rows[4].cells[0],null);assert.equal(m.rows[4].minimumTotal,null);
  assert.equal(m.extras.length,1);assert.equal(m.combinedMinimum,180);assert.equal(m.lowestRealProposal,190);
});
test('quantidade diferente, embalagem não comprovada e uso duplicado ficam pendentes',()=>{
  const d=draft();d.suppliers[0].items[0].quantity=1;d.suppliers[0].items[1].packageQuantity=null;
  let m=buildMap(d);assert.equal(m.rows[0].cells[0].comparable,false);assert.equal(m.rows[1].cells[0].comparable,false);
  d.matches.push({...d.matches[2],requestId:d.request.items[4].id});m=buildMap(d);assert.equal(m.rows[2].cells[0].comparable,false);
});
test('O.C. parcial exige aprovação, inclui somente selecionados, não usa o total da proposta',()=>{
  const d=draft(),a={supplierId:'supplier',items:[{sourceId:'supplier-1',quantity:1,note:''}],approvedBy:'Cliente teste',reference:'Aprovação de teste',confirmed:true,feesConfirmed:true,freight:5,discount:0,other:0};
  assert.throws(()=>buildPurchaseOrder(d,{...a,confirmed:false}),/Aguardando/);
  const oc=buildPurchaseOrder(d,a);assert.equal(oc.lines.length,1);assert.equal(oc.subtotal,50);assert.equal(oc.total,55);assert.match(oc.notice,/29/);
  assert.throws(()=>buildPurchaseOrder(d,{...a,items:[{sourceId:'supplier-5',quantity:1}]}),/extra ou divergente/);
  assert.throws(()=>buildPurchaseOrder(d,{...a,items:[a.items[0],a.items[0]]}),/repetido/);
  assert.throws(()=>buildPurchaseOrder(d,{...a,feesConfirmed:false}),/Confirme frete/);
  assert.throws(()=>buildPurchaseOrder(d,a,new Date('2028-01-01')),/vencida/);
});
test('desconto líquido é aplicado uma vez e totais divergentes são sinalizados',()=>{
  const d=draft();d.suppliers[0].items[0].lineTotal=90;d.suppliers[0].discountMode='included';
  const a={supplierId:'supplier',items:[{sourceId:'supplier-1',quantity:2,note:''}],approvedBy:'Cliente',reference:'Teste',confirmed:true,feesConfirmed:true,freight:0,discount:0,other:0};
  assert.equal(buildPurchaseOrder(d,a).total,90);
  assert.throws(()=>buildPurchaseOrder(d,{...a,discount:10}),/líquidos/);
  assert.ok(documentWarnings(d.suppliers[0]).some(w=>w.includes('difere')));
});
test('Excel contém fórmulas, ausências vazias, extras sublinhados e amarelo válido',async()=>{
  const book=new ExcelJS.Workbook();await book.xlsx.load(await exportQuotationWorkbook(draft()));
  const sheet=book.getWorksheet('Mapa de Cotação');assert.equal(sheet.getCell('H7').result,100);assert.ok(sheet.getCell('H7').formula.includes('COUNT'));
  assert.equal(sheet.getCell('E11').value,null);assert.equal(sheet.getCell('F11').value,null);
  assert.equal(sheet.conditionalFormattings.find(c=>c.ref==='E7').rules[0].style.fill.fgColor.argb,'FFFFF2CC');assert.ok(!sheet.conditionalFormattings.some(c=>c.ref==='E10'));
  assert.equal(sheet.getCell('F7').formula,'ROUND(D7*E7,2)');
  assert.equal(sheet.getCell('B12').font.underline,true);assert.equal(sheet.getCell('H12').value,null);
  assert.equal(book.getWorksheet('Propostas originais').getCell('F2').value,50);
});
test('ausência de preço não vira zero; destinatário divergente aparece na conferência',()=>{
  const d=draft();d.request.clientName='Cliente oficial';d.request.clientTaxId='12345678000100';d.suppliers[0].clientName='Outro cliente';d.suppliers[0].clientTaxId='98765432000100';
  for(const i of d.suppliers[0].items){i.unitPrice=null;i.lineTotal=null;}
  const m=buildMap(d);assert.equal(m.rows[0].cells[0].unitPrice,null);assert.equal(m.rows[0].cells[0].total,null);assert.equal(m.combinedMinimum,null);
  assert.ok(m.warnings.some(w=>w.includes('CPF/CNPJ do destinatário diverge')));
});
test('Excel da O.C. contém só a quantidade parcial autorizada e o total recalculado',async()=>{
  const d=draft(),a={supplierId:'supplier',items:[{sourceId:'supplier-1',quantity:1}],approvedBy:'Cliente teste',reference:'Aprovação de teste',confirmed:true,feesConfirmed:true,freight:5,discount:0,other:0};
  const book=new ExcelJS.Workbook();await book.xlsx.load(await exportQuotationWorkbook(d,'oc',a));const s=book.getWorksheet('Ordem de Compra');
  assert.equal(s.getCell('D7').value,1);assert.equal(s.getCell('F7').result,50);assert.equal(s.getCell('F12').result,55);assert.equal(s.getCell('B8').value,'Subtotal');
});
