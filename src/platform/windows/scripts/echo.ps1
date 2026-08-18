# UTF-8 echo round-trip fixture (design D3): used by doctor and the Windows-only
# runner test to prove CJK/emoji survive the -File script channel byte-for-byte.
param([string]$Text = '')

. "$PSScriptRoot\_common.ps1"

Emit-Json @{ ok = $true; echo = $Text }
