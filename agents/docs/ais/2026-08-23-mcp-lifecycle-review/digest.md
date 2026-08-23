## 摘要

- Grok 與 agy 都指出兩個可重現的殘留風險：STDIN listener 安裝得太晚，以及遊戲重連後只終止目前 socket、沒有終止 WebSocketServer 追蹤的所有 clients。
- 主 agent 回讀 Node/ws 與專案程式後確認兩點皆成立，已在原任務授權範圍內修正：啟動前先掛 STDIN／signal handler、記錄啟動中的 shutdown request、終止完整 clients 集合、清空 connection waiters，並加入 1.5 秒 bridge close 上限與 3 秒程序 hard stop。
- smoke 新增 initialize 前 EOF、ready 後 EOF、port 可重用、occupied-port exit 1；Vitest 新增遊戲重連後釋放同埠與 close 立即結束 awaitConnection。
- Codex reviewer 因其外層唯讀限制拒絕讀 codebase/diff，視為缺席，未拿它的未知判定充作審查證據。

## 分歧對照

### #1 正常 shutdown 是否應直接 process.exit

- Grok：建議在 bounded cleanup 後確定退出，避免第三方 handle 殘留。
- agy：建議 closeResources 完成後直接 process.exit，藉此簡化 handler 管理。
- 我查證的結果：直接 process.exit 會截斷正常 flush，無須在成功清理時使用；但 close 失敗或逾時時必須有 hard stop。
- 證據：src/index.ts:94、src/index.ts:105。
- 採用：保留自然退出；只有 3 秒仍未完成，或 startup fatal 尚有 handle 時才強制退出。

### #2 WebSocketServer.close 是否可能因舊 client 永久等待

- Grok：replaced socket 可能留在 server.clients；只 terminate 目前 socket 不足。
- agy：相同結論，建議遍歷 server.clients。
- 我查證的結果：真的有。attachSocket 對舊 socket 只送 graceful close，而 ws 會持續追蹤到 close event；server.close 會等所有 tracked clients。
- 證據：src/adapters/ws-minecraft-connection.ts:487、tests/adapters/ws-connection.test.ts:86。
- 採用：關閉時 terminate 全部 clients，並用同埠重綁測試驗證。

### #3 STDIN 在 initialize 前關閉

- Grok：listener 裝在 connectStdio 後仍有漏接 EOF 的競態。
- agy：相同結論，指出啟動中的 async window。
- 我查證的結果：真的有。事後 readableEnded 檢查不能取代先掛 listener。
- 證據：src/index.ts:114、src/index.ts:121、scripts/stdio-smoke.mjs:122。
- 採用：先安裝 handler，以 shutdownRequested 跨越 async startup，並新增 early-EOF child smoke。

## 只有一人提到

### connectionWaiters 未在 close 時 settle

- 誰說的：Grok。
- 我查證的結果：真的有；timer 雖然 unref、不一定讓程序常駐，但工具請求會不必要地保持 pending。
- 證據：src/adapters/ws-minecraft-connection.ts:373、src/adapters/ws-minecraft-connection.ts:493。
- 採用：close 時立即以 listening=false、connected=false 結束 waiters，另有 120 秒等待被立即解除的測試。

### waitForExit timeout 後殘留 exit listener

- 誰說的：agy。
- 我查證的結果：真的有，但只在 smoke timeout 錯誤路徑。
- 證據：scripts/stdio-smoke.mjs:77。
- 採用：timeout 時明確 child.off('exit', onExit)。

### spawnRawServer 失敗會使 processState undefined

- 誰說的：agy。
- 我查證的結果：誤判。child_process.spawn 會先回傳 ChildProcess；執行檔啟動失敗走 error event，不會讓已完成的 const 賦值變 undefined。process.execPath 在本測試又是已執行中的 Node 路徑。
- 證據：scripts/stdio-smoke.mjs:43。

## 缺席

- Codex：工具回覆成功，但因其外層限制拒絕讀 handoff 所列 codebase 與 diff，沒有完成實質審查。
- Grok、agy：皆完成；agy 的單獨意見已逐一由本地程式與測試驗證，未直接採信。
