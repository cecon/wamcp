# Progresso da migração para o C3Theme

Gerado por `node scripts/c3-progresso.mjs` (o `--check` recusa este arquivo desatualizado). Uma tela conta como
**migrada** quando importa MUI/`@c3theme/*`; conta como **pendente** quando ainda desenha com `className` e não
usa o pacote. Arquivos sem interface (hooks, tipos) ficam fora. Spike, shell do C3Theme e bootstrap também.

**56 de 155 telas migradas (36%)** · faltam 99

| Pasta | Migradas | Faltam |
|---|---:|---:|
| (raiz) | 2 / 4 | 2 |
| agentChat | 0 / 4 | 4 |
| attributes | 0 / 2 | 2 |
| auth | 3 / 3 | 0 |
| chat | 3 / 3 | 0 |
| contacts | 8 / 10 | 2 |
| conversations | 22 / 25 | 3 |
| desktop | 0 / 1 | 1 |
| filters | 0 / 3 | 3 |
| macros | 0 / 1 | 1 |
| notifications | 0 / 3 | 3 |
| profile | 1 / 7 | 6 |
| reports | 8 / 9 | 1 |
| search | 1 / 3 | 2 |
| settings | 8 / 63 | 55 |
| shortcuts | 0 / 1 | 1 |
| sidebar | 0 / 3 | 3 |
| sla | 0 / 2 | 2 |
| ui | 0 / 8 | 8 |

## O que falta, por pasta

### (raiz)

- `AgentApp.tsx`
- `Workspace.tsx`

### agentChat

- `agentChat/AgentChatScreen.tsx`
- `agentChat/AgentChatThread.tsx`
- `agentChat/ChatMarkdown.tsx`
- `agentChat/ChatSessionBar.tsx`

### attributes

- `attributes/AttributeInput.tsx`
- `attributes/AttributesSection.tsx`

### contacts

- `contacts/ContactDetail.tsx`
- `contacts/ContactsToolbar.tsx`

### conversations

- `conversations/ConversationsScreen.tsx`
- `conversations/NewChatModal.tsx`
- `conversations/whatsappFormat.tsx`

### desktop

- `desktop/UpdateNotice.tsx`

### filters

- `filters/ConditionRow.tsx`
- `filters/FilterModal.tsx`
- `filters/SavedViewControls.tsx`

### macros

- `macros/MacroRunner.tsx`

### notifications

- `notifications/NotificationBell.tsx`
- `notifications/NotificationItem.tsx`
- `notifications/NotificationList.tsx`

### profile

- `profile/BackupCodes.tsx`
- `profile/MfaModals.tsx`
- `profile/MfaSection.tsx`
- `profile/NotificationPreferences.tsx`
- `profile/qr/QrCode.tsx`
- `profile/SessionsSection.tsx`

### reports

- `reports/CsatResponses.tsx`

### search

- `search/Highlight.tsx`
- `search/SearchResults.tsx`

### settings

- `settings/ActionsEditor.tsx`
- `settings/AgentModal.tsx`
- `settings/app/AppSettingsPage.tsx`
- `settings/AuditLogPage.tsx`
- `settings/AutomationPage.tsx`
- `settings/ConditionsEditor.tsx`
- `settings/connections/AuditList.tsx`
- `settings/connections/ChatGptLink.tsx`
- `settings/connections/ConnectionDetailPage.tsx`
- `settings/connections/ConnectionsPage.tsx`
- `settings/connections/ConnectionStatus.tsx`
- `settings/connections/HistoryMessages.tsx`
- `settings/connections/HistoryViewer.tsx`
- `settings/connections/McpAccess.tsx`
- `settings/connections/PairingPanel.tsx`
- `settings/DeliveriesPanel.tsx`
- `settings/directory/AccessSection.tsx`
- `settings/directory/AgentRosterModal.tsx`
- `settings/directory/CredentialsPanel.tsx`
- `settings/directory/RosterSection.tsx`
- `settings/directory/RuntimeSelect.tsx`
- `settings/directory/SkillModal.tsx`
- `settings/directory/SkillPicker.tsx`
- `settings/directory/SkillsPage.tsx`
- `settings/engine/ActivityPanel.tsx`
- `settings/engine/AskModal.tsx`
- `settings/engine/EnginePage.tsx`
- `settings/engine/PermissionsPanel.tsx`
- `settings/engine/StatusPill.tsx`
- `settings/github/ConnectGithubModal.tsx`
- `settings/github/GithubSetup.tsx`
- `settings/github/WebhookInstructions.tsx`
- `settings/InboxAgentSelect.tsx`
- `settings/InboxAutomation.tsx`
- `settings/InboxesPage.tsx`
- `settings/InboxLimit.tsx`
- `settings/MacroEditor.tsx`
- `settings/members/AvatarEditor.tsx`
- `settings/members/MemberAvatar.tsx`
- `settings/members/MemberCard.tsx`
- `settings/members/MemberDetail.tsx`
- `settings/members/OrganizationPage.tsx`
- `settings/members/SalaryRatesForm.tsx`
- `settings/members/UsageChart.tsx`
- `settings/roles/CustomRoleModal.tsx`
- `settings/roles/CustomRolesPage.tsx`
- `settings/RuleEditor.tsx`
- `settings/schedules/RunHistory.tsx`
- `settings/schedules/ScheduleEditor.tsx`
- `settings/schedules/SchedulesPage.tsx`
- `settings/SettingsRouter.tsx`
- `settings/SlaModal.tsx`
- `settings/TeamsPage.tsx`
- `settings/ValueInput.tsx`
- `settings/WebhooksPage.tsx`

### shortcuts

- `shortcuts/ShortcutsModal.tsx`

### sidebar

- `sidebar/ProfileMenu.tsx`
- `sidebar/Sidebar.tsx`
- `sidebar/SidebarParts.tsx`

### sla

- `sla/SlaBadge.tsx`
- `sla/SlaSection.tsx`

### ui

- `ui/Accordion.tsx`
- `ui/Avatar.tsx`
- `ui/Button.tsx`
- `ui/Confirm.tsx`
- `ui/NoAccess.tsx`
- `ui/Overlay.tsx`
- `ui/SecretField.tsx`
- `ui/Settings.tsx`
