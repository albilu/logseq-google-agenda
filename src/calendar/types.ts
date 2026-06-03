export type CalendarEvent = {
  id: string;
  sourceUrl: string;
  calendarName: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  description: string;
};

export type AgendaTask = {
  id: string;
  title: string;
  date: string;
  marker: string;
  pageName: string;
  pageOriginalName: string;
  blockUuid: string;
  priority: string;
  scheduled: string;
  deadline: string;
};

export type DayCell = {
  date: Date;
  dateKey: string;
  inCurrentMonth: boolean;
};
