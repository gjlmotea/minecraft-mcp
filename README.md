# BlockHand（積木之手）— Minecraft Education MCP

讓 AI 在 Minecraft Education Edition 裡長出手腳：**動作**（Agent 走位、挖掘、放置、耕種、搬運）、**眼睛**（感測方塊、查詢座標、訂閱遊戲事件）、**造物**（十種幾何形狀與逐格藍圖）。

透過 Minecraft Education 官方文件化的 `/wsserver` 連線命令（`/connect` 是 alias）操作，不注入行程、不改遊戲檔案、不用畫面辨識。連線命令是官方介面；後續 WebSocket 訊息協定並沒有公開穩定性保證，因此遊戲改版後仍需重新驗證。

- 38 個工具、2 份 resource
- 123 項單元與整合測試、1 支不需開遊戲的 stdio／程序生命週期 smoke、1 支真機 live 驗證
- 不需要任何帳號、token 或祕密；MCP runtime 只綁 loopback，不寫遊戲檔或 artifact

---

## 1. 三步上手

### 步驟一：在每台機器安裝與建置

```bash
cd /你的路徑/minecraft-edu
corepack pnpm install --frozen-lockfile
corepack pnpm run build
```

Node 必須是專案 `.nvmrc` 指定的 **22.23.1**，pnpm 由 Corepack 固定為 **11.17.0**。Windows 與 Mac 都要在本機安裝依賴；不要把另一個作業系統的 `node_modules` 複製過來。Minecraft Education 目前在 Mac 的最低需求是 **macOS 14**。

### 步驟二：在該機登記一次 Codex MCP

```bash
corepack pnpm run setup:codex
corepack pnpm run doctor
```

安裝器會把「這台機器的絕對 Node 路徑」與跨平台 launcher 登記到 `~/.codex/config.toml`，不依賴 Finder／桌面程式能否讀到 nvm、Homebrew 或 shell PATH。它只透過官方 `codex mcp` 指令操作：

- 沒有同名 entry：新增。
- 已是同一工作樹、且絕對 Node 路徑可執行的正確／相容設定：實際 initialize 通過後 no-op，保留既有 timeout 與 tool policy。
- 同名但不相容：停止並顯示差異，不自動 remove/add，也不覆寫陌生設定。

**同一台機器**的 Codex 桌面版、CLI 與 IDE 共用這份設定；Windows 筆電、Mac 或另一台電腦仍要各自執行一次，因為 Node 與專案的絕對路徑不同。登記後請完全退出並重啟 Codex。

### 步驟三：在遊戲裡手動連進來

```bash
corepack pnpm run connect
```

這個相容入口只顯示操作方式，**不會**開 Minecraft、不會切換前景視窗，也不會模擬鍵盤。Windows PowerShell 自動輸入功能已移除；Mac 也不加入 AppleScript 自動化。

**方向很容易搞反：遊戲是連出來的一方，MCP server 是被連的一方。**

1. 在目前 Codex task 呼叫 `mc_status`，複製它回傳的 `connectCommand`。
2. 開 Minecraft Education，**進入一個世界**（停在主選單沒有用）。
3. 世界必須開啟 **Cheats**，操作者需有 Admin／OP 權限。
4. 在聊天列手動輸入，例如：

```
/connect 127.0.0.1:19131
```

看到 `Connection established` 就完成了。之後對 AI 說「幫我在前面蓋一顆空心玻璃球」即可。

不要固定背 19131：桌面版、CLI、IDE 或多個 task 同時啟動時，後開的 MCP 可能取得不同空閒埠。永遠使用**目前要操作的那個 task**回報的指令。

---

## 2. 真機驗證

先做不開遊戲的安全診斷：

```bash
corepack pnpm run doctor
# 機器可讀版本
corepack pnpm blockhand doctor --json
```

doctor 不修改持久設定、不啟動 Minecraft；它會短暫建立隔離的 loopback socket，驗證 launcher、38 tools、2 resources、stdio EOF、監聽埠釋放，並以 Codex **實際登記的 command／args／env** 再完成一次 initialize，避免設定指向失效 Node 卻假綠。

遊戲開著、世界已載入、作弊已開之後：

```bash
cd gjlmotea/vibe/mcp/minecraft-edu && corepack pnpm run live
```

