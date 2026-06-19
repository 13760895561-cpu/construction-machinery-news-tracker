import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import iconv from "iconv-lite";
import Parser from "rss-parser";
import { companies, products, sources, topicKeywords, topics } from "./sources.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "public", "data");
const NEWS_PATH = path.join(DATA_DIR, "news.json");
const METRICS_PATH = path.join(DATA_DIR, "metrics.json");
const MAX_HISTORY = 5000;
const MAX_METRICS = 10000;
const MAX_HTML_ITEMS = 24;
const MAX_RSS_ITEMS = 40;

const parser = new Parser({
  timeout: 18000,
  headers: {
    "User-Agent": "Mozilla/5.0 construction-machinery-rss-tracker/0.1",
  },
});

const metricTypes = [
  {
    key: "sales",
    label: "销量",
    words: ["销量", "销售", "销售量", "累计销售", "销售各类", "销售量"],
  },
  {
    key: "export",
    label: "出口",
    words: ["出口", "出口量", "出口额", "出口金额", "出口数量"],
  },
  {
    key: "import",
    label: "进口",
    words: ["进口", "进口量", "进口额", "进口金额", "进口数量"],
  },
  {
    key: "operatingRate",
    label: "开工率",
    words: ["开工率", "设备开工率", "挖掘机开工率"],
  },
  {
    key: "workingHours",
    label: "作业小时",
    words: ["作业小时", "平均作业小时", "开工小时", "小时数"],
  },
  {
    key: "inventory",
    label: "库存",
    words: ["库存", "代理商库存", "渠道库存", "库存水平"],
  },
  {
    key: "price",
    label: "均价",
    words: ["均价", "平均价格", "价格指数", "价格走势", "单价"],
  },
  {
    key: "cost",
    label: "成本",
    words: ["钢材", "液压件", "发动机", "成本", "原材料", "零部件"],
  },
  {
    key: "investment",
    label: "投资",
    words: ["基建投资", "基础设施投资", "房地产开发投资", "矿山固定资产投资", "制造业技改投资", "固定资产投资"],
  },
  {
    key: "production",
    label: "产量",
    words: ["产量", "生产", "制造"],
  },
];

await main();

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  const existingNews = await readJson(NEWS_PATH, []);
  const existingMetrics = await readJson(METRICS_PATH, []);
  const collectedAt = new Date().toISOString();

  const fetched = [];
  for (const source of sources) {
    try {
      if (source.type === "cninfo") {
        fetched.push(...(await fetchCninfo(source, collectedAt)));
      } else if (source.type === "rss") {
        fetched.push(...(await fetchRss(source, collectedAt)));
      } else {
        fetched.push(...(await fetchHtmlIndex(source, collectedAt)));
      }
    } catch (error) {
      console.warn(`[skip] ${source.name}: ${error.message}`);
    }
  }

  const existingById = new Map(existingNews.map((item) => [item.id, item]));
  const fresh = [];
  for (const item of fetched) {
    if (!item.title || !item.url) continue;
    const previous = existingById.get(item.id);
    fresh.push(previous ? { ...previous, ...item, collectedAt: previous.collectedAt } : item);
  }

  const mergedNews = dedupeById([...fresh, ...existingNews])
    .filter(isValidStoredItem)
    .sort((a, b) => toTime(b.publishedAt) - toTime(a.publishedAt))
    .slice(0, MAX_HISTORY);

  const metrics = [];
  for (const item of mergedNews) {
    metrics.push(...extractMetrics(item));
  }

  const mergedMetrics = dedupeById([...metrics, ...existingMetrics])
    .sort((a, b) => toTime(b.publishedAt) - toTime(a.publishedAt))
    .slice(0, MAX_METRICS);

  await writeJson(NEWS_PATH, mergedNews);
  await writeJson(METRICS_PATH, mergedMetrics);
  await writeJson(path.join(DATA_DIR, "topics.json"), topics);
  await writeJson(
    path.join(DATA_DIR, "companies.json"),
    companies.map(({ code, name, market, url }) => ({ code, name, market, url })),
  );
  await writeJson(
    path.join(DATA_DIR, "products.json"),
    products.map(({ id, name }) => ({ id, name })),
  );
  await writeJson(
    path.join(DATA_DIR, "sources.json"),
    sources.map(({ id, name, board, type, sourceType, url }) => ({ id, name, board, type: sourceType ?? type, url })),
  );
  await writeJson(path.join(DATA_DIR, "summary.json"), {
    generatedAt: collectedAt,
    newsCount: mergedNews.length,
    metricsCount: mergedMetrics.length,
    sourceCount: sources.length,
  });

  console.log(`updated ${mergedNews.length} news items and ${mergedMetrics.length} metric rows`);
}

