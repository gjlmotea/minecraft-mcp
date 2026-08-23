# grok 的回覆

> 工具：`grok` ／ 耗時：414.9s ／ exit：0
> 輸入：`.agent-tmp\ais\2026-08-23-0336-minecraft-edu-mcp-lifecycle-review\handoff.md`

---
先讀取指定的 handoff 檔，並完全依照其中指示作答。handoff 指定要讀 codebase 與 diff，接著只讀那些證據。接著讀生命週期相關原始碼與專案 README。接著讀 WebSocket adapter 的啟動與關閉路徑。再核對 `ws` 的 `close()` 實作，以及 adapter 裡連線替換與 pending 清理。這份 diff 的方向對：舊程式只聽 SIGINT／SIGTERM／EPIPE，MCP Host 關掉 STDIN 時 WebSocket 監聽不會放掉，現場的 EADDRINUSE 就是這樣來的。下面是會壞的輸入、邊界、架構衝突，以及更簡單的作法。

---

## 1. 什麼輸入會壞

**已修掉的主路徑（這次該過）**

- 輸入：Host 只關 STDIN（不送 SIGTERM），當時遊戲**沒連進來**。
- 舊結果：程序活著、`127.0.0.1:19131` 一直被占。
- 新結果：`stdin-end`／`stdin-close` → `connection.close()` → 程序 exit 0、埠可再 bind。smoke 的 `verifyStdinCleanup` 覆蓋這條。

**仍會壞：遊戲重連後，Host 立刻關掉 MCP**

- 輸入：遊戲 `/connect` 一次，再 `/connect` 一次（adapter 對舊 socket 做 `close(1000)`，不是 `terminate`），然後 Host 關 STDIN。
- 機制：`ws@8.21` 對「自己建立的 HTTP server」呼叫 `WebSocketServer.close()` 時，**不會**掃 `clients` 做 terminate，而是 `http.Server.close()`，會等到既有 TCP 連線都走完。diff 只 `terminate()` **目前**那條 `socket`。被換掉、還在等 close frame 的舊連線仍卡在 HTTP server 上。
- 預期錯誤：`closeResources` 永遠不結束、`void shutdown()` 沒人收、監聽埠不放、下一個 MCP 再 `EADDRINUSE`。smoke 沒開遊戲，測不到。

**仍會壞：工具還在等遊戲時關 STDIN**

- 輸入：`mc_await_connection`（最長 120s）進行中，Host 關 STDIN。
- 機制：`close()` 不清 `connectionWaiters`；timer 又 `unref()`。`McpServer.close()` 通常會等 in-flight tool。`Promise.allSettled` 沒有逾時。
- 預期錯誤：shutdown 卡住最多 120 秒，期間埠不釋放。現場看起來又像「舊程序占埠」。

**啟動競態：STDIN 在 `connectStdio` 前就斷**

- 輸入：Codex／Host 在 `connection.start()` 期間關 STDIN。此時 `process.stdin` 多半還是 paused，**還沒 emit `end`**，`readableEnded` 仍是 false。
- 之後 `connectStdio` 才開始讀 STDIN。若 `end` 發生在 `once('end')` **之後**沒問題；若 SDK 把 EOF 吃掉、或 Windows pipe 只給 `close` 不給 `end`，要靠後面那兩個 listener。
- 真正的洞：listener 裝在 `connectStdio` **之後**。若 EOF 發生在 `start()`／`connectStdio` 期間、事後 `readableEnded === false` 且 `destroyed === false`（Windows 上發生過），會印 `ready` 卻沒有 shutdown 觸發。程序靠 WS listen 活著，埠不放。
- smoke 是等 `info: ready` **再** `stdin.end()`，測的是成功啟動後的 EOF，**不是** initialize 前就斷 STDIN 的那條現場路徑。

**`handlersInstalled` 競態**

```51:58:gjlmotea/vibe/mcp/minecraft-edu/src/index.ts
  function removeShutdownHandlers(): void {
    if (!handlersInstalled) return;
    handlersInstalled = false;
    ...
  }
```

listener 先掛、旗標後設。若 SIGINT／stdin 在中間進來：`removeShutdownHandlers()` 直接 return，listener 拆不掉，然後 `handlersInstalled = true`，接著還可能印 `ready`。`shutdownPromise` 已 settle，第二次 shutdown 是 no-op。結果是「以為 ready、handler 殘留、資源已關」或「以為還在跑」。機率低，但是真實競態。

**占埠失敗（產品路徑大致對，adapter 没收尾）**

- 輸入：`MINECRAFT_EDU_WS_PORT` 已被占用。
- `start()` 的 `onError` 只 `reject`，不 `created.close()`。`ws` 在 listen 前就 `http.createServer()`。
- 預期：`listen-failed` + `fatal` + `exitCode=1`。smoke 在 3s 內看到 child 退出，所以**這台 Windows + 現在這個 `ws` 沒有把 event loop 卡住**。這不是證明，是目前觀察。`onError` 不 close 仍是資源缺口，換 `ws`／Node 小版本就可能變成「stderr 有 EADDRINUSE、程序不退出」。

