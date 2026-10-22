# Mapa de Territórios

Sistema web para acompanhar quadras territoriais na cidade de Alfredo Chaves, Espírito Santo.

## Estado atual

O projeto está em fase local de desenvolvimento. A aplicação abre um mapa real do OpenStreetMap centrado em Alfredo Chaves e permite desenhar quadras manualmente, sem inventar limites geográficos.

Funcionalidades atuais:

- React + TypeScript + Vite.
- Leaflet, React-Leaflet e Leaflet Draw.
- Mapa OpenStreetMap com zoom.
- Desenho manual de polígonos no modo Administrador.
- Códigos automáticos no formato `AC-001`, `AC-002` etc.
- Menu Leaflet ancorado à quadra com três ações:
  - Concluída — verde `#27ae60`.
  - Pendente — cinza `#78858a`.
  - Refazer — laranja `#e67e22`.
- Atualização imediata da cor e dos contadores.
- Contadores de total, pendentes, concluídas, refazer e percentual de conclusão.
- Modo Administrador: desenhar, editar limites e excluir quadras.
- Modo Acompanhamento: selecionar quadras e alterar a situação, sem ferramentas administrativas.
- Interface responsiva para telas pequenas e toque.

## Acesso público e área administrativa

Quando o Supabase estiver configurado e as migrations aplicadas:

- `/` é o mapa público e não exige cadastro ou login.
- Visitantes podem ler quadras ativas e alterar a situação pela operação colaborativa autorizada no banco.
- `/admin` oferece acesso sem senha por código OTP enviado ao e-mail autorizado via Supabase Auth.
- O frontend usa `shouldCreateUser: false`, portanto não cria usuários automaticamente.
- O fluxo OTP não depende de URL de redirecionamento: o código é digitado na própria tela `/admin`.
- O acesso administrativo só é concedido quando `public.perfis.papel = 'admin'` para o usuário autenticado.
- A UI não é a proteção principal: as políticas RLS e a função SQL validam as operações no banco.
- Não existe cadastro público no frontend.

Para criar o primeiro administrador, crie manualmente um usuário em Supabase Dashboard → Authentication → Users. Depois, no SQL Editor, insira o ID desse usuário na tabela de perfis:

```sql
insert into public.perfis (user_id, papel)
values ('UUID_DO_USUARIO_CRIADO_NO_AUTH', 'admin');
```

Procedimento seguro: execute esse `insert` somente no SQL Editor usando uma sessão de proprietário/administrador do projeto, nunca pelo frontend. A tabela `public.perfis` não concede escrita a `anon` nem a usuários autenticados comuns. Confirme o resultado com `select user_id, papel from public.perfis where papel = 'admin';` e não coloque o UUID, senha ou chaves secretas em arquivos públicos.

Na configuração do Supabase Auth, desative a criação de novos usuários quando o projeto estiver pronto. O administrador deve ser criado previamente no painel; o OTP apenas autentica uma conta existente e autorizada.

Nunca coloque senhas, `service_role` ou chaves secretas no código ou em variáveis `VITE_*`.

## Limitações atuais

- Os dados ficam somente na memória do navegador.
- Quadras e situações são perdidas ao recarregar a página.
- A integração com o cliente Supabase e a rota `/admin` estão preparadas, mas o projeto remoto ainda precisa ser criado/configurado e as migrations ainda não foram executadas nele.
- A sincronização Realtime depende de habilitar a tabela no projeto Supabase.
- Arquivamento é uma operação reversível lógica (`ativa=false`) que preserva a quadra e seu histórico. Exclusão física não é permitida pela interface pública e não deve ser usada como rotina administrativa.
- Ainda não há importação/exportação de backup JSON.
- Ainda não foi publicado no GitHub Pages.

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

1. Criar projeto Supabase e preencher `.env.local`.
2. Executar as migrations em `supabase/migrations/` na ordem numérica.
3. Criar o primeiro usuário administrador e inserir seu papel.
4. Habilitar Realtime para as tabelas necessárias.
5. Validar RLS e operações públicas e administrativas.
6. Persistir completamente criação, edição e arquivamento administrativos.
6. Implementar backup JSON.
7. Criar testes locais e em dois dispositivos.
8. Publicar o frontend no GitHub Pages.

## Cuidados com os dados

Não armazenar nomes, endereços pessoais, telefones ou outras informações de moradores. As observações devem tratar somente do andamento geral do trabalho territorial.
