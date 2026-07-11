/**
 * サンプル書類生成（FR-13。オンボーディング用＝受入基準5の前提）。
 * ワンクリックでサンプル明細入りの見積書を生成する。
 */

import type { LineItemInput } from './calc';
import { createInputSheet } from './sheets';

/** サンプル明細（源泉対象のデザイン料＋軽減税率の物品＋対象外の立替費）。 */
const SAMPLE_ITEMS: readonly LineItemInput[] = [
  { name: 'Webサイトデザイン制作', quantity: 1, unitPrice: 100000, taxCategory: '10', withholding: true },
  { name: '撮影用飲食物（軽減税率対象）', quantity: 2, unitPrice: 1500, taxCategory: '8', withholding: false },
  { name: '交通費実費（立替）', quantity: 1, unitPrice: 3200, taxCategory: 'none', withholding: false },
];

/** サンプル見積書を生成してシート名を返す。 */
export function createSampleQuote(): string {
  return createInputSheet('quote', {
    clientName: 'サンプル株式会社',
    subject: 'Webサイトリニューアル（サンプル）',
    transactionDate: '2026年7月',
    items: SAMPLE_ITEMS,
    remarks: 'これはサンプル書類です。内容を書き換えてそのままご利用いただけます。',
  });
}
