import type { AgentBot } from '../../adminTypes';

/** LLM providers the server can drive (keep in sync with LLM_PROVIDERS in the backend). */
export const LLM_PROVIDERS = [{ value: 'claude_cli', label: 'Claude Code (neste computador)' }];

export function llmLabel(bot: AgentBot) {
  const provider = LLM_PROVIDERS.find((p) => p.value === bot.provider)?.label ?? bot.provider ?? 'LLM';
  return bot.model ? `${provider} · ${bot.model}` : provider;
}
