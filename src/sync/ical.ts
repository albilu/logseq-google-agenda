import ICAL from 'ical.js';

import type { CalendarEvent } from '../calendar/types';

export type FeedConfig = {
  url: string;
  calendarName: string;
  color?: string;
};

export type FeedError = {
  sourceUrl: string;
  message: string;
};

export type RefreshResult = {
  events: CalendarEvent[];
  errors: FeedError[];
  syncedAt: string;
};

const MAX_UNBOUNDED_RECURRING_OCCURRENCES = 365;

function formatDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function getNamedTimezone(value: ICAL.Time): string | null {
  if (!value) {
    return null;
  }

  const runtimeValue = value as ICAL.Time & { timezone?: string };

  return typeof runtimeValue.timezone === 'string' && runtimeValue.timezone.length > 0
    ? runtimeValue.timezone
    : null;
}

function withTimezoneContext(value: ICAL.Time, fallbackTimezone: string | null): ICAL.Time {
  if (getNamedTimezone(value) || !fallbackTimezone) {
    return value;
  }

  return Object.assign(Object.create(Object.getPrototypeOf(value)), value, {
    timezone: fallbackTimezone,
  }) as ICAL.Time;
}

function isFloatingTime(value: ICAL.Time, fallbackTimezone: string | null = null): boolean {
  return !value.isDate && value.zone?.tzid === 'floating' && !getNamedTimezone(withTimezoneContext(value, fallbackTimezone));
}

function isFiniteRecurRule(value: unknown): value is { count?: number | null; until?: unknown } {
  return typeof value === 'object' && value !== null && ('count' in value || 'until' in value);
}

function isCancelledComponent(component: ICAL.Component): boolean {
  return component.getFirstPropertyValue('status') === 'CANCELLED';
}

function getRecurringMasterUids(components: ICAL.Component[]): Set<string> {
  return new Set(
    components
      .filter(
        (component) =>
          component.name === 'vevent' &&
          (component.hasProperty('rrule') || component.hasProperty('rdate')),
      )
      .map((component) => component.getFirstPropertyValue('uid'))
      .filter((uid): uid is string => typeof uid === 'string' && uid.length > 0),
  );
}

function getMasterTimezones(components: ICAL.Component[]): Map<string, string | null> {
  return new Map(
    components
      .filter((entry) => entry.name === 'vevent' && !entry.hasProperty('recurrence-id'))
      .map((entry) => {
        const event = new ICAL.Event(entry);
        return [event.uid, getNamedTimezone(event.startDate)] as const;
      })
      .filter(([uid]) => typeof uid === 'string' && uid.length > 0),
  );
}

function getCancelledRecurrences(components: ICAL.Component[]): {
  exact: Set<string>;
  thisAndFuture: Map<string, string[]>;
} {
  const masterTimezones = getMasterTimezones(components);
  const exact = new Set<string>();
  const thisAndFuture = new Map<string, string[]>();

  components
    .filter(
      (entry) =>
        entry.name === 'vevent' &&
        entry.hasProperty('recurrence-id') &&
        isCancelledComponent(entry),
    )
    .forEach((entry) => {
      const uid = entry.getFirstPropertyValue('uid');
      const recurrenceId = entry.getFirstPropertyValue('recurrence-id') as ICAL.Time;

      if (typeof uid !== 'string' || uid.length === 0 || !recurrenceId) {
        return;
      }

      const masterTimezone = masterTimezones.get(uid) ?? null;
      const normalizedRecurrenceId = normalizeDate(recurrenceId, masterTimezone);
      const recurrenceProperty = entry.getFirstProperty('recurrence-id');
      const range = recurrenceProperty?.getParameter('range');

      if (typeof range === 'string' && range.toUpperCase() === 'THISANDFUTURE') {
        const existing = thisAndFuture.get(uid) ?? [];
        existing.push(normalizedRecurrenceId);
        thisAndFuture.set(uid, existing);
        return;
      }

      exact.add(`${uid}:${normalizedRecurrenceId}`);
    });

  return { exact, thisAndFuture };
}

