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

export type WeatherDay = {
  date: string;
  temperatureMin: number;
  temperatureMax: number;
  temperatureDisplay: string;
  conditionCode: number;
  conditionLabel: string;
  precipitationChance: number;
  iconKey: string;
};

export type WeatherLocation = {
  query: string;
  resolvedName: string;
  latitude: number;
  longitude: number;
};

export type DayCell = {
  date: Date;
  dateKey: string;
  inCurrentMonth: boolean;
};
