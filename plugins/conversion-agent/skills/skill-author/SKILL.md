---
name: skill-author
description: >-
  Cria uma skill nova do Conversion Agent (local, squad ou institucional) via
  conversa. Invoque quando o membro disser "quero criar uma skill", "fazer
  uma skill", "automatizar X", "transformar este fluxo em comando", ou pedir
  pra "padronizar" um atalho que ele usa repetidamente. NÃO invoque pra
  rodar uma skill que já existe — só pra autoria de uma nova.
---

# /conversion-agent:skill-author

Esta skill ajuda **membros não-técnicos da Conversion** a criar skills novas
sem editar TypeScript. Você (main session) age como **autor pareado**:
escuta o problema, decide o tier certo, scaffolda os arquivos, e devolve
uma skill que funciona.

## O que fazer ao ser invocada

### Fase 1 — Entender o problema

Pergunte ao membro **uma coisa de cada vez**, esperando resposta antes de avançar:

1. **Qual problema você está resolvendo?** Quer uma frase, não um discurso.
   Exemplo bom: "toda semana eu reescrevo 5 variações de headline pro mesmo
   cliente e gasto 30 minutos." Exemplo ruim: "automação de SEO."

2. **Você faz isso só pra você, ou o time inteiro do squad faz?** Resposta
   define o **tier**:
   - "Só eu" → tier `local` (vai pra `~/.claude/skills/<slug>/`).
   - "Meu squad inteiro faz" → tier `squad-library` (gated, ainda não
     implementado — explique que por enquanto vai como local e a versão
     compartilhável entra quando 3+ pessoas pedirem).
   - "Todos os squads da Conversion deveriam ter isso" → tier
     `institucional` (entra no plugin oficial, com watermark + IP).

3. **Que pergunta a skill responde, em uma frase?** Vira a `description`
   no front matter. Limite: 10-200 caracteres. Se a pessoa der uma frase
   longa, ajude a comprimir.

4. **Que slug?** Pergunte só se a pessoa não propôs um. Sugira algo
   `kebab-case` (`brief-rapido`, `meta-tags`, `headline-tester`). Mostre 2
   opções, deixa escolher. **Restrições do regex:** `[a-z0-9][a-z0-9-]*[a-z0-9]`,
   2-80 chars, sem maiúscula, sem underscore.

### Fase 2 — Scaffolding por tier

#### Se tier = local

Execute via Bash. **Segurança:** nunca interpole o texto do membro
(slug, description) diretamente dentro de aspas duplas — descrições com
`$(…)`, backticks ou `$VAR` seriam expandidas pelo shell. Use o tool
`Bash` passando os valores em variáveis de ambiente do próprio comando,
ou monte a invocação com aspas simples ao redor das partes literais e
escape de aspas dentro do conteúdo controlado pelo membro.

Padrão recomendado (delegando aspas ao oclif via STDIN-friendly flags):

```bash
SLUG='<slug-validado-aqui>' \
DESCRIPTION='<descricao-com-aspas-simples-internas-escapadas>' \
  conversion skill new "$SLUG" --description "$DESCRIPTION"
```

Esse comando da CLI Conversion (≥0.1.36) cria
`~/.claude/skills/<slug>/SKILL.md` + `~/.claude/skills/<slug>/skill.json`
com schema validado por Zod. Se o comando falhar com "slug inválido",
volte ao membro pra pegar slug novo. Se falhar com "já existe",
pergunte se ele quer `--force` (sobrescreve) ou outro slug.

Depois de scaffoldar:

1. **Leia o `SKILL.md` recém-criado** pra ver o template (`localSkillDir(slug) + "/SKILL.md"`).
2. **Escreva o conteúdo real da skill** dentro das seções `## When to use`,
   `## Steps`, `## Output`, baseado no problema da Fase 1. Ferramentas
   úteis pro corpo: `Edit` ou `Write`. Mantenha a estrutura, só preencha
   o miolo. **Não toque no `skill.json`** — ele é gerenciado pelo CLI.
3. **Confirme com o membro** mostrando o caminho final e instrução de uso:
   "Pronto. Sua skill está em `~/.claude/skills/<slug>/`. Reabra o Claude
   Code numa pasta de hub Conversion e invoque com `/<slug>`."

#### Se tier = squad-library

Esse caminho ainda é **gated** (não está implementado nessa rodada — ver
backlog do design `~/.gstack/projects/agencia-conversion-conversion-agent/diego-diegoivo-squad-skills-design-20260502-173052.md`,
seção "Backlog (gated por demanda empírica)").

