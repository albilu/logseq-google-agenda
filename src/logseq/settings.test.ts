import { describe, expect, it } from 'vitest';

import { resolveSupportedLocale } from '../i18n';
import { SETTINGS_SCHEMA, getSettingsSchema, parseSettings, type PluginSettings } from './settings';

describe('SETTINGS_SCHEMA', () => {
  it('defines the plugin settings fields', () => {
    expect(SETTINGS_SCHEMA).toEqual([
      {
        key: 'feeds',
        type: 'string',
        title: 'Calendar feeds',
        description: 'JSON array of feed objects with url, calendarName, and optional color.',
        default: '[]',
      },
      {
        key: 'refreshIntervalMinutes',
        type: 'number',
        title: 'Refresh interval (minutes)',
        description: 'How often feeds should refresh automatically.',
        default: 15,
      },
      {
        key: 'weatherCity',
        type: 'string',
        title: 'Weather city',
        description: 'City, region, or country to use for weather forecasts.',
        default: '',
      },
      {
        key: 'weatherRefreshIntervalMinutes',
        type: 'number',
        title: 'Weather refresh interval (minutes)',
        description: 'How often weather should refresh automatically.',
        default: 60,
      },
    ]);
  });
});

describe('getSettingsSchema', () => {
  it('returns French settings copy for fr locales', () => {
    expect(getSettingsSchema('fr-FR')).toEqual([
      {
        key: 'feeds',
        type: 'string',
        title: 'Flux de calendrier',
        description: "Tableau JSON d'objets de flux avec url, calendarName et color facultatif.",
        default: '[]',
      },
      {
        key: 'refreshIntervalMinutes',
        type: 'number',
        title: 'Intervalle de rafraichissement (minutes)',
        description: 'Frequence de rafraichissement automatique des flux.',
        default: 15,
      },
      {
        key: 'weatherCity',
        type: 'string',
        title: 'Ville meteo',
        description: 'Ville, region ou pays a utiliser pour les previsions meteo.',
        default: '',
      },
      {
        key: 'weatherRefreshIntervalMinutes',
        type: 'number',
        title: 'Intervalle de rafraichissement meteo (minutes)',
        description: 'Frequence de rafraichissement automatique de la meteo.',
        default: 60,
      },
    ]);
  });

  it('returns German settings copy for de locales', () => {
    expect(getSettingsSchema('de-DE')).toEqual([
      {
        key: 'feeds',
        type: 'string',
        title: 'Kalender-Feeds',
        description: 'JSON-Array von Feed-Objekten mit url, calendarName und optionaler color.',
        default: '[]',
      },
      {
        key: 'refreshIntervalMinutes',
        type: 'number',
        title: 'Aktualisierungsintervall (Minuten)',
        description: 'Wie oft Feeds automatisch aktualisiert werden sollen.',
        default: 15,
      },
      {
        key: 'weatherCity',
        type: 'string',
        title: 'Wetterort',
        description: 'Stadt, Region oder Land fuer Wettervorhersagen.',
        default: '',
      },
      {
        key: 'weatherRefreshIntervalMinutes',
        type: 'number',
        title: 'Wetter-Aktualisierungsintervall (Minuten)',
        description: 'Wie oft das Wetter automatisch aktualisiert werden soll.',
        default: 60,
      },
    ]);
  });

  it('returns Dutch settings copy for nl locales', () => {
    expect(getSettingsSchema('nl-NL')).toEqual([
      {
        key: 'feeds',
        type: 'string',
        title: 'Kalenderfeeds',
        description: 'JSON-array met feedobjecten met url, calendarName en optionele color.',
        default: '[]',
      },
      {
        key: 'refreshIntervalMinutes',
        type: 'number',
        title: 'Verversingsinterval (minuten)',
        description: 'Hoe vaak feeds automatisch moeten verversen.',
        default: 15,
      },
      {
        key: 'weatherCity',
        type: 'string',
        title: 'Weerlocatie',
        description: 'Stad, regio of land voor weersverwachtingen.',
        default: '',
      },
      {
        key: 'weatherRefreshIntervalMinutes',
        type: 'number',
        title: 'Weer verversingsinterval (minuten)',
        description: 'Hoe vaak het weer automatisch moet verversen.',
        default: 60,
      },
    ]);
  });

  it('falls back to English settings copy for unsupported locales', () => {
    expect(getSettingsSchema('es-ES')).toEqual(SETTINGS_SCHEMA);
  });

  it('supports underscore locale variants in schema generation', () => {
    expect(getSettingsSchema('de_DE')[2]?.title).toBe('Wetterort');
    expect(getSettingsSchema('nl_NL')[2]?.title).toBe('Weerlocatie');
    expect(getSettingsSchema('zh_TW')[0]?.title).toBe('行事曆訂閱');
  });

  it('maps Simplified and Traditional Chinese locales separately', () => {
    expect(getSettingsSchema('zh-CN')[0]?.title).toBe('日历订阅');
    expect(getSettingsSchema('zh-TW')[0]?.title).toBe('行事曆訂閱');
  });
});

