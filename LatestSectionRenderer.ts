import { App, setIcon } from "obsidian";
import { LatestFile } from "./types";
import { t } from "./i18n";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";

type LatestSectionHost = {
	openLatestFile(path: string): void;
	deleteLatestFile(path: string): Promise<void>;
	isDeleteEnabled(): boolean;
};

/** Renders a collapsible Latest subsection (Created or Modified). */
export function renderLatestSubsection(
	app: App,
	containerEl: HTMLElement,
	collapseState: Record<string, boolean>,
	subsectionKey: string,
	label: string,
	iconName: string,
	files: LatestFile[],
	host: LatestSectionHost,
	setCollapseState: (key: string, collapsed: boolean) => Promise<void>
): void {
	const isCollapsed = collapseState[subsectionKey] ?? false;
	const subsectionEl = containerEl.createDiv("launchpad-subfolder");

	const subsectionHeaderEl = subsectionEl.createEl("button", {
		cls: "launchpad-subfolder-header",
		attr: { type: "button", "aria-expanded": (!isCollapsed).toString() },
	});
	const subsectionIconEl = subsectionHeaderEl.createSpan({
		cls: "lp-folder-icon",
		attr: { "aria-hidden": "true" },
	});
	setIconWithFallback(subsectionIconEl, iconName, "file-text");
	subsectionHeaderEl.createSpan({ text: label });
	const subsectionArrowEl = subsectionHeaderEl.createSpan({
		cls: "launchpad-folder-arrow" + (isCollapsed ? " collapsed" : ""),
		text: "▾",
		attr: { "aria-hidden": "true" },
	});

	const subsectionContentEl = subsectionEl.createDiv("launchpad-subfolder-content");
	if (isCollapsed) subsectionContentEl.addClass("is-collapsed");
	const subsectionInnerEl = subsectionContentEl.createDiv("lp-inner");

	subsectionHeaderEl.addEventListener("click", async () => {
		const nowCollapsed = !subsectionContentEl.hasClass("is-collapsed");
		subsectionContentEl.toggleClass("is-collapsed", nowCollapsed);
		subsectionArrowEl.classList.toggle("collapsed", nowCollapsed);
		subsectionHeaderEl.setAttribute("aria-expanded", (!nowCollapsed).toString());
		await setCollapseState(subsectionKey, nowCollapsed);
	});

	if (files.length === 0) {
		subsectionInnerEl.createDiv({ cls: "launchpad-empty", text: t("latest.empty") });
	} else {
		for (const file of files) {
			renderLatestFileItem(app, subsectionInnerEl, file, host);
		}
	}
}

/** Renders one latest-file row including optional delete affordance. */
function renderLatestFileItem(
	app: App,
	containerEl: HTMLElement,
	file: LatestFile,
	host: LatestSectionHost
): void {
	const itemEl = containerEl.createEl("div", {
		cls: "launchpad-item launchpad-latest-item",
		attr: { title: file.path },
	});

	const fileLinkEl = itemEl.createEl("a", {
		cls: "launchpad-item-link",
		attr: { href: "#", "aria-label": `${t("latest.ariaLabel")}: ${file.title}` },
	});
	const iconEl = fileLinkEl.createSpan({
		cls: "lp-item-icon",
		attr: { "aria-hidden": "true" },
	});
	setIcon(iconEl, "file-text");
	fileLinkEl.createSpan({ cls: "lp-item-name", text: file.title });
	fileLinkEl.addEventListener("click", (e) => {
		e.preventDefault();
		host.openLatestFile(file.path);
	});

	if (host.isDeleteEnabled()) {
		const deleteButtonEl = itemEl.createEl("button", {
			cls: "launchpad-delete-btn",
			attr: {
				type: "button",
				"aria-label": `${t("latest.delete.ariaLabel")}: ${file.title}`,
			},
		});
		const trashIconEl = deleteButtonEl.createSpan({ attr: { "aria-hidden": "true" } });
		setIcon(trashIconEl, "trash-2");
		deleteButtonEl.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			new ConfirmDeleteModal(app, file.title, () =>
				host.deleteLatestFile(file.path)
			).open();
		});
	}
}

export function setIconWithFallback(
	element: HTMLElement,
	primaryIcon: string,
	fallbackIcon: string
): void {
	try {
		setIcon(element, primaryIcon);
		return;
	} catch {
		// fall through
	}
	try {
		setIcon(element, fallbackIcon);
		return;
	} catch {
		// fall through
	}
	try {
		setIcon(element, "file");
	} catch {
		// decorative icon only
	}
}
