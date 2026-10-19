// Pedidos de "mapa de cotação" enviados ao Bravo (bot da equipe).
// Fluxo: o navegador envia os arquivos direto ao armazenamento (URL assinada emitida pelo servidor),
// cria o pedido, o servidor chama o webhook do Bravo e o Bravo devolve o resultado no callback.
// Nenhum segredo vai para o navegador: chaves e tokens ficam só em variáveis de ambiente do servidor.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const STATUS_VALIDOS = ['enviado', 'gerando', 'pronto', 'erro'];
export const STATUS_CALLBACK = ['gerando', 'pronto', 'erro'];
export const LIMITE_ARQUIVO = 20 * 1024 * 1024; // por arquivo
export const MAX_ARQUIVOS = 10;
export const MAX_TEXTO = 50000;
const SETE_DIAS = 7 * 24 * 3600;
const TIPOS = /^(application\/pdf|image\/(png|jpe?g|webp|heic|heif)|text\/plain)$/i;
const BUCKET = () => process.env.COTACOES_BUCKET || 'cotacoes-orcamentos';

const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const sanitizeName = value => String(value || 'arquivo').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'arquivo';
const httpError = (status, message) => Object.assign(new Error(message), { status });
const isUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));

// Campos devolvidos ao navegador: nunca inclui callback_token_hash.
export function publico(row) {
  const { callback_token_hash, ...rest } = row || {};
  return { ...rest, arquivos: (row?.arquivos || []).map(({ nome, tipo, tamanho }) => ({ nome, tipo, tamanho })) };
}

// Validação do corpo enviado pelo Bravo no callback. Exportada para testes.
export function validarResultado(body) {
  const status = String(body?.status || '').trim().toLowerCase();
  if (!STATUS_CALLBACK.includes(status)) throw httpError(400, 'status inválido: use gerando, pronto ou erro.');
  const patch = { status };
  const url = body?.planilha_url == null ? '' : String(body.planilha_url).trim();
  if (url) {
    let parsed; try { parsed = new URL(url); } catch { throw httpError(400, 'planilha_url inválida.'); }
    if (parsed.protocol !== 'https:' || url.length > 2000) throw httpError(400, 'planilha_url precisa ser https.');
    patch.planilha_url = url;
  }
  if (status === 'pronto' && !patch.planilha_url) throw httpError(400, 'status pronto exige planilha_url.');
  if (body?.mensagem != null) patch.mensagem = String(body.mensagem).slice(0, 1000);
  if (status === 'erro' && !patch.mensagem) patch.mensagem = 'O Bravo informou erro sem detalhes.';
  return patch;
}

