# PULSE

利用者ごとのサイト稼働監視ダッシュボード。画面はRender Static Site、認証・データ保存・定期監視はSupabaseです。

## 利用方法
1. メールアドレス・8文字以上のパスワードで新規登録します。
2. メール確認なしで、登録直後に自分のダッシュボードが開きます。
3. 「サイトを追加」から、自分で管理する公開HTTPSサイトを登録します（1人10件）。
4. 約5分間隔で監視結果が記録されます。画面の更新ボタンは保存済みの結果を読み直します。

登録サイトの名前・URL変更、監視の一時停止と再開、削除に対応します。URL変更時は履歴をリセットします。停止中の記録は保持します。

## Render設定
| 項目 | 設定 |
| --- | --- |
| Branch | main |
| Build Command | 空欄 |
| Publish Directory | . |
| Auto-Deploy | On Commit |
| 環境変数 | 不要 |

`config.js` に入るのは公開可能なSupabase URLとpublishable keyだけです。service role keyなどの秘密鍵を置かないでください。

## 同じサイト内の中継で通信
ブラウザは `/pulse-api/auth/v1/...` と `/pulse-api/rest/v1/...` へ接続します。
Renderがサーバー側でSupabaseへ転送します。ブラウザからSupabaseへの直接通信や、失敗時の直接接続への切り替えは行いません。認証・RLSはそのまま適用されます。

手動作成済みのStatic Siteには `render.yaml` の変更は自動適用されません。RenderのPULSEサービスで次の設定を追加してください。

**Redirects/Rewrites**

| Source | Destination | Action |
| --- | --- | --- |
| `/pulse-api/*` | `https://bskmgytpfhmjhrclcohf.supabase.co/*` | Rewrite |

**Headers**

| Path | Name | Value |
| --- | --- | --- |
| `/pulse-api/*` | `Cache-Control` | `no-store, private` |
| `/pulse-api/*` | `Vary` | `Authorization, apikey` |

既存の `/*` ルールがある場合は、`/pulse-api/*` のルールを先に置きます。ActionはRedirectではなくRewriteを選びます。新しいBlueprintから作成する場合は `render.yaml` に同じ設定を含めています。

通信方式はHTTPSのままですが、ブラウザの接続先がPULSEの公開URLに統一されます。学校の管理ポリシーがPULSE自体や機能を制限している場合まで動作を保証するものではありません。

## 認証の運用設定
Supabase Authは同じプロジェクト内の他アプリと共通ですが、PULSEのデータは専用テーブルとRLSで分離します。既存アプリの設定は変更していません。

Supabase Dashboard → Authentication → Sign In / Providers → Email の **Confirm email** をOFFにして保存してください。画面コードの変更だけではこのサーバー設定は変わりません。

この設定はプロジェクト共通なのでMy-Linksを含む他アプリの新規登録にも適用されます。メールアドレスの実際の所有確認は行わず、メールアドレスとパスワードの組み合わせで本人のデータを識別します。RLSによるデータの所有者制限は継続します。

確認待ちで既に作成されたアカウントがある場合は、運営者がそのアカウントを確認済みにする必要があります。他アプリの確認待ちアカウントは一括変更しないでください。

新規登録時は設定を確認し、確認メールが有効な間はメール送信を伴う登録を開始しません。パスワード再設定メールは任意の復旧手段として残しており、使用する場合だけSMTP設定が必要です。

セッションはタブ内のsessionStorageに保持し、localStorageは使いません。タブを閉じた後は再ログインします。監視設定・履歴はサーバー保存なので、別の端末でも同じアカウントで利用できます。

## 利用者別データと監視
- `public.pulse_monitors`：登録URL、所有者、監視設定、直近288回の計測履歴。
- RLS：本人の行だけ読み書き可能。所有者・計測結果・チェック時刻の書き換えはクライアントに許可しません。
- `pulse_private`：監視ワーカーの実行制御。一般利用者からアクセスできません。
- `pulse-monitor` Edge Function：定期ジョブ専用の秘密トークンを検証し、実際のHTTP応答を計測します。
- `pulse-monitor-every-five-minutes`：Supabase Cronから5分ごとに実行。秘密トークンはVaultに保存します。
- GitHub Actions：フロントエンドの構文検証のみ。利用者のURL・履歴・秘密鍵をGitHubへ出力しません。

対応する監視先は `*.github.io`、`*.onrender.com`、`*.pages.dev`、`*.vercel.app`、`*.netlify.app` です。サーバーから任意の内部アドレスへアクセスされるのを防ぐため、カスタムドメインは現時点では未対応です。リダイレクト先への追従はしません。HTTP 200〜399を稼働として記録します。

1回の定期処理は未計測・古い順で最大40サイトを計測します。利用増加時には5分以上かかる場合があります。20分以上計測が止まったサイトは警告します。24時間のSLAを保証するサービスではありません。

## 構成
`index.html` / `styles.css` / `app.js` / `config.js` が画面です。
`supabase/pulse.sql` は初回作成に使ったスキーマ定義です。稼働中プロジェクトへ再実行しないでください。
`supabase/functions/pulse-monitor/index.ts` が公開済みの監視関数のソースです。

以前の公開JSON・GitHubベース監視は廃止しました。既存の共有監視設定は利用者のアカウントに自動で割り当てません。
