import test from "node:test";
import assert from "node:assert/strict";

process.env.VERCEL = "1";
const { parseSupplier } = await import("../server.mjs");

test("interpreta as 17 linhas compactadas do orçamento Nichele", () => {
  const text = `01. NICHELE FILIAL - MATRIZ
ProdutoDescriçãoMarcaUnQtd.PesoPreco Total
1112.796MICTORIO GELODECA LPC1,0008,600816,65816,65
21.022.581KIT BACIA C/CX ACOP ASPEN BR 6PCSDECA LPC3,00032,522954,902.864,70
3121.071CUBA EMB OVAL UNIV 49X36.5CM GELODECA LPC2,0005,200133,80267,60
4191.562ENG FLEX 40CM CRDECA MPC8,0000,15455,96447,68
5921.909CANO CHUV 40CM BRENERBRASPC1,0001,29623,2623,26
6281.836DUCHA BELLA DUCHA 4T 6800W 220VLORENZET ELETROPC1,0000,200113,30113,30
7187.985ACAB REG MAX 3/4 CRDECA MPC8,0000,20085,15681,20
8187.787TORN LAVAT MESA ALTA LINK CRDECA MPC2,0001,161393,04786,08
9382.786SIFAO SANF AJUST MULTIUSO 66CM BRTIGREPC12,0000,1288,92107,04
10753.364ANEL VED ESG P/BACIA C/GUIATIGREPC3,0000,25918,5155,53
11304.184ESPUDE BACIA SANITTIGREPC1,0000,0219,239,23
12194.310TB LIG BACIA CRDECA MPC1,0000,272257,68257,68
13126.731ASSENTO SANIT PLAST ASPEN BRDECA LPC3,0001,192153,98461,94
14317.337VALV ESCOAM 1602 CRDECA MPC2,0000,13061,65123,30
15545.402PARAF WC C/BUC 3359 10MM C/2IMPERATRIZPR12,0000,10022,22266,64
16316.668VEDA ROSCA 18X25MTIGREPC2,0000,02011,4922,98
17387.798TB SOLD 25MM 6.00MTIGREBR11,0001,14627,58303,38
Total produtos
7.608,19
Total pedido
7.808,19
Valor TC Out. desp. man
0,00 200,00
Valor frete
TOTAL GERAL
7.808,19`;
  const supplier = parseSupplier({ text, tables: [], method: "pdf-texto-node", confidence: 0.9 }, { name: "Nichele" });
  assert.equal(supplier.items.length, 17);
  assert.match(supplier.items[0].description, /MICTORIO GELO/i);
  assert.equal(supplier.items[0].quantity, 1);
  assert.equal(supplier.items[0].unitPrice, 816.65);
  assert.equal(supplier.items[1].quotedTotal, 2864.70);
  assert.equal(supplier.items[16].quantity, 11);
  assert.equal(supplier.officialTotal, 7808.19);
  assert.equal(supplier.otherCharges, 200);
});

test("une as descrições quebradas do Balaroti e separa frete do total", () => {
  const text = `BALAROTI
DescriçãoTamanhoMarcaR$ TotalR$ UnitárioQuantidadeDesc.
40cmTigre8 PC8,9071,2066546 - ENGATE FLEXIVEL 40CM BCO0,00
Astra1 PC29,9029,90
2464 - BRACO PARA CHUVEIRO PLASTICO 40CM
COM ROSCA DE 1/2 BRANCO CEB40*BR1
0,00
Blukit12 PC7,9094,80
8096 - SIFAO SANFONADO UNIVERSAL ATE 72CM
BRANCO
0,00
1.1/2\"Astra1 PC10,9010,902496 - ESPUDE 1.1/2\" BRANCO BS50,00
Deca3 KT959,902.879,70
159529 - KIT BACIA COM CAIXA ACOPLADA
COMPLETO ASPEN BRANCO KP.751.BR.17
0,00
1/2\"Docol1 PC796,90796,90
21190 - VALVULA MICTORIO 1/2\" PRESSMATIC
COMPACTA CROMADO 90170103006
0,00
Deca2 PC403,90807,80
25354 - TORNEIRA LAVATORIO MESA LINK BICA
ALTA CROMADO 1198.C.LNK
0,00
49x36,5cmDeca2 PC136,90273,80
31294 - CUBA EMBUTIR 49X36,5CM OVAL
BRANCO GELO L.37.17
0,00
Zagonel1 UN149,90149,90
154292 - DUCHA ELETRONICA MOMENT BRANCO
7500W 220V
0,00
18mmx25mTigre2 PC11,9023,802555 - VEDA ROSCA 18MMX25M0,00
25mmTigre11 TB25,90284,907417 - TUBO 25MM SOLD. 6M0,00
Deca1 PC815,90815,90
39573 - MICTORIO COM SIFAO INTEGRADO
BRANCO GELO M.715.17
0,00
Real8 UN33,90271,20
158439 - ACABAMENTO REGISTRO ABS 1/2, 3/4 E
1\" CROMADO C33 PARA DECA E DOCOL 33647
0,00
Frete:
Total do Orçamento:
R$ 86,44
R$ 6.597,14
SAC BALAROTI`;
  const supplier = parseSupplier({ text, tables: [], method: "pdf-texto-node", confidence: 0.9 }, { name: "Balaroti" });
  assert.equal(supplier.items.length, 13);
  assert.match(supplier.items[1].description, /BRACO PARA CHUVEIRO.*COM ROSCA/i);
  assert.equal(supplier.items[0].quantity, 8);
  assert.equal(supplier.items[0].unitPrice, 8.90);
  assert.equal(supplier.items[4].quotedTotal, 2879.70);
  assert.equal(supplier.freight, 86.44);
  assert.equal(supplier.officialTotal, 6597.14);
});
