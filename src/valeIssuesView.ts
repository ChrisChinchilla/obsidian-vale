import { ItemView, MarkdownView, WorkspaceLeaf } from 'obsidian';
import type ValePlugin from '../main';
import type { ValeIssue } from '../main';

export const VALE_ISSUES_VIEW_TYPE = 'vale-issues-view';

export class ValeIssuesView extends ItemView {
  private plugin: ValePlugin;

  constructor(leaf: WorkspaceLeaf, plugin: ValePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VALE_ISSUES_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Vale issues';
  }

  getIcon(): string {
    return 'check-circle';
  }

  async onOpen() {
    this.render();
  }

  render(issues?: ValeIssue[]): void {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('obsidian-vale');

    const activeFile = this.app.workspace.getActiveFile();
    const list = issues ?? (activeFile ? this.plugin.currentIssues.get(activeFile.path) ?? [] : []);

    if (list.length === 0) {
      const empty = container.createDiv({ cls: 'success' });
      empty.createDiv({ cls: 'success-text', text: 'No issues found' });
      return;
    }

    for (const issue of list) {
      const severity = issue.Severity.toLowerCase();
      const alertEl = container.createDiv({ cls: 'alert' });

      const header = alertEl.createDiv({ cls: 'alert__header' });
      header.createSpan({ cls: `alert__severity alert__severity-text--${severity}`, text: issue.Severity.toUpperCase() });
      header.createSpan({ cls: 'alert__check', text: issue.Check });
      header.createSpan({ text: `Line ${issue.Line}` });

      alertEl.createDiv({ cls: 'alert__message', text: issue.Message });

      if (issue.Match) {
        alertEl.createDiv({ cls: 'alert__match', text: issue.Match });
      }

      alertEl.onclick = () => this.jumpToIssue(issue);
    }
  }

  private jumpToIssue(issue: ValeIssue): void {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
      return;
    }

    const line = issue.Line - 1;
    const ch = Math.max(0, issue.Span[0] - 1);
    activeView.editor.setCursor({ line, ch });
    activeView.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
    this.app.workspace.setActiveLeaf(activeView.leaf, { focus: true });
  }
}
