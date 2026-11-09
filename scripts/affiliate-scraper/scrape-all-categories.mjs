import fs from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = 'https://affiliate.watch';
const OUT_DIR = path.resolve('data/affiliate-watch');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchInitialPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = await res.text();
  const match = html.match(/data-page="([^"]+)"/);
  if (!match) throw new Error(`Could not find data-page in ${url}`);
  const raw = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return JSON.parse(raw);
}

async function fetchInertiaPage(url, version) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'X-Inertia': 'true',
      'X-Inertia-Version': version,
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'application/json'
    }
  });
  if (res.status === 409) {
    // Version mismatch, fallback to initial page
    return fetchInitialPage(url);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  console.log('1. Fetching categories index from affiliate.watch/categories...');
  const catData = await fetchInitialPage(`${BASE_URL}/categories`);
  const version = catData.version;
  const categories = catData.props.categories || [];
  console.log(`Found ${categories.length} categories on affiliate.watch.`);

  const categorySummary = [];
  const allAffiliatesMap = new Map(); // slug -> affiliate object
  const categoryToAffiliates = {};

  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    console.log(`[${i + 1}/${categories.length}] Scraping category: ${cat.name} (${cat.slug})...`);
    
    let page = 1;
    let lastPage = 1;
    const catAffiliates = [];

    while (page <= lastPage) {
      const pageUrl = `${BASE_URL}/category/${cat.slug}?page=${page}`;
      try {
        let pageData;
        if (page === 1) {
          pageData = await fetchInitialPage(pageUrl);
        } else {
          pageData = await fetchInertiaPage(pageUrl, version);
        }

        const affProp = pageData.props.affiliates;
        lastPage = affProp.last_page || 1;
        const items = affProp.data || [];
        
        for (const item of items) {
          catAffiliates.push(item);
          if (!allAffiliatesMap.has(item.slug)) {
            allAffiliatesMap.set(item.slug, {
              ...item,
              categoriesList: [cat.name]
            });
          } else {
            const existing = allAffiliatesMap.get(item.slug);
            if (!existing.categoriesList.includes(cat.name)) {
              existing.categoriesList.push(cat.name);
            }
          }
        }
        console.log(`   Page ${page}/${lastPage}: got ${items.length} items (Total in category: ${catAffiliates.length})`);
        page++;
        await sleep(150); // Be polite
      } catch (err) {
        console.error(`   Error fetching ${pageUrl}:`, err.message);
        break;
      }
    }

    categorySummary.push({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      count: catAffiliates.length,
      teaser: cat.teaser,
      description: cat.description
    });

    categoryToAffiliates[cat.slug] = catAffiliates;
    await sleep(200);
  }

  // Save raw data
  console.log(`Total unique affiliate programs collected: ${allAffiliatesMap.size}`);
  await fs.writeFile(
    path.join(OUT_DIR, 'categories-summary.json'),
    JSON.stringify(categorySummary, null, 2),
    'utf8'
  );
  await fs.writeFile(
    path.join(OUT_DIR, 'category-to-affiliates.json'),
    JSON.stringify(categoryToAffiliates, null, 2),
    'utf8'
  );
  await fs.writeFile(
    path.join(OUT_DIR, 'unique-affiliates.json'),
    JSON.stringify(Array.from(allAffiliatesMap.values()), null, 2),
    'utf8'
  );

  console.log('✓ All categories and programs saved to data/affiliate-watch/');
}

main().catch(err => {
  console.error('Fatal error in scraper:', err);
  process.exit(1);
});
