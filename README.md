# Conversion Agent — Plugin para Claude Code

Plugin oficial da **Agência Conversion** que liga o Claude Code à
metodologia proprietária de SEO da empresa. A metodologia em si vive no
backend autenticado (`https://agent.conversion.com.br`); este repositório
contém apenas o manifest, os stubs de skill e a referência ao MCP server
publicado no NPM.

> Este repo é gerado automaticamente a partir do monorepo privado.
> Mudanças manuais aqui serão sobrescritas — abra um issue.

---

## Pré-requisitos

- E-mail corporativo `@conversion.com.br` ativado pelo admin.
- **Node.js 20+** (`node --version` deve mostrar `v20.x` ou superior).
- **Claude Code CLI** instalado (https://claude.com/code).

## Instalação no Mac

### 1. Node 20 (se ainda não tem)

```bash
brew install node@20
brew link --overwrite node@20
node --version
```

### 2. CLI da Conversion

```bash
npm install -g @agenciaconversion/cli
conversion login
```

O `conversion login` abre o navegador. Digite seu e-mail corporativo,
clique no link recebido e o token vai pro **macOS Keychain**.

Confira:

```bash
conversion whoami
```

### 3. Plugin no Claude Code

Dentro do Claude Code:

```
/plugin marketplace add agencia-conversion/conversion-agent-plugin
/plugin install conversion-agent
```

### 4. **Ative auto-update agora** (recomendado)

Logo após instalar, dentro do Claude Code rode:

```
/plugin
```

→ aba **Marketplaces** → selecione **conversion-agent** → toggle
**Enable auto-update**.

A cada vez que o Claude Code abrir, ele checa se houve commit novo no
repo público e atualiza o plugin sozinho. Sem isso, você precisaria
rodar `/plugin marketplace update conversion-agent` manualmente para
receber correções.

### 5. Smoke test

Abra o Claude Code numa pasta de project (após `conversion pull
<ws>/<proj>`) e digite:

```
/conversion-agent:whereami
```

Deve listar workspace + project ativo.

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

### 3. CLI da Conversion

```powershell
npm install -g @agenciaconversion/cli
conversion --version
```

> Se aparecer `'conversion' is not recognized`, feche e reabra o terminal
> pra atualizar o `PATH`. Se persistir, rode `npm bin -g` e adicione o
> diretório retornado ao `PATH` manualmente.

### 4. Login

```powershell
conversion login
```

Abre o navegador padrão. Token salvo no **Windows Credential Manager**.

```powershell
conversion whoami
```

### 5. Plugin no Claude Code

Idêntico ao Mac:

```
/plugin marketplace add agencia-conversion/conversion-agent-plugin
/plugin install conversion-agent
```

### 6. **Ative auto-update agora** (recomendado)

Dentro do Claude Code:

```
/plugin
```

→ aba **Marketplaces** → **conversion-agent** → **Enable auto-update**.

### 7. Smoke

```
/conversion-agent:whereami
```

---

## Materializando um project

Após login, baixe um project pro disco:

```bash
conversion ws                  # lista workspaces que você acessa
conversion projeto             # lista projects do workspace ativo
conversion pull <ws>/<proj>    # materializa numa pasta local
```

A pasta criada conterá `briefing/`, `deliverables/`, `brain/`. Abra-a
com o Claude Code e use as skills do plugin.

## Sync automático

Daemon que sincroniza disco ↔ backend continuamente:

```bash
conversion start    # inicia em background
conversion status   # estado atual
conversion stop     # encerra
```

## Skills disponíveis

Invocadas com `/conversion-agent:<nome>` dentro do Claude Code:

| Skill | Função |
|---|---|
| `whereami` | Mostra contexto da sessão (workspace, project, brain) |
| `briefing` | Gera briefing SEO a partir de tópico + keyword |
| `redator` | Transforma briefing em artigo aplicando 9 quality gates |
| `revisor` | QA do artigo contra checklist proprietário |
| `editor-coesao` | Refina coesão textual em PT-BR |
| `cluster` | Cria cluster (pillar + satellites) |
| `brain` / `brain-update` | Memória do project (tom, glossário, decisões) |
| `pull` / `status` | Sincronização local |
| `workspace` / `projeto` | Navegação entre workspaces e projects |
| `historico` / `buscar` | Pesquisa no project |
| `convidar` / `novo-projeto` / `novo-workspace` | Admin |

`/conversion-agent:skills` lista todas com descrições atualizadas.

## Troubleshooting

### `Failed to clone repository: git@github.com: Permission denied (publickey)`
Aparece no `/plugin install conversion-agent` quando o `git` da máquina
tenta clonar via SSH e não há chave SSH configurada com o GitHub. Force
o git a usar HTTPS para clones do GitHub (one-time, no terminal):

```bash
git config --global url."https://github.com/".insteadOf git@github.com:
```

Em seguida, no Claude Code:

```
/plugin marketplace update conversion-agent
/plugin install conversion-agent
```

### `'conversion' is not recognized` (Windows)
Feche e reabra o terminal. Se persistir, adicione `npm bin -g` ao `PATH`.

### `Permission denied` em `npm install -g` (Mac)
Use `nvm` ou `volta` em vez de Node global, ou `sudo npm install -g
@agenciaconversion/cli`.

### `not_authenticated` ao usar uma skill
Token expirou. Rode `conversion login` novamente.

### `SSE open failed: Unauthorized` no daemon
Versão antiga do CLI. Atualize:

```bash
npm install -g @agenciaconversion/cli@latest
conversion stop
conversion start
```

### Plugin não aparece após `/plugin install`
Reinicie o Claude Code. Se não resolver:

```bash
conversion logout
conversion login
```

E refaça `/plugin install conversion-agent`.

### `conversion login` abre o browser mas trava
- Firewall bloqueando `http://localhost:8765..8775`. Libere localhost.
- Logs em `~/.conversion/login.log` (Mac) ou
  `%USERPROFILE%\.conversion\login.log` (Windows).

### Múltiplas contas na mesma máquina
Setar `CONVERSION_EMAIL` no `~/.claude/settings.json` (bloco env do
plugin) pra escolher qual usar.

## Privacidade

- O plugin envia apenas: e-mail logado, slug da skill chamada e hash
  SHA-256 dos parâmetros — nunca o conteúdo bruto da request.
- A metodologia retornada vem com watermark zero-width (ADR-005). Não
  reproduza textualmente em respostas — use como referência.
- Off-boarding: admin revoga no painel; usuário pode rodar
  `conversion logout --all` pra limpar credenciais locais.

## Versões mínimas

- `@agenciaconversion/cli` ≥ 0.1.29
- `@agenciaconversion/mcp-server` ≥ 0.3.2

## Suporte

Issues técnicos: https://github.com/agencia-conversion/conversion-agent-plugin/issues
