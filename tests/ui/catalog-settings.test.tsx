import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AgentApp from '../../src/agent/AgentApp';
import { CatalogScreen } from '../../src/agent/catalog/CatalogScreen';
import { canOpen } from '../../src/agent/permissions';
import { fakeApi, status } from './fake-api';
import { admin, maria, workspaceRoutes } from './fixtures';
import { catalogRoutes, settings } from './catalog-fixtures';

const nav = () => within(screen.getByRole('navigation', { name: '' }));

describe('catalog settings', () => {
  it('saves the pizza pricing rule and the notes limit', async () => {
    let fail = false;
    const api = fakeApi({
      'GET /catalog/settings': settings,
      'PATCH /catalog/settings': (body) => {
        if (fail) throw status(400, 'Valor inválido');
        return body as object;
      },
    });
    const ui = userEvent.setup();
    render(<CatalogScreen user={admin} section="settings" onNavigate={vi.fn()} />);
    expect(await screen.findByRole('radio', { name: /Maior valor/ }, { timeout: 5000 })).toBeChecked();
    await ui.click(screen.getByRole('radio', { name: /Média/ }));
    const notes = screen.getByLabelText('Tamanho máximo das observações do item');
    expect(notes).toHaveValue(140);
    await ui.clear(notes);
    expect(screen.getByText('Informe um número de caracteres maior que zero.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
    await ui.type(notes, '280');
    await ui.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Configurações salvas.');
    expect(api.called('PATCH', '/catalog/settings')[0].body).toEqual({
      pizza_pricing: 'average',
      notes_max_length: 280,
    });
    fail = true;
    await ui.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Valor inválido');
  });

  it('reports a settings load failure', async () => {
    fakeApi({
      'GET /catalog/settings': () => {
        throw status(403, 'Sem permissão');
      },
    });
    render(<CatalogScreen user={admin} section="settings" onNavigate={vi.fn()} />);
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent('Sem permissão');
  });
});

describe('catalog navigation and permissions', () => {
  it('opens every catalog page from the sidebar for administrators', async () => {
    fakeApi({ ...workspaceRoutes(), ...catalogRoutes() });
    const ui = userEvent.setup();
    render(<AgentApp />);
    await screen.findByRole('heading', { name: 'Conversas' }, { timeout: 5000 });
    await ui.click(nav().getByRole('button', { name: 'Catálogo' }));
    expect(await screen.findByRole('heading', { name: 'Cardápio' })).toBeInTheDocument();
    expect(nav().getByRole('button', { name: 'Cardápio' })).toHaveAttribute('aria-current', 'page');
    await ui.click(nav().getByRole('button', { name: 'Complementos' }));
    expect(await screen.findByRole('heading', { name: 'Complementos' })).toBeInTheDocument();
    await ui.click(nav().getByRole('button', { name: 'Importar do iFood' }));
    expect(await screen.findByRole('heading', { name: 'Importar do iFood' })).toBeInTheDocument();
    await ui.click(nav().getByRole('button', { name: 'Configurações do cardápio' }));
    expect(await screen.findByRole('heading', { name: 'Configurações do cardápio' })).toBeInTheDocument();
    await ui.click(nav().getByRole('button', { name: 'Catálogo' }));
    expect(nav().queryByRole('button', { name: 'Cardápio' })).not.toBeInTheDocument();
  });

  it('shows agents only the menu and the complements library', async () => {
    fakeApi({ ...workspaceRoutes(maria), ...catalogRoutes() });
    const ui = userEvent.setup();
    render(<AgentApp />);
    await screen.findByRole('heading', { name: 'Conversas' }, { timeout: 5000 });
    await ui.click(nav().getByRole('button', { name: 'Catálogo' }));
    expect(await screen.findByRole('heading', { name: 'Cardápio' })).toBeInTheDocument();
    expect(nav().getByRole('button', { name: 'Complementos' })).toBeInTheDocument();
    expect(nav().queryByRole('button', { name: 'Importar do iFood' })).not.toBeInTheDocument();
    expect(nav().queryByRole('button', { name: 'Configurações do cardápio' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'X-Burger' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Novo item' })).not.toBeInTheDocument();

    expect(canOpen(maria, { page: 'catalog', section: 'import' })).toBe(false);
    expect(canOpen(maria, { page: 'catalog', section: 'settings' })).toBe(false);
    expect(canOpen(maria, { page: 'catalog' })).toBe(true);
    expect(canOpen(maria, { page: 'catalog', section: 'groups' })).toBe(true);
    expect(canOpen(admin, { page: 'catalog', section: 'import' })).toBe(true);
  });
});
