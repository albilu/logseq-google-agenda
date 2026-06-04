export type SupportedLocale = 'en' | 'fr' | 'de' | 'nl' | 'zh-Hans' | 'zh-Hant';

type WeatherConditionIconKey = 'sunny' | 'partly-cloudy' | 'cloudy' | 'rain' | 'snow' | 'storm';

const ENGLISH_MESSAGES = {
  'settings.feeds.title': 'Calendar feeds',
  'settings.feeds.description': 'JSON array of feed objects with url, calendarName, and optional color.',
  'settings.refreshIntervalMinutes.title': 'Refresh interval (minutes)',
  'settings.refreshIntervalMinutes.description': 'How often feeds should refresh automatically.',
  'settings.weatherCity.title': 'Weather city',
  'settings.weatherCity.description': 'City, region, or country to use for weather forecasts.',
  'settings.weatherRefreshIntervalMinutes.title': 'Weather refresh interval (minutes)',
  'settings.weatherRefreshIntervalMinutes.description': 'How often weather should refresh automatically.',
  'agenda.previousMonth': 'Previous month',
  'agenda.nextMonth': 'Next month',
  'agenda.today': 'Today',
  'agenda.calendar': 'Calendar',
  'agenda.tasks': 'Tasks',
  'agenda.close': 'Close',
  'agenda.dayDetails': 'Day details',
  'agenda.selectedDay': 'Selected day',
  'agenda.upcoming': 'Upcoming',
  'agenda.noData': 'No data',
  'agenda.nothingUpcoming': 'Nothing upcoming',
  'agenda.syncIssue': 'Sync issue',
  'agenda.syncIssues': 'Sync issues',
  'agenda.week': 'Week',
  'agenda.more': 'more',
  'agenda.precipitation': 'Precipitation',
  'agenda.allDay': 'All day',
  'agenda.priority': 'Priority',
  'agenda.scheduled': 'Scheduled',
  'agenda.due': 'Due',
  'agenda.monthCalendar': 'Month calendar',
  'agenda.mode': 'Agenda mode',
  'agenda.refreshing': 'Refreshing',
  'agenda.weatherDetails': 'Weather details',
  'agenda.resizeSidebarSections': 'Resize sidebar sections',
  'command.openAgenda': 'Open Google Agenda',
  'command.refreshAgenda': 'Refresh Google Agenda',
} as const;

export type TranslationKey = keyof typeof ENGLISH_MESSAGES;

