/**
 * 無料枠カウンタ（FR-9。引継書§6 quota.ts）。
 *
 * - カウントは**クライアント側（UserProperties）**に置く（N-3「無料利用ではシート外への
 *   データ送信ゼロ」の成立要件。引継書§2）。
 * - `usage = { month: 'YYYY-MM', used: n }`。月替りで自動リセット。
 * - 消費は `LockService.getUserLock()` 内で「残数確認→PDF保存成功→+1」（引継書§6）。
 * - プロパティ消去による無料枠リセットの悪用は許容する（柱3 R3-1と同水準。対策コードを書かない）。
 * - 定数 3/1000 は docs 記載と一致すること（cr-compliance テストで検証）。
 */

/** 無料枠: 月3枚（PDF出力の成功1回＝1枚。再出力も計上。要件書FR-9）。 */
export const FREE_MONTHLY_LIMIT = 3;
/** Pro: 月1,000枚のフェアユース上限（要件書§8）。 */
export const PRO_MONTHLY_LIMIT = 1000;

/** UserProperties のキー。 */
const USAGE_PROP_KEY = 'usage';

/** 月次使用量。 */
export interface Usage {
  /** 'YYYY-MM'（Asia/Tokyo）。 */
  readonly month: string;
  /** 当月のPDF出力成功数。 */
  readonly used: number;
}

/**
 * 保存済みJSONを現在月の Usage に解釈する（純関数）。
 * 不正値・月替りは `{ month: currentMonth, used: 0 }` に正規化する。
 */
export function parseUsage(json: string | null, currentMonth: string): Usage {
  if (json === null || json === '') return { month: currentMonth, used: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { month: currentMonth, used: 0 };
  }
  if (typeof parsed !== 'object' || parsed === null) return { month: currentMonth, used: 0 };
  const month = Reflect.get(parsed, 'month');
  const used = Reflect.get(parsed, 'used');
  if (month !== currentMonth) return { month: currentMonth, used: 0 };
  if (typeof used !== 'number' || !Number.isInteger(used) || used < 0) {
    return { month: currentMonth, used: 0 };
  }
  return { month: currentMonth, used };
}

/** 残数（負にならない）。 */
export function remainingOf(usage: Usage, limit: number): number {
  return Math.max(0, limit - usage.used);
}

/** 現在月キー 'YYYY-MM'（Asia/Tokyo。引継書§6の指定実装）。GAS専用。 */
export function currentMonthKey(): string {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM');
}

/** 開発用: 当月使用量カウンタを削除する（(dev)メニュー専用。版指定デプロイ前に削除）。 */
export function clearUsageForDev(): void {
  PropertiesService.getUserProperties().deleteProperty(USAGE_PROP_KEY);
}

/** 現在の使用量を読む（GAS専用）。 */
export function readUsage(): Usage {
  const props = PropertiesService.getUserProperties();
  return parseUsage(props.getProperty(USAGE_PROP_KEY), currentMonthKey());
}

/**
 * 枠を1消費して操作を実行する（GAS専用）。
 *
 * LockService（ユーザーロック）内で「残数確認 → 操作（PDF保存）→ 成功時のみ +1」を行う。
 * 残数が無ければ `QuotaExceededError` 相当の Error を投げる（呼び出し側がPro案内を表示。
 * 文言は marketing §8 verbatim をサイドバー側で保持する）。
 *
 * @param limit その利用者の月間上限（Free=3 / Pro=1000）
 * @param operation 消費対象の操作（PDF保存）。throw したらカウントしない。
 */
export function consumeQuota<T>(limit: number, operation: () => T): T {
  const lock = LockService.getUserLock();
  lock.waitLock(30 * 1000);
  try {
    const props = PropertiesService.getUserProperties();
    const month = currentMonthKey();
    const usage = parseUsage(props.getProperty(USAGE_PROP_KEY), month);
    if (usage.used >= limit) {
      throw new Error('QUOTA_EXCEEDED');
    }
    const result = operation();
    const next: Usage = { month, used: usage.used + 1 };
    props.setProperty(USAGE_PROP_KEY, JSON.stringify(next));
    return result;
  } finally {
    lock.releaseLock();
  }
}
