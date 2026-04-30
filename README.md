# Launchpad

An Obsidian plugin for instant access to any link — internal (`obsidian://`) or external (`https://`) — without breaking your flow.

## Features

- **Sidebar panel** — collapsible folder tree, persists across sessions
- **Link capture modal** — add a bookmark with name, URL, and target folder in under 10 seconds
- **`bookmarks.md` as source of truth** — human-readable, directly editable, syncs with your vault
- **Two entry points** — command palette and slash command (`/`)

## Installation via BRAT

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat) from the Obsidian community plugins
2. Open BRAT settings → **Add Beta Plugin**
3. Paste this repository URL and click **Add Plugin**
4. Enable **Launchpad** in Settings → Community Plugins

## Usage

### Open the sidebar panel

Command palette → **Launchpad: Open panel**

### Add a bookmark

- Click **+** in the sidebar panel header, or
- Command palette / slash command → **Launchpad: Add bookmark**

Fill in the display name, URL (`https://` or `obsidian://`), and choose a folder. Selecting **+ New folder…** creates a new top-level folder on save.

### Edit or delete bookmarks

Open `bookmarks.md` in your vault and edit it directly. The sidebar updates automatically within 200 ms.

## `bookmarks.md` format

```markdown
# Work
- [Linear Board](https://linear.app/myteam)
- [Obsidian Vault](obsidian://open?vault=MyVault)

## Design
- [Figma Project](https://figma.com/...)

# Personal
- [Home Assistant](http://homeassistant.local)
```

| Syntax | Meaning |
|---|---|
| `# Heading` | Top-level folder |
| `## Heading` | Subfolder (one level deep) |
| `- [Name](url)` | Bookmark |

Lines that don't match the bookmark format are ignored silently. The file is re-read before every write so manual edits are never overwritten.

## Development

```bash
npm install
npm run dev    # watch mode with inline source maps
npm run build  # production bundle → main.js
```

Requires Node.js ≥ 16. The plugin targets Obsidian ≥ 1.4.0.

For local testing, symlink or copy the repo directory into `.obsidian/plugins/obsidian-launchpad/` inside your vault, then enable the plugin.

## Out of scope (MVP)

- Edit / delete bookmarks from the UI — edit `bookmarks.md` directly
- Drag-and-drop reordering
- Search / filter within the panel
- More than one level of subfolder nesting

## License

MIT