describe('resolveSupportedLocale', () => {
  it('maps the required locale matrix to supported locales', () => {
    expect(resolveSupportedLocale('de')).toBe('de');
    expect(resolveSupportedLocale('nl')).toBe('nl');
    expect(resolveSupportedLocale('zh-SG')).toBe('zh-Hans');
    expect(resolveSupportedLocale('zh-HK')).toBe('zh-Hant');
    expect(resolveSupportedLocale('zh-MO')).toBe('zh-Hant');
    expect(resolveSupportedLocale('zh-Hans')).toBe('zh-Hans');
    expect(resolveSupportedLocale('zh-Hant')).toBe('zh-Hant');
  });

  it('normalizes underscore locale tags', () => {
    expect(resolveSupportedLocale('de_DE')).toBe('de');
    expect(resolveSupportedLocale('nl_NL')).toBe('nl');
    expect(resolveSupportedLocale('zh_TW')).toBe('zh-Hant');
  });
});

describe('parseSettings', () => {
  it('accepts feeds provided as an already-parsed array', () => {
    expect(
      parseSettings({
        feeds: [
          {
            url: ' https://calendar.google.com/calendar/ical/albilu4%40gmail.com/public/basic.ics ',
            calendarName: ' Team ',
            color: ' #3b82f6 ',
          },
        ],
        refreshIntervalMinutes: 15,
      }),
    ).toEqual<PluginSettings>({
      feeds: [
        {
          url: 'https://calendar.google.com/calendar/ical/albilu4%40gmail.com/public/basic.ics',
          calendarName: 'Team',
          color: '#3b82f6',
        },
      ],
      refreshIntervalMinutes: 15,
      weatherCity: '',
      weatherRefreshIntervalMinutes: 60,
    });
  });

  it('parses valid feed JSON, trims string values, and ignores blank urls', () => {
    const settings = parseSettings({
      feeds: JSON.stringify([
        {
          url: ' https://example.com/engineering.ics ',
          calendarName: ' Engineering ',
          color: ' #33aaff ',
        },
        {
          url: '   ',
          calendarName: 'Ignored',
          color: '#000000',
        },
        {
          url: ' https://example.com/product.ics ',
          calendarName: '   ',
        },
      ]),
      refreshIntervalMinutes: 30,
    });

    expect(settings).toEqual<PluginSettings>({
      feeds: [
        {
          url: 'https://example.com/engineering.ics',
          calendarName: 'Engineering',
          color: '#33aaff',
        },
        {
          url: 'https://example.com/product.ics',
          calendarName: '',
        },
      ],
      refreshIntervalMinutes: 30,
      weatherCity: '',
      weatherRefreshIntervalMinutes: 60,
    });
  });

  it('falls back safely when feed json is invalid', () => {
    expect(
      parseSettings({
        feeds: '{not valid json}',
        refreshIntervalMinutes: 20,
      }),
    ).toEqual<PluginSettings>({
      feeds: [],
      refreshIntervalMinutes: 20,
      weatherCity: '',
      weatherRefreshIntervalMinutes: 60,
    });
  });

  it('falls back to the default refresh interval when the value is invalid', () => {
    expect(
      parseSettings({
        feeds: JSON.stringify([]),
        refreshIntervalMinutes: 0,
      }),
    ).toEqual<PluginSettings>({
      feeds: [],
      refreshIntervalMinutes: 15,
      weatherCity: '',
      weatherRefreshIntervalMinutes: 60,
    });

    expect(
      parseSettings({
        feeds: JSON.stringify([]),
        refreshIntervalMinutes: Number.NaN,
      }),
    ).toEqual<PluginSettings>({
      feeds: [],
      refreshIntervalMinutes: 15,
      weatherCity: '',
      weatherRefreshIntervalMinutes: 60,
    });
  });

  it('accepts refreshIntervalMinutes as a string from Logseq settings', () => {
    expect(
      parseSettings({
        feeds: JSON.stringify([]),
        refreshIntervalMinutes: '30',
      }),
    ).toEqual<PluginSettings>({
      feeds: [],
      refreshIntervalMinutes: 30,
      weatherCity: '',
      weatherRefreshIntervalMinutes: 60,
    });

    expect(
      parseSettings({
        feeds: JSON.stringify([]),
        refreshIntervalMinutes: '5',
      }),
    ).toEqual<PluginSettings>({
      feeds: [],
      refreshIntervalMinutes: 5,
      weatherCity: '',
      weatherRefreshIntervalMinutes: 60,
    });
  });

  it('falls back to default when refreshIntervalMinutes is a non-numeric string', () => {
    expect(
      parseSettings({
        feeds: JSON.stringify([]),
        refreshIntervalMinutes: 'abc',
      }),
    ).toEqual<PluginSettings>({
      feeds: [],
      refreshIntervalMinutes: 15,
      weatherCity: '',
      weatherRefreshIntervalMinutes: 60,
    });
  });

  it('falls back to default when refreshIntervalMinutes is a non-string, non-number value', () => {
    expect(
      parseSettings({
        feeds: JSON.stringify([]),
        refreshIntervalMinutes: true,
      }),
    ).toEqual<PluginSettings>({
      feeds: [],
      refreshIntervalMinutes: 15,
      weatherCity: '',
      weatherRefreshIntervalMinutes: 60,
    });

    expect(
      parseSettings({
        feeds: JSON.stringify([]),
        refreshIntervalMinutes: [30],
      }),
    ).toEqual<PluginSettings>({
      feeds: [],
      refreshIntervalMinutes: 15,
      weatherCity: '',
      weatherRefreshIntervalMinutes: 60,
    });

    expect(
      parseSettings({
        feeds: JSON.stringify([]),
        refreshIntervalMinutes: { value: 30 },
      }),
    ).toEqual<PluginSettings>({
      feeds: [],
      refreshIntervalMinutes: 15,
      weatherCity: '',
      weatherRefreshIntervalMinutes: 60,
    });
  });

  it('parses weather settings independently from agenda refresh settings', () => {
    expect(
      parseSettings({
        feeds: JSON.stringify([]),
        refreshIntervalMinutes: 30,
        weatherCity: '  Paris, FR  ',
        weatherRefreshIntervalMinutes: '90',
      }),
    ).toEqual<PluginSettings>({
      feeds: [],
      refreshIntervalMinutes: 30,
      weatherCity: 'Paris, FR',
      weatherRefreshIntervalMinutes: 90,
    });
  });

  it('preserves a blank weather city after trimming and falls back when the weather refresh interval is invalid', () => {
    expect(
      parseSettings({
        feeds: JSON.stringify([]),
        refreshIntervalMinutes: 15,
        weatherCity: '   ',
        weatherRefreshIntervalMinutes: 0,
      }),
    ).toEqual<PluginSettings>({
      feeds: [],
      refreshIntervalMinutes: 15,
      weatherCity: '',
      weatherRefreshIntervalMinutes: 60,
    });

    expect(
      parseSettings({
        feeds: JSON.stringify([]),
        refreshIntervalMinutes: 15,
        weatherCity: 42,
        weatherRefreshIntervalMinutes: 'abc',
      }),
    ).toEqual<PluginSettings>({
      feeds: [],
      refreshIntervalMinutes: 15,
      weatherCity: '',
      weatherRefreshIntervalMinutes: 60,
    });
  });

  it('falls back when weatherRefreshIntervalMinutes is a non-string, non-number value', () => {
    expect(
      parseSettings({
        feeds: JSON.stringify([]),
        refreshIntervalMinutes: 15,
        weatherRefreshIntervalMinutes: true,
      }),
    ).toEqual<PluginSettings>({
      feeds: [],
      refreshIntervalMinutes: 15,
      weatherCity: '',
      weatherRefreshIntervalMinutes: 60,
    });

    expect(
      parseSettings({
        feeds: JSON.stringify([]),
        refreshIntervalMinutes: 15,
        weatherRefreshIntervalMinutes: [30],
      }),
    ).toEqual<PluginSettings>({
      feeds: [],
      refreshIntervalMinutes: 15,
      weatherCity: '',
      weatherRefreshIntervalMinutes: 60,
    });

    expect(
      parseSettings({
        feeds: JSON.stringify([]),
        refreshIntervalMinutes: 15,
        weatherRefreshIntervalMinutes: { value: 30 },
      }),
    ).toEqual<PluginSettings>({
      feeds: [],
      refreshIntervalMinutes: 15,
      weatherCity: '',
      weatherRefreshIntervalMinutes: 60,
    });
  });
});