async function fetchRss(source, collectedAt) {
  const feed = await parser.parseURL(source.feedUrl ?? source.url);
  return (feed.items ?? []).slice(0, MAX_RSS_ITEMS).map((entry) =>
    normalizeItem({
      source,
      title: cleanText(entry.title),
      url: entry.link,
      summary: cleanText(entry.contentSnippet || entry.content || entry.summary || ""),
      publishedAt: parseDate(entry.isoDate || entry.pubDate),
      collectedAt,
    }),
  );
}

async function fetchHtmlIndex(source, collectedAt) {
  const html = await fetchText(source.url);
  const $ = cheerio.load(html);
  const candidates = [];

  $("a").each((_, element) => {
    const anchor = $(element);
    const title = cleanText(anchor.attr("title") || anchor.text());
    if (!isUsefulTitle(title)) return;

    const href = absoluteUrl(anchor.attr("href"), source.url);
    if (!href || href.startsWith("javascript:")) return;
    if (/product\.d1cm\.com|\/product\//i.test(href)) return;
    if (source.id === "d1cm" && !/news\.d1cm\.com\/20\d+\.shtml/i.test(href)) return;
    if (!isConcreteContentUrl(source, href, title)) return;

    const context = cleanText(anchor.parent().text() || anchor.closest("li, tr, div").text());
    const searchable = `${title} ${context}`;
    if (!shouldKeep(source, searchable)) return;

    candidates.push(
      normalizeItem({
        source,
        title,
        url: href,
        summary: summarize(context && context !== title ? context : title),
        publishedAt: extractDate(searchable),
        collectedAt,
      }),
    );
  });

  const items = dedupeById(candidates).slice(0, MAX_HTML_ITEMS);
  if (shouldHydrateSource(source)) {
    for (const item of items.slice(0, 10)) {
      const articleText = await fetchArticleText(item.url);
      if (articleText) {
        item.summary = summarize(articleText);
        item.productTags = detectProducts(`${item.title} ${articleText}`);
        item.metricTags = detectMetricTypes(`${item.title} ${articleText}`);
        item.companyCodes = uniq([...item.companyCodes, ...detectCompanies(articleText)]);
      }
    }
  }
  return items;
}

async function fetchCninfo(source, collectedAt) {
  const results = [];
  for (const company of companies.filter((item) => item.cninfo)) {
    const params = new URLSearchParams({
      pageNum: "1",
      pageSize: "16",
      column: company.cninfo.column,
      tabName: "fulltext",
      stock: company.cninfo.stock,
      searchkey: "",
      secid: "",
      plate: company.cninfo.plate,
      category: "",
      trade: "",
      seDate: "",
      sortName: "",
      sortType: "",
      isHLtitle: "true",
    });

    try {
      const response = await fetch("https://www.cninfo.com.cn/new/hisAnnouncement/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Referer: company.url,
          "User-Agent": "Mozilla/5.0 construction-machinery-rss-tracker/0.1",
        },
        body: params,
        signal: AbortSignal.timeout(18000),
      });
      if (!response.ok) continue;
      const payload = await response.json();
      for (const entry of payload.announcements ?? []) {
        const title = cleanText(entry.announcementTitle || entry.shortTitle || "");
        if (!title) continue;
        const url = absoluteUrl(entry.adjunctUrl, "https://static.cninfo.com.cn/");
        results.push(
          normalizeItem({
            source,
            title,
            url,
            summary: `${cleanText(entry.secName || company.name)} ${title}`,
            publishedAt: new Date(entry.announcementTime || Date.now()).toISOString(),
            collectedAt,
            companyCodes: [company.code],
            topicIds: [`company-${company.code}`],
          }),
        );
      }
    } catch (error) {
      console.warn(`[skip] 巨潮 ${company.name}: ${error.message}`);
    }
  }
  return results;
}

