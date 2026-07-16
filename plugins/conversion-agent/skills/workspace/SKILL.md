---
name: workspace
description: >-
  Lista os workspaces que o usuário pertence e mostra qual está ativo. Sem
  args = lista. Com arg `<ws-slug>` = troca workspace ativo. Use quando o
  usuário disser "lista meus workspaces", "muda pra acme", "qual workspace
  tô agora?", "trocar pra beta".
---

# /conversion-agent:workspace [<ws-slug>]

Atalho de navegação por workspace.

## Comportamento

1. **Sem arg**:
   - Chame `get_active_project` MCP pra saber estado atual.
   - Chame a MCP tool `list_workspaces_projects` (retorna workspaces +
     projects). Apresente lista numerada com indicador `●` no ativo.
   - Convide: *"Pra trocar, use `/workspace <slug>` ou diga o nome."*

2. **Com arg `<ws-slug>`**:
   - Resolver: ws-slug existe? Lista projects desse ws (via
     `list_workspaces_projects`).
   - Se ws tem projects materializados localmente → não troca workspace
     direto; em vez disso, oferece pickear project: *"Workspace `<slug>`
     tem N projects materializados aqui — qual ativar? (lista)"*. Após
     escolher → `set_active_project` MCP.
   - Se ws não tem projects materializados localmente → "Workspace
     `<slug>` não tem projects neste hub. Use `/pull <slug>/<proj>`
     (MCP tool `materialize_project`) pra materializar."

3. **Cross-workspace**: nunca troque silenciosamente. Sempre confirme:
   *"Sair de `<ws-atual>/<proj-atual>` pra `<novo-ws>`?"*. Sticky
   boundary é regra do CLAUDE.md (Project-ativo §4).

## Saída esperada

Curta, prosa de consultor. Ex:

```
Workspaces:
  ● acme       (3 projects)
    beta       (1 project)
    conversion (1 project, 1 ativo aqui: acme/site)
```

(Não invente os números — leia do backend.)
