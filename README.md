# Mapa de Territórios

**Documentação técnica revisada em 29 de outubro de 2026.** Esta descrição reflete o código, scripts, configurações e migrations versionadas inspecionados nesta revisão. A existência de uma migration local não comprova que ela foi aplicada ao Supabase remoto; build local ou commit também não comprovam publicação até que o GitHub Actions e os assets públicos sejam conferidos.

## Identificação e finalidade

Aplicação web para visualizar e administrar quadras territoriais em Alfredo Chaves, Espírito Santo. O mapa permite acompanhar a situação de cada quadra. A área administrativa autenticada cria quadras, edita geometrias e arquiva ou exclui registros.

Perfis declarados no schema local:

- **Visitante/anônimo:** lê quadras ativas e pode solicitar atualização de situação pela RPC pública `atualizar_situacao_quadra`. As tabelas não concedem escrita direta a `anon`.
- **Usuário autenticado:** acessa as leituras permitidas e pode entrar na área administrativa somente se a conta estiver mapeada na configuração e `public.perfis.papel` for `admin`.
- **Administrador:** além da autorização validada no cliente, as RPCs estruturais verificam `public.eh_admin()` no servidor.
- O enum também define `acompanhamento`, cujo comportamento de produto não está especificado além do papel default no banco.

### Funcionalidades implementadas

- Mapa público de quadras ativas em tela cheia; cabeçalho translúcido flutuante e contadores compactos sobre o mapa.
- Seleção de quadras e atualização de situação com feedback em linha: o status existente muda para “Salvando…” e depois para o status confirmado ou “Erro ao salvar”, sem criar uma área de feedback de altura fixa.
- Painel da quadra responsivo em dispositivos móveis e desktops; motivo do erro disponível pelo `title` e foco de teclado.
- Rótulos permanentes adaptáveis ao tamanho do polígono.
- Autenticação administrativa por alias e senha Supabase; recuperação de senha por link é fluxo separado.
- Desenho de novas quadras, edição de geometrias, consulta de quadras arquivadas, arquivamento e exclusão definitiva protegida por confirmação.
- Na área administrativa, alternância entre OpenStreetMap e CARTO Positron (`light_all`), com preferência gravada no `localStorage`; trocar o fundo atualiza apenas a URL da camada de tiles e não escreve no Supabase.
- Leituras paginadas do Supabase e atualização por Realtime quando disponível, além de atualização periódica.
- Proteção local diagnóstica contra operações de situação incertas, coordenada por quadra entre abas cooperantes pelo Web Locks API quando disponível; falhas não bloqueiam indefinidamente o mapa.
- A migration `20261029120000_idempotent_quadra_updates.sql` adiciona idempotência por UUID e versão otimista para novas alterações, sem remover a RPC legada.

Informações sobre branch, HEAD, alterações locais e status de publicação são transitórias e devem ser verificadas ao iniciar cada sessão, em vez de copiadas como estado permanente nesta documentação. O agente deve preservar todo arquivo não versionado ou modificação preexistente, inclusive `revisao_tecnica.txt`, salvo instrução expressa em contrário.

## Tecnologias e ferramentas

Versões declaradas vêm de `package.json`; versões efetivamente instaladas foram lidas localmente com `npm.cmd ls --depth=0` em 27/10/2026. Faixas do manifesto continuam sendo o contrato de instalação; o lockfile fixa a árvore npm reproduzível.

