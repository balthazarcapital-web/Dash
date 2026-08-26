-- Estrutura para espelhar o Drive sem substituir a fonte original.
create table if not exists public.drive_sync_records (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  drive_id text not null,
  parent_drive_id text,
  record_type text not null check (record_type in ('folder','file','order','quote','map')),
  name text not null,
  mime_type text,
  drive_url text,
  payload jsonb not null default '{}'::jsonb,
  content_hash text,
  drive_modified_at timestamptz,
  synced_at timestamptz not null default now(),
  unique (client_id, drive_id)
);

create index if not exists drive_sync_records_client_idx on public.drive_sync_records (client_id, record_type);
create index if not exists drive_sync_records_payload_idx on public.drive_sync_records using gin (payload);

alter table public.drive_sync_records enable row level security;

-- O painel usa o backend com a service key; não expomos essa tabela diretamente ao navegador.
revoke all on public.drive_sync_records from anon, authenticated;
