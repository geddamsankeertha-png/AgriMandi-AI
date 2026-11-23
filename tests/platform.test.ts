import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';

// Ensure isolated offline SQLite DB & no server auto-start before dynamic imports
const tmpDbPath = path.join(os.tmpdir(), `kisanmandi_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.db`);
process.env.KISANMANDI_NO_AUTOSTART = '1';
process.env.SQLITE_DB_PATH = tmpDbPath;
process.env.GEMINI_API_KEY = '';
process.env.DATA_GOV_IN_API_KEY = '';
process.env.JWT_SECRET = 'test-suite-jwt-secret-key-local';

let server: http.Server;
let baseUrl = '';
let farmerToken = '';
let farmerRefresh = '';
let traderToken = '';
let analystToken = '';
let adminToken = '';
let farmerUserId = '';

before(async () => {
  const { createApp } = await import('../server.ts');
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  try {
    const { getDb } = await import('../server/database.ts');
    getDb().close();
  } catch {
    // ignore if already closed
  }
  for (const suffix of ['', '-wal', '-shm']) {
    const p = `${tmpDbPath}${suffix}`;
    if (fs.existsSync(p)) {
      fs.rmSync(p, { force: true });
    }
  }
});

test('Unit Test: Trader Profit & Break-Even Calculator Arithmetic', () => {
  const purchasePrice = 20;
  const sellingPrice = 35;
  const quantity = 100;
  const transportCost = 500;
  const handlingCost = 200;
  const wastagePercent = 2;

  const totalPurchaseCost = purchasePrice * quantity + transportCost + handlingCost;
  const effectiveQuantity = quantity * (1 - wastagePercent / 100);
  const totalRevenue = sellingPrice * effectiveQuantity;
  const netProfit = totalRevenue - totalPurchaseCost;
  const margin = (netProfit / totalRevenue) * 100;
  const breakEven = totalPurchaseCost / effectiveQuantity;

  assert.equal(totalPurchaseCost, 2700);
  assert.equal(effectiveQuantity, 98);
  assert.equal(netProfit, 730);
  assert.ok(margin > 20);
  assert.ok(Math.abs(breakEven - 27.551) < 0.01);
});

