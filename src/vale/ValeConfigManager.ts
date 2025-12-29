import * as fs from "fs";
import * as path from "path";

// ValeConfigManager handles Vale binary and config file path resolution.
export class ValeConfigManager {
  private valePath?: string;
  private configPath?: string;
  private resolvedValePath?: string;

  constructor(valePath?: string, configPath?: string) {
    this.valePath = valePath;
    this.configPath = configPath;
  }

  private async findValeInCommonPaths(): Promise<string | undefined> {
    // Common installation paths for Vale, especially from Homebrew
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
      } catch (error) {
        // Path doesn't exist, continue
      }
    }

    return undefined;
  }

  async getValePath(): Promise<string> {
    // If explicit path is set, use it
    if (this.valePath) {
      return this.valePath;
    }

    // If we've already resolved the path, use cached value
    if (this.resolvedValePath) {
      return this.resolvedValePath;
    }

    // Try to find vale in common installation paths
    const foundPath = await this.findValeInCommonPaths();
    if (foundPath) {
      this.resolvedValePath = foundPath;
      return foundPath;
    }

    // Fall back to 'vale' and hope it's in PATH
    return 'vale';
  }

  getConfigPath(): string | undefined {
    return this.configPath;
  }

  async valePathExists(): Promise<boolean> {
    try {
      const valePath = await this.getValePath();

      // If it's just 'vale' (not a path), we can't check with stat
      if (valePath === 'vale') {
        return true; // Assume vale is available in PATH
      }

      const stat = await fs.promises.stat(valePath);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  async configPathExists(): Promise<boolean> {
    const configPath = this.configPath;
    if (!configPath) {
      return false;
    }
    return fs.promises
      .stat(configPath)
      .then((stat) => stat.isFile())
      .catch(() => false);
  }
}
