# C3Theme no WhatsAppMcp — o que o time do C3Theme precisa criar e como implementar

> **Pergunta:** dá para aplicar o C3Theme aqui também e o time do C3Theme precisa criar componentes novos — por exemplo, o de chat?
>
> **Resposta curta:** sim, precisa — em **três frentes**. O tema, o shell e as primitivas já existem e podem ser adotados quase de imediato. O **chat é a única frente em que o pacote começa do zero**: existe uma tela de exemplo na vitrine, não um componente. E a forma mais barata de criar esse componente não é escrever do zero no C3Theme: é **extrair para um subpacote o código de chat que já existe e é testado neste repositório**.
>
> **Base do levantamento:** `origin/main` do C3Theme em `2d62f45` (2026-10-30) — o mesmo commit que o `nati-next` fixa. Números, rotas e evidências nos anexos [01](01-c3theme-inventario.md) (C3Theme), [02](02-nati-next-blueprint.md) (migração já feita no nati-next) e [03](03-whatsappmcp-ui-inventario.md) (UI deste app).
>
> **Atualização (30/10/2026):** o time do C3Theme entregou os P0 deste documento — `@c3theme/chat` (contrato, `ChatTransport`, hooks headless, `MessageList` virtualizada, `Composer` com áudio), tokens externos no tema, `FillHeight`, `EmptyState`, `useColorMode`, escala de `z-index` e `UploadField`. O spike de convivência da Fase 1 foi executado e está em [04-spike-convivencia.md](04-spike-convivencia.md); a fundação (pnpm, provider, tokens e modo escuro) está em [05-fundacao.md](05-fundacao.md); router e o shell do pacote (ainda por flag) em [06-router-e-shell.md](06-router-e-shell.md).

---

## 0. Decisões que a análise recomenda (leia só isto, se tiver pressa)

1. **Adotar o C3Theme em fases, não em big bang.** O caso `nati-next` mostra que funciona: shell do C3 + primitivas, telas convertidas em lotes, 338/338 em ~24 h de conversão massiva depois de ~2 dias de fundação. Começar por telas é o erro caro.
2. **Criar um subpacote `@c3theme/chat`** (P0) com 10 componentes/primitivas e 5 hooks headless, mais contrato de dados e chaves de i18n. A demo da vitrine serve como **especificação visual**, não como base de código — 60% dela é acoplamento à demo e não há áudio, mídia, menções, formatação, recibos nem virtualização.
3. **Extrair, não reescrever.** O WhatsAppMcp já tem ~2.600 linhas de chat que são exatamente o que o pacote precisa (bolha, lista, composer, gravação de voz, digitação, marcação WhatsApp, thread de IA), cobertas por testes. Escrever de novo no C3Theme joga fora essa rede de segurança. E já existe precedente dentro do C3Theme: a segunda `DataTable` da vitrine foi **absorvida** para o subpath `@c3theme/ui/table` — extrair código pronto para o pacote é o movimento que o time já fez uma vez.
4. **Chat em modo headless** (hooks + componentes com slots), não "MUI renderizando tudo". Motivo: lista longa, densidade de atendimento, testes por `role`/tag no app, e convivência com Tailwind. Para diálogo, menu, tabela e formulário, MUI por baixo é ganho imediato.
5. **Uma ponte de tokens é entrega do C3Theme, não contorno do app.** O app tem 60 tokens `--color-n-*` (espelho do Chatwoot) e o C3Theme tem 9 cores de marca + `softColors`. Ou o C3Theme aceita um mapa de tokens externo, ou o app perde a paridade visual do Chatwoot e o dark mode duplica.
6. **O chat não deve entrar no motor de telas.** A spec v0 declara chat, tempo real e mídia fora do escopo — e isso está certo. Motor é para CRUD; chat é componente.
7. **Não migrar as listas de conversas/mensagens para componentes MUI** e **não trocar os 50 `<select>` nativos**. A densidade e os contratos de teste atuais valem mais que a padronização.

