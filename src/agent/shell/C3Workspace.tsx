import type { ComponentProps } from 'react';

import C3Provider from '../c3/C3Provider';
import { C3Shell } from './C3Shell';

/**
 * Entrada do shell novo para o `React.lazy`: provider do C3Theme + `AppLayout`. Fica num módulo próprio para o
 * MUI/Emotion só entrarem no bundle quando o shell for usado (flag `?c3shell` nesta fase; padrão depois).
 */
export default function C3Workspace(props: ComponentProps<typeof C3Shell>) {
  return (
    <C3Provider>
      <C3Shell {...props} />
    </C3Provider>
  );
}
