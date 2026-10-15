#!/usr/bin/env node
/**
 * Stripe test-mode helper for scripts/stripe-e2e-local.sh.
 *
 * Reads STRIPE_TEST_SECRET_KEY from the environment and refuses any key that
 * does not start with sk_test_. Never prints the key. stdout is KEY=value
 * lines only; diagnostics go to stderr.
 */
import { createRequire } from "node:module";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const Stripe = require("stripe");

const API_VERSION = "2025-08-27.basil";
const KEY = process.env.STRIPE_TEST_SECRET_KEY || "";

function die(message) {
  process.stderr.write(`stripe-e2e-driver: ${message}\n`);
  process.exit(1);
}

if (!KEY) die("STRIPE_TEST_SECRET_KEY is not set");
if (!KEY.startsWith("sk_test_")) {
  die("STRIPE_TEST_SECRET_KEY must start with sk_test_");
}

const stripe = new Stripe(KEY, { apiVersion: API_VERSION });

function emit(key, value) {
  if (value == null || value === "") return;
  const text = String(value);
  if (/[\r\n]/.test(text)) die(`refusing to emit multiline ${key}`);
  process.stdout.write(`${key}=${text}\n`);
}

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return "";
  return process.argv[index + 1];
}

function assertLocalWebhook(url) {
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/api\/stripe\/webhook$/.test(url)) {
    die(`refusing to post a webhook payload to a non-local URL`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function subscriptionIdFromInvoice(invoice) {
  const parent = invoice?.parent?.subscription_details?.subscription;
  if (typeof parent === "string") return parent;
  if (parent && typeof parent === "object" && typeof parent.id === "string") {
    return parent.id;
  }
  if (typeof invoice?.subscription === "string") return invoice.subscription;
  return "";
}

async function findEvent(type, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = await stripe.events.list({ type, limit: 25 });
    const hit = page.data.find((event) => {
      if (event.livemode) die(`refusing live-mode event ${event.id}`);
      return predicate(event);
    });
    if (hit) return hit;
    await sleep(1000);
  }
  return null;
}

async function ensurePrice(lookupKey, nickname, unitAmount) {
  const existing = await stripe.prices.list({
    lookup_keys: [lookupKey],
    active: true,
    limit: 1,
  });
  if (existing.data[0]?.id) return existing.data[0].id;

  const product = await stripe.products.create({
    name: nickname,
    metadata: { e2e: "stripe-webhook", lookup_key: lookupKey },
  });
  const price = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: unitAmount,
    recurring: { interval: "month" },
    lookup_key: lookupKey,
    nickname,
    metadata: { e2e: "stripe-webhook" },
  });
  return price.id;
}

async function ensurePrices() {
  let creator = process.env.STRIPE_PRICE_CREATOR_BETA || "";
  let pro = process.env.STRIPE_PRICE_PRO_BUILDER_BETA || "";
  if (creator) {
    const price = await stripe.prices.retrieve(creator);
    if (price.livemode) die("STRIPE_PRICE_CREATOR_BETA is a live-mode price");
  } else {
    creator = await ensurePrice(
      "e2e_creator_beta",
      "E2E Creator Beta",
      1500,
    );
  }
  if (pro) {
    const price = await stripe.prices.retrieve(pro);
    if (price.livemode) die("STRIPE_PRICE_PRO_BUILDER_BETA is a live-mode price");
  } else {
    pro = await ensurePrice(
      "e2e_pro_builder_beta",
      "E2E Pro Builder Beta",
      3900,
    );
  }
  emit("CREATOR_PRICE", creator);
  emit("PRO_PRICE", pro);
}

