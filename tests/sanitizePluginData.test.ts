import { describe, expect, it } from "vitest";
import { sanitizePluginData } from "../main.ts";

describe("sanitizePluginData", () => {
	it("returns all defaults for null input", () => {
		const result = sanitizePluginData(null);
		expect(result.latestFilesCount).toBe(5);
		expect(result.latestDeleteEnabled).toBe(false);
		expect(result.tabsSectionEnabled).toBe(true);
		expect(result.latestSectionEnabled).toBe(true);
		expect(result.latestExcludedFiles).toBe("");
		expect(result.bookmarksFilePath).toBeNull();
		expect(result.collapseState).toEqual({});
	});

	it("returns all defaults for empty object", () => {
		const result = sanitizePluginData({});
		expect(result.latestFilesCount).toBe(5);
	});

	it("accepts valid latestFilesCount", () => {
		expect(sanitizePluginData({ latestFilesCount: 10 }).latestFilesCount).toBe(10);
	});

	it("rejects latestFilesCount below 1", () => {
		expect(sanitizePluginData({ latestFilesCount: 0 }).latestFilesCount).toBe(5);
		expect(sanitizePluginData({ latestFilesCount: -1 }).latestFilesCount).toBe(5);
	});

	it("rejects latestFilesCount above 50", () => {
		expect(sanitizePluginData({ latestFilesCount: 51 }).latestFilesCount).toBe(5);
		expect(sanitizePluginData({ latestFilesCount: 100 }).latestFilesCount).toBe(5);
	});

	it("rejects non-integer latestFilesCount", () => {
		expect(sanitizePluginData({ latestFilesCount: 3.5 }).latestFilesCount).toBe(5);
	});

	it("rejects non-boolean latestDeleteEnabled", () => {
		expect(sanitizePluginData({ latestDeleteEnabled: "yes" }).latestDeleteEnabled).toBe(false);
		expect(sanitizePluginData({ latestDeleteEnabled: 1 }).latestDeleteEnabled).toBe(false);
	});

	it("accepts boolean latestDeleteEnabled", () => {
		expect(sanitizePluginData({ latestDeleteEnabled: true }).latestDeleteEnabled).toBe(true);
	});

	it("accepts boolean tabsSectionEnabled and latestSectionEnabled", () => {
		expect(sanitizePluginData({ tabsSectionEnabled: false }).tabsSectionEnabled).toBe(false);
		expect(sanitizePluginData({ latestSectionEnabled: false }).latestSectionEnabled).toBe(false);
	});

	it("defaults tabsSectionEnabled and latestSectionEnabled to true", () => {
		expect(sanitizePluginData({}).tabsSectionEnabled).toBe(true);
		expect(sanitizePluginData({}).latestSectionEnabled).toBe(true);
	});

	it("accepts valid bookmarksFilePath string", () => {
		expect(sanitizePluginData({ bookmarksFilePath: "resources/bookmarks.md" }).bookmarksFilePath)
			.toBe("resources/bookmarks.md");
	});

	it("rejects non-string bookmarksFilePath", () => {
		expect(sanitizePluginData({ bookmarksFilePath: 42 }).bookmarksFilePath).toBeNull();
	});

	it("keeps only boolean values in collapseState", () => {
		const result = sanitizePluginData({
			collapseState: {
				Work: true,
				Personal: false,
				Bad: "string",
				AlsoBad: 1,
			},
		});
		expect(result.collapseState).toEqual({ Work: true, Personal: false });
	});

	it("accepts valid latestExcludedFiles string", () => {
		expect(sanitizePluginData({ latestExcludedFiles: "bookmarks.md" }).latestExcludedFiles)
			.toBe("bookmarks.md");
	});

	it("rejects non-string latestExcludedFiles", () => {
		expect(sanitizePluginData({ latestExcludedFiles: 42 }).latestExcludedFiles).toBe("");
	});
});