# agy 的回覆

> 工具：`agy` ／ 耗時：21.0s ／ exit：0
> 輸入：`.agent-tmp\ais\2026-08-23-0415-blockhand-macos-support-plan\handoff.md`

---
### BlockHand macOS 支援方案交叉審查報告

根據 `C:/Users/GJLMoTea/Desktop/www/.agent-tmp/ais/2026-08-23-0415-blockhand-macos-support-plan/handoff.md` 的指示，針對四個核心問題進行系統級架構評估：

---

### 1. 架構與相依性：切分之正確性與 Stdio 生命週期風險
*   **Launcher 與 GUI PATH 的正確切分**：
    此設計極其精準。在 macOS 中，透過 Finder 或 GUI 啟動的應用程式（如 Codex Desktop）其父行程為 `launchd`，並不會讀取 shell 配置文件（如 `.zshrc`）。使用 `blockhand install` 時在 terminal 中抓取 `process.execPath` 的絕對路徑並寫入配置，能徹底避免 `nvm` / `Homebrew` 導致的 `Node command not found` 異常。
*   **Stdio 生命週期與效能隱患**：
    *   **GC 掉幀與 I/O 阻塞**：MCP 有多達 38 個 tools 且涉及實時遊戲數據。如果在 stdio 處理中頻繁分配與銷毀大 JSON 物件，V8 引擎的垃圾回收（GC）暫停將導致 stdio 通訊延遲甚至逾時。在架構上必須極力避免大物件頻繁分配。
    *   **EOF 與緩衝區殘留**：當 Codex 關閉 stdin 時，必須精確補捉 `end`/`close` 事件。在調用 `process.exit()` 前，需確保 `stdout` 的 write 緩衝區已完全 flush，否則對端會收到殘缺的 JSON-RPC 封包。

### 2. 安全與回滾：`codex mcp` 變更的可靠性
*   **Rollback 機制的潛在漏洞**：
    若 `codex mcp add` 失敗，通常意味著 Codex CLI、TOML 權限或檔案系統鎖定異常。此時執行 rollback `add` 原設定亦有極高機率失敗，將導致使用者原有的設定永久丟失。
*   **防禦性安全策略**：
    *   **硬備份優先**：執行 remove 之前，應先將 `~/.codex/config.toml` 複製一份備份（例如 `.toml.bak`），而非僅依賴 CLI 命令 rollback。
    *   **陌生同名拒絕**：若發現同名且無法識別為舊 BlockHand 的 entry，**必須一律停止並中斷流程（Abort）**，要求人工介入，絕不冒險覆寫。

### 3. 測試與驗收：無 Mac 真機下的驗證邊界與假陽性
*   **可有效證明的測試（Windows 模擬）**：
    *   **路徑與平台 Mock 測試**：模擬 POSIX 路徑風格（`/`）與 `process.platform = 'darwin'`，驗證 `codex-registration` 的解析邏輯。
    *   **Port 0 動態 smoke 測試**：用隨機埠啟動 MCP 並進行 stdio 握手與 tool/resource 列表拉取，證明核心在 POSIX 行為下 100% 正常。
*   **無法在 Windows 模擬的真機邊界（假陽性警訊）**：
    *   **macOS 防火牆與 Loopback 阻擋**：macOS 內建防火牆或沙盒機制（Sandbox）對 `/connect 127.0.0.1:<port>` 的限制，這是 mock 測試無法涵蓋的。
    *   **macOS 版 Minecraft 的 WebSocket 協議實現**：其 WS client 實作是否與 Windows UWP/Win32 版本有細微的 buffer size 或 frame 處理差異，必須以真機實測為準。

### 4. 範圍與順序：UI 自動化移除與相容性遷移
*   **移除 UI 自動化之合理性**：
    完全符合「不干擾使用者」與「極簡跨平台」之目標。自動化輸入（PowerShell / AppleScript）極易受系統焦點影響而失效，將 `/connect` 命令直觀呈現在 UX 上，由玩家複製貼上，能提供更安全且符合預期的互動心流。
*   **遷移與文件缺口**：
    *   **環境變數重載問題**：Codex Desktop 在 Mac 上常駐於背景，修改 `.env` 或安裝 MCP 後，**必須重啟 Codex Desktop 才會讀取到最新的環境變數**。此點必須在 README 明確註記。

---

### 收斂結論

*   **共同結論**：
    單一跨平台核心與 launcher-installer 的切分架構合理，移除非必要的 UI 自動化有助於提高整體系統的穩定性與跨平台可維護性。
*   **主要分歧**：
    原方案擬透過 `codex mcp` 命令進行 rollback，此做法在底層 CLI 異常時可能導致原配置損毀。應改為「實體檔案備份」與「遇陌生同名一律 Abort」的安全邊界。
*   **建議修正**：
    1. 在 `blockhand install` 執行前，手動建立 `~/.codex/config.toml` 的實體備份檔案。
    2. README 中應補上：安裝/升級 MCP 或修改環境變數後，必須**完全退出並重啟 Codex Desktop GUI**。
*   **GO 或 NO-GO**：
    **GO**（在補上實體備份與明確標示 Mac 真機未驗證狀態之前提下，此方案可行且方向正確）。