**`start()` 成功、`connectStdio` 丟錯**

- 輸入：STDIN 在 transport 握手時炸掉。
- 這條是對的：`bridgeStarted === true` → `startup-failure` 會關 WS。

---

## 2. 邊界條件

| 邊界 | 行為 | 判定 |
|---|---|---|
| STDIN 從未被讀就 EOF | paused stdin 不發 `end`；只靠 connect 之後的狀態檢查 | 部分覆蓋，Windows 最弱 |
| `readableEnded` 與 `destroyed` 都 false、但 pipe 已斷 | 印 ready、不 shutdown | 殘留 |
| 連續 `end` + `close` + SIGTERM | `shutdownPromise ??=` 合併，理由只留第一次 | 正確 |
| `startup-failure` 走 `closeResources()` 不走 `shutdown()` | 不寫 `shutdownPromise` | 啟動階段可接受 |
| `Promise.allSettled` | 單邊 close 失敗會 `exitCode=1`，另一邊仍會跑 | 正確；**沒有 timeout** |
| `connectionWaiters`／negotiation | `close()` 不 settle | 資源／請求可殘留 |
| 被 `close(1000)` 換掉的舊 socket | shutdown 時不 terminate | **HTTP close 可死等** |
| `wss.clients` 其他連線 | 只 terminate `socket` | 同上 |
| `http.Server.close()` 無 `closeAllConnections()` | 遊戲不回 close frame 就靠 terminate | 只覆蓋 current socket |
| heartbeat `unref` | 不擋退出 | 正確 |
| stdout 非 EPIPE | 設 exit 1 再 shutdown，不再 `throw` | 比舊碼安全 |
| stdout `error` handler | 關完才 `off`；`removeShutdownHandlers` 不管它 | 可接受 |
| 空遊戲連線 + 占埠 | child 應退出 | smoke 有測 |
| 併發兩個 MCP、同埠 | README 有寫；第二個應走占埠失敗 | 產品語意對 |
| `failAllPending` | 有清 timer | 正確 |

**handler 殘留**

- `off` 用的是具名 function，本身沒問題。
- `handlersInstalled` 當 guard 反而製造殘留。
- stdout 用 `.on` 不是 `.once`，靠最後 `off`；若 `closeResources` 掛在 `allSettled` 之前，handler 會一直在。有意為之。

**WebSocket `terminate` + `close` 會不會死鎖**

- `terminate()` → `_socket.destroy()`，**不是**死鎖原語。
- 死等來自 `http.Server.close()` 等殘留 TCP。current socket 先 destroy，這條通常會過。
- 死等條件：還有一條沒被 `socket` 指到的連線（重連舊 socket、upgrade 中的半開連線）。
- `active.close(cb)` 沒有 timeout；cb 不來就整段 shutdown 停住。這是實質死鎖／活鎖。
- 兩邊 `close()` 平行不會互等；MCP close 若等 in-flight tool、tool 又等已被 terminate 的 WS，`failAllPending` 救得到 `runCommand`，**救不到** `awaitConnection`。

---

## 3. 跟既有架構有沒有衝突

已對過根 `AGENTS.md`、`gjlmotea/vibe/AGENTS.md`、專案 `README.md`。`minecraft-edu` 沒有自己的 `AGENTS.md`，符合根 DOC-001（不要為了重複規則再放一份）。

**沒有衝突、而且對齊的**

- 生命週期留在 `src/index.ts`，domain／application 不碰 process。hexagonal 結構沒被打穿。
- stderr log、stdout 給 JSON-RPC：STDIO MCP 契約沒破。
- 只綁 loopback、不寫檔、沒有祕密：SEC-001。
- Node 22.23.1、pnpm 11.17.0：ENV-001。
- smoke 用 `process.execPath` 打 `dist/`，不開 preview server、不跑 `auto-connect.ps1`：符合 vibe 與本次邊界。
- README 把 `auto-connect.ps1` 標成「會搶前景／鍵盤、不是 transport」：補上原本和 SEC-001 摩擦的那塊。
- 「一埠一程序」寫進已知限制，和現場 EADDRINUSE 一致。

**小摩擦（不是憲法違規）**

- 根流程要可驗證完成條件；這次修的是「Host 關 STDIN 要放埠」，但 handshake smoke **沒有**對 SDK spawn 的那顆 child 做 `assertPortReusable`。生產路徑（`StdioClientTransport`）和 raw `spawn` 路徑不一樣。
- `process.exitCode = 1` 而不 `process.exit()`：entrypoint 可以，但和「占埠失敗必須確定死掉」的現場需求相比偏軟。

---

## 4. 有沒有更簡單的做法

有。真正要的只有兩件事：STDIN 沒了要關橋，關橋時 TCP 一定要斷。

