import { FileSystemAdapter, MarkdownView, Plugin } from "obsidian";
import * as path from "path";
import { ValeSettingTab } from "./settings/ValeSettingTab";
import { DEFAULT_SETTINGS, ValeSettings } from "./types";
import { ValeConfigManager } from "./vale/ValeConfigManager";
import { ValeRunner } from "./vale/ValeRunner";
import { ValeView, VIEW_TYPE_VALE } from "./ValeView";

export default class ValePlugin extends Plugin {
  public settings: ValeSettings;

  private view: ValeView; // Displays the results.
  private configManager?: ValeConfigManager; // Manages operations that require disk access.
  private runner?: ValeRunner; // Runs the actual check.

  // onload runs when plugin becomes enabled.
  async onload(): Promise<void> {
    await this.loadSettings();

    this.addSettingTab(new ValeSettingTab(this.app, this));

    this.addCommand({
      id: "vale-check-document",
      name: "Check document",
      checkCallback: (checking) => {
        if (checking) {
          return !!this.app.workspace.getActiveViewOfType(MarkdownView);
        }

        // The Check document command doesn't actually perform the check. Since
        // a check may take some time to complete, the command only activates
        // the view and then asks the view to run the check. This lets us
        // display a progress bar, for example.
        this.activateView();

        return true;
      },
    });

    this.registerView(
      VIEW_TYPE_VALE,
      (leaf) => (this.view = new ValeView(leaf, this.settings, this.runner))
    );
  }

  // onload runs when plugin becomes disabled.
  async onunload(): Promise<void> {
    if (this.view) {
      await this.view.onClose();
    }

    // Remove all open Vale leaves.
    this.app.workspace
      .getLeavesOfType(VIEW_TYPE_VALE)
      .forEach((leaf) => leaf.detach());

    // Remove all marks from the previous check.
    this.app.workspace.iterateCodeMirrors((cm) => {
      cm.getAllMarks()
        .filter((mark) => mark.className.contains("vale-underline"))
        .forEach((mark) => mark.clear());
    });
  }

  // activateView triggers a check and reveals the Vale view, if isn't already
  // visible.
  async activateView(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_VALE);

    if (leaves.length === 0) {
      await this.app.workspace.getRightLeaf(false).setViewState({
        type: VIEW_TYPE_VALE,
        active: true,
      });
    }

    // Request the view to run the actual check.
    this.view.runValeCheck();

    this.app.workspace.revealLeaf(
      this.app.workspace.getLeavesOfType(VIEW_TYPE_VALE)[0]
    );
  }

  async saveSettings(): Promise<void> {
    this.saveData(this.settings);
    this.initialize();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign(DEFAULT_SETTINGS, await this.loadData());
    this.initialize();
  }

  // initialize rebuilds the config manager and runner. Should be run whenever the
  // settings change.
  initialize(): void {
    this.configManager =
      this.settings.type === "cli"
        ? new ValeConfigManager(
            this.settings.cli.valePath,
            this.normalizeConfigPath(this.settings.cli.configPath)
          )
        : undefined;

    this.runner = new ValeRunner(this.settings, this.configManager);

    // Detach any leaves that use the old runner.
    this.app.workspace.getLeavesOfType(VIEW_TYPE_VALE).forEach((leaf) => {
      leaf.detach();
    });
  }

  // If config path is relative, then convert it to an absolute path.
  // Otherwise, return it as is.
  normalizeConfigPath(configPath: string): string {
    if (path.isAbsolute(configPath)) {
      return configPath;
    }

    const { adapter } = this.app.vault;

    if (adapter instanceof FileSystemAdapter) {
      return adapter.getFullPath(configPath);
    }

    throw new Error("Unrecognized config path");
  }
}
