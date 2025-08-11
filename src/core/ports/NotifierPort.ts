export interface SendTextOptions {
  parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML' | 'None';
  disableWebPagePreview?: boolean;
  replyToMessageId?: number;
}

export abstract class NotifierPort {
  abstract sendText(userId: string, text: string, opts?: SendTextOptions): Promise<void>;
  abstract sendChunks(userId: string, text: string, opts?: SendTextOptions): Promise<void>;
}
