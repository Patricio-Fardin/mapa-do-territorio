# Mapa de Territórios

Sistema web para acompanhar quadras territoriais na cidade de Alfredo Chaves, Espírito Santo.

## Estado atual

O projeto mantém desenvolvimento local e publicação no GitHub Pages. A aplicação abre um mapa OpenStreetMap centrado em Alfredo Chaves; as operações administrativas persistentes para criar, editar e arquivar quadras ainda não estão conectadas à interface.

Funcionalidades atuais:

- React + TypeScript + Vite.
- Leaflet, React-Leaflet e Leaflet Draw.
- Mapa OpenStreetMap com zoom.
- A autenticação administrativa é verificada pelo perfil no Supabase; as operações administrativas de quadras ainda não estão conectadas à interface.
- Códigos automáticos no formato `AC-001`, `AC-002` etc.
- Menu Leaflet ancorado à quadra com três ações:
  - Concluída — verde `#27ae60`.
  - Pendente — cinza `#78858a`.
  - Refazer — laranja `#e67e22`.
- Atualização imediata da cor e dos contadores.
- Contadores de total, pendentes, concluídas, refazer e percentual de conclusão.
- Modo Acompanhamento: selecionar quadras e alterar a situação, sem ferramentas administrativas.
- Interface responsiva para telas pequenas e toque.

## Acesso público e área administrativa

Quando o Supabase estiver configurado e as migrations aplicadas:

- `/` é o mapa público e não exige cadastro ou login.
- Visitantes podem ler quadras ativas e alterar a situação pela operação colaborativa autorizada no banco.
- `/admin` autentica com nome de usuário e senha por `signInWithPassword`; o login não envia e-mail, link mágico ou código OTP.
- O nome de usuário é um alias configurado no frontend. `VITE_ADMIN_LOGIN_EMAIL` mapeia esse alias para o e-mail da conta Auth administrativa existente e fica visível no bundle; não é um segredo.
- A conta Auth administrativa existente deve continuar associada ao perfil atual. O frontend não oferece cadastro nem cria outra conta.
- O acesso administrativo só é concedido quando a consulta a `public.perfis` confirma `papel = 'admin'` para o usuário autenticado. Falha na consulta ou papel diferente encerra a sessão.
- A UI não é a proteção principal: as políticas RLS e a função SQL validam as operações no banco.
- A autenticação, por si só, não habilita criação, edição ou arquivamento de quadras na interface.

Configure `VITE_ADMIN_USERNAME` (opcional; padrão `admin`) e `VITE_ADMIN_LOGIN_EMAIL` (obrigatório) junto às variáveis Supabase em **Settings → Secrets and variables → Actions → Variables** do repositório. Use o e-mail da conta Auth que já corresponde ao perfil com `papel = 'admin'`. Essas variáveis de frontend são públicas; não cadastre senhas ou chaves privilegiadas nelas.

Para desenvolvimento local, copie `.env.example` para `.env.local` e preencha as variáveis `VITE_*` sem usar credenciais privilegiadas. `.env.local` é ignorado pelo Git.

### Definir senha da conta Auth existente

O login por senha não define uma senha automaticamente. Se a conta Auth existente ainda não tiver senha, o proprietário pode executar uma única vez o utilitário local abaixo, apontando explicitamente para o UUID desse usuário:

```powershell
# Configure estas variáveis no ambiente local seguro, sem gravá-las no repositório.
$env:SUPABASE_URL = "<URL do projeto Supabase>"
$env:SUPABASE_SERVICE_ROLE_KEY = "<chave administrativa secreta>"
npm.cmd run admin:set-password -- <UUID_DO_USUARIO_AUTH_EXISTENTE>
```

O utilitário exige um UUID como argumento, solicita a senha duas vezes sem ecoá-la, não imprime credenciais e atualiza somente esse usuário pelo Admin API. Não o execute sem autorização explícita do proprietário; nunca use essa chave em `VITE_*`, no frontend ou no Git. A conta e o registro de `public.perfis` não são criados, substituídos ou alterados por esse procedimento.

## Limitações atuais

- Sem Supabase configurado, os dados locais temporários não persistem após recarregar a página.
- O mapa público usa o cliente Supabase para carregar quadras e persistir mudanças de situação quando configurado; a configuração e as migrations do projeto remoto precisam ser verificadas separadamente.
- A interface administrativa ainda não chama as RPCs `admin_criar_quadra`, `admin_atualizar_geometria` e `admin_arquivar_quadra`. Desenho, edição e arquivamento não estão disponíveis como operações persistentes.
- A sincronização Realtime depende de habilitar a tabela no projeto Supabase.
- Arquivamento é uma operação reversível lógica (`ativa=false`) que preserva a quadra e seu histórico. Exclusão física não é permitida pela interface pública e não deve ser usada como rotina administrativa.
- Ainda não há importação/exportação de backup JSON.
- O frontend está publicado no GitHub Pages em `https://patricio-fardin.github.io/mapa-do-territorio/`.

## Tecnologias

- Node.js LTS e npm.
- React 19.
- TypeScript.
- Vite.
- Leaflet 1.9.
- React-Leaflet 5.
- Leaflet Draw.
- OpenStreetMap.

## Como executar no Windows PowerShell

```powershell
cd "C:\Users\patricio.fardin\Documents\ChatGPT\Mapa interativo"
$env:Path = "C:\Program Files\nodejs;$env:Path"
npm.cmd install
npm.cmd run dev
```

Abra `http://localhost:5173/` no navegador.

O uso de `npm.cmd` evita o bloqueio do PowerShell ao arquivo `npm.ps1`.

Para testar `/admin` localmente, configure também `VITE_ADMIN_USERNAME` e `VITE_ADMIN_LOGIN_EMAIL` em `.env.local`.

## Verificação de produção

```powershell
npm.cmd run build
```

O build foi verificado com sucesso em 22/10/2026.

## Estrutura principal

- `src/App.tsx`: mapa, desenho, modos, menu das quadras e contadores.
- `src/App.css`: layout, cores, responsividade e aparência do menu.
- `src/main.tsx`: ponto de entrada React.
- `package.json`: scripts e dependências.
- `backup-*`: cópias locais criadas antes de alterações estruturais.

## Próximas etapas

1. Confirmar as variáveis de build do GitHub Actions, inclusive o alias e o e-mail da conta Auth existente.
2. Executar as migrations em `supabase/migrations/` na ordem numérica, se ainda não aplicadas pelo proprietário.
3. Habilitar Realtime para as tabelas necessárias.
4. Validar RLS e operações públicas e administrativas.
5. Persistir completamente criação, edição e arquivamento administrativos.
6. Implementar backup JSON.
7. Criar testes locais e em dois dispositivos.

## Cuidados com os dados

Não armazenar nomes, endereços pessoais, telefones ou outras informações de moradores. As observações devem tratar somente do andamento geral do trabalho territorial.
