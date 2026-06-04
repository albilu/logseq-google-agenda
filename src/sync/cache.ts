import type {
  AgendaTask,
  CalendarEvent,
  WeatherDay,
  WeatherLocation,
} from '../calendar/types';
import type { FeedError } from './ical';

export const SNAPSHOT_KEY = 'syncSnapshot';

export type Snapshot = {
  events: CalendarEvent[];
  tasks: AgendaTask[];
  weather: WeatherDay[];
  weatherLocation: WeatherLocation | null;
  errors: FeedError[];
  syncedAt: string;
};

type SnapshotStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

type SnapshotRecord = Record<string, unknown> & {
  events: unknown[];
  errors: unknown[];
  syncedAt: string;
  tasks?: unknown;
  weather?: unknown;
  weatherLocation?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCalendarEvent(value: unknown): value is CalendarEvent {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.sourceUrl === 'string' &&
    typeof value.calendarName === 'string' &&
    typeof value.title === 'string' &&
    typeof value.start === 'string' &&
    typeof value.end === 'string' &&
    typeof value.allDay === 'boolean' &&
    typeof value.location === 'string' &&
    typeof value.description === 'string'
  );
}

function isFeedError(value: unknown): value is FeedError {
  return (
    isRecord(value) &&
    typeof value.sourceUrl === 'string' &&
    typeof value.message === 'string'
  );
}

function isAgendaTask(value: unknown): value is AgendaTask {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.date === 'string' &&
    typeof value.marker === 'string' &&
    typeof value.pageName === 'string' &&
    typeof value.pageOriginalName === 'string' &&
    typeof value.blockUuid === 'string' &&
    typeof value.priority === 'string' &&
    typeof value.scheduled === 'string' &&
    typeof value.deadline === 'string'
  );
}

function isWeatherDay(value: unknown): value is WeatherDay {
  return (
    isRecord(value) &&
    typeof value.date === 'string' &&
    typeof value.temperatureMin === 'number' &&
    typeof value.temperatureMax === 'number' &&
    typeof value.temperatureDisplay === 'string' &&
    typeof value.conditionCode === 'number' &&
    typeof value.conditionLabel === 'string' &&
    typeof value.precipitationChance === 'number' &&
    typeof value.iconKey === 'string'
  );
}

function isWeatherLocation(value: unknown): value is WeatherLocation {
  return (
    isRecord(value) &&
    typeof value.query === 'string' &&
    typeof value.resolvedName === 'string' &&
    typeof value.latitude === 'number' &&
    typeof value.longitude === 'number'
  );
}

function isSnapshotBase(
  value: unknown,
): value is SnapshotRecord {
  return (
    isRecord(value) &&
    Array.isArray(value.events) &&
    value.events.every(isCalendarEvent) &&
    Array.isArray(value.errors) &&
    value.errors.every(isFeedError) &&
    typeof value.syncedAt === 'string'
  );
}

function isSnapshot(value: unknown): value is Snapshot {
  return (
    isSnapshotBase(value) &&
    Array.isArray(value.tasks) &&
    value.tasks.every(isAgendaTask) &&
    Array.isArray(value.weather) &&
    value.weather.every(isWeatherDay) &&
    (value.weatherLocation === null || isWeatherLocation(value.weatherLocation))
  );
}

type LegacySnapshot = Pick<Snapshot, 'events' | 'errors' | 'syncedAt'> & {
  tasks?: AgendaTask[];
};

function isLegacySnapshot(value: unknown): value is LegacySnapshot {
  return (
    isSnapshotBase(value) &&
    (!('tasks' in value) || (Array.isArray(value.tasks) && value.tasks.every(isAgendaTask))) &&
    !('weather' in value) &&
    !('weatherLocation' in value)
  );
}

export function loadSnapshot(storage: SnapshotStorage): Snapshot | null {
  try {
    const raw = storage.getItem(SNAPSHOT_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as unknown;

    if (isSnapshot(parsed)) {
      return parsed;
    }

    if (isLegacySnapshot(parsed)) {
      return {
        ...parsed,
        tasks: parsed.tasks ?? [],
        weather: [],
        weatherLocation: null,
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function saveSnapshot(storage: SnapshotStorage, snapshot: Snapshot): void {
  try {
    storage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore storage write failures and keep caching best-effort.
  }
}
