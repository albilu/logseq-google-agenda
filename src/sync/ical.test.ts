import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CalendarEvent } from '../calendar/types';
import type { FeedConfig } from './ical';
import { parseIcalText, refreshFeeds } from './ical';

const timedFeed: FeedConfig = {
  url: 'https://example.com/engineering.ics',
  calendarName: 'Engineering',
  color: '#33aaff',
};

function createResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar',
    },
    ...init,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseIcalText', () => {
  it('parses timed VEVENT entries into normalized calendar events', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:event-1@example.com',
      'DTSTAMP:20240501T120000Z',
      'DTSTART:20240506T090000Z',
      'DTEND:20240506T100000Z',
      'SUMMARY:Planning',
      'LOCATION:Room 1',
      'DESCRIPTION:Discuss roadmap',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(parseIcalText(text, timedFeed)).toEqual<CalendarEvent[]>([
      {
        id: 'event-1@example.com',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Planning',
        start: '2024-05-06T09:00:00.000Z',
        end: '2024-05-06T10:00:00.000Z',
        allDay: false,
        location: 'Room 1',
        description: 'Discuss roadmap',
      },
    ]);
  });

  it('preserves floating timed VEVENT wall-clock datetimes', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:floating-event@example.com',
      'DTSTAMP:20240501T120000Z',
      'DTSTART:20240506T090000',
      'DTEND:20240506T103000',
      'SUMMARY:Office hours',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(parseIcalText(text, timedFeed)).toEqual<CalendarEvent[]>([
      {
        id: 'floating-event@example.com',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Office hours',
        start: '2024-05-06T09:00:00.000',
        end: '2024-05-06T10:30:00.000',
        allDay: false,
        location: '',
        description: '',
      },
    ]);
  });

  it('normalizes all-day VEVENT entries and defaults optional fields to empty strings', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:holiday@example.com',
      'DTSTAMP:20240501T120000Z',
      'DTSTART;VALUE=DATE:20240506',
      'DTEND;VALUE=DATE:20240507',
      'SUMMARY:Holiday',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(parseIcalText(text, timedFeed)).toEqual<CalendarEvent[]>([
      {
        id: 'holiday@example.com',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Holiday',
        start: '2024-05-06',
        end: '2024-05-07',
        allDay: true,
        location: '',
        description: '',
      },
    ]);
  });

  it('expands recurring VEVENT entries into one event per occurrence', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:daily-standup@example.com',
      'DTSTAMP:20240501T120000Z',
      'DTSTART:20240506T090000Z',
      'DTEND:20240506T093000Z',
      'RRULE:FREQ=DAILY;COUNT=3',
      'SUMMARY:Daily standup',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(parseIcalText(text, timedFeed)).toEqual<CalendarEvent[]>([
      {
        id: 'daily-standup@example.com:2024-05-06T09:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Daily standup',
        start: '2024-05-06T09:00:00.000Z',
        end: '2024-05-06T09:30:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
      {
        id: 'daily-standup@example.com:2024-05-07T09:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Daily standup',
        start: '2024-05-07T09:00:00.000Z',
        end: '2024-05-07T09:30:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
      {
        id: 'daily-standup@example.com:2024-05-08T09:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Daily standup',
        start: '2024-05-08T09:00:00.000Z',
        end: '2024-05-08T09:30:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
    ]);
  });

  it('emits an overridden recurring occurrence only once', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:daily-standup@example.com',
      'DTSTAMP:20240501T120000Z',
      'DTSTART:20240506T090000Z',
      'DTEND:20240506T093000Z',
      'RRULE:FREQ=DAILY;COUNT=3',
      'SUMMARY:Daily standup',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:daily-standup@example.com',
      'RECURRENCE-ID:20240507T090000Z',
      'DTSTAMP:20240501T120000Z',
      'DTSTART:20240507T110000Z',
      'DTEND:20240507T113000Z',
      'SUMMARY:Shifted standup',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(parseIcalText(text, timedFeed)).toEqual<CalendarEvent[]>([
      {
        id: 'daily-standup@example.com:2024-05-06T09:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Daily standup',
        start: '2024-05-06T09:00:00.000Z',
        end: '2024-05-06T09:30:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
      {
        id: 'daily-standup@example.com:2024-05-07T09:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Shifted standup',
        start: '2024-05-07T11:00:00.000Z',
        end: '2024-05-07T11:30:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
      {
        id: 'daily-standup@example.com:2024-05-08T09:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Daily standup',
        start: '2024-05-08T09:00:00.000Z',
        end: '2024-05-08T09:30:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
    ]);
  });

  it('preserves overridden occurrence metadata from recurrence exceptions', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:client-sync@example.com',
      'DTSTAMP:20240501T120000Z',
      'DTSTART:20240506T140000Z',
      'DTEND:20240506T150000Z',
      'RRULE:FREQ=DAILY;COUNT=2',
      'SUMMARY:Client sync',
      'LOCATION:Room 1',
      'DESCRIPTION:Regular sync',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:client-sync@example.com',
      'RECURRENCE-ID:20240507T140000Z',
      'DTSTAMP:20240501T120000Z',
      'DTSTART:20240507T160000Z',
      'DTEND:20240507T170000Z',
      'SUMMARY:Client onsite',
      'LOCATION:HQ',
      'DESCRIPTION:Bring slides',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(parseIcalText(text, timedFeed)).toEqual<CalendarEvent[]>([
      {
        id: 'client-sync@example.com:2024-05-06T14:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Client sync',
        start: '2024-05-06T14:00:00.000Z',
        end: '2024-05-06T15:00:00.000Z',
        allDay: false,
        location: 'Room 1',
        description: 'Regular sync',
      },
      {
        id: 'client-sync@example.com:2024-05-07T14:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Client onsite',
        start: '2024-05-07T16:00:00.000Z',
        end: '2024-05-07T17:00:00.000Z',
        allDay: false,
        location: 'HQ',
        description: 'Bring slides',
      },
    ]);
  });

  it('uses recurrence identity for moved recurring override ids', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:colliding-series@example.com',
      'DTSTAMP:20240501T120000Z',
      'DTSTART:20240506T090000Z',
      'DTEND:20240506T093000Z',
      'RRULE:FREQ=DAILY;COUNT=3',
      'SUMMARY:Series event',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:colliding-series@example.com',
      'RECURRENCE-ID:20240506T090000Z',
      'DTSTAMP:20240501T120000Z',
      'DTSTART:20240507T090000Z',
      'DTEND:20240507T093000Z',
      'SUMMARY:Moved onto next slot',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(parseIcalText(text, timedFeed)).toEqual<CalendarEvent[]>([
      {
        id: 'colliding-series@example.com:2024-05-06T09:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Moved onto next slot',
        start: '2024-05-07T09:00:00.000Z',
        end: '2024-05-07T09:30:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
      {
        id: 'colliding-series@example.com:2024-05-07T09:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Series event',
        start: '2024-05-07T09:00:00.000Z',
        end: '2024-05-07T09:30:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
      {
        id: 'colliding-series@example.com:2024-05-08T09:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Series event',
        start: '2024-05-08T09:00:00.000Z',
        end: '2024-05-08T09:30:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
    ]);
  });

  it('uses first-occurrence overrides in recurring series', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:first-override@example.com',
      'DTSTAMP:20240501T120000Z',
      'DTSTART:20240506T090000Z',
      'DTEND:20240506T093000Z',
      'RDATE:20240508T090000Z',
      'SUMMARY:Daily sync',
      'LOCATION:Room 1',
      'DESCRIPTION:Default details',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:first-override@example.com',
      'RECURRENCE-ID:20240506T090000Z',
      'DTSTAMP:20240501T120000Z',
      'DTSTART:20240506T110000Z',
      'DTEND:20240506T113000Z',
      'SUMMARY:Moved kickoff',
      'LOCATION:Room 4',
      'DESCRIPTION:Updated first instance',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(parseIcalText(text, timedFeed)).toEqual<CalendarEvent[]>([
      {
        id: 'first-override@example.com:2024-05-06T09:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Moved kickoff',
        start: '2024-05-06T11:00:00.000Z',
        end: '2024-05-06T11:30:00.000Z',
        allDay: false,
        location: 'Room 4',
        description: 'Updated first instance',
      },
      {
        id: 'first-override@example.com:2024-05-08T09:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Daily sync',
        start: '2024-05-08T09:00:00.000Z',
        end: '2024-05-08T09:30:00.000Z',
        allDay: false,
        location: 'Room 1',
        description: 'Default details',
      },
    ]);
  });

  it('omits cancelled recurrence exceptions from expanded output', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:cancelled-series@example.com',
      'DTSTAMP:20240501T120000Z',
      'DTSTART:20240506T090000Z',
      'DTEND:20240506T093000Z',
      'RRULE:FREQ=DAILY;COUNT=3',
      'SUMMARY:Daily sync',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:cancelled-series@example.com',
      'RECURRENCE-ID:20240507T090000Z',
      'DTSTAMP:20240501T120000Z',
      'STATUS:CANCELLED',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(parseIcalText(text, timedFeed)).toEqual<CalendarEvent[]>([
      {
        id: 'cancelled-series@example.com:2024-05-06T09:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Daily sync',
        start: '2024-05-06T09:00:00.000Z',
        end: '2024-05-06T09:30:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
      {
        id: 'cancelled-series@example.com:2024-05-08T09:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Daily sync',
        start: '2024-05-08T09:00:00.000Z',
        end: '2024-05-08T09:30:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
    ]);
  });

  it('parses detached recurrence instances when no recurring master exists in the payload', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:detached-instance@example.com',
      'RECURRENCE-ID:20240507T090000Z',
      'DTSTAMP:20240501T120000Z',
      'DTSTART:20240507T110000Z',
      'DTEND:20240507T113000Z',
      'SUMMARY:Detached sync',
      'LOCATION:Room 4',
      'DESCRIPTION:Moved instance',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(parseIcalText(text, timedFeed)).toEqual<CalendarEvent[]>([
      {
        id: 'detached-instance@example.com:2024-05-07T09:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Detached sync',
        start: '2024-05-07T11:00:00.000Z',
        end: '2024-05-07T11:30:00.000Z',
        allDay: false,
        location: 'Room 4',
        description: 'Moved instance',
      },
    ]);
  });

  it('assigns distinct stable ids to detached recurrence instances sharing a UID', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:detached-shared@example.com',
      'RECURRENCE-ID:20240507T090000Z',
      'DTSTAMP:20240501T120000Z',
      'DTSTART:20240507T110000Z',
      'DTEND:20240507T113000Z',
      'SUMMARY:Detached A',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:detached-shared@example.com',
      'RECURRENCE-ID:20240508T090000Z',
      'DTSTAMP:20240501T120000Z',
      'DTSTART:20240508T120000Z',
      'DTEND:20240508T123000Z',
      'SUMMARY:Detached B',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(parseIcalText(text, timedFeed)).toEqual<CalendarEvent[]>([
      {
        id: 'detached-shared@example.com:2024-05-07T09:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Detached A',
        start: '2024-05-07T11:00:00.000Z',
        end: '2024-05-07T11:30:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
      {
        id: 'detached-shared@example.com:2024-05-08T09:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Detached B',
        start: '2024-05-08T12:00:00.000Z',
        end: '2024-05-08T12:30:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
    ]);
  });

  it('ignores detached cancelled recurrence exceptions without DTSTART', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:cancelled-detached@example.com',
      'RECURRENCE-ID:20240507T090000Z',
      'DTSTAMP:20240501T120000Z',
      'STATUS:CANCELLED',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(parseIcalText(text, timedFeed)).toEqual([]);
  });

  it('suppresses duplicate recurrence exceptions for RDATE-based series', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:rdate-series@example.com',
      'DTSTAMP:20240501T120000Z',
      'DTSTART:20240506T090000Z',
      'DTEND:20240506T093000Z',
      'RDATE:20240508T090000Z',
      'SUMMARY:RDATE series',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:rdate-series@example.com',
      'RECURRENCE-ID:20240508T090000Z',
      'DTSTAMP:20240501T120000Z',
      'DTSTART:20240508T110000Z',
      'DTEND:20240508T113000Z',
      'SUMMARY:Shifted RDATE instance',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(parseIcalText(text, timedFeed)).toEqual<CalendarEvent[]>([
      {
        id: 'rdate-series@example.com:2024-05-06T09:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'RDATE series',
        start: '2024-05-06T09:00:00.000Z',
        end: '2024-05-06T09:30:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
      {
        id: 'rdate-series@example.com:2024-05-08T09:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Shifted RDATE instance',
        start: '2024-05-08T11:00:00.000Z',
        end: '2024-05-08T11:30:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
    ]);
  });

  it('normalizes unresolved TZID datetimes to UTC ISO strings', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:tzid-event@example.com',
      'DTSTAMP:20240501T120000Z',
      'DTSTART;TZID=America/New_York:20240506T090000',
      'DTEND;TZID=America/New_York:20240506T100000',
      'SUMMARY:NY morning sync',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(parseIcalText(text, timedFeed)).toEqual<CalendarEvent[]>([
      {
        id: 'tzid-event@example.com',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'NY morning sync',
        start: '2024-05-06T13:00:00.000Z',
        end: '2024-05-06T14:00:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
    ]);
  });

  it('normalizes recurring TZID occurrences across DST boundaries to UTC instants', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:dst-series@example.com',
      'DTSTAMP:20241001T120000Z',
      'DTSTART;TZID=America/New_York:20241101T090000',
      'DTEND;TZID=America/New_York:20241101T100000',
      'RRULE:FREQ=DAILY;COUNT=4',
      'SUMMARY:DST series',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(parseIcalText(text, timedFeed)).toEqual<CalendarEvent[]>([
      {
        id: 'dst-series@example.com:2024-11-01T13:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'DST series',
        start: '2024-11-01T13:00:00.000Z',
        end: '2024-11-01T14:00:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
      {
        id: 'dst-series@example.com:2024-11-02T13:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'DST series',
        start: '2024-11-02T13:00:00.000Z',
        end: '2024-11-02T14:00:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
      {
        id: 'dst-series@example.com:2024-11-03T14:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'DST series',
        start: '2024-11-03T14:00:00.000Z',
        end: '2024-11-03T15:00:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
      {
        id: 'dst-series@example.com:2024-11-04T14:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'DST series',
        start: '2024-11-04T14:00:00.000Z',
        end: '2024-11-04T15:00:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
    ]);
  });

  it('omits cancelled recurring TZID occurrences without throwing', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:cancelled-dst-series@example.com',
      'DTSTAMP:20241001T120000Z',
      'DTSTART;TZID=America/New_York:20241101T090000',
      'DTEND;TZID=America/New_York:20241101T100000',
      'RRULE:FREQ=DAILY;COUNT=4',
      'SUMMARY:Cancelled DST series',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:cancelled-dst-series@example.com',
      'RECURRENCE-ID:20241103T090000',
      'STATUS:CANCELLED',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(() => parseIcalText(text, timedFeed)).not.toThrow();
    expect(parseIcalText(text, timedFeed)).toEqual<CalendarEvent[]>([
      {
        id: 'cancelled-dst-series@example.com:2024-11-01T13:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Cancelled DST series',
        start: '2024-11-01T13:00:00.000Z',
        end: '2024-11-01T14:00:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
      {
        id: 'cancelled-dst-series@example.com:2024-11-02T13:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Cancelled DST series',
        start: '2024-11-02T13:00:00.000Z',
        end: '2024-11-02T14:00:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
      {
        id: 'cancelled-dst-series@example.com:2024-11-04T14:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Cancelled DST series',
        start: '2024-11-04T14:00:00.000Z',
        end: '2024-11-04T15:00:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
    ]);
  });

  it('inherits master metadata for detached overrides that only change time', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:override-inherits@example.com',
      'DTSTAMP:20241001T120000Z',
      'DTSTART:20241101T090000Z',
      'DTEND:20241101T100000Z',
      'RRULE:FREQ=DAILY;COUNT=3',
      'SUMMARY:Inherited title',
      'LOCATION:Inherited room',
      'DESCRIPTION:Inherited notes',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:override-inherits@example.com',
      'RECURRENCE-ID:20241102T090000Z',
      'DTSTART:20241102T110000Z',
      'DTEND:20241102T120000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(parseIcalText(text, timedFeed)).toEqual<CalendarEvent[]>([
      {
        id: 'override-inherits@example.com:2024-11-01T09:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Inherited title',
        start: '2024-11-01T09:00:00.000Z',
        end: '2024-11-01T10:00:00.000Z',
        allDay: false,
        location: 'Inherited room',
        description: 'Inherited notes',
      },
      {
        id: 'override-inherits@example.com:2024-11-02T09:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Inherited title',
        start: '2024-11-02T11:00:00.000Z',
        end: '2024-11-02T12:00:00.000Z',
        allDay: false,
        location: 'Inherited room',
        description: 'Inherited notes',
      },
      {
        id: 'override-inherits@example.com:2024-11-03T09:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Inherited title',
        start: '2024-11-03T09:00:00.000Z',
        end: '2024-11-03T10:00:00.000Z',
        allDay: false,
        location: 'Inherited room',
        description: 'Inherited notes',
      },
    ]);
  });

  it('omits RANGE=THISANDFUTURE cancellation tails without throwing', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:cancelled-tail@example.com',
      'DTSTAMP:20241001T120000Z',
      'DTSTART;TZID=America/New_York:20241101T090000',
      'DTEND;TZID=America/New_York:20241101T100000',
      'RRULE:FREQ=DAILY;COUNT=5',
      'SUMMARY:Cancelled tail series',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:cancelled-tail@example.com',
      'RECURRENCE-ID;RANGE=THISANDFUTURE:20241103T090000',
      'STATUS:CANCELLED',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(() => parseIcalText(text, timedFeed)).not.toThrow();
    expect(parseIcalText(text, timedFeed)).toEqual<CalendarEvent[]>([
      {
        id: 'cancelled-tail@example.com:2024-11-01T13:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Cancelled tail series',
        start: '2024-11-01T13:00:00.000Z',
        end: '2024-11-01T14:00:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
      {
        id: 'cancelled-tail@example.com:2024-11-02T13:00:00.000Z',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Cancelled tail series',
        start: '2024-11-02T13:00:00.000Z',
        end: '2024-11-02T14:00:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
    ]);
  });

  it('falls back deterministically for non-IANA timezone names', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:custom-tzid@example.com',
      'DTSTAMP:20240501T120000Z',
      'DTSTART;TZID=Customized Time Zone:20240506T090000',
      'DTEND;TZID=Customized Time Zone:20240506T100000',
      'SUMMARY:Custom TZ event',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(parseIcalText(text, timedFeed)).toEqual<CalendarEvent[]>([
      {
        id: 'custom-tzid@example.com',
        sourceUrl: timedFeed.url,
        calendarName: timedFeed.calendarName,
        title: 'Custom TZ event',
        start: '2024-05-06T09:00:00.000',
        end: '2024-05-06T10:00:00.000',
        allDay: false,
        location: '',
        description: '',
      },
    ]);
  });

  it('skips malformed VEVENT entries without DTSTART', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:missing-start@example.com',
      'SUMMARY:Broken event',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(parseIcalText(text, timedFeed)).toEqual([]);
  });

  it('fully expands finite recurring VEVENT entries beyond 365 occurrences', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:long-series@example.com',
      'DTSTAMP:20240501T120000Z',
      'DTSTART:20240506T090000Z',
      'DTEND:20240506T093000Z',
      'RRULE:FREQ=DAILY;COUNT=400',
      'SUMMARY:Long series',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const events = parseIcalText(text, timedFeed);

    expect(events).toHaveLength(400);
    expect(events[0]).toEqual<CalendarEvent>({
      id: 'long-series@example.com:2024-05-06T09:00:00.000Z',
      sourceUrl: timedFeed.url,
      calendarName: timedFeed.calendarName,
      title: 'Long series',
      start: '2024-05-06T09:00:00.000Z',
      end: '2024-05-06T09:30:00.000Z',
      allDay: false,
      location: '',
      description: '',
    });
    expect(events[399]).toEqual<CalendarEvent>({
      id: 'long-series@example.com:2025-06-09T09:00:00.000Z',
      sourceUrl: timedFeed.url,
      calendarName: timedFeed.calendarName,
      title: 'Long series',
      start: '2025-06-09T09:00:00.000Z',
      end: '2025-06-09T09:30:00.000Z',
      allDay: false,
      location: '',
      description: '',
    });
  });
});

describe('refreshFeeds', () => {
  it('logs feed fetch and parse counts for each refresh', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fetchImpl: typeof fetch = vi.fn(async () =>
      createResponse(
        [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'BEGIN:VEVENT',
          'UID:event-2@example.com',
          'DTSTAMP:20240501T120000Z',
          'DTSTART:20240507T150000Z',
          'DTEND:20240507T153000Z',
          'SUMMARY:Standup',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n'),
      ),
    ) as typeof fetch;

    await refreshFeeds([timedFeed], fetchImpl);

    expect(logSpy).toHaveBeenCalledWith('[logseq-google-agenda] Fetching feed', {
      url: timedFeed.url,
      calendarName: timedFeed.calendarName,
    });
    expect(logSpy).toHaveBeenCalledWith('[logseq-google-agenda] Feed fetched', {
      url: timedFeed.url,
      calendarName: timedFeed.calendarName,
      status: 200,
      ok: true,
    });
    expect(logSpy).toHaveBeenCalledWith('[logseq-google-agenda] Feed parsed', {
      url: timedFeed.url,
      calendarName: timedFeed.calendarName,
      eventCount: 1,
    });
    expect(logSpy).toHaveBeenCalledWith('[logseq-google-agenda] Refresh feeds completed', {
      feedCount: 1,
      eventCount: 1,
      errorCount: 0,
      syncedAt: expect.any(String),
    });
  });

  it('returns combined events and collects fetch failures without dropping healthy feeds', async () => {
    const successfulFeed: FeedConfig = timedFeed;
    const failingFeed: FeedConfig = {
      url: 'https://example.com/failing.ics',
      calendarName: 'Broken',
    };

    const fetchImpl: typeof fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === successfulFeed.url) {
        return createResponse(
          [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'BEGIN:VEVENT',
            'UID:event-2@example.com',
            'DTSTAMP:20240501T120000Z',
            'DTSTART:20240507T150000Z',
            'DTEND:20240507T153000Z',
            'SUMMARY:Standup',
            'END:VEVENT',
            'END:VCALENDAR',
          ].join('\r\n'),
        );
      }

      throw new Error('network down');
    }) as typeof fetch;

    const result = await refreshFeeds([successfulFeed, failingFeed], fetchImpl);

    expect(result.events).toEqual<CalendarEvent[]>([
      {
        id: 'event-2@example.com',
        sourceUrl: successfulFeed.url,
        calendarName: successfulFeed.calendarName,
        title: 'Standup',
        start: '2024-05-07T15:00:00.000Z',
        end: '2024-05-07T15:30:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
    ]);
    expect(result.errors).toEqual([
      {
        sourceUrl: failingFeed.url,
        message: 'network down',
      },
    ]);
    expect(new Date(result.syncedAt).toISOString()).toBe(result.syncedAt);
  });

  it('records non-ok responses as feed errors', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      createResponse('forbidden', {
        status: 403,
        statusText: 'Forbidden',
      }),
    ) as typeof fetch;

    const result = await refreshFeeds([timedFeed], fetchImpl);

    expect(result.events).toEqual([]);
    expect(result.errors).toEqual([
      {
        sourceUrl: timedFeed.url,
        message: 'Forbidden',
      },
    ]);
  });

  it('starts multi-feed fetches concurrently before earlier feeds resolve', async () => {
    const feeds: FeedConfig[] = [
      timedFeed,
      {
        url: 'https://example.com/product.ics',
        calendarName: 'Product',
      },
    ];
    const started: string[] = [];
    const resolvers = new Map<string, (response: Response) => void>();

    const fetchImpl: typeof fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      started.push(url);

      return new Promise<Response>((resolve) => {
        resolvers.set(url, resolve);
      });
    }) as typeof fetch;

    const pending = refreshFeeds(feeds, fetchImpl);

    await Promise.resolve();

    expect(started).toEqual(feeds.map((feed) => feed.url));

    resolvers
      .get(feeds[1].url)
      ?.(
        createResponse(
          [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'BEGIN:VEVENT',
            'UID:event-3@example.com',
            'DTSTAMP:20240501T120000Z',
            'DTSTART:20240508T100000Z',
            'DTEND:20240508T103000Z',
            'SUMMARY:Demo',
            'END:VEVENT',
            'END:VCALENDAR',
          ].join('\r\n'),
        ),
      );
    resolvers
      .get(feeds[0].url)
      ?.(
        createResponse(
          [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'BEGIN:VEVENT',
            'UID:event-4@example.com',
            'DTSTAMP:20240501T120000Z',
            'DTSTART:20240508T090000Z',
            'DTEND:20240508T093000Z',
            'SUMMARY:Planning',
            'END:VEVENT',
            'END:VCALENDAR',
          ].join('\r\n'),
        ),
      );

    const result = await pending;

    expect(result.errors).toEqual([]);
    expect(result.events).toEqual<CalendarEvent[]>([
      {
        id: 'event-4@example.com',
        sourceUrl: feeds[0].url,
        calendarName: feeds[0].calendarName,
        title: 'Planning',
        start: '2024-05-08T09:00:00.000Z',
        end: '2024-05-08T09:30:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
      {
        id: 'event-3@example.com',
        sourceUrl: feeds[1].url,
        calendarName: feeds[1].calendarName,
        title: 'Demo',
        start: '2024-05-08T10:00:00.000Z',
        end: '2024-05-08T10:30:00.000Z',
        allDay: false,
        location: '',
        description: '',
      },
    ]);
  });
});
