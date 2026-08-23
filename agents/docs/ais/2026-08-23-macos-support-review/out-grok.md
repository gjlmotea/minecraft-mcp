# grok 的回覆

> 工具：`grok` ／ 耗時：531.2s ／ exit：0
> 輸入：`.agent-tmp\ais\2026-08-23-0441-blockhand-macos-support-review\handoff.md`

---
先讀指定的 handoff，再完全照裡面的指示作答。handoff 指定要讀 diff 與必要現行檔案；接下來先把審查材料一次讀齊。diff 被截斷了，接著把剩餘改動和新檔讀完。測試檔與剩餘 diff 還沒讀完；接著對照現行原始碼抓精確行號。# BlockHand macOS 支援 implementation review

對照 `macos-support.md` 的保守狀態機、根 `AGENTS.md` ENV-001／ENV-002／SEC-001，以及方案審查採納項：單一 Node／stdio／`127.0.0.1`、不自動 remove/add、舊 direct-dist 可 no-op、doctor 不碰 Minecraft。Windows 本機證據（114 tests、stdio smoke、`doctor --json` ok）與這份 diff 一致；下面只列可重現的契約／錯誤路徑問題。

---

## 1. 這段 code 在什麼輸入下會壞

**舊 README 形狀的 Codex entry（只設 PORT、command 為 `node`）**

輸入：

```json
{
  "name": "minecraft-edu",
  "enabled": true,
  "transport": {
    "type": "stdio",
    "command": "node",
    "args": ["C:/Users/GJLMoTea/Desktop/www/gjlmotea/vibe/mcp/minecraft-edu/dist/index.js"],
    "env": { "MINECRAFT_EDU_WS_PORT": "19131" }
  }
}
```

接著 `corepack pnpm run setup:codex`。

實際結果：`classifyRegistration` 因缺 `MINECRAFT_EDU_WS_HOST=127.0.0.1` 與 `MINECRAFT_EDU_WS_PORT_FALLBACK=1`，`validBase` 為 false，kind=`blockhand-mismatch`。`install()` 丟錯並退出 1，stderr 要求先 `codex mcp remove minecraft-edu`。runtime 其實仍可用（HOST／FALLBACK 有預設），但安裝器把「可用的同工作樹 entry」當成不相容。使用者若照訊息 remove，會丟掉既有 `startup_timeout_sec`／tool policy——這正是這次刻意避免的事。

**PATH 型 `node` + 齊全 env + 同工作樹 launcher／dist**

輸入：`command="node"`（或任何其他仍存在的 Node 路徑），`args` 指向本工作樹，`env` 等於 `REQUIRED_ENV`。

實際結果：kind=`compatible`，`install()` no-op。Finder 啟動的 Codex Desktop **不會**被改寫成 `realpath(process.execPath)`。GUI 程序沒有 nvm／Homebrew PATH 時，Desktop 載入 MCP 失敗；CLI 卻看起來已安裝完成。

**已登記的 Node 二進位消失（brew upgrade／nvm 搬家）**

輸入：Codex entry 的 `command` 指向已刪的 Cellar／nvm 路徑，args／env 仍符合 compatible。

實際結果：`corepack pnpm run doctor` 用**當前** `process.execPath` 跑 smoke，registration 只是 warn，`ok=true`。Desktop 實際 exec 的是死路徑，MCP 起不來。doctor 無法診斷 macos-support 要抓的 Finder 啟動失敗。

**`MINECRAFT_EDU_WS_PORT=0`**

輸入：`MINECRAFT_EDU_WS_PORT=0 node scripts/launch-mcp.mjs`（或 doctor 塞進 smoke 行程的那個 env）。

實際結果：`readInt(..., 1, 65535)` 把 `0` 當非法， silently 改回 `19131`。adapter 層 `port: 0` 是合法的 OS 配埠；env 層不是。doctor 以為用 PORT=0 隔離，其實沒有。

---

## 2. 邊界條件（空值、極值、併發、錯誤路徑、資源沒釋放）

