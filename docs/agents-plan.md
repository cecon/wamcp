# Plano: agentes humanos e de IA

Status: fase 1 (cadastro unificado) implementada em 2026-10-26; demais fases pendentes. Parte do branch `feat/llm-bots` (commit `417e231`), que já tem a porta `Llm`, provedores plugáveis e o robô de LLM que responde conversas pendentes.

## Objetivo

Hoje o helpdesk tem dois mundos separados:

- **agentes humanos**, que são `users` com papel `administrator` ou `agent`;
- **robôs**, que são `agent_bots`, de webhook ou de LLM.

A proposta é um **cadastro único de agentes**, cada um com:

- **tipo**: humano ou IA;
- **função**: coordenador, operador, suporte dev ou QA;
- **skills e credenciais**, só nos agentes de IA;
- **memória própria**, gravada no SQLite;
- **canal de contato**, só nos agentes humanos: o WhatsApp da pessoa, para ser consultada pelos agentes de IA (_human in the loop_, HITL).

Os papéis seguem duas regras rígidas, garantidas pelo código e não só pelo prompt:

1. **O coordenador nunca executa.** Ele só delega para um operador, ou pergunta a um humano.
2. **Quem executa é o operador.** Suporte dev e QA são operadores especializados. A execução é um fluxo agêntico (com ferramentas e várias etapas), conduzido por um _runtime_ de agente.

## Visão geral

```
WhatsApp do cliente ──► conversa (pending) ──► COORDENADOR (IA)
                                                  │  só pode: delegate / ask_human / handoff
                                                  ▼
                                              TAREFA ──► OPERADOR (IA, com skills)
                                                  │        runtime agêntico + ferramentas MCP
                                                  │        ├─ reply_conversation, catálogo, …
                                                  │        ├─ http_request (usa credencial no servidor)
                                                  │        ├─ remember / recall (memória SQLite)
                                                  │        └─ ask_human ──► WhatsApp do humano (HITL)
                                                  ▼
                                   resultado ──► (QA opcional) ──► resposta ao cliente / handoff
```

## Modelo de dados (migrações v23+)

