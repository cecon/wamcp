import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AgentApp from '../../src/agent/AgentApp';
import { SearchPage } from '../../src/agent/search/SearchPage';
import { Highlight } from '../../src/agent/search/Highlight';
import { fakeApi, status } from './fake-api';
import { contact, conversation, workspaceRoutes } from './fixtures';

const hit = {
  id: 31,
  content: 'Meu pedido do João chegou?',
  message_type: 'incoming',
  created_at: 1,
  conversation_id: 100,
  display_id: 7,
  contact_name: 'João Cliente',
};
const results = (url: URL) => {
  const type = url.searchParams.get('type');
  const all = { conversations: [conversation], contacts: [contact], messages: [hit] };
  return type === 'all' ? all : { [type!]: all[type as keyof typeof all] };
};

function renderPage() {
  const onOpenConversation = vi.fn(),
    onOpenContact = vi.fn();
  render(<SearchPage onOpenConversation={onOpenConversation} onOpenContact={onOpenContact} />);
  return { onOpenConversation, onOpenContact, user: userEvent.setup() };
}

describe('global search', () => {
  it('waits for 2 characters, then shows highlighted results by type', async () => {
    const api = fakeApi({ 'GET /search': (_b: unknown, url: URL) => results(url) });
    const { user, onOpenConversation, onOpenContact } = renderPage();
    const input = screen.getByLabelText('Pesquisar mensagens, contatos ou conversas');
    expect(input).toHaveFocus();
    await user.type(input, 'j');
    expect(screen.getByText('Digite ao menos 2 caracteres para pesquisar.')).toBeInTheDocument();
    await user.type(input, 'oão');
    // Debounced: wait until the full term is highlighted.
    expect(await screen.findAllByText('João', { selector: 'mark' })).not.toHaveLength(0);
    const messages = screen.getByRole('region', { name: 'Mensagens' });
    // The single character is never searched and the last request has the full term.
    const terms = api.called('GET', '/search').map((c) => new URLSearchParams(c.search).get('q'));
    expect(terms).not.toContain('j');
    expect(terms.at(-1)).toBe('joão');
    expect(within(messages).getByText('João Cliente · #7')).toBeInTheDocument();
    expect(within(messages).getByText('João', { selector: 'mark' })).toBeInTheDocument();
    const contacts = screen.getByRole('region', { name: 'Contatos' });
    expect(within(contacts).getByText('João', { selector: 'mark' })).toBeInTheDocument();
    expect(within(contacts).getByText(/joao@example.com/)).toBeInTheDocument();

    await user.click(within(messages).getByRole('button'));
    expect(onOpenConversation).toHaveBeenCalledWith(7);
    await user.click(within(contacts).getByRole('button'));
    expect(onOpenContact).toHaveBeenCalledWith(50);
    await user.click(within(screen.getByRole('region', { name: 'Conversas' })).getByRole('button'));
    expect(onOpenConversation).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole('tab', { name: 'Contatos' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Mensagens' })).not.toBeInTheDocument());
    expect(new URLSearchParams(api.calls.at(-1)!.search).get('type')).toBe('contacts');
    expect(screen.getByRole('tab', { name: 'Contatos' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows the empty state and errors', async () => {
    const api = fakeApi({ 'GET /search': { conversations: [], contacts: [], messages: [] } });
    const { user } = renderPage();
    const input = screen.getByLabelText('Pesquisar mensagens, contatos ou conversas');
    await user.type(input, 'zz');
    expect(await screen.findByText('Nenhum resultado para “zz”.')).toBeInTheDocument();
    api.route('GET /search', () => {
      throw status(400, 'Digite ao menos 2 caracteres');
    });
    await user.type(input, 'z');
    expect(await screen.findByRole('alert')).toHaveTextContent('Digite ao menos 2 caracteres');
  });

  it('opens from the sidebar and Ctrl+K and navigates to the contact', async () => {
    fakeApi({
      ...workspaceRoutes(),
      'GET /search': (_b: unknown, url: URL) => results(url),
      'GET /contacts': [contact],
    });
    const user = userEvent.setup();
    render(<AgentApp />);
    await screen.findByRole('heading', { name: 'Conversas' });
    await user.click(screen.getByRole('button', { name: 'Pesquisa global' }));
    expect(await screen.findByRole('heading', { name: 'Pesquisar' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Contatos' }));
    await screen.findByRole('heading', { name: 'Contatos' });
    await user.keyboard('{Control>}k{/Control}');
    await user.type(await screen.findByLabelText('Pesquisar mensagens, contatos ou conversas'), 'joão');
    const contacts = await screen.findByRole('region', { name: 'Contatos' });
    await user.click(within(contacts).getByRole('button'));
    expect(await screen.findByRole('dialog', { name: 'João Cliente' })).toBeInTheDocument();
  });

  it('highlights only when there is a term and escapes regex characters', () => {
    const { container } = render(
      <p>
        <Highlight text={null} term="x" />
        <Highlight text="sem termo" term="" />
        <Highlight text="custa R$ 10 (à vista)" term="(à" />
      </p>,
    );
    expect(container.textContent).toBe('sem termocusta R$ 10 (à vista)');
    expect(container.querySelector('mark')).toHaveTextContent('(à');
  });
});