| Tecnologia / ferramenta | Versão declarada | Versão instalada observada | Uso / comprovação |
|---|---:|---:|---|
| React | `^19.3.1` | `19.3.1` | UI; `src/App.tsx`, `src/main.tsx` |
| React DOM | `^19.3.1` | `19.3.1` | Montagem em `#root`; `src/main.tsx` |
| TypeScript | `~6.0.3` | `6.0.3` | Tipagem e `tsc -b`; `tsconfig*.json`, `package.json` |
| Vite | `^8.3.4` | `8.3.5` | Servidor e build; `vite.config.ts` |
| `@vitejs/plugin-react` | `^6.1.2` | `6.1.2` | Plugin React do Vite; `vite.config.ts` |
| Supabase JS | `^2.118.0` | `2.118.0` | Auth, PostgREST RPC/consultas e Realtime; `src/lib/supabase.ts` |
| Leaflet | `^1.9.4` | `1.9.4` | Renderização e interação do mapa; `src/App.tsx`, `src/components/AdminMap.tsx` |
| React-Leaflet | `^5.0.0` | `5.0.0` | Componentes React do mapa; `src/App.tsx`, `src/components/AdminMap.tsx` |
| Lucide React | `lucide-react` (versão no lockfile) | Consulte `npm.cmd ls lucide-react` | Ícones vetoriais SVG dos controles do mapa; `src/App.tsx` |
| Leaflet Draw | `^1.0.4` | `1.0.4` | Desenho e edição administrativa; `src/components/AdminMap.tsx` |
| Oxlint | `^1.88.0` | `1.89.0` | Análise estática; `npm run lint`, `.oxlintrc.json` |
| Supabase CLI | `^2.121.0` | `2.121.0` | Dependência de desenvolvimento para tarefas locais/CLI; `package.json` |
| `@types/leaflet` | `^1.9.22` | `1.9.22` | Tipos; dependências de desenvolvimento |
| `@types/leaflet-draw` | `^1.0.13` | `1.0.13` | Tipos; dependências de desenvolvimento |
| `@types/node` | `^24.19.2` | `24.19.2` | Tipos de configuração/script Node |
| `@types/react` / `@types/react-dom` | `^19.3.0` | `19.3.0` | Tipos React |
| Node.js | Não declarado em `engines` | `v24.20.0` neste ambiente | Workflow GitHub Actions fixa major 24; `package.json`, `.github/workflows/deploy.yml` |
| npm | Não declarado em `engines` | `11.19.0` neste ambiente | `package-lock.json` v3 e comandos npm |
| Git | Não é dependência do app | `2.56.0.windows.2` neste ambiente | Controle de versão |
| GitHub Actions / Pages | Actions `checkout@v4`, `setup-node@v4`, `configure-pages@v5`, `upload-pages-artifact@v3`, `deploy-pages@v4` | Runner `ubuntu-latest`; versões indicadas no YAML | `.github/workflows/deploy.yml` |
| OpenStreetMap | Serviço externo, sem versão npm | Não aplicável | Tiles e atribuição em `src/App.tsx` e `src/components/AdminMap.tsx` |
| CARTO Basemaps | Serviço externo, sem versão npm | Não aplicável | Tiles Positron raster (`light_all`) exclusivo da área administrativa; exige chave pública `VITE_CARTO_BASEMAP_KEY` e atribuição OSM/CARTO |
| Web Locks, `localStorage`, evento `storage` | APIs do navegador | Depende do navegador | Coordenação/persistência em `src/App.tsx`; sem `BroadcastChannel` |

Não há ESLint, framework de formulários ou suíte geral de testes unitários/e2e declarados no manifesto. O projeto usa `lucide-react` para ícones vetoriais SVG nos controles de navegação. Existe o script específico `npm.cmd run test:idempotent-migration`, que verifica invariantes da migration de atualização idempotente; ele não substitui testes de interface, integração real ou concorrência. Os símbolos usados nos rótulos são texto/Unicode.

## Arquitetura e arquivos

```text
.
├── .github/workflows/deploy.yml
├── scripts/
│   ├── copy-404.mjs
│   ├── set-admin-password.mjs
│   └── validate-idempotent-migration.mjs
├── src/
│   ├── assets/                 # SVGs de template e hero.png
│   ├── components/AdminMap.tsx # Mapa e operações administrativas
│   ├── lib/
│   │   ├── quadra-label.ts     # Cálculo e renderização de rótulos
│   │   ├── quadra-status.ts    # Validação/normalização da situação
│   │   └── supabase.ts         # Cliente com configuração VITE pública
│   ├── App.tsx                 # Rotas, autenticação e mapa público
│   ├── App.css                # Estilos da aplicação/mapas
│   ├── index.css              # Reset e estilos globais básicos
│   └── main.tsx               # React StrictMode e montagem
├── supabase/
│   ├── config.toml             # Configuração de desenvolvimento local
│   └── migrations/             # Schema, RLS e funções versionadas
├── .env.example
├── .gitignore
├── .oxlintrc.json
├── index.html
├── package.json
├── package-lock.json
├── AGENTS.md                  # Persona e instruções persistentes para agentes de código
├── PROMPT_RECONSTRUCAO.md      # Prompt de entrada resumido, revisado a partir do arquivo local legado
├── PROMPT_RECONSTRUCAO_MAPA.md # Especificação mestre detalhada de reconstrução
├── PROMPT_RESTAURACAO.md       # Instruções históricas de restauração do projeto atual
├── tsconfig*.json
└── vite.config.ts
```

