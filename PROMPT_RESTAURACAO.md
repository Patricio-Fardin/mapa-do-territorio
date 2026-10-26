# Prompt de restauração do Mapa de Territórios

Use este documento como instrução para restaurar, continuar ou publicar o projeto existente. Preserve o código e os dados; não reconstrua a aplicação do zero.

## Repositório e estrutura

- Repositório GitHub: `Patricio-Fardin/mapa-do-territorio`; publicação: GitHub Pages, branch `main`.
- Stack: React, TypeScript, Vite, Leaflet, React-Leaflet, Leaflet Draw e Supabase JS.
- `src/App.tsx`: mapa público, autenticação e recuperação administrativa, situações e contadores.
- `src/components/AdminMap.tsx`: ferramentas administrativas de desenho, edição, arquivamento e exclusão.
- `src/lib/quadra-label.ts`: identifica o interior de polígonos e cria etiquetas não interativas.
- `src/lib/quadra-status.ts`: normaliza e valida os valores de situação.
- `src/lib/supabase.ts`: cliente com variáveis públicas `VITE_*`.
- `src/App.css`, `src/index.css`: estilos responsivos, cores e etiquetas.
- `supabase/migrations/`: esquema, funções, privilégios e políticas versionados.
- `.github/workflows/deploy.yml`: build e deploy do GitHub Pages em pushes para `main`.

Antes de editar, confira branch, `git status`, último commit local e `origin/main`, faça `git fetch origin` e revise todo o diff. Preserve alterações locais e não use `git reset --hard`, `git clean` ou checkout destrutivo. Nunca leia ou imprima `.env.local`, tokens ou outras credenciais.

## Funcionalidade e autorização

- O mapa público mostra somente quadras ativas. Cada quadra mantém seu código; as geometrias suportam GeoJSON `Polygon` e `MultiPolygon`.
- A situação é `pendente`, `concluida` ou `refazer`, apresentada como PENDENTE cinza `#78858a`, CONCLUÍDA verde `#27ae60` ou REFAZER laranja `#e67e22`. As etiquetas usam um ponto calculado dentro do polígono, incluem código quando há espaço e não interceptam cliques.
- Visitantes podem alterar somente a situação usando `atualizar_situacao_quadra`; a interface reflete o resultado persistido.
- O login usa alias/senha via Supabase Auth `signInWithPassword`; o alias é mapeado para `VITE_ADMIN_LOGIN_EMAIL`. A autorização exige consulta de `public.perfis.papel = 'admin'` e as operações RPC verificam `public.eh_admin()` no servidor. Não altere usuários, perfis, senhas ou políticas RLS para contornar a autorização.
- RPCs administrativas: `admin_criar_quadra`, `admin_atualizar_geometria`, `admin_arquivar_quadra` e `admin_excluir_quadra`.
- Arquivar define `ativa = false`, retira do mapa público e preserva o registro e histórico. Excluir definitivamente é irreversível e remove histórico, situação e quadra pela RPC `admin_excluir_quadra`, somente após autorização administrativa e confirmação reforçada na interface. Nunca substitua essa RPC por `.delete()` direto no frontend.
- A migration da exclusão é dependência obrigatória para o frontend que apresenta a ação. A migration `20261026132516_admin_excluir_quadra.sql` foi informada como aplicada em produção antes da publicação desta interface.

## Migrations

Aplicar e validar na ordem:

1. `supabase/migrations/20261022000100_initial_schema.sql`
2. `supabase/migrations/20261022000200_public_map_admin_policies.sql`
3. `supabase/migrations/20261026132516_admin_excluir_quadra.sql`

A migration `20261026132516_admin_excluir_quadra.sql` consta como aplicada no projeto Supabase de produção `bkjcfzotxfapgtxkoswb`, conforme confirmação do proprietário. Não a reaplique nesse projeto. O frontend que chama `admin_excluir_quadra` deve ser publicado após a aplicação da migration.

Antes de restaurar ou publicar contra um banco remoto:

1. Confirme o identificador do projeto com `supabase projects list`; confira nome e ref. O projeto de produção atualmente informado pelo proprietário tem ref `bkjcfzotxfapgtxkoswb`. Nunca escolha um projeto por suposição.
2. Confira `supabase migration list --project-ref <REF>` e compare o histórico local e remoto.
3. Execute `supabase db push --dry-run --project-ref <REF>` (use `--skip-vault` para não atualizar Vault a partir do config local). Prossiga somente se a prévia enumerar exatamente a migration pretendida e nenhuma outra mudança. Se a conexão, senha do banco ou prévia falhar, pare; não contorne o erro e não declare a migration aplicada. Para produção `bkjcfzotxfapgtxkoswb`, confirme a migration `20261026132516` no histórico e não tente reaplicá-la.
4. Aplique somente a migration aprovada com o comando CLI suportado e o mesmo `--project-ref`; nunca use `db reset`, `--include-seed`, edição manual do histórico de migrations ou execução da RPC contra quadras reais.
5. Verifique a migration e a definição/grants da função com consultas de leitura. Confirme `SECURITY DEFINER`, `search_path` vazio, verificação de `public.eh_admin()`, bloqueio da quadra, exclusões na ordem histórico/situação/quadra e ausência de `EXECUTE` para `anon` e `PUBLIC`.
6. Só após confirmar a migration, valide localmente o frontend, revise arquivos/staging, publique em `main` sem force push e acompanhe GitHub Actions até build e deploy verdes. Para a migration de exclusão já aplicada em produção, publique somente a interface e documentação, sem enviar essa migration como pendente para o banco.

O identificador de projeto dentro de `supabase/config.toml` não deve ser tratado como prova de qual banco será atingido. Use `--project-ref` explícito e confira a identidade antes de qualquer comando remoto. Não altere dados, RLS, funções ou permissões remotas sem necessidade identificada e autorização específica.

## Configuração local

Copie `.env.example` para `.env.local` e configure apenas:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_ADMIN_USERNAME` (alias demonstrativo; padrão `admin`)
- `VITE_ADMIN_LOGIN_EMAIL` (mapeamento público da conta Auth existente)

Variáveis `VITE_*` vão para o bundle. Nunca grave senha, service-role key, chave secreta ou credencial administrativa nelas, no código ou em arquivos versionados. O `.env.local` é ignorado pelo Git e não deve ser aberto, impresso ou incluído no commit. Para GitHub Actions, use as Actions Variables previstas pelo workflow.

No Windows, na raiz do checkout:

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run build
npm.cmd run lint
git diff --check
```

O build também executa `scripts/copy-404.mjs`; não altere seu comportamento sem solicitação específica. Valide as rotas localmente e não afirme testes de integração ou produção que não foram executados.

## Segurança de restauração e teste

- Preserve o checkout e os arquivos locais; não apague diretórios, não descarte alterações e não inclua artefatos alheios no commit.
- Não crie quadras, não execute exclusões e não faça alterações experimentais no banco de produção.
- Não aplique migrations até confirmar o ref do projeto, o histórico local/remoto e a prévia de `db push`.
- Testes destrutivos da RPC só podem ocorrer em um banco separado com dados descartáveis e procedimento de rollback revisado. Testes de build/lint não comprovam grants, autorização nem atomicidade remotos.
- Antes de publicar, execute build, lint e `git diff --check`; revise diff e lista exata de arquivos; faça push sem force; acompanhe o workflow até conclusão e registre o SHA e o resultado real.
