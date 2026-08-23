# grok 的回覆

> 工具：`grok` ／ 耗時：186.3s ／ exit：0
> 輸入：`.agent-tmp\ais\2026-08-23-0415-blockhand-macos-support-plan\handoff.md`

---
先讀取指定的 handoff 檔，完全依照其中的指示作答。# BlockHand macOS 支援方案審查

唯一依據：handoff 已確認事實與擬採方案。未讀專案、未改檔、未開 preview。

---

## 1. 架構與相依性

**切分正確。** 協定／WS／MCP 維持單一核心，平台差異收在「每機絕對路徑的 launcher + installer」，符合「同機 Desktop/CLI/IDE 共用 `config.toml`、跨機不能共用 Node／專案路徑」。繼續只綁 `127.0.0.1`、不開 LAN、不碰防火牆，與「Minecraft 主動連入本機 WS」模型一致。

**已有對症、應保留**

- Finder 啟動的 Codex Desktop 沒有 nvm／Homebrew PATH：登記該機 `process.execPath` + launcher 絕對路徑是對的。
- launcher 用 `import.meta.url` 解 `dist`、不依賴 cwd：這是 Desktop 常見 cwd=`/` 或 `$HOME` 的正解。
- preferred 19131 + 佔用則 OS 配埠、使用者只讀該 task 的 `connectCommand`：同機多 Codex client 各 spawn 一支 MCP 時必要。

**方案漏掉或寫太薄的點**

1. **dynamic import 必須走 `file://`，不能 import 檔案系統路徑。**
   `fileURLToPath(new URL('../dist/index.js', import.meta.url))` 只適合作 `existsSync`。`import(absPath)` 在 Windows 與 macOS 都會失敗。應 `existsSync` 用 path，載入用同一個 `URL.href`。

2. **stdout 是 MCP JSON-RPC。** launcher 的 Node 版本／dist 檢查若 `console.log` 到 stdout，Desktop／CLI 的 initialize 會直接壞掉。失敗與診斷只能 stderr，成功路徑零字元再 `import`。

3. **cwd 獨立不能只解 entry。** Desktop 的 cwd 不是專案根。`.env`（含新的 `MINECRAFT_EDU_WS_PORT_FALLBACK`）、log、任何相對路徑必須相對專案根（launcher／`import.meta.url`），否則 Windows 終端機通過、Mac Desktop 靜默用錯設定。這是 Mac-ready 的真實漏洞，不是文件問題。

4. **登記的 Node 路徑要 `fs.realpathSync(process.execPath)`。** Homebrew／nvm／fnm 的 shim 或 `bin/node` symlink 在升級後會指到別的版本；launcher 已 pin `=== '22.23.1'`，但 Codex 仍可能 spawn 到已消失的 symlink。記 realpath，doctor 再核對該檔仍存在且版本 Exact。

5. **Mac 必須在該機 `pnpm install` + `pnpm build`。** lockfile 有 Darwin optional bindings ≠ 從 Windows 拷 `node_modules` 能載入。文件要寫死，否則「程式層支援」會在真機第一天假失敗。

6. **stdio 生命週期的跨平台差異未被方案正視。** Windows smoke 不能外推：POSIX 是 SIGTERM／SIGHUP，父進程死、stdio EOF、WS 埠釋放語意不同。doctor 重用 `stdio-smoke.mjs` 方向對，但必須在 Mac 真機再跑一次，不能把 Windows 通過寫成 Mac stdio 已證成。

7. **同機兩支 Codex 同時活著時，19131 與 fallback 埠會分裂。** 這不是 Mac 獨有，但 Desktop+CLI 同機共用 config 後更常發生。文件必須寫：只信「你正在用的那個 MCP task」的 `connectCommand`，不要背 19131。

8. **doctor 的 macOS 14+ 應警告、不應讓 MCP runtime 硬失敗。** 那是 Minecraft Education 的最低需求，不是 Node MCP 的。硬失敗會擋住沒有遊戲、只驗 stdio 的機器。

arm64／x64：lockfile 已含 Darwin optional 是必要條件，不是充分條件。Rosetta 下用 x64 Node 登記、之後 Desktop 以 arm64 spawn 該 binary，一般能跑，但 doctor 應記錄 `process.arch` 與 `os.arch()`，mismatch 當警告。

---

## 2. 安全與回滾

**用官方 `codex mcp get/add/remove`、不手改 TOML：正確。** 不改 PATH、shell profile、防火牆、UI：正確。陌生同名拒絕覆寫／拒絕 uninstall：正確。

**自動 replace + in-memory rollback 有不可接受的缺口，應縮小，不必砍成「任何 mismatch 一律停」。**

不可接受的遺失／競態

