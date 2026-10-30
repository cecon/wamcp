# Lote 1 — tela piloto migrada (Configurações → Etiquetas)

> **Objetivo deste lote:** provar o caminho completo de uma tela escrita sobre o C3Theme — painel, tabela de dados, diálogo de ação e campos do MUI — **sem mudar contratos** (textos, rótulos, busca, ações) e mantendo build, lint e testes verdes. Serve de receita para os próximos lotes.

---

## 1. O que mudou

| Antes (Tailwind + kit proprio)                              | Agora (C3Theme)                                                                    |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `SettingsPage`/`SettingsHeader`/`Table`/`Cell`/`RowActions` | `Panel` + `Typography` + `DataTable` de `@c3theme/ui/table` + `ActionDialog`       |
| `Modal` + campos `.field`                                   | `ActionDialog` + `TextField` do MUI                                                |
| Busca no header + tabela própria                            | `OutlinedInput` no painel + `DataTable` (ordenação/paginação da tabela)            |
| Ícones de ação de `ui/Button`                               | `IconButton` do MUI com os mesmos `aria-label` (`Editar <nome>`, `Excluir <nome>`) |

Arquivos: [`settings/LabelsPage.tsx`](../../src/agent/settings/LabelsPage.tsx) (reescrito) e [`settings/SettingsRouter.tsx`](../../src/agent/settings/SettingsRouter.tsx) (carga lazy).

**Contratos preservados** (verificados por teste): título “Etiquetas”, descrição, contagem “N etiquetas”, busca com `aria-label="Pesquisar etiquetas…"`, botão “Adicionar etiqueta”, diálogo “Adicionar/Editar etiqueta”, botões “Criar”/“Salvar”/“Cancelar”, ações por linha, `POST/PATCH/DELETE /labels`.

## 2. Receita para os próximos lotes

1. **Escolher a tela mais simples** da pasta (sem efeito colateral, sem streaming).
2. **Mapear o contrato de teste/UX** antes: títulos, `aria-label`, placeholders, textos de botão, `data-testid` se houver.
3. **Trocar só a apresentação**: `Panel` para a moldura, `DataTable` para listas, `ActionDialog` para comandos, `TextField`/campos do pacote para formulários. Nada de regra de negócio nova.
4. **Manter a página em chunk lazy** (`React.lazy` no router da seção) e envolver só a página no `C3Provider` — enquanto o shell padrão não for o do C3, é o que evita MUI global e `CssBaseline` em telas não migradas.
5. **Escrever/ajustar o teste da tela** na mesma mudança (semântica de `role`/texto, não de classe).
6. **Rodar** `tsc`, lint, build, suíte UI com cobertura.
7. **Medir o chunk** da tela no build e registrar no lote.

## 3. Descobertas deste lote (já resolvidas)

| Achado                                                                                 | Consequência                                                                                                                                                           |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O `DataTable` **não traz busca própria**; filtro por coluna é opcional (`showFilters`) | A tela continua dona do campo de busca e filtra as `rows` antes de passar                                                                                              |
| O `@c3theme/ui/table` depende de `@tanstack/react-table`                               | Adicionado como dependência direta do app **e** ao `resolve.dedupe` de `vite.config.ts`/`vitest.config.ts` (senão o TanStack puxa o React do monorepo e o hook quebra) |
| `TextField` com `required` deixa o nome acessível como “Nome da etiqueta *”            | Teste usa `/Nome da etiqueta/`; rótulos visíveis não mudam                                                                                                             |
| Cada página migrada tem seu chunk                                                      | `LabelsPage-*.js` = 111,2 kB (gzip 31,9 kB), carregado só ao abrir a seção                                                                                             |

## 4. Evidências (HEAD desta mudança)

| Verificação                                         | Resultado                                                                                                                        |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `tsc` + ESLint + arquitetura + limite de 300 linhas | verdes                                                                                                                           |
| Suíte UI                                            | **49 arquivos / 216 testes** (novo: [`labels-c3.test.tsx`](../../tests/ui/labels-c3.test.tsx)), cobertura nos limiares           |
| Build                                               | `main` 789,1 kB (gzip 231,5 kB); `C3Provider` compartilhado 325,0 kB (gzip 103,3 kB); `LabelsPage` 111,2 kB (gzip 31,9 kB), lazy |
| Lockfile                                            | `pnpm-lock.yaml` atualizado com `@tanstack/react-table` (`--frozen-lockfile` validado)                                           |

## 5. Próximos lotes

1. **Lote 2 — Configurações simples**: `CannedPage` (respostas prontas), `AttributesPage` e `MacrosPage` (listas + diálogos), aplicando a mesma receita.
2. **Script de régua**: contar arquivos de `src/agent` que ainda usam classes/tokens do tema antigo por pasta, gerar `docs/c3theme/progresso.md` e só depois ligar no `pnpm check`.
3. **Lote 3 — Contatos** (lista + detalhe + importação/merge) e **Relatórios** (filtros de período + gráficos), que dependem de mais decisões de componente.
4. **Chat**: `ChatTransport` sobre a API atual e troca pelo `@c3theme/chat` (último, pelo risco de mídia/scroll).