async function subscribe() {
  const clerk = arg("--clerk");
  const plan = arg("--plan");
  const price = arg("--price");
  const card = arg("--card");
  if (!clerk || !plan || !price) die("subscribe requires --clerk --plan --price");
  if (card !== "visa" && card !== "charge_fail") {
    die("--card must be visa or charge_fail");
  }

  const token = card === "charge_fail" ? "tok_chargeCustomerFail" : "tok_visa";
  const customer = await stripe.customers.create({
    email: `${clerk}@example.com`,
    name: clerk,
    metadata: { clerk_id: clerk, e2e: "stripe-webhook" },
  });
  if (customer.livemode) die("refusing a live-mode customer");

  const paymentMethod = await stripe.paymentMethods.create({
    type: "card",
    card: { token },
  });
  await stripe.paymentMethods.attach(paymentMethod.id, { customer: customer.id });
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: paymentMethod.id },
  });

  let subscription;
  try {
    subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price }],
      default_payment_method: paymentMethod.id,
      metadata: {
        clerk_id: clerk,
        plan_id: plan,
        product_type: "plan",
      },
      payment_behavior:
        card === "charge_fail" ? "allow_incomplete" : "error_if_incomplete",
      expand: ["latest_invoice"],
    });
  } catch (err) {
    const listed = await stripe.subscriptions.list({
      customer: customer.id,
      status: "all",
      limit: 5,
    });
    subscription = listed.data[0];
    if (!subscription) {
      die(err instanceof Error ? err.message : "subscription create failed");
    }
    process.stderr.write(
      `stripe-e2e-driver: subscription create returned an error; using ${subscription.id}\n`,
    );
  }
  if (subscription.livemode) die("refusing a live-mode subscription");

  const invoice = subscription.latest_invoice;
  const invoiceId = typeof invoice === "string" ? invoice : invoice?.id || "";

  emit("CUSTOMER", customer.id);
  emit("SUBSCRIPTION", subscription.id);
  emit("INVOICE", invoiceId);

  const created = await findEvent(
    "customer.subscription.created",
    (event) => event.data?.object?.id === subscription.id,
    45000,
  );
  emit("SUBSCRIPTION_CREATED_EVENT", created?.id || "");

  if (invoiceId && card !== "charge_fail") {
    const paid = await findEvent(
      "invoice.paid",
      (event) => event.data?.object?.id === invoiceId,
      45000,
    );
    emit("INVOICE_PAID_EVENT", paid?.id || "");
  }
  if (card === "charge_fail") {
    const failed = await findEvent(
      "invoice.payment_failed",
      (event) =>
        event.data?.object?.id === invoiceId ||
        subscriptionIdFromInvoice(event.data?.object) === subscription.id,
      45000,
    );
    emit("INVOICE_FAILED_EVENT", failed?.id || "");
  }
}

async function cancel() {
  const id = arg("--subscription");
  if (!id) die("cancel requires --subscription");
  let status = "";
  try {
    const subscription = await stripe.subscriptions.cancel(id);
    if (subscription.livemode) die("refusing a live-mode subscription");
    status = subscription.status || "";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/canceled|cancelled/i.test(message)) die(message);
    status = "canceled";
  }
  const deleted = await findEvent(
    "customer.subscription.deleted",
    (event) => event.data?.object?.id === id,
    45000,
  );
  emit("STATUS", status);
  emit("SUBSCRIPTION", id);
  emit("DELETED_EVENT", deleted?.id || "");
}

function webhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || "";
  if (!secret.startsWith("whsec_")) {
    die("STRIPE_WEBHOOK_SECRET must be the whsec_ value printed by stripe listen");
  }
  return secret;
}

async function postJson(url, payload, header, bodyFile) {
  const body = JSON.stringify(payload);
  const headers = { "Content-Type": "application/json" };
  if (header) headers["stripe-signature"] = header;
  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(60000),
  });
  const text = await response.text();
  if (bodyFile) fs.writeFileSync(bodyFile, text);
  emit("HTTP_STATUS", String(response.status));
  emit("EVENT_ID", payload.id || "");
  process.stderr.write(`stripe-e2e-driver: POST ${url} -> ${response.status}\n`);
}

