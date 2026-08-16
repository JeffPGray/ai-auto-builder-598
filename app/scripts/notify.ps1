# Send a pipeline notification (PowerShell port of notify.sh, for native
# Windows where bash isn't available).
# Usage:  pwsh -File scripts/notify.ps1 "Your message here"
#
# The channel is picked by NOTIFY_CHANNEL in .env (see .env.example):
#   telegram (default) — requires TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
#   email              — sends to NOTIFY_TO (default: EMAIL_ADDRESS) via
#                        scripts/gmail.py
#   sms                — sends to NOTIFY_TO (default: TEST_PHONE) via
#                        Twilio. (iMessage needs macOS, so on Windows the
#                        sms channel requires SMS_PROVIDER=twilio.)
#
# If the chosen channel isn't configured, this exits 0 silently so callers
# don't fail — parity with notify.sh.
# ValueFromRemainingArguments so a dash-leading first argument (the
# `--configured` probe) binds here instead of erroring as an unknown
# parameter name — PowerShell's binder otherwise rejects it before the
# script body runs.
param([Parameter(Position = 0, ValueFromRemainingArguments = $true)][string[]]$MessageParts = @())

$Message = ($MessageParts -join ' ')
if (-not $Message) { exit 0 }

# Read config from the environment first, then fall back to parsing .env
# (project root = parent of this scripts/ dir). The values we read are all
# plain shell-clean tokens, so odd $-containing values elsewhere in .env
# don't affect us.
$cfg = @{}
foreach ($k in @('NOTIFY_CHANNEL','NOTIFY_TO','EMAIL_ADDRESS','TEST_PHONE','SMS_PROVIDER','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID')) {
  $cfg[$k] = [Environment]::GetEnvironmentVariable($k)
}
$envPath = Join-Path (Split-Path -Parent $PSScriptRoot) '.env'
if (Test-Path $envPath) {
  foreach ($line in Get-Content -LiteralPath $envPath) {
    $t = $line.Trim()
    if ($t -eq '' -or $t.StartsWith('#') -or ($t -notmatch '=')) { continue }
    $parts = $t -split '=', 2
    $k = $parts[0].Trim(); $v = $parts[1].Trim().Trim('"').Trim("'")
    if ($cfg.ContainsKey($k) -and -not $cfg[$k]) { $cfg[$k] = $v }
  }
}

# Resolve a Python launcher. Stock Windows shadows BOTH `python` and
# `python3` with Microsoft Store app-execution-alias stubs (reparse points
# under WindowsApps that open the Store instead of running Python), so
# prefer the `py` launcher — installed by python.org installers and never
# alias-shadowed — and only fall back to `python` when it isn't the stub.
function Invoke-KlaudiusPython {
  param([string[]]$ScriptArgs)
  $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
  if ($pyLauncher) { & py -3 @ScriptArgs; return $LASTEXITCODE }
  $py = Get-Command python -ErrorAction SilentlyContinue
  if ($py -and $py.Source -notmatch 'WindowsApps') { & python @ScriptArgs; return $LASTEXITCODE }
  Write-Warning "notify.ps1: no Python found on PATH — cannot send $($cfg['NOTIFY_CHANNEL']) notification."
  return 1
}

$channel = if ($cfg['NOTIFY_CHANNEL']) { $cfg['NOTIFY_CHANNEL'] } else { 'telegram' }

# Probe mode: `notify.ps1 --configured` exits 0 if the resolved channel can
# deliver, 1 otherwise; sends nothing. Parity with notify.sh so a caller
# translated per AGENTS.md's bash→PowerShell swap behaves identically.
if ($Message -eq '--configured') {
  switch ($channel) {
    { $_ -in 'none', 'off' } { exit 1 }
    'email' { if ($cfg['NOTIFY_TO'] -or $cfg['EMAIL_ADDRESS']) { exit 0 } else { exit 1 } }
    'sms'   { if (($cfg['NOTIFY_TO'] -or $cfg['TEST_PHONE']) -and $cfg['SMS_PROVIDER'] -eq 'twilio') { exit 0 } else { exit 1 } }
    default { if ($cfg['TELEGRAM_BOT_TOKEN'] -and $cfg['TELEGRAM_CHAT_ID']) { exit 0 } else { exit 1 } }
  }
}

switch ($channel) {
  { $_ -in 'none', 'off' } {
    # Explicitly disabled — honour the obvious hand-edit spellings even
    # when Telegram creds remain in .env.
    exit 0
  }
  'email' {
    $to = if ($cfg['NOTIFY_TO']) { $cfg['NOTIFY_TO'] } else { $cfg['EMAIL_ADDRESS'] }
    if (-not $to) {
      Write-Warning "Email notifications not configured (no NOTIFY_TO or EMAIL_ADDRESS in .env). Skipping notify."
      exit 0
    }
    $gmail = Join-Path $PSScriptRoot 'gmail.py'
    # --no-url-check: operator alerts are often about a dead URL; the
    # outreach liveness gate must not swallow them.
    [void](Invoke-KlaudiusPython -ScriptArgs @($gmail, 'send', '--to', $to, '--subject', 'Klaudius alert', '--body', $Message, '--no-url-check'))
  }
  'sms' {
    $to = if ($cfg['NOTIFY_TO']) { $cfg['NOTIFY_TO'] } else { $cfg['TEST_PHONE'] }
    if (-not $to) {
      Write-Warning "SMS notifications not configured (no NOTIFY_TO or TEST_PHONE in .env). Skipping notify."
      exit 0
    }
    if ($cfg['SMS_PROVIDER'] -ne 'twilio') {
      Write-Warning "SMS notifications on Windows require SMS_PROVIDER=twilio (iMessage needs macOS). Skipping notify."
      exit 0
    }
    $twilio = Join-Path $PSScriptRoot 'twilio_sms.py'
    [void](Invoke-KlaudiusPython -ScriptArgs @($twilio, 'send', '--to', $to, '--body', $Message, '--no-url-check'))
  }
  default {
    # telegram (the default). An unrecognised NOTIFY_CHANNEL value also
    # lands here so a hand-edited typo degrades to the long-standing
    # default rather than silently disabling alerts.
    $token = $cfg['TELEGRAM_BOT_TOKEN']
    $chat  = $cfg['TELEGRAM_CHAT_ID']
    if (-not $token -or -not $chat) {
      Write-Warning "Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing in .env). Skipping notify."
      exit 0
    }
    # Windows PowerShell 5.1 defaults to SSL3/TLS1.0 and fails Telegram's
    # TLS-1.2-only endpoint. Force TLS 1.2 there; no-op on PowerShell 7.
    if ($PSVersionTable.PSVersion.Major -lt 6) {
      try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
    }
    # No parse_mode: alerts routinely carry raw error strings with
    # unbalanced `_`/`*`, which Markdown parse-mode rejects with HTTP 400 —
    # dropping the alert exactly when it matters most.
    try {
      Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$token/sendMessage" `
        -Body @{ chat_id = $chat; text = $Message } | Out-Null
    } catch {
      Write-Warning "notify.ps1: Telegram send failed: $($_.Exception.Message)"
    }
  }
}
exit 0
