# Motor agêntico: inventário, lacunas e plano

Status: fase 0 concluída em 2026-10-28, base `chore/remove-catalog` (`b04b22f`). Documento de execução de origem: "Implementação do motor agêntico — Plataforma de Empresa Híbrida".

## 1. O que já existe

| Área                 | Onde                                                                               | Situação                                                                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Organização (tenant) | tabela `accounts` (id 1 semeado), `account_id DEFAULT 1` nas tabelas do helpdesk   | Uma conta só. Nenhuma consulta filtra por conta (`conversations.rs` usa `account_id=1` fixo). As tabelas `agents`, `skills` e `custom_roles` não têm `account_id`. |
| Autenticação         | `adapters/inbound/http/auth.rs` (`CurrentUser`, `Requester`), `require_admin_user` | Por token de API ou cookie de sessão com CSRF.                                                                                                                     |
| RBAC                 | `domain/roles.rs`, `custom_roles` (perfis)                                         | Perfis com permissões e com a função de IA (`agent_role`).                                                                                                         |
| Membros humanos e IA | `agents` (v23), `domain/agents.rs`, `application/agents.rs`                        | Uma lista só: `kind` é `human` ou `ai`. A função vem do perfil (coordinator, operator, dev_support, qa). Agentes de IA têm `runtime`, `model` e `instructions`.    |
| Skills               | `skills`, `agent_skills`, `custom_role_skills` (v28)                               | Instruções e uma lista `tools`, que hoje só vira texto no prompt.                                                                                                  |
| Credenciais          | `agent_credentials`, `SecretBox` (AES-GCM)                                         | Cifradas em repouso, nunca listadas.                                                                                                                               |
| Runtime de IA        | porta `Llm` (`application/ports/external.rs`), `adapters/outbound/llm/*`           | Claude Code, Codex e OpenClaude por CLI, em uma chamada só (`complete` → JSON). As CLIs rodam sem tools e sem MCP (`--tools ""`).                                  |
| Atendimento por IA   | `application/llm_bots.rs`                                                          | `message.created` → debounce → `complete` → `{reply, handoff}`. Roda em memória: nada persiste e nada se recupera depois de reiniciar.                             |
| MCP de entrada       | `adapters/inbound/mcp/*`                                                           | Ferramentas do WhatsApp e do helpdesk, com token por sessão de WhatsApp, não por agente.                                                                           |
| Eventos              | `application/event_bus.rs`                                                         | Barramento síncrono em memória, que não é durável.                                                                                                                 |
| Filas duráveis       | `webhook_deliveries`, `event_queue`                                                | Retry e backoff só para webhooks. Não há outbox nem chave de idempotência genérica.                                                                                |
| Auditoria            | `audit_logs` (v15), middleware `audit::record`                                     | Registra mutações administrativas por HTTP. Agentes e skills não são auditados.                                                                                    |
| Uso e custo          | `llm_usage` (v30, branch `feat/members-panel`, ainda sem merge)                    | Tokens e custo por chamada de LLM e salário do mês. Fica com o painel de funcionários.                                                                             |

## 2. Lacunas para o MVP

1. Atividade durável com estados, prazo, prioridade, evidências e chave de idempotência.
2. Delegação estruturada com `correlation_id`, profundidade, contador de hops e bloqueio de ciclos.
3. Porta de runtime agêntico (iniciar, retomar, cancelar, eventos, status), separada da porta `Llm` de chamada única.
4. Tools servidas ao runtime pelo próprio app, com autorização negada por padrão, aprovação humana e auditoria.
5. Isolamento por organização nas tabelas novas, com teste automatizado.
6. Memória do agente com escopo, versão, correção e exclusão.
7. Recuperação depois de reiniciar, sem perda silenciosa nem efeito duplicado.
8. Limites de hops, duração, concorrência, retries e orçamento.

## 3. Matriz de compatibilidade