test('Security Test: JWT Signatures, Expired Tokens & alg:none Rejection', async () => {
  const { generateToken, verifyToken } = await import('../server/securityMiddleware.ts');
  const user = { id: 'usr_test123', email: 'test@kisanmandi.local', role: 'farmer' };

  const accessToken = generateToken(user, 'access');
  const verified = verifyToken(accessToken);
  assert.ok(verified);
  assert.equal(verified.userId, 'usr_test123');
  assert.equal(verified.type, 'access');

  // Forged alg: none token rejected in unit check and HTTP middleware
  const fakeHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const fakePayload = Buffer.from(
    JSON.stringify({ userId: 'usr_hacker', role: 'admin', type: 'access', exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString('base64url');
  const forgedAlgNone = `${fakeHeader}.${fakePayload}.forged`;
  assert.equal(verifyToken(forgedAlgNone), null);

  const algNoneHttp = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${forgedAlgNone}` },
  });
  assert.equal(algNoneHttp.status, 401);

  // Tampered signature rejected
  const tampered = `${accessToken.slice(0, -4)}zzzz`;
  assert.equal(verifyToken(tampered), null);
  const tamperedHttp = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${tampered}` },
  });
  assert.equal(tamperedHttp.status, 401);

  // Expired HS256 token signed with valid secret must be rejected
  const hsHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const expiredPayload = Buffer.from(
    JSON.stringify({
      userId: 'usr_test123',
      email: 'test@kisanmandi.local',
      role: 'farmer',
      jti: 'expired_jti',
      type: 'access',
      exp: Math.floor(Date.now() / 1000) - 120,
    })
  ).toString('base64url');
  const expSig = crypto
    .createHmac('sha256', process.env.JWT_SECRET!)
    .update(`${hsHeader}.${expiredPayload}`)
    .digest('base64url');
  const expiredToken = `${hsHeader}.${expiredPayload}.${expSig}`;
  assert.equal(verifyToken(expiredToken), null);

  const expiredHttp = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${expiredToken}` },
  });
  assert.equal(expiredHttp.status, 401);
});

test('Data Test: AGMARKNET Validation & Python ML Outlier/Missing Audits', async () => {
  const { validatePriceRecord } = await import('../server/agmarknetClient.ts');
  const { pipelineEngine } = await import('../server/dataPipeline.ts');

  const valid = validatePriceRecord({
    arrival_date: '31/10/2026',
    state: 'Andhra Pradesh',
    district: 'Guntur',
    market: 'Guntur',
    commodity: 'Tomato',
    variety: 'Hybrid',
    grade: 'FAQ',
    min_price: 35,
    max_price: 45,
    modal_price: 40,
  });
  assert.equal(valid.isValid, true);

  const invalid = validatePriceRecord({
    arrival_date: '31/10/2026',
    state: 'Andhra Pradesh',
    district: 'Guntur',
    market: 'Guntur',
    commodity: 'Tomato',
    variety: 'Hybrid',
    grade: 'FAQ',
    min_price: 35,
    max_price: 45,
    modal_price: 55,
  });
  assert.equal(invalid.isValid, false);

  const missingReport = pipelineEngine.getMissingValueReport();
  assert.equal(missingReport.totalRecordsAnalyzed, 8800);

  const outlierReport = pipelineEngine.getOutliersReport();
  assert.equal(outlierReport.analyzedRecords, 8800);
  assert.ok(outlierReport.outliersDetected > 0);
});

test('Guest Workflow & Offline Capabilities: 8,800 Sample Rows, Explorer History/Export & Restricted Guards', async () => {
  const res = await fetch(`${baseUrl}/api/system/capabilities`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.offlineReady, true);
  assert.equal(data.zeroMandatoryCost, true);
  assert.equal(data.database, 'sqlite');
  assert.equal(data.geminiConfigured, false);
  assert.equal(data.agmarknetConfigured, false);
  assert.equal(data.historicalPriceRows, 8800);

  // Guest can explore prices & export CSV
  const histRes = await fetch(`${baseUrl}/api/prices/history?commodity=Tomato&market=Guntur&days=30`);
  assert.equal(histRes.status, 200);
  const histJson = await histRes.json();
  assert.equal(histJson.history.length, 30);
  assert.equal(histJson.is_demonstration_data, true);

  const exportRes = await fetch(`${baseUrl}/api/prices/export?commodity=Tomato&market=Guntur&days=15`);
  assert.equal(exportRes.status, 200);
  const csvText = await exportRes.text();
  assert.ok(csvText.includes('date,commodity,market,modal_price_kg'));
  assert.ok(csvText.split('\n').length >= 16);

  // Guest blocked from restricted endpoints
  for (const restricted of ['/api/watchlists', '/api/scenarios', '/api/auth/me', '/api/pipeline/status', '/api/admin/users']) {
    const r = await fetch(`${baseUrl}${restricted}`);
    assert.equal(r.status, 401, `Guest should get 401 on ${restricted}`);
  }
});

test('ML Endpoints: Next-Day, 7-Day, 30-Day Forecasts & Model Performance (Offline)', async () => {
  const r1 = await fetch(`${baseUrl}/api/predict/next-day?commodity=Tomato&market=Guntur`);
  assert.equal(r1.status, 200);
  const p1 = await r1.json();
  assert.equal(p1.commodity, 'Tomato');
  assert.equal(p1.is_demonstration_data, true);
  assert.ok(typeof p1.predicted_next_day_price === 'number');
  assert.equal(p1.confidence_interval.length, 2);

  const r7 = await fetch(`${baseUrl}/api/predict/7-day?commodity=Onion&market=Lasalgaon`);
  assert.equal(r7.status, 200);
  const p7 = await r7.json();
  assert.equal(p7.daily_forecasts.length, 7);

  const r30 = await fetch(`${baseUrl}/api/predict/30-day?commodity=Potato&market=Agra`);
  assert.equal(r30.status, 200);
  const p30 = await r30.json();
  assert.equal(p30.daily_forecasts.length, 30);

  const perfRes = await fetch(`${baseUrl}/api/model-performance?commodity=Tomato&market=Guntur`);
  assert.equal(perfRes.status, 200);
  const perf = await perfRes.json();
  assert.equal(perf.is_demonstration_data, true);
  assert.equal(perf.models.length, 3);
  assert.ok(Array.isArray(perf.backtesting_results) && perf.backtesting_results.length > 0);
});

test('Auth, Role Setup & Privilege Escalation Guards', async () => {
  // Reject privileged self-registration
  const escalateRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName: 'Attacker',
      email: 'attacker@example.com',
      password: 'Password123!',
      role: 'admin',
    }),
  });
  assert.equal(escalateRes.status, 403);

  // Register Farmer, Trader, Analyst and verify their emails via dev_token
  const regFarmer = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName: 'Test Farmer',
      email: 'farmer.test@example.com',
      password: 'FarmerPass123',
      role: 'farmer',
      preferredState: 'Andhra Pradesh',
      preferredDistrict: 'Guntur',
    }),
  });
  assert.equal(regFarmer.status, 201);
  const farmerRegJson = await regFarmer.json();
  farmerUserId = farmerRegJson.user.id;
  const fv = await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: farmerRegJson.dev_token }),
  });
  assert.equal(fv.status, 200);

  const regTrader = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName: 'Test Trader',
      email: 'trader.test@example.com',
      password: 'TraderPass123',
      role: 'trader',
    }),
  });
  assert.equal(regTrader.status, 201);
  const traderRegJson = await regTrader.json();
  const tv = await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: traderRegJson.dev_token }),
  });
  assert.equal(tv.status, 200);
  traderToken = (await tv.json()).token;

  const regAnalyst = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName: 'Test Analyst',
      email: 'analyst.test@example.com',
      password: 'AnalystPass123',
      role: 'analyst',
    }),
  });
  assert.equal(regAnalyst.status, 201);
  const analystRegJson = await regAnalyst.json();
  const av = await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: analystRegJson.dev_token }),
  });
  assert.equal(av.status, 200);
  analystToken = (await av.json()).token;

  // Wrong password -> 401
  const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'farmer.test@example.com', password: 'WrongPassword' }),
  });
  assert.equal(badLogin.status, 401);

  // Valid login -> 200
  const goodLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'farmer.test@example.com', password: 'FarmerPass123' }),
  });
  assert.equal(goodLogin.status, 200);
  const loginJson = await goodLogin.json();
  farmerToken = loginJson.token;
  farmerRefresh = loginJson.refresh_token;

  // First-run admin setup works once, locks on second attempt
  const setup1 = await fetch(`${baseUrl}/api/auth/setup-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Local Admin',
      email: 'admin.local@example.com',
      password: 'AdminPassword123!',
    }),
  });
  assert.equal(setup1.status, 201);
  adminToken = (await setup1.json()).token;

  const setup2 = await fetch(`${baseUrl}/api/auth/setup-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Second Admin',
      email: 'admin2.local@example.com',
      password: 'AdminPassword123!',
    }),
  });
  assert.equal(setup2.status, 403);
});

test('Farmer, Trader & Analyst End-to-End Workflows + SQL Injection Guard', async () => {
  // FARMER: Recommendation -> Watchlist -> Alerts read persistence -> SQLi parameterized test
  const fRecRes = await fetch(`${baseUrl}/api/recommendation/farmer?commodity=Tomato&market=Guntur`);
  assert.equal(fRecRes.status, 200);
  const fRec = await fRecRes.json();
  assert.ok(fRec.nearby_markets_comparison.length > 0);
  assert.ok(fRec.recommendation_badge);

  const sqliWatchlist = await fetch(`${baseUrl}/api/watchlists`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${farmerToken}` },
    body: JSON.stringify({
      state: 'Andhra Pradesh',
      market: "Guntur'); DROP TABLE historical_prices; --",
      commodity: 'Tomato',
      targetPrice: 4100,
      alertCondition: 'above',
    }),
  });
  assert.equal(sqliWatchlist.status, 201);

  // Confirm historical_prices table survived SQLi attempt completely intact
  const capAfterSqli = await (await fetch(`${baseUrl}/api/system/capabilities`)).json();
  assert.equal(capAfterSqli.historicalPriceRows, 8800);

  // Alerts read persistence
  const alertsBefore = await (await fetch(`${baseUrl}/api/alerts?role=farmer`, {
    headers: { Authorization: `Bearer ${farmerToken}` },
  })).json();
  const firstAlertId = alertsBefore.alerts[0]?.id;
  assert.ok(firstAlertId);

  const markRead = await fetch(`${baseUrl}/api/alerts/read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${farmerToken}` },
    body: JSON.stringify({ alertId: firstAlertId }),
  });
  assert.equal(markRead.status, 200);

  const alertsAfter = await (await fetch(`${baseUrl}/api/alerts?role=farmer`, {
    headers: { Authorization: `Bearer ${farmerToken}` },
  })).json();
  assert.equal(alertsAfter.alerts.find((a: any) => a.id === firstAlertId)?.read, true);

  // TRADER: Arbitrage recommendation -> Save & Delete Scenario
  const tRecRes = await fetch(`${baseUrl}/api/recommendation/trader?commodity=Onion&market=Lasalgaon&target_market=Guntur`);
  assert.equal(tRecRes.status, 200);
  const tRec = await tRecRes.json();
  assert.ok(['BUY', 'SELL', 'HOLD'].includes(tRec.signal));
  assert.ok(typeof tRec.arbitrage_analysis.net_margin_percent === 'number');

  const saveScen = await fetch(`${baseUrl}/api/scenarios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${traderToken}` },
    body: JSON.stringify({
      cropGroup: 'Vegetables',
      cropName: 'Onion',
      state: 'Maharashtra',
      market: 'Lasalgaon',
      inputs: { lotSize: 50 },
      predictedPriceQuintal: 2800,
      predictedPriceTonne: 28000,
    }),
  });
  assert.equal(saveScen.status, 201);
  const scenId = (await saveScen.json()).item.id;

  const listScen = await (await fetch(`${baseUrl}/api/scenarios`, {
    headers: { Authorization: `Bearer ${traderToken}` },
  })).json();
  assert.ok(listScen.items.some((s: any) => s.id === scenId));

  const delScen = await fetch(`${baseUrl}/api/scenarios/${scenId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${traderToken}` },
  });
  assert.equal(delScen.status, 200);

  // ANALYST: Monitoring metrics & Pipeline inspection (allowed), Admin write blocked (403)
  const monRes = await fetch(`${baseUrl}/api/monitoring/metrics`, {
    headers: { Authorization: `Bearer ${analystToken}` },
  });
  assert.equal(monRes.status, 200);
  const monJson = await monRes.json();
  assert.ok(monJson.metrics.length > 0);

  const analystAdminBlocked = await fetch(`${baseUrl}/api/admin/users`, {
    headers: { Authorization: `Bearer ${analystToken}` },
  });
  assert.equal(analystAdminBlocked.status, 403);
});

