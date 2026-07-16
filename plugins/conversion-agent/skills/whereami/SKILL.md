---
name: whereami
description: >-
  Mostra contexto completo da sessão atual — workspace + project ativos,
  brain status, N deliverables recentes, status local vs
  backend. Use quando o usuário disser "onde tô?", "qual contexto?",
  "resumo do project atual", "o que tem aqui?", ou no início de sessão pra
  orientar trabalho.
---

# /conversion-agent:whereami

Snapshot consolidado do contexto.

## Comportamento

1. **Project ativo** via `get_active_project`. Se null → mostra hub-root
   + lista de projects materializados; convida `/projeto`.
2. **Brain status**: chame `read_brain` MCP. Para cada arquivo central e
   extensão presente: 1 linha (nome + ✓ se editado / `seed` se default).
3. **Recentes**: chame `search_project({ ws_slug, proj_slug, limit: 5 })`.
   Lista os 5 últimos deliverables (qualquer tipo) com title + status +
   URL editor.
4. **Status local**: chame a MCP tool `sync_status`. Resumo curto: "X
   arquivos ainda não publicados no backend (pendingUpload)" ou "limpo".
   Se `mode: observe`, lembre que o sync automático não publica sozinho.

## Saída esperada

Estrutura visual ≤ 25 linhas:

```
📍 Você está em: acme/site

Brain:
  ✓ tom-voz       editado há 5d
  ✓ glossario     editado há 2d
  ⚠ decisoes      seed (não editado)
  ✓ aprendizados  editado há 8d
  ⚠ personas      seed (não editado)

Últimos deliverables (5):
  • [artigo] Tráfego pago — finalizado          → URL
  • [briefing] 2026-04-24-tráfego-pago — aprovado → URL
  • [serp_snapshot] tráfego-pago-2026-04-24      → URL
  ...

Local vs backend: ✓ limpo (last commit eb1cd56)

Próximo passo sugerido: <skill ou ação baseada em contexto>
```

Sem decoração excessiva. Não invente dados — leia tudo via tools.