| 邊界 | 行為 |
|---|---|
| entry=`null`／`undefined` | `missing`，會 `codex mcp add`。正確。 |
| `enabled: false` | `blockhand-mismatch`，不覆寫、不 uninstall。正確。 |
| env 缺新 key、或多一個非字串值（例如 JSON 數字 `19131`） | `===` 失敗 → mismatch。過嚴。 |
| command=`node`／`node.exe` | 算 Node，但不必是絕對路徑。過寬。 |
| 另一個 clone 的 `.../minecraft-edu/scripts/launch-mcp.mjs` | `blockhand-mismatch`。正確。 |
| 同名 Python MCP | `foreign`。正確。 |
| stdin 在 `start()` 前結束 | 記住 reason，listen 完後 shutdown。smoke 有測。 |
| SIGTERM 在 `startupComplete` 前 | 只記 reason，要等 `start()`／`connectStdio()` 回來才關。沒有 SIGTERM smoke。 |
| `WebSocketServer.close()` 超過 1500ms | Promise reject，但 listening socket **沒有** `terminate`／`unref`；靠 `index.ts` 3s `process.exit`。若那條路沒走到，埠洩漏。 |
| `pickAvailablePort()` | listen(0) 後立刻 close 再給別人用，TOCTOU。 |
| 兩個 `install` 並行 | 都看到 missing 都 add；非原子。v1 不做自動遷移是對的，但並行仍能把 `~/.codex/config.toml` 寫壞。 |
| Rosetta | doctor 在翻譯行程裡跑時，`uname -m` 與 `os.arch()` 都是 x86_64，**不會** warn。 |
| 空字串 path | `normalizeComparablePath` 回 `null`，`samePath` false。安全。 |

---

## 3. 跟既有架構有沒有衝突

**沒有衝突（這批有守住）：**

- 根 ENV-001：鎖 Node 22.23.1、pnpm 11.17.0；腳本是 `.mjs`。
- 根 ENV-002：登記 `realpath(process.execPath)` + launcher，不靠 GUI PATH——**僅限 missing→add 這條路**。
- 根 SEC-001：不改防火牆、不開 LAN、不寫 `0.0.0.0`、不操作 Minecraft UI；PowerShell SendKeys 已刪。
- vibe：沒開 preview server。
- `macos-support.md` 的「程式層支援、Mac live 未驗證」寫進 README／doctor `macLiveVerified: false`。macOS 14 是 warn 不是 MCP 硬失敗。
- 核心仍是一份 `src/`，沒有 macOS 協定分叉。
- `src/index.ts` 同時 `export main`／`reportFatal` 與 direct-dist `argv[1]` 啟動，符合「舊 entry 要繼續能跑」。

**有衝突：**

- 設計寫「同一工作樹的 launcher 或舊 direct-dist **已可用** → no-op」。實作把「已可用」定義成 **env 必須已經是新的三個精確字串**，又把「bare `node`／別的 Node 路徑」算可用。前者比 runtime 預設更嚴，後者比 Finder 絕對路徑契約更鬆。這和 ENV-002／macos-support「每機登記該機絕對 Node」直接打架。
- 設計把 doctor 當 Finder／Desktop 的診斷入口。doctor smoke 從不 spawn Codex 已登記的 `command`+`args`，所以它驗證的是「這顆終端機的 Node 能跑 launcher」，不是「Desktop 會啟動的那條 argv」。
- 方案審查採納「成功路徑不寫 stdout」：launcher／`log()` 有守 stderr。`blockhand install`／`doctor` 寫 stdout 沒問題（人機 CLI，不是 MCP stdio）。

---

## 4. 有沒有更簡單的做法達到同樣效果

有，而且更短。

