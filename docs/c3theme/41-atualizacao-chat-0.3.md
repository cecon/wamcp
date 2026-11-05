# Atualização — C3Theme `origin/main` de 02/11 e `@c3theme/chat` 0.3.0

> **O que mudou:** o C3Theme avançou de `8744b8f` (30/10) para **`e88cf032e5ce881730be768c6468ff72d360f511`** (02/11), com uma leva grande no chat: `AssistantPanel`, `AgentWorkspace`, `ActivityTrace`, `ToolStep`, streaming com “Parar”, `Composer` com `busy`/`onStop`/`hint`, `MessageList` no modo `assistant`, `ConversationPicker` e `useWorkTime`.
>
> **O que fizemos:** atualizamos os dois pacotes (`@c3theme/ui` e `@c3theme/chat`) no `package.json` e no `pnpm-lock.yaml` e validamos o app no worktree pnpm.

---

## 1. O que a nova versão traz

| Área        | Novidade                                                                                                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Assistente  | `AssistantPanel` (cabeçalho/troca de conversa/markdown/ferramentas/Parar) e `AgentWorkspace` (o “trabalho” da resposta: raciocínio, etapas com entrada/saída, painel lateral) |
| Chat        | `MessageList` com `variant="assistant"` (resposta sem balão, largura toda, cursor de escrita, copiar/gerar de novo), `AssistantMessage`, `TypingIndicator` novo               |
| Composer    | `busy`/`onStop` (botão vira **Parar**), `hint`, `actions`, `accept`, gravação de áudio integrada                                                                              |
| Ferramentas | `ToolStep`, `ActivityTrace`, `useWorkTime`/`isWorking` para mostrar o que o agente está fazendo sem “travar” a tela                                                           |
| Outros      | `ConversationPicker`, `Markdown` exportado, `useChatText` (i18n), `buildRows`/`messageKey`                                                                                    |

## 2. Atualização da dependência

```jsonc
"@c3theme/chat": "github:cecon/C3Theme#e88cf03…&path:packages/chat",
"@c3theme/ui":   "github:cecon/C3Theme#e88cf03…&path:packages/ui"
```

- O `pnpm-lock.yaml` foi regenerado no worktree pnpm (`pnpm install --no-frozen-lockfile`), atualizando `@c3theme/chat` 0.1.0 → **0.3.0** e o `@c3theme/ui`.
- **Compatibilidade**: a integração atual (`useMessageWindow` + `MessageList` + `Composer`, atrás de `?c3chat`) compila e passa sem mudanças de contrato — a API antiga foi preservada.

## 3. Evidências (worktree pnpm, dependência nova)

| Verificação                                                 | Resultado                                                                                                                                |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install` (regenerou o lock)                           | `@c3theme/chat` 0.3.0 instalado                                                                                                          |
| `pnpm run lint` (ESLint + arquitetura + 300 linhas + régua) | verde                                                                                                                                    |
| `pnpm run build`                                            | verde — `main` 388,1 kB (gzip 117,6); `Composer` 123,6 kB, `AgentChatScreen` 177,1 kB e `ConversationsScreen` 78,4 kB em chunks próprios |
| `pnpm run test:ui`                                          | **51 arquivos / 220 testes**, cobertura nos limiares                                                                                     |

## 4. Próximo passo (o que a nova versão destrava)

1. **Thread nativo (`?c3chat`)**: usar `busy`/`onStop`/`hint` do `Composer` e `typing`/`renderAvatar` do `MessageList`; avaliar `variant="assistant"` para o chat com o Agente de IA.
2. **Agente de IA**: trocar a thread caseira (`AgentChatThread`) pelo `AssistantPanel` + `AgentWorkspace` (o “Trabalhando…” vira `ActivityTrace`/`ToolStep` dentro da conversa, com streaming e Parar) — resolve exatamente a UX que reclamamos no print do nati.
3. **Ações**: `onRegenerate`, `onOpenWorkspace` e `ConversationPicker` no painel do assistente.

> **Atenção ao rodar local**: a árvore principal ainda tem `node_modules` do npm com o pacote antigo; para desenvolver com esta versão é preciso parar o dev server e rodar **`pnpm install`** (o lock e o `package.json` já estão atualizados).
