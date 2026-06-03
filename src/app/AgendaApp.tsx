import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { buildMonthGrid, getOverflowCount, toDateKey } from '../calendar/month-grid';
import { groupEventsByDate } from '../calendar/group-events';
import type { AgendaTask, CalendarEvent } from '../calendar/types';
import type { Snapshot } from '../sync/cache';

type AgendaAppProps = {
  snapshot?: Snapshot | null;
  initialMonth?: Date;
  today?: Date;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  onClose?: () => void;
  onDateDoubleClick?: (date: Date) => void;
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const VISIBLE_EVENT_LIMIT = 3;

type AgendaMode = 'calendar' | 'tasks';

type AgendaItem = CalendarEvent | AgendaTask;

function groupTasksByDate(tasks: AgendaTask[]) {
  return tasks.reduce<Record<string, AgendaTask[]>>((groupedTasks, task) => {
    const existingTasks = groupedTasks[task.date] ?? [];

    groupedTasks[task.date] = [...existingTasks, task];
    return groupedTasks;
  }, {});
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function shiftMonth(date: Date, delta: number) {
  const targetYear = date.getFullYear();
  const targetMonth = date.getMonth() + delta;
  const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();

  return new Date(targetYear, targetMonth, Math.min(date.getDate(), lastDayOfTargetMonth));
}

function setDateInMonth(month: Date, dayOfMonth: number) {
  const lastDayOfMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();

  return new Date(month.getFullYear(), month.getMonth(), Math.min(dayOfMonth, lastDayOfMonth));
}

function formatMonthHeading(date: Date) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(date);
}

function formatDayButtonLabel(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function formatDayButtonAccessibleLabel(date: Date, visibleItems: AgendaItem[], overflowCount: number) {
  const parts = [formatDayButtonLabel(date)];

  if (visibleItems.length > 0) {
    parts.push(visibleItems.map((item) => item.title).join(', '));
  }

  if (overflowCount > 0) {
    parts.push(`+${overflowCount} more`);
  }

  return parts.join('. ');
}

function formatSyncIssues(errors: Snapshot['errors']) {
  const label = errors.length === 1 ? 'Sync issue' : 'Sync issues';
  return `${label}: ${errors.map((error) => error.message).join('; ')}`;
}

function formatSidebarHeading(date: Date) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' }).format(date);
}

function formatShortDate(date: string | null | undefined) {
  if (!date) {
    return null;
  }

  const parsedDate = new Date(`${date}T00:00:00`);

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsedDate);
}

function getIsoWeekNumber(date: Date) {
  const target = startOfDay(date);
  const dayOfWeek = (target.getDay() + 6) % 7;

  target.setDate(target.getDate() - dayOfWeek + 3);

  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const firstThursdayDayOfWeek = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstThursdayDayOfWeek + 3);

  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / 604800000);
}

function formatEventTime(event: CalendarEvent) {
  if (event.allDay) {
    return 'All day';
  }

  const timeFormat: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
  };

  const start = new Intl.DateTimeFormat('en-US', timeFormat).format(new Date(event.start));
  const end = new Intl.DateTimeFormat('en-US', timeFormat).format(new Date(event.end));

  return `${start} \u2013 ${end}`;
}

function isCalendarEvent(item: AgendaItem): item is CalendarEvent {
  return 'start' in item;
}

const DOUBLE_CLICK_THRESHOLD_MS = 400;

