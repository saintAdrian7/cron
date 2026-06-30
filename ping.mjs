#!/usr/bin/env node
/**
 * Keep-alive pinger for The Astrid.
 *
 * GETs each target URL so Render free web services don't spin down (they sleep
 * after ~15 min of no inbound traffic). Uses the native fetch in Node >= 18 —
 * no dependencies.
 *
 * Config (env vars):
 *   TARGETS         Comma-separated list of URLs to ping (required).
 *   TIMEOUT_MS      Per-request timeout. Default 60000 (cold starts are slow).
 *   RETRIES         Extra attempts per URL after the first. Default 2.
 *   RETRY_DELAY_MS  Delay between attempts. Default 5000.
 *
 * Exit code is non-zero if any target is still unreachable after all retries,
 * so Render marks the run as failed (and you can wire an alert to it).
 */

const TARGETS = (process.env.TARGETS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (TARGETS.length === 0) {
  console.error("No TARGETS set. Provide a comma-separated list of URLs in the TARGETS env var.");
  process.exit(1);
}

const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 60000);
const RETRIES = Number(process.env.RETRIES || 2);
const RETRY_DELAY_MS = Number(process.env.RETRY_DELAY_MS || 5000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pingOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: { "user-agent": "astrid-keepalive/1.0", accept: "*/*" },
    });
    // Drain the body so the underlying socket is released — otherwise the
    // process can hang on undici's keep-alive pool (or trip a libuv assertion
    // on Windows when forced to exit with an open handle).
    await res.arrayBuffer().catch(() => {});
    return { ok: res.ok, status: res.status, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

async function ping(url) {
  let last = { ok: false, error: "no attempt" };
  for (let attempt = 1; attempt <= RETRIES + 1; attempt++) {
    try {
      const r = await pingOnce(url);
      last = { ...r, attempts: attempt };
      if (r.ok) return { url, ...last };
    } catch (e) {
      const error = e?.name === "AbortError" ? `timeout after ${TIMEOUT_MS}ms` : e?.message || String(e);
      last = { ok: false, error, attempts: attempt };
    }
    if (attempt <= RETRIES) await sleep(RETRY_DELAY_MS);
  }
  return { url, ...last };
}

const startStamp = new Date().toISOString();
console.log(`[${startStamp}] pinging ${TARGETS.length} target(s)…`);

const results = await Promise.all(TARGETS.map(ping));

let failed = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`  ok   ${r.url} -> ${r.status} in ${r.ms}ms (attempt ${r.attempts})`);
  } else {
    failed++;
    const detail = r.status ? `HTTP ${r.status}` : r.error;
    console.error(`  FAIL ${r.url} -> ${detail} (after ${r.attempts} attempt(s))`);
  }
}

console.log(`[${new Date().toISOString()}] done — ${results.length - failed} ok, ${failed} failed`);
// Set the exit code and let the event loop drain naturally. Avoid process.exit(),
// which can race fetch's socket teardown and crash on Windows.
process.exitCode = failed > 0 ? 1 : 0;
