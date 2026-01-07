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
import { valeDecorationsExtension, setValeDecorationsEffect } from './src/valeDecorations';
import { findValeInCommonPaths } from './src/utils';

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
  settings: ValePluginSettings;
  public currentIssues: Map<string, ValeIssue[]> = new Map();
  private debouncedCheck: () => void;
  private statusBarItem: HTMLElement;

  async onload() {
    await this.loadSettings();

    // Add status bar item
    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.setText('Vale: Ready');

    // Register CodeMirror 6 extension for Vale decorations
    this.registerEditorExtension(valeDecorationsExtension);

    // Apply custom color CSS variables
    this.updateStyleVariables();

    // Create debounced check function
    this.debouncedCheck = debounce(
      this.checkCurrentFile.bind(this),
      this.settings.debounceDelay,
      true
    );

    // Add settings tab
    this.addSettingTab(new ValeSettingTab(this.app, this));

    // Register commands
    this.addCommand({
      id: 'check-current-file',
      name: 'Check current file with Vale',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        this.checkCurrentFile();
      }
    });

    this.addCommand({
      id: 'toggle-auto-check',
      name: 'Toggle auto-check',
      callback: () => {
        this.settings.enableAutoCheck = !this.settings.enableAutoCheck;
        this.saveSettings().catch(console.error);
        new Notice(`Vale auto-check ${this.settings.enableAutoCheck ? 'enabled' : 'disabled'}`);
      }
    });

    this.addCommand({
      id: 'toggle-inline-decorations',
      name: 'Toggle inline decorations',
      callback: () => {
        this.settings.enableInlineDecorations = !this.settings.enableInlineDecorations;
        this.saveSettings().catch(console.error);

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
      name: 'Clear Vale issues',
      callback: () => {
        this.clearAllDecorations();
        this.currentIssues.clear();
        new Notice('Vale issues cleared');
      }
    });

    // Register events
    this.registerEvent(
      this.app.workspace.on('editor-change', (editor: Editor) => {
        if (this.settings.enableAutoCheck) {
          this.debouncedCheck();
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        if (this.settings.enableAutoCheck) {
          this.checkCurrentFile();
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

    this.statusBarItem.setText('Vale: Checking...');

    try {
      const content = await this.app.vault.read(file);
      const adapter = this.app.vault.adapter as { basePath?: string; getBasePath?: () => string };
      const basePath = adapter.basePath || adapter.getBasePath?.() || '';
      const tempPath = path.join(basePath, '.vale-temp.md');
      
      // Write content to temp file
      await this.app.vault.adapter.write('.vale-temp.md', content);

      // Run Vale
      const issues = await this.runVale(tempPath);
      
      // Clean up temp file
      try {
        await this.app.vault.adapter.remove('.vale-temp.md');
      } catch (e) {
        // Ignore cleanup errors
      }

      // Store issues
      this.currentIssues.set(file.path, issues);

      // Apply decorations
      this.applyDecorations(activeView.editor, issues);

      // Update status bar
      const errorCount = issues.filter(i => i.Severity === 'error').length;
      const warningCount = issues.filter(i => i.Severity === 'warning').length;
      const suggestionCount = issues.filter(i => i.Severity === 'suggestion').length;
      
      this.statusBarItem.setText(
        `Vale: ${errorCount} errors, ${warningCount} warnings, ${suggestionCount} suggestions`
      );

    } catch (error) {
      console.error('Vale check failed:', error);
      this.statusBarItem.setText('Vale: Error');
      new Notice(`Vale check failed: ${error.message}`);
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
      if (error.stdout) {
        try {
          const output: ValeOutput = JSON.parse(error.stdout);
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
      console.warn('Could not access CodeMirror 6 view');
      return;
    }

    // Dispatch the state effect to update decorations
    view.dispatch({
      effects: setValeDecorationsEffect.of(issues)
    });
  }

  private getOffsetForLine(editor: Editor, line: number): number {
    const pos = { line, ch: 0 };
    return editor.posToOffset(pos);
  }

  private getSeverityClass(severity: string): string {
    switch (severity.toLowerCase()) {
      case 'error':
        return 'vale-error';
      case 'warning':
        return 'vale-warning';
      case 'suggestion':
      default:
        return 'vale-suggestion';
    }
  }

  private createIssueWidget(issue: ValeIssue): HTMLElement {
    const widget = document.createElement('span');
    widget.className = 'vale-inline-suggestion';
    widget.setAttribute('data-vale-issue', JSON.stringify(issue));
    return widget;
  }

  private addHoverHandlers(_editor: Editor, _decorations: unknown[]) {
    // Note: Editor API doesn't expose containerEl and coordsAtPos properly
    // Disabled for now - this would need CodeMirror 6 integration
    // Users can see issues in the Vale panel instead
  }

  public clearDecorations(editor: Editor) {
    // Clear decorations by dispatching an empty array
    const view = (editor as { cm?: unknown }).cm;

    if (view) {
      (view as { dispatch: (arg: unknown) => void }).dispatch({
        effects: setValeDecorationsEffect.of([])
      });
    }
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
      .setName('Vale plugin settings')
      .setHeading();

    new Setting(containerEl)
      .setName('Vale executable path')
      .setDesc('Path to the Vale executable (default: "vale")')
      .addText(text => text
        .setPlaceholder('vale')
        .setValue(this.plugin.settings.valePath)
        .onChange(async (value) => {
          this.plugin.settings.valePath = value || 'vale';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Vale config file path')
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
      .setDesc('Display wavy underlines for Vale issues in the editor')
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