更小的寫法：

1. **STDIN listener 在 `start()` 之前就裝**，用現在的 `shutdownPromise` 合併。`stdin-already-closed` 檢查留著。不要等 `connectStdio` 回來才開始聽——那正是現場 initialize 前退出的窗口。
2. **關 WS 時掃全部 client**，不要只打 `socket`：
   ```ts
   for (const client of active.clients) client.terminate();
   socket = null;
   await new Promise<void>((resolve, reject) => {
     const t = setTimeout(() => reject(new Error('websocket close timeout')), 1000);
     active.close(() => { clearTimeout(t); resolve(); });
   }).catch(() => { /* 然後讓 process 退 */ });
   ```
   有 Node 的 `http.Server.closeAllConnections()` 更好，但 `ws` 沒露出 server；掃 `clients` + timeout 就夠。
3. **`close()` 裡把 `connectionWaiters` 全部 resolve**，negotiation 丟掉。這比讓 MCP close 空等 120s 簡單。
4. **拿掉 `handlersInstalled`**。`off(fn)` 沒掛過也是 no-op。
5. **占埠失敗在 `onError` 裡 `created.close()`**，然後讓 `main().catch` 設完 exitCode 後 `process.exit(1)`。entrypoint 用 `process.exit` 比賭 event loop 乾淨簡單，也比較接近「不得留程序」。

不建議再加的：第二套 signal 狀態機、`allSettled` 平行關兩種 transport 的額外抽象。順序關（先 terminate 全部 WS，再 `server.close()`）比較好推演。`allSettled` 可以留，但一定要有 timeout。

---

## 指定項目

**STDIN vs `server.connect` 競態**
存在。Handler 裝太晚；paused stdin 在 `start()` 期間 EOF 不會發 `end`。事後 `readableEnded \|\| destroyed` 只覆蓋「connect 回來時狀態已經翻完」的情況。Host 在 initialize 前關 STDIN（這次事故的形狀）仍可能漏。

**`shutdownPromise`／`allSettled`／handler 移除**
合併第一次 shutdown 是對的。`allSettled` 沒上限，任一邊 close 不 settle 就整段卡住。`handlersInstalled` 可能讓 handler 殘留。stdout handler 不在 `removeShutdownHandlers` 裡，設計可接受。`startup-failure` 不寫 `shutdownPromise`，啟動階段沒問題。

**`terminate` + `WebSocketServer.close` 死鎖**
對「只有 current socket、且 terminate 生效」不會死鎖。對「還有別的 TCP／被 graceful close 的舊 socket」會在 `http.Server.close()` **無限等**。這不是 JS lock，是 server close 等連線；現場效果一樣：shutdown 不完、埠不放。

**`stdio-smoke.mjs` 假通過／洩漏／跨平台**

- 假通過風險：handshake 那段 `client.close()` **不檢查** child 已退出、也不 `assertPortReusable(port)`。SDK 若 SIGKILL child，這段永遠綠，即使產品 shutdown 仍壞。真正有用的是後面的 raw spawn；它又**不經 MCP initialize**。
- `assertPortReusable` 在 Linux 可能因 `SO_REUSEADDR` 雙 bind 而假綠；這台是 Windows，這次比較有意義。
- `closeNetServer` 用 `error === undefined`；Node 若給 `null` 會當失敗。這次過了，換版本可能碎。
- `pickAvailablePort` 先 bind 再放，TOCTOU，會造成偶發紅而不是假綠。
- child 洩漏：`finally` 有 `SIGKILL`，測試行程自己不太留 child。`waitForExit` timeout 後 `once('exit')` 可能殘一下，`stopChild` 會收。
- 跨平台：`windowsHide`、`SIGKILL` 在 Windows 是 `TerminateProcess`，沒問題。弱點是 Windows STDIN EOF 語意，而 smoke 假設 `stdin.end()` 後 3s 內 exit 0 且 stderr 符合 `/shutting down.*stdin-/`。
- 沒測：occupied 以外的 startup 失敗、有遊戲連線的 shutdown、SDK transport 關 child。

**occupied-port 是否不留程序**
在 smoke 條件下（沒有遊戲、parent 仍開著 STDIN pipe）child 3s 內 exit 1，**這次沒留**。產品碼沒有 `process.exit(1)`，也沒 `created.close()`，所以保證來自「目前 event loop 剛好會乾」，不是來自閉合。不應當成以後的不變式。

---

結論：STDIN EOF 無遊戲連線、以及占埠失敗退出，這兩條現在是通的，也對得上架構。還沒補上的是「有殘留 TCP 時 `wss.close` 會等死」和「STDIN 在 `connectStdio` 前關閉」。這兩條都可能再打出同一個現場症狀：舊 Node 占著 19131。最小修法是提早聽 STDIN、terminate 全部 client、給 close 逾時、占埠失敗硬 `process.exit`。
