import { CONVERSATION_TYPES, HOME, REPORT_SECTIONS, SETTINGS_SECTIONS, type Route } from '../route';
import type { FilterCondition } from '../types';

/**
 * Base do app no navegador: `''` no dev (Vite serve na raiz) e `/app` quando o backend serve o build
 * (`src-tauri/tauri.conf`, `vite.config.ts` com `base: './'`). O `BrowserRouter` usa isto como `basename`.
 */
export function routerBase(): string {
  return new URL(document.baseURI).pathname.replace(/\/+$/, '');
}

function numberParam(params: URLSearchParams, key: string): number | undefined {
  const value = Number(params.get(key));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function stringParam(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key);
  return value ? value : undefined;
}

/** Os filtros avançados viajam na URL (views salvas e filtro aplicado sobrevivem ao recarregar). */
function filtersParam(params: URLSearchParams): FilterCondition[] | undefined {
  const raw = params.get('f');
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? (parsed as FilterCondition[]) : undefined;
  } catch {
    return undefined;
  }
}

/** Rota do app -> caminho do navegador (com query). Contrária de `pathToRoute`. */
export function routeToPath(route: Route): string {
  switch (route.page) {
    case 'conversations': {
      const params = new URLSearchParams();
      if (route.inboxId) params.set('inbox', String(route.inboxId));
      if (route.teamId) params.set('team', String(route.teamId));
      if (route.label) params.set('label', route.label);
      if (route.q) params.set('q', route.q);
      if (route.conversationType) params.set('type', route.conversationType);
      if (route.viewId) params.set('view', String(route.viewId));
      if (route.displayId) params.set('conversation', String(route.displayId));
      if (route.filters?.length) params.set('f', JSON.stringify(route.filters));
      const query = params.toString();
      return query ? `/conversations?${query}` : '/conversations';
    }
    case 'contacts':
      return route.contactId ? `/contacts?contact=${route.contactId}` : '/contacts';
    case 'agent_chat':
      return route.agentId ? `/agent-chat?agent=${route.agentId}` : '/agent-chat';
    case 'agent_runs':
      return '/agents-live';
    case 'reports':
      return route.section && route.section !== 'overview' ? `/reports?section=${route.section}` : '/reports';
    case 'search':
      return '/search';
    case 'profile':
      return '/profile';
    case 'notifications':
      return '/notifications';
    case 'settings': {
      const params = new URLSearchParams({ section: route.section });
      if (route.id) params.set('id', String(route.id));
      if (route.connectionId) params.set('connection', route.connectionId);
      return `/settings?${params.toString()}`;
    }
  }
}

/** Caminho do navegador -> rota do app; caminho desconhecido cai na tela inicial. */
export function pathToRoute(pathname: string, search: string): Route {
  const params = new URLSearchParams(search);
  const path = pathname.replace(/\/+$/, '') || '/';
  switch (path) {
    case '/conversations': {
      const type = stringParam(params, 'type');
      return {
        page: 'conversations',
        inboxId: numberParam(params, 'inbox'),
        teamId: numberParam(params, 'team'),
        label: stringParam(params, 'label'),
        q: stringParam(params, 'q'),
        displayId: numberParam(params, 'conversation'),
        conversationType: CONVERSATION_TYPES.find((value) => value === type),
        viewId: numberParam(params, 'view'),
        filters: filtersParam(params),
      };
    }
    case '/contacts':
      return { page: 'contacts', contactId: numberParam(params, 'contact') };
    case '/agent-chat':
      return { page: 'agent_chat', agentId: numberParam(params, 'agent') };
    case '/agents-live':
      return { page: 'agent_runs' };
    case '/reports': {
      const section = stringParam(params, 'section');
      return { page: 'reports', section: REPORT_SECTIONS.find((value) => value === section) ?? 'overview' };
    }
    case '/search':
      return { page: 'search' };
    case '/profile':
      return { page: 'profile' };
    case '/notifications':
      return { page: 'notifications' };
    case '/settings': {
      const section = stringParam(params, 'section');
      return {
        page: 'settings',
        section: SETTINGS_SECTIONS.find((value) => value === section) ?? 'account',
        id: numberParam(params, 'id'),
        connectionId: stringParam(params, 'connection'),
      };
    }
    default:
      return HOME;
  }
}
