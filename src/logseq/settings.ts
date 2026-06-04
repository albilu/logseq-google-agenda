import type { FeedConfig } from '../sync/ical';

const DEFAULT_FEEDS_JSON = '[]';
const DEFAULT_REFRESH_INTERVAL_MINUTES = 15;
const DEFAULT_WEATHER_REFRESH_INTERVAL_MINUTES = 60;

export const SETTINGS_SCHEMA = [
  {
    key: 'feeds',
    type: 'string',
    title: 'Calendar feeds',
    description: 'JSON array of feed objects with url, calendarName, and optional color.',
    default: DEFAULT_FEEDS_JSON,
  },
  {
    key: 'refreshIntervalMinutes',
    type: 'number',
    title: 'Refresh interval (minutes)',
    description: 'How often feeds should refresh automatically.',
    default: DEFAULT_REFRESH_INTERVAL_MINUTES,
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
    default: DEFAULT_WEATHER_REFRESH_INTERVAL_MINUTES,
  },
] as const;

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
