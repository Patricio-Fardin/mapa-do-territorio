# Prompt de reconstrução — Mapa de Territórios

**Revisado em 29 de outubro de 2026.** Este arquivo foi incorporado ao repositório a partir do prompt local legado `PROMPT_RECONSTRUCAO.md` e atualizado para evitar contradições com o sistema atual. Ele é um prompt de entrada resumido; use `PROMPT_RECONSTRUCAO_MAPA.md` para os contratos e critérios detalhados e `AGENTS.md` para as regras persistentes do agente.

---

## Papel

Atue como arquiteto de software e desenvolvedor full-stack responsável por manter ou reconstruir o **Mapa de Territórios** de Alfredo Chaves/ES. Primeiro inspecione o ambiente e o código disponíveis. Não assuma que uma reconstrução do zero seja necessária, nem substitua a implementação existente sem comparar requisitos, estado do repositório e riscos.

Trabalhe com persistência: diante de erros de build, ferramenta, comando ou validação, investigue a causa, tente alternativas seguras e continue em etapas menores. Não abandone a tarefa silenciosamente. Não invente resultados, credenciais, dados geográficos nem estado remoto. Siga o arquivo `AGENTS.md`.

## Objetivo do sistema

Manter uma aplicação web responsiva para visualizar e administrar quadras territoriais usando geometrias confiáveis, com mapa público e área administrativa autenticada. A persistência principal é Supabase; não apresente dados locais ou mudanças visuais como se estivessem salvos no servidor.

## Stack vigente a confirmar nos manifestos

- React 19, TypeScript e Vite.
- Leaflet, React-Leaflet e Leaflet Draw.
- Supabase JS para Auth, consultas/RPC e Realtime.
- OpenStreetMap no mapa público; área administrativa permite alternar entre OSM e CARTO Positron com preferência local no navegador.
- GitHub Actions e GitHub Pages para build/publicação.
- Oxlint para lint; há validação específica de migration por `npm.cmd run test:idempotent-migration`. Não há uma suíte geral de testes unitários/e2e no inventário documentado.

Use sempre `package.json`, `package-lock.json`, configurações e migrations atuais como fonte de verdade para a checkout que estiver aberta.

## Funcionalidades já existentes a preservar

1. Mapa público de quadras ativas, zoom/pan, seleção de polígonos, contadores e rótulos dentro das quadras.
2. Situações: `pendente`, `concluida` e `refazer`; mudanças chamam RPC do Supabase. Não há escrita direta nas tabelas pelo visitante.
3. Mapa em tela cheia com cabeçalho translúcido flutuante e chips de indicadores compactos.
4. Painel da quadra adaptável a mobile e desktop. A linha “Situação atual” muda para “Aguardando…”/“Salvando…” e depois para o estado confirmado ou “Erro ao salvar”. Não adicionar novamente uma área de feedback fixa abaixo dos botões: isso aumentou o card no mobile e foi removido.
5. Em erro conhecido, a mensagem curta fica vermelha; o motivo completo é disponibilizado no atributo `title` da linha e por foco de teclado. Não deixe o tooltip ser cortado por um ancestral com `overflow: hidden`; se necessário, teste a implementação nativa ou crie uma alternativa acessível.
6. Área administrativa autenticada, listagem de quadras ativas/arquivadas, desenho/edição de Polygon/MultiPolygon, criação, arquivamento e exclusão permanente protegida.
7. Leitura paginada, atualização Realtime quando disponível e atualização periódica.
8. Mecanismo cliente para coordenar e diagnosticar atualizações de situação incertas e migration local de atualização idempotente/versionada. Consulte o código e a migration antes de alterar esse fluxo.
9. Seletor de mapa-base na área administrativa entre OSM e CARTO Positron (`light_all`), persistido em `localStorage`, sem recriar o `MapContainer` nem efetuar escritas no Supabase. Manter atribuição dos provedores e chave CARTO via `VITE_CARTO_BASEMAP_KEY`.

## Requisitos visuais e responsividade

