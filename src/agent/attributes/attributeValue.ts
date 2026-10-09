import type { AttributeDefinition, FilterValue } from '../types';

const NUMERIC = new Set(['number', 'currency', 'percent']);

/** Text typed by the agent → the JSON value the API expects (`null` clears the attribute). */
export function parseAttribute(definition: AttributeDefinition, text: string): FilterValue | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return NUMERIC.has(definition.attribute_display_type) ? Number(trimmed) : trimmed;
}

/** Client-side check of the regex pattern (the server validates again); returns the cue on mismatch. */
export function patternError(definition: AttributeDefinition, value: FilterValue | null) {
  if (!definition.regex_pattern || typeof value !== 'string') return '';
  try {
    if (new RegExp(definition.regex_pattern).test(value)) return '';
  } catch {
    return '';
  }
  return definition.regex_cue || 'O valor não segue o formato exigido';
}
