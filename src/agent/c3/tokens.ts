import type { C3ThemeProviderProps } from '@c3theme/ui';

/**
 * O tipo `C3Tokens` ainda não é exportado pelo `@c3theme/ui` (só o prop `tokens` do provider). Derivar do prop
 * mantém o mapa checado sem depender de import profundo (o ESLint do pacote proíbe). Pedido pequeno ao C3Theme:
 * exportar `C3Tokens`/`C3SchemeTokens`.
 */
type C3Tokens = NonNullable<C3ThemeProviderProps['tokens']>;

/**
 * Ponte entre o design system atual do app (`src/agent/styles/agent.css`) e o tema do C3Theme.
 *
 * O app nasceu espelhando a paleta do Chatwoot (`--color-n-*`); o C3Theme espera um subconjunto de papéis
 * (primária, fundo, papel, texto, divisória...). Enquanto as telas convivem, o tema C3 usa os mesmos valores do
 * CSS para não haver dois cinzas na mesma tela. Quando a migração terminar, este mapa pode ser trocado pela paleta
 * C3 pura sem tocar nas telas.
 *
 * Valores copiados de `agent.css` (light §10-85, dark §87-147). Ao mudar um token lá, mudar aqui também — o
 * spike de convivência (`?c3spike`) mostra os dois lado a lado.
 */
export const C3_TOKENS: C3Tokens = {
  light: {
    primary: '#2781f6', // --color-n-brand / blue-9
    secondary: '#5b6474',
    success: '#12a594', // teal-9
    warning: '#ab6400', // amber-11
    error: '#e54666', // ruby-9
    info: '#2781f6',
    background: '#f7f7f7', // --color-n-background
    paper: '#fefefe', // --color-n-surface-1
    text: '#1c2024', // slate-12
    textSecondary: '#60646c', // slate-11
    divider: '#e2e3e7', // --color-n-strong
    headerBg: '#ffffff',
    headerFg: '#1c2024',
  },
  dark: {
    primary: '#7eb6ff', // blue-11
    secondary: '#9aa4b2',
    success: '#0bd8b6', // teal-11
    warning: '#ffca16', // amber-11
    error: '#ff949d', // ruby-11
    info: '#7eb6ff',
    background: '#1c1d20', // --color-n-background (28 29 32)
    paper: '#141517', // --color-n-surface-1 (20 21 23)
    text: '#edeef0', // slate-12
    textSecondary: '#b0b4ba', // slate-11
    divider: '#2e2d32', // --color-n-strong
    headerBg: '#16171a', // --color-n-surface-2
    headerFg: '#edeef0',
  },
  radius: 8, // mesmo `rounded-lg` do Tailwind atual
  fontFamily: `'Inter Variable', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`,
};
