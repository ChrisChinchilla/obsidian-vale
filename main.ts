import {
  App,
  Editor,
  MarkdownView,
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  debounce
} from 'obsidian';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { valeDecorationsExtension, setValeDecorationsEffect } from './src/valeDecorations';
import { findValeInCommonPaths } from './src/utils';
import { logger } from './src/logger';

const execFileAsync = promisify(execFile);

export interface ValeIssue {
  Action: {
    Name: string;
    Params: string[];
  };
  Check: string;
  Description: string;
  Line: number;
  Link: string;
  Message: string;
  Severity: string;
  Span: [number, number];
  Match: string;
}

interface ValeOutput {
  [filename: string]: ValeIssue[];
}

interface ValePluginSettings {
  valePath: string;
  configPath: string;
  debounceDelay: number;
  enableAutoCheck: boolean;
  enableInlineDecorations: boolean;
  severityColors: {
    error: string;
    warning: string;
    suggestion: string;
  };
}

const DEFAULT_SETTINGS: ValePluginSettings = {
  valePath: 'vale',
  configPath: '',
  debounceDelay: 1000,
  enableAutoCheck: true,
  enableInlineDecorations: true,
  severityColors: {
    error: '#ff0000',
    warning: '#ffa500',
    suggestion: '#0000ff'
  }
};

export default class ValePlugin extends Plugin {
  settings!: ValePluginSettings;
  public currentIssues: Map<string, ValeIssue[]> = new Map();
  private debouncedCheck!: () => void;
  private debouncedDelay = -1;
  private statusBarItem!: HTMLElement;

