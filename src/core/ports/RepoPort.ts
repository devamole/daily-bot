export type DailyState = 'pending_morning' | 'pending_update' | 'needs_followup' | 'done' | 'expired';

export interface UserRow {
  user_id: string;
  chat_id: string;
  tz: string;
  provider: string;
  provider_user_id: string;
  created_at?: number;
}

export interface DailyRow {
  id: number;
  user_id: string;
  date: string; // YYYY-MM-DD
  state: DailyState;
  score?: number | null;
  eval_model?: string | null;
  eval_version?: string | null;
  eval_rationale?: string | null;
  created_at?: number;
  updated_at?: number;
}

export interface MessageRow {
  id?: number;
  chat_id: string;
  user_id: string;
  message_id?: number | null;
  update_id?: string | null;
  provider?: string | null;
  text: string;
  timestamp: number; // epoch seconds
  type: 'morning' | 'update' | 'followup' | 'chat' | 'system';
  created_at?: number;
}

export abstract class RepoPort {
  abstract upsertUser(u: Pick<UserRow, 'user_id' | 'chat_id' | 'tz' | 'provider' | 'provider_user_id'>): Promise<void>;
  abstract getUser(user_id: string): Promise<UserRow | null>;
  abstract getLastDaily(user_id: string): Promise<DailyRow | null>;
  abstract createDaily(user_id: string, date: string, state: DailyState, opts?: { overwriteToday?: boolean }): Promise<number>;
  abstract setDailyState(dailyId: number, state: DailyState, patch?: Partial<DailyRow>): Promise<void>;
  abstract insertMessage(row: Omit<MessageRow, 'id'>): Promise<void>;
  abstract getMorningText(user_id: string, date: string): Promise<string>;
  abstract hasEvent(provider: string, event_id: string): Promise<boolean>;
}