test('Admin Workflow, Malformed CSV Rejection, Retrain/Rollback & Refresh Rotation', async () => {
  // Reject malformed CSV headers
  const badCsv1 = await fetch(`${baseUrl}/api/pipeline/upload-csv`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ filename: 'bad_headers.csv', csvContent: 'colA,colB\n1,2' }),
  });
  assert.equal(badCsv1.status, 400);

  // Reject CSV whose rows all fail date/price validation (negative price, min > max, bad date)
  const badCsv2 = await fetch(`${baseUrl}/api/pipeline/upload-csv`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      filename: 'bad_rows.csv',
      csvContent: [
        'arrival_date,market,commodity,min_price,max_price,modal_price',
        'not-a-date,Guntur,Tomato,30,40,35',
        '2026-11-10,Guntur,Tomato,50,30,40',
        '2026-11-11,Guntur,Tomato,20,30,-10',
      ].join('\n'),
    }),
  });
  assert.equal(badCsv2.status, 400);

  // Valid quoted CSV upload -> 201
  const validCsv = await fetch(`${baseUrl}/api/pipeline/upload-csv`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      filename: 'valid_upload.csv',
      csvContent: [
        'arrival_date,state,district,market,commodity,variety,grade,min_price,max_price,modal_price,arrival_tonnes',
        '2026-11-15,"Andhra Pradesh",Guntur,Guntur,Tomato,"Hybrid, Grade-A",FAQ,32,40,36,410',
      ].join('\n'),
    }),
  });
  assert.equal(validCsv.status, 201);

  // Data quality gate & Model retraining -> Rollback
  const gate = await (await fetch(`${baseUrl}/api/pipeline/validate-retrain`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })).json();
  assert.equal(gate.passed, true);

  const retrainRes = await fetch(`${baseUrl}/api/pipeline/retrain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ commodity: 'Tomato', market: 'Guntur', algorithm: 'Multiple Linear Regression' }),
  });
  assert.equal(retrainRes.status, 200);
  const retrainJson = await retrainRes.json();
  assert.equal(retrainJson.success, true);

  const rollbackRes = await fetch(`${baseUrl}/api/pipeline/rollback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ commodity: 'Tomato', market: 'Guntur', version: '' }),
  });
  assert.equal(rollbackRes.status, 200);
  const rollbackJson = await rollbackRes.json();
  assert.equal(rollbackJson.success, true);

  // Admin user management: deactivate & reactivate farmer + audit logs clean of passwords/tokens
  const deact = await fetch(`${baseUrl}/api/admin/users/${farmerUserId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ status: 'Deactivated' }),
  });
  assert.equal(deact.status, 200);

  const react = await fetch(`${baseUrl}/api/admin/users/${farmerUserId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ status: 'Active' }),
  });
  assert.equal(react.status, 200);

  // Refresh token reuse & audit log inspection (re-login first because deactivation revoked tokens)
  const relogin = await (await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'farmer.test@example.com', password: 'FarmerPass123' }),
  })).json();
  const rTok = relogin.refresh_token;

  const rotRes = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: rTok }),
  });
  assert.equal(rotRes.status, 200);

  const reuseOld = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: rTok }),
  });
  assert.equal(reuseOld.status, 401);

  const auditRes = await (await fetch(`${baseUrl}/api/admin/audit-logs?limit=50`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })).json();
  assert.ok(auditRes.logs.length > 0);
  const logSerialized = JSON.stringify(auditRes.logs);
  assert.equal(logSerialized.includes('FarmerPass123'), false);
  assert.equal(logSerialized.includes('AdminPassword123!'), false);
  assert.equal(logSerialized.includes(adminToken), false);
});