1. **分類只問三件事**：stdio、本工作樹 launcher 或 dist、enabled。HOST／FALLBACK 缺省等於 runtime 預設就當成可用。`command` 不是絕對 Node 路徑、或 `existsSync(command)===false` → mismatch（需要人手動 remove），不要 no-op。這樣才真的保住 timeout，又不會把 PATH `node` 當成 Mac 完成。
2. **doctor 最少 `existsSync(registered command)`**，更好是用那條 argv 做一次 38-tool smoke。現在的 smoke 重複測 launcher，測不到登記結果。
3. **launcher 的 `fail()` 直接 `process.exit(1)`**。現在靠「沒碰到 stdin 所以 event loop 會空」，比一行 exit 脆。
4. **不必為了 cwd 再包一層複雜狀態機**。launcher + `import(RUNTIME_URL.href)` 已經解決 Finder cwd；分類不必再為「換 launcher」自動遷移，維持 v1 停止即可。
5. 不要在 doctor 設 `MINECRAFT_EDU_WS_PORT=0`。smoke 自己 `listen(0)` 就夠了；env `0` 在 `readInt` 根本非法。

保留 launcher（版本檢查 + URL import + stdout 乾淨）是合理的，不要刪。要刪的是「env 精確比對 ∩ 任意 Node 路徑都 compatible」這段過度設計。

---

## Findings（P0 → P3）

### P0

沒有。Windows 已驗證路徑（missing/exact/本機那筆 compatible、stdio EOF、占埠 fallback）看不出會立刻炸資料、開 LAN、或讓現有 live 橋接靜默壞掉。不 BLOCK。

### P1

**P1-1 — 舊可用 entry 被當成不相容，照錯誤訊息操作會丟 timeout**
`scripts/lib/codex-registration.mjs:6-10, 57-62, 109-114`；`scripts/blockhand.mjs:101-128`

- 輸入：上面「只設 PORT」的 Codex JSON，跑 `setup:codex`。
- 實際：exit 1，`loopback／port 環境設定與 BlockHand 基線不同`；不 add、不 no-op。
- 期望（macos-support.md:36-37、digest「舊 direct-dist 視為相容」）：同工作樹且 runtime 能聽 `127.0.0.1` → compatible／no-op，保留 timeout。
- 測試缺口：`tests/scripts/codex-registration.test.mjs` 沒有「缺 FALLBACK／HOST」案例；compatible 案例（L81-91）給了完整 `REQUIRED_ENV`。

**P1-2 — `compatible` 接受 PATH `node` 與任意其他 Node 路徑，安裝器不會改寫成絕對路徑**
`scripts/lib/codex-registration.mjs:29-33, 116-128`；`scripts/blockhand.mjs:121-126`；測試 L81-91 把 Homebrew 路徑 vs nvm 路徑標成成功。

- 輸入：`command="node"`，args=本工作樹 launcher，env=`REQUIRED_ENV`，然後 `setup:codex`，再用 Finder 開 Codex Desktop。
- 實際：stdout「相容設定…不做 remove/add」。Desktop 沒有 shell PATH 時 spawn `node` 失敗，38 tools 不會出現。
- 期望：這正是 launcher + `realpath(process.execPath)` 要修的事；這種 entry 應是 mismatch，或至少 doctor fail。

**P1-3 — doctor 的健康訊號是假的：不執行已登記 argv**
`scripts/blockhand.mjs:236-248, 272-283, 320`；smoke 一律 `process.execPath` + `scripts/launch-mcp.mjs`（`scripts/stdio-smoke.mjs:46, 156, 194, 222`）。

- 輸入：Codex `command` 指向已刪 Node，args／env 仍 compatible；本機 Node 22.23.1 正常。
- 實際：`doctor --json` → `ok: true`，`codex-registration` 最多 warn「direct-dist」，`mcp-smoke` pass。
- 期望：registration 或 smoke fail，並指出 Desktop 將 exec 的那條路徑不存在／版本不對。
- 附帶：warn 文案永遠寫「direct-dist」，即使 args 已是 launcher、只是 Node 路徑不同（`blockhand.mjs:247`）。

### P2

**P2-1 — `MINECRAFT_EDU_WS_PORT=0` 被靜默改成 19131**
`src/composition.ts:30-36, 42` vs adapter 已支援 `port: 0`（`tests/adapters/ws-connection.test.ts:29`）。doctor 還故意設 PORT=0（`blockhand.mjs:282-283`），對 child MCP 無效（smoke 用 `getDefaultEnvironment()`），對「若有人真的把 0 傳進 runtime」有害。

