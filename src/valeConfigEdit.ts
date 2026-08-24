/**
 * Small, targeted helpers for editing two specific comma-separated list
 * keys in a .vale.ini file: a top-level key (e.g. `Packages`) and a key
 * scoped to a `[glob]` section (e.g. `BasedOnStyles` under `[*.md]`).
 *
 * This intentionally does NOT parse/rewrite the whole ini file - it edits
 * matched lines in place and preserves everything else (comments, other
 * sections, formatting) untouched. A full config manager (arbitrary keys,
 * per-rule severities, generating sections from scratch) is a separate,
 * larger roadmap item.
 */

function parseList(value: string): string[] {
  return value.split(',').map((v) => v.trim()).filter(Boolean);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findSectionBounds(lines: string[], section: string): { start: number; end: number } | null {
  const header = `[${section}]`;
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) {
    return null;
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

function setTopLevelListKey(text: string, key: string, mutate: (values: string[]) => string[]): string {
  const lines = text.split('\n');
  const keyRegex = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`);
  const firstSectionIdx = lines.findIndex((line) => /^\s*\[/.test(line));
  const topEnd = firstSectionIdx === -1 ? lines.length : firstSectionIdx;

  for (let i = 0; i < topEnd; i++) {
    const match = lines[i].match(keyRegex);
    if (match) {
      const updated = mutate(parseList(match[1]));
      lines[i] = `${key} = ${updated.join(', ')}`;
      return lines.join('\n');
    }
  }

  const updated = mutate([]);
  const newLine = `${key} = ${updated.join(', ')}`;
  if (firstSectionIdx === -1) {
    lines.push(newLine);
  } else {
    lines.splice(firstSectionIdx, 0, newLine);
  }
  return lines.join('\n');
}

function setSectionListKey(
  text: string,
  section: string,
  key: string,
  mutate: (values: string[]) => string[]
): string {
  const lines = text.split('\n');
  const keyRegex = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`);
  const bounds = findSectionBounds(lines, section);

  if (!bounds) {
    const updated = mutate([]);
    if (lines.length > 0 && lines[lines.length - 1].trim() !== '') {
      lines.push('');
    }
    lines.push(`[${section}]`, `${key} = ${updated.join(', ')}`);
    return lines.join('\n');
  }

  for (let i = bounds.start + 1; i < bounds.end; i++) {
    const match = lines[i].match(keyRegex);
    if (match) {
      const updated = mutate(parseList(match[1]));
      lines[i] = `${key} = ${updated.join(', ')}`;
      return lines.join('\n');
    }
  }

  const updated = mutate([]);
  lines.splice(bounds.end, 0, `${key} = ${updated.join(', ')}`);
  return lines.join('\n');
}

export function readSectionListKey(text: string, section: string, key: string): string[] {
  const lines = text.split('\n');
  const bounds = findSectionBounds(lines, section);
  if (!bounds) {
    return [];
  }

  const keyRegex = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`);
  for (let i = bounds.start + 1; i < bounds.end; i++) {
    const match = lines[i].match(keyRegex);
    if (match) {
      return parseList(match[1]);
    }
  }
  return [];
}

function addUnique(values: string[], name: string): string[] {
  return values.includes(name) ? values : [...values, name];
}

function removeValue(values: string[], name: string): string[] {
  return values.filter((v) => v !== name);
}

export function addToTopLevelList(text: string, key: string, name: string): string {
  return setTopLevelListKey(text, key, (values) => addUnique(values, name));
}

export function removeFromTopLevelList(text: string, key: string, name: string): string {
  return setTopLevelListKey(text, key, (values) => removeValue(values, name));
}

export function addToSectionList(text: string, section: string, key: string, name: string): string {
  return setSectionListKey(text, section, key, (values) => addUnique(values, name));
}

export function removeFromSectionList(text: string, section: string, key: string, name: string): string {
  return setSectionListKey(text, section, key, (values) => removeValue(values, name));
}

// ---------------------------------------------------------------------------
// Single-value keys (for per-rule severity overrides, e.g.
// `write-good.Passive = warning` under `[*.md]`)
// ---------------------------------------------------------------------------

export function readSectionKeyValue(text: string, section: string, key: string): string | undefined {
  const lines = text.split('\n');
  const bounds = findSectionBounds(lines, section);
  if (!bounds) {
    return undefined;
  }

  const keyRegex = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(.*)$`);
  for (let i = bounds.start + 1; i < bounds.end; i++) {
    const match = lines[i].match(keyRegex);
    if (match) {
      return match[1].trim();
    }
  }
  return undefined;
}

export function setSectionKeyValue(text: string, section: string, key: string, value: string): string {
  const lines = text.split('\n');
  const keyRegex = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(.*)$`);
  const bounds = findSectionBounds(lines, section);

  if (!bounds) {
    if (lines.length > 0 && lines[lines.length - 1].trim() !== '') {
      lines.push('');
    }
    lines.push(`[${section}]`, `${key} = ${value}`);
    return lines.join('\n');
  }

  for (let i = bounds.start + 1; i < bounds.end; i++) {
    if (keyRegex.test(lines[i])) {
      lines[i] = `${key} = ${value}`;
      return lines.join('\n');
    }
  }

  lines.splice(bounds.end, 0, `${key} = ${value}`);
  return lines.join('\n');
}

export function removeSectionKey(text: string, section: string, key: string): string {
  const lines = text.split('\n');
  const bounds = findSectionBounds(lines, section);
  if (!bounds) {
    return text;
  }

  const keyRegex = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(.*)$`);
  for (let i = bounds.start + 1; i < bounds.end; i++) {
    if (keyRegex.test(lines[i])) {
      lines.splice(i, 1);
      return lines.join('\n');
    }
  }
  return text;
}

// ---------------------------------------------------------------------------
// Rule override semantics: `RuleName = NO` disables a rule, `RuleName =
// suggestion|warning|error` overrides its severity, and no key at all means
// "use the style's default".
// ---------------------------------------------------------------------------

export type RuleOverride = 'default' | 'suggestion' | 'warning' | 'error' | 'disabled';

export function parseRuleOverride(value: string | undefined): RuleOverride {
  if (value === undefined) {
    return 'default';
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'no') {
    return 'disabled';
  }
  if (normalized === 'suggestion' || normalized === 'warning' || normalized === 'error') {
    return normalized;
  }
  return 'default';
}

/** Returns the ini value to write, or null to mean "remove the key". */
export function ruleOverrideToValue(override: RuleOverride): string | null {
  if (override === 'default') {
    return null;
  }
  if (override === 'disabled') {
    return 'NO';
  }
  return override;
}
