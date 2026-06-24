---
name: brain-update
description: Consolida aprendizados dos últimos entregáveis aprovados e propõe atualizações à memória do projeto (brain). Use para atualizar o tom de voz, registrar decisões editoriais, estender o glossário, capturar aprendizados, refinar personas, ou consolidar qualquer padrão recorrente observado. Grava em brain/_pending.md para revisão humana — NÃO altera o brain direto. Invocada automaticamente pela main session em Fase 4 do orquestrador (aprovação de entregável); também pode ser chamada manualmente para consolidar padrões acumulados.
---

# /conversion-agent:brain-update

Esta skill consolida padrões observados nos últimos entregáveis aprovados e
propõe **atualizações à memória do projeto** (os 5 arquivos de `brain/`)
como um documento pendente (`brain/_pending.md`). **Um humano aprova** via
editor web ou CLI antes das mudanças migrarem para os arquivos definitivos.

## 0. Quando esta skill roda

**Disparo automático (default).** Em Fase 4 do orquestrador (quando o
humano aprova um deliverable), a main session invoca esta skill sem
perguntar. Custo é baixo — propostas ficam em `brain/_pending.md` e o
humano revisa quando quiser. Zero propostas é um resultado válido; se a
skill não detectar padrão novo, o reporte confirma isso e o fluxo segue.

**Disparo manual.** Pode ser invocada direto pelo humano (`/conversion-agent:brain-update`)
para consolidar padrões acumulados em múltiplos entregáveis já
aprovados — útil ao final de uma bateria de trabalho ou quando o brain
está "atrasado" em relação ao output recente.

**Nunca dispare você mesma em cadeia.** Uma execução de brain-update
não dispara outra — previne loop infinito.

## 1. Confirme o project-root

O CWD atual precisa ser um project-root (contém `.conversion/manifest.json`).
Se não for, PARE e peça ao usuário para rodar `conversion pull <ws>/<proj>`
ou `cd` para o project-root.

## 2. Leia o brain atual

Invoque a MCP tool `conversion-context:read_brain` (sem argumentos) para
carregar os 5 arquivos de `brain/`:

- `brain.tom_voz`
- `brain.glossario`
- `brain.decisoes`
- `brain.aprendizados`
- `brain.personas`

Você precisa conhecer o estado atual do brain antes de propor
acréscimos/ajustes — propostas redundantes são rejeitadas.

## 3. Colete os últimos entregáveis aprovados

Invoque a MCP tool `conversion-context:search_project` com:

```json
{ "type": "artigo", "status": "approved", "limit": 10 }
```

Repita o mesmo padrão para `cluster` (status `active`) e para
`newsletter`/`relatorio` se o projeto os tiver. Consolide a lista dos
últimos ~10-20 entregáveis mais recentes (ordenados pela resposta, que já
vem por `updated_at desc`).

Para cada entregável relevante, use `conversion-context:get_content` com o
slug para puxar `bodyPreview` + `frontmatter` — você só precisa do conteúdo
suficiente para detectar padrões, não do corpo inteiro.

## 4. Detecte padrões

Analise o material e identifique **apenas** mudanças que valem formalizar.
Exemplos válidos:

- **tom_voz**: um tom/recurso retórico aparecendo consistentemente (≥3
  entregáveis) que não está no `brain/tom-voz.md`.
- **glossario**: um termo preferido ou proibido repetido sem padronização
  (escolhas inconsistentes entre artigos).
