import type { AttributeDisplayType, ConversationStatus, ConversationType, FilterType } from './types';

export const STATUS_LABEL: Record<ConversationStatus | 'all', string> = {
  open: 'Abertas',
  pending: 'Pendentes (IA)',
  snoozed: 'Adiadas',
  resolved: 'Resolvidas',
  all: 'Todos os status',
};

export const WEBHOOK_EVENTS: Record<string, string> = {
  conversation_created: 'Conversa criada',
  conversation_status_changed: 'Status alterado',
  conversation_updated: 'Conversa atualizada',
  message_created: 'Mensagem criada',
  message_updated: 'Mensagem atualizada',
  contact_created: 'Contato criado',
  contact_updated: 'Contato atualizado',
  csat_created: 'Avaliação recebida',
};

export const AUTOMATION_EVENTS: Record<string, string> = {
  conversation_created: 'Conversa criada',
  conversation_updated: 'Conversa atualizada',
  conversation_opened: 'Conversa aberta/reaberta',
  conversation_resolved: 'Conversa resolvida',
  message_created: 'Mensagem criada',
};
export const CONDITION_ATTRIBUTES: Record<string, string> = {
  content: 'Conteúdo da mensagem',
  message_type: 'Tipo da mensagem',
  status: 'Status',
  inbox_id: 'Caixa de entrada',
  assignee_id: 'Responsável',
  team_id: 'Time',
  labels: 'Etiquetas',
  contact_phone: 'Telefone do contato',
  contact_name: 'Nome do contato',
  contact_email: 'E-mail do contato',
  priority: 'Prioridade',
};
export const OPERATORS: Record<string, string> = {
  equal_to: 'é igual a',
  not_equal_to: 'é diferente de',
  contains: 'contém',
  does_not_contain: 'não contém',
  is_present: 'está preenchido',
  is_not_present: 'está vazio',
};
/** Automation conditions also accept "começa com". */
export const AUTOMATION_OPERATORS: Record<string, string> = { ...OPERATORS, starts_with: 'começa com' };
export const ACTIONS: Record<string, string> = {
  assign_agent: 'Atribuir agente',
  assign_team: 'Atribuir time',
  remove_assigned_agent: 'Remover agente atribuído',
  remove_assigned_team: 'Remover time atribuído',
  add_label: 'Adicionar etiqueta',
  remove_label: 'Remover etiqueta',
  send_message: 'Enviar mensagem',
  add_private_note: 'Adicionar nota interna',
  resolve_conversation: 'Resolver conversa',
  open_conversation: 'Abrir conversa',
  pending_conversation: 'Marcar como pendente',
  snooze_conversation: 'Adiar conversa',
  mute_conversation: 'Silenciar conversa',
  change_priority: 'Alterar prioridade',
  set_priority: 'Definir prioridade',
};
export const PRIORITY_LABEL: Record<string, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  urgent: 'Urgente',
};
/** Advanced filter operators (automation rules use the first six). */
export const FILTER_OPERATORS: Record<string, string> = {
  ...OPERATORS,
  is_greater_than: 'é maior que',
  is_less_than: 'é menor que',
  days_before: 'há mais de (dias)',
};
export const SORT_LABEL: Record<string, string> = {
  last_activity_at_desc: 'Última atividade: mais recentes',
  last_activity_at_asc: 'Última atividade: mais antigas',
  created_at_desc: 'Criação: mais recentes',
  created_at_asc: 'Criação: mais antigas',
  priority_desc: 'Prioridade: mais alta primeiro',
  priority_asc: 'Prioridade: mais baixa primeiro',
  waiting_since_asc: 'Aguardando resposta: há mais tempo',
  waiting_since_desc: 'Aguardando resposta: há menos tempo',
};
export const CONVERSATION_TYPE_LABEL: Record<ConversationType, string> = {
  mentions: 'Menções',
  unattended: 'Não atendidas',
  participating: 'Participando',
};
export const ATTRIBUTE_TYPE_LABEL: Record<AttributeDisplayType, string> = {
  text: 'Texto',
  number: 'Número',
  currency: 'Moeda',
  percent: 'Porcentagem',
  link: 'Link',
  date: 'Data',
  list: 'Lista',
  checkbox: 'Caixa de seleção',
};
export const ATTRIBUTE_MODEL_LABEL: Record<FilterType, string> = {
  conversation: 'Conversa',
  contact: 'Contato',
};
