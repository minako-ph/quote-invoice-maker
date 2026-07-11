import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FREE_MONTHLY_LIMIT, PRO_MONTHLY_LIMIT } from '../src/server/quota';

/**
 * CR走査テスト（引継書§10②③。決定的コードガード）。
 *
 * - CR-1: ソース全体にインボイス登録番号の照会エンドポイント・照会クライアント・
 *   「検証」機能が存在しないことをスキャンする（形式チェック /^T\d{13}$/ のみ可）。
 * - 価格・無料枠定数（1480／3／1000）が docs 記載と一致すること。
 */

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/** 走査対象ディレクトリ（ソース・UI・web）。 */
const SCAN_DIRS = ['apps-script/src', 'backend/src', 'web', 'scripts'];
/** 走査対象拡張子。 */
const SCAN_EXTS = ['.ts', '.js', '.mjs', '.html', '.css', '.json'];

/** CR-1 禁止パターン: 国税庁インボイス公表システム関連の照会実装の痕跡。 */
const FORBIDDEN_PATTERNS: readonly { readonly pattern: RegExp; readonly reason: string }[] = [
  { pattern: /invoice-kohyo/i, reason: '国税庁インボイス公表システムのエンドポイント（CR-1）' },
  { pattern: /web-api\.invoice/i, reason: 'インボイスWeb-APIのURL（CR-1）' },
  { pattern: /適格請求書発行事業者公表/, reason: '公表システム照会の実装痕跡（CR-1）' },
  { pattern: /登録番号(の|を)?(照会|検証|確認)/, reason: '登録番号の照会・検証機能（CR-1。形式チェックのみ可）' },
  { pattern: /registrationNumber(Lookup|Verify|Check)/i, reason: '登録番号照会APIの実装（CR-1）' },
];

/** CR-1 の許容: 「検証しません」等の否定文・注意書きは許す。 */
const ALLOWED_CONTEXTS: readonly RegExp[] = [
  /検証(しません|しない|を行わない|コードを書かない)/,
  /真正性(は|を)?検証/, // 「真正性は検証しません」の断り書き
  /照会(しません|しない|エンドポイント・照会クライアント)/,
];

function listFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      results.push(...listFiles(full));
    } else if (SCAN_EXTS.some((ext) => entry.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

describe('CR-1: インボイス照会・検証コードの不存在（走査）', () => {
  const files = SCAN_DIRS.flatMap((dir) => listFiles(join(repoRoot, dir)));

  it('走査対象のソースファイルが存在する', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
    it(`禁止パターンが存在しない: ${String(pattern)}（${reason}）`, () => {
      const violations: string[] = [];
      for (const file of files) {
        const content = readFileSync(file, 'utf-8');
        const lines = content.split('\n');
        lines.forEach((line, index) => {
          if (!pattern.test(line)) return;
          // 否定文（〜しません等）の断り書きは許容する
          if (ALLOWED_CONTEXTS.some((ctx) => ctx.test(line))) return;
          violations.push(`${file.replace(repoRoot, '')}:${index + 1}: ${line.trim().slice(0, 120)}`);
        });
      }
      expect(violations, violations.join('\n')).toEqual([]);
    });
  }
});

describe('価格・無料枠定数と docs の一致（引継書§10③・§13）', () => {
  it('無料枠=月3枚・Pro上限=月1,000枚', () => {
    expect(FREE_MONTHLY_LIMIT).toBe(3);
    expect(PRO_MONTHLY_LIMIT).toBe(1000);
  });

  it('requirements.md に確定値（¥1,480税込・月3枚・月1,000枚）が記載されている', () => {
    const requirements = readFileSync(join(repoRoot, 'docs/requirements.md'), 'utf-8');
    expect(requirements).toContain('¥1,480/月（税込）');
    expect(requirements).toContain('月3枚');
    expect(requirements).toContain('1,000枚');
  });

  it('サイドバーの無料枠到達メッセージが marketing §8 verbatim と一致する', () => {
    const sidebar = readFileSync(join(repoRoot, 'apps-script/src/sidebar/sidebar.html'), 'utf-8');
    expect(sidebar).toContain(
      '今月の無料枠（3枚）を使い切りました。Proは月¥1,480（税込）で月1,000枚まで発行できます。無料枠は毎月1日に回復します。',
    );
  });

  it('サイドバーのクロスセル文言が marketing §9 verbatim と一致する（CR-1受け皿）', () => {
    const sidebar = readFileSync(join(repoRoot, 'apps-script/src/sidebar/sidebar.html'), 'utf-8');
    expect(sidebar).toContain(
      '取引先が適格請求書発行事業者かをまとめて確認したいときは、姉妹アドオン『会社リストクリーナー』をご利用ください。本アドオンは登録番号の真正性を検証しません。',
    );
  });
});
