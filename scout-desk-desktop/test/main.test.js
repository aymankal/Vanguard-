const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// main.js needs Electron only at runtime; stub it so the link rules can be tested in plain Node.
const load = Module._load;
Module._load = (req, ...rest) => (req === 'electron'
  ? { app: { requestSingleInstanceLock: () => true, on() {}, whenReady: () => new Promise(() => {}) } }
  : load(req, ...rest));
const { isInApp } = require('../main');
Module._load = load;

test('desk and Supabase pages stay in the app', () => {
  assert.ok(isInApp('https://aymankal.github.io/Vanguard-/scout-desk/'));
  assert.ok(isInApp('https://aymankal.github.io/Vanguard-/scout-desk/#pipeline'));
  assert.ok(isInApp('https://aymankal.github.io/Vanguard-/scout-desk'));
  assert.ok(isInApp('https://awmeixsvltzdspwnamyf.supabase.co/auth/v1/verify?token=x'));
});

test('everything else opens in the browser', () => {
  assert.ok(!isInApp('https://www.linkedin.com/in/someone'));
  assert.ok(!isInApp('https://aymankal.github.io/Vanguard-/client/'));
  assert.ok(!isInApp('https://aymankal.github.io/Vanguard-/scout-desk-evil/'));
  assert.ok(!isInApp('http://aymankal.github.io/Vanguard-/scout-desk/'));
  assert.ok(!isInApp('https://aymankal.github.io.evil.com/Vanguard-/scout-desk/'));
  assert.ok(!isInApp('not a url'));
});
