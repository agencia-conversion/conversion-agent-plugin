---
name: novo-workspace
description: Cria um novo workspace. Pode ser invocada com args (`/novo-workspace acme --name "Acme"`) ou sem args (Consultor pergunta slug + nome em uma linha cada). Use quando o usuário disser "cria um workspace pra X", "novo cliente", "workspace pra agência Y".
---

# /conversion-agent:novo-workspace [<slug>] [--name "Nome"]

Atalho pro `conversion ws create`.

## Comportamento

1. **Args completos** (slug + nome): execute Bash `conversion ws create <slug> --name "<nome>"`.
2. **Args parciais ou nenhum**: pergunte ao usuário o que falta — slug primeiro, depois nome. Validações:
   - Slug: kebab-case, 2-80 chars, sem espaço, sem acento. Se inválido, explique exatamente o quê e peça de novo.
   - Nome: 1-200 chars, qualquer charset razoável.
3. Execute Bash. Se 409 (slug duplicado): "Slug `<slug>` já existe. Quer outro nome?".
4. Sucesso: confirme em uma linha com URL admin pra editar:
   *"✓ Workspace `<slug>` criado. Editar: https://agent.conversion.com.br/admin/ws/<id>"*.
5. Sugira próximo passo: `/novo-projeto <slug>/<projeto-slug> --name "Nome"` se o usuário pareceu pronto pra criar project também.

## Regras

- **Não exponha curl/API direto** — use sempre o CLI (`conversion ws create`).
- Linguagem de cliente. Zero jargão técnico (slug é OK, é vocabulário do usuário do plugin).