- O mapa é o plano principal e ocupa a viewport com `100dvh` e fallback `100vh`.
- Cabeçalho e chips flutuam sobre o mapa. Considere safe areas e não permita que overlays escondam permanentemente os controles ou a atribuição cartográfica.
- A linha de status do painel deve permanecer em uma única linha, com altura/line-height estáveis entre “Salvando…”, estado final e “Erro ao salvar”. Não altere a altura do painel nem desloque os botões durante transições.
- Desktop usa ajustes a partir de 641 px e um breakpoint adicional a partir de 1200 px; valide também uma janela estreita e uma ampla. Não presuma que um ajuste válido em celular funcionará no desktop.
- Verifique a linha inteira do tooltip por mouse e teclado, cores de erro, foco, texto truncado, alvos touch e `prefers-reduced-motion`.
- Qualquer estado “incerto” deve comunicar incerteza; nunca afirme sucesso nem erro terminal se a resposta do servidor não o comprovar.

## Segurança e dados

- Não invente quadras, códigos, geometrias, streets/ruas ou limites. Não coloque dados pessoais de moradores.
- GeoJSON suportado: `Polygon` e `MultiPolygon`; preservar a ordem de coordenadas e a geometria persistida.
- Autenticação administrativa é Supabase Auth por alias/senha e validação de `public.perfis`; as RPCs estruturais também precisam de validação do lado do servidor. O alias ou o estado React não substitui autorização.
- Revisar migrations locais não confirma que foram aplicadas ao projeto remoto. Não executar migration, alterar RLS/grants/RPC, criar/trocar conta admin, alterar senha ou escrever dados em produção sem autorização explícita e escopo definido.
- Nunca ler, imprimir, incluir em documentação, comitar ou expor `.env.local`, senhas, tokens, service-role keys ou outras credenciais. `VITE_*` entra no bundle público e não pode guardar segredos.
- Para testes de escrita, utilizar ambiente isolado e dados descartáveis, com aprovação apropriada. Não reutilizar dados reais como fixture.

## Ordem de trabalho sugerida

1. Inspecionar `git status --short --branch`, HEAD, diff, branches e arquivos existentes. Preservar mudanças do usuário e arquivos não versionados.
2. Ler `AGENTS.md`, `README.md`, `PROMPT_RECONSTRUCAO_MAPA.md`, `PROMPT_RESTAURACAO.md`, `package.json`, código relevante e migrations locais.
3. Separar fatos confirmados, hipóteses, lacunas e decisões que dependem do proprietário.
4. Implementar em etapas pequenas, evitando refatorações ou dependências não necessárias.
5. Validar com os comandos realmente existentes:

   ```powershell
   npm.cmd ci
   npm.cmd run build
   npm.cmd run lint
   npm.cmd run test:idempotent-migration
   git diff --check
   ```

   Execute os comandos relevantes e informe o resultado real. Se algum falhar, diagnostique-o, corrija quando for seguro e repita a verificação.

6. Para mudanças visuais, faça smoke test em browser nas larguras mobile, desktop estreita e desktop ampla. Se usar screenshots ou medições DOM, informe exatamente quais estados e dimensões foram observados.
7. Antes de commit/push, inspecione o diff e os arquivos staged. Preserve arquivos não relacionados. Só faça commit, push, merge ou deploy com autorização explícita.
8. Após publicação autorizada, confirme o SHA em `main`, o run do GitHub Actions e os assets servidos pelo GitHub Pages. Um push isolado não prova que o deploy terminou.
9. Entregue relatório com arquivos alterados, testes executados, resultado do build/lint/script de migration, estado do Git/deploy e pendências não verificadas.

## Próximas etapas de interface já identificadas

- **Controles:** agrupar “Minha localização” e zoom `+`/`−` no canto inferior direito; tratar permissão/erro de geolocalização.
- **Tema:** mover a preferência de tema para a área administrativa e remover botão isolado do mapa público, se presente na versão alvo. Definir antes se a preferência é local ou compartilhada.
- **Rótulos por zoom:** ocultar textos dos rótulos quando zoom < 15 e exibi-los no zoom >= 15, tanto no mapa público quanto no administrativo, sem esconder ou desabilitar os polígonos.
- **Testes:** adicionar testes/mocks para respostas atrasadas/fora de ordem, conflitos, timeout, armazenamento indisponível/corrompido, recarga e coordenação entre abas.
- **Operações incertas:** documentar procedimento seguro de diagnóstico; considerar futuras melhorias servidoras somente com proposta e autorização separadas.
- **Documentação:** manter README, este prompt e o prompt mestre alinhados com a interface e as ferramentas efetivamente presentes.

Consulte o plano de evolução no `README.md`; marque uma etapa como concluída somente após implementação e validação observável. Nunca apresente item futuro como funcionalidade já disponível.

---

**Início do trabalho:** inspecione o repositório disponível e informe o estado inicial antes de modificar qualquer arquivo.
