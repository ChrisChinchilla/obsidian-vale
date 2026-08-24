import {
  App,
  Editor,
  MarkdownView,
  Modal,
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  debounce,
  requestUrl
} from 'obsidian';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { valeDecorationsExtension, setValeDecorationsEffect, setVocabHandler } from './src/valeDecorations';
import { ensureAbsolutePath, findValeInCommonPaths, getVaultBasePath } from './src/utils';
import { ValeIssuesView, VALE_ISSUES_VIEW_TYPE } from './src/valeIssuesView';
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

type ValeSeverity = 'suggestion' | 'warning' | 'error';

const SEVERITY_RANK: Record<string, number> = {
  suggestion: 1,
  warning: 2,
  error: 3
};

interface ValePluginSettings {
  valePath: string;
  configPath: string;
  debounceDelay: number;
  enableAutoCheck: boolean;
  enableInlineDecorations: boolean;
  minAlertLevel: ValeSeverity;
  maxNumberOfProblems: number;
  ignoredChecks: string;
  manageValeInstall: boolean;
  managedValeVersion: string;
  valeOnboardingShown: boolean;
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
  minAlertLevel: 'suggestion',
  maxNumberOfProblems: 100,
  ignoredChecks: '',
  manageValeInstall: true,
  managedValeVersion: '',
  valeOnboardingShown: false,
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

    // Let hover-tooltip buttons add words to Vale's accept/reject vocab lists
    setVocabHandler((word, list) => {
      void this.addToVocabList(word, list);
    });

    // Register the issues panel view
    this.registerView(VALE_ISSUES_VIEW_TYPE, (leaf) => new ValeIssuesView(leaf, this));

    // Apply custom color CSS variables
    this.updateStyleVariables();

    this.rebuildDebouncedCheck();

    // Add settings tab
    this.addSettingTab(new ValeSettingTab(this.app, this));

