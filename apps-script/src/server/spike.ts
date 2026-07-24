/**
 * V-1/V-2 スパイク（引継書§12-3。人間がテストシートのスクリプトエディタから実行する）。
 *
 * - exportPdfProbe(): V-1「Sheets export URL が4スコープ構成のトークンで認可されるか」
 *   F-2: 本番フロー同型（固定ダミー書類 → calcDocument → renderTemplate（非表示の_帳票）→
 *   exportRenderedPdf（showSheet→export→finally hideSheet））で検証する。
 *   これで検証対象が「4スコープトークンの export URL 認可」に純化される。
 * - driveProbe():     V-2「Advanced Drive Service（drive.file）でフォルダ作成・PDF保存ができるか」
 *
 * どちらも結果を Logger と戻り値の文字列で返す。人間は実行結果を docs/decisions.md に記録する
 * （実行手順は docs/setup/spike-v1-v2.md）。
 * 不成立時は引継書§6のフォールバック順に従い、(2)到達で**停止して人間判断**（スコープ追加をしない＝CR-3）。
 */

import { calcDocument, type LineItemInput } from './calc';
import { buildExportUrl, exportRenderedPdf, isPdfBytes } from './pdf';
import { DEFAULT_PROFILE, type IssuerProfile } from './profile';
import type { DocumentData } from './sheets';
import { renderTemplate } from './template';

/** V-1検証用の固定明細（サンプル書類相当。源泉対象＋軽減税率＋対象外を含む）。 */
const PROBE_ITEMS: readonly LineItemInput[] = [
  { name: 'Webサイトデザイン制作', quantity: 1, unitPrice: 100000, taxCategory: '10', withholding: true },
  { name: '撮影用飲食物（軽減税率対象）', quantity: 2, unitPrice: 1500, taxCategory: '8', withholding: false },
  { name: '交通費実費（立替）', quantity: 1, unitPrice: 3200, taxCategory: 'none', withholding: false },
];

/** V-1検証用の固定プロファイル（登録番号は形式ダミー）。 */
const PROBE_PROFILE: IssuerProfile = {
  ...DEFAULT_PROFILE,
  name: 'スパイク検証 発行者',
  address: '東京都千代田区1-1-1',
  registrationNumber: 'T1234567890123',
  taxable: true,
  withholdingDefault: true,
  bankInfo: '〇〇銀行 〇〇支店 普通 1234567',
};

/**
 * V-1: 本番フロー同型で _帳票 を描画し、export URL からPDFを取得してみる。
 * 成功条件: exportRenderedPdf が %PDF 検査込みで Blob を返すこと。
 * 成功後、_帳票 シートを再表示すればA4差し込み結果を目視できる。
 */
export function probeExportPdf(): string {
  const lines: string[] = ['=== V-1 exportPdfProbe（本番フロー同型） ==='];
  try {
    const doc: DocumentData = {
      type: 'invoice',
      docNumber: 'PROBE-0001',
      issueDate: new Date(),
      transactionDate: '2026年7月',
      clientName: 'スパイク検証株式会社',
      subject: 'V-1スパイク検証（削除可）',
      dueOrExpiry: '',
      bankInfo: PROBE_PROFILE.bankInfo,
      withholdingEnabled: true,
      items: PROBE_ITEMS,
      remarks: 'V-1スパイクの固定ダミー書類です',
    };
    const result = calcDocument(doc.items, {
      rounding: 'floor',
      withholdingEnabled: true,
      withholdingBase: 'exTax',
    });
    const rendered = renderTemplate(doc, result, PROBE_PROFILE);
    lines.push(`帳票描画: OK（gid=${rendered.sheetId}, range=${rendered.range}）`);

    const blob = exportRenderedPdf(rendered, '_v1probe.pdf');
    const bytes = blob.getBytes();
    lines.push(`export fetch: OK（${bytes.length} bytes）`);
    lines.push(`%PDFマジックバイト: ${isPdfBytes(bytes) ? 'OK' : 'NG'}`);
    lines.push('→ V-1 成立候補。_帳票シートを再表示するとA4差し込み結果を目視できます');
    lines.push('（レイアウト品質はサンプル書類のE2Eで最終確認）');
  } catch (e) {
    lines.push(`失敗: ${e instanceof Error ? e.message : String(e)}`);
    lines.push('→ V-1 不成立の可能性。このログ全文をdecisions.mdへ記録し、フォールバック(1)を検討');
    lines.push('（スコープ追加や別方式への黙った切替はしない＝CR-3。(2)到達で停止して人間判断）');
  }
  const report = lines.join('\n');
  Logger.log(report);
  return report;
}

