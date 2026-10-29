# 滑鼠行為上下文實驗 v2

比較固定目標與途中跳動目標，保存原始指標事件、刺激時間線、規則式行為片段與片段序列圖。這是受 WATSON 行為抽象啟發的研究原型，尚未實作其上下文嵌入學習，也沒有訓練真人／腳本／AI Agent 分類器。

## 部署與試玩

保留本專案目錄結構，將 GitHub Repository 連結到 Netlify：

- Build command：`npm run build`
- Publish directory：`dist`
- Functions directory：`netlify/functions`
- Node.js：22.12 以上（建議 24）
- 環境變數：`EXPORT_TOKEN`，至少 24 字元的隨機字串，勿提交至 GitHub

建置會將 `index.html`、`collector.mjs`、`experiment.mjs` 複製到公開的 `dist/`，並將後端及其共用模組複製到 `netlify/functions/`。`validation.mjs`、匯出權杖及資料不會複製到 `dist/`。不需建立 `.gitkeep`，也不要只用 Netlify 靜態拖放部署。

填入自訂參與者代碼、勾選同意，選擇任務與條件，從藍圈拖到綠圈。可直接開始下一次，不需按重設。每次上傳確認前暫停接受新任務，最多等待 15 秒；未確認上傳的紀錄仍保留在本頁 JSON 備份。關閉頁面前請下載備份，重新整理會清空記憶體中的紀錄。逾時不代表後端一定未寫入，匯入研究資料時需檢查重複資料。

只測試前端可執行 `python -m http.server 8000 --directory dist`，開啟 `http://localhost:8000`。此方式沒有 Netlify 後端，上傳會失敗，但可下載 JSON；不會寫入 CSV。本機完整端點需使用 Netlify 的開發環境。

## 實驗條件

| 條件 | 行為 |
|---|---|
| 固定目標 static | 目標保持 (730,110)，仍記錄一個不改變畫面的 control_marker |
| 動態目標 jump | 開始後隨機 450–950 ms，目標跳到 (620,60) 或 (620,300) |
| 隨機混合 mixed | 每次獨立以 50% 機率指派 static/jump，不保證小樣本數量相等 |

時間以每次 pointerdown 為 0。刺激標記使用排程後的 requestAnimationFrame 回呼時間，表示要求更新畫面的時刻，不是硬體驗證的顯示時間。太快結束可能來不及出現刺激，`analysis.stimulus_observed=false`，不可當成已接受刺激的反應資料。

直線／曲線是視覺引導，不要求沿路徑通過。所有座標轉換到 800×400 標準空間；實際操作區 CSS 尺寸另外存於 `rendered_stage`。路徑距離單位是標準座標單位，不是物理毫米或實際螢幕像素。

## 資料與行為抽象

Schema `2.0` 保留 participant_id、session_id、trial_index、task_type、pointer_type、input_device、rendered_stage、experiment、stimuli、events、end_reason。滑鼠與觸控板在瀏覽器中常同樣是 pointer_type=mouse，因此另外讓參與者自填裝置。公開端點只接受 human，自填來源以 `online_self_report_unverified` 標記，不能視為已驗證真人。

`analysis` 是可重算的規則式摘要，後端會自行重算而不信任客戶端摘要：

- 片段類型：movement、low_motion、target_approach、direction_change、stimulus_boundary。
- 目標距離 ≤90 判作接近目標；位移 ≥2 的相鄰有效移動方向夾角 >60° 判為方向改變。
- 間隔 ≥100 ms 且位移／時間 <0.05，標記低移動量。稀疏取樣也會影響此指標，不能直接解讀為主動停頓。
- 跨越刺激標記的相鄰事件另記 boundary，不假裝知道兩事件之間的完整軌跡。pre/post 統計只計各自視窗內樣本間的距離，因此兩者路徑和不一定等於全程。
- adjustment_latency_proxy_ms：目標改變至少 80 ms 後，移動朝新目標（方向餘弦 >0.7），且較刺激前最後有效方向改變（餘弦 <0.9）的首筆觀測時間差。無前置方向或未符合時為 null，不是 0，也不代表認知反應時間。
- graph 的節點是片段，next 邊只代表時間順序，沒有宣稱因果或系統資訊流。

放開時距離當時目標中心 ≤30 才算完成。取消、重設、視窗 resize、頁面切到背景、失去指標捕捉、175 秒逾時或達 2500 事件上限，都會以未完成中止紀錄保存。即使中止時位於目標內，也不算完成。後端仍接受既有 v1 格式與其原本 45 單位容差。

## 匯出與比較

管理端點仍為 `/api/export`，帶 `Authorization: Bearer YOUR_EXPORT_TOKEN`，支援 `limit` 與 `after` 分頁。不可將權杖寫進前端。JSON 可用瀏覽器備份陣列或匯出端點的 `{records:[...]}` 物件；多頁請先合併 records，不要只分析第一頁。

```sh
node analyze-records.mjs records.json analysis-output
```

產生 baseline.csv（全程統計）、context.csv（增加刺激前後與片段特徵）、metadata.csv（標籤、參與者、條件與分組資訊）、graphs.json（後續圖模型輸入）。只處理 v2，v1 會略過；不會自動訓練或宣稱辨識準確率。請勿將資料、匯出結果或權杖提交到公開 GitHub。

建議先比較相同 RF 模型下的 baseline/context 表示，再評估 GNN。`row_id` 僅供連接表格，不能當作模型特徵。metadata 中的身分、標籤、裝置、條件及上傳狀態不應直接混入特徵。方向調整指標不適用 static，需在同條件內比較，避免模型只學會區分任務條件。

真人、腳本與 AI Agent 均應涵蓋相同任務和實驗條件；另外保存可追溯的來源標籤，分開記錄決策來源與控制方式。按參與者／自動化實作來源切分訓練與測試，避免同一來源跨集合。先檢查 released、刺激是否出現及取樣品質；取消或未完成可作獨立分析，不應不加說明混入反應時間比較。這些是實驗控制，並非已完成的模型結果。

## 驗證

```sh
npm ci
npm test
npm run build
```

測試涵蓋時間線、正確終點、取消、短操作、原始資料驗證、上限與 v1 相容性，並以最小 DOM 模擬執行真實 collector 模組，驗證連續操作、條件變化、取消與失敗備份。DOM 模擬不驗證瀏覽器繪圖、觸控硬體或實際顯示延遲；正式蒐集前仍需在目標裝置試跑。Netlify Blobs 的真實寫入需要部署環境驗證。

方法參考：[WATSON: Abstracting Behaviors from Audit Logs via Aggregation of Contextual Semantics (NDSS 2021)](https://www.ndss-symposium.org/ndss-paper/watson-abstracting-behaviors-from-audit-logs-via-aggregation-of-contextual-semantics/)。本原型的規則分段與時間序列圖是針對網頁互動的改編，不是 WATSON 重現。
