# Contribuir

Use Node.js 24 e Rust estável. Siga SOLID, KISS e DRY sem introduzir abstrações sem necessidade concreta.

- Mantenha arquivos com no máximo 300 linhas, sem minificar para contornar o limite.
- Domínio e aplicação não dependem de infraestrutura. No backend (`src-tauri/server`), `domain` não usa outras camadas e `application` só usa `domain` e as portas em `application/ports`; `scripts/check-architecture.mjs` verifica.
- Separe operações de leitura e envio; toda mudança de acesso precisa de teste de isolamento.
- Não use credenciais reais em testes, fixtures, imagens ou logs.
- Execute `npm run check`, `npm run test:server`, `npm run coverage:server` (mínimo 80% de linhas), `npm run test:e2e`, `cargo fmt --all` e `cargo clippy --workspace --all-targets -- -D warnings` (em `src-tauri`) antes de enviar PR.
- Preserve versão consistente em package.json, lockfiles, Cargo.toml e configuração Tauri.
- Ajuste documentação quando o comportamento ou a instalação mudar.
- Toda mudança entra em `main` por PR, com os checks `quality` e `windows` aprovados e a branch atualizada. Não use bypass administrativo.
- CI roda somente no PR. Após o merge na `main`, a release faz bump automático e build/publicação, consultando os checks já aprovados sem repeti-los. O bump altera só a cópia de compilação; não publique por tag nem crie commits diretos de versão na `main`.
