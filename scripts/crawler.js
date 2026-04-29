    locale: "ja-JP",
  });
  const page = await context.newPage();

  const allProperties = [];

  try {
    for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
      const url = buildUrl(pageNum);
      console.log(`Fetching page ${pageNum}: ${url}`);

      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(1500);

      const properties = await extractProperties(page);
      console.log(`  Found ${properties.length} properties`);

      if (properties.length === 0) break;
      allProperties.push(...properties);

      const hasNext = await page.$(".pager_next a, .pagination .next:not(.disabled)");
      if (!hasNext) break;

      if (pageNum < MAX_PAGES) await delay(DELAY_MS);
    }
  } catch (err) {
    console.error("Crawl error:", err.message);
  } finally {
    await browser.close();
  }

  // 既存データとマージ（重複除去）
  let existing = [];
  if (fs.existsSync(OUTPUT_PATH)) {
    try {
      existing = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8")).properties || [];
    } catch {}
  }

  const merged = mergeProperties(existing, allProperties);

  const output = {
    lastUpdated: new Date().toISOString(),
    totalCount: merged.length,
    properties: merged,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf8");
  console.log(`Saved ${merged.length} properties to ${OUTPUT_PATH}`);
}

function buildUrl(pageNum) {
  // 収益物件一覧（全国・全種別）
  const base = "https://www.kenbiya.com/ar/cl/";
  return pageNum === 1 ? base : `${base}?pg=${pageNum}`;
}

async function extractProperties(page) {
  return await page.evaluate(() => {
    const results = [];

    // 健美家の物件リストセレクタ（複数パターンに対応）
    const containers = document.querySelectorAll(
      ".property_list_wrap .property_item, " +
      ".bukken_list > li, " +
      ".list_item, " +
      "[class*='property_list'] > li, " +
      "[class*='item_list'] > li"
    );

    containers.forEach((el) => {
      const get = (sels) => {
        for (const s of sels) {
          const found = el.querySelector(s);
          if (found?.textContent?.trim()) return found.textContent.trim().replace(/\s+/g, " ");
        }
        return "";
      };

      const getHref = (sels) => {
        for (const s of sels) {
          const a = el.querySelector(s);
          if (a?.href) return a.href;
        }
        const a = el.querySelector("a[href]");
        return a?.href || "";
      };

      const prop = {
        id: "",
        name: get([".property_name", ".item_name", "h3", "h2", ".bukken_name"]),
        price: get([".price", ".kakaku", "[class*='price']", ".item_price"]),
        priceRaw: 0,
        type: get([".property_type", ".shubetsu", "[class*='type']", ".kind"]),
        prefecture: get([".pref", ".prefecture", "[class*='pref']"]),
        location: get([".location", ".address", ".shozaichi", "[class*='address']"]),
        yield: get([".yield", ".rimawari", "[class*='yield']", "[class*='rimawari']"]),
        yieldRaw: 0,
        buildingAge: get([".building_age", ".chikunen", "[class*='age']", "[class*='chiku']"]),
        buildingAgeRaw: 0,
        area: get([".area", ".menseki", "[class*='area']", "[class*='menseki']"]),
        structure: get([".structure", ".kozo", "[class*='structure']", "[class*='kozo']"]),
        url: getHref(["a[href*='/ar/']", "a[href*='/pp/']", "h3 a", "a"]),
        crawledAt: new Date().toISOString(),
      };

      // URL から ID を抽出
      const idMatch = prop.url.match(/\/(\d+)\/?$/);
      prop.id = idMatch ? idMatch[1] : String(Math.random()).slice(2, 10);

      // 数値を抽出
      const priceMatch = prop.price.match(/([\d,]+)\s*万/);
      if (priceMatch) prop.priceRaw = parseInt(priceMatch[1].replace(/,/g, ""));

      const yieldMatch = prop.yield.match(/([\d.]+)\s*%/);
      if (yieldMatch) prop.yieldRaw = parseFloat(yieldMatch[1]);

      const ageMatch = prop.buildingAge.match(/(\d+)\s*年/);
      if (ageMatch) prop.buildingAgeRaw = parseInt(ageMatch[1]);

      if (prop.name || prop.price || prop.location) {
        results.push(prop);
      }
    });

    return results;
  });
}

function mergeProperties(existing, incoming) {
  const map = new Map(existing.map((p) => [p.id, p]));
  incoming.forEach((p) => map.set(p.id, p));
  return Array.from(map.values());
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

