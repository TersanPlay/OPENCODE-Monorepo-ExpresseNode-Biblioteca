import { useRef, useState } from 'react';
import {
  BookMarked,
  BookOpen,
  CalendarDays,
  Feather,
  GraduationCap,
  Highlighter,
  Library,
  NotebookPen,
  PenLine,
  Pencil,
  ScrollText,
  StickyNote,
} from 'lucide-react';
import { Badge } from '../../../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { cn } from '../../../lib/utils';

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const WATERMARKS = [
  { Icon: BookOpen, className: 'left-[-8%] top-[6%] size-32 -rotate-12' },
  { Icon: PenLine, className: 'right-[4%] top-[1%] size-24 rotate-[14deg]' },
  { Icon: NotebookPen, className: 'left-[38%] top-[-6%] size-24 -rotate-[18deg]' },
  { Icon: Pencil, className: 'left-[46%] top-[44%] size-28 rotate-[20deg]' },
  { Icon: Highlighter, className: 'left-[18%] top-[30%] size-20 -rotate-[24deg]' },
  { Icon: ScrollText, className: 'right-[10%] top-[26%] size-20 rotate-[12deg]' },
  { Icon: StickyNote, className: 'left-[-2%] top-[54%] size-20 rotate-[18deg]' },
  { Icon: BookMarked, className: 'right-[-6%] bottom-[4%] size-36 -rotate-6' },
  { Icon: Feather, className: 'left-[6%] bottom-[-4%] size-28 rotate-[10deg]' },
  { Icon: Library, className: 'right-[26%] bottom-[-8%] size-28 rotate-[8deg]' },
  { Icon: GraduationCap, className: 'right-[6%] bottom-[36%] size-24 rotate-[16deg]' },
];

export function TodayCalendar({ date = new Date() }: { date?: Date }) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const today = date.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = new Date(year, month, 1).getDay();

  const [selected, setSelected] = useState(today);
  const [focusDay, setFocusDay] = useState(today);
  const btnRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  const monthLabel = date.toLocaleDateString('pt-BR', { month: 'long' });
  const weekday = date.toLocaleDateString('pt-BR', { weekday: 'long' });

  const label = (d: number) =>
    new Date(year, month, d).toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

  const move = (delta: number) => {
    const next = Math.min(daysInMonth, Math.max(1, focusDay + delta));
    setFocusDay(next);
    btnRefs.current[next]?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, d: number) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-7);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(7);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setSelected(d);
    }
  };

  const cells: (number | null)[] = Array.from({ length: startOffset }, () => null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <Card className="relative flex flex-col overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 6% -10%, rgba(8,127,140,.16), transparent 55%), radial-gradient(100% 80% at 98% 6%, rgba(200,155,91,.16), transparent 52%), radial-gradient(90% 90% at 62% 118%, rgba(124,198,202,.20), transparent 60%)',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden text-ink opacity-[0.06]"
      >
        {WATERMARKS.map((w, i) => (
          <w.Icon key={i} className={`absolute ${w.className}`} strokeWidth={1.4} />
        ))}
      </div>

      <CardHeader className="relative items-center">
        <CardTitle className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-small bg-primary/10 text-primary">
            <CalendarDays className="size-4" />
          </span>
          Calendário
        </CardTitle>
        <Badge variant="primary" dot>
          Hoje
        </Badge>
      </CardHeader>

      <CardContent className="relative flex flex-1 flex-col">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <span className="text-[15px] font-bold capitalize text-ink">
            {monthLabel} {year}
          </span>
          <span className="text-[12px] font-semibold capitalize text-muted">{weekday}</span>
        </div>

        <div
          role="group"
          aria-label={`Calendário de ${monthLabel} de ${year}`}
          className="relative rounded-card bg-ink/[0.07] ring-1 ring-inset ring-black/[0.06]"
        >
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-card">
            {WEEKDAYS.map((d, i) => (
              <span
                key={`wd-${i}`}
                className="bg-surface/70 py-1.5 text-center text-[10.5px] font-bold uppercase tracking-wide text-muted"
              >
                {d}
              </span>
            ))}

            {cells.map((c, i) => {
              if (c === null) {
                return <span key={`empty-${i}`} aria-hidden="true" className="h-9 bg-surface/70" />;
              }
              const isToday = c === today;
              const isSelected = c === selected;
              const isFocus = c === focusDay;
              return (
                <button
                  key={`day-${c}`}
                  ref={(el) => {
                    btnRefs.current[c] = el;
                  }}
                  type="button"
                  tabIndex={isFocus ? 0 : -1}
                  aria-label={label(c)}
                  aria-current={isToday ? 'date' : undefined}
                  aria-pressed={isSelected}
                  onClick={() => {
                    setSelected(c);
                    setFocusDay(c);
                  }}
                  onFocus={() => setFocusDay(c)}
                  onKeyDown={(event) => handleKeyDown(event, c)}
                  className={cn(
                    'group relative flex h-9 items-center justify-center text-[12.5px] font-semibold',
                    'transition-all duration-200 [transition-timing-function:var(--ease)] motion-reduce:transition-none',
                    'focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                    isToday
                      ? 'z-10 bg-primary text-white shadow-card hover:-translate-y-1 hover:bg-primary-dark hover:shadow-pop motion-reduce:hover:translate-y-0'
                      : 'bg-surface/70 text-ink/70 hover:z-10 hover:-translate-y-0.5 hover:bg-surface hover:text-ink hover:shadow-[0_12px_24px_-16px_rgba(23,26,26,.45)] motion-reduce:hover:translate-y-0',
                    isSelected && !isToday && 'ring-1 ring-inset ring-primary/50',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100 motion-reduce:transition-none"
                    style={{
                      background:
                        'radial-gradient(85% 85% at 50% 0%, rgba(8,127,140,.20), transparent 72%)',
                    }}
                  />
                  <span className="relative">{c}</span>
                </button>
              );
            })}
          </div>
        </div>

        <p className="mt-3 text-[12.5px] text-muted">
          <span className="font-semibold text-ink">
            {selected === today ? 'Hoje é' : 'Selecionado'}:
          </span>{' '}
          <span className="capitalize">{label(selected)}</span>
        </p>
      </CardContent>
    </Card>
  );
}
