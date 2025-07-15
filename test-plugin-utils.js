// test-plugin-utils.js
// Test plugin API helpers: formatDate
require('module-alias/register');
// Directly import formatDate
const { formatDate, today } = require('./src/ts/lib/pluginHost.ts');

const input = '2025-07-15';
const formatted = formatDate(input, 'MMMM d, yyyy');
console.log('Formatted:', formatted);
// Test formatDate
if (formatted !== 'July 15, 2025') {
  console.error('TEST FAIL formatDate:', formatted);
  process.exit(1);
}
// Test today()
const td = today();
if (/^\d{4}-\d{2}-\d{2}$/.test(td)) {
  console.log('TEST PASS: today() format OK:', td);
  process.exit(0);
} else {
  console.error('TEST FAIL today():', td);
  process.exit(1);
}
