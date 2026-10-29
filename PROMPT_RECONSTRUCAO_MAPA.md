# Prompt mestre de reconstrução — Mapa de Territórios

**Revisado em 29 de outubro de 2026.** Este prompt é independente da conversa em que foi criado. Stack, arquivos, scripts e migrations foram rechecados na checkout disponível nessa data. Ele documenta o código versionado, não prova o estado remoto do Supabase nem o que está publicado no GitHub Pages. Leia também `AGENTS.md` (persona e regras persistentes), `PROMPT_RECONSTRUCAO.md` (prompt resumido) e `README.md` (estado do produto e roadmap).

---

## 1. Papel e missão

Atue como arquiteto de software e desenvolvedor full-stack responsável por reconstruir o **Mapa de Territórios**. O sistema acompanha quadras territoriais em Alfredo Chaves, Espírito Santo, usando uma aplicação web com mapa público e área administrativa.

Priorize fidelidade aos requisitos comprovados, segurança, integridade e consistência dos dados, acessibilidade, responsividade, manutenção e clareza operacional. Não declare como implementado, testado ou publicado algo que não tenha sido efetivamente realizado e verificado.

Reconstrua a aplicação progressivamente. Não comece substituindo tecnologias ou schema sem inspecionar o material disponível, distinguir fatos de lacunas e explicar as consequências.

## 2. Contexto verificado do sistema

### 2.1 Finalidade, usuários e acesso

- O mapa público apresenta quadras territoriais, seus códigos e situações.
- Visitantes podem ler quadras ativas e solicitar atualização de situação por uma RPC; as tabelas não concedem escrita direta a usuários `anon`.
- Usuários administrativos autenticam-se por Supabase Auth. A interface recebe alias e senha, compara alias após trim e sem diferenciar caixa, mapeia o alias ao e-mail configurado e usa `signInWithPassword`.
- O alias não concede autorização. Após login e ao recuperar sessão existente, o cliente consulta `public.perfis` pelo `user_id` e exige `papel = 'admin'`. As funções administrativas também validam `public.eh_admin()` no servidor.
- O enum de papéis também inclui `acompanhamento`, com default no schema, mas as capacidades de produto desse perfil não estão detalhadas além das policies presentes nas migrations.
- Recuperação de senha por e-mail é um fluxo separado; ela não é o fluxo do login com senha e não concede papel administrativo.

### 2.2 Funcionalidades públicas

- Exibe quadras com `ativa = true`, consultadas no Supabase em páginas de até 1000, ordenadas por `id`.
- Geometrias aceitas pelo contrato atual: GeoJSON `Polygon` e `MultiPolygon`.
- Clique no polígono seleciona a quadra e exibe código, situação e controles públicos de situação.
- Situações:
  - `pendente`: “Pendente”, cinza `#78858a`, símbolo de relógio `◷`.
  - `concluida`: “Concluída”, verde `#27ae60`, símbolo `✓`.
  - `refazer`: “Refazer”, laranja `#e67e22`, símbolo `⚠`.
- Contadores apresentam total, pendentes, concluídas e refazer.
- Rótulos são posicionados dentro de polígonos, ajustados ao espaço e não capturam cliques. O mapa público prioriza situação/símbolo; código pode ser omitido em quadras pequenas.
- Base cartográfica: tiles OpenStreetMap em `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`. Exiba a atribuição OpenStreetMap Contributors e o link de copyright.
- Centro inicial: `[-20.6353, -40.7498]`, zoom 14. Após carregar quadras, o mapa tenta enquadrar os limites; há controle para restaurar a visualização.
- A tela pública é map-first: mapa ocupa `100dvh` (com fallback `100vh`), cabeçalho translúcido flutuante e indicadores em chips sobre o mapa. O enquadramento inicial usa `fitBounds` com padding para não cobrir os elementos de interface.
- O painel da quadra é um overlay responsivo. A linha “Situação atual” substitui o texto temporariamente por “Aguardando…”/“Salvando…” e depois mostra o status confirmado ou “Erro ao salvar”; não existe uma área fixa de feedback abaixo dos botões. O estado de salvamento usa cor neutra, o erro fica vermelho, o motivo fica no atributo `title` da linha e ela pode receber foco de teclado.
- Em desktop, o painel adapta largura a partir de 641 px e pode ampliar até 440 px a partir de 1200 px. A linha de status mantém uma linha com altura/line-height estáveis; validar novamente em viewport estreita e ampla sempre que o CSS mudar.
- O layout adapta safe areas e controles para celular. Respeitar `prefers-reduced-motion` em novas animações.
- Dados carregam por consultas Supabase com paginação. Realtime é assinado quando configurado e há também atualização periódica. Não simule dados locais como se fossem persistidos se o Supabase estiver ausente.

