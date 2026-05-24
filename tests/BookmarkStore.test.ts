import { beforeEach, describe, expect, it } from "vitest";
import { BookmarkStoreManager } from "../BookmarkStore.ts";

describe("parseContent", () => {
	let manager: BookmarkStoreManager;

	beforeEach(() => {
		manager = new BookmarkStoreManager({} as any, "bookmarks.md");
	});

	it("returns empty store for empty string", () => {
		const store = manager.parseContent("");
		expect(store.folders).toHaveLength(0);
		expect(store.uncategorized).toHaveLength(0);
	});

	it("parses a top-level folder with one bookmark", () => {
		const store = manager.parseContent("# Work\n- [Linear](https://linear.app)\n");
		expect(store.folders).toHaveLength(1);
		expect(store.folders[0].name).toBe("Work");
		expect(store.folders[0].bookmarks).toHaveLength(1);
		expect(store.folders[0].bookmarks[0]).toEqual({
			name: "Linear",
			url: "https://linear.app",
		});
	});

	it("parses a subfolder under a top-level folder", () => {
		const store = manager.parseContent(
			"# Work\n## Design\n- [Figma](https://figma.com)\n"
		);
		expect(store.folders[0].subfolders).toHaveLength(1);
		expect(store.folders[0].subfolders[0].name).toBe("Design");
		expect(store.folders[0].subfolders[0].bookmarks[0].url).toBe(
			"https://figma.com"
		);
	});

	it("places bookmarks before any heading into uncategorized", () => {
		const store = manager.parseContent("- [Home](https://example.com)\n# Work\n");
		expect(store.uncategorized).toHaveLength(1);
		expect(store.uncategorized[0].name).toBe("Home");
	});

	it("treats orphaned ## with no preceding # as top-level folder", () => {
		const store = manager.parseContent("## Orphaned\n- [x](https://x.com)\n");
		expect(store.folders).toHaveLength(1);
		expect(store.folders[0].name).toBe("Orphaned");
		expect(store.folders[0].bookmarks).toHaveLength(1);
	});

	it("silently drops bookmarks with disallowed URL schemes", () => {
		const store = manager.parseContent(
			"# Work\n"
			+ "- [Bad JS](javascript:alert(1))\n"
			+ "- [Bad file](file:///etc/passwd)\n"
			+ "- [Bad data](data:text/html,<h1>x</h1>)\n"
			+ "- [Good](https://example.com)\n"
		);
		expect(store.folders[0].bookmarks).toHaveLength(1);
		expect(store.folders[0].bookmarks[0].url).toBe("https://example.com");
	});

	it("handles URLs containing parentheses", () => {
		const url = "https://en.wikipedia.org/wiki/Bézier_curve_(mathematics)";
		const store = manager.parseContent(`# Work\n- [Bezier](${url})\n`);
		expect(store.folders[0].bookmarks[0].url).toBe(url);
	});

	it("handles bookmark names containing ]", () => {
		const store = manager.parseContent(
			"# Work\n- [Stack Overflow [closed]](https://stackoverflow.com)\n"
		);
		expect(store.folders[0].bookmarks[0].name).toBe("Stack Overflow [closed]");
	});

	it("handles multiple folders", () => {
		const store = manager.parseContent(
			"# Work\n- [A](https://a.com)\n# Personal\n- [B](https://b.com)\n"
		);
		expect(store.folders).toHaveLength(2);
		expect(store.folders[0].name).toBe("Work");
		expect(store.folders[1].name).toBe("Personal");
	});

	it("ignores non-bookmark lines silently", () => {
		const store = manager.parseContent(
			"# Work\nThis is a comment\n\n   \n- [Good](https://good.com)\n"
		);
		expect(store.folders[0].bookmarks).toHaveLength(1);
	});

	it("accepts all allowed URL schemes", () => {
		const lines = [
			"- [A](https://a.com)",
			"- [B](http://b.com)",
			"- [C](obsidian://open?vault=V)",
			"- [D](vault://MyFolder)",
			"- [E](note://My%20Note)",
		].join("\n");
		const store = manager.parseContent(`# Work\n${lines}\n`);
		expect(store.folders[0].bookmarks).toHaveLength(5);
	});
});

describe("serialize", () => {
	const manager = new BookmarkStoreManager({} as any, "bookmarks.md");

	it("always ends with a newline", () => {
		const store = manager.parseContent("# Work\n- [A](https://a.com)\n");
		expect(manager.serialize(store)).toMatch(/\n$/);
	});

	it("serializes uncategorized bookmarks before folders", () => {
		const result = manager.serialize({
			folders: [{
				name: "Work",
				bookmarks: [{ name: "B", url: "https://b.com" }],
				subfolders: [],
			}],
			uncategorized: [{ name: "A", url: "https://a.com" }],
		});
		const lines = result.split("\n");
		expect(lines[0]).toBe("- [A](https://a.com)");
		expect(lines[2]).toBe("# Work");
	});

	it("serializes subfolders under their parent folder", () => {
		const result = manager.serialize({
			folders: [{
				name: "Work",
				bookmarks: [],
				subfolders: [{
					name: "Design",
					bookmarks: [{ name: "Figma", url: "https://figma.com" }],
					subfolders: [],
				}],
			}],
			uncategorized: [],
		});
		expect(result).toContain("## Design");
		expect(result).toContain("- [Figma](https://figma.com)");
	});
});

describe("round-trip: serialize(parseContent(x)) === x", () => {
	const manager = new BookmarkStoreManager({} as any, "bookmarks.md");
	const cases = [
		"# Work\n- [Linear](https://linear.app)\n",
		"# Work\n\n## Design\n- [Figma](https://figma.com)\n",
		"- [Home](https://home.com)\n\n# Work\n- [A](https://a.com)\n",
		"# A\n- [X](https://x.com)\n\n# B\n- [Y](https://y.com)\n",
		"# Work\n- [Wiki](https://en.wikipedia.org/wiki/X_(Y))\n",
	];

	for (const input of cases) {
		it(`round-trips: ${input.slice(0, 40).replace(/\n/g, "↵")}`, () => {
			expect(manager.serialize(manager.parseContent(input))).toBe(input);
		});
	}
});