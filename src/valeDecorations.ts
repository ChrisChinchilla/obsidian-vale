import { EditorView, Decoration, DecorationSet, hoverTooltip } from '@codemirror/view';
import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';
import type { ValeIssue } from '../main';

// ============================================================================
// Types and Constants
// ============================================================================

type ActionType = 'remove' | 'replace' | 'suggest' | 'edit';

// Store issues for hover tooltip access
let currentIssues: ValeIssue[] = [];

// Cache for dictionary suggestions to avoid redundant lookups
const dictionarySuggestionsCache = new Map<string, string[]>();

/**
 * Get spelling suggestions from the system dictionary
 * Uses Electron's spell checker via the webFrame API
 */
async function getSpellingSuggestions(word: string): Promise<string[]> {
	// Check cache first
	const cached = dictionarySuggestionsCache.get(word);
	if (cached !== undefined) {
		return cached;
	}

	try {
		// Access Electron's spell checker through the webFrame API if available
		// @ts-ignore - Electron webFrame API
		if (window.require) {
			// @ts-ignore
			const { webFrame } = window.require('electron');
			if (webFrame?.getWordSuggestions) {
				const suggestions = webFrame.getWordSuggestions(word);
				dictionarySuggestionsCache.set(word, suggestions);
				return suggestions;
			}
		}
	} catch (e) {
		console.error('Failed to get spelling suggestions:', e);
	}

	// No spell checker available or error occurred
	dictionarySuggestionsCache.set(word, []);
	return [];
}

// ============================================================================
// Position Calculation Helpers
// ============================================================================

/**
 * Calculate the absolute position range for a Vale issue in the document
 */
function calculateIssuePosition(issue: ValeIssue, doc: any): { from: number; to: number } | null {
  const line = issue.Line - 1; // Vale uses 1-indexed lines

  if (line < 0 || line >= doc.lines) {
    return null;
  }

  const lineObj = doc.line(line + 1); // CodeMirror uses 1-indexed for doc.line()
  const from = lineObj.from + (issue.Span[0] - 1); // Vale uses 1-indexed character positions
  const to = lineObj.from + issue.Span[1];

  if (from < 0 || to > doc.length || from >= to) {
    return null;
  }

  return { from, to };
}

// ============================================================================
// Action Parsing Helpers
// ============================================================================

/**
 * Parse Vale action to determine operation type and suggestions
 * Note: For spelling actions with 'spellings' placeholder, returns empty suggestions
 * (actual suggestions need to be fetched from system dictionary)
 */
function parseValeAction(action: ValeIssue['Action']): {
  operationType: string;
  suggestions: string[];
  needsSpellCheck: boolean;
} {
  if (!action || !action.Name || !action.Params || action.Params.length === 0) {
    return { operationType: '', suggestions: [], needsSpellCheck: false };
  }

  const actionName = action.Name.toLowerCase() as ActionType;

  // For 'edit' actions, first param is the operation type
  if (actionName === 'edit') {
    return {
      operationType: action.Params[0].toLowerCase(),
      suggestions: action.Params.slice(1),
      needsSpellCheck: false
    };
  }

  // For 'suggest' actions with 'spellings' placeholder
  if (actionName === 'suggest' && action.Params.length === 1 && action.Params[0] === 'spellings') {
    return {
      operationType: 'suggest',
      suggestions: [],  // Empty - will be fetched from system dictionary
      needsSpellCheck: true
    };
  }

  // For other actions, all params are suggestions
  return {
    operationType: actionName,
    suggestions: action.Params,
    needsSpellCheck: false
  };
}

// ============================================================================
// Action Application
// ============================================================================

/**
 * Apply a Vale action to the editor
 * @param view - The CodeMirror EditorView
 * @param issue - The Vale issue containing the action
 * @param suggestionIndex - Optional index of the suggestion to apply
 * @returns true if the action was successfully applied
 */
function applyValeAction(view: EditorView, issue: ValeIssue, suggestionIndex?: number): boolean {
  if (!issue.Action || !issue.Action.Name) {
    return false;
  }

  const position = calculateIssuePosition(issue, view.state.doc);
  if (!position) {
    return false;
  }

  const { from, to } = position;
  const { operationType, suggestions } = parseValeAction(issue.Action);

  try {
    if (operationType === 'remove') {
      // Remove the highlighted text
      view.dispatch({ changes: { from, to, insert: '' } });
      return true;
    }

    if (operationType === 'replace' || operationType === 'suggest') {
      // Replace with a suggestion
      if (suggestions.length === 0) {
        return false;
      }

      const replacement = suggestionIndex !== undefined && suggestionIndex < suggestions.length
        ? suggestions[suggestionIndex]
        : suggestions[0];

      view.dispatch({ changes: { from, to, insert: replacement } });
      return true;
    }

    console.warn(`Unknown Vale action operation: ${operationType}`);
    return false;
  } catch (e) {
    console.error('Failed to apply Vale action:', e);
    return false;
  }
}