- `src/App.tsx`: roteamento leve por `BASE_URL` entre mapa público e `/admin`, login/recuperação, leitura pública, estados/contadores e transação da situação, incluindo coordenação e persistência de incerteza.
- `src/components/AdminMap.tsx`: lista ativa/arquivada, desenho Leaflet Draw, edição de Polygon/MultiPolygon, confirmação de autorização e chamadas de RPC estruturais.
- `src/lib/quadra-label.ts`: calcula um ponto interno por busca aproximada de maior distância às bordas, ajusta dimensões do rótulo conforme o polígono/zoom e cria marcador não interativo.
- `src/lib/quadra-status.ts`: aceita apenas `pendente`, `concluida` e `refazer`; relação ausente/vazia vira `pendente`, mas formas ambíguas/inválidas lançam erro.
- `src/lib/supabase.ts`: cria cliente somente quando URL e chave publicável existem; sessão persiste e renova token automaticamente. A chave é pública e não deve ser privilegiada.
- `vite.config.ts`: `base` de publicação `/mapa-do-territorio/` e plugin React.
- `src/main.tsx`: renderiza `<App />` em `<StrictMode>`.
- `scripts/copy-404.mjs`: copia `dist/index.html` para `dist/404.html` para fallback de rota do Pages. O build depende desse script; não o substitua por assumptions sobre o servidor.
- `supabase/config.toml`: parâmetros locais (por exemplo, Postgres major 17, portas e redirects de desenvolvimento). `project_id = "Mapa_interativo"` é identificador de configuração local, não prova qual projeto remoto será usado. O arquivo referencia `./seed.sql`, mas não há `supabase/seed.sql` no inventário atual.
- `AGENTS.md` define o fluxo de trabalho, a persona técnica, as ferramentas verificadas, as regras de segurança e a persistência esperada de qualquer agente que assumir o repositório.
- `PROMPT_RECONSTRUCAO.md` é a versão de entrada resumida do prompt local legado, revisada para refletir a arquitetura atual e evitar instruções obsoletas.
- `PROMPT_RECONSTRUCAO_MAPA.md` é a especificação mestre detalhada para reconstrução independente, requisitos verificáveis, lacunas e segurança.
- `PROMPT_RESTAURACAO.md` contém orientações históricas para restaurar/operar o projeto existente. Nenhum desses arquivos substitui nova inspeção do ambiente ou autorização específica.

## Mapa público

- A aplicação usa `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`, com atribuição visível a OpenStreetMap Contributors e link para copyright.
- Centro inicial: Alfredo Chaves/ES (`[-20.6353, -40.7498]`), zoom 14. Após carregar os dados, tenta ajustar o mapa aos limites das geometrias; existe botão flutuante acessível para restaurar a visualização.
- Lê apenas quadras `ativa = true`, selecionando `id`, `codigo`, `geometria`, `ativa` e relação `situacoes_quadras(situacao)`. Faz paginação em blocos de 1000, ordenada por `id`; Realtime e intervalo de 30 segundos solicitam atualizações. O cliente ignora leituras antigas com sequência/versionamento local.
- Geometrias GeoJSON suportadas na aplicação e validador do banco: `Polygon` e `MultiPolygon`. O banco mantém `geometria` como JSONB.
- Clicar em polígono seleciona a quadra e abre painel com código, situação e ações de situação. O mapa público não oferece criação, edição de geometria, arquivamento ou exclusão.
- Situações e cores do polígono: `pendente` / **Pendente** (`#78858a`), `concluida` / **Concluída** (`#27ae60`), `refazer` / **Refazer** (`#e67e22`). Indicadores incluem `◷`, `✓` e `⚠`. Contadores exibem total e quantidade em cada estado.
- Etiquetas não capturam cliques. No mapa público priorizam situação e símbolo, abreviando ou omitindo detalhes em polígonos pequenos; no administrativo também mostram o código quando há espaço.
- A tela pública usa o mapa como plano principal em `100dvh`, com fallback `100vh`, cabeçalho translúcido e indicadores flutuantes; chips podem rolar horizontalmente em telas estreitas. O enquadramento inicial compensa a área dos elementos sobrepostos.
- O painel de seleção fica sobre o mapa e é responsivo: mobile usa margens seguras e altura máxima compacta; desktop adapta largura a partir de 641 px e pode ampliar até 440 px a partir de 1200 px.
- A linha “Situação atual” é a única área de feedback do salvamento normal: “Aguardando…”/“Salvando…”, status final ou “Erro ao salvar”. Não existe uma linha reservada de altura fixa abaixo dos botões. O estado de erro torna o motivo disponível pelo tooltip nativo `title` e por foco de teclado; o prefixo mantém cor neutra e o texto de erro fica vermelho.
- No canto superior direito do mapa público há o botão “Centralizar no meu local”, com ícone Lucide `LocateFixed` e geolocalização nativa do Leaflet (`map.locate({ setView: true, maxZoom: 16 })`), e o botão “Restaurar visão do mapa”, agora com ícone `Scan`. Se a localização falhar, o mapa mantém o enquadramento anterior e exibe uma mensagem acessível. O mapa público continua usando OpenStreetMap sem seletor de fundo; o seletor OSM/CARTO está limitado à área administrativa. Agrupamento de zoom/localização no canto inferior direito e controle de tema ainda estão pendentes. `prefers-reduced-motion` deve ser respeitado em futuras animações.
- Estados de inicialização, dados desatualizados, falha/indisponibilidade de conexão, armazenamento indisponível/corrompido e operação pendente são comunicados. Sem Supabase configurado, operações e autorização não são simuladas com dados locais.

