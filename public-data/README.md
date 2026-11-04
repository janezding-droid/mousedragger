# 公開資料離線實驗（進行中）

不使用正式 collector API；不推斷 bot、同意或 TARGET。原始檔不加入 Git。Balabit 明確授權檔未見，僅有研究可取得聲明；不要將原始資料打包到網站。DARPA 官方聲明 public domain，資料品質不保證。

依賴：Node 24.20.0、Python 3.13.13（實際版本另記於驗證結果）；全為標準函式庫，canonical features.mjs 直接引用。原有 npm 鎖保持不變。

```powershell
python public-data/download_balabit.py public-data/selection.json C:/path/to/raw/balabit
python public-data/reproduce.py public-data/selection.json C:/path/to/raw/balabit C:/path/to/NEW-output --measure
node --test public-data/balabit.test.mjs
python -m unittest discover -s public-data -p 'test_*.py' -v
```

必須使用未存在的輸出目錄。下載檔與 pinned Git blob 驗證相符才能分析；既有資料重用仍驗證。fragments.jsonl 包含完整衍生座標，保留工作目錄，未確認授權不再散布。彙總 CSV/JSON 可供報告。重跑不讀 test_files 或 public_labels.csv。

DARPA 解析命令（取得官方 JSONL 後）：

```powershell
python public-data/darpa.py C:/path/to/official.jsonl C:/path/to/darpa-output
```

目前只支援 CDM18 命名空間及 JSON 解碼後字串 UUID／標準 Avro union；其他編碼明確失敗，不能猜測。奈秒用 Python 整數；兩個 object 與 host 保留，圖為事件參數關聯圖，不假設因果流向。摘要保留每個 occurrence 的檔案／行號與原始行雜湊、事件 UUID；verify 檢查覆蓋、端點、時間界與 ID。完整原始事件保留於來源檔，彙總不代表完整 WATSON 或因果重現。

DARPA 尚無可用原始事件或攻擊 PDF；6 個合成契約測試不算 DARPA 外部實證。去重基準目前是相同 host/subject/object/object2/type/time 的參數鍵去重，並非全記錄 byte 精確去重；需取得資料後補全記錄對照。未標註真值一律 unknown。

分類切分為 provisional：跨集合精確片段已發現，尚待隔離、近重複檢查與冒用來源復原；不得用目前 split 直接聲稱獨立泛化。公開測試標籤尚未載入，沒有分類成績。後續驗收詳見 protocol.md 與專案 quality-status.json。
