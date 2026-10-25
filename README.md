# 結業證書產生器 v2.0

貼上學員名單，批次產出結業證書（PDF、PNG、JPG）。純前端，不需安裝，也不會把名單上傳到任何伺服器。

![結業證書產生器畫面（範例姓名：王小明）](docs/screenshot.webp)

## 開啟方式

用 Chrome 或 Edge 直接開啟 `index.html`。

- 預設字型（思源宋體）從 Google Fonts 載入，離線時改用電腦內建明體，介面會提示。
- 讀取「電腦已安裝的字型」只有 Chrome、Edge 支援；其他瀏覽器請用「上傳字型檔」。

## 使用流程

1. **學員名單**：一行一位，或用逗號、頓號、Tab 分隔。也可匯入 .xlsx、.csv、.tsv、.txt，或把檔案拖進名單欄。
2. **證書內容**：修改班級名稱、說明文字、主辦單位、講師、日期、證書編號。可用 `{姓名}`、`{序號}`、`{總數}` 等變數。
3. **版面調整**：在預覽上點選文字後拖曳，或用方向鍵微調。字級、字距、最大寬度、對齊、樣式都可改。
4. **匯出**：合併 PDF、每人一份 PDF、PNG、JPG（ZIP），或直接列印。

按 F1 可看完整說明與快捷鍵。

## 名單表格模式

首列含「姓名」欄時，自動進入表格模式：

| 姓名 | 班級名稱 | 日期 | 證書編號 | 成績 |
|---|---|---|---|---|
| 王小明 | | 2026-10-21 | A001 | 優 |

- 「班級名稱、講師、日期、證書編號、主辦單位、說明第一行、說明第二行」等欄會逐人覆寫證書內容，留空就用預設。
- 其他欄（如「成績」）可在文字中用 `{成績}` 引用。
- Excel 的日期會依「日期格式」設定轉成民國或西元。
- 「下載範本」可取得空白 CSV。

## 設定保存

- 設定自動存在這台電腦的瀏覽器（localStorage）。
- 上傳的字型與底圖存在瀏覽器資料庫（IndexedDB）。
- 「設定組合」可存多組常用設定；「匯出 JSON」可帶到別台電腦，但不含名單、字型檔與底圖檔。

## 檔案結構

```
index.html              主頁
style.css               樣式（含深色模式、窄螢幕）
templates/bg-navy-gold.js  內建底圖（base64）
vendor/jspdf.umd.min.js PDF 元件
js/core/                純函式，可在 Node 測試
  text.js               文字處理、日期、檔名、變數
  table.js              名單解析、表格模式、整理
  xlsx.js               讀取 .xlsx
  zip.js                產生 ZIP（含 CRC32）
  fields.js             欄位定義與欄名對應
  pages.js              每位學員的最終文字
  settings.js           設定預設值、驗證、版本轉移
js/templates.js         範本幾何
js/render.js            Canvas 繪製
js/fonts.js             字型註冊、缺字偵測
js/store.js             localStorage／IndexedDB
js/export.js            PDF、ZIP、列印
js/ui-*.js              各面板介面
js/app.js               狀態與協調
tests/                  單元測試
```

## 測試

```bash
npm test
```

使用 Node 內建 `node:test`，不需安裝套件。涵蓋 text、table、xlsx、zip、pages、settings 六個核心模組。

## 已知限制

- 列印結果依各印表機驅動而異，套印前請用白紙試印對位。
- 圖片輸出（PNG、JPG）在解析度 2x、3x 時會放大整張底圖，PNG 每張可能超過 20 MB。
- 自訂底圖的文字位置沿用內建範本比例，需自行在「版面調整」微調。
- 只讀取 .xlsx 的第一張工作表；舊版 .xls 無法讀取，會提示另存成 .xlsx 或 CSV。
- 介面沒有做自動化瀏覽器測試（E2E），UI 部分靠人工檢查。

## 授權

[MIT](LICENSE)。內附的 jsPDF（`vendor/jspdf.umd.min.js`）依其原本的 MIT 授權。

製作者：黃政文
