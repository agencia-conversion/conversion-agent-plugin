---
name: novo-projeto
description: >-
  Cria o projeto de um cliente dentro do vault da squad, no Brain do Search
  Hub, e já o deixa pronto para uso. Use quando o usuário disser "cria um
  projeto pra X", "novo cliente no Brain", "abre o Brain da Allianz", "adiciona
  o cliente Y na squad Gaia". Args opcionais: nome do cliente e vault da squad.
---

# /conversion-agent:novo-projeto [<cliente>] [--vault <slug-do-vault>]

Cria o projeto de um cliente no Brain do Search Hub.

## O que "criar projeto" significa aqui

No Search Hub, criar projeto é **provisionar o Brain de um cliente que já
existe no cadastro**. Diga isso ao usuário se ele pedir algo que não caiba:

- O cliente precisa estar **ativo** e ter **a squad do vault como responsável**.
  Não dá para criar projeto avulso, sem cliente cadastrado.
- Use o **nome do cliente**, não o do grupo. Ex.: o grupo Atacadão Pneus tem o
  cliente **Bransales**; o grupo Grupo OLX tem OLX, Viva Real e ZAP Imóveis.
- **Um Brain por grupo.** Clientes do mesmo grupo caem no mesmo projeto.
- É **idempotente**: se o Brain já existe, a tool devolve o projeto existente
  com `created: false`. Não é erro — só avise que já estava criado.

## Comportamento

1. **Vault.** Sem `--vault`, liste os vaults com
   `searchhub_list_workspaces_projects` e pergunte qual squad é a responsável
   pelo cliente. Mostre o nome da squad, não o slug com hash.
2. **Cliente.** Sem argumento, pergunte o nome do cliente como está no
   cadastro. Não slugifique você mesmo — a tool faz isso com a regra do backend.
3. **Criar.** Chame `searchhub_create_project({ ws_slug, client })`.
4. **Materializar.** Com sucesso, chame
   `searchhub_materialize_project({ ws_slug, proj_slug: project.slug, set_active: true })`.
5. **Responder** em 2 linhas: se foi criado ou já existia, e o nome do projeto
   ativo. Sugira `/brain` para o usuário ver o contexto.

## Erros — traduza assim

| `error` | Diga ao usuário |
|---|---|
| `client_not_found` | Não achei esse cliente ativo nessa squad. Confirme o nome do **cliente** (não do grupo) e se a squad responsável é essa. |
| `ambiguous_client` | Há dois clientes com esse nome na squad; o cadastro precisa ser corrigido antes. |
| `workspace_not_found` | Esse vault não existe para você; mostre os vaults da resposta. |
| `writes_disabled` | A escrita no Brain está desligada no servidor. Não é problema da conta dele. |
| `provision_pending` | O Brain está sendo preparado; tente de novo em instantes. |
| `session_expired` | Sessão expirada, ou a conta ainda não tem acesso ao Search Hub. Peça `auth_login_start`; se persistir, é cadastro, não login. |

## Quando a tool não existe

`searchhub_create_project` só aparece nos modos `searchhub` (o padrão) e
`parallel`. Se o plugin estiver em `CONVERSION_TOOLSET_MODE=legacy`, não há
criação pelo plugin: oriente a criar o projeto no admin de
https://agent.conversion.com.br por um owner do workspace, e depois
materialize com `materialize_project`.

## Regras

- Nunca invente cliente, slug ou vault. Se o usuário não souber, pergunte.
- Não exponha curl nem a rota da API.
