// Regression test for the reconciliation safety net's data source.
// Bug: listSuccessfulTransactions queried /transactions with no date range, so
// Flutterwave returned a near-empty default window and the daily reconcile saw
// "0 checked" — silently missing every webhook-dropped payment. It MUST send an
// explicit from/to range.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlutterwaveGateway } from './FlutterwaveGateway.js';

test('listSuccessfulTransactions sends an explicit from/to date range', async () => {
  const calls = [];
  const gw = new FlutterwaveGateway({ secretKey: 'test-key' });
  gw.client = {
    get: async (path, opts) => {
      calls.push({ path, params: opts?.params });
      return { data: { data: [{ id: '1', tx_ref: 'exambot-usr_a-weekly-1', amount: 500 }],
                       meta: { page_info: { total_pages: 1 } } } };
    },
  };

  const txns = await gw.listSuccessfulTransactions();

  assert.equal(txns.length, 1);
  assert.equal(calls[0].path, '/transactions');
  assert.equal(calls[0].params.status, 'successful');
  assert.ok(calls[0].params.from, 'from date must be set');
  assert.ok(calls[0].params.to, 'to date must be set');
  assert.match(calls[0].params.from, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(calls[0].params.to, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(calls[0].params.from < calls[0].params.to, 'from must precede to');
});

test('listSuccessfulTransactions paginates and stops at total_pages', async () => {
  let page = 0;
  const gw = new FlutterwaveGateway({ secretKey: 'test-key' });
  gw.client = {
    get: async () => {
      page += 1;
      return { data: { data: [{ id: String(page), tx_ref: `exambot-x-weekly-${page}`, amount: 500 }],
                       meta: { page_info: { total_pages: 2 } } } };
    },
  };
  const txns = await gw.listSuccessfulTransactions();
  assert.equal(txns.length, 2); // two pages then stop
});
