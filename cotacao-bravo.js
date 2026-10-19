// Painel "Gerar mapa de cotação" (aba Cotações): envia orçamentos ao Bravo e acompanha o status.
(function () {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ROTULO = { enviado: 'Enviado', gerando: 'Gerando', pronto: 'Pronto', erro: 'Erro' };
  const st = { clientId: null, files: [], pedidos: [], timer: null, busy: false };
  const box = () => document.querySelector('#cotacao-bravo');
  const q = s => box()?.querySelector(s);
  const clientId = () => document.querySelector('#client-select')?.value || localStorage.getItem('dashboard-client') || 'deterlimp';
  const dataHora = v => v ? new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
  const tamanho = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  async function api(url, options = {}) {
    const r = await fetch(url, options); let data = {}; try { data = await r.json(); } catch {}
    if (!r.ok) throw new Error(data.error || 'Não foi possível concluir.'); return data;
  }
  function render() {
    const root = box(); if (!root) return;
    root.innerHTML = `<header class="cb-head"><div><span class="cb-eyebrow">BRAVO · MAPA DE COTAÇÃO</span><h2>Gerar mapa de cotação</h2><p>Envie os orçamentos (PDF ou imagem) ou escreva-os em texto. O Bravo monta o mapa no modelo da Absolutta e devolve o link da planilha aqui.</p></div></header>
      <div class="cb-grid"><form class="cb-form" data-form>
        <label>Título<input name="titulo" maxlength="200" placeholder="Ex.: Elétrica – pedido 123"></label>
        <label>Orçamentos em texto (opcional)<textarea name="texto" rows="5" placeholder="Fornecedor A: item, quantidade, preço…"></textarea></label>
        <label class="cb-drop">Arquivos de orçamento (PDF/imagem, até 20 MB cada)<input type="file" name="arquivos" multiple accept="application/pdf,image/*,text/plain"></label>
        <ul class="cb-files">${st.files.map((f, i) => `<li>${esc(f.name)} <small>${tamanho(f.size)}</small> <button type="button" data-remove="${i}" aria-label="Remover">×</button></li>`).join('')}</ul>
        <div class="cb-feedback" data-feedback role="alert" hidden></div>
        <button type="submit" class="cb-primary" ${st.busy ? 'disabled' : ''}>${st.busy ? 'Enviando…' : 'Gerar mapa de cotação'}</button>
      </form>
      <section class="cb-list"><h3>Pedidos enviados</h3>${st.pedidos.length ? `<ul>${st.pedidos.map(p => `<li class="cb-item"><div><strong>${esc(p.titulo)}</strong><small>${dataHora(p.criado_em)} · ${p.arquivos.length} arquivo(s)${p.texto ? ' · texto' : ''}</small>${p.mensagem ? `<small class="cb-msg">${esc(p.mensagem)}</small>` : ''}</div><div class="cb-side"><span class="cb-status cb-${esc(p.status)}">${ROTULO[p.status] || esc(p.status)}</span>${p.planilha_url ? `<a href="${esc(p.planilha_url)}" target="_blank" rel="noopener">Abrir planilha ↗</a>` : ''}</div></li>`).join('')}</ul>` : '<p class="cb-empty">Nenhum pedido enviado ainda.</p>'}</section></div>`;
  }
  function feedback(msg) { const el = q('[data-feedback]'); if (el) { el.textContent = msg; el.hidden = !msg; } }
  async function carregar() {
    try { st.pedidos = (await api('/api/cotacoes/pedidos?clientId=' + encodeURIComponent(st.clientId))).pedidos; }
    catch (e) { st.pedidos = []; render(); feedback(e.message); return agendar(); }
    const form = q('[data-form]'), saved = form ? { titulo: form.titulo.value, texto: form.texto.value } : null;
    render(); if (saved) { q('[data-form]').titulo.value = saved.titulo; q('[data-form]').texto.value = saved.texto; }
    agendar();
  }
  function agendar() { clearTimeout(st.timer); if (st.pedidos.some(p => p.status === 'enviado' || p.status === 'gerando')) st.timer = setTimeout(carregar, 10000); }
  async function enviar(form) {
    const titulo = form.titulo.value.trim(), texto = form.texto.value.trim();
    if (!texto && !st.files.length) return feedback('Anexe ao menos um orçamento ou escreva os orçamentos em texto.');
    st.busy = true; render(); q('[data-form]').titulo.value = titulo; q('[data-form]').texto.value = texto;
    try {
      const arquivos = [];
      for (const f of st.files) {
        const tipo = f.type || 'application/octet-stream';
        const alvo = await api('/api/cotacoes/arquivos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: st.clientId, nome: f.name, tipo, tamanho: f.size }) });
        const up = await fetch(alvo.url, { method: alvo.method || 'PUT', headers: { 'Content-Type': tipo }, body: f });
        if (!up.ok) throw new Error(`Falha ao enviar ${f.name}.`);
        arquivos.push({ nome: f.name, tipo, tamanho: f.size, path: alvo.path });
      }
      await api('/api/cotacoes/pedidos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: st.clientId, obra: document.querySelector('#client-select')?.selectedOptions?.[0]?.textContent?.trim() || '', titulo, texto, arquivos }) });
      st.files = []; st.busy = false; await carregar(); const limpo = q('[data-form]'); if (limpo) { limpo.titulo.value = ''; limpo.texto.value = ''; }
    } catch (e) { st.busy = false; render(); q('[data-form]').titulo.value = titulo; q('[data-form]').texto.value = texto; feedback(e.message); }
  }
  function bind() {
    document.addEventListener('submit', e => { if (e.target.matches('#cotacao-bravo [data-form]')) { e.preventDefault(); enviar(e.target); } });
    document.addEventListener('change', e => {
      if (e.target.matches('#cotacao-bravo input[type=file]')) { const form = e.target.form, t = form.titulo.value, x = form.texto.value; st.files.push(...e.target.files); render(); q('[data-form]').titulo.value = t; q('[data-form]').texto.value = x; }
      if (e.target.matches('#client-select')) setTimeout(() => setClient(clientId()), 0);
    });
    document.addEventListener('click', e => { const b = e.target.closest('#cotacao-bravo [data-remove]'); if (b) { const form = q('[data-form]'), t = form.titulo.value, x = form.texto.value; st.files.splice(Number(b.dataset.remove), 1); render(); q('[data-form]').titulo.value = t; q('[data-form]').texto.value = x; } });
  }
  function setClient(id) { if (id === st.clientId) return; st.clientId = id; st.files = []; st.pedidos = []; render(); carregar(); }
  function start() { if (!box()) return; bind(); setClient(clientId()); }
  window.CotacaoBravo = { setClient, recarregar: carregar };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
