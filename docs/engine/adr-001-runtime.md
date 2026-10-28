# ADR 001: runtime de agentes do motor

Status: aceito para o MVP em 2026-10-28. Pendências P3 e P4 em [inventario.md](inventario.md).

## Contexto

O motor precisa de um runtime agêntico: um laço que chama o modelo, executa tools e para quando o trabalho termina. Esse runtime não pode ser dono da identidade, da memória nem das tarefas, porque essas ficam no SQLite do app. O documento de origem pede para avaliar o OpenCode e proíbe o OpenClaude.

## Avaliação do OpenCode

As fontes primárias foram conferidas em 2026-10-28: o repositório `anomalyco/opencode` (antigo `sst/opencode`) e as páginas `opencode.ai/docs/{server,cli,permissions,agents,mcp-servers,providers}`.

| Critério    | Achado                                                                                                                                                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Versão      | Linha 1.x no npm `opencode-ai`, **v1.19.5** (2026-10-28). Existe uma linha 2.x (v2.2.0, pacotes `@opencode/*`) com outra documentação, que não foi avaliada.                                                                                                                                                  |
| Licença     | **MIT** (Copyright (c) 2025 opencode). Pode ser redistribuído junto com o produto, mantendo o aviso. O README pede que projetos com "opencode" no nome digam que não são afiliados.                                                                                                                           |
| Integração  | `opencode serve --port N --hostname 127.0.0.1` expõe HTTP + SSE com OpenAPI 3.1 em `GET /doc`. Rotas: `POST /session`, `POST /session/:id/prompt_async`, `POST /session/:id/abort`, `GET /session/status`, `GET /session/:id/message`, `GET /event` (SSE). Não há SDK em Rust, então o adapter usa HTTP puro. |
| Ferramentas | Configuração em `opencode.json`, que pode ir inline por `OPENCODE_CONFIG_CONTENT`. `permission` aceita `allow`, `ask` ou `deny` por tool (read, edit, bash, webfetch, …). MCP remoto: `mcp.<nome> = {type:"remote", url, headers}`.                                                                           |
| Modelos     | `provider/model` (Anthropic, OpenRouter e outros). A chave vai por `{env:VAR}` na configuração.                                                                                                                                                                                                               |
| Consumo     | Mensagens do assistente trazem `cost` e `tokens {input, output, reasoning, cache:{read, write}}`.                                                                                                                                                                                                             |
| Segurança   | Sobe sem autenticação, a não ser que `OPENCODE_SERVER_PASSWORD` esteja definido (basic auth). Escuta em 127.0.0.1 por padrão. Uma permissão `ask` trava a sessão até alguém responder.                                                                                                                        |
| Windows     | Binário nativo (`opencode-windows-x64`). O bash interno usa o Git Bash, mas aqui fica desligado.                                                                                                                                                                                                              |

## Decisão

1. **A porta `AgentRuntime`** (`application/ports/engine.rs`) é a única coisa que o motor conhece: `start_run`, `resume_run`, `cancel_run`, `stream_events` e `run_status`. Os eventos são normalizados para `started`, `message_delta`, `tool_requested`, `approval_required`, `tool_completed`, `delegation_requested`, `usage_reported`, `completed`, `failed` e `cancelled`.
2. **As tools nunca são do runtime.** Toda tool, inclusive `delegar` e `financeiro.consultar_pagamento`, é servida pelo app num endpoint MCP do motor (`/engine/mcp/{run_token}`). O token vale para um agente, uma atividade e uma execução. A autorização, a aprovação, a idempotência e a auditoria acontecem no app, negando por padrão. No OpenCode, todas as tools internas ficam `deny`, e só o servidor MCP do motor fica ligado.
3. **Adapter `OpenCodeRuntime`**, testado ao vivo com a 1.18.25 instalada aqui (a última é a 1.19.5):
   - um processo `opencode serve` **por execução**, em `127.0.0.1` numa porta livre, com senha aleatória (o token MCP é por execução, então um servidor compartilhado não serviria);
   - pasta própria por execução, apagada no fim, com `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME` e `XDG_CACHE_HOME` próprios. No teste ao vivo, sem isso, o OpenCode carregou a configuração global do usuário, inclusive um agente com `edit` e `bash` liberados;
   - `OPENCODE_DISABLE_AUTOUPDATE`, `OPENCODE_DISABLE_MODELS_FETCH` e a descoberta de `.claude` desligados;
   - configuração inline sem nenhuma permissão `ask`, para nada travar: as 17 tools internas ficam `deny`, também pelo mapa `tools`;
   - os nomes das tools vão ao MCP com `__` no lugar de `.`, porque as APIs de modelo recusam ponto em nome de função.
4. **Adapter `ScriptedRuntime`** para testes: executa um roteiro determinístico, chamando as mesmas tools do motor pelo mesmo serviço. É ele que permite provar o fluxo, o reinício e as falhas sem chave de modelo.
5. **OpenClaude não entra no motor.** A remoção do runtime existente (`ClaudeCli::openclaude`, desde o #37) é decisão do usuário (P2).

## Plano de substituição

Trocar de runtime é escrever outro adapter da porta, como Claude Agent SDK, Codex ou OpenCode 2.x. Nada no domínio, nas tabelas ou na UI depende do formato interno do OpenCode. As sessões do OpenCode são descartáveis: a fonte de verdade é a `engine_runs`, e uma execução perdida é refeita a partir da atividade.

## Consequências

- O isolamento de tools não depende do runtime se comportar bem: o runtime só alcança o que o endpoint MCP do motor autoriza.
- O OpenCode precisa estar instalado (`npm i -g opencode-ai@1.19.5`) e o agente precisa de uma chave de modelo. Sem isso, a execução falha com uma mensagem clara e a atividade fica `failed`, sem retry infinito.
