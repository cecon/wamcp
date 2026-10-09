import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContactPanel } from '../../src/agent/conversations/ContactPanel';
import { ReplyBox } from '../../src/agent/conversations/ReplyBox';
import { fakeApi, status } from './fake-api';
import { admin, contact, conversation, inbox, labels, maria, team } from './fixtures';
import { burger, calabresa, juice } from './catalog-fixtures';

function renderConversation() {
  render(
    <>
      <ReplyBox path="/conversations/7" disabled={false} onSent={vi.fn()} />
      <ReplyBox path="/conversations/8" disabled={false} onSent={vi.fn()} />
      <ContactPanel
        conversation={conversation}
        user={maria}
        catalog={{ inboxes: [inbox], agents: [admin, maria], teams: [team], labels }}
        onChange={vi.fn()}
        onError={vi.fn()}
        onOpenConversation={vi.fn()}
        onClose={vi.fn()}
      />
    </>,
  );
  return userEvent.setup();
}

describe('catalog lookup in the conversation panel', () => {
  it('finds items and inserts name and price into the reply of this conversation', async () => {
    let results: unknown = [burger, juice, calabresa];
    const api = fakeApi({
      'GET /contacts/50': contact,
      'GET /catalog/search': () => {
        if (results instanceof Error) throw results;
        return results;
      },
    });
    const ui = renderConversation();
    await ui.click(screen.getByRole('button', { name: 'Catálogo' }));
    const search = screen.getByLabelText('Buscar no catálogo');
    await ui.type(search, 'x');
    expect(api.called('GET', '/catalog/search')).toHaveLength(0);
    await ui.type(search, '-b');
    await waitFor(() => expect(api.called('GET', '/catalog/search').at(-1)!.search).toBe('?q=x-b'));
    const panel = within(screen.getByRole('complementary', { name: 'Painel do contato' }));
    expect(await panel.findByText('X-Burger')).toBeInTheDocument();
    expect(panel.getByText(/R\$ 29,90 · PDV XB01/)).toBeInTheDocument();
    expect(
      within(panel.getByText('Suco natural').closest('li')!).getByText('Indisponível agora'),
    ).toBeInTheDocument();

    const [mine, other] = screen.getAllByRole('textbox', { name: 'Mensagem' });
    await ui.click(panel.getByRole('button', { name: 'Inserir X-Burger na resposta' }));
    expect(mine).toHaveValue('X-Burger — R$ 29,90');
    await ui.click(panel.getByRole('button', { name: 'Inserir Calabresa na resposta' }));
    expect(mine).toHaveValue('X-Burger — R$ 29,90\nCalabresa — a partir de R$ 49,90');
    expect(other).toHaveValue('');

    results = [];
    await ui.type(search, 'z');
    expect(await panel.findByText('Nenhum item encontrado.')).toBeInTheDocument();
    results = status(500, 'Catálogo indisponível');
    await ui.type(search, 'z');
    expect(await panel.findByText('Catálogo indisponível')).toBeInTheDocument();
  });
});
