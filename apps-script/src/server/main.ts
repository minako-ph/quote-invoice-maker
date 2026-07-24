/**
 * エントリポイント（build.mjs の ENTRY_POINTS と厳密一致させること。引継書§6）。
 * すべてのトップレベル関数はここから export する。
 */

import {
  convertActiveQuote,
  exportActiveToPdf,
  licenseClear,
  licenseGet,
  licenseSave,
  newDocument,
  newSample,
  profileGet,
  profileSave,
  recalculateActive,
  sidebarInit,
  usageOnly,
  type ExportResult,
  type SidebarInit,
  type UsageInfo,
} from './sidebarApi';
import { probeDrive, probeExportPdf, probeExportPdfFallback1 } from './spike';
import type { LicenseStatus } from './license';
import type { IssuerProfile, ProfileValidation } from './profile';

/**
 * アドオンメニュー（エディタアドオンのonOpen）。
 * (dev) 項目はV-1/V-2スパイク用の一時メニュー——standaloneエディタ実行では
 * SpreadsheetApp.getActiveSpreadsheet() が null になり本番フロー（_帳票描画→export）に
 * 入れないため、テストシート上のメニューから実行する。**スパイク成立後に削除する**（decisions.md TODO）。
 */
export function onOpen(): void {
  SpreadsheetApp.getUi()
    .createAddonMenu()
    .addItem('サイドバーを開く', 'showSidebar')
    .addSeparator()
    .addItem('(dev) V-1スパイク', 'devRunExportPdfProbe')
    .addItem('(dev) V-1フォールバック(1)スパイク', 'devRunExportPdfFallback1')
    .addItem('(dev) V-2スパイク', 'devRunDriveProbe')
    .addToUi();
}

/** インストール直後（onInstall は onOpen を呼ぶのが定石）。 */
export function onInstall(): void {
  onOpen();
}

/** サイドバーを表示する。 */
export function showSidebar(): void {
  const html = HtmlService.createHtmlOutputFromFile('sidebar')
    .setTitle('見積書・請求書メーカー')
    .setWidth(320);
  SpreadsheetApp.getUi().showSidebar(html);
}

// ---- サイドバーAPI（google.script.run 対象）----

export function getSidebarInit(): SidebarInit {
  return sidebarInit();
}

export function createDocument(type: string): { sheetName: string } {
  return newDocument(type);
}

export function convertToInvoice(): { sheetName: string } {
  return convertActiveQuote();
}

export function recalculate(): ReturnType<typeof recalculateActive> {
  return recalculateActive();
}

export function exportPdf(): ExportResult {
  return exportActiveToPdf();
}

export function getUsage(): UsageInfo {
  return usageOnly();
}

export function saveLicenseKey(key: string): LicenseStatus {
  return licenseSave(key);
}

export function getLicenseStatus(forceRefresh: boolean): LicenseStatus {
  return licenseGet(forceRefresh);
}

export function clearLicenseKey(): LicenseStatus {
  return licenseClear();
}

export function getProfile(): IssuerProfile {
  return profileGet();
}

export function saveProfile(input: unknown): ProfileValidation {
  return profileSave(input);
}

export function createSample(): { sheetName: string } {
  return newSample();
}

// ---- V-1/V-2 スパイク（§12-3）----
// devRun* はテストシートのアドオンメニューから実行し、結果全文を alert で表示する
// （改行そのまま。スプレッドシートのUIコンテキストで動くため getActiveSpreadsheet が有効）。
// exportPdfProbe/driveProbe はエディタ実行用に残す（V-2はエディタ実行で成立済み）。

export function devRunExportPdfProbe(): void {
  SpreadsheetApp.getUi().alert(probeExportPdf());
}

export function devRunExportPdfFallback1(): void {
  SpreadsheetApp.getUi().alert(probeExportPdfFallback1());
}

export function devRunDriveProbe(): void {
  SpreadsheetApp.getUi().alert(probeDrive());
}

export function exportPdfProbe(): string {
  return probeExportPdf();
}

export function exportPdfFallback1Probe(): string {
  return probeExportPdfFallback1();
}

export function driveProbe(): string {
  return probeDrive();
}
