---
name: novo-workspace
description: Cria um novo workspace. Pode ser invocada com args (`/novo-workspace acme --name "Acme"`) ou sem args (Consultor pergunta slug + nome em uma linha cada). Use quando o usuário disser "cria um workspace pra X", "novo cliente", "workspace pra agência Y".
---

# /conversion-agent:novo-workspace [<slug>] [--name "Nome"]

Cria um novo workspace.

> **Nota:** o CLI `conversion` foi descontinuado e ainda **não há MCP tool**
> de criação de workspace. A criação é feita no app web (admin) por um
> administrador — esta skill valida os dados e encaminha o usuário pra lá.

## Comportamento

1. **Colete slug + nome** (dos args, ou perguntando o que falta — slug
   primeiro, depois nome). Validações:
   - Slug: kebab-case, 2-80 chars, sem espaço, sem acento. Se inválido, explique exatamente o quê e peça de novo.
   - Nome: 1-200 chars, qualquer charset razoável.
2. **Criação (app web)**: oriente o usuário a criar o workspace no admin —
   https://agent.conversion.com.br/admin/ws — com o slug + nome validados.
   (Só admin cria workspace; se slug duplicado, o app avisa — peça outro.)
3. Sugira próximo passo: `/novo-projeto <slug>/<projeto-slug> --name "Nome"` se o usuário pareceu pronto pra criar project também.

## Regras

- **Não exponha curl/API direto** — a criação é feita pela UI admin do app web.
- Linguagem de cliente. Zero jargão técnico (slug é OK, é vocabulário do usuário do plugin).
