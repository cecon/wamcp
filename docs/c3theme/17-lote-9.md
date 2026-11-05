# Lote 9 — Contatos no C3Theme

> **Objetivo:** migrar o maior bloco restante — a lista de contatos — para o C3Theme, mantendo toolbar, detalhe lateral, modais e todos os contratos de teste. Resultado: **18/153 telas migradas (12%)**, 220 testes verdes em duas execuções.

---

## 1. O que mudou

| Peça                                             | Migrado                                                                                                                                                                                                        | Continua no app                                                                                                        |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [ContactsPage](../../src/agent/ContactsPage.tsx) | `SettingsC3Page/Header` (busca, contagem, toolbar como ação), `SettingsC3Error`, `Panel` + `DataTable` com colunas Nome (avatar/bloqueado), E-mail, Telefone e Última atividade; clique na linha abre o painel | `ContactsToolbar` (filtros/views/importar/exportar/novo), `ContactDetail` e os modais de importação/merge/novo contato |

A página entrou no [`Workspace`](../../src/agent/Workspace.tsx) por `React.lazy`: o chunk do MUI só carrega ao abrir Contatos.

**Contratos preservados sem edição de teste:** busca `Pesquisar contatos…`, contagem “N contato(s)”, vazio “Nenhum contato encontrado.”, clique no nome abrindo o `dialog` de detalhe, botões da toolbar (“Novo contato”, “Importar”, “Exportar”, filtros), edição de telefone/foto/etiquetas/notas, merge, exclusão e o fluxo da busca global que abre um contato.

## 2. Evidências (HEAD desta mudança)

| Verificação                          | Resultado                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `tsc` + ESLint + arquitetura + régua | verdes                                                                                                                    |
| Suíte UI (2 execuções)               | **51 arquivos / 220 testes**, cobertura nos limiares                                                                      |
| Testes de contatos                   | 11/11 (`contacts-book`, `contacts-reports`, `search`) sem mudança de asserção                                             |
| Build                                | `ContactsPage` 17,0 kB (gzip 5,8) em chunk lazy; `main` **693,6 kB (gzip 205,8)** — −19 kB ao tirar a página do principal |
| Régua                                | **18 de 153 telas migradas (12%)**                                                                                        |

## 3. Achados

- **`onRowClick` do `DataTable`** substitui o `<tr onClick>` do app sem mudar a experiência (clique no texto do nome abre o detalhe).
- **Avatar e bloqueado** couberam na célula via `Stack`/`Typography`; nenhuma classe utilitária própria foi necessária.
- **Toolbar como `action` do header** funciona bem para grupos de botões densos.

## 4. Próximos lotes

1. **Detalhe do contato + modais** (`ContactDetail`, `ContactForm`, `ImportModal`, `MergeModal`, `NewContactModal`) — próximo passo natural de Contatos.
2. **Relatórios** e **editor de macro**.
3. **Fechamento**: shell C3 e thread do chat como padrão, z-index unificado, pedidos ao pacote e balanço final.
