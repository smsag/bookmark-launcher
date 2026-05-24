import { describe, expect, it } from "vitest";

function buildFiles(entries: { path: string; ctime: number; mtime: number }[]) {
	return entries.map((entry) => ({
		title: entry.path.split("/").pop()!.replace(".md", ""),
		...entry,
	}));
}

function getLatestCreated(files: ReturnType<typeof buildFiles>, n: number) {
	return [...files].sort((a, b) => b.ctime - a.ctime).slice(0, n);
}

function getLatestModified(
	files: ReturnType<typeof buildFiles>,
	n: number,
	excludedPaths: Set<string> = new Set()
) {
	const filtered = files.filter((file) => !excludedPaths.has(file.path));
	const createdPaths = new Set(
		[...filtered].sort((a, b) => b.ctime - a.ctime).slice(0, n).map((file) => file.path)
	);
	return filtered
		.filter((file) => !createdPaths.has(file.path))
		.sort((a, b) => b.mtime - a.mtime)
		.slice(0, n);
}

const FILES = buildFiles([
	{ path: "a.md", ctime: 6, mtime: 1 },
	{ path: "b.md", ctime: 5, mtime: 6 },
	{ path: "c.md", ctime: 4, mtime: 5 },
	{ path: "d.md", ctime: 3, mtime: 4 },
	{ path: "e.md", ctime: 2, mtime: 3 },
	{ path: "f.md", ctime: 1, mtime: 2 },
]);

describe("getLatestCreated", () => {
	it("returns n files sorted by ctime descending", () => {
		const result = getLatestCreated(FILES, 3);
		expect(result.map((file) => file.path)).toEqual(["a.md", "b.md", "c.md"]);
	});

	it("returns all files when n exceeds total", () => {
		expect(getLatestCreated(FILES, 100)).toHaveLength(6);
	});
});

describe("getLatestModified", () => {
	it("excludes files already in Created", () => {
		const created = getLatestCreated(FILES, 3);
		const createdPaths = new Set(created.map((file) => file.path));
		const modified = getLatestModified(FILES, 3, createdPaths);
		for (const file of modified) {
			expect(createdPaths.has(file.path)).toBe(false);
		}
	});

	it("sorts by mtime descending", () => {
		const modified = getLatestModified(FILES, 3);
		const mtimes = modified.map((file) => file.mtime);
		expect(mtimes).toEqual([...mtimes].sort((a, b) => b - a));
	});

	it("applies excluded paths filter", () => {
		const result = getLatestModified(FILES, 6, new Set(["d.md", "e.md"]));
		expect(result.map((file) => file.path)).not.toContain("d.md");
		expect(result.map((file) => file.path)).not.toContain("e.md");
	});
});

describe("getLatestExcludedPaths parsing", () => {
	function parseExcluded(value: string): Set<string> {
		return new Set(
			value.split(",").map((part) => part.trim()).filter((part) => part.length > 0)
		);
	}

	it("parses comma-separated paths", () => {
		const result = parseExcluded("bookmarks.md, journal.md");
		expect(result).toEqual(new Set(["bookmarks.md", "journal.md"]));
	});

	it("trims whitespace from entries", () => {
		expect(parseExcluded("  bookmarks.md  ")).toEqual(new Set(["bookmarks.md"]));
	});

	it("drops empty entries", () => {
		expect(parseExcluded("bookmarks.md,,journal.md,")).toEqual(
			new Set(["bookmarks.md", "journal.md"])
		);
	});

	it("returns empty set for empty string", () => {
		expect(parseExcluded("").size).toBe(0);
	});
});