## Área administrativa e autenticação

- Caminho: `/mapa-do-territorio/admin` no Pages e `/admin` no caminho servido pela base local. `App` escolhe a página usando `BASE_URL` e `history/popstate`; não há roteador externo.
- Login pede alias e senha. Alias é comparado após `trim()` sem diferenciar caixa e mapeado para `VITE_ADMIN_LOGIN_EMAIL`; a autenticação é `signInWithPassword`. Não há OTP/link mágico no caminho de login.
- Na montagem, consulta sessão existente via `getSession`; após login/recuperação, valida usuário e consulta `public.perfis` por `user_id`, exigindo `papel === 'admin'`. Erro/perfil não autorizado tenta `signOut({ scope: 'local' }`. As permissões reais também dependem de RLS/RPC no banco.
- “Esqueci minha senha” é fluxo separado: `resetPasswordForEmail`, callback de recuperação, validação do usuário/perfil e atualização de senha com Auth. Isso envia link; não é login sem e-mail.
- A área admin carrega quadras ativas e arquivadas, contadores e status, atualiza por Realtime e intervalo de 30s. Um lock local impede cliques operacionais duplicados; isso não substitui controles transacionais no servidor.
- Desenho de polígono impede interseções no Leaflet Draw conforme configuração, permite múltiplos vértices e é cancelável. Antes de criar, compara geometrias ativas; gera o próximo código com base nos códigos lidos. A unicidade final depende também da constraint do banco.
- Edição de geometria pode salvar mais de uma quadra em chamadas sequenciais; se houver falha parcial, mensagem informa quantas já foram salvas e recarrega dados.
- Arquivamento exige confirmação nativa do navegador; deixa de aparecer no público e preserva histórico conforme a RPC.
- Exclusão permanente exige digitar exatamente `EXCLUIR <código>` e confirmar em janela nativa. A interface chama `admin_excluir_quadra`; não executa `.delete()` direto. É destrutiva e remove histórico/situação/quadra segundo a migration local.

## Dados, RLS e RPCs documentados no repositório

Os fatos desta seção descrevem as três migrations versionadas, na ordem abaixo. Não demonstram que foram aplicadas, nem que continuam iguais no Supabase remoto.

### Tipos e tabelas

