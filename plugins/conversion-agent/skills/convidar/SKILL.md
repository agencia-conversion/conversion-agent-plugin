---
name: convidar
description: Convida um member pro workspace ativo (ou outro via `--ws`). Arg: `<email>`. Use quando o usuário disser "convida fulano@x.com pra acme", "adiciona o joão como member", "manda convite pro novo dev".
---

# /conversion-skills:convidar <email> [--ws <ws-slug>]

Atalho pro `conversion members invite`.

## Comportamento

1. **Resolver workspace**:
   - Flag `--ws <slug>` → explícito.
   - Sem flag → workspace ativo (via `get_active_project`).
   - Sem ativo + sem flag → pergunta workspace.
2. **Validar email**:
   - Formato válido (regex simples).
   - Se backend rejeitar (`email_not_whitelisted`): explique limitação do whitelist.
3. Execute Bash `conversion members invite <email> --ws <ws-slug>`.
4. **Tratamento**:
   - 409 `already_member`: "`<email>` já é member de `<ws>`. Pra trocar role, use a UI admin (`/admin/ws/<id>/members`) — CLI ainda não suporta promote diretamente."
   - 400 `email_not_whitelisted`: "Email `<email>` fora do whitelist Conversion. Pedir admin pra ajustar."
   - 403: "Você não é owner de `<ws>`. Convite só por owner."
5. **Sucesso**: *"✓ Convite enviado para `<email>` em `<ws>`. Eles aparecem na lista de members após o primeiro login."*
   Sugira `/convidar` pra próximo email se o usuário tiver mais.

## Regras

- Confirme uma vez antes de mandar quando email parecer typo (ex: `@gmial.com`).
- Nunca convide múltiplos sem confirmação explícita do usuário.
