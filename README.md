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
