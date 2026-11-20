# リリース手順

Limit Radar は VS Code Marketplace / Open VSX には公開せず、GitHub Releases で VSIX を配布します。

1. `package.json` の `version` を上げ、`CHANGELOG.md` に変更点を書く
2. コミットしてタグを push する

```powershell
git tag v0.2.0
```

```powershell
git push origin main --tags
```

GitHub Actions（`.github/workflows/release.yml`）が構文チェック → VSIX 作成 → GitHub Release への添付まで行います。Secrets の登録は不要です。

## リリース前チェック

- [ ] `node scripts/check.js` で3サービスとも取得できる
- [ ] VSIX をローカルにインストールして、ステータスバー・パネル・通知を確認した
- [ ] Claude 連携のセットアップ・解除を試した