| Objeto | Colunas / significado verificado |
|---|---|
| `public.app_role` | Enum `admin`, `acompanhamento`. |
| `public.situacao_quadra` | Enum `pendente`, `concluida`, `refazer`. |
| `public.tipo_evento_quadra` | Enum `criada`, `situacao_alterada`, `observacao_alterada`, `geometria_alterada`, `arquivada`. |
| `public.perfis` | `user_id uuid` PK/FK `auth.users(id)` com `ON DELETE CASCADE`; `papel app_role NOT NULL DEFAULT acompanhamento`; `created_at timestamptz`. |
| `public.quadras` | `id uuid` PK default UUID; `codigo text` unique e regex `^AC-[0-9]{3,}$`; `geometria jsonb` com tipo Polygon/MultiPolygon; `ativa boolean`; `created_at`, `created_by` FK Auth com `ON DELETE SET NULL`, `updated_at`. Índice em `ativa`. |
| `public.situacoes_quadras` | `quadra_id uuid` PK/FK quadra `ON DELETE RESTRICT`; `situacao` enum default pendente; `observacao text` default vazio, máximo 2000 caracteres; `updated_at`, `updated_by` FK Auth `ON DELETE SET NULL`. |
| `public.historico_quadras` | `id uuid` PK; `quadra_id` FK quadra `ON DELETE RESTRICT`; `tipo_evento`; situações anterior/nova nullable; `detalhes jsonb`; `created_at`; `user_id` FK Auth `ON DELETE SET NULL`. Índice por quadra/data descendente. |

### Funções

| Função | Contrato local |
|---|---|
| `eh_admin()` | Retorna boolean consultando `perfis` para `auth.uid()` e papel `admin`; `SECURITY DEFINER`, `search_path = ''`. |
| `atualizar_situacao_quadra(p_quadra_id uuid, p_situacao public.situacao_quadra, p_observacao text DEFAULT NULL)` | Mantém a assinatura legada, mas a migration idempotente faz a função delegar à lógica versionada. Incrementa `versao`, grava histórico e retorna situação/versão sem expor observação. Clientes legados não enviam versão esperada nem UUID, portanto retries legados recebem novas operações. |
| `geometria_geojson_valida(p_geometria jsonb)` | Valida tipo Polygon/MultiPolygon, arrays/aneis/pontos e faixas de longitude/latitude conforme implementação da migration 002. |
| `admin_criar_quadra(p_codigo text, p_geometria jsonb)` | Exige `eh_admin`, valida código/geometria, insere quadra, situação inicial pendente e evento criado; retorna objeto JSON com dados da quadra. |
| `admin_atualizar_geometria(p_quadra_id uuid, p_geometria jsonb)` | Exige `eh_admin`, valida geometria, atualiza somente quadra ativa, grava evento; retorna quadra atualizada. |
| `admin_arquivar_quadra(p_quadra_id uuid)` | Exige `eh_admin`, define `ativa = false`, grava evento e retorna boolean. |
| `admin_excluir_quadra(p_quadra_id uuid)` | Migration 003: exige sessão e `eh_admin`, bloqueia quadra e exclui histórico, situação e quadra dentro da transação; retorna boolean. Grants locais removem execução de `public` e `anon`, concedendo a `authenticated`. |

### RLS e permissões finais representadas pelas migrations

- RLS é habilitada em `perfis`, `quadras`, `situacoes_quadras` e `historico_quadras`.
- A migration 002 deixa quadras/situações ativas legíveis para `anon` e `authenticated`; quadras arquivadas dependem de `eh_admin()`. Histórico fica legível a administradores autenticados.
- `perfis` tem policy de leitura própria ou admin da migration inicial; permissões efetivas são a composição de grants, policies e alterações subsequentes.
- `anon` não recebe escrita direta nas tabelas. A migration 002 revoga escrita de `anon, authenticated`; operações são feitas por RPCs. Funções administrativas são executáveis por `authenticated`; `atualizar_situacao_quadra` é pública conforme concessão da migration 002.
- Não há política de escrita direta de cliente no histórico. A atomicidade de operações estruturais depende da implementação real da RPC/Postgres.

### Migrations e estado remoto

1. `supabase/migrations/20261022000100_initial_schema.sql`
2. `supabase/migrations/20261022000200_public_map_admin_policies.sql`
3. `supabase/migrations/20261026132516_admin_excluir_quadra.sql`

O README anterior registrava a afirmação de que a terceira migration havia sido aplicada ao projeto de produção `bkjcfzotxfapgtxkoswb`, conforme informação atribuída ao proprietário. **Essa afirmação não foi verificada no Supabase durante a atualização desta documentação.** Confirme o projeto remoto e o histórico de migrations com o responsável antes de qualquer operação. `supabase/config.toml`, migrations locais e arquivos temporários do CLI não são evidência suficiente do schema/estado remoto atual. Não há migração automática durante build/deploy.

## Segurança e consistência de situação

O comportamento a seguir foi rechecado em `src/App.tsx` e migrations locais em 29/10/2026:

