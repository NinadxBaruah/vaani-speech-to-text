/**
 * Language/mode/speaker catalogue — the single source of truth.
 * The web app reads it from GET /api/meta, so the UI never drifts from the server.
 * Source: Sarvam docs (saaras:v4 realtime STT, bulbul:v3 TTS), checked 2026-11-24.
 */

export interface Language {
  code: string;
  name: string;
  nativeName: string;
}

export const STT_LANGUAGES: readonly Language[] = [
  { code: 'en-IN', name: 'English (India)', nativeName: 'English' },
  { code: 'hi-IN', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'bn-IN', name: 'Bengali', nativeName: 'বাংলা' },
  { code: 'ta-IN', name: 'Tamil', nativeName: 'தமிழ்' },
  { code: 'te-IN', name: 'Telugu', nativeName: 'తెలుగు' },
  { code: 'gu-IN', name: 'Gujarati', nativeName: 'ગુજરાતી' },
  { code: 'kn-IN', name: 'Kannada', nativeName: 'ಕನ್ನಡ' },
  { code: 'ml-IN', name: 'Malayalam', nativeName: 'മലയാളം' },
  { code: 'mr-IN', name: 'Marathi', nativeName: 'मराठी' },
  { code: 'pa-IN', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ' },
  { code: 'od-IN', name: 'Odia', nativeName: 'ଓଡ଼ିଆ' },
  { code: 'as-IN', name: 'Assamese', nativeName: 'অসমীয়া' },
  { code: 'ur-IN', name: 'Urdu', nativeName: 'اردو' },
  { code: 'ne-IN', name: 'Nepali', nativeName: 'नेपाली' },
  { code: 'kok-IN', name: 'Konkani', nativeName: 'कोंकणी' },
  { code: 'ks-IN', name: 'Kashmiri', nativeName: 'کٲشُر' },
  { code: 'sd-IN', name: 'Sindhi', nativeName: 'سنڌي' },
  { code: 'sa-IN', name: 'Sanskrit', nativeName: 'संस्कृतम्' },
  { code: 'sat-IN', name: 'Santali', nativeName: 'ᱥᱟᱱᱛᱟᱲᱤ' },
  { code: 'mni-IN', name: 'Manipuri', nativeName: 'ꯃꯩꯇꯩꯂꯣꯟ' },
  { code: 'brx-IN', name: 'Bodo', nativeName: 'बड़ो' },
  { code: 'mai-IN', name: 'Maithili', nativeName: 'मैथिली' },
  { code: 'doi-IN', name: 'Dogri', nativeName: 'डोगरी' },
];

/** `auto` lets saaras:v4 detect the language per utterance (best for mixed speech). */
export const AUTO_LANGUAGE = 'auto';
export const STT_LANGUAGE_CODES = [AUTO_LANGUAGE, ...STT_LANGUAGES.map((l) => l.code)] as const;

const TTS_CODES = new Set([
  'en-IN',
  'hi-IN',
  'bn-IN',
  'ta-IN',
  'te-IN',
  'gu-IN',
  'kn-IN',
  'ml-IN',
  'mr-IN',
  'pa-IN',
  'od-IN',
]);
export const TTS_LANGUAGES: readonly Language[] = STT_LANGUAGES.filter((l) =>
  TTS_CODES.has(l.code),
);
export const TTS_LANGUAGE_CODES = TTS_LANGUAGES.map((l) => l.code);

export const STT_MODES = [
  { id: 'transcribe', label: 'Transcribe', hint: 'Text in the language that was spoken' },
  {
    id: 'codemix',
    label: 'Code-mix',
    hint: 'Mixed speech kept mixed, e.g. Hinglish with English words in Latin script',
  },
  { id: 'translit', label: 'Romanised', hint: 'Everything written in Latin script' },
  { id: 'translate', label: 'Translate to English', hint: 'Speak any language, get English text' },
  { id: 'verbatim', label: 'Verbatim', hint: 'Word for word, fillers included' },
] as const;
export const STT_MODE_IDS = STT_MODES.map((m) => m.id) as [
  (typeof STT_MODES)[number]['id'],
  ...(typeof STT_MODES)[number]['id'][],
];
export type SttMode = (typeof STT_MODE_IDS)[number];

export const TTS_SPEAKERS = [
  { id: 'shubh', label: 'Shubh (male)' },
  { id: 'priya', label: 'Priya (female, warm)' },
  { id: 'aditya', label: 'Aditya (male, news)' },
  { id: 'kavya', label: 'Kavya (female, calm)' },
  { id: 'rahul', label: 'Rahul (male, conversational)' },
  { id: 'neha', label: 'Neha (female, conversational)' },
] as const;
export const TTS_SPEAKER_IDS = TTS_SPEAKERS.map((s) => s.id) as [string, ...string[]];
export const DEFAULT_TTS_SPEAKER = 'shubh';
