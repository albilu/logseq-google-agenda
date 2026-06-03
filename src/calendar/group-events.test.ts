import type { CalendarEvent } from './types';
import { groupEventsByDate } from './group-events';

function createEvent(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'event-1',
    sourceUrl: 'https://calendar.google.com/calendar/u/0/r',
    calendarName: 'Engineering',
    title: 'Planning',
    start: '2024-05-06T09:00:00.000',
    end: '2024-05-06T10:00:00.000',
    allDay: false,
    location: 'Room 1',
    description: 'Discuss roadmap',
    ...overrides,
  } as CalendarEvent;
}

describe('groupEventsByDate', () => {
  it('groups events by their start date key and sorts each day by start time ascending', () => {
    const events: CalendarEvent[] = [
      createEvent({
        id: '1',
        title: 'Lunch',
        start: '2024-05-06T12:00:00.000',
        end: '2024-05-06T13:00:00.000',
      }),
      createEvent({
        id: '2',
        title: 'Retro',
        start: '2024-05-07T11:00:00.000',
        end: '2024-05-07T12:00:00.000',
      }),
      createEvent({
        id: '3',
        title: 'Planning',
        start: '2024-05-06T09:00:00.000',
        end: '2024-05-06T10:00:00.000',
      }),
    ];

    expect(groupEventsByDate(events)).toEqual({
      '2024-05-06': [events[2], events[0]],
      '2024-05-07': [events[1]],
    });
  });

  it('sorts by actual time when start timestamps use different UTC offsets', () => {
    const earlierInstant = createEvent({
      id: '4',
      title: 'Earlier instant',
      start: '2024-05-06T10:00:00+02:00',
      end: '2024-05-06T11:00:00+02:00',
    });
    const laterInstant = createEvent({
      id: '5',
      title: 'Later instant',
      start: '2024-05-06T08:30:00Z',
      end: '2024-05-06T09:30:00Z',
    });

    expect(groupEventsByDate([laterInstant, earlierInstant])['2024-05-06']).toEqual([
      earlierInstant,
      laterInstant,
    ]);
  });

  it('groups an all-day date-only event under its literal date key', () => {
    const allDayEvent = createEvent({
      id: '6',
      title: 'Holiday',
      start: '2024-05-06',
      end: '2024-05-07',
      allDay: true,
    });

    const RealDate = Date;
    const shiftedDateOnlyResult = new RealDate('2024-05-05T20:00:00.000Z');

    vi.stubGlobal(
      'Date',
      class extends RealDate {
        constructor(value?: ConstructorParameters<DateConstructor>[0]) {
          if (value === '2024-05-06') {
            super(shiftedDateOnlyResult.getTime());
            return shiftedDateOnlyResult;
          }

          super(value as never);
        }
      } as DateConstructor,
    );

    try {
      expect(groupEventsByDate([allDayEvent])).toEqual({
        '2024-05-06': [allDayEvent],
      });
    } finally {
      vi.stubGlobal('Date', RealDate);
    }
  });

  it('returns an empty object when there are no events', () => {
    expect(groupEventsByDate([])).toEqual({});
  });
});
