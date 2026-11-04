# 公開資料離線實驗（進行中）

不使用正式 collector API；不推斷 bot、同意或 TARGET。原始檔不加入 Git。Balabit 明確授權檔未見，僅有研究可取得聲明；不要將原始資料打包到網站。DARPA 官方聲明 public domain，資料品質不保證。

依賴：Node 24.20.0、Python 3.13.13（實際版本另記於驗證結果）；核心解析全為標準函式庫，canonical features.mjs 直接引用；--quality 圖表使用 requirements-quality.txt 固定的 matplotlib 與相依版本。原有 npm 鎖保持不變。

```powershell
python public-data/download_balabit.py public-data/selection.json C:/path/to/raw/balabit
python -m pip install -r public-data/requirements-quality.txt
python public-data/reproduce.py public-data/selection.json C:/path/to/raw/balabit C:/path/to/NEW-output --measure --quality
node --test public-data/balabit.test.mjs
python -m unittest discover -s public-data -p 'test_*.py' -v
```

必須使用未存在的輸出目錄。下載檔與 pinned Git blob 驗證相符才能分析；既有資料重用仍驗證。fragments.jsonl 包含完整衍生座標，保留工作目錄，未確認授權不再散布。彙總 CSV/JSON 可供報告。重跑不讀 test_files 或 public_labels.csv。

DARPA 解析命令（取得官方 JSONL 後）：

```powershell
python public-data/darpa.py C:/path/to/official.jsonl C:/path/to/darpa-output
```

目前只支援 CDM18 命名空間及 JSON 解碼後字串 UUID／標準 Avro union；其他編碼明確失敗，不能猜測。奈秒用 Python 整數；兩個 object 與 host 保留，圖為事件參數關聯圖，不假設因果流向。摘要保留每個 occurrence 的檔案／行號與原始行雜湊、事件 UUID；verify 檢查覆蓋、端點、時間界與 ID。完整原始事件保留於來源檔，彙總不代表完整 WATSON 或因果重現。

DARPA 尚無可用原始事件或攻擊 PDF；第2輪取得官方操作日誌，不能當攻擊真值。8 個合成契約測試不算 DARPA 外部實證。基準包括 raw occurrence、原始行 byte SHA256 精確去重（含換行差異）、參數時間鍵、1s/10s 聚合，全部保留 occurrence refs。verify_source 從實際原始檔重讀行號／雜湊／所有正規化欄位；沒有原始事件不能宣稱完成外部驗證。未標註真值一律 unknown。現行 parser 全量保留記憶體，大型批次須先制定有背景的最小案例與記憶體上限。

第2輪已隔離跨集合全部精確／正規化候選出現：46,950 中隔離42,544，保留4,406。候選規則易誤併短點擊且可能漏過量化邊界近鄰，不能宣稱完整防洩漏。test冒用來源與未見使用者泛化未驗證，分類仍關閉。公開測試標籤尚未載入，沒有分類成績。後續驗收詳見 protocol.md 與專案 quality-status.json。


--quality 產出 split-manifest.json、leakage-audit.json、per-session feature-distributions.csv、robustness-results.csv/JSON、cases.json/MD 與 PNG/SVG 圖。首尾保留的下採樣、縮放、5ms單調時間抖動、5%內部缺失及pause/時長敏感度只用隔離後train。圖同列session中位數的中位數與最大配對絕對差，避免中位數零值掩蓋尾端變化。案例只有來源ID及度量，完整回放仍待整合；不是分類成功／失敗。


第3輪代理任務（v3協議先於保留集評估固定）：

```powershell
python public-data/benchmark.py C:/path/to/analysis/fragments.jsonl C:/path/to/quality/split-manifest.json C:/path/to/NEW-benchmark-output
python public-data/render_benchmark.py C:/path/to/benchmark-output
```

使用 requirements-quality.txt 的 numpy 2.5.3。這是7位已知合法來源使用者的建構配對身分不符代理，不是官方冒用或bot標籤；user35/user7/user9完全排除。全量／三組only／三組leave-one-out、距離與ridge線性方法均報，未按保留集選模型。固定validation genuine最大閾值，7個genuine無法校準5%誤報；使用者bootstrap不涵蓋claimed端或training不確定性。正式test／public labels仍未開啟。本輪先前「分類關閉」描述指官方冒用任務；代理任務另見 benchmark-protocol-v3.md。輸出predictions含來源session及claimed user，模型輸入與缺值量見session-features。


第4輪新增（以下狀態取代前文歷史快照）：官方 E5 TRACE 42,992,814-byte 終端分片已取得。內嵌 CDM20 Avro schema，不是 CDM18 JSON；前10,000 records含8,813 events。只有可讀性與摘要探索，未取得E5攻擊真值、未確認完整主機/時間背景，attack_retention=null。不同資料集不混算。固定16-byte UUID以hex保留；hostId取CDM20外層；奈秒整數不轉float。來源定位為整個壓縮檔SHA256+Avro record ordinal，另保存完整解碼紀錄canonical hash，不能當raw byte dedup。原始檔不提交Git，不執行任何事件內命令。

```powershell
python -m pip install -r public-data/requirements-avro.txt
python public-data/avro_probe.py C:/path/to/ta1-trace-3-e5-official-1.bin.178.gz C:/path/to/NEW-avro-output --limit 10000
python public-data/render_avro_probe.py C:/path/to/avro-output C:/path/to/plot-output
python public-data/profile_pipeline.py public-data/selection.json C:/path/to/raw/balabit C:/path/to/NEW-profile-output
python public-data/audit_cases.py C:/path/to/cases.json C:/path/to/fragments.jsonl C:/path/to/raw/balabit C:/path/to/NEW-case-output
```

profile_pipeline量10/20/40 sessions各兩次，完整包含CSV匯入/特徵、獨立原始列驗證、重複隔離、穩健性與繪圖；不同session數的split及隔離工作量不同，不能推導線性擴充或分類比較。每次是新程序，OS cache未控制，首次不稱cold cache。CSV列出Python validator與兩個Node stage各自OS峰值；沒有量render子程序或整棵程序樹同時峰值，不加總冒稱總記憶體。40 sessions原始列全量快取使validator約845MiB，後續串流改善仍待。案例逐點/時間/來源雜湊/路徑獨立驗證，靜態回放已補，動畫網站仍待。


第5輪新增：官方E5真值PDF與bins.md5sum已取得，原分片符合發布者MD5。報告TRACE2案例與本機TRACE3檔名不可直接對齊，CDM hostUUID映射未建立；所有事件仍unknown。5/17 Azazel報告作者稱未建立C2並視描述活動為良性，不得因工具名補正類。2018操作日誌屬E3，不是E5。

```powershell
python public-data/profile_context.py C:/path/to/shard.gz C:/path/to/NEW-context-profile
python public-data/audit_context.py C:/path/to/shard.gz C:/path/to/NEW-context --limit 1000000
python public-data/render_context.py C:/path/to/NEW-context/context.json C:/path/to/figures
```

profile_context單一命令執行1k/10k/100k records各兩次新程序、第二次來源重讀、輸出hash比對與OS程序峰值/時間。它量context稽核，不是完整摘要建構；cache未控制。audit_context以host+UUID解析同有界範圍內的晚到定義，保留缺漏例、固定六指標大小寫敏感substring匹配及欄位位置/解碼hash。匹配不是真值，零匹配不是良性。100萬筆subject不同UUID676/702有定義，但事件出現次數只有93798/889289，分母不可混淆。缺定義可能在其他分片；不猜因果方向或時間順序。四個新增合成契約測試不算外部攻擊成績。
