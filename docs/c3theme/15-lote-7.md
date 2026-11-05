# Lote 7 — Login e verificação em duas etapas no C3Theme

> **Objetivo:** migrar a porta de entrada do produto para o `AuthLayout` e campos do C3Theme, mantendo todo o fluxo de autenticação (CSRF, MFA, códigos de recuperação, erros e primeiro acesso) **sem alterar teste**. Resultado: **16/153 telas migradas**, 220 testes verdes em duas execuções.

---

## 1. O que mudou

| Peça                                     | Migrado                                                                                                                      | Observação                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [Login](../../src/agent/auth/Login.tsx)  | `C3Provider` + `AuthLayout` (painel lateral com a marca) + `TextField`/`Alert`/`Button` do MUI                               | O passo de senha virou um `Stack` dentro do cartão do `AuthLayout`        |
| [MFA](../../src/agent/auth/MfaStep.tsx)  | `TextField` com `autoComplete="one-time-code"`/monoespaçado, `Alert` de erro, “Verificar” e “Cancelar e voltar para o login” | Mesma lógica de desafio expirado (401 com “expirad”)                      |
| [AgentApp](../../src/agent/AgentApp.tsx) | `Login` agora é `React.lazy` com `Suspense`                                                                                  | O MUI saiu do chunk principal (−42 kB) e o login carrega em chunk próprio |

**Primeiro acesso (`Bootstrap`) fica na moldura antiga** por enquanto: ele tem cartão, validações e mensagens próprias e merece um lote dedicado.

**Contratos preservados sem edição de teste:** rótulos `E-mail`, `Senha`, `Código de verificação`; headings “Entrar no Atendimento”/“Verificação em duas etapas”; envio por Enter; `role="alert"` com as mensagens de erro (inclusive “Muitas tentativas”); limpeza do código após erro; “Verificar” desabilitado sem código; cancelamento do MFA; fluxo de primeiro acesso e login/CSRF da suíte.

## 2. Evidências (HEAD desta mudança)

| Verificação                          | Resultado                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `tsc` + ESLint + arquitetura + régua | verdes                                                                                                                   |
| Suíte UI (2 execuções)               | **51 arquivos / 220 testes**, cobertura nos limiares                                                                     |
| Testes de autenticação               | 18/18 (`login-mfa`, `first-run`, `shell`) **sem mudança de asserção**                                                    |
| Build                                | `Login` 7,6 kB (gzip 2,9) em chunk lazy; `main` **713,0 kB (gzip 210,3)** — caiu 42 kB ao tirar o MUI do chunk principal |
| Régua                                | **16 de 153 telas migradas (10%)**                                                                                       |

## 3. Achados

- **`AuthLayout` já resolve a moldura de autenticação** (painel de marca 44%, cartão 440 px, `Logo` do branding): a tela de login ficou só com o formulário.
- **Lazy no login compensa**: o chunk principal perdeu o peso do MUI e o login carrega em 7,6 kB.
- **`required` no `htmlInput`** manteve os rótulos exatos usados pelos testes (sem asterisco).

## 4. Próximos lotes

1. **Bootstrap (primeiro acesso)** com a mesma moldura de autenticação.
2. **Contatos** (lista/detalhe/importação/merge) — maior bloco restante.
3. **Relatórios** e **editor de macro**.
4. **Fechamento**: shell C3 e thread do chat como padrão, z-index unificado, pedidos ao pacote e balanço final.
