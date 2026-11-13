/**
 * The methods of calculation, their names, and the default settings of each country.
 *
 * @module
 */

import { languageOf } from '../language.ts';
import type { CalculationSettings } from './calculate.ts';

/**
 * A method of calculation: the angles of the sun below the horizon at Fajr and Isha, in
 * {@link CALCULATION_METHODS}. `custom` takes them from the settings.
 */
export type CalculationMethod =
  | 'muslim_world_league'
  | 'muslims_of_france'
  | 'angle_15'
  | 'algeria'
  | 'morocco'
  | 'egypt'
  | 'karachi'
  | 'umm_al_qura'
  | 'gulf'
  | 'moonsighting_committee'
  | 'north_america'
  | 'kuwait'
  | 'qatar'
  | 'singapore'
  | 'turkey'
  | 'tehran'
  | 'russia'
  | 'custom';

/**
 * The angles of each method but `custom`.
 *
 * A method has no offset of its own: Dhuhr is one minute after the solar transit for every method,
 * and any other minute is an adjustment of the settings. Umm al-Qura and Qatar have a time for
 * Isha instead of an angle.
 */
export const CALCULATION_METHODS: Readonly<
  Record<
    Exclude<CalculationMethod, 'custom'>,
    {
      /** The angle of the sun below the horizon at Fajr, in degrees. */
      readonly fajrAngle: number;
      /** The angle at Isha, in degrees, or `null` when Isha is a time after Maghrib. */
      readonly ishaAngle: number | null;
      /**
       * The minutes from Maghrib, before its adjustment, to Isha, or `null` when Isha has an
       * angle. 90 for Umm al-Qura, 120 during Ramadan, and 90 for Qatar.
       */
      readonly ishaMinutesAfterMaghrib: number | null;
    }
  >
> = {
  muslim_world_league: angles(18, 17),
  muslims_of_france: angles(12, 12),
  angle_15: angles(15, 15),
  algeria: angles(18, 17),
  morocco: angles(18, 17),
  egypt: angles(19.5, 17.5),
  karachi: angles(18, 18),
  umm_al_qura: { fajrAngle: 18.5, ishaAngle: null, ishaMinutesAfterMaghrib: 90 },
  gulf: angles(18.2, 18.2),
  moonsighting_committee: angles(18, 18),
  north_america: angles(15, 15),
  kuwait: angles(18, 17.5),
  qatar: { fajrAngle: 18, ishaAngle: null, ishaMinutesAfterMaghrib: 90 },
  singapore: angles(20, 18),
  turkey: angles(18, 17),
  tehran: angles(17.7, 14),
  russia: angles(16, 15),
};

function angles(
  fajrAngle: number,
  ishaAngle: number,
): { fajrAngle: number; ishaAngle: number; ishaMinutesAfterMaghrib: null } {
  return { fajrAngle, ishaAngle, ishaMinutesAfterMaghrib: null };
}

// The countries of each method. The other countries have the Muslim World League.
const COUNTRIES: readonly (readonly [Exclude<CalculationMethod, 'custom'>, string])[] = [
  ['angle_15', 'FR'],
  ['algeria', 'DZ'],
  ['morocco', 'MA'],
  ['umm_al_qura', 'SA'],
  [
    'egypt',
    'EG IQ LB SY AO BF BI BJ BW CD CF CI CM CV DJ ER ET GA GH GM GN GQ GW KE KM LR LS LY MG ML MR ' +
      'MU MW MZ NA NE NG RW SC SD SL SN SO SS ST SZ TD TG TZ UG ZA ZM ZW',
  ],
  ['north_america', 'CA US GB ES'],
  ['karachi', 'PK IN BD AF TN OM JO MY'],
  ['singapore', 'SG ID'],
  ['gulf', 'AE'],
  ['kuwait', 'KW'],
  ['qatar', 'QA'],
  ['turkey', 'TR'],
  ['tehran', 'IR'],
  ['russia', 'RU'],
];

