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
import { fetchPdfBlob } from './pdf';
import { isProfileConfigured, loadProfile, storeProfile, type IssuerProfile, type ProfileValidation } from './profile';
import { FREE_MONTHLY_LIMIT, consumeQuota, readUsage, remainingOf, type Usage } from './quota';
import { renderTemplate } from './template';
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
}

/**
 * PDF出力・保存の一気通貫（FR-7/8/9/12。引継書§6の消費順序）:
 * 再計算 → 帳票差し込み → 無料枠ロック内で「残数確認 → PDF生成・Drive保存 → +1」→ 台帳追記。
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
  const result = calcDocument(doc.items, settingsOf(doc, profile));
  writeSummary(sheet, result);
  const rendered = renderTemplate(doc, result, profile);
  SpreadsheetApp.flush();

  const spreadsheetId = SpreadsheetApp.getActiveSpreadsheet().getId();
  const fileName = buildPdfFileName(doc.issueDate, doc.clientName, result.total);
  const license = licenseStatus();
  const limit = effectiveLimit();

  const saved = consumeQuota(limit, () => {
    const blob = fetchPdfBlob(spreadsheetId, rendered.sheetId, rendered.range, fileName);
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

  return { fileName: saved.fileName, fileUrl: saved.url, usage: usageInfo(license) };
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
