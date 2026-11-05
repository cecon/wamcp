// material-ui
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';

import { useFetch } from '../../useFetch';
import { sessionPath, type AuditEntry } from './model';

const HEADERS = ['Ação', 'Credencial', 'Quando'];

/** Atividade tab: recent MCP calls made with this connection's tokens and ChatGPT grants. */
export function AuditList({ id }: { id: string }) {
  const { data, error } = useFetch<AuditEntry[]>(`${sessionPath(id)}/audit`);
  if (error)
    return (
      <Alert severity="error" sx={{ fontSize: 14 }}>
        {error}
      </Alert>
    );
  if (!data)
    return (
      <Typography variant="body2" color="text.secondary">
        Carregando atividade…
      </Typography>
    );
  return (
    <Table size="small" aria-label="Atividade MCP">
      <TableHead>
        <TableRow>
          {HEADERS.map((header) => (
            <TableCell key={header}>
              <Typography variant="subtitle2" component="span">
                {header}
              </Typography>
            </TableCell>
          ))}
        </TableRow>
      </TableHead>
      <TableBody>
        {data.length === 0 && (
          <TableRow>
            <TableCell colSpan={HEADERS.length}>
              <Typography variant="body1" sx={{ py: 8, textAlign: 'center' }}>
                As chamadas MCP aparecerão aqui.
              </Typography>
            </TableCell>
          </TableRow>
        )}
        {data.slice(0, 100).map((a, i) => (
          <TableRow key={i}>
            <TableCell>
              <Box component="code" sx={{ color: 'var(--color-n-slate-12)' }}>
                {a.action}
              </Box>
            </TableCell>
            <TableCell>{a.token_id || '—'}</TableCell>
            <TableCell>{new Date(a.at).toLocaleString('pt-BR')}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