1. A alteração cria UUID v4 local e persiste registro versão 2 (`quadraId`, código, situação solicitada, estado e indicador de erro) no `localStorage` antes de iniciar `atualizar_situacao_quadra`.
2. Web Locks exclusivo usa um nome derivado da quadra para coordenar abas cooperantes da mesma origem/perfil. O lock é temporário e liberado por `finally`; sem suporte, a operação continua com coordenação apenas na aba. Um registro incerto de uma quadra não bloqueia alterações em outras quadras.
3. Estados persistidos: `pending` (RPC iniciada/sem resultado), `transport-uncertain` (resposta/erro não conclusivo), `confirmed` (resposta positiva validada pela aplicação) e `resolved` (tombstone). Só a resposta 2xx sem erro, com `quadra_id` igual ao solicitado e situação válida igual à solicitada, pode avançar para `confirmed`. Erros HTTP, exceções, timeout, resposta incompleta ou estado divergente não são prova terminal.
4. A leitura da situação atual nunca resolve `pending`/`transport-uncertain`. Para `confirmed`, reconciliação pode gravar `resolved` depois de ler a quadra; o caminho de sucesso pode gravar tombstone diretamente após validar a resposta RPC. O tombstone permanece no armazenamento e só é substituído sob lock após comparar identidade/conteúdo esperado.
5. Registro corrompido, versão antiga/desconhecida, falha de leitura/gravação ou indisponibilidade da coordenação são preservados como diagnóstico e geram aviso; não bloqueiam todas as novas gravações. Um registro incerto da mesma quadra impede somente a repetição simultânea daquela quadra. Registros diferentes da versão 2 não são migrados/apagados automaticamente.
6. Timeout da interface não cancela a RPC. Resposta atrasada ainda é processada; erro de transporte pode deixar lock/registro pendente. Não há repetição automática nem fila offline.

**Limite importante:** Web Locks cobre apenas abas cooperantes na mesma origem/perfil enquanto o navegador e o armazenamento persistem. Não coordena dispositivos/navegadores diferentes, software antigo não cooperante, nem resiste à limpeza/evicção do `localStorage`. Depois de uma resposta perdida, o cliente não consegue provar que a execução remota terminou ou não ocorrerá tardiamente. Resolução definitiva exige suporte do servidor — por exemplo, chave idempotente/identificador persistido e API para consultar o resultado — inexistente nas migrations locais atuais. Não apresente uma leitura isolada como confirmação do término da RPC.

### Idempotência e versão

A migration `20261029120000_idempotent_quadra_updates.sql` é aditiva. Ela cria `situacoes_quadras.versao`, inicializada em `0`, e a tabela privada `operacoes_situacao_quadras`. A nova RPC `atualizar_situacao_quadra_v2` recebe um UUID lógico, a versão esperada e os mesmos dados da alteração. Repetir o mesmo UUID com os mesmos parâmetros retorna `replayed` sem duplicar histórico; reutilizá-lo com parâmetros diferentes é rejeitado. Alterações concorrentes com versão antiga retornam `conflict`, sem sobrescrever a situação atual. `updated`, `unchanged` e `rejected` são estados explícitos. As respostas públicas não incluem `observacao`; a observação continua sendo usada internamente para validar a identidade da operação.

O frontend tenta a RPC v2 e só usa a RPC antiga quando o banco ainda não possui a nova função, mantendo compatibilidade durante a implantação. A migration corrigida também redefine a RPC antiga para delegar à mesma lógica versionada; contudo, clientes antigos não fornecem UUID e cada retry legado recebe uma nova operação, portanto a idempotência de retry só existe no cliente novo. Sequência segura: aplicar a migration em ambiente de teste, validar a RPC antiga e a v2, aplicar em produção, confirmar que a função antiga passou a delegar, e só então publicar a versão frontend que usa a v2.

A RPC legada usa `public.gen_random_uuid()`, fornecida pela extensão `pgcrypto` criada na migration inicial. A migration não presume uma função instalada manualmente fora desse histórico; se a extensão estiver ausente ou instalada em outro schema, a aplicação deve falhar na validação do ambiente antes da implantação.

## Configuração, desenvolvimento e publicação

### Ambiente

`.env.example` contém valores demonstrativos, não credenciais:

```dotenv
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sua-chave-publica-do-supabase
VITE_CARTO_BASEMAP_KEY=sua-chave-publica-do-carto
VITE_ADMIN_USERNAME=admin
VITE_ADMIN_LOGIN_EMAIL=admin@example.com
```

