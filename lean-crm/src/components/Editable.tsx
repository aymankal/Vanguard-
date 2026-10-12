import { useEffect, useRef, useState } from 'react';

/** Click-to-edit text. Enter/blur saves, Esc cancels. */
export function Editable({
  value, onSave, placeholder = '—', type = 'text', className = '', multiline = false, list,
}: {
  value: string | number | null | undefined;
  onSave: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'number' | 'date' | 'email';
  className?: string;
  multiline?: boolean;
  list?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const start = () => {
    setDraft(value == null ? '' : String(value));
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    if (draft !== (value == null ? '' : String(value))) onSave(draft);
  };

  if (editing) {
    const props = {
      ref,
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); }
        if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
      },
      className: `input ${className}`,
    };
    return multiline ? <textarea rows={4} {...props} /> : <input type={type} list={list} {...props} />;
  }
  const shown = value == null || value === '' ? null : String(value);
  return (
    <button
      type="button"
      onClick={start}
      className={`block w-full min-h-[1.75rem] truncate rounded px-1 -mx-1 py-0.5 text-left hover:bg-zinc-100 focus:bg-zinc-100 focus:outline-none dark:hover:bg-zinc-800 dark:focus:bg-zinc-800 ${multiline ? 'whitespace-pre-wrap' : ''} ${className}`}
      title="Click to edit"
    >
      {shown ?? <span className="text-zinc-400">{placeholder}</span>}
    </button>
  );
}
