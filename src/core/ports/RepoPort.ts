import type { ReasonCode } from "../analysis/reasons";
import type { TaskComplexity } from "../analysis/workload";

export type DailyState = "pending_morning" | "pending_update" | "needs_followup" | "done" | "expired";

export type DailyRow = {
  id: number;
  user_id: string;
  date: string;
  state: DailyState;
  score?: number | null;
  eval_model?: string | null;
  eval_version?: string | null;
  eval_rationale?: string | null;
  morning_prompt_at?: number | null;
  evening_prompt_at?: number | null;
  first_morning_at?: number | null;
  first_update_at?: number | null;
  closed_at?: number | null;
  workload_points?: number | null;
  workload_level?: "low" | "normal" | "high" | null;
};

export type UserRow = {
  user_id: string;
  chat_id: string;
  tz: string;
  provider: string;          // "telegram" | "slack" | "teams" | ...
  provider_user_id: string;  
  created_at: number;       
  updated_at: number;        
};

export type UpsertUserInput = {
  user_id: string;
  chat_id: string;
  tz: string;
  provider: string;
  provider_user_id: string;
};

export interface RepoPort {
  getAllUsers(): Promise<Array<{ user_id: string; tz: string }>>;
  upsertUser(input: UpsertUserInput): Promise<void>;
  getUserById(userId: string): Promise<UserRow | null>;
  getDailyByDate(userId: string, ymd: string): Promise<DailyRow | null>;
  createDaily(userId: string, ymd: string, state: DailyState): Promise<number>;
  setDailyState(dailyId: number, state: DailyState): Promise<void>;

  claimMorningPrompt(dailyId: number, epoch: number): Promise<boolean>;
  claimEveningPrompt(dailyId: number, epoch: number): Promise<boolean>;

  patchDaily(
    dailyId: number,
    patch: Partial<Pick<
      DailyRow,
      "first_morning_at" | "first_update_at" | "closed_at" |
      "workload_points" | "workload_level" |
      "score" | "eval_model" | "eval_version" | "eval_rationale"
    >>
  ): Promise<void>;

  insertTasks(
    dailyId: number,
    userId: string,
    tasks: Array<{ pos: number; text: string; est_complexity: TaskComplexity; est_points: number; source: "heuristic" | "llm" }>
  ): Promise<void>;

  upsertReasons(
    dailyId: number,
    reasons: Array<{
      code: ReasonCode | "other" | string;
      confidence: number;
      source: "heuristic" | "llm" | "manual";
      raw?: string | null;
      message_id?: number | null;
      model_version?: string | null;
    }>
  ): Promise<void>;
}
