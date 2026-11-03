-- The admin UI no longer performs hard deletion of territory blocks.
-- Keep the legacy function definition, but remove access through the Data API.
REVOKE EXECUTE ON FUNCTION public.admin_excluir_quadra(uuid)
  FROM PUBLIC, anon, authenticated;
