# PULSE

利用者ごとのサイト稼働監視ダッシュボード。画面はRender Static Site、PULSE専用認証とデータ保存・定期監視は既存Supabase内で実行します。

## 最初の利用
1. 「新規登録」でメールアドレスと8〜128文字のパスワードを登録します。
2. メール確認なしで専用ダッシュボードを開きます。
3. 表示された復旧コードを安全な場所へ保存します。保存完了で閉じるまで、同じタブの再読み込み後も表示を試みます。
4. 自分の公開サイトを追加します（最大10件）。

My-Linksのアカウントとは別です。同じメールアドレスでもPULSEで新規登録してください。My-Linksのパスワード、Supabase Authのメール確認・SMTP設定は変更しません。

## メールを使わない復旧
「パスワードを忘れた場合」でPULSEのメールアドレス、登録時の復旧コード、新しいパスワードを入力します。復旧コードは再設定ごとに更新され、古いコードとすべての既存セッションは無効になります。パスワードと復旧コードを両方なくした場合の自動復旧はありません。

ログイン後、画面上部の「復旧コード」から現在のPULSEパスワードを使ってコードを再発行できます。以前のコードは無効になります。

メールアドレスはログインIDとして使用し、所有確認は行いません。登録したメールアドレスだけを根拠に、My-Linksや旧版PULSEのデータへアクセスすることはできません。

## Render設定
| 項目 | 設定 |
| --- | --- |
| Branch | main |
| Build Command | 空欄 |
| Publish Directory | . |
| Auto-Deploy | On Commit |
| 環境変数 | 不要 |

既存の中継ルールはそのまま使用します。

| Source | Destination | Action |
| --- | --- | --- |
| `/pulse-api/*` | `https://bskmgytpfhmjhrclcohf.supabase.co/*` | Rewrite |

ブラウザは `/pulse-api/functions/v1/pulse-api` にPOSTします。認証・保存内容の応答をキャッシュしないよう、`/pulse-api/*` に `Cache-Control: no-store, private` を設定します。Varyを設定する場合は `x-pulse-session, apikey` にします。新しいBlueprint向けの `render.yaml` にも設定を含めています。既存の手動作成サービスにはYAMLの変更が自動適用されません。

## 認証と保存の分離
- `pulse_private.accounts`：PULSEだけのアカウント。パスワードはSHA-256で前処理した後bcrypt（コスト12）でハッシュ化。
- `pulse_private.sessions`：ランダムな256ビットのPULSE専用トークンをSHA-256でハッシュ化して保存。有効期限7日。My-LinksのJWTは使用しません。
- `pulse_private.monitors`：本人の登録サイトと直近288回の監視履歴。
- `pulse_private.rate_limits`：登録、ログイン、復旧の試行回数を制限。
- `pulse-api` Edge Function：専用トークンを検証するサーバー処理へ接続し、利用者ごとの操作を実行。

これらのテーブルにブラウザ用の権限は与えず、RLSも有効にします。専用APIはセッションから所有者を判定し、利用者が送信した所有者IDは使用しません。SQLの公開関数はservice_roleだけに実行を許可します。秘密鍵をブラウザやリポジトリへ含めないでください。

セッションはタブのsessionStorageに保存し、localStorageは使いません。タブを閉じた後は再ログインします。監視設定・履歴はサーバーに保存します。

## 既存データ
My-Linksのアカウントとテーブルは変更しません。旧版PULSEの `public.pulse_monitors` は保持し、既存の定期監視も継続します。新しいPULSEアカウントに、メールアドレス一致だけで旧データを自動移行することはありません。

`supabase/pulse.sql` は旧版の初期スキーマ、`supabase/pulse-isolated-auth.sql` が分離版の追加スキーマです。既に適用した環境へ再実行しないでください。

## 監視
`pulse-monitor` Edge FunctionをSupabase Cronで約5分ごとに起動します。既存の秘密トークンはVaultで管理します。監視結果はGitHubへ書き出しません。

対応URLは `*.github.io`、`*.onrender.com`、`*.pages.dev`、`*.vercel.app`、`*.netlify.app` の公開HTTPSサイトです。カスタムドメインは現在未対応です。リダイレクトを追従せず、HTTP 200〜399を稼働として記録します。

1回の処理は古い記録から最大40件を計測します。利用増加時や実行状況によって5分以上かかる場合があり、20分以上計測が止まったサイトは警告します。

## 検証
利用者の希望により、今回の分離版はブラウザ操作・実アカウント登録による動作確認を行っていません。
