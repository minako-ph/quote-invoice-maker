/**
 * ライセンス（FR-10。引継書§6 license.ts）。
 *
 * - キーは UserProperties に保存。検証は `/license/verify` へ委譲する
 *   （GAS側で JWT ローカル検証をしない＝`LICENSE_PUBKEY` は持たない）。
 * - 検証結果は短時間（10分）UserProperties にキャッシュする。
 * - 検証不能時は fail-closed（Free扱い）＋サイドバーに状態表示（N-4）。
 * - 外部送信はキー文字列のみ（N-3。シート内容を送らない）。
 */

import { FREE_MONTHLY_LIMIT, PRO_MONTHLY_LIMIT } from './quota';

const LICENSE_KEY_PROP = 'licenseKey';
const LICENSE_CACHE_PROP = 'licenseStatusCache';

/** 検証キャッシュTTL（10分。引継書§6）。 */
export const LICENSE_CACHE_TTL_MS = 10 * 60 * 1000;

/** サイドバーに返すライセンス状態（N-4: 検証不能も明示する）。 */
export interface LicenseStatus {
  /** 'none'=キー未登録 / 'valid'=Pro有効 / 'invalid'=キー無効 / 'error'=検証不能（fail-closed） */
  readonly state: 'none' | 'valid' | 'invalid' | 'error';
  /** 実効プラン。valid のときのみ 'pro'。 */
  readonly plan: 'free' | 'pro';
  /** 実効月間上限。 */
  readonly limit: number;
  /** 課金期間末（Unix秒。valid時のみ）。 */
  readonly periodEnd?: number;
  /** 利用者向けメッセージ（エラー時の状態表示など）。 */
  readonly message?: string;
}

interface CachedStatus {
  readonly status: LicenseStatus;
  readonly cachedAt: number;
}

/** Script Properties からバックエンドURLを取得する（未設定なら空文字）。 */
export function backendUrl(): string {
  const url = PropertiesService.getScriptProperties().getProperty('BACKEND_URL');
  return url === null ? '' : url;
}

function freeStatus(state: LicenseStatus['state'], message?: string): LicenseStatus {
  return message === undefined
    ? { state, plan: 'free', limit: FREE_MONTHLY_LIMIT }
    : { state, plan: 'free', limit: FREE_MONTHLY_LIMIT, message };
}

/** 保存済みキーを返す（未登録は null）。 */
function storedKey(): string | null {
  return PropertiesService.getUserProperties().getProperty(LICENSE_KEY_PROP);
}

function readCache(): CachedStatus | null {
  const json = PropertiesService.getUserProperties().getProperty(LICENSE_CACHE_PROP);
  if (json === null) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const status = Reflect.get(parsed, 'status');
    const cachedAt = Reflect.get(parsed, 'cachedAt');
    if (typeof cachedAt !== 'number' || typeof status !== 'object' || status === null) return null;
    const state = Reflect.get(status, 'state');
    const plan = Reflect.get(status, 'plan');
    const limit = Reflect.get(status, 'limit');
    if (
      (state === 'none' || state === 'valid' || state === 'invalid' || state === 'error') &&
      (plan === 'free' || plan === 'pro') &&
      typeof limit === 'number'
    ) {
      const periodEnd = Reflect.get(status, 'periodEnd');
      const message = Reflect.get(status, 'message');
      const restored: LicenseStatus = {
        state,
        plan,
        limit,
        ...(typeof periodEnd === 'number' ? { periodEnd } : {}),
        ...(typeof message === 'string' ? { message } : {}),
      };
      return { status: restored, cachedAt };
    }
    return null;
  } catch {
    return null;
  }
}

function writeCache(status: LicenseStatus): void {
  const entry: CachedStatus = { status, cachedAt: Date.now() };
  PropertiesService.getUserProperties().setProperty(LICENSE_CACHE_PROP, JSON.stringify(entry));
}

/**
 * `/license/verify` を呼びキーを検証する。
 * 送信するのはキー文字列のみ（N-3）。ネットワーク・バックエンド障害は 'error'（fail-closed）。
 */
function verifyViaBackend(key: string): LicenseStatus {
  const base = backendUrl();
  if (base === '') {
    return freeStatus('error', 'バックエンドURLが未設定のため検証できません（一時的にFree扱い）');
  }
  let responseText = '';
  let statusCode = 0;
  try {
    const response = UrlFetchApp.fetch(`${base}/license/verify`, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ licenseKey: key }),
      muteHttpExceptions: true,
    });
    statusCode = response.getResponseCode();
    responseText = response.getContentText();
  } catch {
    return freeStatus('error', 'ライセンスサーバに接続できません（一時的にFree扱い）');
  }
  if (statusCode !== 200) {
    return freeStatus('error', `ライセンス検証に失敗しました（HTTP ${statusCode}。一時的にFree扱い）`);
  }
  try {
    const parsed: unknown = JSON.parse(responseText);
    if (typeof parsed !== 'object' || parsed === null) return freeStatus('error', '検証応答が不正です');
    const valid = Reflect.get(parsed, 'valid');
    const periodEnd = Reflect.get(parsed, 'periodEnd');
    if (valid === true) {
      return {
        state: 'valid',
        plan: 'pro',
        limit: PRO_MONTHLY_LIMIT,
        ...(typeof periodEnd === 'number' ? { periodEnd } : {}),
      };
    }
    return freeStatus('invalid', 'ライセンスキーが無効です（期限切れ・解約済みの可能性があります）');
  } catch {
    return freeStatus('error', '検証応答を解析できません');
  }
}

/**
 * 現在のライセンス状態を返す（キャッシュ10分。forceRefresh で再検証）。
 */
export function licenseStatus(forceRefresh: boolean = false): LicenseStatus {
  const key = storedKey();
  if (key === null || key === '') return freeStatus('none');
  if (!forceRefresh) {
    const cached = readCache();
    if (cached !== null && Date.now() - cached.cachedAt < LICENSE_CACHE_TTL_MS) {
      return cached.status;
    }
  }
  const status = verifyViaBackend(key);
  writeCache(status);
  return status;
}

/**
 * キーを保存して即時検証する。無効キーは保存しない。
 * 検証不能（error）の場合は保存だけ行い状態を返す（次回検証に委ねる。fail-closed）。
 */
export function storeLicenseKey(key: string): LicenseStatus {
  const trimmed = key.trim();
  if (trimmed === '') return freeStatus('none', 'ライセンスキーを入力してください');
  const status = verifyViaBackend(trimmed);
  if (status.state === 'invalid') {
    return status;
  }
  PropertiesService.getUserProperties().setProperty(LICENSE_KEY_PROP, trimmed);
  writeCache(status);
  return status;
}

/** キーとキャッシュを削除する。 */
export function removeLicenseKey(): LicenseStatus {
  const props = PropertiesService.getUserProperties();
  props.deleteProperty(LICENSE_KEY_PROP);
  props.deleteProperty(LICENSE_CACHE_PROP);
  return freeStatus('none');
}

/** 実効の月間上限（quota消費時に使用）。 */
export function effectiveLimit(): number {
  return licenseStatus().limit;
}