function normalizeItem(input) {
  const title = cleanText(input.title);
  const summary = summarize(cleanText(input.summary || title));
  const text = `${title} ${summary}`;
  const companyCodes = input.companyCodes?.length ? input.companyCodes : detectCompanies(text);
  const topicIds = uniq([...(input.source.topicIds ?? []), ...(input.topicIds ?? []), ...companyCodes.map((code) => `company-${code}`)]);
  const productTags = detectProducts(text);
  const metricTags = detectMetricTypes(text);
  const board = input.source.board;
  const publishedAt = input.publishedAt || new Date().toISOString();

  return {
    id: stableId(input.url || title),
    title,
    url: input.url,
    source: input.source.name,
    sourceType: input.source.sourceType ?? input.source.type,
    board,
    topicIds,
    companyCodes,
    productTags,
    metricTags,
    summary,
    publishedAt,
    collectedAt: input.collectedAt,
  };
}

function extractMetrics(item) {
  const text = cleanText(`${item.title}。${item.summary}`);
  const sentences = splitSentences(text);
  const rows = [];

  for (const sentence of sentences) {
    const metric = metricTypes.find((type) => type.words.some((word) => sentence.includes(word)));
    if (!metric) continue;

    const value = extractValue(sentence);
    const yoy = extractRate(sentence, "同比");
    const mom = extractRate(sentence, "环比");
    if (!value && yoy === null && mom === null) continue;

    const productsInSentence = detectProducts(sentence);
    const companyCodes = detectCompanies(sentence);
    const unit = value?.unit ?? (sentence.includes("%") ? "%" : "");
    const period = extractPeriod(sentence) || extractPeriod(item.title) || inferPeriodFromDate(item.publishedAt);
    const key = `${item.id}-${metric.key}-${period}-${value?.raw ?? ""}-${yoy ?? ""}-${mom ?? ""}`;

    rows.push({
      id: stableId(key),
      title: item.title,
      source: item.source,
      url: item.url,
      board: item.board,
      metricType: metric.key,
      metricLabel: metric.label,
      productTags: productsInSentence.length ? productsInSentence : item.productTags,
      companyCodes: companyCodes.length ? companyCodes : item.companyCodes,
      period,
      value: value?.number ?? null,
      unit,
      yoy,
      mom,
      publishedAt: item.publishedAt,
      collectedAt: item.collectedAt,
      excerpt: sentence.slice(0, 180),
    });
  }

  return rows.slice(0, 8);
}

function extractValue(sentence) {
  const match = sentence.match(/([+-]?\d+(?:\.\d+)?)\s*(万亿元|亿元|万美元|万美元\/台|万元\/台|万元|万台|台|万辆|辆|吨|小时|%|百分点|元\/吨|元)/);
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;
  return { number, unit: match[2], raw: match[0] };
}

function extractRate(sentence, label) {
  const regex = new RegExp(`${label}[^\\d+-]{0,8}([+-]?\\d+(?:\\.\\d+)?)\\s*%`);
  const match = sentence.match(regex);
  if (!match) return null;
  const raw = Number(match[1]);
  if (!Number.isFinite(raw)) return null;
  const negativeWords = ["下降", "减少", "降低", "回落", "下滑"];
  const window = sentence.slice(Math.max(0, match.index - 12), (match.index ?? 0) + match[0].length + 12);
  return negativeWords.some((word) => window.includes(word)) && raw > 0 ? -raw : raw;
}

function detectProducts(text) {
  return products
    .filter((item) => item.aliases.some((alias) => text.includes(alias)))
    .map((item) => item.id);
}

function detectCompanies(text) {
  return companies
    .filter((company) => {
      const aliases = [company.name, company.code, company.hkexCode, ...(company.aliases ?? [])].filter(Boolean);
      return aliases.some((alias) => text.includes(alias));
    })
    .map((company) => company.code);
}

function detectMetricTypes(text) {
  return metricTypes.filter((item) => item.words.some((word) => text.includes(word))).map((item) => item.key);
}

function shouldKeep(source, text) {
  if (source.board === "company") return detectCompanies(text).length > 0 || source.id === "cninfo";
  if (source.sourceType === "finance_media") return hasFinanceNewsRelevance(text);
  if (source.sourceType === "local_policy" || source.sourceType === "central_policy") {
    return topicKeywords.some((word) => text.includes(word)) || /政策|通知|意见|方案|规划|措施|行动/.test(text);
  }
  return topicKeywords.some((word) => text.includes(word)) || detectMetricTypes(text).length > 0;
}