test('Security Test: Strict Auth Rate Limiting Enforces 429 After Threshold', async () => {
  let hit429 = false;
  for (let i = 0; i < 28; i++) {
    const r = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nonexistent@example.com', password: 'wrong' }),
    });
    if (r.status === 429) {
      hit429 = true;
      break;
    }
  }
  assert.equal(hit429, true, 'Strict auth rate limiter should enforce HTTP 429 after 25 attempts');
});

test('Email Verification Test: Verify Me Email Token Required Before Role Dashboard Access', async () => {
  const { resetRateLimitsForTests } = await import('../server/securityMiddleware.ts');
  resetRateLimitsForTests();

  const email = `verify_test_${Math.random().toString(36).slice(2, 8)}@example.com`;
  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName: 'Verify Farmer',
      email,
      password: 'VerifyPassword123',
      role: 'farmer',
      preferredState: 'Andhra Pradesh',
      preferredDistrict: 'Guntur',
    }),
  });
  assert.equal(regRes.status, 201);
  const regJson = await regRes.json();
  assert.equal(regJson.requiresVerification, true);
  assert.equal(regJson.user.emailVerified, false);
  assert.equal(regJson.token, undefined, 'Registration must not grant access token before email Verify Me link is clicked');
  assert.ok(regJson.dev_token, 'Should generate verification token for emailed Verify Me link');

  // Direct /api/auth/verify-me bypass must not exist
  const bypassRes = await fetch(`${baseUrl}/api/auth/verify-me`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'VerifyPassword123' }),
  });
  assert.equal(bypassRes.status, 404);

  // Login must be rejected with 403 prior to clicking emailed Verify Me button
  const unverifiedLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'VerifyPassword123' }),
  });
  assert.equal(unverifiedLogin.status, 403);
  const unverifiedJson = await unverifiedLogin.json();
  assert.equal(unverifiedJson.requiresVerification, true);

  // Invalid verification token is rejected
  const badVerify = await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'invalid_token_xyz' }),
  });
  assert.equal(badVerify.status, 400);

  // Clicking the Verify Me link in the email activates the account & grants role dashboard access
  const goodVerify = await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: regJson.dev_token }),
  });
  assert.equal(goodVerify.status, 200);
  const verifyJson = await goodVerify.json();
  assert.equal(verifyJson.success, true);
  assert.equal(verifyJson.user.emailVerified, true);
  assert.equal(verifyJson.user.role, 'farmer');
  assert.ok(verifyJson.token);
  assert.ok(verifyJson.refresh_token);

  // Re-clicking same link returns alreadyVerified without minting a second session token
  const reuseVerify = await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: regJson.dev_token }),
  });
  assert.equal(reuseVerify.status, 200);
  const reuseJson = await reuseVerify.json();
  assert.equal(reuseJson.alreadyVerified, true);
  assert.equal(reuseJson.token, undefined, 'Replayed verification link must not issue a new session JWT');

  // Verified farmer token accesses farmer endpoint and stays blocked from admin endpoints
  const farmerAlertsRes = await fetch(`${baseUrl}/api/alerts?role=farmer`, {
    headers: { Authorization: `Bearer ${verifyJson.token}` },
  });
  assert.equal(farmerAlertsRes.status, 200);

  const farmerAdminBlocked = await fetch(`${baseUrl}/api/admin/users`, {
    headers: { Authorization: `Bearer ${verifyJson.token}` },
  });
  assert.equal(farmerAdminBlocked.status, 403);

  // Login now succeeds with 200 after email verification
  const verifiedLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'VerifyPassword123' }),
  });
  assert.equal(verifiedLogin.status, 200);

  // Also test resend verification and trader role dashboard access
  const traderEmail = `verify_trader_${Math.random().toString(36).slice(2, 8)}@example.com`;
  const traderRegRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName: 'Verify Trader',
      email: traderEmail,
      password: 'VerifyPassword123',
      role: 'trader',
    }),
  });
  const traderRegJson = await traderRegRes.json();

  const resendRes = await fetch(`${baseUrl}/api/auth/resend-verification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: traderEmail }),
  });
  assert.equal(resendRes.status, 200);
  const resendJson = await resendRes.json();
  assert.equal(resendJson.success, true);
  assert.ok(resendJson.dev_token);

  // Clicking the first email's Verify Me link still works before verification completes
  const traderVerifyRes = await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: traderRegJson.dev_token }),
  });
  assert.equal(traderVerifyRes.status, 200);
  const traderVerifyJson = await traderVerifyRes.json();
  assert.equal(traderVerifyJson.user.role, 'trader');
  assert.equal(traderVerifyJson.user.emailVerified, true);

  // Once verified, all outstanding tokens for that user are retired (alreadyVerified=true, no new JWT)
  const secondTokenAfterVerify = await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: resendJson.dev_token }),
  });
  assert.equal(secondTokenAfterVerify.status, 200);
  const secondJson = await secondTokenAfterVerify.json();
  assert.equal(secondJson.alreadyVerified, true);
  assert.equal(secondJson.token, undefined);

  const traderScenarios = await fetch(`${baseUrl}/api/scenarios`, {
    headers: { Authorization: `Bearer ${traderVerifyJson.token}` },
  });
  assert.equal(traderScenarios.status, 200);

  // Test 6-digit email OTP verification (AI Studio Dev Preview flow), brute-force lockout, & pasted full URL parsing
  resetRateLimitsForTests();
  const { getDb } = await import('../server/database.ts');
  const db = getDb();

  const analystEmail = `verify_otp_${Math.random().toString(36).slice(2, 8)}@example.com`;
  const otpRegRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName: 'OTP Analyst',
      email: analystEmail,
      password: 'VerifyPassword123',
      role: 'analyst',
    }),
  });
  assert.equal(otpRegRes.status, 201);
  const otpRegJson = await otpRegRes.json();
  assert.equal(otpRegJson.otp, undefined, 'API response must never leak email OTP');
  assert.equal(otpRegJson.code, undefined, 'API response must never leak email OTP');

  const storedTokenRow = db
    .prepare('SELECT token_hash, otp_hash, failed_attempts FROM email_verification_tokens WHERE user_id = ? AND used = 0')
    .get(otpRegJson.user.id) as { token_hash: string; otp_hash: string | null; failed_attempts: number } | undefined;
  assert.ok(storedTokenRow?.otp_hash, 'Email verification token row should store SHA-256 otp_hash');
  assert.equal(storedTokenRow?.failed_attempts, 0);

  // Set deterministic hash for the test OTP so we never rely on plaintext email output
  const badTestHash = crypto.createHash('sha256').update('918273').digest('hex');
  db.prepare('UPDATE email_verification_tokens SET otp_hash = ? WHERE token_hash = ?').run(
    badTestHash,
    storedTokenRow!.token_hash
  );

  // Malformed OTP format -> 400
  const malformedOtpRes = await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: analystEmail, code: '12ab' }),
  });
  assert.equal(malformedOtpRes.status, 400);

  // 5 wrong OTP attempts -> 400 each, 6th attempt -> 429 brute-force lockout
  for (let i = 0; i < 5; i++) {
    const wrongOtp = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: analystEmail, code: '000000' }),
    });
    assert.equal(wrongOtp.status, 400);
  }
  const lockedOtpRes = await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: analystEmail, code: '918273' }),
  });
  assert.equal(lockedOtpRes.status, 429, 'Should enforce 429 lockout after 5 wrong OTP attempts even if 6th uses old code');

  // Resend issues a fresh active OTP & link token
  const resendOtpRes = await fetch(`${baseUrl}/api/auth/resend-verification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: analystEmail }),
  });
  assert.equal(resendOtpRes.status, 200);
  const latestTokenRow = db
    .prepare('SELECT token_hash FROM email_verification_tokens WHERE user_id = ? AND used = 0 ORDER BY created_at DESC LIMIT 1')
    .get(otpRegJson.user.id) as { token_hash: string } | undefined;
  assert.ok(latestTokenRow);

  const validOtp = '739104';
  const validOtpHash = crypto.createHash('sha256').update(validOtp).digest('hex');
  db.prepare('UPDATE email_verification_tokens SET otp_hash = ? WHERE token_hash = ?').run(
    validOtpHash,
    latestTokenRow!.token_hash
  );

  // Verify using email + 6-digit code
  const validOtpVerify = await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: analystEmail, code: validOtp }),
  });
  assert.equal(validOtpVerify.status, 200);
  const validOtpJson = await validOtpVerify.json();
  assert.equal(validOtpJson.success, true);
  assert.equal(validOtpJson.user.emailVerified, true);
  assert.equal(validOtpJson.user.role, 'analyst');
  assert.ok(validOtpJson.token);

  const analystMonRes = await fetch(`${baseUrl}/api/monitoring/metrics`, {
    headers: { Authorization: `Bearer ${validOtpJson.token}` },
  });
  assert.equal(analystMonRes.status, 200);

  // Test pasting a full verification link URL into /api/auth/verify-email
  const urlPasteEmail = `verify_url_${Math.random().toString(36).slice(2, 8)}@example.com`;
  const urlPasteReg = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName: 'URL Paste Farmer',
      email: urlPasteEmail,
      password: 'VerifyPassword123',
      role: 'farmer',
    }),
  });
  const urlPasteRegJson = await urlPasteReg.json();
  const urlVerifyRes = await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: `https://ais-dev-example.asia-southeast1.run.app/verify-email?token=${urlPasteRegJson.dev_token}`,
    }),
  });
  assert.equal(urlVerifyRes.status, 200);
  const urlVerifyJson = await urlVerifyRes.json();
  assert.equal(urlVerifyJson.success, true);
  assert.equal(urlVerifyJson.user.emailVerified, true);
});

