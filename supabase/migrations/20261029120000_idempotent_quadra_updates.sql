-- Idempotência e controle otimista de versão para alterações colaborativas.
-- Esta migration é aditiva e redefine a RPC antiga ao final para delegar
-- à mesma lógica versionada, preservando sua assinatura pública.

alter table public.situacoes_quadras
  add column if not exists versao integer not null default 0;

do $$
declare
  tipo text;
  nulo text;
  padrao text;
begin
  select c.data_type, c.is_nullable, c.column_default
    into tipo, nulo, padrao
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = 'situacoes_quadras'
     and c.column_name = 'versao';
  if tipo is distinct from 'integer' or nulo is distinct from 'NO'
     or padrao not in ('0', '0::integer', '(0)' , '(0)::integer') then
    raise exception 'Schema incompatível: public.situacoes_quadras.versao deve ser integer NOT NULL DEFAULT 0';
  end if;
end;
$$;

create table if not exists public.operacoes_situacao_quadras (
  operacao_id uuid primary key,
  quadra_id uuid not null references public.quadras(id) on delete restrict,
  situacao public.situacao_quadra not null,
  observacao text,
  versao_esperada integer,
  resultado jsonb not null,
  created_at timestamptz not null default now(),
  constraint operacoes_situacao_quadras_observacao_check
    check (observacao is null or pg_catalog.char_length(observacao) <= 2000)
);

create index if not exists operacoes_situacao_quadras_quadra_idx
  on public.operacoes_situacao_quadras (quadra_id, created_at desc);

alter table public.operacoes_situacao_quadras enable row level security;
revoke all on public.operacoes_situacao_quadras from public, anon, authenticated;

do $$
declare
  obrigatorias integer;
  tem_pk boolean;
  tem_fk boolean;
begin
  select count(*) into obrigatorias
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'operacoes_situacao_quadras'
     and ((column_name = 'operacao_id' and data_type = 'uuid' and is_nullable = 'NO')
       or (column_name = 'quadra_id' and data_type = 'uuid' and is_nullable = 'NO')
       or (column_name = 'situacao' and udt_name = 'situacao_quadra' and is_nullable = 'NO')
       or (column_name = 'observacao' and data_type = 'text')
       or (column_name = 'versao_esperada' and data_type = 'integer')
       or (column_name = 'resultado' and data_type = 'jsonb' and is_nullable = 'NO')
       or (column_name = 'created_at' and data_type = 'timestamp with time zone' and is_nullable = 'NO'));
  if obrigatorias <> 7 then
    raise exception 'Schema incompatível: public.operacoes_situacao_quadras possui colunas obrigatórias incompatíveis';
  end if;
  select exists (
    select 1 from pg_catalog.pg_constraint c
     where c.conrelid = 'public.operacoes_situacao_quadras'::regclass
       and c.contype = 'p'
       and c.conkey = array[(select attnum from pg_catalog.pg_attribute where attrelid = c.conrelid and attname = 'operacao_id')]
  ) into tem_pk;
  if not tem_pk then raise exception 'Schema incompatível: chave primária de operacoes_situacao_quadras.operacao_id ausente'; end if;
  select exists (
    select 1 from pg_catalog.pg_constraint c
     where c.conrelid = 'public.operacoes_situacao_quadras'::regclass
       and c.contype = 'f'
       and pg_catalog.pg_get_constraintdef(c.oid) like '%(quadra_id)%public.quadras%'
  ) into tem_fk;
  if not tem_fk then raise exception 'Schema incompatível: FK de operacoes_situacao_quadras.quadra_id ausente'; end if;
end;
$$;