const METHOD_OF_COUNTRY = new Map(
  COUNTRIES.flatMap(([method, countries]) =>
    countries.split(' ').map((country) => [country, method] as const),
  ),
);

// Where the Hanafi school is the majority.
const HANAFI_COUNTRIES = new Set(['PK', 'IN', 'BD', 'AF']);

/**
 * Return the method of calculation of a country.
 *
 * @param countryCode - The country, as an ISO 3166-1 alpha-2 code like `FR`.
 * @returns The method of the country: `angle_15` in France, for example. The Muslim World League
 *   for the other countries, and without a country.
 */
export function defaultCalculationMethod(
  countryCode?: string | null,
): Exclude<CalculationMethod, 'custom'> {
  return METHOD_OF_COUNTRY.get(countryCode?.toUpperCase() ?? '') ?? 'muslim_world_league';
}

/**
 * Return the settings of calculation of a country, for `calculatePrayerTimes()`.
 *
 * @param countryCode - The country, as an ISO 3166-1 alpha-2 code like `FR`.
 * @returns The method of the country, from {@link defaultCalculationMethod}; the Hanafi Asr in
 *   Pakistan, India, Bangladesh and Afghanistan, and the Shafi'i Asr elsewhere; the
 *   `twilight_angle` rule for high latitudes; and no adjustment.
 */
export function defaultCalculationSettings(countryCode?: string | null): CalculationSettings {
  return {
    method: defaultCalculationMethod(countryCode),
    madhab: HANAFI_COUNTRIES.has(countryCode?.toUpperCase() ?? '') ? 'hanafi' : 'shafi',
    highLatitudeRule: 'twilight_angle',
  };
}

const ENGLISH_NAMES: Readonly<Record<CalculationMethod, string>> = {
  muslim_world_league: 'Muslim World League',
  muslims_of_france: 'Muslim of France (ex UOIF)',
  angle_15: 'Fajr and Isha at 15°',
  algeria: 'Algerian Ministry of Religious Affairs and Wakfs',
  morocco: 'Moroccan Ministry of Wakfs and Islamic Affairs',
  egypt: 'Egyptian General Authority of Survey',
  karachi: 'University of Islamic Sciences, Karachi',
  umm_al_qura: 'Umm al-Qura University, Makkah',
  gulf: 'The Gulf Region',
  moonsighting_committee: 'Moon Sighting Committee',
  north_america: 'Islamic Society of North America',
  kuwait: 'Kuwait',
  qatar: 'Qatar',
  singapore: 'Singapore',
  turkey: 'Turkey',
  tehran: 'Institute of Geophysics, University of Tehran',
  russia: 'Spiritual Administration of Muslims in Russia',
  custom: 'Custom angles',
};

