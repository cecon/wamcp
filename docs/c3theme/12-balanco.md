# Balanço da adoção do C3Theme no WhatsAppMcp

> **Resumo:** a fundação está concluída e o app roda nos dois mundos com segurança — tema, tokens, modo escuro, router e chat do C3Theme integrados; 29 lotes de telas migrados (64 telas) com 220 testes verdes em todas as fases. O que falta é **cobertura de telas** (92) e as decisões de produto que destravam o padrão novo (shell e chat). Nada foi quebrado no caminho: cada mudança entrou atrás de flag ou em seção isolada, com o caminho antigo intacto.

---

## 1. O que foi entregue, por fase

| Fase              | Entrega                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Evidência                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Análise**       | O que o C3Theme entrega, o blueprint do nati-next, o inventário da UI e o plano em fases                                                                                                                                                                                                                                                                                                                                                                                                          | [`docs/c3theme/00…04`](00-analise-e-plano.md)        |
| **Spike**         | Shell + chat do pacote rodando ao lado do Tailwind (`?c3spike`), bundle medido, correções de integração                                                                                                                                                                                                                                                                                                                                                                                           | [`04-spike-convivencia.md`](04-spike-convivencia.md) |
| **Dependências**  | pnpm com os pacotes fixados por SHA, `onlyBuiltDependencies`, lock próprio, CI/release com `C3THEME_TOKEN`                                                                                                                                                                                                                                                                                                                                                                                        | commit `chore(deps)`                                 |
| **Fundação**      | `C3Provider` (`injectFirst` + tokens do `agent.css` + `Notifier`), ponte de claro/escuro nos dois sentidos, stubs de MUI nos testes                                                                                                                                                                                                                                                                                                                                                               | [`05-fundacao.md`](05-fundacao.md)                   |
| **Router**        | URL como fonte da navegação (deep link, F5, voltar/avançar, filtros na URL), 213 testes antigos intactos                                                                                                                                                                                                                                                                                                                                                                                          | [`06-router-e-shell.md`](06-router-e-shell.md)       |
| **Shell**         | `AppLayout` com o mesmo menu, header, sino e perfil, atrás de `?c3shell`, em chunk lazy                                                                                                                                                                                                                                                                                                                                                                                                           | idem                                                 |
| **Lotes de tela** | Etiquetas, Respostas prontas, Macros (lista), Atributos, Conta, SLA, Perfil, Caixa de entrada, Busca, Login, MFA, primeiro acesso, Contatos, formulário/notas, etiquetas/ações, modais do contato e Relatórios completos, moldura/card/cabeçalho, thread, lista, balões, ações/anexos, digitação, filtros, menu, composer, painel, ações em massa, participantes, ações, partes do composer e Agente de IA (lista, sessões, thread e markdown) Registro de auditoria e limites/mensagens da caixa | [`07`](07-lote-piloto.md)–[`37`](37-lote-29.md)      |
| **Chat**          | `ChatTransport` sobre a API atual + thread do `@c3theme/chat` atrás de `?c3chat`                                                                                                                                                                                                                                                                                                                                                                                                                  | [`10-chat-transporte.md`](10-chat-transporte.md)     |
| **Régua**         | `pnpm progresso:c3` com `--check` no `pnpm lint`; baseline 64/156                                                                                                                                                                                                                                                                                                                                                                                                                                 | [`progresso.md`](progresso.md)                       |

## 2. Números

| Medida                                            | Valor                                                                                                                                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commits da adoção na branch `feat/c3theme-adocao` | 51                                                                                                                                                                                  |
| Telas migradas                                    | **64 de 156 (41%)**                                                                                                                                                                 |
| Suíte de UI                                       | **51 arquivos / 220 testes** + 6 testes node do servidor                                                                                                                            |
| Cobertura                                         | limiares 80/80/80/70 mantidos                                                                                                                                                       |
| Testes existentes alterados                       | 1 asserção (rótulo com asterisco do MUI, lote 3); os lotes 1, 2 e 4 não mudaram nenhum                                                                                              |
| `main` (gzip)                                     | 403,4 kB (**121,0 kB**) — páginas com MUI em chunks lazy; `react-router` responde por +41 kB                                                                                        |
| Chunks lazy do C3Theme                            | `C3Provider` 314 kB (100,3 gzip) + shell 46 kB (11,4) + páginas de 0,8–10 kB + login 6,5 kB + contatos 17 kB + relatórios 12,8 kB + conversas 78,3 kB + agente 176,4 kB + chat 7 kB |
| CI local equivalente                              | `pnpm install --frozen-lockfile`, `pnpm run lint`, `pnpm run build`, `pnpm run test:ui` verdes                                                                                      |

