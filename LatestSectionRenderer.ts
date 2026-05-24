import { App, setIcon } from "obsidian";
import { LatestFile, RenderLatestSubsectionOptions } from "./types";
import type { LatestHost } from "./BookmarkView";
import { t } from "./i18n";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";
import { attachCollapseHandler, setIconWithFallback } from "./utils";

/** Renders a collapsible Latest subsection (Created or Modified). */
export function renderLatestSubsection(opts: RenderLatestSubsectionOptions): void {
	const {
		app,
		containerEl,
		collapseState,
		subsectionKey,
		label,
		iconName,
		files,
		host,
		setCollapseState,
	} = opts;

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

	attachCollapseHandler(
		subsectionHeaderEl,
		subsectionContentEl,
		subsectionArrowEl,
		subsectionKey,
		setCollapseState
	);

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
	host: LatestHost
): void {
	const itemEl = containerEl.createEl("div", {
		cls: "launchpad-item launchpad-latest-item",
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
