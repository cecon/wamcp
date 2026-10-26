//! Skills every account starts with (migration v24). They only use MCP tools that exist today; a
//! skill with the same name is kept, and a deleted default skill does not come back.

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
