# Lote 3 — Atributos personalizados no C3Theme

> **Objetivo:** migrar a tela de Configurações com o teste mais acoplado (`custom-attributes.test.tsx`) provando que é possível trocar a pele **sem mudar o comportamento** — abas, tabela, criação/edição e exclusão. Resultado: 6/150 telas migradas, 217 testes verdes em duas execuções seguidas.

---

## 1. O que mudou

| Peça            | Antes                                                        | Agora                                                                                                                       |
| --------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Página          | `SettingsPage/Header/Table/Cell/RowActions` + `ConfirmModal` | `SettingsC3Page/Header`, `Panel`, `Tabs`/`Tab` do MUI, `DataTable`, `ActionDialog` para excluir                             |
| Modal           | `Modal` + campos `.field` + `<select>` nativo                | `ActionDialog` + `TextField`/`SelectField **native**` (modelo, nome, chave, descrição, tipo, opções da lista, regex e dica) |
| Abas            | `<nav role="tablist">` caseiro                               | `Tabs`/`Tab` do MUI (mesmos nomes e `aria-selected`)                                                                        |
| Ações por linha | `RowActions`                                                 | `IconButton` com os mesmos `aria-label` (`Editar/Excluir <nome>`)                                                           |

Arquivos: [`AttributesPage.tsx`](../../src/agent/settings/AttributesPage.tsx), [`AttributeModal.tsx`](../../src/agent/settings/AttributeModal.tsx), [`SettingsRouter.tsx`](../../src/agent/settings/SettingsRouter.tsx) (carga lazy).

**Contratos preservados:** abas “Conversa”/“Contato”, contagem, vazio “Nenhum atributo personalizado ainda.”, “Adicionar atributo”, diálogos “Adicionar/Editar atributo”, botões “Criar”/“Salvar”/“Cancelar”, “Excluir”, campos por rótulo, selects nativos (`selectOptions` continua valendo), corpo enviado (`POST/PATCH/DELETE /custom_attribute_definitions`).

## 2. A única mudança de asserção

O `required` do MUI acrescenta um asterisco ao nome acessível do campo, então o teste passou de `getByLabelText('Nome de exibição')` para `getByLabelText(/Nome de exibição/)`. Nenhum outro ponto do teste mudou — criação, erro 422 inline, edição com chave desabilitada e exclusão continuam verificados.

## 3. Evidências (HEAD desta mudança)

| Verificação                                         | Resultado                                                                                                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc` + ESLint + arquitetura + limite de 300 linhas | verdes                                                                                                                                   |
| Suíte UI (2 execuções seguidas)                     | **50 arquivos / 217 testes**, cobertura nos limiares                                                                                     |
| `custom-attributes.test.tsx`                        | 3/3 (inclui a tela e os inputs de atributo nas conversas)                                                                                |
| Build                                               | `AttributesPage` 28,1 kB (gzip 9,5); `SettingsC3` 100,0 kB (gzip 28,6); `C3Provider` 325,0 kB (gzip 103,3); `main` 778,7 kB (gzip 229,6) |
| Régua                                               | **6 de 150 telas migradas (4%)**                                                                                                         |

Ajustes de infraestrutura deste lote: `testTimeout` em 30 s e pré-carregamento do chunk do C3Theme nos testes longos — a tela leva ~9 s sozinha e, em 50 workers, passava dos 15 s sem ser falha de lógica.

## 4. Achados para os próximos lotes

- **`SelectField native` é o caminho para preservar formulários** que usam `<select>`/`selectOptions`: mantém a semântica, o teclado nativo e os testes, com o visual do tema.
- **`ActionDialog` cobre confirmação de exclusão** sem `ConfirmModal`; o `tone="danger"` mantém a hierarquia visual.
- **Telas com teste longo** devem pré-carregar o chunk do pacote no próprio arquivo de teste, senão o primeiro carregamento entra no tempo do teste.

## 5. Próximos lotes

1. **Lote 4 — Contatos** (lista/detalhe/importação/merge): é o maior bloco restante de Configurações/CRM.
2. **Lote 5 — Relatórios** (filtros de período + gráficos) e **editor de macro** (`MacroEditor`, `ActionsEditor`, `ConditionsEditor`).
3. **Chat** — `ChatTransport` sobre a API atual + `@c3theme/chat`; último por causa de mídia, scroll e virtualização.
