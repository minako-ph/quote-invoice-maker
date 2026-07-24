/**
 * サイドバーAPI（google.script.run の受け口）。
 *
 * すべての戻り値はサイドバーへそのまま渡る JSON 化可能なオブジェクトにする。
 * 失敗は Error を投げ、サイドバー側の withFailureHandler で利用者へ提示する
 * （N-2/N-4: 無言で失敗しない）。
 */

import { calcDocument, type CalcSettings } from './calc';
import { savePdfToDrive } from './drive';
import { appendLedgerRow } from './ledger';
import { effectiveLimit, licenseStatus, removeLicenseKey, storeLicenseKey, type LicenseStatus } from './license';
import { buildPdfFileName } from './naming';
import { exportDocumentPdf } from './pdf';
import { isProfileConfigured, loadProfile, storeProfile, type IssuerProfile, type ProfileValidation } from './profile';
import { FREE_MONTHLY_LIMIT, clearUsageForDev, consumeQuota, readUsage, remainingOf, type Usage } from './quota';
import { activeInputSheet, convertQuoteToInvoice, createInputSheet, readDocument, writeSummary, type DocumentData } from './sheets';
import { createSampleQuote } from './sample';
import type { DocumentType } from './layout';

/** サイドバーに返す使用量情報（FR-9: 常時表示）。 */
export interface UsageInfo {
  readonly month: string;
  readonly used: number;
  readonly limit: number;
  readonly remaining: number;
  readonly plan: 'free' | 'pro';
}

/** サイドバー初期化情報。 */
export interface SidebarInit {
  readonly usage: UsageInfo;
  readonly license: LicenseStatus;
  readonly profile: IssuerProfile;
  readonly profileConfigured: boolean;
}

function usageInfo(license: LicenseStatus): UsageInfo {
  const usage: Usage = readUsage();
  const limit = license.plan === 'pro' ? license.limit : FREE_MONTHLY_LIMIT;
  return {
    month: usage.month,
    used: usage.used,
    limit,
    remaining: remainingOf(usage, limit),
    plan: license.plan,
  };
}

/** サイドバー初期化（開いた直後に1回呼ぶ）。 */
export function sidebarInit(): SidebarInit {
  const license = licenseStatus();
  const profile = loadProfile();
  return {
    usage: usageInfo(license),
    license,
    profile,
    profileConfigured: isProfileConfigured(profile),
  };
}

/** 使用量のみ再取得（PDF出力後の表示更新用）。 */
export function usageOnly(): UsageInfo {
  return usageInfo(licenseStatus());
}

/** 新規書類シートを作成する（FR-1）。 */
export function newDocument(typeRaw: string): { sheetName: string } {
  const type: DocumentType = typeRaw === 'invoice' ? 'invoice' : 'quote';
  return { sheetName: createInputSheet(type) };
}

/** サンプル見積書を作成する（FR-13）。 */
export function newSample(): { sheetName: string } {
  return { sheetName: createSampleQuote() };
}

/** 見積→請求変換（FR-2）。 */
export function convertActiveQuote(): { sheetName: string } {
  return { sheetName: convertQuoteToInvoice() };
}

/** 書類の設定値（プロファイル＋書類単位トグル）から計算設定を組み立てる。 */
function settingsOf(doc: DocumentData, profile: IssuerProfile): CalcSettings {
  return {
    rounding: profile.rounding,
    withholdingEnabled: doc.withholdingEnabled,
    withholdingBase: profile.withholdingBase,
  };
}

/** 再計算（プレビュー）: アクティブ入力シートを計算し集計・注記を書き込む（FR-3/4・N-1）。 */
export function recalculateActive(): {
  readonly total: number;
  readonly withholdingTax: number;
  readonly amountDue: number;
  readonly notes: readonly string[];
} {
  const sheet = activeInputSheet();
  const doc = readDocument(sheet);
  const profile = loadProfile();
  const result = calcDocument(doc.items, settingsOf(doc, profile));
  writeSummary(sheet, result);
  return {
    total: result.total,
    withholdingTax: result.withholdingTax,
    amountDue: result.amountDue,
    notes: result.notes,
  };
}

/** PDF出力の結果。 */
export interface ExportResult {
  readonly fileName: string;
  readonly fileUrl: string;
  readonly usage: UsageInfo;
  /** F-6: 初回のPDF保存成功直後に1回だけ true（サイドバーがレビュー依頼を表示。marketing §8）。 */
  readonly showReviewPrompt: boolean;
}

const REVIEW_PROMPT_PROP = 'reviewPromptShown';

