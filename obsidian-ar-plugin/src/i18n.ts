const language = typeof navigator === "undefined" ? "en" : navigator.language;

export const isPortuguese = language.toLocaleLowerCase().startsWith("pt");

export function tr(portuguese: string, english: string): string {
  return isPortuguese ? portuguese : english;
}
