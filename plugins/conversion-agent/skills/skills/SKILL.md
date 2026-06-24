---
name: skills
description: Lista todas as skills do plugin Conversion Agent com descrição curta. Use quando o usuário perguntar "que comandos existem?", "o que você sabe fazer?", "como começo?", ou no início de uma sessão pra orientar fluxos disponíveis.
---

# /conversion-agent:skills

Catálogo das skills disponíveis no plugin.

## Comportamento

Liste em prosa de consultor as skills agrupadas por propósito. Use a tabela abaixo como fonte da verdade — extraia descrição do `frontmatter.description` de cada SKILL.md em `packages/plugin/skills/`. Atualize esta lista quando skills forem adicionadas:

### Pontos de entrada
- `/conversion-start` — entrada oficial; abre fluxo de SEO.
- `/orchestrator` — playbook do Consultor (espelho do CLAUDE.md).

### Conteúdo editorial (skills de geração)
- `/briefing` — análise SERP + skyscraper plan + pesquisa de fontes.
- `/redator` — gera artigo a partir do briefing.
- `/factcheck` — gera ledger de claims + dossiê factual.
- `/revisor` — revisa quality gates inline.
- `/editor-coesao` — coesão final em pt-BR.
- `/cluster` — pilar + satélites.

### Memória (brain)
- `/brain-update` — propõe atualizações ao brain (auto-fire em Fase 4).
- `/brain` — visualiza estado do brain (arquivos centrais + provas/fontes).

### Navegação
- `/workspace` — lista/troca workspace ativo.
- `/projeto` — lista/troca project ativo.
- `/whereami` — contexto completo (ws + proj + brain + recentes).

### Operacional
- `/pull` — re-materializa project ativo.
- `/status` — diff local vs backend.
- `/buscar <termo>` — full-text no project.
- `/abrir <slug>` — URL editor web.
- `/historico` — últimos N commits do project.

### Admin (atalhos)
- `/novo-workspace` — cria workspace.
- `/novo-projeto` — cria project no ws ativo.
- `/convidar <email>` — convida member.

### Discovery
- `/skills` (este).

Após listar, sugira o próximo passo conforme contexto:
- Sem project ativo → "Comece com `/projeto` pra escolher onde trabalhar."
- Com project ativo → "Qual deliverable quer hoje? `/briefing`, `/cluster`, `/redator`..."
