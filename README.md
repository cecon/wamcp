# WA MCP

Aplicativo Windows em **Tauri 2 + React**, com múltiplas sessões WhatsApp e um endpoint MCP autenticado por sessão.

## Instalar

Baixe o instalador `.exe` em [Releases](https://github.com/cecon/wamcp/releases).

1. Instale e abra WA MCP.
2. Em Configurações, configure o token do seu Cloudflare Tunnel.
3. Crie uma sessão e escaneie o QR Code em WhatsApp → Aparelhos conectados.
4. Em Acesso MCP, siga a seção **Conectar ao ChatGPT**, ou gere um token para outro cliente MCP.
5. Autorize somente a sessão e as permissões que deseja compartilhar.

O instalador inclui Node.js e cloudflared. Não é necessário instalar ferramentas de desenvolvimento para usar o aplicativo. O instalador inicial não tem assinatura Authenticode.

Fechar a janela mantém o aplicativo na bandeja. Clique no ícone verde para abrir novamente; use **Sair** para encerrar o serviço e o túnel. O computador deve permanecer ligado e conectado à internet.

Por padrão, o WA MCP inicia automaticamente com o Windows (minimizado na bandeja, sem abrir a janela). Desative em **Configurações → Iniciar com o Windows** se preferir abrir manualmente.

### Atualizações automáticas

A partir da versão 26.10.3, o aplicativo verifica novas releases ao abrir e a cada seis horas. O download ocorre em segundo plano e a assinatura é validada com a chave pública embutida. Quando estiver pronto, clique **Reiniciar e atualizar** no aviso; o aplicativo encerra seus serviços, instala silenciosamente e reabre. As sessões e o histórico permanecem no perfil do Windows. Também é possível usar **Configurações → Verificar atualizações**. Sem internet, a versão atual continua funcionando.

Versões anteriores precisam de uma instalação manual para receber o atualizador. A assinatura do atualizador é independente de Authenticode: ela protege o pacote de atualização, mas não remove avisos do Windows sobre editor desconhecido.

## MCP

Endpoint: `https://wamcp.cappyfy.com/mcp/<session-id>`

Transporte: Streamable HTTP sem estado. O ChatGPT usa OAuth 2.1 com PKCE S256 e registro dinâmico de cliente (DCR). Outros clientes podem usar o cabeçalho Bearer personalizado.

### ChatGPT

1. Ative o modo de desenvolvedor nas configurações do ChatGPT, se disponível para sua conta/workspace.
2. Abra [Plugins](https://chatgpt.com/plugins), use **+** e informe a URL MCP da sessão. Escolha OAuth, deixando Client ID e Client Secret vazios para registro automático.
3. No WA MCP → sessão → Acesso MCP, escolha **Somente leitura** ou **Leitura e envio** e gere um código temporário.
4. Na página de autorização em `wamcp.cappyfy.com`, cole esse código e confirme.

O código é de uso único e expira em dez minutos. O access token dura uma hora; o refresh token é rotacionado, com autorização limitada a 90 dias. A lista **Conexões autorizadas** permite revogar a conexão imediatamente. O aplicativo e o túnel devem continuar funcionando no PC.

Isso disponibiliza um servidor compatível com plugins MCP do ChatGPT. A instalação na conta deve ser concluída pelo usuário; não representa publicação no diretório público da OpenAI. A disponibilidade da criação de plugins depende da conta e das políticas do workspace.

Metadados por sessão: `/.well-known/oauth-protected-resource/mcp/<session-id>`. Metadados do emissor: `/.well-known/oauth-authorization-server`. As ferramentas declaram os escopos OAuth, e `get_profile` identifica somente a sessão autorizada. O registro de clientes aceita apenas callbacks HTTPS conhecidos do ChatGPT, com correspondência exata no fluxo. Não é anunciado suporte a CIMD, `private_key_jwt` ou RFC 9207.

### Outros clientes

```json
{
  "mcpServers": {
    "whatsapp": {
      "url": "https://wamcp.cappyfy.com/mcp/SEU_ID",
      "headers": { "Authorization": "Bearer SEU_TOKEN" }
    }
  }
}
```

O formato acima é um exemplo; ajuste-o ao seu cliente MCP.

| Ferramenta        | Permissão       |
| ----------------- | --------------- |
| `session_status`  | Leitura         |
| `get_profile`     | Leitura         |
| `list_chats`      | Leitura         |
| `get_messages`    | Leitura         |
| `get_media`       | Leitura         |
| `search_messages` | Leitura         |
| `send_message`    | Leitura e envio |

Tokens Bearer e tokens OAuth de acesso/renovação são aleatórios, armazenados por hash SHA-256, limitados a uma sessão e revogáveis. A interface cria tokens Bearer válidos por 90 dias. Ferramentas de envio só são anunciadas para tokens com essa permissão. Os registros DCR e seus segredos de cliente persistem no SQLite local para permitir reconexão após reiniciar o aplicativo.

### Mensagens, áudios e arquivos

Para enviar texto, autorize a conexão com **Leitura e envio** e use `send_message` com o `jid` real de `list_chats` e o texto autorizado. Uma conexão existente de somente leitura precisa ser autorizada novamente com envio; atualizar o aplicativo não amplia suas permissões. Se o envio não for confirmado, consulte o histórico antes de repetir.

`get_messages` e `search_messages` incluem `media` com tipo, MIME, nome do arquivo, tamanho, duração e indicação de mensagem de voz quando disponíveis. Use `get_media` com `jid` e `messageId` (o campo `id` da mensagem) para baixar o anexo. Áudios são retornados como conteúdo de áudio MCP; documentos, imagens e vídeos como recursos binários incorporados, sem links públicos. O cliente MCP precisa suportar esses formatos para reproduzir ou salvar o conteúdo. Não há transcrição automática.

O download exige a sessão conectada, tem limite de 10 MiB e espera de até 30 segundos. Mídias antigas podem ter expirado no WhatsApp. Mensagens já armazenadas antes desta atualização não contêm os dados necessários ao download, salvo se forem sincronizadas novamente. Os dados de download persistem no SQLite; o conteúdo binário é baixado sob demanda e não é salvo em disco pelo servidor. Reinicie o aplicativo atualizado e atualize a lista de ferramentas no cliente para descobrir `get_media`.

## Dados locais

`%LOCALAPPDATA%\com.cappyfy.wamcp\`

- `wamcp.sqlite`: sessões, conversas, mensagens, hashes dos tokens e auditoria.
- `auth/`: credenciais de aparelhos WhatsApp.
- `tunnel.token`: credencial local do Cloudflare Tunnel.
- `admin.token`: segredo da API administrativa local.

O SQLite é criado automaticamente no PC da instalação. Nenhum histórico ou token é incluído no instalador ou enviado ao GitHub. Para backup, encerre o aplicativo e copie a pasta de dados. O banco não é criptografado; ele usa as proteções do perfil do Windows.

## Túnel

Configure o hostname público para `http://127.0.0.1:17382`. A API administrativa usa `127.0.0.1:17381` e **não deve ser publicada**. O aplicativo inicia seu próprio processo cloudflared com um arquivo de token, sem instalar um serviço global do Windows.

`wamcp.cappyfy.com` é o endereço desta implantação. Execute o conector em apenas um computador com estas sessões: réplicas com bancos diferentes não compartilham contas ou tokens. Para outra implantação, adapte `publicUrl` e configure um hostname/túnel próprio.

## Eventos no ChatGPT

O servidor oferece `message.created` para novas mensagens recebidas, com filtro opcional por conversa e entrega HTTPS assinada. A assinatura é criada pelo ChatGPT somente quando o usuário pede monitoramento; a atualização não ativa automações por conta própria. Consulte [MCP_EVENTS.md](MCP_EVENTS.md) para limites, segurança e o teste completo após atualizar e reescanear o plugin.

## Desenvolvimento

Requisitos: Windows x64, Node.js 24, Rust estável, Visual Studio Build Tools com C++ e WebView2.

```sh
npm ci
npm run desktop
```

Prévia web: execute `npm run server` e `npm run dev`; informe o conteúdo do arquivo local `admin.token` no formulário de desenvolvimento. O aplicativo Tauri usa comunicação interna e não precisa desse passo.

```sh
npm run check
npm run test:e2e
npm run desktop:build
```

## Arquitetura e qualidade

Arquitetura hexagonal: domínio puro, casos de uso com portas injetadas, adaptadores de entrada HTTP/MCP e de saída SQLite/WhatsApp. Consulte [ARCHITECTURE.md](ARCHITECTURE.md).

- TypeScript estrito na interface, ESLint, regras React Hooks e Prettier.
- Limite físico de **300 linhas por arquivo** de código, incluindo CSS e Rust.
- Verificação automática de direção das dependências e consistência de versão.
- Testes de autorização, isolamento, persistência, SDK MCP e interface com Playwright.
- Rustfmt, Clippy com warnings tratados como erros e auditoria npm.
- Dependabot semanal para npm, Cargo e Actions.

## Versão e release

Formato: **YY.MM.incremental**. Primeira versão: `26.10.1`. O incremental reinicia em 1 a cada mês. Para compatibilidade com SemVer/Tauri, meses de 1 a 9 não têm zero à esquerda nos metadados, por exemplo `27.1.1`.

```sh
npm run format
cargo check --manifest-path src-tauri/Cargo.toml
git add .
git commit -m "feat: descreva a alteração"
git push origin SUA_BRANCH
gh pr create --base main
```

Trabalhe em uma branch e abra PR para `main`. A proteção da branch exige os checks `quality` e `windows` aprovados e a branch atualizada antes do merge, inclusive para administradores. Não envie diretamente para `main` nem crie tags para publicar.

O CI roda somente no PR. Depois do merge, Windows release consulta os resultados já aprovados do PR e executa apenas o bump automático e o build/publicação do instalador assinado, sem repetir testes, auditoria ou Clippy. A versão usa o mês UTC e o próximo incremental acima das versões existentes. O bump sincroniza os metadados apenas na cópia usada para compilar; não cria commits diretos na `main` protegida. A tag aponta para o commit mergeado. Antes de publicar, o fluxo confirma novamente que esse ainda é o commit atual e que o CI do PR segue aprovado. Tags avulsas, pushes sem PR e execução manual não publicam. Não há credenciais Cloudflare ou WhatsApp no CI.

O CI usa o secret `TAURI_SIGNING_PRIVATE_KEY` para assinar o instalador e publica `.exe.sig` e `latest.json`. A chave privada deve ser preservada fora do repositório; sua perda impede atualizar instalações que confiam na chave pública atual. O feed aponta para os artefatos da release, publicados juntos após todos os checks.

## Limites desta versão

- A integração usa Baileys, um cliente não oficial do WhatsApp Web, sem afiliação à Meta. Pode exigir novo pareamento após mudanças do serviço.
- O histórico depende do conteúdo disponibilizado pelo WhatsApp na sincronização; não há garantia de recuperar todo o histórico antigo.
- Anexos são baixados sob demanda pelo MCP, até 10 MiB; disponibilidade depende do WhatsApp e da sincronização.
- Envio MCP de texto; sem envio de mídia.
- O ícone é próprio, inspirado em um balão verde de conversa.

## Referências

- [Tauri: bandeja do sistema](https://v2.tauri.app/learn/system-tray/)
- [Cloudflare: túnel pela API](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel-api/)
- [Baileys](https://github.com/WhiskeySockets/Baileys)
- [Autenticação de plugins no ChatGPT](https://developers.openai.com/plugins/build/auth)

Licença MIT.
