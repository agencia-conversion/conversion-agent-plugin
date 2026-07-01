---
name: sync-feedbacks
description: "Extrai comentarios de revisao de Docs/.docx de um cliente e grava como conhecimento markdown (feedbacks/ + brain/_pending) num projeto Conversion Agent, com dedup incremental. Descobre os documentos via client_id (MCP tool mcp__conversion__feedback_sources)."
---

# /conversion-skills:sync-feedbacks

Extrai comentarios de revisao de Docs/.docx de um cliente e grava como conhecimento markdown (feedbacks/ + brain/_pending) num projeto Conversion Agent, com dedup incremental.

## When to use

Quando a analista pedir para **puxar / sincronizar os feedbacks de revisão dos
clientes** — os **comentários** que revisores deixam em Google Docs / `.docx` — para
dentro de um projeto Conversion Agent. O problema que isso resolve: hoje, quando a IA
produz conteúdo, ela não enxerga os feedbacks antigos e repete os mesmos erros. Esta
skill extrai esses comentários, reconhece o que já foi processado, e os transforma em
conhecimento markdown no projeto (`feedbacks/`) + propostas de aprendizado no `brain/` —
que é onde as skills de conteúdo (`/briefing`, `/redator`) de fato leem.

Gatilhos típicos: *"puxa os feedbacks do cliente X"*, *"sincroniza os comentários do
cliente 1071 pro nike-bi"*, *"atualiza os aprendizados com as revisões"*.

> Extrai **somente comentários** (nunca o corpo do texto). Funciona em **massa**:
> vários documentos comentados de um cliente de uma vez.

## Pré-requisitos

- **MCP `conversion` instalado.** A tool `mcp__conversion__feedback_sources` (descoberta
  dos documentos no passo 3) é servida pelo MCP server `conversion`. Se ela não existir na
  sessão, instale uma vez com:
  ```bash
  claude mcp add --transport http conversion http://mcp.conversion.com.br/mcp
  ```
  Depois reabra a sessão (ou rode `/reload-plugins`) para a tool aparecer. Esse MCP é
  compartilhado — todos os usuários da skill apontam para o mesmo endpoint e a mesma tool.
- **Login Google (Drive) por conta própria.** A leitura dos comentários usa a conta
  Google do **próprio analista**, via Application Default Credentials (ADC) — **não**
  depende mais de token nem de `client_secret` do squad BI (aqueles arquivos só
  existiam nas máquinas do squad). Valide com o passo 4; se faltar, o login é
  `gcloud auth application-default login --scopes=...` (cada analista loga com a
  própria conta). Detalhe no passo 4.
- **Login Conversion ativo** (para as MCP tools de save e para
  `mcp__conversion__feedback_sources`). Se alguma tool retornar `not_authenticated`,
  faça o login transparente (magic link) antes de continuar.
- Scripts Python da skill em `${CLAUDE_PLUGIN_ROOT}/skills/sync-feedbacks/scripts/`
  (`drive_auth.py`, `extract_comments.py`). Dependências em `requirements.txt`
  (`google-api-python-client`, `google-auth`, `python-docx`). O login Google usa o
  `gcloud` (Google Cloud SDK), já instalado nas máquinas.

## Steps

1. **Resolver o projeto-alvo.** Chame `get_active_project`. Se houver projeto ativo,
   use seu `ws_slug`/`proj_slug`. Se `null`, pergunte à usuária qual projeto (formato
   `workspace/projeto`, ex.: `conversion/nike-bi`) e confirme antes de seguir.
   **Nunca infira** ws/proj.

2. **Pedir o `client_id`.** Peça o **id do cliente** (inteiro, ex.: `1071`). É esse id
   que descobre os documentos comentados do cliente — não há mais pasta do Drive a
   informar.

