// Monta os dados do "Mapa de locações" a partir das linhas da planilha
// "Controle de Locações - Absolutta" (porta da lógica de atualizar_dados.py).
export const PLANILHA_LOCACOES_ID = "1VNcv3lmd57kTopxYmQb1aE_fBPL4s5D-wSMaduNagAs";

export const OBRAS = [
  { id: "carlos", cliente: "Carlos Bezerra", endereco: "Rua Virgínia Dalabona, 1202 - Orleans, Curitiba - PR", lat: -25.4296934, lng: -49.3633695, precisao: "número exato", chaves: ["carlos", "bezerra", "dolabona", "dalabona"] },
  { id: "solon", cliente: "Solon (Clínica Santa Gianna)", endereco: "Av. Nossa Senhora da Luz, 2373 - Jardim Social, Curitiba - PR, 82530-010", lat: -25.4236413, lng: -49.2414282, precisao: "número exato", chaves: ["solon", "gianna", "nossa senhora da luz", "jardim social"] },
  { id: "clovis", cliente: "Dr. Clóvis (Serviço de Infectologia / Obra CMSF)", endereco: "Rua Des. Vieira Cavalcanti, 1089 - Mercês, Curitiba - PR", lat: -25.4203202, lng: -49.2888797, precisao: "número exato", chaves: ["clovis", "infectologia", "cmsf", "vieira cavalcanti", "merces"] },
  { id: "deterlimp", cliente: "Deterlimp", endereco: "Av. das Cerejeiras, 619 - Capela Velha, Araucária - PR, 83705-340", lat: -25.5580835, lng: -49.3924825, precisao: "aproximada (só a avenida)", chaves: ["deterlimp", "araucaria", "cerejeiras"] }
];

const COLUNAS = {
  data_pedido: "data do pedido", locadora: "locadora", obra: "obra/cliente", item: "o que foi pedido", conversa: "conversa",
  nf_boleto: "recebido/enviado", data_baixa: "data da baixa", aviso: "aviso ao billy", obs: "observa",
  sol_entrega: "data da solicitacao da entrega", entrega: "data da entrega", sol_retirada: "data da solicitacao da retirada",
  retirada: "data da retirada", dias_locado: "dias locado", nf_chegou: "data de chegada da nf", enviado: "data do envio ao cliente",
  valor_venc: "valor/vencimento"
};

export const norm = s => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x00-\x7f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

export function dataIso(txt) {
  txt = String(txt || "").trim();
  let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(txt); if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(txt); if (m) return `20${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(txt); if (m) return txt;
  return null;
}

function valorVencimento(txt) {
  const v = /R\$\s*[\d.]+,\d{2}/.exec(txt || ""), d = /venc\w*\.?\s*(\d{2}\/\d{2}\/\d{4})/i.exec(txt || "");
  return { valor: v ? v[0] : "", vencimento: d ? d[1] : "", vencimento_iso: d ? dataIso(d[1]) : null };
}

function motivoExclusao(reg, alvo) {
  const obs = norm(reg.obs);
  if (obs.includes("cancelad")) return "Observações dizem cancelada";
  if (obs.includes("nao e locacao")) return "Observações dizem 'não é locação'";
  const item = norm(reg.item);
  if ((alvo.includes("carlos") || alvo.includes("bezerra")) && item.includes("locacao") && item.includes("betoneira 400l")) return "Carlos não tem locação de betoneira 400L (só a retirada)";
  return null;
}

// Sem coluna de status: "Na obra" vem das Observações (ex.: "Na obra: caçamba entregue em 16/10/2026").
export function naObraPelasObservacoes(obs) {
  const n = norm(obs);
  if (!/\bna obra\b/.test(n) || /\b(nao|ainda nao) (esta |chegou )?na obra\b/.test(n)) return "";
  const data = /entreg\w*\s+(?:em\s+)?(\d{2}\/\d{2}\/\d{4})/i.exec(obs) || /na obra\D{0,20}(\d{2}\/\d{2}\/\d{4})/i.exec(obs);
  return data ? data[1] : "Na obra";
}

export function montarDadosLocacoes(linhas, agora = new Date()) {
  linhas = (linhas || []).map(l => (l || []).map(c => String(c ?? "")));
  if (!linhas.length) throw new Error("Planilha de locações vazia.");
  const cab = linhas[0].map(norm);
  const idx = Object.fromEntries(Object.entries(COLUNAS).map(([k, v]) => [k, cab.findIndex(c => c.startsWith(v))]));
  if (idx.item < 0 || idx.obra < 0) throw new Error("Cabeçalho da planilha de locações não reconhecido.");
  const obras = OBRAS.map(({ chaves, ...o }) => ({ ...o, itens: [] }));
  const nao_mapeadas = [], excluidas = [];
  linhas.slice(1).forEach((lin, i) => {
    const n = i + 2;
    if (!lin.some(c => c.trim())) return;
    const g = k => (idx[k] >= 0 && idx[k] < lin.length ? lin[idx[k]].trim() : "");
    const entrega = g("entrega") || naObraPelasObservacoes(g("obs"));
    const reg = {
      linha: n, item: g("item"), locadora: g("locadora"), obra_planilha: g("obra"), data_pedido: g("data_pedido"), data_pedido_iso: dataIso(g("data_pedido")),
      conversa: g("conversa"), nf_boleto: g("nf_boleto"), data_baixa: g("data_baixa"), obs: g("obs"), dias_locado: g("dias_locado"), valor_venc: g("valor_venc"),
      linha_tempo: [["Solicitado", g("sol_entrega")], ["Entregue", entrega], ["Retirada solicitada", g("sol_retirada")], ["Retirado", g("retirada")], ["NF/boleto chegou", g("nf_chegou")], ["Enviado ao cliente", g("enviado")]]
    };
    Object.assign(reg, valorVencimento(reg.valor_venc));
    reg.pago = /\b(pago|paga|quitado|quitada)\b/.test(norm(lin.join(" ")));
    const alvo = norm(reg.obra_planilha), motivo = motivoExclusao(reg, alvo);
    if (motivo) { excluidas.push({ linha: n, item: reg.item, obra_planilha: reg.obra_planilha, motivo }); return; }
    const achou = obras.filter((o, j) => OBRAS[j].chaves.some(ch => alvo.includes(ch)));
    if (achou.length === 1) achou[0].itens.push(reg); else nao_mapeadas.push(reg);
  });
  const gerado_em = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(agora).replace(",", "");
  return { gerado_em, obras, nao_mapeadas, excluidas, fonte: "planilha" };
}