| Tabela              | Conteúdo                                                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agents`            | `id`, `kind` (`human`/`ai`), `role` (`coordinator`/`operator`/`dev_support`/`qa`), `name`, `active`; para humanos: `user_id` (login opcional) e `whatsapp_jid` (HITL); para IA: `runtime`, `provider`, `model`, `instructions` |
| `skills`            | `id`, `name`, `description`, `instructions` (markdown, no estilo de um `SKILL.md`), `tools` (JSON com as ferramentas MCP liberadas), `credential_names`                                                                        |
| `agent_skills`      | ligação N:N entre agentes e skills                                                                                                                                                                                             |
| `agent_credentials` | `agent_id`, `name`, `kind` (api key, basic, bearer…), `secret` **cifrado em repouso**, `created`, `last_used`                                                                                                                  |
| `agent_tasks`       | `id`, `conversation_id`, `coordinator_id`, `operator_id`, `parent_id`, `goal`, `status` (`queued`/`running`/`waiting_human`/`done`/`failed`), `result`, `runtime_session_id`                                                   |
| `agent_task_events` | log da tarefa: delegação, chamadas de ferramenta, perguntas e respostas HITL, erros                                                                                                                                            |
| `hitl_requests`     | `task_id`, `asked_by`, `human_agent_id`, `question`, `answer`, `status`, `wa_message_id`, `asked_at`, `answered_at`, `expires_at`                                                                                              |
| `agent_memories`    | `agent_id`, `scope` (`global`/`contact`/`conversation`), `scope_id`, `content`, `created`, `updated`; busca por FTS5 (`agent_memories_fts`)                                                                                    |

Como fica o que já existe:

- **Humanos:** `users` continua sendo o login. Um agente humano pode apontar para um `user`, mas não precisa: um especialista que só é consultado pelo WhatsApp não tem login.
- **Robôs de LLM:** o robô de hoje passa a ser só um coordenador conectado à caixa de entrada. A migração converte os robôs `llm` existentes.
- **Credenciais:** o projeto ainda não tem cifragem em repouso; hoje `crypto.rs` só faz hash e segredos aleatórios. A proposta é AES-GCM com uma chave guardada fora do banco, via DPAPI do Windows ou um arquivo `agents.key` no diretório de dados com ACL do usuário. **A credencial nunca vai para o modelo.** As ferramentas que a usam (por exemplo `http_request`) recebem só o _nome_ da credencial e a aplicam no servidor.

## Runtimes agênticos

A porta `Llm` atual serve para uma chamada única ("prompt → JSON"). Para o fluxo agêntico entra uma segunda porta:

```rust
trait AgentRuntime {
    /// Executa (ou retoma) uma sessão agêntica com ferramentas MCP e devolve o resultado.
    async fn run(&self, session: &AgentSession) -> Result<RunOutcome>;
}
struct AgentSession { system, prompt, mcp_url, mcp_token, allowed_tools, model, resume }
struct RunOutcome { session_id, result, is_error }
```

As ferramentas chegam ao runtime pelo **próprio endpoint MCP do app**, com um token emitido por execução e preso a uma tripla (agente, tarefa, conversa). O token é revogado no fim da execução. Esse desenho já foi validado na versão em Node, com o Claude Code real. O servidor decide quais ferramentas cada token enxerga, a partir das skills do agente e da sua função. Por exemplo, o token de um coordenador **não lista** ferramentas de execução.

| Runtime      | Como roda                                                                        | Situação               |
| ------------ | -------------------------------------------------------------------------------- | ---------------------- |
| `claude_cli` | `claude -p --mcp-config … --allowedTools … --resume`                             | flags já validadas     |
| `codex_cli`  | `codex exec` com MCP configurado                                                 | a validar              |
| `openclaude` | fork multi-provedor do Claude Code; com OpenRouter, ele conduz a sessão agêntica | **ver o risco abaixo** |

**Risco do OpenClaude:** segundo as fontes públicas, ele derivou do código-fonte do Claude Code que foi exposto em 31/03/2026. O código original é propriedade da Anthropic. **Empacotá-lo dentro do instalador do app traz risco de licença e de distribuição.** Recomendações:

- não empacotar no instalador; tratar como runtime **opcional, instalado pelo usuário** (como o Claude Code hoje), detectado no PATH;
- **Decisão (2026-10-26):** o OpenRouter só serve como LLM. Trabalho agêntico com modelos do OpenRouter roda no OpenClaude (runtime `openclaude`, com o modelo do OpenRouter no campo modelo e a chave como credencial do agente). Robôs de LLM simples podem ganhar um provedor `openrouter` direto na porta `Llm`.

## Fluxos

### 1. Coordenação: o coordenador só delega

1. Chega uma mensagem do cliente numa conversa `pending` de uma caixa ligada a um coordenador.
2. O coordenador roda com acesso só a `delegate(operator, goal)`, `ask_human(…)` e `handoff()`. Ele recebe a conversa, as memórias relevantes e a lista de operadores com as suas skills.
3. `delegate` cria uma `agent_task` e enfileira o operador. O servidor **recusa** qualquer outra ferramenta vinda do coordenador; essa é a regra 1.

### 2. Execução: o operador

1. O runtime do operador roda com as ferramentas das suas skills, `remember` e `recall`, `ask_human` e `reply_conversation` (presa à conversa da tarefa).
2. O resultado vai para `agent_tasks.result`, e a conversa recebe a resposta.
3. Opcionalmente, um agente QA revisa antes de enviar: o coordenador delega "revisar" ao QA, e o QA aprova ou devolve para o operador.

### 3. HITL: humano pelo WhatsApp

1. `ask_human(agent | role, question)` cria um `hitl_request` e envia a pergunta ao WhatsApp da pessoa. O envio sai por uma **sessão interna** configurada (um número do app reservado para a equipe), não pela caixa do cliente.
2. A tarefa fica `waiting_human` e o runtime encerra a execução atual, sem ficar bloqueado esperando.
3. A pessoa responde citando a mensagem, ou com o código curto da pergunta. A ingestão desvia essa resposta para o `hitl_request` e ela **não vira conversa do helpdesk**.
4. Com a resposta, a tarefa é retomada (`--resume` ou o histórico do laço próprio) com o texto da pessoa. Se a pergunta expirar, o coordenador recebe o timeout e decide se faz handoff.

### 4. Memória

- `remember(content, scope)` grava e `recall(query, scope)` busca por FTS5. A memória sempre fica restrita ao próprio agente.
- No fim de cada tarefa, o operador grava um resumo curto na memória da conversa.
- A interface mostra e permite apagar as memórias de cada agente, por causa da LGPD: são dados de clientes.

## Fases sugeridas

1. **Cadastro unificado:** `agents`, `skills`, `agent_skills`, credenciais cifradas, API e telas "Agentes" (com abas Humanos e IA) e "Skills". Ainda sem execução.
2. **Runtime agêntico + MCP por execução:** a porta `AgentRuntime`, o runtime `claude_cli`, o token por tarefa, o filtro de ferramentas por skill e função, e a memória (`remember`/`recall`).
3. **Coordenação:** `agent_tasks`, a regra "coordenador só delega" no servidor, o painel de tarefas na conversa e a migração dos robôs `llm`.
4. **HITL pelo WhatsApp:** sessão interna, `hitl_requests`, roteamento das respostas, retomada e expiração.
5. **Mais runtimes:** `codex_cli` e `openclaude` (com OpenRouter), detectados no PATH; provedor `openrouter` para os robôs de LLM.
6. **QA e observabilidade:** etapa de revisão, custo e tempo por tarefa, e relatórios.

Cada fase entra com testes no padrão atual: fakes das portas (`AgentRuntime`, WhatsApp), testes de integração em `src-tauri/server/tests` e testes de UI.

## Decisões tomadas (2026-10-26)

- **Uma lista só, "Agentes"**: pessoas e agentes de IA juntos. Todo login é uma pessoa da lista; a pessoa pode ter WhatsApp (para ser consultada) e, opcionalmente, acesso ao helpdesk.
- **Pessoas e IA têm as mesmas funções** (coordenador, operador, suporte dev, QA), vindas do perfil. Quem executa pode ter skills; credenciais são só de agentes de IA, porque são usadas pelas ferramentas no servidor.
- **Perfil obrigatório para todo agente** (login, WhatsApp ou IA). O perfil define as permissões e a função de IA (coordenador, operador, suporte dev, QA); o agente herda a função do perfil. O perfil "Padrão" reproduz o acesso de quem não tinha perfil e não pode ser excluído.
- **Robôs saem da interface**: os agentes de IA, com a função vinda do perfil, assumem esse papel. A API de robôs por webhook continua no backend por compatibilidade.

## Adiantado da fase 5 (2026-10-27): agente de IA atendendo pela runtime

- Cada caixa de entrada pode ter um **Agente de IA** (`inboxes.ai_agent_id`, migração v27). Ele responde as conversas pendentes pela runtime e pelo modelo do cadastro, com as suas instruções e as instruções das suas skills. Só atende um agente de IA ativo cuja função executa: coordenadores não atendem.
- Por enquanto é a mesma chamada "LLM" dos robôs: sem ferramentas e com resposta estruturada `{reply, handoff}`. O laço agêntico com MCP continua na fase 2.
- **Runtimes:**
  - `claude_cli` usa o login do Claude Code.
  - `codex_cli` roda `codex exec` em sandbox somente leitura, com o login do Codex. Ainda não foi testado com o binário real.
  - `openclaude` roda o OpenClaude apontado para o OpenRouter, com o modelo do cadastro e a credencial `OPENROUTER_API_KEY` do agente (ou a única chave de API dele).
- `GET /agent_runtimes` diz quais runtimes estão instalados. A detecção procura `WAMCP_*_BIN`, depois o executável no PATH e no `~/.local/bin`, e por fim a instalação global do npm, rodada com o Node. O cadastro desabilita as runtimes ausentes.

## Decisões em aberto

1. **Agente humano sem login:** basta o WhatsApp para ser consultado, ou todo humano precisa ser um `user`?
2. **Sessão interna do HITL:** dá para reservar um número só para falar com a equipe, ou usamos a mesma sessão dos clientes, com a desambiguação pelo número do humano?
3. **Quem responde ao cliente:** sempre o operador, ou o coordenador pode responder perguntas triviais? A regra 1, tomada ao pé da letra, impede o coordenador de responder.
4. ~~**OpenRouter:**~~ decidido: só como LLM; o agêntico com OpenRouter usa o OpenClaude.
5. **Chave das credenciais:** DPAPI do Windows (presa ao usuário do Windows) ou arquivo de chave (mais portátil para backup)?
6. **Skills:** cadastradas na interface, importadas de arquivos `SKILL.md` no formato do Claude Code, ou as duas formas?
7. **Limites:** quantos agentes de IA rodando ao mesmo tempo nesta máquina, e qual orçamento de tempo e custo por tarefa?

## Referências

- OpenClaude: [dsebastien.net](https://www.dsebastien.net/openclaude/), [Claude Market](https://claudemarket.ai/blog/what-is-openclaude/), [EveryDev](https://www.everydev.ai/tools/openclaude)
- Robô de LLM e provedores: `src-tauri/server/src/domain/llm.rs`, `application/llm_bots.rs`, `adapters/outbound/llm/`
