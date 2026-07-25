import http from 'k6/http';
import exec from 'k6/execution';
import { check, fail, sleep } from 'k6';
import { Counter, Gauge, Rate, Trend } from 'k6/metrics';

const profile = (__ENV.K6_PROFILE || 'baseline').trim().toLowerCase();
const duration = (__ENV.K6_DURATION || (profile === 'smoke' ? '30s' : '5m')).trim();
const expectedBranches = positiveInteger('K6_EXPECTED_BRANCHES', 100);
const requestedVus = positiveInteger('K6_VUS', profile === 'smoke' ? 3 : 30);
const switchVus = positiveInteger('K6_BRANCH_SWITCH_VUS', profile === 'smoke' ? 1 : Math.max(1, Math.floor(requestedVus * 0.1)));
const poolRps = positiveInteger('K6_POOL_RPS', 100);
const thinkTimeSeconds = nonNegativeNumber('K6_THINK_TIME_SECONDS', 1);
const summaryPath = (__ENV.K6_SUMMARY_PATH || 'backend-rust/load-tests/artifacts/k6-summary.json').trim();

const normalApiDuration = new Trend('normal_api_duration', true);
const dashboardReportDuration = new Trend('dashboard_report_duration', true);
const multiBranchDuration = new Trend('multi_branch_duration', true);
const branchSwitchDuration = new Trend('branch_switch_duration', true);
const poolRequestDuration = new Trend('pool_request_duration', true);
const apiErrorRate = new Rate('api_error_rate');
const poolExhaustionErrors = new Counter('pool_exhaustion_errors');
const validatedBranchCount = new Gauge('validated_branch_count');

export const options = buildOptions();

let switchSession;

export function setup() {
  const baseUrl = requiredUrl('K6_BASE_URL');
  const users = requiredUsers();
  const sessions = users.map((user, index) => login(baseUrl, user, index));

  if (profile !== 'pool') {
    const branchCount = loadBranchCount(baseUrl, sessions[0].accessToken);
    validatedBranchCount.add(branchCount);
    if (branchCount < expectedBranches) {
      fail(`capacity dataset has ${branchCount} branches; at least ${expectedBranches} real branches are required`);
    }
  }

  if ((profile === 'baseline' || profile === 'smoke') && sessions.length < switchVus) {
    fail(`K6_USERS_JSON needs at least ${switchVus} independent sessions for branch switching`);
  }
  if (profile === 'baseline' || profile === 'smoke') {
    sessions.forEach((session, index) => {
      if (!session.targetBranchId) {
        fail(`K6_USERS_JSON[${index}].targetBranchId is required for branch-switch proof`);
      }
      if (session.targetBranchId === session.currentBranchId) {
        fail(`K6_USERS_JSON[${index}] must use two different canonical branch IDs`);
      }
    });
  }

  return { baseUrl, sessions };
}

export function normalApi(data) {
  const session = sessionForVu(data.sessions);
  const response = http.get(
    `${data.baseUrl}${__ENV.K6_NORMAL_PATH || '/api/v1/auth/me'}`,
    requestParams(session.accessToken, 'normal_api'),
  );
  recordApi(response, normalApiDuration, 'normal API');
  sleep(thinkTimeSeconds);
}

export function dashboardReport(data) {
  const session = sessionForVu(data.sessions);
  const response = http.get(
    `${data.baseUrl}${__ENV.K6_DASHBOARD_PATH || '/api/v1/reports/dashboard'}`,
    requestParams(session.accessToken, 'dashboard_report'),
  );
  recordApi(response, dashboardReportDuration, 'dashboard report');
  sleep(thinkTimeSeconds);
}

export function multiBranchReport(data) {
  const session = sessionForVu(data.sessions);
  const response = http.get(
    `${data.baseUrl}${__ENV.K6_MULTI_BRANCH_PATH || '/api/v1/settings/multi-branch/command-center'}`,
    requestParams(session.accessToken, 'multi_branch_report'),
  );
  recordApi(response, multiBranchDuration, '100-branch command center');
  sleep(thinkTimeSeconds);
}

export function branchSwitch(data) {
  if (!switchSession) {
    const seed = sessionForVu(data.sessions);
    switchSession = { ...seed };
  }

  const response = http.post(
    `${data.baseUrl}/api/v1/auth/switch-branch`,
    JSON.stringify({
      branchId: switchSession.targetBranchId,
      refreshToken: switchSession.refreshToken,
      deviceId: switchSession.deviceId,
    }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'branch_switch' },
    },
  );
  branchSwitchDuration.add(response.timings.duration);
  const body = apiBody(response);
  const passed = check(response, {
    'branch switch returned 200': (value) => value.status === 200,
    'branch switch returned rotated tokens': () => Boolean(body?.data?.access_token && body?.data?.refresh_token),
  });
  apiErrorRate.add(!passed);
  if (!passed) {
    fail(`branch switch failed with HTTP ${response.status}: ${safeBody(response)}`);
  }

  const previousBranchId = switchSession.currentBranchId;
  switchSession.currentBranchId = switchSession.targetBranchId;
  switchSession.targetBranchId = previousBranchId;
  switchSession.accessToken = body.data.access_token;
  switchSession.refreshToken = body.data.refresh_token;
  sleep(Math.max(thinkTimeSeconds, 1));
}

