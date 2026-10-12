import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { api, useQuery, write, invalidateAll } from '../api';
import type { Deal, Stage } from '../types';
import { money, moneyShort, dueLabel, todayStr } from '../format';

export function Pipeline() {
  const { data: stages } = useQuery<Stage[]>('/stages');
  const { data: deals, mutate } = useQuery<Deal[]>('/deals');
  const [active, setActive] = useState<Deal | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const byStage = useMemo(() => {
    const m = new Map<number, Deal[]>();
    stages?.forEach((s) => m.set(s.id, []));
    deals?.forEach((d) => m.get(d.stage_id)?.push(d));
    return m;
  }, [stages, deals]);

  const openTotal = useMemo(
    () => (deals ?? []).filter((d) => !['won', 'lost'].includes(d.stage.toLowerCase())).reduce((s, d) => s + d.value, 0),
    [deals],
  );

  const onDragStart = (e: DragStartEvent) => setActive(deals?.find((d) => d.id === e.active.id) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setActive(null);
    const dealId = Number(e.active.id);
    const stageId = Number(e.over?.id);
    const deal = deals?.find((d) => d.id === dealId);
    const stage = stages?.find((s) => s.id === stageId);
    if (!deal || !stage || deal.stage_id === stageId) return;
    const prev = deal.stage_id;
    mutate((ds) => ds.map((d) => (d.id === dealId ? { ...d, stage_id: stageId, stage: stage.name, nba_fresh: false } : d)));
    write(api(`/deals/${dealId}`, { method: 'PATCH', body: { stage_id: stageId } }), () =>
      mutate((ds) => ds.map((d) => (d.id === dealId ? { ...d, stage_id: prev } : d))),
    );
  };

  if (!stages || !deals) return <div className="p-8 text-sm text-zinc-400">Loading…</div>;
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-end justify-between gap-4 px-4 pt-4 md:px-8 md:pt-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
          <p className="mt-1 text-sm text-zinc-500">{money(openTotal)} open across {deals.filter((d) => !['won', 'lost'].includes(d.stage.toLowerCase())).length} deals · drag cards to move</p>
        </div>
      </header>
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
        <div className="flex flex-1 snap-x gap-3 overflow-x-auto p-4 md:px-8">
          {stages.map((s) => (
            <Column key={s.id} stage={s} deals={byStage.get(s.id) ?? []} />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>{active && <Card deal={active} overlay />}</DragOverlay>
      </DndContext>
    </div>
  );
}

function Column({ stage, deals }: { stage: Stage; deals: Deal[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const total = deals.reduce((s, d) => s + d.value, 0);
  const tone = stage.name.toLowerCase() === 'won' ? 'text-emerald-600 dark:text-emerald-400' : stage.name.toLowerCase() === 'lost' ? 'text-zinc-400' : '';

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const body = { title: title.trim(), value: Number(value.replace(/[^\d.]/g, '')) || 0, stage_id: stage.id };
    setTitle(''); setValue(''); setAdding(false);
    await write(api('/deals', { method: 'POST', body }));
    invalidateAll();
  };

  return (
    <section ref={setNodeRef} className={`flex w-72 shrink-0 snap-start flex-col rounded-lg bg-zinc-100/80 transition-colors dark:bg-zinc-900/60 ${isOver ? 'ring-2 ring-indigo-400' : ''}`}>
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <div>
          <h2 className={`text-sm font-semibold ${tone}`}>{stage.name} <span className="font-normal text-zinc-400">{deals.length}</span></h2>
          <p className="text-xs text-zinc-500">{money(total)}</p>
        </div>
        <button className="btn-ghost text-base" onClick={() => setAdding((a) => !a)} aria-label={`Add deal to ${stage.name}`}>+</button>
      </div>
      {adding && (
        <form onSubmit={add} className="mx-2 mb-2 space-y-1.5 rounded-md bg-white p-2 shadow-sm dark:bg-zinc-900">
          <input autoFocus className="input" placeholder="Deal title" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setAdding(false)} />
          <div className="flex gap-1.5">
            <input className="input" placeholder="Value, e.g. 15000" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
            <button className="btn-primary">Add</button>
          </div>
        </form>
      )}
      <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {deals.map((d) => <Card key={d.id} deal={d} />)}
      </div>
    </section>
  );
}

function Card({ deal, overlay }: { deal: Deal; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: deal.id });
  const navigate = useNavigate();
  const overdue = deal.close_date && deal.close_date < todayStr() && !['won', 'lost'].includes(deal.stage.toLowerCase());
  return (
    <article
      ref={overlay ? undefined : setNodeRef}
      {...(overlay ? {} : listeners)}
      {...(overlay ? {} : attributes)}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.key === 'Enter' && !e.defaultPrevented) navigate(`/deals/${deal.id}`);
      }}
      className={`card cursor-grab touch-manipulation p-2.5 text-left shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:cursor-grabbing ${isDragging && !overlay ? 'opacity-30' : ''} ${overlay ? 'rotate-1 shadow-xl' : ''}`}
    >
      <Link to={`/deals/${deal.id}`} className="block text-sm font-medium leading-snug hover:underline" onClick={(e) => isDragging && e.preventDefault()}>
        {deal.title}
      </Link>
      <p className="mt-0.5 truncate text-xs text-zinc-500">{deal.company ?? deal.contact ?? 'No company'}</p>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="font-semibold">{moneyShort(deal.value)}</span>
        {deal.close_date && <span className={overdue ? 'text-red-600 dark:text-red-400' : 'text-zinc-500'}>{dueLabel(deal.close_date)}</span>}
      </div>
      {deal.nba_text && deal.nba_fresh && (
        <p className="mt-2 border-t border-zinc-100 pt-1.5 text-xs text-indigo-700 dark:border-zinc-800 dark:text-indigo-300">✦ {deal.nba_text}</p>
      )}
    </article>
  );
}
