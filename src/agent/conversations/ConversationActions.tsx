import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import { Plus, X } from 'lucide-react';

import { http } from '../api';
import type { Catalog, Conversation, User } from '../types';
import { PRIORITY_LABEL } from '../labels';
import { useFetch } from '../useFetch';

interface Props {
  conversation: Conversation;
  user: User;
  catalog: Catalog;
  onChange: (conversation: Conversation) => void;
  onError: (message: string) => void;
}

const fieldSx = {
  height: 32,
  width: '100%',
  borderRadius: 1,
  border: 1,
  borderColor: 'divider',
  bgcolor: 'background.paper',
  px: 1,
  fontSize: 14,
  color: 'text.primary',
};

/** Ações da conversa no C3Theme (lote 24): agente (+ “Atribuir a mim”), time, prioridade e etiquetas. */
export function ConversationActions({ conversation: c, user, catalog, onChange, onError }: Props) {
  const [adding, setAdding] = useState(false);
  const path = `/conversations/${c.display_id}`;
  const run = (request: Promise<Conversation>) =>
    request.then(onChange).catch((e: Error) => onError(e.message));
  const agents = catalog.agents.filter(
    (a) => a.active && (a.role === 'administrator' || a.inbox_ids?.includes(c.inbox_id)),
  );
  // O agente de IA é da caixa, não um “agente atribuído” humano: mostramos quem está atendendo
  // automaticamente enquanto ninguém assume a conversa.
  const aiAgentId = catalog.inboxes.find((inbox) => inbox.id === c.inbox_id)?.ai_agent_id ?? null;
  const directory = useFetch<{ id: number; name: string }[]>(aiAgentId ? '/agent_directory' : null);
  const aiAgent = aiAgentId ? directory.data?.find((agent) => agent.id === aiAgentId) : undefined;
  const available = catalog.labels.filter((l) => !c.labels.includes(l.title));
  const setLabels = (labels: string[]) => run(http(`${path}/labels`, 'POST', { labels }));
  const color = (title: string) => catalog.labels.find((l) => l.title === title)?.color || '#8B8D98';

  return (
    <Stack spacing={2}>
      <Box>
        <Stack direction="row" sx={{ mb: 0.5, alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="body2">
            <Box component="span" id="assignee-label">
              Agente atribuído
            </Box>
          </Typography>
          {c.assignee_id !== user.id && (
            <Button
              size="small"
              variant="text"
              onClick={() => void run(http(`${path}/assignments`, 'POST', { assignee_id: user.id }))}
              sx={{ fontSize: 12, textTransform: 'none' }}
            >
              Atribuir a mim
            </Button>
          )}
        </Stack>
        <Box
          component="select"
          aria-labelledby="assignee-label"
          value={c.assignee_id ?? ''}
          onChange={(e) =>
            void run(
              http(`${path}/assignments`, 'POST', {
                assignee_id: e.target.value ? Number(e.target.value) : null,
              }),
            )
          }
          sx={fieldSx}
        >
          <option value="">Nenhum</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.availability === 'online' ? '' : a.availability === 'busy' ? ' · ocupado' : ' · offline'}
            </option>
          ))}
        </Box>
        {!c.assignee_id && (c.assignee_agent_name || aiAgent) && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            Responsável: <strong>{c.assignee_agent_name ?? aiAgent?.name}</strong> (IA) — responde até um humano
            assumir; se não resolver, passa automaticamente para uma pessoa.
          </Typography>
        )}
      </Box>
      <Box>
        <Typography component="label" variant="body2" sx={{ display: 'block', mb: 0.5 }}>
          Time atribuído
        </Typography>
        <Box
          component="select"
          aria-label="Time atribuído"
          value={c.team_id ?? ''}
          onChange={(e) =>
            void run(
              http(`${path}/assignments`, 'POST', {
                team_id: e.target.value ? Number(e.target.value) : null,
              }),
            )
          }
          sx={fieldSx}
        >
          <option value="">Nenhum</option>
          {catalog.teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Box>
      </Box>
      <Box>
        <Typography component="label" variant="body2" sx={{ display: 'block', mb: 0.5 }}>
          Prioridade
        </Typography>
        <Box
          component="select"
          aria-label="Prioridade"
          value={c.priority ?? ''}
          onChange={(e) =>
            void run(http(`${path}/toggle_priority`, 'POST', { priority: e.target.value || null }))
          }
          sx={fieldSx}
        >
          <option value="">Nenhuma</option>
          {Object.entries(PRIORITY_LABEL).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </Box>
      </Box>
      <Box>
        <Typography variant="body2" sx={{ display: 'block', mb: 1 }}>
          Etiquetas da conversa
        </Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <Button
            size="small"
            variant="outlined"
            data-shortcut="labels"
            startIcon={<Plus size={12} />}
            onClick={() => setAdding(true)}
            sx={{ borderRadius: 1, borderStyle: 'dashed', textTransform: 'none', fontSize: 12, height: 24 }}
          >
            Adicionar etiquetas
          </Button>
          {adding && (
            <Box
              sx={{
                width: '100%',
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                maxHeight: 240,
                overflowY: 'auto',
              }}
              role="menu"
            >
              {available.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
                  Nenhuma etiqueta disponível.
                </Typography>
              ) : (
                available.map((l) => (
                  <Button
                    key={l.id}
                    role="menuitem"
                    fullWidth
                    onClick={() => {
                      setAdding(false);
                      void setLabels([...c.labels, l.title]);
                    }}
                    sx={{ justifyContent: 'flex-start', gap: 1, textTransform: 'none' }}
                  >
                    <Box sx={{ width: 8, height: 8, borderRadius: 0.25, bgcolor: l.color }} />
                    {l.title}
                  </Button>
                ))
              )}
            </Box>
          )}
          {c.labels.map((title) => (
            <Stack
              key={title}
              direction="row"
              spacing={0.75}
              sx={{
                height: 24,
                alignItems: 'center',
                borderRadius: 1,
                bgcolor: 'action.hover',
                border: 1,
                borderColor: 'divider',
                pl: 1,
                pr: 0.25,
              }}
            >
              <Box sx={{ width: 8, height: 8, borderRadius: 0.25, bgcolor: color(title) }} />
              <Typography variant="caption">{title}</Typography>
              <IconButton
                size="small"
                aria-label={`Remover ${title}`}
                onClick={() => void setLabels(c.labels.filter((l) => l !== title))}
                sx={{ p: 0.25 }}
              >
                <X size={12} />
              </IconButton>
            </Stack>
          ))}
        </Stack>
      </Box>
    </Stack>
  );
}
