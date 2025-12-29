import { timed } from "../debug";
import { ValeResponse, ValeSettings } from "../types";
import { ValeCli } from "./ValeCli";
import { ValeConfigManager } from "./ValeConfigManager";
import { ValeServer } from "./ValeServer";

// The primary responsibility of the ValeRunner is to make sure only one check
// is running at any given time.
export class ValeRunner {
  private settings: ValeSettings;

  // Only exists when user is using the CLI.
  private configManager?: ValeConfigManager;

  constructor(settings: ValeSettings, configManager?: ValeConfigManager) {
    this.settings = settings;
    this.configManager = configManager;
  }

  run = notConcurrent(
    async (text: string, format: string): Promise<ValeResponse> => {
      return timed("ValeRunner.run()", async () => {
        if (this.settings.type === "server") {
          return new ValeServer(this.settings.server.url).vale(text, format);
        } else if (this.settings.type === "cli") {
          console.log('[ValeRunner] Running in CLI mode');

          if (!this.configManager) {
            console.error('[ValeRunner] Config manager not initialized');
            throw new Error("Config manager not initialized");
          }

          console.log('[ValeRunner] Checking if vale exists...');
          const valeExists = await this.configManager.valePathExists();
          console.log('[ValeRunner] Vale exists:', valeExists);

          if (!valeExists) {
            const valePath = await this.configManager.getValePath();
            console.error('[ValeRunner] Could not find vale at:', valePath);
            throw new Error("Couldn't find vale");
          }

          // If a config path is explicitly set, verify it exists
          // Otherwise, let Vale use its built-in config discovery
          const configPath = this.configManager.getConfigPath();
          console.log('[ValeRunner] Config path:', configPath || '(using Vale discovery)');

          if (configPath) {
            const configExists = await this.configManager.configPathExists();
            console.log('[ValeRunner] Config exists:', configExists);
            if (!configExists) {
              console.error('[ValeRunner] Config file not found at:', configPath);
              throw new Error("Couldn't find config file at: " + configPath);
            }
          }

          console.log('[ValeRunner] Starting Vale CLI check...');
          return new ValeCli(this.configManager).vale(text, format);
        } else {
          throw new Error("Unknown runner");
        }
      });
    }
  );
}

// notConcurrent ensures there's only ever one promise in-flight.
const notConcurrent = (
  proc: (text: string, format: string) => PromiseLike<ValeResponse>
) => {
  let inFlight: Promise<ValeResponse> | false = false;

  return (text: string, format: string) => {
    if (!inFlight) {
      inFlight = (async () => {
        try {
          return await proc(text, format);
        } finally {
          inFlight = false;
        }
      })();
    }
    return inFlight;
  };
};
