import en from "./i18n/en.json";
import de from "./i18n/de.json";

type StringKey = keyof typeof en;
type LocaleStrings = Record<StringKey, string>;
const enStrings: LocaleStrings = en;
const deStrings: LocaleStrings = de;

const locales: Record<string, LocaleStrings> = {
	en: enStrings,
	de: deStrings,
};

function getLocale(): string {
	// Obsidian stores the user's chosen language in localStorage under "language".
	// Slice to 2 chars to normalise region variants (e.g. "de-AT" → "de").
	return (window.localStorage.getItem("language") ?? "en").slice(0, 2);
}

const locale = getLocale();
const strings: LocaleStrings = locales[locale] ?? enStrings;

export function t(key: StringKey): string {
	return strings[key];
}
