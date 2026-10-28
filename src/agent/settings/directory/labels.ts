import type { AgentCredential, RosterAgent, RosterRole } from '../../adminTypes';

export const ROLES: { value: RosterRole; label: string; hint: string }[] = [
  { value: 'coordinator', label: 'Coordenador', hint: 'Nunca executa: só delega para operadores.' },
  { value: 'operator', label: 'Operador', hint: 'Executa as tarefas com as suas skills.' },
  { value: 'dev_support', label: 'Suporte dev', hint: 'Operador especializado em problemas técnicos.' },
  { value: 'qa', label: 'QA', hint: 'Revisa o trabalho dos operadores.' },
];

/** Agentic runtimes (keep in sync with RUNTIMES in the backend; /agent_runtimes says which are installed). OpenCode runs
 * any provider's model (provedor/modelo, OpenRouter included) and is the agentic engine's runtime. */
export const RUNTIMES = [
  { value: 'claude_cli', label: 'Claude Code' },
  { value: 'codex_cli', label: 'Codex CLI' },
  { value: 'opencode', label: 'OpenCode' },
];

export const CREDENTIAL_KINDS: { value: AgentCredential['kind']; label: string }[] = [
  { value: 'api_key', label: 'Chave de API' },
  { value: 'bearer', label: 'Token Bearer' },
  { value: 'basic', label: 'Usuário e senha (Basic)' },
  { value: 'secret', label: 'Outro segredo' },
];

export const roleLabel = (role: string) => ROLES.find((r) => r.value === role)?.label ?? role;
export const runtimeLabel = (runtime: string | null) =>
  RUNTIMES.find((r) => r.value === runtime)?.label ?? runtime ?? '';
/** People and AI share the roles: coordinators delegate, the other roles execute (and hold skills). */
export const executes = (role: string | null) => Boolean(role) && role !== 'coordinator';
/** Credentials are used by an AI agent's tools on the server: only AI agents that execute hold them. */
export const holdsCredentials = (agent: Pick<RosterAgent, 'kind' | 'role'>) =>
  agent.kind === 'ai' && executes(agent.role);
export const phone = (jid: string | null) => (jid ? `+${jid.split('@')[0]}` : '');
