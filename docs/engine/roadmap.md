# Motor agêntico: o que vem depois do MVP

1. **Gatilho pelo WhatsApp.** Uma conversa de uma caixa servida por um agente com o motor ligado vira atividade (`idempotency_key` = id da mensagem). O `llm_bots` precisa deixar de responder esse agente. Hoje o motor recebe pedidos pelo canal interno (API e tela), e uma atividade com `conversation_id` responde na conversa.
2. **Julio QA com GitHub em sandbox.** Uma tool com repositório de teste, token com escopo e expiração no cofre, e aprovação obrigatória para push.
3. **Memória avançada.** Busca por relevância (FTS5 ou vetores, se houver necessidade comprovada), resumo de sessões longas e retenção configurável por tipo.
4. **Proatividade agendada.** Agendas explícitas por agente atrás de flag, com orçamento e limite de ações por período. Hoje só existe o disparo por evento.
5. **Billing real.** Preço de referência versionado por modelo, teto mensal com alerta e fatura. A hipótese comercial (R$ 50 por humano, custo do modelo + 50% por agente, cerca de 33% de margem bruta) ainda precisa ser validada.
6. **Marketplace de skills e tools**, com origem, versão e revisão de segurança.
7. **Avatar.** O editor 2D é da sessão do painel. O 3D fica para depois.
8. **Várias empresas de verdade.** Filtrar por `account_id` também nas tabelas antigas do helpdesk e decidir entre SQLite e PostgreSQL (P1 e P5).
9. **OpenCode 2.x.** Avaliar os pacotes `@opencode/*` e escrever outro adaptador da mesma porta, se valer a pena.
10. **Erros de configuração sem retry.** Hoje "modelo não encontrado" ou chave inválida contam como tentativa e são repetidos 3 vezes. O melhor é falhar na primeira.
