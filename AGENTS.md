# Agent Context — Launchpad

This file gives AI coding agents the context needed to work on this codebase without re-deriving it from scratch.

## What this is

An Obsidian community plugin. It adds a persistent sidebar panel and a modal dialog for managing bookmarks stored in a plain Markdown file (`bookmarks.md`) at the vault root.

## Build

```bash
npm install
npm run dev    # esbuild watch mode, inline source maps
npm run build  # tsc type-check + esbuild production bundle → main.js
```

TypeScript target: ES6. Module format: CJS (Obsidian requires it). All Obsidian APIs are external — never bundle them.

After a build, `main.js` must be committed. BRAT installs directly from the repo root; it expects `manifest.json`, `main.js`, and `styles.css` to be present there.

## Architecture

```
main.ts              Plugin entry — wires everything together
BookmarkStore.ts     Parse + write bookmarks.md (BookmarkStoreManager)
BookmarkView.ts      Sidebar panel (ItemView, type: launchpad-view)
CaptureModal.ts      Add-bookmark modal (Modal)
types.ts             Interfaces: Bookmark, BookmarkFolder, BookmarkStore, FolderOption
styles.css           All styles; uses Obsidian CSS variables throughout
```

### Data flow

1. `bookmarks.md` is the single source of truth
2. `BookmarkStoreManager.parse()` reads and returns an in-memory `BookmarkStore`
3. `BookmarkView` receives a `BookmarkStore` snapshot and renders it (pure render — no internal state beyond collapse)
4. `BookmarkStoreManager.addBookmark()` re-reads the file immediately before writing to avoid stomping external edits
5. A vault `modify` watcher in `main.ts` calls `refreshViews()` whenever `bookmarks.md` changes, pushing a fresh snapshot to all open sidebar leaves

### Key invariants

- `BookmarkStoreManager` is the **only** writer of `bookmarks.md`. All other code goes through it.
- The view is **stateless except for collapse state**. It does not hold a reference to the store between renders.
- Collapse state is persisted via `plugin.saveData()` as `{ collapseState: Record<string, boolean> }`. Keys are folder paths: `"Work"` for top-level, `"Work/Design"` for subfolders.
- `BookmarkView` communicates with the plugin only through the `BookmarkViewHost` interface (defined in `BookmarkView.ts`) — no direct import of the plugin class, avoiding circular imports.

### Parsing rules (`bookmarks.md`)

| Line pattern | Interpretation |
|---|---|
| `# Heading` | Top-level folder |
| `## Heading` | Subfolder (child of the most recent `#` heading) |
| `- [Name](url)` | Bookmark under the current heading context |
| Anything else | Silently ignored |

Bookmarks that appear before any heading go into `store.uncategorized`.

### URL handling

| Prefix | Handler |
|---|---|
| `obsidian://` | `window.open(url)` |
| `https://` / `http://` | `window.open(url, "_blank", "noopener,noreferrer")` |

The capture modal validates that the URL starts with `https://`, `http://`, or `obsidian://` before enabling the Save button.

## Obsidian API surface used

| API | Where | Purpose |
|---|---|---|
| `Plugin.addCommand()` | `main.ts` | Register palette + slash commands |
| `Plugin.registerView()` | `main.ts` | Register sidebar view type |
| `Plugin.registerEvent()` | `main.ts` | File watcher (vault `modify`/`create`) |
| `Plugin.loadData()` / `saveData()` | `main.ts` | Persist collapse state |
| `app.vault.read()` / `modify()` / `create()` | `BookmarkStore.ts` | File I/O |
| `app.workspace.getLeavesOfType()` | `main.ts` | Iterate open sidebar leaves |
| `app.workspace.getRightLeaf()` | `main.ts` | Open sidebar panel |
| `app.workspace.revealLeaf()` | `main.ts` | Focus sidebar panel |
| `ItemView` | `BookmarkView.ts` | Sidebar panel base class |
| `Modal` | `CaptureModal.ts` | Add-bookmark dialog base class |

## MVP constraints (do not expand without discussion)

- Maximum one level of subfolder nesting (`##` only, no `###`)
- No UI for editing or deleting bookmarks — users edit `bookmarks.md` directly
- No search or filter in the sidebar
- No drag-and-drop reordering
- No bookmark import from browser
