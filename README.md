# PULSE

公開Webサイトの稼働状況を見守る、日本語の黒×ネオンダッシュボード。

## 機能
- 稼働状態・HTTPステータス・応答時間・直近288回の稼働率
- サイト名／URL検索、正常・障害・未計測による絞り込み
- 最新20件の履歴、スマホ対応、60秒ごとの表示更新
- GitHub Actionsによる約5分ごとの計測とRender Static Siteでの表示
- 20分以上更新がない場合の警告。架空データやlocalStorageは使いません。

## Render Static Siteで公開
| 設定 | 値 |
| --- | --- |
| Repository | morigu812-svg/PULSE |
| Branch | main |
| Build Command | 空欄 |
| Publish Directory | . |
| Auto-Deploy | On Commit |
| 環境変数 | 不要 |

`render.yaml` はBlueprint用の設定です。手動で作成済みのサービスへ自動適用されるものではありません。

画面はRender、監視処理はGitHub Actions（Monitor PULSE）で実行します。
画面は公開リポジトリの最新 `data/status.json` を直接読み込むため、監視結果の更新ごとにRenderを再デプロイする必要はありません。GitHub側のキャッシュで反映が遅れる場合があります。
監視結果のコミットには `[skip ci] [skip render]` を付け、監視による不要な再ビルドを防ぎます。HTMLやJavaScriptの通常の変更は再デプロイされます。
GitHub Pagesの設定は不要です。

## 監視対象の追加
`monitors.json` を編集してコミットします。最大10件です。

```json
[
  {"name": "PULSE", "url": "https://morigu812-svg.github.io/PULSE/"}
]
```

自分が管理する公開HTTPSサイトを登録してください。URLと履歴は公開されます。初期の監視対象URLはGitHub Pagesの仮URLです。Render公開後、実際のURLに書き換えてください。

## 計測と制限
GitHub Actionsのスケジュールは遅延・省略される場合があります。定刻実行を保証する監視サービスではありません。公開リポジトリのスケジュールは長期間活動がないと停止する場合があります。
HTTP 200〜399を正常と判定します。リダイレクト先は検査しません。応答時間はGitHub Actions実行環境からレスポンスヘッダー受信までの時間です。稼働率は保存されたチェック結果の割合で、時間ベースのSLAではありません。

このサイトは稼働監視用です。侵入検知・脆弱性診断・通知・利用者別データ保存は含みません。計測先のDNSは公開IPか検証しますが、任意の第三者が監視先を登録する公開APIは提供していません。

## ローカル確認
`python3 -m http.server 8080` で表示できます。計測は `python3 scripts/check.py` で実行します。外部ライブラリやAPIキーは不要です。
