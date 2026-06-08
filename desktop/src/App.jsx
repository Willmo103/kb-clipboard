import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, 
  Clipboard, 
  Trash2, 
  Download, 
  RefreshCw, 
  Star, 
  FileText, 
  Image as ImageIcon, 
  Folder, 
  Link as LinkIcon, 
  X, 
  Sun, 
  Moon, 
  ChevronRight, 
  ExternalLink,
  Copy,
  Settings
} from 'lucide-react';

export default function App() {
  const [items, setItems] = useState([]);
  const [limit] = useState(30);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  
  // Search & Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  
  // UI states
  const [selectedItem, setSelectedItem] = useState(null);
  const [darkMode, setDarkMode] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  
  // Modals
  const [showClearModal, setShowClearModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [ignorePatternsText, setIgnorePatternsText] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [keepFavoritesOnClear, setKeepFavoritesOnClear] = useState(true);
  const [exportOnlyFavorites, setExportOnlyFavorites] = useState(false);

  const loaderRef = useRef(null);

  // Toggle Dark Mode
  useEffect(() => {
    if (darkMode) {
      document.body.classList.add('dark');
      document.body.style.backgroundColor = '#1C1917';
      document.body.style.color = '#E7E5E4';
    } else {
      document.body.classList.remove('dark');
      document.body.style.backgroundColor = '#F4EFEA';
      document.body.style.color = '#3C2F2F';
    }
  }, [darkMode]);

  // Reset offset and fetch when filters change
  useEffect(() => {
    setItems([]);
    setOffset(0);
    setHasMore(true);
    fetchHistory(0, true);
  }, [searchTerm, selectedType, favoritesOnly]);

  // Infinite Scroll Observer
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      const target = entries[0];
      if (target.isIntersecting && hasMore && !loading) {
        setOffset((prevOffset) => {
          const nextOffset = prevOffset + limit;
          fetchHistory(nextOffset, false);
          return nextOffset;
        });
      }
    }, { threshold: 0.1 });

    if (loaderRef.current) {
      observer.observe(loaderRef.current);
    }

    return () => {
      if (loaderRef.current) {
        observer.unobserve(loaderRef.current);
      }
    };
  }, [hasMore, loading, offset]);

  // Fetch History via direct Electron IPC
  const fetchHistory = async (currentOffset, reset = false) => {
    if (loading) return;
    setLoading(true);
    
    try {
      const data = await window.api.getClipboardHistory({
        limit,
        offset: currentOffset,
        search: searchTerm,
        favoritesOnly,
        type: selectedType
      });
      
      if (data.length < limit) {
        setHasMore(false);
      }
      
      if (reset) {
        setItems(data);
      } else {
        setItems((prev) => [...prev, ...data]);
      }
    } catch (err) {
      console.error('Error fetching clipboard history:', err);
    } finally {
      setLoading(false);
    }
  };

  const showStatus = (msg) => {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage(''), 2000);
  };

  // Copy to Clipboard
  const handleCopyToClipboard = async (item) => {
    try {
      const res = await window.api.copyToClipboard({
        content: item.content,
        type: item.content_type,
        filePath: item.file_path
      });
      if (res.status === 'success') {
        showStatus('Copied to clipboard!');
        // Refresh local timestamp/access_count without complete reload
        setItems(items.map(i => i.id === item.id ? { ...i, access_count: i.access_count + 1, timestamp: new Date().toISOString() } : i));
        if (selectedItem && selectedItem.id === item.id) {
          setSelectedItem({ ...selectedItem, access_count: selectedItem.access_count + 1 });
        }
      }
    } catch (err) {
      console.error('Copy error:', err);
    }
  };

  // Toggle Favorite
  const handleToggleFavorite = async (item) => {
    try {
      const res = await window.api.toggleFavorite(item.id);
      if (res.status === 'success') {
        const updatedItem = { ...item, is_favorite: item.is_favorite ? 0 : 1 };
        if (selectedItem && selectedItem.id === item.id) {
          setSelectedItem(updatedItem);
        }
        setItems(items.map(i => i.id === item.id ? updatedItem : i));
        showStatus(updatedItem.is_favorite ? 'Added to favorites' : 'Removed from favorites');
      }
    } catch (err) {
      console.error('Favorite error:', err);
    }
  };

  // Delete Item
  const handleDeleteItem = async (item) => {
    try {
      const res = await window.api.deleteItem(item.id);
      if (res.status === 'success') {
        if (selectedItem && selectedItem.id === item.id) {
          setSelectedItem(null);
        }
        setItems(items.filter(i => i.id !== item.id));
        showStatus('Deleted history item');
      }
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  // Open/View
  const handleOpenItem = async (item) => {
    try {
      await window.api.openItem({
        content: item.content,
        type: item.content_type,
        filePath: item.file_path
      });
      showStatus('Opened successfully');
    } catch (err) {
      console.error('Open error:', err);
      alert(`Error opening item: ${err.message}`);
    }
  };

  // Clear History
  const handleClearHistory = async () => {
    try {
      const res = await window.api.clearHistory(keepFavoritesOnClear);
      if (res.status === 'success') {
        setItems(keepFavoritesOnClear ? items.filter(i => i.is_favorite === 1) : []);
        setSelectedItem(null);
        setShowClearModal(false);
        showStatus('Clipboard history cleared');
      }
    } catch (err) {
      console.error('Clear history error:', err);
    }
  };

  // Export JSON
  const handleExportJSON = async () => {
    try {
      const res = await window.api.exportToJson({ favoritesOnly: exportOnlyFavorites });
      if (res.status === 'success') {
        showStatus(`Exported ${res.count} items!`);
        setShowExportModal(false);
      }
    } catch (err) {
      console.error('Export error:', err);
    }
  };

  const formatSize = (bytes) => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateStr) => {
    try {
      // Handle SQLite format like '2026-05-30 05:00:00' or ISO strings
      const normalized = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
      const d = new Date(normalized);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch (e) {
      return dateStr;
    }
  };

  const isUrl = (text) => {
    try {
      const trimmed = text.trim();
      return trimmed.startsWith('http://') || trimmed.startsWith('https://');
    } catch (e) {
      return false;
    }
  };

  return (
    <div className={`h-screen flex flex-col ${darkMode ? 'dark bg-retro-bg-dark text-retro-text-dark' : 'bg-retro-bg-light text-retro-text-light'} transition-colors duration-200 overflow-hidden`}>
      
      {/* Toast Notification */}
      {statusMessage && (
        <div className="fixed bottom-6 right-6 bg-retro-orange text-white px-4 py-2.5 rounded shadow-lg text-sm font-semibold z-50 animate-bounce">
          {statusMessage}
        </div>
      )}

      {/* Header */}
      <header className="border-b border-retro-border-light dark:border-retro-border-dark py-4 px-6 flex items-center justify-between sticky top-0 bg-retro-bg-light/95 dark:bg-retro-bg-dark/95 backdrop-blur z-20">
        <div className="flex items-center space-x-3">
          <div className="bg-retro-orange p-2 rounded text-white shadow-sm">
            <Clipboard size={22} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">kb-clipboard</h1>
            <p className="text-xs opacity-60">Knowledge-Base Clipboard Explorer</p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={async () => {
              try {
                const text = await window.api.getIgnorePatterns();
                setIgnorePatternsText(text || '');
                setShowSettingsModal(true);
              } catch (err) {
                console.error('Failed to load ignore patterns:', err);
              }
            }}
            className="hidden sm:flex items-center space-x-1 px-3 py-1.5 text-xs bg-retro-panel-light dark:bg-retro-panel-dark border border-retro-border-light dark:border-retro-border-dark hover:border-retro-orange rounded font-semibold transition-colors"
            title="Ignore Settings"
          >
            <Settings size={14} />
            <span>Settings</span>
          </button>

          <button
            onClick={() => setShowExportModal(true)}
            className="hidden sm:flex items-center space-x-1 px-3 py-1.5 text-xs bg-retro-panel-light dark:bg-retro-panel-dark border border-retro-border-light dark:border-retro-border-dark hover:border-retro-orange rounded font-semibold transition-colors"
            title="Export History"
          >
            <Download size={14} />
            <span>Export</span>
          </button>

          <button
            onClick={() => setShowClearModal(true)}
            className="hidden sm:flex items-center space-x-1 px-3 py-1.5 text-xs bg-retro-panel-light dark:bg-retro-panel-dark border border-retro-border-light dark:border-retro-border-dark hover:border-retro-red/60 hover:text-retro-red rounded font-semibold transition-colors"
            title="Clear History"
          >
            <Trash2 size={14} />
            <span>Clear</span>
          </button>

          <button
            onClick={() => setDarkMode(!darkMode)}
            className="p-2 hover:bg-retro-panel-light dark:hover:bg-retro-panel-dark rounded-full transition-colors"
            title="Toggle theme"
          >
            {darkMode ? <Sun size={18} className="text-retro-yellow" /> : <Moon size={18} className="text-retro-blue" />}
          </button>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        
        {/* Sidebar */}
        <aside className="w-full md:w-64 p-6 border-r border-retro-border-light dark:border-retro-border-dark flex flex-col space-y-6 md:overflow-y-auto">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider opacity-60">Search</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Search clipboard..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm bg-retro-panel-light dark:bg-retro-panel-dark border border-retro-border-light dark:border-retro-border-dark rounded focus:outline-none focus:border-retro-orange transition-colors"
              />
              <Search className="absolute left-3 top-2.5 text-retro-text-light/50 dark:text-retro-text-dark/50" size={16} />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider opacity-60">Filter Content</label>
            <div className="flex flex-col space-y-1">
              {[
                { id: 'all', label: 'All History' },
                { id: 'text', label: 'Texts & Links' },
                { id: 'file', label: 'Files' },
                { id: 'image', label: 'Images' }
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedType(t.id)}
                  className={`text-left px-3 py-2 rounded text-sm transition-colors flex items-center justify-between ${selectedType === t.id ? 'bg-retro-panel-light dark:bg-retro-panel-dark font-medium text-retro-orange' : 'hover:bg-retro-panel-light/50 dark:hover:bg-retro-panel-dark/50'}`}
                >
                  <span>{t.label}</span>
                  <ChevronRight size={14} className={selectedType === t.id ? 'opacity-100' : 'opacity-0'} />
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider opacity-60">Starred</label>
            <button
              onClick={() => setFavoritesOnly(!favoritesOnly)}
              className={`w-full text-left px-3 py-2 rounded text-sm transition-colors flex items-center justify-between ${favoritesOnly ? 'bg-retro-panel-light dark:bg-retro-panel-dark font-medium text-retro-yellow' : 'hover:bg-retro-panel-light/50 dark:hover:bg-retro-panel-dark/50'}`}
            >
              <span className="flex items-center space-x-2">
                <Star size={14} className={favoritesOnly ? 'fill-retro-yellow text-retro-yellow' : ''} />
                <span>Favorites Only</span>
              </span>
              <ChevronRight size={14} className={favoritesOnly ? 'opacity-100' : 'opacity-0'} />
            </button>
          </div>

          <div className="pt-6 border-t border-retro-border-light dark:border-retro-border-dark mt-auto text-xs opacity-55">
            <p>Database: sqlite (direct)</p>
            <p>Records: {items.length} visible</p>
          </div>
        </aside>

        {/* Content list */}
        <main className="flex-1 p-6 flex flex-col md:overflow-y-auto">
          
          <div className="sm:hidden flex items-center space-x-2 mb-4">
            <button
              onClick={async () => {
                try {
                  const text = await window.api.getIgnorePatterns();
                  setIgnorePatternsText(text || '');
                  setShowSettingsModal(true);
                } catch (err) {
                  console.error('Failed to load ignore patterns:', err);
                }
              }}
              className="flex-1 flex items-center justify-center space-x-1 py-2 text-xs bg-retro-panel-light dark:bg-retro-panel-dark border border-retro-border-light dark:border-retro-border-dark rounded font-semibold"
            >
              <Settings size={14} />
              <span>Settings</span>
            </button>
            <button
              onClick={() => setShowExportModal(true)}
              className="flex-1 flex items-center justify-center space-x-1 py-2 text-xs bg-retro-panel-light dark:bg-retro-panel-dark border border-retro-border-light dark:border-retro-border-dark rounded font-semibold"
            >
              <Download size={14} />
              <span>Export</span>
            </button>
            <button
              onClick={() => setShowClearModal(true)}
              className="flex-1 flex items-center justify-center space-x-1 py-2 text-xs bg-retro-panel-light dark:bg-retro-panel-dark border border-retro-border-light dark:border-retro-border-dark hover:text-retro-red rounded font-semibold"
            >
              <Trash2 size={14} />
              <span>Clear</span>
            </button>
          </div>

          {items.length === 0 && !loading ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
              <Clipboard className="opacity-30 mb-4" size={48} />
              <h3 className="text-lg font-semibold">No history found</h3>
              <p className="text-sm opacity-60 max-w-sm mt-1">Copy text, files, or images to the OS clipboard to see them populated here automatically.</p>
            </div>
          ) : (
            <div className="flex flex-col space-y-3">
              {items.map((item) => (
                <div
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  className={`group cursor-pointer p-4 bg-retro-panel-light dark:bg-retro-panel-dark border ${selectedItem && selectedItem.id === item.id ? 'border-retro-orange/80 shadow-md' : 'border-retro-border-light dark:border-retro-border-dark'} hover:border-retro-orange/60 dark:hover:border-retro-orange/60 rounded transition-all duration-150 flex items-center justify-between`}
                >
                  <div className="flex items-center space-x-4 min-w-0 flex-1">
                    <div className="flex-shrink-0 w-9 h-9 bg-retro-bg-light dark:bg-retro-bg-dark rounded text-retro-orange flex items-center justify-center overflow-hidden">
                      {item.content_type === 'file' ? (
                        <Folder size={18} />
                      ) : item.content_type === 'image' ? (
                        item.thumbnail ? (
                          <img 
                            src={`data:image/png;base64,${item.thumbnail}`} 
                            alt="thumbnail" 
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <ImageIcon size={18} />
                        )
                      ) : isUrl(item.content) ? (
                        <LinkIcon size={18} className="text-retro-blue" />
                      ) : (
                        <FileText size={18} className="text-retro-text-light/70 dark:text-retro-text-dark/70" />
                      )}
                    </div>
                    
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold truncate leading-tight">
                        {item.content_type === 'file' ? (
                          item.file_path ? item.file_path.split(/[\\/]/).pop() : 'File'
                        ) : item.content_type === 'image' ? (
                          'Clipboard Image'
                        ) : (
                          item.content
                        )}
                      </div>
                      <div className="text-xs opacity-50 flex items-center space-x-2 mt-1">
                        <span>{formatDate(item.timestamp)}</span>
                        <span>•</span>
                        <span className="capitalize">{item.content_type}</span>
                        {item.file_size > 0 && (
                          <>
                            <span>•</span>
                            <span>{formatSize(item.file_size)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 ml-4 flex-shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleToggleFavorite(item); }}
                      className="p-1.5 hover:bg-retro-bg-light dark:hover:bg-retro-bg-dark rounded text-retro-yellow transition-colors"
                      title="Favorite"
                    >
                      <Star size={15} className={item.is_favorite ? 'fill-retro-yellow' : ''} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleCopyToClipboard(item); }}
                      className="p-1.5 hover:bg-retro-bg-light dark:hover:bg-retro-bg-dark rounded text-retro-orange transition-colors"
                      title="Copy to Clipboard"
                    >
                      <Copy size={15} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteItem(item); }}
                      className="p-1.5 hover:bg-retro-bg-light dark:hover:bg-retro-bg-dark rounded hover:text-retro-red transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div ref={loaderRef} className="py-8 flex justify-center">
            {loading && (
              <RefreshCw className="animate-spin text-retro-orange" size={24} />
            )}
          </div>
        </main>
      </div>

      {/* Detail drawer */}
      {selectedItem && (
        <div className="fixed inset-0 bg-black/55 backdrop-blur-sm flex justify-end z-50 transition-opacity">
          <div className="absolute inset-0" onClick={() => setSelectedItem(null)} />
          <div className="relative w-full max-w-2xl bg-retro-bg-light dark:bg-retro-bg-dark h-full shadow-2xl flex flex-col border-l border-retro-border-light dark:border-retro-border-dark animate-slide-in">
            
            <div className="p-4 border-b border-retro-border-light dark:border-retro-border-dark flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Clipboard className="text-retro-orange" size={18} />
                <h2 className="font-bold truncate max-w-md">Item Details</h2>
              </div>
              <button 
                onClick={() => setSelectedItem(null)}
                className="p-1.5 hover:bg-retro-panel-light dark:hover:bg-retro-panel-dark rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              
              {/* Preview container */}
              <div className="border border-retro-border-light dark:border-retro-border-dark rounded p-4 bg-retro-panel-light/30 dark:bg-retro-panel-dark/30 shadow-inner">
                {selectedItem.content_type === 'image' ? (
                  <div className="flex items-center justify-center max-h-96 overflow-hidden bg-stone-200 dark:bg-stone-850 rounded">
                    <img 
                      src={`data:image/png;base64,${selectedItem.content}`} 
                      alt="Clipboard preview"
                      className="max-h-96 object-contain"
                    />
                  </div>
                ) : selectedItem.content_type === 'file' ? (
                  <div className="space-y-2 p-3 text-sm">
                    <div className="flex items-center space-x-2 text-retro-orange font-bold">
                      <Folder size={18} />
                      <span>Local File Object</span>
                    </div>
                    <div className="font-mono text-xs break-all bg-retro-bg-light dark:bg-retro-bg-dark p-2 rounded">
                      {selectedItem.file_path}
                    </div>
                  </div>
                ) : (
                  <div className="max-h-96 overflow-y-auto font-mono text-sm break-all whitespace-pre-wrap select-text bg-retro-bg-light dark:bg-retro-bg-dark p-4 rounded">
                    {isUrl(selectedItem.content) ? (
                      <a 
                        href={selectedItem.content.trim()} 
                        target="_blank" 
                        rel="noreferrer"
                        className="text-retro-blue hover:underline flex items-center space-x-1 inline-flex"
                      >
                        <span>{selectedItem.content}</span>
                        <ExternalLink size={12} />
                      </a>
                    ) : (
                      selectedItem.content
                    )}
                  </div>
                )}
              </div>

              {/* Metadata parameters */}
              <div className="bg-retro-panel-light dark:bg-retro-panel-dark p-4 rounded border border-retro-border-light dark:border-retro-border-dark grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-[10px] uppercase font-bold opacity-50 block">Type</span>
                  <span className="font-semibold capitalize">{selectedItem.content_type}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold opacity-50 block">Access Count</span>
                  <span className="font-semibold">{selectedItem.access_count} times</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold opacity-50 block">Created</span>
                  <span className="font-medium text-xs break-all">{formatDate(selectedItem.timestamp)}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold opacity-50 block">Mime Type</span>
                  <span className="font-medium text-xs break-all truncate">{selectedItem.mime_type || 'N/A'}</span>
                </div>
                {selectedItem.file_size > 0 && (
                  <div>
                    <span className="text-[10px] uppercase font-bold opacity-50 block">Size</span>
                    <span className="font-semibold">{formatSize(selectedItem.file_size)}</span>
                  </div>
                )}
                <div>
                  <span className="text-[10px] uppercase font-bold opacity-50 block">Hash</span>
                  <span className="font-mono text-[10px] break-all">{selectedItem.content_hash}</span>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2 pt-2 border-t border-retro-border-light/40 dark:border-retro-border-dark/40">
                <button
                  onClick={() => handleCopyToClipboard(selectedItem)}
                  className="flex-1 flex items-center justify-center space-x-2 py-2.5 px-4 bg-retro-orange hover:bg-retro-orange/95 text-white rounded text-sm font-semibold transition-colors shadow-sm"
                >
                  <Copy size={16} />
                  <span>Copy to Clipboard</span>
                </button>
                
                <button
                  onClick={() => handleToggleFavorite(selectedItem)}
                  className="flex-1 flex items-center justify-center space-x-2 py-2.5 px-4 bg-retro-panel-light dark:bg-retro-panel-dark border border-retro-border-light dark:border-retro-border-dark hover:border-retro-yellow rounded text-sm font-semibold transition-colors"
                >
                  <Star size={16} className={selectedItem.is_favorite ? 'fill-retro-yellow text-retro-yellow' : ''} />
                  <span>{selectedItem.is_favorite ? 'Starred' : 'Star Item'}</span>
                </button>

                {(selectedItem.content_type === 'file' || isUrl(selectedItem.content) || selectedItem.content_type === 'image') && (
                  <button
                    onClick={() => handleOpenItem(selectedItem)}
                    className="flex-1 flex items-center justify-center space-x-2 py-2.5 px-4 bg-retro-panel-light dark:bg-retro-panel-dark border border-retro-border-light dark:border-retro-border-dark hover:border-retro-blue rounded text-sm font-semibold transition-colors"
                  >
                    <ExternalLink size={16} />
                    <span>Open / View</span>
                  </button>
                )}

                <button
                  onClick={() => handleDeleteItem(selectedItem)}
                  className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 bg-retro-panel-light dark:bg-retro-panel-dark border border-retro-border-light dark:border-retro-border-dark hover:border-retro-red/60 hover:text-retro-red rounded text-sm font-semibold transition-colors"
                >
                  <Trash2 size={16} />
                  <span>Delete History</span>
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* Clear History Modal */}
      {showClearModal && (
        <div className="fixed inset-0 bg-black/55 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-retro-bg-light dark:bg-retro-bg-dark border border-retro-border-light dark:border-retro-border-dark p-6 rounded shadow-2xl w-full max-w-md space-y-4">
            <h2 className="text-lg font-bold text-retro-red">Clear History</h2>
            <p className="text-sm opacity-80">Are you sure you want to delete clipboard history? This action cannot be undone.</p>
            
            <label className="flex items-center space-x-2 cursor-pointer pt-2">
              <input
                type="checkbox"
                checked={keepFavoritesOnClear}
                onChange={(e) => setKeepFavoritesOnClear(e.target.checked)}
                className="rounded border-retro-border-light bg-retro-panel-light text-retro-orange focus:ring-retro-orange"
              />
              <span className="text-xs font-semibold uppercase tracking-wider opacity-85">Keep Starred Favorites</span>
            </label>

            <div className="flex justify-end space-x-3 pt-3 border-t border-retro-border-light dark:border-retro-border-dark">
              <button
                onClick={() => setShowClearModal(false)}
                className="px-4 py-2 text-xs border border-retro-border-light dark:border-retro-border-dark hover:bg-retro-panel-light/50 dark:hover:bg-retro-panel-dark/50 rounded font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleClearHistory}
                className="px-4 py-2 text-xs bg-retro-red hover:bg-retro-red/90 text-white rounded font-semibold transition-colors shadow-sm"
              >
                Clear History
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/55 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-retro-bg-light dark:bg-retro-bg-dark border border-retro-border-light dark:border-retro-border-dark p-6 rounded shadow-2xl w-full max-w-md space-y-4">
            <h2 className="text-lg font-bold text-retro-orange">Export History</h2>
            <p className="text-sm opacity-80">Select export configuration. The data will be saved as a formatted JSON document.</p>
            
            <label className="flex items-center space-x-2 cursor-pointer pt-2">
              <input
                type="checkbox"
                checked={exportOnlyFavorites}
                onChange={(e) => setExportOnlyFavorites(e.target.checked)}
                className="rounded border-retro-border-light bg-retro-panel-light text-retro-orange focus:ring-retro-orange"
              />
              <span className="text-xs font-semibold uppercase tracking-wider opacity-85">Export Favorites Only</span>
            </label>

            <div className="flex justify-end space-x-3 pt-3 border-t border-retro-border-light dark:border-retro-border-dark">
              <button
                onClick={() => setShowExportModal(false)}
                className="px-4 py-2 text-xs border border-retro-border-light dark:border-retro-border-dark hover:bg-retro-panel-light/50 dark:hover:bg-retro-panel-dark/50 rounded font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleExportJSON}
                className="px-4 py-2 text-xs bg-retro-orange hover:bg-retro-orange/90 text-white rounded font-semibold transition-colors shadow-sm"
              >
                Export JSON
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/55 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-retro-bg-light dark:bg-retro-bg-dark border border-retro-border-light dark:border-retro-border-dark p-6 rounded shadow-2xl w-full max-w-lg space-y-4">
            <div className="flex items-center justify-between border-b border-retro-border-light dark:border-retro-border-dark pb-3">
              <h2 className="text-lg font-bold text-retro-orange flex items-center space-x-2">
                <Settings size={18} />
                <span>Ignore Pattern Settings</span>
              </h2>
              <button 
                onClick={() => setShowSettingsModal(false)}
                className="p-1 hover:bg-retro-panel-light dark:hover:bg-retro-panel-dark rounded-full transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            
            <p className="text-sm opacity-80">
              Define regular expression patterns to automatically ignore and discard clipboard records (e.g. passwords, sensitive files).
            </p>

            <textarea
              value={ignorePatternsText}
              onChange={(e) => setIgnorePatternsText(e.target.value)}
              className="w-full h-64 p-3 bg-retro-panel-light dark:bg-retro-panel-dark border border-retro-border-light dark:border-retro-border-dark rounded font-mono text-sm focus:outline-none focus:border-retro-orange resize-y"
              placeholder="# Example ignore patterns&#10;# Ignore strings containing 'password'&#10;password&#10;# Ignore token keys&#10;[A-Za-z0-9+/]{40}&#10;# Ignore specific file paths&#10;.*\\.env"
            />

            <div className="bg-retro-panel-light/40 dark:bg-retro-panel-dark/40 border border-retro-border-light/60 dark:border-retro-border-dark/60 p-3 rounded text-xs space-y-1">
              <div className="font-bold opacity-80 uppercase tracking-wider">Guidelines:</div>
              <ul className="list-disc pl-4 space-y-1 opacity-75">
                <li>One regular expression pattern per line.</li>
                <li>Lines starting with <code className="font-mono bg-stone-250 dark:bg-stone-800 px-1 py-0.5 rounded">#</code> are comments.</li>
                <li>Blank/empty lines are ignored.</li>
                <li>Matches are evaluated against texts, file paths, and filenames.</li>
              </ul>
            </div>

            <div className="flex justify-end space-x-3 pt-3 border-t border-retro-border-light dark:border-retro-border-dark">
              <button
                onClick={() => setShowSettingsModal(false)}
                className="px-4 py-2 text-xs border border-retro-border-light dark:border-retro-border-dark hover:bg-retro-panel-light/50 dark:hover:bg-retro-panel-dark/50 rounded font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setSavingSettings(true);
                  try {
                    await window.api.saveIgnorePatterns(ignorePatternsText);
                    showStatus('Ignore patterns saved successfully!');
                    setShowSettingsModal(false);
                  } catch (err) {
                    console.error('Failed to save ignore patterns:', err);
                    alert('Error saving patterns: ' + err.message);
                  } finally {
                    setSavingSettings(false);
                  }
                }}
                disabled={savingSettings}
                className="px-4 py-2 text-xs bg-retro-orange hover:bg-retro-orange/90 text-white rounded font-semibold transition-colors shadow-sm disabled:opacity-50"
              >
                {savingSettings ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
