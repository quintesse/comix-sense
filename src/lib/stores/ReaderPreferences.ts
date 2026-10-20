/** Resolve an explicit album choice before consulting browser language preferences. */
export function preferredLanguage(
	saved: string | undefined,
	available: readonly string[],
	preferred: readonly string[]
): string {
	const normalize = (language: string) => language.toLowerCase().replaceAll('_', '-');
	const match = (language: string) =>
		available.find((candidate) => normalize(candidate) === normalize(language));
	if (saved === 'org') return 'org';
	if (saved !== undefined) {
		const language = match(saved);
		if (language !== undefined) return language;
	}
	for (const preference of preferred) {
		// Browser locales such as en-US also match an album's generic en translation.
		const language = match(preference) ?? match(normalize(preference).split('-')[0]);
		if (language !== undefined) return language;
	}
	return 'org';
}
