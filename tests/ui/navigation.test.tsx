import { describe, expect, it } from 'vitest';

import { pathToRoute, routeToPath } from '../../src/agent/navigation/routes';
import type { Route } from '../../src/agent/route';

/** A URL é a fonte da navegação: ida e volta tem de preservar a rota, inclusive filtros e ids. */
function roundTrip(route: Route) {
  const url = routeToPath(route);
  const [path, search = ''] = url.split('?');
  return pathToRoute(path, search);
}

describe('navegação por URL', () => {
  it('preserva conversas com filtros avançados e view salva', () => {
    const route: Route = {
      page: 'conversations',
      viewId: 3,
      filters: [
        { attribute_key: 'status', filter_operator: 'equal_to', values: ['open'], query_operator: 'and' },
      ],
    };
    expect(roundTrip(route)).toEqual(route);
  });

  it('preserva canais, times, etiquetas, busca e conversa aberta', () => {
    const route: Route = {
      page: 'conversations',
      inboxId: 2,
      teamId: 4,
      label: 'vip',
      q: 'pedido',
      conversationType: 'mentions',
      displayId: 7,
    };
    expect(roundTrip(route)).toEqual(route);
  });

  it('preserva contato, agente e conexão de Configurações', () => {
    expect(roundTrip({ page: 'contacts', contactId: 9 })).toEqual({ page: 'contacts', contactId: 9 });
    expect(roundTrip({ page: 'agent_chat', agentId: 5 })).toEqual({ page: 'agent_chat', agentId: 5 });
    expect(roundTrip({ page: 'settings', section: 'connections', connectionId: 'gh-1' })).toEqual({
      page: 'settings',
      section: 'connections',
      connectionId: 'gh-1',
    });
  });

  it('cai na tela inicial em caminho desconhecido e na seção padrão em URL inválida', () => {
    expect(pathToRoute('/', '')).toEqual({ page: 'conversations' });
    expect(pathToRoute('/qualquer-coisa', '')).toEqual({ page: 'conversations' });
    expect(pathToRoute('/settings', '?section=nao-existe')).toEqual({ page: 'settings', section: 'account' });
    expect(pathToRoute('/reports', '')).toEqual({ page: 'reports', section: 'overview' });
  });

  it('ignora filtro malformado em vez de quebrar a tela', () => {
    const route = pathToRoute('/conversations', '?f=nao-e-json');
    expect(route.page === 'conversations' ? route.filters : undefined).toBeUndefined();
    expect(routeToPath({ page: 'reports', section: 'overview' })).toBe('/reports');
    expect(routeToPath({ page: 'settings', section: 'labels' })).toBe('/settings?section=labels');
  });
});