async function post() {
  const kind = arg("--kind");
  const url = arg("--url");
  const bodyFile = arg("--body-file");
  const run = arg("--run") || "run";
  assertLocalWebhook(url);

  if (kind === "missing-signature" || kind === "invalid-signature") {
    const payload = {
      id: `evt_e2e_${kind === "missing-signature" ? "missing" : "bad"}_${run}`,
      object: "event",
      api_version: API_VERSION,
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      type: "checkout.session.expired",
      data: { object: { id: `cs_e2e_${run}`, object: "checkout.session" } },
    };
    const header =
      kind === "invalid-signature" ? "t=1,v1=deadbeefdeadbeef" : "";
    await postJson(url, payload, header, bodyFile);
    return;
  }

  const secret = webhookSecret();

  if (kind === "valid-noop") {
    const payload = {
      id: `evt_e2e_ok_${run}`,
      object: "event",
      api_version: API_VERSION,
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      type: "checkout.session.expired",
      data: {
        object: {
          id: `cs_e2e_ok_${run}`,
          object: "checkout.session",
          metadata: { product_type: "plan" },
        },
      },
    };
    const header = Stripe.webhooks.generateTestHeaderString({
      payload: JSON.stringify(payload),
      secret,
    });
    await postJson(url, payload, header, bodyFile);
    return;
  }

  if (kind === "credit-pack-missing") {
    const clerk = arg("--clerk");
    if (!clerk) die("credit-pack-missing requires --clerk");
    const payload = {
      id: `evt_e2e_pack_${run}`,
      object: "event",
      api_version: API_VERSION,
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_e2e_pack_${run}`,
          object: "checkout.session",
          mode: "payment",
          payment_status: "paid",
          amount_total: 500,
          currency: "usd",
          metadata: {
            clerk_id: clerk,
            coin_amount: "1500",
            product_type: "credit_pack",
          },
        },
      },
    };
    const header = Stripe.webhooks.generateTestHeaderString({
      payload: JSON.stringify(payload),
      secret,
    });
    await postJson(url, payload, header, bodyFile);
    return;
  }

  if (kind === "duplicate-invoice") {
    const sourceId = arg("--source-event");
    if (!sourceId) die("duplicate-invoice requires --source-event");
    const source = await stripe.events.retrieve(sourceId);
    if (source.livemode) die("refusing to copy a live-mode event");
    if (source.type !== "invoice.paid") {
      die(`source event ${sourceId} is ${source.type}, expected invoice.paid`);
    }
    const clone = JSON.parse(JSON.stringify(source));
    clone.id = `evt_e2e_dup_${run}`;
    clone.livemode = false;
    const payload = JSON.stringify(clone);
    const header = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret,
    });
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": header,
      },
      body: payload,
      signal: AbortSignal.timeout(60000),
    });
    const text = await response.text();
    if (bodyFile) fs.writeFileSync(bodyFile, text);
    emit("HTTP_STATUS", String(response.status));
    emit("EVENT_ID", clone.id);
    return;
  }

  die(`unknown --kind ${kind || "(missing)"}`);
}

async function createPackCharge() {
  const clerk = arg("--clerk");
  const amount = Number(arg("--amount") || "1000");
  const coins = arg("--coins") || "4000";
  if (!clerk || !Number.isFinite(amount) || amount < 1) {
    die("create-pack-charge requires --clerk and --amount");
  }
  const customer = await stripe.customers.create({
    email: `${clerk}@example.com`,
    metadata: { clerk_id: clerk, e2e: "stripe-webhook" },
  });
  if (customer.livemode) die("refusing a live-mode customer");
  const paymentMethod = await stripe.paymentMethods.create({
    type: "card",
    card: { token: "tok_visa" },
  });
  await stripe.paymentMethods.attach(paymentMethod.id, { customer: customer.id });
  const intent = await stripe.paymentIntents.create({
    amount,
    currency: "usd",
    customer: customer.id,
    payment_method: paymentMethod.id,
    confirm: true,
    off_session: true,
    metadata: {
      clerk_id: clerk,
      product_type: "credit_pack",
      coin_amount: String(coins),
    },
  });
  if (intent.livemode) die("refusing a live-mode payment");
  if (intent.status !== "succeeded") {
    die(`payment intent ${intent.id} status ${intent.status}`);
  }
  const chargeId =
    typeof intent.latest_charge === "string"
      ? intent.latest_charge
      : intent.latest_charge?.id || "";
  if (!chargeId) die("payment intent has no charge");
  emit("CUSTOMER", customer.id);
  emit("PAYMENT_INTENT", intent.id);
  emit("CHARGE", chargeId);
}

async function refundPart() {
  const charge = arg("--charge");
  const amount = Number(arg("--amount") || "");
  if (!charge || !Number.isFinite(amount) || amount < 1) {
    die("refund-part requires --charge and --amount");
  }
  const refund = await stripe.refunds.create({ charge, amount });
  if (refund.livemode) die("refusing a live-mode refund");
  // Basil charge objects omit refunds.data. Match the charge.refunded
  // snapshot by the cumulative amount_refunded after this refund.
  const updated = await stripe.charges.retrieve(charge);
  if (updated.livemode) die("refusing a live-mode charge");
  const expectedRefunded = updated.amount_refunded;
  emit("REFUND", refund.id);
  emit("CHARGE", charge);
  emit("AMOUNT_REFUNDED", String(expectedRefunded));
  const event = await findEvent(
    "charge.refunded",
    (candidate) => {
      const object = candidate.data?.object;
      if (!object || object.id !== charge) return false;
      if (candidate.created + 10 < refund.created) return false;
      return object.amount_refunded === expectedRefunded;
    },
    45000,
  );
  if (!event) {
    die(`charge.refunded for ${charge} amount_refunded=${expectedRefunded} was not found`);
  }
  emit("REFUND_EVENT", event.id);
}

const command = process.argv[2] || "";
const commands = {
  "ensure-prices": ensurePrices,
  subscribe,
  cancel,
  post,
  "create-pack-charge": createPackCharge,
  "refund-part": refundPart,
};

if (!commands[command]) {
  die("usage: ensure-prices | subscribe | cancel | post | create-pack-charge | refund-part");
}

commands[command]().catch((err) => {
  die(err instanceof Error ? err.message : String(err));
});