---

## 1. Foto dos dois lados

|                         | C3Theme (`origin/main` 2d62f45, 30/10/2026)                                                                                                                | WhatsAppMcp (HEAD atual)                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Stack                   | React 19 · MUI 9 · React Router 8 · react-intl 12 · SWR · Vite 8 · TS 6                                                                                    | React 19 · Tailwind 4 · lucide-react · Tauri 2 · sem MUI/Emotion/router/intl     |
| Pacotes                 | `@c3theme/ui` (75 arquivos, 5.462 linhas), `@c3theme/engine` (52/4.829), `@c3theme/conformance`                                                            | `src/agent` (206 arquivos, 18.514 linhas) + servidor Rust Axum/rusqlite          |
| Testes                  | 8 arquivos (4 no `ui`, 4 no `engine`); sem Storybook; sem README por pacote                                                                                | 48 arquivos / 7.234 linhas; cobertura mínima 80/80/80/70                         |
| Chat                    | **só na vitrine**: `apps/showcase/src/sections/apps/chat/*` (9 arquivos, 1.231 linhas), 100% mock                                                          | **produto**: `conversations/` 32 arquivos/3.366 linhas + `agentChat/` 604 linhas |
| Tema                    | `createC3Theme` + `C3ThemeProvider`, 9 marcas, claro/escuro por CSS vars, RTL, 2 looks (`c3`/`angle`)                                                      | `agent.css` de 192 linhas com `@theme` e `data-theme`; 60 tokens `--color-n-*`   |
| Layout                  | `AppLayout` (drawer/mini/barra, breadcrumbs, header, footer) — **exige React Router**                                                                      | roteador de estado próprio (`route.ts`), shell em `Workspace.tsx`/`Sidebar.tsx`  |
| Formulário/tabela       | campos públicos (`MoneyField`, `DecimalField`, `DateField`, `SelectField`, `SearchSelectField`, `FileField`…), `DataTable` servidor em `@c3theme/ui/table` | 225 usos de classe `.field`, 50 `<select>` nativos, tabelas próprias             |
| Backend (se usar motor) | `c3-engine` + `c3-engine-rusqlite` (rusqlite **0.40** / libsqlite3-sys 0.38)                                                                               | `wamcp-server` com rusqlite **0.39** (bundled) → **conflito de link**            |

**Leitura:** o C3Theme é hoje um **tema + shell + CRUD declarativo**. Ele não é um kit de aplicação de atendimento — e é justamente essa a lacuna que o WhatsAppMcp expõe.

---

## 2. O que já existe e deve ser adotado (não pedir de novo)

| Necessidade do app                          | Onde está no C3Theme                                                      | Observação                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Marca, claro/escuro, densidade, RTL, idioma | `createC3Theme`, `C3ThemeProvider`, `SettingsDrawer`                      | 9 marcas: `blue, teal, violet, orange, graphite, indigo, green, rose, cyan`; o verde/ciano combina com WhatsApp |
| Shell (menu, header, breadcrumb, rodapé)    | `AppLayout`, `VerticalNav`, `HorizontalNav`, `Breadcrumbs`, `AppFooter`   | Ganho maior e risco menor — mas exige React Router 8                                                            |
| Login/MFA                                   | `AuthLayout`, `OtpInput`                                                  | O MFA do app usa input único; `OtpInput` cobre                                                                  |
| Tabela de contatos/relatórios               | `DataTable` + `@c3theme/ui/table` (modo servidor, seleção, sticky header) | Já resolve lista longa sem virtualização                                                                        |
| Formulários de configuração                 | campos públicos (`fields/*`), `ActionDialog`, `Panel`, `StatusChip`       | 225 `.field` do app mapeiam direto                                                                              |
| Período de relatório                        | `PeriodFilter` (intervalo livre + atalhos + impressão)                    | Cobre os filtros de Relatórios; ainda sem popover de calendário e **sem consumidor** hoje                       |
| Loading/erro/manutenção                     | `Skeleton*`, `PageLoader`, `MessagePage`                                  | Resolve 72 empty states ad hoc ao padronizar                                                                    |
| Avisos                                      | `notify`/`Notifier` (agora com `NotifyAction`)                            | Ainda **fila de 1** — ver P1                                                                                    |
| Busca de telas, usuário, notificações       | `CommandSearch`, `UserMenu`, `NotificationsButton`                        | Sino simples demais para inbox — ver P1                                                                         |

