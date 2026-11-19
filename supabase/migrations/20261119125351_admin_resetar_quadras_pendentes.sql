create or replace function public.admin_resetar_quadras_pendentes()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  total_alteradas integer;
begin
  if not public.eh_admin() then
    raise exception 'Ação administrativa não autorizada';
  end if;

  with alvo as materialized (
    select s.quadra_id, s.situacao as situacao_anterior
    from public.situacoes_quadras s
    join public.quadras q on q.id = s.quadra_id
    where q.ativa = true
      and s.situacao <> 'pendente'::public.situacao_quadra
    for update of s
  ),
  atualizadas as (
    update public.situacoes_quadras s
    set
      situacao = 'pendente'::public.situacao_quadra,
      updated_at = now(),
      updated_by = auth.uid(),
      versao = s.versao + 1
    from alvo a
    where s.quadra_id = a.quadra_id
    returning s.quadra_id
  ),
  historicos as (
    insert into public.historico_quadras (
      quadra_id, tipo_evento, situacao_anterior, situacao_nova, detalhes, user_id
    )
    select
      a.quadra_id,
      'situacao_alterada'::public.tipo_evento_quadra,
      a.situacao_anterior,
      'pendente'::public.situacao_quadra,
      jsonb_build_object('origem', 'reset_administrativo'),
      auth.uid()
    from alvo a
    join atualizadas u on u.quadra_id = a.quadra_id
    returning id
  )
  select count(*)::integer into total_alteradas from historicos;

  return total_alteradas;
end;
$function$;

revoke all on function public.admin_resetar_quadras_pendentes() from public;
revoke all on function public.admin_resetar_quadras_pendentes() from anon;
grant execute on function public.admin_resetar_quadras_pendentes() to authenticated;