test('Reliability Test: Spot-Price Caching, SQLite ON CONFLICT Upsert & Pipeline Status Tracking', async () => {
  const res1 = await fetch(`${baseUrl}/api/commodities/live`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'Andhra Pradesh', market: 'Guntur', group: 'Vegetables' }),
  });
  assert.equal(res1.status, 200);
  const json1 = await res1.json();
  assert.equal(json1.success, true);
  assert.equal(json1.cached_response, undefined);

  const res2 = await fetch(`${baseUrl}/api/commodities/live`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'Andhra Pradesh', market: 'Guntur', group: 'Vegetables' }),
  });
  assert.equal(res2.status, 200);
  const json2 = await res2.json();
  assert.equal(json2.cached_response, true);

  const { getDb } = await import('../server/database.ts');
  const db = getDb();
  const nowIso = new Date().toISOString();
  db.prepare(`
    INSERT INTO historical_prices (
      arrival_date, state, district, market, commodity, variety, grade,
      min_price, max_price, modal_price, arrival_tonnes, data_source, created_at
    ) VALUES ('2026-11-25', 'Andhra Pradesh', 'Guntur', 'Guntur', 'TestCrop', 'FAQ', 'FAQ', 30, 50, 40, 100, 'test', ?)
    ON CONFLICT (arrival_date, commodity, market) DO UPDATE SET modal_price = excluded.modal_price
  `).run(nowIso);

  const row1 = db.prepare('SELECT modal_price FROM historical_prices WHERE arrival_date = ? AND commodity = ? AND market = ?').get('2026-11-25', 'TestCrop', 'Guntur') as { modal_price: number };
  assert.equal(row1.modal_price, 40);

  db.prepare(`
    INSERT INTO historical_prices (
      arrival_date, state, district, market, commodity, variety, grade,
      min_price, max_price, modal_price, arrival_tonnes, data_source, created_at
    ) VALUES ('2026-11-25', 'Andhra Pradesh', 'Guntur', 'Guntur', 'TestCrop', 'FAQ', 'FAQ', 35, 55, 45, 120, 'test', ?)
    ON CONFLICT (arrival_date, commodity, market) DO UPDATE SET modal_price = excluded.modal_price
  `).run(nowIso);

  const row2 = db.prepare('SELECT modal_price FROM historical_prices WHERE arrival_date = ? AND commodity = ? AND market = ?').get('2026-11-25', 'TestCrop', 'Guntur') as { modal_price: number };
  assert.equal(row2.modal_price, 45, 'ON CONFLICT DO UPDATE should update modal price safely');

  const { pipelineEngine } = await import('../server/dataPipeline.ts');
  const pipeStatus = pipelineEngine.getStatus();
  assert.ok(typeof pipeStatus.consecutiveFailures === 'number');
  assert.ok(typeof pipeStatus.consecutiveFailuresWarning === 'boolean');
});