3. **Descobrir os documentos (MCP `mcp__conversion__feedback_sources`).** Esta é uma
   **chamada à tool MCP** `mcp__conversion__feedback_sources` — **não** é um script
   local. Invoque-a passando exatamente `{ client_id: <inteiro> }` (o id do passo 2). A
   tool consulta o backend e devolve `{ rows: [...] }`, onde cada `row` tem
   `{ txt_link, Created_Date, fk_cliente }`. Colete os `txt_link` (as URLs dos
   documentos comentados), preservando a ordem — é essa lista que alimenta o extractor
   no passo 5.
   - Se a tool retornar `not_authenticated` / `session_expired`, faça o **login
     transparente** (magic link) e **repita a chamada** antes de seguir. Não peça pra
     usuária autenticar manualmente — você conduz.
   - Se `rows` vier vazio, informe à usuária que o cliente `<client_id>` não tem
     documentos de feedback registrados e **pare** (nada a extrair).

4. **Garantir auth do Drive (Google ADC).** Rode:
   ```bash
   python "${CLAUDE_PLUGIN_ROOT}/skills/sync-feedbacks/scripts/drive_auth.py" --whoami
   ```
   Se imprimir o e-mail `@conversion.com.br`, siga. Se falhar (ADC ausente ou sem o
   escopo do Drive), o próprio script imprime o comando de login. Como o login Google
   **abre o browser e exige interação**, esta é a exceção à regra de conduzir sozinho:
   peça à analista que rode o login no chat com o prefixo `!`:
   ```
   ! gcloud auth application-default login --scopes=https://www.googleapis.com/auth/drive.readonly,https://www.googleapis.com/auth/cloud-platform
   ```
   Cada analista loga com a **própria conta Google** — sem nenhum arquivo do squad BI.
   Depois rode o `--whoami` de novo para confirmar.

5. **Extrair os comentários.** Defina um workdir, escreva as URLs (`txt_link` do passo 3,
   uma por linha) num arquivo, e rode o extractor (passe os slugs reais resolvidos no
   passo 1):
   ```bash
   WORKDIR="$HOME/.conversion-feedbacks/_run-<proj>"
   rm -rf "$WORKDIR" && mkdir -p "$WORKDIR"
   # grave as URLs (uma por linha) em "$WORKDIR/_docs.txt"
   python "${CLAUDE_PLUGIN_ROOT}/skills/sync-feedbacks/scripts/extract_comments.py" extract \
       --docs "$WORKDIR/_docs.txt" --ws <ws> --proj <proj> --workdir "$WORKDIR"
   ```
   A lista de URLs pode vir por arquivo (`--docs <arquivo>`) ou por stdin (`--docs -`).
   Flags opcionais: `--only-open` (ignora comentários resolvidos; o default inclui e
   sinaliza `[RESOLVIDO]`), `--rebuild` (reprocessa tudo, ignorando o dedup).
   O script imprime um resumo JSON (`counts` new/changed/skipped/no-comments/error +
   lista `to_save`) e grava `feedbacks/*.md` em `$WORKDIR/feedbacks/`.

6. **Persistir os feedbacks no projeto (MCP).** Se `to_save` estiver vazio, pule para
   o passo 9 (nada novo). Senão, leia cada arquivo em `$WORKDIR/feedbacks/*.md` (Read)
   e grave todos num **único** `project_save_batch`, passando `ws_slug`/`proj_slug` e
   `files[]` com `path = feedbacks/<arquivo>.md` + `content`. Inclua **no mesmo batch**
   o arquivo do brain do passo 7. Guarde a URL retornada.

