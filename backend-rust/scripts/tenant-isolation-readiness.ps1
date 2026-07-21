[CmdletBinding()]
param(
  [string]$BaseUrl = $env:AURASHINE_BASE_URL,
  [string]$AccessToken = $env:AURASHINE_ACCESS_TOKEN,
  [string]$TenantId = $env:AURASHINE_TENANT_ID,
  [string]$BranchId = $env:AURASHINE_BRANCH_ID,
  [string]$ForgedBranchId = $env:AURASHINE_FORGED_BRANCH_ID,
  [string]$ForgedTenantId = $env:AURASHINE_FORGED_TENANT_ID
)

$ErrorActionPreference = 'Stop'

foreach ($required in @{
  BaseUrl = $BaseUrl; AccessToken = $AccessToken; TenantId = $TenantId
  BranchId = $BranchId; ForgedBranchId = $ForgedBranchId; ForgedTenantId = $ForgedTenantId
}.GetEnumerator()) {
  if ([string]::IsNullOrWhiteSpace($required.Value)) { throw "$($required.Key) is required" }
}

function Get-Status([string]$Tenant, [string]$Branch) {
  $request = [Net.HttpWebRequest]::Create("$($BaseUrl.TrimEnd('/'))/api/v1/auth/me")
  $request.Method = 'GET'
  $request.Headers['Authorization'] = "Bearer $AccessToken"
  $request.Headers['x-tenant-id'] = $Tenant
  $request.Headers['x-branch-id'] = $Branch
  try {
    $response = [Net.HttpWebResponse]$request.GetResponse()
    try { return [int]$response.StatusCode } finally { $response.Dispose() }
  } catch [Net.WebException] {
    if ($_.Exception.Response -is [Net.HttpWebResponse]) {
      return [int]([Net.HttpWebResponse]$_.Exception.Response).StatusCode
    }
    throw
  }
}

$checks = [ordered]@{
  valid_scope = Get-Status $TenantId $BranchId
  forged_branch = Get-Status $TenantId $ForgedBranchId
  forged_tenant = Get-Status $ForgedTenantId $BranchId
}

if ($checks.valid_scope -ne 200) { throw "valid scope failed with HTTP $($checks.valid_scope)" }
if ($checks.forged_branch -notin @(401, 403)) { throw "forged branch was not rejected: HTTP $($checks.forged_branch)" }
if ($checks.forged_tenant -notin @(401, 403)) { throw "forged tenant was not rejected: HTTP $($checks.forged_tenant)" }

[pscustomobject]$checks | ConvertTo-Json
