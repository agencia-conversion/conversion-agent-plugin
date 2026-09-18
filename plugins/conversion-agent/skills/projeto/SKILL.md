---
name: projeto
description: >-
  Lista os projects do workspace ativo (ou de outro ws via flag) e mostra
  qual está ativo. Sem args = lista do ws ativo. Com arg `<proj-slug>` =
  ativa esse project. Com arg `<ws>/<proj>` = workspace + project explícito
  (cross-ws). Use quando o usuário disser "qual project tô?", "abre o site
  da acme", "muda pra landing", "lista os projects".
---

# /conversion-agent:projeto [<proj-slug> | <ws>/<proj>]

Atalho de navegação por project.

## Comportamento

1. **Sem arg**:
   - Resolve workspace ativo via `get_active_project` (campo `ws_slug`).
   - Lista os projects com a MCP tool `list_workspaces_projects`. **Não leia
     arquivo de hub do disco:** o nome do hub muda com o destino (Search Hub ou
     legado) e só as tools sabem qual é o atual. Ler o arquivo direto mostra
     projetos do destino errado.
   - Indicador `●` no ativo. Convite: *"Pra trocar, `/projeto <slug>`."*

2. **Com arg `<proj-slug>`** (sem ws-slug):
   - Resolve no workspace ativo.
   - Se materializado: `set_active_project` MCP. Confirma em 1 linha.
   - Se não materializado mas existe no backend: oferecer materializar.
     *"`<proj-slug>` existe no backend mas não materializado aqui.
     Materializar agora? (s/N)"* → MCP tool `materialize_project`.
   - Se não existe: erro claro + sugestão de criar via `/novo-projeto`.

3. **Com arg `<ws>/<proj>`**:
   - Cross-workspace. Reconfirma boundary explicitamente antes de
     trocar.
   - Idem fluxo de pull se não materializado.

## Saída esperada

Curta. Ex (sem arg):

```
Workspace acme — projects:
  ● site            (último: 3 commits, 2h atrás)
    landing-x       (último: 8 dias atrás)
    landing-y       (não materializado — /pull acme/landing-y)

Pra trocar: /projeto <slug>
```
