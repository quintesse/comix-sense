/** Apply to assembled passages so digits and punctuation inside dialogue stay with it. */
export function shouldSkipPassage(text: string): boolean {
	return /^[\p{N}\p{P}\p{White_Space}]+$/u.test(text) && /[\p{N}\p{P}]/u.test(text);
}
