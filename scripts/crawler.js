const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const DAILY_DIR = path.join(__dirname, "../data/daily");
const LATEST_PATH = path.join(__dirname, "../data/latest.json");
const MAX_PAGES = parseInt(process.env.MAX_PAGES || "700");
const DELAY_MS = parseInt(process.env.DELAY_MS || "1500");
const CONCURRENCY = parseInt(process.env.CONCURRENCY || "5");
const DETAIL_DELAY_MS = parseInt(process.env.DETAIL_DELAY_MS || "500");
const SKIP_DETAIL = process.env.SKIP_DETAIL === "true" || process.env.SKIP_DETAIL === "1";
const FORCE_REFRESH = process.env.FORCE_REFRESH === "true" || process.env.FORCE_REFRESH === "1";

function categorizeStructure(raw) {
  if (!raw) return null;
  const s = raw.replace(/\s/g, "");
  if (/SRC造/.test(s)) return "SRC造";
  if (/RC造|鉄筋コンクリート/.test(s)) return "RC造";
  if (/軽量鉄骨/.test(s)) return "軽量鉄骨造";
  if (/S造|鉄骨造|重量鉄骨/.test(s)) return "S造";
  if (/木造/.test(s)) return "木造";
  if (/鉄骨/.test(s)) return "S造";
  return "その他";
}

function jstDateStr() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}

const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
  "岐阜県", "静岡県", "愛知県", "三重県",
  "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県",
  "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

function parsePriceMan(text) {
  if (!text) return null;
  const t = text.replace(/\s+/g, "");
  const okuMatch = t.match(/([\d,]+)億/);
  const manMatch = t.match(/([\d,]+)万/);
  let total = 0;
  if (okuMatch) total += parseInt(okuMatch[1].replace(/,/g, ""), 10) * 10000;
  if (manMatch) total += parseInt(manMatch[1].replace(/,/g, ""), 10);
  return total > 0 ? total : null;
}

function postProcess(p) {
  let prefecture = "";
  for (const pref of PREFECTURES) {
    if (p.address && p.address.startsWith(pref)) {
      prefecture = pref;
      break;
    }
  }

  let trafficLine = "";
  let trafficStation = "";
  let trafficWalkMin = null;
  if (p.trafficRaw) {
    const walkMatch = p.trafficRaw.match(/歩(\d+)分/);
    if (walkMatch) trafficWalkMin = parseInt(walkMatch[1], 10);
    const cleaned = p.trafficRaw.replace(/歩\d+分.*$/, "").replace(/バス.*$/, "").trim();
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length >= 2 && /駅$/.test(parts[parts.length - 1])) {
      trafficStation = parts[parts.length - 1];
      trafficLine = parts.slice(0, -1).join(" ");
    } else {
      trafficLine = parts.join(" ");
    }
  }

  const priceMan = parsePriceMan(p.priceLabel);
  const yieldMatch = (p.yieldLabel || "").match(/([\d.]+)/);
  const yieldPct = yieldMatch ? parseFloat(yieldMatch[1]) : null;

  const buildingAreaMatch = (p.buildingAreaText || "").match(/([\d.]+)/);
  const buildingAreaM2 = buildingAreaMatch ? parseFloat(buildingAreaMatch[1]) : null;
  const landAreaMatch = (p.landAreaText || "").match(/([\d.]+)/);
  const landAreaM2 = landAreaMatch ? parseFloat(landAreaMatch[1]) : null;

  let builtYear = null;
  let builtMonth = null;
  let buildingAgeYears = null;
  const ymMatch = (p.builtYearMonth || "").match(/(\d+)年(\d+)月/);
  const yMatch = (p.builtYearMonth || "").match(/(\d+)年/);
  if (ymMatch) {
    builtYear = parseInt(ymMatch[1], 10);
    builtMonth = parseInt(ymMatch[2], 10);
  } else if (yMatch) {
    builtYear = parseInt(yMatch[1], 10);
  }
  if (builtYear) {
    buildingAgeYears = new Date().getFullYear() - builtYear;
  }

  const url = p.href.startsWith("http")
    ? p.href
    : (p.href ? "https://www.kenbiya.com" + p.href : "");

  return {
    id: p.id,
    name: p.name,
    type: p.type,
    prefecture,
    address: p.address,
    trafficLine,
    trafficStation,
    trafficWalkMin,
    trafficRaw: p.trafficRaw,
    priceLabel: p.priceLabel,
    priceMan,
    yieldPct,
    buildingAreaM2,
    landAreaM2,
    builtYearMonth: p.builtYearMonth,
    builtYear,
    builtMonth,
    buildingAgeYears,
    floorsLabel: p.floorsLabel,
    structure: null,
    structureRaw: null,
    broker: null,
    url,
    crawledAt: new Date().toISOString(),
  };
}

