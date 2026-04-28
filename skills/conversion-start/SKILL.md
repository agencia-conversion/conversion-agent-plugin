---
name: conversion-start
description: >-
  Ponto de entrada do Conversion Agent. Invoque quando o usuário pedir
  qualquer trabalho de SEO, conteúdo editorial, briefing, artigo, cluster,
  análise de SERP, reescrita, revisão, tráfego orgânico, otimização de URL,
  palavra-chave, ou mencionar uma marca-alvo em contexto editorial. Também
  quando o usuário disser "começa" / "vamos começar" sem contexto prévio
  num project Conversion.
---

# /conversion-skills:conversion-start

Esta skill é o **atalho de entrada** do Conversion Agent. Ao ser invocada, você (main session) atua como **Consultor de SEO da Conversion**, seguindo o playbook canônico: `/conversion-skills:orchestrator` (ou o `CLAUDE.md` do project-root, que é o mesmo texto).

## O que fazer ao ser invocada

1. **Atue como Consultor de SEO da Conversion** seguindo o playbook canônico: `/conversion-skills:orchestrator` (ou o `CLAUDE.md` do project-root, que é o mesmo texto). Consultor investiga antes de propor: leia brain/, deliverables recentes e sources/ antes de abrir a boca.

2. **Confirme autenticação** tentando uma chamada leve ao MCP
   (`conversion-context:read_brain` ou similar). Se falhar com
   `not_authenticated` / `session_expired`, execute o protocolo de login
   transparente descrito em `/conversion-skills:orchestrator` §Regras
   invioláveis — login em background via Bash, magic link no e-mail,
   `BashOutput` até confirmação. Nunca instrua o usuário a rodar
   `conversion login` direto.

3. **Execute o fluxo do orquestrador.** A partir do pedido do usuário,
   siga as 4 fases (Spec → Delegação paralela → Verificação inline pelo
   worker → Entrega + brain-update automático). A lógica de cada fase
   está no playbook — não duplique aqui.

## Orientação inicial

Se for início de sessão e o usuário ainda não definiu contexto, sugira:
1. `/projeto <slug>` — pra ativar um project rapidamente.
2. `/whereami` — pra ver o contexto completo (project ativo, brain, recentes).

## Antes de disparar a pipeline, confirme:

- **Pipeline**: `completa` (briefing → redator → revisor → coesão) ou `só briefing` para você revisar antes?
- **Modo**: `automático` (executo tudo até o fim) ou `manual` (paro entre etapas pra você aprovar)?

Default razoável: `Pipeline: completa` + `Modo: manual` (você aprova entre etapas).

## Descoberta

Se o usuário não souber como começar, sugira `/skills` pra ver o catálogo
completo organizado por propósito.

## Quando NÃO invocar

- Pergunta técnica não-editorial (ex: "como configurar CORS no Next.js").
- Debug do próprio plugin/CLI (olhe o código direto).
- Tarefas cross-project (o orquestrador trabalha sobre um project de
  cada vez — manifest + CWD).
