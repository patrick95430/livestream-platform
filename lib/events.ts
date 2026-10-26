/**
 * 交界合約：前端與後端共用的即時事件格式。
 *
 * 這個檔案就是 docs/contract.md 的程式碼版本。
 * 改這裡等於改合約，兩個人都要同意才能改。
 *
 * 所有即時訊息都走 LiveKit 的 data channel，不另外架 WebSocket 伺服器。
 */

/** 所有事件共用一個 topic，收到後再用 type 分流 */
export const EVENT_TOPIC = 'app';

/** 觀眾或主播送出的文字留言 */
export type ChatEvent = {
  type: 'chat';
  from: string;
  text: string;
  ts: number;
};

/**
 * 禮物事件。
 * 注意：這個事件只由「伺服器」發出（見 app/api/gifts/route.ts）。
 * 前端自己發不算數，否則不付點數也能讓全場噴動畫。
 */
export type GiftEvent = {
  type: 'gift';
  from: string;
  gift: string;
  label: string;
  emoji: string;
  points: number;
  ts: number;
};

/** 延遲量測：送出探測 */
export type PingEvent = {
  type: 'ping';
  id: string;
  from: string;
  ts: number;
};

/** 延遲量測：回應探測 */
export type PongEvent = {
  type: 'pong';
  id: string;
  to: string;
  ts: number;
};

export type AppEvent = ChatEvent | GiftEvent | PingEvent | PongEvent;

export function encodeEvent(event: AppEvent): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(event));
}

export function decodeEvent(payload: Uint8Array): AppEvent | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(payload));
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof (parsed as { type?: unknown }).type === 'string'
    ) {
      return parsed as AppEvent;
    }
    return null;
  } catch {
    // 收到不是我們格式的訊息就忽略，不要讓整個房間掛掉
    return null;
  }
}
