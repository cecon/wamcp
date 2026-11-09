# Arquitetura

## Direção das dependências

Interface React → IPC Tauri → adaptadores HTTP/MCP → aplicação → domínio.

A aplicação recebe objetos que implementam portas. `server/index.mjs` é a raiz de composição: instancia SQLite e WhatsApp e os injeta nos casos de uso. O domínio não importa Express, SQLite, Baileys ou SDK MCP. Os adaptadores de entrada não importam adaptadores de saída.

## Componentes

| Diretório                               | Responsabilidade                                                  |
| --------------------------------------- | ----------------------------------------------------------------- |
| `server/domain`                         | Políticas de acesso independentes de infraestrutura               |
| `server/application`                    | Operações de sessão, consulta e envio, com dependências injetadas |
| `server/adapters/inbound`               | Validação de entrada, autenticação HTTP e transporte MCP          |
| `server/adapters/outbound/sqlite`       | Persistência e consultas parametrizadas                           |
| `server/adapters/outbound/whatsapp.mjs` | Pareamento, reconexão e eventos Baileys                           |
| `src`                                   | Interface React, sem acesso direto a credenciais do WhatsApp      |
| `src-tauri/src`                         | Ciclo de vida Windows, bandeja, IPC e processos filhos            |

## Portas

A porta de repositório é um objeto com operações `session`, `sessions`, `createSession`, `status`, `chat`, `message`, `chats`, `messages`, `search`, `issueToken`, `tokens`, `authenticate`, `revoke`, `audit`, `events` e `close`.

A porta de WhatsApp oferece `connect`, `stop`, `detail`, `send`, `media`, `restore` e `close`. Os testes substituem essa porta por uma implementação em memória para nunca enviar mensagens reais.

A porta de repositório também oferece `media`, limitada por sessão, conversa e mensagem. A tabela aditiva `message_media` preserva o payload protobuf necessário ao download e metadados separados. As consultas de histórico expõem somente metadados, nunca chaves ou URLs de mídia. `get_media` exige leitura, baixa sob demanda com limite de bytes e tempo, verifica novamente a credencial antes da resposta e entrega áudio MCP ou recurso binário incorporado. Não cria links públicos nem arquivos locais.

Interfaces pequenas e injeção explícita evitam contêiner de dependências ou hierarquias desnecessárias. Regras de autorização ficam no domínio; use cases fazem orquestração; transporte e SQL ficam nos adaptadores.

## Canais

Cada caixa de entrada tem um canal (`channel_type`: hoje `whatsapp` e `github`). Os casos de uso nunca comparam o tipo: pedem o canal da caixa (`application/channels`) e as suas capacidades (`domain/channel.rs`: mídia, reações, apagar para todos, presença, bloqueio e iniciar conversa).

- **Entrada.** O canal transforma o seu evento numa mensagem do contato e chama `HelpdeskService::receive` (`application/inbound.rs`). Ali fica a regra única de roteamento: conversa nova, reaproveitada ou reaberta, depois a atualização da conversa e a atribuição automática. O canal só acha o contato, a rota e grava a própria mensagem.
- **Saída.** `Channel::send` entrega a resposta (WhatsApp com a assinatura do agente; GitHub como comentário). Reações, apagar, digitação, confirmação de leitura e bloqueio são métodos opcionais: o padrão é "não há neste canal".

Para adicionar um canal: as capacidades em `domain/channel.rs`, uma implementação de `Channel` em `application/channels/`, a entrada do evento chamando `receive`, e a tabela `channel_<tipo>` com a caixa.

## Plugins

O que um agente sabe fazer vem dos plugins. Um plugin é um manifesto (`plugin.json`, validado em `domain/plugins.rs`) com skills (instruções), ferramentas e as credenciais que elas usam. O administrador instala, liga ou desliga e preenche as credenciais em Configurações → Plugins (`/api/v1/plugins`).

