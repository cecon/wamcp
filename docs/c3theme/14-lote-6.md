# Lote 6 — Busca global no C3Theme

> **Objetivo:** migrar a Busca global (página com campo, abas e estados) mantendo as listas de resultado e os contratos de teste; aprender a lidar com o efeito de **páginas lazy** nos testes. Resultado: **14/153 telas migradas**, 220 testes verdes em duas execuções.

---

## 1. O que mudou

| Peça                                                  | Migrado                                                                                                                                                                                       | Continua no app                                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [Busca global](../../src/agent/search/SearchPage.tsx) | `SettingsC3Page`, `Panel`, `Typography h4` (“Pesquisar”), `OutlinedInput` com `autoFocus`/`aria-label`, `Tabs`/`Tab` (Todos, Conversas, Contatos, Mensagens), estados vazios e alerta de erro | `SearchResults` (regiões “Conversas”/“Contatos”/“Mensagens”, botões, `mark` do destaque) |

A página entrou no [`Workspace`](../../src/agent/Workspace.tsx) por `React.lazy` — o chunk do MUI só carrega ao abrir a busca (ou Ctrl+K). Contratos preservados: rótulo do campo, foco automático, texto de mínimo de caracteres, abas com `aria-selected`, heading “Pesquisar”, regiões e destaque com `mark`.

## 2. Dois ajustes de processo descobertos

1. **Página lazy nos testes**: quem navega para a busca e consulta o campo no mesmo tique precisa de `findByLabelText` (o chunk do MUI ainda está carregando). Ajuste feito em `permissions-sla.test.tsx`; nenhuma outra asserção mudou.
2. **Arquivo gerado no Prettier**: o `progresso.md` é saída do script e estava sendo reformatado pelo Prettier, o que quebrava o gate da régua. Entrou no `.prettierignore`; a ordem correta passou a ser “prettier → gerar régua → lint”.

## 3. Evidências (HEAD desta mudança)

| Verificação                          | Resultado                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `tsc` + ESLint + arquitetura + régua | verdes                                                                     |
| Suíte UI (2 execuções)               | **51 arquivos / 220 testes**, cobertura nos limiares                       |
| Testes da busca e de permissões      | 4/4 e 8/8                                                                  |
| Build                                | `SearchPage` 5,3 kB (gzip 2,0) em chunk lazy; `main` 756,1 kB (gzip 223,9) |
| Régua                                | **14 de 153 telas migradas (9%)**                                          |

## 4. Próximos lotes

1. **Login/MFA** com `AuthLayout` e `OtpInput` do pacote — primeira impressão do produto.
2. **Contatos** (lista/detalhe/importação/merge) — maior bloco restante.
3. **Relatórios** e **editor de macro**.
4. **Fechamento**: shell C3 e thread do chat como padrão, z-index unificado, pedidos ao pacote e balanço final.
