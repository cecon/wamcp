import type { ReactNode } from 'react';

// material-ui
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { http } from '../../api';
import type { RosterAgent, Salary, SalaryRates, Skill, UsageDay } from '../../adminTypes';
import type { Inbox } from '../../types';
import { useFetch } from '../../useFetch';
import { Toggle } from '../../ui/Settings';
import { useAction } from '../useAction';
import { phone, roleLabel, runtimeLabel } from '../directory/labels';
import { AvatarEditor } from './AvatarEditor';
import { UsageChart } from './UsageChart';
import { agentBody, brl, costPerThousand, count, salaryLabel, skillIdsOf, usd } from './format';

export interface MemberDetailProps {
  agent: RosterAgent;
  roster: RosterAgent[];
  skills: Skill[];
  salary: Salary | undefined;
  rates: SalaryRates | undefined;
  inboxes: Inbox[];
  onEdit: () => void;
  onClose: () => void;
  onChanged: () => void;
}

const SELECT_SX = {
  height: 36,
  borderRadius: 1,
  border: 1,
  borderColor: 'divider',
  bgcolor: 'background.paper',
  color: 'text.primary',
  px: 1,
} as const;

export const DetailCard = ({ title, children }: { title: string; children: ReactNode }) => (
  <Box
    component="section"
    aria-label={title}
    sx={{ borderRadius: 2.5, bgcolor: 'var(--color-n-alpha-2)', p: 2 }}
  >
    <Typography
      variant="overline"
      component="h3"
      sx={{ display: 'block', mb: 1, color: 'var(--color-n-slate-11)' }}
    >
      {title}
    </Typography>
    {children}
  </Box>
);

/** Overview tab: salary, model, token usage of the last 30 days and the inboxes the agent serves. */
export function Overview({ agent, salary, rates, inboxes }: MemberDetailProps) {
  const { data: usage } = useFetch<UsageDay[]>(
    agent.kind === 'ai' ? `/agent_directory/${agent.id}/usage?days=30` : null,
  );
  const perThousand = costPerThousand(salary);
  const serves = inboxes.filter((i) => i.ai_agent_id === agent.id);
  return (
    <>
      <DetailCard title="Salário digital">
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          {salaryLabel(agent, salary)}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          {agent.kind === 'ai'
            ? `Começa o mês em R$ 0 e acumula o custo dos tokens de cada tarefa${
                rates ? ` com ${rates.ai_margin_percent}% de margem (US$ 1 = ${brl(rates.usd_brl_rate)})` : ''
              }.`
            : agent.active
              ? 'Assento fixo por pessoa ativa.'
              : 'Pessoas inativas não ocupam assento.'}
        </Typography>
        {salary && salary.unpriced_calls > 0 && (
          <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'var(--color-n-amber-11)' }}>
            {salary.unpriced_calls} chamada(s) sem custo informado pelo runtime não entram no salário.
          </Typography>
        )}
      </DetailCard>
      {agent.kind === 'ai' && (
        <>
          <DetailCard title="Modelo">
            <Typography variant="body2">
              {runtimeLabel(agent.runtime)}
              {agent.model ? ` · ${agent.model}` : ' · modelo padrão'}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {perThousand === null
                ? 'Custo por 1 mil tokens: aparece depois da primeira tarefa com custo informado.'
                : `Custo por 1 mil tokens neste mês: ${brl(perThousand)} (com a margem).`}
            </Typography>
          </DetailCard>
          <DetailCard title="Uso de tokens (30 dias)">
            <Stack direction="row" spacing={2} sx={{ mb: 1 }}>
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  Entrada no mês
                </Typography>
                <Typography variant="body2">{count(salary?.input_tokens ?? 0)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  Saída no mês
                </Typography>
                <Typography variant="body2">{count(salary?.output_tokens ?? 0)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  Custo bruto
                </Typography>
                <Typography variant="body2">{usd(salary?.cost_usd ?? 0)}</Typography>
              </Box>
            </Stack>
            <UsageChart usage={usage || []} />
          </DetailCard>
          <DetailCard title="Atende">
            {serves.length ? (
              <Box component="ul" sx={{ m: 0, pl: 2.5, color: 'var(--color-n-slate-12)' }}>
                {serves.map((i) => (
                  <Typography key={i.id} component="li" variant="body2">
                    {i.name}
                  </Typography>
                ))}
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Nenhuma caixa de entrada.
              </Typography>
            )}
          </DetailCard>
        </>
      )}
      {agent.kind === 'human' && (
        <DetailCard title="Contato">
          <Typography variant="body2">
            {[agent.user_email, phone(agent.whatsapp_jid)].filter(Boolean).join(' · ') || '—'}
          </Typography>
        </DetailCard>
      )}
    </>
  );
}

