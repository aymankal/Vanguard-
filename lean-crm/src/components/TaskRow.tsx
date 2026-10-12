import { Link } from 'react-router-dom';
import type { Task } from '../types';
import { dueLabel, todayStr, addDays } from '../format';

export function TaskRow({ task, onToggle, onSnooze, showLinks = true }: {
  task: Task;
  onToggle: (t: Task) => void;
  onSnooze?: (t: Task, date: string) => void;
  showLinks?: boolean;
}) {
  const overdue = !task.done && task.due_date && task.due_date < todayStr();
  return (
    <li className="group flex items-center gap-3 px-3 py-2">
      <input
        type="checkbox"
        checked={!!task.done}
        onChange={() => onToggle(task)}
        className="h-4 w-4 shrink-0 cursor-pointer accent-indigo-600"
        aria-label={`Mark "${task.title}" done`}
      />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm ${task.done ? 'text-zinc-400 line-through' : ''}`}>{task.title}</p>
        {showLinks && (task.contact || task.deal) && (
          <p className="truncate text-xs text-zinc-500">
            {task.contact && task.contact_id && <Link className="hover:underline" to={`/contacts/${task.contact_id}`}>{task.contact}</Link>}
            {task.contact && task.deal && ' · '}
            {task.deal && task.deal_id && <Link className="hover:underline" to={`/deals/${task.deal_id}`}>{task.deal}</Link>}
          </p>
        )}
      </div>
      {onSnooze && !task.done && (
        <div className="flex gap-0.5 sm:hidden sm:group-hover:flex sm:group-focus-within:flex">
          <button className="btn-ghost" onClick={() => onSnooze(task, addDays(todayStr(), 1))} title="Move to tomorrow">+1d</button>
          <button className="btn-ghost hidden sm:inline-flex" onClick={() => onSnooze(task, addDays(todayStr(), 7))} title="Move to next week">+1w</button>
        </div>
      )}
      <span className={`shrink-0 text-xs ${overdue ? 'font-medium text-red-600 dark:text-red-400' : 'text-zinc-500'}`}>{dueLabel(task.due_date)}</span>
    </li>
  );
}