/**
 * V-1 フォールバック(1)の検証（引継書§6の決定木。一次案=コンテナ自身のexport URLはHTTP 404で不成立
 * ——ブラウザの同一URLではPDF取得成功のため、4スコープトークンの認可起因と判定済み）。
 *
 * 「drive.file でアプリが新規作成したスプレッドシートへ帳票を複製 → そのファイルの export URL」
 * 方式が成立するかを、1回の実行で次の順に検証する:
 *   ① Drive API（Advanced Service v3・drive.file）で新規スプレッドシート「_v1probe_帳票」を作成
 *   ② SpreadsheetApp.openById(新ID) — drive.file スコープ下でアプリ作成ファイルが開けるか
 *      （開けたらA1:C5に値を書いて flush。**②が通れば帳票描画をアプリ作成ファイル側で行う設計で
 *        レイアウトコード無変更のまま解決できる**）
 *   ③ そのファイルへの既存 buildExportUrl(newId, gid, 'A1:C5') を fetch — HTTPコードと%PDF判定
 *   ④ 保険: Drive REST export（googleapis.com/drive/v3/files/{id}/export?mimeType=application/pdf）
 * ②不成立で③④のみ成立の場合は実装コスト大のため**停止して人間判断**（決定木(2)）。
 * スコープは4点から増やさない（CR-3。googleapis.com の urlFetchWhitelist 追加はスコープ変更ではない）。
 * 生成した「_v1probe_帳票」は目視確認後に手で削除してよい。
 */
