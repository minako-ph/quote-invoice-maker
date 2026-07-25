/**
 * 帳票レンダリング用の作業スプレッドシート管理（V-1確定構成。decisions.md 2026-07-24）。
 *
 * V-1実測（一次案=コンテナのexport URLが404／FB(1)=アプリ作成ファイルへのexportは200）を受け、
 * 帳票の描画・PDF化は**アプリ（drive.file）が作成した専用の作業ファイル**上で行う。
 * - 1ユーザー1ファイル。保存フォルダ「帳票」直下に作成し、IDを UserProperties に保持。
 * - 存在・trashed 確認（fields明示＝F-3と同じ理由）で消えていたら自動再作成。
 * - 描画は先頭シート（sheetId=0）を使い回す。
 * - 競合防止は呼び出し側の LockService（ユーザーロック）で担保する（quota.consumeQuota 内で
 *   スクラッチ確保→描画→export→保存の全工程を実行する）。
 */

import { ensureFolders } from './drive';

const SCRATCH_PROP_KEY = 'scratchSpreadsheetId';

/** 作業ファイル名（ユーザーのDriveに見えるため用途がわかる名前にする）。 */
export const SCRATCH_FILE_NAME = '_帳票レンダリング用（アプリが使用します）';

/** 描画に使うシートID（新規作成ファイルの先頭シートは 0）。 */
export const SCRATCH_SHEET_ID = 0;

/** 保存済みIDのファイルが生存しているスプレッドシートかを確認する。 */
function scratchAlive(fileId: string): boolean {
  try {
    const file = Drive.Files.get(fileId, { fields: 'id, mimeType, trashed' });
    return file.trashed !== true && file.mimeType === 'application/vnd.google-apps.spreadsheet';
  } catch {
    return false;
  }
}

/**
 * 保存済みのスクラッチIDを破棄する（描画失敗時のリトライ用。
 * 次回の ensureScratchSpreadsheet() が新規作成する）。
 */
export function discardScratchSpreadsheet(): void {
  PropertiesService.getUserProperties().deleteProperty(SCRATCH_PROP_KEY);
}

/**
 * 帳票作業ファイルを確保して ID を返す（無ければ「帳票」フォルダ直下に作成）。
 */
export function ensureScratchSpreadsheet(): string {
  const props = PropertiesService.getUserProperties();
  const saved = props.getProperty(SCRATCH_PROP_KEY);
  if (saved !== null && saved !== '' && scratchAlive(saved)) {
    return saved;
  }
  const folders = ensureFolders();
  const created = Drive.Files.create({
    name: SCRATCH_FILE_NAME,
    mimeType: 'application/vnd.google-apps.spreadsheet',
    parents: [folders.root],
  });
  if (created.id === undefined) {
    throw new Error('帳票用の作業ファイルを作成できませんでした（Drive APIがIDを返しませんでした）');
  }
  props.setProperty(SCRATCH_PROP_KEY, created.id);
  return created.id;
}