7. **Ponte com o brain — um arquivo por rodada (fecha o loop).** A partir **dos
   comentários novos/alterados**, destile os **padrões recorrentes e acionáveis** (ex.:
   "cliente sempre pede CTA mais direto", "evitar jargão X", "datar dados") como uma lista
   enxuta de propostas — não copie comentário a comentário, **sintetize**. Grave num
   arquivo **novo e exclusivo desta rodada**, usando o `round_id` do resumo do passo 5:
   - `path = brain/_pending-feedbacks-<round_id>.md` (ex.: `brain/_pending-feedbacks-2026-05-28-1432.md`).
   - Inclua esse arquivo no **mesmo** `project_save_batch` do passo 6.
   - **Não** mantenha cópia cumulativa local e **não** reescreva arquivos de rodadas
     anteriores. Cada rodada é um arquivo independente.

   Por que um arquivo por rodada: a humana revisa e, ao promover, **apaga aquele arquivo**
   — e ele **nunca reaparece**, porque rodadas futuras só criam arquivos com `round_id`
   novo (e o dedup do passo 5 garante que um doc já processado não volta a gerar proposta,
   salvo `--rebuild`, que cria outro arquivo datado, sem tocar nos antigos).

   Esse arquivo é **propriedade desta skill** — **não toque em `brain/_pending.md`**, que é
   do ritual brain-vivo (`/brain-update`). A humana revisa `brain/_pending-feedbacks-*.md`
   e promove o que valer para `brain/aprendizados.md` / `brain/glossario.md` /
   `brain/decisoes.md` — é a promoção que faz `/briefing` e `/redator` pararem de repetir
   os erros (porque `read_brain` lê só os 5 arquivos definitivos).

8. **Confirmar o manifest (dedup).** **Só depois** do `project_save_batch` ter
   sucesso, rode:
   ```bash
   python "${CLAUDE_PLUGIN_ROOT}/skills/sync-feedbacks/scripts/extract_comments.py" commit \
       --ws <ws> --proj <proj> --workdir "$WORKDIR"
   ```
   Isso marca os docs gravados como processados (por fingerprint), para a próxima
   rodada pular o que não mudou. Se o save falhar, **não** rode o commit — assim o
   doc é reprocessado na próxima vez.

9. **Reportar.** Devolva à usuária, em linguagem de cliente:
   - A **URL web** do save (passo 6).
   - Resumo: N feedbacks gravados (novos/alterados), N pulados (sem mudança), total de
     comentários, quantos resolvidos.
   - Se houve propostas de brain: aponte o arquivo da rodada
     `brain/_pending-feedbacks-<round_id>.md` para revisão e lembre que promover para
     `aprendizados.md` (e apagar o arquivo da rodada) é o que alimenta as skills de conteúdo.
   - Erros por documento (status `error` no resumo), se houver.

## Output

| Artefato | Onde | O quê |
|---|---|---|
| `feedbacks/<doc>-<id8>.md` | projeto (via MCP) | 1 arquivo por documento comentado: autor, data, trecho ancorado, respostas, flag `[RESOLVIDO]` |
| `brain/_pending-feedbacks-<round_id>.md` | projeto (via MCP) | propostas de aprendizado destiladas — **um arquivo por rodada**; revise, promova para os 5 brain definitivos e apague |
| URL web | chat | link do editor para os arquivos gravados |
| Resumo de dedup | chat | novos / alterados / pulados / sem-comentários / erros |

**Descoberta por `client_id`:** os documentos não vêm mais de uma pasta do Drive
informada à mão — vêm da **tool MCP** `mcp__conversion__feedback_sources`, que recebe
`{ client_id }` e devolve `{ rows: [{ txt_link, Created_Date, fk_cliente }] }`. O extractor
recebe os `txt_link` via `--docs` e resolve o `fileId` de cada link. A leitura dos
comentários continua **local**, via Google ADC do próprio analista (`drive_auth.py`;
login self-service com `gcloud auth application-default login`, sem arquivos do squad BI).

**Dedup incremental:** o estado vive em `$HOME/.conversion-feedbacks/<ws>__<proj>.json`
(fingerprint por documento). Documentos sem mudança nos comentários são pulados; um
comentário **novo** num Google Doc é detectado mesmo sem alteração no corpo (o
fingerprint do doc nativo inclui id+modifiedTime de cada comentário). Nomes de arquivo
são determinísticos por documento → reprocessar sobrescreve o próprio arquivo, sem
duplicar. `--rebuild` força reprocessar tudo (útil se o manifest local se perder).

**Google Doc nativo vs `.docx`:** exportar um Google Doc para `.docx` **perde os
comentários** — por isso documentos nativos usam a Drive API `comments().list`, e só
os `.docx` enviados são lidos via `word/comments.xml`. A skill escolhe o caminho pelo
`mimeType` automaticamente.
