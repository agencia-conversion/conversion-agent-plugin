---
name: pull
description: >-
  Re-materializa o project ativo do backend (via MCP tool `materialize_project`).
  Use quando o usuário disser "puxa o project", "atualiza o project",
  "sincroniza", ou quando você precisar de versão fresca do disco antes de
  operação que depende dela. Sem args = project ativo (via get_active_project);
  com arg `<ws>/<proj>` = pull explícito.
---

# /conversion-agent:pull

Re-materializa o project do backend via MCP tool `materialize_project`
(baixa o head atual e reescreve o `.conversion/manifest.json`). O CLI
`conversion` foi descontinuado — tudo é feito por MCP tools.

## Comportamento

1. Sem arg + project ativo definido (via `get_active_project`): chame a
   MCP tool `materialize_project` com o `ws_slug`/`proj_slug` do project
   ativo.
2. Sem arg + sem project ativo: liste os projects via
   `list_workspaces_projects` e pergunte ao usuário qual materializar.
3. Com arg explícito `<ws>/<proj>`: chame `materialize_project` direto com
   esses slugs (`set_active: true` se o usuário quiser ativá-lo).

Reporte ao usuário: linha curta com commit materializado + path.
Sem detalhes técnicos a menos que erro.