Copie para `.env.local` e substitua pelas configurações públicas corretas. `VITE_ADMIN_USERNAME` tem default `admin`; `VITE_ADMIN_LOGIN_EMAIL` mapeia o alias para a conta Auth existente. Variáveis `VITE_*` são incluídas no bundle: nunca use senha, `service_role`, chave privada ou credencial privilegiada. `.env.local`, `.env` e `*.local` são ignorados por `.gitignore`; não os leia para documentação nem os inclua em commits.

### Comandos existentes

O workflow fixa Node 24; `package.json` não declara faixa `engines`. O ambiente inspecionado tinha Node `v24.20.0` e npm `11.19.0`. No Windows PowerShell, na raiz:

```powershell
npm.cmd ci
npm.cmd run dev
npm.cmd run build
npm.cmd run lint
npm.cmd run test:idempotent-migration
git diff --check
npm.cmd run preview
```

O Vite local serve em `http://localhost:5173/mapa-do-territorio/`; admin em `/mapa-do-territorio/admin`. Não há um runner de testes gerais nem arquivos `*.test.*`/`*.spec.*` no inventário. O script `test:idempotent-migration` é uma validação específica da migration, não uma suíte de testes do frontend. Não invente `npm test` como comando funcional sem adicionar deliberadamente infraestrutura.

O script `admin:set-password` (`npm.cmd run admin:set-password -- <UUID>`) está declarado, mas altera senha: exige UUID de usuário Auth existente como argumento, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no ambiente local seguro, e senha/confirmação digitadas sem eco. **Não execute sem pedido explícito e confirmação do proprietário sobre o usuário e a ação.** Nunca armazene a chave em `VITE_*` ou documente seu valor.

### GitHub Pages

`.github/workflows/deploy.yml` inicia no push a `main` ou `workflow_dispatch`, usa Ubuntu, Node 24 e `npm ci`; faz `npm run build`, configura Pages, carrega `dist` e publica. O build lê as Actions Variables públicas `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_ADMIN_USERNAME` e `VITE_ADMIN_LOGIN_EMAIL`. A chave CARTO de uso no navegador é definida como `VITE_CARTO_BASEMAP_KEY` no próprio workflow e também pode ser fornecida em `.env.local`; é uma chave pública, incluída no bundle, e deve ter restrições de domínio configuradas no painel CARTO. O código mantém a atribuição a OpenStreetMap e CARTO. Verifique os termos, limites de uso e enquadramento aplicável antes do uso institucional em produção. URL do site configurada no projeto: `https://patricio-fardin.github.io/mapa-do-territorio/`. A configuração é declarativa; não prova que Pages esteja habilitado ou que uma execução esteja verde. Não há script de publicação local: o deploy é feito pelo workflow.

## Limitações, pendências e validação necessária

### Limitações atuais comprovadas

- A RPC v2 fornece idempotência e consulta por UUID, mas uma RPC antiga ou cliente legado não fornece UUID nem versão esperada; durante a transição, retries legados podem continuar sem idempotência lógica completa.
- A persistência é local a navegador/perfil e pode ser perdida por limpeza ou evicção.
- Registro incompatível/corrompido é fail-closed, mas não há ferramenta de reparo seguro na interface.
- O estado final do Supabase remoto, grants/RLS efetivos, Auth e dados não foi consultado durante esta atualização documental.
- Não há suíte geral de testes unitários/e2e; o script `test:idempotent-migration` é uma validação especializada e não testa a interface, transações remotas ou grants efetivos.

### Itens que exigem validação externa

- Confirmar, com acesso autorizado, o projeto Supabase alvo, migrations aplicadas, grants/RLS, existência do perfil admin e estado das configurações de Auth. Não inferir isso a partir de migrations ou `config.toml`.
- Confirmar no GitHub a configuração de Pages, Actions Variables, branch de publicação e resultado do último workflow.
- Para testar chamadas de escrita, usar projeto de desenvolvimento isolado e dados descartáveis. Não executar operações de teste em produção.
- Confirmar em ambiente autorizado que a migration `20261029120000_idempotent_quadra_updates.sql`, as RPCs v2/consulta e os grants correspondentes estão aplicados e compatíveis com o frontend atual. O arquivo local não comprova o estado remoto.

## Plano de evolução da interface — estado em 29 de outubro de 2026

### Concluído

