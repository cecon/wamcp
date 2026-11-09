import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

// C3Theme
import { ActionDialog } from '@c3theme/ui';

import { http } from '../../api';
import type { Inbox } from '../../types';
import { useFetch } from '../../useFetch';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Overlay';
import { useAction } from '../useAction';
import type { AgentInstall, StoreAgent, TemplatePreview } from './types';

interface Props {
  template: StoreAgent;
  onClose: () => void;
  onInstalled: () => void;
}

function Section({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <Box>
      <Typography variant="subtitle2">{title}</Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.5, fontSize: 14, color: 'text.secondary' }}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </Box>
    </Box>
  );
}

/** What the agent will do and may use, then name, credentials and inbox; installing does it all. */
export function AgentInstallModal({ template, onClose, onInstalled }: Props) {
  const preview = useFetch<TemplatePreview>(`/store/agents/${template.id}`);
  const inboxes = useFetch<Inbox[]>('/inboxes');
  const [name, setName] = useState(template.agent_name),
    [credentials, setCredentials] = useState<Record<string, string>>({}),
    [inbox, setInbox] = useState(''),
    [result, setResult] = useState<AgentInstall | null>(null);
  const { error, busy, run } = useAction();
  const manifest = preview.data?.manifest;

  if (result) {
    return (
      <Modal title={`${result.agent.name} está pronto`} onClose={onClose}>
        <Stack spacing={2}>
          <Typography variant="body2">
            Instalado com a habilidade {result.plugin.manifest.name} v{result.plugin.manifest.version}:{' '}
            {result.granted.length} ferramenta{result.granted.length === 1 ? '' : 's'} liberada
            {result.granted.length === 1 ? '' : 's'} e {result.routines.length} rotina
            {result.routines.length === 1 ? '' : 's'} em Agendamentos.
          </Typography>
          {result.pending.length > 0 ? (
            <Box role="status" sx={{ color: 'warning.main' }}>
              <Section title="Falta você fazer" items={result.pending} />
            </Box>
          ) : (
            <Typography role="status" variant="body2" color="success.main">
              Nada pendente. Ligue o servidor da habilidade, se ainda não ligou, e mande uma mensagem de
              teste.
            </Typography>
          )}
          <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
            <Button label="Fechar" onClick={onClose} />
          </Stack>
        </Stack>
      </Modal>
    );
  }

  const tool = (full: string) => {
    const own = manifest?.tools.find((t) => `${manifest.id}.${t.name}` === full);
    return own ? `${own.description} (${full})` : full;
  };
  const routines = (manifest?.schedules || []).filter((s) => template.schedules.includes(s.name));

  const install = () => {
    if (!manifest || !name.trim()) return;
    void run(async () => {
      const installed = await http<AgentInstall>(`/store/agents/${template.id}`, 'POST', {
        name: name.trim(),
        credentials,
        inbox_id: inbox ? Number(inbox) : null,
      });
      setResult(installed);
      onInstalled();
    });
  };

  return (
    <ActionDialog
      open
      title={`Instalar o agente “${template.name}”`}
      description={template.description}
      confirmLabel="Instalar e criar o agente"
      backLabel="Cancelar"
      dirty={name !== template.agent_name || Object.values(credentials).some(Boolean)}
      loading={busy}
      error={error}
      onClose={onClose}
      onConfirm={install}
    >
      {preview.error && (
        <Typography variant="body2" color="error">
          {preview.error}
        </Typography>
      )}
      {!manifest && !preview.error && <Typography variant="body2">Lendo a habilidade…</Typography>}
      <Section title="Objetivos" items={template.goals} />
      <Section title="Pode usar" items={template.tools.map((g) => tool(g.tool))} />
      <Section
        title="Rotinas que serão criadas"
        items={routines.map((r) => `${r.name}${r.description ? ` (${r.description})` : ''}`)}
      />
      <TextField
        label="Nome do agente"
        value={name}
        onChange={(e) => setName(e.target.value)}
        size="small"
        required
        error={!name.trim()}
        helperText={name.trim() ? undefined : 'Dê um nome ao agente.'}
      />
      {(manifest?.credentials || []).map((credential) => {
        const set = preview.data?.credentials_set.includes(credential.name);
        return (
          <TextField
            key={credential.name}
            label={`Credencial ${credential.name}`}
            type="password"
            autoComplete="off"
            size="small"
            placeholder={set ? 'Já configurada; deixe em branco para manter' : ''}
            helperText={credential.help}
            value={credentials[credential.name] || ''}
            onChange={(e) => setCredentials({ ...credentials, [credential.name]: e.target.value })}
          />
        );
      })}
      <TextField
        select
        label="Caixa que ele atende"
        value={inbox}
        onChange={(e) => setInbox(e.target.value)}
        size="small"
        slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
        helperText="Opcional: você pode ligar depois em Canais."
      >
        <option value="">Nenhuma por enquanto</option>
        {(inboxes.data || []).map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
      </TextField>
    </ActionDialog>
  );
}
