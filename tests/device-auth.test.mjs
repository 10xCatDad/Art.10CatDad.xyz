import test from "node:test";
import assert from "node:assert/strict";
import { authenticateDevice, hashDeviceToken, newDeviceToken } from "../lib/device-auth.ts";

test("device keys are random and only hashes are looked up", async () => {
 const token = newDeviceToken(), now = Date.now(), queries = [];
 assert.match(token, /^art_device_[0-9a-f]{64}$/);
 assert.notEqual(token, newDeviceToken());
 const digest = await hashDeviceToken(token);
 const row = { id: "device", name: "Test", expires_at: now + 1000, last_used_at: now };
 const db = { prepare(sql) { return { bind(...args) { queries.push({ sql, args }); return { first: async () => row }; } }; } };
 assert.deepEqual(await authenticateDevice(new Request("https://art.example/api/uploads", { headers: { authorization: `Bearer ${token}` } }), db, now), row);
 assert.deepEqual(queries[0].args, [digest, now]);
 assert.ok(!JSON.stringify(queries).includes(token));
 assert.match(queries[0].sql, /expires_at > \?/);
});

test("missing, malformed, revoked, and cross-origin keys fail closed", async () => {
 let reads = 0;
 const db = { prepare() { reads++; return { bind() { return { first: async () => null }; } }; } };
 for (const authorization of ["", "Bearer wrong", `Basic ${newDeviceToken()}`]) {
  assert.equal(await authenticateDevice(new Request("https://art.example/api/uploads", { headers: { authorization } }), db), null);
 }
 assert.equal(reads, 0);
 const token = newDeviceToken();
 assert.equal(await authenticateDevice(new Request("https://art.example/api/uploads", { headers: { authorization: `Bearer ${token}`, origin: "https://evil.example" } }), db), null);
 assert.equal(reads, 0);
 assert.equal(await authenticateDevice(new Request("https://art.example/api/uploads", { headers: { authorization: `Bearer ${token}` } }), db), null);
 assert.equal(reads, 1);
});