function getOccurrences(event: ICAL.Event): ICAL.Time[] {
  if (!event.isRecurring()) {
    if (!event.startDate) {
      return [];
    }

    return [event.startDate];
  }

  const iterator = event.iterator();
  const occurrences: ICAL.Time[] = [];
  const rule = event.component.getFirstPropertyValue('rrule');
  const shouldIncludeBaseStart = event.component.hasProperty('rdate') && !event.component.hasProperty('rrule');

  const normalizedLimit = isFiniteRecurRule(rule) && (rule.count || rule.until)
    ? Number.POSITIVE_INFINITY
    : MAX_UNBOUNDED_RECURRING_OCCURRENCES;

  if (shouldIncludeBaseStart) {
    occurrences.push(event.startDate);
  }

  for (let index = 0; index < normalizedLimit; index += 1) {
    const occurrence = iterator.next();

    if (!occurrence) {
      break;
    }

    occurrences.push(occurrence);
  }

  const seen = new Set<string>();

  return occurrences.filter((occurrence) => {
    const key = normalizeDate(occurrence);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function getFormatterParts(date: Date, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
}

function normalizeFloatingDate(value: ICAL.Time): string {
  return `${value.year}-${formatDatePart(value.month)}-${formatDatePart(value.day)}T${formatDatePart(value.hour)}:${formatDatePart(value.minute)}:${formatDatePart(value.second)}.000`;
}

function normalizeZonedDate(value: ICAL.Time, fallbackTimezone: string | null = null): string {
  const normalizedValue = withTimezoneContext(value, fallbackTimezone);
  const timeZone = getNamedTimezone(normalizedValue);

  if (!timeZone) {
    return normalizedValue.toJSDate().toISOString();
  }

  const targetTime = Date.UTC(
    normalizedValue.year,
    normalizedValue.month - 1,
    normalizedValue.day,
    normalizedValue.hour,
    normalizedValue.minute,
    normalizedValue.second,
  );
  let instant = targetTime;

  try {
    for (let index = 0; index < 3; index += 1) {
      const parts = getFormatterParts(new Date(instant), timeZone);
      const zonedTime = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
        Number(parts.second),
      );
      const offset = zonedTime - instant;
      const nextInstant = targetTime - offset;

      if (nextInstant === instant) {
        break;
      }

      instant = nextInstant;
    }
  } catch {
    return normalizeFloatingDate(normalizedValue);
  }

  return new Date(instant).toISOString();
}

function normalizeDate(value: ICAL.Time, fallbackTimezone: string | null = null): string {
  const normalizedValue = withTimezoneContext(value, fallbackTimezone);

  if (isFloatingTime(normalizedValue, fallbackTimezone)) {
    return normalizeFloatingDate(normalizedValue);
  }

  if (getNamedTimezone(normalizedValue)) {
    return normalizeZonedDate(normalizedValue, fallbackTimezone);
  }

  return normalizedValue.isDate ? normalizedValue.toString() : normalizedValue.toJSDate().toISOString();
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unknown feed error';
}

export function parseIcalText(text: string, feed: FeedConfig): CalendarEvent[] {
  const calendar = new ICAL.Component(ICAL.parse(text));
  const components = calendar.getAllSubcomponents('vevent');
  const recurringMasterUids = getRecurringMasterUids(components);
  const cancelledRecurrences = getCancelledRecurrences(components);

  return components.flatMap((component) => {
    const uid = component.getFirstPropertyValue('uid');

    if (component.hasProperty('recurrence-id') && typeof uid === 'string' && recurringMasterUids.has(uid)) {
      return [];
    }

    if (isCancelledComponent(component)) {
      return [];
    }

    const event = new ICAL.Event(component);
    const occurrences = getOccurrences(event);
    const masterTimezone = getNamedTimezone(event.startDate);

    return occurrences.flatMap((occurrence) => {
      const recurrenceIdentity = normalizeDate(occurrence, masterTimezone);
      const recurrenceKey = `${event.uid}:${recurrenceIdentity}`;

      if (cancelledRecurrences.exact.has(recurrenceKey)) {
        return [];
      }

      const cancelledRangeStarts = cancelledRecurrences.thisAndFuture.get(event.uid) ?? [];

      if (cancelledRangeStarts.some((rangeStart) => recurrenceIdentity >= rangeStart)) {
        return [];
      }

      const details = event.isRecurring() ? event.getOccurrenceDetails(occurrence) : null;
      const metadataEvent = details?.item || event;
      const metadataComponent = details?.item?.component || component;

      if (isCancelledComponent(metadataComponent)) {
        return [];
      }

      const startDate = details?.startDate || event.startDate;
      const endDate = details?.endDate || event.endDate;

      if (!startDate || !endDate) {
        return [];
      }

      const start = normalizeDate(startDate, masterTimezone);
      const recurrenceId = component.hasProperty('recurrence-id')
        ? normalizeDate(component.getFirstPropertyValue('recurrence-id') as ICAL.Time)
        : null;
      const recurringIdentity = event.isRecurring() ? recurrenceIdentity : null;

      return {
        id: recurrenceId
          ? `${event.uid || `${feed.url}:${event.summary || ''}`}:${recurrenceId}`
          : recurringIdentity
          ? `${event.uid || `${feed.url}:${event.summary || ''}`}:${recurringIdentity}`
          : event.uid || `${feed.url}:${start}:${event.summary || ''}`,
        sourceUrl: feed.url,
        calendarName: feed.calendarName,
        title: metadataEvent.summary ?? event.summary ?? '',
        start,
        end: normalizeDate(endDate, masterTimezone),
        allDay: Boolean(startDate.isDate),
        location: metadataEvent.location ?? event.location ?? '',
        description: metadataEvent.description ?? event.description ?? '',
      } satisfies CalendarEvent;
    });
  });
}

export async function refreshFeeds(
  feeds: FeedConfig[],
  fetchImpl: typeof fetch = fetch,
): Promise<RefreshResult> {
  const results = await Promise.all(
    feeds.map(async (feed) => {
      try {
        console.log('[logseq-google-agenda] Fetching feed', {
          url: feed.url,
          calendarName: feed.calendarName,
        });
        const response = await fetchImpl(feed.url);

        console.log('[logseq-google-agenda] Feed fetched', {
          url: feed.url,
          calendarName: feed.calendarName,
          status: response.status,
          ok: response.ok,
        });

        if (!response.ok) {
          throw new Error(response.statusText || `HTTP ${response.status}`);
        }

        const text = await response.text();
        const events = parseIcalText(text, feed);

        console.log('[logseq-google-agenda] Feed parsed', {
          url: feed.url,
          calendarName: feed.calendarName,
          eventCount: events.length,
        });

        return {
          events,
          error: null,
        };
      } catch (error) {
        return {
          events: [] as CalendarEvent[],
          error: {
            sourceUrl: feed.url,
            message: toErrorMessage(error),
          } satisfies FeedError,
        };
      }
    }),
  );

  const snapshot = {
    events: results.flatMap((result) => result.events),
    errors: results.flatMap((result) => (result.error ? [result.error] : [])),
    syncedAt: new Date().toISOString(),
  };

  console.log('[logseq-google-agenda] Refresh feeds completed', {
    feedCount: feeds.length,
    eventCount: snapshot.events.length,
    errorCount: snapshot.errors.length,
    syncedAt: snapshot.syncedAt,
  });

  return snapshot;
}
