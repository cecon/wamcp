import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';

import { Brain, Pencil, X } from 'lucide-react';

import { roleLabel } from '../directory/labels';
import { MemberAvatar } from './MemberAvatar';
import { Overview, Settings, Skills, Tools, type MemberDetailProps } from './MemberDetailPanels';
import { statusOf } from './format';

const TABS = ['Visão Geral', 'Habilidades', 'Memória', 'Ferramentas', 'Configurações'] as const;
type Tab = (typeof TABS)[number];

/** Detail pane of a member: overview (salary, model, usage), skills, memory, tools and settings. */
export function MemberDetail(props: MemberDetailProps) {
  const { agent, skills, onEdit, onClose } = props;
  const [tab, setTab] = useState<Tab>('Visão Geral');
  const status = statusOf(agent);
  return (
    <Box
      component="aside"
      aria-label={`Detalhes de ${agent.name}`}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        borderRadius: 3,
        bgcolor: 'var(--color-n-solid-2)',
        p: 2.5,
        border: 1,
        borderColor: 'divider',
      }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <MemberAvatar choices={agent.avatar} kind={agent.kind} seed={agent.id} size={64} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="h6" component="h2" noWrap>
            {agent.name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {[...new Set([agent.profile_name, agent.role && roleLabel(agent.role)])]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {agent.kind === 'ai' ? 'Agente de IA' : 'Humano'} · {status.label}
          </Typography>
        </Box>
        <IconButton aria-label="Editar cadastro" onClick={onEdit}>
          <Pencil size={16} />
        </IconButton>
        <IconButton aria-label="Fechar detalhes" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </Stack>
      {agent.description && (
        <Typography
          variant="body2"
          sx={{ borderRadius: 2.5, bgcolor: 'var(--color-n-alpha-2)', px: 1.5, py: 1 }}
        >
          “{agent.description}”
        </Typography>
      )}
      <Tabs
        value={tab}
        onChange={(_event, value: Tab) => setTab(value)}
        aria-label="Seções"
        variant="scrollable"
        scrollButtons="auto"
        sx={{ minHeight: 36, borderBottom: 1, borderColor: 'divider' }}
      >
        {TABS.map((t) => (
          <Tab
            key={t}
            value={t}
            label={t}
            sx={{ minHeight: 36, px: 1, py: 0.75, fontSize: 14, textTransform: 'none' }}
          />
        ))}
      </Tabs>
      <Box role="tabpanel" aria-label={tab} sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {tab === 'Visão Geral' && <Overview {...props} />}
        {tab === 'Habilidades' && <Skills agent={agent} skills={skills} />}
        {tab === 'Memória' && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 1,
              py: 3,
              textAlign: 'center',
            }}
          >
            <Box component={Brain} size={28} sx={{ color: 'var(--color-n-slate-10)' }} />
            <Typography variant="body2" color="text.secondary">
              {agent.kind === 'ai'
                ? 'A memória própria do agente (lembrar e consultar fatos de clientes e conversas) chega com o runtime agêntico. Ela vai aparecer aqui, com a opção de apagar cada item.'
                : 'Pessoas não têm memória gravada no app.'}
            </Typography>
          </Box>
        )}
        {tab === 'Ferramentas' && <Tools agent={agent} skills={skills} />}
        {tab === 'Configurações' && <Settings {...props} />}
      </Box>
    </Box>
  );
}
