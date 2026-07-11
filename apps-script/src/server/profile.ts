/**
 * 発行者プロファイル（FR-11。UserProperties に JSON 保存）。
 *
 * 登録番号は `/^T\d{13}$/` の**形式チェックのみ**。チェックデジット・真正性検証の
 * コードを書かない（CR-1。照会エンドポイント・照会クライアントを存在させない）。
 */

import type { RoundingMode, WithholdingBase } from './calc';

/** UserProperties のキー。 */
const PROFILE_PROP_KEY = 'profile';

/** 登録番号の形式（T+13桁）。形式チェックのみ可（CR-1）。 */
export const REGISTRATION_NUMBER_PATTERN = /^T\d{13}$/;

/** 発行者プロファイル（FR-11の全項目）。 */
export interface IssuerProfile {
  /** 氏名/名称。 */
  readonly name: string;
  /** 住所。 */
  readonly address: string;
  /** 適格請求書発行事業者の登録番号（T+13桁）。免税事業者は空。 */
  readonly registrationNumber: string;
  /** 課税（適格請求書発行事業者）= true ／ 免税 = false（FR-6）。 */
  readonly taxable: boolean;
  /** 消費税の端数処理方式（既定 floor）。 */
  readonly rounding: RoundingMode;
  /** 源泉税の既定ON/OFF（書類作成時の初期値）。 */
  readonly withholdingDefault: boolean;
  /** 源泉対象額の基準（既定 exTax）。 */
  readonly withholdingBase: WithholdingBase;
  /** 振込先（請求書に差し込む）。 */
  readonly bankInfo: string;
  /** 書類番号プレフィックス（例 'ABC-'。空可）。 */
  readonly docNumberPrefix: string;
}

/** 未設定時の既定プロファイル。 */
export const DEFAULT_PROFILE: IssuerProfile = {
  name: '',
  address: '',
  registrationNumber: '',
  taxable: true,
  rounding: 'floor',
  withholdingDefault: false,
  withholdingBase: 'exTax',
  bankInfo: '',
  docNumberPrefix: '',
};

/** バリデーション結果。 */
export interface ProfileValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

/**
 * プロファイルを検証する（純関数）。
 * 登録番号: 形式チェックのみ行う（CR-1。真正性は検証しない）。
 * F-5: 課税（適格）を選んだ場合は登録番号必須——§6-3①（氏名/名称**及び登録番号**）を
 * 満たさない「登録番号のない適格様式風」の帳票を構造的に出さないため。
 */
export function validateProfile(profile: IssuerProfile): ProfileValidation {
  const errors: string[] = [];
  if (profile.taxable && profile.registrationNumber === '') {
    errors.push(
      '適格請求書発行事業者の場合は登録番号（T＋13桁）が必要です。未登録・免税事業者の方はチェックを外してください（区分記載請求書の様式で出力します）',
    );
  }
  if (profile.taxable && profile.registrationNumber !== '') {
    if (!REGISTRATION_NUMBER_PATTERN.test(profile.registrationNumber)) {
      errors.push('登録番号は「T＋数字13桁」の形式で入力してください（例: T1234567890123）');
    }
  }
  if (!profile.taxable && profile.registrationNumber !== '') {
    // 区分記載請求書に登録番号様の番号を記載しない（要件書§6-4）。
    errors.push('免税事業者モードでは登録番号を設定できません（空にしてください）');
  }
  return { ok: errors.length === 0, errors };
}

/** unknown から IssuerProfile を安全に復元する（欠損・型不一致は既定値で補う）。 */
export function normalizeProfile(parsed: unknown): IssuerProfile {
  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_PROFILE;
  const get = (key: string): unknown => Reflect.get(parsed, key);
  const str = (key: string, fallback: string): string => {
    const v = get(key);
    return typeof v === 'string' ? v : fallback;
  };
  const bool = (key: string, fallback: boolean): boolean => {
    const v = get(key);
    return typeof v === 'boolean' ? v : fallback;
  };
  const roundingRaw = get('rounding');
  const rounding: RoundingMode =
    roundingRaw === 'floor' || roundingRaw === 'round' || roundingRaw === 'ceil'
      ? roundingRaw
      : DEFAULT_PROFILE.rounding;
  const baseRaw = get('withholdingBase');
  const withholdingBase: WithholdingBase =
    baseRaw === 'exTax' || baseRaw === 'inTax' ? baseRaw : DEFAULT_PROFILE.withholdingBase;
  return {
    name: str('name', DEFAULT_PROFILE.name),
    address: str('address', DEFAULT_PROFILE.address),
    registrationNumber: str('registrationNumber', DEFAULT_PROFILE.registrationNumber),
    taxable: bool('taxable', DEFAULT_PROFILE.taxable),
    rounding,
    withholdingDefault: bool('withholdingDefault', DEFAULT_PROFILE.withholdingDefault),
    withholdingBase,
    bankInfo: str('bankInfo', DEFAULT_PROFILE.bankInfo),
    docNumberPrefix: str('docNumberPrefix', DEFAULT_PROFILE.docNumberPrefix),
  };
}

/** プロファイルを読み込む（GAS専用。未設定は既定値）。 */
export function loadProfile(): IssuerProfile {
  const json = PropertiesService.getUserProperties().getProperty(PROFILE_PROP_KEY);
  if (json === null || json === '') return DEFAULT_PROFILE;
  try {
    return normalizeProfile(JSON.parse(json));
  } catch {
    return DEFAULT_PROFILE;
  }
}

/**
 * プロファイルを保存する（GAS専用）。検証エラー時は保存せず errors を返す。
 */
export function storeProfile(input: unknown): ProfileValidation {
  const profile = normalizeProfile(input);
  const validation = validateProfile(profile);
  if (!validation.ok) return validation;
  PropertiesService.getUserProperties().setProperty(PROFILE_PROP_KEY, JSON.stringify(profile));
  return validation;
}

/** プロファイルが最低限設定済みか（オンボーディング表示用）。 */
export function isProfileConfigured(profile: IssuerProfile): boolean {
  return profile.name !== '';
}
