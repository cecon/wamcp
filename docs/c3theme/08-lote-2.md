# Lote 2 — Configurações simples no C3Theme (Respostas prontas e Macros)

> **Objetivo:** repetir a receita do lote 1 em telas com carga assíncrona e diálogos, criar as peças comuns das Configurações migradas e provar que telas com testes existentes podem mudar de pele **sem mudar o contrato**. Resultado: 3 telas migradas (Etiquetas + Respostas prontas + Macros), 217 testes verdes e a régua em 4/150.

---

## 1. O que mudou

| Tela                                 | Escopo da migração                                                                               | Contratos preservados                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Respostas prontas** (`CannedPage`) | tela completa: `SettingsC3Page/Header`, `Panel`, `DataTable`, `ActionDialog` + `TextField`       | título, busca `Pesquisar respostas…`, contagem “N resposta(s)”, “Adicionar resposta pronta”, atalho `/slug`, conteúdo, `Editar/Excluir /slug`, `GET/POST/PATCH/DELETE /canned_responses` |
| **Macros** (`MacrosPage`)            | **lista e cabeçalho** no pacote; `MacroEditor` (side panel) e `ConfirmModal` continuam os do app | “Adicionar macro”, “Editar/Excluir <nome>”, textos de ações (`A → B`), “Criada por”, “Visibilidade”, vazio “Nenhuma macro encontrada.”, diálogos com os mesmos nomes                     |
| **Etiquetas** (`LabelsPage`, lote 1) | refatorada para usar as peças comuns, sem mudança de contrato                                    | idem lote 1                                                                                                                                                                              |

Peças comuns criadas em [`settings/c3/SettingsC3.tsx`](../../src/agent/settings/c3/SettingsC3.tsx): `SettingsC3Page` (provider no escopo da seção + moldura), `SettingsC3Header` (título, descrição, busca, contagem, ação) e `SettingsC3Error` (`role="alert"`).

## 2. Receita atualizada (para o lote 3)

1. `<SettingsC3Page>` + `<SettingsC3Header …>` + `<Panel flush>` com `DataTable`.
2. Colunas com `ColumnDef` do TanStack; ações por linha em `IconButton` com os `aria-label` antigos.
3. Formulários/confirmações em `ActionDialog`; o que já é complexo (editor de macro) fica para uma etapa própria.
4. A seção entra no `SettingsRouter` por `React.lazy` dentro de `<LazyPage>` — chunk do MUI só quando abre.
5. Teste da tela no mesmo commit; telas com teste existente não mudam de asserção se os contratos forem mantidos.
6. `pnpm progresso:c3` e build para medir os chunks.

## 3. Evidências (HEAD desta mudança)

| Verificação                                         | Resultado                                                                                                                                                                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc` + ESLint + arquitetura + limite de 300 linhas | verdes                                                                                                                                                                                        |
| Suíte UI (2 execuções seguidas)                     | **50 arquivos / 217 testes**, cobertura nos limiares — novo [`canned-c3.test.tsx`](../../tests/ui/canned-c3.test.tsx); `macros.test.tsx` (6) e `labels-c3` passando sem alteração de asserção |
| Build                                               | `main` 783,4 kB (gzip 230,4); `C3Provider` 325,0 kB (gzip 103,3); `SettingsC3` 100,0 kB (gzip 28,6); páginas: `CannedPage` 3,3 kB, `LabelsPage` 3,8 kB, `MacrosPage` 4,8 kB (todas lazy)      |
| Régua                                               | `4 de 150 telas migradas (3%)`                                                                                                                                                                |
| Estabilidade                                        | `asyncUtilTimeout` global em 10 s: o primeiro carregamento do chunk do MUI em 50 workers pode passar de 3 s                                                                                   |

## 4. Achados

- **Páginas migradas ficam minúsculas** porque o peso do MUI/C3Theme já está nos chunks compartilhados (`C3Provider`, `SettingsC3`); o custo por tela nova é ~3–5 kB.
- **Testes existentes são a rede de segurança**: `macros.test.tsx` não mudou uma linha e continuou validando o editor, os diálogos e as chamadas de API.
- **Timeout de teste é parte da migração**: sem o ajuste global, telas lazy falham de forma intermitente em execução paralela.
- O editor de macro e o `ConfirmModal` são os próximos candidatos — trocá-los muda o contrato de teste (roles/labels do editor), então entram como lote próprio.

## 5. Próximos lotes

1. **Lote 3 — Atributos personalizados**: migrar `AttributesPage` + `AttributeModal`/`ValueInput`, atualizando `custom-attributes.test.tsx` (é o teste mais acoplado à semântica antiga).
2. **Lote 4 — Contatos** (lista/detalhe/importação/merge) e **Relatórios** (filtros + gráficos).
3. **Lote 5 — Editor de macro** e componentes de formulário restantes (`ConditionsEditor`, `ActionsEditor`).
4. **Chat** (`@c3theme/chat` + `ChatTransport`), por último.
