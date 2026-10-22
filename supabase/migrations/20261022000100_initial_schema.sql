-- Mapa de Territórios: esquema inicial.
-- Execute no SQL Editor do Supabase. Não contém chaves ou dados reais.

create extension if not exists pgcrypto;

create type public.app_role as enum ('admin', 'acompanhamento');
create type public.situacao_quadra as enum ('pendente', 'concluida', 'refazer');
create type public.tipo_evento_quadra as enum ('criada', 'situacao_alterada', 'observacao_alterada', 'geometria_alterada', 'arquivada');

create table public.perfis (
  user_id uuid primary key references auth.users(id) on delete cascade,
  papel public.app_role not null default 'acompanhamento',
  created_at timestamptz not null default now()
);

create table public.quadras (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^AC-[0-9]{3,}$'),
  geometria jsonb not null,
  ativa boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint geometria_tipo_valido check ((geometria->>'type') in ('Polygon', 'MultiPolygon'))
);

create table public.situacoes_quadras (
  quadra_id uuid primary key references public.quadras(id) on delete restrict,
  situacao public.situacao_quadra not null default 'pendente',
  observacao text not null default '' check (char_length(observacao) <= 2000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table public.historico_quadras (
  id uuid primary key default gen_random_uuid(),
  quadra_id uuid not null references public.quadras(id) on delete restrict,
  tipo_evento public.tipo_evento_quadra not null,
  situacao_anterior public.situacao_quadra,
  situacao_nova public.situacao_quadra,
  detalhes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null
);

create index historico_quadras_quadra_id_idx on public.historico_quadras(quadra_id, created_at desc);
create index quadras_ativas_idx on public.quadras(ativa);

create or replace function public.eh_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.perfis where user_id = auth.uid() and papel = 'admin'::public.app_role) $$;

revoke all on function public.eh_admin() from public;
grant execute on function public.eh_admin() to anon, authenticated;

create or replace function public.atualizar_situacao_quadra(p_quadra_id uuid, p_situacao public.situacao_quadra, p_observacao text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  anterior public.situacao_quadra;
  observacao_anterior text;
  atualizado_anterior timestamptz;
  resultado public.situacoes_quadras;
begin
  if auth.uid() is null then raise exception 'Sessão obrigatória'; end if;
  if p_observacao is not null and pg_catalog.char_length(p_observacao) > 2000 then raise exception 'Observação excede 2.000 caracteres'; end if;
  select s.situacao, s.observacao, s.updated_at into anterior, observacao_anterior, atualizado_anterior
    from public.situacoes_quadras s join public.quadras q on q.id = s.quadra_id
    where s.quadra_id = p_quadra_id and q.ativa for update of s;
  if anterior is null then raise exception 'Quadra ativa não encontrada'; end if;
  if anterior = p_situacao and (p_observacao is null or observacao_anterior = p_observacao) then
    return jsonb_build_object('quadra_id', p_quadra_id, 'situacao', anterior, 'observacao', observacao_anterior, 'updated_at', atualizado_anterior);
  end if;
  update public.situacoes_quadras set situacao = p_situacao, observacao = coalesce(p_observacao, observacao), updated_at = now(), updated_by = auth.uid() where quadra_id = p_quadra_id returning * into resultado;
  insert into public.historico_quadras (quadra_id, tipo_evento, situacao_anterior, situacao_nova, detalhes, user_id) values (p_quadra_id, case when anterior <> p_situacao then 'situacao_alterada'::public.tipo_evento_quadra else 'observacao_alterada'::public.tipo_evento_quadra end, anterior, p_situacao, jsonb_build_object('observacao_alterada', p_observacao is not null), auth.uid());
  return jsonb_build_object('quadra_id', resultado.quadra_id, 'situacao', resultado.situacao, 'observacao', resultado.observacao, 'updated_at', resultado.updated_at);
end;
$$;

revoke all on function public.atualizar_situacao_quadra(uuid, public.situacao_quadra, text) from public;
grant execute on function public.atualizar_situacao_quadra(uuid, public.situacao_quadra, text) to authenticated;

alter table public.perfis enable row level security;
alter table public.quadras enable row level security;
alter table public.situacoes_quadras enable row level security;
alter table public.historico_quadras enable row level security;

create policy perfis_select_self on public.perfis for select to authenticated using (user_id = auth.uid() or public.eh_admin());
create policy quadras_select_authenticated on public.quadras for select to authenticated using (ativa or public.eh_admin());
create policy situacoes_select_authenticated on public.situacoes_quadras for select to authenticated using (exists (select 1 from public.quadras q where q.id = quadra_id and (q.ativa or public.eh_admin())));
create policy historico_select_authenticated on public.historico_quadras for select to authenticated using (exists (select 1 from public.quadras q where q.id = quadra_id and (q.ativa or public.eh_admin())));

create policy quadras_admin_insert on public.quadras for insert to authenticated with check (public.eh_admin());
create policy quadras_admin_update on public.quadras for update to authenticated using (public.eh_admin()) with check (public.eh_admin());
create policy situacoes_admin_write on public.situacoes_quadras for all to authenticated using (public.eh_admin()) with check (public.eh_admin());

revoke all on public.perfis, public.quadras, public.situacoes_quadras, public.historico_quadras from anon;
revoke insert, update, delete on public.perfis, public.historico_quadras from authenticated;
grant select on public.perfis, public.quadras, public.situacoes_quadras, public.historico_quadras to authenticated;
grant insert, update on public.quadras to authenticated;

-- Não há policies de insert/update/delete para histórico: o cliente não pode alterá-lo diretamente.