    // Verify Vale is runnable, installing a managed copy if it isn't
    void this.verifyOrInstallVale();

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
        this.refreshIssuesViews([]);
        new Notice('Vale issues cleared');
      }
    });

    this.addCommand({
      id: 'sync-styles',
      name: 'Sync styles',
      callback: () => {
        void this.syncStyles();
      }
    });

    this.addCommand({
      id: 'show-configuration',
      name: 'Show effective configuration',
      callback: () => {
        void this.showConfiguration();
      }
    });

    this.addCommand({
      id: 'install-or-update-vale',
      name: 'Install or update Vale',
      callback: () => {
        void this.installOrUpdateVale();
      }
    });

    this.addCommand({
      id: 'open-issues-view',
      name: 'Open issues panel',
      callback: () => {
        void this.activateIssuesView();
      }
    });

    this.addCommand({
      id: 'vocab-add-accept',
      name: 'Add selection to Vale accept list',
      editorCallback: (editor: Editor) => {
        const word = editor.getSelection().trim();
        if (!word) {
          new Notice('Select a word or phrase first');
          return;
        }
        void this.addToVocabList(word, 'accept');
      }
    });

    this.addCommand({
      id: 'vocab-add-reject',
      name: 'Add selection to Vale reject list',
      editorCallback: (editor: Editor) => {
        const word = editor.getSelection().trim();
        if (!word) {
          new Notice('Select a word or phrase first');
          return;
        }
        void this.addToVocabList(word, 'reject');
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
    setVocabHandler(null);
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

      const issues = this.filterIssues(await this.runVale(tempPath));

      this.currentIssues.set(file.path, issues);
      this.applyDecorations(activeView.editor, issues);
      this.refreshIssuesViews(issues);

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

  private async resolveValePath(): Promise<string> {
    const valePath = this.settings.valePath;

    if (valePath && valePath !== 'vale') {
      return valePath;
    }

    const managedPath = this.getManagedValeBinaryPath();
    if (await this.pathExists(managedPath)) {
      return managedPath;
    }

    const foundPath = await findValeInCommonPaths();
    return foundPath || 'vale';
  }

  private resolveConfigPath(): string {
    if (!this.settings.configPath) {
      return '';
    }
    return ensureAbsolutePath(this.settings.configPath, this.app.vault);
  }

  /** cwd for Vale invocations, so a relative StylesPath in .vale.ini resolves against the vault root. */
  private execOptions(): { cwd?: string } {
    const basePath = getVaultBasePath(this.app.vault);
    return basePath ? { cwd: basePath } : {};
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private getManagedValeDir(): string {
    return path.join(getVaultBasePath(this.app.vault), this.app.vault.configDir, 'plugins', this.manifest.id, 'vale-bin');
  }

  private getManagedValeBinaryPath(): string {
    return path.join(this.getManagedValeDir(), os.platform() === 'win32' ? 'vale.exe' : 'vale');
  }

  /**
   * Maps the current OS/arch to the matching asset name on Vale's GitHub
   * releases, e.g. `vale_3.18.0_macOS_arm64.tar.gz`.
   */
  private getValeAssetSuffix(): { osName: string; archName: string; ext: string } {
    const platform = os.platform();
    const archName = os.arch() === 'arm64' ? 'arm64' : '64-bit';

    if (platform === 'darwin') {
      return { osName: 'macOS', archName, ext: 'tar.gz' };
    }
    if (platform === 'linux') {
      return { osName: 'Linux', archName, ext: 'tar.gz' };
    }
    if (platform === 'win32') {
      return { osName: 'Windows', archName, ext: 'zip' };
    }
    throw new Error(`Unsupported platform for a managed Vale install: ${platform}`);
  }

  private async fetchLatestValeRelease(): Promise<{ version: string; assetName: string; downloadUrl: string }> {
    const response = await requestUrl({ url: 'https://api.github.com/repos/errata-ai/vale/releases/latest' });
    const data = response.json as { tag_name: string; assets: { name: string; browser_download_url: string }[] };

    const version = data.tag_name.replace(/^v/, '');
    const { osName, archName, ext } = this.getValeAssetSuffix();
    const assetName = `vale_${version}_${osName}_${archName}.${ext}`;
    const asset = data.assets.find((a) => a.name === assetName);

    if (!asset) {
      throw new Error(`No Vale release asset found for this platform (expected ${assetName})`);
    }

    return { version, assetName, downloadUrl: asset.browser_download_url };
  }

  /**
   * Downloads and installs a managed copy of Vale, switching the plugin to
   * use it. Safe to call when a managed copy is already up to date - it's a
   * no-op unless `force` is set or the version has changed.
   */
  private async installManagedVale(force: boolean): Promise<string | null> {
    const managedDir = this.getManagedValeDir();
    const managedPath = this.getManagedValeBinaryPath();

    try {
      const release = await this.fetchLatestValeRelease();

      if (!force && this.settings.managedValeVersion === release.version && await this.pathExists(managedPath)) {
        return managedPath;
      }

      new Notice(`Downloading Vale ${release.version}…`);
      await fs.mkdir(managedDir, { recursive: true });

      const archivePath = path.join(managedDir, release.assetName);
      const download = await requestUrl({ url: release.downloadUrl });
      await fs.writeFile(archivePath, Buffer.from(download.arrayBuffer));

      // Windows' bundled bsdtar handles .zip too, so `tar -xf` works for both archive types.
      await execFileAsync('tar', ['-xf', archivePath, '-C', managedDir]);
      await fs.unlink(archivePath).catch(() => { /* best-effort cleanup */ });

      if (os.platform() !== 'win32') {
        await fs.chmod(managedPath, 0o755);
      }

      this.settings.valePath = managedPath;
      this.settings.managedValeVersion = release.version;
      await this.saveSettings();

      new Notice(`Vale ${release.version} installed`);
      return managedPath;
    } catch (error) {
      logger.error('Failed to install Vale:', error instanceof Error ? error.message : String(error));
      new Notice(`Failed to install Vale: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  public async installOrUpdateVale(): Promise<void> {
    await this.installManagedVale(true);
  }

  public async uninstallManagedVale(): Promise<void> {
    const managedDir = this.getManagedValeDir();
    const managedPath = this.getManagedValeBinaryPath();

    try {
      await fs.rm(managedDir, { recursive: true, force: true });
    } catch (error) {
      logger.error('Failed to remove managed Vale install:', error instanceof Error ? error.message : String(error));
      new Notice(`Failed to remove managed Vale install: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    if (this.settings.valePath === managedPath) {
      this.settings.valePath = 'vale';
    }
    this.settings.managedValeVersion = '';
    await this.saveSettings();
    new Notice('Managed Vale install removed');
  }

  /**
   * Runs once at startup: confirms the resolved Vale binary actually runs,
   * installing a managed copy if nothing usable was found (and the user
   * hasn't opted out), or mentioning the managed-install option once if an
   * existing system install is being used instead.
   */
  private async verifyOrInstallVale(): Promise<void> {
    const resolvedPath = await this.resolveValePath();

    try {
      await execFileAsync(resolvedPath, ['--version'], this.execOptions());

      if (!this.settings.valeOnboardingShown) {
        this.settings.valeOnboardingShown = true;
        await this.saveSettings();

        if (resolvedPath !== this.getManagedValeBinaryPath()) {
          new Notice(
            'Vale Linter: using your existing Vale install. This plugin can also download and manage its own copy of Vale - see Settings → Vale Linter → "Install or update Vale".',
            12000
          );
        }
      }
      return;
    } catch {
      // Vale isn't runnable at the resolved path - fall through to managed install.
    }

    if (!this.settings.manageValeInstall) {
      return;
    }

    new Notice('Vale not found - Vale Linter is installing a managed copy…');
    await this.installManagedVale(false);
  }

  private matchesIgnoredCheck(checkName: string): boolean {
    const patterns = this.settings.ignoredChecks
      .split(',')
      .map((pattern) => pattern.trim())
      .filter(Boolean);

    return patterns.some((pattern) => {
      if (!pattern.includes('*')) {
        return checkName === pattern;
      }
      const escaped = pattern.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const regex = new RegExp(`^${escaped.join('.*')}$`);
      return regex.test(checkName);
    });
  }

  private filterIssues(issues: ValeIssue[]): ValeIssue[] {
    const minRank = SEVERITY_RANK[this.settings.minAlertLevel] ?? SEVERITY_RANK.suggestion;
    const filtered = issues.filter((issue) => {
      if ((SEVERITY_RANK[issue.Severity] ?? SEVERITY_RANK.suggestion) < minRank) {
        return false;
      }
      return !this.matchesIgnoredCheck(issue.Check);
    });

    if (this.settings.maxNumberOfProblems > 0) {
      return filtered.slice(0, this.settings.maxNumberOfProblems);
    }
    return filtered;
  }

  private refreshIssuesViews(issues: ValeIssue[]): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VALE_ISSUES_VIEW_TYPE)) {
      if (leaf.view instanceof ValeIssuesView) {
        leaf.view.render(issues);
      }
    }
  }

  private async activateIssuesView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VALE_ISSUES_VIEW_TYPE)[0];
    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (!rightLeaf) {
        return;
      }
      leaf = rightLeaf;
      await leaf.setViewState({ type: VALE_ISSUES_VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  private async getStylesInfo(): Promise<{ stylesPath: string; vocab: string } | null> {
    const valePath = await this.resolveValePath();
    const configPath = this.resolveConfigPath();

    const args = ['ls-config'];
    if (configPath) {
      args.push(`--config=${configPath}`);
    }

    try {
      const { stdout } = await execFileAsync(valePath, args, this.execOptions());
      // `vale ls-config` has no `StylesPath` key: the resolved styles
      // directories (global styles dir, then the configured StylesPath)
      // are listed in `Paths`, and `Vocab` is an array of vocab names.
      const config = JSON.parse(stdout) as { Paths?: string[]; Vocab?: string[] };

      const stylesPath = config.Paths?.[config.Paths.length - 1];
      if (!stylesPath) {
        new Notice('Vale configuration has no StylesPath set');
        return null;
      }
      const vocab = config.Vocab?.[0];
      if (!vocab) {
        new Notice('No Vocab configured — add "Vocab = YourVocabName" to your .vale.ini');
        return null;
      }

      return {
        stylesPath: ensureAbsolutePath(stylesPath, this.app.vault),
        vocab
      };
    } catch (error) {
      logger.error('Failed to read Vale configuration:', error instanceof Error ? error.message : String(error));
      new Notice(`Failed to read Vale configuration: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private async addToVocabList(word: string, list: 'accept' | 'reject'): Promise<void> {
    const info = await this.getStylesInfo();
    if (!info) {
      return;
    }

    const vocabDir = path.join(info.stylesPath, 'config', 'vocabularies', info.vocab);
    const filePath = path.join(vocabDir, `${list}.txt`);

    try {
      await fs.mkdir(vocabDir, { recursive: true });

      let existing = '';
      try {
        existing = await fs.readFile(filePath, 'utf8');
      } catch {
        // File doesn't exist yet - start with an empty list
      }

      const lines = existing.split('\n').map((line) => line.trim()).filter(Boolean);
      if (lines.includes(word)) {
        new Notice(`"${word}" is already in the ${list} list`);
        return;
      }

      lines.push(word);
      await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8');
      new Notice(`Added "${word}" to Vale ${list} list`);

      void this.checkCurrentFile();
    } catch (error) {
      logger.error('Failed to update Vale vocab:', error instanceof Error ? error.message : String(error));
      new Notice(`Failed to update Vale vocab: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async syncStyles() {
    const valePath = await this.resolveValePath();
    const configPath = this.resolveConfigPath();

    const args = ['sync'];
    if (configPath) {
      args.push(`--config=${configPath}`);
    }

    new Notice('Syncing Vale styles…');
    try {
      await execFileAsync(valePath, args, this.execOptions());
      new Notice('Vale styles synced');
    } catch (error) {
      logger.error('Vale sync failed:', error instanceof Error ? error.message : String(error));
      new Notice(`Vale sync failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async showConfiguration() {
    const valePath = await this.resolveValePath();
    const configPath = this.resolveConfigPath();

    const args = ['ls-config'];
    if (configPath) {
      args.push(`--config=${configPath}`);
    }

    try {
      const { stdout } = await execFileAsync(valePath, args, this.execOptions());
      new ValeConfigModal(this.app, stdout).open();
    } catch (error) {
      logger.error('Failed to load Vale configuration:', error instanceof Error ? error.message : String(error));
      new Notice(`Failed to load Vale configuration: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async runVale(filepath: string): Promise<ValeIssue[]> {
    const valePath = await this.resolveValePath();
    const configPath = this.resolveConfigPath();

    // Build arguments array for execFile (safer than shell string interpolation)
    const args = ['--output=JSON'];
    if (configPath) {
      args.push(`--config=${configPath}`);
    }
    args.push(filepath);

    try {
      const { stdout, stderr } = await execFileAsync(valePath, args, this.execOptions());

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

class ValeConfigModal extends Modal {
  constructor(app: App, private configText: string) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Vale effective configuration' });
    const pre = contentEl.createEl('pre');
    pre.setText(this.configText || '(empty)');
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.maxHeight = '60vh';
    pre.style.overflow = 'auto';
  }

  onClose() {
    this.contentEl.empty();
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
      .setName('Manage Vale install')
      .setDesc('If Vale isn\'t found on your system, automatically download and manage a copy instead of requiring a manual install')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.manageValeInstall)
        .onChange(async (value) => {
          this.plugin.settings.manageValeInstall = value;
          await this.plugin.saveSettings();
        }));

    {
      const installSetting = new Setting(containerEl)
        .setName('Install or update Vale')
        .setDesc(
          this.plugin.settings.managedValeVersion
            ? `Managed Vale ${this.plugin.settings.managedValeVersion} is installed`
            : 'Download and manage a copy of Vale, or update the managed copy to the latest release'
        )
        .addButton(button => button
          .setButtonText('Install or update')
          .onClick(async () => {
            button.setDisabled(true).setButtonText('Installing…');
            await this.plugin.installOrUpdateVale();
            this.display();
          }));

      if (this.plugin.settings.managedValeVersion) {
        installSetting.addButton(button => button
          .setButtonText('Uninstall')
          .setWarning()
          .onClick(async () => {
            button.setDisabled(true).setButtonText('Removing…');
            await this.plugin.uninstallManagedVale();
            this.display();
          }));
      }
    }

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
      .setName('Minimum alert level')
      .setDesc('Only show issues at or above this severity')
      .addDropdown(dropdown => dropdown
        .addOption('suggestion', 'Suggestion')
        .addOption('warning', 'Warning')
        .addOption('error', 'Error')
        .setValue(this.plugin.settings.minAlertLevel)
        .onChange(async (value) => {
          this.plugin.settings.minAlertLevel = value as ValeSeverity;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Maximum problems')
      .setDesc('Maximum number of issues to display per file (0 = unlimited)')
      .addText(text => text
        .setPlaceholder('100')
        .setValue(String(this.plugin.settings.maxNumberOfProblems))
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= 0) {
            this.plugin.settings.maxNumberOfProblems = numValue;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Ignored checks')
      .setDesc('Comma-separated Vale check names to suppress entirely, independent of severity. Supports * wildcards (e.g. "write-good.*, Vale.Spelling")')
      .addText(text => text
        .setPlaceholder('write-good.*, Vale.Spelling')
        .setValue(this.plugin.settings.ignoredChecks)
        .onChange(async (value) => {
          this.plugin.settings.ignoredChecks = value;
          await this.plugin.saveSettings();
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
