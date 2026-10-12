export type Stage = { id: number; name: string; position: number };
export type Company = { id: number; name: string; website: string; industry: string; size: string; notes: string; contact_count?: number };
export type Contact = {
  id: number; name: string; email: string; phone: string; title: string;
  company_id: number | null; company: string | null; owner: string; last_activity: string | null;
};
export type Deal = {
  id: number; title: string; value: number; stage_id: number; stage: string;
  company_id: number | null; company: string | null; contact_id: number | null; contact: string | null;
  close_date: string | null; nba_text: string | null; nba_fresh?: boolean; last_activity: string;
};
export type Task = { id: number; title: string; due_date: string | null; contact_id: number | null; deal_id: number | null; done: number; contact?: string | null; deal?: string | null };
export type ActivityType = 'note' | 'email' | 'stage_change' | 'task_done' | 'call_connected' | 'call_no_answer' | 'call_voicemail' | 'linkedin' | 'meeting_booked';
export type Activity = {
  id: number; type: ActivityType; body: string; contact_id: number | null; company_id: number | null; deal_id: number | null; created_at: string;
  user_id?: number | null; user_name?: string | null; meeting_at?: string | null; meeting_status?: MeetingStatus | null;
};
export type Action = { tool: string; input: Record<string, unknown>; summary: string };
export type Applied = { kind: 'contact' | 'company' | 'deal' | 'task' | 'note'; id: number; label: string };

export type Role = 'owner' | 'rep' | 'client';
export type Client = { id: number; name: string; logo_url: string; status: 'active' | 'paused' | 'ended'; contact_email?: string; start_date?: string | null };
export type User = { id: number; email: string; name: string; role: Role; client_id: number | null };
export type Me = { agency: boolean; user: User | null; clients: Client[] };
export type MeetingStatus = 'booked' | 'held' | 'no_show' | 'cancelled';
