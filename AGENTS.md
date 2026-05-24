# Agent Context — Launchpad

This file gives AI coding agents the context needed to work on this codebase without re-deriving it from scratch.

## What this is

An Obsidian community plugin. It adds a persistent sidebar panel and a modal dialog for managing bookmarks stored in a plain Markdown file (configurable path, defaults to `bookmarks.md` at the vault root). On first launch a `SetupModal` lets the user pick the file location; subsequent launches auto-detect a legacy `bookmarks.md` if no path has been saved.

## Build

```bash
npm install
npm run dev    # esbuild watch mode, inline source maps
npm run build  # tsc type-check + esbuild production bundle → main.js
```

TypeScript target: ES6. Module format: CJS (Obsidian requires it). All Obsidian APIs are external — never bundle them.

After a build, `main.js` must be committed. BRAT installs directly from the repo root; it expects `manifest.json`, `main.js`, and `styles.css` to be present there.

## Releasing

When creating a GitHub release, always upload the three BRAT-required files as release assets — BRAT fetches them from the release, not the repo root:

```bash
npm run build
git add -A && git commit -m "..."
git tag <version>
git push origin main --tags
gh release create <version> --title "..." --notes "..."
gh release upload <version> manifest.json main.js styles.css --clobber
```

Skipping the `gh release upload` step will cause BRAT installs/updates to fail with a missing `manifest.json` error.

## Architecture

```
main.ts                  Plugin entry — lifecycle, workspace wiring,
                         BookmarkViewHost implementation
BookmarkStore.ts         Parse + write the bookmarks file (BookmarkStoreManager)
BookmarkView.ts          Sidebar panel (ItemView, type: launchpad-view).
                         Exports BookmarkViewHost (composed from CollapseHost,
                         BookmarkHost, NavigationHost, TabsHost, LatestHost)
LatestSectionRenderer.ts Latest Created/Modified subsection renderer
ConfirmDeleteModal.ts    Delete confirmation modal for Latest files
CaptureModal.ts          Add-bookmark modal (Modal)
SetupModal.ts            First-launch / reconfigure file-path modal (Modal)
SettingsTab.ts           Plugin settings tab (LaunchpadSettingTab)
types.ts                 Interfaces: Bookmark, BookmarkFolder, BookmarkStore,
                         FolderOption, OpenTab, LatestFile,
                         RenderLatestSubsectionOptions
utils.ts                 Shared utilities: setIconWithFallback,
                         attachCollapseHandler, LATEST_FILES_COUNT_MAX
styles.css               All styles; uses Obsidian CSS variables throughout
```

### Data flow

1. The bookmarks file path is persisted in plugin data (`bookmarksFilePath`). On first launch `SetupModal` captures it; on upgrade a legacy `bookmarks.md` at the vault root is adopted silently.
2. `BookmarkStoreManager.parse()` reads the file and returns an in-memory `BookmarkStore`.
3. `BookmarkView` receives a `BookmarkStore` snapshot and renders it (pure render — no internal state beyond collapse).
4. `BookmarkStoreManager.addBookmark()` re-reads the file immediately before writing to avoid stomping external edits.
5. Vault `modify`, `create`, and `rename` watchers in `main.ts` call `refreshViews()` whenever the bookmarks file changes, pushing a fresh snapshot to all open sidebar leaves.

### Key invariants

- `BookmarkStoreManager` is the **only** writer of the bookmarks file.
  All other code goes through it.
- The view is **stateless except for collapse state**. It does not hold
  a reference to the store between renders.
- Collapse state is persisted via `plugin.saveData()` as
  `{ collapseState: Record<string, boolean>, bookmarksFilePath: string | null }`.
  Collapse keys use `FOLDER_SEP` (`\x1F`): `"Work"` for top-level,
  `"Work\x1FDesign"` for subfolders. The separator avoids collisions
  when folder names contain `/`. System sections use double-underscore
  keys: `__tabs__`, `__latest__`, `__latest_created__`, `__latest_modified__`.
- `BookmarkView` communicates with the plugin only through the
  `BookmarkViewHost` interface (defined in `BookmarkView.ts`) — no
  direct import of the plugin class, avoiding circular imports.
  `BookmarkViewHost` is composed from five focused sub-interfaces:
  `CollapseHost`, `BookmarkHost`, `NavigationHost`, `TabsHost`, `LatestHost`.
- All collapse handler wiring goes through `attachCollapseHandler()`
  in `utils.ts` — no inline event listener duplication.
- `renderLatestSubsection()` takes a single `RenderLatestSubsectionOptions`
  object — never positional parameters.
