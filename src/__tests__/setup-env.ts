// Freeze the runtime timezone for every test run. Date math in
// src/lib/calculations/price-formation.ts mixes local-time arithmetic
// (new Date("...T00:00:00"), setDate) with UTC rendering
// (toISOString()) — fine for the app, brittle for tests. Pinning TZ
// up front makes behaviour deterministic for devs on any TZ and for
// CI (which runs UTC).
process.env.TZ = "UTC";
