import { describe, expect, it } from "vitest";
import { FOLDER_SEP } from "../BookmarkStore.ts";
import type { BookmarkStore } from "../types.ts";

function pruneCollapseState(
	collapseState: Record<string, boolean>,
	store: BookmarkStore
): { state: Record<string, boolean>; changed: boolean } {
	const systemKeys = new Set([
		"__tabs__", "__latest__", "__latest_created__", "__latest_modified__",
	]);
	const validFolderKeys = new Set<string>();
	for (const folder of store.folders) {
		validFolderKeys.add(folder.name);
		for (const sub of folder.subfolders) {
			validFolderKeys.add(`${folder.name}${FOLDER_SEP}${sub.name}`);
		}
	}
	const result = { ...collapseState };
	let changed = false;
	for (const key of Object.keys(result)) {
		if (!systemKeys.has(key) && !validFolderKeys.has(key)) {
			delete result[key];
			changed = true;
		}
	}
	return { state: result, changed };
}

const STORE: BookmarkStore = {
	folders: [
		{ name: "Work", bookmarks: [], subfolders: [{ name: "Design", bookmarks: [], subfolders: [] }] },
		{ name: "Personal", bookmarks: [], subfolders: [] },
	],
	uncategorized: [],
};

describe("pruneCollapseState", () => {
	it("keeps valid folder keys", () => {
		const { state } = pruneCollapseState({ Work: true, Personal: false }, STORE);
		expect(state).toEqual({ Work: true, Personal: false });
	});

	it("keeps valid subfolder keys", () => {
		const key = `Work${FOLDER_SEP}Design`;
		const { state } = pruneCollapseState({ [key]: true }, STORE);
		expect(state[key]).toBe(true);
	});

	it("removes orphaned folder keys", () => {
		const { state, changed } = pruneCollapseState({ OldFolder: true }, STORE);
		expect(state).not.toHaveProperty("OldFolder");
		expect(changed).toBe(true);
	});

	it("always keeps all system keys", () => {
		const input = {
			__tabs__: true,
			__latest__: false,
			__latest_created__: true,
			__latest_modified__: false,
		};
		const { state } = pruneCollapseState(input, STORE);
		expect(state).toEqual(input);
	});

	it("returns changed=false when nothing was pruned", () => {
		const { changed } = pruneCollapseState({ Work: true }, STORE);
		expect(changed).toBe(false);
	});

	it("returns changed=true when at least one key was pruned", () => {
		const { changed } = pruneCollapseState({ Work: true, Ghost: true }, STORE);
		expect(changed).toBe(true);
	});

	it("handles empty collapseState", () => {
		const { state, changed } = pruneCollapseState({}, STORE);
		expect(state).toEqual({});
		expect(changed).toBe(false);
	});

	it("handles empty store", () => {
		const { state } = pruneCollapseState(
			{ Work: true, __tabs__: false },
			{ folders: [], uncategorized: [] }
		);
		expect(state).toEqual({ __tabs__: false });
	});
});