import { Fragment } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { splitMentions } from './mentions';
import { formatWhatsApp } from './whatsappFormat';

/** Corpo da mensagem no C3Theme (lote 19): markup do WhatsApp como texto e menções como chip “@Nome”. */
export function MessageBody({ content }: { content: string }) {
  return (
    <Typography variant="body2" component="p" sx={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
      {splitMentions(content).map((segment, i) =>
        'mention' in segment ? (
          <Box
            component="span"
            key={i}
            data-mention={segment.id}
            sx={{
              borderRadius: 0.5,
              bgcolor: 'var(--color-n-blue-3)',
              px: 0.5,
              fontWeight: 500,
              color: 'var(--color-n-blue-11)',
            }}
          >
            @{segment.mention}
          </Box>
        ) : (
          <Fragment key={i}>{formatWhatsApp(segment.text, `s${i}`)}</Fragment>
        ),
      )}
    </Typography>
  );
}
