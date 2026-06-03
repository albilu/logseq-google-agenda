import { describe, expect, it } from 'vitest';

import { SETTINGS_SCHEMA, parseSettings, type PluginSettings } from './settings';

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
    ]);
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
    });

    expect(
      parseSettings({
        feeds: JSON.stringify([]),
        refreshIntervalMinutes: Number.NaN,
      }),
    ).toEqual<PluginSettings>({
      feeds: [],
      refreshIntervalMinutes: 15,
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
    });

    expect(
      parseSettings({
        feeds: JSON.stringify([]),
        refreshIntervalMinutes: '5',
      }),
    ).toEqual<PluginSettings>({
      feeds: [],
      refreshIntervalMinutes: 5,
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
    });
  });
});
