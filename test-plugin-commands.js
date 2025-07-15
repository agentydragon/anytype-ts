// test-plugin-commands.js
// Test plugin command registration and invocation
require('module-alias/register');
require('module-alias/register');
require('ts-node/register');
const { _invokeCommand, loadPlugins } = require('./src/ts/lib/pluginHost.ts');

// Simulate a Plugin object that registers a command
let createCalled = false;
const api = {
  query: async () => ({ records: [
    {
      id: 'plugin1',
      relations: { Script: [{ value:
        `plugin.registerCommand({
           id: 'ping',
           title: 'Ping',
           shortcut: 'Ctrl+P',
           handler: () => { plugin.create({ pinged: true }); }
         });`
      }] }
    }
  ]}),
  logError: e => console.error('plugin error:', e),
  create: (obj) => { if (obj.pinged) createCalled = true; }
};

(async () => {
  await loadPlugins(api);
  // Invoke registered command
  _invokeCommand('ping');
  if (createCalled) {
    console.log('TEST PASS: plugin->command communication succeeded');
    process.exit(0);
  } else {
    console.error('TEST FAIL: createCalled=', createCalled);
    process.exit(1);
  }
})();