create or replace function public.atualizar_situacao_quadra_v2(
  p_operacao_id uuid,
  p_quadra_id uuid,
  p_situacao public.situacao_quadra,
  p_observacao text default null,
  p_versao_esperada integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  quadra_ativa boolean;
  atual public.situacoes_quadras;
  operacao public.operacoes_situacao_quadras;
  resposta jsonb;
  nova_versao integer;
  mudou_situacao boolean;
  mudou_observacao boolean;
begin
  if p_operacao_id is null or p_quadra_id is null then
    raise exception 'Identificador da operação e da quadra são obrigatórios';
  end if;
  if p_observacao is not null and pg_catalog.char_length(p_observacao) > 2000 then
    raise exception 'Observação excede 2.000 caracteres';
  end if;

  -- Serializa o UUID mesmo quando chamadas concorrentes apontam para quadras diferentes.
  -- Assim, a segunda chamada pode reproduzir ou rejeitar o primeiro registro com clareza.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_operacao_id::text, 0));

  -- Primeiro serializa pela quadra. Isso faz duas chamadas simultâneas com o
  -- mesmo UUID reencontrarem a operação já gravada, em vez de duplicarem o evento.
  select q.ativa into quadra_ativa
    from public.quadras q
    where q.id = p_quadra_id
    for update;
  if not found then raise exception 'Quadra não encontrada'; end if;

  select o.* into operacao
    from public.operacoes_situacao_quadras o
    where o.operacao_id = p_operacao_id;
  if found then
    if operacao.quadra_id <> p_quadra_id
       or operacao.situacao <> p_situacao
       or operacao.observacao is distinct from p_observacao
       or operacao.versao_esperada is distinct from p_versao_esperada then
      raise exception 'UUID de operação já utilizado com parâmetros diferentes';
    end if;
    return jsonb_set(operacao.resultado, '{status}', to_jsonb('replayed'::text), true);
  end if;

  if not quadra_ativa then
    resposta := jsonb_build_object('status', 'rejected', 'operacao_id', p_operacao_id,
      'quadra_id', p_quadra_id, 'motivo', 'quadra_inativa');
    insert into public.operacoes_situacao_quadras
      (operacao_id, quadra_id, situacao, observacao, versao_esperada, resultado)
      values (p_operacao_id, p_quadra_id, p_situacao, p_observacao, p_versao_esperada, resposta);
    return resposta;
  end if;

  select s.* into atual
    from public.situacoes_quadras s
    where s.quadra_id = p_quadra_id
    for update;
  if not found then raise exception 'Situação da quadra não encontrada'; end if;

  if p_versao_esperada is not null and atual.versao <> p_versao_esperada then
    resposta := jsonb_build_object('status', 'conflict', 'operacao_id', p_operacao_id,
      'quadra_id', p_quadra_id, 'situacao', atual.situacao,
      'versao', atual.versao,
      'updated_at', atual.updated_at);
    insert into public.operacoes_situacao_quadras
      (operacao_id, quadra_id, situacao, observacao, versao_esperada, resultado)
      values (p_operacao_id, p_quadra_id, p_situacao, p_observacao, p_versao_esperada, resposta);
    return resposta;
  end if;

  mudou_situacao := atual.situacao <> p_situacao;
  mudou_observacao := p_observacao is not null and p_observacao is distinct from atual.observacao;
  if not mudou_situacao and not mudou_observacao then
    resposta := jsonb_build_object('status', 'unchanged', 'operacao_id', p_operacao_id,
      'quadra_id', p_quadra_id, 'situacao', atual.situacao,
      'versao', atual.versao,
      'updated_at', atual.updated_at);
  else
    nova_versao := atual.versao + 1;
    update public.situacoes_quadras
      set situacao = p_situacao,
          observacao = coalesce(p_observacao, observacao),
          versao = nova_versao,
          updated_at = now(),
          updated_by = auth.uid()
      where quadra_id = p_quadra_id;
    insert into public.historico_quadras
      (quadra_id, tipo_evento, situacao_anterior, situacao_nova, detalhes, user_id)
      values (p_quadra_id,
        case when mudou_situacao then 'situacao_alterada'::public.tipo_evento_quadra
             else 'observacao_alterada'::public.tipo_evento_quadra end,
        atual.situacao, p_situacao,
        pg_catalog.jsonb_build_object('observacao_alterada', mudou_observacao,
          'versao_anterior', atual.versao, 'versao', nova_versao), auth.uid());
    resposta := jsonb_build_object('status', 'updated', 'operacao_id', p_operacao_id,
      'quadra_id', p_quadra_id, 'situacao', p_situacao,
      'versao', nova_versao,
      'updated_at', now());
  end if;

  insert into public.operacoes_situacao_quadras
    (operacao_id, quadra_id, situacao, observacao, versao_esperada, resultado)
    values (p_operacao_id, p_quadra_id, p_situacao, p_observacao, p_versao_esperada, resposta);
  return resposta;
end;
$$;

revoke all on function public.atualizar_situacao_quadra_v2(uuid, uuid, public.situacao_quadra, text, integer) from public, anon, authenticated;
grant execute on function public.atualizar_situacao_quadra_v2(uuid, uuid, public.situacao_quadra, text, integer) to anon, authenticated;

create or replace function public.consultar_operacao_situacao_quadra(p_operacao_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select o.resultado - 'observacao'
  from public.operacoes_situacao_quadras o
  where o.operacao_id = p_operacao_id
$$;

revoke all on function public.consultar_operacao_situacao_quadra(uuid) from public, anon, authenticated;
grant execute on function public.consultar_operacao_situacao_quadra(uuid) to anon, authenticated;

-- Mantém a assinatura antiga para clientes já publicados, mas usa a mesma
-- transação versionada da v2. O cliente antigo não fornece versão nem UUID;
-- por isso cada chamada recebe um UUID novo e continua não sendo idempotente
-- entre retries, embora passe a incrementar a versão e a serializar a quadra.
create or replace function public.atualizar_situacao_quadra(
  p_quadra_id uuid,
  p_situacao public.situacao_quadra,
  p_observacao text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.atualizar_situacao_quadra_v2(
    public.gen_random_uuid(), p_quadra_id, p_situacao, p_observacao, null
  );
end;
$$;

revoke all on function public.atualizar_situacao_quadra(uuid, public.situacao_quadra, text) from public;
grant execute on function public.atualizar_situacao_quadra(uuid, public.situacao_quadra, text) to anon, authenticated;