### 2.3 Funcionalidades administrativas

- Rota `/admin` relativamente à base configurada; no GitHub Pages atual, `/mapa-do-territorio/admin`.
- Lista quadras ativas e arquivadas, contadores e situação; suporta atualizar dados.
- Leaflet Draw permite desenhar polígono com múltiplos vértices e editar geometrias existentes; `MultiPolygon` é apresentado por componentes e reconstruído ao salvar.
- Códigos têm o formato `AC-001` ou maior. O cliente propõe o próximo código com base nos existentes; unicidade final é garantida pela constraint do banco, não por uma leitura cliente.
- Criar quadra cria também situação inicial `pendente` e evento histórico via RPC.
- Arquivamento remove a quadra do mapa público, mas preserva dados e histórico via RPC.
- Exclusão permanente é diferente de arquivamento. Exige digitar `EXCLUIR <código>` e uma confirmação final; deve remover histórico, situação e quadra em operação servidor autorizada. Nunca implemente como delete direto do cliente.
- Operações administrativas revalidam a sessão e perfil admin antes de chamar RPC; estados busy evitam cliques duplicados em uma instância do componente.
- Leituras administrativas consultam separadamente quadras ativas e arquivadas; atualização por Realtime e intervalo de 30 segundos é implementada.

## 3. Stack e ferramentas verificadas

Os números abaixo foram observados em 27/10/2026 e os scripts foram rechecados em 29/10/2026. Ao reconstruir, leia o manifesto e lockfile atuais em vez de assumir que essas versões continuam sendo a escolha desejada.

| Tecnologia | Declarada | Instalada observada | Papel |
|---|---:|---:|---|
| React / React DOM | `^19.3.1` | `19.3.1` | Interface e montagem; Strict Mode ativo. |
| TypeScript | `~6.0.3` | `6.0.3` | Tipagem estática e `tsc -b`. |
| Vite | `^8.3.4` | `8.3.5` | Dev server e build; base `/mapa-do-territorio/`. |
| `@vitejs/plugin-react` | `^6.1.2` | `6.1.2` | Integração React do Vite. |
| `@supabase/supabase-js` | `^2.118.0` | `2.118.0` | Auth, PostgREST RPC/queries e Realtime. |
| Leaflet | `^1.9.4` | `1.9.4` | Mapa, camadas e geometrias. |
| React-Leaflet | `^5.0.0` | `5.0.0` | Adaptadores React para Leaflet. |
| Leaflet Draw | `^1.0.4` | `1.0.4` | Desenho e edição administrativa. |
| Oxlint | `^1.88.0` | `1.89.0` | Lint; config em `.oxlintrc.json`. |
| Supabase CLI | `^2.121.0` | `2.121.0` | Dependência de desenvolvimento para tarefas locais/CLI. |
| Tipos | React `^19.3.0`, Leaflet `^1.9.22`, Leaflet Draw `^1.0.13`, Node `^24.19.2` | Versões correspondentes do lock local | Desenvolvimento TypeScript. |
| Node.js / npm | `engines` não declarados | Node `v24.20.0`, npm `11.19.0` no ambiente inspecionado | CI fixa Node major 24; respeite o workflow. |
| Git | Não é dependência do frontend | `2.56.0.windows.2` no ambiente inspecionado | Versionamento. |
| GitHub Actions / Pages | YAML usa `checkout@v4`, `setup-node@v4`, `configure-pages@v5`, `upload-pages-artifact@v3`, `deploy-pages@v4` | Runner `ubuntu-latest` configurado | Build/deploy por Pages. |
| OpenStreetMap | Serviço externo, não pacote npm | Não aplicável | Tiles e crédito cartográfico. |
| Web Locks / `localStorage` / evento `storage` | APIs do navegador | Depende do runtime | Coordenação/persistência local para operação incerta. `BroadcastChannel` não é usado. |