/**
 * 初回export成功のフラグを消費する（F-6）。初回のみ true を返し、以後は false。
 * 再表示はしない（marketing §8: 1回だけ・再表示/報酬付き依頼は禁止）。
 */
function consumeReviewPromptFlag(): boolean {
  const props = PropertiesService.getUserProperties();
  if (props.getProperty(REVIEW_PROMPT_PROP) !== null) return false;
  props.setProperty(REVIEW_PROMPT_PROP, '1');
  return true;
}

/**
 * PDF出力・保存の一気通貫（FR-7/8/9/12。引継書§6の消費順序・V-1確定構成）:
 * 再計算 → 無料枠ロック内で「残数確認 → 作業ファイル確保・帳票描画（Sheets Advanced Service）・
 * PDF取得・Drive保存 → +1」→ 台帳追記。
 * スクラッチファイル（1ユーザー1つ）の競合防止は consumeQuota のユーザーロックで担保する
 * （decisions.md 2026-07-24）。
 *
 * 無料枠超過は Error('QUOTA_EXCEEDED') をそのまま投げる（サイドバーが marketing §8 の
 * verbatim 文言でPro案内を表示する）。
 */
export function exportActiveToPdf(): ExportResult {
  const sheet = activeInputSheet();
  const doc = readDocument(sheet);
  if (doc.items.length === 0) {
    throw new Error('明細が1行もありません。品目・数量・単価を入力してから出力してください。');
  }
  const profile = loadProfile();
  // F-5: 記載事項①（発行者の氏名/名称・適格は登録番号も）を欠いた帳票を構造的に出さない
  if (profile.name === '') {
    throw new Error(
      '発行者プロファイル（氏名/名称）を設定してください（サイドバー「発行者プロファイル」から）',
    );
  }
  if (profile.taxable && profile.registrationNumber === '') {
    throw new Error(
      '適格請求書発行事業者の場合は登録番号（T＋13桁）が必要です。未登録・免税事業者の方はチェックを外してください（区分記載請求書の様式で出力します）',
    );
  }
  const result = calcDocument(doc.items, settingsOf(doc, profile));
  writeSummary(sheet, result);
  SpreadsheetApp.flush();

  const fileName = buildPdfFileName(doc.issueDate, doc.clientName, result.total);
  const license = licenseStatus();
  const limit = effectiveLimit();

  const saved = consumeQuota(limit, () => {
    // V-1確定経路: スクラッチ確保→Sheets batchUpdate描画→export→保存（全工程をユーザーロック内で）
    const blob = exportDocumentPdf(doc, result, profile, fileName);
    return savePdfToDrive(blob, fileName, doc.type);
  });

  appendLedgerRow({
    issueDate: doc.issueDate,
    type: doc.type,
    docNumber: doc.docNumber,
    clientName: doc.clientName,
    totalInclTax: result.total,
    fileUrl: saved.url,
  });

  return {
    fileName: saved.fileName,
    fileUrl: saved.url,
    usage: usageInfo(license),
    showReviewPrompt: consumeReviewPromptFlag(),
  };
}

/** プロファイル取得（FR-11）。 */
export function profileGet(): IssuerProfile {
  return loadProfile();
}

/** プロファイル保存（FR-11）。検証エラーは ok=false で返す（throw しない）。 */
export function profileSave(input: unknown): ProfileValidation {
  return storeProfile(input);
}

/** ライセンスキー保存＋検証（FR-10）。 */
export function licenseSave(key: string): LicenseStatus {
  return storeLicenseKey(key);
}

/** ライセンス状態取得（強制再検証つき）。 */
export function licenseGet(forceRefresh: boolean): LicenseStatus {
  return licenseStatus(forceRefresh === true);
}

/** ライセンスキー削除。 */
export function licenseClear(): LicenseStatus {
  return removeLicenseKey();
}

/**
 * 開発用リセット（(dev)メニュー専用。版指定デプロイ前に(dev)一括削除の対象）:
 * 当月使用量カウンタと reviewPromptShown を削除する。
 * E2Eで無料枠（月3枚）を使い切っても再検証できるようにするための機能で、
 * 本番UIからは到達できない（FR-9の「プロパティ消去による無料枠リセットは許容」の割り切りと同水準）。
 */
export function devResetUsageAndReviewFlag(): string {
  clearUsageForDev();
  PropertiesService.getUserProperties().deleteProperty(REVIEW_PROMPT_PROP);
  return '当月使用量カウンタと reviewPromptShown をリセットしました（開発用）';
}
