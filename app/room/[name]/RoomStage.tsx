'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Track } from 'livekit-client';
import {
  ControlBar,
  GridLayout,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
} from '@livekit/components-react';
import ChatPanel from '@/components/ChatPanel';
import GiftBar from '@/components/GiftBar';
import EffectLayer from '@/components/EffectLayer';
import LatencyMeter from '@/components/LatencyMeter';
import LyricsBar from '@/components/LyricsBar';
import FilterToggle, { FILTERS, type FilterKey } from '@/components/FilterToggle';

/**
 * 房間內部的版面。
 *
 * 這個元件在 <LiveKitRoom> 裡面，所以可以用所有 LiveKit 的 hook。
 * 左邊是影像區（上面疊特效、歌詞、延遲數字），右邊是互動區。
 */
export default function RoomStage({ roomName }: { roomName: string }) {
  const [filter, setFilter] = useState<FilterKey>('none');

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  return (
    <div className="flex h-dvh flex-col bg-neutral-950 text-neutral-100">
      <header className="flex shrink-0 items-center justify-between border-b border-neutral-800 px-4 py-2">
        <h1 className="text-sm font-medium">
          房間 <span className="text-sky-400">{roomName}</span>
        </h1>
        <Link href="/" className="text-xs text-neutral-400 hover:text-neutral-200">
          回首頁
        </Link>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* 影像區：position relative，讓特效層和歌詞條可以疊上來 */}
        <main
          className="video-stage relative min-h-0 flex-1 bg-black"
          style={{ ['--video-filter' as string]: FILTERS[filter].css }}
        >
          <GridLayout tracks={tracks} className="h-full">
            <ParticipantTile />
          </GridLayout>

          <EffectLayer />
          <LatencyMeter />
          <LyricsBar />
        </main>

        <aside className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-neutral-800 p-3 lg:w-80 lg:border-l">
          <ChatPanel />
          <GiftBar roomName={roomName} />
          <FilterToggle value={filter} onChange={setFilter} />
        </aside>
      </div>

      <div className="shrink-0 border-t border-neutral-800">
        <ControlBar />
      </div>

      {/* 沒有這個元件就聽不到別人的聲音 */}
      <RoomAudioRenderer />
    </div>
  );
}
