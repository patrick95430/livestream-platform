'use client';

import { useEffect, useRef, useState } from 'react';

export type LyricLine = {
  /** 這句開始的秒數 */
  at: number;
  text: string;
};

/**
 * 示範歌詞。換成你們自己要唱的那首。
 *
 * 對唱的做法：在文字前面標誰唱，兩人各看同一份歌詞就知道輪到誰。
 * 不要放受著作權保護的歌詞到公開的 repo 裡。
 */
export const DEMO_LYRICS: LyricLine[] = [
  { at: 0, text: '（前奏）' },
  { at: 4, text: 'A：這裡放第一句' },
  { at: 9, text: 'B：這裡放第二句' },
  { at: 14, text: 'A：第三句' },
  { at: 19, text: 'B：第四句' },
  { at: 24, text: '合：副歌第一句' },
  { at: 29, text: '合：副歌第二句' },
  { at: 34, text: '（間奏）' },
];

/**
 * 卡拉 OK 歌詞條。
 *
 * 用一個計時器推進秒數，把對應的那句高亮。
 * 兩個人各自按播放會對不準，所以 Demo 時由主播按，
 * 之後可以把「播放／暫停」做成事件廣播給全場，大家的歌詞就會同步。
 */
export default function LyricsBar({
  lyrics = DEMO_LYRICS,
}: {
  lyrics?: LyricLine[];
}) {
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const startedAt = useRef<number>(0);

  useEffect(() => {
    if (!playing) return;

    startedAt.current = Date.now() - elapsed * 1000;
    const timer = window.setInterval(() => {
      setElapsed((Date.now() - startedAt.current) / 1000);
    }, 100);

    return () => window.clearInterval(timer);
    // elapsed 故意不放進依賴，否則每 100ms 會重建一次計時器
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const currentIndex = lyrics.reduce(
    (found, line, i) => (elapsed >= line.at ? i : found),
    -1,
  );

  const current = currentIndex >= 0 ? lyrics[currentIndex] : null;
  const next = currentIndex + 1 < lyrics.length ? lyrics[currentIndex + 1] : null;

  return (
    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-4 pt-10 pb-4">
      <div className="mx-auto flex max-w-3xl items-end gap-3">
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-2xl font-medium text-white drop-shadow">
            {current?.text ?? '按播放開始'}
          </p>
          <p className="mt-1 truncate text-sm text-neutral-400">
            {next?.text ?? ''}
          </p>
        </div>

        <div className="pointer-events-auto flex shrink-0 gap-1.5">
          <button
            onClick={() => setPlaying((p) => !p)}
            className="rounded bg-white/15 px-3 py-1.5 text-xs text-white hover:bg-white/25"
          >
            {playing ? '暫停' : '播放'}
          </button>
          <button
            onClick={() => {
              setPlaying(false);
              setElapsed(0);
            }}
            className="rounded bg-white/15 px-3 py-1.5 text-xs text-white hover:bg-white/25"
          >
            歸零
          </button>
          <span className="rounded bg-black/50 px-2 py-1.5 font-mono text-xs text-neutral-300">
            {elapsed.toFixed(1)}s
          </span>
        </div>
      </div>
    </div>
  );
}