Não há ESLint, biblioteca de ícones, framework de formulários ou runner de testes unitários/e2e declarado. Existe o script específico `npm.cmd run test:idempotent-migration` para verificar invariantes da migration; não o trate como cobertura de UI ou de integração remota. Não adicione dependências sem necessidade justificada.

## 4. Arquitetura e arquivos observados

Estrutura relevante da aplicação existente:

```text
src/
  App.tsx
  App.css
  index.css
  main.tsx
  components/AdminMap.tsx
  lib/supabase.ts
  lib/quadra-status.ts
  lib/quadra-label.ts
  assets/
scripts/
  copy-404.mjs
  set-admin-password.mjs
  validate-idempotent-migration.mjs
supabase/
  config.toml
  migrations/
.github/workflows/deploy.yml
vite.config.ts
tsconfig.json
tsconfig.app.json
tsconfig.node.json
.oxlintrc.json
.env.example
package.json
package-lock.json
index.html
README.md
AGENTS.md
PROMPT_RECONSTRUCAO.md
PROMPT_RECONSTRUCAO_MAPA.md
PROMPT_RESTAURACAO.md
```

- `src/App.tsx`: rotas leves baseadas em `import.meta.env.BASE_URL`/`popstate`, login e recuperação administrativa, mapa público, estados/consultas e consistência de situação.
- `src/components/AdminMap.tsx`: mapa, edição/desenho, consulta de quadras ativas/arquivadas e fluxos administrativos.
- `src/lib/supabase.ts`: cliente Supabase condicional às variáveis públicas; persistência/renovação de sessão e `detectSessionInUrl: false`.
- `src/lib/quadra-status.ts`: normalização/validação estrita dos enums e tratamento de relação ausente.
- `src/lib/quadra-label.ts`: cálculo aproximado de ponto interno e rótulo HTML criado com `textContent`, não interativo.
- `src/App.css`, `src/index.css`: componentes, responsividade, estados visuais e estilos globais.
- `src/main.tsx`: inicializa React em Strict Mode.
- `vite.config.ts`: configura `base: '/mapa-do-territorio/'`.
- `scripts/copy-404.mjs`: copia `dist/index.html` para `dist/404.html`, necessário para fallback de rotas no Pages. Preservar comportamento até mudança planejada.
- `scripts/set-admin-password.mjs`: fluxo operacional sensível descrito em “Segurança”; não automatize.
- `supabase/migrations/`: documentação executável do schema/regras locais, não prova do remoto.
- `supabase/config.toml`: configuração de desenvolvimento local, não fonte de verdade de projeto remoto. Referencia `./seed.sql`, que não apareceu na árvore atual.

## 5. Banco de dados e integrações comprovados localmente

As migrations locais encontradas, em ordem:

1. `supabase/migrations/20261022000100_initial_schema.sql`
2. `supabase/migrations/20261022000200_public_map_admin_policies.sql`
3. `supabase/migrations/20261026132516_admin_excluir_quadra.sql`
4. `supabase/migrations/20261029120000_idempotent_quadra_updates.sql`

### 5.1 Schema e relações

- Enums:
  - `public.app_role`: `admin`, `acompanhamento`.
  - `public.situacao_quadra`: `pendente`, `concluida`, `refazer`.
  - `public.tipo_evento_quadra`: `criada`, `situacao_alterada`, `observacao_alterada`, `geometria_alterada`, `arquivada`.
- `public.perfis`: `user_id uuid` chave primária e FK para `auth.users(id)` com cascade; `papel app_role` not null default `acompanhamento`; `created_at timestamptz`.
- `public.quadras`: `id uuid` PK/default UUID; `codigo text` unique e regex `^AC-[0-9]{3,}$`; `geometria jsonb` tipo GeoJSON Polygon/MultiPolygon; `ativa boolean`; `created_at`, `created_by` FK Auth com `ON DELETE SET NULL`, `updated_at`. Índice por `ativa`.
- `public.situacoes_quadras`: `quadra_id uuid` PK/FK quadra `ON DELETE RESTRICT`; `situacao` enum not null default pendente; `observacao text` not null default `''` limitada a 2000 caracteres; `updated_at`, `updated_by` FK Auth com `ON DELETE SET NULL`.
- `public.historico_quadras`: `id uuid` PK; `quadra_id` FK quadra `ON DELETE RESTRICT`; `tipo_evento`; situações anterior/nova nullable; `detalhes jsonb`; `created_at`; `user_id` FK Auth com `ON DELETE SET NULL`. Índice `(quadra_id, created_at desc)`.

