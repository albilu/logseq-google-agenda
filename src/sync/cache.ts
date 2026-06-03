import type { AgendaTask, CalendarEvent } from '../calendar/types';
import type { FeedError } from './ical';

export const SNAPSHOT_KEY = 'syncSnapshot';

export type Snapshot = {
  events: CalendarEvent[];
  tasks: AgendaTask[];
  errors: FeedError[];
  syncedAt: string;
};

type SnapshotStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
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

function isSnapshot(value: unknown): value is Snapshot {
  return (
    isRecord(value) &&
    Array.isArray((value as Snapshot).events) &&
    (value as Snapshot).events.every(isCalendarEvent) &&
    Array.isArray((value as Snapshot).tasks) &&
    (value as Snapshot).tasks.every(isAgendaTask) &&
    Array.isArray((value as Snapshot).errors) &&
    (value as Snapshot).errors.every(isFeedError) &&
    typeof (value as Snapshot).syncedAt === 'string'
  );
}

type LegacySnapshot = Omit<Snapshot, 'tasks'>;

function isLegacySnapshot(value: unknown): value is LegacySnapshot {
  return (
    isRecord(value) &&
    !('tasks' in value) &&
    Array.isArray((value as LegacySnapshot).events) &&
    (value as LegacySnapshot).events.every(isCalendarEvent) &&
    Array.isArray((value as LegacySnapshot).errors) &&
    (value as LegacySnapshot).errors.every(isFeedError) &&
    typeof (value as LegacySnapshot).syncedAt === 'string'
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
        tasks: [],
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
