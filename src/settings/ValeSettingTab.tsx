import { AppContext } from "../context";
import { App, PluginSettingTab } from "obsidian";
import * as React from "react";
import * as ReactDOM from "react-dom/client";
import ValePlugin from "../main";
import { SettingsRouter } from "./SettingsRouter";

export class ValeSettingTab extends PluginSettingTab {
  private plugin: ValePlugin;
  private root: ReactDOM.Root | null = null;

  constructor(app: App, plugin: ValePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    if (!this.root) {
      this.root = ReactDOM.createRoot(this.containerEl);
    }
    this.root.render(
      <AppContext.Provider value={this.app}>
        <SettingsRouter plugin={this.plugin} />
      </AppContext.Provider>
    );
  }

  hide(): void {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }
}
