import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';

import type { Route } from '../route';
import { pathToRoute, routeToPath } from './routes';

/**
 * A rota do app espelhada na URL: deep link, voltar/avançar e F5 mantêm a tela. A API é a mesma de antes
 * (`[route, setRoute]`), então as telas continuam recebendo `onNavigate` sem saber que há um router.
 *
 * `keepParams` preserva flags que não fazem parte da rota (ex.: `?c3shell` enquanto o shell novo é avaliado);
 * sem isso a primeira navegação as descartaria.
 */
export function useRoute(keepParams: string[] = []): [Route, (route: Route) => void] {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const route = useMemo(() => pathToRoute(pathname, search), [pathname, search]);
  const keep = keepParams.join(',');
  const setRoute = useCallback(
    (next: Route) => {
      const [path, query = ''] = routeToPath(next).split('?');
      const params = new URLSearchParams(query);
      const current = new URLSearchParams(search);
      for (const key of keep.split(',').filter(Boolean)) {
        const value = current.get(key);
        if (value !== null && !params.has(key)) params.set(key, value);
      }
      const finalQuery = params.toString();
      navigate(finalQuery ? `${path}?${finalQuery}` : path);
    },
    [navigate, search, keep],
  );
  return [route, setRoute];
}