### 5.2 RPCs e regras de autorização

- `eh_admin() -> boolean`: verifica `perfis` por `auth.uid()`/papel admin; `SECURITY DEFINER`, `search_path = ''`.
- `atualizar_situacao_quadra(p_quadra_id uuid, p_situacao public.situacao_quadra, p_observacao text DEFAULT NULL) -> jsonb`: mantém a assinatura legada, mas a migration 004 redefine a função para delegar à lógica versionada usando um UUID novo para cada chamada. Clientes legados continuam sem idempotência lógica entre retries, pois não enviam UUID nem versão esperada.
- `atualizar_situacao_quadra_v2(p_operacao_id uuid, p_quadra_id uuid, p_situacao public.situacao_quadra, p_observacao text, p_versao_esperada integer) -> jsonb`: exige versão esperada, usa um identificador estável de operação, aplica controle otimista de versão e pode devolver `updated`, `unchanged`, `conflict`, `rejected` ou `replayed`.
- `consultar_operacao_situacao_quadra(p_operacao_id uuid) -> jsonb`: consulta o resultado persistido da operação, removendo o campo de observação. A migration 004 cria `public.operacoes_situacao_quadras` com RLS habilitada e sem acesso direto para clientes; execução ocorre por funções autorizadas.
- `aplicar_situacao_quadra_idempotente(...)`: função interna `SECURITY DEFINER` compartilhada pelas RPCs legada e v2; serializa operações, armazena o resultado e evita duplicar efeito quando o mesmo UUID/parâmetros são repetidos. Isso descreve a migration local e não confirma o deploy remoto.
- `geometria_geojson_valida(p_geometria jsonb) -> boolean`: valida tipos, estrutura de anéis/coordenadas e limites de latitude/longitude conforme a migration 002.
- `admin_criar_quadra(p_codigo text, p_geometria jsonb) -> jsonb`: exige `eh_admin`, valida dados, cria quadra, situação `pendente` e evento `criada`.
- `admin_atualizar_geometria(p_quadra_id uuid, p_geometria jsonb) -> jsonb`: exige `eh_admin`, valida e atualiza quadra ativa e histórico.
- `admin_arquivar_quadra(p_quadra_id uuid) -> boolean`: exige `eh_admin`, marca inativa e grava histórico.
- `admin_excluir_quadra(p_quadra_id uuid) -> boolean`: migration 003 exige usuário autenticado/admin, bloqueia quadra e exclui histórico, situação e quadra na mesma função/transaction. Grants locais negam `public`/`anon` e permitem `authenticated`.
- RLS é habilitada nas quatro tabelas. A migration 002 permite leitura pública de quadras e situações ativas; quadras arquivadas são visíveis ao admin. Histórico é legível por administrador autenticado. `perfis` tem policy para o próprio usuário ou admin na migration inicial. Escrita direta em `anon`/`authenticated` é revogada pelas migrations e as operações usam RPC.
- Políticas/grants efetivos são a composição e sequência das migrations. Não invente regras adicionais sem consultar schema remoto em ambiente autorizado.

### 5.3 Estado remoto não comprovado

As migrations e configurações locais não confirmam o estado do projeto Supabase remoto. A migration `20261029120000_idempotent_quadra_updates.sql` e seus contratos são locais até que o histórico remoto e as definições efetivas sejam verificados em acesso autorizado. A documentação anterior registra como afirmação atribuída ao proprietário que `20261026132516_admin_excluir_quadra.sql` teria sido aplicada ao projeto `bkjcfzotxfapgtxkoswb`; isso também não foi confirmado nesta revisão. `project_id` de `supabase/config.toml` e arquivos `.temp` não identificam com segurança o destino remoto. Não execute migrations, queries de escrita ou alteração de dados como parte da reconstrução sem aprovação explícita.

## 6. Consistência das alterações de situação

Implementação atual em `src/App.tsx` (confirmar novamente se o código disponível divergir):

