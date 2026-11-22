/* Voltaro storefront + payment gateway backend.
 * Serves the static site and creates/verifies Stripe Checkout sessions for
 * Alipay (支付宝) and WeChat Pay (微信支付). No third-party npm dependencies.
 *
 * Secrets are read from .env or process.env and never sent to the browser.
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const env = loadEnv(path.join(ROOT, '.env'));

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || env.STRIPE_WEBHOOK_SECRET || '';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog.json'), 'utf8'));
const EVENT_LOG = path.join(ROOT, 'payment-events.jsonl');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function loadEnv(file) {
  const out = {};
  try {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith('#')) continue;
      const i = s.indexOf('=');
      if (i < 0) continue;
      const key = s.slice(0, i).trim();
      let value = s.slice(i + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key) out[key] = value;
    }
  } catch (_) {
    /* no .env file is fine */
  }
  return out;
}

function fail(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, err) {
  const status = Number(err && err.status) || 500;
  const code = (err && err.code) || 'INTERNAL_ERROR';
  const message = status >= 500 ? 'Payment service is temporarily unavailable.' : err.message;
  if (status >= 500) console.error('[payment]', code, err && err.message);
  sendJson(res, status, { error: { code, message } });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 128000) {
        reject(fail(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

function parseJsonBody(raw) {
  try {
    const value = JSON.parse(raw || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('bad shape');
    return value;
  } catch (_) {
    throw fail(400, 'INVALID_JSON', 'Invalid request body.');
  }
}

function baseUrl(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return proto + '://' + host;
}

function priceCart(items) {
  if (!Array.isArray(items) || !items.length) {
    throw fail(400, 'EMPTY_CART', 'Your cart is empty.');
  }
  if (items.length > 30) {
    throw fail(400, 'TOO_MANY_ITEMS', 'Too many items in the cart.');
  }
  const lines = [];
  let subtotal = 0;
  for (const item of items) {
    const product = catalog.products.find((p) => p.id === String(item && item.id));
    if (!product) throw fail(400, 'UNKNOWN_PRODUCT', 'A product in your cart is no longer available.');
    const qty = Number(item.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
      throw fail(400, 'INVALID_QUANTITY', 'Invalid item quantity.');
    }
    subtotal += product.price * qty;
    lines.push({
      name: product.name,
      unit_amount: Math.round(product.price * 100),
      quantity: qty,
    });
  }
  const shipping = subtotal >= catalog.freeShippingThreshold ? 0 : catalog.shippingFlat;
  if (shipping > 0) {
    lines.push({ name: 'Shipping (EU)', unit_amount: Math.round(shipping * 100), quantity: 1 });
  }
  return {
    lines,
    subtotal: Math.round(subtotal * 100) / 100,
    shipping,
    total: Math.round((subtotal + shipping) * 100) / 100,
  };
}

function stripeRequest(method, endpoint, form) {
  return new Promise((resolve, reject) => {
    if (!STRIPE_SECRET_KEY) {
      reject(fail(503, 'PAYMENT_NOT_CONFIGURED', 'Payment is not configured yet. Please try again later.'));
      return;
    }
    const body = form ? new URLSearchParams(form).toString() : '';
    const request = https.request(
      {
        hostname: 'api.stripe.com',
        path: '/v1' + endpoint,
        method,
        headers: {
          Authorization: 'Bearer ' + STRIPE_SECRET_KEY,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 20000,
      },
      (response) => {
        let raw = '';
        response.on('data', (chunk) => { raw += chunk; });
        response.on('end', () => {
          let parsed = {};
          try { parsed = JSON.parse(raw); } catch (_) { /* keep empty */ }
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve(parsed);
          } else {
            const message = (parsed.error && parsed.error.message) || 'Payment gateway refused the request.';
            reject(fail(502, (parsed.error && parsed.error.code) || 'STRIPE_ERROR', message));
          }
        });
      }
    );
    request.on('timeout', () => request.destroy(fail(504, 'PAYMENT_TIMEOUT', 'Payment gateway timed out.')));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

async function createCheckoutSession(req, res, body) {
  const orderNo = String(body.orderNo || '');
  if (!/^VT-[A-Z0-9-]{6,40}$/.test(orderNo)) {
    throw fail(400, 'INVALID_ORDER', 'Invalid order number.');
  }
  const method = body.method === 'wechat_pay' ? 'wechat_pay' : body.method === 'alipay' ? 'alipay' : null;
  if (!method) throw fail(400, 'INVALID_METHOD', 'Choose Alipay or WeChat Pay.');

  const priced = priceCart(body.items);
  const origin = baseUrl(req);
  const form = {
    mode: 'payment',
    'payment_method_types[0]': method,
    client_reference_id: orderNo,
    'metadata[order_no]': orderNo,
    'metadata[payment_method]': method,
    success_url:
      origin + '/payment-success.html?session_id={CHECKOUT_SESSION_ID}&order_no=' + encodeURIComponent(orderNo),
    cancel_url: origin + '/checkout.html?payment=cancelled&order_no=' + encodeURIComponent(orderNo),
  };
  priced.lines.forEach((line, i) => {
    form[`line_items[${i}][price_data][currency]`] = 'eur';
    form[`line_items[${i}][price_data][product_data][name]`] = line.name;
    form[`line_items[${i}][price_data][unit_amount]`] = String(line.unit_amount);
    form[`line_items[${i}][quantity]`] = String(line.quantity);
  });
  if (method === 'wechat_pay') {
    form['payment_method_options[wechat_pay][client]'] = 'web';
  }
  const email = String(body.email || '').trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) form.customer_email = email;

  const session = await stripeRequest('POST', '/checkout/sessions', form);
  if (!session.url) throw fail(502, 'STRIPE_ERROR', 'Payment session could not be created.');
  sendJson(res, 200, {
    url: session.url,
    sessionId: session.id,
    amount: priced.total,
    currency: 'EUR',
    method,
  });
}

async function checkoutStatus(res, query) {
  const sessionId = String(query.session_id || '');
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
    throw fail(400, 'INVALID_SESSION', 'Invalid payment session.');
  }
  const session = await stripeRequest('GET', '/checkout/sessions/' + encodeURIComponent(sessionId));
  const expectedOrder = String(query.order_no || '');
  const orderNo = session.client_reference_id || (session.metadata && session.metadata.order_no) || '';
  if (expectedOrder && orderNo && expectedOrder !== orderNo) {
    throw fail(403, 'ORDER_MISMATCH', 'Payment does not belong to this order.');
  }
  sendJson(res, 200, {
    paid: session.payment_status === 'paid',
    paymentStatus: session.payment_status,
    status: session.status,
    orderNo,
    amountTotal: Number(session.amount_total || 0) / 100,
    currency: String(session.currency || 'eur').toUpperCase(),
    paymentIntent: session.payment_intent || null,
    method: (session.metadata && session.metadata.payment_method) || null,
  });
}

function verifyStripeSignature(payload, header) {
  if (!STRIPE_WEBHOOK_SECRET || !header) return null;
  const values = {};
  for (const part of String(header).split(',')) {
    const i = part.indexOf('=');
    if (i > 0) values[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  const timestamp = values.t;
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return null;
  const expected = crypto
    .createHmac('sha256', STRIPE_WEBHOOK_SECRET)
    .update(timestamp + '.' + payload)
    .digest('hex');
  const signatures = String(values.v1 || '').split(/\s+/).filter(Boolean);
  for (const signature of signatures) {
    if (signature.length !== expected.length) continue;
    if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return true;
  }
  return null;
}

async function handleWebhook(req, res) {
  const raw = await readBody(req);
  if (!verifyStripeSignature(raw, req.headers['stripe-signature'])) {
    throw fail(400, 'INVALID_SIGNATURE', 'Invalid webhook signature.');
  }
  let event;
  try { event = JSON.parse(raw); } catch (_) { throw fail(400, 'INVALID_EVENT', 'Invalid webhook event.'); }
  const obj = (event.data && event.data.object) || {};
  const record = {
    type: event.type,
    orderNo: obj.client_reference_id || (obj.metadata && obj.metadata.order_no) || null,
    sessionId: obj.id && String(obj.id).startsWith('cs_') ? obj.id : null,
    paid: obj.payment_status === 'paid' || event.type === 'checkout.session.async_payment_succeeded',
    receivedAt: new Date().toISOString(),
  };
  fs.appendFile(EVENT_LOG, JSON.stringify(record) + '\n', () => {});
  sendJson(res, 200, { received: true });
}

function serveStatic(req, res, pathname) {
  let relative = decodeURIComponent(pathname);
  if (relative === '/' || relative === '') relative = '/index.html';
  const resolved = path.resolve(ROOT, '.' + relative);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.stat(resolved, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(resolved).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if (pathname === '/api/pay/config' && req.method === 'GET') {
      sendJson(res, 200, {
        configured: Boolean(STRIPE_SECRET_KEY),
        methods: [
          { id: 'alipay', label: '支付宝 Alipay' },
          { id: 'wechat_pay', label: '微信支付 WeChat Pay' },
        ],
        currency: 'EUR',
      });
      return;
    }

    if (pathname === '/api/pay/create' && req.method === 'POST') {
      await createCheckoutSession(req, res, parseJsonBody(await readBody(req)));
      return;
    }

    if (pathname === '/api/pay/status' && req.method === 'GET') {
      await checkoutStatus(res, Object.fromEntries(url.searchParams));
      return;
    }

    if (pathname === '/api/webhooks/stripe' && req.method === 'POST') {
      await handleWebhook(req, res);
      return;
    }

    if (pathname.startsWith('/api/')) {
      throw fail(404, 'NOT_FOUND', 'Unknown API endpoint.');
    }

    serveStatic(req, res, pathname);
  } catch (err) {
    sendError(res, err);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Voltaro storefront listening on port ' + PORT + ' (payment ' + (STRIPE_SECRET_KEY ? 'configured' : 'not configured') + ')');
});
