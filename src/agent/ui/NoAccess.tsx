import { Lock } from 'lucide-react';

/** Shown when the agent's role does not allow the page (or the server answered 403). */
export function NoAccess() {
  return (
    <div
      role="alert"
      className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center"
    >
      <Lock size={24} className="text-n-slate-10" />
      <p className="text-heading-3 text-n-slate-12">Você não tem acesso a esta página</p>
      <p className="max-w-sm text-sm text-n-slate-11">
        Seu perfil não inclui esta permissão. Fale com um administrador se precisar de acesso.
      </p>
    </div>
  );
}
