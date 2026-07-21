[CmdletBinding()]
param(
  [ValidateSet('Readiness', 'Load', 'SignOff', 'SelfTest')]
  [string]$Mode = 'Readiness',
  [string]$BaseUrl = $env:MICRO_PNL_BASE_URL,
  [string]$AccessToken = $env:MICRO_PNL_ACCESS_TOKEN,
  [string]$LimitedAccessToken = $env:MICRO_PNL_LIMITED_ACCESS_TOKEN,
  [string]$TenantId = $env:MICRO_PNL_TENANT_ID,
  [string[]]$BranchIds = @($env:MICRO_PNL_BRANCH_IDS -split ',' | Where-Object { $_ }),
  [string]$FromDate = (Get-Date -Day 1 -Format 'yyyy-MM-dd'),
  [string]$ToDate = (Get-Date -Format 'yyyy-MM-dd'),
  [string]$RefundSaleId = $env:MICRO_PNL_REFUND_SALE_ID,
  [string]$DeferredRevenueSaleId = $env:MICRO_PNL_DEFERRED_SALE_ID,
  [string]$PayrollRunId = $env:MICRO_PNL_PAYROLL_RUN_ID,
  [int]$Requests = 20,
  [int]$P95BudgetMs = 1500
)

$ErrorActionPreference = 'Stop'

function Assert-Value([string]$Name, [string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { throw "$Name is required" }
}

function Get-Headers([string]$Token = $AccessToken) {
  @{
    Authorization = "Bearer $Token"
    'x-tenant-id' = $TenantId
    'x-branch-id' = $BranchIds[0].Trim()
  }
}

function Invoke-Api([string]$Path, [string]$Token = $AccessToken) {
  Invoke-RestMethod -Method GET -Uri "$($BaseUrl.TrimEnd('/'))$Path" -Headers (Get-Headers $Token)
}

function Get-ReportPath([string]$Name) {
  "/api/v1/profit-intelligence/$Name`?scope=tenant&fromDate=$FromDate&toDate=$ToDate"
}

function Assert-Reconciled($Reconciliation, $Advanced) {
  if (-not $Reconciliation.branchPeriodCloseReady) { throw 'Micro P&L branch-period close is not ready' }
  if (-not $Advanced.reconciliationReady) { throw 'Advanced Profit Copilot is not reconciliation-ready' }
  if ($Advanced.recommendationsBlocked) { throw 'Profit recommendations are blocked' }
  if ($Advanced.copilotFactSchemaVersion -ne 'micro-pnl-reconciled-v1') { throw 'Unexpected Copilot fact schema' }
  if ([string]::IsNullOrWhiteSpace($Advanced.copilotFactHash)) { throw 'Copilot fact hash is missing' }
  foreach ($row in @($Advanced.copilot)) {
    if ($row.evaluationStatus -ne 'passed' -or [string]::IsNullOrWhiteSpace($row.recommendationVersionId)) {
      throw 'Copilot recommendation evaluation/version persistence failed'
    }
  }
}

function Invoke-Readiness {
  if ($BranchIds.Count -lt 2) { throw 'At least two real MICRO_PNL_BRANCH_IDS are required for consolidated sign-off' }
  $reconciliation = (Invoke-Api (Get-ReportPath 'reconciliation')).data
  $advanced = (Invoke-Api (Get-ReportPath 'advanced')).data
  if ($advanced.branchCount -lt 2 -or $reconciliation.branchCount -lt 2) { throw 'API did not consolidate at least two authorized branches' }
  Assert-Reconciled $reconciliation $advanced
  if ($LimitedAccessToken) {
    try {
      Invoke-Api (Get-ReportPath 'advanced') $LimitedAccessToken | Out-Null
      throw 'Limited token unexpectedly received tenant-wide profitability'
    } catch {
      if ($_.Exception.Response.StatusCode.value__ -ne 403) { throw }
    }
  }
  [pscustomobject]@{
    BranchCount = $advanced.branchCount
    Reconciled = $reconciliation.branchPeriodCloseReady
    FactSchema = $advanced.copilotFactSchemaVersion
    FactHash = $advanced.copilotFactHash
    Recommendations = @($advanced.copilot).Count
    PermissionProbe = if ($LimitedAccessToken) { 'passed' } else { 'token_missing' }
  }
}

function Invoke-Load {
  if ($Requests -lt 1) { throw 'Requests must be positive' }
  $durations = [System.Collections.Generic.List[double]]::new()
  for ($i = 0; $i -lt $Requests; $i++) {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $advanced = (Invoke-Api (Get-ReportPath 'advanced')).data
    $watch.Stop()
    if (-not $advanced.reconciliationReady) { throw 'Load response was not reconciliation-ready' }
    $durations.Add($watch.Elapsed.TotalMilliseconds)
  }
  $ordered = @($durations | Sort-Object)
  $index = [Math]::Max(0, [Math]::Ceiling($ordered.Count * 0.95) - 1)
  $p95 = [Math]::Round($ordered[$index], 2)
  [pscustomobject]@{ Requests = $Requests; P95Ms = $p95; BudgetMs = $P95BudgetMs; Passed = $p95 -le $P95BudgetMs }
  if ($p95 -gt $P95BudgetMs) { throw "Micro P&L p95 ${p95}ms exceeds ${P95BudgetMs}ms" }
}

function Invoke-SignOff {
  Assert-Value RefundSaleId $RefundSaleId
  Assert-Value DeferredRevenueSaleId $DeferredRevenueSaleId
  Assert-Value PayrollRunId $PayrollRunId
  $readiness = Invoke-Readiness
  $lines = (Invoke-Api "/api/v1/profit-intelligence/micro-lines?scope=tenant&fromDate=$FromDate&toDate=$ToDate&pageSize=200").data.rows
  if (-not @($lines | Where-Object saleId -eq $RefundSaleId).Count) { throw 'Real refund sale is absent from Micro P&L lines' }
  if (-not @($lines | Where-Object saleId -eq $DeferredRevenueSaleId).Count) { throw 'Real deferred-revenue redemption sale is absent from Micro P&L lines' }
  Invoke-Api "/api/v1/staff-payroll/runs/$PayrollRunId" | Out-Null
  $load = Invoke-Load
  [pscustomobject]@{ Readiness = $readiness; Refund = 'passed'; DeferredRevenue = 'passed'; Payroll = 'passed'; Load = $load }
}

function Invoke-SelfTest {
  $rows = @(10, 20, 30, 40, 50, 60, 70, 80, 90, 100)
  $index = [Math]::Max(0, [Math]::Ceiling($rows.Count * 0.95) - 1)
  if ($rows[$index] -ne 100) { throw 'p95 calculation self-test failed' }
  'Micro P&L production readiness self-test passed'
}

if ($Mode -eq 'SelfTest') { Invoke-SelfTest; exit 0 }
Assert-Value BaseUrl $BaseUrl
Assert-Value AccessToken $AccessToken
Assert-Value TenantId $TenantId
if ($BranchIds.Count -lt 1) { throw 'MICRO_PNL_BRANCH_IDS is required' }

switch ($Mode) {
  'Readiness' { Invoke-Readiness }
  'Load' { Invoke-Load }
  'SignOff' { Invoke-SignOff }
}
