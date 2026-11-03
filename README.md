# Netlify 單層上傳版：完全不必建立資料夾

這份 ZIP 內只有 7 個根目錄檔案：

- `index.html`：線上滑鼠 CAPTCHA 蒐集頁
- `record.mjs`：接收資料的伺服器函式原始碼
- `export.mjs`：管理者匯出資料的伺服器函式原始碼
- `build.mjs`：Netlify 部署時建立網站資料夾與後端資料夾
- `netlify.toml`：部署設定（已設定 build、publish、functions、redirects）
- `package.json`：安裝 Netlify Blobs 依賴
- `README.md`：本檔案

## 用 GitHub 網站上傳

1. 先將 ZIP 解壓縮；**請選取裡面的 7 個檔案**，不要上傳 ZIP 本身。
2. 在 GitHub 建立 Repository → Add file → Upload files。
3. 把這 7 個檔案上傳到 Repository 最上層，不要另外建立任何資料夾。
4. 點 Commit changes。
5. 到 Netlify → Add new project → Import an existing project → GitHub → 選此 Repository。
6. 建置設定留預設即可，或確保：Base directory = repo root；Build command = `node build.mjs`；Publish directory = `dist`；Functions directory = `netlify/functions`。
7. Netlify 預設使用 Node.js 24；若你自行指定版本，請確保 Node.js 22.12 以上。Netlify 的 Project configuration → Environment variables 加入 `EXPORT_TOKEN`。請使用長度至少 24 字元的隨機祕密字串，勿提交至 GitHub。
8. 部署後在網站勾選同意並測試提交，需看到「資料已儲存至線上資料庫」。

建置時 `build.mjs` 會自動生成：

```
dist/index.html                  # 僅此目錄對外公開
netlify/functions/record.mjs    # 動態後端
netlify/functions/export.mjs    # 管理者匯出
```

以上生成的資料夾**不需要自行上傳**，也不需要 `.gitkeep`。資料儲存於 Netlify Blobs，不會自動存進本機 CSV；需要利用完整版研究工具包的 `tools/export_netlify.ps1` 與 `model/import_web_records.py` 匯出及轉換。

**切勿只把 `index.html` 丟到 Netlify 的「手動發布」**：純靜態頁不會自動建立後端。請用本說明的「GitHub 連結部署」以執行建置指令。


## 研究改進分支：隔離驗證與 API 契約（2026-11-03）

本分支新增 `api.test.mjs`、`package-lock.json` 與 `.gitignore`，因此原先「7 個檔案」說明僅適用基準版本；使用 Git 複製整個分支即可。部署建置入口與公開目錄不變。

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run build
```

測試使用記憶體儲存替身；SDK 分頁測試注入替身 HTTP，無須 EXPORT_TOKEN 或正式 Netlify 環境，也不讀寫參與者資料。測試中的 storage secret 為合成錯誤訊息，預期會出現在伺服器測試日誌；用戶端只收到通用 503。

- 試次格式維持 schema 1.0。一次 down、零至多次 move、一次 up；時間為非負、單調不減的毫秒，總時長需大於零且不超過 180,000 ms。同時間事件可保留。
- 事件 pointer_type 省略時沿用 trial；顯式矛盾或空值拒收。button 若提供須為 -1 至 5 的整數，is_dragging 若提供須為布林。保留現有前端 up=true 的行為，該欄位不是事件狀態的判斷依據。
- 請求串流最多 350,000 bytes，包含多位元 UTF-8；不信任 Content-Length。超限取消讀取並回 413；壞 JSON、無效 UTF-8 及驗證錯誤回 400；儲存錯誤回 503。
- completed 仍依距 TARGET 45px 內判定；未達標的合法 trial 仍可保存。human 是自報、未驗證的標籤，不代表已知真值。
- 匯出仍以 Bearer token 授權、limit/after 分頁；SDK list 預設自動收齊服務分頁。每個 HTTP 頁面會重新列舉 key，沒有跨請求快照保證；並行刪除的 null 紀錄會略過。大資料集仍有全列舉成本。

這些驗證不等於正式 Netlify 端到端測試。前端多指標與取消流程的後續隔離驗證及修補，見下方第七階段。沒有部署或存取正式服務。

## 第五階段：離線軌跡特徵（feature_version 1.0.0）

在 repository 根目錄執行：

```powershell
node analyze.mjs input.json features-output.json
```

輸入可為瀏覽器備份陣列或管理者匯出 `{records:[...]}`；輸出為獨立 sidecar JSON，原始 schema 1.0 與正式 API 不變。不連線、不寫入 Netlify。輸出檔必須尚不存在，避免覆蓋資料；單次輸入上限 10 MB / 1000 筆。逐筆非法資料保留 index 與中文錯誤，部分失敗 exit 2，整體讀寫／格式失敗 exit 1，全成功 exit 0。所有衍生結果仍可能含 trial_id，應依原始資料存取規範保存。

`features.mjs` 可直接作為 ES module 匯入瀏覽器或 Node：`extractFeatures(events, {target, pauseThresholdPxS: 5})`，或 `analyzeRecord(record)` 保留來源欄位並產生繁中摘要。這不是收集 API 驗證器：幾何函式座標絕對值上限 1,000,000、時間非負且不超過 MAX_SAFE_INTEGER、時長 0–180 秒（不含零）、事件 2–2500；不檢查 START、pointer、consent。匯入成功僅代表可計算特徵。

- 時間輸入為 ms，輸出為 s、px/s、px/s²。mean speed = 全路長 / 全時長；速度陣列只包含正時間差段。
- 同時間移動保留路長、排除分段速度；加速度不跨被排除段，以相鄰有效速度段的時間中點差計算。平均絕對加速度是有效 pair 的算術平均，非時間加權。
- pause 嚴格定義為 speed < 閾值，預設 5 px/s 僅為設計值；重複位置以座標完全相同判定，沒有抗雜訊容差。
- 路長零時效率 null；無相鄰有效速度段時加速度 null；缺 target 時誤差 null。quality 提供原因與零時間段數，不輸出 NaN/Infinity。
- 保留原始 label/source/label_source，不補造 human 真值；缺 label_source 標為 unspecified_unverified。completed_reported 只是原值，終點誤差另外計算。
- 純函式不改變輸入；6 組 synthetic_demo 手算案例與專案驗收報告由研究成果提供。未測真實偵測率或效能提升，也未將 WATSON 的 provenance 方法直接移植到滑鼠資料。

## 第七階段：收集器指標隔離與整合驗證

收集器一次只追蹤按下主按鈕的 pointerId。其他指標的 move/up/cancel 不混入目前試次；次要按鈕不能開始或提前結束主按鈕拖曳。放開、重設、切換任務、pointercancel 或意外 lostpointercapture 會清理活動狀態，必要時釋放 capture。取消的試次不提交，畫面清空，可由 START 再次開始；合法但未到 TARGET 的試次仍可保存。schema 與既有 up.is_dragging=true 契約不變。

`npm test` 現有 84 項測試，包含 13 項新的收集器與整合測試。collector.test.mjs 執行實際內嵌腳本，以 DOM/capture/fetch 替身隔離，並將 mouse/pen/touch 產出的 record 送入真實 API handler（記憶體 store）及特徵函式。這不是實體觸控、原生瀏覽器 capture 排程或正式 Netlify 的驗證；實體裝置仍需部署前 smoke test。

研究網站為獨立純本機分析介面，接受幾何可計算資料，不會替代 API 的知情同意、START、pointer_type 或儲存驗證。本次沒有更新已發布私人研究網站，也沒有部署正式收集器。
