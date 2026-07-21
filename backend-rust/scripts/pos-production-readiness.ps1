[CmdletBinding()]
param(
  [ValidateSet('Readiness', 'Load', 'Soak', 'OfflineRecovery', 'SelfTest')]
  [string]$Mode = 'Readiness',
  [string]$BaseUrl = $env:POS_BASE_URL,
  [string]$AccessToken = $env:POS_ACCESS_TOKEN,
  [string]$TenantId = $env:POS_TENANT_ID,
  [string]$BranchId = $env:POS_BRANCH_ID,
  [string[]]$TerminalIds = @($env:POS_TERMINAL_IDS -split ',' | Where-Object { $_ }),
  [int]$Requests = 100,
  [int]$Concurrency = 10,
  [int]$DurationMinutes = 15,
  [string]$OfflinePayloadPath,
  [switch]$AllowWrites,
  [switch]$SignedWebhookProbes
)

$ErrorActionPreference = 'Stop'

function Assert-Value([string]$Name, [string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { throw "$Name is required" }
}

function Get-Headers {
  @{
    Authorization = "Bearer $AccessToken"
    'x-tenant-id' = $TenantId
    'x-branch-id' = $BranchId
  }
}

function Invoke-Api([string]$Method, [string]$Path, $Body = $null, [hashtable]$ExtraHeaders = @{}, [switch]$Public) {
  $headers = if ($Public) { @{} } else { Get-Headers }
  foreach ($key in $ExtraHeaders.Keys) { $headers[$key] = $ExtraHeaders[$key] }
  $params = @{ Method = $Method; Uri = "$($BaseUrl.TrimEnd('/'))$Path"; Headers = $headers }
  if ($null -ne $Body) {
    $params.ContentType = 'application/json'
    $params.Body = if ($Body -is [string]) { $Body } else { $Body | ConvertTo-Json -Depth 20 -Compress }
  }
  Invoke-RestMethod @params
}

function Get-Hmac([string]$Secret, [string]$Body, [ValidateSet('Hex', 'Base64')]$Encoding = 'Hex') {
  $hmac = [System.Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($Secret))
  try { $bytes = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($Body)) } finally { $hmac.Dispose() }
  if ($Encoding -eq 'Base64') { return [Convert]::ToBase64String($bytes) }
  -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

function Get-Sha256([string]$Value) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $bytes = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)) } finally { $sha.Dispose() }
  -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

function Test-SignedWebhooks {
  $results = @()
  $razorpay = $env:RAZORPAY_WEBHOOK_SECRET
  if ($razorpay) {
    $body = '{"event":"readiness.probe","payload":{"payment_link":{"entity":{"id":"readiness-probe"}}}}'
    Invoke-Api POST '/api/v1/webhooks/razorpay' $body @{ 'x-razorpay-signature' = Get-Hmac $razorpay $body } -Public | Out-Null
    $results += [pscustomobject]@{ Provider = 'razorpay'; SignedWebhook = 'verified' }
  } else { $results += [pscustomobject]@{ Provider = 'razorpay'; SignedWebhook = 'secret_missing' } }

  $cashfree = $env:CASHFREE_CLIENT_SECRET
  if ($cashfree) {
    $body = '{"type":"READINESS_PROBE","data":{"link_id":"readiness-probe","link_status":"pending"}}'
    $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()
    $signature = Get-Hmac $cashfree "$timestamp$body" Base64
    Invoke-Api POST '/api/v1/webhooks/cashfree' $body @{ 'x-webhook-timestamp' = $timestamp; 'x-webhook-signature' = $signature } -Public | Out-Null
    $results += [pscustomobject]@{ Provider = 'cashfree'; SignedWebhook = 'verified' }
  } else { $results += [pscustomobject]@{ Provider = 'cashfree'; SignedWebhook = 'secret_missing' } }

  if ($env:PHONEPE_WEBHOOK_USERNAME -and $env:PHONEPE_WEBHOOK_PASSWORD) {
    $body = '{"event":"READINESS_PROBE","payload":{"merchantOrderId":"readiness-probe","state":"pending"}}'
    $authorization = Get-Sha256 "$($env:PHONEPE_WEBHOOK_USERNAME):$($env:PHONEPE_WEBHOOK_PASSWORD)"
    Invoke-Api POST '/api/v1/webhooks/phonepe' $body @{ Authorization = "SHA256($authorization)" } -Public | Out-Null
    $results += [pscustomobject]@{ Provider = 'phonepe'; SignedWebhook = 'verified' }
  } else { $results += [pscustomobject]@{ Provider = 'phonepe'; SignedWebhook = 'secret_missing' } }

  if ($env:WHATSAPP_CLOUD_VERIFY_TOKEN) {
    $token = [Uri]::EscapeDataString($env:WHATSAPP_CLOUD_VERIFY_TOKEN)
    $challenge = Invoke-Api GET "/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=$token&hub.challenge=pos-readiness" $null @{} -Public
    $results += [pscustomobject]@{ Provider = 'whatsapp'; SignedWebhook = if ($challenge -eq 'pos-readiness') { 'verified' } else { 'failed' } }
  } else { $results += [pscustomobject]@{ Provider = 'whatsapp'; SignedWebhook = 'secret_missing' } }
  $results
}

