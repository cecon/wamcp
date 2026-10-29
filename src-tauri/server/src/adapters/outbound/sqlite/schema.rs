//! Chatwoot parity migrations (v9 onwards), appended to the Node schema.

/// Steps after v8, in order; never edit a released step, add a new one.
pub fn steps() -> Vec<String> {
    vec![
        // v9: anexos de mensagens (arquivos em media/<sessão>/<AAAA>/<MM>/ dentro da pasta de dados)
        "CREATE TABLE attachments(id INTEGER PRIMARY KEY,
           message_id INTEGER NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
           file_type TEXT NOT NULL,mime_type TEXT NOT NULL,file_name TEXT,file_size INTEGER,duration INTEGER,
           voice INTEGER NOT NULL DEFAULT 0,path TEXT,created_at INTEGER NOT NULL);
         CREATE INDEX attachments_message ON attachments(message_id);"
            .into(),
        // v10: conversas silenciadas e menções (@agente) em notas privadas
        "ALTER TABLE conversations ADD COLUMN muted INTEGER NOT NULL DEFAULT 0;
         CREATE TABLE mentions(id INTEGER PRIMARY KEY,
           user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
           message_id INTEGER NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
           created_at INTEGER NOT NULL,UNIQUE(user_id,message_id));
         CREATE INDEX mentions_user ON mentions(user_id,conversation_id);"
            .into(),
        // v11: visualizações salvas (filtros avançados) e definições de atributos personalizados
        "CREATE TABLE custom_filters(id INTEGER PRIMARY KEY,
           user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           name TEXT NOT NULL,filter_type TEXT NOT NULL,query TEXT NOT NULL,created TEXT NOT NULL);
         CREATE INDEX custom_filters_user ON custom_filters(user_id,filter_type);
         CREATE TABLE custom_attribute_definitions(id INTEGER PRIMARY KEY,
           attribute_display_name TEXT NOT NULL,attribute_key TEXT NOT NULL,attribute_model TEXT NOT NULL,
           attribute_display_type TEXT NOT NULL,attribute_description TEXT,attribute_values TEXT NOT NULL DEFAULT '[]',
           regex_pattern TEXT,regex_cue TEXT,created TEXT NOT NULL,UNIQUE(attribute_key,attribute_model));"
            .into(),
        // v12: notas de contato e foto de perfil do WhatsApp
        "CREATE TABLE contact_notes(id INTEGER PRIMARY KEY,
           contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
           user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,content TEXT NOT NULL,created_at INTEGER NOT NULL);
         CREATE INDEX contact_notes_contact ON contact_notes(contact_id,created_at);
         ALTER TABLE contacts ADD COLUMN avatar_url TEXT;"
            .into(),
        // v13: notificações adiáveis e preferências de notificação por agente
        "ALTER TABLE notifications ADD COLUMN snoozed_until INTEGER;
         CREATE TABLE notification_settings(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
           flags TEXT NOT NULL DEFAULT '{}');"
            .into(),
        // v14: macros (sequências de ações executadas pelos agentes)
        "CREATE TABLE macros(id INTEGER PRIMARY KEY,name TEXT NOT NULL,
           visibility TEXT NOT NULL CHECK(visibility IN ('personal','global')),
           created_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
           actions TEXT NOT NULL CHECK(json_valid(actions)),created TEXT NOT NULL);"
            .into(),
        // v15: autenticação em dois fatores (TOTP) e registro de auditoria
        "ALTER TABLE users ADD COLUMN mfa_secret TEXT;
         ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0;
         ALTER TABLE users ADD COLUMN mfa_last_step INTEGER;
         ALTER TABLE users ADD COLUMN mfa_backup_codes TEXT NOT NULL DEFAULT '[]';
         CREATE TABLE mfa_challenges(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           expires_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0);
         CREATE TABLE audit_logs(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
           action TEXT NOT NULL,auditable_type TEXT NOT NULL,auditable_id INTEGER,details TEXT NOT NULL DEFAULT '{}',
           ip_address TEXT,created_at INTEGER NOT NULL);
         CREATE INDEX audit_logs_created ON audit_logs(created_at DESC);"
            .into(),
        // v16: limite de atribuições por agente e texto da pesquisa CSAT por caixa de entrada
        "ALTER TABLE inboxes ADD COLUMN max_assignment_limit INTEGER;
         ALTER TABLE inboxes ADD COLUMN csat_survey_message TEXT;"
            .into(),
        // v17: políticas de SLA e o SLA aplicado a cada conversa
        "CREATE TABLE sla_policies(id INTEGER PRIMARY KEY,name TEXT NOT NULL,description TEXT,
           first_response_time_threshold INTEGER,next_response_time_threshold INTEGER,resolution_time_threshold INTEGER,
           created TEXT NOT NULL);
         CREATE TABLE applied_slas(conversation_id INTEGER PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
           sla_policy_id INTEGER NOT NULL REFERENCES sla_policies(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,
           status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','hit','missed')),missed_at INTEGER);
         CREATE INDEX applied_slas_status ON applied_slas(status);"
            .into(),
        // v18: robôs de atendimento externos (agent bots) via webhook e token de API
        "ALTER TABLE webhooks ADD COLUMN kind TEXT NOT NULL DEFAULT 'webhook';
         CREATE TABLE agent_bots(id INTEGER PRIMARY KEY,name TEXT NOT NULL,description TEXT,
           webhook_id INTEGER NOT NULL UNIQUE REFERENCES webhooks(id) ON DELETE CASCADE,created TEXT NOT NULL);
         ALTER TABLE inboxes ADD COLUMN agent_bot_id INTEGER REFERENCES agent_bots(id) ON DELETE SET NULL;"
            .into(),
        // v19: perfis personalizados (permissões) atribuídos a agentes
        "CREATE TABLE custom_roles(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE NOCASE,description TEXT,
           permissions TEXT NOT NULL DEFAULT '[]',created TEXT NOT NULL);
         ALTER TABLE users ADD COLUMN custom_role_id INTEGER REFERENCES custom_roles(id) ON DELETE SET NULL;"
            .into(),
        // v20: catálogo de produtos (cardápio): categorias, produtos, itens, grupos de complementos,
        // opções, preços de sabor por tamanho, configurações e importações do iFood (valores em centavos)
        "CREATE TABLE menu_settings(id INTEGER PRIMARY KEY CHECK(id=1),
           pizza_pricing TEXT NOT NULL DEFAULT 'greater' CHECK(pizza_pricing IN ('greater','average')),
           notes_max_length INTEGER NOT NULL DEFAULT 140,timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo');
         INSERT INTO menu_settings(id) VALUES(1);
         CREATE TABLE menu_categories(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE NOCASE,description TEXT,
           template TEXT NOT NULL DEFAULT 'default' CHECK(template IN ('default','pizza','combo')),external_code TEXT,
           status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','unavailable')),
           position INTEGER NOT NULL DEFAULT 0,ifood_id TEXT);
         CREATE UNIQUE INDEX menu_one_pizza ON menu_categories(template) WHERE template='pizza';
         CREATE TABLE menu_products(id INTEGER PRIMARY KEY,name TEXT NOT NULL,description TEXT,external_code TEXT,
           ean TEXT,serving TEXT NOT NULL DEFAULT 'not_applicable',dietary TEXT NOT NULL DEFAULT '[]',image TEXT,
           slices INTEGER,ifood_id TEXT);
         CREATE TABLE menu_items(id INTEGER PRIMARY KEY,
           category_id INTEGER NOT NULL REFERENCES menu_categories(id) ON DELETE RESTRICT,
           kind TEXT NOT NULL DEFAULT 'default' CHECK(kind IN ('default','pizza','combo')),
           product_id INTEGER NOT NULL REFERENCES menu_products(id),price_cents INTEGER NOT NULL DEFAULT 0,
           original_price_cents INTEGER,status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','unavailable')),
           external_code TEXT,shifts TEXT NOT NULL DEFAULT '[]',position INTEGER NOT NULL DEFAULT 0,ifood_id TEXT);
         CREATE INDEX menu_items_category ON menu_items(category_id,position);
         CREATE TABLE menu_groups(id INTEGER PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN
           ('ingredients','specification','offer_unit','cutlery','size','crust','edge','topping','combo_main')),
           external_code TEXT,status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','unavailable')),
           ifood_id TEXT);
         CREATE TABLE menu_item_groups(item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
           group_id INTEGER NOT NULL REFERENCES menu_groups(id) ON DELETE RESTRICT,min INTEGER NOT NULL DEFAULT 0,
           max INTEGER NOT NULL DEFAULT 1,position INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(item_id,group_id));
         CREATE INDEX menu_item_groups_group ON menu_item_groups(group_id);
         CREATE TABLE menu_options(id INTEGER PRIMARY KEY,
           group_id INTEGER NOT NULL REFERENCES menu_groups(id) ON DELETE CASCADE,
           product_id INTEGER NOT NULL REFERENCES menu_products(id),price_cents INTEGER NOT NULL DEFAULT 0,
           original_price_cents INTEGER,status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','unavailable')),
           external_code TEXT,max_quantity INTEGER NOT NULL DEFAULT 1,fractions TEXT,
           item_id INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,position INTEGER NOT NULL DEFAULT 0,ifood_id TEXT);
         CREATE INDEX menu_options_group ON menu_options(group_id,position);
         CREATE TABLE menu_size_prices(option_id INTEGER NOT NULL REFERENCES menu_options(id) ON DELETE CASCADE,
           size_option_id INTEGER NOT NULL REFERENCES menu_options(id) ON DELETE CASCADE,
           price_cents INTEGER NOT NULL,PRIMARY KEY(option_id,size_option_id));
         CREATE TABLE menu_imports(id TEXT PRIMARY KEY,url TEXT NOT NULL,status TEXT NOT NULL,message TEXT,
           counts TEXT NOT NULL DEFAULT '{}',preview TEXT,payload TEXT,started_at INTEGER NOT NULL,finished_at INTEGER);"
            .into(),
        // v21: nome do agente na primeira linha das mensagens enviadas pelo WhatsApp
        "ALTER TABLE inboxes ADD COLUMN show_agent_name INTEGER NOT NULL DEFAULT 1;".into(),
        // v22: robôs respondidos pelo próprio servidor com uma LLM (Claude Code, Codex, OpenRouter…), sem webhook
        "ALTER TABLE agent_bots ADD COLUMN kind TEXT NOT NULL DEFAULT 'webhook' CHECK(kind IN ('webhook','llm'));
         ALTER TABLE agent_bots ADD COLUMN provider TEXT;
         ALTER TABLE agent_bots ADD COLUMN model TEXT;
         ALTER TABLE agent_bots ADD COLUMN instructions TEXT;"
            .into(),
        // v23: cadastro unificado de agentes humanos e de IA, com funções, skills e credenciais cifradas
        "CREATE TABLE agents(id INTEGER PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('human','ai')),
           role TEXT NOT NULL CHECK(role IN ('coordinator','operator','dev_support','qa')),description TEXT,
           user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,whatsapp_jid TEXT,
           runtime TEXT,model TEXT,instructions TEXT,active INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL);
         CREATE TABLE skills(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE NOCASE,description TEXT,
           instructions TEXT NOT NULL DEFAULT '',tools TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tools)),created TEXT NOT NULL);
         CREATE TABLE agent_skills(agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
           skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,PRIMARY KEY(agent_id,skill_id));
         CREATE TABLE agent_credentials(id INTEGER PRIMARY KEY,agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
           name TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('api_key','bearer','basic','secret')),secret TEXT NOT NULL,
           created TEXT NOT NULL,last_used TEXT,UNIQUE(agent_id,name));"
            .into(),
        // v24: skills padrão (atender pelo cardápio, montar e fechar pedido, transferir para a equipe)
        super::default_skills::DEFAULT_SKILLS.into(),
        // v25: todo agente (login, consultado pelo WhatsApp ou IA) tem um perfil; a função de IA vem do perfil.
        // O perfil "Padrão" reproduz o acesso de quem não tinha perfil (tudo menos relatórios).
        super::default_skills::PROFILES.into(),
        // v26: uma lista só de agentes: todo login vira uma pessoa da lista, ligada pelo user_id
        super::default_skills::ROSTER_LOGINS.into(),
        // v27: o agente de IA que atende uma caixa de entrada (pelo runtime e modelo do cadastro)
        "ALTER TABLE inboxes ADD COLUMN ai_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL;".into(),
        // v28: perfis com skills (herdadas pelos agentes) e a skill e o perfil padrão "Atendente de delivery"
        super::default_skills::PROFILE_SKILLS.into(),
        // v29: catálogo, cardápio e vendas saem do produto (tabelas, skills de venda e o perfil de delivery)
        super::default_skills::NO_CATALOG.into(),
        // v30: painel de funcionários: tokens e custo de cada chamada de LLM (o salário dos agentes de IA; tabela
        // genérica, também para o motor agêntico: run_ref liga a uma execução),
        // a quem cada agente responde na hierarquia e o avatar personalizado
        "CREATE TABLE llm_usage(id INTEGER PRIMARY KEY,agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
           agent_bot_id INTEGER,conversation_id INTEGER,run_ref TEXT,provider TEXT NOT NULL,model TEXT,
           input_tokens INTEGER NOT NULL DEFAULT 0,cached_tokens INTEGER NOT NULL DEFAULT 0,output_tokens INTEGER NOT NULL DEFAULT 0,
           cost REAL,currency TEXT NOT NULL DEFAULT 'USD',
           cost_source TEXT NOT NULL DEFAULT 'none' CHECK(cost_source IN ('reported','estimated','none')),at TEXT NOT NULL);
         CREATE INDEX llm_usage_agent ON llm_usage(agent_id,at);
         ALTER TABLE agents ADD COLUMN supervisor_id INTEGER REFERENCES agents(id) ON DELETE SET NULL;
         ALTER TABLE agents ADD COLUMN avatar TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(avatar));"
            .into(),
        // v31: o funcionário do sistema (agente de IA do próprio app) e as propostas que ele faz
        super::default_skills::SYSTEM_AGENT.into(),
        // v32: motor agêntico —
        // atividades, delegações, execuções, tools com grants, evidências, auditoria e memória, por organização
        super::engine_schema::ENGINE.into(),
        // v33: chat interno de cada pessoa logada com os agentes de IA (fora do WhatsApp e das conversas de
        // clientes); propostas do funcionário do sistema também podem nascer nesse chat
        "CREATE TABLE agent_chats(id INTEGER PRIMARY KEY,
           user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
           created_at INTEGER NOT NULL,UNIQUE(user_id,agent_id));
         CREATE TABLE agent_chat_messages(id INTEGER PRIMARY KEY,
           chat_id INTEGER NOT NULL REFERENCES agent_chats(id) ON DELETE CASCADE,
           role TEXT NOT NULL CHECK(role IN ('user','agent','error')),content TEXT NOT NULL,created_at INTEGER NOT NULL);
         CREATE INDEX agent_chat_messages_chat ON agent_chat_messages(chat_id,id);
         CREATE TABLE system_proposals_v33(id INTEGER PRIMARY KEY,
           conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
           chat_id INTEGER REFERENCES agent_chats(id) ON DELETE CASCADE,
           after_message_id INTEGER NOT NULL DEFAULT 0,
           action TEXT NOT NULL,args TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(args)),summary TEXT NOT NULL,
           status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','failed','discarded')),
           result TEXT,created_at INTEGER NOT NULL,decided_at INTEGER,
           CHECK((conversation_id IS NULL) <> (chat_id IS NULL)));
         INSERT INTO system_proposals_v33(id,conversation_id,after_message_id,action,args,summary,status,result,
           created_at,decided_at)
           SELECT id,conversation_id,after_message_id,action,args,summary,status,result,created_at,decided_at
           FROM system_proposals;
         DROP TABLE system_proposals;
         ALTER TABLE system_proposals_v33 RENAME TO system_proposals;"
            .into(),
        // v34: canal GitHub (eventos de PR, issues, Actions e pushes viram conversas); inboxes é refeita
        super::github_schema::github_channel(),
        // v35: agendamentos (crons) em que agentes de IA se inscrevem para trabalhar sozinhos, e o histórico
        // das execuções; o resultado vai para o chat do agente com quem criou o agendamento
        "CREATE TABLE agent_schedules(id INTEGER PRIMARY KEY,name TEXT NOT NULL,cron TEXT,interval_minutes INTEGER,
           timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',prompt TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,
           created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,last_run_at INTEGER,next_run_at INTEGER,
           created_at INTEGER NOT NULL,CHECK((cron IS NULL) <> (interval_minutes IS NULL)));
         CREATE INDEX agent_schedules_due ON agent_schedules(active,next_run_at);
         CREATE TABLE agent_schedule_agents(
           schedule_id INTEGER NOT NULL REFERENCES agent_schedules(id) ON DELETE CASCADE,
           agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,PRIMARY KEY(schedule_id,agent_id));
         CREATE TABLE agent_schedule_runs(id INTEGER PRIMARY KEY,
           schedule_id INTEGER NOT NULL REFERENCES agent_schedules(id) ON DELETE CASCADE,
           agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
           status TEXT NOT NULL CHECK(status IN ('running','done','failed','skipped')),
           output TEXT,error TEXT,started_at INTEGER NOT NULL,finished_at INTEGER);
         CREATE INDEX agent_schedule_runs_schedule ON agent_schedule_runs(schedule_id,id);"
            .into(),
    ]
}
