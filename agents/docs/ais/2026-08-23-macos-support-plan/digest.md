# BlockHand macOS 支援方案審查摘要

## 呼叫結果

- 詢問：grok、codex、agy
- 成功：3／3
- 失敗：無
- 裁決：兩份明確 GO、一份 Conditional GO；修正契約後可動工

## 共同結論

1. 核心維持單一 Node／stdio／loopback WebSocket 實作，不做 macOS 協定分叉。
2. 每台機器用該機絕對 Node 與 launcher 路徑登記一次；同機 Codex Desktop／CLI／IDE 共用設定，跨機不共用絕對路徑。
3. 維持 `127.0.0.1`、不開 LAN、不改防火牆；只信目前 MCP task 的 `mc_status.connectCommand`。
4. 移除鍵鼠／前景視窗自動化符合使用者要求；Windows、Mac 統一手動 `/connect`。
5. 目前只能宣稱「程式層與安裝流程支援 macOS」；Finder 啟動、POSIX lifecycle 與 Minecraft live 必須留到 macOS 14+ 真機。

## 動工前採納的修正

- launcher 以 `URL.href` import、成功路徑不寫 stdout、錯誤只寫 stderr；Node 與 launcher 登記路徑使用 realpath。
- 核心提供明確可呼叫的 `main()`／runtime entry，不依賴 import side effect。
- doctor 的 smoke 使用隔離動態埠，不碰正常 19131；macOS 14 是 Minecraft 的 warning／驗收門檻，不是純 MCP runtime 的硬失敗。
- 安裝器 v1 採保守狀態機：不存在才 add；完全相容 no-op；任何 mismatch 或陌生同名一律停止並顯示差異，不做非原子的自動 remove/add，因此不需要宣稱不可能保證的 rollback。
- uninstall 只在使用者明確呼叫、且 fingerprint 能確認是本工作樹 BlockHand 時移除。
- 保留 `pnpm connect` 名稱作安全相容入口，但只解釋如何從 `mc_status` 取得手動指令；不綁埠、不啟動遊戲、不模擬輸入。
- adapter 單元測試改用 port 0；路徑測試明確使用 `path.win32`／`path.posix`，不把 mock platform 當 Mac 真機證據。
- 文件補上 Mac 必須在本機 install/build、不可複製 Windows `node_modules`、登記後需完全重啟 Codex，以及自動輸入已有意移除。

## 主要分歧與取捨

- grok／agy 建議若自動遷移就先備份整份 TOML；codex 建議 v1 預設停止。採後者：本次不做自動遷移，避免設定遺失與並行寫入競態。
- grok 建議本工作樹舊 entry 可自動換新；本次只把現有 direct-dist 形狀視為相容，不強制遷移，保留既有 timeout／tool policy。
- agy 提到大 JSON／GC，但本次是安裝與平台支援，沒有證據顯示需修改 MCP 工具資料流，故不擴張範圍。
- codex 建議 `/wsserver` 作主要文件稱呼；產品 UX 仍可展示官方 alias `/connect`，但會明確說明 message protocol 並非受保證的公開穩定 API。

## 實作順序

1. 明確 runtime entry + launcher + launcher smoke。
2. registration 純函式與測試。
3. `blockhand install/doctor/uninstall/connect`。
4. 移除 PowerShell／run-plan 自動輸入路徑。
5. port 0 測試、env 範例與跨平台文件。
6. Windows 全驗證；Mac 真機驗收維持待辦狀態。
