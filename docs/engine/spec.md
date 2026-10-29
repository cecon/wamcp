# SPEC: motor agêntico (MVP)

Escopo: [inventario.md](inventario.md). Runtime: [ADR 001](adr-001-runtime.md).

## Domínio

Toda tabela `engine_*` tem `account_id`, a organização, e toda consulta do motor filtra por ele. Um agente de outra organização não aparece no diretório, não recebe delegação e não enxerga atividade, memória nem evidência.

| Conceito               | Tabela                         | Regras                                                                                                                                                                                            |
| ---------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Membro                 | `agents` (+ `account_id`, v31) | Humano ou IA, com perfil obrigatório. Só IA ativa executa no motor.                                                                                                                               |
| Política do agente     | `engine_agent_policies`        | `enabled`, `proactive_enabled` (padrão `false`), `execution_policy` (`suggest_only`, `approval_for_sensitive` ou `within_grants`), `max_concurrency`, `run_timeout_secs`, `monthly_token_budget`. |
| Grant                  | `engine_tool_grants`           | (agente, tool) → `allow` ou `approval`. Sem linha, o pedido é negado.                                                                                                                             |
| Atividade              | `engine_activities`            | Estados abaixo. `idempotency_key` é única por conta. `parent_id` liga delegações.                                                                                                                 |
| Delegação              | `engine_delegations`           | `correlation_id` herdado da raiz, `depth`, `hops`, `skill`, `reason`. É única por (pai, `request_key`).                                                                                           |
| Execução               | `engine_runs`                  | Uma por tentativa. Guarda `token` (credencial do MCP do motor), `runtime`, `external_id`, tokens, custo e `cost_source`.                                                                          |
| Chamada de tool        | `engine_tool_calls`            | É única por (atividade, `call_key`): repetir a mesma chamada devolve o resultado guardado.                                                                                                        |
| Evidência              | `engine_evidence`              | Id `ev_…`, gerado pelo motor a partir do resultado da tool, nunca pelo modelo.                                                                                                                    |
| Mensagem entre agentes | `engine_messages`              | Pedido e resposta de cada delegação.                                                                                                                                                              |
| Auditoria              | `engine_audit`                 | Toda decisão: execução, tool permitida, negada ou aprovada, delegação, falha. Nunca guarda segredos.                                                                                              |
| Memória                | `engine_memories`              | `episodic`, `semantic` ou `operational`. Escopo `private` (só o agente) ou `organization`. Tem versão (`supersedes`), validade e exclusão lógica.                                                 |

### Estados da atividade

```
queued ──► running ──► completed
             │  ▲ └──► failed      (sem retry restante, limite estourado, tool indisponível)
             │  │
             ▼  │ aprovada / negada
       waiting_approval
qualquer estado não final ──► cancelled
```

Transições inválidas são recusadas pelo domínio (`domain/engine/activity.rs`).

## Tools do motor

Todas passam por `EngineService::call_tool(token, nome, args)`. O token identifica a execução, o agente, a atividade e a conta. A ordem de checagem é: token válido e execução viva, tool conhecida, grant do agente, política de aprovação, idempotência, execução, evidência e auditoria.

| Tool                                                                     | Quem             | Efeito                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `delegar {skill, pedido, motivo}`                                        | Agente com grant | Procura no diretório da mesma conta um agente de IA ativo com essa skill (dele ou do perfil) e grant para alguma tool da skill. Cria uma atividade filha e uma delegação, executa o destino e devolve `{status, resposta, evidencias}`. Recusa se `hops ≥ MAX_HOPS` (3) ou se o destino já está na cadeia (ciclo). |
| `concluir {resposta, evidencias[]}`                                      | Toda execução    | Termina a atividade. Toda evidência citada precisa existir na árvore da atividade, senão a chamada é recusada, para o modelo não inventar fontes. Na raiz com conversa, publica a resposta no canal de origem, uma vez só.                                                                                         |
| `financeiro.consultar_pagamento {cliente}`                               | Grant explícito  | Tool simulada com dados fictícios. Devolve `{status, valor, data_pagamento}` e uma evidência.                                                                                                                                                                                                                      |
| `memoria.lembrar {conteudo, tipo, escopo}` e `memoria.consultar {termo}` | Toda execução    | Memória do agente com escopo.                                                                                                                                                                                                                                                                                      |

