import { spawn } from "child_process";
import { ValeResponse } from "../types";
import { ValeConfigManager } from "./ValeConfigManager";

export class ValeCli {
  configManager: ValeConfigManager;

  constructor(configManager: ValeConfigManager) {
    this.configManager = configManager;
  }

  async vale(text: string, format: string): Promise<ValeResponse> {

    const child = spawn(this.configManager.getValePath(), [
      "--config",
      this.configManager.getConfigPath(),
      "--ext",
      format,
      "--output",
      "JSON",
    ]);

    let stdout = "";
    console.log(child);

    if (child.stdout) {
      child.stdout.on("data", (data) => {
        stdout += data;
      });
    }
    console.log(stdout);

    return new Promise((resolve, reject) => {
      child.on("error", reject);

      child.on("close", (code) => {
        console.log(code);
        if (code === 0) {
          // Vale exited without alerts.
          resolve({});
        } else if (code === 1) {
          // Vale returned alerts.
          console.log(JSON.parse(stdout));
          resolve(JSON.parse(stdout));
        } else {
          // Vale exited unexpectedly.
          reject(new Error(`child exited with code ${code}`));
        }
      });

      child.stdin.write(text);
      child.stdin.end();
    });
  }
}
