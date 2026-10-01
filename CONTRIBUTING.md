# Contribuir

Use Node.js 24 e Rust estável. Siga SOLID, KISS e DRY sem introduzir abstrações sem necessidade concreta.

- Mantenha arquivos com no máximo 300 linhas, sem minificar para contornar o limite.
- Domínio e aplicação não dependem de infraestrutura.
- Separe operações de leitura e envio; toda mudança de acesso precisa de teste de isolamento.
- Não use credenciais reais em testes, fixtures, imagens ou logs.
- Execute `npm run check`, `npm run test:e2e`, Rustfmt e Clippy antes de enviar PR.
- Preserve versão consistente em package.json, lockfiles, Cargo.toml e configuração Tauri.
- Ajuste documentação quando o comportamento ou a instalação mudar.
