import { useEffect, type ReactNode } from 'react';

// material-ui
import { StyledEngineProvider, useColorScheme } from '@mui/material/styles';

// C3Theme
import { C3ThemeProvider, Notifier } from '@c3theme/ui';
import type { Branding, UiConfig } from '@c3theme/ui';

import { useTheme as useAppTheme } from '../theme/theme';
import { C3_TOKENS } from './tokens';

const BRANDING: Partial<Branding> = { name: 'WhatsAppMcp', homePath: '/app/' };
const DEFAULT_CONFIG = { brand: 'blue', locale: 'pt-BR' } as const satisfies Partial<UiConfig>;

/**
 * Um só dono do claro/escuro: o app escreve `data-theme` no `<html>` (o Tailwind depende dele) e o MUI passa a
 * seguir a mesma escolha. Se o usuário trocar pelo painel do C3Theme, a escolha volta para o app — assim as telas
 * ainda em Tailwind e as já migradas nunca ficam em modos diferentes.
 */
function ColorModeBridge() {
  const { mode: muiMode, setMode } = useColorScheme();
  const [appMode, setAppMode] = useAppTheme();

  useEffect(() => {
    setMode(appMode);
  }, [appMode, setMode]);

  useEffect(() => {
    if (muiMode && muiMode !== appMode) setAppMode(muiMode);
  }, [muiMode, appMode, setAppMode]);

  return null;
}

/**
 * Fundação do C3Theme no app: Emotion injetado antes do Tailwind (`injectFirst`, senão utilitário do app perde
 * para o MUI), tema com os tokens do `agent.css`, idioma pt-BR e o aviso global do pacote.
 *
 * Montado onde há tela C3 (spike hoje, shell na próxima fase); a árvore inteira continua em Tailwind até a
 * migração das telas — por isso o provider não envolve o `AgentApp` ainda: o `CssBaseline` do pacote mudaria
 * tipografia e margens de telas que ninguém migrou.
 */
export default function C3Provider({ children }: { children: ReactNode }) {
  return (
    <StyledEngineProvider injectFirst>
      <C3ThemeProvider
        branding={BRANDING}
        defaultConfig={DEFAULT_CONFIG}
        storageKey="wamcp.agent.c3"
        tokens={C3_TOKENS}
      >
        <ColorModeBridge />
        {children}
        <Notifier />
      </C3ThemeProvider>
    </StyledEngineProvider>
  );
}
