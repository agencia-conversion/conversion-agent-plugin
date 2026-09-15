---
name: limpar-entregavel
description: >-
  Remove caracteres invisíveis e artefatos de tooling de um entregável já
  gravado (HTML, Markdown ou texto) antes de ele ir pro cliente. Use quando
  o usuário disser "limpa o redline.html", "tira os invisíveis desse
  arquivo", "o DOCX tá com caractere estranho", ou depois de importar
  conteúdo de fora. Arg: path do arquivo relativo à raiz do project.
---

# /conversion-agent:limpar-entregavel <path> [--dry-run]

Atalho pra MCP tool `sanitize_deliverable`.

## Quando NÃO precisa

Entregável gravado pelo pipeline **já entra limpo** — a canonicalização
remove os invisíveis antes do hash, no backend e no arquivo local. Esta
skill serve pro que foi salvo **antes** desse fix, ou pra conteúdo que
entrou por fora (colado de Docs, importado de outro CMS).

Se o usuário pedir a limpeza num arquivo recém-gerado pelo `/redator` ou
pelo `/otimizar-pagina`, diga isso antes de rodar — provavelmente o
resultado vai ser `changed: false` e o incômodo dele é outro.

## Comportamento

1. Resolve project ativo via `get_active_project`. Sem project ativo →
   "Escolhe o project primeiro com `/projeto`."
2. Sem `<path>` no argumento, pergunte qual arquivo. Não adivinhe: a tool
   grava por cima.
3. Chame `sanitize_deliverable({ ws_slug, proj_slug, path })`. Com
   `--dry-run`, passe `dry_run: true` — relata sem gravar.
4. Reporte em 2-3 linhas: o que saiu, por categoria, e bytes antes/depois.
   Se `changed: false`, diga "já estava limpo" e pare.

## Erros

- `unsupported_format` em `.docx`/`.xlsx`/`.pdf` → explique que são zip de
  XML e que a tool v1 trata só texto (HTML/MD/TXT/XML/SVG). Não tente
  contornar.
- `not_found` → sugira `/buscar` pra achar o path certo, ou `/pull` se o
  project estiver desatualizado.
- `project_not_in_hub` → `materialize_project` primeiro.

## Limite

Ela tira caractere invisível e, em HTML, `<meta name="generator">` e
comentário de tooling. **Não** faz evasão de detector: não parafraseia e
não mexe em C2PA/EXIF. Se o pedido for "fazer o texto não parecer IA", o
caminho é qualidade de prosa (`/editor-coesao`), não esta skill.