---

## 3. O que o time do C3Theme precisa criar

Numeração `PED-xx` para virar issue/pedido no repositório do C3Theme (é o mesmo formato que funcionou no nati: PR do C3Theme → bump do pin no app).

### 3.1 Decisões de arquitetura antes de codar (bloqueiam o resto)

| #   | Decisão                                             | Recomendação                                                                                                       | Por quê                                                                         |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| D1  | Chat renderizado em MUI ou headless?                | **Headless**: hooks + markup próprio com `sx` opcional; app decide densidade                                       | Lista longa, virtualização, testes por `role`/`tag`, densidade de atendimento   |
| D2  | Tema aceita mapa de tokens externo?                 | **Sim**: `createC3Theme({ tokensMap })` (ou `themeFromCssVars`) gerando `theme.vars` + emitindo `var(--color-n-*)` | Hoje há dois vocabulários (`--mui-palette-*` e `--color-n-*`) e dois dark modes |
| D3  | Região de conteúdo com altura cheia no `AppLayout`? | **Sim**: slot/conteúdo `height: 100%` (hoje telas cheias usam `calc(100dvh - 220px)`)                              | Chat, kanban e editor precisam; a demo usa gambiarra de altura                  |
| D4  | Ícones: pacote define família?                      | **Não**: ícone como `component`/prop em todo componente                                                            | App usa `lucide-react` (82 arquivos); pacote usa `iconsax-reactjs`              |
| D5  | i18n do chat                                        | Chaves `c3.chat.*` no `i18n.ts` (hoje **zero** chaves de chat)                                                     | A vitrine fixa pt-BR e não usa react-intl                                       |
| D6  | Pacote versionado por tag ou SHA?                   | **SHA** (como o nati faz), com release próprio e changelog                                                         | Evita "tag que anda"; o CI precisa de token de leitura                          |
| D7  | Testes/Storybook/README por pacote                  | **Obrigatório** antes de prometer estabilidade                                                                     | Hoje: 8 testes, sem Storybook, sem README de pacote                             |

### 3.2 P0 — novo subpacote `@c3theme/chat` (o "componente de chat")

**É isto que responde à pergunta.** A demo da vitrine mostra o visual; o pacote precisa disto:

