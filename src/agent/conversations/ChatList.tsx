import { useState, type ReactNode } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';

import type { Catalog, Conversation, Meta } from '../types';
import { BulkActionBar } from './BulkActionBar';
import { ChatListHeader, type StatusFilter } from './ChatListHeader';
import { ConversationCard } from './ConversationCard';

export type AssigneeType = 'me' | 'unassigned' | 'all';
export type { StatusFilter };

const TABS: { id: AssigneeType; label: string; count: keyof Meta }[] = [
  { id: 'me', label: 'Minhas', count: 'mine' },
  { id: 'unassigned', label: 'Não atribuídas', count: 'unassigned' },
  { id: 'all', label: 'Todas', count: 'all' },
];

interface Props {
  title: string;
  items: Conversation[];
  meta: Meta;
  status: StatusFilter;
  tab: AssigneeType;
  sort: string;
  filtering?: boolean;
  toolbar?: ReactNode;
  catalog: Catalog;
  selected?: number;
  hasMore: boolean;
  error: string;
  onStatus: (status: StatusFilter) => void;
  onTab: (tab: AssigneeType) => void;
  onSort: (sort: string) => void;
  onSelect: (displayId: number) => void;
  onMore: () => void;
  onReload: () => void;
}

/** Lista de conversas no C3Theme (lote 15): cabeçalho, abas Minhas/Não atribuídas/Todas (as atendidas pela IA aparecem em Todas), barra em lote e os cards. */
export function ChatList({
  title,
  items,
  meta,
  status,
  tab,
  sort,
  filtering = false,
  toolbar,
  catalog,
  selected,
  hasMore,
  error,
  ...on
}: Props) {
  const [checked, setChecked] = useState<number[]>([]);
  const visible = checked.filter((id) => items.some((c) => c.display_id === id));
  const toggle = (id: number, value: boolean) =>
    setChecked((list) => (value ? [...list, id] : list.filter((x) => x !== id)));

  return (
    <Box
      component="section"
      aria-label="Lista de conversas"
      sx={{
        display: 'flex',
        height: '100%',
        flexShrink: 0,
        flexDirection: 'column',
        bgcolor: 'background.paper',
        borderRight: { md: 1 },
        borderColor: 'divider',
        width: { xs: '100%', md: 340, xl: 412 },
      }}
    >
      <ChatListHeader
        title={title}
        status={status}
        sort={sort}
        filtering={filtering}
        toolbar={toolbar}
        onStatus={on.onStatus}
        onSort={on.onSort}
      />
      {!filtering && (
        <Tabs
          value={tab}
          onChange={(_event, value: AssigneeType) => on.onTab(value)}
          variant="fullWidth"
          sx={{ minHeight: 40, borderBottom: 1, borderColor: 'divider', px: 1 }}
        >
          {TABS.map((item) => (
            <Tab
              key={item.id}
              value={item.id}
              sx={{ minHeight: 40, py: 1, textTransform: 'none' }}
              label={
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                  <span>{item.label}</span>
                  <Box
                    component="span"
                    sx={{
                      display: 'flex',
                      height: 20,
                      minWidth: 20,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 99,
                      px: 0.75,
                      fontSize: 12,
                      fontWeight: 500,
                      bgcolor: tab === item.id ? 'primary.main' : 'action.hover',
                      color: tab === item.id ? 'primary.contrastText' : 'text.secondary',
                    }}
                  >
                    {meta[item.count] ?? 0}
                  </Box>
                </Stack>
              }
            />
          ))}
        </Tabs>
      )}
      {visible.length > 0 && (
        <BulkActionBar
          selected={visible}
          total={items.length}
          catalog={catalog}
          onSelectAll={(all) => setChecked(all ? items.map((c) => c.display_id) : [])}
          onClear={() => setChecked([])}
          onDone={(updated) => {
            setChecked((list) => list.filter((id) => !updated.includes(id)));
            on.onReload();
          }}
        />
      )}
      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {error && (
          <Typography variant="body2" sx={{ p: 2, color: 'error.main' }}>
            {error}
          </Typography>
        )}
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {items.map((conversation) => (
            <ConversationCard
              key={conversation.id}
              conversation={conversation}
              labels={catalog.labels}
              selected={selected === conversation.display_id}
              onSelect={() => on.onSelect(conversation.display_id)}
              checked={visible.includes(conversation.display_id)}
              selecting={visible.length > 0}
              onCheck={(value) => toggle(conversation.display_id, value)}
            />
          ))}
        </Box>
        {items.length === 0 && !error && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
            Não há conversas ativas neste grupo.
          </Typography>
        )}
        {hasMore && (
          <Box sx={{ p: 1.5 }}>
            <Button fullWidth variant="outlined" onClick={on.onMore}>
              Carregar mais
            </Button>
          </Box>
        )}
      </Box>
    </Box>
  );
}
