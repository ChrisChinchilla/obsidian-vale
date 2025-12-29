import * as fs from "fs";
import * as path from "path";
import { findValeInCommonPaths } from "../utils";

// ValeConfigManager handles Vale binary and config file path resolution.
export class ValeConfigManager {
  private valePath?: string;
  private configPath?: string;
  private resolvedValePath?: string;

  constructor(valePath?: string, configPath?: string) {
    this.valePath = valePath;
    this.configPath = configPath;
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
    const foundPath = await findValeInCommonPaths();
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
