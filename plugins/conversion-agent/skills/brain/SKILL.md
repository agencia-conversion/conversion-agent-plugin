---
name: brain
description: Mostra o estado do brain do project ativo (arquivos centrais + provas/fontes quando existirem) + URL editor web pra cada. Use quando o usuário perguntar "como está o brain?", "o que tem em personas?", ou quando você precisa orientar humano a editar manualmente.
---

# /conversion-agent:brain

Visualização do brain do project ativo.

## Comportamento

1. Resolve project ativo via `get_active_project`. Se não há → peça ao usuário antes.
2. Chame MCP `read_brain({ ws_slug, proj_slug })` — retorna os arquivos de brain presentes no projeto.
3. Pra cada arquivo central (tom_voz, glossario, decisoes, aprendizados, personas) e extensão presente (provas, fontes):
   - Linha 1: nome + tamanho aproximado (ex: "tom-voz: 1.2KB, atualizado há 3 dias").
   - Linha 2: URL editor web `https://agent.conversion.com.br/p/<ws_id>/<proj_id>/edit/brain/<file>.md`.
4. Se algum arquivo central está em estado-semente (default seed, não editado), sinalize: "(seed default — edite quando o cliente tiver tom-de-voz definido)".
5. Verifique se `brain/_pending.md` existe (propostas pendentes). Se sim, mostra: "Há N propostas pendentes em `_pending.md` — revisar?".

Output em prosa de consultor, ≤ 15 linhas.
