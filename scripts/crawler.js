const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const OUTPUT_PATH = path.join(__dirname, "../data/properties.json");
const MAX_PAGES = parseInt(process.env.MAX_PAGES || "10");
const DELAY_MS = 2000;

async function main() {
  console.log(`[${new Date().toISOString()}] Crawler started`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "ja-JP",
  });
  const page = await context.newPage();
  const allProperties = [];

  try {
    for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
      const url = pageNum === 1
        ? "https://www.kenbiya.com/pp0/"
        : `https://www.kenbiya.com/pp0/n-${pageNum}/`;

      console.log(`Fetching page ${pageNum}: ${url}`);
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(2000);

      const properties = await page.evaluate(() => {
        const results = [];
        const items = document.querySelectorAll(".prop_block");
        items.forEach((el) => {
          const get = (sel) => {
            const found = el.querySelector(sel);
            return found ? found.textContent.trim().replace(/\s+/g, " ") : "";
          };
          const getHref = () => {
            const a = el.querySelector("a");
            return a ? (a.href || a.getAttribute("href") || "") : "";
          };
          const name      = get(".name");
          const price     = get(".price");
          const yieldVal  = get(".yield");
          const location  = get(".trafficInfo") || get(".main");
          const spec      = get(".spec");
          const cate      = get(".cate_icon");
          const href      = getHref();
          const priceMatch = price.match(/([\d,]+)\s*万/);
          const priceRaw   = priceMatch ? parseInt(priceMatch[1].replace(/,/g, "")) : 0;
          const yieldMatch = yieldVal.match(/([\d.]+)\s*%/);
          const yieldRaw   = yieldMatch ? parseFloat(yieldMatch[1]) : 0;
          const ageMatch   = spec.match(/築(\d+)年/);
          const buildingAgeRaw = ageMatch ? parseInt(ageMatch[1]) : 0;
          const idMatch = href.match(/\/(\d+)\/?$/);
          const id = idMatch ? idMatch[1] : String(Math.random()).slice(2, 10);
          if (name || price) {
            results.push({
              id, name, price, priceRaw,
              type: cate, prefecture: "", location,
              yield: yieldVal, yieldRaw,
              buildingAge: ageMatch ? `築${ageMatch[1]}年` : "",
              buildingAgeRaw, area: spec,
              url: href.startsWith("http") ? href : "https://www.kenbiya.com" + href,
              crawledAt: new Date().toISOString(),
            });
          }
        });
        return results;
      });

      console.log(`  Found ${properties.length} properties`);
      if (properties.length === 0) break;
      allProperties.push(...properties);
      if (pageNum < MAX_PAGES) await new Promise(r => setTimeout(r, DELAY_MS));
    }
  } catch (err) {
    console.error("Crawl error:", err.message);
  } finally {
    await browser.close();
  }

  let existing = [];
  if (fs.existsSync(OUTPUT_PATH)) {
    try {
      existing = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8")).properties || [];
    } catch {}
  }
  const map = new Map(existing.map(p => [p.id, p]));
  allProperties.forEach(p => map.set(p.id, p));
  const merged = Array.from(map.values());
  const output = {
    lastUpdated: new Date().toISOString(),
    totalCount: merged.length,
    properties: merged,
  };
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf8");
  console.log(`Saved ${merged.length} properties`);
}

main().catch(err => { console.error(err); process.exit(1); });
