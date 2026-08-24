import { App, Modal, Notice, Setting, requestUrl } from 'obsidian';
import type ValePlugin from '../main';
import { ValeRuleSettingsModal } from './valeRuleSettingsModal';

const REGISTRY_URL = 'https://raw.githubusercontent.com/errata-ai/packages/master/library.json';

interface ValeStylePackage {
  name: string;
  description: string;
  homepage: string;
  url: string;
  tags?: string[];
}

export class ValeStyleBrowserModal extends Modal {
  private plugin: ValePlugin;
  private packages: ValeStylePackage[] = [];
  private enabled: Set<string> = new Set();
  private busy: Set<string> = new Set();
  private filter = '';
  private loading = true;
  private loadError = '';

  constructor(app: App, plugin: ValePlugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen() {
    this.titleEl.setText('Browse Vale styles');
    this.render();
    await this.load();
  }

  onClose() {
    this.contentEl.empty();
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.loadError = '';
    this.render();

    try {
      const [registryResponse, enabledStyles] = await Promise.all([
        requestUrl({ url: REGISTRY_URL }),
        this.plugin.getEnabledStyles()
      ]);

      const all = registryResponse.json as ValeStylePackage[];
      this.packages = all.filter((pkg) => (pkg.tags ?? ['style']).includes('style'));
      this.enabled = new Set(enabledStyles);
    } catch (error) {
      this.loadError = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('vale-style-browser');

    new Setting(contentEl)
      .setName('Search')
      .addText((text) => text
        .setPlaceholder('Filter by name or description')
        .setValue(this.filter)
        .onChange((value) => {
          this.filter = value;
          this.render();
        }));

    if (this.loading) {
      contentEl.createDiv({ text: 'Loading styles…' });
      return;
    }

    if (this.loadError) {
      contentEl.createDiv({ text: `Failed to load the Vale style registry: ${this.loadError}` });
      return;
    }

    const query = this.filter.trim().toLowerCase();
    const filtered = this.packages.filter((pkg) =>
      !query || pkg.name.toLowerCase().includes(query) || pkg.description.toLowerCase().includes(query)
    );

    if (filtered.length === 0) {
      contentEl.createDiv({ text: 'No styles match your search.' });
      return;
    }

    const list = contentEl.createDiv({ cls: 'vale-style-browser-list' });
    for (const pkg of filtered) {
      this.renderPackage(list, pkg);
    }
  }

  private renderPackage(list: HTMLElement, pkg: ValeStylePackage): void {
    const isEnabled = this.enabled.has(pkg.name);
    const isBusy = this.busy.has(pkg.name);

    const setting = new Setting(list)
      .setName(pkg.name)
      .setDesc(pkg.description);

    setting.addExtraButton((button) => button
      .setIcon('external-link')
      .setTooltip('Open homepage')
      .onClick(() => window.open(pkg.homepage, '_blank')));

    if (isEnabled) {
      setting.addExtraButton((button) => button
        .setIcon('settings')
        .setTooltip('Configure rules')
        .onClick(() => new ValeRuleSettingsModal(this.app, this.plugin, pkg.name).open()));
    }

    setting.addButton((button) => {
      button
        .setButtonText(isBusy ? '…' : isEnabled ? 'Remove' : 'Install')
        .setDisabled(isBusy)
        .onClick(() => void this.toggleStyle(pkg));
      if (isEnabled) {
        button.setWarning();
      }
    });
  }

  private async toggleStyle(pkg: ValeStylePackage): Promise<void> {
    const isEnabled = this.enabled.has(pkg.name);
    this.busy.add(pkg.name);
    this.render();

    try {
      if (isEnabled) {
        await this.plugin.removeStyle(pkg.name);
        this.enabled.delete(pkg.name);
      } else {
        await this.plugin.installStyle(pkg.name);
        this.enabled.add(pkg.name);
      }
    } catch (error) {
      new Notice(`Failed for ${pkg.name}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.busy.delete(pkg.name);
      this.render();
    }
  }
}
