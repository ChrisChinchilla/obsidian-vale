import * as path from 'path';
import * as fs from 'fs';
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

/**
 * Searches for Vale binary in common installation paths.
 * Returns the path if found, undefined otherwise.
 */
export async function findValeInCommonPaths(): Promise<string | undefined> {
  const commonPaths = [
    '/opt/homebrew/bin/vale',  // Homebrew on Apple Silicon
    '/usr/local/bin/vale',      // Homebrew on Intel Mac
    '/usr/bin/vale',            // System-wide installation
    path.join(process.env.HOME || '', '.local/bin/vale'), // User-local installation
  ];

  for (const valePath of commonPaths) {
    try {
      const stat = await fs.promises.stat(valePath);
      if (stat.isFile()) {
        return valePath;
      }
    } catch {
      // Path doesn't exist, continue
    }
  }

  return undefined;
}
