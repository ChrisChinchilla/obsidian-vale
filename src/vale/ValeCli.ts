import { spawn } from "child_process";
import { ValeResponse } from "../types";
import { ValeConfigManager } from "./ValeConfigManager";
import { debug } from "../debug";

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
      debug('[Vale] Using config file: ' + configPath);
      args.push("--config", configPath);
    } else {
      debug('[Vale] No config file specified, using Vale\'s built-in discovery');
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

    debug('[Vale] Process spawned, PID: ' + child.pid);

    let stdout = "";
    let stderr = "";

    if (child.stdout) {
      child.stdout.on("data", (data) => {
        stdout += data;
        debug('[Vale] stdout: ' + data.toString());
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (data) => {
        stderr += data;
        debug('[Vale] stderr: ' + data.toString());
      });
    }

    return new Promise((resolve, reject) => {
      child.on("error", (error) => {
        debug('[Vale] Process error: ' + error);
        reject(error);
      });

      child.on("close", (code) => {
        debug('[Vale] Process closed with code: ' + code);
        debug('[Vale] Total stdout length: ' + stdout.length);
        debug('[Vale] Total stderr length: ' + stderr.length);

        if (stderr) {
          debug('[Vale] Full stderr: ' + stderr);
        }

        if (code === 0) {
          // Vale exited without alerts.
          debug('[Vale] No alerts found');
          resolve({});
        } else if (code === 1) {
          // Vale returned alerts.
          debug('[Vale] Parsing alerts from stdout');
          try {
            const parsed = JSON.parse(stdout);
            debug('[Vale] Successfully parsed alerts: ' + Object.keys(parsed).length);
            resolve(parsed);
          } catch (e) {
            debug('[Vale] Failed to parse JSON: ' + e);
            debug('[Vale] stdout was: ' + stdout);
            reject(new Error(`Failed to parse Vale output: ${e}`));
          }
        } else {
          // Vale exited unexpectedly.
          debug('[Vale] Unexpected exit code: ' + code);
          reject(new Error(`Vale exited with code ${code}. stderr: ${stderr}`));
        }
      });

      debug('[Vale] Writing text to stdin (length: ' + text.length + ')');
      child.stdin.write(text);
      child.stdin.end();
    });
  }
}
