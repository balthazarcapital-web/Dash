-- Pedidos de mapa de cotação enviados ao Bravo pela aba Cotações.
-- Somente cria objetos novos; não altera tabelas existentes.
create table if not exists public.cotacao_pedidos (
  id uuid primary key default gen_random_uuid(),
  cliente_id text not null,
  obra text,
  titulo text not null,
  texto text not null default '',
  arquivos jsonb not null default '[]'::jsonb, -- [{nome,tipo,tamanho,path}]
  status text not null default 'enviado' check (status in ('enviado','gerando','pronto','erro')),
  planilha_url text,
  mensagem text,
  callback_token_hash text not null, -- sha256 do token de retorno; o token em si nunca é guardado
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists cotacao_pedidos_cliente_idx on public.cotacao_pedidos (cliente_id, criado_em desc);
alter table public.cotacao_pedidos enable row level security;
-- Acesso apenas pelo backend (service role); nada exposto ao navegador.
revoke all on public.cotacao_pedidos from anon, authenticated;

-- Bucket privado para os arquivos de orçamento (até 20 MB por arquivo).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cotacoes-orcamentos', 'cotacoes-orcamentos', false, 20971520,
        array['application/pdf','image/png','image/jpeg','image/webp','image/heic','image/heif','text/plain'])
on conflict (id) do nothing;
