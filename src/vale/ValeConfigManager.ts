import * as compressing from "compressing";
import { spawn } from "child_process";
import download from "download";
import * as fs from "fs";
import { parse, stringify } from "ini";
import * as os from "os";
import * as path from "path";
import { Extract } from "unzipper";
import { debug } from "../debug";
import { DEFAULT_VALE_INI, ValeConfig, ValeRule, ValeRuleSeverity, ValeStyle } from "../types";

// ValeManager exposes file operations for working with the Vale configuration
// file and styles.
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
      path.join(os.homedir(), '.local/bin/vale'), // User-local installation
    ];

    // Add common Windows installation paths when running on Windows
    if (process.platform === 'win32') {
      commonPaths.push(
        'C:\\\\Program Files\\\\vale\\\\vale.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'vale', 'vale.exe'),
        path.join(process.env.PROGRAMFILES || '', 'vale', 'vale.exe'),
      );
    }
    for (const valePath of commonPaths) {
      try {
        const stat = await fs.promises.stat(valePath);
        if (stat.isFile()) {
          return valePath;
        }
      } catch (error) {
        // Path does not exist, continue searching
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

      // If it's just 'vale' (not a path), verify it's actually available
      // by attempting to execute it
      if (valePath === 'vale') {
        return this.verifyValeExecutable(valePath);
      }

      const stat = await fs.promises.stat(valePath);
      if (!stat.isFile()) {
        return false;
      }

      // For explicit paths, also verify the binary is executable
      return this.verifyValeExecutable(valePath);
    } catch {
      return false;
    }
  }

  private async verifyValeExecutable(valePath: string): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn(valePath, ['--version'], {
        env: process.env,
      });

      let hasOutput = false;
      let resolved = false;
      let timeoutId: NodeJS.Timeout;

      const resolveOnce = (value: boolean) => {
        if (!resolved) {
          resolved = true;
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          resolve(value);
        }
      };

      child.stdout?.on('data', () => {
        hasOutput = true;
      });

      child.on('error', () => {
        resolveOnce(false);
      });

      child.on('close', (code: number) => {
        // Vale --version should exit with code 0 and produce output
        resolveOnce(code === 0 && hasOutput);
      });

      // Set a timeout to avoid hanging indefinitely
      timeoutId = setTimeout(() => {
        try {
          if (!child.killed) {
            child.kill();
          }
        } catch {
          // Ignore errors when attempting to kill an already-exited process
        }
        resolveOnce(false);
      }, 5000);
    });
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

  async installStyle(style: ValeStyle): Promise<void> {
    const stylesPath = await this.getStylesPath();
    if (!stylesPath) {
      throw new Error('StylesPath not configured');
    }

    if (!style.url) {
      throw new Error('Style URL is not defined');
    }

    const zipPath = path.join(stylesPath, path.basename(style.url));

    const isInstalled = await fs.promises
      .stat(path.join(stylesPath, style.name))
      .then((stats) => stats.isDirectory())
      .catch(() => false);

    if (isInstalled) {
      return;
    }

    return new Promise((resolve) => {
      download(style.url!, { extract: true }).pipe(
        fs.createWriteStream(zipPath).on("close", () => {
          fs.createReadStream(zipPath)
            .pipe(Extract({ path: path.dirname(zipPath) }))
            .on("close", () => {
              fs.unlinkSync(zipPath);
              resolve();
            });
        })
      );
    });
  }

  async uninstallStyle(style: ValeStyle): Promise<void> {
    const stylesPath = await this.getStylesPath();
    if (!stylesPath) {
      throw new Error('StylesPath not configured');
    }
    return fs.promises.rm(path.join(stylesPath, style.name), {
      force: true,
      recursive: true,
    });
  }

  async loadConfig(): Promise<ValeConfig> {
    const configPath = this.configPath;
    if (!configPath) {
      throw new Error('Config path not set');
    }
    return parse(
      await fs.promises.readFile(configPath, "utf-8")
    ) as ValeConfig;
  }

  async saveConfig(config: ValeConfig): Promise<void> {
    const configPath = this.configPath;
    if (!configPath) {
      throw new Error('Config path not set');
    }
    await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
    return fs.promises.writeFile(configPath, stringify(config), {
      encoding: "utf-8",
    });
  }

  async getStylesPath(): Promise<string | undefined> {
    const config = await this.loadConfig();
    const stylesPath = config.StylesPath as string;
    const configPath = this.configPath;

    if (!stylesPath || !configPath) {
      return undefined;
    }

    return path.join(path.dirname(configPath), stylesPath);
  }

  /**
   * Helper method to parse comma-separated style names from config
   */
  private parseStyles(basedOnStyles: string): string[] {
    return basedOnStyles.split(",").map((style) => style.trim());
  }

  async enableStyle(name: string): Promise<void> {
    const config = await this.loadConfig();

    const basedOnStyles = config["*"]?.md?.BasedOnStyles;
    if (!basedOnStyles) {
      throw new Error('Invalid config structure');
    }
    const styles = this.parseStyles(basedOnStyles);
    const stylesSet = new Set(styles);
    stylesSet.add(name);
    config["*"].md.BasedOnStyles = [...stylesSet].join(", ");

    return this.saveConfig(config);
  }

  async disableStyle(name: string): Promise<void> {
    const config = await this.loadConfig();

    const basedOnStyles = config["*"]?.md?.BasedOnStyles;
    if (!basedOnStyles) {
      throw new Error('Invalid config structure');
    }
    const styles = this.parseStyles(basedOnStyles);
    const stylesSet = new Set(styles);
    stylesSet.delete(name);
    config["*"].md.BasedOnStyles = [...stylesSet].join(", ");

    return this.saveConfig(config);
  }

  async updateRule(style: string, rule: ValeRule): Promise<void> {
    const config = await this.loadConfig();

    if (rule.disabled) {
      config["*"].md[`${style}.${rule.name}`] = "NO";
    } else if (rule.severity !== "default") {
      config["*"].md[`${style}.${rule.name}`] = rule.severity;
    } else {
      delete config["*"].md[`${style}.${rule.name}`];
    }

    return this.saveConfig(config);
  }

  async getConfiguredRules(style: string): Promise<ValeRule[]> {
    const config = await this.loadConfig();

    const md = config["*"].md;

    const rules: Record<string, ValeRule> = {};

    Object.entries(md).map(([key, value]) => {
      const identifier: string = key;
      if (identifier.startsWith(style + ".") && value) {
        const severityValue = value === "YES" || value === "NO" ? "default" : (value as ValeRuleSeverity);
        rules[identifier.split(".")[1]] = {
          name: identifier.split(".")[1],
          severity: severityValue,
          disabled: value === "NO",
        };
      }
    });

    return Object.values(rules);
  }

  async getRulesForStyle(style: string): Promise<string[]> {
    const stylesPath = await this.getStylesPath();
    if (!stylesPath) {
      throw new Error('StylesPath not configured');
    }
    const paths = await fs.promises.readdir(
      path.join(stylesPath, style)
    );

    return paths
      .map((entry) => path.parse(entry))
      .filter((path) => path.ext === ".yml")
      .map((file) => file.name);
  }

  async getInstalled(): Promise<string[]> {
    const stylesPath = await this.getStylesPath();
    if (!stylesPath) {
      return ["Vale"];
    }
    const paths = await fs.promises.readdir(stylesPath);

    const installed = [...paths]
      .filter((style) => style)
      .filter(async (name) => {
        const info = await fs.promises.stat(
          path.join(stylesPath, name)
        );
        return info.isDirectory();
      });

    return [...installed, "Vale"];
  }

  async getEnabledStyles(): Promise<string[]> {
    const config = await this.loadConfig();

    const basedOnStyles = config["*"]?.md?.BasedOnStyles;
    if (!basedOnStyles) {
      return [];
    }
    const styles = this.parseStyles(basedOnStyles).filter((style) => style);

    return [...new Set(styles)];
  }

  async installVale(): Promise<string> {
    const releaseUrl = (platform: string) => {
      switch (platform) {
        case "linux":
          return "https://github.com/errata-ai/vale/releases/download/v2.13.0/vale_2.13.0_Linux_64-bit.tar.gz";
        case "darwin":
          return "https://github.com/errata-ai/vale/releases/download/v2.13.0/vale_2.13.0_macOS_64-bit.tar.gz";
        case "win32":
          return "https://github.com/errata-ai/vale/releases/download/v2.13.0/vale_2.13.0_Windows_64-bit.zip";
        default:
          throw new Error("Unsupported platform");
      }
    };

    const url = releaseUrl(process.platform);
    const configPath = this.getConfigPath();
    if (!configPath) {
      throw new Error('Config path not set');
    }

    const zipPath = path.join(
      path.dirname(configPath),
      path.basename(url)
    );

    const destinationPath = path.join(path.dirname(zipPath), "bin");

    try {
      const input = await download(url);
      if (process.platform === "win32") {
        await compressing.zip.uncompress(input, destinationPath);
      } else {
        await compressing.tgz.uncompress(input, destinationPath);
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      debug(`[Vale] Failed to install Vale: ${errorMsg}`);
    }

    return path.join(
      destinationPath,
      "vale" + (process.platform === "win32" ? ".exe" : "")
    );
  }

  // initializeDataPath creates a directory inside the plugin directory for
  // storing default Vale configuration.
  async initializeDataPath(): Promise<void> {
    if (!(await this.configPathExists())) {
      await this.saveConfig(DEFAULT_VALE_INI);
    }

    const stylesPath = await this.getStylesPath();
    if (stylesPath) {
      await fs.promises.mkdir(stylesPath, {
        recursive: true,
      });
    }
  }

  async getAvailableStyles(): Promise<ValeStyle[]> {
    // Snatched from https://github.com/errata-ai/styles/blob/master/library.json.
    // If the FuzzySuggestModal ever gets async support, we should make a
    // request instead.
    return Promise.resolve([
      {
        name: "Google",
        description:
          "A Vale-compatible implementation of the Google Developer Documentation Style Guide.",
        homepage: "https://github.com/errata-ai/Google",
        url: "https://github.com/errata-ai/Google/releases/latest/download/Google.zip",
      },
      {
        name: "Joblint",
        description:
          "Test tech job posts for issues with sexism, culture, expectations, and recruiter fails.",
        homepage: "https://github.com/errata-ai/Joblint",
        url: "https://github.com/errata-ai/Joblint/releases/latest/download/Joblint.zip",
      },
      {
        name: "Microsoft",
        description:
          "A Vale-compatible implementation of the Microsoft Writing Style Guide.",
        homepage: "https://github.com/errata-ai/Microsoft",
        url: "https://github.com/errata-ai/Microsoft/releases/latest/download/Microsoft.zip",
      },
      {
        name: "proselint",
        description:
          "proselint places the world’s greatest writers and editors by your side, where they whisper suggestions on how to improve your prose.",
        homepage: "https://github.com/errata-ai/proselint",
        url: "https://github.com/errata-ai/proselint/releases/latest/download/proselint.zip",
      },
      {
        name: "write-good",
        description:
          "Naive linter for English prose for developers who can't write good and wanna learn to do other stuff good too.",
        homepage: "https://github.com/errata-ai/write-good",
        url: "https://github.com/errata-ai/write-good/releases/latest/download/write-good.zip",
      },
      {
        name: "alex",
        description: "Catch insensitive, inconsiderate writing.",
        homepage: "https://github.com/errata-ai/alex",
        url: "https://github.com/errata-ai/alex/releases/latest/download/alex.zip",
      },
      {
        name: "Readability",
        description:
          "Vale-compatible implementations of many popular readability metrics.",
        homepage: "https://github.com/errata-ai/Readability",
        url: "https://github.com/errata-ai/Readability/releases/latest/download/Readability.zip",
      },
      {
        name: "Openly",
        description:
          "A Vale linter style that attempts to emulate some features of the commercial, and closed source.",
        homepage: "https://github.com/testthedocs/Openly",
        url: "https://github.com/testthedocs/Openly/releases/latest/download/Openly.zip",
      },
    ]);
  }
}
