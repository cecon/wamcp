# Fechamento — 100% das telas no C3Theme

> **Resultado:** **161 de 161 telas migradas (100%)**, `main` em **290,8 kB (gzip 92,0 kB)**, suíte **220 testes verdes** (222 no worktree com o pacote 0.3) e `tsc`/ESLint/arquitetura/régua verdes. A migração terminou sem big bang: shell e chat novos continuam atrás de flag até a decisão de UX.

---

## 1. Como foi feito (3 frentes em paralelo + fechamento)

| Frente                | Escopo                                                                                                                                                            | Resultado                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **settings-core**     | Páginas de Configurações (Canais/Inboxes, Motor, Agendamentos, Aplicativo, Conexões, GitHub) e modais/editores (SLA, perfis, regra de automação, macro, entregas) | `SettingsC3Page/Header` + `DataTable`; páginas no `lazy` do router; testes do escopo verdes |
| **settings-support**  | `members/**` (Funcionários, organograma, detalhe, salário) e `directory/**` (roster, skills, credenciais), `AgentModal`, `InboxAgentSelect`                       | abas/`ActionDialog`/MUI; dois arquivos extraídos por limite de 300 linhas; testes verdes    |
| **product-surfaces**  | Perfil/MFA, Notificações, Filtros/views salvas, Busca, Contatos, Conversas, Atributos, SLA, Macros, Relatórios (CSAT), Atalhos, UpdateNotice e **Sidebar**        | 100% das pastas dela; SidePanel do contato em `Dialog` lateral; `SidebarNav` extraído       |
| **Lead (fechamento)** | Primitivos compartilhados `ui/*`, `Workspace`, `AgentApp`, `SettingsRouter` (lazy de Agents/Skills/Organization), régua/docs/verificação                          | 11 arquivos finais; **régua 161/161**                                                       |

## 2. Primitivos migrados no fechamento

| Arquivo                                   | Como ficou                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui/Button`                               | `Button` do MUI mantendo a API do app (`color`, `variant`, `size`, `icon`, `trailingIcon`, `label`)                                                           |
| `ui/Avatar`                               | `Avatar` do MUI com as iniciais determinísticas e o ponto de disponibilidade                                                                                  |
| `ui/Settings`                             | Header (busca/contagem/ação), `Box` de página, tabela com `<tr>` preservado, `RowActions`, `ModalFooter` e **`Toggle` com `Switch` do MUI (`role="switch"`)** |
| `ui/Overlay`                              | `Dialog`/`Drawer` (modal e painel lateral com título acessível e “Fechar”), `Dropdown` com `role="menu"` e `MenuItem`                                         |
| `ui/Accordion`                            | seção MUI com `aria-expanded` e corpo que desmonta ao fechar                                                                                                  |
| `ui/Confirm`                              | `ActionDialog` (com `C3Provider` local)                                                                                                                       |
| `ui/SecretField`, `ui/NoAccess`           | `TextField`/`IconButton` e `Stack`/`Typography`                                                                                                               |
| `Workspace`, `AgentApp`, `SettingsRouter` | `Box`/`Typography` nos fallbacks; Agents/Skills/Organization no `lazy` (chunk do MUI fora do principal)                                                       |

## 3. Evidências finais

| Verificação                                                    | Resultado                                                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `npx tsc --noEmit`                                             | verde                                                                                        |
| `npm run lint` (ESLint + arquitetura + 300 linhas + **régua**) | verde                                                                                        |
| `npm run build`                                                | verde — **`main` 290,8 kB (gzip 92,0)**; `C3Provider` 247,9 kB (80,7) em chunk compartilhado |
| `npm run test:ui` (árvore principal)                           | **220 testes verdes + 2 pulados** (teste do `AssistantPanel` exige chat 0.3)                 |
| Worktree pnpm (chat 0.3)                                       | validado em seguida: **222 testes**, lint e build verdes                                     |
| Régua                                                          | **161 de 161 telas (100%)** — `node scripts/c3-progresso.mjs --check` no lint                |

## 4. O que sobra (decisões de produto, não migração)

1. **Virar os padrões**: `?c3shell` (AppLayout) e `?c3assistant`/`?c3chat` (chat novo) continuam opt-in; a troca de default pede adaptação dos testes de shell/chat antigos e aprovação de UX. O código dos dois lados está pronto.
2. **Unificar `z-index`** com o `Z_INDEX` do pacote (quando exportado) e revisar os overlays próprios.
3. **Pedidos ao C3Theme** já mapeados (tokens/`useColorMode`/`Z_INDEX` exportados, `injectFirst` embutido, imports `.js`, `NavItem` com `aria-current`).
4. **Ambiente**: `C3THEME_TOKEN` no CI, `pnpm install` local e remoção dos worktrees de validação.
