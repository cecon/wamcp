# Lote 8 — Primeiro acesso (Bootstrap) no `AuthLayout`

> **Objetivo:** fechar a autenticação no C3Theme migrando o **primeiro acesso** (criação do administrador) para a mesma moldura do login, sem mudar validações, mensagens nem os testes. Resultado: **17/153 telas migradas**, 220 testes verdes em duas execuções.

---

## 1. O que mudou

| Peça                                            | Migrado                                                                                           | Observação                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [Bootstrap](../../src/agent/auth/Bootstrap.tsx) | `TextField` × 4 (nome, e-mail, senha, confirmação), `Alert` de erro, botão “Criar administrador”  | Mesmas validações (10 caracteres, senhas iguais), 409 → volta ao login com aviso |
| [Login](../../src/agent/auth/Login.tsx)         | **um só** `C3Provider` + `AuthLayout` para login, MFA, primeiro acesso e o aviso de acesso remoto | O aviso “abra no computador…” virou `Stack` com `role="status"`                  |

**Contratos preservados sem edição de teste:** rótulos `Nome`, `E-mail`, `Senha (mínimo 10 caracteres)`, `Confirmar senha`; heading “Criar administrador”; botão de mesmo nome (e “Criando…”); `role="alert"` para as validações; retorno ao login após 409; aviso de acesso remoto e ausência dos campos; fluxo completo de primeiro acesso (422, 409, 500, fallback de login).

## 2. Evidências (HEAD desta mudança)

| Verificação                          | Resultado                                                             |
| ------------------------------------ | --------------------------------------------------------------------- |
| `tsc` + ESLint + arquitetura + régua | verdes                                                                |
| Suíte UI (2 execuções)               | **51 arquivos / 220 testes**, cobertura nos limiares                  |
| Autenticação                         | 18/18 (`first-run`, `login-mfa`, `shell`) sem mudança de asserção     |
| Build                                | `Login` 6,5 kB (gzip 2,4) em chunk lazy; `main` 713,0 kB (gzip 210,3) |
| Régua                                | **17 de 153 telas migradas (11%)**                                    |

## 3. Achados

- **A moldura única de autenticação simplificou o Login**: uma árvore `C3Provider` + `AuthLayout` cobre os quatro estados (senha, MFA, primeiro acesso, aviso remoto), sem cartões paralelos.
- **Labels com parênteses continuam funcionando**: `Senha (mínimo 10 caracteres)` é encontrado exato porque o `required` foi para o `htmlInput` (sem asterisco no nome acessível).
- **O `AuthLayout` resolve o “primeiro acesso” sem CSS extra**: título, descrição e botão usam só MUI + tema do app.

## 4. Próximos lotes

1. **Contatos** (lista/detalhe/importação/merge) — maior bloco restante.
2. **Relatórios** e **editor de macro**.
3. **Fechamento**: shell C3 e thread do chat como padrão, z-index unificado, pedidos ao pacote e balanço final.