1. Antes da RPC, cria UUID v4 e tenta persistir em `localStorage` um registro versão 2 com ID da operação, ID/código da quadra, situação solicitada, estado e indicador de erro; o registro não contém credenciais ou tokens. Trate falhas de persistência como estado diagnóstico explícito e não afirme que a tentativa local ficou protegida quando não foi gravada.
2. O Web Lock usa um nome derivado da quadra e coordena abas cooperantes na mesma origem/perfil quando disponível. A implementação atual tem caminhos degradados quando Web Locks ou armazenamento não estão disponíveis; inspecione esses caminhos em vez de presumir bloqueio seguro global.
3. O registro de operação local usa uma chave de armazenamento e guarda uma operação incerta. Não deduza que o mecanismo fornece uma fila durável ou isolamento entre todos os dispositivos. Antes de alterar esse fluxo, teste em especial uma pendência de uma quadra seguida de alteração em outra.
4. Estados locais documentados:
   - `pending`: tentativa iniciada sem resultado conclusivo.
   - `transport-uncertain`: erro de transporte, timeout ou resposta ainda não validada.
   - `confirmed`: resposta RPC 2xx sem erro e payload validado para a quadra/situação esperadas.
   - `resolved`: tombstone/estado terminal local quando o fluxo de reconciliação o estabelece.
5. A migration 004 fornece UUID idempotente, controle otimista de versão e RPC `consultar_operacao_situacao_quadra`. O cliente deve consultar o registro da operação antes de inferir desfecho a partir da situação corrente. A reconciliação também tem caminhos de compatibilidade baseados em versão; inspecione-os no código atual.
6. Timeout da interface não cancela a RPC. Uma resposta atrasada ainda pode ser processada; não repita automaticamente gravações ambíguas nem afirme que uma leitura isolada prova que uma chamada remota terminou.
7. `localStorage` pode ser limpo/evicto e Web Locks não coordenam dispositivos, perfis ou navegadores diferentes. `storage` notifica abas mas não é um mutex. Não afirme que há fila offline ou coordenação global.

Garantias condicionais do cliente: Web Locks coordena abas cooperantes enquanto a API funciona; o armazenamento local pode ajudar na recuperação somente quando o registro foi efetivamente gravado e permanece disponível. O código tem caminhos de fallback quando Web Locks/localStorage falham; verifique se a operação prossegue sem persistência antes de afirmar qualquer garantia.

Não garantido: coordenação entre dispositivos/navegadores/perfis, sobrevivência à limpeza/evicção do armazenamento, prova de que a RPC parou após perda da resposta, nem impossibilidade de efeito remoto tardio. A migration local 004 acrescenta UUID idempotente, resultado persistido e RPC de consulta; antes de desenhar uma segunda solução, confirme se a migration foi aplicada e teste a reconciliação com respostas perdidas/atrasadas. Não confunda o código de migration com o contrato efetivamente implantado.

## 7. Requisitos verificáveis de reconstrução

Implemente e valide critérios de aceitação:

### Mapa público

- Mostra somente quadras ativas e trata Polygon/MultiPolygon sem presumir dados malformados.
- Código, polígono, rótulo, situação, legenda/contagem e seleção representam o mesmo dado persistido.
- Rótulos não impedem interação com o polígono e reduzem/omitem conteúdo em polígonos pequenos.
- Atribuição OpenStreetMap permanece visível.
- Mapa funciona em telas estreitas, preserva safe areas, controles têm nomes acessíveis e botão restaura limites/centro.
- Estados de falha/ausência Supabase são explícitos; dados locais/visuais não se apresentam como gravação persistida.

### Situações e segurança assíncrona

- Somente os três valores do enum são aceitos; situação ausente pode seguir default `pendente` apenas quando a relação é realmente ausente conforme o contrato. Relação inválida/ambígua deve gerar erro explícito, não sucesso silencioso.
- Evite duplo clique e vincule feedback/resultado à quadra e operação capturadas no início.
- Persistência local versionada deve ocorrer antes da RPC; falha nela não envia escrita.
- Coordenação multi-aba deve usar mecanismo atômico compatível (Web Locks se disponível) cobrindo operação inteira. `storage`/`BroadcastChannel` notificam, mas não substituem mutex.
- HTTP 4xx/5xx, timeout, abort, erro de transporte, corpo ausente/incompatível ou SQLSTATE sintático isolado não provam término; mantêm incerteza/bloqueio.
- O caminho de confirmação exige retorno 2xx sem erro e payload que passe o contrato real da RPC, vinculado à quadra/situação solicitadas.
- Preferir consulta pelo UUID em `consultar_operacao_situacao_quadra` para reconciliar uma operação identificada. Um fallback baseado em estado/versão precisa de uma prova técnica de que a tentativa original não poderá mais gravar; não usar apenas a igualdade da situação como prova. Não repetir automaticamente escrita incerta nem apagar registro para desbloquear UI.
- Erros de armazenamento, versão desconhecida, corrupção, ausência inexplicada e coordenação indisponível devem bloquear com mensagem acessível e específica.
- Testes locais com mocks devem incluir respostas fora de ordem, timeout seguido de resposta tardia, 400/401/403/409/422, 429/5xx/gateway, transporte/abort, dados/payload inválidos, leitura antes/depois da situação, storage indisponível, recarga e múltiplas abas. Não teste com dados reais.
- Não afirme que Web Locks/localStorage provam término remoto; explique limites e operação de suporte para bloqueios persistentes.