| #      | Componente/hook                                  | API proposta                                                                                                                                                 | Base pronta no WhatsAppMcp                          | LOC origem |
| ------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ---------- |
| PED-01 | `Chat/MessageBubble`                             | `message`, `variant` (`incoming`/`outgoing`/`private`/`bot`/`failed`/`deleted`), `author`, `receipt`, `quoted`, `reactions`, `attachments`, `actions` (slot) | `MessageItem.tsx` + `MessageExtras.tsx`             | 208        |
| PED-02 | `Chat/MessageList`                               | `messages`, `renderBubble`, `typing`, `hasMore`, `onLoadMore`, `highlightId`, `daySeparator`, `virtual`, `emptyState`                                        | `MessageList.tsx` + scroll de `ConversationBox.tsx` | 130        |
| PED-03 | `Chat/Composer`                                  | `mode` (`reply`/`note`), `onSend`, `attachments`, `voice`, `mentions`, `canned`, `draftKey`, `disabledReason`, `slots.toolbar`                               | `ReplyBox.tsx` + `composer/*`                       | 390        |
| PED-04 | `Chat/useVoiceRecorder` (headless)               | `{ recording, elapsed, start, cancel, finish }` — OGG/Opus com fallback WebM                                                                                 | `composer/useVoiceRecorder.ts`                      | 98         |
| PED-05 | `Chat/useTypingStatus` (headless)                | `{ typing, recording, start, stop }` com debounce de 3 s                                                                                                     | `composer/composerState.ts`                         | 48         |
| PED-06 | `Chat/useDraft` (headless)                       | rascunho por `scopeKey` em `localStorage`                                                                                                                    | `composerState.ts`                                  | 15         |
| PED-07 | `Chat/TextMarkup`                                | `profile: 'whatsapp' \| 'markdown' \| 'plain'`, nunca HTML                                                                                                   | `whatsappFormat.tsx` + `MessageBody.tsx`            | 60         |
| PED-08 | `Chat/ConversationList` + `ConversationListItem` | `items`, `selectedId`, `selectable`, `onSelect`, `slots` (SLA/etiquetas/prioridade)                                                                          | `ChatList.tsx` + `ConversationCard.tsx`             | 281        |
| PED-09 | `Chat/AttachmentView`                            | 5 tipos: imagem (lightbox), vídeo, áudio, documento, localização                                                                                             | `Attachments.tsx`                                   | 113        |
| PED-10 | `Chat/Thread` + `Chat/AITurn`                    | steps de ferramenta, "pensando", markdown, erro, tokens/custo                                                                                                | `agentChat/AgentChatThread.tsx`                     | 225        |
| PED-11 | `Chat/TypingIndicator`                           | expira sozinho, ignora self                                                                                                                                  | `TypingIndicator.tsx`                               | 51         |
| PED-12 | `Chat/useMessageWindow` (headless)               | paginação para trás + âncora de scroll + "novas mensagens"                                                                                                   | (não existe hoje: o app carrega tudo)               | —          |
| PED-13 | Contrato de dados público                        | `Message`/`Conversation`/`Attachment`/`Receipt`/`Reaction` com `at` ISO, ids string, `status`, `replyTo`, `mentions`                                         | `src/agent/types.ts` + demo `chat/data.ts`          | 150        |
| PED-14 | i18n + acessibilidade do chat                    | chaves `c3.chat.*`, `aria-live`, foco ao trocar conversa, teclado no emoji, RTL                                                                              | —                                                   | 300        |

**Esforço P0:** ~2.000–2.700 linhas e **3–5 semanas de 1 dev** (inclui testes e documentação). O caminho mais curto é extrair os arquivos acima, trocar imports de `../api` por props/hooks injetados, e manter os testes do app como suíte de aceitação do pacote.

**Restrição do repositório:** o C3Theme agora recusa arquivo com mais de **300 linhas** (`scripts/check-lines.mjs:9`). O `Composer` (390 LOC) e a `MessageBubble` (208) terão de ser divididos em arquivos menores — bom para manutenção, mas entra no orçamento de extração.

### 3.3 P1 — novo subpacote `@c3theme/helpdesk`

| #      | Componente                                                                | Origem no app                                                | LOC |
| ------ | ------------------------------------------------------------------------- | ------------------------------------------------------------ | --- |
| PED-15 | `Helpdesk/StatusBadge` (open/pending/snoozed/resolved, variante "com IA") | `StatusPill`/`ChatListHeader`/`ConversationCard`             | ~40 |
| PED-16 | `Helpdesk/SlaBadge` + `useSlaCountdown` (perdido/cumprido)                | `sla/SlaBadge.tsx`, `sla/SlaSection.tsx`                     | 51  |
| PED-17 | `Helpdesk/CsatRating` + `RatingDistribution`                              | `reports/CsatResponses.tsx`                                  | 58  |
| PED-18 | `Helpdesk/QueryBuilder` (atributo/operador/valor + AND/OR)                | `filters/ConditionRow.tsx` + `settings/ConditionsEditor.tsx` | 206 |
| PED-19 | `Helpdesk/MetricTile` + `BarChart` (SVG puro, acessível)                  | `reports/MetricReport.tsx` + `BarChart.tsx`                  | 115 |
| PED-20 | `Helpdesk/BulkActionBar` (ações em massa sobre ids)                       | `BulkActionBar.tsx`                                          | 194 |

