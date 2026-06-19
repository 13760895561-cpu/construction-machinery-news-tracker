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
      .filter((item) => inRange(item.publishedAt, timeRange))
      .filter((item) => topic === "all" || item.topicIds.includes(topic))
      .filter((item) => company === "all" || item.companyCodes.includes(company))
      .filter((item) => product === "all" || item.productTags.includes(product))
      .filter((item) => {
        if (!text) return true;
        return `${item.title} ${item.summary} ${item.source}`.toLowerCase().includes(text);
      })
      .sort((a, b) => parseDate(b.publishedAt).getTime() - parseDate(a.publishedAt).getTime());
  }, [activeBoard, company, data.news, product, query, timeRange, topic]);

  const filteredMetrics = useMemo(() => {
    const text = query.trim().toLowerCase();
    return data.metrics
      .filter((item) => item.board === activeBoard)
      .filter((item) => inRange(item.publishedAt, timeRange))
      .filter((item) => metricType === "all" || item.metricType === metricType)
      .filter((item) => company === "all" || item.companyCodes.includes(company))
      .filter((item) => product === "all" || item.productTags.includes(product))
      .filter((item) => {
        if (!text) return true;
        return `${item.title} ${item.excerpt} ${item.source}`.toLowerCase().includes(text);
      })
      .sort((a, b) => parseDate(b.publishedAt).getTime() - parseDate(a.publishedAt).getTime());
  }, [activeBoard, company, data.metrics, metricType, product, query, timeRange]);

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
              {visibleSources.slice(0, 8).map((source) => (
                <a href={source.url} target="_blank" rel="noreferrer" key={source.id}>
                  {source.name}
                  <ExternalLink size={13} />
                </a>
              ))}
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
                  onClick={() => setTimeRange(item.key)}
                >
                  {item.label}
                </button>
              ))}
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
            {visibleTopics.map((item) => (
              <a className="topic-pill" href={item.url} target="_blank" rel="noreferrer" key={item.id}>
                <span>{item.group}</span>
                <strong>{item.name}</strong>
                <ArrowUpRight size={15} />
              </a>
            ))}
          </section>

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

function EmptyState({ label }: { label: string }) {
  return <div className="empty-state">{label}</div>;
}
