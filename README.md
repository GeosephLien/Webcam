# Spatial Webcam 3D Demo

這是一個純前端的 3D webcam 雙人搶球原型。

## 功能

- 開啟 webcam 後做雙手追蹤
- 左半邊是 P1，右半邊是 P2
- 先碰到中央能量球的人持球
- 把球帶回自己那一側就得分
- 直接用靜態主機部署即可

## 本機執行

因為瀏覽器的 webcam 權限通常只允許 `https` 或 `localhost`，不要直接雙擊 `index.html` 用 `file://` 開啟。

可用以下方式啟動本機伺服器：

```powershell
python -m http.server 8080
```

然後打開：

```text
http://localhost:8080
```

## 檔案

- `index.html`: 頁面結構
- `styles.css`: 視覺樣式
- `app.js`: Three.js + MediaPipe 雙人搶球邏輯
