// material-ui
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import type { ColumnDef } from '@tanstack/react-table';

// C3Theme
import { DataTable } from '@c3theme/ui/table';

export interface CsatRow {
  id: number;
  display_id: number;
  contact_name: string | null;
  assignee_name: string | null;
  rating: number;
  feedback: string | null;
}

const ratingColor = (rating: number) =>
  rating >= 4 ? 'var(--color-n-teal-9)' : rating >= 3 ? 'var(--color-n-amber-9)' : 'var(--color-n-ruby-9)';

const columns: ColumnDef<CsatRow>[] = [
  {
    id: 'rating',
    header: 'Nota',
    accessorFn: (row) => row.rating,
    cell: (info) => (
      <Chip
        label={info.row.original.rating}
        size="small"
        sx={{
          width: 28,
          height: 28,
          borderRadius: 1,
          fontWeight: 500,
          color: '#fff',
          bgcolor: ratingColor(info.row.original.rating),
        }}
      />
    ),
  },
  {
    id: 'conversation',
    header: 'Conversa',
    accessorFn: (row) => `#${row.display_id} · ${row.contact_name || 'Contato'}`,
    cell: (info) => <Typography variant="body2">{String(info.getValue())}</Typography>,
  },
  {
    id: 'assignee',
    header: 'Responsável',
    accessorFn: (row) => row.assignee_name || 'Sem responsável',
    cell: (info) => (
      <Typography variant="body2" color="text.secondary">
        {String(info.getValue())}
      </Typography>
    ),
  },
  {
    id: 'feedback',
    header: 'Comentário',
    accessorFn: (row) => (row.feedback ? `“${row.feedback}”` : '—'),
    cell: (info) => <Typography variant="body2">{String(info.getValue())}</Typography>,
  },
];

/** Chatwoot CsatTable: rating chip, conversation, assignee and the contact's comment. */
export function CsatResponses({ rows }: { rows: CsatRow[] }) {
  return (
    <DataTable
      rows={rows}
      columns={columns}
      getRowId={(row) => String(row.id)}
      paginate={false}
      empty="Nenhuma avaliação no período."
      ariaLabel="Avaliações"
    />
  );
}

/** Chatwoot CsatRatingDistribution: one bar per rating (1–5) with its share of the answers. */
export function RatingDistribution({ ratings, total }: { ratings: Record<string, number>; total: number }) {
  return (
    <Box
      component="ul"
      aria-label="Distribuição das notas"
      sx={{ display: 'flex', flexDirection: 'column', gap: 1, listStyle: 'none', m: 0, p: 0 }}
    >
      {['5', '4', '3', '2', '1'].map((rating) => {
        const count = ratings[rating] || 0;
        const share = total ? Math.round((count / total) * 100) : 0;
        return (
          <Box
            component="li"
            key={rating}
            sx={{ display: 'flex', alignItems: 'center', gap: 1.5, fontSize: 14 }}
          >
            <Typography component="span" variant="body2" color="text.secondary" sx={{ width: 56 }}>
              Nota {rating}
            </Typography>
            <Box
              component="span"
              sx={{
                display: 'block',
                height: 8,
                flex: 1,
                overflow: 'hidden',
                borderRadius: 99,
                bgcolor: 'var(--color-n-slate-3)',
              }}
            >
              <Box
                component="span"
                sx={{
                  display: 'block',
                  height: '100%',
                  width: `${share}%`,
                  borderRadius: 99,
                  bgcolor: ratingColor(Number(rating)),
                }}
              />
            </Box>
            <Typography component="span" variant="body2" sx={{ width: 80, textAlign: 'right' }}>
              {count} ({share}%)
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}
