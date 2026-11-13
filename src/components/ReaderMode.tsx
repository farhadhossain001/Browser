import React, { useState, useEffect } from 'react';
import { ReadabilityData } from '../types.ts';
import { BookOpen, ArrowLeft, Clock, FileText, Globe, Sun, Moon, Coffee } from 'lucide-react';

interface ReaderModeProps {
  url: string;
  onClose: () => void;
  onNavigate: (url: string) => void;
}

export const ReaderMode: React.FC<ReaderModeProps> = ({ url, onClose, onNavigate }) => {
  const [data, setData] = useState<ReadabilityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState<'sm' | 'base' | 'lg' | 'xl'>('base');
  const [theme, setTheme] = useState<'dark' | 'sepia' | 'light'>('dark');

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    fetch(`/api/readability?url=${encodeURIComponent(url)}`)
      .then((res) => {
        if (!res.ok) throw new Error('Could not extract article text');
        return res.json();
      })
      .then((resData) => {
        if (isMounted) {
          setData(resData);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err.message || 'Unable to load reader view');
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [url]);

  const fontSizeClasses = {
    sm: 'text-sm leading-relaxed',
    base: 'text-base leading-relaxed',
    lg: 'text-lg leading-relaxed',
    xl: 'text-xl leading-relaxed',
  };

  const themeStyles = {
    dark: 'bg-slate-950 text-slate-200 border-slate-800',
    sepia: 'bg-[#fbf0d9] text-[#433422] border-[#e6d3b3]',
    light: 'bg-white text-slate-800 border-slate-200',
  };

  return (
    <div className={`flex-1 flex flex-col h-full overflow-hidden transition-colors ${themeStyles[theme].split(' ')[0]}`}>
      {/* Reader Controls Toolbar */}
      <div className={`flex items-center justify-between px-4 py-2.5 border-b shrink-0 ${themeStyles[theme].split(' ')[2]}`}>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800/20 hover:bg-slate-800/40 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Exit Reader Mode</span>
        </button>

        <div className="flex items-center gap-3 text-xs">
          {/* Font Size Selector */}
          <div className="flex items-center bg-slate-800/10 rounded-lg p-0.5 border border-slate-700/20">
            <button
              onClick={() => setFontSize('sm')}
              className={`px-2 py-0.5 rounded text-xs ${fontSize === 'sm' ? 'bg-slate-700/30 font-bold' : ''}`}
            >
              A-
            </button>
            <button
              onClick={() => setFontSize('base')}
              className={`px-2 py-0.5 rounded text-xs ${fontSize === 'base' ? 'bg-slate-700/30 font-bold' : ''}`}
            >
              A
            </button>
            <button
              onClick={() => setFontSize('lg')}
              className={`px-2 py-0.5 rounded text-xs ${fontSize === 'lg' ? 'bg-slate-700/30 font-bold' : ''}`}
            >
              A+
            </button>
          </div>

          {/* Theme Palette Selector */}
          <div className="flex items-center gap-1 bg-slate-800/10 rounded-lg p-0.5 border border-slate-700/20">
            <button
              onClick={() => setTheme('dark')}
              title="Dark Theme"
              className={`p-1.5 rounded ${theme === 'dark' ? 'bg-slate-800 text-white' : 'opacity-60'}`}
            >
              <Moon className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setTheme('sepia')}
              title="Sepia Paper Theme"
              className={`p-1.5 rounded ${theme === 'sepia' ? 'bg-[#ebd8b7] text-[#433422]' : 'opacity-60'}`}
            >
              <Coffee className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setTheme('light')}
              title="Crisp Light Theme"
              className={`p-1.5 rounded ${theme === 'light' ? 'bg-slate-200 text-slate-800' : 'opacity-60'}`}
            >
              <Sun className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Reader Content Area */}
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-2xl mx-auto">
          {loading && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-8 h-8 rounded-full border-2 border-blue-500 border-t-transparent animate-spin mb-4" />
              <p className="text-sm opacity-70">Distilling clean article text...</p>
            </div>
          )}

          {error && (
            <div className="p-6 rounded-xl border border-red-500/20 bg-red-500/5 text-center my-12">
              <BookOpen className="w-8 h-8 text-red-400 mx-auto mb-2" />
              <h3 className="text-sm font-semibold mb-1">Could not extract article text</h3>
              <p className="text-xs opacity-75 mb-4">{error}</p>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium"
              >
                Return to Web View
              </button>
            </div>
          )}

          {!loading && !error && data && (
            <article className={themeStyles[theme].split(' ')[1]}>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-4 leading-tight">
                {data.title}
              </h1>

              {/* Metadata */}
              <div className="flex items-center gap-3 text-xs opacity-60 mb-8 pb-4 border-b border-current/10">
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{data.readTimeMinutes} min read</span>
                </span>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <FileText className="w-3.5 h-3.5" />
                  <span>{data.wordCount.toLocaleString()} words</span>
                </span>
                <span>·</span>
                <button
                  type="button"
                  onClick={() => onNavigate(data.url)}
                  className="hover:underline flex items-center gap-1 truncate max-w-[200px]"
                  title="Return to full web page"
                >
                  <Globe className="w-3 h-3" />
                  <span className="truncate">{new URL(data.url).hostname}</span>
                </button>
              </div>

              {/* Render Cleaned Article HTML with in-browser link interception */}
              <div
                className={`prose max-w-none ${fontSizeClasses[fontSize]} space-y-4`}
                onClick={(e) => {
                  const target = (e.target as HTMLElement).closest('a');
                  if (!target) return;
                  const href = target.getAttribute('href');
                  if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
                  e.preventDefault();
                  try {
                    const resolved = new URL(href, data.url).href;
                    onNavigate(resolved);
                  } catch {
                    // ignore invalid URL
                  }
                }}
                dangerouslySetInnerHTML={{ __html: data.content }}
              />
            </article>
          )}
        </div>
      </div>
    </div>
  );
};