export function poolPressure(data) {
  const session = sessionForVu(data.sessions);
  const response = http.get(
    `${data.baseUrl}${__ENV.K6_POOL_PATH || '/api/v1/reports/dashboard'}`,
    requestParams(session.accessToken, 'pool_pressure'),
  );
  poolRequestDuration.add(response.timings.duration);
  const failed = response.status !== 200 || apiBody(response)?.success !== true;
  apiErrorRate.add(failed);
  if (
    response.status >= 500 ||
    /pool timed out|acquire timeout|connection pool|too many connections/i.test(safeBody(response))
  ) {
    poolExhaustionErrors.add(1);
  }
  check(response, { 'pool-pressure request succeeded': (value) => value.status === 200 });
}

export function handleSummary(data) {
  const thresholdFailures = Object.entries(data.metrics || {}).flatMap(([metric, value]) =>
    Object.entries(value.thresholds || {})
      .filter(([, threshold]) => threshold.ok === false)
      .map(([threshold]) => `${metric}: ${threshold}`),
  );
  const outcome = thresholdFailures.length === 0 ? 'PASSED' : 'FAILED';
  return {
    stdout: `\nAuraShine capacity gate ${outcome}${thresholdFailures.length ? `\n${thresholdFailures.join('\n')}` : ''}\n`,
    [summaryPath]: JSON.stringify(
      {
        metadata: {
          profile,
          expectedBranches,
          requestedVus,
          duration,
          generatedAt: new Date().toISOString(),
        },
        thresholdFailures,
        summary: data,
      },
      null,
      2,
    ),
  };
}

function buildOptions() {
  const thresholds = {
    api_error_rate: ['rate<0.01'],
    checks: ['rate>0.99'],
  };

  if (profile === 'pool') {
    thresholds.pool_request_duration = ['p(95)<2000'];
    thresholds.pool_exhaustion_errors = ['count==0'];
    thresholds.dropped_iterations = ['count==0'];
    return {
      scenarios: {
        pool_pressure: {
          executor: 'constant-arrival-rate',
          exec: 'poolPressure',
          rate: poolRps,
          timeUnit: '1s',
          duration,
          preAllocatedVUs: Math.max(20, poolRps),
          maxVUs: Math.max(60, poolRps * 3),
        },
      },
      thresholds,
      setupTimeout: '3m',
      summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
    };
  }

  thresholds.normal_api_duration = ['p(95)<500'];
  thresholds.dashboard_report_duration = ['p(95)<2000'];
  thresholds.multi_branch_duration = ['p(95)<2000'];
  thresholds.branch_switch_duration = ['p(95)<1000'];

  if (profile === 'smoke') {
    return {
      scenarios: {
        normal_api: { executor: 'constant-vus', exec: 'normalApi', vus: 1, duration },
        dashboard_report: { executor: 'constant-vus', exec: 'dashboardReport', vus: 1, duration },
        multi_branch_report: { executor: 'constant-vus', exec: 'multiBranchReport', vus: 1, duration },
        branch_switch: { executor: 'constant-vus', exec: 'branchSwitch', vus: switchVus, duration },
      },
      thresholds,
      setupTimeout: '3m',
      summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
    };
  }

  if (profile !== 'baseline') {
    throw new Error('K6_PROFILE must be smoke, baseline, or pool');
  }
  if (requestedVus < 4) {
    throw new Error('baseline K6_VUS must be at least 4');
  }
  const dashboardVus = Math.max(1, Math.floor(requestedVus * 0.2));
  const multiBranchVus = Math.max(1, Math.floor(requestedVus * 0.1));
  const normalVus = requestedVus - dashboardVus - multiBranchVus - switchVus;
  if (normalVus < 1) {
    throw new Error('K6_BRANCH_SWITCH_VUS leaves no VU for the normal API scenario');
  }

  return {
    scenarios: {
      normal_api: { executor: 'constant-vus', exec: 'normalApi', vus: normalVus, duration },
      dashboard_report: { executor: 'constant-vus', exec: 'dashboardReport', vus: dashboardVus, duration },
      multi_branch_report: { executor: 'constant-vus', exec: 'multiBranchReport', vus: multiBranchVus, duration },
      branch_switch: { executor: 'constant-vus', exec: 'branchSwitch', vus: switchVus, duration },
    },
    thresholds,
    setupTimeout: '3m',
    summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  };
}