test('AGMARKNET 2.0 Integration Test: Metric Normalization, Strict Bounds, Pipeline Toggle & Ingestion Guards', async () => {
  const { agmarknetV2Client } = await import('../server/agmarknetV2Client.ts');

  // 1. Unit Normalization: Rs./Quintal -> Rs./kg
  const rawSample = {
    mkt_id: 1013,
    status: 'ACTIVE',
    mkt_name: 'Guntur APMC',
    cmdt_name: 'Tomato',
    state_name: 'Andhra Pradesh',
    district_name: 'Guntur',
    arrival_qty: '120.5',
    modal_price_wt: '3200',
    unit_name_price: 'Rs./Quintal',
    unit_name_arrival: 'Metric Tonnes',
  };

  const norm = agmarknetV2Client.normalizeRecord(rawSample, '2026-11-23');
  assert.equal(norm.isValid, true);
  assert.ok(norm.record);
  assert.equal(norm.record.modal_price, 32.00, '3200 Rs./Quintal must normalize to 32.00 Rs./kg');
  assert.equal(norm.record.min_price, 28.80, 'Min price should default to 90% of modal');
  assert.equal(norm.record.max_price, 35.20, 'Max price should default to 110% of modal');
  assert.equal(norm.record.arrival_tonnes, 120.5, 'Arrivals in Metric Tonnes must be preserved');
  assert.equal(norm.record.data_source, 'agmarknet_v2', 'Provenance must be agmarknet_v2');
  assert.equal(norm.record.market, 'Guntur', 'Trailing APMC should be cleaned from market name');

  // 2. Validation rejections
  const badPrice = agmarknetV2Client.normalizeRecord({ ...rawSample, modal_price_wt: '-50' }, '2026-11-23');
  assert.equal(badPrice.isValid, false);

  const missingCommodity = agmarknetV2Client.normalizeRecord({ ...rawSample, cmdt_name: '' }, '2026-11-23');
  assert.equal(missingCommodity.isValid, false);

  // 3. System capabilities check
  const capRes = await fetch(`${baseUrl}/api/system/capabilities`);
  assert.equal(capRes.status, 200);
  const capJson = await capRes.json();
  assert.equal(capJson.agmarknetV2Configured, true);
  assert.equal(capJson.agmarknetV2Enabled, true);

  // 4. Admin Toggle Endpoint
  const toggleOff = await fetch(`${baseUrl}/api/pipeline/v2-toggle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(toggleOff.status, 200);
  const toggleOffJson = await toggleOff.json();
  assert.equal(toggleOffJson.enabled, false);

  // 5. Ingestion when disabled should reject cleanly
  const disabledFetch = await fetch(`${baseUrl}/api/pipeline/trigger-fetch-v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ commodityId: 1 }),
  });
  assert.equal(disabledFetch.status, 200);
  const disabledJson = await disabledFetch.json();
  assert.equal(disabledJson.disabled, true);

  // 6. Toggle back on
  const toggleOn = await fetch(`${baseUrl}/api/pipeline/v2-toggle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal(toggleOn.status, 200);
  const toggleOnJson = await toggleOn.json();
  assert.equal(toggleOnJson.enabled, true);

  // 7. Security guard: non-admin or unauthenticated cannot toggle
  const unauthorizedToggle = await fetch(`${baseUrl}/api/pipeline/v2-toggle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(unauthorizedToggle.status, 401);
});

