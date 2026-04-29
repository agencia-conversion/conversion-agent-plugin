---
name: buscar
description: >-
  Full-text search no project ativo. Use quando o usuário disser "busca por X",
  "procura artigo sobre Y", "tem briefing de Z?". Args: termo de busca livre.
  Retorna lista clicável de slugs com tipo + status.
---

# /conversion-skills:buscar <termo>

Atalho pra MCP tool `conversion-context:search_project`.

## Comportamento

1. Resolve project ativo via `get_active_project`. Se não há → peça ao
   usuário antes de buscar.
2. Chame `search_project({ ws_slug, proj_slug, query: <termo>, limit: 20 })`.
3. Apresente resultados em tabela curta:
   `<title>  (<type>, <status>)  →  <URL editor web>`.
4. Se zero resultados: "Nada encontrado pra '<termo>'. Tente variar
   palavras ou checar grafia."
5. Se muitos resultados (>20): mencione que truncou e sugira refinamento.