const TRANSLATIONS: Record<SupportedLocale, Record<TranslationKey, string>> = {
  en: ENGLISH_MESSAGES,
  fr: {
    'settings.feeds.title': 'Flux de calendrier',
    'settings.feeds.description': "Tableau JSON d'objets de flux avec url, calendarName et color facultatif.",
    'settings.refreshIntervalMinutes.title': 'Intervalle de rafraichissement (minutes)',
    'settings.refreshIntervalMinutes.description': 'Frequence de rafraichissement automatique des flux.',
    'settings.weatherCity.title': 'Ville meteo',
    'settings.weatherCity.description': 'Ville, region ou pays a utiliser pour les previsions meteo.',
    'settings.weatherRefreshIntervalMinutes.title': 'Intervalle de rafraichissement meteo (minutes)',
    'settings.weatherRefreshIntervalMinutes.description': 'Frequence de rafraichissement automatique de la meteo.',
    'agenda.previousMonth': 'Mois précédent',
    'agenda.nextMonth': 'Mois suivant',
    'agenda.today': "Aujourd'hui",
    'agenda.calendar': 'Calendrier',
    'agenda.tasks': 'Tâches',
    'agenda.close': 'Fermer',
    'agenda.dayDetails': 'Détails du jour',
    'agenda.selectedDay': 'Jour sélectionné',
    'agenda.upcoming': 'À venir',
    'agenda.noData': 'Aucune donnée',
    'agenda.nothingUpcoming': 'Rien à venir',
    'agenda.syncIssue': 'Problème de synchronisation',
    'agenda.syncIssues': 'Problèmes de synchronisation',
    'agenda.week': 'Semaine',
    'agenda.more': 'de plus',
    'agenda.precipitation': 'Précipitations',
    'agenda.allDay': 'Toute la journée',
    'agenda.priority': 'Priorité',
    'agenda.scheduled': 'Planifié',
    'agenda.due': 'Échéance',
    'agenda.monthCalendar': 'Calendrier mensuel',
    'agenda.mode': "Mode de l'agenda",
     'agenda.refreshing': 'Actualisation',
     'agenda.weatherDetails': 'Détails météo',
     'agenda.resizeSidebarSections': 'Redimensionner les sections latérales',
     'command.openAgenda': 'Ouvrir Google Agenda',
     'command.refreshAgenda': 'Actualiser Google Agenda',
   },
   de: {
    'settings.feeds.title': 'Kalender-Feeds',
    'settings.feeds.description': 'JSON-Array von Feed-Objekten mit url, calendarName und optionaler color.',
    'settings.refreshIntervalMinutes.title': 'Aktualisierungsintervall (Minuten)',
    'settings.refreshIntervalMinutes.description': 'Wie oft Feeds automatisch aktualisiert werden sollen.',
    'settings.weatherCity.title': 'Wetterort',
    'settings.weatherCity.description': 'Stadt, Region oder Land fuer Wettervorhersagen.',
    'settings.weatherRefreshIntervalMinutes.title': 'Wetter-Aktualisierungsintervall (Minuten)',
    'settings.weatherRefreshIntervalMinutes.description': 'Wie oft das Wetter automatisch aktualisiert werden soll.',
    'agenda.previousMonth': 'Vorheriger Monat',
    'agenda.nextMonth': 'Nächster Monat',
    'agenda.today': 'Heute',
    'agenda.calendar': 'Kalender',
    'agenda.tasks': 'Aufgaben',
    'agenda.close': 'Schließen',
    'agenda.dayDetails': 'Tagesdetails',
    'agenda.selectedDay': 'Ausgewählter Tag',
    'agenda.upcoming': 'Bevorstehend',
    'agenda.noData': 'Keine Daten',
    'agenda.nothingUpcoming': 'Nichts bevorstehend',
    'agenda.syncIssue': 'Synchronisierungsproblem',
    'agenda.syncIssues': 'Synchronisierungsprobleme',
    'agenda.week': 'Woche',
    'agenda.more': 'mehr',
    'agenda.precipitation': 'Niederschlag',
    'agenda.allDay': 'Ganztägig',
    'agenda.priority': 'Priorität',
    'agenda.scheduled': 'Geplant',
    'agenda.due': 'Fällig',
    'agenda.monthCalendar': 'Monatskalender',
    'agenda.mode': 'Agenda-Modus',
     'agenda.refreshing': 'Aktualisierung',
     'agenda.weatherDetails': 'Wetterdetails',
     'agenda.resizeSidebarSections': 'Größe der Seitenleistenbereiche ändern',
     'command.openAgenda': 'Google Agenda oeffnen',
     'command.refreshAgenda': 'Google Agenda aktualisieren',
   },
   nl: {
    'settings.feeds.title': 'Kalenderfeeds',
    'settings.feeds.description': 'JSON-array met feedobjecten met url, calendarName en optionele color.',
    'settings.refreshIntervalMinutes.title': 'Verversingsinterval (minuten)',
    'settings.refreshIntervalMinutes.description': 'Hoe vaak feeds automatisch moeten verversen.',
    'settings.weatherCity.title': 'Weerlocatie',
    'settings.weatherCity.description': 'Stad, regio of land voor weersverwachtingen.',
    'settings.weatherRefreshIntervalMinutes.title': 'Weer verversingsinterval (minuten)',
    'settings.weatherRefreshIntervalMinutes.description': 'Hoe vaak het weer automatisch moet verversen.',
    'agenda.previousMonth': 'Vorige maand',
    'agenda.nextMonth': 'Volgende maand',
    'agenda.today': 'Vandaag',
    'agenda.calendar': 'Kalender',
    'agenda.tasks': 'Taken',
    'agenda.close': 'Sluiten',
    'agenda.dayDetails': 'Dagdetails',
    'agenda.selectedDay': 'Geselecteerde dag',
    'agenda.upcoming': 'Binnenkort',
    'agenda.noData': 'Geen gegevens',
    'agenda.nothingUpcoming': 'Niets binnenkort',
    'agenda.syncIssue': 'Synchronisatieprobleem',
    'agenda.syncIssues': 'Synchronisatieproblemen',
    'agenda.week': 'Week',
    'agenda.more': 'meer',
    'agenda.precipitation': 'Neerslag',
    'agenda.allDay': 'Hele dag',
    'agenda.priority': 'Prioriteit',
    'agenda.scheduled': 'Gepland',
    'agenda.due': 'Vervalt',
    'agenda.monthCalendar': 'Maandkalender',
    'agenda.mode': 'Agendaweergave',
     'agenda.refreshing': 'Verversen',
     'agenda.weatherDetails': 'Weerdetails',
     'agenda.resizeSidebarSections': 'Zijbalksecties vergroten of verkleinen',
     'command.openAgenda': 'Google Agenda openen',
     'command.refreshAgenda': 'Google Agenda vernieuwen',
   },
   'zh-Hans': {
    'settings.feeds.title': '日历订阅',
    'settings.feeds.description': '包含 url、calendarName 和可选 color 的订阅对象 JSON 数组。',
    'settings.refreshIntervalMinutes.title': '刷新间隔（分钟）',
    'settings.refreshIntervalMinutes.description': '自动刷新订阅的频率。',
    'settings.weatherCity.title': '天气城市',
    'settings.weatherCity.description': '用于天气预报的城市、地区或国家。',
    'settings.weatherRefreshIntervalMinutes.title': '天气刷新间隔（分钟）',
    'settings.weatherRefreshIntervalMinutes.description': '自动刷新天气的频率。',
    'agenda.previousMonth': '上个月',
    'agenda.nextMonth': '下个月',
    'agenda.today': '今天',
    'agenda.calendar': '日历',
    'agenda.tasks': '任务',
    'agenda.close': '关闭',
    'agenda.dayDetails': '日期详情',
    'agenda.selectedDay': '所选日期',
    'agenda.upcoming': '即将到来',
    'agenda.noData': '没有数据',
    'agenda.nothingUpcoming': '没有即将到来的内容',
    'agenda.syncIssue': '同步问题',
    'agenda.syncIssues': '同步问题',
    'agenda.week': '周',
    'agenda.more': '更多',
    'agenda.precipitation': '降水',
    'agenda.allDay': '全天',
    'agenda.priority': '优先级',
    'agenda.scheduled': '计划时间',
    'agenda.due': '截止时间',
    'agenda.monthCalendar': '月历',
    'agenda.mode': '议程模式',
     'agenda.refreshing': '刷新中',
     'agenda.weatherDetails': '天气详情',
     'agenda.resizeSidebarSections': '调整侧边栏分区大小',
     'command.openAgenda': '打开 Google Agenda',
     'command.refreshAgenda': '刷新 Google Agenda',
   },
   'zh-Hant': {
    'settings.feeds.title': '行事曆訂閱',
    'settings.feeds.description': '包含 url、calendarName 與選用 color 的訂閱物件 JSON 陣列。',
    'settings.refreshIntervalMinutes.title': '重新整理間隔（分鐘）',
    'settings.refreshIntervalMinutes.description': '自動重新整理訂閱的頻率。',
    'settings.weatherCity.title': '天氣城市',
    'settings.weatherCity.description': '用於天氣預報的城市、地區或國家。',
    'settings.weatherRefreshIntervalMinutes.title': '天氣重新整理間隔（分鐘）',
    'settings.weatherRefreshIntervalMinutes.description': '自動重新整理天氣的頻率。',
    'agenda.previousMonth': '上個月',
    'agenda.nextMonth': '下個月',
    'agenda.today': '今天',
    'agenda.calendar': '行事曆',
    'agenda.tasks': '任務',
    'agenda.close': '關閉',
    'agenda.dayDetails': '日期詳細資料',
    'agenda.selectedDay': '選取的日期',
    'agenda.upcoming': '即將到來',
    'agenda.noData': '沒有資料',
    'agenda.nothingUpcoming': '沒有即將到來的內容',
    'agenda.syncIssue': '同步問題',
    'agenda.syncIssues': '同步問題',
    'agenda.week': '週',
    'agenda.more': '更多',
    'agenda.precipitation': '降雨機率',
    'agenda.allDay': '全天',
    'agenda.priority': '優先順序',
    'agenda.scheduled': '排程',
    'agenda.due': '截止',
    'agenda.monthCalendar': '月曆',
    'agenda.mode': '議程模式',
     'agenda.refreshing': '重新整理中',
     'agenda.weatherDetails': '天氣詳細資料',
     'agenda.resizeSidebarSections': '調整側邊欄區塊大小',
     'command.openAgenda': '開啟 Google Agenda',
     'command.refreshAgenda': '重新整理 Google Agenda',
   },
  };

