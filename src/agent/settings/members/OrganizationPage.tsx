// material-ui
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { ArrowRight, Inbox as InboxIcon, TriangleAlert } from 'lucide-react';

import type { RosterAgent } from '../../adminTypes';
import type { Catalog } from '../../types';
import { useFetch } from '../../useFetch';
import { SettingsC3Error, SettingsC3Header, SettingsC3Page } from '../c3/SettingsC3';
import { Branch } from './OrganizationBranch';
import { buildTree, warnings } from './tree';

interface Props {
  catalog: Catalog;
}

/**
 * "Organização": the hierarchy of people and AI agents (who answers to whom), which directs the
 * agentic flow: a coordinator delegates to the members below it, and each inbox goes to its AI agent.
 */
export function OrganizationPage({ catalog }: Props) {
  const { data, error, loading, reload } = useFetch<RosterAgent[]>('/agent_directory');
  const roster = data || [];
  const below = buildTree(roster);
  const notes = warnings(roster);
  const byId = (id: number | null | undefined) => roster.find((a) => a.id === id);
  const chain = (agent: RosterAgent) => {
    const bosses: RosterAgent[] = [];
    let boss = byId(agent.supervisor_id);
    while (boss && !bosses.includes(boss) && boss.id !== agent.id) {
      bosses.push(boss);
      boss = byId(boss.supervisor_id);
    }
    return bosses;
  };

  return (
    <SettingsC3Page>
      <SettingsC3Header
        title="Organização"
        description="Quem responde a quem. A hierarquia dirige o fluxo agêntico: o coordenador delega para quem está abaixo dele e pergunta às pessoas; os operadores executam. Cada caixa de entrada vai para o agente de IA que a atende."
        count={`${roster.length} membro${roster.length === 1 ? '' : 's'}`}
      />
      {error && <SettingsC3Error>{error}</SettingsC3Error>}
      <Box
        component="section"
        aria-label="Fluxo das conversas"
        sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
      >
        <Typography variant="h6" component="h2">
          Fluxo das conversas
        </Typography>
        {catalog.inboxes.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Nenhuma caixa de entrada: conecte um WhatsApp para criar uma.
          </Typography>
        )}
        <Box
          component="ul"
          sx={{ display: 'flex', flexDirection: 'column', gap: 1, m: 0, p: 0, listStyle: 'none' }}
        >
          {catalog.inboxes.map((inbox) => {
            const agent = byId(inbox.ai_agent_id);
            return (
              <Stack
                key={inbox.id}
                component="li"
                direction="row"
                spacing={1}
                sx={{
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  borderRadius: 2,
                  bgcolor: 'var(--color-n-alpha-2)',
                  px: 1.5,
                  py: 1,
                  fontSize: 14,
                  color: 'var(--color-n-slate-12)',
                }}
              >
                <Box component={InboxIcon} size={14} sx={{ color: 'var(--color-n-slate-10)' }} />
                {inbox.name}
                <Box component={ArrowRight} size={14} sx={{ color: 'var(--color-n-slate-10)' }} />
                {agent ? (
                  <>
                    <Typography component="span" variant="body2" sx={{ fontWeight: 500 }}>
                      {agent.name}
                    </Typography>
                    {chain(agent).map((boss) => (
                      <Box
                        key={boss.id}
                        component="span"
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 1,
                          color: 'var(--color-n-slate-11)',
                        }}
                      >
                        <Box component={ArrowRight} size={14} sx={{ color: 'var(--color-n-slate-10)' }} />
                        escala para {boss.name}
                      </Box>
                    ))}
                  </>
                ) : (
                  <Typography component="span" variant="body2" color="text.secondary">
                    equipe humana (sem agente de IA)
                  </Typography>
                )}
              </Stack>
            );
          })}
        </Box>
      </Box>
      {notes.length > 0 && (
        <Box
          component="section"
          aria-label="Pontos de atenção"
          sx={{ borderRadius: 2, bgcolor: 'var(--color-n-amber-3)', px: 1.5, py: 1 }}
        >
          {notes.map((note) => (
            <Typography
              key={note}
              component="p"
              variant="body2"
              sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, color: 'var(--color-n-amber-12)' }}
            >
              <Box component={TriangleAlert} size={14} sx={{ mt: 0.25, flexShrink: 0 }} />
              {note}
            </Typography>
          ))}
        </Box>
      )}
      <Box
        component="section"
        aria-label="Hierarquia"
        sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
      >
        <Typography variant="h6" component="h2">
          Hierarquia
        </Typography>
        {loading && !data ? (
          <Typography variant="body2" color="text.secondary">
            Carregando…
          </Typography>
        ) : roster.length === 0 ? (
          <Typography variant="body1" sx={{ py: 5, textAlign: 'center' }}>
            Nenhum membro.
          </Typography>
        ) : (
          <Branch
            nodes={below(null)}
            below={below}
            roster={roster}
            inboxes={catalog.inboxes}
            onChanged={reload}
          />
        )}
      </Box>
    </SettingsC3Page>
  );
}