腳本會印出要輸入的 `/connect`，等你連上，然後走完一條完整路徑並逐項回報 PASS／FAIL：連線 → 讀玩家座標 → 遊戲內發話 → 設定時間 → 召喚 Agent → 感測 → 走 L 形路徑 → 預覽建造 → 蓋空心玻璃球 → 回頭驗證方塊真的存在 → 藍圖合併 → 訂閱並收事件 → 政策閘門 → 清除示範建築。

預設會把示範建築填回 `air`，不在世界裡留垃圾。想留下來看：

```bash
cd gjlmotea/vibe/mcp/minecraft-edu && node scripts/live-check.mjs --keep
```

不需要開遊戲的驗證（型別、測試、build、stdio 握手、STDIN 關閉釋放連接埠與占埠失敗一次跑完）：

```bash
cd gjlmotea/vibe/mcp/minecraft-edu && corepack pnpm run verify
```

---

## 3. 工具面

### 連線與後備（4）

| 工具 | 用途 |
|---|---|
| `mc_status` | 橋接狀態、連線指令、已訂閱事件、累計指令數。任何失敗先查這個 |
| `mc_await_connection` | 阻塞等待遊戲連入（單次上限 120 秒） |
| `mc_run_command` | 單行 raw slash 指令；沒有專用工具時的後備 |
| `mc_run_commands` | 依序執行多條 raw 指令 |

### Agent — 手腳（10）

| 工具 | 用途 |
|---|---|
| `mc_agent_create` | 召喚 Agent |
| `mc_agent_move` | 往指定方向走 N 格 |
| `mc_agent_turn` | 左右轉，每次 90 度 |
| `mc_agent_teleport` | 把走丟的 Agent 叫回玩家身邊 |
| `mc_agent_act` | attack／destroy／till，可連續 |
| `mc_agent_place` | 從背包槽放置方塊 |
| `mc_agent_collect` | 撿取掉落物 |
| `mc_agent_inventory` | count／space／detail／drop／dropAll／transfer |
| `mc_agent_sense` | inspect／inspectData／detect／detectRedstone —— Agent 的眼睛 |
| `mc_agent_program` | **一次送出一整段動作程式**，逐步回報結果 |

Agent 方向是**相對它自己的面向**，不是世界方位。

### 世界（9）

`mc_set_block`、`mc_fill`、`mc_clone`、`mc_test_block`、`mc_query_target`、`mc_summon`、`mc_world_settings`（時間／天氣／遊戲規則／難度）、`mc_structure`（存讀結構）、`mc_ticking_area`。

`mc_query_target` 會把 `querytarget` 回傳的 JSON 字串解析好，這是取得玩家或 Agent 座標的正規做法——建造前先問它。

### 玩家與回饋（7）

`mc_teleport`、`mc_give`、`mc_gamemode`、`mc_effect`、`mc_player_action`（kill／clear／xp／ability）、`mc_message`（say／tell／title／subtitle／actionbar）、`mc_feedback`（音效／粒子）。

### 建造（4）

| 工具 | 用途 |
|---|---|
| `mc_build_preview` | 只算不做：方塊數、邊界盒、fill 批次數 |
| `mc_build_shape` | line／box／sphere／ellipsoid／cylinder／cone／pyramid／disk／torus／helix，多數支援 hollow |
| `mc_blueprint_preview` | 逐格藍圖的預覽 |
| `mc_build_blueprint` | 任意形狀：給「座標 → 方塊」清單，相同方塊自動合併 |

### 事件 — 感知（4）

`mc_events_catalog`、`mc_events_subscribe`、`mc_events_unsubscribe`、`mc_events_poll`。

事件進環形緩衝，用游標連續讀；`dropped > 0` 代表輪詢太慢、有事件永遠讀不到了。重新連線後會自動重新訂閱。

---

## 4. 為什麼建造不會卡死

天真作法是每個方塊送一次 `setblock`。一顆半徑 20 的實心球有 33,000 多格，等於三萬多次 WebSocket 往返——實務上等於當機。

BlockHand 的管線是：

```
形狀參數 → inside() 判定掃描 → 方塊座標集合
        → X 連段合併 → Z 矩形合併 → Y 立方合併（三階段 greedy）
        → 依 Bedrock 單次 /fill 上限 32768 拆批
        → 送出
```

半徑 8 的實心球從 2,000 多個方塊壓成不到 200 條指令，且合併結果是**決定性**的——同一組輸入永遠得到同一組批次，所以有測試釘住「合併後覆蓋的方塊集合必須與原始點集合完全相同」，不會多蓋也不會少蓋。

