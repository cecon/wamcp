//! Seed data: default skills (v24), mandatory profiles (v25), logins in the agent list (v26) and
//! profile skills with the default delivery attendant (v28).
//! Skills only use MCP tools that exist today; a skill with the same name is kept, and a deleted
//! default skill does not come back.

/// `INSERT OR IGNORE` of the default skills (no single quotes inside the texts).
pub const DEFAULT_SKILLS: &str = r#"INSERT OR IGNORE INTO skills(name,description,instructions,tools,created) VALUES
('Atender pelo cardápio',
 'Busca itens no cardápio e apresenta ao cliente com preço, opções e foto.',
 '# Atender pelo cardápio

Use quando o cliente perguntar o que tem, quanto custa ou pedir um item.

1. Leia a conversa com get_conversation para entender o pedido.
2. Busque com catalog_search pelo nome, por um termo da descrição ou pelo código PDV. Ela só traz itens disponíveis agora.
3. Para cada item que interessa, abra catalog_item: veja os grupos de complementos (mínimo e máximo), os tamanhos e os sabores de pizza com preço por tamanho.
4. Apresente no máximo 3 a 5 opções por mensagem, com nome, preço em reais e o que precisa ser escolhido. Não invente itens, preços nem promoções.
5. Quando o cliente quiser ver um item, envie a foto, a descrição e o preço com catalog_send_item (conversa e item_id).
6. Se nada for encontrado, diga isso e sugira itens parecidos que a busca trouxe; nunca prometa um item fora do cardápio.',
 '["get_conversation","catalog_search","catalog_item","catalog_send_item","reply_conversation"]',
 strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('Montar e fechar pedido',
 'Confirma escolhas, calcula o total com as regras do cardápio e resume o pedido.',
 '# Montar e fechar pedido

Use depois que o cliente escolheu o que quer.

1. Confira os complementos obrigatórios do item com catalog_item e pergunte ao cliente o que faltar (tamanho, sabores, borda, acompanhamentos).
2. Calcule cada item com catalog_quote: item_id, quantidade e as escolhas por option_id; em combos, as escolhas aninhadas do item escolhido. Observações vão em notes.
3. Se catalog_quote apontar problemas (opção obrigatória faltando, máximo excedido, item indisponível), explique ao cliente e corrija antes de seguir.
4. Responda com o resumo: cada item com escolhas, quantidade e valor, e o total. Use somente os valores calculados por catalog_quote.
5. Peça a confirmação do cliente. Endereço, pagamento e prazo de entrega ficam com a equipe: depois da confirmação, marque a conversa com a etiqueta do pedido, se existir, e transfira para um humano.',
 '["get_conversation","catalog_item","catalog_quote","reply_conversation","set_conversation_labels"]',
 strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('Transferir para a equipe',
 'Passa a conversa para um humano quando o agente não deve ou não consegue resolver.',
 '# Transferir para a equipe

Transfira quando houver reclamação, pagamento, troca ou cancelamento, pedido de falar com uma pessoa, ou qualquer dúvida que as instruções e o cardápio não respondem.

1. Avise o cliente com uma frase curta que uma pessoa da equipe vai continuar o atendimento.
2. Se souber o time ou a pessoa certa, use assign_conversation.
3. Mude a conversa para aberta com set_conversation_status (status open). A partir daí não responda mais nessa conversa.',
 '["get_conversation","reply_conversation","assign_conversation","set_conversation_status"]',
 strftime('%Y-%m-%dT%H:%M:%fZ','now'));"#;

/// Profiles (`custom_roles`) become mandatory and carry the AI role (migration v25). "Padrão" has the
/// access agents had without a profile; one profile per AI role is created for the AI agents.
pub const PROFILES: &str = r#"ALTER TABLE custom_roles ADD COLUMN agent_role TEXT
   CHECK(agent_role IN ('coordinator','operator','dev_support','qa'));
ALTER TABLE custom_roles ADD COLUMN builtin INTEGER NOT NULL DEFAULT 0;
INSERT INTO custom_roles(name,description,permissions,builtin,created)
  SELECT CASE WHEN EXISTS(SELECT 1 FROM custom_roles WHERE name='Padrão') THEN 'Padrão do sistema' ELSE 'Padrão' END,
   'Acesso padrão: conversas e contatos das suas caixas de entrada, sem relatórios.',
   '["conversation_manage","conversation_unassigned_manage","conversation_participating_manage","contact_manage"]',
   1, strftime('%Y-%m-%dT%H:%M:%fZ','now');
UPDATE users SET custom_role_id=(SELECT id FROM custom_roles WHERE builtin=1) WHERE custom_role_id IS NULL;
INSERT OR IGNORE INTO custom_roles(name,description,permissions,agent_role,created) VALUES
 ('Coordenador de IA','Agente de IA que nunca executa: só delega para operadores.','["conversation_manage","contact_manage"]','coordinator',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('Operador','Executa tarefas com as suas skills.','["conversation_manage","contact_manage"]','operator',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('Suporte dev','Operador especializado em problemas técnicos.','["conversation_manage","contact_manage"]','dev_support',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('QA','Revisa o trabalho dos operadores.','["conversation_manage","contact_manage"]','qa',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
ALTER TABLE agents ADD COLUMN profile_id INTEGER REFERENCES custom_roles(id);
UPDATE agents SET profile_id=(SELECT r.id FROM custom_roles r WHERE r.agent_role=agents.role ORDER BY r.id LIMIT 1);
UPDATE agents SET profile_id=(SELECT id FROM custom_roles WHERE builtin=1) WHERE profile_id IS NULL;"#;

/// One list of agents (migration v26): every login becomes a person in the roster, linked by
/// `user_id` (one roster row per login at most).
pub const ROSTER_LOGINS: &str = r#"UPDATE agents SET user_id=NULL WHERE user_id IS NOT NULL
  AND id NOT IN (SELECT MIN(id) FROM agents WHERE user_id IS NOT NULL GROUP BY user_id);
INSERT INTO agents(name,kind,role,profile_id,user_id,active,created)
  SELECT u.name,'human','operator',u.custom_role_id,u.id,u.active,strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM users u WHERE NOT EXISTS(SELECT 1 FROM agents a WHERE a.user_id=u.id);
CREATE UNIQUE INDEX agents_user ON agents(user_id) WHERE user_id IS NOT NULL;"#;

/// Profiles carry skills that every agent of the profile inherits (migration v28), plus the default
/// "Atendente de delivery" skill and a profile of the same name that comes with it.
pub const PROFILE_SKILLS: &str = r#"CREATE TABLE custom_role_skills(
   role_id INTEGER NOT NULL REFERENCES custom_roles(id) ON DELETE CASCADE,
   skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,PRIMARY KEY(role_id,skill_id));
INSERT OR IGNORE INTO skills(name,description,instructions,tools,created) VALUES
('Atendente de delivery',
 'Atende o cliente do delivery do início ao fim: cardápio, montagem do pedido e fechamento da venda.',
 '# Atendente de delivery

Você atende os clientes do delivery pelo WhatsApp, como uma pessoa da equipe: mensagens curtas, cordiais e em português do Brasil.

## Atender
1. Leia a conversa com get_conversation (e get_messages, se precisar de mais histórico) antes de responder.
2. Cumprimente na primeira mensagem e pergunte o que o cliente deseja. Responda com reply_conversation.

## Consultar e apresentar o cardápio
3. Busque com catalog_search pelo nome, por um termo da descrição ou pelo código PDV. Ela só traz itens disponíveis agora.
4. Abra os itens com catalog_item para ver complementos (mínimo e máximo), tamanhos e sabores de pizza com o preço por tamanho.
5. Apresente de 3 a 5 opções por mensagem, com nome, preço em reais e o que precisa ser escolhido. Para mostrar um item, envie foto, descrição e preço com catalog_send_item.
6. Nunca invente itens, preços, promoções ou prazos. Se não encontrar, diga isso e sugira itens parecidos da busca.

## Montar o pedido
7. Para cada item, pergunte o que faltar dos complementos obrigatórios (tamanho, sabores, borda, acompanhamentos) e anote as observações.
8. Calcule cada item com catalog_quote (item_id, quantidade, escolhas por option_id e notes). Se ele apontar problemas, explique ao cliente e corrija.
9. Ofereça uma bebida ou sobremesa uma única vez, sem insistir.

## Fechar a venda
10. Envie o resumo: cada item com escolhas, quantidade e valor, e o total. Use somente os valores calculados por catalog_quote.
11. Peça o endereço de entrega (rua, número, bairro e referência), a forma de pagamento (Pix, cartão na entrega ou dinheiro, e o troco) e o nome de quem recebe.
12. Peça a confirmação final do cliente. Confirmado, agradeça, marque a conversa com a etiqueta do pedido (set_conversation_labels), se existir, e passe para a equipe preparar e entregar: assign_conversation, se souber o time, e set_conversation_status com status open.

## Transferir para a equipe
13. Transfira na hora em reclamação, problema com pagamento, troca ou cancelamento, pedido para falar com uma pessoa ou dúvida que o cardápio e as instruções não respondem. Avise o cliente em uma frase e mude o status para open. Depois disso, não responda mais nessa conversa.',
 '["get_conversation","get_messages","reply_conversation","catalog_search","catalog_item","catalog_send_item","catalog_quote","set_conversation_labels","assign_conversation","set_conversation_status"]',
 strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT OR IGNORE INTO custom_roles(name,description,permissions,agent_role,created) VALUES
 ('Atendente de delivery','Atende os clientes do delivery: cardápio, pedido e fechamento da venda.',
  '["conversation_manage","contact_manage"]','operator',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT OR IGNORE INTO custom_role_skills(role_id,skill_id)
  SELECT r.id,s.id FROM custom_roles r JOIN skills s ON s.name='Atendente de delivery'
  WHERE r.name='Atendente de delivery' AND r.agent_role='operator';"#;
