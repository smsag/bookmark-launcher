import { App, PluginSettingTab, Setting } from "obsidian";
import { t } from "./i18n";
import { LATEST_FILES_COUNT_MAX } from "./utils";

// Import the plugin type for typing only — the actual instance is passed
// in via constructor, so there is no circular runtime dependency.
import type LaunchpadPlugin from "./main";

/** Settings tab displayed under Settings -> Community Plugins -> Launchpad. */
export class LaunchpadSettingTab extends PluginSettingTab {
	plugin: LaunchpadPlugin;

	constructor(app: App, plugin: LaunchpadPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName(t("settings.tabs.name"))
			.setDesc(t("settings.tabs.desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.tabsSectionEnabled)
					.onChange(async (value) => {
						this.plugin.settings.tabsSectionEnabled = value;
						await this.plugin.saveSettings();
						await this.plugin.refreshViews();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.latest.name"))
			.setDesc(t("settings.latest.desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.latestSectionEnabled)
					.onChange(async (value) => {
						this.plugin.settings.latestSectionEnabled = value;
						await this.plugin.saveSettings();
						await this.plugin.refreshViews();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.latest.exclude.name"))
			.setDesc(t("settings.latest.exclude.desc"))
			.addText((text) =>
				text
					.setPlaceholder("bookmarks.md, Resources/journal.md")
					.setValue(this.plugin.settings.latestExcludedFiles)
					.onChange(async (value) => {
						this.plugin.settings.latestExcludedFiles = value;
						this.plugin.invalidateExcludedPathsCache();
						await this.plugin.saveSettings();
						await this.plugin.refreshViews();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.latestCount.name"))
			.setDesc(t("settings.latestCount.desc"))
			.addText((text) =>
				text
					.setPlaceholder("5")
					.setValue(String(this.plugin.settings.latestFilesCount))
					.onChange(async (value) => {
						const n = parseInt(value, 10);
						if (!isNaN(n) && n > 0 && n <= LATEST_FILES_COUNT_MAX) {
							this.plugin.settings.latestFilesCount = n;
							await this.plugin.saveSettings();
							await this.plugin.refreshViews();
						}
					})
			);

		new Setting(containerEl)
			.setName(t("settings.latestDelete.name"))
			.setDesc(t("settings.latestDelete.desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.latestDeleteEnabled)
					.onChange(async (value) => {
						this.plugin.settings.latestDeleteEnabled = value;
						await this.plugin.saveSettings();
						await this.plugin.refreshViews();
					})
			);
	}
}
