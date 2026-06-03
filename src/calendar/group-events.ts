import { toDateKey } from './month-grid';
import type { CalendarEvent } from './types';

function getEventDateKey(event: CalendarEvent) {
  if (event.allDay && /^\d{4}-\d{2}-\d{2}$/.test(event.start)) {
    return event.start;
  }

  return toDateKey(new Date(event.start));
}

export function groupEventsByDate(events: CalendarEvent[]) {
  const sortedEvents = [...events].sort((left, right) =>
    new Date(left.start).getTime() - new Date(right.start).getTime(),
  );

  return sortedEvents.reduce<Record<string, CalendarEvent[]>>((groups, event) => {
    const key = getEventDateKey(event);

    if (!groups[key]) {
      groups[key] = [];
    }

    groups[key].push(event);
    return groups;
  }, {});
}
