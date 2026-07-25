/**
 * Drive 保存（FR-8・V-2。引継書§6）。
 *
 * DriveApp は使わない（フルdriveスコープを要求しがち）。**Advanced Drive Service（Drive API v3・
 * manifest の userSymbol "Drive"）**でフォルダ作成とPDFアップロードを行う。
 * drive.file スコープは「アプリが作成したファイル/フォルダ」に読み書き可——
 * V-2実測で確定済み（2026-07-24・decisions.md）。
 *
 * フォルダIDは DocumentProperties に保持し、消えていたら再作成する。
 */

import type { DocumentType } from './layout';
import { FOLDER_NAMES } from './layout';
import { resolveNameCollision } from './naming';

const FOLDER_PROP_KEY = 'driveFolders';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** 保存結果（台帳リンク・サイドバー表示用）。 */
export interface SavedPdf {
  readonly fileId: string;
  readonly fileName: string;
  readonly url: string;
}

interface FolderIds {
  readonly root: string;
  readonly invoice: string;
  readonly quote: string;
}

/** 保存済みフォルダID群を読む（未保存・不正は null）。 */
function readFolderIds(): FolderIds | null {
  const json = PropertiesService.getDocumentProperties().getProperty(FOLDER_PROP_KEY);
  if (json === null) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const root = Reflect.get(parsed, 'root');
    const invoice = Reflect.get(parsed, 'invoice');
    const quote = Reflect.get(parsed, 'quote');
    if (typeof root === 'string' && typeof invoice === 'string' && typeof quote === 'string') {
      return { root, invoice, quote };
    }
    return null;
  } catch {
    return null;
  }
}

/** フォルダが生存しているか（削除・ゴミ箱行きは false）。 */
function folderAlive(folderId: string): boolean {
  try {
    // F-3: v3のFiles.getは既定fieldsにtrashedを含まないため明示する
    // （省略するとtrashedがundefinedになり、ゴミ箱入りフォルダを生存と誤判定して
    //   以後のPDFがゴミ箱内へ保存され続ける）。
    const file = Drive.Files.get(folderId, { fields: 'id, mimeType, trashed' });
    return file.trashed !== true && file.mimeType === FOLDER_MIME;
  } catch {
    return false;
  }
}

/** フォルダを新規作成し ID を返す。 */
function createFolder(name: string, parentId?: string): string {
  const resource: GoogleAppsScript.Drive_v3.Drive.V3.Schema.File = {
    name,
    mimeType: FOLDER_MIME,
    ...(parentId !== undefined ? { parents: [parentId] } : {}),
  };
  const created = Drive.Files.create(resource);
  if (created.id === undefined) {
    throw new Error('フォルダの作成に失敗しました（Drive APIがIDを返しませんでした）');
  }
  return created.id;
}

/**
 * 保存フォルダ（「帳票」→「請求書」「見積書」）を確保して ID 群を返す。
 * 消えていたら再作成し、DocumentProperties を更新する。
 */
export function ensureFolders(): FolderIds {
  const cached = readFolderIds();
  if (
    cached !== null &&
    folderAlive(cached.root) &&
    folderAlive(cached.invoice) &&
    folderAlive(cached.quote)
  ) {
    return cached;
  }
  const rootId = cached !== null && folderAlive(cached.root) ? cached.root : createFolder(FOLDER_NAMES.root);
  const invoiceId =
    cached !== null && folderAlive(cached.invoice) ? cached.invoice : createFolder(FOLDER_NAMES.invoice, rootId);
  const quoteId =
    cached !== null && folderAlive(cached.quote) ? cached.quote : createFolder(FOLDER_NAMES.quote, rootId);
  const ids: FolderIds = { root: rootId, invoice: invoiceId, quote: quoteId };
  PropertiesService.getDocumentProperties().setProperty(FOLDER_PROP_KEY, JSON.stringify(ids));
  return ids;
}

/** Drive クエリ文字列用に名前をエスケープする。 */
function escapeForQuery(name: string): string {
  return name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** フォルダ内に同名ファイルが存在するか（drive.file 配下＝アプリ作成分のみ見える）。 */
function nameExistsInFolder(folderId: string, name: string): boolean {
  const result = Drive.Files.list({
    q: `'${folderId}' in parents and name = '${escapeForQuery(name)}' and trashed = false`,
    fields: 'files(id)',
    pageSize: 1,
  });
  return (result.files ?? []).length > 0;
}

/**
 * PDF Blob を種別サブフォルダへ保存する（FR-8）。
 * 同名衝突は `_2` からの連番で回避（naming.resolveNameCollision）。
 */
export function savePdfToDrive(blob: GoogleAppsScript.Base.Blob, fileName: string, type: DocumentType): SavedPdf {
  const folders = ensureFolders();
  const folderId = type === 'invoice' ? folders.invoice : folders.quote;
  const finalName = resolveNameCollision(fileName, (candidate) => nameExistsInFolder(folderId, candidate));
  const created = Drive.Files.create(
    { name: finalName, parents: [folderId], mimeType: 'application/pdf' },
    blob,
    { fields: 'id, webViewLink' },
  );
  if (created.id === undefined) {
    throw new Error('PDFの保存に失敗しました（Drive APIがIDを返しませんでした）');
  }
  const url = created.webViewLink ?? `https://drive.google.com/file/d/${created.id}/view`;
  return { fileId: created.id, fileName: finalName, url };
}