async function fetchDetails(context, properties) {
  if (SKIP_DETAIL) {
    console.log("SKIP_DETAIL=true: skipping detail fetch");
    return;
  }

  const cache = new Map();
  if (!FORCE_REFRESH && fs.existsSync(LATEST_PATH)) {
    try {
      const prev = JSON.parse(fs.readFileSync(LATEST_PATH, "utf8"));
      for (const p of prev.properties || []) {
        if (p.id && p.structureRaw) {
          cache.set(p.id, {
            structure: p.structure,
            structureRaw: p.structureRaw,
            broker: p.broker || null,
          });
        }
      }
    } catch (e) {
      console.log("Detail cache load failed:", e.message);
    }
  }
  console.log(`Detail cache loaded: ${cache.size} entries`);

  for (const p of properties) {
    const c = cache.get(p.id);
    if (c) {
      p.structure = c.structure;
      p.structureRaw = c.structureRaw;
      p.broker = c.broker;
    }
  }

  const targets = properties.filter((p) => p.id && p.url && (!p.structureRaw || !p.broker));
  console.log(`Detail fetch needed: ${targets.length} / ${properties.length}`);
  if (targets.length === 0) return;

  const queue = [...targets];
  let processed = 0;
  let consecutiveFailures = 0;
  let aborted = false;

  async function worker(workerId) {
    const page = await context.newPage();
    while (!aborted) {
      const target = queue.shift();
      if (!target) break;
      try {
        const resp = await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 30000 });
        if (resp && (resp.status() === 403 || resp.status() === 429)) {
          console.error(`[w${workerId}] HTTP ${resp.status()} for ${target.id}, aborting`);
          aborted = true;
          break;
        }
        const detail = await page.evaluate(() => {
          let structureRaw = null;
          for (const dt of document.querySelectorAll("dt")) {
            const label = dt.textContent.trim();
            if (label === "建物構造/階数" || label === "建物構造") {
              const dd = dt.nextElementSibling;
              if (dd && dd.tagName === "DD") {
                structureRaw = dd.textContent.trim().replace(/\s+/g, " ");
                break;
              }
            }
          }
          let broker = null;
          const text = document.body.innerText;
          const m = text.match(/取扱不動産会社\s*\n\s*([^\n]+)/);
          if (m) broker = m[1].trim();
          return { structureRaw, broker };
        });
        target.structureRaw = detail.structureRaw;
        target.structure = categorizeStructure(detail.structureRaw);
        target.broker = detail.broker;
        consecutiveFailures = 0;
      } catch (e) {
        consecutiveFailures++;
        console.error(`[w${workerId}] ${target.id} failed: ${e.message}`);
        if (consecutiveFailures >= 5) {
          console.error("Too many consecutive failures, aborting workers");
          aborted = true;
          break;
        }
      }
      processed++;
      if (processed % 100 === 0) {
        console.log(`Detail progress: ${processed} / ${targets.length}`);
      }
      await new Promise((r) => setTimeout(r, DETAIL_DELAY_MS));
    }
    await page.close().catch(() => {});
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));
  console.log(`Detail fetch done: ${processed} processed${aborted ? " (aborted)" : ""}`);
}