const WEATHER_CONDITION_TRANSLATIONS: Record<SupportedLocale, Record<WeatherConditionIconKey, string>> = {
  en: {
    sunny: 'Sunny',
    'partly-cloudy': 'Partly cloudy',
    cloudy: 'Cloudy',
    rain: 'Rain',
    snow: 'Snow',
    storm: 'Storm',
  },
  fr: {
    sunny: 'Ensoleillé',
    'partly-cloudy': 'Partiellement nuageux',
    cloudy: 'Nuageux',
    rain: 'Pluie',
    snow: 'Neige',
    storm: 'Orage',
  },
  de: {
    sunny: 'Sonnig',
    'partly-cloudy': 'Teilweise bewölkt',
    cloudy: 'Bewölkt',
    rain: 'Regen',
    snow: 'Schnee',
    storm: 'Sturm',
  },
  nl: {
    sunny: 'Zonnig',
    'partly-cloudy': 'Halfbewolkt',
    cloudy: 'Bewolkt',
    rain: 'Regen',
    snow: 'Sneeuw',
    storm: 'Onweer',
  },
  'zh-Hans': {
    sunny: '晴天',
    'partly-cloudy': '局部多云',
    cloudy: '多云',
    rain: '雨',
    snow: '雪',
    storm: '雷暴',
  },
  'zh-Hant': {
    sunny: '晴天',
    'partly-cloudy': '局部多雲',
    cloudy: '多雲',
    rain: '雨',
    snow: '雪',
    storm: '雷暴',
  },
};

