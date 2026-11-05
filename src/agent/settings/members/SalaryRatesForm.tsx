import { useState } from 'react';

// material-ui
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { http } from '../../api';
import type { Account } from '../../parityTypes';
import { useAction } from '../useAction';

/** Defaults of the vision doc (keep in sync with `domain::salary`). */
const DEFAULTS = { seat: 50, margin: 50, rate: 5.5 };

/** "Salário digital": a person's monthly seat, the margin on AI token costs and the dollar rate. */
export function SalaryRatesForm({ account }: { account: Account }) {
  const s = account.settings || {};
  const [form, setForm] = useState({
    seat: String(s.seat_price_brl ?? DEFAULTS.seat),
    margin: String(s.ai_margin_percent ?? DEFAULTS.margin),
    rate: String(s.usd_brl_rate ?? DEFAULTS.rate),
  });
  const [saved, setSaved] = useState(false);
  const { error, busy, run } = useAction();
  const field = (key: keyof typeof form, label: string, hint: string, step: string) => (
    <TextField
      label={label}
      type="number"
      size="small"
      fullWidth
      helperText={hint}
      value={form[key]}
      onChange={(e) => {
        setSaved(false);
        setForm({ ...form, [key]: e.target.value });
      }}
      slotProps={{ htmlInput: { min: 0, step, required: true } }}
    />
  );
  return (
    <Box
      component="form"
      aria-label="Salário digital"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await http('/account', 'PATCH', {
            seat_price_brl: Number(form.seat),
            ai_margin_percent: Number(form.margin),
            usd_brl_rate: Number(form.rate),
          });
          setSaved(true);
        });
      }}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        maxWidth: 672,
        borderTop: 1,
        borderColor: 'divider',
        pt: 2,
      }}
    >
      <Box>
        <Typography variant="h5" component="h2">
          Salário digital
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Quanto cada membro custa no painel de Funcionários. O salário de um agente de IA começa o mês em
          zero e acumula o custo dos tokens das suas tarefas com a margem.
        </Typography>
      </Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        {field('seat', 'Assento por pessoa (R$/mês)', 'Cobrado de cada pessoa ativa.', '0.01')}
        {field('margin', 'Margem sobre a IA (%)', 'Somada ao custo dos tokens.', '1')}
        {field('rate', 'Cotação do dólar (R$)', 'Os runtimes informam o custo em dólar.', '0.01')}
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {saved && (
        <Typography variant="body2" sx={{ color: 'var(--color-n-teal-11)' }}>
          Valores do salário digital salvos.
        </Typography>
      )}
      <Button type="submit" variant="contained" disabled={busy} sx={{ alignSelf: 'flex-start' }}>
        Salvar valores
      </Button>
    </Box>
  );
}
