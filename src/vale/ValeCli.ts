import { spawn } from "child_process";
import { ValeResponse } from "../types";
import { ValeConfigManager } from "./ValeConfigManager";

export class ValeCli {
  configManager: ValeConfigManager;

  constructor(configManager: ValeConfigManager) {
    this.configManager = configManager;
  }

  async vale(text: string, format: string): Promise<ValeResponse> {
    const args = [];
    const configPath = this.configManager.getConfigPath();

    // Only pass --config if a config path is explicitly set
    // Otherwise, let Vale use its built-in config discovery
    if (configPath) {
      console.debug('[Vale] Using config file:', configPath);
      args.push("--config", configPath);
    } else {
      console.debug('[Vale] No config file specified, using Vale\'s built-in discovery');
    }

    args.push("--ext", format, "--output", "JSON");

    // Get Vale path (may be resolved from common installation locations)
    const valePath = await this.configManager.getValePath();

    const child = spawn(valePath, args, {
      shell: false,
      env: process.env,
    });

    console.debug('[Vale] Process spawned, PID:', child.pid);

    let stdout = "";
    let stderr = "";

    if (child.stdout) {
      child.stdout.on("data", (data) => {
        stdout += data;
        console.debug('[Vale] stdout:', data.toString());
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (data) => {
        stderr += data;
        console.error('[Vale] stderr:', data.toString());
      });
    }

    return new Promise((resolve, reject) => {
      child.on("error", (error) => {
        console.error('[Vale] Process error:', error);
        reject(error);
      });

      child.on("close", (code) => {
        console.debug('[Vale] Process closed with code:', code);
        console.debug('[Vale] Total stdout length:', stdout.length);
        console.debug('[Vale] Total stderr length:', stderr.length);

        if (stderr) {
          console.error('[Vale] Full stderr:', stderr);
        }

        if (code === 0) {
          // Vale exited without alerts.
          console.debug('[Vale] No alerts found');
          resolve({});
        } else if (code === 1) {
          // Vale returned alerts.
          console.debug('[Vale] Parsing alerts from stdout');
          try {
            const parsed = JSON.parse(stdout);
            console.debug('[Vale] Successfully parsed alerts:', Object.keys(parsed).length);
            resolve(parsed);
          } catch (e) {
            console.error('[Vale] Failed to parse JSON:', e);
            console.error('[Vale] stdout was:', stdout);
            reject(new Error(`Failed to parse Vale output: ${e}`));
          }
        } else {
          // Vale exited unexpectedly.
          console.error('[Vale] Unexpected exit code:', code);
          reject(new Error(`Vale exited with code ${code}. stderr: ${stderr}`));
        }
      });

      console.debug('[Vale] Writing text to stdin (length:', text.length, ')');
      child.stdin.write(text);
      child.stdin.end();
    });
  }
}
