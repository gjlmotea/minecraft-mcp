# 自動在 Minecraft Education 聊天列輸入 /connect，免去人工打字。
#
# 實測出來的三件事，換過幾種做法才確定：
#   1. 遊戲吃 Enter 開聊天，不吃 T（T 被當成遊戲控制鍵，不會進聊天）。
#   2. 聊天列不接受 Ctrl+V，但接受 SendKeys 逐字送出的字串。
#   3. 送鍵前必須確認前景真的是 Minecraft，否則會打到別的視窗。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts/auto-connect.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/auto-connect.ps1 -Port 19131

param(
    [int]$Port = 19131,
    [string]$McHost = '127.0.0.1'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

Add-Type @'
using System;
using System.Runtime.InteropServices;
public class McFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
}
'@

function Get-ForegroundProcessName {
    $handle = [McFg]::GetForegroundWindow()
    $ownerId = 0
    [void][McFg]::GetWindowThreadProcessId($handle, [ref]$ownerId)
    return (Get-Process -Id $ownerId -ErrorAction SilentlyContinue).ProcessName
}

$mc = Get-Process -Name 'Minecraft.Windows' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $mc) {
    Write-Error '找不到執行中的 Minecraft Education（行程名 Minecraft.Windows）。'
    exit 1
}

# 9 = SW_RESTORE：視窗最小化時先還原。
[void][McFg]::ShowWindow($mc.MainWindowHandle, 9)

# Windows 會擋下非前景行程呼叫 SetForegroundWindow（foreground lock），
# 所以主要靠 WScript.Shell 的 AppActivate，並重試幾次；SetForegroundWindow
# 只當後備。兩者都失敗才放棄，交回人工。
$shell = New-Object -ComObject WScript.Shell
$fg = $null
for ($i = 0; $i -lt 5; $i++) {
    try { [void]$shell.AppActivate($mc.Id) } catch { }
    Start-Sleep -Milliseconds 350
    $fg = Get-ForegroundProcessName
    if ($fg -eq 'Minecraft.Windows') { break }
    [void][McFg]::SetForegroundWindow($mc.MainWindowHandle)
    Start-Sleep -Milliseconds 350
    $fg = Get-ForegroundProcessName
    if ($fg -eq 'Minecraft.Windows') { break }
}

if ($fg -ne 'Minecraft.Windows') {
    Write-Error "無法把 Minecraft 帶到前景（目前前景是 $fg）；請手動點一下遊戲視窗再重試。"
    exit 1
}
Start-Sleep -Milliseconds 300

# Enter 開聊天，輸入列會自動取得焦點。
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -Milliseconds 500

$command = '/connect ' + $McHost + ':' + $Port
[System.Windows.Forms.SendKeys]::SendWait($command)
Start-Sleep -Milliseconds 400
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')

Write-Output "已在遊戲內送出：$command"
