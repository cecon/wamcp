# Progresso da migração para o C3Theme

Gerado por `node scripts/c3-progresso.mjs` (o `--check` recusa este arquivo desatualizado). Uma tela conta como
**migrada** quando importa MUI/`@c3theme/*`; conta como **pendente** quando ainda desenha com `className` e não
usa o pacote. Arquivos sem interface (hooks, tipos) ficam fora. Spike, shell do C3Theme e bootstrap também.

**173 de 177 telas migradas (98%)** · faltam 4

| Pasta | Migradas | Faltam |
|---|---:|---:|
| (raiz) | 4 / 4 | 0 |
| agentChat | 6 / 6 | 0 |
| agentPage | 7 / 7 | 0 |
| agentRuns | 2 / 2 | 0 |
| attributes | 2 / 2 | 0 |
| auth | 3 / 3 | 0 |
| chat | 3 / 3 | 0 |
| contacts | 10 / 10 | 0 |
| conversations | 26 / 26 | 0 |
| desktop | 1 / 1 | 0 |
| filters | 3 / 3 | 0 |
| macros | 1 / 1 | 0 |
| notifications | 3 / 3 | 0 |
| profile | 7 / 7 | 0 |
| reports | 9 / 9 | 0 |
| search | 3 / 3 | 0 |
| settings | 68 / 72 | 4 |
| shortcuts | 1 / 1 | 0 |
| sidebar | 4 / 4 | 0 |
| sla | 2 / 2 | 0 |
| ui | 8 / 8 | 0 |

## O que falta, por pasta

### settings

- `settings/plugins/CredentialsModal.tsx`
- `settings/plugins/InstallModal.tsx`
- `settings/plugins/PluginsPage.tsx`
- `settings/plugins/RoutineModal.tsx`