## Fluxo Lu → Anny → Lu

1. `POST /api/v1/engine/activities {agent_id, request, conversation_id?, idempotency_key?}`. Pelo WhatsApp, o gatilho é o `message.created` da caixa servida por Lu com o motor ligado.
2. O motor cria a atividade raiz `queued` e uma execução de Lu, depois chama `runtime.start_run` e consome `stream_events`.
3. Lu chama `delegar {skill:"consultar_pagamento", pedido:"O cliente ACME pagou?"}`.
4. O diretório encontra Anny, que tem a skill e o grant `financeiro.consultar_pagamento`. O motor cria a atividade filha e a delegação (`hops = 1`) e roda Anny.
5. Anny chama `financeiro.consultar_pagamento {cliente:"ACME"}`. O motor grava a chamada, a evidência `ev_…` e a auditoria.
6. Anny chama `concluir`, citando `ev_…`. A filha fica `completed` e a resposta volta como resultado de `delegar`.
7. Lu chama `concluir`, citando a mesma evidência. A raiz fica `completed`, e a resposta vai para a conversa de origem ou fica na atividade, no canal interno.

## Falhas

| Cenário                           | Comportamento                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cliente não encontrado            | A tool devolve `status: "nao_encontrado"`, com evidência. O agente responde isso, sem inventar.                                                                                                                                                                                                                                                                                                                                   |
| Tool indisponível                 | A chamada fica `failed` e a auditoria registra. O agente recebe o erro e pode concluir dizendo que não conseguiu.                                                                                                                                                                                                                                                                                                                 |
| Permissão negada                  | `denied`, com auditoria. O agente recebe "sem permissão para X".                                                                                                                                                                                                                                                                                                                                                                  |
| Aprovação                         | A chamada fica `pending_approval` e a atividade `waiting_approval`. Ao aprovar ou negar por `POST /engine/tool_calls/:id/decision`, o motor executa a tool (ou registra a recusa) e põe a atividade de volta na fila. Uma execução nova encontra a decisão porque a chamada é idempotente. Execuções são descartáveis, então o motor não depende de `resume_run`: ele existe na porta para runtimes que mantêm a sessão viva.     |
| Timeout                           | A execução que passa de `run_timeout_secs` é cancelada (`cancel_run`) e conta como tentativa falha.                                                                                                                                                                                                                                                                                                                               |
| Resposta ambígua                  | Uma execução que termina sem `concluir` conta como tentativa falha.                                                                                                                                                                                                                                                                                                                                                               |
| Evento repetido                   | A mesma `idempotency_key` devolve a atividade existente.                                                                                                                                                                                                                                                                                                                                                                          |
| Delegação circular ou hops demais | `delegar` recusa, com auditoria.                                                                                                                                                                                                                                                                                                                                                                                                  |
| Falha do provedor                 | Retry até `MAX_ATTEMPTS` (3). Depois a atividade fica `failed` com a mensagem, e o solicitante recebe um aviso fixo, nunca um resultado inventado.                                                                                                                                                                                                                                                                                |
| Orçamento estourado               | A execução não começa: a atividade fica `failed` com "orçamento mensal do agente esgotado".                                                                                                                                                                                                                                                                                                                                       |
| Reinício                          | Na subida, execuções `running` viram `interrupted`. As atividades raiz `queued` ou `running` são retomadas com uma nova tentativa. A filha é retomada quando o pai repete `delegar`, que é idempotente. Chamadas de tool repetidas devolvem o resultado guardado. Se a resposta ao canal ficou `sending`, ela não é reenviada: a atividade fica `failed` com "verificar se a resposta saiu", sem perda silenciosa nem duplicação. |

## Consumo

O evento `usage_reported` grava tokens de entrada, saída e cache, e o custo com `cost_source` (`reported` quando o runtime informa, `estimated` quando não), na `engine_runs` e, na mesma transação, na `llm_usage` do painel de funcionários (`run_ref` = `engine_run:<id>`), que calcula o salário digital. A soma do mês na `engine_runs` alimenta o orçamento.
