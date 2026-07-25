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
import type { LicenseStatus } from './license';
import type { IssuerProfile, ProfileValidation } from './profile';

/** アドオンメニュー（エディタアドオンのonOpen）。 */
export function onOpen(): void {
  SpreadsheetApp.getUi()
    .createAddonMenu()
    .addItem('サイドバーを開く', 'showSidebar')
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

// V-1/V-2 スパイク・(dev)メニューは版指定デプロイ前クリーンアップで削除済み
// （2026-07-25。経緯と実測は docs/decisions.md・docs/setup/spike-v1-v2.md 参照）。
