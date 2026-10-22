-- Torna o mapa e a atualização colaborativa de situação públicos.
-- Mantém operações estruturais e papéis restritos a administradores autenticados.

drop policy if exists quadras_select_authenticated on public.quadras;
drop policy if exists situacoes_select_authenticated on public.situacoes_quadras;
drop policy if exists historico_select_authenticated on public.historico_quadras;
drop policy if exists situacoes_admin_write on public.situacoes_quadras;
drop policy if exists situacoes_admin_insert on public.situacoes_quadras;
drop policy if exists situacoes_admin_update on public.situacoes_quadras;
drop policy if exists quadras_admin_insert on public.quadras;
drop policy if exists quadras_admin_update on public.quadras;

create policy quadras_select_public on public.quadras
  for select to anon, authenticated
  using (ativa or public.eh_admin());

create policy situacoes_select_public on public.situacoes_quadras
  for select to anon, authenticated
  using (exists (select 1 from public.quadras q where q.id = quadra_id and (q.ativa or public.eh_admin())));

create policy historico_admin_select on public.historico_quadras
  for select to authenticated
  using (public.eh_admin());

revoke all on public.perfis, public.quadras, public.situacoes_quadras, public.historico_quadras from anon;
revoke insert, update, delete on public.perfis, public.quadras, public.situacoes_quadras, public.historico_quadras from anon, authenticated;
grant select on public.quadras, public.situacoes_quadras to anon;
grant select on public.perfis, public.quadras, public.situacoes_quadras, public.historico_quadras to authenticated;

revoke all on function public.eh_admin() from public;
grant execute on function public.eh_admin() to anon, authenticated;