**Esforço:** ~1–2 semanas; baixo risco, alto reuso em qualquer produto de atendimento da C3.

### 3.4 Evoluções no `@c3theme/ui` existente

| #      | Entrega                                                                      | Situação hoje                                                  | Por quê                                                        |
| ------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| PED-21 | **Fila de avisos** (`notify` com empilhamento, ação, undo)                   | fila de **1**: um aviso substitui o outro (`notify.tsx:23,30`) | Envio/falha/reconexão disparam vários eventos; hoje se perdem  |
| PED-22 | **`Tooltip`** padronizado                                                    | não existe; o app tem **151** `title=`                         | Acessibilidade e consistência                                  |
| PED-23 | **`EmptyState`**                                                             | 72 implementações ad hoc                                       | Padronizar estado vazio em tabela, busca, inbox                |
| PED-24 | **`Tabs`** (underline/pill/contador)                                         | 7 tablists à mão no app, nenhuma no pacote                     | Reuso imediato em Configurações/Relatórios                     |
| PED-25 | **Upload/dropzone com progresso**                                            | `FileField` só faz base64 ≤ 1 MB (sem upload persistido)       | Anexo de WhatsApp é mídia, não base64                          |
| PED-26 | **`NotificationsButton` de inbox** (agrupar, tempo relativo, ações por item) | sino simples                                                   | Central de notificações do app é própria e mais rica           |
| PED-27 | **`CommandSearch` com ações/registros**                                      | busca só títulos do menu                                       | Atalho de operador (Ctrl+K) precisa achar conversa/contato     |
| PED-28 | **`Avatar` com presença**                                                    | demo tem `StatusAvatar` fora do pacote; `SoftAvatar` sem badge | Vai ser copiado em todo app de chat                            |
| PED-29 | **Escala de `z-index` em tokens**                                            | app usa 30/40/50; MUI usa 1300/1400/1500                       | Menus e tooltips vão ficar atrás de diálogo se ninguém decidir |
| PED-30 | **`useColorMode` único** (MUI ⇄ `data-theme`)                                | app escreve `data-theme`; provider tem o seu                   | Dois donos = flash de tema                                     |
| PED-31 | **Ponte de tokens** (D2) e **região de altura cheia** (D3)                   | ver §3.1                                                       | Sem isso, chat e relatórios ficam com gambiarra                |

**Esforço:** ~2–3 semanas.

### 3.5 O que **não** deve entrar no design system

Regra prática: se o componente importa um endpoint do domínio ou conhece "WhatsApp", "helpdesk" ou "conta", é **composição do app**, não pacote.

- Shell deste produto (`Workspace`, `Sidebar`, `ConversationsScreen`, `ContactPanel`, `ConversationActions`), `ChatListHeader` com as abas Minhas/Não atribuídas/Todas.
- 19 seções de Configurações, 8 de Relatórios, `FilterModal`+views salvas, automações, webhooks, escalas, engine de agentes, conexões/QR/pareamento.
- Regras de negócio: status/atribuição/snooze, CSAT, SLA, macros, papéis, multi-conta, formatação de mensagem **como dado** (o componente recebe texto; o parser pode ser do pacote).
- As listas de conversa/mensagem **não** viram `List` do MUI; o `<select>` nativo **não** vira `Select` do MUI.

### 3.6 Correções pequenas que o app vai precisar no pacote

