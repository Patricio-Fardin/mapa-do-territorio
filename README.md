# Mapa de Territórios

Aplicação web para acompanhar quadras territoriais em Alfredo Chaves, Espírito Santo. O frontend usa React, TypeScript, Vite, Leaflet e React-Leaflet; quando configurado, o Supabase fornece autenticação, dados persistidos e operações autorizadas.

## Funcionalidades

- Mapa OpenStreetMap centrado em Alfredo Chaves/ES, com layout responsivo e controles de zoom.
- Quadras com códigos automáticos no formato `AC-001`, `AC-002` etc.
- Desenho administrativo de polígonos com múltiplos vértices e edição posterior da geometria. O desenho é concluído pela interação normal do Leaflet Draw; a persistência usa `admin_criar_quadra` e `admin_atualizar_geometria`.
- Suporte a geometrias GeoJSON `Polygon` e `MultiPolygon`.
- Etiquetas permanentes no mapa público e administrativo com código e situação. O ponto da etiqueta é calculado dentro do polígono; em quadras pequenas a apresentação é compactada. As etiquetas não interceptam cliques.
- Situações públicas: **Pendente** (cinza `#78858a`), **Concluída** (verde `#27ae60`) e **Refazer** (laranja `#e67e22`). A alteração confirmada atualiza a situação, cor, etiqueta, contadores e percentual; a situação persistida pelo Supabase é carregada novamente do servidor.
- Contadores e seleção pública por toque, sem disponibilizar desenho, edição de limites ou exclusão aos visitantes.
- Atualizações do mapa por leitura do Supabase e Realtime quando habilitado.

## Acesso e autorização

- `/` apresenta o mapa público; `/admin` é a área administrativa.
- O login administrativo recebe alias e senha. O alias é normalizado sem diferenciar maiúsculas/minúsculas e mapeado para `VITE_ADMIN_LOGIN_EMAIL`; a autenticação usa `signInWithPassword`, sem envio de link mágico ou OTP no login.
- Depois de autenticar e ao recuperar uma sessão existente, a aplicação consulta `public.perfis` e só autoriza o usuário quando `papel = 'admin'`. Falha de consulta ou perfil não administrativo encerra a sessão local.
- A recuperação de senha é um fluxo separado do login e usa o Supabase Auth. Ela não cria usuários nem concede papel administrativo.
- Operações estruturais são executadas por RPCs que verificam `public.eh_admin()` no servidor. O cliente frontend não recebe chaves privilegiadas nem permissão de exclusão direta nas tabelas.

## Arquivar e excluir definitivamente

**Arquivar** chama `admin_arquivar_quadra`, define `ativa = false` e preserva o registro, situação e histórico. A quadra deixa de aparecer no mapa público e permanece localizável na lista administrativa de arquivadas.

**Excluir definitivamente** é uma ação distinta e irreversível. A interface exige digitar exatamente `EXCLUIR <código>` e uma confirmação final. A RPC `admin_excluir_quadra(p_quadra_id uuid)` valida a autorização administrativa no servidor e, na mesma transação, exclui os registros de `public.historico_quadras`, `public.situacoes_quadras` e `public.quadras`, nessa ordem. A interface chama exclusivamente essa RPC e só remove a quadra da lista após confirmação de sucesso. Usuários públicos não têm acesso à ação nem podem executar a RPC sem autorização administrativa.

## Supabase e migrations

As migrations do repositório, em ordem, são:

1. `supabase/migrations/20261022000100_initial_schema.sql` — tabelas, tipos, `eh_admin`, situação pública e políticas iniciais.
2. `supabase/migrations/20261022000200_public_map_admin_policies.sql` — políticas atuais e RPCs de criação, edição de geometria, arquivamento e atualização pública de situação.
3. `supabase/migrations/20261026132516_admin_excluir_quadra.sql` — RPC de exclusão definitiva e seus privilégios. Conforme informado, esta migration já foi aplicada ao Supabase de produção `bkjcfzotxfapgtxkoswb`; não a reaplique.

