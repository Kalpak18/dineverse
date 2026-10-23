// Preloaded into the API server under test (node -r). Replaces the razorpay
// SDK with an in-memory fake and appends every call to RZP_LOG so tests can
// assert what the server asked Razorpay to do.
const Module = require('module');
const fs = require('fs');

const LOG = process.env.RZP_LOG;
const log = (entry) => fs.appendFileSync(LOG, JSON.stringify(entry) + '\n');
const orders = {};
let seq = 0;

class FakeRazorpay {
  constructor() {
    this.orders = {
      create: async (o) => {
        const id = `order_${seq++}`;
        orders[id] = o;
        log({ call: 'orders.create', id, transfers: (o.transfers || []).length, notes: o.notes });
        return { id, ...o, status: 'created' };
      },
      fetch: async (id) => ({ id, status: 'created', ...orders[id] }),
    };
    this.payments = {
      // pay_N always settles order_N in full
      fetch: async (id) => {
        const orderId = id.replace('pay_', 'order_');
        return { id, status: 'captured', amount: orders[orderId]?.amount, order_id: orderId };
      },
      transfer: async (id) => { log({ call: 'payments.transfer', id }); return { items: [{ id: 'trf_manual' }] }; },
      fetchTransfer: async (id) => {
        const order = orders[id.replace('pay_', 'order_')];
        return { items: order?.transfers?.length ? [{ id: `trf_${id}` }] : [] };
      },
      refund: async (id, opts) => {
        log({ call: 'payments.refund', id, amount: opts.amount, reverse_all: opts.reverse_all || 0 });
        return { id: `rfnd_${id}` };
      },
    };
  }
}

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'razorpay') return FakeRazorpay;
  return originalLoad.call(this, request, ...rest);
};