- `LATEST_FILES_COUNT_MAX` is defined once in `utils.ts` and imported
  wherever validation is needed.

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
| `https://` / `http://` | `window.open(url, "_blank", "noopener,noreferrer")` |
| `obsidian://` | `window.open(url)` — captures the active file first so the back-link appears in the sidebar |
| `vault://path` | Decodes the path, looks up the `TFolder`, and calls `revealInFolder` via the file-explorer leaf |
| `note://linkpath` | `app.metadataCache.getFirstLinkpathDest()` then `leaf.openFile()` |

URLs containing ASCII control characters are rejected before any scheme-specific handling.

The capture modal accepts `https://`, `http://`, `obsidian://`, `vault://`, `note://`, and `[[wiki link]]` shorthand (normalized to `note://` on save). All other schemes are blocked at parse time in `BookmarkStoreManager.parseContent()`.

## Obsidian API surface used

| API | Where | Purpose |
|---|---|---|
| `Plugin.addCommand()` | `main.ts` | Register palette commands |
| `Plugin.registerView()` | `main.ts` | Register sidebar view type |
| `Plugin.registerEvent()` | `main.ts` | File watchers (vault `modify`, `create`, `rename`; workspace `file-menu`) |
| `Plugin.loadData()` / `saveData()` | `main.ts` | Persist collapse state and bookmarks file path |
| `app.vault.read()` / `modify()` / `create()` / `createFolder()` | `BookmarkStore.ts` | File I/O |
| `app.vault.getAbstractFileByPath()` | `BookmarkStore.ts`, `main.ts` | File/folder lookup |
| `app.metadataCache.getFirstLinkpathDest()` | `main.ts` | Resolve `note://` link paths |
| `app.workspace.iterateAllLeaves()` | `main.ts` | Collect open editor tabs (filtered by rootSplit) |
| `app.workspace.getLeavesOfType()` | `main.ts` | Iterate open sidebar leaves |
| `app.workspace.getRightLeaf()` | `main.ts` | Open sidebar panel |
| `app.workspace.revealLeaf()` / `setActiveLeaf()` | `main.ts` | Focus sidebar panel |
| `app.workspace.getActiveFile()` | `main.ts` | Capture file for obsidian:// back-navigation |
| `app.workspace.on("file-menu")` | `main.ts` | "Copy path for Launchpad" context-menu item |
| `app.vault.trash()` | `main.ts` | Move Latest files to system trash |
| `app.vault.getFiles()` | `main.ts` | Vault file snapshot for Latest section |
| `ItemView` | `BookmarkView.ts` | Sidebar panel base class |
| `Modal` | `CaptureModal.ts`, `SetupModal.ts` | Dialog base class |

### Shared utilities (`utils.ts`)

| Export | Purpose |
|---|---|
| `setIconWithFallback(el, primary, fallback)` | Sets a Lucide icon with graceful fallback for older Obsidian builds |
| `attachCollapseHandler(trigger, content, arrow, key, persist)` | Wires collapse/expand click handler; used by all four collapsible section types |
| `LATEST_FILES_COUNT_MAX` | Upper bound (50) for the Latest files count setting; imported by `main.ts` and `SettingsTab.ts` |

### Interface hierarchy

`BookmarkViewHost` (BookmarkView.ts) is composed from:

| Sub-interface | Methods | Used by |
|---|---|---|
| `CollapseHost` | `getCollapseState`, `setCollapseState` | All section renderers |
| `BookmarkHost` | `openCaptureModal`, `openSetupModal`, `openSettings`, `reloadBookmarks`, `openBookmarkUrl` | `BookmarkView.ts` |
| `NavigationHost` | `getPreviousFilename`, `navigateBack` | `BookmarkView.ts` |
| `TabsHost` | `isTabsSectionEnabled`, `getOpenTabs`, `focusTab` | `BookmarkView.ts` |
| `LatestHost` | `isLatestSectionEnabled`, `getLatestCreatedFiles`, `getLatestModifiedFiles`, `openLatestFile`, `deleteLatestFile`, `isDeleteEnabled` | `BookmarkView.ts`, `LatestSectionRenderer.ts` |

`LaunchpadPlugin` in `main.ts` implements `BookmarkViewHost` and
therefore satisfies all five sub-interfaces.

## MVP constraints (do not expand without discussion)

- Maximum one level of subfolder nesting (`##` only, no `###`)
- No UI for editing or deleting bookmarks — users edit `bookmarks.md` directly
- No search or filter in the sidebar
- No drag-and-drop reordering
- No bookmark import from browser
- No positional parameter lists longer than 4 arguments — use options
  objects (see `RenderLatestSubsectionOptions`)