function hasDirectIndustryRelevance(text) {
  if (detectProducts(text).length > 0) return true;
  if (detectCompanies(text).length > 0) return true;

  const directWords = [
    "工程机械",
    "工程机械行业",
    "工程机械工业",
    "中国工程机械工业协会",
    "建筑设备",
    "施工机械",
    "矿山机械",
    "土方机械",
    "工业车辆",
    "高空作业平台",
    "开工率",
    "作业小时",
    "开工小时",
    "设备平均作业小时",
    "代理商库存",
    "渠道库存",
    "主机厂",
  ];
  if (directWords.some((word) => text.includes(word))) return true;

  const componentWords = ["液压件", "液压系统", "工程机械零部件", "挖机油缸", "工程机械发动机"];
  return componentWords.some((word) => text.includes(word));
}

function hasFinanceNewsRelevance(text) {
  if (hasDirectIndustryRelevance(text)) return true;

  const macroWords = [
    "基建",
    "基础设施",
    "专项债",
    "重大项目",
    "固定资产投资",
    "房地产开发投资",
    "房地产投资",
    "制造业投资",
    "制造业技改",
    "设备更新",
    "更新改造",
    "大规模设备更新",
    "矿山",
    "采矿业",
    "煤炭",
    "港口",
    "铁路",
    "公路",
    "水利",
    "钢材",
    "钢铁",
    "螺纹钢",
    "热卷",
    "液压",
    "发动机",
    "出口",
    "进口",
    "海关",
    "重卡",
    "机械设备",
    "装备制造",
  ];

  return macroWords.some((word) => text.includes(word));
}

function shouldHydrateSource(source) {
  return ["official_data", "association", "industry_media", "finance_media"].includes(source.sourceType);
}

function isConcreteContentUrl(source, url, title = "") {
  let parsed;
  let sourceParsed;
  try {
    parsed = new URL(url);
    sourceParsed = new URL(source.url);
  } catch {
    return false;
  }

  const path = parsed.pathname.replace(/\/+/g, "/");
  if (isPortalOrColumnUrl(url, title)) return false;
  if (/\.(pdf|docx?|xlsx?)$/i.test(path)) return true;
  if (/\/(search|sitemap|mail|login|register|zt|zhuanti|special|service|interaction)\b/i.test(path)) return false;
  if (/\/allkeywords\/|\/product_/i.test(path)) return false;

  if (source.sourceType === "central_policy" || source.sourceType === "local_policy") {
    const sameHost = parsed.hostname === sourceParsed.hostname;
    const govHost = parsed.hostname.endsWith(".gov.cn") || parsed.hostname === "www.gov.cn";
    const articleSignal =
      /20\d{2}[-/]?\d{2}[-/]?\d{2}/.test(path) ||
      /\/20\d{4}\//.test(path) ||
      /t20\d{6}_\d+/.test(path) ||
      /art[_/-]20\d{2}/.test(path) ||
      /content[_/-]?\d{5,}/.test(path) ||
      /\/\d{6,}\.(s?html?)$/i.test(path) ||
      /\/[a-f0-9-]{24,}\/\d+\.html$/i.test(path);

    return (sameHost || govHost) && articleSignal;
  }

  return true;
}

function isValidStoredItem(item) {
  if (/product\.d1cm\.com|\/product\//i.test(item.url)) return false;
  if (item.source === "第一工程机械网" && !/news\.d1cm\.com\/20\d+\.shtml/i.test(item.url)) return false;
  if (item.source === "财联社" && !hasFinanceNewsRelevance(`${item.title} ${item.summary}`)) return false;
  if (item.source === "第一财经" && !hasFinanceNewsRelevance(`${item.title} ${item.summary}`)) return false;
  if (isPortalOrColumnUrl(item.url, item.title)) return false;
  return true;
}

function isPortalOrColumnUrl(url, title = "") {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }

  const path = parsed.pathname.replace(/\/+/g, "/");
  const navTitle = /^(省|市|县)?(人民政府|政府办公厅|发展和改革委员会|工业和信息化厅|科学技术厅|自然资源厅|财政厅|交通运输厅|应急管理厅|国家矿山安全监察局)$/.test(title);
  if (navTitle) return true;
  if (path === "/" || path === "/index.html" || path === "/index.shtml") return true;
  if (/\/(col|columns)\/[^/]+\/index\.(s?html?)$/i.test(path)) return true;
  if (/\/(list|iframe_list)[^/]*\.(s?html?)$/i.test(path)) return true;
  if (/\/(zwgk|zfwj|zc|gk|zhengce|tzgg|wjk|zfxxgk|xxgk)\/?$/i.test(path)) return true;
  if (/\/(zwgk|zfwj|zc|gk|zhengce|tzgg|wjk|zfxxgk|xxgk)\/index\.(s?html?)$/i.test(path)) return true;
  return false;
}