空心形狀一律用「內部判定 + 外殼鄰居測試」實作，而不是每個形狀各寫一套空心數學。新增形狀只要寫 `inside()`，空心行為自動一致。

---

## 5. 安全邊界

**不做的事**

- 不連外網：只在 `127.0.0.1` 開 WebSocket 監聽。
- MCP runtime 不寫檔案：沒有任何 artifact 輸出路徑。只有使用者明確執行 `setup:codex`／`uninstall:codex` 時，官方 Codex CLI 才會更新本機 MCP 設定。
- 不碰祕密：整個專案沒有 token、帳號或憑證。
- 不主動連線：遊戲不 `/connect` 進來，所有工具都回可照做的錯誤訊息，不會靜默失敗。

**`mc_run_command` 的閘門**

`mcp/README.md` 架構原則 4 要求拒絕任意執行入口。這裡的判斷是：slash 指令的作用域完全在本機遊戲世界內，不觸及主機檔案系統、行程或網路，所以它不等同任意程式碼執行。真正必須擋的是讓橋接失效的操作，因此政策是**結構性**的而非猜意圖的關鍵字黑名單：

1. 只允許單行——換行與 NUL 直接拒絕，不能用 `\n` 把一條請求拆成兩條指令。
2. 拒絕 `wsserver` 與 `connect`——那會把遊戲指向別的端點，之後所有工具全部失效。
3. 其餘指令標記 `read-only`／`world-write`／`wide-effect` 風險等級，交由 MCP Host 依 annotation 決定是否要人工確認。

所有會被插進指令列的方塊 ID、選擇器、狀態字串都先過白名單正規表達式，防止用空白拼出額外參數。

**商標**

