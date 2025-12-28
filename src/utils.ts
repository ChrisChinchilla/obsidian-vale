import * as path from 'path';
import { Vault } from 'obsidian';
import { ValeConfigManager } from './vale/ValeConfigManager';

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
 * Creates a new managed ValeConfigManager instance for the given vault.
 * The managed instance uses the default data directory within the plugin folder.
 */
export function newManagedConfigManager(vault: Vault): ValeConfigManager {
  const dataDir = path.join(vault.configDir, "plugins/obsidian-vale/data");
  const binaryName = process.platform === "win32" ? "vale.exe" : "vale";

  return new ValeConfigManager(
    ensureAbsolutePath(path.join(dataDir, "bin", binaryName), vault),
    ensureAbsolutePath(path.join(dataDir, ".vale.ini"), vault)
  );
}
