---
name: status
description: >-
  Mostra o status de sync (local vs backend) do project ativo (via MCP tool
  `sync_status`). Use quando o usuário pedir "o que mudou", "diff", "status do
  project", ou antes de operação que pode entrar em conflito com mudanças
  locais não pushadas.
---

# /conversion-agent:status

Mostra o status de sync do project via MCP tool `sync_status`. O CLI
`conversion` foi descontinuado — tudo é feito por MCP tools.

## Comportamento

1. Resolve project ativo via `get_active_project`. Se não há, peça ao
   usuário ou use `/conversion-agent:whereami`.
2. Chame a MCP tool `sync_status` (sem args = project ativo; ou passe
   `ws_slug`/`proj_slug`). Ela retorna `pendingUpload`, `pendingDownload`,
   `mode` (observe/pull/bidirectional) e `paused`.
3. Repassa o resumo ao usuário:
   - `pendingUpload` → "arquivos locais ainda não publicados no backend"
   - `pendingDownload` → "mudanças no backend ainda não baixadas"
   - `mode: observe` → o sync automático **apenas observa** (não publica);
     a publicação acontece quando a skill grava via `project_save_and_url`.
4. Se há `pendingUpload` significativo, avise **explicitamente** que esses
   arquivos ainda **não aparecem na plataforma** e oriente re-salvar pela
   skill correspondente (`/redator`, `/briefing`, etc. — todas gravam via
   `project_save_and_url`, que publica o commit direto).
