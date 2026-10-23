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
- `/admin` envia um link mágico por e-mail via Supabase Auth; ao retornar, uma sessão existente é validada novamente.
- A conta administrativa deve existir previamente no Supabase. O frontend não oferece cadastro e envia o link com `shouldCreateUser: false`.
- O acesso administrativo só é concedido quando a consulta a `public.perfis` confirma `papel = 'admin'` para o usuário autenticado. Falha na consulta ou papel diferente encerra a sessão.
- A UI não é a proteção principal: as políticas RLS e a função SQL validam as operações no banco.
- A autenticação, por si só, não habilita criação, edição ou arquivamento de quadras na interface.

Na configuração do Supabase Auth, defina o Site URL como `https://patricio-fardin.github.io/mapa-do-territorio/` e inclua `https://patricio-fardin.github.io/mapa-do-territorio/**` em Additional Redirect URLs. No template Magic Link, use `{{ .ConfirmationURL }}` sem URL `localhost` fixa. Para desenvolvimento, pode-se permitir `http://localhost:5173/**`.

Para criar o primeiro administrador, crie manualmente um usuário em Supabase Dashboard → Authentication → Users. Depois, no SQL Editor, insira o ID desse usuário na tabela de perfis:

```sql
insert into public.perfis (user_id, papel)
values ('UUID_DO_USUARIO_CRIADO_NO_AUTH', 'admin');
```

Procedimento seguro: execute esse `insert` somente no SQL Editor usando uma sessão de proprietário/administrador do projeto, nunca pelo frontend. A tabela `public.perfis` não concede escrita a `anon` nem a usuários autenticados comuns. Confirme o resultado com `select user_id, papel from public.perfis where papel = 'admin';` e não coloque o UUID, senha ou chaves secretas em arquivos públicos.

Na configuração do Supabase Auth, desative a criação de novos usuários quando o projeto estiver pronto. O administrador deve ser criado previamente no painel e possuir o perfil autorizado no banco.

Nunca coloque senhas, `service_role` ou chaves secretas no código ou em variáveis `VITE_*`.

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

1. Confirmar a configuração do projeto Supabase e das URLs de redirecionamento do Auth.
2. Executar as migrations em `supabase/migrations/` na ordem numérica.
3. Criar o primeiro usuário administrador e inserir seu papel.
4. Habilitar Realtime para as tabelas necessárias.
5. Validar RLS e operações públicas e administrativas.
6. Persistir completamente criação, edição e arquivamento administrativos.
6. Implementar backup JSON.
7. Criar testes locais e em dois dispositivos.
8. Validar o retorno do link mágico no GitHub Pages após configurar as URLs permitidas no Supabase Auth.

## Cuidados com os dados

Não armazenar nomes, endereços pessoais, telefones ou outras informações de moradores. As observações devem tratar somente do andamento geral do trabalho territorial.
