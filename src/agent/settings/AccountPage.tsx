import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

// C3Theme
import { Panel, SelectField } from '@c3theme/ui';

import { http } from '../api';
import type { Account, Locale } from '../parityTypes';
import { useFetch } from '../useFetch';
import { useAction } from './useAction';
import { SalaryRatesForm } from './members/SalaryRatesForm';
import { SettingsC3Error, SettingsC3Header, SettingsC3Page } from './c3/SettingsC3';

const LOCALES: Record<Locale, string> = { 'pt-BR': 'Português (Brasil)', en: 'English', es: 'Español' };

/** Configurações → Conta no C3Theme (lote 4): formulário geral + resolução automática; salários seguem no app. */
export function AccountPage() {
  const { data, error } = useFetch<Account>('/account');
  return (
    <SettingsC3Page>
      <SettingsC3Header
        title="Configurações da conta"
        description="Nome, idioma, resolução automática de conversas inativas e os valores do salário digital desta conta."
      />
      {data ? (
        <>
          <AccountForm account={data} />
          <SalaryRatesForm account={data} />
        </>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {error || 'Carregando…'}
        </Typography>
      )}
    </SettingsC3Page>
  );
}

function AccountForm({ account }: { account: Account }) {
  const days = account.settings?.auto_resolve_duration;
  const [form, setForm] = useState({
    name: account.name,
    locale: account.locale,
    autoResolve: Boolean(days),
    days: String(days || 7),
    message: account.settings?.auto_resolve_message || '',
  });
  const [saved, setSaved] = useState(false);
  const { error, busy, run } = useAction();
  const set = (patch: Partial<typeof form>) => {
    setSaved(false);
    setForm({ ...form, ...patch });
  };

  return (
    <Panel>
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await http('/account', 'PATCH', {
              name: form.name.trim(),
              locale: form.locale,
              auto_resolve_duration: form.autoResolve ? Number(form.days) : null,
              auto_resolve_message: form.message.trim() || null,
            });
            setSaved(true);
          });
        }}
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 640 }}
      >
        <TextField
          label="Nome da conta"
          size="small"
          value={form.name}
          onChange={(event) => set({ name: event.target.value })}
          slotProps={{ htmlInput: { required: true, maxLength: 120 } }}
        />
        <SelectField
          native
          label="Idioma"
          size="small"
          value={form.locale}
          onChange={(value) => value && set({ locale: value as Locale })}
          options={Object.entries(LOCALES).map(([value, label]) => ({ value, label }))}
        />
        <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 1 }}>
          <FormControlLabel
            control={
              <Switch
                checked={form.autoResolve}
                onChange={(event) => set({ autoResolve: event.target.checked })}
              />
            }
            label="Resolver conversas inativas automaticamente"
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            Conversas abertas ou pendentes sem atividade são resolvidas após o período definido.
          </Typography>
        </Box>
        {form.autoResolve && (
          <TextField
            label="Dias de inatividade"
            size="small"
            type="number"
            value={form.days}
            onChange={(event) => set({ days: event.target.value })}
            slotProps={{ htmlInput: { min: 1, max: 999, required: true } }}
          />
        )}
        <TextField
          label="Mensagem da resolução automática"
          size="small"
          multiline
          rows={3}
          value={form.message}
          placeholder="Enviada ao contato quando a conversa é resolvida por inatividade (opcional)."
          onChange={(event) => set({ message: event.target.value })}
          slotProps={{ htmlInput: { maxLength: 1000 } }}
        />
        {error && <SettingsC3Error>{error}</SettingsC3Error>}
        {saved && (
          <Typography variant="body2" sx={{ color: 'success.main' }}>
            Configurações da conta salvas.
          </Typography>
        )}
        <Stack direction="row">
          <Button type="submit" variant="contained" disabled={busy}>
            Salvar alterações
          </Button>
        </Stack>
      </Box>
    </Panel>
  );
}