  async onload() {
    await this.loadSettings();

    // Add status bar item
    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.setText('Ready');

    // Register CodeMirror 6 extension for Vale decorations
    this.registerEditorExtension(valeDecorationsExtension);

    // Apply custom color CSS variables
    this.updateStyleVariables();

    this.rebuildDebouncedCheck();

    // Add settings tab
    this.addSettingTab(new ValeSettingTab(this.app, this));

    // Register commands
    this.addCommand({
      id: 'check-current-file',
      name: 'Check current file',
      editorCallback: () => {
        void this.checkCurrentFile();
      }
    });

    this.addCommand({
      id: 'toggle-auto-check',
      name: 'Toggle auto-check',
      callback: () => {
        this.settings.enableAutoCheck = !this.settings.enableAutoCheck;
        this.saveSettings().catch((error) => {
          logger.error('Failed to save settings:', error instanceof Error ? error.message : String(error));
        });
        new Notice(`Vale auto-check ${this.settings.enableAutoCheck ? 'enabled' : 'disabled'}`);
      }
    });

    this.addCommand({
      id: 'toggle-inline-decorations',
      name: 'Toggle inline decorations',
      callback: () => {
        this.settings.enableInlineDecorations = !this.settings.enableInlineDecorations;
        this.saveSettings().catch((error) => {
          logger.error('Failed to save settings:', error instanceof Error ? error.message : String(error));
        });

        // Refresh decorations based on new setting
        if (this.settings.enableInlineDecorations) {
          // Re-apply decorations if we have issues
          const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
          const activeFile = this.app.workspace.getActiveFile();
          if (activeView && activeFile) {
            const issues = this.currentIssues.get(activeFile.path);
            if (issues && issues.length > 0) {
              this.applyDecorations(activeView.editor, issues);
            }
          }
        } else {
          // Clear decorations
          const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
          if (activeView) {
            this.clearDecorations(activeView.editor);
          }
        }

        new Notice(`Vale inline decorations ${this.settings.enableInlineDecorations ? 'enabled' : 'disabled'}`);
      }
    });

    this.addCommand({
      id: 'clear-issues',
      name: 'Clear all issues',
      callback: () => {
        this.clearAllDecorations();
        this.currentIssues.clear();
        new Notice('Vale issues cleared');
      }
    });

    // Register events
    this.registerEvent(
      this.app.workspace.on('editor-change', (_editor: Editor) => {
        if (this.settings.enableAutoCheck) {
          this.debouncedCheck();
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        if (this.settings.enableAutoCheck) {
          void this.checkCurrentFile();
        }
      })
    );

  }

  onunload() {
    this.clearAllDecorations();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.updateStyleVariables();
    this.rebuildDebouncedCheck();
  }

  private rebuildDebouncedCheck() {
    if (this.settings.debounceDelay === this.debouncedDelay) {
      return;
    }
    this.debouncedDelay = this.settings.debounceDelay;
    this.debouncedCheck = debounce(
      () => { void this.checkCurrentFile(); },
      this.settings.debounceDelay,
      true
    );
  }

  private updateStyleVariables() {
    document.body.style.setProperty('--vale-alert-severity-error-background-color', this.settings.severityColors.error);
    document.body.style.setProperty('--vale-alert-severity-warning-background-color', this.settings.severityColors.warning);
    document.body.style.setProperty('--vale-alert-severity-suggestion-background-color', this.settings.severityColors.suggestion);
  }

  private async checkCurrentFile() {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
      return;
    }

    const file = activeView.file;
    if (!file) {
      return;
    }

    this.statusBarItem.setText('Checking...');

    const tempPath = path.join(os.tmpdir(), `vale-${process.pid}-${Date.now()}.md`);
    try {
      const content = await this.app.vault.read(file);
      await fs.writeFile(tempPath, content, 'utf8');

      const issues = await this.runVale(tempPath);

      this.currentIssues.set(file.path, issues);
      this.applyDecorations(activeView.editor, issues);

      const counts = { error: 0, warning: 0, suggestion: 0 };
      for (const issue of issues) {
        const key = issue.Severity as keyof typeof counts;
        if (key in counts) counts[key]++;
      }
      this.statusBarItem.setText(
        `Vale: ${counts.error} errors, ${counts.warning} warnings, ${counts.suggestion} suggestions`
      );

    } catch (error) {
      logger.error('Vale check failed:', error instanceof Error ? error.message : String(error));
      this.statusBarItem.setText('Error');
      new Notice(`Vale check failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors (file may not exist if write failed)
      }
    }
  }

  private async runVale(filepath: string): Promise<ValeIssue[]> {
    // console.log('[Vale] Running vale on file:', filepath);

    // Determine Vale path: use setting if provided, otherwise search common paths
    let valePath = this.settings.valePath;

    if (!valePath || valePath === 'vale') {
      // console.log('[Vale] No explicit vale path set, searching common locations...');
      const foundPath = await findValeInCommonPaths();
      if (foundPath) {
        valePath = foundPath;
        // console.log('[Vale] Using found vale binary:', valePath);
      } else {
        // console.log('[Vale] Vale not found in common paths, using "vale" from PATH');
        valePath = 'vale';
      }
    } else {
      // console.log('[Vale] Using explicit vale path from settings:', valePath);
    }

    // Get config path (optional)
    const configPath = this.settings.configPath;
    // console.log('[Vale] Config path:', configPath || '(using Vale\'s built-in discovery)');

    // Build arguments array for execFile (safer than shell string interpolation)
    const args = ['--output=JSON'];
    if (configPath) {
      args.push(`--config=${configPath}`);
    }
    args.push(filepath);
    // console.log('[Vale] Running vale with args:', args);

    // Run a separate command to detect which config file Vale is using
    // const configArgs = ['ls-config'];
    // if (configPath) {
    //   configArgs.push(`--config=${configPath}`);
    // }
    // try {
    //   const { stdout: configStdout } = await execFileAsync(valePath, configArgs);
    //   console.log('[Vale] Config file being used:', configStdout.trim());
    // } catch (e) {
    //   console.log('[Vale] Could not detect config file (vale ls-config failed)');
    // }

    try {
      const { stdout, stderr } = await execFileAsync(valePath, args);

      if (stderr && !stderr.includes('warning')) {
        // console.error('[Vale] stderr:', stderr);
        throw new Error(stderr);
      }

      // console.log('[Vale] stdout length:', stdout?.length || 0);
      const output: ValeOutput = JSON.parse(stdout || '{}');
      const filename = Object.keys(output)[0];
      const issues = output[filename] || [];
      // console.log('[Vale] Found', issues.length, 'issues');

      return issues;
    } catch (error) {
      // console.error('[Vale] Command failed:', error);
      // Vale returns exit code 1 when there are issues, which is not an error
      const execError = error as { stdout?: string };
      if (execError.stdout) {
        try {
          const output: ValeOutput = JSON.parse(execError.stdout);
          const filename = Object.keys(output)[0];
          const issues = output[filename] || [];
          // console.log('[Vale] Found', issues.length, 'issues (from error.stdout)');
          return issues;
        } catch {
          // Failed to parse error.stdout
          throw error;
        }
      }
      throw error;
    }
  }

  public applyDecorations(editor: Editor, issues: ValeIssue[]) {
    // Store issues for reference
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
      this.currentIssues.set(activeFile.path, issues);
    }

    // Check if inline decorations are enabled
    if (!this.settings.enableInlineDecorations) {
      return;
    }

    // Get the CodeMirror 6 EditorView from the editor
    // Access it through the cm property
    const view = (editor as { cm?: { dispatch: (arg: unknown) => void } }).cm;

    if (!view) {
      logger.warn('Could not access CodeMirror 6 view');
      return;
    }

    // Dispatch the state effect to update decorations
    view.dispatch({
      effects: setValeDecorationsEffect.of(issues)
    });
  }

  public clearDecorations(editor: Editor) {
    const view = (editor as { cm?: { dispatch: (arg: unknown) => void } }).cm;
    if (!view) {
      return;
    }
    view.dispatch({
      effects: setValeDecorationsEffect.of([])
    });
  }

  private clearAllDecorations() {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView) {
      this.clearDecorations(activeView.editor);
    }
  }
}

class ValeSettingTab extends PluginSettingTab {
  plugin: ValePlugin;

  constructor(app: App, plugin: ValePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl)
      .setName('Executable path')
      .setDesc('Path to the executable (defaults to "vale" on the system path)')
      .addText(text => text
        .setPlaceholder('/usr/local/bin/vale')
        .setValue(this.plugin.settings.valePath)
        .onChange(async (value) => {
          this.plugin.settings.valePath = value || 'vale';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Config file path')
      .setDesc('Path to .vale.ini config file (leave empty to use default)')
      .addText(text => text
        .setPlaceholder('/path/to/.vale.ini')
        .setValue(this.plugin.settings.configPath)
        .onChange(async (value) => {
          this.plugin.settings.configPath = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Auto-check enabled')
      .setDesc('Automatically check files as you type')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableAutoCheck)
        .onChange(async (value) => {
          this.plugin.settings.enableAutoCheck = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Show inline decorations')
      .setDesc('Display wavy underlines for issues in the editor')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableInlineDecorations)
        .onChange(async (value) => {
          this.plugin.settings.enableInlineDecorations = value;
          await this.plugin.saveSettings();

          // Refresh decorations based on new setting
          if (value) {
            // Re-apply decorations if we have issues
            const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
            const activeFile = this.plugin.app.workspace.getActiveFile();
            if (activeView && activeFile) {
              const issues = this.plugin.currentIssues.get(activeFile.path);
              if (issues && issues.length > 0) {
                this.plugin.applyDecorations(activeView.editor, issues);
              }
            }
          } else {
            // Clear decorations
            const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
            if (activeView) {
              this.plugin.clearDecorations(activeView.editor);
            }
          }
        }));

    new Setting(containerEl)
      .setName('Debounce delay (ms)')
      .setDesc('Delay before checking after you stop typing')
      .addText(text => text
        .setPlaceholder('1000')
        .setValue(String(this.plugin.settings.debounceDelay))
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue > 0) {
            this.plugin.settings.debounceDelay = numValue;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Severity colors')
      .setHeading();

    new Setting(containerEl)
      .setName('Error color')
      .setDesc('Color for error severity issues')
      .addText(text => text
        .setPlaceholder('#ff0000')
        .setValue(this.plugin.settings.severityColors.error)
        .onChange(async (value) => {
          this.plugin.settings.severityColors.error = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Warning color')
      .setDesc('Color for warning severity issues')
      .addText(text => text
        .setPlaceholder('#ffa500')
        .setValue(this.plugin.settings.severityColors.warning)
        .onChange(async (value) => {
          this.plugin.settings.severityColors.warning = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Suggestion color')
      .setDesc('Color for suggestion severity issues')
      .addText(text => text
        .setPlaceholder('#0000ff')
        .setValue(this.plugin.settings.severityColors.suggestion)
        .onChange(async (value) => {
          this.plugin.settings.severityColors.suggestion = value;
          await this.plugin.saveSettings();
        }));
  }
}
