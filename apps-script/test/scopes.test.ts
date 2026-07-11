import { describe, it, expect } from 'vitest';
import manifest from '../appsscript.json';

// CR-3: OAuthスコープは以下の4点に固定（順序・過不足すべて不可）。
// スコープ差分チェック（scripts/check-oauth-scopes.mjs）と同じ不変条件を
// pnpm test でも常時検証する保険（ビルド前後のチェックはCIが実施）。
const EXPECTED_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.currentonly',
  'https://www.googleapis.com/auth/script.external_request',
  'https://www.googleapis.com/auth/script.container.ui',
  'https://www.googleapis.com/auth/drive.file',
];

describe('appsscript.json oauthScopes (CR-3)', () => {
  it('スコープが4点と順序まで完全一致する', () => {
    expect(manifest.oauthScopes).toEqual(EXPECTED_SCOPES);
  });

  it('スコープ数はちょうど4点', () => {
    expect(manifest.oauthScopes).toHaveLength(4);
  });

  it('restrictedスコープ（Drive全体・Gmail等）を含まない', () => {
    const forbidden = [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/gmail',
      'https://www.googleapis.com/auth/spreadsheets',
    ];
    for (const scope of manifest.oauthScopes) {
      expect(forbidden).not.toContain(scope);
    }
  });

  it('タイムゾーンは Asia/Tokyo（月次無料枠・帳票日付の前提）', () => {
    expect(manifest.timeZone).toBe('Asia/Tokyo');
  });

  it('urlFetchWhitelist に docs.google.com が含まれる（V-1 export URL）', () => {
    expect(manifest.urlFetchWhitelist).toContain('https://docs.google.com/');
  });
});
