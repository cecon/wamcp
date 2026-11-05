import type { ReactNode } from 'react';

// C3Theme
import { Panel } from '@c3theme/ui';

import type { User } from '../types';
import { SettingsC3Header, SettingsC3Page } from '../settings/c3/SettingsC3';
import { MfaSection } from './MfaSection';
import { NotificationPreferences } from './NotificationPreferences';
import { SessionsSection } from './SessionsSection';

/** Bloco do perfil no `Panel` do pacote: título e nota em cima, controles embaixo. */
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
    <Panel title={title} subtitle={note}>
      {children}
    </Panel>
  );
}

/** Configurações do perfil no C3Theme (lote 5): casca migrada; as seções seguem no app por enquanto. */
export function ProfilePage({ user }: { user: User }) {
  return (
    <SettingsC3Page>
      <SettingsC3Header title="Configurações do perfil" description={`${user.name} · ${user.email}`} />
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
    </SettingsC3Page>
  );
}
