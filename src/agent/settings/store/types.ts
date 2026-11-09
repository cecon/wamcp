import type { Plugin } from '../plugins/types';

/** What is installed here of a store skill (`installed` in `GET /store`). */
export interface Installed {
  version: string;
  enabled: boolean;
  /** The store has a newer version. */
  update: boolean;
  credentials_missing: string[];
}

interface Card {
  id: string;
  name: string;
  description: string;
  category: string;
  /** An icon name (`calculator`, `bike`…); unknown names get the default. */
  icon: string;
  version: string;
}

/** A skill of the store: one plugin. */
export interface StorePlugin extends Card {
  url: string;
  docs: string | null;
  installed: Installed | null;
}

export interface TemplateGrant {
  tool: string;
  effect: 'allow' | 'approval';
}

/** An agent template: its plugin plus the agent that uses it. */
export interface AgentTemplate extends Card {
  plugin: string;
  agent_name: string;
  role: string;
  runtime: string;
  model: string | null;
  instructions: string;
  goals: string[];
  tools: TemplateGrant[];
  schedules: string[];
}

export interface StoreAgent extends AgentTemplate {
  plugin_installed: Installed | null;
}

/** `GET /store`. */
export interface Store {
  name: string;
  source: string;
  default_source: boolean;
  plugins: StorePlugin[];
  agents: StoreAgent[];
}

/** `GET /store/agents/{id}`: the template and what its plugin brings. */
export interface TemplatePreview {
  template: AgentTemplate;
  plugin: Omit<StorePlugin, 'installed'>;
  manifest: Plugin['manifest'];
  credentials_set: string[];
}

/** `POST /store/agents/{id}`. */
export interface AgentInstall {
  agent: { id: number; name: string };
  plugin: Plugin;
  granted: string[];
  routines: string[];
  /** What the administrator still has to do. */
  pending: string[];
}