| Item                                             | Estado                                                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `AppLayout` não oferece conteúdo com altura 100% | confirmado no código; a vitrine usa `calc(100dvh - 220px)`                                            |
| `window.scrollTo` no `AppLayout`                 | **já corrigido** no `origin/main` (efeito em bloco); o monkey patch do nati pode sair no próximo bump |
| `PageHeader`                                     | não está exportado no root do `origin/main` (só `Breadcrumbs`) — decidir se volta                     |
| `DataTable`                                      | no working tree local está **não commitado**; use o do `origin/main` em `@c3theme/ui/table`           |
| Sem README/Storybook por pacote                  | pedir junto com o chat (a documentação de props é o que evita cópia)                                  |

---

## 4. Ordem recomendada (o que destrava o quê)

| Fase | Frente                                                                             | Dono          | Esforço  | Destrava                               |
| ---- | ---------------------------------------------------------------------------------- | ------------- | -------- | -------------------------------------- |
| 0    | ADR + decisões D1–D7                                                               | C3Theme + app | 2–3 dias | Tudo                                   |
| 1    | Spike Tailwind × MUI (1 tela)                                                      | app           | 1–2 dias | Decisão de reset/dark/z-index          |
| 2    | `@c3theme/chat` P0 (PED-01…14)                                                     | C3Theme       | 3–5 sem  | Tela de conversas no padrão C3         |
| 3    | `@c3theme/ui` evoluções PED-21…31                                                  | C3Theme       | 2–3 sem  | Configurações/relatórios sem gambiarra |
| 4    | Fundação front (provider, router, `AppLayout`, `AuthLayout`, título, notificações) | app           | 1–2 sem  | Troca visual do shell                  |
| 5    | Telas em lotes (Configurações → Contatos → Relatórios → Perfil)                    | app           | 3–5 sem  | Fim do Tailwind "legado" nessas telas  |
| 6    | `@c3theme/helpdesk` P1 (PED-15…20)                                                 | C3Theme       | 1–2 sem  | SLA/CSAT/filtros padronizados          |
| 7    | Gates e release (régua, testes, pino SHA, token CI)                                | app           | 3–5 dias | Migração "fechada" e reproduzível      |

Total aproximado: **C3Theme 6–10 semanas**, **WhatsAppMcp 5–8 semanas** de 1 dev (as fases 2–3 e 4–5 rodam em paralelo).

---

## 5. Plano de implementação no WhatsAppMcp (fases)

> Detalhe operacional completo no [anexo 02](02-nati-next-blueprint.md), §7. Aqui fica o recorte para este app.

**Fase 0 — Decisões (1–2 dias, sem código de tela).** ADR com: layout = `AppLayout` do C3; chat = `@c3theme/chat` (headless) e **fica fora do motor**; o que fica fora do tema (chat durante a transição, QR/streaming); dono do reset (preflight do Tailwind **ou** `CssBaseline` — não os dois) e dono do dark mode (`data-theme` ou `colorSchemes`); adotar React Router 8 com `basename: '/app'`; SHA do C3Theme fixado.

**Fase 1 — Spike de convivência (1–2 dias, descartável).** Branch com MUI 9 + Emotion + `@c3theme/ui` instalados e **uma** tela (`AppLayout` + `Panel` + `Button`) ao lado do Tailwind atual. Medir: preflight × `CssBaseline` (bordas, `img`, `button`), dois dark modes, `z-index` (modal atual 40 × MUI 1300), bundle (+250–400 KB), fontes. Saída: 1 página de conflitos e decisão.

**Fase 2 — Fundação front (1–2 semanas).** `C3ThemeProvider` com marca verde/ciano, `locale: 'pt-BR'`, `storageKey` próprio; React Router 8 com as rotas de `route.ts` (deep link: `/app/conversations/:id`, `/app/settings/:section`); `AppLayout` com menu vindo de `route.ts`/`permissions.ts` (ícones `lucide` como componente); `AuthLayout` no login/MFA; `Notifier`; `StyledEngineProvider injectFirst`; stubs de `matchMedia`/`ResizeObserver` no setup de teste **antes** da primeira tela.

