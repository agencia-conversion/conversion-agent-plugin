---
name: novo-workspace
description: >-
  Explica como os vaults (workspaces) de squad funcionam no Brain do Search Hub
  e para onde encaminhar um pedido de novo workspace. Use quando o usuário
  disser "cria um workspace pra X", "nova squad no Brain", "vault novo",
  "workspace pra agência Y".
---

# /conversion-agent:novo-workspace

No Brain do Search Hub, **cada squad tem um vault**, e os vaults não são
criados sob demanda: são provisionados a partir do cadastro de squads do
Search Hub. Por isso esta skill não cria nada — ela orienta.

## Comportamento

1. Liste os vaults que o usuário já acessa com
   `searchhub_list_workspaces_projects`. Muitas vezes o pedido é, na verdade,
   um **projeto** novo dentro de um vault que já existe — nesse caso, encaminhe
   para `/novo-projeto`.
2. Se for mesmo uma **squad nova**: explique que o vault nasce quando a squad
   é cadastrada no Search Hub e o provisionamento roda. Peça que o usuário
   acione quem administra o cadastro de squads.
3. Se for um **cliente novo**, não um vault: o cliente precisa ser cadastrado
   no Search Hub com a squad responsável; depois, `/novo-projeto` cria o Brain.

## Quando o plugin está no modo legado

Com `CONVERSION_TOOLSET_MODE=legacy`, workspaces são os do app web antigo e
continuam sendo criados no admin, por um administrador:
https://agent.conversion.com.br/admin/ws.

## Regras

- Não prometa criar vault. A decisão é de cadastro, não do plugin.
- Linguagem de cliente, sem jargão técnico.