/** Skills tab: the agent's own skills plus the ones inherited from its profile. */
export function Skills({ agent, skills }: { agent: RosterAgent; skills: Skill[] }) {
  const ids = skillIdsOf(agent);
  if (!ids.length)
    return (
      <Typography variant="body2" color="text.secondary">
        Nenhuma skill.
      </Typography>
    );
  const inherited = new Set(agent.profile_skill_ids || []);
  return (
    <Box
      component="ul"
      sx={{ display: 'flex', flexDirection: 'column', gap: 1, m: 0, p: 0, listStyle: 'none' }}
    >
      {ids.map((id) => {
        const skill = skills.find((s) => s.id === id);
        if (!skill) return null;
        return (
          <Box
            key={id}
            component="li"
            sx={{ borderRadius: 2, bgcolor: 'var(--color-n-alpha-2)', px: 1.5, py: 1 }}
          >
            <Typography component="span" variant="body2" sx={{ fontWeight: 500 }}>
              {skill.name}
            </Typography>
            {inherited.has(id) && (
              <Box
                component="span"
                sx={{
                  ml: 1,
                  borderRadius: 0.5,
                  bgcolor: 'var(--color-n-slate-4)',
                  px: 0.5,
                  fontSize: 12,
                  color: 'var(--color-n-slate-11)',
                }}
              >
                do perfil
              </Box>
            )}
            {skill.description && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {skill.description}
              </Typography>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

/** Tools tab: the MCP tools released by the agent's skills and its server-side credentials. */
export function Tools({ agent, skills }: { agent: RosterAgent; skills: Skill[] }) {
  const owned = skillIdsOf(agent)
    .map((id) => skills.find((s) => s.id === id))
    .filter((s): s is Skill => Boolean(s));
  const tools = [...new Set(owned.flatMap((s) => s.tools))].sort();
  return (
    <>
      {tools.length ? (
        <Box
          component="ul"
          sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, m: 0, p: 0, listStyle: 'none' }}
        >
          {tools.map((tool) => (
            <Box
              key={tool}
              component="li"
              sx={{
                borderRadius: 1,
                bgcolor: 'var(--color-n-alpha-2)',
                px: 1,
                py: 0.25,
                fontFamily: 'monospace',
                fontSize: 12,
                color: 'var(--color-n-slate-12)',
              }}
            >
              {tool}
            </Box>
          ))}
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary">
          As skills deste agente não liberam ferramentas.
        </Typography>
      )}
      {agent.kind === 'ai' && (
        <Typography variant="caption" color="text.secondary">
          {agent.credential_count
            ? `${agent.credential_count} credencial(is) usada(s) pelas ferramentas no servidor; edite o cadastro para gerenciá-las.`
            : 'Sem credenciais.'}
        </Typography>
      )}
    </>
  );
}

/** Settings tab: who the agent answers to, the active switch and the avatar customization. */
export function Settings({ agent, roster, onChanged }: MemberDetailProps) {
  const { error, busy, run } = useAction();
  const save = (changes: Partial<RosterAgent>) =>
    run(async () => {
      await http(`/agent_directory/${agent.id}`, 'PUT', agentBody(agent, changes));
      onChanged();
    });
  return (
    <>
      <Box component="label" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography component="span" variant="body2">
          Responde a
        </Typography>
        <Box
          component="select"
          disabled={busy}
          value={agent.supervisor_id ? String(agent.supervisor_id) : ''}
          onChange={(e) => void save({ supervisor_id: e.target.value ? Number(e.target.value) : null })}
          sx={SELECT_SX}
        >
          <option value="">Ninguém (topo da organização)</option>
          {roster
            .filter((a) => a.id !== agent.id)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.role ? ` — ${roleLabel(a.role)}` : ''}
              </option>
            ))}
        </Box>
      </Box>
      <Toggle
        label="Ativo"
        hint={
          agent.kind === 'ai'
            ? 'Inativo, o agente não atende nem recebe tarefas.'
            : 'Inativa, a pessoa não ocupa assento.'
        }
        checked={agent.active}
        onChange={(active) => void save({ active })}
      />
      {error && <Alert severity="error">{error}</Alert>}
      <AvatarEditor key={agent.id} agent={agent} onSaved={onChanged} />
    </>
  );
}
