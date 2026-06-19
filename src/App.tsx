import {
  ArrowUpRight,
  BarChart3,
  Building2,
  CalendarClock,
  Database,
  ExternalLink,
  Factory,
  FileText,
  Filter,
  Gauge,
  LineChart,
  RefreshCw,
  Search,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Board, Company, MetricItem, NewsItem, Product, Source, Summary, Topic } from "./types";

type DataState = {
  news: NewsItem[];
  metrics: MetricItem[];
  topics: Topic[];
  companies: Company[];
  products: Product[];
  sources: Source[];
  summary: Summary | null;
};

const timeRanges = [
  { key: "day", label: "日" },
  { key: "week", label: "周" },
  { key: "month", label: "月" },
  { key: "quarter", label: "季" },
  { key: "year", label: "年" },
  { key: "all", label: "全部" },
] as const;

type TimeRange = (typeof timeRanges)[number]["key"];

const metricLabels: Record<string, string> = {
  sales: "销量",
  export: "出口",
  import: "进口",
  operatingRate: "开工率",
  workingHours: "作业小时",
  inventory: "库存",
  price: "均价",
  cost: "成本",
  investment: "投资",
  production: "产量",
};

const boardCopy: Record<Board, { name: string; eyebrow: string; icon: typeof Factory }> = {
  industry: { name: "行业信息", eyebrow: "政策、趋势、权威数据", icon: Factory },
  company: { name: "主机厂信息", eyebrow: "公告、经营动态、公司数据", icon: Building2 },
};

function parseDate(value: string) {
  const time = Date.parse(value);
  return Number.isNaN(time) ? new Date(0) : new Date(time);
}

