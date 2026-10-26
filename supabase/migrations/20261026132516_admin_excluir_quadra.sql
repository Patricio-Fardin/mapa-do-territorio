-- A RPC executa em uma transação PostgreSQL; qualquer exceção reverte todas as exclusões.
create or replace function public.admin_excluir_quadra(p_quadra_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  quadra_encontrada uuid;
begin
  if auth.uid() is null then
    raise exception 'Sessão obrigatória';
  end if;
  if not public.eh_admin() then
    raise exception 'Ação administrativa não autorizada';
  end if;

  select q.id into quadra_encontrada
  from public.quadras q
  where q.id = p_quadra_id
  for update;
  if not found then
    raise exception 'Quadra não encontrada';
  end if;

  delete from public.historico_quadras h where h.quadra_id = p_quadra_id;
  delete from public.situacoes_quadras s where s.quadra_id = p_quadra_id;
  delete from public.quadras q where q.id = p_quadra_id;
  if not found then
    raise exception 'A exclusão da quadra não foi concluída';
  end if;

  return true;
end;
$$;

revoke all on function public.admin_excluir_quadra(uuid) from public;
revoke all on function public.admin_excluir_quadra(uuid) from anon;
grant execute on function public.admin_excluir_quadra(uuid) to authenticated;