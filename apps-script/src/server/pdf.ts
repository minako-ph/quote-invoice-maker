/**
 * PDF生成（FR-7・V-1確定構成。decisions.md 2026-07-24）。
 *
 * V-1実測: 一次案（コンテナ自身のexport URL）はHTTP 404で不成立。フォールバック(1)＝
 * **アプリ（drive.file）が作成した作業スプレッドシートに Sheets Advanced Service で帳票を描画し、
 * そのファイルの export URL を UrlFetchApp＋OAuthトークンで取得**する方式で確定
 * （FB(1)実測 ①○②×③○④○・probe⑤ ②③成立）。スコープは4点のまま（CR-3）。
 */

import { ensureScratchSpreadsheet, SCRATCH_SHEET_ID } from './scratch';
import { buildTemplateRequests } from './template';
import type { CalcResult } from './calc';
import type { IssuerProfile } from './profile';
import type { DocumentData } from './sheets';

/** export URL を組み立てる（V-1一次案。パラメータの実挙動はスパイクで確認）。 */
export function buildExportUrl(spreadsheetId: string, gid: number, range: string): string {
  const params = [
    'format=pdf',
    `gid=${gid}`,
    `range=${encodeURIComponent(range)}`,
    'size=A4',
    'portrait=true',
    'fitw=true',
    'gridlines=false',
    'sheetnames=false',
    'printtitle=false',
    'top_margin=0.50',
    'bottom_margin=0.50',
    'left_margin=0.50',
    'right_margin=0.50',
  ].join('&');
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?${params}`;
}

/** バイト列が %PDF マジックバイトで始まるか（F-4: 200だが非PDFの無言劣化ガード）。 */
export function isPdfBytes(bytes: readonly number[]): boolean {
  return (
    bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
  );
}

/**
 * 帳票シートをA4縦PDFの Blob として取得する。
 * 失敗時は原因（HTTPステータス・非PDF応答）を含むエラーを投げる（N-2/N-4: 無言で失敗しない）。
 */
export function fetchPdfBlob(spreadsheetId: string, gid: number, range: string, fileName: string): GoogleAppsScript.Base.Blob {
  const url = buildExportUrl(spreadsheetId, gid, range);
  const response = UrlFetchApp.fetch(url, {
    headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` },
    muteHttpExceptions: true,
  });
  const code = response.getResponseCode();
  if (code !== 200) {
    throw new Error(
      `PDFの生成に失敗しました（HTTP ${code}）。時間をおいて再度お試しください。` +
        '繰り返し失敗する場合はサポートへご連絡ください。',
    );
  }
  // F-4: HTTP 200 でも HTML 等が返るエッジがあるため、%PDF マジックバイトを検査してから返す。
  if (!isPdfBytes(response.getContent())) {
    throw new Error(
      'PDFの生成結果が不正です（応答がPDF形式ではありませんでした）。時間をおいて再度お試しください。' +
        '繰り返し失敗する場合はサポートへご連絡ください。',
    );
  }
  return response.getBlob().setName(fileName);
}

/**
 * 帳票の描画〜PDF取得の一気通貫（V-1確定経路。本実装・V-1スパイクの両方が使う）:
 * 作業ファイル確保（scratch.ts）→ Sheets Advanced Service batchUpdate で描画 →
 * export URL からPDF Blob取得（%PDF検査つき）。
 *
 * 単一スクラッチファイルの競合防止のため、呼び出し側は LockService（ユーザーロック）内で
 * 実行すること（本実装は quota.consumeQuota 内から呼ばれる）。
 */
export function exportDocumentPdf(
  doc: DocumentData,
  result: CalcResult,
  profile: IssuerProfile,
  fileName: string,
): GoogleAppsScript.Base.Blob {
  const { requests, range } = buildTemplateRequests(doc, result, profile, SCRATCH_SHEET_ID);
  const scratchId = ensureScratchSpreadsheet();
  const spreadsheets = Sheets.Spreadsheets;
  if (spreadsheets === undefined) {
    throw new Error('Sheets Advanced Service が利用できません（appsscript.json の enabledAdvancedServices を確認）');
  }
  spreadsheets.batchUpdate({ requests: [...requests] }, scratchId);
  return fetchPdfBlob(scratchId, SCRATCH_SHEET_ID, range, fileName);
}
