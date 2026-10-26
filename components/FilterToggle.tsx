'use client';

export const FILTERS = {
  none: { label: '原始', css: 'none' },
  warm: { label: '暖色', css: 'sepia(0.3) saturate(1.4) contrast(1.05)' },
  cool: { label: '冷色', css: 'hue-rotate(-18deg) saturate(1.3)' },
  mono: { label: '黑白', css: 'grayscale(1) contrast(1.1)' },
  soft: { label: '柔焦', css: 'blur(1px) brightness(1.12) saturate(1.1)' },
} as const;

export type FilterKey = keyof typeof FILTERS;

export const FILTER_KEYS = Object.keys(FILTERS) as FilterKey[];

/**
 * 相機濾鏡切換。
 *
 * 重要限制：這是 CSS filter，只改「你自己瀏覽器上看到的畫面」，
 * 不會改變送出去的串流。觀眾那邊看到的還是原始畫面。
 *
 * 要讓濾鏡真的進到串流裡，必須在送出前處理視訊軌
 * （把畫面畫到 canvas、套效果、再用 canvas 的輸出當作視訊來源）。
 * 那是第二階段的事，先用這個版本把介面和狀態流做對。
 */
export default function FilterToggle({
  value,
  onChange,
}: {
  value: FilterKey;
  onChange: (next: FilterKey) => void;
}) {
  return (
    <section className="rounded-lg border border-neutral-700 bg-neutral-900 p-3">
      <h2 className="mb-2 text-sm font-medium text-neutral-300">濾鏡</h2>

      <div className="flex flex-wrap gap-1.5">
        {FILTER_KEYS.map((key) => (
          <button
            key={key}
            onClick={() => onChange(key)}
            aria-pressed={value === key}
            className={`rounded border px-2.5 py-1 text-xs ${
              value === key
                ? 'border-sky-500 bg-sky-600 text-white'
                : 'border-neutral-600 bg-neutral-800 text-neutral-300 hover:border-neutral-400'
            }`}
          >
            {FILTERS[key].label}
          </button>
        ))}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
        目前只改本機畫面。要讓觀眾也看到，需要在送出前處理視訊軌。
      </p>
    </section>
  );
}
