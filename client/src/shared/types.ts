export type ServiceStatus = 'checking' | 'online' | 'offline';
export type FeedbackValue = 'helpful' | 'irrelevant' | 'duplicate';
export type FeedMode = 'all' | 'unread' | 'relevant';
export type FeedSort = 'latest' | 'importance' | 'personalized';

export type Keyword = { id: string; value: string; enabled: boolean };
export type Topic = { id: string; name: string; aliases: string[]; excludeWords: string[]; sourceIds: string[]; frequencyMinutes: number; notificationLevel: 'all' | 'important' | 'none'; description: string; enabled: boolean; keywords: Keyword[] };
export type SourceOption = { id: string; name: string };
export type FeedItem = {
  id: string;
  sourceName: string;
  source: string;
  keyword: string;
  title: string;
  summary: string;
  url: string;
  collectedAt: string;
  importanceScore: number;
  relevanceScore: number;
  isRead: boolean;
  aiStatus: string;
  analysisSummary: string;
  analysisReason: string;
  feedback: FeedbackValue | null;
};
export type FeedResponse = { data: FeedItem[]; page: number; pageSize: number; total: number; totalPages: number };
export type CollectionResult = {
  errors: Array<{ source: string; keyword: string; message: string }>;
  stats: { topics: number; keywords: number; results: number };
  persistence: { saved: number; duplicates: number; changes: number };
  analysis: { processed: number; ai: number; fallback: number };
};
export type EventDetail = { title: string; firstSeenAt: string; lastSeenAt: string; sourceCount: number; sources: FeedItem[] };
export type Digest = {
  title: string;
  total: number;
  unread: number;
  changes: number;
  sourceCounts: Record<string, number>;
  topItems: Array<{ id: string; title: string; sourceName: string; importanceScore: number; summary: string }>;
};
export type CollectionEvent = {
  status: 'started' | 'completed' | 'failed';
  stats?: { results: number; saved: number; changes: number };
  error?: string;
};
export type EditingValue =
  | { kind: 'topic'; topic: Topic }
  | { kind: 'keyword'; topic: Topic; keyword: Keyword };
export type FeedOverview = { all: number; unread: number; relevant: number; globalAll: number; globalUnread: number; topicCounts: Record<string, number> };
export type WorkspaceView = 'inbox' | 'topics' | 'actions' | 'manage' | 'events' | 'runs' | 'sources' | 'notifications' | 'settings';
export type BriefSection = { title: string; detail: string; sourceIds: string[] };
export type BriefTask = { id: string; title: string; done: boolean; date: string };
export type EditorialBrief = {
  id: string; version: number; createdAt: string; updatedAt: string;
  title: string; reader: string; angle: 'guide' | 'engineering'; rationale: string;
  outline: BriefSection[]; checks: string[]; tasks: BriefTask[];
  sources: { id: string; title: string; sourceName: string; summary: string; url: string }[];
  provider: 'ai' | 'fallback'; archived: boolean;
};
