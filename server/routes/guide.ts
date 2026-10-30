import type { FastifyInstance } from 'fastify';
import type { Container } from '~server/container';

/**
 * Отдаёт обучающий ролик руководителя байтами с поддержкой Range (перемотка в <video>).
 * Бинарный поток, не JSON — zod-контракта в shared/schemas.ts у него нет осознанно.
 */
export async function registerGuideRoutes(app: FastifyInstance, c: Container): Promise<void> {
  app.get('/api/guide-video', async (req, reply) => {
    const video = await c.guide.getVideo();
    if (!video) return reply.status(404).send({ error: 'Ролик ещё не загружен' });
    const { buffer, contentType } = video;

    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (!range) {
      return reply.header('Accept-Ranges', 'bytes').header('Content-Length', buffer.length).type(contentType).send(buffer);
    }
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Number(range[2]) : buffer.length - 1;
    if (start > end || end >= buffer.length) {
      return reply.status(416).header('Content-Range', `bytes */${buffer.length}`).send();
    }
    return reply
      .status(206)
      .header('Accept-Ranges', 'bytes')
      .header('Content-Range', `bytes ${start}-${end}/${buffer.length}`)
      .header('Content-Length', end - start + 1)
      .type(contentType)
      .send(buffer.subarray(start, end + 1));
  });
}
