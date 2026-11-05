import React from 'react';
import AgentApp from './AgentApp';

// Spike de adoção do C3Theme (Fase 1): carregado só com `?c3spike`, em chunk separado, para medir a convivência.
const C3Spike = React.lazy(() => import('./c3/spike'));

const c3Spike = new URLSearchParams(window.location.search).has('c3spike');

/** Escolhe entre o app real e o spike do C3Theme. */
export default function Entry() {
  if (!c3Spike) return <AgentApp />;
  return (
    <React.Suspense fallback={<p className="p-6 text-sm text-n-slate-11">Carregando spike do C3Theme…</p>}>
      <C3Spike />
    </React.Suspense>
  );
}
