//! Vigia das conversas paradas com a IA: de tempos em tempos procura conversas cujo responsável é o
//! agente da caixa e cuja última mensagem é do contato sem resposta, pede ao agente que decida de
//! novo e, depois de algumas tentativas, força o handoff para um humano (regra: se não resolve, passa).
use super::helpdesk::HelpdeskService;
use super::llm_bots::LlmBotService;
use crate::domain::actor::Actor;
use crate::domain::error::Result;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::time::Duration;
use tokio::task::JoinHandle;

/// Sem resposta por este tempo, o vigia chama a IA de novo.
const STALE_SECS: i64 = 180;
/// Tentativas antes de obrigar o handoff.
const MAX_ATTEMPTS: u8 = 3;
const LIMIT: i64 = 50;

pub struct AiWatchdog {
    helpdesk: HelpdeskService,
    bots: LlmBotService,
    attempts: Mutex<HashMap<i64, u8>>,
}

impl AiWatchdog {
    pub fn new(helpdesk: HelpdeskService, bots: LlmBotService) -> Self {
        Self {
            helpdesk,
            bots,
            attempts: Mutex::new(HashMap::new()),
        }
    }

    /// Uma rodada: reinvoca a IA nas conversas paradas e passa a um humano as que já esgotaram as tentativas.
    pub fn tick(&self) -> Result<usize> {
        let stale_before = self.helpdesk.core.now() - STALE_SECS;
        let ids = self.helpdesk.core.repo.stalled_ai_conversations(stale_before, LIMIT)?;
        let mut attempts = self.attempts.lock();
        attempts.retain(|id, _| ids.contains(id));
        for id in &ids {
            let tries = attempts.entry(*id).or_insert(0);
            if *tries >= MAX_ATTEMPTS {
                match self.handoff(*id) {
                    Ok(()) => {
                        attempts.remove(id);
                    }
                    Err(error) => {
                        tracing::warn!(%error, conversation = %id, "vigia da IA não conseguiu passar a um humano")
                    }
                }
            } else {
                *tries += 1;
                self.bots.nudge(*id);
            }
        }
        Ok(ids.len())
    }

    fn handoff(&self, conversation_id: i64) -> Result<()> {
        let Some(conversation) = self.helpdesk.core.repo.conversation_by_id(conversation_id)? else {
            return Ok(());
        };
        let actor = Actor::Bot {
            inbox_id: conversation.inbox_id,
        };
        self.helpdesk
            .handoff_to_human(&actor, &conversation, "a IA não respondeu depois de 3 tentativas")?;
        Ok(())
    }

    /// Sobe o job quando há um serviço de IA configurado.
    pub fn spawn_optional(helpdesk: HelpdeskService, bots: Option<LlmBotService>) -> Vec<JoinHandle<()>> {
        bots.map(|bots| AiWatchdog::new(helpdesk, bots).spawn())
            .into_iter()
            .collect()
    }

    /// Job periódico: a primeira rodada é depois de um minuto, depois a cada minuto.
    pub fn spawn(self) -> JoinHandle<()> {
        tokio::spawn(async move {
            let start = tokio::time::Instant::now() + Duration::from_secs(60);
            let mut ticker = tokio::time::interval_at(start, Duration::from_secs(60));
            loop {
                ticker.tick().await;
                let _ = self.tick();
            }
        })
    }
}
