export type Board = "industry" | "company";

export type NewsItem = {
  id: string;
  title: string;
  url: string;
  source: string;
  sourceType: string;
  board: Board;
  topicIds: string[];
  companyCodes: string[];
  productTags: string[];
  metricTags: string[];
  summary: string;
  publishedAt: string;
  collectedAt: string;
};

export type MetricItem = {
  id: string;
  title: string;
  source: string;
  url: string;
  board: Board;
  metricType: string;
  metricLabel: string;
  productTags: string[];
  companyCodes: string[];
  period: string;
  value: number | null;
  unit: string;
  yoy: number | null;
  mom: number | null;
  publishedAt: string;
  collectedAt: string;
  excerpt: string;
};

export type Topic = {
  id: string;
  name: string;
  board: Board;
  group: string;
  url: string;
  description: string;
};

export type Company = {
  code: string;
  name: string;
  market: string;
  url: string;
};

export type Product = {
  id: string;
  name: string;
};

export type Source = {
  id: string;
  name: string;
  board: Board;
  type: string;
  url: string;
};

export type Summary = {
  generatedAt: string;
  newsCount: number;
  metricsCount: number;
  sourceCount: number;
};
