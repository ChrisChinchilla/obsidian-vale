import { App, Modal, Notice, Setting } from 'obsidian';
import type ValePlugin from '../main';
import type { RuleOverride } from './valeConfigEdit';

const OVERRIDE_OPTIONS: { value: RuleOverride; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'suggestion', label: 'Suggestion' },
  { value: 'warning', label: 'Warning' },
  { value: 'error', label: 'Error' },
  { value: 'disabled', label: 'Disabled' }
];

export class ValeRuleSettingsModal extends Modal {
  private plugin: ValePlugin;
  private styleName: string;
  private rules: string[] = [];
  private overrides: Map<string, RuleOverride> = new Map();
  private loading = true;
  private loadError = '';

  constructor(app: App, plugin: ValePlugin, styleName: string) {
    super(app);
    this.plugin = plugin;
    this.styleName = styleName;
  }

  async onOpen() {
    this.titleEl.setText(`${this.styleName} rules`);
    this.render();
    await this.load();
  }

  onClose() {
    this.contentEl.empty();
  }

  private async load(): Promise<void> {
    try {
      const { rules, overrides } = await this.plugin.getStyleRuleOverrides(this.styleName);
      this.rules = rules;
      this.overrides = overrides;
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
    contentEl.addClass('vale-rule-settings');

    if (this.loading) {
      contentEl.createDiv({ text: 'Loading rules…' });
      return;
    }

    if (this.loadError) {
      contentEl.createDiv({ text: `Failed to load rules: ${this.loadError}` });
      return;
    }

    if (this.rules.length === 0) {
      contentEl.createDiv({ text: `No rules found for ${this.styleName}.` });
      return;
    }

    const list = contentEl.createDiv({ cls: 'vale-rule-settings-list' });
    for (const rule of this.rules) {
      const current = this.overrides.get(rule) ?? 'default';

      new Setting(list)
        .setName(rule)
        .addDropdown((dropdown) => {
          for (const option of OVERRIDE_OPTIONS) {
            dropdown.addOption(option.value, option.label);
          }
          dropdown
            .setValue(current)
            .onChange(async (value) => {
              const override = value as RuleOverride;
              try {
                await this.plugin.setRuleOverride(this.styleName, rule, override);
                this.overrides.set(rule, override);
              } catch (error) {
                new Notice(`Failed to update ${rule}: ${error instanceof Error ? error.message : String(error)}`);
              }
            });
        });
    }
  }
}