- **remove 與 add 非原子。** 行程在中間被殺、`codex mcp add` 參數不符當前 CLI schema、Desktop 同時寫回 `config.toml`，都會留下「BlockHand 消失」。只把舊 transport 放在記憶體裡，rollback 救不了 crash。
- **「可辨識為本專案舊設定」未定義。** 指紋過寬會誤刪別人的同名 MCP；過窄會把現行 Windows 的 `node …/dist/index.js`（無 launcher）當成陌生同名而拒絕，遷移失敗。
- **只存 transport 可能丟欄位。** env、cwd、timeout、tool allowlist 若 `get` 看得到但 `add` 寫不回，rollback 已是降級復原。
- **Desktop／CLI 開著時改同一份 config** 是真實競態；方案未要求關閉 Codex。

建議政策（比「一律人工移除」窄、比現案安全）

| 情況 | 行為 |
|---|---|
| 無 entry | add |
| 完全相同（realpath(node) + launcher 絕對路徑 + 本專案） | no-op |
| 名稱是 canonical，且 args／command 能對上**本 repo 路徑**的歷史形狀（`dist/index.js` 或 `launch-mcp.mjs`） | 先把 `get` 的完整 JSON 寫到專案外 backup 檔，再 remove→add；add 失敗用 backup 做 rollback；backup 失敗則停止、不 remove |
| 同名且指紋是 BlockHand，但路徑是**另一個 clone** | 拒絕，印出對方路徑（一台機器只能登記一個 BlockHand） |
| 同名但指紋不是 BlockHand | 拒絕，要求人工 `codex mcp remove` |
| 任何歧義 | 停止，不要猜 |

不要為了 UX 做「看名字像就換」。單人機器上，可逆的自動升級只應涵蓋**本工作樹**的舊 BlockHand；其餘停止並印出精確指令。uninstall 維持：不存在=成功；陌生=拒絕。

install／uninstall 期間應要求 Codex Desktop／CLI 不要同時寫 config（至少文件 + doctor 警告）；這不是理論，是共享 `config.toml` 的必然後果。

---

## 3. 測試與驗收

沒有 Mac 真機時，能證明的是 **installer 狀態機 + 核心不依賴 Windows API + launcher 的路徑／stdio 契約**；不能證明 Minecraft live，也不能證明 Finder 啟動的 Codex Desktop。

**現在就能當有效證據（在 Windows 上跑，邏輯成立）**

- 登記狀態機單元測試：空白／中文／空格路徑、exact no-op、本專案舊形狀替換、陌生同名拒絕、另一 clone 拒絕、add 失敗 rollback、backup 檔內容。
- launcher：缺 dist、Node 版本≠`22.23.1` → 非零退出且 stdout 為空；成功路徑不寫 stdout。
- 用 `path.win32`／`path.posix` **顯式**測路徑組裝，而不是只 `process.platform = 'darwin'`。
- adapter 改 port 0、讀實際 status port：降低平行碰撞，Windows／未來 Darwin 都受惠。
- 靜態確認核心與 tools 無 `auto-connect.ps1`、PowerShell 自動輸入、AppleScript。

**必須留到 macOS 14+ 真機，且文件維持「未 live 驗證」**

- Finder 啟動 Codex Desktop：空 PATH、stdio MCP initialize、38 tools／2 resources、EOF、埠釋放。
- 該機 `pnpm install` 後 Darwin optional native bindings 真的載入。
- Homebrew／nvm realpath 的 Node 能被 Desktop spawn。
- Minecraft Education `/connect 127.0.0.1:<port>`（Admin+Cheats）、IPv4 而非 `localhost`→`::1`。
- 真的 SIGTERM／父進程退出後 WS 埠釋放。

**假陽性（通過了也不准寫成 Mac-ready）**

1. 在 Windows mock `process.platform='darwin'`，但 `node:path` 仍是 win32。
2. lockfile 有 `darwin-arm64`／`x64` optional ≠ 載入成功。
3. Windows 103 tests + 38-tool stdio smoke ≠ POSIX 信號與 Desktop 無 TTY stdio。
4. `doctor` 沒開 Minecraft 的 smoke ≠ 遊戲 protocol（且官方對後續 message 無穩定性承諾，本來就不能寫成正式穩定 API）。
5. doctor 在 Windows 跳過 Darwin 檢查卻 exit 0 ≠ Mac doctor 會過。
6. 工具清單 38 個還在 ≠ 某個 tool 仍呼叫 `cmd`／PowerShell／`%USERPROFILE%`（移除 auto-connect 之後仍可能殘留）。
7. mock 掉的 `codex mcp add` ≠ 真 CLI 對 zsh／含空白 argv 的 quoting。

驗收用語只能是方案已寫的那句：**程式層與安裝流程支援；待 macOS 14+ 真機 live 驗證。** 任何把 Windows verify 寫成「已支援 Mac 遊戲連線」都是文件錯誤。

