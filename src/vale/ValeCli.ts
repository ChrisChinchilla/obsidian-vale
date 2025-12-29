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
      console.log('[Vale] Using config file:', configPath);
      args.push("--config", configPath);
    } else {
      console.log('[Vale] No config file specified, using Vale\'s built-in discovery');
    }

    args.push("--ext", format, "--output", "JSON");

    // Get Vale path (may be resolved from common installation locations)
    const valePath = await this.configManager.getValePath();
    // console.log('[Vale] Spawning vale with path:', valePath);
    // console.log('[Vale] Arguments:', args);

    const child = spawn(valePath, args, {
      shell: true,
      env: process.env,
    });

    console.log('[Vale] Process spawned, PID:', child.pid);

    let stdout = "";
    let stderr = "";

    if (child.stdout) {
      child.stdout.on("data", (data) => {
        stdout += data;
        console.log('[Vale] stdout:', data.toString());
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
        console.log('[Vale] Process closed with code:', code);
        console.log('[Vale] Total stdout length:', stdout.length);
        console.log('[Vale] Total stderr length:', stderr.length);

        if (stderr) {
          console.error('[Vale] Full stderr:', stderr);
        }

        if (code === 0) {
          // Vale exited without alerts.
          console.log('[Vale] No alerts found');
          resolve({});
        } else if (code === 1) {
          // Vale returned alerts.
          console.log('[Vale] Parsing alerts from stdout');
          try {
            const parsed = JSON.parse(stdout);
            console.log('[Vale] Successfully parsed alerts:', Object.keys(parsed).length);
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

      console.log('[Vale] Writing text to stdin (length:', text.length, ')');
      child.stdin.write(text);
      child.stdin.end();
    });
  }
}
