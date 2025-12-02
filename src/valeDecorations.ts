import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';
import type { ValeIssue } from '../main';

// Define a state effect to update Vale decorations
export const setValeDecorationsEffect = StateEffect.define<ValeIssue[]>();

// Create a state field to manage Vale decorations
export const valeDecorationsField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },

  update(decorations, tr) {
    // Map existing decorations through document changes
    decorations = decorations.map(tr.changes);

    // Apply any decoration updates
    for (let effect of tr.effects) {
      if (effect.is(setValeDecorationsEffect)) {
        decorations = createDecorations(effect.value, tr.state.doc);
      }
    }

    return decorations;
  },

  provide: f => EditorView.decorations.from(f)
});

// Helper function to create decorations from Vale issues
function createDecorations(issues: ValeIssue[], doc: any): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  for (const issue of issues) {
    try {
      // Convert line/span to absolute positions
      const line = issue.Line - 1; // Vale uses 1-indexed lines

      if (line < 0 || line >= doc.lines) {
        continue; // Skip invalid line numbers
      }

      const lineObj = doc.line(line + 1); // CodeMirror uses 1-indexed for doc.line()
      const from = lineObj.from + (issue.Span[0] - 1); // Vale uses 1-indexed character positions
      const to = lineObj.from + issue.Span[1];

      if (from < 0 || to > doc.length || from >= to) {
        continue; // Skip invalid positions
      }

      // Determine CSS class based on severity
      const className = `vale-${issue.Severity.toLowerCase()}`;

      // Create the decoration with a title attribute for hover tooltips
      const decoration = Decoration.mark({
        class: className,
        attributes: {
          'data-vale-message': issue.Message,
          'data-vale-check': issue.Check,
          'title': `${issue.Severity}: ${issue.Message} (${issue.Check})`
        }
      });

      builder.add(from, to, decoration);
    } catch (e) {
      console.warn('Failed to create Vale decoration for issue:', issue, e);
    }
  }

  return builder.finish();
}

// Export the extension that combines the state field
export const valeDecorationsExtension = [valeDecorationsField];
