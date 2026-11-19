-- Atualizacao em lote das quadras identificadas pelo marcador do mapa publico.
-- A operacao e atomica, versionada e idempotente; nenhuma gravacao parcial e aceita.

create table if not exists public.operacoes_marcacao_territorio (
  operacao_id uuid primary key,
  payload jsonb not null,
  resultado jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.operacoes_marcacao_territorio enable row level security;
revoke all on public.operacoes_marcacao_territorio from public, anon, authenticated;

create or replace function public.aplicar_marcacao_territorio(
  p_operacao_id uuid,
  p_situacao public.situacao_quadra,
  p_quadras jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  payload_operacao jsonb;
  resultado_existente jsonb;
  situacao_atual public.situacao_quadra;
  versao_atual integer;
  codigo_atual text;
  atualizado_em timestamptz;
  quadra_ativa boolean;
  resultado_quadras jsonb := '[]'::jsonb;
  resultado_final jsonb;
  total_alteradas integer := 0;
  total_recebidas integer;
  id_quadra uuid;
begin
  if p_operacao_id is null then
    raise exception 'Identificador da operacao e obrigatorio';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_operacao_id::text, 0));
  if p_situacao is null or p_situacao not in ('concluida'::public.situacao_quadra, 'refazer'::public.situacao_quadra) then
    raise exception 'Situacao de marcacao invalida';
  end if;
  if p_quadras is null or pg_catalog.jsonb_typeof(p_quadras) <> 'array' then
    raise exception 'A lista de quadras deve ser um array';
  end if;

  total_recebidas := pg_catalog.jsonb_array_length(p_quadras);
  if total_recebidas < 1 or total_recebidas > 250 then
    raise exception 'A marcacao deve conter entre 1 e 250 quadras';
  end if;

  if (
    select count(distinct value->>'id')
    from pg_catalog.jsonb_array_elements(p_quadras)
  ) <> total_recebidas then
    raise exception 'A marcacao contem quadras duplicadas';
  end if;

  for item in select value from pg_catalog.jsonb_array_elements(p_quadras)
  loop
    if pg_catalog.jsonb_typeof(item) <> 'object'
      or pg_catalog.jsonb_typeof(item->'id') <> 'string'
      or (item->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or pg_catalog.jsonb_typeof(item->'versao') <> 'number'
      or (item->>'versao') !~ '^[0-9]+$'
    then
      raise exception 'Identificador ou versao de quadra invalido';
    end if;
  end loop;

  payload_operacao := pg_catalog.jsonb_build_object('situacao', p_situacao, 'quadras', p_quadras);
  select o.payload, o.resultado
    into payload_operacao, resultado_existente
    from public.operacoes_marcacao_territorio o
    where o.operacao_id = p_operacao_id;
  if found then
    if payload_operacao <> pg_catalog.jsonb_build_object('situacao', p_situacao, 'quadras', p_quadras) then
      raise exception 'Identificador de operacao ja utilizado com outros parametros';
    end if;
    return pg_catalog.jsonb_set(resultado_existente, '{status}', pg_catalog.to_jsonb('replayed'::text), true);
  end if;
  payload_operacao := pg_catalog.jsonb_build_object('situacao', p_situacao, 'quadras', p_quadras);

  -- Bloqueia e confere todas as quadras antes de modificar qualquer uma.
  -- A ordem fixa por UUID evita deadlocks entre marcacoes simultaneas.
  for item in
    select value from pg_catalog.jsonb_array_elements(p_quadras)
    order by (value->>'id')::uuid
  loop
    id_quadra := (item->>'id')::uuid;
    select q.ativa, s.situacao, s.versao
      into quadra_ativa, situacao_atual, versao_atual
      from public.quadras q
      join public.situacoes_quadras s on s.quadra_id = q.id
      where q.id = id_quadra
      for update of q, s;
    if not found or quadra_ativa is distinct from true then
      raise exception 'Uma das quadras nao esta mais ativa';
    end if;
    if versao_atual <> (item->>'versao')::integer then
      return pg_catalog.jsonb_build_object(
        'status', 'conflict',
        'quadra_id', id_quadra,
        'versao_atual', versao_atual,
        'situacao_atual', situacao_atual
      );
    end if;
  end loop;

  for item in
    select value from pg_catalog.jsonb_array_elements(p_quadras)
    order by (value->>'id')::uuid
  loop
    id_quadra := (item->>'id')::uuid;
    select q.codigo, s.situacao, s.versao, s.updated_at
      into codigo_atual, situacao_atual, versao_atual, atualizado_em
      from public.quadras q
      join public.situacoes_quadras s on s.quadra_id = q.id
      where q.id = id_quadra;

    if situacao_atual <> p_situacao then
      update public.situacoes_quadras
        set situacao = p_situacao,
            versao = versao_atual + 1,
            updated_at = pg_catalog.now(),
            updated_by = auth.uid()
        where quadra_id = id_quadra
        returning updated_at into atualizado_em;

      insert into public.historico_quadras
        (quadra_id, tipo_evento, situacao_anterior, situacao_nova, detalhes, user_id)
      values (
        id_quadra,
        'situacao_alterada'::public.tipo_evento_quadra,
        situacao_atual,
        p_situacao,
        pg_catalog.jsonb_build_object(
          'origem', 'marcador_territorio',
          'operacao_id', p_operacao_id,
          'versao_anterior', versao_atual,
          'versao', versao_atual + 1
        ),
        auth.uid()
      );
      total_alteradas := total_alteradas + 1;
      resultado_quadras := resultado_quadras || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'id', id_quadra,
          'codigo', codigo_atual,
          'situacao', p_situacao,
          'versao', versao_atual + 1,
          'updated_at', atualizado_em,
          'alterada', true
        )
      );
    else
      resultado_quadras := resultado_quadras || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'id', id_quadra,
          'codigo', codigo_atual,
          'situacao', situacao_atual,
          'versao', versao_atual,
          'updated_at', atualizado_em,
          'alterada', false
        )
      );
    end if;
  end loop;

  resultado_final := pg_catalog.jsonb_build_object(
    'status', 'updated',
    'total_recebidas', total_recebidas,
    'total_alteradas', total_alteradas,
    'quadras', resultado_quadras
  );

  insert into public.operacoes_marcacao_territorio (operacao_id, payload, resultado)
    values (p_operacao_id, payload_operacao, resultado_final);

  return resultado_final;
end;
$$;

revoke all on function public.aplicar_marcacao_territorio(uuid, public.situacao_quadra, jsonb) from public, anon, authenticated;
grant execute on function public.aplicar_marcacao_territorio(uuid, public.situacao_quadra, jsonb) to anon, authenticated;
