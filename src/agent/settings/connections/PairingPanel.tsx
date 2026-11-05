import { useState } from 'react';

// material-ui
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { LogOut, MessageCircle, RefreshCw, Unplug } from 'lucide-react';

import { http } from '../../api';
import { ConfirmModal } from '../../ui/Confirm';
import { QrCode } from '../../profile/qr/QrCode';
import { useAction } from '../useAction';
import { ACTIVE, sessionPath, type ConnectionDetail } from './model';

interface Props {
  detail: ConnectionDetail;
  onRefresh: () => Promise<void>;
}

/** The backend sends the QR Code as an image data URL; raw QR text is encoded in the browser. */
function Qr({ value }: { value: string }) {
  const label = 'QR Code para conectar o WhatsApp';
  return value.startsWith('data:image/') ? (
    <Box
      component="img"
      src={value}
      alt={label}
      width={224}
      height={224}
      sx={{ borderRadius: 2, bgcolor: '#fff' }}
    />
  ) : (
    <QrCode value={value} size={224} label={label} />
  );
}

function Placeholder({ status }: { status: string }) {
  const connected = status === 'connected';
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1,
        px: 2,
        py: 5,
        textAlign: 'center',
      }}
    >
      <Box
        component={MessageCircle}
        size={48}
        sx={{ color: connected ? 'var(--color-n-teal-10)' : 'var(--color-n-slate-9)' }}
      />
      <Typography component="p" variant="h6">
        {connected
          ? 'Tudo conectado'
          : status === 'connecting' || status === 'qr'
            ? 'Preparando o QR Code…'
            : 'Pronto para conectar'}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 320 }}>
        {connected
          ? 'As mensagens chegam na caixa de entrada e a conexão está disponível para o MCP.'
          : 'Clique em Conectar WhatsApp para gerar o QR Code.'}
      </Typography>
    </Box>
  );
}

/** Conexão tab: instructions, connect / disconnect / "Desconectar e sair" and the QR Code. */
export function PairingPanel({ detail, onRefresh }: Props) {
  const { error, busy, run } = useAction();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const action = (name: 'connect' | 'disconnect' | 'logout') =>
    http(`${sessionPath(detail.id)}/${name}`, 'POST').then(onRefresh);
  const active = ACTIVE.includes(detail.status);
  return (
    <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { md: '1fr auto' } }}>
      <Box sx={{ display: 'flex', maxWidth: 576, flexDirection: 'column', gap: 2 }}>
        <Box>
          <Typography component="h2" variant="h6">
            Conecte o WhatsApp
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Vincule esta conexão como um aparelho conectado.
          </Typography>
        </Box>
        <Box
          component="ol"
          sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, m: 0, pl: 2.5, fontSize: 14 }}
        >
          <Typography component="li" variant="body2">
            Abra o WhatsApp no celular.
          </Typography>
          <Typography component="li" variant="body2">
            Acesse <Box component="strong">Aparelhos conectados</Box>.
          </Typography>
          <Typography component="li" variant="body2">
            Toque em <Box component="strong">Conectar aparelho</Box> e leia o QR Code.
          </Typography>
        </Box>
        {error && (
          <Alert severity="error" sx={{ fontSize: 14 }}>
            {error}
          </Alert>
        )}
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          <Button
            variant="contained"
            startIcon={<RefreshCw size={16} />}
            disabled={busy || active}
            onClick={() => void run(() => action('connect'))}
          >
            {detail.status === 'connected' ? 'WhatsApp conectado' : 'Conectar WhatsApp'}
          </Button>
          {active && (
            <Button
              variant="outlined"
              startIcon={<Unplug size={16} />}
              disabled={busy}
              onClick={() => void run(() => action('disconnect'))}
            >
              Desconectar
            </Button>
          )}
          <Button
            color="error"
            variant="outlined"
            startIcon={<LogOut size={16} />}
            disabled={busy}
            onClick={() => setConfirmLogout(true)}
          >
            Desconectar e sair
          </Button>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          “Desconectar e sair” desvincula o celular e apaga as credenciais desta conexão. O histórico local e
          a caixa de entrada continuam.
        </Typography>
      </Box>
      <Box
        sx={{
          display: 'flex',
          width: { xs: '100%', md: 288 },
          flexDirection: 'column',
          alignItems: 'center',
          gap: 1,
          borderRadius: 2,
          border: 1,
          borderColor: 'divider',
          bgcolor: 'var(--color-n-solid-1)',
          p: 2,
        }}
      >
        {detail.qr ? <Qr value={detail.qr} /> : <Placeholder status={detail.status} />}
        <Typography component="small" variant="caption" color="text.secondary">
          {detail.qr ? 'O QR Code é atualizado automaticamente.' : 'A conexão fica salva neste computador.'}
        </Typography>
      </Box>
      {confirmLogout && (
        <ConfirmModal
          title="Desconectar e sair?"
          description="O WhatsApp deixa de estar vinculado a esta conexão. Para voltar, será preciso ler um novo QR Code."
          confirm="Desconectar e sair"
          onConfirm={() => action('logout')}
          onClose={() => setConfirmLogout(false)}
        />
      )}
    </Box>
  );
}
