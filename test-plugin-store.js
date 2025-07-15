// test-plugin-store.js
// Test savePlugin create and update logic
require('module-alias/register');
require('ts-node/register');
const { savePlugin } = require('./src/ts/lib/pluginHost.ts');

// In-memory store for plugin objects
const store = [];
let idCounter = 1;
const api = {
  query: async ({ type, filter }) => {
    const name = filter[0].value;
    // Match on Name relation array
    const recs = store
      .filter(o => Array.isArray(o.Name) && o.Name[0] === name)
      .map(o => ({ id: o.id }));
    return { records: recs };
  },
  create: async ({ type, relations }) => {
    const id = `plugin-${idCounter++}`;
    store.push({ id, ...relations });
    return { id };
  },
  update: async ({ id, relations }) => {
    const obj = store.find(o => o.id === id);
    Object.assign(obj, relations);
    return { id };
  },
  logError: e => console.error('error:', e)
};

(async () => {
  // Create new plugin
  const id1 = await savePlugin(api, 'plugA', 'codeA', true);
  if (id1 && store.length === 1 && store[0].Script[0] === 'codeA' && store[0].Enabled[0] === true) {
    console.log('CREATE PASS');
  } else {
    console.error('CREATE FAIL', store);
    process.exit(1);
  }
  // Update existing plugin
  const id2 = await savePlugin(api, 'plugA', 'codeB', false);
  if (id2 === id1 && store.length === 1 && store[0].Script[0] === 'codeB' && store[0].Enabled[0] === false) {
    console.log('UPDATE PASS');
    process.exit(0);
  } else {
    console.error('UPDATE FAIL', store);
    process.exit(1);
  }
})();
