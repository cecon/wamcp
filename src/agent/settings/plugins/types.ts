/** A plugin as `GET /plugins` lists it (the manifest plus its install state). */
export interface PluginTool {
  name: string;
  description: string;
  side_effects: boolean;
  sensitive: boolean;
  internal_only: boolean;
  endpoint: { kind: 'http' | 'mcp' | 'builtin'; url: string; credential?: string | null };
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
  };
  enabled: boolean;
  builtin: boolean;
  installed: string;
  updated: string;
  credentials_set: string[];
}