- **Etapa 1 — Mapa como elemento principal:** mapa público em tela cheia; cabeçalho translúcido flutuante; contadores em chips compactos; enquadramento inicial ajustado para a área dos overlays. Commit de referência: `57b329a`.
- **Feedback sem Layout Shift:** substituição do status na própria linha “Situação atual” durante salvamento, sucesso e erro; removida a área fixa de feedback que desperdiçava espaço vertical. Commit de referência: `b672179`.
- **Alternância de mapa-base administrativo:** seletor entre OpenStreetMap e CARTO Positron (`light_all`), preferência local em `localStorage`, atribuição visível a OSM/CARTO e nenhuma escrita no Supabase. O componente `MapContainer` não é recriado; a seleção/estado das quadras permanece no componente administrativo.
- **Geolocalização no mapa público:** ícone Lucide `LocateFixed` e ação `map.locate({ setView: true, maxZoom: 16 })`; mensagens acessíveis para falhas e restauração do enquadramento anterior se o navegador não conseguir localizar. A função “Restaurar visão do mapa” foi mantida com o ícone Lucide `Scan`.

### Próximas etapas de interface — pendentes

1. **Controles do mapa (parcialmente concluído):** o botão “Centralizar no meu local” já usa `map.locate`, solicita permissão do navegador e trata erros sem perder o enquadramento anterior. Falta organizar a geolocalização e os controles de zoom `+ / −` em um grupo no canto inferior direito, com alvos acessíveis e espaçamento seguro para painel de quadra e margens do dispositivo.
2. **Tema na área administrativa:** adicionar a preferência de tema na área administrativa, sem criar um botão isolado no mapa público. Não foi encontrado um controle de tema na inspeção do código atual; confirmar a experiência desejada antes de implementá-la. Definir se o tema é local por navegador ou compartilhado antes de decidir onde persistir.
3. **Rótulos conforme zoom:** ocultar os textos dos rótulos quando o zoom for menor que 15 e mostrá-los a partir de 15, sincronizando renderização inicial e evento `zoomend` nos mapas público e administrativo. Manter polígonos visíveis, selecionáveis e clicáveis; a mudança afeta somente os rótulos.

### Melhorias técnicas recomendadas — pendentes

- Criar testes automatizados/mocks para timeout, resposta atrasada, respostas fora de ordem, conflito de versão, falha de `localStorage`, recarga e coordenação entre abas; manter `npm.cmd run test:idempotent-migration` para verificar a migration, sem tratá-lo como suíte de UI.
- Definir e testar procedimento seguro de diagnóstico/recuperação para registros locais incompatíveis ou corrompidos; nunca apagar estado incerto cegamente só para liberar os botões.
- Validar em ambiente autorizado o estado real do Supabase (migration `20261029120000_idempotent_quadra_updates.sql`, grants, RLS, RPCs e perfil administrativo), sem presumir que migrations locais já estejam aplicadas.
- Considerar mecanismos adicionais de consulta/remediação de operações incertas no servidor. A RPC v2 e a tabela idempotente existem no conjunto de migrations local; qualquer alteração adicional de banco exige proposta, ambiente isolado, autorização e validação próprios.
- Definir uma pequena suíte de regressão visual para viewport mobile, desktop estreito, desktop largo, estados de carregamento/sucesso/erro, acessibilidade e tooltip.

Os itens deste plano são sugestões de continuidade, não funcionalidades já entregues. Atualize o status somente depois de alterar código, rodar validações e registrar evidências.

## Documentação de reconstrução

- [`AGENTS.md`](AGENTS.md): persona/skill com práticas de trabalho, ferramentas, segurança, fluxo de validação e instrução explícita de persistência diante de erros.
- [`PROMPT_RECONSTRUCAO.md`](PROMPT_RECONSTRUCAO.md): prompt conciso migrado e revisado a partir do arquivo legado encontrado em outra pasta local; serve como ponto de entrada.
- [`PROMPT_RECONSTRUCAO_MAPA.md`](PROMPT_RECONSTRUCAO_MAPA.md): prompt mestre com contexto técnico, migrations, critérios, lacunas e plano de evolução.
- [`PROMPT_RESTAURACAO.md`](PROMPT_RESTAURACAO.md): orientações históricas para retomar o checkout existente.

Esses arquivos são referências de contexto, não substituem a inspeção do ambiente nem autorização específica para operações remotas, alteração de senha, publicação ou ações destrutivas.
