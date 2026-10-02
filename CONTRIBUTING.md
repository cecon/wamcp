# Contribuir

Use Node.js 24 e Rust estável. Siga SOLID, KISS e DRY sem introduzir abstrações sem necessidade concreta.

- Mantenha arquivos com no máximo 300 linhas, sem minificar para contornar o limite.
- Domínio e aplicação não dependem de infraestrutura.
- Separe operações de leitura e envio; toda mudança de acesso precisa de teste de isolamento.
- Não use credenciais reais em testes, fixtures, imagens ou logs.
- Execute `npm run check`, `npm run test:e2e`, Rustfmt e Clippy antes de enviar PR.
- Preserve versão consistente em package.json, lockfiles, Cargo.toml e configuração Tauri.
- Ajuste documentação quando o comportamento ou a instalação mudar.
- Toda mudança entra em `main` por PR, com os checks `quality` e `windows` aprovados e a branch atualizada. Não use bypass administrativo.
- Releases são automáticas após o CI do merge na `main`; aumente a versão no PR e não publique por tag ou envio direto.
