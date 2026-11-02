// material-ui
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';

import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const body = { wordBreak: 'break-word', whiteSpace: 'pre-wrap' } as const;

/** Each Markdown element in the C3Theme (lote 27); raw HTML never renders. */
const COMPONENTS: Components = {
  p: ({ children }) => (
    <Box component="p" sx={{ ...body, m: 0, '&:not(:first-of-type)': { mt: 1 } }}>
      {children}
    </Box>
  ),
  a: ({ href, children }) => (
    <Link
      href={href}
      target="_blank"
      rel="noreferrer"
      sx={{ color: 'primary.main', textDecoration: 'underline', wordBreak: 'break-all' }}
    >
      {children}
    </Link>
  ),
  ul: ({ children }) => (
    <Box component="ul" sx={{ mt: 1, pl: 2.5, m: 0, listStyle: 'disc', '& li + li': { mt: 0.5 } }}>
      {children}
    </Box>
  ),
  ol: ({ children }) => (
    <Box component="ol" sx={{ mt: 1, pl: 2.5, m: 0, listStyle: 'decimal', '& li + li': { mt: 0.5 } }}>
      {children}
    </Box>
  ),
  h1: ({ children }) => (
    <Box
      component="h3"
      sx={{ mt: 1.5, mb: 0.5, fontSize: 16, fontWeight: 600, '&:first-of-type': { mt: 0 } }}
    >
      {children}
    </Box>
  ),
  h2: ({ children }) => (
    <Box
      component="h3"
      sx={{ mt: 1.5, mb: 0.5, fontSize: 16, fontWeight: 600, '&:first-of-type': { mt: 0 } }}
    >
      {children}
    </Box>
  ),
  h3: ({ children }) => (
    <Box component="h4" sx={{ mt: 1.5, mb: 0.5, fontWeight: 600, '&:first-of-type': { mt: 0 } }}>
      {children}
    </Box>
  ),
  h4: ({ children }) => (
    <Box component="h4" sx={{ mt: 1.5, mb: 0.5, fontWeight: 600, '&:first-of-type': { mt: 0 } }}>
      {children}
    </Box>
  ),
  blockquote: ({ children }) => (
    <Box
      component="blockquote"
      sx={{ mt: 1, borderLeft: 2, borderColor: 'divider', pl: 1.5, color: 'text.secondary', m: 0 }}
    >
      {children}
    </Box>
  ),
  code: ({ className, children }) =>
    className ? (
      <Box component="code" className={className}>
        {children}
      </Box>
    ) : (
      <Box
        component="code"
        sx={{
          borderRadius: 0.5,
          bgcolor: 'action.hover',
          px: 0.5,
          py: 0.25,
          fontFamily: 'monospace',
          fontSize: '0.85em',
        }}
      >
        {children}
      </Box>
    ),
  pre: ({ children }) => (
    <Box
      component="pre"
      sx={{
        mt: 1,
        m: 0,
        overflowX: 'auto',
        borderRadius: 1,
        bgcolor: 'action.hover',
        p: 1.5,
        fontFamily: 'monospace',
        fontSize: 12,
        lineHeight: 1.6,
      }}
    >
      {children}
    </Box>
  ),
  table: ({ children }) => (
    <Box sx={{ mt: 1, overflowX: 'auto' }}>
      <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        {children}
      </Box>
    </Box>
  ),
  th: ({ children }) => (
    <Box
      component="th"
      sx={{
        border: 1,
        borderColor: 'divider',
        bgcolor: 'action.hover',
        px: 1,
        py: 0.5,
        textAlign: 'left',
        fontWeight: 600,
      }}
    >
      {children}
    </Box>
  ),
  td: ({ children }) => (
    <Box component="td" sx={{ border: 1, borderColor: 'divider', px: 1, py: 0.5, verticalAlign: 'top' }}>
      {children}
    </Box>
  ),
  hr: () => <Box component="hr" sx={{ my: 1.5, borderColor: 'divider', borderBottom: 0 }} />,
};

/** Mensagem do agente em Markdown no C3Theme (lote 27): listas, tabelas, código e links. */
export function ChatMarkdown({ content }: { content: string }) {
  return (
    <Box sx={{ minWidth: 0, wordBreak: 'break-word' }}>
      <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {content}
      </Markdown>
    </Box>
  );
}
