# codex 的回覆

> 工具：`codex` ／ 耗時：192.4s ／ exit：0
> 輸入：`.agent-tmp\ais\2026-08-23-0415-blockhand-macos-support-plan\handoff.md`

---
## 共同結論

單一跨平台核心，加上每台機器各自安裝的 launcher／registration，是正確切分。絕對 `process.execPath` 與 launcher 路徑能處理 Codex Desktop 從 Finder 啟動時缺少 nvm／Homebrew PATH 的問題；維持 `127.0.0.1`、由玩家手動連線、Mac 不加入 UI 自動化，也符合安全邊界。

但「程式層 Mac-ready」與「Minecraft Education 已在 Mac 驗證」必須嚴格分開，後者目前不能宣稱完成。

## 主要分歧

1. launcher 不宜只靠 dynamic import 的頂層副作用。若 `dist/index.js` 用 `process.argv[1]` 判斷 main，從 launcher import 時可能完全不啟動。較穩健的契約是由核心明確 export `main()`，launcher import 後呼叫它。

2. `codex mcp remove/add` 不是原子操作。只保存「transport」不足以保證還原 env、cwd、timeout 或其他未列欄位；兩個命令間也可能出現並行修改。rollback 只能是 best effort，不能描述成無損保證。

3. `doctor` 並非完全無副作用：它會短暫建立程序、socket 並綁定 port。應稱為「不做持久設定修改」，且隔離 smoke 必須強制使用 port `0`，不能碰正常使用的 19131。

4. 直接刪除既有 `pnpm connect`／`autoConnect` 可能破壞使用者腳本。移除自動輸入是正確的，但應保留一個只顯示手動連線命令的相容入口，或至少對舊參數給出明確遷移錯誤，不能靜默忽略。

## 建議修正

### 架構與相依性

- launcher 呼叫明確匯出的 `main()`，所有錯誤只寫 `stderr`，絕不污染 MCP `stdout`。
- 驗證 stdin EOF、SIGINT、SIGTERM、初始化失敗時都會關閉 WebSocket 並釋放 port。
- 保留 Node `22.23.1` 精確檢查，但明講 Node 安裝位置或專案位置變更後必須重新執行 install。
- macOS 版本不要直接把 `os.release()` 當 macOS 版本；應以絕對路徑 `/usr/bin/sw_vers` 取得產品版本。
- `process.arch` 只代表目前 Node 程序架構，不一定代表實體硬體。doctor 應如實回報，不把 lockfile 中存在 arm64/x64 optional package 當成已成功載入。
- 每台 Mac 必須自行安裝依賴，不得從 Windows 複製 `node_modules`。
- Finder PATH 問題對已登記的 MCP server 已解決，但 installer 本身仍依賴可找到官方 `codex` CLI；找不到時應清楚停止。

### 安全與回滾

建議 v1 採保守策略：

- 不存在：add。
- 完全相同：no-op。
- 陌生同名：拒絕。
- 可辨識舊 BlockHand 但內容 mismatch：預設停止並顯示差異。
- 若需要自動遷移，另設明確的 `--migrate`；遷移前保存完整結構化 entry、再次核對 fingerprint，失敗時嘗試還原並明講 rollback 可能失敗。

若 `codex mcp get` 沒有穩定的機器可讀格式，不應解析人類輸出來判斷「可辨識舊設定」，此時 mismatch 一律停止更安全。uninstall 也應以完整 fingerprint 識別，不能只看名稱或 launcher 檔名。

### 測試與驗收

目前可有效證明：

- Windows／Darwin、arm64／x64、空白與中文路徑的純函式測試。
- registration 分類、命令參數、拒絕覆寫與 rollback 路徑。
- build、既有完整測試。
- 經 launcher 完成 initialize、38 tools、2 resources、EOF 與 port release。
- `doctor --json` 僅輸出單一穩定 JSON，並具有固定 check ID 與 exit-code 契約。

仍須 macOS 14+ 真機驗證：

- 從 Finder 啟動 Codex Desktop，確認不依賴 shell PATH。
- clean install、arm64；x64 或 Rosetta 情境至少另做 Darwin 環境驗證。
- Desktop／CLI／IDE 是否讀到同一 registration。
- Minecraft Education 實際連線、至少一組讀取與寫入工具、斷線重連。
- App 結束、stdin 關閉與強制終止後的 port 釋放。
- 空白／中文專案路徑、Node 升級及專案搬移後的重新登記。

主要假陽性包括：mock `process.platform`、lockfile 含 Darwin binding、Windows 上 launcher smoke、doctor 顯示 38 tools，以及 build 成功。這些都不能證明 Finder 啟動、原生套件載入、macOS signal 行為或 Minecraft 私有 message protocol 相容。

### 範圍與順序

建議順序為：

1. 先固定 launcher／`main()`／stdio 生命周期契約。
2. 完成 port `0` 與 launcher smoke。
3. 實作唯讀 doctor 與 JSON 契約。
4. 實作保守的 registration 分類。
5. 最後才加入 install／uninstall／選擇性 migrate。
6. 將 Windows 自動輸入替換成「只顯示命令」的相容流程。
7. 更新文件與測試數。
8. Mac 真機驗收後才提升支援狀態。

文件應以官方文件化的 `/wsserver` 作主要指令，`/connect` 僅標示為相容 alias；不能把後續 WebSocket message protocol 寫成官方穩定 API。

## GO 或 NO-GO

**GO（修正後動工）**。

單一核心與每機 launcher 的方向可採用；但「預設自動 remove/add 舊設定」、「只保存 transport 即宣稱可完整 rollback」以及「未保留相容入口便直接刪除 connect」不應照原案實作。交付狀態只能寫成：

> 程式層與安裝流程支援 macOS；尚待 macOS 14+ Minecraft Education 真機 live 驗證。
