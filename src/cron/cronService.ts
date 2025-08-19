import { RepoPort } from "../core/ports/RepoPort";
import { NotifierPort } from "../core/ports/NotifierPort";
import { nowPartsInTz, isWithinMinuteWindow } from "../core/utils/dates";
import { messages } from "../core/daily/messages";

type CronOptions = {
  morningHour?: number;     // por defecto 8
  morningMinute?: number;   // por defecto 0
  eveningHour?: number;     // por defecto 18
  eveningMinute?: number;   // por defecto 0
  windowMinutes?: number;   // por defecto 10
};

export class CronService {
  constructor(
    private readonly repo: RepoPort,
    private readonly notifier: NotifierPort,
    private readonly opts: CronOptions = {}
  ) {}

  async tick(): Promise<{ morning: number; evening: number }> {
    const MORNING_H = this.opts.morningHour ?? 8;
    const MORNING_M = this.opts.morningMinute ?? 0;
    const EVENING_H = this.opts.eveningHour ?? 18;
    const EVENING_M = this.opts.eveningMinute ?? 0;
    const WINDOW = this.opts.windowMinutes ?? 10;

    let morningCount = 0;
    let eveningCount = 0;

    const users = await this.repo.getAllUsers();
    for (const u of users) {
      const { hour, minute, ymd, epoch } = nowPartsInTz(u.tz || "America/Bogota");

      if (isWithinMinuteWindow(hour, minute, MORNING_H, MORNING_M, WINDOW)) {
        const daily = (await this.repo.getDailyByDate(u.user_id, ymd)) ||
                      await (async () => {
                        const id = await this.repo.createDaily(u.user_id, ymd, "pending_morning");
                        return { id, user_id: u.user_id, date: ymd, state: "pending_morning" as const };
                      })();

        if (await this.repo.claimMorningPrompt(daily.id, epoch)) {
          await this.notifier.sendText(u.user_id, messages.morning);
          morningCount++;
        }
      }

      if (isWithinMinuteWindow(hour, minute, EVENING_H, EVENING_M, WINDOW)) {
        const daily = await this.repo.getDailyByDate(u.user_id, ymd);
        if (daily && daily.state === "pending_update") {
          if (await this.repo.claimEveningPrompt(daily.id, epoch)) {
            await this.notifier.sendText(u.user_id, messages.evening);
            eveningCount++;
          }
        }
      }
    }

    return { morning: morningCount, evening: eveningCount };
  }
}