A migration de exclusão já foi aplicada ao projeto Supabase de produção `bkjcfzotxfapgtxkoswb`, conforme confirmação do proprietário. A interface que oferece a ação deve ser publicada depois da migration. Não reaplique essa migration. Antes de qualquer outra alteração de banco, confira o projeto e o histórico remoto e exija uma prévia que liste somente as migrations pretendidas. Este repositório não aplica migrations automaticamente.

Para desenvolvimento local, copie `.env.example` para `.env.local` e configure somente valores públicos:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_ADMIN_USERNAME=admin
VITE_ADMIN_LOGIN_EMAIL=
```

`VITE_ADMIN_USERNAME` é opcional (padrão `admin`) e `VITE_ADMIN_LOGIN_EMAIL` é o e-mail público de mapeamento da conta Auth já associada ao perfil administrador. Essas variáveis `VITE_*` ficam visíveis no bundle e não podem conter senhas, service role ou outras chaves secretas. `.env.local` é ignorado pelo Git. Para GitHub Pages, as mesmas variáveis públicas são configuradas como Actions Variables consumidas por `.github/workflows/deploy.yml`.

Não crie nem substitua a conta administrativa ou seu perfil para configurar o projeto. Não altere permissões ou dados remotos fora de uma mudança autorizada e revisada.

## Desenvolvimento e verificações

No Windows PowerShell, a partir da raiz do repositório:

```powershell
npm.cmd install
npm.cmd run dev
```

Abra `http://localhost:5173/mapa-do-territorio/`; a rota administrativa local é `/mapa-do-territorio/admin`. Para verificar alterações:

```powershell
npm.cmd run build
npm.cmd run lint
git diff --check
```

O build executa TypeScript, Vite e `scripts/copy-404.mjs`. O lint usa Oxlint. Antes de publicar, revise o diff e o status, confirme que nenhum arquivo de ambiente, credencial ou alteração alheia foi incluído e aguarde o workflow GitHub Actions de build e deploy.

## Testes e limitações

Build e lint locais não substituem testes reais de autenticação, privilégios ou transações no banco. Não teste exclusão no Supabase de produção e não use quadras reais como dados de teste. Verifique criação, edição e situações no mapa com dados de desenvolvimento; para testar a RPC de exclusão, use um projeto isolado com dados descartáveis e confirme que falhas revertem a operação. Não declare a exclusão remota testada sem uma execução autorizada e verificável.

Para restaurar o projeto com segurança, siga [`PROMPT_RESTAURACAO.md`](PROMPT_RESTAURACAO.md). O documento inclui a estrutura, migrations, checagens de projeto e cuidados para não apagar dados.

## Estrutura principal

- `src/App.tsx` — mapa público, autenticação e recuperação administrativa, situação e contadores.
- `src/components/AdminMap.tsx` — desenho, edição, arquivamento e exclusão administrativa.
- `src/lib/quadra-label.ts` — cálculo e renderização de etiquetas dentro dos polígonos.
- `src/lib/quadra-status.ts` — validação e normalização de situações.
- `src/lib/supabase.ts` — cliente Supabase configurado pelas variáveis públicas.
- `src/App.css` e `src/index.css` — estilos e responsividade.
- `supabase/migrations/` — esquema, políticas e RPCs versionadas.
- `.github/workflows/deploy.yml` — build e publicação no GitHub Pages.

## Publicação

O site é servido em `https://patricio-fardin.github.io/mapa-do-territorio/`. A migration `20261026132516_admin_excluir_quadra.sql` já foi informada como aplicada em `bkjcfzotxfapgtxkoswb`; esta publicação atualiza a interface após essa aplicação. Para migrations futuras, verifique o repositório e o projeto Supabase por identificador explícito, compare os históricos local/remoto, revise a prévia `db push --dry-run` e aplique somente a mudança pretendida. Confirme o workflow Actions desta publicação. Não use `db reset`, force push, exclusões de teste em produção nem publique a interface antes da migration correspondente.
