// test-plugin-host.js
// Simple test for pluginHost: ensure onAppStart handlers run
require('ts-node/register');
const { loadPlugins, onAppStart } = require('./src/ts/lib/pluginHost.ts');

// Mock API
let handlerCalled = false;
let createCalled = false;
const api = {
  query: async () => ({ records: [
    {
      id: 'plugin1',
      relations: { Script: [{ value:
        `plugin.onAppStart(() => {
           handlerCalled = true;
           plugin.create({ type: 'Test', data: { ok: true } });
         });`
      }] }
    }
  ]}),
  logError: (e) => console.error('plugin error:', e),
  create: (obj) => { createCalled = true; console.log('api.create called', obj); }
};

// Register our own handler to verify execution
onAppStart(() => { handlerCalled = true; });

(async () => {
  await loadPlugins(api);
  if (handlerCalled && createCalled) {
    console.log('TEST PASS: plugin->api communication succeeded.');
    process.exit(0);
  } else {
    console.error('TEST FAIL: handlerCalled=', handlerCalled, 'createCalled=', createCalled);
    process.exit(1);
  }
})();