| Pedido do documento                                                                     | Repositório                                                 | Decisão                                                                                                                                   |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL como fonte de verdade                                                        | SQLite local (`rusqlite`), app desktop                      | **Manter SQLite.** O schema novo usa SQL portável (FK, índices, `UNIQUE`). Migrar para PostgreSQL é pendência P1.                         |
| Fila ou worker durável                                                                  | Laços `tokio` em `compose.rs::start_jobs` e filas em tabela | Usar tabela + laço de recuperação na subida, seguindo o padrão de `webhook_deliveries`.                                                   |
| `Organization`                                                                          | `accounts`                                                  | `organization_id` = `accounts.id`. As tabelas do motor filtram por conta. As tabelas antigas continuam com uma conta (lacuna registrada). |
| `Member` humano ou IA                                                                   | `agents`                                                    | Reaproveitada, sem tabela nova.                                                                                                           |
| `AgentProfile`                                                                          | `agents` + `custom_roles`                                   | Modelo, prompt e skills já existem. Grants, orçamento, `proactive_enabled` e política de execução ficam em `engine_agent_policies`.       |
| `Skill`                                                                                 | `skills`                                                    | Reaproveitada. Skill não autoriza nada: a autorização vem de `ToolGrant`.                                                                 |
| `ToolGrant`                                                                             | não existe                                                  | Tabela `engine_tool_grants`, negando por padrão.                                                                                          |
| `Conversation` / `Message`                                                              | helpdesk                                                    | Reaproveitadas. A resposta final sai pelo `helpdesk.reply`. As mensagens entre agentes ficam em `engine_messages`, ligadas à atividade.   |
| `Activity`, `Delegation`, `ExecutionRun`, `ToolInvocation`, `AuditEvent`, `AgentMemory` | não existem                                                 | Tabelas `engine_*` novas.                                                                                                                 |
| `UsageRecord` e dashboard                                                               | `llm_usage` + painel (em `feat/members-panel`)              | O motor grava o uso de cada execução em `engine_runs` e em `llm_usage` (`run_ref` = `engine_run:<id>`). Não cria outro dashboard.  |
| Runtime OpenCode                                                                        | não existe                                                  | Adapter HTTP + SSE para `opencode serve` 1.x. Ver [ADR 001](adr-001-runtime.md).                                                          |
| OpenClaude fora                                                                         | está no código desde o #37                                  | **Pendência P2 para o usuário.** Não removi.                                                                                              |

## 4. Plano por fases

- **Fase 0:** este inventário, o [ADR 001](adr-001-runtime.md) e a [SPEC](spec.md).
- **Fase 1, domínio:** `domain/engine` (estados, transições, hops e ciclos, autorização de tools, orçamento) e migração v32 com as tabelas `engine_*` (v30 é do painel, v31 do agente de sistema).
- **Fase 2, runtime:** porta `AgentRuntime`, adapter OpenCode, adapter roteirizado para testes, endpoint MCP do motor e tool mock `financeiro.consultar_pagamento`.
- **Fase 3, fluxo:** `EngineService` (Lu → Anny → Lu), evidência, resposta no canal de origem, recuperação na subida e cenários de falha.
- **Fase 4, UI e governança:** tela de atividades e delegações, aprovações e limites. Os campos do cadastro do agente e o painel de custo ficam com a sessão do painel de funcionários.
- **Fase 5, validação:** testes de integração (fluxo, reinício, isolamento, permissões), lint, CI e guia de operação.

## 5. Pendências de alto impacto

- **P1:** PostgreSQL ou SQLite. Só faz sentido mudar se houver versão em nuvem com várias empresas.
- **P2:** remover o runtime OpenClaude, que tem risco de licença.
- **P3:** OpenCode 1.x ou 2.x. A 2.x tem outros pacotes e outra documentação. Fixei a 1.19.5.
- **P4:** teste com runtime real. Precisa do OpenCode instalado e de uma chave de modelo fornecida pelo usuário. Sem isso, os testes automatizados usam o adapter roteirizado.
- **P5:** isolamento das tabelas antigas por conta, que ainda não filtram por `account_id`.