依 [Minecraft Usage Guidelines](https://www.minecraft.net/en-us/usage-guidelines)，第三方工具不得看起來像官方產品。產品名 **BlockHand** 刻意不含 Minecraft 商標；`minecraft-edu` 只是這個私人工作區內的描述性資料夾名。若日後要對外發布，套件名與任何公開露出都必須重新檢視。

---

## 6. 設定

全部有預設值，`.env` 不是必需品。

| 變數 | 預設 | 說明 |
|---|---|---|
| `MINECRAFT_EDU_WS_HOST` | `127.0.0.1` | 監聽位址；預設只綁 loopback |
| `MINECRAFT_EDU_WS_PORT` | `19131` | 優先監聽埠；實際值以 `mc_status` 回報為準 |
| `MINECRAFT_EDU_WS_PORT_FALLBACK` | `1` | 優先埠被其他 MCP 任務占用時，由作業系統自動配一個空閒埠；設成 `0` 可要求占埠即失敗 |
| `MINECRAFT_EDU_COMMAND_TIMEOUT_MS` | `10000` | 單一指令等待遊戲回應的逾時 |
| `MINECRAFT_EDU_EVENT_BUFFER` | `500` | 事件環形緩衝筆數 |
| `MINECRAFT_EDU_MAX_BUILD_BLOCKS` | `200000` | 單次建造方塊數上限，超過即拒絕 |
| `MINECRAFT_EDU_STEP_DELAY_MS` | `100` | Agent 程式每步預設間隔 |
| `MINECRAFT_EDU_DEBUG_FRAMES` | 未設 | 設成 `1` 會把遊戲回的每個原始封包印到 stderr，診斷協定行為用 |

---

## 7. 模組地圖

```
src/
  domain/                     純資料與純邏輯，不依賴 MCP、ws 或 Node
    contracts.ts              型別、已知事件名、Bedrock fill 上限
    coordinates.ts            絕對／相對／局部座標格式化與邊界檢查
    commands.ts               所有 slash 指令建構器 + 注入白名單
    command-policy.ts         raw 指令的結構性閘門
    build/shapes.ts           十種形狀；inside() + 外殼鄰居測試
    build/fill-planner.ts     三階段 greedy 合併 + 依上限拆批
  ports/minecraft-connection.ts   連線抽象；測試靠它塞假件
  adapters/ws-minecraft-connection.ts  WebSocket 監聽、requestId 對應、事件緩衝、重連重訂閱
  application/
    blockhand-service.ts      Agent 程式展開、querytarget 解析、事件
    build-service.ts          規劃與執行分離（先讀後寫）
  server/
    create-server.ts          server 實例與給 Host 的操作指引
    schemas.ts                共用 zod 片段
    tool-kit.ts               回應塑形與錯誤包裝
    tools/                    session／agent／world／player／build／event
  composition.ts              組裝；可注入假連線
  index.ts                    stdio 入口
```

領域層完全不知道 WebSocket 的存在，所以整條 MCP 工具管線可以用純記憶體假件測到底——`tests/integration/mcp-client.test.ts` 的 16 項測試都不需要開遊戲。

---

## 8. 已知限制

- **世界必須開作弊**，否則遊戲會拒絕每一條指令。這是 Minecraft 的規則，不是 bug。
- **macOS 狀態是程式層與安裝流程支援、待真機 live 驗證**：目前尚未在 macOS 14+ 從 Finder 啟動 Codex Desktop 並完成 Minecraft `/connect`、讀寫與斷線重連的全流程，因此不能宣稱 Mac 遊戲端已驗證。
- **Agent 是 Education Edition 專屬**，一般 Bedrock 版沒有這個功能。
- **事件名稱與 `agent` 子指令 Mojang 沒有正式文件化**，來自公開觀察；遊戲改版可能改變行為。`mc_events_subscribe` 允許清單外的名稱，但會標記為未驗證。
- **`agent setitem` 的參數順序未經證實**，目前沒有做成專用工具，需要時請走 `mc_run_command`。
- **`@s` 在 WebSocket 指令下不一定能解析**：從橋接送進去的指令沒有實體身分，實測 `querytarget @s` 會完全沒有回應。`mc_query_target` 因此預設用 `@p`（最近的玩家），`live` 也會依序試 `@p` → `@a` → `@e[type=player]` 並回報每次結果。
- **大型建造可能撞到 MCP Host 的請求逾時**：建造工具會逐條送出 fill 並等遊戲回應，實測半徑 6 的空心球（126 條）約需 13 秒，但遊戲繁忙時會更久。MCP client 預設逾時多為 60 秒，超過就會在 Host 端被砍斷（工具本身仍在跑）。先用 `mc_build_preview` 看 `fillBatches`，數量大時分批建造。
- **每個 BlockHand 程序仍各自持有一個監聽埠**：STDIO client 關閉後，server 會同步關閉 Minecraft WebSocket 並釋放連接埠。Codex 桌面版同時載入多個任務，或桌面版／CLI／IDE 並行時，第一份會取得優先埠，其餘會自動取得空閒埠；請一律用目前任務的 `mc_status.connectCommand` 讓遊戲連到實際要操作的那一份。若需要固定埠，可替各 client 配不同的 `MINECRAFT_EDU_WS_PORT`，或把 `MINECRAFT_EDU_WS_PORT_FALLBACK` 設成 `0`。
- **握手後的第一條指令曾必定逾時，現已修正**：四次獨立真機執行都重現——遊戲在伺服器裝好解密器之前就送出一個加密訊框，串流錯位導致下一次請求的回應讀不出來。AES-CFB8 會自我同步，所以只影響第一條。adapter 現在會在握手完成後自動送一條唯讀 `time query daytime` 把那次損失吸收掉並丟棄結果，呼叫端的第一個動作即可正常。stderr 會記 `primed post-handshake stream`。
- **事件只在真正發生時觸發**：`BlockPlaced` 只在玩家親手放方塊時發出，`/setblock` 與 `/fill` 都不算。要收到事件必須先訂閱、再讓事件真的發生。
- **部分回應的 requestId 對不上請求**（觀察到會回全為零的 ID）。adapter 在「只剩一個待決請求」時會把回應歸給它，並在 stderr 記錄這是推斷來的；否則那些請求會一路靜默逾時，呼叫端只看到「沒反應」而不是真正的失敗原因。
- 一次只維持一條遊戲連線；新連線會取代舊的。
- 已完成真機驗證的環境：Minecraft Education **1.26.32.0（Win32 桌面版）**。若改用 Microsoft Store 的 UWP 版，loopback 會被 Windows 應用程式隔離擋住，需要額外的 `CheckNetIsolation LoopbackExempt` 豁免。macOS 14+ 的驗收矩陣見 [`agents/docs/macos-support.md`](agents/docs/macos-support.md)。

---

## 9. 授權

本專案以 [MIT License](LICENSE) 釋出。你可以自由使用、修改、散布與再授權，包含商業用途，唯一條件是保留原始的版權聲明與授權條款。

軟體按「現狀」提供，不附任何明示或默示的擔保。

Minecraft、Minecraft Education 為 Mojang Studios 與 Microsoft 的商標；本專案與兩者無隸屬關係，也未獲其背書。
