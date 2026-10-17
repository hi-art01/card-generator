/* eslint-disable @typescript-eslint/no-require-imports */
const cheerio = require('cheerio');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function test() {
  const query = "space force debate arguments";
  const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }});
    const html = await res.text();
    const $ = cheerio.load(html);
    
    if (html.includes('Captcha')) {
      console.log('Captcha detected!');
    } else if (html.includes('rate limit')) {
      console.log('Rate limit detected!');
    }
    
    const results = [];
    $('.result__url').each((i, el) => {
      let link = $(el).attr('href');
      // DDG redirects look like //duckduckgo.com/l/?uddg=https://...
      if (link && link.includes('uddg=')) {
        const urlParams = new URLSearchParams(link.split('?')[1]);
        link = urlParams.get('uddg');
      }
      if (link) results.push(link);
    });
    
    console.log(results);
    if(results.length === 0) console.log(html.substring(0, 500));
  } catch(e) { console.error(e) }
}
test();
