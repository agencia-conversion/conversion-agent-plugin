---
name: pull
description: >-
  Re-materializa o project ativo do backend (atalho `conversion pull`). Use
  quando o usuário disser "puxa o project", "atualiza o project", "sincroniza",
  ou quando você precisar de versão fresca do disco antes de operação que
  depende dela. Sem args = project ativo (via get_active_project); com arg
  `<ws>/<proj>` = pull explícito.
---

# /conversion-skills:pull

Atalho pra `conversion pull`.

## Comportamento

1. Sem arg + project ativo definido (via `get_active_project`): executa
   `conversion pull <ws>/<proj>` em foreground via Bash.
2. Sem arg + sem project ativo: pergunte ao usuário qual project pullar
   (lista via `conversion projects`).
3. Com arg explícito: executa direto.

Reporte ao usuário: linha curta com commit pulled + path materializado.
Sem detalhes técnicos a menos que erro.
