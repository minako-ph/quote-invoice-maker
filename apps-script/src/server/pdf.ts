/**
 * PDF生成（FR-7・V-1。引継書§6「一次案」）。
 *
 * 一次案: UrlFetchApp で Sheets export URL＋`Authorization: Bearer ScriptApp.getOAuthToken()`。
 * **V-1 未検証**: 4スコープ構成のトークンでこのエンドポイントが認可されるかは
 * spike.ts exportPdfProbe() の実機実行（人間）で確定してから本接続する（引継書§8・§12-3）。
 * 不成立時のフォールバック順は引継書§6（(1) drive.fileで新規作成したスプレッドシートへ複製→export、
 * (2) 停止して人間判断）。**スコープ追加や別方式への黙った切替はしない（CR-3）。**
 */

import { TEMPLATE_SHEET_NAME } from './layout';
import type { TemplateRenderResult } from './template';

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
 * 描画済みの帳票（_帳票）をPDF化する共通ヘルパ（F-2。本実装・V-1スパイクの両方が使う）。
 *
 * 非表示シートの gid export は挙動が異なり得るため、export の間だけ
 * `showSheet()` → `flush()` → fetch → finally で `hideSheet()` する
 * （同一方式内の堅牢化であり CR-3 の方式・スコープ変更ではない。
 * 一瞬タブが見える副作用は許容＝decisions.md）。
 */
export function exportRenderedPdf(rendered: TemplateRenderResult, fileName: string): GoogleAppsScript.Base.Blob {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TEMPLATE_SHEET_NAME);
  if (sheet === null) {
    throw new Error('帳票シート（_帳票）が見つかりません。「プレビュー/再計算」を実行してから出力してください');
  }
  sheet.showSheet();
  SpreadsheetApp.flush();
  try {
    return fetchPdfBlob(ss.getId(), rendered.sheetId, rendered.range, fileName);
  } finally {
    sheet.hideSheet();
    SpreadsheetApp.flush();
  }
}
