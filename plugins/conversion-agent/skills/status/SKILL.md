---
name: status
description: >-
  Mostra diff local vs backend do project ativo (atalho `conversion status`).
  Use quando o usuário pedir "o que mudou", "diff", "status do project", ou
  antes de operação que pode entrar em conflito com mudanças locais não
  pushadas.
---

# /conversion-skills:status

Atalho pra `conversion status`.

## Comportamento

1. Resolve project ativo via `get_active_project`. Se não há, peça ao
   usuário ou pule pra `conversion whereami`.
2. Executa `conversion status` em foreground via Bash.
3. Repassa output ao usuário, **traduzindo prefixos** quando útil:
   - `A` (added) → "novos arquivos"
   - `M` (modified) → "modificados"
   - `D` (deleted) → "removidos"
4. Se há divergência significativa, sugira `/pull` ou `conversion push`.
