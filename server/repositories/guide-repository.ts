import type { Storage } from '~server/platform';
import { PlatformError } from '~server/platform';

const KEY = 'guide/intro-video.mp4';

export type GuideVideo = { buffer: Buffer; contentType: string };

/** Обучающий ролик руководителя — один статичный файл в локальное файловое хранилище, читается один раз и кэшируется в процессе. */
export class GuideRepository {
  private cached: GuideVideo | null | undefined;

  constructor(private readonly storage: Storage) {}

  async getVideo(): Promise<GuideVideo | null> {
    if (this.cached === undefined) this.cached = await this.fetch();
    return this.cached;
  }

  private async fetch(): Promise<GuideVideo | null> {
    try {
      const res = await this.storage.download(KEY);
      const buffer = Buffer.from(await res.arrayBuffer());
      return { buffer, contentType: res.headers.get('content-type') ?? 'video/mp4' };
    } catch (e) {
      if (e instanceof PlatformError && e.status === 404) return null;
      throw e;
    }
  }
}
