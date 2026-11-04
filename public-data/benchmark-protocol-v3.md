# v3：已知使用者代理驗證（評估前固定）

2026-11-04 第3輪；未開啟官方 test 或 public labels。v1/v2 不變，本文件增加獨立探索性任務；不能替代官方冒用測試。不同合法訓練使用者的 session 被配對到其他 claimed account，正類為「來源身分與宣稱不符的建構配對」，不是實際攻擊或 bot。來源使用者完全已知。曾指定的 user35/user7/user9 完全排除模型、閾值及成績；其未見使用者泛化仍待驗證。

保留 v2 隔離；每 session 對每特徵取有效片段中位數，空值不補零，缺值用 train 中位數並報缺值量。速度組 mean_speed/max_segment_speed/mean_abs_acceleration；停頓組 pause_duration/repeated_position_ratio；幾何組 path_length/displacement/path_efficiency。train 全域中位數/IQR 縮放，IQR=0 用1；每 claimed user 的原型僅為兩個 train session 的中位數。每來源 session 與全部7個開發帳戶配對（1 genuine/6 mismatched），絕對差為模型輸入。方法一平均平方差，方法二 ridge 線性最小平方（含不罰截距、lambda=1、無搜尋）；不做 logistic 效能宣稱。train 的 genuine 原型含自身造成樂觀擬合，明示此限制；validation/reserved 完全不含訓練 session。

full、三組 only、三組 leave-one-out 全部預定，禁止挑最佳。所有方法及消融先用 train 擬合，再於 validation genuine 分數最大值固定閾值，分數嚴格大於才警報。7個 genuine 無法可靠校準5% FPR，僅有1/7解析度，必須明示。最後一次讀 reserved 配對做代理任務評估；保留 predictions，每個來源/宣稱/分割可查。

ROC-AUC 使用 ties 半分；PR-AUC 使用依同分閾值分組的 average precision；報類別比例、FPR/FNR及固定閾值。常數機會模型 AUC=.5、AP=正類比例、全部預測 genuine。主要95%百分位區間以來源使用者叢集 bootstrap 2000次，種子20261104；每次同時保留該來源所有session及claimed配對。只有7群且claimed共享原型，此區間不涵蓋訓練集或claimed端不確定性；不聲稱人口推論。消融只作探索性比較，不重選設定。按session留存結果，不以49配對當49獨立樣本。

本輪不新增原始資料。依賴 numpy=2.5.3；資料版本、manifest與輸入SHA256另存 run-metadata.json。乾淨兩次執行核心表需一致。官方冒用、跨來源使用者完全獨立測試、DARPA實證仍未完成。
