# Conversion Agent — Plugin Público

Distribuição pública do plugin Claude Code da Agência Conversion. Este repositório é gerado automaticamente a partir do monorepo privado e contém apenas os artefatos necessários para o `/plugin marketplace add` do Claude Code consumir.

A metodologia proprietária permanece no backend (`agent.conversion.com.br`) — este plugin é apenas um cliente autenticado.

## Instalação

Pré-requisitos:

- Email corporativo `@conversion.com.br`.
- Node.js 20+.
- Claude Code CLI.

### 1. Instale o CLI da Conversion

```bash
npm i -g @agenciaconversion/cli
conversion login
```

O comando abre o navegador para um magic link, valida o email e salva o token no keychain do sistema.

### 2. Adicione o marketplace e instale o plugin no Claude Code

Dentro do Claude Code:

```
/plugin marketplace add agencia-conversion/conversion-agent-plugin
/plugin install conversion-agent
```

O Claude Code baixa o plugin e inicia o servidor MCP local que conversa com o backend usando o token do passo 1.

### 3. Ative auto-update (recomendado)

`/plugin` → aba **Marketplaces** → `agencia-conversion` → **Enable auto-update**. Toda vez que o Claude Code abrir, o plugin checa versão nova e atualiza sozinho.

## Uso

```
/conversion-skills:conversion-start
```

É o ponto de entrada. As skills disponíveis incluem `briefing`, `redator`, `revisor`, `editor-coesao`, `cluster`, `brain-update`, além de comandos de workspace/project (`workspace`, `projeto`, `pull`, `status`, `historico`, `buscar`, `abrir`).

## Suporte

- Issues: <https://github.com/agencia-conversion/conversion-agent-plugin/issues>
- Email: `diego@conversion.com.br`
