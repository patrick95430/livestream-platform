/**
 * 伺服器端的 LiveKit 設定與 client。
 * 這個檔案只能被 app/api/ 底下的程式引用，絕對不要從 'use client' 元件引用,
 * 否則 API secret 會被打包進瀏覽器。
 */

import { RoomServiceClient } from 'livekit-server-sdk';

export type LiveKitConfig = {
  apiKey: string;
  apiSecret: string;
  wsUrl: string;
};

/** 讀環境變數。少任何一個就回 null，讓呼叫端回 500 並印出清楚的訊息。 */
export function livekitConfig(): LiveKitConfig | null {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const wsUrl = process.env.LIVEKIT_URL;

  if (!apiKey || !apiSecret || !wsUrl) return null;

  // Windows 上用記事本編 .env.local 會在行尾留 \r，驗證一定失敗。
  // 這裡順手清掉，省掉一個很難查的坑。
  return {
    apiKey: apiKey.trim(),
    apiSecret: apiSecret.trim(),
    wsUrl: wsUrl.trim(),
  };
}

/**
 * RoomServiceClient 用來做「以伺服器身分」的操作：列房間、建房間、廣播事件。
 * 它吃的是 https:// 位址，不是給瀏覽器連線用的 wss://。
 */
export function roomService(): RoomServiceClient | null {
  const config = livekitConfig();
  if (!config) return null;

  const httpUrl = config.wsUrl.replace(/^ws/, 'http');
  return new RoomServiceClient(httpUrl, config.apiKey, config.apiSecret);
}

export const MISSING_CONFIG_MESSAGE =
  '伺服器缺少 LIVEKIT_API_KEY / LIVEKIT_API_SECRET / LIVEKIT_URL，請檢查 .env.local';
