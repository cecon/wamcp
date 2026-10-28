import type { RosterAgent } from '../../adminTypes';
import { executes } from '../directory/labels';

/** Members grouped under who they answer to; a missing or unknown boss puts them at the top. */
export function buildTree(roster: RosterAgent[]) {
  const ids = new Set(roster.map((a) => a.id));
  const children = new Map<number | null, RosterAgent[]>();
  for (const agent of roster) {
    const boss = agent.supervisor_id && ids.has(agent.supervisor_id) ? agent.supervisor_id : null;
    children.set(boss, [...(children.get(boss) || []), agent]);
  }
  return (id: number | null) => children.get(id) || [];
}

/** What the tree says is off: coordinators nobody answers to, and AI executors nobody delegates to. */
export function warnings(roster: RosterAgent[]) {
  const below = buildTree(roster);
  const list: string[] = [];
  for (const agent of roster.filter((a) => a.active)) {
    if (agent.role === 'coordinator' && below(agent.id).length === 0)
      list.push(`${agent.name} coordena, mas ninguém responde a ele: não tem para quem delegar.`);
    if (agent.kind === 'ai' && executes(agent.role) && !agent.supervisor_id)
      list.push(`${agent.name} executa, mas não responde a ninguém: nenhum coordenador delega para ele.`);
  }
  return list;
}
