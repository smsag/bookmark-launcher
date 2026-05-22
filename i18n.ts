import en from "./i18n/en.json";
import de from "./i18n/de.json";

type StringKey = keyof typeof en;

const locales: Record<string, Partial<Record<StringKey, string>>> = { en, de };

function getLocale(): string {
	// Obsidian stores the user's chosen language in localStorage under "language".
	// Slice to 2 chars to normalise region variants (e.g. "de-AT" → "de").
	return (window.localStorage.getItem("language") ?? "en").slice(0, 2);
}

const locale = getLocale();
const strings: Partial<Record<StringKey, string>> = locales[locale] ?? en;

export function t(key: StringKey): string {
	return strings[key] ?? en[key];
}
