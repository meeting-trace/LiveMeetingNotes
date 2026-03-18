/**
 * Comprehensive list of languages supported by browser Web Speech API.
 * Used for:
 *  - The "available languages" multi-select in TranscriptionConfig
 *  - The language quick-switch dropdown in RecordingControls
 */
export interface WorldLanguage {
  value: string;       // BCP-47 code, e.g. "vi-VN"
  fiCode: string;      // ISO 3166-1 alpha-2 (lowercase) for flag-icons CSS, e.g. "vn"
  name: string;        // Native language name, e.g. "Русский"
  englishName: string; // English language name, e.g. "Russian"
  keywords: string;    // Extra search terms: country name in English + native, e.g. "Russia, Россия"
}

/** Default set shown in RecordingControls when the user hasn't customised the list. */
export const DEFAULT_AVAILABLE_LANGUAGES: string[] = [
  'vi-VN', 'en-US', 'en-GB', 'ja-JP', 'ko-KR',
  'zh-CN', 'zh-TW', 'fr-FR', 'de-DE', 'es-ES',
];

export const WORLD_LANGUAGES: WorldLanguage[] = [
  // ── East Asia ──────────────────────────────────────────────────
  { value: 'zh-CN', fiCode: 'cn', name: '中文（简体）',      englishName: 'Chinese Simplified',             keywords: 'China, 中国, 中國' },
  { value: 'zh-TW', fiCode: 'tw', name: '中文（繁體）',      englishName: 'Chinese Traditional (Taiwan)',    keywords: 'Taiwan, 台湾, 臺灣' },
  { value: 'zh-HK', fiCode: 'hk', name: '中文（香港）',      englishName: 'Chinese (Hong Kong)',             keywords: 'Hong Kong, 香港' },
  { value: 'ja-JP', fiCode: 'jp', name: '日本語',            englishName: 'Japanese',                       keywords: 'Japan, 日本' },
  { value: 'ko-KR', fiCode: 'kr', name: '한국어',            englishName: 'Korean',                         keywords: 'Korea, 한국' },
  { value: 'mn-MN', fiCode: 'mn', name: 'Монгол',           englishName: 'Mongolian',                      keywords: 'Mongolia, Монгол улс' },

  // ── Southeast Asia ─────────────────────────────────────────────
  { value: 'vi-VN', fiCode: 'vn', name: 'Tiếng Việt',       englishName: 'Vietnamese',                     keywords: 'Vietnam, Việt Nam' },
  { value: 'th-TH', fiCode: 'th', name: 'ภาษาไทย',          englishName: 'Thai',                           keywords: 'Thailand, ไทย' },
  { value: 'id-ID', fiCode: 'id', name: 'Bahasa Indonesia',  englishName: 'Indonesian',                     keywords: 'Indonesia' },
  { value: 'ms-MY', fiCode: 'my', name: 'Bahasa Melayu',     englishName: 'Malay',                          keywords: 'Malaysia, Malay' },
  { value: 'tl-PH', fiCode: 'ph', name: 'Filipino',          englishName: 'Filipino (Tagalog)',              keywords: 'Philippines, Pilipinas' },
  { value: 'km-KH', fiCode: 'kh', name: 'ភាសាខ្មែរ',        englishName: 'Khmer (Cambodian)',               keywords: 'Cambodia, កម្ពុជា' },
  { value: 'lo-LA', fiCode: 'la', name: 'ລາວ',               englishName: 'Lao',                            keywords: 'Laos, ລາວ' },
  { value: 'my-MM', fiCode: 'mm', name: 'မြန်မာဘာသာ',        englishName: 'Burmese (Myanmar)',               keywords: 'Myanmar, Burma, မြန်မာ' },

  // ── South Asia ─────────────────────────────────────────────────
  { value: 'hi-IN', fiCode: 'in', name: 'हिन्दी',            englishName: 'Hindi',                          keywords: 'India, भारत' },
  { value: 'bn-BD', fiCode: 'bd', name: 'বাংলা',              englishName: 'Bengali (Bangladesh)',            keywords: 'Bangladesh, বাংলাদেশ' },
  { value: 'bn-IN', fiCode: 'in', name: 'বাংলা (ভারত)',       englishName: 'Bengali (India)',                 keywords: 'India, Bengal, ভারত' },
  { value: 'ur-PK', fiCode: 'pk', name: 'اردو',               englishName: 'Urdu (Pakistan)',                 keywords: 'Pakistan, پاکستان' },
  { value: 'ta-IN', fiCode: 'in', name: 'தமிழ்',             englishName: 'Tamil',                          keywords: 'India, Tamil Nadu, தமிழ்நாடு' },
  { value: 'te-IN', fiCode: 'in', name: 'తెలుగు',            englishName: 'Telugu',                         keywords: 'India, Andhra Pradesh' },
  { value: 'ml-IN', fiCode: 'in', name: 'മലയാളം',            englishName: 'Malayalam',                      keywords: 'India, Kerala' },
  { value: 'kn-IN', fiCode: 'in', name: 'ಕನ್ನಡ',             englishName: 'Kannada',                        keywords: 'India, Karnataka' },
  { value: 'mr-IN', fiCode: 'in', name: 'मराठी',             englishName: 'Marathi',                        keywords: 'India, Maharashtra' },
  { value: 'gu-IN', fiCode: 'in', name: 'ગુજરાતી',           englishName: 'Gujarati',                       keywords: 'India, Gujarat' },
  { value: 'pa-IN', fiCode: 'in', name: 'ਪੰਜਾਬੀ',            englishName: 'Punjabi',                        keywords: 'India, Punjab' },
  { value: 'ne-NP', fiCode: 'np', name: 'नेपाली',            englishName: 'Nepali',                         keywords: 'Nepal, नेपाल' },
  { value: 'si-LK', fiCode: 'lk', name: 'සිංහල',             englishName: 'Sinhala (Sri Lanka)',             keywords: 'Sri Lanka' },

  // ── Middle East / Central Asia ──────────────────────────────────
  { value: 'ar-SA', fiCode: 'sa', name: 'العربية',            englishName: 'Arabic (Saudi Arabia)',           keywords: 'Saudi Arabia, Arab, السعودية' },
  { value: 'ar-EG', fiCode: 'eg', name: 'العربية (مصر)',      englishName: 'Arabic (Egypt)',                  keywords: 'Egypt, مصر' },
  { value: 'ar-MA', fiCode: 'ma', name: 'العربية (المغرب)',   englishName: 'Arabic (Morocco)',                keywords: 'Morocco, المغرب' },
  { value: 'fa-IR', fiCode: 'ir', name: 'فارسی',              englishName: 'Persian (Farsi)',                 keywords: 'Iran, ایران, Persia' },
  { value: 'he-IL', fiCode: 'il', name: 'עברית',              englishName: 'Hebrew',                         keywords: 'Israel, ישראל' },
  { value: 'tr-TR', fiCode: 'tr', name: 'Türkçe',             englishName: 'Turkish',                        keywords: 'Turkey, Türkiye' },
  { value: 'az-AZ', fiCode: 'az', name: 'Azərbaycan',         englishName: 'Azerbaijani',                    keywords: 'Azerbaijan, Azərbaycan' },
  { value: 'kk-KZ', fiCode: 'kz', name: 'Қазақ',             englishName: 'Kazakh',                         keywords: 'Kazakhstan, Қазақстан' },
  { value: 'uz-UZ', fiCode: 'uz', name: "O'zbek",             englishName: 'Uzbek',                          keywords: "Uzbekistan, O'zbekiston" },

  // ── English variants ───────────────────────────────────────────
  { value: 'en-US', fiCode: 'us', name: 'English (US)',        englishName: 'English (United States)',         keywords: 'United States, America, USA' },
  { value: 'en-GB', fiCode: 'gb', name: 'English (UK)',        englishName: 'English (United Kingdom)',        keywords: 'United Kingdom, Britain, England' },
  { value: 'en-AU', fiCode: 'au', name: 'English (AU)',        englishName: 'English (Australia)',             keywords: 'Australia' },
  { value: 'en-CA', fiCode: 'ca', name: 'English (CA)',        englishName: 'English (Canada)',                keywords: 'Canada' },
  { value: 'en-IN', fiCode: 'in', name: 'English (IN)',        englishName: 'English (India)',                 keywords: 'India' },
  { value: 'en-NZ', fiCode: 'nz', name: 'English (NZ)',        englishName: 'English (New Zealand)',           keywords: 'New Zealand' },

  // ── Western Europe ─────────────────────────────────────────────
  { value: 'fr-FR', fiCode: 'fr', name: 'Français',           englishName: 'French (France)',                keywords: 'France' },
  { value: 'fr-CA', fiCode: 'ca', name: 'Français (CA)',      englishName: 'French (Canada)',                keywords: 'Canada' },
  { value: 'fr-BE', fiCode: 'be', name: 'Français (BE)',      englishName: 'French (Belgium)',               keywords: 'Belgium, Belgique' },
  { value: 'de-DE', fiCode: 'de', name: 'Deutsch',             englishName: 'German (Germany)',               keywords: 'Germany, Deutschland' },
  { value: 'de-AT', fiCode: 'at', name: 'Deutsch (AT)',        englishName: 'German (Austria)',               keywords: 'Austria, Österreich' },
  { value: 'de-CH', fiCode: 'ch', name: 'Deutsch (CH)',        englishName: 'German (Switzerland)',           keywords: 'Switzerland, Schweiz' },
  { value: 'es-ES', fiCode: 'es', name: 'Español (ES)',        englishName: 'Spanish (Spain)',                keywords: 'Spain, España' },
  { value: 'es-MX', fiCode: 'mx', name: 'Español (MX)',        englishName: 'Spanish (Mexico)',               keywords: 'Mexico, México' },
  { value: 'es-AR', fiCode: 'ar', name: 'Español (AR)',        englishName: 'Spanish (Argentina)',            keywords: 'Argentina' },
  { value: 'es-CO', fiCode: 'co', name: 'Español (CO)',        englishName: 'Spanish (Colombia)',             keywords: 'Colombia' },
  { value: 'es-US', fiCode: 'us', name: 'Español (US)',        englishName: 'Spanish (United States)',        keywords: 'United States, America' },
  { value: 'pt-BR', fiCode: 'br', name: 'Português (BR)',      englishName: 'Portuguese (Brazil)',            keywords: 'Brazil, Brasil' },
  { value: 'pt-PT', fiCode: 'pt', name: 'Português (PT)',      englishName: 'Portuguese (Portugal)',          keywords: 'Portugal' },
  { value: 'it-IT', fiCode: 'it', name: 'Italiano',            englishName: 'Italian',                       keywords: 'Italy, Italia' },
  { value: 'nl-NL', fiCode: 'nl', name: 'Nederlands',          englishName: 'Dutch (Netherlands)',            keywords: 'Netherlands, Holland, Nederland' },
  { value: 'nl-BE', fiCode: 'be', name: 'Nederlands (BE)',     englishName: 'Dutch (Belgium)',                keywords: 'Belgium, België' },
  { value: 'ca-ES', fiCode: 'es', name: 'Català',              englishName: 'Catalan',                       keywords: 'Catalonia, Catalunya' },
  { value: 'eu-ES', fiCode: 'es', name: 'Euskara',             englishName: 'Basque',                        keywords: 'Basque Country, Euskadi' },
  { value: 'gl-ES', fiCode: 'es', name: 'Galego',              englishName: 'Galician',                      keywords: 'Galicia' },
  { value: 'cy-GB', fiCode: 'gb', name: 'Cymraeg',             englishName: 'Welsh',                         keywords: 'Wales, Cymru' },

  // ── Northern Europe ────────────────────────────────────────────
  { value: 'sv-SE', fiCode: 'se', name: 'Svenska',             englishName: 'Swedish',                       keywords: 'Sweden, Sverige' },
  { value: 'da-DK', fiCode: 'dk', name: 'Dansk',               englishName: 'Danish',                        keywords: 'Denmark, Danmark' },
  { value: 'fi-FI', fiCode: 'fi', name: 'Suomi',               englishName: 'Finnish',                       keywords: 'Finland, Suomi' },
  { value: 'nb-NO', fiCode: 'no', name: 'Norsk bokmål',        englishName: 'Norwegian',                     keywords: 'Norway, Norge' },
  { value: 'is-IS', fiCode: 'is', name: 'Íslenska',            englishName: 'Icelandic',                     keywords: 'Iceland, Ísland' },

  // ── Eastern Europe ─────────────────────────────────────────────
  { value: 'ru-RU', fiCode: 'ru', name: 'Русский',             englishName: 'Russian',                       keywords: 'Russia, Россия, Русский' },
  { value: 'pl-PL', fiCode: 'pl', name: 'Polski',              englishName: 'Polish',                        keywords: 'Poland, Polska' },
  { value: 'cs-CZ', fiCode: 'cz', name: 'Čeština',            englishName: 'Czech',                         keywords: 'Czech Republic, Czechia, Česko' },
  { value: 'sk-SK', fiCode: 'sk', name: 'Slovenčina',          englishName: 'Slovak',                        keywords: 'Slovakia, Slovensko' },
  { value: 'hu-HU', fiCode: 'hu', name: 'Magyar',              englishName: 'Hungarian',                     keywords: 'Hungary, Magyarország' },
  { value: 'ro-RO', fiCode: 'ro', name: 'Română',              englishName: 'Romanian',                      keywords: 'Romania, România' },
  { value: 'bg-BG', fiCode: 'bg', name: 'Български',           englishName: 'Bulgarian',                     keywords: 'Bulgaria, България' },
  { value: 'hr-HR', fiCode: 'hr', name: 'Hrvatski',            englishName: 'Croatian',                      keywords: 'Croatia, Hrvatska' },
  { value: 'sr-RS', fiCode: 'rs', name: 'Srpski',              englishName: 'Serbian',                       keywords: 'Serbia, Srbija' },
  { value: 'uk-UA', fiCode: 'ua', name: 'Українська',          englishName: 'Ukrainian',                     keywords: 'Ukraine, Україна' },
  { value: 'el-GR', fiCode: 'gr', name: 'Ελληνικά',           englishName: 'Greek',                         keywords: 'Greece, Ελλάδα' },
  { value: 'lt-LT', fiCode: 'lt', name: 'Lietuvių',            englishName: 'Lithuanian',                    keywords: 'Lithuania, Lietuva' },
  { value: 'lv-LV', fiCode: 'lv', name: 'Latviešu',           englishName: 'Latvian',                       keywords: 'Latvia, Latvija' },
  { value: 'et-EE', fiCode: 'ee', name: 'Eesti',               englishName: 'Estonian',                      keywords: 'Estonia, Eesti' },
  { value: 'sl-SI', fiCode: 'si', name: 'Slovenščina',         englishName: 'Slovenian',                     keywords: 'Slovenia, Slovenija' },
  { value: 'mk-MK', fiCode: 'mk', name: 'Македонски',          englishName: 'Macedonian',                    keywords: 'North Macedonia, Македонија' },
  { value: 'sq-AL', fiCode: 'al', name: 'Shqip',               englishName: 'Albanian',                      keywords: 'Albania, Shqipëri' },
  { value: 'ka-GE', fiCode: 'ge', name: 'ქართული',            englishName: 'Georgian',                      keywords: 'Georgia, საქართველო' },
  { value: 'hy-AM', fiCode: 'am', name: 'Հայերեն',             englishName: 'Armenian',                      keywords: 'Armenia, Հայաստան' },

  // ── Africa ────────────────────────────────────────────────────
  { value: 'sw-TZ', fiCode: 'tz', name: 'Kiswahili',           englishName: 'Swahili',                       keywords: 'Tanzania, Kenya, East Africa' },
  { value: 'af-ZA', fiCode: 'za', name: 'Afrikaans',           englishName: 'Afrikaans',                     keywords: 'South Africa, Suid-Afrika' },
  { value: 'am-ET', fiCode: 'et', name: 'አማርኛ',               englishName: 'Amharic (Ethiopia)',             keywords: 'Ethiopia, ኢትዮጵያ' },
  { value: 'zu-ZA', fiCode: 'za', name: 'isiZulu',             englishName: 'Zulu',                          keywords: 'South Africa, Zulu' },
];
