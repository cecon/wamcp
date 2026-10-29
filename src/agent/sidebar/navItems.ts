import {
  Bolt,
  Bot,
  Braces,
  Briefcase,
  Inbox as InboxIcon,
  MessageSquareText,
  MonitorCog,
  Network,
  Repeat,
  ScrollText,
  Sparkles,
  ShieldCheck,
  SquareUser,
  Tags,
  Timer,
  Users,
  Webhook,
  Workflow,
} from 'lucide-react';
import type { ReportSection, SettingsSection } from '../route';

/** Settings entries of the sidebar (Chatwoot order); `desktop` ones exist only in the Tauri window. */
export const SETTINGS: { section: SettingsSection; label: string; icon: typeof Bolt; desktop?: boolean }[] = [
  { section: 'account', label: 'Configurações da conta', icon: Briefcase },
  { section: 'agents', label: 'Funcionários', icon: SquareUser },
  { section: 'organization', label: 'Organização', icon: Network },
  { section: 'teams', label: 'Times', icon: Users },
  { section: 'inboxes', label: 'Canais', icon: InboxIcon },
  { section: 'labels', label: 'Etiquetas', icon: Tags },
  { section: 'attributes', label: 'Atributos personalizados', icon: Braces },
  { section: 'canned', label: 'Respostas prontas', icon: MessageSquareText },
  { section: 'automation', label: 'Automação', icon: Repeat },
  { section: 'skills', label: 'Skills', icon: Sparkles },
  { section: 'macros', label: 'Macros', icon: Workflow },
  { section: 'sla', label: 'SLA', icon: Timer },
  { section: 'webhooks', label: 'Webhooks', icon: Webhook },
  { section: 'audit', label: 'Registro de auditoria', icon: ScrollText },
  { section: 'custom_roles', label: 'Perfis', icon: ShieldCheck },
  { section: 'engine', label: 'Motor de agentes', icon: Bot },
  { section: 'app', label: 'Aplicativo', icon: MonitorCog, desktop: true },
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
