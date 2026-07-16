---
name: novo-projeto
description: >-
  Cria um novo project no workspace ativo (ou em ws explícito). Args:
  `<proj-slug>` (no ws ativo) ou `<ws>/<proj>` (cross-ws), `--name "Nome"`.
  Use quando o usuário disser "cria um project", "novo site pra acme",
  "adiciona o cliente X.com.br no acme".
---

# /conversion-agent:novo-projeto [<slug> | <ws>/<proj>] [--name "Nome"]

Cria um novo project no backend.

> **Nota:** o CLI `conversion` foi descontinuado e ainda **não há MCP tool**
> de criação de project. A criação em si é feita no app web
> (agent.conversion.com.br) por um owner do workspace; esta skill orienta o
> usuário e, depois de criado, materializa localmente via `materialize_project`.

## Comportamento

1. **Resolução do workspace**:
   - Arg com `<ws>/<proj>` → workspace explícito.
   - Arg só com `<proj-slug>` → usa workspace ativo (via `get_active_project`).
   - Sem args → pergunta workspace + project + nome em sequência (1 pergunta por vez, pt-BR).
2. **Validações**:
   - Slug do project: mesmas regras (kebab-case 2-80, sem acento). Se inválido, explique.
   - Nome: 1-200 chars.
3. **Criação (app web)**: oriente o usuário a criar o project em
   agent.conversion.com.br (um owner do workspace faz isso). Se ele não for
   owner: "Pra criar project, peça pra um owner de `<ws>`."
4. **Após criado no backend**: materialize localmente com a MCP tool
   `materialize_project` (`ws_slug`/`proj_slug`, `set_active: true` para já
   ativar). Confirme em 1 linha com o path materializado.

## Regras

- Confirme cliente/marca **uma vez** se contexto for ambíguo (ex: ws ativo é "agencia-x" mas pedido cita "y.com.br" — pergunta workspace).
- Nunca crie cross-workspace silenciosamente.