**Fase 3 — Chat (paralela, C3Theme).** Extrair hooks → bolha → lista → composer; o app consome e seus 11 arquivos de teste de chat (composer, messages, mentions, voice, reply, agent-chat…) viram a suíte de aceitação do pacote. Enquanto o kit não estiver pronto, o chat atual continua funcionando dentro do novo shell (dois regimes temporários, como no nati).

**Fase 4 — Telas em lotes (3–5 semanas).** Lote por pasta: `settings/labels` (piloto mais simples) → `settings/*` (19 seções) → `contacts` → `reports` → `profile`/`auth`. Um PR por lote, sem regra de negócio nova, atualizando asserções de teste no mesmo commit (classe → ARIA/texto). Meta: **zero** classe Tailwind nos arquivos migrados, medida por script de régua.

**Fase 5 — Helpdesk.** Trocar `SlaBadge`, `StatusPill`, `CsatResponses`, `ConditionRow` pelas versões do pacote.

**Fase 6 — Fecho e release.** Script de régua no `npm run check` (molde `scripts/c3-progresso.mjs` do nati, adaptado a Tailwind); remover Tailwind/preflight onde não houver mais legado; 2 refs de SHA no `package.json`; token `C3THEME_TOKEN` no CI/release; procedimento de bump documentado.

**Decisão técnica do backend (só se usar o motor nos CRUDs):** `wamcp-server` está em rusqlite **0.39** e o `c3-engine-rusqlite` em **0.40** — Cargo recusa dois `libsqlite3-sys`. Alternativas: (a) subir o app para 0.40, ou (b) implementar `c3_engine::Store` (~100–150 linhas) sobre a conexão atual, como o nati fez. **Não é pré-requisito** para tema, shell ou chat.

---

## 6. Riscos que podem custar caro (com mitigação)

| #   | Risco                                                                                     | Evidência                                                                                          | Mitigação                                                                                     |
| --- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| R1  | Emotion injeta CSS depois do Tailwind; utilitário em componente MUI perde silenciosamente | ordem de `<style>` em runtime                                                                      | `StyledEngineProvider injectFirst` desde o dia 1; regra "não sobrescrever MUI com utilitário" |
| R2  | Preflight do Tailwind × `CssBaseline` do MUI                                              | `agent.css:6`; MUI repete reset                                                                    | Um dono só; não ativar `CssBaseline` se o preflight ficar                                     |
| R3  | Dois dark modes (`data-theme` × `colorSchemes`)                                           | `theme.ts:33-36`                                                                                   | `useColorMode` único, controlado (PED-30)                                                     |
| R4  | Testes de UI quebram por semântica (MUI `Select` não é `<select>`, `Dialog` vira portal)  | 48 arquivos/7.234 linhas travam `role`, tag `STRONG`, `data-testid`                                | Migrar por tela preservando `aria-label`/roles; **não** trocar `<select>` nativo              |
| R5  | `z-index` incompatível (app 30/40/50 × MUI 1300+)                                         | `Overlay.tsx:25,53,101`                                                                            | Escala única de tokens (PED-29)                                                               |
| R6  | Bundle/cold start no Tauri                                                                | hoje 584,5 KB JS + 52,5 KB CSS; MUI+Emotion+iconsax somam 250–400 KB                               | imports por caminho, mapear `lucide` (não adotar iconsax nas telas), medir antes/depois       |
| R7  | CSP do Tauri                                                                              | `style-src 'self' 'unsafe-inline'` (`tauri.conf.json:15`) permite Emotion; endurecer exige `nonce` | `createCache` com `nonce` suportado pelo provider                                             |
| R8  | jsdom sem `matchMedia`/`ResizeObserver`                                                   | `tests/ui/setup.ts` só stuba `scrollIntoView`/`EventSource`                                        | adicionar stubs antes da primeira tela                                                        |
| R9  | Listas longas: MUI `List` degrada e o app não virtualiza                                  | `MessageList` mapeia tudo                                                                          | virtualização no pacote (`PED-02`/`PED-12`), não no MUI                                       |
| R10 | Conflito rusqlite 0.39 × 0.40                                                             | `src-tauri/server/Cargo.toml:31` × `crates/c3-engine-rusqlite/Cargo.toml`                          | ver §5 (bump ou `Store` próprio)                                                              |
| R11 | Migração que "fecha a régua" mas não testa                                                | erro do nati: FA ficou, `access` não foi aplicado                                                  | régua + gate de ícone + e2e por papel/texto                                                   |
| R12 | Dois padrões de componente (kit local × pacote)                                           | nati: campos do pacote entregues e não adotados                                                    | escolher **um** por área e escrever no ADR                                                    |