### Administração e autenticação

- Exigir login por alias/senha via `signInWithPassword`, validar configuração sem quebrar mapa público e não usar OTP/link mágico como login administrativo.
- Validar papel consultando perfil por `user_id` depois de login e ao recuperar sessão. Erro ou perfil inadequado nega acesso e tenta encerrar sessão local.
- Revalidar autorização server-side dentro de RPC estrutural; não confiar em alias, metadata ou React state.
- Desenho/edição suportam geometrias requeridas, validam no cliente para UX e sempre no servidor para segurança.
- Criar, editar, arquivar e excluir exigem estados busy, mensagens claras e confirmação retornada por resposta/RPC. Exclusão permanente exige frase exata e segunda confirmação; jamais implementar escrita direta das tabelas no frontend.
- Recuperação de senha é separada, valida callback/usuário/perfil e comunica explicitamente que envia e-mail.
- Não logar senhas, tokens, chaves, e-mails ou mensagens sensíveis.

### Acessibilidade e responsividade

- Formularios têm labels associados, autocomplete apropriado, estados carregando/erro em live regions e botões desabilitados quando operação não segura.
- Foco de teclado visível; controles do mapa possuem nomes acessíveis; informação de cor também é indicada por texto/símbolo.
- A linha “Situação atual” conserva uma única linha e altura estável entre carregamento/sucesso/erro; não inserir uma área de feedback de altura fixa que amplie o painel. Validar posições do painel e botões em viewport estreita e ampla.
- O motivo do erro deve ser acessível por tooltip sem ser cortado pelo card; garantir fallback por foco de teclado e texto alternativo acessível.
- Respeitar `prefers-reduced-motion`, dimensões touch, safe areas e layout móvel.

## 8. Instalação, validação e publicação

Use manifestos e scripts reais presentes na checkout. No estado documentado:

```powershell
npm.cmd ci
npm.cmd run dev
npm.cmd run build
npm.cmd run lint
npm.cmd run test:idempotent-migration
git diff --check
npm.cmd run preview
```

- O workflow usa Node 24, `npm ci`, `npm run build`, Pages artifact e deploy em push a `main`/`workflow_dispatch`.
- O build executa `tsc -b`, Vite e `node scripts/copy-404.mjs`.
- Lint executa `oxlint`.
- O script `npm.cmd run test:idempotent-migration` existe e valida invariantes da migration. Não há uma suíte geral de testes unitários/e2e no inventário revisado em 29/10/2026. Se implementar testes de UI/integração, documente o runner adicionado e resultados reais; não fabrique comando/resultado.
- Variáveis públicas do frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_ADMIN_USERNAME`, `VITE_ADMIN_LOGIN_EMAIL`. Actions utiliza GitHub Variables com esses nomes. Não inserir segredo nas variáveis `VITE_*`.
- Site configurado: `https://patricio-fardin.github.io/mapa-do-territorio/`, base do Vite `/mapa-do-territorio/`.
- Não há comando de deploy manual no `package.json`; publicação é workflow Actions. Antes de declarar publicada, confirme execução/URL/SHA no GitHub.
- Credenciais/autorização do Supabase e GitHub devem ser fornecidas pelo responsável por canais seguros. Não ler `.env.local` ou arquivos de segredo para descobrir valores.

## 9. Plano de reconstrução por etapas