export function tokenConfere(header, tokenHash) {
  const match = /^Bearer\s+(\S+)$/i.exec(String(header || ''));
  if (!match || !tokenHash) return false;
  const a = Buffer.from(hash(match[1]), 'hex'), b = Buffer.from(String(tokenHash), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- Armazenamento ----------
function supabaseStore() {
  const base = process.env.SUPABASE_URL.replace(/\/$/, ''), key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const rest = async (pathname, options = {}) => {
    const response = await fetch(`${base}/rest/v1/${pathname}`, { ...options, headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(options.headers || {}) } });
    if (!response.ok) throw httpError(502, `Supabase respondeu ${response.status}: ${(await response.text()).slice(0, 200)}`);
    return response.status === 204 ? [] : response.json();
  };
  const encodePath = p => p.split('/').map(encodeURIComponent).join('/');
  return {
    tipo: 'supabase',
    async list(clientId) { return rest(`cotacao_pedidos?cliente_id=eq.${encodeURIComponent(clientId)}&order=criado_em.desc&limit=50`); },
    async get(id) { return (await rest(`cotacao_pedidos?id=eq.${id}&limit=1`))[0] || null; },
    async insert(row) { return (await rest('cotacao_pedidos', { method: 'POST', body: JSON.stringify(row) }))[0]; },
    async update(id, patch) { return (await rest(`cotacao_pedidos?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ ...patch, atualizado_em: new Date().toISOString() }) }))[0]; },
    async uploadTarget(filePath) {
      const response = await fetch(`${base}/storage/v1/object/upload/sign/${BUCKET()}/${encodePath(filePath)}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' });
      if (!response.ok) throw httpError(502, `Supabase Storage respondeu ${response.status}`);
      const { url } = await response.json();
      return { url: `${base}/storage/v1${url}`, method: 'PUT' };
    },
    async exists(filePath) {
      const response = await fetch(`${base}/storage/v1/object/info/${BUCKET()}/${encodePath(filePath)}`, { headers });
      return response.ok;
    },
    async downloadUrl(filePath) {
      const response = await fetch(`${base}/storage/v1/object/sign/${BUCKET()}/${encodePath(filePath)}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: SETE_DIAS }) });
      if (!response.ok) throw httpError(502, `Supabase Storage respondeu ${response.status}`);
      const { signedURL } = await response.json();
      return `${base}/storage/v1${signedURL}`;
    }
  };
}

// Armazenamento local (desenvolvimento/testes): JSON + arquivos em runtime_data.
export function localStore(dir, publicBase) {
  const db = path.join(dir, 'cotacao-pedidos.json'), files = path.join(dir, 'cotacao-arquivos');
  const secret = process.env.COTACOES_ARQUIVOS_SECRET || (localStore.secret ||= crypto.randomBytes(32).toString('hex'));
  const read = async () => { try { return JSON.parse(await fs.readFile(db, 'utf8')); } catch { return []; } };
  const write = async rows => { await fs.mkdir(dir, { recursive: true }); await fs.writeFile(db + '.tmp', JSON.stringify(rows, null, 2)); await fs.rename(db + '.tmp', db); };
  const sign = (filePath, exp, op) => crypto.createHmac('sha256', secret).update(`${op}:${filePath}:${exp}`).digest('hex');
  const signed = (filePath, op, seconds) => { const exp = Math.floor(Date.now() / 1000) + seconds; return `${publicBase()}/api/cotacoes/arquivos/local?${new URLSearchParams({ path: filePath, exp, op, sig: sign(filePath, exp, op) })}`; };
  return {
    tipo: 'local',
    async list(clientId) { return (await read()).filter(r => r.cliente_id === clientId).sort((a, b) => b.criado_em.localeCompare(a.criado_em)).slice(0, 50); },
    async get(id) { return (await read()).find(r => r.id === id) || null; },
    async insert(row) { const rows = await read(); const now = new Date().toISOString(); const full = { status: 'enviado', planilha_url: null, mensagem: null, criado_em: now, atualizado_em: now, ...row }; rows.push(full); await write(rows); return full; },
    async update(id, patch) { const rows = await read(); const row = rows.find(r => r.id === id); if (!row) return null; Object.assign(row, patch, { atualizado_em: new Date().toISOString() }); await write(rows); return row; },
    async uploadTarget(filePath) { return { url: signed(filePath, 'put', 900), method: 'PUT' }; },
    async exists(filePath) { try { await fs.access(path.join(files, filePath)); return true; } catch { return false; } },
    async downloadUrl(filePath) { return signed(filePath, 'get', SETE_DIAS); },
    // Rota local que imita a URL assinada do Storage.
    async handleLocal(req, res, url) {
      const filePath = url.searchParams.get('path') || '', exp = Number(url.searchParams.get('exp')), op = url.searchParams.get('op'), sig = url.searchParams.get('sig') || '';
      const expected = sign(filePath, exp, op);
      if (!/^[a-z0-9_-]+\/[0-9a-f-]{36}\/[a-zA-Z0-9._-]+$/.test(filePath) || exp < Date.now() / 1000 || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw httpError(403, 'Link de arquivo inválido ou expirado.');
      const target = path.join(files, filePath);
      if (op === 'put' && req.method === 'PUT') {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > LIMITE_ARQUIVO) throw httpError(413, 'Arquivo maior que 20 MB.'); chunks.push(chunk); }
        await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, Buffer.concat(chunks));
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); return;
      }
      if (op === 'get' && req.method === 'GET') { const data = await fs.readFile(target); res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': data.length }); res.end(data); return; }
      throw httpError(405, 'Operação não permitida.');
    }
  };
}

// ---------- Rotas ----------
function publicBaseFrom(req) {
  if (process.env.DASH_PUBLIC_URL) return process.env.DASH_PUBLIC_URL.replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http')).split(',')[0];
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}
// Preview da Vercel fica atrás de login. Se houver o segredo de "Protection Bypass for Automation",
// ele vai na URL de callback para o Bravo conseguir responder (só em preview, nunca em produção).
function withBypass(link) {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!secret || process.env.VERCEL_ENV !== 'preview') return link;
  const u = new URL(link); u.searchParams.set('x-vercel-protection-bypass', secret); return u.toString();
}

async function readJson(req, limit = 200 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw httpError(413, 'Requisição muito grande.'); chunks.push(chunk); }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw httpError(400, 'JSON inválido.'); }
}
const send = (res, status, data) => { const body = JSON.stringify(data); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) }); res.end(body); };

async function chamarBravo(payload) {
  const target = process.env.BRAVO_WEBHOOK_URL;
  if (!target) throw new Error('Webhook do Bravo não configurado (BRAVO_WEBHOOK_URL).');
  const headerName = process.env.BRAVO_WEBHOOK_HEADER || 'Authorization', token = process.env.BRAVO_WEBHOOK_TOKEN;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers[headerName] = /^authorization$/i.test(headerName) ? `Bearer ${token}` : token;
  const response = await fetch(target, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Webhook do Bravo respondeu ${response.status}.`);
}

export function createCotacaoPedidos({ clients, localDir, isVercel, store: injected }) {
  let publicBase = () => 'http://localhost';
  const getStore = () => {
    if (injected) return injected;
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return supabaseStore();
    if (isVercel) throw httpError(503, 'Armazenamento das cotações não configurado (Supabase) neste ambiente.');
    return (createCotacaoPedidos.local ||= localStore(localDir, () => publicBase()));
  };
  return async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/cotacoes/')) return false;
    try {
      publicBase = () => publicBaseFrom(req);
      const parts = url.pathname.split('/').filter(Boolean).slice(2); // após api/cotacoes
      const sameOrigin = () => { if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw httpError(403, 'Origem da solicitação não permitida.'); };
      const store = getStore();

      if (parts[0] === 'arquivos' && parts[1] === 'local' && store.handleLocal) { await store.handleLocal(req, res, url); return true; }

      // 1) Navegador pede onde enviar um arquivo.
      if (parts[0] === 'arquivos' && parts.length === 1 && req.method === 'POST') {
        sameOrigin();
        const body = await readJson(req), clientId = String(body.clientId || '');
        if (!clients[clientId]) throw httpError(400, 'Cliente inválido.');
        const tipo = String(body.tipo || ''), tamanho = Number(body.tamanho || 0);
        if (!TIPOS.test(tipo)) throw httpError(400, 'Envie PDF, imagem (PNG/JPG/WEBP/HEIC) ou TXT.');
        if (!(tamanho > 0) || tamanho > LIMITE_ARQUIVO) throw httpError(400, 'Cada arquivo pode ter até 20 MB.');
        const filePath = `${clientId}/${crypto.randomUUID()}/${sanitizeName(body.nome)}`;
        const target = await store.uploadTarget(filePath);
        send(res, 200, { path: filePath, ...target }); return true;
      }

      // 2) Criar pedido e chamar o Bravo.
      if (parts[0] === 'pedidos' && parts.length === 1 && req.method === 'POST') {
        sameOrigin();
        const body = await readJson(req), clientId = String(body.clientId || '');
        if (!clients[clientId]) throw httpError(400, 'Cliente inválido.');
        const texto = String(body.texto || '').trim().slice(0, MAX_TEXTO), titulo = String(body.titulo || '').trim().slice(0, 200);
        const arquivos = (Array.isArray(body.arquivos) ? body.arquivos : []).slice(0, MAX_ARQUIVOS + 1);
        if (arquivos.length > MAX_ARQUIVOS) throw httpError(400, `Envie no máximo ${MAX_ARQUIVOS} arquivos por pedido.`);
        if (!texto && !arquivos.length) throw httpError(400, 'Anexe ao menos um orçamento ou escreva os orçamentos em texto.');
        const limpos = [];
        for (const a of arquivos) {
          const p = String(a.path || '');
          if (!p.startsWith(clientId + '/') || !/^[a-z0-9_-]+\/[0-9a-f-]{36}\/[a-zA-Z0-9._-]+$/.test(p) || !(await store.exists(p))) throw httpError(400, `Arquivo não encontrado no armazenamento: ${a.nome || p}`);
          limpos.push({ nome: String(a.nome || path.basename(p)).slice(0, 200), tipo: String(a.tipo || '').slice(0, 100), tamanho: Number(a.tamanho || 0), path: p });
        }
        const token = crypto.randomBytes(32).toString('base64url');
        const row = await store.insert({ id: crypto.randomUUID(), cliente_id: clientId, obra: String(body.obra || '').slice(0, 200), titulo: titulo || `Mapa de cotação ${new Date().toLocaleDateString('pt-BR')}`, texto, arquivos: limpos, status: 'enviado', callback_token_hash: hash(token) });
        let saved = row;
        try {
          const callback = withBypass(`${publicBaseFrom(req)}/api/cotacoes/pedidos/${row.id}/resultado`);
          await chamarBravo({ pedido_id: row.id, cliente_id: row.cliente_id, obra: row.obra, titulo: row.titulo, texto: row.texto, arquivos: await Promise.all(limpos.map(async a => ({ nome: a.nome, tipo: a.tipo, url: await store.downloadUrl(a.path) }))), callback_url: callback, callback_token: token });
        } catch (error) {
          saved = await store.update(row.id, { status: 'erro', mensagem: `Não foi possível acionar o Bravo: ${error.message}` });
        }
        send(res, 201, { pedido: publico(saved) }); return true;
      }

      // 3) Lista para a aba Cotações.
      if (parts[0] === 'pedidos' && parts.length === 1 && req.method === 'GET') {
        const clientId = String(url.searchParams.get('clientId') || '');
        if (!clients[clientId]) throw httpError(400, 'Cliente inválido.');
        send(res, 200, { pedidos: (await store.list(clientId)).map(publico) }); return true;
      }

      // 4) Callback do Bravo.
      if (parts[0] === 'pedidos' && parts[2] === 'resultado' && parts.length === 3 && req.method === 'POST') {
        if (!isUuid(parts[1])) throw httpError(404, 'Pedido não encontrado.');
        const row = await store.get(parts[1]);
        if (!row || !tokenConfere(req.headers.authorization, row.callback_token_hash)) throw httpError(401, 'Token de retorno inválido.');
        if (row.status === 'pronto') throw httpError(409, 'Este pedido já está pronto.');
        const patch = validarResultado(await readJson(req, 20 * 1024));
        const saved = await store.update(row.id, patch);
        send(res, 200, { ok: true, pedido: { id: saved.id, status: saved.status, planilha_url: saved.planilha_url || null } }); return true;
      }
      throw httpError(404, 'Rota de cotações não encontrada.');
    } catch (error) {
      send(res, error.status || 500, { error: error.message || 'Erro inesperado.' }); return true;
    }
  };
}