// The strings `calculation_methods_*` of mawaqit/mawaqit-mobile-i18n. It has none for `angle_15`,
// named here with the names of Fajr and Isha of these strings.
const NAMES = new Map<string, Readonly<Record<CalculationMethod, string>>>([
  [
    'ar',
    {
      muslim_world_league: 'رابطة العالم الإسلامي',
      muslims_of_france: 'المسلمون في فرنسا (مثال: الاتحاد الإسلامي للعلماء في فرنسا)',
      angle_15: 'الفجر والعشاء بزاوية 15°',
      algeria: 'وزارة الشؤون الدينية والأوقاف في الجزائر',
      morocco: 'وزارة الأوقاف والشؤون الإسلامية في المغرب',
      egypt: 'الهيئة العامة للمساحة في مصر',
      karachi: 'جامعة العلوم الإسلامية في كراتشي',
      umm_al_qura: 'جامعة أم القرى في مكة المكرمة',
      gulf: 'المنطقة الخليجية',
      moonsighting_committee: 'لجنة رؤية الهلال',
      north_america: 'الجمعية الإسلامية في أمريكا الشمالية',
      kuwait: 'الكويت',
      qatar: 'قطر',
      singapore: 'سنغافورة',
      turkey: 'تركيا',
      tehran: 'معهد الجيوفيزياء، جامعة طهران',
      russia: 'الإدارة الروحية للمسلمين في روسيا',
      custom: 'زوايا مخصصة',
    },
  ],
  [
    'de',
    {
      muslim_world_league: 'Liga der muslimischen Welt',
      muslims_of_france: 'Musulman de France (ehemals UOIF)',
      angle_15: 'Fadjr und Ishaa bei 15°',
      algeria: 'Algerisches Ministerium für religiöse Angelegenheiten und Wakfs',
      morocco: 'Marokkanisches Ministerium für Wakfs und Islamische Angelegenheiten',
      egypt: 'Egyptian General Authority of Survey',
      karachi: 'Universität für Islamische Wissenschaften, Karachi',
      umm_al_qura: 'Universität Umm al-Qura, Mekka',
      gulf: 'Golfregion',
      moonsighting_committee: 'Mondbeobachtungskomitee',
      north_america: 'Islamische Gesellschaft Nordamerikas',
      kuwait: 'Kuwait',
      qatar: 'Katar',
      singapore: 'Singapur',
      turkey: 'Türkei',
      tehran: 'Institut für Geophysik, Universität Teheran',
      russia: 'Geistliche Verwaltung der Muslime in Russland',
      custom: 'Eigene Winkel',
    },
  ],
  ['en', ENGLISH_NAMES],
  [
    'fr',
    {
      muslim_world_league: 'Ligue du monde musulman',
      muslims_of_france: 'Musulman de France (ancien UOIF)',
      angle_15: 'Fajr et Isha à 15°',
      algeria: 'Ministère des affaires religieuses et des wakfs Algérien',
      morocco: 'Ministère des wakfs et affaires islamiques Marocain',
      egypt: 'Egyptian General Authority of Survey',
      karachi: 'Université des sciences islamiques, Karachi',
      umm_al_qura: 'Université Umm al-Qura, La Mecque',
      gulf: 'Région du Golfe',
      moonsighting_committee: "Comité d'observation de la lune",
      north_america: "Société islamique d'Amérique du Nord",
      kuwait: 'Koweït',
      qatar: 'Qatar',
      singapore: 'Singapour',
      turkey: 'Turquie',
      tehran: 'Institut de géophysique, Université de Téhéran',
      russia: 'Administration spirituelle des musulmans en Russie',
      custom: 'Angles personnalisés',
    },
  ],
  [
    'tr',
    {
      muslim_world_league: 'Müslüman Dünya Ligi',
      muslims_of_france: 'Musulman de France (eski UOIF)',
      angle_15: 'Sabah ve Yatsı için 15°',
      algeria: 'Cezayir Din İşleri ve Vakıflar Bakanlığı',
      morocco: 'Fas Vakıflar ve İslami İşler Bakanlığı',
      egypt: 'Egyptian General Authority of Survey',
      karachi: 'University of Islamic Sciences, Karachi',
      umm_al_qura: 'Umm al-Qura Üniversitesi, Mekke',
      gulf: 'Körfez Bölgesi',
      moonsighting_committee: 'Ay Gözlem Komitesi',
      north_america: 'Islamic Society of North America',
      kuwait: 'Kuveyt',
      qatar: 'Katar',
      singapore: 'Singapur',
      turkey: 'Türkiye',
      tehran: 'Institute of Geophysics, University of Tehran',
      russia: "Rusya'daki Müslümanların Ruhani Yönetimi",
      custom: 'Özel açılar',
    },
  ],
]);

/**
 * Return the name of a method of calculation, like `Muslim World League`.
 *
 * @param method - The method.
 * @param language - A language, like `fr`, or a language tag, like `fr-FR`. Arabic, English,
 *   French, German and Turkish have the names of the MAWAQIT app; the other languages get the
 *   English name.
 * @returns The name of the method in this language.
 */
export function calculationMethodName(method: CalculationMethod, language = 'en'): string {
  return (NAMES.get(languageOf(language)) ?? ENGLISH_NAMES)[method];
}
