export interface NormalizedUser {
  id: string;
  display?: string;
  tz?: string;
  team_id?: string;
  tenant_id?: string;
}

export interface NormalizedChat {
  id: string;
  type?: 'dm' | 'channel';
}

export type UpdateType = 'command' | 'message';

export interface NormalizedUpdate {
  provider: 'telegram'; // extensible a 'slack' | 'teams' | 'whatsapp'
  event_id: string;
  ts: number; // epoch seconds
  user: NormalizedUser;
  chat: NormalizedChat;
  type: UpdateType;
  command?: 'start';
  text?: string;
}