/**
 * 禮物定價表。
 *
 * 這是價格的唯一真相，而且只有伺服器端會讀它來算錢。
 * 前端只傳 giftKey，不傳金額 —— 前端如果能傳金額，使用者打開 DevTools
 * 就能把「扣 10 點」改成「扣 -1000 點」。
 */

export const GIFTS = {
  heart: { label: '愛心', emoji: '♥', points: 1 },
  star: { label: '星星', emoji: '★', points: 5 },
  rocket: { label: '火箭', emoji: '✦', points: 20 },
  crown: { label: '皇冠', emoji: '♛', points: 50 },
} as const;

export type GiftKey = keyof typeof GIFTS;

export const GIFT_KEYS = Object.keys(GIFTS) as GiftKey[];

export function isGiftKey(value: unknown): value is GiftKey {
  return typeof value === 'string' && value in GIFTS;
}
