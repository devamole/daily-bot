import { EvaluatorPort } from "../ports/EvaluatorPort";
import { NotifierPort } from "../ports/NotifierPort";
import { RepoPort } from "../ports/RepoPort";
import { NormalizedUpdate } from "../types/NormalizedUpdate";
import { localDateStr } from "../utils/dates";
import { messages } from "./messages";

export class DailyService {
  constructor(
    private readonly repo: RepoPort,
    private readonly notifier: NotifierPort,
    private readonly evaluator: EvaluatorPort,
    private readonly defaultTz: string
  ) {}

  async handle(update: NormalizedUpdate): Promise<void> {
    const { provider, event_id, user, text = '', ts, type, command } = update;
    const userId = String(user.id);
    const tz = user.tz || this.defaultTz;
    const today = localDateStr(ts, tz);

    // Idempotencia básica
    if (await this.repo.hasEvent(provider, event_id)) {
      return;
    }

    // /start: registra y reinicia el día actual
    if (type === 'command' && command === 'start') {
      await this.repo.upsertUser({
        user_id: userId,
        chat_id: userId,
        tz,
        provider,
        provider_user_id: userId
      });
      await this.repo.createDaily(userId, today, 'pending_morning', { overwriteToday: true });
      await this.notifier.sendText(userId, messages.morning);
      await this.repo.insertMessage({
        chat_id: userId,
        user_id: userId,
        message_id: 0,
        update_id: event_id,
        provider,
        text: '/start',
        timestamp: ts,
        type: 'system'
      });
      return;
    }

    // Último estado (puede ser de ayer)
    const last = await this.repo.getLastDaily(userId);
    if (!last || last.date !== today) {
      // expira el anterior si no estaba done
      if (last && last.state !== 'done') {
        await this.repo.setDailyState(last.id, 'expired');
      }
      const id = await this.repo.createDaily(userId, today, 'pending_morning');
      // trata este mensaje como MORNING
      await this.repo.setDailyState(id, 'pending_update');
      await this.notifier.sendText(userId, "✅ ¡Recibido! Gracias por compartir tu daily.");
      await this.repo.insertMessage({
        chat_id: userId,
        user_id: userId,
        message_id: 0,
        update_id: event_id,
        provider,
        text,
        timestamp: ts,
        type: 'morning'
      });
      return;
    }

    const { id: dailyId, state } = last;

    if (state === 'pending_morning') {
      await this.repo.setDailyState(dailyId, 'pending_update');
      await this.notifier.sendText(userId, "✅ ¡Recibido! Gracias por compartir tu daily.");
      await this.repo.insertMessage({
        chat_id: userId,
        user_id: userId,
        message_id: 0,
        update_id: event_id,
        provider,
        text,
        timestamp: ts,
        type: 'morning'
      });
      return;
    }

    if (state === 'pending_update') {
      const plan = await this.repo.getMorningText(userId, today);
      const { score, advice, rationale, version, model } = await this.evaluator.evaluate(plan || '', text);

      if (score >= 100) {
        await this.notifier.sendText(userId, `🎉 ¡Excelente! Cumpliste tus objetivos. ${advice || ''}`.trim());
        await this.repo.setDailyState(dailyId, 'done', {
          score,
          eval_version: version,
          eval_model: model,
          eval_rationale: rationale
        });
      } else {
        await this.notifier.sendText(userId, messages.notMet);
        await this.repo.setDailyState(dailyId, 'needs_followup', {
          score,
          eval_version: version,
          eval_model: model,
          eval_rationale: rationale
        });
      }

      await this.repo.insertMessage({
        chat_id: userId,
        user_id: userId,
        message_id: 0,
        update_id: event_id,
        provider,
        text,
        timestamp: ts,
        type: 'update'
      });
      return;
    }

    if (state === 'needs_followup') {
      // Cierra con respuesta de coaching (simple)
      const plan = await this.repo.getMorningText(userId, today);
      const reply = `🧭 Gracias por el contexto. Mañana ajusta así: ${text.slice(0, 200)}`;
      await this.notifier.sendText(userId, reply);
      await this.repo.setDailyState(dailyId, 'done');
      await this.repo.insertMessage({
        chat_id: userId,
        user_id: userId,
        message_id: 0,
        update_id: event_id,
        provider,
        text,
        timestamp: ts,
        type: 'followup'
      });
      return;
    }

    // state === 'done' → chat libre (aquí simple)
    await this.repo.insertMessage({
      chat_id: userId,
      user_id: userId,
      message_id: 0,
      update_id: event_id,
      provider,
      text,
      timestamp: ts,
      type: 'chat'
    });
    await this.notifier.sendText(userId, "💬 ¡Te leo! (chat libre)");
  }
}
