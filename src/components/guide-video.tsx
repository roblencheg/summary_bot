import { GUIDE_VIDEO_URL } from '~/lib/api';

/** Обучающий ролик руководителя — один и тот же плеер на странице «Как это устроено» и в модалке первого входа. */
export function GuideVideo({ className }: { className?: string }) {
  return (
    <video controls preload="metadata" className={className ?? 'aspect-video w-full rounded-xl bg-night'}>
      <source src={GUIDE_VIDEO_URL} type="video/mp4" />
    </video>
  );
}
