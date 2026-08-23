# BlockHand macOS implementation review 摘要

## 呼叫結果

- 詢問：grok、codex、agy
- 成功：3／3（工具程序皆 exit 0）
- 有效審查：grok 完整讀取 diff；agy 讀取但多項結論與實碼不符；codex 因自身讀檔限制拒絕審查
- 外加一位專案內唯讀 reviewer 檢查現行工作樹
- 總裁決：`PASS WITH FIXES`

## 已查證 findings

### #1 compatible entry 可能實際無法由 Codex Desktop 啟動（P1）

- 誰說的：grok、專案內 reviewer
- 我查證的結果：真的有
- 證據：`scripts/lib/codex-registration.mjs` 的 `isNodeCommand()` 只看 basename；`classifyRegistration()` 沒驗 command 是存在的絕對路徑或 Node 版本。`scripts/blockhand.mjs` 的 doctor 又以目前 `process.execPath` 跑 smoke，而不是 entry 的 command／args／env。
- 可重現：command=`/does/not/exist/node` 或裸 `node`、args 指向本工作樹、三個 env 齊全，會分類 `compatible`；install no-op，doctor 可整體 exit 0。
- 修正：compatible 必須使用可執行的絕對 Node 路徑、實際版本 22.23.1；doctor 與 install preflight 必須用真正 registration argv/env initialize。

### #2 舊 direct-dist entry 的缺省 env 被判得過嚴（P1）

- 誰說的：grok
- 我查證的結果：真的有
- 證據：`requiredEnvironmentMatches()` 要求 HOST、PORT、FALLBACK 三個 key 都存在；`readRuntimeConfig()` 對缺少 HOST／FALLBACK 本來就有相同安全預設。先前 README 的手動範例只設 PORT。
- 結果：同工作樹、可用且有自訂 timeout 的舊 entry 會被要求人工 remove，與「保留既有設定」目標衝突。
- 修正：把缺值按 runtime 預設正規化；明確設成其他 host/port/fallback 才 mismatch。額外 env 只允許 `MINECRAFT_EDU_*`，避免 `NODE_OPTIONS` 等影響啟動。

### #3 doctor 宣稱隔離 port 0，但 env parser 會退回 19131（P2）

- 誰說的：grok
- 我查證的結果：真的有
- 證據：`scripts/blockhand.mjs` 對 smoke 設 `MINECRAFT_EDU_WS_PORT=0`；`src/composition.ts` 卻以 min=1 讀 port，所以 0 會被換成 default 19131。adapter 本身已支援 OS-assigned port 0。
- 修正：允許明確的 port 0，並新增 config 測試／實際 registration smoke。

### #4 CLI 參數與 Codex binary override 過於寬鬆（P2）

- 誰說的：專案內 reviewer
- 我查證的結果：真的有
- 證據：`blockhand.mjs` 對 `install --dry-run`／`uninstall --dry-run` 等未知參數完全忽略；失效的 `CODEX_CLI_PATH` 會靜默改用 PATH 上另一顆 codex。
- 修正：每個 subcommand 使用精確 argv grammar，未知參數在任何副作用前 exit 2；明確 override 不存在時 hard fail。

### #5 stale dist 可在 Codex 啟動時才爆（P2）

- 誰說的：專案內 reviewer
- 我查證的結果：真的有
- 證據：install 只檢查 `dist/index.js` 存在，舊 dist 可能尚未 export `main()`，但 launcher 到 Codex spawn 才發現。
- 修正：missing→add 之前先以 desired registration 做 initialize preflight；失敗就不寫設定。

### #6 Rosetta 偵測不足（P2）

- 誰說的：grok、專案內 reviewer
- 我查證的結果：真的有
- 證據：Rosetta 下 `uname -m` 與 Node 都可能回 x86_64/x64，現有 mismatch 比較會 pass。
- 修正：macOS 額外讀 `/usr/sbin/sysctl -in sysctl.proc_translated`。

### #7 文件把 runtime 與 installer 的寫入混為一談（P3）

- 誰說的：專案內 reviewer
- 我查證的結果：真的有
- 證據：README 首段仍說「不寫任何檔案」，但 `setup:codex` 會由官方 CLI 更新 Codex 設定；connect guide 的「貼到聊天列」也與既有 Windows 實測不接受 Ctrl+V 不一致。
- 修正：限定為 MCP runtime 不寫 artifact／遊戲檔；改成手動輸入。

## 查證後不採納

### close timeout 必然造成永久埠洩漏

- 誰說的：grok
- 我查證的結果：不是本次阻擋；正常 close 已 terminate 完整 clients，direct／launcher lifecycle smoke 都驗證立即重綁。極端第三方 close hang 時，index 還有 hard-stop 回收程序。

### 啟動中 SIGTERM 是空操作

- 誰說的：grok
- 我查證的結果：誤判。handler 先記 `shutdownRequested`；`connection.start()` 後與 `connectStdio()` 後都有檢查，啟動完成即關閉。可後續補 POSIX 真機 signal 證據，但不是現行邏輯洞。

### APFS 路徑大小寫應一律視為相同

- 誰說的：grok
- 我查證的結果：不採納。APFS 可為 case-sensitive；遇到不同拼法時保守停止不會破壞資料。真實存在路徑可在 runtime 層 realpath，但不可把所有 POSIX 路徑無條件 lowercase。

### 完全無 finding／程式已精簡到極致

- 誰說的：agy
- 我查證的結果：誤判，至少 #1–#3 都有具體輸入可重現。

### 因不能讀 diff 而 BLOCK

- 誰說的：codex
- 我查證的結果：屬 reviewer 能力限制，不是 implementation finding；handoff 已明確授權並提供 diff 路徑，其他 reviewer 可讀。

## 後續

依使用者已明確要求完成實作，review skill 收斂到此結束；接下來由主 agent 修正上述已證實缺陷、重新跑完整驗證，再交付。Mac live 狀態仍維持待真機。

## 修正結果

- #1：compatible 現在要求絕對 Node 路徑存在、`--version` 精確為 22.23.1；install 與 doctor 都用 Codex entry 的真實 command／args／env initialize，並驗證隔離埠釋放。
- #2：缺少 HOST／FALLBACK 視為 runtime 安全預設；非 `MINECRAFT_EDU_*` env（例如 `NODE_OPTIONS`）拒絕。
- #3：runtime config 正式接受 port 0，新增 3 項測試。
- #4：每個 subcommand 使用精確 argv grammar；未知參數 exit 2。失效 `CODEX_CLI_PATH` hard fail，不再 fallback。
- #5：missing→add 前先跑 desired registration preflight，stale dist 不會寫入 Codex 設定。
- #6：Darwin doctor 加入 `sysctl.proc_translated`。
- #7：README 區分 MCP runtime 與明確執行 installer 的設定寫入；連線文案改為手動輸入。
- 修正後：9 test files、123/123 tests、typecheck、build、launcher／direct-dist stdio lifecycle smoke 全過；doctor 實際 entry smoke 通過且保留現有 `startup_timeout_sec=15`。