function requiredUsers() {
  let users;
  try {
    users = JSON.parse((__ENV.K6_USERS_JSON || '').trim());
  } catch (error) {
    fail(`K6_USERS_JSON is not valid JSON: ${error.message}`);
  }
  if (!Array.isArray(users) || users.length === 0) {
    fail('K6_USERS_JSON must contain at least one real staging user');
  }
  const identities = new Set();
  users.forEach((user, index) => {
    for (const field of ['tenantContext', 'loginId', 'password', 'branchId']) {
      if (!String(user?.[field] || '').trim()) {
        fail(`K6_USERS_JSON[${index}].${field} is required`);
      }
    }
    requireUuid(user.branchId, `K6_USERS_JSON[${index}].branchId`);
    if (user.targetBranchId) {
      requireUuid(user.targetBranchId, `K6_USERS_JSON[${index}].targetBranchId`);
    }
    const identityKey = `${user.tenantContext}:${user.loginId}`.toLowerCase();
    if (identities.has(identityKey)) {
      fail(`K6_USERS_JSON contains duplicate identity ${user.loginId}`);
    }
    identities.add(identityKey);
  });
  return users;
}

function login(baseUrl, user, index) {
  const deviceId = `k6-capacity-${index}-${Date.now()}`;
  const response = http.post(
    `${baseUrl}/api/v1/auth/login`,
    JSON.stringify({
      loginId: user.loginId,
      password: user.password,
      branchId: user.branchId,
      deviceId,
      ...(user.mfaCode ? { mfaCode: user.mfaCode } : {}),
    }),
    {
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': user.tenantContext },
      tags: { name: 'setup_login' },
    },
  );
  let data = requiredApiData(response, `login for K6_USERS_JSON[${index}]`);

  if (data.requiresBranchSelection) {
    const select = http.post(
      `${baseUrl}/api/v1/auth/select-branch`,
      JSON.stringify({ selectionToken: data.selectionToken, branchId: user.branchId, deviceId }),
      {
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': user.tenantContext },
        tags: { name: 'setup_select_branch' },
      },
    );
    data = requiredApiData(select, `branch selection for K6_USERS_JSON[${index}]`);
  }

  if (!data.access_token || !data.refresh_token) {
    fail(`login for K6_USERS_JSON[${index}] did not return an authenticated token pair`);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    currentBranchId: user.branchId,
    targetBranchId: user.targetBranchId || '',
    deviceId,
  };
}

function loadBranchCount(baseUrl, accessToken) {
  let count = 0;
  let cursor = '';
  do {
    const query = cursor ? `?limit=200&cursor=${encodeURIComponent(cursor)}` : '?limit=200';
    const response = http.get(
      `${baseUrl}/api/v1/settings/branches/page${query}`,
      requestParams(accessToken, 'setup_branch_page'),
    );
    const data = requiredApiData(response, 'branch capacity validation');
    if (!Array.isArray(data.items)) {
      fail('branch capacity validation returned an invalid page');
    }
    count += data.items.length;
    cursor = data.nextCursor || '';
  } while (cursor);
  return count;
}

function recordApi(response, trend, label) {
  trend.add(response.timings.duration);
  const body = apiBody(response);
  const passed = check(response, {
    [`${label} returned 200`]: (value) => value.status === 200,
    [`${label} returned success envelope`]: () => body?.success === true,
  });
  apiErrorRate.add(!passed);
}

function requestParams(accessToken, name) {
  return {
    headers: { Authorization: `Bearer ${accessToken}` },
    tags: { name },
  };
}

function sessionForVu(sessions) {
  return sessions[(exec.vu.idInTest - 1) % sessions.length];
}

function requiredApiData(response, label) {
  const body = apiBody(response);
  if (response.status < 200 || response.status >= 300 || body?.success !== true || body.data == null) {
    fail(`${label} failed with HTTP ${response.status}: ${safeBody(response)}`);
  }
  return body.data;
}

function apiBody(response) {
  try {
    return response.json();
  } catch (_) {
    return null;
  }
}

function safeBody(response) {
  return String(response.body || '').slice(0, 500).replace(/[\r\n]+/g, ' ');
}

function requiredUrl(name) {
  const value = String(__ENV[name] || '').trim().replace(/\/$/, '');
  if (!/^https:\/\//i.test(value) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(value)) {
    fail(`${name} must be HTTPS, except loopback local testing`);
  }
  return value;
}

function requireUuid(value, label) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value))) {
    fail(`${label} must be a canonical UUID`);
  }
}

function positiveInteger(name, fallback) {
  const value = Number(__ENV[name] || fallback);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function nonNegativeNumber(name, fallback) {
  const value = Number(__ENV[name] ?? fallback);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return value;
}