1. **Inspecionar ambiente:** confirme diretório/repositório, branch, status, diff, HEAD e arquivos reais. Leia manifestos/configurações e documentação; não abra arquivos secretos.
2. **Separar fatos e lacunas:** crie inventário de funcionalidades, schema, dependências, integrações, estado remoto não conhecido e requisitos contraditórios. Pergunte antes de escolhas irreversíveis.
3. **Propor arquitetura:** descreva estrutura, componentes, serviços e contratos; preserve stack existente salvo justificativa técnica e aprovação do usuário para mudanças materiais.
4. **Planejar integração/segurança:** compare migrations locais, nunca presuma estado remoto. Planeje RLS/Auth/RPC como contrato; apresente mudanças server-side em proposta separada e aguarde autorização.
5. **Implementar incrementalmente:** primeiro fundação e leitura do mapa; depois rótulos/seleção/situações; autenticação/área admin; operações seguras; responsividade/acessibilidade.
6. **Validar cada etapa:** TypeScript/build, lint e testes unitários/mocks que existam. Inspecione saída, diff e status; preserve alterações preexistentes.
7. **Exercitar falhas:** concorrência multi-aba, rede/HTTP, timeout/resposta atrasada, reload, storage corrompido/indisponível, RPC parcial, sessão inválida e erros de leitura usando mocks/projeto isolado.
8. **Documentar operação:** comandos reais, variáveis públicas, limitações, suporte, publicação e procedimentos aprovados.
9. **Relatório de conformidade:** relacione critérios, arquivos, comandos executados e resultados, cenários apenas analisados, lacunas/risco remoto e próximos passos. Nunca afirmar teste remoto ou deploy sem evidência.

## 10. Regras de alteração, segurança e publicação

- Confira branch/status/diff antes de editar. Preserve toda alteração do usuário; nunca use `git reset --hard`, `git clean`, `git restore` ou checkout destrutivo para apagar trabalho.
- Trabalhe apenas na checkout autorizada. Não leia, imprima ou copie `.env.local`, credenciais, tokens ou segredos. Não comite segredo; use `.env.example` somente com placeholders demonstrativos.
- Não modifique banco remoto, tabelas, dados, Auth, usuário/perfil, RPC ou RLS sem pedido explícito e escopo/autorização claros. Inspeção local de migration não autoriza deploy de schema.
- Não execute ação de mudança de senha, nem o script `admin:set-password`, sem autorização explícita e confirmação do responsável sobre o UUID Auth existente e a ação. O script atual espera UUID como argumento, `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` no ambiente local e senha digitada sem eco; nunca codifique usuário/senha/chave.
- Não remova/troque conta admin ou altere o papel para contornar fluxo de login.
- Não faça commit, push, merge, publicação ou deploy sem solicitação explícita. Em publicação autorizada, revise arquivos exatos, valide build/lint, nunca force push sem autorização, acompanhe workflow e relate SHA/resultado.
- Antes de excluir dados, mostrar claramente escopo/irreversibilidade e obter confirmação exigida. Não usar dados de produção para testes.
- Diferencie sempre: mudança implementada, teste realmente executado, análise estática e comportamento verificado em ambiente remoto.

## 11. Lacunas conhecidas — não preencher por suposição

Antes de qualquer decisão que dependa delas, liste e pergunte objetivamente:

1. **Estado remoto Supabase:** quais migrations estão aplicadas hoje; quais grants, policies/RLS e definições de funções estão realmente implantados; qual projeto/ref autorizado será alvo.
2. **Produção da migration de exclusão:** README anterior registra que o proprietário teria informado que `20261026132516_admin_excluir_quadra.sql` já foi aplicada ao projeto `bkjcfzotxfapgtxkoswb`; isso não foi verificado no ambiente remoto. Não reaplique nem declare aplicada sem consulta autorizada.
3. **Provisionamento/admin:** UUID/Auth do administrador, associação atual `perfis`, fluxo de criação inicial e aliases/e-mail configurados não são verificáveis sem acesso autorizado. Não criar/trocar conta por conta própria.
4. **Dados reais das quadras:** não foi identificado seed no repositório; `supabase/config.toml` lista `./seed.sql`, mas esse arquivo não foi encontrado na árvore. Dados, quantidade e qualidade das geometrias remotas são desconhecidos.
5. **Recuperação de RPC incerta:** a migration local 004 adiciona UUID idempotente, tabela de resultados e RPC de consulta, mas seu estado remoto não foi confirmado. Clientes legados não enviam UUID/versão e não têm idempotência completa entre retries. Após erro de transporte, teste o caminho real de reconciliação antes de afirmar que o incidente foi resolvido.
6. **Ambiente Pages:** Actions Variables, configuração de Pages, último deploy, domínio/URL efetivamente publicada e verde do workflow não foram verificados.
7. **Requisitos adicionais de negócio:** semântica do papel `acompanhamento`, necessidade de observações, trilha/auditoria, retenção e regras operacionais além do schema existente precisam de decisão do responsável.
8. **Compatibilidade alvo:** o workflow fixa Node 24, mas o manifesto não declara `engines`; navegadores alvo/nível de suporte a Web Locks não estão documentados. O código contém um caminho degradado quando Web Locks não existe e pode tentar a operação com coordenação limitada à aba; verifique esse comportamento e o efeito de falha do armazenamento antes de afirmar que o sistema falha fechado.