async function fetchArticleText(url) {
  if (!/^https?:\/\//i.test(url) || /\.(pdf|docx?|xlsx?|zip|rar)(\?|$)/i.test(url)) return "";
  try {
    const html = await fetchText(url);
    const $ = cheerio.load(html);
    $("script, style, nav, header, footer, iframe, noscript").remove();
    const preferred = $("article, .article, .content, .TRS_Editor, .detail, .main").first().text();
    const text = cleanText(preferred || $("body").text());
    return text.length > 80 ? text.slice(0, 2400) : "";
  } catch {
    return "";
  }
}

function extractDate(text) {
  const now = new Date();
  const normalized = text.replace(/\s+/g, " ");
  const full = normalized.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/);
  if (full) return toIso(Number(full[1]), Number(full[2]), Number(full[3]));
  const short = normalized.match(/(?<!\d)(\d{1,2})[-/.月](\d{1,2})日?(?!\d)/);
  if (short) return toIso(now.getFullYear(), Number(short[1]), Number(short[2]));
  return now.toISOString();
}

function extractPeriod(text) {
  const year = text.match(/(20\d{2})年/);
  if (!year) return "";
  const yearText = year[1];
  const month = text.match(/(20\d{2})年\s*(\d{1,2})月/);
  if (month) return `${month[1]}-${month[2].padStart(2, "0")}`;
  const quarter = text.match(/(20\d{2})年\s*第?([一二三四1-4])季度/);
  if (quarter) return `${quarter[1]}Q${chineseQuarter(quarter[2])}`;
  if (/上半年/.test(text)) return `${yearText}H1`;
  if (/前三季度/.test(text)) return `${yearText}Q1-Q3`;
  if (/全年|年度|年报/.test(text)) return `${yearText}FY`;
  return yearText;
}

function inferPeriodFromDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function chineseQuarter(value) {
  const map = { 一: "1", 二: "2", 三: "3", 四: "4" };
  return map[value] ?? value;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 construction-machinery-rss-tracker/0.1",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "";
  const declared = contentType.match(/charset=([^;]+)/i)?.[1]?.toLowerCase();
  if (declared && iconv.encodingExists(declared)) return iconv.decode(buffer, declared);

  const utf8 = iconv.decode(buffer, "utf8");
  const meta = utf8.match(/charset=["']?([\w-]+)/i)?.[1]?.toLowerCase();
  if (meta && iconv.encodingExists(meta) && meta !== "utf-8") return iconv.decode(buffer, meta);
  if ((utf8.match(/\uFFFD/g) ?? []).length > 8) return iconv.decode(buffer, "gb18030");
  return utf8;
}

function parseDate(value) {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function absoluteUrl(href, base) {
  if (!href) return "";
  try {
    return new URL(href, base).toString();
  } catch {
    return "";
  }
}

function cleanText(value = "") {
  return String(value)
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function summarize(text) {
  const clean = cleanText(text);
  if (clean.length <= 180) return clean;
  return `${clean.slice(0, 180)}...`;
}

function isUsefulTitle(title) {
  if (!title || title.length < 6 || title.length > 120) return false;
  if (/登录|注册|首页|更多|返回|上一页|下一页|English|无障碍/.test(title)) return false;
  return /[\u4e00-\u9fa5]/.test(title);
}

function splitSentences(text) {
  return cleanText(text)
    .split(/[。！？!?；;]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 8);
}

function toIso(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day, 4, 0, 0));
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function toTime(value) {
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

function stableId(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 20);
}

function dedupeById(items) {
  const map = new Map();
  for (const item of items) {
    if (!item?.id) continue;
    if (!map.has(item.id)) map.set(item.id, item);
  }
  return Array.from(map.values());
}

function uniq(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
