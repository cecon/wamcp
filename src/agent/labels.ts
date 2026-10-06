import type { ConversationStatus } from './types';

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
};
export const OPERATORS: Record<string, string> = {
  equal_to: 'é igual a',
  not_equal_to: 'é diferente de',
  contains: 'contém',
  does_not_contain: 'não contém',
  is_present: 'está preenchido',
  is_not_present: 'está vazio',
};
export const ACTIONS: Record<string, string> = {
  assign_agent: 'Atribuir agente',
  assign_team: 'Atribuir time',
  add_label: 'Adicionar etiqueta',
  remove_label: 'Remover etiqueta',
  send_message: 'Enviar mensagem',
  add_private_note: 'Adicionar nota interna',
  resolve_conversation: 'Resolver conversa',
  open_conversation: 'Abrir conversa',
  set_priority: 'Definir prioridade',
};
export const PRIORITY_LABEL: Record<string, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  urgent: 'Urgente',
};