export function probeExportPdfFallback1(): string {
  const lines: string[] = ['=== V-1 フォールバック(1) probeExportPdfFallback1 ==='];
  const token = ScriptApp.getOAuthToken();

  // ① アプリ作成ファイルとして新規スプレッドシートを作る（drive.file の管轄に入れる）
  let fileId = '';
  try {
    const created = Drive.Files.create({
      name: '_v1probe_帳票',
      mimeType: 'application/vnd.google-apps.spreadsheet',
    });
    if (created.id === undefined) throw new Error('Drive APIがIDを返しませんでした');
    fileId = created.id;
    lines.push(`① 新規スプレッドシート作成: OK (id=${fileId})`);
  } catch (e) {
    lines.push(`① 新規スプレッドシート作成: 失敗 — ${e instanceof Error ? e.message : String(e)}`);
    lines.push('→ ここで不成立なら方式自体が成り立たない。全文をdecisions.mdへ記録し停止（決定木(2)）');
    const report = lines.join('\n');
    Logger.log(report);
    return report;
  }

  // ② drive.file スコープ下で SpreadsheetApp.openById が通るか（成立すれば帳票描画を移設できる）
  let gid = 0;
  let openOk = false;
  try {
    const ss = SpreadsheetApp.openById(fileId);
    const sheet = ss.getSheets()[0];
    if (sheet === undefined) throw new Error('シートが取得できません');
    gid = sheet.getSheetId();
    sheet.getRange('A1:C2').setValues([
      ['V-1 fallback probe', 123, '¥45,678'],
      ['帳票描画テスト', new Date().toISOString(), 'OK'],
    ]);
    SpreadsheetApp.flush();
    openOk = true;
    lines.push(`② SpreadsheetApp.openById+書込: OK (gid=${gid})`);
    lines.push('   → 帳票描画をアプリ作成ファイル側で行う設計（レイアウトコード無変更）で解決可能');
  } catch (e) {
    lines.push(`② SpreadsheetApp.openById: 失敗 — ${e instanceof Error ? e.message : String(e)}`);
    lines.push('   → ②不成立。③④のみ成立でも実装コスト大のため停止して人間判断（決定木(2)）');
  }

  // ③ 既存の export URL 方式をアプリ作成ファイルに対して試す
  try {
    const url = buildExportUrl(fileId, gid, 'A1:C5');
    const response = UrlFetchApp.fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      muteHttpExceptions: true,
    });
    const code = response.getResponseCode();
    const pdfOk = code === 200 && isPdfBytes(response.getContent());
    lines.push(`③ export URL（docs.google.com）: HTTP ${code} ／ %PDF: ${pdfOk ? 'OK' : 'NG'}`);
  } catch (e) {
    lines.push(`③ export URL: 例外 — ${e instanceof Error ? e.message : String(e)}`);
  }

  // ④ 保険: Drive REST export（Advanced Service の export はバイト列を返せないため UrlFetchApp で直叩き）
  try {
    const restUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/pdf`;
    const response = UrlFetchApp.fetch(restUrl, {
      headers: { Authorization: `Bearer ${token}` },
      muteHttpExceptions: true,
    });
    const code = response.getResponseCode();
    const pdfOk = code === 200 && isPdfBytes(response.getContent());
    lines.push(`④ Drive REST export（googleapis.com）: HTTP ${code} ／ %PDF: ${pdfOk ? 'OK' : 'NG'}`);
  } catch (e) {
    lines.push(`④ Drive REST export: 例外 — ${e instanceof Error ? e.message : String(e)}`);
  }

  lines.push('');
  lines.push(
    openOk
      ? '判定: ②成立 → フォールバック(1)採用可。③/④いずれか成立した経路をexport手段として決定木(1)で確定し、decisions.mdへ記録'
      : '判定: ②不成立 → 停止して人間判断（決定木(2)。スコープ追加はしない＝CR-3）',
  );
  lines.push('生成物「_v1probe_帳票」は目視確認後に削除してよい');
  const report = lines.join('\n');
  Logger.log(report);
  return report;
}

/**
 * 決定木(2)の検討用 probe⑤（フォールバック(1)の実測が ①○②×③○④○ だったことを受けて）:
 * ②SpreadsheetApp.openById がアプリ作成ファイルに対して不成立だったため、
 * 帳票描画を **Sheets Advanced Service（v4 batchUpdate）** で行えるかを検証する。
 * （初版のREST直叩きは「HTTP 403=既定プロジェクトのSheets API未有効」で不成立。
 *   Advanced Serviceならmanifest宣言で既定プロジェクトのAPIが自動有効化される。
 *   ※標準GCPプロジェクトへ紐付けた後はSheets/Drive APIの手動有効化が必要）
 *
 * 1回の実行で:
 *   ① Drive API（drive.file）で新規スプレッドシート「_v1probe5_帳票」を作成
 *   ② Sheets.Spreadsheets.batchUpdate で「値＋書式（太字/罫線/セル結合/列幅）」を書込
 *      → 成立判定は「例外なく完了し応答に spreadsheetId/replies がある」こと（③と独立に判定）
 *   ③ 既存 buildExportUrl で export → HTTPコード＋%PDF判定
 * ②③とも成立なら「帳票描画=Sheets Advanced Service・export=③の経路」で本実装を組める
 * （スコープは4点から増やさない＝CR-3）。生成した「_v1probe5_帳票」は目視確認後に手で削除してよい。
 */
export function probeSheetsApiWrite(): string {
  const lines: string[] = ['=== 決定木(2)検討 probeSheetsApiWrite（Sheets REST書込→export） ==='];
  const token = ScriptApp.getOAuthToken();

  // ① アプリ作成ファイル
  let fileId = '';
  try {
    const created = Drive.Files.create({
      name: '_v1probe5_帳票',
      mimeType: 'application/vnd.google-apps.spreadsheet',
    });
    if (created.id === undefined) throw new Error('Drive APIがIDを返しませんでした');
    fileId = created.id;
    lines.push(`① 新規スプレッドシート作成: OK (id=${fileId})`);
  } catch (e) {
    lines.push(`① 新規スプレッドシート作成: 失敗 — ${e instanceof Error ? e.message : String(e)}`);
    const report = lines.join('\n');
    Logger.log(report);
    return report;
  }

  // ② Sheets Advanced Service batchUpdate: 値＋太字＋罫線＋セル結合＋列幅（帳票描画に必要な操作の代表4種）。
  // REST直叩き（sheets.googleapis.com）は「HTTP 403=既定プロジェクトのSheets API未有効」で不成立だったため、
  // Advanced Service（manifest宣言で既定プロジェクトのAPIが自動有効化される）へ置換した。
  // 成立判定は「例外なく完了し、応答に spreadsheetId / replies がある」ことで③と独立に行う。
  let ok2 = false;
  try {
    const batchUpdate: GoogleAppsScript.Sheets.Schema.BatchUpdateSpreadsheetRequest = {
      requests: [
        {
          updateCells: {
            range: { sheetId: 0, startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 3 },
            fields: 'userEnteredValue,userEnteredFormat.textFormat.bold',
            rows: [
              {
                values: [
                  { userEnteredValue: { stringValue: '請求書（probe⑤）' }, userEnteredFormat: { textFormat: { bold: true } } },
                  { userEnteredValue: { numberValue: 12345 } },
                  { userEnteredValue: { stringValue: '¥45,678' } },
                ],
              },
              {
                values: [
                  { userEnteredValue: { stringValue: '品目A' } },
                  { userEnteredValue: { numberValue: 2 } },
                  { userEnteredValue: { stringValue: 'OK' } },
                ],
              },
            ],
          },
        },
        {
          updateBorders: {
            range: { sheetId: 0, startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 3 },
            top: { style: 'SOLID' },
            bottom: { style: 'SOLID' },
            left: { style: 'SOLID' },
            right: { style: 'SOLID' },
            innerHorizontal: { style: 'SOLID' },
            innerVertical: { style: 'SOLID' },
          },
        },
        {
          mergeCells: {
            range: { sheetId: 0, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: 3 },
            mergeType: 'MERGE_ALL',
          },
        },
        {
          updateDimensionProperties: {
            range: { sheetId: 0, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
            properties: { pixelSize: 180 },
            fields: 'pixelSize',
          },
        },
      ],
    };
    const spreadsheets = Sheets.Spreadsheets;
    if (spreadsheets === undefined) {
      throw new Error('Sheets Advanced Service が利用できません（appsscript.json の enabledAdvancedServices を確認）');
    }
    const response = spreadsheets.batchUpdate(batchUpdate, fileId);
    const hasSpreadsheetId = typeof response.spreadsheetId === 'string' && response.spreadsheetId !== '';
    const hasReplies = Array.isArray(response.replies);
    ok2 = hasSpreadsheetId || hasReplies;
    lines.push(
      `② Sheets Advanced batchUpdate（値+太字+罫線+結合+列幅）: ${ok2 ? '成立' : '不成立'}` +
        `（spreadsheetId=${hasSpreadsheetId ? 'あり' : 'なし'} / replies=${hasReplies ? String((response.replies ?? []).length) + '件' : 'なし'}）`,
    );
  } catch (e) {
    lines.push(`② Sheets Advanced batchUpdate: 例外 — ${e instanceof Error ? e.message : String(e)}`);
  }

  // ③ 既存 export URL 経路（フォールバック(1)③で成立実績あり）。②と独立に成否判定する。
  let ok3 = false;
  try {
    const url = buildExportUrl(fileId, 0, 'A1:C5');
    const response = UrlFetchApp.fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      muteHttpExceptions: true,
    });
    const code = response.getResponseCode();
    ok3 = code === 200 && isPdfBytes(response.getContent());
    lines.push(`③ export URL: HTTP ${code} ／ %PDF: ${ok3 ? 'OK' : 'NG'} → ${ok3 ? '成立' : '不成立'}`);
  } catch (e) {
    lines.push(`③ export URL: 例外 — ${e instanceof Error ? e.message : String(e)}`);
  }

  lines.push('');
  lines.push(`判定: ②Sheets書込=${ok2 ? '成立' : '不成立'} ／ ③export=${ok3 ? '成立' : '不成立'}`);
  if (ok2 && ok3) {
    lines.push('→ 「帳票描画=Sheets Advanced Service・export=既存URL」で本実装を組める');
    lines.push('（PDFを開いて太字・罫線・結合・列幅が反映されているかも目視確認するとより確実）');
  } else {
    lines.push('→ 不成立側の表示全文をdecisions.mdへ記録（両方不成立なら停止して人間判断＝CR-3。スコープ追加はしない）');
  }
  lines.push('生成物「_v1probe5_帳票」は目視確認後に削除してよい');
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
      // F-3と同じくfieldsを明示（既定fieldsにtrashedは含まれない）
      const fetched = Drive.Files.get(file.id, { fields: 'id, name, mimeType, trashed' });
      lines.push(
        `取得確認: OK (name=${String(fetched.name)}, mimeType=${String(fetched.mimeType)}, trashed=${String(fetched.trashed)})`,
      );
    }
    lines.push('→ V-2 成立候補。Driveで「_v2probe_帳票」フォルダと中身を目視確認しdecisions.mdへ記録');
    lines.push('（追加確認: 「帳票」フォルダをゴミ箱へ→再export→新フォルダが再作成されること）');
  } catch (e) {
    lines.push(`例外: ${e instanceof Error ? e.message : String(e)}`);
    lines.push('→ V-2 不成立の可能性。エラーメッセージをdecisions.mdへ記録し停止（スコープ追加はしない＝CR-3）');
  }
  const report = lines.join('\n');
  Logger.log(report);
  return report;
}