- **Ferramentas.** Cada uma se chama `<plugin>.<ferramenta>` e é servida fora do processo: `http` (um `POST` com os argumentos em JSON) ou `mcp` (`initialize` e `tools/call` por Streamable HTTP). Só se aceita HTTPS, ou HTTP para o próprio computador. O transporte (`adapters/outbound/plugin_transport.rs`) não segue redirecionamentos, tem prazo de 30 s e lê no máximo 1 MiB. Os plugins que vêm com o app (hoje `financeiro`, de demonstração) usam `builtin`.
- **Credenciais.** Ficam seladas pela `SecretBox`. O servidor aplica a credencial como `Authorization: Bearer` na chamada; o modelo nunca a vê, e a API só diz quais já têm valor.
- **Skills.** Entram na biblioteca como `<nome do plugin>: <skill>`, com as ferramentas do plugin, e acompanham instalação, atualização e remoção.
- **Dados do cliente.** Uma ferramenta `contact_scoped` recebe em `contato` o contato da conversa quando um cliente começou a vez (`EngineService::scope_to_contact`), e o que o modelo mandou no lugar é ignorado.
- **Rotinas.** O manifesto pode sugerir rotinas (`schedules`, com cron validado). O administrador as cria em Agendamentos escolhendo os agentes. A rotina de um agente do motor vira um pedido do motor (`schedule:<id>`), com as ferramentas internas.
- **Mensagens.** O plugin do próprio app `mensagens` (`application/plugins/messaging.rs`) oferece `enviar_whatsapp`: `internal_only`, `sensitive` e com efeito externo, então na política padrão cada envio espera aprovação.
- **Motor.** `PluginService` é o `BusinessTools` do motor. O catálogo (`application/engine/catalog.rs`) junta as ferramentas internas e as dos plugins ligados; cada agente ainda precisa da permissão da ferramenta. Uma ferramenta `internal_only` nunca é oferecida nem executada numa execução que responde a uma mensagem de cliente, para limitar injeção de prompt.

## Agentes ao vivo

Uma conversa espera o seu agente de IA enquanto está `pending` e a última mensagem pública é do contato. A fila de respostas (`application/llm_bots/live.rs`) é esse estado da própria conversa, então sobrevive a um reinício: ao subir, `recover` agenda todas as conversas que ainda esperam. Os pedidos do motor já ficam no banco e são retomados por `EngineService::recover`.

- **Pausar.** Fica em `agent_pauses`. Um agente pausado não responde conversas e não começa pedidos do motor (os pedidos esperam na fila); delegar para ele é recusado. Retomar responde o que chegou e roda o que esperava.
- **Encerrar.** Interrompe a resposta em andamento (o futuro é descartado e o processo do runtime morre junto), não envia nada e passa a conversa para uma pessoa (`handoff_to_human`). Um pedido do motor é cancelado com tudo o que ele delegou, e as execuções em andamento são canceladas no runtime.
- **Resumo.** Numa conversa com mais mensagens do que a janela do prompt (40), o começo chega ao agente como resumo, feito pelo próprio modelo do agente e guardado em `conversation_summaries`. Ele é refeito só quando a janela passa do que ele cobre, cobrindo tudo menos as 20 mensagens mais novas. Uma falha no resumo não impede a resposta.

- **Ponte para o motor.** Quando o agente da caixa roda num runtime do motor (hoje o OpenCode), a vez do cliente vira um pedido do motor em nome do contato (`application/llm_bots/bridge.rs`): o agente trabalha com as ferramentas dos plugins que tem permissão de usar, nunca as `internal_only`, e a resposta do `concluir` vai para a conversa. Os outros agentes respondem direto pelo modelo, sem ferramentas.

Os botões Pausar, Retomar, Encerrar e Cancelar ficam na tela "Agentes ao vivo" do menu, que lista as execuções do registro `agent_runs`; só administradores os veem (`/api/v1/agents/live`, `/api/v1/engine/activities/{id}/cancel`).

## Eventos MCP

