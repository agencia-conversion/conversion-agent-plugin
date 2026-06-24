# Conversion Agent — Plugin para Claude Code

Plugin oficial da **Agência Conversion** que liga o Claude Code à
metodologia proprietária de SEO da empresa. A metodologia em si vive no
backend autenticado (`https://agent.conversion.com.br`); este repositório
contém apenas o manifest, os stubs de skill e o MCP server empacotado.

<!--
  GERADO AUTOMATICAMENTE: este README é sincronizado a partir de
  `packages/plugin/PUBLIC_README.md` no monorepo privado
  (agencia-conversion/conversion-agent) pelo workflow `sync-public-plugin.yml`.
  Edições manuais aqui serão sobrescritas — edite a fonte no monorepo.
-->

> Este repositório (manifests, skills, mcp-server e este README) é gerado
> automaticamente a partir do monorepo privado. Para correções, abra um
> issue ou um PR no monorepo.

---

## Pré-requisitos

- E-mail corporativo `@conversion.com.br` ativado pelo admin.
- **Node.js 20+** (`node --version` deve mostrar `v20.x` ou superior).
- **Claude Code CLI** instalado (https://claude.com/code).

> Você **não** precisa de nenhum CLI da Conversion. O antigo
> `@agenciaconversion/cli` foi **descontinuado** — `npm install -g
> @agenciaconversion/cli` retorna `404`. Tudo roda pelo plugin do Claude Code,
> e o login acontece sozinho na primeira skill.

## Instalação no Mac

### 1. Node 20 (se ainda não tem)

```bash
brew install node@20
brew link --overwrite node@20
node --version
```

### 2. Plugin no Claude Code

Dentro do Claude Code:

```
/plugin marketplace add agencia-conversion/conversion-agent-plugin
/plugin install conversion-agent@conversion-agent
/reload-plugins
```

O Claude Code baixa o plugin e inicia o MCP server automaticamente
(empacotado no plugin — não baixa nada de registry no startup).

### 3. **Ative auto-update agora** (recomendado)

Logo após instalar, dentro do Claude Code rode:

```
/plugin
```

→ aba **Marketplaces** → selecione **conversion-agent** → toggle
**Enable auto-update**.

A cada vez que o Claude Code abrir, ele checa se houve commit novo e
atualiza o plugin sozinho. Sem isso, você precisaria rodar
`/plugin marketplace update conversion-agent` manualmente.

### 4. Primeiro uso (o login acontece aqui, sozinho)

Descreva uma pauta (ou rode `/conversion-agent:conversion-start`). Na
**primeira** chamada, o orquestrador percebe que falta sessão e dispara um
**magic link** para o seu e-mail `@conversion.com.br`:

- Clique no link; a página confirma e fecha sozinha.
- A sessão é salva automaticamente. **Você não roda comando de login.**

Confira o contexto ativo:

```
/conversion-agent:whereami
```

---

## Instalação no Windows

Use **PowerShell** ou **Windows Terminal**.

### 1. Node 20

```powershell
winget install OpenJS.NodeJS.LTS
node --version
```

Reabra o terminal pra `node` aparecer no `PATH`.

### 2. Claude Code CLI

Baixe o instalador `.exe` em https://claude.com/code.

### 3. Plugin no Claude Code

Idêntico ao Mac:

```
/plugin marketplace add agencia-conversion/conversion-agent-plugin
/plugin install conversion-agent@conversion-agent
/reload-plugins
```

### 4. **Ative auto-update agora** (recomendado)

Dentro do Claude Code:

```
/plugin
```

→ aba **Marketplaces** → **conversion-agent** → **Enable auto-update**.

### 5. Primeiro uso (login automático)

Descreva uma pauta (ou `/conversion-agent:conversion-start`). O magic link
chega no seu e-mail corporativo; clique e a sessão fica salva. Sem comando
de terminal.

```
/conversion-agent:whereami
```

---

## Abrindo um project

Não há comando de terminal. A materialização é conversacional — peça em
prosa ("abre o project `<slug>`") ou use as skills do plugin:

```
/conversion-agent:projeto       # lista e ativa projects do workspace
/conversion-agent:abrir <slug>  # materializa + ativa um project
```

A pasta criada conterá `briefing/`, `deliverables/`, `brain/`. As mudanças
são sincronizadas com o backend automaticamente enquanto o Claude Code está
aberto.

## Skills disponíveis

Invocadas com `/conversion-agent:<nome>` dentro do Claude Code:

| Skill | Função |
|---|---|
| `conversion-start` | Ponto de entrada; descreva a pauta e o orquestrador conduz |
| `whereami` | Mostra contexto da sessão (workspace, project, brain) |
| `briefing` | Gera briefing SEO a partir de tópico + keyword |
| `redator` | Transforma briefing em artigo aplicando 9 quality gates |
| `revisor` | QA do artigo contra checklist proprietário |
| `editor-coesao` | Refina coesão textual em PT-BR |
| `cluster` | Cria cluster (pillar + satellites) |
| `brain` / `brain-update` | Memória do project (tom, glossário, decisões) |
| `projeto` / `abrir` | Navegação e materialização de projects |
| `workspace` | Navegação entre workspaces |
| `historico` / `buscar` | Pesquisa no project |
| `convidar` / `novo-projeto` / `novo-workspace` | Admin |

`/conversion-agent:skills` lista todas com descrições atualizadas.

## Troubleshooting

### `npm error 404 … @agenciaconversion/cli`
Esperado — o CLI foi **descontinuado**. Ignore qualquer guia antigo que
mande `npm install -g @agenciaconversion/cli`. Siga o fluxo plugin-first
acima.

### Plugin não aparece após `/plugin install`
Rode `/reload-plugins` ou reinicie o Claude Code. Se persistir, force re-add
do marketplace:

```
/plugin marketplace remove conversion-agent
/plugin marketplace add agencia-conversion/conversion-agent-plugin
/plugin install conversion-agent@conversion-agent
```

### `Failed to install: This plugin uses a source type your Claude Code version does not support`
`marketplace.json` em cache antigo. Atualize o Claude Code pra versão
recente e force o re-add do marketplace (bloco acima).

### Skill responde `not_authenticated` ou `session_expired`
Não rode nada manual. Reinvoque `/conversion-agent:conversion-start` — o
orquestrador dispara um novo magic link no seu e-mail. Clique e siga.

### Magic link não chega
Cheque spam. Confirme que seu e-mail `@conversion.com.br` foi ativado pelo
admin. Se não chegar em ~30s, fale com o suporte.

### `rate_limited`
Você passou de 100 chamadas/hora. Espere o tempo indicado.

## Suporte

- Issue técnica: abra neste repo.
- Metodologia ou acesso: `diego@conversion.com.br`.

## Licença

Proprietário — Agência Conversion. Uso interno apenas.
