/** A plugin as `GET /plugins` lists it (the manifest plus its install state). */
export interface PluginTool {
  name: string;
  description: string;
  side_effects: boolean;
  sensitive: boolean;
  internal_only: boolean;
  contact_scoped?: boolean;
  endpoint: { kind: 'http' | 'mcp' | 'builtin'; url: string; credential?: string | null };
}

export interface PluginSchedule {
  name: string;
  description: string;
  cron: string;
  prompt: string;
}

export interface Plugin {
  manifest: {
    id: string;
    name: string;
    version: string;
    description: string;
    skills: { name: string; description: string }[];
    tools: PluginTool[];
    credentials: { name: string; help: string }[];
    schedules: PluginSchedule[];
  };
  enabled: boolean;
  builtin: boolean;
  installed: string;
  updated: string;
  /** Where it was installed from (`https://…/plugin.json`), for updates. */
  source: string | null;
  credentials_set: string[];
}

/** `POST /plugins/{id}/update`. */
export interface UpdateOutcome {
  updated: boolean;
  previous_version: string;
  plugin: Plugin;
}