## 3. O que virou padrão e o que está atrás de flag

| Item                                        | Estado                                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Tema, tokens, modo escuro, provider, router | **padrão** (todas as telas usam a URL e o tema escolhido)                                                   |
| Shell `AppLayout`                           | `?c3shell` — aguarda decisão de UX (clique no item-pai navegar × expandir, `aria-current`)                  |
| Thread do chat (`@c3theme/chat`)            | `?c3chat` — faltam notas privadas, respostas prontas, menções/emoji, reações, ações e histórico do WhatsApp |
| Spike de validação                          | `?c3spike` (ferramenta de desenvolvimento, sem UI de produção)                                              |

## 4. Pendências conhecidas

**Telas (92):** Configurações restantes (~39: Agents/Teams/Inboxes/Webhooks/Roles/Engine/Schedules/Conexões/App e afins), detalhe do contato (`SidePanel`), seções internas de Perfil/Notificações, bootstrap/avisos e telas auxiliares de Relatórios/Conta. A receita está nos lotes 1–28 e a régua mede o avanço.

**Decisões de produto:** virar o shell C3 para padrão; virar o thread do chat; definir se o shell passa a exigir `react-router` em telas que hoje usam `onNavigate` próprio (já compatível).

**Pedidos pequenos ao C3Theme:** exportar `C3Tokens`, `useColorMode` e `Z_INDEX`; embutir `injectFirst` no `C3ThemeProvider`; emitir `dist` com imports `.js` (NodeNext); `NavItem` com `defaultChild`/`onClick` e `aria-current` no ativo; `MessageBubble` com slot de ações e citação (para o chat nativo alcançar paridade).

**Ações do ambiente:** criar o secret **`C3THEME_TOKEN`**; no dev local, parar o servidor e rodar `pnpm install`; remover os worktrees de validação (`git worktree remove D:\projetos\wamcp-pnpm-check`, `D:\projetos\C3Theme-main`) quando não precisar mais.

## 5. Como continuar

1. `pnpm progresso:c3` mostra o que falta por pasta; escolha o próximo lote pela ordem do banner “O que falta”.
2. Aplique a receita de [07-lote-piloto.md §2](07-lote-piloto.md) (C3Page/Header, `DataTable`, `ActionDialog`, `SelectField native`, lazy + `C3Provider` no escopo, teste no mesmo commit).
3. Rode `pnpm run lint && pnpm run build && pnpm run test:ui`; a régua já faz parte do `lint`.
4. Atualize o documento do lote e a régua no mesmo commit.

> **Estado do objetivo:** fundação concluída; lotes em andamento. A branch está pronta para revisão/merge e o restante é execução repetível — não há bloqueio técnico conhecido.

---

## 6. Atualização final do ciclo (02/11/2026)

- **Lotes 1–29 entregues em 33 rodadas**: fundação (pnpm, provider, tokens, router, shell atrás de `?c3shell`, thread atrás de `?c3chat`, régua no lint) e telas: Etiquetas, Respostas prontas, Macros (lista), Atributos, Conta, SLA, Perfil, Caixa de entrada, Busca, Login/MFA, primeiro acesso, Contatos (lista, formulário, notas, etiquetas, ações e 4 modais), Relatórios completos, Conversas completas (moldura, card, cabeçalho, thread, balões, ações/anexos/corpo, digitação, filtros, menu, composer e partes), Agente de IA (lista, sessões, thread e markdown) Registro de auditoria e limites/mensagens da caixa.
- **Régua:** 64 de 156 telas (41%), com gate no `pnpm lint`; o total cresceu de 153 para 156 porque `ConversationFilters`, `ComposerToolbar` e `AgentChatMessages` passaram a contar (não são telas novas).
- **Verificação final (árvore principal + worktree pnpm):** `pnpm install --frozen-lockfile`, lint (ESLint + arquitetura + 300 linhas + régua), build e suíte UI **51 arquivos / 220 testes** em execuções repetidas — tudo verde no HEAD do lote 29.
- **Bundle:** `main` 421,9 kB (gzip 125,6) — páginas com MUI em chunks lazy; `AgentChatScreen` 177,1 kB, `ConversationsScreen` 78,3 kB, `InboxesPage` 18,2 kB, `ContactsPage` 17,5 kB, `Reports` 12,8 kB, `Login` 6,5 kB.
- **Ainda fora:** 92 telas (detalhe do contato `SidePanel`, ~39 de Configurações, seções internas de Perfil/Notificações, bootstrap/avisos), shell C3 e thread do chat como padrão, z-index unificado e os pedidos ao pacote da §4.
- **Para retomar:** dizer “continuar” (a meta amplia o limite de rodadas), rodar `pnpm progresso:c3` e seguir a receita da §5.
