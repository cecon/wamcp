# Balanço da adoção do C3Theme no WhatsAppMcp

> **Resumo:** a fundação está concluída e o app roda nos dois mundos com segurança — tema, tokens, modo escuro, router e chat do C3Theme integrados; 4 lotes de telas migrados (11 telas) com 220 testes verdes em todas as fases. O que falta é **cobertura de telas** (142) e as decisões de produto que destravam o padrão novo (shell e chat). Nada foi quebrado no caminho: cada mudança entrou atrás de flag ou em seção isolada, com o caminho antigo intacto.

---

## 1. O que foi entregue, por fase

| Fase              | Entrega                                                                                                                             | Evidência                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Análise**       | O que o C3Theme entrega, o blueprint do nati-next, o inventário da UI e o plano em fases                                            | [`docs/c3theme/00…04`](00-analise-e-plano.md)                                               |
| **Spike**         | Shell + chat do pacote rodando ao lado do Tailwind (`?c3spike`), bundle medido, correções de integração                             | [`04-spike-convivencia.md`](04-spike-convivencia.md)                                        |
| **Dependências**  | pnpm com os pacotes fixados por SHA, `onlyBuiltDependencies`, lock próprio, CI/release com `C3THEME_TOKEN`                          | commit `chore(deps)`                                                                        |
| **Fundação**      | `C3Provider` (`injectFirst` + tokens do `agent.css` + `Notifier`), ponte de claro/escuro nos dois sentidos, stubs de MUI nos testes | [`05-fundacao.md`](05-fundacao.md)                                                          |
| **Router**        | URL como fonte da navegação (deep link, F5, voltar/avançar, filtros na URL), 213 testes antigos intactos                            | [`06-router-e-shell.md`](06-router-e-shell.md)                                              |
| **Shell**         | `AppLayout` com o mesmo menu, header, sino e perfil, atrás de `?c3shell`, em chunk lazy                                             | idem                                                                                        |
| **Lotes de tela** | Etiquetas, Respostas prontas, Macros (lista), Atributos, Conta e SLA                                                                | [`07`](07-lote-piloto.md), [`08`](08-lote-2.md), [`09`](09-lote-3.md), [`11`](11-lote-4.md) |
| **Chat**          | `ChatTransport` sobre a API atual + thread do `@c3theme/chat` atrás de `?c3chat`                                                    | [`10-chat-transporte.md`](10-chat-transporte.md)                                            |
| **Régua**         | `pnpm progresso:c3` com `--check` no `pnpm lint`; baseline 11/153                                                                   | [`progresso.md`](progresso.md)                                                              |

## 2. Números

| Medida                                            | Valor                                                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Commits da adoção na branch `feat/c3theme-adocao` | 14                                                                                              |
| Telas migradas                                    | **11 de 153 (7%)**                                                                              |
| Suíte de UI                                       | **51 arquivos / 220 testes** + 6 testes node do servidor                                        |
| Cobertura                                         | limiares 80/80/80/70 mantidos                                                                   |
| Testes existentes alterados                       | 1 asserção (rótulo com asterisco do MUI, lote 3); os lotes 1, 2 e 4 não mudaram nenhum          |
| `main` (gzip)                                     | 765,5 kB (**225,9 kB**) — +41 kB do `react-router`                                              |
| Chunks lazy do C3Theme                            | `C3Provider` 314 kB (100,3 gzip) + shell 46 kB (11,4) + páginas de 3–5 kB + thread do chat 7 kB |
| CI local equivalente                              | `pnpm install --frozen-lockfile`, `pnpm run lint`, `pnpm run build`, `pnpm run test:ui` verdes  |

## 3. O que virou padrão e o que está atrás de flag

| Item                                        | Estado                                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Tema, tokens, modo escuro, provider, router | **padrão** (todas as telas usam a URL e o tema escolhido)                                                   |
| Shell `AppLayout`                           | `?c3shell` — aguarda decisão de UX (clique no item-pai navegar × expandir, `aria-current`)                  |
| Thread do chat (`@c3theme/chat`)            | `?c3chat` — faltam notas privadas, respostas prontas, menções/emoji, reações, ações e histórico do WhatsApp |
| Spike de validação                          | `?c3spike` (ferramenta de desenvolvimento, sem UI de produção)                                              |

## 4. Pendências conhecidas

**Telas (142):** Contatos (10 arquivos), Conversas (23), Relatórios (11), Configurações restantes (Agents/Teams/Inboxes/Webhooks/Auditoria/Roles/Engine/Schedules/Conexões/App), Agente de IA (4), Auth/Perfil/Notificações. A receita está nos lotes 1–4 e a régua mede o avanço.

**Decisões de produto:** virar o shell C3 para padrão; virar o thread do chat; definir se o shell passa a exigir `react-router` em telas que hoje usam `onNavigate` próprio (já compatível).

**Pedidos pequenos ao C3Theme:** exportar `C3Tokens`, `useColorMode` e `Z_INDEX`; embutir `injectFirst` no `C3ThemeProvider`; emitir `dist` com imports `.js` (NodeNext); `NavItem` com `defaultChild`/`onClick` e `aria-current` no ativo; `MessageBubble` com slot de ações e citação (para o chat nativo alcançar paridade).

**Ações do ambiente:** criar o secret **`C3THEME_TOKEN`**; no dev local, parar o servidor e rodar `pnpm install`; remover os worktrees de validação (`git worktree remove D:\projetos\wamcp-pnpm-check`, `D:\projetos\C3Theme-main`) quando não precisar mais.

## 5. Como continuar

1. `pnpm progresso:c3` mostra o que falta por pasta; escolha o próximo lote pela ordem do banner “O que falta”.
2. Aplique a receita de [07-lote-piloto.md §2](07-lote-piloto.md) (C3Page/Header, `DataTable`, `ActionDialog`, `SelectField native`, lazy + `C3Provider` no escopo, teste no mesmo commit).
3. Rode `pnpm run lint && pnpm run build && pnpm run test:ui`; a régua já faz parte do `lint`.
4. Atualize o documento do lote e a régua no mesmo commit.

> **Estado do objetivo:** fundação concluída; lotes em andamento. A branch está pronta para revisão/merge e o restante é execução repetível — não há bloqueio técnico conhecido.
