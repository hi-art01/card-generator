import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import { getBannedUrlMessage, isBannedUrl } from '../../../lib/domainFilters';

export async function POST(req: Request) {
  try {
    const { url }: { url?: string } = await req.json();

    if (!url) {
      return NextResponse.json({ error: 'Missing url' }, { status: 400 });
    }

    if (isBannedUrl(url)) {
      return NextResponse.json({ error: getBannedUrlMessage(url) }, { status: 400 });
    }

    console.log(`Scraping full targeted URL: ${url}`);
    
    // 15 seconds timeout to allow large site downloads
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, signal: AbortSignal.timeout(15000) });
    
    if (!res.ok) {
        return NextResponse.json({ error: `Failed to fetch URL: ${res.statusText}` }, { status: 400 });
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    
    const pageTitle = $('title').text() || url;

    // Aggressively remove junk
    $('script, style, noscript, nav, header, footer, aside, .sidebar, .ad, img, svg, iframe').remove();
    
    let fullText = '';
    $('p, h1, h2, h3, h4, h5, h6, li').each((i, el) => {
      fullText += $(el).text().replace(/\s+/g, ' ').trim() + '\n\n';
    });

    if (!fullText.trim()) {
        fullText = $('body').text().replace(/\s+/g, ' ').trim();
    }

    return NextResponse.json({ text: fullText.trim(), title: pageTitle.trim() });
  } catch (error: unknown) {
    console.error(error);
    const message = error instanceof Error ? error.message : 'Unknown error occurred.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