- 輸入：`MINECRAFT_EDU_WS_PORT=0 MINECRAFT_EDU_WS_PORT_FALLBACK=0` 啟動。
- 實際：聽 19131；若被占則 `listen-failed`／EADDRINUSE，而不是 OS 配空閒埠。

**P2-2 — close-timeout 不釋放監聽 socket**
`src/adapters/ws-minecraft-connection.ts:532-557`：1500ms 後 `reject`，沒有對 `active` 再 `terminate` 內部 HTTP server。`src/index.ts:98-111` 只在 `shutdown()` 設 3s `process.exit`；`startup-failure` 走 `closeResources`（L154-156）**沒有**這顆強制退出定時器，要等 `reportFatal`（L175-183）的另一顆 3s。

- 輸入：讓 `WebSocketServer.close` 卡住（殘留 CLOSING client 未進 `clients` 集合的極端情況，或平台 close hang）。
- 實際：Promise 失敗，埠仍被占，直到 process 被硬砍。macos-support 要的「立即重綁」不成立。

**P2-3 — SIGTERM／SIGINT 在 `startupComplete` 前是空操作**
`src/index.ts:117-120, 137-153`。`start()` 之後有補查 `shutdownRequested`；`connectStdio` 期間沒有。沒有 SIGTERM 測試（smoke 只測 stdin EOF，`stdio-smoke.mjs:108-136`）。Mac Host 對卡住的 initialize 送 SIGTERM 時，行為未鎖定。

**P2-4 — Rosetta 偵測在翻譯行程內是死的**
`scripts/blockhand.mjs:209-219`。輸入：Apple Silicon + `arch -x86_64` 的 Node 跑 doctor。實際：`uname -m` 與 `os.arch()` 都是 x64／x86_64，`architecture` pass。應看 `sysctl.proc_translated`。

**P2-5 — POSIX 路徑用字串相等，APFS 大小寫／NFD 會誤判 mismatch**
`scripts/lib/codex-registration.mjs:16-27`。測試還断言 `/Users/Me` ≠ `/Users/me`（`codex-registration.test.mjs:49`）。在 case-insensitive 磁碟上這是同一檔，install 會停。

**P2-6 — `codex mcp list --json` 必須是純陣列**
`scripts/blockhand.mjs:60-69`。stdout 前面多一行 log、或外層改成 `{servers:[...]}`、或 env 值是 number：整段 doctor／install 失敗。本機現況能 parse，這是 CLI 契約耦合，不是單元測試能鎖住的。

### P3

- `pickAvailablePort` TOCTOU（`stdio-smoke.mjs:39-43`）：可能偶發撞埠。
- bind 失敗時 `created.close(() => undefined)` 不等待（`ws-minecraft-connection.ts:435-440`）：短暫多一個 handle。
- `package.json` `"files"` 只有 `dist`，不含 launcher；套件是 private，現在無影響。
- 沒有 `readRuntimeConfig` 單元測試覆蓋 PORT=0／FALLBACK 缺省。
- 沒有 SIGHUP（終端掛斷）；MCP 主路徑仍是 stdin／SIGTERM。

---

## 架構／範圍結論

這批改動的主軸（launcher、`main()` 可呼叫、port fallback、拆掉 UI 自動化、文件不宣稱 Mac live）方向對，也對齊 SEC-001 與「不開 LAN」。不需要重寫核心橋接。

真正沒做完的是安裝狀態機與 doctor 的**觀察點**：它們目前驗證「這顆 terminal Node 能跑」，不是「Codex Desktop 將會 exec 的那條 argv」。這在 Windows 終端機迴歸裡看不出來，卻是 Mac Finder 驗收第一個會踩的坑。

---

**Verdict: `PASS WITH FIXES`**

P1 修完前不要宣稱「每台機器登記一次就能給 Desktop／CLI／IDE 共用」已閉環；Windows 程式層與安裝流程可以合入。Mac 狀態維持文件所寫：程式層支援，待 macOS 14+ 真機 live——且 doctor 必須先能測到登記路徑，否則真機失敗會被本機 `ok=true` 蓋掉。
