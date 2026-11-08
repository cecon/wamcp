import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect } from 'vitest';

/** O menu lateral do shell (AppLayout do C3Theme) é `navigation`; itens folha são links, grupos são botões. */
export function nav() {
  return screen.getByRole('navigation');
}

function inNav() {
  return within(nav());
}

export function navItem(name: string | RegExp) {
  const seen = inNav();
  const found = seen.queryByRole('link', { name }) ?? seen.queryByRole('button', { name });
  if (!found) throw new Error(`Item de menu não encontrado: ${String(name)}`);
  return found;
}

export function navQuery(name: string | RegExp) {
  const seen = inNav();
  return seen.queryByRole('link', { name }) ?? seen.queryByRole('button', { name });
}

export async function navFind(name: string | RegExp) {
  await waitFor(() => expect(navQuery(name)).toBeTruthy());
  return navItem(name);
}

const GROUPS = ['Conversas', 'Relatórios', 'Configurações'];

/**
 * Clica num item do menu abrindo o grupo dono quando preciso (o AppLayout começa com os grupos fechados e
 * os itens de conversas/relatórios/configurações vivem dentro deles).
 */
export async function click(user: UserEvent, name: string | RegExp) {
  const direct = navQuery(name);
  if (direct) return user.click(direct);
  for (const group of GROUPS) {
    const toggle = inNav().queryByRole('button', { name: group });
    if (!toggle) continue;
    await user.click(toggle);
    const found = navQuery(name);
    if (found) return user.click(found);
  }
  throw new Error(`Item de menu não encontrado: ${String(name)}`);
}