Atalho honesto: scaffolda como `local` (Fase 2 acima) e fala pro membro:

> Por enquanto vai como skill local. Quando 3+ pessoas do seu squad
> pedirem essa skill, a Conversion ativa o tier squad-library e a gente
> compartilha em 1 dia. Avise o admin do seu workspace que você quer
> compartilhar isso.

Depois disso, se o admin do workspace pedir, abra issue
`feat(squad-library): activate for <ws-slug>` no
[agencia-conversion/conversion-agent](https://github.com/agencia-conversion/conversion-agent/issues/new).

#### Se tier = institucional

Esse caminho é **engenharia de verdade** — toca backend, watermark, CI.
**Não tente fazer sozinho.** Aja como triagem:

1. Confirme com o membro que ele entende o overhead: "uma skill
   institucional precisa de revisão da equipe Conversion, vai pelo plugin
   pra todos os squads, e demora 1-2 semanas pra deployar. Quer mesmo?"

2. Se sim, abra um issue no repo. **Segurança:** o heredoc DEVE usar
   delimitador `'EOF'` entre aspas simples — sem isso, `$VAR` e
   `$(…)` dentro do texto do membro seriam expandidos pelo shell e
   poderiam executar comandos. Em adição, escreva o body num arquivo
   temporário antes de invocar `gh` pra eliminar qualquer expansão.

   ```bash
   BODY_FILE=$(mktemp)
   cat > "$BODY_FILE" <<'EOF'
   ## Problema
   <Fase 1, ponto 1>

   ## Por que institucional (não local nem squad)
   <Fase 1, ponto 2 — justificar a generalização>

   ## Description proposta
   <Fase 1, ponto 3>

   ## Slug proposto
   <Fase 1, ponto 4>

   ## Quem propõe
   <membro>
   EOF
   gh issue create \
     --repo agencia-conversion/conversion-agent \
     --title 'feat(skills): proposta institucional' \
     --label 'skill-proposal' \
     --body-file "$BODY_FILE"
   rm -f "$BODY_FILE"
   ```

   Note as aspas simples em `'EOF'`, em `--title`, e em `--label`: o
   shell trata o conteúdo literal e nada é expandido. Substitua os
   placeholders `<…>` no momento da geração do arquivo, **antes** de
   invocar o `gh`.

3. Diga ao membro: "Issue aberto. Diego ou um admin Conversion vai
   priorizar. Enquanto isso, você pode ter a versão local rodando em 30
   segundos." E ofereça scaffoldar como local (Fase 2 — local).

### Fase 3 — Verificação

Independente do tier, antes de dizer "pronto":

1. **Confirme que o `skill.json` (se for local) tem `version: 1` e o
   timestamp do dia.** Use `Read` no caminho.

2. **Releia o `SKILL.md` final** e cheque:
   - Front matter `name:` bate com o slug.
   - `description:` está YAML-quoted se contém `:`, `"`, `-`, `#`.
   - As 3 seções (`## When to use`, `## Steps`, `## Output`) têm conteúdo
     real, não placeholder `<step 1>`.

3. **Se a skill chama MCP tools**, mencione os requisitos:
   - Plugin Conversion deve estar instalado.
   - Membro deve estar logado (`conversion login`).
   - Sessão Claude Code deve estar num diretório de hub Conversion (CLI
     pra MCP saber qual workspace usar).

## Guardrail (anti-loop)

- **Não invoque skill-author recursivamente.** Se o membro pedir "cria
  uma skill que cria skills", explique que skill-author já é isso.
- **Não escreva o `skill.json` à mão.** Sempre via `conversion skill new`.
  O comando faz validação Zod + atomic write — escrever direto vai
  falhar no schema.
- **Não inicie scaffolding antes da Fase 1.** Sem problema claro a skill
  vira lixo no graveyard do `~/.claude/skills/`. Resista à pressão de
  "anda logo, só cria."
- **Se o membro pedir pra refazer uma skill institucional existente
  (`/briefing`, `/redator`, etc.) localmente**, recuse: essa metodologia
  é IP da Conversion. Sugira que ele use a institucional via
  `/<slug-institucional>` direto.

## Saída esperada

Mensagem final ao membro com:
- Caminho do `SKILL.md` (ou link do issue se foi institucional).
- Tier escolhido + justificativa em 1 frase.
- Comando de invocação (`/<slug>`).
- Próximo passo concreto ("reabra o Claude Code aqui e invoque com `/<slug>`",
  ou "espere o admin Conversion priorizar o issue").