function formatDate(value: string) {
  const date = parseDate(value);
  if (date.getTime() === 0) return "未知日期";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatFullDate(value: string) {
  const date = parseDate(value);
  if (date.getTime() === 0) return "未知日期";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function inRange(value: string, range: TimeRange) {
  if (range === "all") return true;
  const date = parseDate(value);
  if (date.getTime() === 0) return true;
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const day = 24 * 60 * 60 * 1000;
  const limits: Record<Exclude<TimeRange, "all">, number> = {
    day,
    week: day * 7,
    month: day * 31,
    quarter: day * 92,
    year: day * 366,
  };
  return diff <= limits[range];
}

function inDateWindow(value: string, range: TimeRange, startDate: string, endDate: string) {
  const hasCustomRange = Boolean(startDate || endDate);
  if (!hasCustomRange) return inRange(value, range);

  const itemTime = parseDate(value).getTime();
  if (itemTime === 0) return false;

  const startTime = startDate ? new Date(`${startDate}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
  const endTime = endDate ? new Date(`${endDate}T23:59:59`).getTime() : Number.POSITIVE_INFINITY;
  const from = Math.min(startTime, endTime);
  const to = Math.max(startTime, endTime);

  return itemTime >= from && itemTime <= to;
}

function formatRangeLabel(range: TimeRange, startDate: string, endDate: string) {
  if (startDate || endDate) {
    return `${startDate || "最早"} 至 ${endDate || "最新"}`;
  }
  return timeRanges.find((item) => item.key === range)?.label ?? "全部";
}

function uniq<T>(items: T[]) {
  return Array.from(new Set(items));
}

function dataPath(url: string) {
  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}${url.replace(/^\//, "")}`;
}

async function loadJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(`${dataPath(url)}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return fallback;
    return await response.json();
  } catch {
    return fallback;
  }
}

export function App() {
  const [data, setData] = useState<DataState>({
    news: [],
    metrics: [],
    topics: [],
    companies: [],
    products: [],
    sources: [],
    summary: null,
  });
  const [activeBoard, setActiveBoard] = useState<Board>("industry");
  const [timeRange, setTimeRange] = useState<TimeRange>("month");
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState("all");
  const [company, setCompany] = useState("all");
  const [product, setProduct] = useState("all");
  const [metricType, setMetricType] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    Promise.all([
      loadJson<NewsItem[]>("/data/news.json", []),
      loadJson<MetricItem[]>("/data/metrics.json", []),
      loadJson<Topic[]>("/data/topics.json", []),
      loadJson<Company[]>("/data/companies.json", []),
      loadJson<Product[]>("/data/products.json", []),
      loadJson<Source[]>("/data/sources.json", []),
      loadJson<Summary | null>("/data/summary.json", null),
    ]).then(([news, metrics, topics, companies, products, sources, summary]) => {
      setData({ news, metrics, topics, companies, products, sources, summary });
    });
  }, []);

  const visibleTopics = useMemo(
    () => data.topics.filter((item) => item.board === activeBoard),
    [activeBoard, data.topics],
  );

  const visibleSources = useMemo(
    () => data.sources.filter((item) => item.board === activeBoard),
    [activeBoard, data.sources],
  );

  const filteredNews = useMemo(() => {
    const text = query.trim().toLowerCase();
    return data.news
      .filter((item) => item.board === activeBoard)
      .filter((item) => inDateWindow(item.publishedAt, timeRange, startDate, endDate))
      .filter((item) => topic === "all" || item.topicIds.includes(topic))
      .filter((item) => company === "all" || item.companyCodes.includes(company))
      .filter((item) => product === "all" || item.productTags.includes(product))
      .filter((item) => {
        if (!text) return true;
        return `${item.title} ${item.summary} ${item.source}`.toLowerCase().includes(text);
      })
      .sort((a, b) => parseDate(b.publishedAt).getTime() - parseDate(a.publishedAt).getTime());
  }, [activeBoard, company, data.news, endDate, product, query, startDate, timeRange, topic]);

  const filteredMetrics = useMemo(() => {
    const text = query.trim().toLowerCase();
    return data.metrics
      .filter((item) => item.board === activeBoard)
      .filter((item) => inDateWindow(item.publishedAt, timeRange, startDate, endDate))
      .filter((item) => metricType === "all" || item.metricType === metricType)
      .filter((item) => company === "all" || item.companyCodes.includes(company))
      .filter((item) => product === "all" || item.productTags.includes(product))
      .filter((item) => {
        if (!text) return true;
        return `${item.title} ${item.excerpt} ${item.source}`.toLowerCase().includes(text);
      })
      .sort((a, b) => parseDate(b.publishedAt).getTime() - parseDate(a.publishedAt).getTime());
  }, [activeBoard, company, data.metrics, endDate, metricType, product, query, startDate, timeRange]);

  const statsNews = useMemo(
    () =>
      data.news
        .filter((item) => item.source === "国家统计局数据发布")
        .filter((item) => inDateWindow(item.publishedAt, timeRange, startDate, endDate))
        .sort((a, b) => parseDate(b.publishedAt).getTime() - parseDate(a.publishedAt).getTime()),
    [data.news, endDate, startDate, timeRange],
  );

  const statsMetrics = useMemo(
    () =>
      data.metrics
        .filter((item) => item.source === "国家统计局数据发布")
        .filter((item) => inDateWindow(item.publishedAt, timeRange, startDate, endDate))
        .sort((a, b) => parseDate(b.publishedAt).getTime() - parseDate(a.publishedAt).getTime()),
    [data.metrics, endDate, startDate, timeRange],
  );

  const archiveGroups = useMemo(() => {
    const groups = new Map<string, number>();
    for (const item of filteredNews) {
      const date = parseDate(item.publishedAt);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filteredNews]);

  const kpis = useMemo(() => {
    const topics = uniq(filteredNews.flatMap((item) => item.topicIds)).length;
    const companies = uniq(filteredNews.flatMap((item) => item.companyCodes)).length;
    const metrics = filteredMetrics.length;
    const products = uniq(filteredMetrics.flatMap((item) => item.productTags)).length;
    return { topics, companies, metrics, products };
  }, [filteredMetrics, filteredNews]);

  const activeBoardMeta = boardCopy[activeBoard];
  const ActiveIcon = activeBoardMeta.icon;
  const rangeLabel = formatRangeLabel(timeRange, startDate, endDate);

  function clearCustomDates() {
    setStartDate("");
    setEndDate("");
  }

  function openStatsDashboard() {
    setActiveBoard("industry");
    setTopic("official-data");
    setCompany("all");
    window.setTimeout(() => {
      document.getElementById("stats-dashboard")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">工程机械 RSS 情报中枢</p>
          <h1>工程机械情报台</h1>
        </div>
        <div className="update-chip" title="采集脚本每小时运行一次">
          <RefreshCw size={16} />
          <span>{data.summary ? `更新 ${formatDate(data.summary.generatedAt)}` : "等待数据"}</span>
        </div>
      </header>

      <main>
        <section className="workspace">
          <div className="board-rail" aria-label="板块切换">
            {(Object.keys(boardCopy) as Board[]).map((board) => {
              const item = boardCopy[board];
              const Icon = item.icon;
              return (
                <button
                  className={board === activeBoard ? "board-tab active" : "board-tab"}
                  key={board}
                  type="button"
                  onClick={() => {
                    setActiveBoard(board);
                    setTopic("all");
                    setCompany("all");
                    setProduct("all");
                    setMetricType("all");
                  }}
                >
                  <Icon size={18} />
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.eyebrow}</small>
                  </span>
                </button>
              );
            })}
          </div>

          <section className="hero-band">
            <div>
              <div className="section-title">
                <ActiveIcon size={22} />
                <div>
                  <h2>{activeBoardMeta.name}</h2>
                  <p>{activeBoardMeta.eyebrow}</p>
                </div>
              </div>
              <div className="stat-grid">
                <KpiCard icon={FileText} label="新闻与公告" value={filteredNews.length} />
                <KpiCard icon={Database} label="量化指标" value={kpis.metrics} />
                <KpiCard icon={Filter} label="覆盖 Topic" value={kpis.topics} />
                <KpiCard icon={Gauge} label="覆盖品类" value={kpis.products} />
              </div>
            </div>
            <div className="source-strip">
              {visibleSources.slice(0, 8).map((source) =>
                source.id === "stats-data" ? (
                  <button className="source-action" type="button" onClick={openStatsDashboard} key={source.id}>
                    {source.name}
                    <BarChart3 size={13} />
                  </button>
                ) : (
                  <a href={source.url} target="_blank" rel="noreferrer" key={source.id}>
                    {source.name}
                    <ExternalLink size={13} />
                  </a>
                ),
              )}
            </div>
          </section>

          <section className="control-band">
            <div className="search-box">
              <Search size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索政策、品类、公司、指标"
              />
            </div>
            <div className="segmented" aria-label="时间回看">
              {timeRanges.map((item) => (
                <button
                  key={item.key}
                  className={item.key === timeRange ? "active" : ""}
                  type="button"
                  onClick={() => {
                    setTimeRange(item.key);
                    clearCustomDates();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="date-range-control" aria-label="自定义日期区间">
              <input
                aria-label="开始日期"
                type="date"
                value={startDate}
                onChange={(event) => {
                  setStartDate(event.target.value);
                  setTimeRange("all");
                }}
                onInput={(event) => {
                  setStartDate(event.currentTarget.value);
                  setTimeRange("all");
                }}
              />
              <span>至</span>
              <input
                aria-label="结束日期"
                type="date"
                value={endDate}
                onChange={(event) => {
                  setEndDate(event.target.value);
                  setTimeRange("all");
                }}
                onInput={(event) => {
                  setEndDate(event.currentTarget.value);
                  setTimeRange("all");
                }}
              />
              <button type="button" onClick={clearCustomDates}>
                清除
              </button>
            </div>
            <select value={topic} onChange={(event) => setTopic(event.target.value)}>
              <option value="all">全部 Topic</option>
              {visibleTopics.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            {activeBoard === "company" && (
              <select value={company} onChange={(event) => setCompany(event.target.value)}>
                <option value="all">全部公司</option>
                {data.companies.map((item) => (
                  <option value={item.code} key={item.code}>
                    {item.name}
                  </option>
                ))}
              </select>
            )}
            <select value={product} onChange={(event) => setProduct(event.target.value)}>
              <option value="all">全部品类</option>
              {data.products.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select value={metricType} onChange={(event) => setMetricType(event.target.value)}>
              <option value="all">全部指标</option>
              {Object.entries(metricLabels).map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </select>
          </section>

          <section className="topic-band">
            {visibleTopics.map((item) =>
              item.id === "official-data" ? (
                <button className="topic-pill topic-button" type="button" onClick={openStatsDashboard} key={item.id}>
                  <span>{item.group}</span>
                  <strong>{item.name}</strong>
                  <BarChart3 size={15} />
                </button>
              ) : (
                <a className="topic-pill" href={item.url} target="_blank" rel="noreferrer" key={item.id}>
                  <span>{item.group}</span>
                  <strong>{item.name}</strong>
                  <ArrowUpRight size={15} />
                </a>
              ),
            )}
          </section>

          {activeBoard === "industry" && (
            <StatsDashboard metrics={statsMetrics} news={statsNews} rangeLabel={rangeLabel} />
          )}

          <section className="content-grid">
            <div className="primary-column">
              <div className="section-heading">
                <div>
                  <h3>最新收纳</h3>
                  <p>只展示锁定来源的新闻、公告、政策和数据发布</p>
                </div>
                <span>{filteredNews.length} 条</span>
              </div>
              <div className="news-list">
                {filteredNews.length === 0 && <EmptyState label="暂无匹配新闻，等待下一次采集。" />}
                {filteredNews.map((item) => (
                  <article className="news-item" key={item.id}>
                    <div className="news-date">
                      <CalendarClock size={15} />
                      {formatDate(item.publishedAt)}
                    </div>
                    <h4>
                      <a href={item.url} target="_blank" rel="noreferrer">
                        {item.title}
                      </a>
                    </h4>
                    <p>{item.summary}</p>
                    <div className="tag-row">
                      <span>{item.source}</span>
                      {item.metricTags.slice(0, 3).map((tag) => (
                        <span key={tag}>{metricLabels[tag] ?? tag}</span>
                      ))}
                      {item.productTags.slice(0, 4).map((tag) => (
                        <span key={tag}>{data.products.find((p) => p.id === tag)?.name ?? tag}</span>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <aside className="side-column">
              <div className="section-heading compact">
                <div>
                  <h3>数据归档</h3>
                  <p>自动识别的量化指标</p>
                </div>
                <BarChart3 size={18} />
              </div>
              <div className="metric-list">
                {filteredMetrics.length === 0 && <EmptyState label="暂无匹配指标。" />}
                {filteredMetrics.slice(0, 18).map((item) => (
                  <a className="metric-item" href={item.url} target="_blank" rel="noreferrer" key={item.id}>
                    <div>
                      <span>{metricLabels[item.metricType] ?? item.metricLabel}</span>
                      <time>{formatFullDate(item.publishedAt)}</time>
                    </div>
                    <strong>
                      {item.value === null ? "已识别" : item.value.toLocaleString("zh-CN")}
                      {item.unit}
                    </strong>
                    <p>{item.title}</p>
                    <small>
                      {item.yoy !== null ? `同比 ${item.yoy}%` : ""}
                      {item.yoy !== null && item.mom !== null ? " · " : ""}
                      {item.mom !== null ? `环比 ${item.mom}%` : ""}
                    </small>
                  </a>
                ))}
              </div>

              <div className="section-heading compact">
                <div>
                  <h3>时间收纳</h3>
                  <p>按月聚合当前筛选结果</p>
                </div>
                <LineChart size={18} />
              </div>
              <div className="archive-list">
                {archiveGroups.map(([key, count]) => (
                  <div key={key}>
                    <span>{key}</span>
                    <strong>{count}</strong>
                  </div>
                ))}
              </div>
            </aside>
          </section>
        </section>
      </main>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value }: { icon: typeof TrendingUp; label: string; value: number }) {
  return (
    <div className="kpi-card">
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value.toLocaleString("zh-CN")}</strong>
    </div>
  );
}

function StatsDashboard({
  metrics,
  news,
  rangeLabel,
}: {
  metrics: MetricItem[];
  news: NewsItem[];
  rangeLabel: string;
}) {
  const investmentMetrics = metrics.filter((item) => item.metricType === "investment");
  const priceMetrics = metrics.filter((item) => ["price", "cost", "production"].includes(item.metricType));
  const latestInvestment = pickMetric(metrics, ["固定资产投资"]);
  const latestRealEstate = pickMetric(metrics, ["房地产"]);
  const latestPpi = pickMetric(metrics, ["工业生产者出厂价格"]);
  const latestInputPrice = pickMetric(metrics, ["购进价格"]);

  return (
    <section className="stats-dashboard" id="stats-dashboard">
      <div className="section-heading">
        <div>
          <h3>国家统计局数据看板</h3>
          <p>当前区间：{rangeLabel}</p>
        </div>
        <span>{metrics.length} 项指标</span>
      </div>

      <div className="dashboard-kpis">
        <DashboardKpi label="统计局发布" value={news.length} unit="条" />
        <DashboardKpi label="已提取指标" value={metrics.length} unit="项" />
        <DashboardKpi label="投资相关" value={investmentMetrics.length} unit="项" />
        <DashboardKpi label="价格成本" value={priceMetrics.length} unit="项" />
      </div>

      <div className="dashboard-grid">
        <div className="dashboard-panel">
          <div className="panel-heading">
            <h4>核心指标</h4>
            <small>从统计局发布中自动抽取</small>
          </div>
          <div className="focus-metric-grid">
            <FocusMetric label="固定资产投资" metric={latestInvestment} />
            <FocusMetric label="房地产开发投资" metric={latestRealEstate} />
            <FocusMetric label="PPI" metric={latestPpi} />
            <FocusMetric label="购进价格" metric={latestInputPrice} />
          </div>
        </div>

        <div className="dashboard-panel">
          <div className="panel-heading">
            <h4>同比/环比</h4>
            <small>按发布时间排序</small>
          </div>
          <RateTrend metrics={metrics} />
        </div>
      </div>

      <div className="dashboard-panel">
        <div className="panel-heading">
          <h4>统计局发布</h4>
          <small>点击标题可打开原始发布</small>
        </div>
        <div className="stats-release-list">
          {news.length === 0 && <EmptyState label="当前时间区间没有统计局发布。" />}
          {news.slice(0, 8).map((item) => (
            <a href={item.url} target="_blank" rel="noreferrer" key={item.id}>
              <time>{formatFullDate(item.publishedAt)}</time>
              <strong>{item.title}</strong>
              <span>{item.metricTags.map((tag) => metricLabels[tag] ?? tag).join(" / ") || "发布"}</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function DashboardKpi({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="dashboard-kpi">
      <span>{label}</span>
      <strong>
        {value.toLocaleString("zh-CN")}
        <small>{unit}</small>
      </strong>
    </div>
  );
}

function FocusMetric({ label, metric }: { label: string; metric?: MetricItem }) {
  return (
    <a className="focus-metric" href={metric?.url ?? "#stats-dashboard"} target={metric ? "_blank" : undefined} rel="noreferrer">
      <span>{label}</span>
      <strong>
        {metric?.value === null || metric?.value === undefined
          ? "--"
          : `${metric.value.toLocaleString("zh-CN")}${metric.unit}`}
      </strong>
      <small>
        {metric
          ? [
              metric.yoy !== null ? `同比 ${metric.yoy}%` : "",
              metric.mom !== null ? `环比 ${metric.mom}%` : "",
              metric.period,
            ]
              .filter(Boolean)
              .join(" · ")
          : "暂无提取"}
      </small>
    </a>
  );
}

function RateTrend({ metrics }: { metrics: MetricItem[] }) {
  const rateRows = metrics
    .flatMap((item) => [
      item.yoy !== null ? { item, label: "同比", value: item.yoy } : null,
      item.mom !== null ? { item, label: "环比", value: item.mom } : null,
    ])
    .filter((item): item is { item: MetricItem; label: string; value: number } => Boolean(item))
    .slice(0, 10);
  const maxAbs = Math.max(1, ...rateRows.map((row) => Math.abs(row.value)));

  if (rateRows.length === 0) return <EmptyState label="当前时间区间没有可展示的同比/环比。" />;

  return (
    <div className="rate-trend">
      {rateRows.map((row) => {
        const width = Math.max(6, (Math.abs(row.value) / maxAbs) * 100);
        return (
          <a href={row.item.url} target="_blank" rel="noreferrer" className="rate-row" key={`${row.item.id}-${row.label}`}>
            <div>
              <span>{row.label}</span>
              <strong>{row.value}%</strong>
            </div>
            <div className="rate-track">
              <span
                className={row.value >= 0 ? "positive" : "negative"}
                style={{ width: `${width}%` }}
              />
            </div>
            <small>{row.item.title}</small>
          </a>
        );
      })}
    </div>
  );
}

function pickMetric(metrics: MetricItem[], keywords: string[]) {
  return metrics.find((item) => keywords.some((keyword) => `${item.title} ${item.excerpt}`.includes(keyword)));
}

function EmptyState({ label }: { label: string }) {
  return <div className="empty-state">{label}</div>;
}