// ============================================================================
// Tooltip Generation Helpers
// ============================================================================

/**
 * Generate tooltip text for the title attribute (fallback)
 */
function generateTooltipText(issue: ValeIssue): string {
  let text = `${issue.Severity}: ${issue.Message}`;

  if (issue.Action && issue.Action.Name) {
    const { operationType, suggestions, needsSpellCheck } = parseValeAction(issue.Action);

    if (operationType === 'remove') {
      text += '\n\nAction: Remove';
    } else if (needsSpellCheck) {
      text += '\n\nSpelling suggestions available';
    } else if (suggestions.length > 0) {
      text += '\n\nSuggestions:\n' + suggestions.map(s => `  • ${s}`).join('\n');
    }
  }

  text += `\n\n(${issue.Check})`;
  return text;
}

/**
 * Create a remove button element
 */
function createRemoveButton(view: EditorView, issue: ValeIssue): HTMLElement {
  const button = document.createElement('button');
  button.className = 'vale-tooltip-action-button vale-tooltip-action-button--remove';
  button.textContent = 'Remove';
  button.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (applyValeAction(view, issue)) {
      view.focus();
    }
  };
  return button;
}

/**
 * Create a header element for suggestions section
 */
function createSuggestionsHeader(text: string): HTMLElement {
  const header = document.createElement('div');
  header.className = 'vale-tooltip-suggestions-header';
  header.textContent = text;
  return header;
}

/**
 * Create suggestion buttons
 * @param directApply - If true, directly replace text without using Vale action (for spell check)
 */
function createSuggestionButtons(
  view: EditorView,
  issue: ValeIssue,
  suggestions: string[],
  directApply: boolean = false
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'vale-tooltip-suggestions-list';

  suggestions.forEach((suggestion, index) => {
    const button = document.createElement('button');
    button.className = 'vale-tooltip-suggestion-button';
    button.textContent = suggestion;
    button.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (directApply) {
        // Directly replace text for spell check suggestions
        const position = calculateIssuePosition(issue, view.state.doc);
        if (position) {
          const { from, to } = position;
          view.dispatch({ changes: { from, to, insert: suggestion } });
          view.focus();
        }
      } else {
        // Use Vale action for regular suggestions
        if (applyValeAction(view, issue, index)) {
          view.focus();
        }
      }
    };
    container.appendChild(button);
  });

  return container;
}

/**
 * Create action UI elements based on the Vale action type
 */
function createActionUI(view: EditorView, issue: ValeIssue): HTMLElement | null {
  if (!issue.Action || !issue.Action.Name) {
    return null;
  }

  const actionName = issue.Action.Name.toLowerCase() as ActionType;

  const { operationType, suggestions, needsSpellCheck } = parseValeAction(issue.Action);

  // Handle remove actions
  if (operationType === 'remove' || actionName === 'remove') {
    const container = document.createElement('div');
    container.className = 'vale-tooltip-actions';
    container.appendChild(createRemoveButton(view, issue));
    return container;
  }

  // Handle spell check actions - fetch suggestions asynchronously
  if (needsSpellCheck) {
    const container = document.createElement('div');
    container.appendChild(createSuggestionsHeader('Loading suggestions...'));

    // Fetch spelling suggestions asynchronously
    getSpellingSuggestions(issue.Match)
      .then(spellSuggestions => {
        container.innerHTML = ''; // Clear loading message

        if (spellSuggestions.length > 0) {
          container.appendChild(createSuggestionsHeader('Suggestions:'));
          container.appendChild(createSuggestionButtons(view, issue, spellSuggestions, true));
        } else {
          container.appendChild(createSuggestionsHeader('No suggestions available'));
        }
      })
      .catch(err => {
        container.innerHTML = '';
        container.appendChild(createSuggestionsHeader('Error loading suggestions'));
        console.error('Error fetching spelling suggestions:', err);
      });

    return container;
  }

  // Handle suggestion-based actions
  if (suggestions.length > 0) {
    const container = document.createElement('div');
    container.appendChild(createSuggestionsHeader('Suggestions:'));
    container.appendChild(createSuggestionButtons(view, issue, suggestions));
    return container;
  }

  return null;
}

