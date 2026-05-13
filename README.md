# Launchpad

An Obsidian plugin for instant access to any link — web, internal note, vault folder, or `obsidian://` deep link — without breaking your flow.

## Features

- **Sidebar panel** — collapsible folder tree, persists across sessions
- **Link capture modal** — add a bookmark with name, URL, and target folder in under 10 seconds
- **Plain Markdown source of truth** — human-readable, directly editable, syncs with your vault
- **Configurable file location** — store `bookmarks.md` anywhere in your vault
- **Multiple link types** — `https://`, `http://`, `obsidian://`, `vault://` (folder reveal), `note://` (internal note), or `[[wiki link]]` shorthand
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

Fill in the display name, URL, and choose a folder. Selecting **+ New folder…** creates a new top-level folder on save.

Supported URL formats:

| Format | Opens |
|---|---|
| `https://…` / `http://…` | External URL in the default browser |
| `obsidian://…` | Obsidian URI (cross-vault commands, plugins, etc.) |
| `vault://path/to/folder` | Reveals that folder in the file explorer |
| `note://My Note` | Opens an internal note by link path |
| `[[My Note]]` | Shorthand for `note://` — normalized on save |

### Edit or delete bookmarks

Open your bookmarks file in your vault and edit it directly. The sidebar updates automatically whenever the file changes.

### Configure the bookmarks file location

Command palette → **Launchpad: Configure bookmarks file location**

The file can live anywhere inside your vault (e.g. `Resources/bookmarks.md`). You can also right-click any folder in the file explorer and choose **Copy path for Launchpad** to get a ready-to-paste `vault://` URL.

## Bookmarks file format

```markdown
# Work
- [Linear Board](https://linear.app/myteam)
- [Obsidian Vault](obsidian://open?vault=MyVault)
- [Project Notes](note://Work/Project Notes)
- [Assets Folder](vault://Work/Assets)

## Design
- [Figma Project](https://figma.com/...)
- [Design Brief](note://Design Brief)

# Personal
- [Home Assistant](http://homeassistant.local)
```

| Syntax | Meaning |
|---|---|
| `# Heading` | Top-level folder |
| `## Heading` | Subfolder (one level deep only) |
| `- [Name](url)` | Bookmark — any supported URL scheme |
| Anything else | Silently ignored |

The file is re-read before every write so manual edits are never overwritten.

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