function normalizeLocale(locale: string | null | undefined) {
  return (locale ?? '').trim().replace(/_/g, '-');
}

export function resolveSupportedLocale(locale: string | null | undefined): SupportedLocale {
  const normalized = normalizeLocale(locale);

  if (/^fr(?:-|$)/i.test(normalized)) {
    return 'fr';
  }

  if (/^de(?:-|$)/i.test(normalized)) {
    return 'de';
  }

  if (/^nl(?:-|$)/i.test(normalized)) {
    return 'nl';
  }

  if (/^zh(?:-Hant|-TW|-HK|-MO)/i.test(normalized)) {
    return 'zh-Hant';
  }

  if (/^zh(?:-Hans(?:-|$)|-CN(?:-|$)|-SG(?:-|$))/i.test(normalized)) {
    return 'zh-Hans';
  }

  return 'en';
}

export function createTranslator(locale?: string | null) {
  const messages = TRANSLATIONS[resolveSupportedLocale(locale)];

  return (key: TranslationKey): string => messages[key];
}

export function getFormattingLocale(locale?: string | null) {
  const normalized = normalizeLocale(locale);

  switch (resolveSupportedLocale(normalized)) {
    case 'fr':
      return 'fr-FR';
    case 'de':
      return 'de-DE';
    case 'nl':
      return 'nl-NL';
    case 'zh-Hans':
      return 'zh-CN';
    case 'zh-Hant':
      return 'zh-TW';
    default:
      return 'en-US';
  }
}

export function formatLocaleDate(
  locale: string | null | undefined,
  value: Date,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat(getFormattingLocale(locale), options).format(value);
}

export function getWeekdayLabels(locale?: string | null) {
  const formatter = new Intl.DateTimeFormat(getFormattingLocale(locale), {
    weekday: 'short',
    timeZone: 'UTC',
  });

  return Array.from({ length: 7 }, (_, index) => formatter.format(new Date(Date.UTC(2024, 0, 1 + index))));
}

export function getWeatherConditionLabel(
  locale: string | null | undefined,
  iconKey: string | null | undefined,
  fallbackLabel: string,
) {
  const supportedLocale = resolveSupportedLocale(locale);
  const translatedLabel = iconKey
    ? WEATHER_CONDITION_TRANSLATIONS[supportedLocale][iconKey as WeatherConditionIconKey]
    : undefined;

  return translatedLabel ?? fallbackLabel;
}