create or replace function public.geometria_geojson_valida(p_geometria jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare
  tipo text; poligono jsonb; anel jsonb; ponto jsonb; coords jsonb; i integer; j integer; k integer; longitude numeric; latitude numeric;
begin
  if p_geometria is null or pg_catalog.jsonb_typeof(p_geometria) <> 'object' then return false; end if;
  if not (p_geometria ? 'type') or not (p_geometria ? 'coordinates') then return false; end if;
  tipo := p_geometria->>'type'; coords := p_geometria->'coordinates';
  if tipo is null or tipo not in ('Polygon', 'MultiPolygon') or pg_catalog.jsonb_typeof(coords) <> 'array' then return false; end if;
  if tipo = 'Polygon' then
    if pg_catalog.jsonb_array_length(coords) = 0 then return false; end if;
    for i in 0..pg_catalog.jsonb_array_length(coords)-1 loop
      anel := coords->i;
      if pg_catalog.jsonb_typeof(anel) <> 'array' then return false; end if;
      if pg_catalog.jsonb_array_length(anel) < 4 then return false; end if;
      if (anel->0) <> (anel->(pg_catalog.jsonb_array_length(anel)-1)) then return false; end if;
      for j in 0..pg_catalog.jsonb_array_length(anel)-1 loop
        ponto := anel->j;
        if pg_catalog.jsonb_typeof(ponto) <> 'array' then return false; end if;
        if pg_catalog.jsonb_array_length(ponto) < 2 then return false; end if;
        for k in 0..pg_catalog.jsonb_array_length(ponto)-1 loop
          if pg_catalog.jsonb_typeof(ponto->k) <> 'number' then return false; end if;
        end loop;
        longitude := (ponto->>0)::numeric; latitude := (ponto->>1)::numeric;
        if longitude < -180 or longitude > 180 or latitude < -90 or latitude > 90 then return false; end if;
      end loop;
    end loop;
    return true;
  end if;
  if pg_catalog.jsonb_array_length(coords) = 0 then return false; end if;
  for i in 0..pg_catalog.jsonb_array_length(coords)-1 loop
    poligono := coords->i;
    if not public.geometria_geojson_valida(pg_catalog.jsonb_build_object('type', 'Polygon', 'coordinates', poligono)) then return false; end if;
  end loop;
  return true;
end; $$;

revoke all on function public.geometria_geojson_valida(jsonb) from public;
grant execute on function public.geometria_geojson_valida(jsonb) to authenticated;

create or replace function public.admin_criar_quadra(p_codigo text, p_geometria jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare novo_id uuid; resultado jsonb;
begin
  if not public.eh_admin() then raise exception 'Ação administrativa não autorizada'; end if;
  if p_codigo is null or p_codigo !~ '^AC-[0-9]{3,}$' then raise exception 'Código de quadra inválido'; end if;
  if not public.geometria_geojson_valida(p_geometria) then raise exception 'Geometria GeoJSON inválida'; end if;
  insert into public.quadras (codigo, geometria, created_by) values (p_codigo, p_geometria, auth.uid()) returning id into novo_id;
  insert into public.situacoes_quadras (quadra_id, situacao, updated_by) values (novo_id, 'pendente', auth.uid());
  insert into public.historico_quadras (quadra_id, tipo_evento, situacao_nova, detalhes, user_id) values (novo_id, 'criada', 'pendente', jsonb_build_object('codigo', p_codigo), auth.uid());
  select jsonb_build_object('id', q.id, 'codigo', q.codigo, 'geometria', q.geometria, 'ativa', q.ativa) into resultado from public.quadras q where q.id = novo_id;
  return resultado;
end; $$;

create or replace function public.admin_atualizar_geometria(p_quadra_id uuid, p_geometria jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare resultado jsonb;
begin
  if not public.eh_admin() then raise exception 'Ação administrativa não autorizada'; end if;
  if not public.geometria_geojson_valida(p_geometria) then raise exception 'Geometria GeoJSON inválida'; end if;
  update public.quadras set geometria = p_geometria, updated_at = now() where id = p_quadra_id and ativa returning jsonb_build_object('id', id, 'codigo', codigo, 'geometria', geometria) into resultado;
  if resultado is null then raise exception 'Quadra ativa não encontrada'; end if;
  insert into public.historico_quadras (quadra_id, tipo_evento, detalhes, user_id) values (p_quadra_id, 'geometria_alterada', jsonb_build_object('geometria_atualizada', true), auth.uid());
  return resultado;
end; $$;

create or replace function public.admin_arquivar_quadra(p_quadra_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.eh_admin() then raise exception 'Ação administrativa não autorizada'; end if;
  update public.quadras set ativa = false, updated_at = now() where id = p_quadra_id and ativa;
  if not found then raise exception 'Quadra ativa não encontrada'; end if;
  insert into public.historico_quadras (quadra_id, tipo_evento, detalhes, user_id) values (p_quadra_id, 'arquivada', '{}'::jsonb, auth.uid());
  return true;
end; $$;

revoke execute on function public.admin_criar_quadra(text, jsonb), public.admin_atualizar_geometria(uuid, jsonb), public.admin_arquivar_quadra(uuid) from public;
revoke execute on function public.admin_criar_quadra(text, jsonb), public.admin_atualizar_geometria(uuid, jsonb), public.admin_arquivar_quadra(uuid) from anon;
grant execute on function public.admin_criar_quadra(text, jsonb), public.admin_atualizar_geometria(uuid, jsonb), public.admin_arquivar_quadra(uuid) to authenticated;

-- A função valida a quadra e grava situação + histórico em uma operação.
-- Acesso anônimo é intencional para o mapa público; não concede escrita direta.
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
  quadra_ativa boolean;
  resultado public.situacoes_quadras;
begin
  if p_observacao is not null and pg_catalog.char_length(p_observacao) > 2000 then
    raise exception 'Observação excede 2.000 caracteres';
  end if;
  select q.ativa into quadra_ativa from public.quadras q where q.id = p_quadra_id for update;
  if not found or not quadra_ativa then raise exception 'Quadra ativa não encontrada'; end if;
  select s.situacao, s.observacao, s.updated_at into anterior, observacao_anterior, atualizado_anterior
    from public.situacoes_quadras s join public.quadras q on q.id = s.quadra_id
    where s.quadra_id = p_quadra_id and q.ativa for update of s;
  if anterior is null then raise exception 'Quadra ativa não encontrada'; end if;
  if anterior = p_situacao and (p_observacao is null or observacao_anterior = p_observacao) then
    return jsonb_build_object('quadra_id', p_quadra_id, 'situacao', anterior, 'observacao', observacao_anterior, 'updated_at', atualizado_anterior);
  end if;
  update public.situacoes_quadras
    set situacao = p_situacao, observacao = coalesce(p_observacao, observacao), updated_at = now(), updated_by = auth.uid()
    where quadra_id = p_quadra_id returning * into resultado;
  insert into public.historico_quadras (quadra_id, tipo_evento, situacao_anterior, situacao_nova, detalhes, user_id)
    values (p_quadra_id, case when anterior <> p_situacao then 'situacao_alterada'::public.tipo_evento_quadra else 'observacao_alterada'::public.tipo_evento_quadra end, anterior, p_situacao, pg_catalog.jsonb_build_object('observacao_alterada', p_observacao is not null and p_observacao is distinct from observacao_anterior), auth.uid());
  return jsonb_build_object('quadra_id', resultado.quadra_id, 'situacao', resultado.situacao, 'observacao', resultado.observacao, 'updated_at', resultado.updated_at);
end;
$$;

revoke all on function public.atualizar_situacao_quadra(uuid, public.situacao_quadra, text) from public;
grant execute on function public.atualizar_situacao_quadra(uuid, public.situacao_quadra, text) to anon, authenticated;
