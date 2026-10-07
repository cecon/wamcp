import type { ReactNode } from 'react';
import type { User } from '../types';
import { SettingsHeader, SettingsPage } from '../ui/Settings';
import { MfaSection } from './MfaSection';
import { NotificationPreferences } from './NotificationPreferences';
import { SessionsSection } from './SessionsSection';

/** Chatwoot profile settings block: title and note on the left, controls on the right. */
export function ProfileSection({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`profile-${title}`}
      className="grid gap-4 border-b border-n-weak py-8 last:border-b-0 lg:grid-cols-[1fr_2fr]"
    >
      <div>
        <h2 id={`profile-${title}`} className="text-heading-2 text-n-slate-12">
          {title}
        </h2>
        <p className="mt-1 text-sm text-n-slate-11">{note}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** Chatwoot "Configurações do perfil": notification preferences and account security. */
export function ProfilePage({ user }: { user: User }) {
  return (
    <SettingsPage>
      <SettingsHeader title="Configurações do perfil" description={`${user.name} · ${user.email}`} />
      <ProfileSection
        title="Notificações"
        note="Escolha quais eventos geram notificações e como o navegador avisa você."
      >
        <NotificationPreferences />
      </ProfileSection>
      <ProfileSection
        title="Verificação em duas etapas"
        note="Proteja sua conta com um código temporário (TOTP) do aplicativo autenticador além da senha."
      >
        <MfaSection />
      </ProfileSection>
      <ProfileSection
        title="Sessões ativas"
        note="Navegadores conectados à sua conta. Encerre os que você não reconhece."
      >
        <SessionsSection />
      </ProfileSection>
    </SettingsPage>
  );
}
