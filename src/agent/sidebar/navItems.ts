import {
  Bolt,
  Braces,
  Briefcase,
  Inbox as InboxIcon,
  MessageSquareText,
  Repeat,
  ScrollText,
  SquareUser,
  Tags,
  Timer,
  Users,
  Webhook,
  Workflow,
} from 'lucide-react';
import type { ReportSection, SettingsSection } from '../route';

/** Settings entries of the sidebar (Chatwoot order). */
export const SETTINGS: { section: SettingsSection; label: string; icon: typeof Bolt }[] = [
  { section: 'account', label: 'Configurações da conta', icon: Briefcase },
  { section: 'agents', label: 'Agentes', icon: SquareUser },
  { section: 'teams', label: 'Times', icon: Users },
  { section: 'inboxes', label: 'Caixas de entrada', icon: InboxIcon },
  { section: 'labels', label: 'Etiquetas', icon: Tags },
  { section: 'attributes', label: 'Atributos personalizados', icon: Braces },
  { section: 'canned', label: 'Respostas prontas', icon: MessageSquareText },
  { section: 'automation', label: 'Automação', icon: Repeat },
  { section: 'macros', label: 'Macros', icon: Workflow },
  { section: 'sla', label: 'SLA', icon: Timer },
  { section: 'webhooks', label: 'Webhooks', icon: Webhook },
  { section: 'audit', label: 'Registro de auditoria', icon: ScrollText },
];

/** Report pages of the sidebar (Chatwoot reports menu). */
export const REPORTS: { section: ReportSection; label: string }[] = [
  { section: 'overview', label: 'Visão geral' },
  { section: 'agents', label: 'Agentes' },
  { section: 'inboxes', label: 'Caixas de entrada' },
  { section: 'teams', label: 'Times' },
  { section: 'labels', label: 'Etiquetas' },
  { section: 'csat', label: 'CSAT' },
  { section: 'bots', label: 'Assistente IA' },
  { section: 'sla', label: 'SLA' },
];
