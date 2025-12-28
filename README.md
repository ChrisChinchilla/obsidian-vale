# Obsidian Vale Plugin

A plugin that integrates the [Vale](https://vale.sh/) prose linter with Obsidian, providing configurable, offline-first inline style and grammar checking directly in your editor.

## Features

- **Inline Issue Display**: See Vale issues highlighted directly in your Obsidian editor
- **Real-time Checking**: Automatically checks your document as you type (configurable)
- **Severity Indicators**: Different visual styles for errors, warnings, and suggestions
- **Hover Tooltips**: Hover over highlighted text to see detailed issue descriptions
- **Status Bar Integration**: Quick overview of issues in the current document
- **Customizable**: Configure Vale path, config file, and visual styles

## Prerequisites

Before using this plugin, [you need to have Vale installed on your system](https://vale.sh/docs/install) and [configured](https://vale.sh/docs/vale-ini).

## Installation

### Manual Installation

1. Download the latest release from the releases page
2. Extract the files to your vault's `.obsidian/plugins/obsidian-vale/` folder
3. Reload Obsidian
4. Enable the plugin in Settings → Community plugins

### Building from Source

1. Clone this repository
2. Install dependencies:

   ```bash
   npm install
   ```

3. Build the plugin:

   ```bash
   npm run build
   ```

4. Copy `main.js`, `manifest.json` to your vault's `.obsidian/plugins/obsidian-vale/` folder
5. Reload Obsidian and enable the plugin

## Configuration

Access the plugin settings through Settings → Plugin Options → Vale Linter:

### Settings

- **Vale Executable Path**: Path to the Vale executable (default: `vale`)

  - If Vale is in your PATH, leave as `vale`
  - Otherwise, provide the full path (e.g., `/usr/local/bin/vale`)

- **Vale Config File Path**: Path to your `.vale.ini` file

  - Leave empty to use Vale's default config discovery
  - Or specify a custom path (e.g., `/home/user/.vale.ini`)

- **Auto-check Enabled**: Toggle automatic checking as you type

- **Debounce Delay**: Time to wait (in milliseconds) after you stop typing before checking

- **Severity Colors**: Customize the colors for different severity levels

## Usage

### Commands

The plugin provides the following commands (accessible via Command Palette - Cmd/Ctrl+P):

- **Check current file with Vale**: Manually run Vale on the current file
- **Toggle auto-check**: Enable/disable automatic checking
- **Clear Vale issues**: Clear all highlighted issues from the editor

### Visual Indicators

Issues are displayed with different underline styles based on severity:

- **Errors**: Red wavy underline (e.g., spelling mistakes, grammar errors)
- **Warnings**: Orange wavy underline (e.g., style suggestions)
- **Suggestions**: Blue dotted underline (e.g., optional improvements)

### Status Bar

The status bar shows a summary of issues in the current file:

- `Vale: Ready` - No issues found
- `Vale: 2 errors, 1 warning, 3 suggestions` - Issue count by severity
- `Vale: Checking...` - Vale is currently analyzing the file

## Troubleshooting

### Vale not found

If you see "Vale not found" errors:

1. Ensure Vale is installed: Run `vale --version` in your terminal
2. If Vale is not in your PATH, specify the full path in plugin settings
3. On Windows, you might need to include the `.exe` extension

### No issues detected

If Vale runs but finds no issues:

1. Check your `.vale.ini` configuration
2. Ensure you have styles installed (`vale sync`)
3. Verify Vale works from command line: `vale your-file.md`

### Performance issues

If the plugin causes lag:

1. Increase the debounce delay in settings
2. Disable auto-check and use manual checking
3. Check if your Vale configuration is too complex

## Customizing Vale Rules

Vale's behavior is controlled by its configuration file and style guides. You can:

1. Use pre-made styles:

   ```bash
   # Popular styles
   vale sync
   ```

2. Create custom rules in `.vale/styles/YourStyle/`:

   ```yaml
   # .vale/styles/YourStyle/MyRule.yml
   extends: existence
   message: "Consider using '%s' instead of '%s'."
   level: warning
   tokens:
     - utilize: use
     - commence: begin
   ```

3. Configure which rules to apply in `.vale.ini`:
   ```ini
   [*.md]
   BasedOnStyles = Vale, YourStyle
   Vale.Spelling = NO
   YourStyle.MyRule = YES
   ```

## Contributing

Contributions are welcome! Feel free to submit issues and pull requests.

## License

MIT