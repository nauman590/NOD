import { test, expect } from "@playwright/test";

const API = "http://localhost:3001/api";

// Registers a fresh provider and returns an auth header.
async function registerProvider(request: any) {
  const email = `sprint2_${Date.now()}_${Math.floor(Math.random() * 1e6)}@nod.app`;
  const reg = await request.post(`${API}/auth/register/provider`, {
    data: { email, phone: `+1555${Date.now() % 10000000}`, password: "provider1234", fullName: "Sprint2 Bot" },
  });
  expect(reg.ok()).toBeTruthy();
  const { accessToken } = await reg.json();
  return { Authorization: `Bearer ${accessToken}` };
}

// Item 3 — instant payout endpoints. Before Connect onboarding a provider has no
// connected account, so the balance is zero/disabled and instant payout is refused.
test("payout balance is zero and disabled before Connect onboarding", async ({ request }) => {
  const headers = await registerProvider(request);
  const res = await request.get(`${API}/providers/me/payouts/balance`, { headers });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body).toMatchObject({
    payoutsEnabled: false,
    instantAvailableCents: 0,
    availableCents: 0,
    pendingCents: 0,
  });
});

test("instant payout is blocked until Connect payouts are set up", async ({ request }) => {
  const headers = await registerProvider(request);
  const res = await request.post(`${API}/providers/me/payouts/instant`, { headers, data: {} });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(String(body.message)).toMatch(/set up/i);
});