async function main() {
  console.log(`[${new Date().toISOString()}] Crawler started (MAX_PAGES=${MAX_PAGES}, DELAY_MS=${DELAY_MS}, CONCURRENCY=${CONCURRENCY})`);
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
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      } catch (e) {
        console.error(`  Page ${pageNum} navigation failed: ${e.message}`);
        continue;
      }
      await page.waitForTimeout(2000);

      const properties = await page.evaluate(() => {
        const results = [];
        const blocks = document.querySelectorAll("ul.prop_block");
        blocks.forEach((block) => {
          const checkbox = block.querySelector('input[name="ck_pp"]');
          const idRaw = checkbox ? (checkbox.value || "") : "";
          const idMatch = idRaw.match(/^(\d+)/);
          const id = idMatch ? idMatch[1] : "";

          const a = block.closest("a");
          const href = a ? (a.getAttribute("href") || "") : "";

          const cateIcon = block.querySelector("img.cate_icon");
          const cateAlt = cateIcon ? (cateIcon.getAttribute("alt") || "") : "";
          const type = cateAlt.replace(/^不動産投資の/, "");

          const mainItems = block.querySelectorAll("li.main > ul > li");
          const norm = (el) => el ? el.textContent.trim().replace(/\s+/g, " ") : "";
          const name = norm(mainItems[0]).replace(/^[○●◆◇☆★※]+/, "").trim();
          const address = norm(mainItems[1]);
          const trafficRaw = norm(mainItems[2]);

          const priceItems = block.querySelectorAll("li.price > ul > li");
          const priceLabel = priceItems[0] ? priceItems[0].textContent.replace(/\s+/g, "") : "";
          const yieldLabel = priceItems[1] ? priceItems[1].textContent.replace(/\s+/g, "") : "";

          const topLis = block.querySelectorAll(":scope > li");
          let buildingAreaText = "";
          let landAreaText = "";
          if (topLis[3]) {
            topLis[3].querySelectorAll("li").forEach((li) => {
              const t = li.textContent.trim();
              if (li.querySelector(".land") || /^土[:：]/.test(t)) landAreaText = t;
              else buildingAreaText = t;
            });
          }
          let builtYearMonth = "";
          let floorsLabel = "";
          if (topLis[4]) {
            const texts = Array.from(topLis[4].querySelectorAll("li"))
              .map((li) => li.textContent.trim())
              .filter((t) => t.length > 0);
            builtYearMonth = texts.find((t) => /\d+年/.test(t)) || "";
            floorsLabel = texts.find((t) => /階/.test(t)) || "";
          }

          if (id || name) {
            results.push({
              id, name, type, address, trafficRaw,
              priceLabel, yieldLabel,
              buildingAreaText, landAreaText,
              builtYearMonth, floorsLabel, href,
            });
          }
        });
        return results;
      });

      console.log(`  Found ${properties.length} properties`);
      if (properties.length === 0) break;
      allProperties.push(...properties.map(postProcess));
      if (pageNum < MAX_PAGES) await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  } catch (err) {
    console.error("Crawl error:", err.message);
  }

  await fetchDetails(context, allProperties);
  await browser.close();

  const dateStr = jstDateStr();
  const properties = allProperties
    .filter((p) => p && p.id)
    .map((p, i) => ({ no: i + 1, ...p }));

  const output = {
    date: dateStr,
    lastUpdated: new Date().toISOString(),
    totalCount: properties.length,
    properties,
  };
  const dailyPath = path.join(DAILY_DIR, `${dateStr}.json`);
  fs.mkdirSync(DAILY_DIR, { recursive: true });
  const json = JSON.stringify(output, null, 2);
  fs.writeFileSync(dailyPath, json, "utf8");
  fs.writeFileSync(LATEST_PATH, json, "utf8");
  console.log(`Saved ${properties.length} properties to ${dailyPath}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
