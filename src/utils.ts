import * as path from 'path';
import { Vault } from 'obsidian';

/**
 * Ensures that a path is absolute. If the path is relative, it will be
 * resolved relative to the vault's base path.
 */
export function ensureAbsolutePath(inputPath: string, vault: Vault): string {
  if (!inputPath || inputPath.trim() === '') {
    return '';
  }

  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }

  const adapter = vault.adapter as any;
  const basePath = adapter.basePath || adapter.getBasePath?.() || '';
  return path.join(basePath, inputPath);
}
