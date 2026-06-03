import type { DayCell } from './types';

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function getMondayFirstDayIndex(date: Date) {
  return (date.getDay() + 6) % 7;
}

export function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export function buildMonthGrid(month: Date): DayCell[][] {
  const firstOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = addDays(firstOfMonth, -getMondayFirstDayIndex(firstOfMonth));

  const cells = Array.from({ length: 42 }, (_, index) => {
    const cellDate = startOfDay(addDays(gridStart, index));

    return {
      date: cellDate,
      dateKey: toDateKey(cellDate),
      inCurrentMonth: cellDate.getMonth() === firstOfMonth.getMonth(),
    };
  });

  return Array.from({ length: 6 }, (_, weekIndex) =>
    cells.slice(weekIndex * 7, weekIndex * 7 + 7),
  );
}

export function getOverflowCount(totalEvents: number, visibleLimit = 3) {
  return Math.max(totalEvents - visibleLimit, 0);
}