- **decisoes**: uma decisão editorial implícita (ex: "sempre abrir com
  dado", "nunca usar jargão técnico nos 3 primeiros parágrafos") que se
  repetiu e merece virar regra explícita.
- **aprendizados**: o que funcionou (engajamento, performance) ou não,
  se o entregável trouxer essa informação no frontmatter ou corpo.
- **personas**: refinamento da audiência quando o briefing/artigo revelar
  um recorte novo (ex: persona secundária).

**Não proponha**:

- Mudanças que já estão no brain (verifique antes).
- Propostas vagas sem ≥2 entregáveis como evidência.
- Regras que duplicam a metodologia da Conversion (ela já é guardrail).
- Mais de 10 propostas de uma vez — priorize as mais importantes.

## 5. Monte o arquivo `brain/_pending.md`

A estrutura segue o schema Zod `brain.pending`:

```yaml
---
type: brain.pending
title: Propostas de atualização
updated_at: <ISO-8601 timestamp now>
proposals:
  - target: brain.glossario
    summary: "Incluir termo 'funil de conversão' como preferido"
    rationale: "Apareceu 4x em artigos recentes com grafias inconsistentes (funil-conversão, funil, funil de conversão)."
    source_slugs: [seo-b2b-funil, como-atrair-leads, artigo-3]
  - target: brain.tom_voz
    summary: "Abrir com dado concreto (número, estatística)"
    rationale: "5 dos últimos 6 artigos aprovados abrem assim. Parece ser padrão editorial adotado."
    source_slugs: [...]
---

# Propostas de atualização

Esta página contém propostas de atualização à memória do projeto. Cada
proposta vem dos padrões observados nos últimos entregáveis aprovados.

**Para aprovar**: mover cada proposta (manualmente via editor ou CLI)
para o arquivo correspondente em `brain/` e deletar a entrada daqui.

## Proposta 1 — brain.glossario: ...

(texto livre explicando a proposta, opcional)
```

Regras:

- `target` deve ser um dos tipos brain (`brain.tom_voz`, `brain.glossario`,
  `brain.decisoes`, `brain.aprendizados`, `brain.personas`, `brain.provas`,
  `brain.fontes`).
- `summary` ≤ 300 chars, imperativo, uma linha só.
- `rationale` entre 4 e 2000 chars, explicação curta do porquê + evidência.
- `source_slugs` é opcional mas **altamente recomendado** — um humano
  precisa poder clicar e validar.
- Máximo **10** propostas por vez.

Se o arquivo `brain/_pending.md` já existe (tem propostas anteriores) **E
esta execução gerou propostas novas**: substitua por completo (a skill não
faz merge — cada invocação com output é uma foto do momento). **Se esta
execução gerou ZERO propostas**: NÃO toque no arquivo existente —
propostas anteriores continuam válidas até o humano resolver.

## 6. Output (MANDATORY file write via MCP)

Use `conversion-context:project_save_and_url` com `path="brain/_pending.md"`
e `content=<markdown completo acima>`. A tool retorna a URL web do arquivo
— copie e retorne ao usuário.

## 7. Reporte (formato estruturado — MANDATORY)

Responda **exatamente** neste formato, pra o orquestrador parsear:

```
Brain-update report:
proposals: <N>
by_target: tom_voz=<a>, glossario=<b>, decisoes=<c>, aprendizados=<d>, personas=<e>
url: <web URL do brain/_pending.md, ou "none" se proposals=0 e não houve gravação>
summary: <frase curta com ou sem propostas; ver abaixo>
```

Regras do campo `summary`:

- Se `proposals > 0`: frase imperativa compacta descrevendo o conteúdo,
  ≤ 120 chars. Ex: `summary: "3 propostas (2 glossário, 1 decisão) aguardando revisão em brain/_pending.md"`.
- Se `proposals == 0`: exatamente `summary: "Nenhum padrão novo detectado — brain está em dia"`.

Regras do campo `by_target`:

- Sempre lista os 5 targets em ordem fixa (tom_voz, glossario, decisoes,
  aprendizados, personas), com os que não apareceram como `=0`.
- Se `proposals = 0`, todos são `=0`.

Regras do campo `url`:

- Se `proposals > 0`: URL web retornada pela MCP tool `project_save_and_url`.
- Se `proposals == 0`: emita `url: none` e NÃO grave arquivo (não pisar em
  um `_pending.md` existente sem motivo — se já houver propostas de uma
  execução anterior, deixe intactas).

**Zero prosa explicativa fora desse bloco.** O orquestrador espera
parseável. Se precisa dizer algo adicional (erro, ambiguidade), use o
caminho `Conclusão: INCONCLUSIVO — <motivo>` (análogo ao sub-agent
conversion-qa) e pare.

## 8. Restrições

- NÃO edite diretamente os 5 arquivos de `brain/` — sempre via `_pending.md`.
- NÃO proponha mudanças sem evidência concreta (slugs dos entregáveis).
- NÃO invente conteúdo — se o material for fraco, proponha zero.
- NÃO dump no chat — a resposta do agente é curta; o conteúdo vai para o
  arquivo.
