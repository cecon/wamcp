# Lote 5 — Perfil e Caixa de entrada no C3Theme

> **Objetivo:** migrar a casca de duas páginas de topo (fora de Configurações) mantendo as listas/seções internas do app, provando que a receita também serve para páginas de produto. Resultado: **13/153 telas migradas**, 220 testes verdes.

---

## 1. O que mudou

| Página                                                                                             | Migrado                                                                                                    | Continua no app                                            |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Configurações do perfil** ([`profile/ProfilePage.tsx`](../../src/agent/profile/ProfilePage.tsx)) | `SettingsC3Page/Header` + `Panel` com título/nota por seção (`ProfileSection`)                             | `NotificationPreferences`, `MfaSection`, `SessionsSection` |
| **Caixa de entrada** ([`NotificationsPage.tsx`](../../src/agent/NotificationsPage.tsx))            | `C3Provider`, `Box`/`Typography` de moldura e cabeçalho (h1 “Caixa de entrada”, largura 400 px no desktop) | `NotificationList` e `NotificationBulkActions`             |

As duas páginas passaram a carregar por `React.lazy` no [`Workspace`](../../src/agent/Workspace.tsx): o chunk do MUI só entra quando a página abre.

**Contratos preservados sem alteração de teste:** heading “Configurações do perfil”; switches/listas das seções (nomes e `role`s); heading “Caixa de entrada” (necessário em `conversations.test`), `role="region"`/`aria-label` da seção, botões de ação em massa (“Marcar tudo como lido”, “Excluir todas”) e o fluxo de notificações da suíte.

## 2. Evidências (HEAD desta mudança)

| Verificação                          | Resultado                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `tsc` + ESLint + arquitetura + régua | verdes                                                                                                  |
| Suíte UI                             | **51 arquivos / 220 testes**, cobertura nos limiares                                                    |
| Testes diretamente afetados          | 23/23 (`profile`, `notifications-center`, `shell`, `conversations`) **sem mudança de asserção**         |
| Build                                | `NotificationsPage` 0,8 kB (gzip 0,47) · `ProfilePage` 9,8 kB (gzip 3,4) · `main` 760,9 kB (gzip 224,9) |
| Régua                                | **13 de 153 telas migradas (8%)**                                                                       |

## 3. Achados

- **Páginas de topo entram na mesma receita**: `SettingsC3Page/Header` para telas de conteúdo e `C3Provider` + `Box`/`Typography` para telas de painel (Caixa de entrada).
- **A `Panel` do pacote já é o “card de seção”**: `title`/`subtitle` viraram o bloco título+nota do perfil sem CSS próprio.
- **Cuidado de ordem no gate**: gerar a régua **antes** de rodar o `lint` no mesmo comando; o gate recusa o arquivo desatualizado (foi o que aconteceu aqui e é o comportamento desejado).

## 4. Próximo lote sugerido

1. **Busca global** (`SearchPage`) — tem regiões/tabs e atalho; contrato de teste conhecido.
2. **Login/MFA** com `AuthLayout` e `OtpInput` do pacote — primeira impressão do produto.
3. **Contatos** (lista/detalhe/importação/merge) — maior bloco restante.
4. **Relatórios** e **editor de macro** — depois dos anteriores.
5. **Fechamento**: shell C3 e thread do chat como padrão, z-index unificado e pedidos ao pacote.