Não substitua nenhuma dessas lacunas por credenciais fictícias apresentadas como reais, schema inventado, migration presumida ou estado de produção não consultado.

## 12. Plano atual de evolução da interface — referência de 29/10/2026

### Já entregue e validado em commits anteriores

- Mapa público em tela cheia, cabeçalho translúcido e chips de indicadores flutuantes; enquadramento inicial compensando os overlays (`57b329a`).
- Feedback de situação em linha, sem área de altura fixa abaixo dos botões: “Salvando…”/estado final/“Erro ao salvar” (`b672179`).
- Ajuste do painel para desktop, status de uma linha, tooltip `title`, cor de erro e foco de teclado (`95b6993`). A simulação visual local observou a linha com altura constante e posição dos botões estável em janelas desktop estreita e ampla; isso não é substituto para uma suíte automatizada.

### Pendências de interface

1. **Mapa-base administrativo:** escolher OSM ou CARTO Positron por troca de `TileLayer`, sem alterar dados GeoJSON/status. Confirmar endpoint, atribuição e termos atuais do provedor antes de codificar.
2. **Controles:** agrupar geolocalização e zoom `+`/`−` no canto inferior direito, respeitando permissão de geolocalização, safe areas e painel de seleção.
3. **Tema:** mover a escolha de tema para a área administrativa e remover o controle de tema isolado da interface pública se ainda estiver presente na versão alvo. Definir persistência local ou compartilhada antes de escolher armazenamento.
4. **Rótulos por zoom:** ocultar o texto do rótulo em zoom menor que 15 e exibi-lo em zoom 15 ou superior, tanto no mapa público quanto no administrativo; não ocultar ou desativar os polígonos.

### Pendências técnicas/documentais

- Criar testes/mocks para timeout, resposta atrasada/fora de ordem, conflitos, falhas de armazenamento, recarga e coordenação entre abas. O script `test:idempotent-migration` testa invariantes SQL locais e não cobre a UI.
- Revisar comportamento quando uma operação incerta existe para outra quadra, ou quando Web Locks/localStorage não estão disponíveis; não presumir segurança que não foi exercitada.
- Confirmar o estado real da migration 004, das RPCs/grants/RLS/Auth no Supabase remoto apenas com autorização e acesso apropriados.
- Definir procedimento seguro de suporte para registros locais incompatíveis/corrompidos; nunca removê-los cegamente para “desbloquear” a interface.
- Manter README, prompt resumido, prompt mestre e `AGENTS.md` alinhados com a implementação real e as pendências aprovadas.

Os itens pendentes não devem ser descritos como implementados. Atualize seu estado somente após alteração, validações documentadas e, quando aplicável, confirmação remota.

## 13. Relatório final obrigatório do agente

Ao terminar qualquer reconstrução, informe:

- funcionalidades/requisitos entregues e não entregues;
- arquivos criados/modificados, sem ocultar trabalho preexistente;
- comandos de build/lint/teste executados e saída real, separados de análise estática;
- resultados de teste local, remoto e publicação em categorias distintas;
- segurança, autenticação, consistência e falhas não cobertas;
- estado do Git, commits/push/deploy apenas se explicitamente autorizados;
- lacunas que precisam de decisão humana e próximo passo recomendado.

---

**Fim do prompt mestre.** O agente que receber este documento deve iniciar pelo inventário do ambiente onde estiver executando. Este texto foi revisado em 29/10/2026 e descreve a implementação local inspecionada nessa data; não substitui nova inspeção da checkout atual, nem confirma estado remoto do Supabase ou do GitHub Pages.
