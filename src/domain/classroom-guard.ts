import { MinecraftBridgeError } from './contracts.js';

/**
 * 課堂防護。
 *
 * command-policy 原本的立場是「標記風險等級，交由 MCP Host 決定要不要確認」。
 * 那個立場在單人開發情境成立，但這個專案的使用現場是**教室**：
 *
 *   - Host 可能設成自動核准（老師為了上課順暢很容易這樣做）。
 *   - 學生只要能對那個 AI 說話，就等於能下指令。他不必破解橋接，只要說服模型。
 *   - 誤用不需要 raw 指令：`mc_player_action` 本來就接受 `@a` 且 `kill` 是選項之一，
 *     所以只擋 raw 指令是演戲，兩條路都要擋。
 *
 * 規則刻意做成一句話能教給老師的形狀：
 * **會作用在「人」身上的動作，必須指名道姓，不能用 `@a` 這種群體選擇器。**
 * 想殺誰就得打出那個人的名字——這讓「殺光全班」從一句話變成必須逐一指名，
 * 而合法的課堂管理（清掉某個學生的背包）完全不受影響。
 */

/** 直接作用在玩家身上的指令動詞。這些在 raw 指令路徑上一律拒絕。 */
const PLAYER_AFFECTING_VERBS = new Set(['kill', 'kick', 'op', 'deop', 'clear', 'ability']);

/** 專用工具裡屬於「作用在人身上」的動作。 */
const PLAYER_AFFECTING_ACTIONS = new Set(['kill', 'clear', 'ability']);

const DISABLE_HINT = '確定要關閉請設 MINECRAFT_EDU_CLASSROOM_GUARD=0。';

export function isPlayerAffectingVerb(verb: string): boolean {
  return PLAYER_AFFECTING_VERBS.has(verb.toLowerCase());
}

/**
 * 選擇器是否指向「不特定的一群人或某個人」。
 *
 * 只有明確打出玩家名稱才算指名道姓。`@s` 也擋掉：README 已載明從 WebSocket
 * 送進來的指令沒有實體身分，`@s` 在實測中無法解析，放行只會製造一條看起來
 * 安全、實際上行為未定義的路。
 */
export function isBroadSelector(selector: string): boolean {
  return selector.trim().startsWith('@');
}

export function assertClassroomAllowsVerb(verb: string, guardEnabled: boolean): void {
  if (!guardEnabled || !isPlayerAffectingVerb(verb)) return;
  throw new MinecraftBridgeError(
    'command-forbidden',
    `課堂防護：raw 指令不接受 ${verb}——它直接作用在玩家身上，而 raw 指令沒有選擇器層級的防護。` +
      `合法用途請走專用工具（例如 mc_player_action），那裡會要求指名道姓。${DISABLE_HINT}`,
  );
}

export function assertClassroomAllowsTarget(
  action: string,
  selector: string,
  guardEnabled: boolean,
): void {
  if (!guardEnabled) return;
  if (!PLAYER_AFFECTING_ACTIONS.has(action.toLowerCase())) return;
  if (!isBroadSelector(selector)) return;
  throw new MinecraftBridgeError(
    'command-forbidden',
    `課堂防護：${action} 會作用在玩家身上，必須指名道姓，不接受 ${selector.trim()} 這種群體選擇器。` +
      `請改成明確的玩家名稱。${DISABLE_HINT}`,
  );
}
