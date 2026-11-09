// Run: node tests/model.test.js
const assert = require("assert"), fs = require("fs");
globalThis.window = globalThis;
require("../public/model.js");
const D = JSON.parse(fs.readFileSync(__dirname + "/../public/data.json", "utf8"));

const P = Model.plan(D, {});
assert.strictEqual(P.fc[0].ym, "2026-11", "forecast starts the month after the last recorded month");
assert.strictEqual(P.fc[P.fc.length - 1].ym, "2027-09", "forecast ends at contract term end");
assert.strictEqual(P.fc.length, 11);
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
assert.strictEqual(sum(D.monthly, (m) => m.ordered_gallons), D.summary.ordered_gallons, "monthly gallons add to summary");
assert.strictEqual(D.orders.length, D.summary.orders_count);

const up = Model.plan(D, { volAdj: 10, priceShock: 20 });
assert(Math.abs(up.fcGal / P.fcGal - 1.1) < 1e-9, "+10% volume scales gallons");
assert(Math.abs(up.fcFuel / P.fcFuel - 1.1 * 1.2) < 1e-9, "volume and price compound");
assert.strictEqual(Model.plan(D, { budget: 1 }).overMonths, 11, "a $1 cap flags every month");
assert.strictEqual(Model.plan(D, { budget: 0 }).overMonths, 0, "no cap flags nothing");

const bands = Model.matchBands(D.orders);
assert.strictEqual(sum(bands, (b) => b.value), D.orders.length, "every order lands in one band");
assert.strictEqual(bands[1].value, D.summary.unmatched_orders);
console.log("model tests passed");
