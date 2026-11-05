# Fase 2 — router, shell do C3Theme e ativação por flag

> **Nesta etapa:** a navegação passou a viver na URL (deep link, F5, voltar/avançar) **sem mudar nenhum comportamento** — os 213 testes anteriores continuam passando. O shell novo (`AppLayout` do C3Theme) está implementado e ligado por `?c3shell`, em chunk lazy, pronto para virar padrão depois da revisão de UX.
>
> **Evidências:** `tsc`, ESLint, build e a suíte completa verdes (48 arquivos, 215 testes, cobertura nos limiares). Bundle: `main` 804,8 kB (+41 kB do `react-router`, gzip 235,9 kB); shell C3 carregado só com a flag, em 2 chunks (145,1 kB gzip). Detalhes e evidências abaixo.

---

## 1. Router: a URL passa a ser a fonte da navegação

| Antes                                             | Agora                                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `useState<Route>(HOME)` no `Workspace`            | `useRoute()` lê/escreve a URL via React Router 8                                    |
| Sem deep link, sem F5 na tela, sem voltar/avançar | `/conversations?inbox=10`, `/settings?section=labels`, `/reports?section=csat` etc. |
| Rotas em união discriminada (`route.ts`)          | A mesma união, serializada por `routeToPath`/`pathToRoute`                          |

Arquivos: [`navigation/routes.ts`](../../src/agent/navigation/routes.ts), [`navigation/useRoute.ts`](../../src/agent/navigation/useRoute.ts), [`AgentApp.tsx`](../../src/agent/AgentApp.tsx), [`Workspace.tsx`](../../src/agent/Workspace.tsx).

- **`basename`** vem de `document.baseURI`: `''` no dev (Vite na raiz) e `/app` quando o backend serve o build — sem configuração por ambiente.
- **Filtros avançados e views salvas** viajam na URL (`?f=<json>`), então aplicar um filtro e recarregar mantém o resultado.
- **Flags de desenvolvimento** não se perdem na navegação: `useRoute(['c3shell'])` preserva a flag que liga o shell novo.
- **Caminho desconhecido** cai na tela inicial; seção ou relatório inválido cai no padrão (`account`/`overview`) em vez de quebrar.
- Contratos preservados: `onNavigate(route)` continua igual nas telas; 213 testes antigos passaram sem alteração.
- Testes novos: [`tests/ui/navigation.test.tsx`](../../tests/ui/navigation.test.tsx) (5) cobrem ida-e-volta, filtros, ids e URLs inválidas.

## 2. Shell do C3Theme (`?c3shell`)

O [`shell/C3Shell.tsx`](../../src/agent/shell/C3Shell.tsx) monta o `AppLayout` com o mesmo conteúdo de navegação do sidebar atual:

| Sidebar atual                                              | No `AppLayout`                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Caixa de entrada + badge de não lidas                      | item `Caixa de entrada` com `badge` = não lidas                                             |
| Conversas (Todas, tipos, pastas, times, canais, etiquetas) | item `Conversas` com filhos (links gerados de `routeToPath`)                                |
| Agentes, Contatos (por permissão)                          | itens folha                                                                                 |
| Relatórios (por permissão)                                 | grupo `Relatórios` com as 8 seções                                                          |
| Configurações (admin)                                      | grupo `Sistema` com as 19 seções (filtra `desktop`)                                         |
| Busca no topo + pesquisa global                            | `header`: `OutlinedInput` com `aria-label="Pesquisar conversas"` + botão de pesquisa global |
| Sino de notificações                                       | `header` (mesmo `NotificationBell`)                                                         |
| Menu do perfil (presença, tema, sair)                      | `drawerFooter` (mesmo `ProfileMenu`)                                                        |
| —                                                          | `ColorModeButton` e `SettingsButton` do pacote no header                                    |

Decisões de implementação:

- **Lazy de verdade**: [`shell/C3Workspace.tsx`](../../src/agent/shell/C3Workspace.tsx) é importado por `React.lazy`; MUI/Emotion só entram quando a flag está ligada. O shell atual continua leve.
- **Provider**: o `C3Provider` (tokens do app + `injectFirst` + `Notifier` + ponte de claro/escuro) envolve o shell; a árvore atual segue em Tailwind até a decisão de virar padrão.
- **Altura cheia**: `FillHeight` nas telas de conversas/chat de IA; as demais mantêm rolagem normal (Configurações/Relatórios).
- **Testes**: [`tests/ui/shell-c3.test.tsx`](../../tests/ui/shell-c3.test.tsx) (2) verificam menu, badge, navegação por link, busca do header, páginas de Configurações e persistência da flag. O chunk é pré-carregado no arquivo de teste para a transformação do MUI não estourar o timeout em paralelo.

## 3. Custo medido

| Chunk                                      |  Tamanho |     gzip | Quando carrega         |
| ------------------------------------------ | -------: | -------: | ---------------------- |
| `main` (app atual + react-router)          | 804,8 kB | 235,9 kB | sempre                 |
| `C3Provider` (MUI, Emotion, iconsax, tema) | 430,8 kB | 132,6 kB | só com `?c3shell`      |
| `C3Workspace` (shell, menu)                |  50,3 kB |  12,5 kB | só com `?c3shell`      |
| `spike` (`?c3spike`)                       | 104,4 kB |  27,8 kB | só com a flag do spike |
| CSS do Tailwind                            |  54,3 kB |  10,9 kB | inalterado             |

> O shell custa **~145 kB gzip** e é pago apenas por quem usa `?c3shell`. Quando virar padrão, esse custo passa a ser o do app — o `main` fica com ~236 kB gzip + 145 kB do shell.

## 4. O que falta para virar padrão (decisão de UX + 3 pedidos ao C3Theme)

1. **Clique no item-pai.** O `VerticalNav` do pacote só expande/recolhe quando o item tem filhos; o sidebar atual **navega** ao clicar (ex.: “Configurações” abre Funcionários). Para manter o comportamento atual sem copiar o menu, o `NavItem` precisa de algo como `defaultChild`/`onClick`. **Alternativa:** aceitar a mudança de UX (pai só expande) e atualizar o [shell.test.tsx](../../tests/ui/shell.test.tsx).
2. **`aria-current` no item ativo.** O sidebar hoje marca `aria-current="page"`; o pacote usa classe `Mui-selected`. Pedir o atributo (ou adaptar os testes).
3. **Exports pequenos:** `C3Tokens` (usei `C3ThemeProviderProps['tokens']`), `useColorMode` e `Z_INDEX`; e o `injectFirst` dentro do `C3ThemeProvider`.
4. **Imports com extensão no `dist`.** O pacote emite `import './theme/vars'` sem `.js`. No Vite/build funciona; no Vitest com pnpm o pacote cai em `node_modules/.pnpm`, é externalizado e o Node ESM não resolve. Contornado com `test.server.deps.inline: [/@c3theme\//]` no [`vitest.config.ts`](../../vitest.config.ts); o certo é o C3Theme emitir com extensão (NodeNext).

Sem os itens 1–2, virar o padrão exige reescrever 3 testes de shell e aceitar a mudança de comportamento do menu — decisão de produto, não técnica.

## 5. Próximos passos

1. Decidir o item 1 (pedido ao C3Theme x mudança de UX) e então **virar o shell padrão**, removendo o sidebar antigo e o `?c3shell`.
2. **Tela piloto** (Configurações → Etiquetas) com `DataTable`/campos do pacote, calibrar a régua e escrever o script de progresso.
3. **Chat**: `ChatTransport` sobre a API atual e troca de lista/bolha/composer pelo `@c3theme/chat`.
