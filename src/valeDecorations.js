import { EditorView, Decoration, hoverTooltip } from '@codemirror/view';
import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';
// Store issues for hover tooltip access
let currentIssues = [];
// Cache for dictionary suggestions to avoid redundant lookups
const dictionarySuggestionsCache = new Map();
/**
 * Get spelling suggestions from the system dictionary
 * Uses Electron's spell checker via the webFrame API
 */
function getSpellingSuggestions(word) {
    // Check cache first
    const cached = dictionarySuggestionsCache.get(word);
    if (cached !== undefined) {
        return Promise.resolve(cached);
    }
    try {
        // Access Electron's spell checker through the webFrame API if available
        // @ts-ignore - Electron webFrame API
        if (window.require) {
            // @ts-ignore
            const { webFrame } = window.require('electron');
            if (webFrame === null || webFrame === void 0 ? void 0 : webFrame.getWordSuggestions) {
                const suggestions = webFrame.getWordSuggestions(word);
                dictionarySuggestionsCache.set(word, suggestions);
                return Promise.resolve(suggestions);
            }
        }
    }
    catch (e) {
        console.error('Failed to get spelling suggestions:', e);
    }
    // No spell checker available or error occurred
    dictionarySuggestionsCache.set(word, []);
    return Promise.resolve([]);
}
// ============================================================================
// Position Calculation Helpers
// ============================================================================
/**
 * Calculate the absolute position range for a Vale issue in the document
 */
