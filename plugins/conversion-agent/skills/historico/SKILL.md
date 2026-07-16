---
name: historico
description: Mostra os últimos N commits do project ativo. Use quando o usuário perguntar "o que mudou recentemente?", "quem mexeu nisso?", "histórico do project", ou pra reconstruir contexto antes de retomar trabalho.
---

# /conversion-agent:historico

Últimos commits do project ativo.

## Comportamento

1. Resolve project ativo via `get_active_project`.
2. Use endpoint backend `/api/v1/ws/<ws_id>/projects/<proj_id>/commits?limit=10` (já existe? se não, fallback: MCP tool `sync_status` no project-root local).
3. Apresente lista em tabela:
   - Data relativa (ex: "há 3h").
   - Commit ID curto (8 chars).
   - Mensagem (1 linha truncada em 80 chars).
   - Arquivos tocados (count).
4. Se há divergência local não publicada (`sync_status` mostra `pendingUpload`), inclua isso no topo: "⚠ Você tem N arquivos locais ainda não publicados no backend".

Output ≤ 12 linhas.