---

## 4. 範圍與順序

**移除 Windows UI automation 符合這次目標，應做。** 使用者已明確反對 UI 自動化打斷電腦；AppleScript 與 PowerShell 自動輸入都不該再進 MCP 流程。刪 `auto-connect.ps1`、拿掉 `package.json` 的 Windows-only `connect`、劇本只印真實 `/connect` 並等玩家手動連：與跨平台、不搶前景視窗一致。

這是對現有 Windows 使用者的 **breaking change**，不是順便清理。README／父層 mcp README／註解必須一次刪乾淨，並寫明改為手動 `/connect`。

**順序缺口：不要先拆自動連線再補 launcher。** 否則 Windows 在過渡期只剩「自己記 port、自己打指令」，比現在差。建議：

1. 核心 cwd 獨立（`.env`／相對路徑相對專案根）——否則 launcher 在 Desktop 是空殼。
2. `launch-mcp.mjs`（realpath 檢查、stdout 乾淨、`URL.href` import）。
3. 登記指紋規格寫死（含**現行無 launcher 的 Windows 形狀**），否則 `install` 無法遷移現有機器。
4. `codex-registration.mjs` + 單元測試（mock CLI）。
5. `blockhand.mjs`：`install`／`doctor --json`／`uninstall`；doctor 重用 stdio-smoke。
6. 確認 Windows 仍能靠新 launcher 手動 `/connect` 之後，再刪 UI automation。
7. adapter port 0、`.env.example`、README 共通流程、`agents/docs/macos-support.md`、父層測試數；**不把 Mac 寫成真機已驗證**。
8. 本機 target tests、`pnpm verify`、`blockhand doctor --json`、`git diff --check`；根 `node scripts/verify.mjs` 失敗要能指出是本專案還是其他專案既有問題。

**相容性遷移缺口：** 方案寫了「可辨識舊 BlockHand」，但沒把「Windows 現有 `node + dist/index.js`、相對路徑、非 realpath」列入指紋。漏這條，第一個跑 `pnpm blockhand install` 的 Windows 使用者會被當成陌生同名而卡住。

**文件缺口：** 同機共用／跨機不共用已有；還要補：必須本機 install+build、禁止拷 Windows `node_modules`、只信當前 task 的 `connectCommand`、install 時不要並行開 Codex 寫 config、auto-connect 是有意刪除、macOS 14 是遊戲需求不是 MCP runtime 硬門檻。

範圍沒有膨脹去開 LAN、改 bind、做 AppleScript，這部分沒問題。不要在這次順手做多 clone 並存登記。

---

## 收斂

### 共同結論

單一核心 + 每機絕對路徑 launcher／installer 是正確切分；繼續 loopback-only、手動 `/connect`、官方 `codex mcp *`、明確「未真機 live 驗證」，與已確認事實和使用者邊界一致。Windows UI automation 應刪，但它是 breaking change，必須在新安裝路徑可工作之後再刪。

### 主要分歧（對擬採方案）

- 不同意「同名可辨識就 remove→add、只在記憶體 rollback」。應縮成僅本工作樹歷史指紋，且 backup 先落地；歧義一律停。不是全面改成手動。
- 不同意 doctor 把 macOS 14 當 MCP 硬失敗。
- 認為 cwd 獨立、`file://` import、stdout 衛生、Node realpath 是漏寫的架構契約，不是實作細節。
- 認為 Windows stdio／lockfile Darwin bindings 不能當 Mac runtime 證據。

### 建議修正（動工前寫進方案即可，不必改方向）

1. launcher：`URL.href` import；失敗走 stderr；成功零 stdout。
2. Node 與 launcher 路徑一律 realpath；install 當時就 pin `22.23.1`。
3. `.env` 與所有相對 I/O 錨在專案根。
4. 登記指紋含現行 Windows `dist/index.js` 形狀；跨 clone 拒絕；replace 前寫 backup。
5. 先 launcher+install，再刪 auto-connect。
6. 單元測試用 `path.win32`／`path.posix`；mock platform 不當 Darwin 證據。
7. 文件三句話：未 live 驗證、本機 pnpm install、只複製當前 task 的 `/connect`。

### 裁決：**Conditional GO**

方向正確，可以動工，但上面 1–5 是契約不是 nicety；不補就開寫，Mac Desktop 會在「Windows 全綠」下於 stdio／`.env`／登記遷移失敗。
**不是 NO-GO**：沒有協定分叉、沒有 bind `0.0.0.0`、沒有 UI 自動化、沒有把未驗證寫成已驗證。
真機 Minecraft／Finder Codex 仍是後置閘門，不得在這次交付宣稱 live 通過。
