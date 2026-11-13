export interface Tab {
  id: string;
  title: string;
  url: string;
  displayUrl: string;
  favicon?: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  historyStack: string[];
  historyIndex: number;
  mode: 'web' | 'reader';
  proxyMode: boolean; // true = through backend proxy, false = direct
  zoom: number; // 80, 90, 100, 110, 125, 150
  reloadCount?: number;
}

export interface SearchEngine {
  id: string;
  name: string;
  searchUrl: (query: string) => string;
  iconLetter: string;
  color: string;
  description: string;
}

export interface QuickLink {
  title: string;
  url: string;
  category: string;
  description: string;
  iconName?: string;
}

export interface ReadabilityData {
  title: string;
  url: string;
  wordCount: number;
  readTimeMinutes: number;
  content: string;
}
