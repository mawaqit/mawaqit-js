/** Return the language of a language tag: `fr` for `fr`, `fr-FR` or `fr_FR`. Internal. */
export function languageOf(tag: string): string {
  return tag.replace(/[-_].*/s, '').toLowerCase();
}
