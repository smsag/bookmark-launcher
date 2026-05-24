import { setIcon } from "obsidian";

/** Maximum value accepted for the Latest files count setting. */
export const LATEST_FILES_COUNT_MAX = 50;

/**
 * Attempts to set a Lucide icon on an element, falling back gracefully
 * on older Obsidian builds where the primary icon name may not exist.
 * The final fallback is "file" — always available in Obsidian's icon set.
 * Icon is decorative in all call sites; rendering the section matters more
 * than the glyph.
 */
export function setIconWithFallback(
	element: HTMLElement,
	primaryIcon: string,
	fallbackIcon: string
): void {
	try {
		setIcon(element, primaryIcon);
		return;
	} catch {
		// Primary icon unavailable on this Obsidian build — try fallback.
	}
	try {
		setIcon(element, fallbackIcon);
		return;
	} catch {
		// Fallback also unavailable — use universal default.
	}
	try {
		setIcon(element, "file");
	} catch {
		// No-op: icon is decorative.
	}
}

/**
 * Wires up a collapse/expand click handler on a folder or section header.
 * Toggles the `is-collapsed` class on contentEl, the `collapsed` class on
 * arrowEl (if provided), updates `aria-expanded` on triggerEl, and persists
 * the new state via the provided callback.
 */
export function attachCollapseHandler(
	triggerEl: HTMLElement,
	contentEl: HTMLElement,
	arrowEl: HTMLElement | null,
	collapseKey: string,
	persist: (key: string, collapsed: boolean) => Promise<void>
): void {
	triggerEl.addEventListener("click", async () => {
		const nowCollapsed = !contentEl.hasClass("is-collapsed");
		contentEl.toggleClass("is-collapsed", nowCollapsed);
		if (arrowEl) arrowEl.classList.toggle("collapsed", nowCollapsed);
		triggerEl.setAttribute("aria-expanded", (!nowCollapsed).toString());
		await persist(collapseKey, nowCollapsed);
	});
}