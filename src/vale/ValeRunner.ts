import { timed } from "../debug";
import { ValeResponse } from "../types";
import { ValeCli } from "./ValeCli";
import { ValeConfigManager } from "./ValeConfigManager";

// The primary responsibility of the ValeRunner is to make sure only one check
// is running at any given time.
export class ValeRunner {
  private configManager: ValeConfigManager;

  constructor(configManager: ValeConfigManager) {
    this.configManager = configManager;
  }

  run = notConcurrent(
    async (text: string, format: string): Promise<ValeResponse> => {
      return timed("ValeRunner.run()", async () => {
        console.debug('[ValeRunner] Running Vale CLI check');

        console.debug('[ValeRunner] Checking if vale exists...');
        const valeExists = await this.configManager.valePathExists();
        console.debug('[ValeRunner] Vale exists:', valeExists);

        if (!valeExists) {
          const valePath = await this.configManager.getValePath();
          console.error('[ValeRunner] Could not find vale at:', valePath);
          throw new Error("Couldn't find vale");
        }

        // If a config path is explicitly set, verify it exists
        // Otherwise, let Vale use its built-in config discovery
        const configPath = this.configManager.getConfigPath();
        console.debug('[ValeRunner] Config path:', configPath || '(using Vale discovery)');

        if (configPath) {
          const configExists = await this.configManager.configPathExists();
          console.debug('[ValeRunner] Config exists:', configExists);
          if (!configExists) {
            console.error('[ValeRunner] Config file not found at:', configPath);
            throw new Error("Couldn't find config file at: " + configPath);
          }
        }

        console.debug('[ValeRunner] Starting Vale CLI check...');
        return new ValeCli(this.configManager).vale(text, format);
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
