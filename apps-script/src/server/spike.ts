/**
 * V-1/V-2 スパイク（引継書§12-3。人間がテストシートのスクリプトエディタから実行する）。
 *
 * - exportPdfProbe(): V-1「Sheets export URL が4スコープ構成のトークンで認可されるか」
 * - driveProbe():     V-2「Advanced Drive Service（drive.file）でフォルダ作成・PDF保存ができるか」
 *
 * どちらも結果を Logger と戻り値の文字列で返す。人間は実行結果（HTTPステータス・生成物の確認）を
 * docs/decisions.md に記録する（実行手順は docs/setup/spike-v1-v2.md）。
 * 不成立時は引継書§6のフォールバック順に従い、(2)到達で**停止して人間判断**（スコープ追加をしない＝CR-3）。
 */

import { buildExportUrl } from './pdf';

/**
 * V-1: アクティブシートの A1:C5 をPDF export URL で取得してみる。
 * 成功条件: HTTP 200 かつ Content-Type が application/pdf かつ %PDF マジックバイト。
 */
export function probeExportPdf(): string {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const url = buildExportUrl(ss.getId(), sheet.getSheetId(), 'A1:C5');

  const lines: string[] = ['=== V-1 exportPdfProbe ==='];
  lines.push(`URL: ${url.replace(ss.getId(), '<spreadsheetId>')}`);
  try {
    const response = UrlFetchApp.fetch(url, {
      headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` },
      muteHttpExceptions: true,
    });
    const code = response.getResponseCode();
    const headers: unknown = response.getHeaders();
    const contentType =
      typeof headers === 'object' && headers !== null ? Reflect.get(headers, 'Content-Type') : undefined;
    const bytes = response.getContent();
    const head = bytes.slice(0, 4);
    const isPdf = head.length === 4 && head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46; // %PDF
    lines.push(`HTTP: ${code}`);
    lines.push(`Content-Type: ${String(contentType)}`);
    lines.push(`bytes: ${bytes.length}`);
    lines.push(`%PDFマジックバイト: ${isPdf ? 'OK' : 'NG'}`);
    lines.push(
      code === 200 && isPdf
        ? '→ V-1 成立候補（A4レイアウト品質は帳票で別途確認）'
        : '→ V-1 不成立の可能性。HTTPステータスと本文をdecisions.mdへ記録し、フォールバック(1)を検討',
    );
    if (code !== 200) {
      lines.push(`本文先頭200文字: ${response.getContentText().slice(0, 200)}`);
    }
  } catch (e) {
    lines.push(`例外: ${e instanceof Error ? e.message : String(e)}`);
    lines.push('→ urlFetchWhitelist（https://docs.google.com/）と権限承認を確認');
  }
  const report = lines.join('\n');
  Logger.log(report);
  return report;
}

/**
 * V-2: Advanced Drive Service（Drive v3・drive.file）で
 * フォルダ作成 → 小さなPDF Blobのアップロード → 取得（生存確認）を行う。
 * 生成物は「_v2probe_帳票」フォルダに残す（人間がDriveで目視確認後、手で削除してよい）。
 */
export function probeDrive(): string {
  const lines: string[] = ['=== V-2 driveProbe ==='];
  try {
    const folder = Drive.Files.create({
      name: '_v2probe_帳票',
      mimeType: 'application/vnd.google-apps.folder',
    });
    lines.push(`フォルダ作成: OK (id=${String(folder.id)})`);

    const blob = Utilities.newBlob('%PDF-1.4 probe', 'application/pdf', '_v2probe.pdf');
    const file = Drive.Files.create(
      { name: '_v2probe.pdf', parents: folder.id !== undefined ? [folder.id] : [], mimeType: 'application/pdf' },
      blob,
      { fields: 'id, webViewLink' },
    );
    lines.push(`PDFアップロード: OK (id=${String(file.id)})`);
    lines.push(`webViewLink: ${String(file.webViewLink)}`);

    if (file.id !== undefined) {
      const fetched = Drive.Files.get(file.id);
      lines.push(`取得確認: OK (name=${String(fetched.name)}, mimeType=${String(fetched.mimeType)})`);
    }
    lines.push('→ V-2 成立候補。Driveで「_v2probe_帳票」フォルダと中身を目視確認しdecisions.mdへ記録');
  } catch (e) {
    lines.push(`例外: ${e instanceof Error ? e.message : String(e)}`);
    lines.push('→ V-2 不成立の可能性。エラーメッセージをdecisions.mdへ記録し停止（スコープ追加はしない＝CR-3）');
  }
  const report = lines.join('\n');
  Logger.log(report);
  return report;
}