// ============================================================================
// Decoration Creation
// ============================================================================

/**
 * Create decorations from Vale issues
 */
function createDecorations(issues: ValeIssue[], doc: any): DecorationSet {
  currentIssues = issues;
  const builder = new RangeSetBuilder<Decoration>();

  for (const issue of issues) {
    try {
      const position = calculateIssuePosition(issue, doc);
      if (!position) {
        continue;
      }

      const { from, to } = position;
      const className = `vale-${issue.Severity.toLowerCase()}`;
      const tooltipText = generateTooltipText(issue);

      const decoration = Decoration.mark({
        class: className,
        attributes: {
          'data-vale-message': issue.Message,
          'data-vale-check': issue.Check,
          'title': tooltipText
        }
      });

      builder.add(from, to, decoration);
    } catch (e) {
      console.warn('Failed to create Vale decoration for issue:', issue, e);
    }
  }

  return builder.finish();
}

// ============================================================================
// Tooltip DOM Creation
// ============================================================================

/**
 * Create the hover tooltip DOM element
 */
function createTooltipDOM(view: EditorView, issue: ValeIssue): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'vale-tooltip-container';

  // Severity badge
  const severityEl = document.createElement('div');
  severityEl.className = `vale-tooltip-severity vale-tooltip-severity--${issue.Severity.toLowerCase()}`;
  severityEl.textContent = issue.Severity.toUpperCase();
  dom.appendChild(severityEl);

  // Message
  const messageEl = document.createElement('div');
  messageEl.className = 'vale-tooltip-message';
  messageEl.textContent = issue.Message;
  dom.appendChild(messageEl);

  // Action buttons
  const actionUI = createActionUI(view, issue);
  if (actionUI) {
    dom.appendChild(actionUI);
  }

  // Check name
  const checkEl = document.createElement('div');
  checkEl.className = 'vale-tooltip-check';
  checkEl.textContent = `Check: ${issue.Check}`;
  dom.appendChild(checkEl);

  // Link (if available)
  if (issue.Link) {
    const linkEl = document.createElement('a');
    linkEl.className = 'vale-tooltip-link';
    linkEl.href = issue.Link;
    linkEl.textContent = 'Learn more →';
    linkEl.target = '_blank';
    linkEl.onclick = (e) => {
      e.preventDefault();
      window.open(issue.Link, '_blank');
    };
    dom.appendChild(linkEl);
  }

  return dom;
}

/**
 * Find the Vale issue at the given position
 */
function findIssueAtPosition(view: EditorView, pos: number, decorations: DecorationSet): ValeIssue | undefined {
  let foundIssue: ValeIssue | undefined;

  decorations.between(pos, pos, (from, to) => {
    if (pos >= from && pos <= to && !foundIssue) {
      for (const issue of currentIssues) {
        const position = calculateIssuePosition(issue, view.state.doc);
        if (position && from === position.from && to === position.to) {
          foundIssue = issue;
          return false; // Stop iterating
        }
      }
    }
  });

  return foundIssue;
}

// ============================================================================
// State Management
// ============================================================================

// Define a state effect to update Vale decorations
export const setValeDecorationsEffect = StateEffect.define<ValeIssue[]>();

// Create a state field to manage Vale decorations
export const valeDecorationsField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },

  update(decorations, tr) {
    decorations = decorations.map(tr.changes);

    for (const effect of tr.effects) {
      if (effect.is(setValeDecorationsEffect)) {
        decorations = createDecorations(effect.value, tr.state.doc);
      }
    }

    return decorations;
  },

  provide: f => EditorView.decorations.from(f)
});

// ============================================================================
// Hover Tooltip Extension
// ============================================================================

/**
 * Create a hover tooltip extension for Vale issues
 */
const valeHoverTooltip = hoverTooltip((view, pos) => {
  const decorations = view.state.field(valeDecorationsField);
  const issue = findIssueAtPosition(view, pos, decorations);

  if (!issue) {
    return null;
  }

  return {
    pos,
    above: true,
    create: () => ({ dom: createTooltipDOM(view, issue) })
  };
});

// ============================================================================
// Exports
// ============================================================================

export const valeDecorationsExtension = [valeDecorationsField, valeHoverTooltip];