function calculateIssuePosition(issue, doc) {
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
function parseValeAction(action) {
    if (!action || !action.Name || !action.Params || action.Params.length === 0) {
        return { operationType: '', suggestions: [], needsSpellCheck: false };
    }
    const actionName = action.Name.toLowerCase();
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
            suggestions: [], // Empty - will be fetched from system dictionary
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
function applyValeAction(view, issue, suggestionIndex) {
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
    }
    catch (e) {
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
function generateTooltipText(issue) {
    let text = `${issue.Severity}: ${issue.Message}`;
    if (issue.Action && issue.Action.Name) {
        const { operationType, suggestions, needsSpellCheck } = parseValeAction(issue.Action);
        if (operationType === 'remove') {
            text += '\n\nAction: Remove';
        }
        else if (needsSpellCheck) {
            text += '\n\nSpelling suggestions available';
        }
        else if (suggestions.length > 0) {
            text += '\n\nSuggestions:\n' + suggestions.map(s => `  • ${s}`).join('\n');
        }
    }
    text += `\n\n(${issue.Check})`;
    return text;
}
/**
 * Create a remove button element
 */
function createRemoveButton(view, issue) {
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
function createSuggestionsHeader(text) {
    const header = document.createElement('div');
    header.className = 'vale-tooltip-suggestions-header';
    header.textContent = text;
    return header;
}
/**
 * Create suggestion buttons
 * @param directApply - If true, directly replace text without using Vale action (for spell check)
 */
function createSuggestionButtons(view, issue, suggestions, directApply = false) {
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
            }
            else {
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
function createActionUI(view, issue) {
    if (!issue.Action || !issue.Action.Name) {
        return null;
    }
    const actionName = issue.Action.Name.toLowerCase();
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
            }
            else {
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
function createDecorations(issues, doc) {
    currentIssues = issues;
    const builder = new RangeSetBuilder();
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
        }
        catch (e) {
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
function createTooltipDOM(view, issue) {
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
function findIssueAtPosition(view, pos, decorations) {
    let foundIssue;
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
export const setValeDecorationsEffect = StateEffect.define();
// Create a state field to manage Vale decorations
export const valeDecorationsField = StateField.define({
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmFsZURlY29yYXRpb25zLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsidmFsZURlY29yYXRpb25zLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sRUFBRSxVQUFVLEVBQUUsVUFBVSxFQUFpQixZQUFZLEVBQUUsTUFBTSxrQkFBa0IsQ0FBQztBQUN2RixPQUFPLEVBQUUsVUFBVSxFQUFFLFdBQVcsRUFBRSxlQUFlLEVBQUUsTUFBTSxtQkFBbUIsQ0FBQztBQVM3RSx3Q0FBd0M7QUFDeEMsSUFBSSxhQUFhLEdBQWdCLEVBQUUsQ0FBQztBQUVwQyw4REFBOEQ7QUFDOUQsTUFBTSwwQkFBMEIsR0FBRyxJQUFJLEdBQUcsRUFBb0IsQ0FBQztBQUUvRDs7O0dBR0c7QUFDSCxTQUFTLHNCQUFzQixDQUFDLElBQVk7SUFDM0Msb0JBQW9CO0lBQ3BCLE1BQU0sTUFBTSxHQUFHLDBCQUEwQixDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUNwRCxJQUFJLE1BQU0sS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUMxQixPQUFPLE9BQU8sQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDaEMsQ0FBQztJQUVELElBQUksQ0FBQztRQUNKLHdFQUF3RTtRQUN4RSxxQ0FBcUM7UUFDckMsSUFBSSxNQUFNLENBQUMsT0FBTyxFQUFFLENBQUM7WUFDcEIsYUFBYTtZQUNiLE1BQU0sRUFBRSxRQUFRLEVBQUUsR0FBRyxNQUFNLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDO1lBQ2hELElBQUksUUFBUSxhQUFSLFFBQVEsdUJBQVIsUUFBUSxDQUFFLGtCQUFrQixFQUFFLENBQUM7Z0JBQ2xDLE1BQU0sV0FBVyxHQUFHLFFBQVEsQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsQ0FBQztnQkFDdEQsMEJBQTBCLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxXQUFXLENBQUMsQ0FBQztnQkFDbEQsT0FBTyxPQUFPLENBQUMsT0FBTyxDQUFD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QUFDLElBQUksQ0FBQyxDQUFDLENBQUM7Q0FDN0MsQ0FBQyxDQUFDO0FBRUgsK0VBQStFO0FBQy9FLDBCQUEwQjtBQUMxQiwrRUFBK0U7QUFFL0U7O0dBRUc7QUFDSCxNQUFNLGdCQUFnQixHQUFHLFlBQVksQ0FBQyxDQUFDLElBQUksRUFBRSxHQUFHLEVBQUUsRUFBRTtJQUNsRCxNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDO0lBQzNELE1BQU0sS0FBSyxHQUFHLG1CQUFtQixDQUFDLElBQUksRUFBRSxHQUFHLEVBQUUsV0FBVyxDQUFDLENBQUM7SUFFMUQsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ1gsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRUQsT0FBTztRQUNMLEdBQUc7UUFDSCxLQUFLLEVBQUUsSUFBSTtRQUNYLE1BQU0sRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDLEVBQUUsR0FBRyxFQUFFLGdCQUFnQixDQUFDLElBQUksRUFBRSxLQUFLLENBQUMsRUFBRSxDQUFDO0tBQ3ZELENBQUM7QUFDSixDQUFDLENBQUMsQ0FBQztBQUVILCtFQUErRTtBQUMvRSxVQUFVO0FBQ1YsK0VBQStFO0FBRS9FLE1BQU0sQ0FBQyxNQUFNLHdCQUF3QixHQUFHLENBQUMsb0JBQW9CLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEVkaXRvclZpZXcsIERlY29yYXRpb24sIERlY29yYXRpb25TZXQsIGhvdmVyVG9vbHRpcCB9IGZyb20gJ0Bjb2RlbWlycm9yL3ZpZXcnO1xuaW1wb3J0IHsgU3RhdGVGaWVsZCwgU3RhdGVFZmZlY3QsIFJhbmdlU2V0QnVpbGRlciB9IGZyb20gJ0Bjb2RlbWlycm9yL3N0YXRlJztcbmltcG9ydCB0eXBlIHsgVmFsZUlzc3VlIH0gZnJvbSAnLi4vbWFpbic7XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFR5cGVzIGFuZCBDb25zdGFudHNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxudHlwZSBBY3Rpb25UeXBlID0gJ3JlbW92ZScgfCAncmVwbGFjZScgfCAnc3VnZ2VzdCcgfCAnZWRpdCc7XG5cbi8vIFN0b3JlIGlzc3VlcyBmb3IgaG92ZXIgdG9vbHRpcCBhY2Nlc3NcbmxldCBjdXJyZW50SXNzdWVzOiBWYWxlSXNzdWVbXSA9IFtdO1xuXG4vLyBDYWNoZSBmb3IgZGljdGlvbmFyeSBzdWdnZXN0aW9ucyB0byBhdm9pZCByZWR1bmRhbnQgbG9va3Vwc1xuY29uc3QgZGljdGlvbmFyeVN1Z2dlc3Rpb25zQ2FjaGUgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nW10+KCk7XG5cbi8qKlxuICogR2V0IHNwZWxsaW5nIHN1Z2dlc3Rpb25zIGZyb20gdGhlIHN5c3RlbSBkaWN0aW9uYXJ5XG4gKiBVc2VzIEVsZWN0cm9uJ3Mgc3BlbGwgY2hlY2tlciB2aWEgdGhlIHdlYkZyYW1lIEFQSVxuICovXG5mdW5jdGlvbiBnZXRTcGVsbGluZ1N1Z2dlc3Rpb25zKHdvcmQ6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nW10+IHtcblx0Ly8gQ2hlY2sgY2FjaGUgZmlyc3Rcblx0Y29uc3QgY2FjaGVkID0gZGljdGlvbmFyeVN1Z2dlc3Rpb25zQ2FjaGUuZ2V0KHdvcmQpO1xuXHRpZiAoY2FjaGVkICE9PSB1bmRlZmluZWQpIHtcblx0XHRyZXR1cm4gUHJvbWlzZS5yZXNvbHZlKGNhY2hlZCk7XG5cdH1cblxuXHR0cnkge1xuXHRcdC8vIEFjY2VzcyBFbGVjdHJvbidzIHNwZWxsIGNoZWNrZXIgdGhyb3VnaCB0aGUgd2ViRnJhbWUgQVBJIGlmIGF2YWlsYWJsZVxuXHRcdC8vIEB0cy1pZ25vcmUgLSBFbGVjdHJvbiB3ZWJGcmFtZSBBUElcblx0XHRpZiAod2luZG93LnJlcXVpcmUpIHtcblx0XHRcdC8vIEB0cy1pZ25vcmVcblx0XHRcdGNvbnN0IHsgd2ViRnJhbWUgfSA9IHdpbmRvdy5yZXF1aXJlKCdlbGVjdHJvbicpO1xuXHRcdFx0aWYgKHdlYkZyYW1lPy5nZXRXb3JkU3VnZ2VzdGlvbnMpIHtcblx0XHRcdFx0Y29uc3Qgc3VnZ2VzdGlvbnMgPSB3ZWJGcmFtZS5nZXRXb3JkU3VnZ2VzdGlvbnMod29yZCk7XG5cdFx0XHRcdGRpY3Rpb25hcnlTdWdnZXN0aW9uc0NhY2hlLnNldCh3b3JkLCBzdWdnZXN0aW9ucyk7XG5cdFx0XHRcdHJldHVybiBQcm9taXNlLnJlc29sdmUoc3VnZ2VzdGlvbnMpO1xuXHRcdFx0fVxuXHRcdH1cblx0fSBjYXRjaCAoZSkge1xuXHRcdGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBnZXQgc3BlbGxpbmcgc3VnZ2VzdGlvbnM6JywgZSk7XG5cdH1cblxuXHQvLyBObyBzcGVsbCBjaGVja2VyIGF2YWlsYWJsZSBvciBlcnJvciBvY2N1cnJlZFxuXHRkaWN0aW9uYXJ5U3VnZ2VzdGlvbnNDYWNoZS5zZXQod29yZCwgW10pO1xuXHRyZXR1cm4gUHJvbWlzZS5yZXNvbHZlKFtdKTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gUG9zaXRpb24gQ2FsY3VsYXRpb24gSGVscGVyc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIENhbGN1bGF0ZSB0aGUgYWJzb2x1dGUgcG9zaXRpb24gcmFuZ2UgZm9yIGEgVmFsZSBpc3N1ZSBpbiB0aGUgZG9jdW1lbnRcbiAqL1xuZnVuY3Rpb24gY2FsY3VsYXRlSXNzdWVQb3NpdGlvbihcbiAgaXNzdWU6IFZhbGVJc3N1ZSxcbiAgZG9jOiB7IGxpbmVzOiBudW1iZXI7IGxlbmd0aDogbnVtYmVyOyBsaW5lOiAobnVtOiBudW1iZXIpID0+IHsgZnJvbTogbnVtYmVyIH0gfVxuKTogeyBmcm9tOiBudW1iZXI7IHRvOiBudW1iZXIgfSB8IG51bGwge1xuICBjb25zdCBsaW5lID0gaXNzdWUuTGluZSAtIDE7IC8vIFZhbGUgdXNlcyAxLWluZGV4ZWQgbGluZXNcblxuICBpZiAobGluZSA8IDAgfHwgbGluZSA+PSBkb2MubGluZXMpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IGxpbmVPYmogPSBkb2MubGluZShsaW5lICsgMSk7IC8vIENvZGVNaXJyb3IgdXNlcyAxLWluZGV4ZWQgZm9yIGRvYy5saW5lKClcbiAgY29uc3QgZnJvbSA9IGxpbmVPYmouZnJvbSArIChpc3N1ZS5TcGFuWzBdIC0gMSk7IC8vIFZhbGUgdXNlcyAxLWluZGV4ZWQgY2hhcmFjdGVyIHBvc2l0aW9uc1xuICBjb25zdCB0byA9IGxpbmVPYmouZnJvbSArIGlzc3VlLlNwYW5bMV07XG5cbiAgaWYgKGZyb20gPCAwIHx8IHRvID4gZG9jLmxlbmd0aCB8fCBmcm9tID49IHRvKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICByZXR1cm4geyBmcm9tLCB0byB9O1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBBY3Rpb24gUGFyc2luZyBIZWxwZXJzXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogUGFyc2UgVmFsZSBhY3Rpb24gdG8gZGV0ZXJtaW5lIG9wZXJhdGlvbiB0eXBlIGFuZCBzdWdnZXN0aW9uc1xuICogTm90ZTogRm9yIHNwZWxsaW5nIGFjdGlvbnMgd2l0aCAnc3BlbGxpbmdzJyBwbGFjZWhvbGRlciwgcmV0dXJucyBlbXB0eSBzdWdnZXN0aW9uc1xuICogKGFjdHVhbCBzdWdnZXN0aW9ucyBuZWVkIHRvIGJlIGZldGNoZWQgZnJvbSBzeXN0ZW0gZGljdGlvbmFyeSlcbiAqL1xuZnVuY3Rpb24gcGFyc2VWYWxlQWN0aW9uKGFjdGlvbjogVmFsZUlzc3VlWydBY3Rpb24nXSk6IHtcbiAgb3BlcmF0aW9uVHlwZTogc3RyaW5nO1xuICBzdWdnZXN0aW9uczogc3RyaW5nW107XG4gIG5lZWRzU3BlbGxDaGVjazogYm9vbGVhbjtcbn0ge1xuICBpZiAoIWFjdGlvbiB8fCAhYWN0aW9uLk5hbWUgfHwgIWFjdGlvbi5QYXJhbXMgfHwgYWN0aW9uLlBhcmFtcy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4geyBvcGVyYXRpb25UeXBlOiAnJywgc3VnZ2VzdGlvbnM6IFtdLCBuZWVkc1NwZWxsQ2hlY2s6IGZhbHNlIH07XG4gIH1cblxuICBjb25zdCBhY3Rpb25OYW1lID0gYWN0aW9uLk5hbWUudG9Mb3dlckNhc2UoKSBhcyBBY3Rpb25UeXBlO1xuXG4gIC8vIEZvciAnZWRpdCcgYWN0aW9ucywgZmlyc3QgcGFyYW0gaXMgdGhlIG9wZXJhdGlvbiB0eXBlXG4gIGlmIChhY3Rpb25OYW1lID09PSAnZWRpdCcpIHtcbiAgICByZXR1cm4ge1xuICAgICAgb3BlcmF0aW9uVHlwZTogYWN0aW9uLlBhcmFtc1swXS50b0xvd2VyQ2FzZSgpLFxuICAgICAgc3VnZ2VzdGlvbnM6IGFjdGlvbi5QYXJhbXMuc2xpY2UoMSksXG4gICAgICBuZWVkc1NwZWxsQ2hlY2s6IGZhbHNlXG4gICAgfTtcbiAgfVxuXG4gIC8vIEZvciAnc3VnZ2VzdCcgYWN0aW9ucyB3aXRoICdzcGVsbGluZ3MnIHBsYWNlaG9sZGVyXG4gIGlmIChhY3Rpb25OYW1lID09PSAnc3VnZ2VzdCcgJiYgYWN0aW9uLlBhcmFtcy5sZW5ndGggPT09IDEgJiYgYWN0aW9uLlBhcmFtc1swXSA9PT0gJ3NwZWxsaW5ncycpIHtcbiAgICByZXR1cm4ge1xuICAgICAgb3BlcmF0aW9uVHlwZTogJ3N1Z2dlc3QnLFxuICAgICAgc3VnZ2VzdGlvbnM6IFtdLCAgLy8gRW1wdHkgLSB3aWxsIGJlIGZldGNoZWQgZnJvbSBzeXN0ZW0gZGljdGlvbmFyeVxuICAgICAgbmVlZHNTcGVsbENoZWNrOiB0cnVlXG4gICAgfTtcbiAgfVxuXG4gIC8vIEZvciBvdGhlciBhY3Rpb25zLCBhbGwgcGFyYW1zIGFyZSBzdWdnZXN0aW9uc1xuICByZXR1cm4ge1xuICAgIG9wZXJhdGlvblR5cGU6IGFjdGlvbk5hbWUsXG4gICAgc3VnZ2VzdGlvbnM6IGFjdGlvbi5QYXJhbXMsXG4gICAgbmVlZHNTcGVsbENoZWNrOiBmYWxzZVxuICB9O1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBBY3Rpb24gQXBwbGljYXRpb25cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBBcHBseSBhIFZhbGUgYWN0aW9uIHRvIHRoZSBlZGl0b3JcbiAqIEBwYXJhbSB2aWV3IC0gVGhlIENvZGVNaXJyb3IgRWRpdG9yVmlld1xuICogQHBhcmFtIGlzc3VlIC0gVGhlIFZhbGUgaXNzdWUgY29udGFpbmluZyB0aGUgYWN0aW9uXG4gKiBAcGFyYW0gc3VnZ2VzdGlvbkluZGV4IC0gT3B0aW9uYWwgaW5kZXggb2YgdGhlIHN1Z2dlc3Rpb24gdG8gYXBwbHlcbiAqIEByZXR1cm5zIHRydWUgaWYgdGhlIGFjdGlvbiB3YXMgc3VjY2Vzc2Z1bGx5IGFwcGxpZWRcbiAqL1xuZnVuY3Rpb24gYXBwbHlWYWxlQWN0aW9uKHZpZXc6IEVkaXRvclZpZXcsIGlzc3VlOiBWYWxlSXNzdWUsIHN1Z2dlc3Rpb25JbmRleD86IG51bWJlcik6IGJvb2xlYW4ge1xuICBpZiAoIWlzc3VlLkFjdGlvbiB8fCAhaXNzdWUuQWN0aW9uLk5hbWUpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBjb25zdCBwb3NpdGlvbiA9IGNhbGN1bGF0ZUlzc3VlUG9zaXRpb24oaXNzdWUsIHZpZXcuc3RhdGUuZG9jKTtcbiAgaWYgKCFwb3NpdGlvbikge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGNvbnN0IHsgZnJvbSwgdG8gfSA9IHBvc2l0aW9uO1xuICBjb25zdCB7IG9wZXJhdGlvblR5cGUsIHN1Z2dlc3Rpb25zIH0gPSBwYXJzZVZhbGVBY3Rpb24oaXNzdWUuQWN0aW9uKTtcblxuICB0cnkge1xuICAgIGlmIChvcGVyYXRpb25UeXBlID09PSAncmVtb3ZlJykge1xuICAgICAgLy8gUmVtb3ZlIHRoZSBoaWdobGlnaHRlZCB0ZXh0XG4gICAgICB2aWV3LmRpc3BhdGNoKHsgY2hhbmdlczogeyBmcm9tLCB0bywgaW5zZXJ0OiAnJyB9IH0pO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgaWYgKG9wZXJhdGlvblR5cGUgPT09ICdyZXBsYWNlJyB8fCBvcGVyYXRpb25UeXBlID09PSAnc3VnZ2VzdCcpIHtcbiAgICAgIC8vIFJlcGxhY2Ugd2l0aCBhIHN1Z2dlc3Rpb25cbiAgICAgIGlmIChzdWdnZXN0aW9ucy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuXG4gICAgICBjb25zdCByZXBsYWNlbWVudCA9IHN1Z2dlc3Rpb25JbmRleCAhPT0gdW5kZWZpbmVkICYmIHN1Z2dlc3Rpb25JbmRleCA8IHN1Z2dlc3Rpb25zLmxlbmd0aFxuICAgICAgICA/IHN1Z2dlc3Rpb25zW3N1Z2dlc3Rpb25JbmRleF1cbiAgICAgICAgOiBzdWdnZXN0aW9uc1swXTtcblxuICAgICAgdmlldy5kaXNwYXRjaCh7IGNoYW5nZXM6IHsgZnJvbSwgdG8sIGluc2VydDogcmVwbGFjZW1lbnQgfSB9KTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIGNvbnNvbGUud2FybihgVW5rbm93biBWYWxlIGFjdGlvbiBvcGVyYXRpb246ICR7b3BlcmF0aW9uVHlwZX1gKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gYXBwbHkgVmFsZSBhY3Rpb246JywgZSk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFRvb2x0aXAgR2VuZXJhdGlvbiBIZWxwZXJzXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogR2VuZXJhdGUgdG9vbHRpcCB0ZXh0IGZvciB0aGUgdGl0bGUgYXR0cmlidXRlIChmYWxsYmFjaylcbiAqL1xuZnVuY3Rpb24gZ2VuZXJhdGVUb29sdGlwVGV4dChpc3N1ZTogVmFsZUlzc3VlKTogc3RyaW5nIHtcbiAgbGV0IHRleHQgPSBgJHtpc3N1ZS5TZXZlcml0eX06ICR7aXNzdWUuTWVzc2FnZX1gO1xuXG4gIGlmIChpc3N1ZS5BY3Rpb24gJiYgaXNzdWUuQWN0aW9uLk5hbWUpIHtcbiAgICBjb25zdCB7IG9wZXJhdGlvblR5cGUsIHN1Z2dlc3Rpb25zLCBuZWVkc1NwZWxsQ2hlY2sgfSA9IHBhcnNlVmFsZUFjdGlvbihpc3N1ZS5BY3Rpb24pO1xuXG4gICAgaWYgKG9wZXJhdGlvblR5cGUgPT09ICdyZW1vdmUnKSB7XG4gICAgICB0ZXh0ICs9ICdcXG5cXG5BY3Rpb246IFJlbW92ZSc7XG4gICAgfSBlbHNlIGlmIChuZWVkc1NwZWxsQ2hlY2spIHtcbiAgICAgIHRleHQgKz0gJ1xcblxcblNwZWxsaW5nIHN1Z2dlc3Rpb25zIGF2YWlsYWJsZSc7XG4gICAgfSBlbHNlIGlmIChzdWdnZXN0aW9ucy5sZW5ndGggPiAwKSB7XG4gICAgICB0ZXh0ICs9ICdcXG5cXG5TdWdnZXN0aW9uczpcXG4nICsgc3VnZ2VzdGlvbnMubWFwKHMgPT4gYCAg4oCiICR7c31gKS5qb2luKCdcXG4nKTtcbiAgICB9XG4gIH1cblxuICB0ZXh0ICs9IGBcXG5cXG4oJHtpc3N1ZS5DaGVja30pYDtcbiAgcmV0dXJuIHRleHQ7XG59XG5cbi8qKlxuICogQ3JlYXRlIGEgcmVtb3ZlIGJ1dHRvbiBlbGVtZW50XG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZVJlbW92ZUJ1dHRvbih2aWV3OiBFZGl0b3JWaWV3LCBpc3N1ZTogVmFsZUlzc3VlKTogSFRNTEVsZW1lbnQge1xuICBjb25zdCBidXR0b24gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdidXR0b24nKTtcbiAgYnV0dG9uLmNsYXNzTmFtZSA9ICd2YWxlLXRvb2x0aXAtYWN0aW9uLWJ1dHRvbiB2YWxlLXRvb2x0aXAtYWN0aW9uLWJ1dHRvbi0tcmVtb3ZlJztcbiAgYnV0dG9uLnRleHRDb250ZW50ID0gJ1JlbW92ZSc7XG4gIGJ1dHRvbi5vbmNsaWNrID0gKGUpID0+IHtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICBpZiAoYXBwbHlWYWxlQWN0aW9uKHZpZXcsIGlzc3VlKSkge1xuICAgICAgdmlldy5mb2N1cygpO1xuICAgIH1cbiAgfTtcbiAgcmV0dXJuIGJ1dHRvbjtcbn1cblxuLyoqXG4gKiBDcmVhdGUgYSBoZWFkZXIgZWxlbWVudCBmb3Igc3VnZ2VzdGlvbnMgc2VjdGlvblxuICovXG5mdW5jdGlvbiBjcmVhdGVTdWdnZXN0aW9uc0hlYWRlcih0ZXh0OiBzdHJpbmcpOiBIVE1MRWxlbWVudCB7XG4gIGNvbnN0IGhlYWRlciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBoZWFkZXIuY2xhc3NOYW1lID0gJ3ZhbGUtdG9vbHRpcC1zdWdnZXN0aW9ucy1oZWFkZXInO1xuICBoZWFkZXIudGV4dENvbnRlbnQgPSB0ZXh0O1xuICByZXR1cm4gaGVhZGVyO1xufVxuXG4vKipcbiAqIENyZWF0ZSBzdWdnZXN0aW9uIGJ1dHRvbnNcbiAqIEBwYXJhbSBkaXJlY3RBcHBseSAtIElmIHRydWUsIGRpcmVjdGx5IHJlcGxhY2UgdGV4dCB3aXRob3V0IHVzaW5nIFZhbGUgYWN0aW9uIChmb3Igc3BlbGwgY2hlY2spXG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZVN1Z2dlc3Rpb25CdXR0b25zKFxuICB2aWV3OiBFZGl0b3JWaWV3LFxuICBpc3N1ZTogVmFsZUlzc3VlLFxuICBzdWdnZXN0aW9uczogc3RyaW5nW10sXG4gIGRpcmVjdEFwcGx5OiBib29sZWFuID0gZmFsc2Vcbik6IEhUTUxFbGVtZW50IHtcbiAgY29uc3QgY29udGFpbmVyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIGNvbnRhaW5lci5jbGFzc05hbWUgPSAndmFsZS10b29sdGlwLXN1Z2dlc3Rpb25zLWxpc3QnO1xuXG4gIHN1Z2dlc3Rpb25zLmZvckVhY2goKHN1Z2dlc3Rpb24sIGluZGV4KSA9PiB7XG4gICAgY29uc3QgYnV0dG9uID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYnV0dG9uJyk7XG4gICAgYnV0dG9uLmNsYXNzTmFtZSA9ICd2YWxlLXRvb2x0aXAtc3VnZ2VzdGlvbi1idXR0b24nO1xuICAgIGJ1dHRvbi50ZXh0Q29udGVudCA9IHN1Z2dlc3Rpb247XG4gICAgYnV0dG9uLm9uY2xpY2sgPSAoZSkgPT4ge1xuICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcblxuICAgICAgaWYgKGRpcmVjdEFwcGx5KSB7XG4gICAgICAgIC8vIERpcmVjdGx5IHJlcGxhY2UgdGV4dCBmb3Igc3BlbGwgY2hlY2sgc3VnZ2VzdGlvbnNcbiAgICAgICAgY29uc3QgcG9zaXRpb24gPSBjYWxjdWxhdGVJc3N1ZVBvc2l0aW9uKGlzc3VlLCB2aWV3LnN0YXRlLmRvYyk7XG4gICAgICAgIGlmIChwb3NpdGlvbikge1xuICAgICAgICAgIGNvbnN0IHsgZnJvbSwgdG8gfSA9IHBvc2l0aW9uO1xuICAgICAgICAgIHZpZXcuZGlzcGF0Y2goeyBjaGFuZ2VzOiB7IGZyb20sIHRvLCBpbnNlcnQ6IHN1Z2dlc3Rpb24gfSB9KTtcbiAgICAgICAgICB2aWV3LmZvY3VzKCk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFVzZSBWYWxlIGFjdGlvbiBmb3IgcmVndWxhciBzdWdnZXN0aW9uc1xuICAgICAgICBpZiAoYXBwbHlWYWxlQWN0aW9uKHZpZXcsIGlzc3VlLCBpbmRleCkpIHtcbiAgICAgICAgICB2aWV3LmZvY3VzKCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9O1xuICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChidXR0b24pO1xuICB9KTtcblxuICByZXR1cm4gY29udGFpbmVyO1xufVxuXG4vKipcbiAqIENyZWF0ZSBhY3Rpb24gVUkgZWxlbWVudHMgYmFzZWQgb24gdGhlIFZhbGUgYWN0aW9uIHR5cGVcbiAqL1xuZnVuY3Rpb24gY3JlYXRlQWN0aW9uVUkodmlldzogRWRpdG9yVmlldywgaXNzdWU6IFZhbGVJc3N1ZSk6IEhUTUxFbGVtZW50IHwgbnVsbCB7XG4gIGlmICghaXNzdWUuQWN0aW9uIHx8ICFpc3N1ZS5BY3Rpb24uTmFtZSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3QgYWN0aW9uTmFtZSA9IGlzc3VlLkFjdGlvbi5OYW1lLnRvTG93ZXJDYXNlKCkgYXMgQWN0aW9uVHlwZTtcblxuICBjb25zdCB7IG9wZXJhdGlvblR5cGUsIHN1Z2dlc3Rpb25zLCBuZWVkc1NwZWxsQ2hlY2sgfSA9IHBhcnNlVmFsZUFjdGlvbihpc3N1ZS5BY3Rpb24pO1xuXG4gIC8vIEhhbmRsZSByZW1vdmUgYWN0aW9uc1xuICBpZiAob3BlcmF0aW9uVHlwZSA9PT0gJ3JlbW92ZScgfHwgYWN0aW9uTmFtZSA9PT0gJ3JlbW92ZScpIHtcbiAgICBjb25zdCBjb250YWluZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgICBjb250YWluZXIuY2xhc3NOYW1lID0gJ3ZhbGUtdG9vbHRpcC1hY3Rpb25zJztcbiAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQoY3JlYXRlUmVtb3ZlQnV0dG9uKHZpZXcsIGlzc3VlKSk7XG4gICAgcmV0dXJuIGNvbnRhaW5lcjtcbiAgfVxuXG4gIC8vIEhhbmRsZSBzcGVsbCBjaGVjayBhY3Rpb25zIC0gZmV0Y2ggc3VnZ2VzdGlvbnMgYXN5bmNocm9ub3VzbHlcbiAgaWYgKG5lZWRzU3BlbGxDaGVjaykge1xuICAgIGNvbnN0IGNvbnRhaW5lciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChjcmVhdGVTdWdnZXN0aW9uc0hlYWRlcignTG9hZGluZyBzdWdnZXN0aW9ucy4uLicpKTtcblxuICAgIC8vIEZldGNoIHNwZWxsaW5nIHN1Z2dlc3Rpb25zIGFzeW5jaHJvbm91c2x5XG4gICAgZ2V0U3BlbGxpbmdTdWdnZXN0aW9ucyhpc3N1ZS5NYXRjaClcbiAgICAgIC50aGVuKHNwZWxsU3VnZ2VzdGlvbnMgPT4ge1xuICAgICAgICBjb250YWluZXIuaW5uZXJIVE1MID0gJyc7IC8vIENsZWFyIGxvYWRpbmcgbWVzc2FnZVxuXG4gICAgICAgIGlmIChzcGVsbFN1Z2dlc3Rpb25zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQoY3JlYXRlU3VnZ2VzdGlvbnNIZWFkZXIoJ1N1Z2dlc3Rpb25zOicpKTtcbiAgICAgICAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQoY3JlYXRlU3VnZ2VzdGlvbkJ1dHRvbnModmlldywgaXNzdWUsIHNwZWxsU3VnZ2VzdGlvbnMsIHRydWUpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQoY3JlYXRlU3VnZ2VzdGlvbnNIZWFkZXIoJ05vIHN1Z2dlc3Rpb25zIGF2YWlsYWJsZScpKTtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIC5jYXRjaChlcnIgPT4ge1xuICAgICAgICBjb250YWluZXIuaW5uZXJIVE1MID0gJyc7XG4gICAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChjcmVhdGVTdWdnZXN0aW9uc0hlYWRlcignRXJyb3IgbG9hZGluZyBzdWdnZXN0aW9ucycpKTtcbiAgICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgZmV0Y2hpbmcgc3BlbGxpbmcgc3VnZ2VzdGlvbnM6JywgZXJyKTtcbiAgICAgIH0pO1xuXG4gICAgcmV0dXJuIGNvbnRhaW5lcjtcbiAgfVxuXG4gIC8vIEhhbmRsZSBzdWdnZXN0aW9uLWJhc2VkIGFjdGlvbnNcbiAgaWYgKHN1Z2dlc3Rpb25zLmxlbmd0aCA+IDApIHtcbiAgICBjb25zdCBjb250YWluZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQoY3JlYXRlU3VnZ2VzdGlvbnNIZWFkZXIoJ1N1Z2dlc3Rpb25zOicpKTtcbiAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQoY3JlYXRlU3VnZ2VzdGlvbkJ1dHRvbnModmlldywgaXNzdWUsIHN1Z2dlc3Rpb25zKSk7XG4gICAgcmV0dXJuIGNvbnRhaW5lcjtcbiAgfVxuXG4gIHJldHVybiBudWxsO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBEZWNvcmF0aW9uIENyZWF0aW9uXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogQ3JlYXRlIGRlY29yYXRpb25zIGZyb20gVmFsZSBpc3N1ZXNcbiAqL1xuZnVuY3Rpb24gY3JlYXRlRGVjb3JhdGlvbnMoXG4gIGlzc3VlczogVmFsZUlzc3VlW10sXG4gIGRvYzogeyBsaW5lczogbnVtYmVyOyBsZW5ndGg6IG51bWJlcjsgbGluZTogKG51bTogbnVtYmVyKSA9PiB7IGZyb206IG51bWJlciB9IH1cbik6IERlY29yYXRpb25TZXQge1xuICBjdXJyZW50SXNzdWVzID0gaXNzdWVzO1xuICBjb25zdCBidWlsZGVyID0gbmV3IFJhbmdlU2V0QnVpbGRlcjxEZWNvcmF0aW9uPigpO1xuXG4gIGZvciAoY29uc3QgaXNzdWUgb2YgaXNzdWVzKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHBvc2l0aW9uID0gY2FsY3VsYXRlSXNzdWVQb3NpdGlvbihpc3N1ZSwgZG9jKTtcbiAgICAgIGlmICghcG9zaXRpb24pIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHsgZnJvbSwgdG8gfSA9IHBvc2l0aW9uO1xuICAgICAgY29uc3QgY2xhc3NOYW1lID0gYHZhbGUtJHtpc3N1ZS5TZXZlcml0eS50b0xvd2VyQ2FzZSgpfWA7XG4gICAgICBjb25zdCB0b29sdGlwVGV4dCA9IGdlbmVyYXRlVG9vbHRpcFRleHQoaXNzdWUpO1xuXG4gICAgICBjb25zdCBkZWNvcmF0aW9uID0gRGVjb3JhdGlvbi5tYXJrKHtcbiAgICAgICAgY2xhc3M6IGNsYXNzTmFtZSxcbiAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgICdkYXRhLXZhbGUtbWVzc2FnZSc6IGlzc3VlLk1lc3NhZ2UsXG4gICAgICAgICAgJ2RhdGEtdmFsZS1jaGVjayc6IGlzc3VlLkNoZWNrLFxuICAgICAgICAgICd0aXRsZSc6IHRvb2x0aXBUZXh0XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBidWlsZGVyLmFkZChmcm9tLCB0bywgZGVjb3JhdGlvbik7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc29sZS53YXJuKCdGYWlsZWQgdG8gY3JlYXRlIFZhbGUgZGVjb3JhdGlvbiBmb3IgaXNzdWU6JywgaXNzdWUsIGUpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBidWlsZGVyLmZpbmlzaCgpO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBUb29sdGlwIERPTSBDcmVhdGlvblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIENyZWF0ZSB0aGUgaG92ZXIgdG9vbHRpcCBET00gZWxlbWVudFxuICovXG5mdW5jdGlvbiBjcmVhdGVUb29sdGlwRE9NKHZpZXc6IEVkaXRvclZpZXcsIGlzc3VlOiBWYWxlSXNzdWUpOiBIVE1MRWxlbWVudCB7XG4gIGNvbnN0IGRvbSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBkb20uY2xhc3NOYW1lID0gJ3ZhbGUtdG9vbHRpcC1jb250YWluZXInO1xuXG4gIC8vIFNldmVyaXR5IGJhZGdlXG4gIGNvbnN0IHNldmVyaXR5RWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgc2V2ZXJpdHlFbC5jbGFzc05hbWUgPSBgdmFsZS10b29sdGlwLXNldmVyaXR5IHZhbGUtdG9vbHRpcC1zZXZlcml0eS0tJHtpc3N1ZS5TZXZlcml0eS50b0xvd2VyQ2FzZSgpfWA7XG4gIHNldmVyaXR5RWwudGV4dENvbnRlbnQgPSBpc3N1ZS5TZXZlcml0eS50b1VwcGVyQ2FzZSgpO1xuICBkb20uYXBwZW5kQ2hpbGQoc2V2ZXJpdHlFbCk7XG5cbiAgLy8gTWVzc2FnZVxuICBjb25zdCBtZXNzYWdlRWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgbWVzc2FnZUVsLmNsYXNzTmFtZSA9ICd2YWxlLXRvb2x0aXAtbWVzc2FnZSc7XG4gIG1lc3NhZ2VFbC50ZXh0Q29udGVudCA9IGlzc3VlLk1lc3NhZ2U7XG4gIGRvbS5hcHBlbmRDaGlsZChtZXNzYWdlRWwpO1xuXG4gIC8vIEFjdGlvbiBidXR0b25zXG4gIGNvbnN0IGFjdGlvblVJID0gY3JlYXRlQWN0aW9uVUkodmlldywgaXNzdWUpO1xuICBpZiAoYWN0aW9uVUkpIHtcbiAgICBkb20uYXBwZW5kQ2hpbGQoYWN0aW9uVUkpO1xuICB9XG5cbiAgLy8gQ2hlY2sgbmFtZVxuICBjb25zdCBjaGVja0VsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIGNoZWNrRWwuY2xhc3NOYW1lID0gJ3ZhbGUtdG9vbHRpcC1jaGVjayc7XG4gIGNoZWNrRWwudGV4dENvbnRlbnQgPSBgQ2hlY2s6ICR7aXNzdWUuQ2hlY2t9YDtcbiAgZG9tLmFwcGVuZENoaWxkKGNoZWNrRWwpO1xuXG4gIC8vIExpbmsgKGlmIGF2YWlsYWJsZSlcbiAgaWYgKGlzc3VlLkxpbmspIHtcbiAgICBjb25zdCBsaW5rRWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XG4gICAgbGlua0VsLmNsYXNzTmFtZSA9ICd2YWxlLXRvb2x0aXAtbGluayc7XG4gICAgbGlua0VsLmhyZWYgPSBpc3N1ZS5MaW5rO1xuICAgIGxpbmtFbC50ZXh0Q29udGVudCA9ICdMZWFybiBtb3JlIOKGkic7XG4gICAgbGlua0VsLnRhcmdldCA9ICdfYmxhbmsnO1xuICAgIGxpbmtFbC5vbmNsaWNrID0gKGUpID0+IHtcbiAgICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICAgIHdpbmRvdy5vcGVuKGlzc3VlLkxpbmssICdfYmxhbmsnKTtcbiAgICB9O1xuICAgIGRvbS5hcHBlbmRDaGlsZChsaW5rRWwpO1xuICB9XG5cbiAgcmV0dXJuIGRvbTtcbn1cblxuLyoqXG4gKiBGaW5kIHRoZSBWYWxlIGlzc3VlIGF0IHRoZSBnaXZlbiBwb3NpdGlvblxuICovXG5mdW5jdGlvbiBmaW5kSXNzdWVBdFBvc2l0aW9uKHZpZXc6IEVkaXRvclZpZXcsIHBvczogbnVtYmVyLCBkZWNvcmF0aW9uczogRGVjb3JhdGlvblNldCk6IFZhbGVJc3N1ZSB8IHVuZGVmaW5lZCB7XG4gIGxldCBmb3VuZElzc3VlOiBWYWxlSXNzdWUgfCB1bmRlZmluZWQ7XG5cbiAgZGVjb3JhdGlvbnMuYmV0d2Vlbihwb3MsIHBvcywgKGZyb20sIHRvKSA9PiB7XG4gICAgaWYgKHBvcyA+PSBmcm9tICYmIHBvcyA8PSB0byAmJiAhZm91bmRJc3N1ZSkge1xuICAgICAgZm9yIChjb25zdCBpc3N1ZSBvZiBjdXJyZW50SXNzdWVzKSB7XG4gICAgICAgIGNvbnN0IHBvc2l0aW9uID0gY2FsY3VsYXRlSXNzdWVQb3NpdGlvbihpc3N1ZSwgdmlldy5zdGF0ZS5kb2MpO1xuICAgICAgICBpZiAocG9zaXRpb24gJiYgZnJvbSA9PT0gcG9zaXRpb24uZnJvbSAmJiB0byA9PT0gcG9zaXRpb24udG8pIHtcbiAgICAgICAgICBmb3VuZElzc3VlID0gaXNzdWU7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlOyAvLyBTdG9wIGl0ZXJhdGluZ1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9KTtcblxuICByZXR1cm4gZm91bmRJc3N1ZTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU3RhdGUgTWFuYWdlbWVudFxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vLyBEZWZpbmUgYSBzdGF0ZSBlZmZlY3QgdG8gdXBkYXRlIFZhbGUgZGVjb3JhdGlvbnNcbmV4cG9ydCBjb25zdCBzZXRWYWxlRGVjb3JhdGlvbnNFZmZlY3QgPSBTdGF0ZUVmZmVjdC5kZWZpbmU8VmFsZUlzc3VlW10+KCk7XG5cbi8vIENyZWF0ZSBhIHN0YXRlIGZpZWxkIHRvIG1hbmFnZSBWYWxlIGRlY29yYXRpb25zXG5leHBvcnQgY29uc3QgdmFsZURlY29yYXRpb25zRmllbGQgPSBTdGF0ZUZpZWxkLmRlZmluZTxEZWNvcmF0aW9uU2V0Pih7XG4gIGNyZWF0ZSgpIHtcbiAgICByZXR1cm4gRGVjb3JhdGlvbi5ub25lO1xuICB9LFxuXG4gIHVwZGF0ZShkZWNvcmF0aW9ucywgdHIpIHtcbiAgICBkZWNvcmF0aW9ucyA9IGRlY29yYXRpb25zLm1hcCh0ci5jaGFuZ2VzKTtcblxuICAgIGZvciAoY29uc3QgZWZmZWN0IG9mIHRyLmVmZmVjdHMpIHtcbiAgICAgIGlmIChlZmZlY3QuaXMoc2V0VmFsZURlY29yYXRpb25zRWZmZWN0KSkge1xuICAgICAgICBkZWNvcmF0aW9ucyA9IGNyZWF0ZURlY29yYXRpb25zKGVmZmVjdC52YWx1ZSwgdHIuc3RhdGUuZG9jKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZGVjb3JhdGlvbnM7XG4gIH0sXG5cbiAgcHJvdmlkZTogZiA9PiBFZGl0b3JWaWV3LmRlY29yYXRpb25zLmZyb20oZilcbn0pO1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBIb3ZlciBUb29sdGlwIEV4dGVuc2lvblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIENyZWF0ZSBhIGhvdmVyIHRvb2x0aXAgZXh0ZW5zaW9uIGZvciBWYWxlIGlzc3Vlc1xuICovXG5jb25zdCB2YWxlSG92ZXJUb29sdGlwID0gaG92ZXJUb29sdGlwKCh2aWV3LCBwb3MpID0+IHtcbiAgY29uc3QgZGVjb3JhdGlvbnMgPSB2aWV3LnN0YXRlLmZpZWxkKHZhbGVEZWNvcmF0aW9uc0ZpZWxkKTtcbiAgY29uc3QgaXNzdWUgPSBmaW5kSXNzdWVBdFBvc2l0aW9uKHZpZXcsIHBvcywgZGVjb3JhdGlvbnMpO1xuXG4gIGlmICghaXNzdWUpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgcG9zLFxuICAgIGFib3ZlOiB0cnVlLFxuICAgIGNyZWF0ZTogKCkgPT4gKHsgZG9tOiBjcmVhdGVUb29sdGlwRE9NKHZpZXcsIGlzc3VlKSB9KVxuICB9O1xufSk7XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEV4cG9ydHNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuZXhwb3J0IGNvbnN0IHZhbGVEZWNvcmF0aW9uc0V4dGVuc2lvbiA9IFt2YWxlRGVjb3JhdGlvbnNGaWVsZCwgdmFsZUhvdmVyVG9vbHRpcF07XG4iXX0=