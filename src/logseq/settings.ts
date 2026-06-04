import type { FeedConfig } from '../sync/ical';
import { createTranslator } from '../i18n';

const DEFAULT_FEEDS_JSON = '[]';
const DEFAULT_REFRESH_INTERVAL_MINUTES = 15;
const DEFAULT_WEATHER_REFRESH_INTERVAL_MINUTES = 60;

export function getSettingsSchema(locale?: string) {
  const t = createTranslator(locale);

  return [
    {
      key: 'feeds',
      type: 'string',
      title: t('settings.feeds.title'),
      description: t('settings.feeds.description'),
      default: DEFAULT_FEEDS_JSON,
    },
    {
      key: 'refreshIntervalMinutes',
      type: 'number',
      title: t('settings.refreshIntervalMinutes.title'),
      description: t('settings.refreshIntervalMinutes.description'),
      default: DEFAULT_REFRESH_INTERVAL_MINUTES,
    },
    {
      key: 'weatherCity',
      type: 'string',
      title: t('settings.weatherCity.title'),
      description: t('settings.weatherCity.description'),
      default: '',
    },
    {
      key: 'weatherRefreshIntervalMinutes',
      type: 'number',
      title: t('settings.weatherRefreshIntervalMinutes.title'),
      description: t('settings.weatherRefreshIntervalMinutes.description'),
      default: DEFAULT_WEATHER_REFRESH_INTERVAL_MINUTES,
    },
  ] as const;
}

export const SETTINGS_SCHEMA = getSettingsSchema('en-US');

export type PluginSettings = {
  feeds: FeedConfig[];
  refreshIntervalMinutes: number;
  weatherCity: string;
  weatherRefreshIntervalMinutes: number;
};

type RawSettings = {
  feeds?: unknown;
  refreshIntervalMinutes?: unknown;
  weatherCity?: unknown;
  weatherRefreshIntervalMinutes?: unknown;
};

function isFeedRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeFeeds(parsed: unknown): FeedConfig[] {
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.flatMap((entry) => {
    if (!isFeedRecord(entry)) {
      return [];
    }

    const url = trimString(entry.url);

    if (!url) {
      return [];
    }

    const calendarName = trimString(entry.calendarName);
    const color = trimString(entry.color);

    return [
      {
        url,
        calendarName,
        ...(color ? { color } : {}),
      },
    ];
  });
}

function parseFeeds(rawFeeds: unknown): FeedConfig[] {
  if (Array.isArray(rawFeeds)) {
    return normalizeFeeds(rawFeeds);
  }

  if (typeof rawFeeds !== 'string') {
    return [];
  }

  try {
    return normalizeFeeds(JSON.parse(rawFeeds) as unknown);
  } catch {
    return [];
  }
}

function parseRefreshInterval(value: unknown): number {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return DEFAULT_REFRESH_INTERVAL_MINUTES;
  }

  const num = typeof value === 'number' ? value : Number(value);

  return Number.isFinite(num) && num > 0 ? num : DEFAULT_REFRESH_INTERVAL_MINUTES;
}

function parseWeatherRefreshInterval(value: unknown): number {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return DEFAULT_WEATHER_REFRESH_INTERVAL_MINUTES;
  }

  const num = typeof value === 'number' ? value : Number(value);

  return Number.isFinite(num) && num > 0 ? num : DEFAULT_WEATHER_REFRESH_INTERVAL_MINUTES;
}

export function parseSettings(raw: RawSettings): PluginSettings {
  return {
    feeds: parseFeeds(raw.feeds ?? DEFAULT_FEEDS_JSON),
    refreshIntervalMinutes: parseRefreshInterval(raw.refreshIntervalMinutes),
    weatherCity: trimString(raw.weatherCity),
    weatherRefreshIntervalMinutes: parseWeatherRefreshInterval(raw.weatherRefreshIntervalMinutes),
  };
}
