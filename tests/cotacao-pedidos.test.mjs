import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { validarResultado, tokenConfere, publico, createCotacaoPedidos } from '../lib/cotacao-pedidos.mjs';

test('resultado: aceita gerando, pronto com https e erro', () => {
  assert.deepEqual(validarResultado({ status: 'gerando' }), { status: 'gerando' });
  assert.equal(validarResultado({ status: 'pronto', planilha_url: 'https://docs.google.com/spreadsheets/d/x' }).planilha_url, 'https://docs.google.com/spreadsheets/d/x');
  assert.equal(validarResultado({ status: 'erro' }).mensagem, 'O Bravo informou erro sem detalhes.');
});
test('resultado: rejeita status inválido, pronto sem link e link não https', () => {
  for (const body of [{ status: 'enviado' }, { status: 'xyz' }, {}, { status: 'pronto' }, { status: 'pronto', planilha_url: 'http://x.com' }, { status: 'pronto', planilha_url: 'javascript:alert(1)' }])
    assert.throws(() => validarResultado(body), e => e.status === 400);
});
test('resultado: mensagem limitada a 1000 caracteres', () => {
  assert.equal(validarResultado({ status: 'erro', mensagem: 'a'.repeat(5000) }).mensagem.length, 1000);
});
test('token: só Bearer com o token correto confere', () => {
  const token = 'abc123', hash = crypto.createHash('sha256').update(token).digest('hex');
  assert.equal(tokenConfere('Bearer abc123', hash), true);
  assert.equal(tokenConfere('Bearer errado', hash), false);
  assert.equal(tokenConfere('abc123', hash), false);
  assert.equal(tokenConfere(undefined, hash), false);
});
test('lista pública nunca expõe hash do token nem caminho interno', () => {
  const p = publico({ id: '1', callback_token_hash: 'h', arquivos: [{ nome: 'a.pdf', tipo: 'application/pdf', path: 'x/y/a.pdf' }] });
  assert.equal(p.callback_token_hash, undefined); assert.equal(p.arquivos[0].path, undefined);
});
test('rota de resultado: 401 sem token, 200 com token, 409 depois de pronto', async () => {
  const token = 'tok_TESTE', id = crypto.randomUUID();
  const rows = { [id]: { id, status: 'enviado', callback_token_hash: crypto.createHash('sha256').update(token).digest('hex') } };
  const store = { get: async i => rows[i] || null, update: async (i, patch) => Object.assign(rows[i], patch) };
  const handle = createCotacaoPedidos({ clients: { test: 'x' }, store });
  const call = async (auth, body) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]); req.method = 'POST'; req.headers = { host: 'localhost', ...(auth ? { authorization: auth } : {}) };
    let status, out; const res = { writeHead(s) { status = s; }, end(b) { out = JSON.parse(b); } };
    await handle(req, res, new URL(`http://localhost/api/cotacoes/pedidos/${id}/resultado`)); return { status, out };
  };
  assert.equal((await call(null, { status: 'gerando' })).status, 401);
  assert.equal((await call('Bearer outro', { status: 'gerando' })).status, 401);
  assert.equal((await call(`Bearer ${token}`, { status: 'pronto' })).status, 400);
  assert.equal((await call(`Bearer ${token}`, { status: 'pronto', planilha_url: 'https://docs.google.com/spreadsheets/d/TESTE' })).status, 200);
  assert.equal(rows[id].status, 'pronto');
  assert.equal((await call(`Bearer ${token}`, { status: 'erro' })).status, 409);
});
