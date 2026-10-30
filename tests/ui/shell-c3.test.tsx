import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import AgentApp from '../../src/agent/AgentApp';
// Pré-carrega o chunk do shell (MUI/Emotion) fora do tempo da asserção: em paralelo, a primeira transformação passa de 8 s.
import '../../src/agent/shell/C3Workspace';
import { fakeApi } from './fake-api';
import { workspaceRoutes } from './fixtures';
import { summary } from './report-fixtures';

/** Liga o shell novo do C3Theme (Fase 2) pela mesma flag usada no navegador. */
function enableC3Shell() {
  window.history.replaceState({}, '', '/?c3shell');
}

afterEach(() => window.history.replaceState({}, '', '/'));

describe('shell C3 (?c3shell)', () => {
  it('monta o AppLayout com menu, badge de não lidas, busca e navegação por link', async () => {
    fakeApi({ ...workspaceRoutes(), 'GET /reports/summary_v2': summary, 'GET /reports': [] });
    enableC3Shell();
    const user = userEvent.setup();
    render(<AgentApp />);

    // O shell do C3Theme vem em chunk lazy: a primeira importação transforma o MUI e passa de 1 s no Vitest.
    expect(await screen.findByRole('heading', { name: 'Conversas' }, { timeout: 8000 })).toBeInTheDocument();
    const nav = await screen.findByRole('navigation');
    expect(await within(nav).findByText('3')).toBeInTheDocument();

    // Itens folha são links do react-router (o AppLayout navega pela URL).
    await user.click(within(nav).getByRole('link', { name: 'Contatos' }));
    expect(await screen.findByRole('heading', { name: 'Contatos' })).toBeInTheDocument();
    // A flag do shell sobrevive à navegação (o menu continua no AppLayout).
    expect(screen.getByRole('navigation')).toBeInTheDocument();

    // A busca do header continua indo para a lista filtrada.
    await user.type(screen.getByLabelText('Pesquisar conversas'), 'joão{Enter}');
    expect(await screen.findByRole('heading', { name: 'Busca: “joão”' })).toBeInTheDocument();
  });

  it('mantém as páginas de Configurações acessíveis pelo menu do pacote', async () => {
    fakeApi({ ...workspaceRoutes(), 'GET /account': { id: 1, name: 'Loja', locale: 'pt-BR', settings: {} } });
    enableC3Shell();
    const user = userEvent.setup();
    render(<AgentApp />);

    await screen.findByRole('heading', { name: 'Conversas' }, { timeout: 8000 });
    const nav = await screen.findByRole('navigation');
    await user.click(within(nav).getByRole('button', { name: 'Configurações' }));
    await user.click(within(nav).getByRole('link', { name: 'Configurações da conta' }));
    expect(await screen.findByLabelText('Nome da conta')).toHaveValue('Loja');
  });
});
