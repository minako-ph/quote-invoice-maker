/**
 * PDF生成（FR-7・V-1。引継書§6「一次案」）。
 *
 * 一次案: UrlFetchApp で Sheets export URL＋`Authorization: Bearer ScriptApp.getOAuthToken()`。
 * **V-1 未検証**: 4スコープ構成のトークンでこのエンドポイントが認可されるかは
 * spike.ts exportPdfProbe() の実機実行（人間）で確定してから本接続する（引継書§8・§12-3）。
 * 不成立時のフォールバック順は引継書§6（(1) drive.fileで新規作成したスプレッドシートへ複製→export、
 * (2) 停止して人間判断）。**スコープ追加や別方式への黙った切替はしない（CR-3）。**
 */

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

/**
 * 帳票シートをA4縦PDFの Blob として取得する。
 * 失敗時は原因（HTTPステータス）を含むエラーを投げる（N-2/N-4: 無言で失敗しない）。
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
  return response.getBlob().setName(fileName);
}
