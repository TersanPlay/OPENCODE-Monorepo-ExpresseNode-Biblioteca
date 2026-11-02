/**
 * A ISBNdb devolve ISO 639-3 (com algumas variantes regionais). O sistema
 * armazena o idioma como texto livre em português (padrão: "Português").
 * Códigos desconhecidos são ignorados para não gravar siglas na ficha.
 */
const LANGUAGE_LABELS: Record<string, string> = {
  por: 'Português',
  pt: 'Português',
  'pt-br': 'Português',
  'pt-pt': 'Português',
  eng: 'Inglês',
  en: 'Inglês',
  spa: 'Espanhol',
  es: 'Espanhol',
  'es-419': 'Espanhol',
  fra: 'Francês',
  fre: 'Francês',
  fr: 'Francês',
  'fr-ca': 'Francês',
  deu: 'Alemão',
  ger: 'Alemão',
  de: 'Alemão',
  ita: 'Italiano',
  it: 'Italiano',
  nld: 'Holandês',
  dut: 'Holandês',
  nl: 'Holandês',
  lat: 'Latim',
  la: 'Latim',
  ell: 'Grego',
  gre: 'Grego',
  el: 'Grego',
  rus: 'Russo',
  ru: 'Russo',
  ara: 'Árabe',
  ar: 'Árabe',
  heb: 'Hebraico',
  he: 'Hebraico',
  jpn: 'Japonês',
  ja: 'Japonês',
  zho: 'Chinês',
  chi: 'Chinês',
  zh: 'Chinês',
  'zh-tw': 'Chinês',
  kor: 'Coreano',
  ko: 'Coreano',
  swe: 'Sueco',
  sv: 'Sueco',
  pol: 'Polonês',
  pl: 'Polonês',
  tur: 'Turco',
  tr: 'Turco',
  hin: 'Hindi',
  hi: 'Hindi',
};

export function normalizeLanguage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  if (LANGUAGE_LABELS[key]) return LANGUAGE_LABELS[key];
  // Nome já em português (ex.: "Português") — mantém apenas se não parecer código.
  if (/^[a-z]{2,3}(-[a-z0-9]+)?$/i.test(key)) return null;
  return raw.trim();
}