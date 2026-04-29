---
name: abrir
description: >-
  Resolve um slug e retorna URL clicável do editor web. Use quando o usuário
  disser "abre o briefing X", "manda o link do artigo Y", ou após uma busca
  pra abrir resultado específico. Arg: slug do artefato.
---

# /conversion-skills:abrir <slug>

Resolve slug + retorna URL editor web.

## Comportamento

1. Resolve project ativo via `get_active_project`.
2. Chame MCP `get_content({ ws_slug, proj_slug, slug })` (apenas pra
   confirmar tipo + path).
3. Construa URL:
   `https://conversion-skills.vercel.app/p/<ws_id>/<proj_id>/edit/<path>`.
   (Note: NÃO `/app/p/...` — depois da unificação 22L é `/p/...`.)
4. Output: 2 linhas — title + URL.
5. Se slug não existe → "Não achei `<slug>` no project. Use `/buscar`
   pra explorar ou liste com `conversion-context:search_project`."
