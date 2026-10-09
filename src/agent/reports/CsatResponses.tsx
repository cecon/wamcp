import { Cell, Table } from '../ui/Settings';
import { cn } from '../ui/cn';

export interface CsatRow {
  id: number;
  display_id: number;
  contact_name: string | null;
  assignee_name: string | null;
  rating: number;
  feedback: string | null;
}

const ratingColor = (rating: number) =>
  rating >= 4 ? 'bg-n-teal-9' : rating >= 3 ? 'bg-n-amber-9' : 'bg-n-ruby-9';

/** Chatwoot CsatTable: rating chip, conversation, assignee and the contact's comment. */
export function CsatResponses({ rows }: { rows: CsatRow[] }) {
  return (
    <Table
      headers={['Nota', 'Conversa', 'Responsável', 'Comentário']}
      rows={rows.length}
      empty="Nenhuma avaliação no período."
    >
      {rows.map((r) => (
        <tr key={r.id}>
          <Cell>
            <span
              className={cn(
                'inline-flex size-7 items-center justify-center rounded-lg text-white',
                ratingColor(r.rating),
              )}
            >
              {r.rating}
            </span>
          </Cell>
          <Cell className="text-n-slate-12">
            #{r.display_id} · {r.contact_name || 'Contato'}
          </Cell>
          <Cell>{r.assignee_name || 'Sem responsável'}</Cell>
          <Cell>{r.feedback ? `“${r.feedback}”` : '—'}</Cell>
        </tr>
      ))}
    </Table>
  );
}

/** Chatwoot CsatRatingDistribution: one bar per rating (1–5) with its share of the answers. */
export function RatingDistribution({ ratings, total }: { ratings: Record<string, number>; total: number }) {
  return (
    <ul className="flex flex-col gap-2" aria-label="Distribuição das notas">
      {['5', '4', '3', '2', '1'].map((rating) => {
        const count = ratings[rating] || 0;
        const share = total ? Math.round((count / total) * 100) : 0;
        return (
          <li key={rating} className="flex items-center gap-3 text-sm">
            <span className="w-14 text-n-slate-11">Nota {rating}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-n-slate-3">
              <span
                className={cn('block h-full rounded-full', ratingColor(Number(rating)))}
                style={{ width: `${share}%` }}
              />
            </span>
            <span className="w-20 text-right text-n-slate-12">
              {count} ({share}%)
            </span>
          </li>
        );
      })}
    </ul>
  );
}
