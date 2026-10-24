const flags = import.meta.glob(
	[
		'/node_modules/svelte-flagpack/dist/flags/m/??.svg',
		'/node_modules/svelte-flagpack/dist/flags/m/??-*.svg'
	],
	{
		eager: true,
		exhaustive: true,
		query: '?url',
		import: 'default'
	}
) as Record<string, string>;
// Language codes are not country codes. Use representative countries explicitly.
const countries: Record<string, string> = {
	en: 'GB-UKM',
	nl: 'NL',
	fr: 'FR',
	de: 'DE',
	es: 'ES',
	it: 'IT',
	pt: 'PT',
	ca: 'ES-CT',
	eu: 'ES-PV',
	gl: 'ES-GA',
	da: 'DK',
	sv: 'SE',
	no: 'NO',
	nb: 'NO',
	nn: 'NO',
	fi: 'FI',
	is: 'IS',
	pl: 'PL',
	cs: 'CZ',
	sk: 'SK',
	hu: 'HU',
	ro: 'RO',
	bg: 'BG',
	el: 'GR',
	uk: 'UA',
	ru: 'RU',
	tr: 'TR',
	ar: 'SA',
	he: 'IL',
	hi: 'IN',
	bn: 'BD',
	zh: 'CN',
	ja: 'JP',
	ko: 'KR',
	vi: 'VN',
	th: 'TH',
	id: 'ID',
	ms: 'MY',
	fa: 'IR',
	sw: 'TZ',
	af: 'ZA',
	et: 'EE',
	lv: 'LV',
	lt: 'LT',
	sl: 'SI',
	hr: 'HR',
	sr: 'RS'
};
export function flag(language: string) {
	const [base, region] = language.toLowerCase().split(/[-_]/);
	const country = region?.length === 2 ? region.toUpperCase() : countries[base];
	const code = country === 'GB' ? 'GB-UKM' : country;
	return code ? flags[`/node_modules/svelte-flagpack/dist/flags/m/${code}.svg`] : undefined;
}

const languageNames = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });

export function languageLabel(language: string): string {
	const code = language.toUpperCase();
	if (!language || ['org', 'ocr'].includes(language.toLowerCase())) return code;
	try {
		const name = languageNames.of(language.replaceAll('_', '-'));
		return name ? `${name} (${code})` : code;
	} catch {
		return code;
	}
}

/** Language codes with the same representative Flagpack flags as the reader menu. */
export const translationLanguages = Object.keys(countries)
	.filter((language) => flag(language))
	.map((language) => ({ id: language, text: languageLabel(language) }))
	.sort((a, b) => a.text.localeCompare(b.text, 'en'));
