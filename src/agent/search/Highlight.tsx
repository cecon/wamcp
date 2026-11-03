// material-ui
import Box from '@mui/material/Box';

/** Marks every case-insensitive occurrence of `term` in `text` (Chatwoot search highlight). */
export function Highlight({ text, term }: { text: string | null | undefined; term: string }) {
  if (!text) return null;
  if (!term) return <>{text}</>;
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escape(term)})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        i % 2 ? (
          <Box
            component="mark"
            key={i}
            sx={{ borderRadius: 0.5, bgcolor: 'var(--color-n-amber-3)', px: 0.5, color: 'inherit' }}
          >
            {part}
          </Box>
        ) : (
          part
        ),
      )}
    </>
  );
}
