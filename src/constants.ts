import { SearchEngine, QuickLink, Tab } from './types.ts';

export const SEARCH_ENGINES: SearchEngine[] = [
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    searchUrl: (q: string) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    iconLetter: 'D',
    color: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
    description: 'Privacy-focused HTML search with zero tracking',
  },
  {
    id: 'wikipedia',
    name: 'Wikipedia',
    searchUrl: (q: string) => `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`,
    iconLetter: 'W',
    color: 'text-slate-400 bg-slate-500/10 border-slate-500/20',
    description: 'Direct encyclopedia lookup and reference',
  },
  {
    id: 'google',
    name: 'Google',
    searchUrl: (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
    iconLetter: 'G',
    color: 'text-blue-500 bg-blue-500/10 border-blue-500/20',
    description: 'Comprehensive global web search',
  },
  {
    id: 'bing',
    name: 'Bing',
    searchUrl: (q: string) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
    iconLetter: 'B',
    color: 'text-teal-500 bg-teal-500/10 border-teal-500/20',
    description: 'Microsoft Bing web search engine',
  },
  {
    id: 'brave',
    name: 'Brave',
    searchUrl: (q: string) => `https://search.brave.com/search?q=${encodeURIComponent(q)}`,
    iconLetter: 'Br',
    color: 'text-orange-500 bg-orange-500/10 border-orange-500/20',
    description: 'Independent, private search index',
  },
];

export const QUICK_LINKS: QuickLink[] = [
  {
    title: 'Wikipedia',
    url: 'https://en.wikipedia.org',
    category: 'Reference',
    description: 'The free encyclopedia with 60M+ articles',
  },
  {
    title: 'Hacker News',
    url: 'https://news.ycombinator.com',
    category: 'Technology',
    description: 'Curated tech, startups, and computing discussion',
  },
  {
    title: 'DuckDuckGo',
    url: 'https://duckduckgo.com/html/',
    category: 'Search',
    description: 'Lightweight privacy search without tracking',
  },
  {
    title: 'BBC World News',
    url: 'https://www.bbc.com/news',
    category: 'News',
    description: 'Global breaking news, analysis, and reports',
  },
  {
    title: 'MDN Web Docs',
    url: 'https://developer.mozilla.org',
    category: 'Documentation',
    description: 'Standards-based resources for open web tech',
  },
  {
    title: 'Project Gutenberg',
    url: 'https://www.gutenberg.org',
    category: 'Literature',
    description: 'Free public domain eBooks and classic texts',
  },
  {
    title: 'Dev.to Community',
    url: 'https://dev.to',
    category: 'Developers',
    description: 'Constructive community for software developers',
  },
  {
    title: 'Internet Archive',
    url: 'https://archive.org',
    category: 'Archive',
    description: 'Digital library of millions of free books & sites',
  },
];

export function createNewTab(initialUrl = ''): Tab {
  const id = 'tab_' + Math.random().toString(36).substring(2, 9);
  return {
    id,
    title: initialUrl ? 'Loading...' : 'New Tab',
    url: initialUrl,
    displayUrl: initialUrl,
    isLoading: !!initialUrl,
    canGoBack: false,
    canGoForward: false,
    historyStack: initialUrl ? [initialUrl] : [],
    historyIndex: initialUrl ? 0 : -1,
    mode: 'web',
    proxyMode: true,
    zoom: 100,
  };
}
