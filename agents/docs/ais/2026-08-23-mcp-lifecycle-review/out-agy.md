# agy 的回覆

> 工具：`agy` ／ 耗時：75.8s ／ exit：0
> 輸入：`.agent-tmp\ais\2026-08-23-0336-minecraft-edu-mcp-lifecycle-review\handoff.md`

---
這是一份針對 Minecraft Education MCP 程序生命週期修復的深度代碼審查與架構分析報告。

---

### 1. 這段 Code 在什麼輸入下會壞（具體輸入與預期錯誤）

#### 情況 A：測試腳本 `stdio-smoke.mjs` 中 `spawnRawServer` 啟動失敗
* **具體輸入**：在執行 `verifyOccupiedPortFailure` 測試時，若環境中的 Node.js 執行路徑錯誤、或權限不足，導致 `spawnRawServer` 本身丟出同步或非同步異常。
* **預期錯誤結果**：
  * 此時 `processState` 還未被成功賦值（為 `undefined`）。
  * 程式跳入 `finally` 區塊，執行 `await stopChild(processState.child)`。
  * 由於 `processState` 是 `undefined`，會拋出 `TypeError: Cannot read properties of undefined (reading 'child')`。
  * 這個 `TypeError` 將中斷 `finally` 的執行流，導致隨後的 `await closeNetServer(reservation.server)` **被跳過**。
  * 最終，用於測試佔埠的隨機 `net.Server` 將會被洩漏（持續監聽該 port），直到主 Node.js 測試程序結束。

#### 情況 B：WebSocket 連線更替（Replacing Connection）且舊連線不回應 Close Frame
* **具體輸入**：在 MCP 運行期間，有舊的 Minecraft 遊戲客戶端連線，因為新連線連入而被 `attachSocket` 取代。此時舊連線執行 `socket.close(1000)`，但遊戲端（或網路層）因卡死、繁忙或協定握手問題，**不回傳 close frame**，使舊連線持續維持在 `CLOSING` 狀態。隨後，MCP 接收到 STDIN EOF 訊號，觸發關機。
* **預期錯誤結果**：
  * `connection.close()` 只對當前最新的 `socket` 變數執行 `socket?.terminate()`。
  * `WebSocketServer.close()` 會等待 **所有** 客戶端（包括剛才處於 `CLOSING` 狀態的舊 socket）完全中斷後，才會觸發 `close` 的 callback。
  * 由於舊 socket 卡在 `CLOSING` 且未被 `terminate()`，`WebSocketServer.close()` 的 Promise 將會**永遠掛起（hang）**，造成關機流程死鎖，主程序無法釋放監聽 Port。

---

### 2. 邊界條件：空值、極值、併發、錯誤路徑、資源釋放

#### 併發與競態 1：STDIN 在非同步啟動中途關閉
在 `index.ts` 中，`runtime.connection.start()` 與 `connectStdio(server)` 均為非同步操作。
* **競態**：若 STDIN 的關閉事件在這些非同步操作**尚未 resolve 之前**發生，此時 `handlersInstalled` 仍為 `false`，系統還沒註冊 `process.stdin.once('end')`。
* **緩解與漏洞**：作者在 `main()` 尾端加了狀態檢查：
  ```typescript
  if (process.stdin.readableEnded || process.stdin.destroyed) {
    await shutdown('stdin-already-closed');
    return;
  }
  ```
  這能阻擋多數正常 EOF。然而，若 STDIN 遭遇的是讀取錯誤（`error` 事件）而非正常關閉，因為 `index.ts` 內**完全沒有**監聽 `process.stdin.on('error')`，該 unhandled error 會使 Node.js 異常退出，但在某些 debug 或 worker 執行環境下可能無法完成乾淨的 `closeResources`。

#### 併發與競態 2：非同步清理期間遭遇第二次 `SIGINT` / `SIGTERM`
* **競態**：在 `closeResources` 中等待 `Promise.allSettled` 的非同步期間，使用者再次按下 `Ctrl+C`。
* **資源釋放失敗風險**：因為 `removeShutdownHandlers()` 在 `closeResources` 開頭就立刻把自訂的 `SIGINT` / `SIGTERM` 監聽器移除，此時第二次訊號會觸發 Node.js 的**預設終止行為**，使程序當場中斷，尚未完成的 `Promise.allSettled` 清理邏輯直接夭折，連接埠和連線可能來不及釋放。

#### 資源殘留：`waitForExit` 監聽器殘留
* 在 `stdio-smoke.mjs` 的 `waitForExit` 內：
  ```javascript
  new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  })
  ```
  若該 Promise 因為 `setTimeout` 超時而 reject，`child.once('exit')` 的監聽器**依然會殘留在 `child` 物件上**，導致 listener 洩漏。

---

### 3. 跟這個 Repo 既有架構有無衝突

經查閱根目錄與 vibe 的 `AGENTS.md`，以及專案的 `README.md`，此 patch **與既有架構無衝突**：
* 遵守了 `ENV-001` 的「跨平台、不寫死絕對路徑、優先使用 Node 原生模組」規範。
* 遵守了 `SEC-001` 的「無祕密洩漏、不主動部署」規範。
* 符合新修訂的 `README.md` 契約 ——「同一台機器若刻意同時開多個 MCP client，請配置不同的 `MINECRAFT_EDU_WS_PORT`」。

---

### 4. 有沒有更簡單的做法達到同樣效果

#### A. 徹底消除 WebSocket 關閉死鎖的極簡做法
不需自行管理與追蹤個別的 `socket` 變數並調用 `terminate()`。`ws` 庫的 `WebSocketServer` 實例自帶 `clients` 集合（`Set<WebSocket>`）。
我們可以在 `close()` 時直接遍歷並強制關閉所有活動中的連線：
```typescript
async close(): Promise<void> {
  if (heartbeat !== null) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  failAllPending('MCP server 正在關閉。');

  // 強制 terminate 所有 client 連線（包含所有替換中、關閉中的 socket）
  if (server !== null) {
    for (const client of server.clients) {
      client.terminate();
    }
  }

  const active = server;
  server = null;
  if (active === null) return;
  await new Promise<void>((resolve) => {
    active.close(() => resolve());
  });
}
```
* **優點**：程式碼更短，且 100% 防範了任何 replacing / zombie client 卡死 `WebSocketServer.close()` 的死鎖問題。

#### B. 簡化生命週期管理與事件解除註冊
目前我們在 `index.ts` 中費盡心思使用 `removeShutdownHandlers` 去解除每一個 process 事件監聽器，目的是為了讓 Event Loop 自動排空退出。
其實，更安全、更直接的做法是在非同步清理 Promise 完成後，**明確調用 `process.exit(process.exitCode ?? 0)`**：
* **做法**：不用寫 `removeShutdownHandlers`，在 `closeResources` 的最後一行加入 `process.exit(process.exitCode ?? 0)`。
* **優點**：
  1. 不用維護複雜的 `handlersInstalled` 狀態與逐個解除監聽的代碼。
  2. 即使 Event Loop 因為第三方庫（如 `@modelcontextprotocol/sdk`）內部未清理乾淨的 timer 或 socket 殘留，也能確保程序 100% 退出，不會懸空掛起。
  3. 不需要擔心在清理期間移除 `SIGINT` 監聽器導致程序被預設行為攔腰砍斷的問題。
