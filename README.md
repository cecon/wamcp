# WA MCP

Aplicativo Windows em **Tauri 2 + React**, com múltiplas sessões WhatsApp e um endpoint MCP autenticado por sessão.

## Instalar

Baixe o instalador `.exe` em [Releases](https://github.com/cecon/wamcp/releases).

1. Instale e abra WA MCP.
2. Em Configurações, configure o token do seu Cloudflare Tunnel.
3. Crie uma sessão e escaneie o QR Code em WhatsApp → Aparelhos conectados.
4. Em Acesso MCP, gere um token para cada integração.
5. Configure o cliente com a URL da sessão e `Authorization: Bearer SEU_TOKEN`.

O instalador inclui Node.js e cloudflared. Não é necessário instalar ferramentas de desenvolvimento para usar o aplicativo. O instalador inicial não tem assinatura Authenticode.

Fechar a janela mantém o aplicativo na bandeja. Clique no ícone verde para abrir novamente; use **Sair** para encerrar o serviço e o túnel. O computador deve permanecer ligado e conectado à internet.

## MCP

Endpoint: `https://wamcp.cappyfy.com/mcp/<session-id>`

Transporte: Streamable HTTP sem estado. O cliente precisa aceitar cabeçalho Bearer personalizado; login OAuth não está implementado nesta versão.

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
| `list_chats`      | Leitura         |
| `get_messages`    | Leitura         |
| `search_messages` | Leitura         |
| `send_message`    | Leitura e envio |

Tokens são aleatórios, armazenados apenas como SHA-256, limitados a uma sessão, exibidos uma única vez e revogáveis. A interface cria tokens válidos por 90 dias. Ferramentas de envio só são anunciadas para tokens com essa permissão.

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
npm run version -- next
npm run format
cargo check --manifest-path src-tauri/Cargo.toml
git add .
git commit -m "chore: release YY.M.incremental"
git tag vYY.M.incremental
git push origin main --tags
```

Uma tag dispara validações, testes, compilação Windows, instalador NSIS e publicação de release com checksum SHA-256. `workflow_dispatch` compila um artefato sem publicar release. Não há credenciais Cloudflare ou WhatsApp no CI.

## Limites desta versão

- A integração usa Baileys, um cliente não oficial do WhatsApp Web, sem afiliação à Meta. Pode exigir novo pareamento após mudanças do serviço.
- O histórico depende do conteúdo disponibilizado pelo WhatsApp na sincronização; não há garantia de recuperar todo o histórico antigo.
- Mensagens de mídia são identificadas por tipo/caption; anexos não são baixados.
- Envio MCP de texto; sem envio de mídia, OAuth, inicialização automática com Windows ou atualização automática do aplicativo.
- O ícone é próprio, inspirado em um balão verde de conversa.

## Referências

- [Tauri: bandeja do sistema](https://v2.tauri.app/learn/system-tray/)
- [Cloudflare: túnel pela API](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel-api/)
- [Baileys](https://github.com/WhiskeySockets/Baileys)

Licença MIT.
