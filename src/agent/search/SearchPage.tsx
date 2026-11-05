import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import InputAdornment from '@mui/material/InputAdornment';
import OutlinedInput from '@mui/material/OutlinedInput';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';

// third-party
import { Search } from 'lucide-react';

// C3Theme
import { Panel } from '@c3theme/ui';

import type { SearchResults as Results, SearchType } from '../parityTypes';
import { SearchResults } from './SearchResults';
import { MIN_CHARS, useSearch } from './useSearch';
import { SettingsC3Error, SettingsC3Page } from '../settings/c3/SettingsC3';

const TABS: { type: SearchType; label: string }[] = [
  { type: 'all', label: 'Todos' },
  { type: 'conversations', label: 'Conversas' },
  { type: 'contacts', label: 'Contatos' },
  { type: 'messages', label: 'Mensagens' },
];

const total = (r: Results) =>
  (r.conversations?.length || 0) + (r.contacts?.length || 0) + (r.messages?.length || 0);

interface Props {
  onOpenConversation: (displayId: number) => void;
  onOpenContact: (id: number) => void;
}

/** Busca global no C3Theme (lote 6): cabeçalho, campo e abas do pacote; as listas de resultado seguem no app. */
export function SearchPage({ onOpenConversation, onOpenContact }: Props) {
  const [text, setText] = useState(''),
    [type, setType] = useState<SearchType>('all');
  const { term, results, error, searching } = useSearch(text, type);
  return (
    <SettingsC3Page>
      <Panel>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="h4" component="h1">
            Pesquisar
          </Typography>
          <OutlinedInput
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Pesquise mensagens, contatos ou conversas (#12 abre a conversa 12)"
            startAdornment={
              <InputAdornment position="start">
                <Search size={16} />
              </InputAdornment>
            }
            slotProps={{ input: { 'aria-label': 'Pesquisar mensagens, contatos ou conversas' } }}
          />
          <Tabs
            value={type}
            onChange={(_event, value: SearchType) => setType(value)}
            aria-label="Tipo de resultado"
          >
            {TABS.map((tab) => (
              <Tab key={tab.type} value={tab.type} label={tab.label} />
            ))}
          </Tabs>
        </Box>
      </Panel>
      {error && <SettingsC3Error>{error}</SettingsC3Error>}
      {text.trim().length < MIN_CHARS ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
          Digite ao menos {MIN_CHARS} caracteres para pesquisar.
        </Typography>
      ) : searching && !results ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
          Pesquisando…
        </Typography>
      ) : results && total(results) > 0 ? (
        <Panel>
          <SearchResults
            results={results}
            term={term}
            onOpenConversation={onOpenConversation}
            onOpenContact={onOpenContact}
          />
        </Panel>
      ) : (
        !searching && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
            Nenhum resultado para “{term}”.
          </Typography>
        )
      )}
    </SettingsC3Page>
  );
}
