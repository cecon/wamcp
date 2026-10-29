# Motor agêntico: operação local

## O que precisa estar instalado

- **App** (`npm run tauri dev`, ou o instalador): o motor sobe junto com o servidor local, sem configuração.
- **OpenCode 1.x** para os agentes rodarem de verdade: `npm install -g opencode-ai`. Testado com a 1.18.25.
  - O app procura nesta ordem: `WAMCP_OPENCODE_BIN`, `opencode.exe` no PATH e o binário nativo dentro de `node_modules/opencode-ai/bin`.
  - Em **Configurações → Motor de agentes → Permissões**, a lista de runtimes diz se o OpenCode foi encontrado.
- **Chave do modelo** de cada agente de IA, cadastrada como credencial do agente (`OPENROUTER_API_KEY`, tipo chave de API). Ela é cifrada em repouso e chega ao OpenCode só por variável de ambiente do processo da execução.
- **Modelo do agente** no formato `provedor/modelo`, por exemplo `openrouter/openai/gpt-5`.

## Montar o fluxo Lu → Anny

1. Em **Agentes**, crie a Lu (IA, perfil "Coordenador de IA") e a Anny (IA, perfil "Operador"), com runtime OpenCode e modelo.
2. Em **Skills**, crie a skill `consultar_pagamento` e dê para a Anny (ou para o perfil dela).
3. Em **Motor de agentes → Permissões**, escolha a Anny e permita `financeiro.consultar_pagamento`. Sem isso, a chamada é negada.
4. Em **Motor de agentes → Novo pedido**, mande para a Lu: "O cliente ACME pagou?".

O financeiro é simulado e usa dados fictícios: `ACME` pagou, `Beta Ltda` está pendente, `Indisponivel` simula a ferramenta fora do ar, e qualquer outro nome dá "não encontrado".

## Variáveis

| Variável                                            | Para quê                                                    |
| --------------------------------------------------- | ----------------------------------------------------------- |
| `WAMCP_OPENCODE_BIN`                                | Caminho do executável do OpenCode, quando não está no PATH. |
| `WAMCP_ENGINE_LIVE_MODEL` / `WAMCP_ENGINE_LIVE_KEY` | Só para o teste ao vivo (abaixo).                           |

## Onde ficam as coisas

- **Banco:** tabelas `engine_*` no `wamcp.sqlite` da pasta de dados do app. Toda tabela tem `account_id`.
- **Execuções do OpenCode:** `<pasta de dados>/engine/run-<id>`, com configuração e dados isolados (`XDG_*`). A pasta é apagada no fim de cada execução. A configuração global do OpenCode do usuário nunca é carregada.
- **Auditoria:** tabela `engine_audit` e o painel de cada pedido. Segredos nunca são gravados.

## Testes

| Comando                                                                                                 | O que cobre                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:server`                                                                                   | Toda a suíte, incluindo `engine_flow`, `engine_failures`, `engine_governance`, `engine_recovery` e `engine_api`.                                                                                                                               |
| `cargo test -p wamcp-server --no-default-features --test engine_opencode_live -- --ignored --nocapture` | Teste ao vivo com o OpenCode instalado. Sem chave, confere que a execução falha de forma limpa (processo, isolamento, MCP, eventos e limpeza). Com `WAMCP_ENGINE_LIVE_MODEL` e `WAMCP_ENGINE_LIVE_KEY`, roda o fluxo Lu → Anny no modelo real. |
| `npx vitest run tests/ui/engine-page.test.tsx`                                                          | Tela do motor.                                                                                                                                                                                                                                 |

Lembre de rodar com `CARGO_TARGET_DIR` e `TEMP` no F:.

## Problemas comuns

| Sintoma                                                                  | Causa e saída                                                                                |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| "OpenCode não está instalado neste computador"                           | Instale o `opencode-ai` ou defina `WAMCP_OPENCODE_BIN`.                                      |
| "Defina o modelo do agente no formato provedor/modelo"                   | Ajuste o modelo no cadastro do agente.                                                       |
| "Model not found: …"                                                     | O provedor não tem chave. Cadastre a credencial do agente.                                   |
| Atividade `failed` com "O app reiniciou enquanto a resposta era enviada" | O app caiu no meio do envio. Confira na conversa se a resposta saiu antes de mandar de novo. |
| Atividade parada em "Aguardando aprovação"                               | Abra o pedido e aprove ou recuse a chamada pendente.                                         |
| "Orçamento mensal de tokens do agente esgotado"                          | Aumente ou remova o limite em Permissões.                                                    |
