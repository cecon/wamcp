# Lote 4 — Conta e SLA no C3Theme (sem mudar teste)

> **Objetivo:** migrar duas telas de Configurações com formulário/switch e tabela com editor externo **sem alterar uma linha de teste** — provando que a receita do lote 1–3 já está estável. Resultado: 11/153 telas migradas, 220 testes verdes.

---

## 1. O que mudou

| Tela                                                                                   | Migrado                                                                                                                                                                                       | Continua no app                     |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **Configurações da conta** ([`AccountPage`](../../src/agent/settings/AccountPage.tsx)) | `SettingsC3Page/Header`, `Panel`, `TextField`, `SelectField native` (“Idioma”), `Switch` (“Resolver conversas inativas automaticamente”), alertas de erro/sucesso e botão “Salvar alterações” | `SalaryRatesForm` (salário digital) |
| **SLA** ([`SlaPage`](../../src/agent/settings/SlaPage.tsx))                            | `SettingsC3Page/Header`, `DataTable` (colunas de prazo formatadas), `ActionDialog` de exclusão                                                                                                | `SlaModal` (editor de política)     |

**Contratos preservados sem edição de teste:** `getByLabelText('Nome da conta')` (o `required` foi para o `htmlInput`, então o rótulo não ganha asterisco), `selectOptions('Idioma')` por ser select nativo, `getByRole('switch', { name: 'Resolver conversas inativas automaticamente' })`, “Dias de inatividade”, “Mensagem da resolução automática”, “Salvar alterações”, “Configurações da conta salvas.”, “Dados inválidos”, “Nenhum SLA ainda.”, “Adicionar SLA”, “Editar/Excluir <política>”, `1 SLA`, `30min`/`2d` e o corpo de `POST/PUT/DELETE /sla_policies`.

## 2. Evidências (HEAD desta mudança)

| Verificação                                         | Resultado                                                                                                             |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `tsc` + ESLint + arquitetura + limite de 300 linhas | verdes                                                                                                                |
| Suíte UI                                            | **51 arquivos / 220 testes**, cobertura nos limiares — `settings-parity` (6) e `shell` (6) passando **sem alteração** |
| Build                                               | `AccountPage` 4,9 kB (gzip 2,1); `SlaPage` 4,2 kB (gzip 1,8); `main` 766,2 kB (gzip 226,1)                            |
| Régua                                               | **11 de 153 telas migradas (7%)**                                                                                     |

## 3. Achados

- **`required` no `htmlInput` (e não no `TextField`)**: mantém a validação nativa sem o asterisco no nome acessível — é a diferença em relação ao lote 3, onde o asterisco exigiu ajuste de teste.
- **Mixagem controlada funciona**: as duas telas convivem com componentes do app (`SalaryRatesForm`, `SlaModal`) dentro do `Panel` do C3Theme; eles entram nos próximos lotes, um de cada vez.
- **Páginas novas continuam baratas**: ~4–5 kB cada, porque `C3Provider`/`SettingsC3` são chunks compartilhados.

## 4. Fechamento (última rodada)

1. **Contatos e Relatórios** são os blocos grandes restantes; entram em lotes próprios (com adaptação de teste, como Atributos).
2. **Chat**: ligar digitação/recibos e decidir a virada do thread (`?c3chat`) para padrão.
3. **Gate**: ligar `progresso:c3 --check` no `pnpm check` e decidir o shell C3 como padrão (dependente da UX de clique no item-pai e `aria-current`).
4. **Balanço da adoção**: documento final com números, pendências e o que ainda depende de decisão do produto.