test('Hosted Email Verification URL Resolution & Delivery Status Reporting', async () => {
  const { resolveAppBaseUrl } = await import('../server/mailService.ts');
  const origAppBase = process.env.APP_BASE_URL;
  const origRenderUrl = process.env.RENDER_EXTERNAL_URL;

  try {
    delete process.env.APP_BASE_URL;
    process.env.RENDER_EXTERNAL_URL = 'https://kisanmandi.onrender.com/';
    assert.equal(resolveAppBaseUrl('http://localhost:3000'), 'https://kisanmandi.onrender.com');

    // Even if APP_BASE_URL was left as localhost from .env.example, prefer RENDER_EXTERNAL_URL in hosted deploy
    process.env.APP_BASE_URL = 'http://localhost:3000';
    assert.equal(resolveAppBaseUrl(), 'https://kisanmandi.onrender.com');

    // Custom APP_BASE_URL overrides RENDER_EXTERNAL_URL
    process.env.APP_BASE_URL = 'https://mandi.example.com/';
    assert.equal(resolveAppBaseUrl('https://kisanmandi.onrender.com'), 'https://mandi.example.com');

    // Active Cloud Run / AI Studio preview URL keeps verification links on the active preview DB
    assert.equal(
      resolveAppBaseUrl('https://ais-dev-example.asia-southeast1.run.app/'),
      'https://ais-dev-example.asia-southeast1.run.app'
    );

    // Falls back to requestOrigin when neither APP_BASE_URL nor RENDER_EXTERNAL_URL is set
    delete process.env.APP_BASE_URL;
    delete process.env.RENDER_EXTERNAL_URL;
    assert.equal(resolveAppBaseUrl('https://my-app.onrender.com/'), 'https://my-app.onrender.com');
  } finally {
    if (origAppBase !== undefined) process.env.APP_BASE_URL = origAppBase;
    else delete process.env.APP_BASE_URL;
    if (origRenderUrl !== undefined) process.env.RENDER_EXTERNAL_URL = origRenderUrl;
    else delete process.env.RENDER_EXTERNAL_URL;
  }
});




