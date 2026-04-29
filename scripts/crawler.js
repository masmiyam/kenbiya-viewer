const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const OUTPUT_PATH = path.join(__dirname, "../data/properties.json");
const MAX_PAGES = parseInt(process.env.MAX_PAGES || "700");
const DELAY_MS = parseInt(process.env.DELAY_MS || "1500");

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
    url,
    crawledAt: new Date().toISOString(),
  };
}

async function main() {
  console.log(`[${new Date().toISOString()}] Crawler started (MAX_PAGES=${MAX_PAGES}, DELAY_MS=${DELAY_MS})`);
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
  } finally {
    await browser.close();
  }

  let existing = [];
  if (fs.existsSync(OUTPUT_PATH)) {
    try {
      existing = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8")).properties || [];
    } catch {}
  }
  const map = new Map(existing.filter((p) => p && p.id).map((p) => [p.id, p]));
  allProperties.forEach((p) => { if (p.id) map.set(p.id, p); });
  const merged = Array.from(map.values()).map((p, i) => ({ no: i + 1, ...p }));

  const output = {
    lastUpdated: new Date().toISOString(),
    totalCount: merged.length,
    properties: merged,
  };
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf8");
  console.log(`Saved ${merged.length} properties`);
}

main().catch((err) => { console.error(err); process.exit(1); });
