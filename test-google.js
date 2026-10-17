/* eslint-disable @typescript-eslint/no-require-imports */
const google = require('googlethis');

async function test() {
  try {
    const res = await google.search('space force debate arguments', { page: 0, safe: false, parse_ads: false });
    console.log(JSON.stringify(res.results.slice(0, 2), null, 2));
  } catch (e) {
    console.error('Error:', e);
  }
}
test();