---

## 7. Três opções de escopo (para decidir com o produto)

| Opção                                                                      | O que muda                                                               | Esforço app | Ganho                                                         | Risco                                                                               |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **A — Tema + shell só**                                                    | `C3ThemeProvider` + `AppLayout`/`AuthLayout`; conteúdo continua Tailwind | 2–3 sem     | Identidade visual C3 imediata                                 | Dois regimes de CSS permanentes; chat e telas ficam "estrangeiros" dentro do layout |
| **B — Tema + shell + primitivas, chat extraído em paralelo** (recomendada) | A + campos/tabela/período/skeleton + `@c3theme/chat` quando pronto       | 5–8 sem     | Convergência real; chat reutilizável por todos os produtos C3 | Depende do C3Theme entregar P0 (D1–D7)                                              |
| **C — Big bang, chat reescrito em MUI**                                    | Tudo de B + reescrever 3.4k linhas de chat                               | 10–14 sem   | Nenhum ganho de reuso                                         | Perde densidade, testes e desempenho; refaz o que já funciona                       |

**Recomendação:** **B**. Começar por Fase 0–2 (decisões + spike + fundação) enquanto o C3Theme fecha D1–D7 e extrai os hooks do chat — que é a parte de menor risco e maior reuso. O chat atual continua no ar durante a transição.

---

## 8. Próximos 5 passos concretos

1. **Escrever o ADR** deste app nos moldes do `docs/adr/0018` do nati, com escopo, o que fica fora e as decisões D1–D7.
2. **Rodar o spike de convivência** (Fase 1) — é o único item que pode mudar o plano.
3. **Abrir os pedidos `PED-01…PED-14`** no C3Theme, começando por D1/D2 e pelos hooks PED-04/05/06/07 (baixo risco, testes já existem).
4. **Levar o C3Theme local para o `origin/main` 2d62f45** antes de criar qualquer coisa: o `main` local está 85 commits atrás e o working tree tem WIP (DataTable não commitado).
5. **Fixar o SHA e o token de leitura** no CI/release do WhatsAppMcp (molde do nati) para que o bump seja um PR isolado.

---

## 9. Anexos

| Doc                                                                | Conteúdo                                                                                                  |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| [01-c3theme-inventario.md](01-c3theme-inventario.md)               | API pública, maturidade, vitrine × pacote, análise da demo de chat, lacunas P0/P1/P2                      |
| [02-nati-next-blueprint.md](02-nati-next-blueprint.md)             | Como a migração foi feita: fases, arquitetura, pedidos entregues, armadilhas, versionamento, checklist    |
| [03-whatsappmcp-ui-inventario.md](03-whatsappmcp-ui-inventario.md) | Telas, primitivas, análise do chat, classificação genérico × composição × domínio, 18 riscos MUI+Tailwind |

> **Nota de escopo:** este documento analisa e propõe; não alterou código de UI nem configuração do app. A única escrita fora de `docs/c3theme/` foi o reparo de permissões de arquivo do workspace (necessário para o terminal funcionar), com backup e comando de rollback em `D:\projetos\WhatsAppMcp-acl-recovery\`.
