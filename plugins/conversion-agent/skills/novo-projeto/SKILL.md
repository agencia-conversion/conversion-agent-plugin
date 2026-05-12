---
name: novo-projeto
description: >-
  Cria um novo project no workspace ativo (ou em ws explícito). Args:
  `<proj-slug>` (no ws ativo) ou `<ws>/<proj>` (cross-ws), `--name "Nome"`.
  Use quando o usuário disser "cria um project", "novo site pra acme",
  "adiciona o cliente X.com.br no acme".
---

# /conversion-skills:novo-projeto [<slug> | <ws>/<proj>] [--name "Nome"]

Atalho pro `conversion proj create`.

## Comportamento

1. **Resolução do workspace**:
   - Arg com `<ws>/<proj>` → workspace explícito.
   - Arg só com `<proj-slug>` → usa workspace ativo (via `get_active_project`).
   - Sem args → pergunta workspace + project + nome em sequência (1 pergunta por vez, pt-BR).
2. **Validações**:
   - Slug do project: mesmas regras (kebab-case 2-80, sem acento). Se inválido, explique.
   - Nome: 1-200 chars.
3. Execute Bash `conversion proj create <ws>/<proj> --name "<nome>"`.
4. **Tratamento de erro**:
   - 409: "`<proj>` já existe em `<ws>`. Outro slug?".
   - 403: "Você não é owner de `<ws>`. Pra criar project, peça pra um owner do ws."
5. **Sucesso**: confirme + sugira próximo passo:
   - *"✓ Project `<ws>/<proj>` criado no backend. Materializar localmente agora? `conversion pull <ws>/<proj>` — ou eu disparo pra você."*
6. Se usuário aceitar pull, execute Bash. Após pull bem-sucedido, sugira `set_active_project` MCP pra ativar.

## Regras

- Confirme cliente/marca **uma vez** se contexto for ambíguo (ex: ws ativo é "agencia-x" mas pedido cita "y.com.br" — pergunta workspace).
- Nunca crie cross-workspace silenciosamente.
