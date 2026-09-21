# 生成 native messaging host manifest 并写注册表（HKCU，无需管理员）。
# 扩展 id 默认值为本机已装载的 fund-assistant 扩展（dist/ 路径不变则 id 稳定）；
# 重新装载/换机后用 -ExtensionId 传入新 id。
param([string]$ExtensionId = 'nbaplfjcofhcdfgemehjicafpndjghpf')

$ErrorActionPreference = 'Stop'
if (-not $ExtensionId) { throw '缺少 -ExtensionId（扩展加载后从 chrome://extensions 获取）' }
$d = $PSScriptRoot
$json = @{
  name            = 'com.fund.assistant'
  description     = 'Fund Assistant local server bootstrap'
  type            = 'stdio'
  path            = Join-Path $d 'native-host.cmd'
  allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $d 'com.fund.assistant.json'), $json)
reg add 'HKCU\Software\Google\Chrome\NativeMessagingHosts\com.fund.assistant' /ve /t REG_SZ /d (Join-Path $d 'com.fund.assistant.json') /f | Out-Null
Write-Host 'install ok: com.fund.assistant ->' (Join-Path $d 'com.fund.assistant.json')
