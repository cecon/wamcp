import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { connectRealtime } from '../../src/agent/api';
import { ImportPage } from '../../src/agent/catalog/importer/ImportPage';
import { fakeApi, FakeEventSource, status } from './fake-api';
import { importJob, readyJob } from './catalog-fixtures';

const LINK = 'https://www.ifood.com.br/delivery/sao-paulo-sp/pizzaria-boa/abc123';
const KEY = 'wamcp.catalog.import';

function renderImport(pollMs = 20) {
  const onOpenMenu = vi.fn();
  render(<ImportPage realtime={connectRealtime(() => {})} onOpenMenu={onOpenMenu} pollMs={pollMs} />);
  return { ui: userEvent.setup(), onOpenMenu };
}
async function start(ui: ReturnType<typeof userEvent.setup>) {
  await ui.type(await screen.findByLabelText('Link da loja no iFood'), LINK);
  await ui.click(screen.getByRole('button', { name: 'Importar' }));
}
const step = (label: string) => screen.getByRole('listitem', { name: new RegExp(`^${label}:`) });

describe('iFood import', () => {
  it('validates the link, polls the crawler through verification and merges the preview', async () => {
    const api = fakeApi({
      'POST /catalog/imports': importJob(),
      'GET /catalog/imports/7f3c': importJob({ status: 'opening' }),
      'POST /catalog/imports/7f3c/apply': { ...readyJob, status: 'applied' },
    });
    const { ui, onOpenMenu } = renderImport();
    await ui.type(screen.getByLabelText('Link da loja no iFood'), 'https://example.com/loja');
    await ui.click(screen.getByRole('button', { name: 'Importar' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Cole o link da loja no formato https://www.ifood.com.br',
    );
    expect(api.called('POST', '/catalog/imports')).toHaveLength(0);
    await ui.clear(screen.getByLabelText('Link da loja no iFood'));
    await start(ui);
    await waitFor(() => expect(api.called('POST', '/catalog/imports')[0].body).toEqual({ url: LINK }));
    expect(await screen.findByRole('region', { name: 'Importação em andamento' })).toBeInTheDocument();
    expect(step('Abrindo o iFood')).toHaveAttribute('aria-current', 'step');
    expect(localStorage.getItem(KEY)).toBe('7f3c');

    api.route(
      'GET /catalog/imports/7f3c',
      importJob({ status: 'waiting_human', message: 'Confirme no navegador que você é humano' }),
    );
    expect(await screen.findByText(/Uma janela do iFood abriu no computador do WA MCP/)).toHaveTextContent(
      "Se o iFood pedir 'Confirme que é humano', clique lá para continuar.",
    );
    expect(screen.getByText('Confirme no navegador que você é humano')).toBeInTheDocument();
    expect(step('Abrindo o iFood')).toHaveAccessibleName('Abrindo o iFood: concluída');
    expect(step('Aguardando verificação')).toHaveAccessibleName('Aguardando verificação: em andamento');

    api.route('GET /catalog/imports/7f3c', importJob({ status: 'loading' }));
    await waitFor(() => expect(step('Lendo cardápio')).toHaveAccessibleName('Lendo cardápio: em andamento'));
    expect(screen.queryByText(/Uma janela do iFood abriu/)).not.toBeInTheDocument();

    api.route('GET /catalog/imports/7f3c', readyJob);
    const preview = within(await screen.findByLabelText('Prévia do cardápio'));
    const counts = within(screen.getByText('Itens').closest('div')!);
    expect(counts.getByText('64')).toBeInTheDocument();
    expect(screen.getByText('140')).toBeInTheDocument();
    expect(preview.getByText('Pizzas')).toBeInTheDocument();
    expect(preview.getByText(/PDV PZ01/)).toBeInTheDocument();
    expect(preview.getByText('(obrigatório, mín. 1 · máx. 1)')).toBeInTheDocument();
    expect(preview.getByText('Grande — R$ 59,90')).toBeInTheDocument();
    const polls = api.called('GET', '/catalog/imports/7f3c').length;

    expect(screen.getByRole('radio', { name: /Mesclar com o cardápio atual/ })).toBeChecked();
    await ui.click(screen.getByRole('button', { name: 'Aplicar importação' }));
    expect(await screen.findByText('Cardápio importado com sucesso.')).toBeInTheDocument();
    expect(api.called('POST', '/catalog/imports/7f3c/apply')[0].body).toEqual({ mode: 'merge' });
    expect(api.called('GET', '/catalog/imports/7f3c').length).toBe(polls);
    expect(localStorage.getItem(KEY)).toBeNull();
    await ui.click(screen.getByRole('button', { name: 'Abrir cardápio' }));
    expect(onOpenMenu).toHaveBeenCalled();
    await ui.click(screen.getByRole('button', { name: 'Nova importação' }));
    expect(screen.getByLabelText('Link da loja no iFood')).toBeInTheDocument();
  });

  it('resumes a ready import and asks for a strong confirmation before replacing everything', async () => {
    localStorage.setItem(KEY, '7f3c');
    const api = fakeApi({
      'GET /catalog/imports/7f3c': readyJob,
      'POST /catalog/imports/7f3c/apply': { ...readyJob, status: 'applied' },
    });
    const { ui } = renderImport();
    await screen.findByLabelText('Prévia do cardápio', {}, { timeout: 5000 });
    await ui.click(screen.getByRole('radio', { name: /Substituir tudo/ }));
    await ui.click(screen.getByRole('button', { name: 'Aplicar importação' }));
    let dialog = within(screen.getByRole('dialog', { name: 'Substituir todo o cardápio?' }));
    await ui.click(dialog.getByRole('button', { name: 'Cancelar' }));
    expect(api.called('POST', '/catalog/imports/7f3c/apply')).toHaveLength(0);

    await ui.click(screen.getByRole('button', { name: 'Aplicar importação' }));
    dialog = within(screen.getByRole('dialog', { name: 'Substituir todo o cardápio?' }));
    expect(dialog.getByRole('button', { name: 'Substituir cardápio' })).toBeDisabled();
    await ui.type(dialog.getByLabelText('Digite SUBSTITUIR para confirmar'), 'substituir');
    await ui.click(dialog.getByRole('button', { name: 'Substituir cardápio' }));
    await waitFor(() =>
      expect(api.called('POST', '/catalog/imports/7f3c/apply')[0].body).toEqual({ mode: 'replace' }),
    );
    expect(await screen.findByText('Cardápio importado com sucesso.')).toBeInTheDocument();
  });

  it('cancels a running import, shows failures and start errors', async () => {
    let started: unknown = importJob();
    const api = fakeApi({
      'POST /catalog/imports': () => {
        if (started instanceof Error) throw started;
        return started;
      },
      'GET /catalog/imports/7f3c': importJob({ status: 'opening' }),
      'DELETE /catalog/imports/7f3c': { ok: true },
    });
    const { ui } = renderImport();
    await start(ui);
    await ui.click(await screen.findByRole('button', { name: 'Cancelar importação' }));
    await waitFor(() => expect(api.called('DELETE', '/catalog/imports/7f3c')).toHaveLength(1));
    expect(
      await screen.findByText('Importação cancelada. A janela do iFood foi fechada.'),
    ).toBeInTheDocument();
    await ui.click(screen.getByRole('button', { name: 'Nova importação' }));
    expect(screen.getByLabelText('Link da loja no iFood')).toHaveValue(LINK);

    api.route(
      'GET /catalog/imports/7f3c',
      importJob({ status: 'failed', message: 'O iFood não respondeu em 5 minutos.' }),
    );
    await ui.click(screen.getByRole('button', { name: 'Importar' }));
    expect(await screen.findByText('O iFood não respondeu em 5 minutos.')).toBeInTheDocument();
    await ui.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    started = status(409, 'Já existe uma importação em andamento.');
    await ui.click(screen.getByRole('button', { name: 'Importar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Já existe uma importação em andamento.');
  });

  it('follows catalog.import.updated events without waiting for the next poll', async () => {
    localStorage.setItem(KEY, 'sumiu');
    fakeApi({
      'GET /catalog/imports/sumiu': () => {
        throw status(404, 'Importação não encontrada');
      },
      'POST /catalog/imports': importJob(),
      'GET /catalog/imports/7f3c': importJob(),
    });
    const { ui } = renderImport(60000);
    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
    await start(ui);
    await screen.findByRole('region', { name: 'Importação em andamento' });
    FakeEventSource.emit('catalog.import.updated', { id: 'outra', status: 'failed' });
    FakeEventSource.emit('catalog.import.updated', { id: '7f3c', status: 'waiting_human', message: null });
    expect(await screen.findByText(/Uma janela do iFood abriu/)).toBeInTheDocument();
    FakeEventSource.emit('catalog.import.updated', { id: '7f3c', status: 'failed', message: 'Loja fechada' });
    expect(await screen.findByText('Loja fechada')).toBeInTheDocument();
  });
});
