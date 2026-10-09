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
