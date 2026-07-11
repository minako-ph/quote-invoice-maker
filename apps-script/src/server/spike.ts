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
import { exportRenderedPdf, isPdfBytes } from './pdf';
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