function Invoke-Readiness {
  Invoke-Api GET '/health' $null @{} -Public | Out-Null
  $providers = (Invoke-Api GET '/api/v1/pos/payment-providers').data
  $reliability = (Invoke-Api GET '/api/v1/pos/reliability').data
  $terminals = (Invoke-Api GET '/api/v1/pos/terminals').data
  $reconciliations = (Invoke-Api GET '/api/v1/pos/provider-reconciliations').data
  $delivery = @()
  foreach ($kind in @('email', 'phone')) {
    try { Invoke-Api POST '/api/v1/invoice-notifications/profile/verify-provider' @{ kind = $kind } | Out-Null; $delivery += "${kind}:verified" }
    catch { $delivery += "${kind}:pending" }
  }
  [pscustomobject]@{
    Providers = $providers
    SignedWebhooks = if ($SignedWebhookProbes) { @(Test-SignedWebhooks) } else { @('not_run') }
    Delivery = $delivery
    MatchedSettlements = @($reconciliations | Where-Object status -eq 'matched' | Select-Object provider, settlementDate, statementReference)
    Terminals = @($terminals).Count
    Reliability = $reliability
  } | ConvertTo-Json -Depth 20
}

function Invoke-TerminalBatch([int]$Count) {
  if ($TerminalIds.Count -lt 2) { throw 'At least two POS_TERMINAL_IDS are required for multi-terminal load testing' }
  $client = [System.Net.Http.HttpClient]::new()
  $tasks = [System.Collections.Generic.List[System.Threading.Tasks.Task[System.Net.Http.HttpResponseMessage]]]::new()
  try {
    for ($i = 0; $i -lt $Count; $i++) {
      $terminal = $TerminalIds[$i % $TerminalIds.Count].Trim()
      $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, "$($BaseUrl.TrimEnd('/'))/api/v1/pos/terminals/$terminal/heartbeat")
      $request.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $AccessToken)
      $request.Headers.Add('x-tenant-id', $TenantId)
      $request.Headers.Add('x-branch-id', $BranchId)
      $request.Content = [System.Net.Http.StringContent]::new('{}', [Text.Encoding]::UTF8, 'application/json')
      $tasks.Add($client.SendAsync($request))
    }
    [System.Threading.Tasks.Task]::WaitAll([System.Threading.Tasks.Task[]]$tasks.ToArray())
    @($tasks | ForEach-Object { $_.Result } | Where-Object { -not $_.IsSuccessStatusCode }).Count
  } finally {
    foreach ($task in $tasks) { if ($task.Status -eq [System.Threading.Tasks.TaskStatus]::RanToCompletion) { $task.Result.Dispose() } }
    $client.Dispose()
  }
}

function Invoke-Load([switch]$Continuous) {
  if ($Requests -lt 1 -or $Concurrency -lt 1) { throw 'Requests and Concurrency must be positive' }
  $deadline = if ($Continuous) { [DateTime]::UtcNow.AddMinutes($DurationMinutes) } else { [DateTime]::UtcNow }
  $remaining = $Requests
  $sent = 0
  $failed = 0
  $watch = [Diagnostics.Stopwatch]::StartNew()
  do {
    $batch = if ($Continuous) { $Concurrency } else { [Math]::Min($Concurrency, $remaining) }
    $failed += Invoke-TerminalBatch $batch
    $sent += $batch
    $remaining -= $batch
  } while (($Continuous -and [DateTime]::UtcNow -lt $deadline) -or (-not $Continuous -and $remaining -gt 0))
  $watch.Stop()
  [pscustomobject]@{ Mode = if ($Continuous) { 'Soak' } else { 'Load' }; Requests = $sent; Failed = $failed; DurationSeconds = [Math]::Round($watch.Elapsed.TotalSeconds, 2); RequestsPerSecond = [Math]::Round($sent / [Math]::Max($watch.Elapsed.TotalSeconds, 0.001), 2) } | ConvertTo-Json
  if ($failed) { exit 2 }
}

function Invoke-OfflineRecovery {
  if (-not $AllowWrites) { throw 'OfflineRecovery creates one real staging invoice; pass -AllowWrites explicitly' }
  Assert-Value OfflinePayloadPath $OfflinePayloadPath
  $template = Get-Content -Raw -LiteralPath $OfflinePayloadPath | ConvertFrom-Json
  if ($null -eq $template.checkout) { throw 'Offline payload must contain a checkout object' }
  $operationId = "recovery-$([Guid]::NewGuid().ToString('N'))"
  $body = @{ operationId = $operationId; checkout = $template.checkout }
  $first = (Invoke-Api POST '/api/v1/pos/offline-checkout' $body).data
  $second = (Invoke-Api POST '/api/v1/pos/offline-checkout' $body).data
  if ($first.sale.id -ne $second.sale.id) { throw 'Offline replay created different invoices' }
  [pscustomobject]@{ OperationId = $operationId; InvoiceId = $first.sale.id; ReplaySafe = $true } | ConvertTo-Json
}

function Invoke-SelfTest {
  $actual = Get-Hmac 'key' 'The quick brown fox jumps over the lazy dog'
  if ($actual -ne 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8') { throw 'HMAC self-test failed' }
  'POS production readiness self-test passed'
}

if ($Mode -eq 'SelfTest') { Invoke-SelfTest; exit 0 }
Assert-Value BaseUrl $BaseUrl
Assert-Value AccessToken $AccessToken
Assert-Value TenantId $TenantId
Assert-Value BranchId $BranchId

switch ($Mode) {
  'Readiness' { Invoke-Readiness }
  'Load' { Invoke-Load }
  'Soak' { Invoke-Load -Continuous }
  'OfflineRecovery' { Invoke-OfflineRecovery }
}
