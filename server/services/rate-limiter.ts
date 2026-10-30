/**
 * Ограничение исходящих сообщений Telegram: глобально ~25/с и 1/с на получателя.
 * В памяти — процесс один.
 */
export class RateLimiter {
  private globalTimes: number[] = [];
  private perChat = new Map<number, number>();

  constructor(
    private readonly globalPerSec = 25,
    private readonly perChatIntervalMs = 1_000,
  ) {}

  async wait(chatId: number): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.globalTimes = this.globalTimes.filter((t) => now - t < 1_000);
      const lastChat = this.perChat.get(chatId) ?? 0;
      const chatWait = lastChat + this.perChatIntervalMs - now;
      const globalWait = this.globalTimes.length >= this.globalPerSec ? 1_000 - (now - this.globalTimes[0]) : 0;
      const delay = Math.max(chatWait, globalWait, 0);
      if (delay === 0) {
        this.globalTimes.push(now);
        this.perChat.set(chatId, now);
        if (this.perChat.size > 5_000) this.perChat.clear();
        return;
      }
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