`application/events.mjs` coordena assinaturas, filtros e entrega por portas injetadas. O adaptador `sqlite/event-store.mjs` mantém assinaturas e uma fila durável em tabelas aditivas; `event-webhook.mjs` implementa HTTPS com destino público fixado por conexão e assinatura Standard Webhooks. O adaptador WhatsApp publica somente mensagens `notify` recém-inseridas e recebidas, sem histórico ou eco de envio. A raiz de composição conecta essas portas; nenhum caso de uso importa infraestrutura.

A autorização de entrega consulta o ID estável do token ou grant OAuth, sem armazenar o bearer token na assinatura. A validade é reavaliada antes de cada tentativa; renovação do access token mantém a identidade, enquanto revogação do grant a invalida. Uma desconexão explícita remove as assinaturas; encerramento normal do processo conserva a fila. Consulte [MCP_EVENTS.md](MCP_EVENTS.md) para contrato, limites e teste real.

## Segurança

Um único listener (`0.0.0.0:17382`) atende a janela do desktop, a rede local e o túnel: app web em `/app`, API em `/api/v1`, MCP e OAuth. Toda a gestão exige login (cookie `HttpOnly`, `SameSite=Strict`, `Secure` sob HTTPS) com token CSRF e origem verificada; as conexões do WhatsApp são exclusivas de administradores, e o primeiro administrador só é criado por requisição local (loopback, sem cabeçalhos de proxy). Comandos do Tauri só existem na janela do aplicativo. O MCP rejeita origens de navegador, valida o token antes de criar um servidor efêmero e nunca usa IDs de sessão fornecidos por argumentos das ferramentas.

Cada requisição MCP resolve novamente a credencial. SHA-256 é adequado aqui porque os tokens são 256 bits aleatórios, não senhas humanas. Revogar ou expirar invalida a requisição seguinte; revogação não desfaz um envio já em andamento.

OAuth usa os handlers oficiais do SDK MCP para validação de clientes, callbacks e PKCE S256. A aplicação implementa autorização por código de uso único emitido apenas por administradores autenticados. O recurso de cada sessão é obrigatório na autorização, troca e renovação; códigos e tokens são vinculados ao cliente e à sessão. Refresh tokens são rotacionados e sua reutilização revoga a autorização associada. Clientes DCR persistem, inclusive após reiniciar, e só aceitam callbacks HTTPS do ChatGPT. Os segredos de cliente DCR são armazenados no SQLite local; não saem no repositório nem no instalador.

A porta OAuth oferece armazenamento por categoria/chave com expiração, hash, aleatoriedade e transações síncronas. O adaptador SQLite a implementa em uma tabela adicional sem alterar as conversas ou credenciais existentes. A tela de consentimento impede incorporação em frames e valida a origem do formulário; códigos de pareamento e estados de autorização não usam cookies.

O SQLite usa WAL e chaves estrangeiras. Inserts de mensagens são idempotentes por sessão, conversa e ID da mensagem. Credenciais e histórico persistem fora dos arquivos do aplicativo para sobreviver às atualizações.

## Operação

Tauri inicia Node e cloudflared como filhos ocultos. Fechar a janela apenas oculta o painel. Sair encerra ambos os processos. O perfil do Windows é a fronteira de proteção dos dados locais; não há criptografia adicional do banco.

“Conector em execução” confirma o processo local; não é prova de saúde da conexão externa. `/healthz` permite validar o caminho completo pela Cloudflare.

O módulo nativo `updates` usa o atualizador oficial Tauri. Ele baixa a release por HTTPS e valida a assinatura antes de armazenar o pacote em memória; apenas esse pacote verificado pode ser instalado pelo comando da interface. A chave privada fica no GitHub Actions Secrets e a pública no aplicativo. A instalação encerra os processos próprios, preserva a pasta de dados e reabre o aplicativo. A interface consulta ao iniciar e a cada seis horas; o reinício é escolhido pelo usuário.

## Verificações

`npm run check` roda lint, arquitetura, formato, tipos, build e testes de integração. `npm run test:e2e` valida o fluxo de interface com respostas controladas; o pareamento real exige o QR Code no celular.