export function AgendaApp({
  snapshot = null,
  initialMonth,
  today = new Date(),
  isRefreshing = false,
  onClose,
  onDateDoubleClick,
}: AgendaAppProps) {
  const toolbarRef = useRef<HTMLElement | null>(null);
  const primarySectionRef = useRef<HTMLDivElement | null>(null);
  const secondarySectionRef = useRef<HTMLDivElement | null>(null);
  const todayButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastClickRef = useRef<{ dateKey: string; time: number } | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const isDraggingRef = useRef(false);
  const [selectedPanelRatio, setSelectedPanelRatio] = useState(0.4);
  const normalizedToday = startOfDay(today);
  const initialDisplayedMonth = startOfDay(initialMonth ?? normalizedToday);
  const [currentMonth, setCurrentMonth] = useState(initialDisplayedMonth);
  const [selectedDate, setSelectedDate] = useState(
    initialMonth ? setDateInMonth(initialDisplayedMonth, normalizedToday.getDate()) : normalizedToday,
  );
  const [mode, setMode] = useState<AgendaMode>('calendar');

  const eventsByDate = useMemo(
    () => groupEventsByDate(snapshot?.events ?? []),
    [snapshot?.events],
  );
  const tasksByDate = useMemo(
    () => groupTasksByDate(snapshot?.tasks ?? []),
    [snapshot?.tasks],
  );
  const monthGrid = useMemo(() => buildMonthGrid(currentMonth), [currentMonth]);
  const selectedDateKey = toDateKey(selectedDate);
  const selectedItems = mode === 'calendar'
    ? eventsByDate[selectedDateKey] ?? []
    : tasksByDate[selectedDateKey] ?? [];

  const upcomingDays = useMemo(() => {
    const days: Array<{ dateKey: string; label: string; items: AgendaItem[] }> = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(normalizedToday.getFullYear(), normalizedToday.getMonth(), normalizedToday.getDate() + i);
      const key = toDateKey(d);
      const dayItems = mode === 'calendar'
        ? eventsByDate[key] ?? []
        : tasksByDate[key] ?? [];
      if (dayItems.length > 0) {
        days.push({ dateKey: key, label: formatSidebarHeading(d), items: dayItems });
      }
    }
    return days;
  }, [normalizedToday, eventsByDate, tasksByDate, mode]);

  function handleShiftMonth(delta: number) {
    const nextMonth = shiftMonth(currentMonth, delta);
    setCurrentMonth(nextMonth);
    setSelectedDate(setDateInMonth(nextMonth, selectedDate.getDate()));
  }

  function handleDayClick(date: Date, dateKey: string) {
    setSelectedDate(date);

    const now = Date.now();
    const last = lastClickRef.current;

    if (last && last.dateKey === dateKey && now - last.time < DOUBLE_CLICK_THRESHOLD_MS) {
      console.log('[logseq-google-agenda] Double-click detected', { dateKey });
      onDateDoubleClick?.(date);
      lastClickRef.current = null;
    } else {
      lastClickRef.current = { dateKey, time: now };
    }
  }

  function handleToday() {
    console.log('[logseq-google-agenda] Today button clicked', {
      currentMonthBefore: `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`,
      today: toDateKey(normalizedToday),
    });
    setCurrentMonth(normalizedToday);
    setSelectedDate(normalizedToday);
  }

  const handleResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handleResizePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current || !sidebarRef.current) return;

    const sidebar = sidebarRef.current;
    const rect = sidebar.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const ratio = Math.min(Math.max(offsetY / rect.height, 0.15), 0.85);
    setSelectedPanelRatio(ratio);
  }, []);

  const handleResizePointerUp = useCallback((e: React.PointerEvent) => {
    isDraggingRef.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  useEffect(() => {
    console.log('[logseq-google-agenda] Toolbar layout measured', {
      hasPrimarySection: Boolean(primarySectionRef.current),
      hasSecondarySection: Boolean(secondarySectionRef.current),
      hasTodayButton: Boolean(todayButtonRef.current),
      toolbarWidth: toolbarRef.current?.getBoundingClientRect().width ?? null,
      primaryWidth: primarySectionRef.current?.getBoundingClientRect().width ?? null,
      secondaryWidth: secondarySectionRef.current?.getBoundingClientRect().width ?? null,
      todayLeft: todayButtonRef.current?.getBoundingClientRect().left ?? null,
      todayRight: todayButtonRef.current?.getBoundingClientRect().right ?? null,
    });
  }, [currentMonth, mode]);

  // Diagnostic: log every click target in the iframe to find what intercepts Today button clicks
  useEffect(() => {
    function handleDocClick(e: MouseEvent) {
      const el = e.target as HTMLElement;
      const rect = el.getBoundingClientRect();
      console.log('[logseq-google-agenda] Document click', {
        tag: el.tagName,
        className: el.className,
        id: el.id || null,
        text: el.textContent?.slice(0, 40),
        clickX: e.clientX,
        clickY: e.clientY,
        elRect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      });
    }
    document.addEventListener('click', handleDocClick, true);
    return () => document.removeEventListener('click', handleDocClick, true);
  }, []);

  return (
    <main className="agenda-shell">
      <header ref={toolbarRef} className="agenda-toolbar">
        <div ref={primarySectionRef} className="agenda-toolbar__section agenda-toolbar__section--primary">
          <div className="agenda-toolbar__group agenda-toolbar__group--nav">
            <button
              type="button"
              className="agenda-toolbar__icon-button agenda-toolbar__icon-button--nav"
              onClick={() => handleShiftMonth(-1)}
              aria-label="Previous month"
            >
              <span aria-hidden="true" className="agenda-toolbar__icon-glyph">&lt;</span>
            </button>
            <button
              type="button"
              className="agenda-toolbar__icon-button agenda-toolbar__icon-button--nav"
              onClick={() => handleShiftMonth(1)}
              aria-label="Next month"
            >
              <span aria-hidden="true" className="agenda-toolbar__icon-glyph">&gt;</span>
            </button>
          </div>
          <h1 className="agenda-toolbar__title">{formatMonthHeading(currentMonth)}</h1>
          {isRefreshing ? (
            <span className="agenda-toolbar__spinner" role="status" aria-label="Refreshing">
              <span className="agenda-toolbar__spinner-dot" aria-hidden="true" />
            </span>
          ) : null}
        </div>

        <div ref={secondarySectionRef} className="agenda-toolbar__section agenda-toolbar__section--secondary">
          <div className="agenda-toolbar__group agenda-toolbar__group--views" aria-label="Agenda mode">
            <button
              ref={todayButtonRef}
              type="button"
              className="agenda-toolbar__button"
              onClick={handleToday}
            >
              Today
            </button>
            <button
              type="button"
              className="agenda-toolbar__button"
              aria-pressed={mode === 'calendar'}
              onClick={() => setMode('calendar')}
            >
              Calendar
            </button>
            <button
              type="button"
              className="agenda-toolbar__button"
              aria-pressed={mode === 'tasks'}
              onClick={() => setMode('tasks')}
            >
              Tasks
            </button>
          </div>
            <button
              type="button"
              className="agenda-toolbar__icon-button agenda-toolbar__icon-button--close"
              onClick={onClose}
              aria-label="Close"
            >
              <span aria-hidden="true" className="agenda-toolbar__icon-glyph">x</span>
            </button>
        </div>
      </header>

      {snapshot && snapshot.errors.length > 0 ? (
        <section className="agenda-banner" role="status">
          {formatSyncIssues(snapshot.errors)}
        </section>
      ) : null}

      <div className="agenda-layout">
        <section className="agenda-calendar" aria-label="Month calendar">
          <div className="agenda-weekdays" aria-hidden="true">
            <span className="agenda-weekdays__week-label">Week</span>
            {WEEKDAYS.map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>

          <div className="agenda-grid">
            {monthGrid.map((week) => (
              <div key={week[0].dateKey} className="agenda-week-row">
                <span className="agenda-week-label">Week {getIsoWeekNumber(week[0].date)}</span>
                {week.map((day) => {
                  const dayItems = mode === 'calendar'
                    ? eventsByDate[day.dateKey] ?? []
                    : tasksByDate[day.dateKey] ?? [];
                  const visibleItems = dayItems.slice(0, VISIBLE_EVENT_LIMIT);
                  const overflowCount = getOverflowCount(dayItems.length, VISIBLE_EVENT_LIMIT);
                  const isSelected = day.dateKey === selectedDateKey;

                  return (
                    <button
                      key={day.dateKey}
                      type="button"
                      className={[
                        'agenda-day',
                        day.inCurrentMonth ? '' : 'agenda-day--muted',
                        isSelected ? 'agenda-day--selected' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      aria-label={formatDayButtonAccessibleLabel(day.date, visibleItems, overflowCount)}
                      aria-pressed={isSelected}
                      onClick={() => handleDayClick(day.date, day.dateKey)}
                    >
                      <span className="agenda-day__number">{day.date.getDate()}</span>
                      <span className="agenda-day__events">
                        {visibleItems.map((item) => (
                          <span key={item.id} className="agenda-event-pill">
                            {item.title}
                          </span>
                        ))}
                        {overflowCount > 0 ? (
                          <span className="agenda-overflow-pill">+{overflowCount} more</span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </section>

        <aside
          ref={sidebarRef}
          className={`agenda-sidebar${isDraggingRef.current ? ' agenda-sidebar--resizing' : ''}`}
          aria-label="Day details"
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
        >
          <section
            className="agenda-sidebar__selected"
            aria-label="Selected day"
            style={{ flex: `0 0 ${selectedPanelRatio * 100}%` }}
          >
            <h2>{formatSidebarHeading(selectedDate)}</h2>
            {selectedItems.length === 0 ? (
              <div className="agenda-empty-state">No data</div>
            ) : (
              <div className="agenda-event-list">
                {selectedItems.map((item) =>
                  isCalendarEvent(item) ? (
                    <article key={item.id} className="agenda-sidebar__event agenda-sidebar__event--calendar">
                      <div className="agenda-sidebar__event-header">
                        <h3 className="agenda-sidebar__event-title">{item.title}</h3>
                        <p className="agenda-sidebar__calendar">{item.calendarName}</p>
                      </div>
                      <p className="agenda-sidebar__time">{formatEventTime(item)}</p>
                    </article>
                  ) : (
                    <article key={item.id} className="agenda-sidebar__event agenda-sidebar__event--task">
                      <div className="agenda-sidebar__event-header">
                        <h3 className="agenda-sidebar__event-title">{item.title}</h3>
                        <p className="agenda-sidebar__calendar">{item.pageOriginalName}</p>
                      </div>
                      <div className="agenda-sidebar__task-meta">
                        <p className="agenda-sidebar__time">{item.marker}</p>
                        {item.priority ? (
                          <p className="agenda-sidebar__detail">Priority {item.priority}</p>
                        ) : null}
                        {formatShortDate(item.scheduled) ? (
                          <p className="agenda-sidebar__detail">
                            Scheduled {formatShortDate(item.scheduled)}
                          </p>
                        ) : null}
                        {formatShortDate(item.deadline) ? (
                          <p className="agenda-sidebar__detail">
                            Due {formatShortDate(item.deadline)}
                          </p>
                        ) : null}
                      </div>
                    </article>
                  ),
                )}
              </div>
            )}
          </section>

          <div
            className="agenda-sidebar__resize-handle"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize sidebar sections"
            onPointerDown={handleResizePointerDown}
          >
            <span className="agenda-sidebar__resize-grip" aria-hidden="true" />
          </div>

          <section
            className="agenda-sidebar__upcoming"
            aria-label="Upcoming"
            style={{ flex: `1 1 0`, minHeight: `${(1 - selectedPanelRatio) * 100}%` }}
          >
            <h2>Upcoming</h2>
            {upcomingDays.length === 0 ? (
              <div className="agenda-empty-state">Nothing upcoming</div>
            ) : (
              <div className="agenda-event-list">
                {upcomingDays.map((day) => (
                  <div key={day.dateKey} className="agenda-sidebar__day-group">
                    <h3 className="agenda-sidebar__day-heading">{day.label}</h3>
                    {day.items.map((item) =>
                      isCalendarEvent(item) ? (
                        <article key={item.id} className="agenda-sidebar__event agenda-sidebar__event--calendar">
                          <div className="agenda-sidebar__event-header">
                            <h3 className="agenda-sidebar__event-title">{item.title}</h3>
                            <p className="agenda-sidebar__calendar">{item.calendarName}</p>
                          </div>
                          <p className="agenda-sidebar__time">{formatEventTime(item)}</p>
                        </article>
                      ) : (
                        <article key={item.id} className="agenda-sidebar__event agenda-sidebar__event--task">
                          <div className="agenda-sidebar__event-header">
                            <h3 className="agenda-sidebar__event-title">{item.title}</h3>
                            <p className="agenda-sidebar__calendar">{item.pageOriginalName}</p>
                          </div>
                          <div className="agenda-sidebar__task-meta">
                            <p className="agenda-sidebar__time">{item.marker}</p>
                          </div>
                        </article>
                      ),
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
