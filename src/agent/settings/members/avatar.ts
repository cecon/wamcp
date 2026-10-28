import type { AvatarChoices, RosterKind } from '../../adminTypes';

/** Choices of each avatar part (keep in sync with AVATAR_PARTS in the backend); the first is the default. */
export const AVATAR_PARTS = {
  skin: ['light', 'tan', 'brown', 'dark'],
  hair: ['short', 'long', 'curly', 'bun', 'none'],
  outfit: ['shirt', 'hoodie', 'suit', 'tshirt'],
  accessory: ['none', 'glasses', 'headset', 'cap'],
  color: ['teal', 'blue', 'violet', 'amber', 'ruby', 'iris'],
} as const;
export type AvatarPart = keyof typeof AVATAR_PARTS;

export const PART_LABELS: Record<AvatarPart, string> = {
  skin: 'Pele',
  hair: 'Cabelo',
  outfit: 'Roupa',
  accessory: 'Acessório',
  color: 'Cor',
};
export const CHOICE_LABELS: Record<string, string> = {
  light: 'Clara',
  tan: 'Morena clara',
  brown: 'Morena',
  dark: 'Escura',
  short: 'Curto',
  long: 'Longo',
  curly: 'Cacheado',
  bun: 'Coque',
  none: 'Nenhum',
  shirt: 'Camisa',
  hoodie: 'Moletom',
  suit: 'Terno',
  tshirt: 'Camiseta',
  glasses: 'Óculos',
  headset: 'Headset',
  cap: 'Boné',
  teal: 'Verde-água',
  blue: 'Azul',
  violet: 'Violeta',
  amber: 'Âmbar',
  ruby: 'Rubi',
  iris: 'Íris',
};

/** Fills every missing part; AI agents default to a headset so they read as agents at a glance. */
export function withDefaults(choices: AvatarChoices | undefined, kind: RosterKind, seed: number) {
  const pick = <P extends AvatarPart>(part: P) => {
    const options = AVATAR_PARTS[part];
    return options[seed % options.length];
  };
  return {
    skin: choices?.skin ?? pick('skin'),
    hair: choices?.hair ?? pick('hair'),
    outfit: choices?.outfit ?? (kind === 'ai' ? 'hoodie' : 'shirt'),
    accessory: choices?.accessory ?? (kind === 'ai' ? 'headset' : 'none'),
    color: choices?.color ?? pick('color'),
  };
}
