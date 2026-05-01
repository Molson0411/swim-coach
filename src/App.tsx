import React, { useState, useRef, useEffect, Component } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Waves, 
  Activity, 
  ChevronRight, 
  RotateCcw, 
  Upload,
  Info,
  Play,
  Video,
  Target,
  Quote,
  Timer,
  Zap,
  ArrowLeft,
  FileText,
  Trophy,
  Dumbbell,
  Instagram,
  Mail,
  History,
  LogOut,
  LogIn,
  User as UserIcon,
  Trash2
} from 'lucide-react';
import { analyzeSwim } from './services/gemini';
import { AnalysisReport, AnalysisMode } from './types';
import { cn } from './lib/utils';
import { Toaster, toast } from 'sonner';
import {
  auth,
  db,
  completeGoogleRedirectSignIn,
  getAuthErrorMessage,
  signInWithGoogle,
  logout,
  handleFirestoreError,
  OperationType
} from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, deleteDoc, doc } from 'firebase/firestore';

// Confirm Modal Component
function ConfirmModal({ isOpen, title, message, onConfirm, onCancel }: { 
  isOpen: boolean, 
  title: string, 
  message: string, 
  onConfirm: () => void, 
  onCancel: () => void 
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-white p-8 rounded-[2.5rem] shadow-2xl max-w-sm w-full space-y-6"
          >
            <div className="space-y-2">
              <h3 className="text-xl font-bold font-serif italic text-ink">{title}</h3>
              <p className="text-sm text-ink/60 leading-relaxed">{message}</p>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={onCancel}
                className="flex-1 py-3 rounded-xl font-bold uppercase tracking-widest text-[10px] border border-ink/10 hover:bg-ink/5 transition-all"
              >
                Cancel
              </button>
              <button 
                onClick={onConfirm}
                className="flex-1 py-3 rounded-xl font-bold uppercase tracking-widest text-[10px] bg-red-500 text-white hover:bg-red-600 transition-all shadow-lg shadow-red-500/20"
              >
                Confirm
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

// Error Boundary Component
class ErrorBoundary extends React.Component<any, any> {
  // @ts-ignore
  state = { hasError: false, errorInfo: '' };

  static getDerivedStateFromError(error: any) {
    return { hasError: true, errorInfo: error.message };
  }

  render() {
    // @ts-ignore
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-paper p-6">
          <div className="bg-white p-8 rounded-[2rem] shadow-xl max-w-md w-full text-center space-y-4">
            <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto">
              <Info className="w-8 h-8" />
            </div>
            <h2 className="text-xl sm:text-2xl font-bold font-serif italic text-ink leading-snug">Something went wrong</h2>
            <p className="text-sm text-ink/60 leading-relaxed">
              We encountered an error. Please try refreshing the page.
            </p>
            <div className="p-4 bg-red-50 rounded-xl text-left overflow-auto max-h-32">
              {/* @ts-ignore */}
              <code className="text-[10px] text-red-600">{this.state.errorInfo}</code>
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-ink text-white py-4 rounded-xl font-bold uppercase tracking-widest hover:bg-ink/90 transition-all"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }
    // @ts-ignore
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
      <Toaster position="top-center" richColors />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [mode, setMode] = useState<AnalysisMode | null>(null);
  const [activeTab, setActiveTab] = useState<'input' | 'report' | 'history'>('input');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [progress, setProgress] = useState(0);
  const [history, setHistory] = useState<(AnalysisReport & { id: string, createdAt: any, event?: string })[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<{ isOpen: boolean, id: string }>({ isOpen: false, id: '' });
  
  // Mode A Inputs
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [videoBase64, setVideoBase64] = useState<string | null>(null);
  const [textInput, setTextInput] = useState('');
  const [eventA, setEventA] = useState('');

  // Mode B Inputs
  const [raceEntries, setRaceEntries] = useState([
    { id: Date.now(), event: '50公尺自由式', customEvent: '', time: '', strokeCount: '', poolLength: '50', splits: '' }
  ]);

  const commonEvents = [
    '50公尺自由式', '100公尺自由式', '200公尺自由式', '400公尺自由式', '800公尺自由式', '1500公尺自由式',
    '50公尺仰式', '100公尺仰式', '200公尺仰式',
    '50公尺蛙式', '100公尺蛙式', '200公尺蛙式',
    '50公尺蝶式', '100公尺蝶式', '200公尺蝶式',
    '200公尺個人混合式', '400公尺個人混合式',
    '其他'
  ];

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    completeGoogleRedirectSignIn()
      .then((redirectUser) => {
        if (redirectUser) {
          toast.success('登入成功');
        }
      })
      .catch((error) => {
        toast.error(getAuthErrorMessage(error));
      });

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    if (window.location.hostname === '127.0.0.1') {
      toast.info('Firebase 登入需要使用 localhost，正在切換網址...');
      window.location.replace(
        `${window.location.protocol}//localhost:${window.location.port}${window.location.pathname}${window.location.search}${window.location.hash}`
      );
      return;
    }

    setIsSigningIn(true);
    const toastId = toast.loading('正在開啟 Google 登入...');
    try {
      const signedInUser = await signInWithGoogle();
      if (signedInUser) {
        toast.success('登入成功', { id: toastId });
      } else {
        toast.info('正在前往 Google 登入...', { id: toastId });
      }
    } catch (error) {
      toast.error(getAuthErrorMessage(error), { id: toastId });
    } finally {
      setIsSigningIn(false);
    }
  };

  useEffect(() => {
    if (user) {
      const q = query(
        collection(db, 'reports'),
        where('uid', '==', user.uid),
        orderBy('createdAt', 'desc')
      );

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const reports = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as any[];
        setHistory(reports);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'reports');
      });

      return () => unsubscribe();
    } else {
      setHistory([]);
    }
  }, [user]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setVideoFile(file);
      setVideoPreview(URL.createObjectURL(file));
      
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = (reader.result as string).split(',')[1];
        setVideoBase64(base64String);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAnalyze = async () => {
    if (!mode) return;
    
    if (mode === 'A' && !eventA) {
      toast.error('請填寫游泳項目 (例如：50公尺自由式)');
      return;
    }
    if (mode === 'B') {
      const isValid = raceEntries.every(entry => 
        entry.event && (entry.event !== '其他' || entry.customEvent) && entry.time && entry.poolLength
      );
      if (!isValid) {
        toast.error('請填寫所有比賽項目的必填欄位 (項目、秒數與泳池長度)');
        return;
      }
    }

    setIsAnalyzing(true);
    setProgress(0);
    
    // Simulate progress
    const progressInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 95) return prev;
        const diff = Math.random() * 10;
        return Math.min(prev + diff, 95);
      });
    }, 800);

    try {
      const result = await analyzeSwim(mode, {
        videoBase64: mode === 'A' ? videoBase64 || undefined : undefined,
        textInput: mode === 'A' ? textInput : undefined,
        event: mode === 'A' ? eventA : undefined,
        raceEntries: mode === 'B' ? raceEntries.map(e => ({
          event: e.event === '其他' ? e.customEvent : e.event,
          time: e.time,
          strokeCount: e.strokeCount,
          poolLength: e.poolLength,
          splits: e.splits
        })) : undefined
      });

      // Save to Firestore if logged in
      if (user) {
        try {
          await addDoc(collection(db, 'reports'), {
            ...result,
            uid: user.uid,
            createdAt: serverTimestamp(),
            event: mode === 'A' ? eventA : (raceEntries[0].event === '其他' ? raceEntries[0].customEvent : raceEntries[0].event)
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, 'reports');
        }
      }

      setProgress(100);
      setTimeout(() => {
        setReport(result);
        setActiveTab('report');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 500);
    } catch (error) {
      console.error('Analysis failed:', error);
      toast.error('分析失敗，請稍後再試。');
    } finally {
      clearInterval(progressInterval);
      setIsAnalyzing(false);
      setProgress(0);
    }
  };

  const resetMode = () => {
    setMode(null);
    setReport(null);
    setActiveTab('input');
    setVideoFile(null);
    setVideoPreview(null);
    setVideoBase64(null);
    setTextInput('');
    setEventA('');
    setRaceEntries([
      { id: Date.now(), event: '50公尺自由式', customEvent: '', time: '', strokeCount: '', poolLength: '50', splits: '' }
    ]);
  };

  const addRaceEntry = () => {
    setRaceEntries([
      ...raceEntries,
      { id: Date.now(), event: '50公尺自由式', customEvent: '', time: '', strokeCount: '', poolLength: '50', splits: '' }
    ]);
  };

  const removeRaceEntry = (id: number) => {
    if (raceEntries.length > 1) {
      setRaceEntries(raceEntries.filter(e => e.id !== id));
    }
  };

  const updateRaceEntry = (id: number, field: string, value: string) => {
    setRaceEntries(raceEntries.map(e => e.id === id ? { ...e, [field]: value } : e));
  };

  const deleteHistoryItem = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setConfirmDelete({ isOpen: true, id });
  };

  const handleConfirmDelete = async () => {
    const id = confirmDelete.id;
    setConfirmDelete({ isOpen: false, id: '' });
    try {
      await deleteDoc(doc(db, 'reports', id));
      toast.success('紀錄已刪除');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'reports');
    }
  };

  return (
    <div className="min-h-screen bg-paper text-ink font-sans selection:bg-accent selection:text-white">
      <ConfirmModal 
        isOpen={confirmDelete.isOpen}
        title="Delete Record"
        message="確定要刪除這筆紀錄嗎？此動作無法復原。"
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDelete({ isOpen: false, id: '' })}
      />
      {/* Header */}
      <header className="border-b border-ink/10 p-4 md:p-6 flex flex-col sm:flex-row justify-between items-center bg-white/80 backdrop-blur-md sticky top-0 z-50 gap-4 sm:gap-0">
        <div className="flex items-center gap-3 cursor-pointer w-full sm:w-auto" onClick={resetMode}>
          <div className="bg-accent p-2 rounded-xl shadow-lg shadow-accent/20">
            <Waves className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-bold tracking-tight uppercase italic font-serif text-ink">SwimFlow AI</h1>
            <p className="text-[9px] sm:text-[10px] uppercase tracking-widest opacity-50 font-mono text-accent font-bold">Dual-Mode Coach v3.0</p>
          </div>
        </div>
        
        <div className="flex items-center justify-between sm:justify-end gap-4 w-full sm:w-auto">
          {user ? (
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-widest font-bold opacity-50 hidden sm:block">Athlete</p>
                <p className="text-xs font-bold sm:hidden opacity-50 uppercase tracking-widest">Athlete</p>
                <p className="text-xs font-bold">{user.displayName}</p>
              </div>
              <button 
                onClick={() => setActiveTab('history')}
                className={cn(
                  "p-2 rounded-xl transition-all",
                  activeTab === 'history' ? "bg-accent text-white shadow-lg shadow-accent/20" : "bg-ink/5 text-ink/60 hover:bg-ink/10 hover:text-ink"
                )}
                title="History"
              >
                <History className="w-5 h-5" />
              </button>
              <button 
                onClick={logout}
                className="p-2 bg-ink/5 text-ink/60 hover:bg-ink/10 hover:text-ink rounded-xl transition-all"
                title="Logout"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <button 
              onClick={handleSignIn}
              disabled={!isAuthReady || isSigningIn}
              className="flex items-center gap-2 bg-ink text-white px-6 py-2 rounded-xl text-[11px] uppercase tracking-widest font-bold hover:bg-ink/90 transition-all shadow-lg shadow-ink/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <LogIn className="w-4 h-4" /> {isSigningIn ? 'Signing in...' : 'Login'}
            </button>
          )}

          {mode && (
            <div className="flex gap-2 bg-ink/5 p-1 rounded-2xl">
              <button 
                onClick={() => setActiveTab('input')}
                className={cn(
                  "text-xs sm:text-[11px] uppercase tracking-widest px-4 sm:px-6 py-2 transition-all rounded-xl font-bold",
                  activeTab === 'input' ? "bg-white text-accent shadow-sm" : "text-ink/60 hover:text-ink"
                )}
              >
                Input
              </button>
              <button 
                onClick={() => report && setActiveTab('report')}
                disabled={!report}
                className={cn(
                  "text-xs sm:text-[11px] uppercase tracking-widest px-4 sm:px-6 py-2 transition-all rounded-xl font-bold",
                  activeTab === 'report' ? "bg-white text-accent shadow-sm" : "disabled:opacity-20 text-ink/60 hover:text-ink"
                )}
              >
                Report
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-6">
        <AnimatePresence mode="wait">
          {activeTab === 'history' ? (
            <motion.div 
              key="history-view"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-4xl mx-auto pt-4 sm:pt-8 space-y-6 sm:space-y-8"
            >
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h2 className="text-2xl sm:text-4xl font-bold uppercase tracking-tight font-serif italic">Analysis History</h2>
                <button 
                  onClick={() => setActiveTab('input')}
                  className="text-[10px] uppercase tracking-widest font-bold opacity-50 hover:opacity-100 transition-opacity flex items-center gap-2"
                >
                  <ArrowLeft className="w-3 h-3" /> Back to App
                </button>
              </div>

              {history.length === 0 ? (
                <div className="bg-white border border-ink/5 p-16 rounded-[3rem] text-center space-y-4">
                  <div className="w-16 h-16 bg-ink/5 text-ink/20 rounded-full flex items-center justify-center mx-auto">
                    <History className="w-8 h-8" />
                  </div>
                  <p className="text-ink/40 font-serif italic">No analysis history found.</p>
                </div>
              ) : (
                <div className="grid gap-4">
                  {history.map((item) => (
                    <div 
                      key={item.id}
                      onClick={() => {
                        setReport(item);
                        setMode(item.mode);
                        setActiveTab('report');
                      }}
                      className="bg-white border border-ink/5 p-6 rounded-[2rem] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer flex items-center justify-between group"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
                        <div className={cn(
                          "w-12 h-12 rounded-2xl flex items-center justify-center text-white shrink-0",
                          item.mode === 'A' ? "bg-ink" : "bg-accent"
                        )}>
                          {item.mode === 'A' ? <Play className="w-5 h-5" /> : <Timer className="w-5 h-5" />}
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span className="text-xs sm:text-[10px] font-bold uppercase tracking-widest text-accent">Mode {item.mode}</span>
                            <span className="text-xs sm:text-[10px] opacity-30 hidden sm:inline">•</span>
                            <span className="text-xs sm:text-[10px] opacity-30 font-mono uppercase">
                              {item.createdAt?.toDate().toLocaleDateString()} {item.createdAt?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <h3 className="text-base sm:text-lg font-bold uppercase italic font-serif text-ink leading-tight">{item.event || item.stroke || 'Analysis Report'}</h3>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <ChevronRight className="w-4 h-4 text-ink/20 group-hover:text-accent transition-colors" />
                        <button 
                          onClick={(e) => deleteHistoryItem(e, item.id)}
                          className="p-2 text-ink/10 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          ) : !mode ? (
            <motion.div 
              key="mode-selection"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto pt-12"
            >
              <button 
                onClick={() => setMode('A')}
                className="group bg-white border border-ink/5 p-8 text-left hover:border-accent/50 transition-all rounded-[2.5rem] shadow-xl shadow-ink/5 hover:shadow-2xl hover:shadow-accent/10 hover:-translate-y-1"
              >
                <div className="w-12 h-12 sm:w-14 sm:h-14 bg-ink text-white rounded-2xl flex items-center justify-center mb-6 group-hover:bg-accent transition-colors">
                  <Play className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <h2 className="text-xl sm:text-2xl font-bold mb-2 uppercase tracking-tight font-serif italic text-ink">模式 A：動作技術診斷</h2>
                <p className="text-xs sm:text-sm text-ink/60 mb-6 leading-relaxed">上傳側面影片，分析姿勢問題並與奧運選手對標。適合修正泳姿細節。</p>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-accent">
                  Start Diagnosis <ChevronRight className="w-4 h-4" />
                </div>
              </button>

              <button 
                onClick={() => setMode('B')}
                className="group bg-white border border-ink/5 p-8 text-left hover:border-accent/50 transition-all rounded-[2.5rem] shadow-xl shadow-ink/5 hover:shadow-2xl hover:shadow-accent/10 hover:-translate-y-1"
              >
                <div className="w-12 h-12 sm:w-14 sm:h-14 bg-accent text-white rounded-2xl flex items-center justify-center mb-6 group-hover:bg-ink transition-colors">
                  <Timer className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <h2 className="text-xl sm:text-2xl font-bold mb-2 uppercase tracking-tight font-serif italic text-ink">模式 B：成績分析與課表</h2>
                <p className="text-xs sm:text-sm text-ink/60 mb-6 leading-relaxed">輸入成績數據，計算效率，並獲取科學訓練課表。適合提升體能與配速。</p>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-accent">
                  Start Analysis <ChevronRight className="w-4 h-4" />
                </div>
              </button>
            </motion.div>
          ) : activeTab === 'input' ? (
            <motion.div 
              key="input-form"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="grid lg:grid-cols-12 gap-8"
            >
              <div className="lg:col-span-7 space-y-8">
                <button 
                  onClick={resetMode}
                  className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold opacity-50 hover:opacity-100 transition-opacity"
                >
                  <ArrowLeft className="w-3 h-3" /> Back to Mode Selection
                </button>

                <div className="space-y-6">
                  <h2 className="text-2xl sm:text-4xl font-bold uppercase tracking-tight font-serif italic">
                    {mode === 'A' ? 'Technical Diagnosis' : 'Performance Analysis'}
                  </h2>
                  
                  {mode === 'A' ? (
                    <div className="space-y-6">
                      <div className="space-y-2">
                        <label className="text-xs sm:text-[10px] uppercase tracking-widest font-bold opacity-50">游泳項目 (必填)</label>
                        <input 
                          type="text" 
                          placeholder="例如：50公尺自由式"
                          value={eventA}
                          onChange={(e) => setEventA(e.target.value)}
                          className="w-full bg-white border border-ink/10 p-4 rounded-2xl focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all text-sm sm:text-base"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs sm:text-[10px] uppercase tracking-widest font-bold opacity-50">上傳影片 (推薦)</label>
                        <div 
                          onClick={() => fileInputRef.current?.click()}
                          className="border-2 border-dashed border-ink/10 aspect-video flex flex-col items-center justify-center cursor-pointer hover:bg-white hover:border-accent/50 transition-all overflow-hidden relative group rounded-[2rem]"
                        >
                          {videoPreview ? (
                            <video src={videoPreview} className="w-full h-full object-cover" controls />
                          ) : (
                            <>
                              <Upload className="w-8 h-8 text-accent opacity-50" />
                              <p className="text-xs font-bold uppercase tracking-widest opacity-50 mt-2 px-4 text-center">Drop video or click to upload</p>
                            </>
                          )}
                          <input 
                            type="file" 
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            accept="video/*"
                            className="hidden"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs sm:text-[10px] uppercase tracking-widest font-bold opacity-50">補充描述 (選填)</label>
                        <textarea 
                          placeholder="描述您的動作感受或想改進的地方..."
                          value={textInput}
                          onChange={(e) => setTextInput(e.target.value)}
                          className="w-full bg-white border border-ink/10 p-4 h-32 rounded-2xl focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all resize-none text-sm sm:text-base"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-8">
                      {raceEntries.map((entry, index) => (
                        <div key={entry.id} className="p-6 sm:p-8 bg-white border border-ink/5 rounded-[2rem] shadow-sm space-y-6 relative group">
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-xs sm:text-[10px] font-bold text-accent uppercase tracking-widest">Entry #{index + 1}</span>
                            {raceEntries.length > 1 && (
                              <button 
                                onClick={() => removeRaceEntry(entry.id)}
                                className="text-xs sm:text-[10px] uppercase tracking-widest font-bold text-red-400 hover:text-red-500 transition-colors"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                          
                          <div className="grid md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                              <label className="text-xs sm:text-[10px] uppercase tracking-widest font-bold opacity-50">比賽項目 (必填)</label>
                              <select 
                                value={entry.event}
                                onChange={(e) => updateRaceEntry(entry.id, 'event', e.target.value)}
                                className="w-full bg-paper/50 border border-ink/10 p-4 rounded-2xl focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all text-sm sm:text-base"
                              >
                                {commonEvents.map(ev => (
                                  <option key={ev} value={ev}>{ev}</option>
                                ))}
                              </select>
                              {entry.event === '其他' && (
                                <input 
                                  type="text" 
                                  placeholder="請輸入自定義項目"
                                  value={entry.customEvent}
                                  onChange={(e) => updateRaceEntry(entry.id, 'customEvent', e.target.value)}
                                  className="w-full bg-paper/50 border border-ink/10 p-4 mt-2 rounded-2xl focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all text-sm sm:text-base"
                                />
                              )}
                            </div>
                            <div className="space-y-2">
                              <label className="text-xs sm:text-[10px] uppercase tracking-widest font-bold opacity-50">比賽秒數 (必填)</label>
                              <input 
                                type="text" 
                                placeholder="例如：58.5"
                                value={entry.time}
                                onChange={(e) => updateRaceEntry(entry.id, 'time', e.target.value)}
                                className="w-full bg-paper/50 border border-ink/10 p-4 rounded-2xl focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all text-sm sm:text-base"
                              />
                            </div>
                          </div>

                          <div className="grid md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                              <label className="text-xs sm:text-[10px] uppercase tracking-widest font-bold opacity-50">泳池長度 (必填)</label>
                              <select 
                                value={entry.poolLength}
                                onChange={(e) => updateRaceEntry(entry.id, 'poolLength', e.target.value)}
                                className="w-full bg-paper/50 border border-ink/10 p-4 rounded-2xl focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all text-sm sm:text-base"
                              >
                                <option value="25">25 公尺</option>
                                <option value="50">50 公尺</option>
                              </select>
                            </div>
                            <div className="space-y-2">
                              <label className="text-xs sm:text-[10px] uppercase tracking-widest font-bold opacity-50">划手數 (選填)</label>
                              <input 
                                type="text" 
                                placeholder="例如：42"
                                value={entry.strokeCount}
                                onChange={(e) => updateRaceEntry(entry.id, 'strokeCount', e.target.value)}
                                className="w-full bg-paper/50 border border-ink/10 p-4 rounded-2xl focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all text-sm sm:text-base"
                              />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <label className="text-xs sm:text-[10px] uppercase tracking-widest font-bold opacity-50">分段成績 (選填，例如：30.5, 32.1...)</label>
                            <input 
                              type="text" 
                              placeholder="例如：30.5, 32.1"
                              value={entry.splits}
                              onChange={(e) => updateRaceEntry(entry.id, 'splits', e.target.value)}
                              className="w-full bg-paper/50 border border-ink/10 p-4 rounded-2xl focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all text-sm sm:text-base"
                            />
                          </div>
                        </div>
                      ))}

                      <button 
                        onClick={addRaceEntry}
                        className="w-full border-2 border-dashed border-accent/20 bg-accent/5 p-6 rounded-[2rem] flex items-center justify-center gap-2 hover:bg-accent/10 transition-all text-[11px] uppercase tracking-widest font-bold text-accent"
                      >
                        <span className="text-xl">+</span> Add Another Race Entry
                      </button>
                    </div>
                  )}

                  <button 
                    onClick={handleAnalyze}
                    disabled={isAnalyzing}
                    className="w-full bg-ink text-white py-6 rounded-3xl font-bold uppercase tracking-[0.3em] hover:bg-ink/90 transition-all shadow-lg shadow-ink/20 disabled:opacity-50 flex flex-col items-center justify-center gap-4"
                  >
                    {isAnalyzing ? (
                      <>
                        <div className="relative w-12 h-12">
                          <svg className="w-full h-full transform -rotate-90">
                            <circle
                              cx="24"
                              cy="24"
                              r="20"
                              stroke="currentColor"
                              strokeWidth="4"
                              fill="transparent"
                              className="text-white/10"
                            />
                            <circle
                              cx="24"
                              cy="24"
                              r="20"
                              stroke="currentColor"
                              strokeWidth="4"
                              fill="transparent"
                              strokeDasharray={125.6}
                              strokeDashoffset={125.6 - (progress / 100) * 125.6}
                              className="text-accent transition-all duration-500 ease-out"
                            />
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center text-[10px] font-mono">
                            {Math.round(progress)}%
                          </div>
                        </div>
                        <span className="text-[10px] tracking-widest text-white/70">AI Processing...</span>
                      </>
                    ) : (
                      'Start AI Analysis'
                    )}
                  </button>
                </div>
              </div>

              <div className="lg:col-span-5 space-y-8">
                <section className="bg-white border border-ink/5 p-6 sm:p-8 rounded-[2.5rem] shadow-xl shadow-ink/5">
                  <div className="flex items-center gap-2 mb-6 text-accent">
                    <Info className="w-4 h-4" />
                    <h2 className="text-xs uppercase tracking-[0.2em] font-bold">Analysis Workflow</h2>
                  </div>
                  <div className="space-y-6">
                    {(mode === 'A' ? [
                      { step: "01", title: "Biomechanics", desc: "Joint angles & body alignment." },
                      { step: "02", title: "Elite Benchmarking", desc: "Comparing with Dressel/Ledecky." },
                      { step: "03", title: "Expert Diagnosis", desc: "Identifying technical patterns." }
                    ] : [
                      { step: "01", title: "Efficiency Calc", desc: "SWOLF & DPS calculation." },
                      { step: "02", title: "CSS & Zones", desc: "Critical speed & training zones." },
                      { step: "03", title: "FINA Scoring", desc: "Benchmarking against world standards." }
                    ]).map((item) => (
                      <div key={item.step} className="flex gap-4 group">
                        <div className="w-8 h-8 rounded-full bg-accent/5 flex items-center justify-center text-xs sm:text-[10px] font-bold text-accent group-hover:bg-accent group-hover:text-white transition-colors shrink-0">
                          {item.step}
                        </div>
                        <div>
                          <h4 className="text-xs sm:text-[10px] font-bold uppercase tracking-widest text-ink">{item.title}</h4>
                          <p className="text-xs sm:text-[10px] text-ink/40 leading-relaxed">{item.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="report-view"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="max-w-4xl mx-auto space-y-6 sm:space-y-12 pt-2 sm:pt-8"
            >
              {report && (
                <div className="bg-white border border-ink/5 p-5 sm:p-12 rounded-[2rem] sm:rounded-[3rem] shadow-2xl shadow-ink/5">
                  {/* Header Info */}
                  <div className="border-b border-ink/10 pb-6 sm:pb-12 flex flex-col md:flex-row md:items-end justify-between gap-4 sm:gap-6 mb-6 sm:mb-12">
                    <div>
                      <div className="flex items-center gap-2 mb-3 sm:mb-4">
                        <span className="px-3 py-1 bg-accent text-white text-[9px] sm:text-[10px] font-bold uppercase tracking-widest rounded-full">
                          Mode {report.mode}
                        </span>
                        <span className="text-[9px] sm:text-[10px] font-mono opacity-30 uppercase">ID: {Math.random().toString(36).substr(2, 6).toUpperCase()}</span>
                      </div>
                      <h2 className="text-3xl sm:text-5xl font-bold uppercase tracking-tight leading-tight sm:leading-none font-serif italic text-ink">
                        Analysis Report
                      </h2>
                    </div>
                    <div className="text-left md:text-right">
                      <p className="text-[10px] uppercase tracking-widest font-bold text-accent mb-0.5">Detected Stroke</p>
                      <p className="text-xl sm:text-3xl font-bold uppercase italic font-serif text-ink">{report.stroke || 'N/A'}</p>
                    </div>
                  </div>

                  {/* Mode A Specific Content */}
                  {report.mode === 'A' && (
                    <div className="space-y-12">
                      <section className="relative">
                        <Quote className="absolute -top-6 -left-6 w-12 h-12 opacity-5 text-accent hidden sm:block" />
                        <h3 className="text-sm sm:text-xs uppercase tracking-[0.2em] font-bold mb-6 sm:mb-8 flex items-center gap-2 text-accent">
                          <Activity className="w-4 h-4" /> Technical Diagnosis
                        </h3>
                        <div className="space-y-6 sm:space-y-8">
                          {report.findings?.map((finding, idx) => (
                            <div key={idx} className="pl-4 sm:pl-6 border-l-4 border-accent/20">
                              <p className="text-lg sm:text-2xl font-serif italic leading-relaxed mb-2 text-ink">
                                "{finding.metaphor}"
                              </p>
                              <p className="text-[11px] sm:text-sm text-ink/60 font-medium uppercase tracking-wider leading-relaxed">
                                {finding.analysis}
                              </p>
                            </div>
                          ))}
                        </div>
                      </section>

                      <section className="space-y-8">
                        <h3 className="text-sm sm:text-xs uppercase tracking-[0.2em] font-bold mb-6 flex items-center gap-2 text-accent">
                          <Target className="w-4 h-4" /> 修正建議與口訣
                        </h3>
                        <div className="grid md:grid-cols-3 gap-4 sm:gap-8">
                          {report.suggestions?.map((suggestion, idx) => (
                            <div key={idx} className="flex flex-col group">
                              <div className="bg-ink text-white p-5 sm:p-8 mb-3 rounded-3xl group-hover:bg-accent transition-colors">
                                <h4 className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] font-bold mb-2 opacity-50">一秒懂口訣</h4>
                                <p className="text-base sm:text-xl font-bold tracking-normal italic font-serif">
                                  {suggestion.mnemonic}
                                </p>
                              </div>
                              <div className="bg-paper/50 border border-ink/5 p-5 sm:p-8 flex-grow rounded-3xl">
                                <h4 className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] font-bold mb-2 text-accent leading-tight">核心練習：{suggestion.drill.name}</h4>
                                <p className="text-xs sm:text-sm leading-relaxed text-ink/70">
                                  {suggestion.drill.purpose}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    </div>
                  )}

                  {/* Mode B Specific Content */}
                  {report.mode === 'B' && report.metrics && (
                    <div className="space-y-12">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6">
                        {[
                          { label: 'SWOLF', value: report.metrics.swolf, icon: Activity },
                          { label: 'DPS (m)', value: report.metrics.dps, icon: Target },
                          { label: 'CSS', value: report.metrics.css, icon: Timer },
                          { label: 'FINA Points', value: report.metrics.finaPoints, icon: Trophy },
                        ].map((stat) => (
                          <div key={stat.label} className="bg-white border border-ink/5 p-4 sm:p-8 rounded-3xl flex flex-col items-center justify-center text-center shadow-sm hover:shadow-md transition-shadow">
                            <stat.icon className="w-3.5 h-3.5 sm:w-5 sm:h-5 mb-2 text-accent opacity-50" />
                            <p className="text-[9px] sm:text-[10px] uppercase tracking-widest font-bold opacity-50 mb-0.5">{stat.label}</p>
                            <p className="text-lg sm:text-3xl font-bold text-ink">{stat.value || '--'}</p>
                          </div>
                        ))}
                      </div>

                      <section>
                        <h3 className="text-sm sm:text-xs uppercase tracking-[0.2em] font-bold mb-4 flex items-center gap-2 text-accent">
                          <FileText className="w-4 h-4" /> Efficiency Analysis
                        </h3>
                        <p className="text-lg sm:text-2xl leading-relaxed text-ink/80 font-serif italic">"{report.metrics.analysis}"</p>
                      </section>

                      {report.trainingPlan && (
                        <section className="border border-ink/10 rounded-[2rem] overflow-hidden">
                          <div className="bg-ink text-white p-5">
                            <h3 className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold flex items-center gap-2">
                              <Dumbbell className="w-4 h-4 text-accent" /> Scientific Training Plan
                            </h3>
                          </div>
                          <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-ink/10">
                            <div className="p-5 sm:p-8 space-y-5 bg-white">
                              <div>
                                <h4 className="text-[9px] sm:text-[10px] uppercase tracking-widest font-bold text-accent mb-1.5">Warmup (WU)</h4>
                                <p className="text-xs sm:text-sm leading-relaxed">{report.trainingPlan.warmup}</p>
                              </div>
                              <div>
                                <h4 className="text-[9px] sm:text-[10px] uppercase tracking-widest font-bold text-accent mb-1.5">Drills</h4>
                                <p className="text-xs sm:text-sm leading-relaxed">{report.trainingPlan.drills}</p>
                              </div>
                            </div>
                            <div className="p-5 sm:p-8 space-y-5 bg-paper/50">
                              <div>
                                <h4 className="text-[9px] sm:text-[10px] uppercase tracking-widest font-bold text-accent mb-1.5">Main Set (MS)</h4>
                                <p className="text-xs sm:text-sm font-bold leading-relaxed">{report.trainingPlan.mainSet}</p>
                              </div>
                              <div>
                                <h4 className="text-[9px] sm:text-[10px] uppercase tracking-widest font-bold text-accent mb-1.5">Cool Down (CD)</h4>
                                <p className="text-xs sm:text-sm leading-relaxed">{report.trainingPlan.coolDown}</p>
                              </div>
                            </div>
                          </div>
                        </section>
                      )}
                    </div>
                  )}

                  {/* Common Growth Advice */}
                  <section className="border-t border-ink/10 pt-8 sm:pt-12 mt-8 sm:mt-12">
                    <h3 className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold mb-5 sm:mb-8 text-accent">Coach's Growth Advice</h3>
                    <div className="bg-accent/5 p-6 sm:p-10 rounded-[2rem] sm:rounded-[2.5rem] border border-accent/10">
                      <p className="text-base sm:text-xl leading-relaxed italic font-serif text-ink/80">{report.growthAdvice}</p>
                    </div>
                  </section>

                  {/* Missing Data Warning */}
                  {report.missingData && report.missingData.length > 0 && (
                    <div className="bg-yellow-100 border border-yellow-400 p-4 text-yellow-800 text-xs mt-8">
                      <p className="font-bold mb-1 uppercase tracking-widest">⚠️ Missing Data for Precise Analysis:</p>
                      <ul className="list-disc list-inside">
                        {report.missingData.map((item, i) => <li key={i}>{item}</li>)}
                      </ul>
                    </div>
                  )}

                  <div className="flex justify-center pt-12">
                    <button 
                      onClick={resetMode}
                      className="px-10 py-4 bg-accent text-white rounded-2xl font-bold uppercase tracking-widest hover:bg-ink transition-all shadow-lg shadow-accent/20"
                    >
                      New Analysis
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Coach Connect Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 mt-12 sm:mt-24">
        <div className="bg-white border border-ink/5 p-6 sm:p-16 rounded-[2.5rem] sm:rounded-[3rem] shadow-xl shadow-ink/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-accent/5 rounded-full -mr-32 -mt-32 blur-3xl" />
          <div className="relative z-10">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
              <div className="bg-accent p-1 rounded-xl w-fit">
                <Dumbbell className="text-white w-4 h-4" />
              </div>
              <h2 className="text-lg sm:text-2xl font-bold uppercase tracking-tight font-serif italic text-ink">
                真人教練進階諮詢 (Coach Connect)
              </h2>
            </div>
            
            <div className="max-w-2xl space-y-6 sm:space-y-8">
              <blockquote className="text-base sm:text-xl font-serif italic text-ink/80 leading-relaxed border-l-4 border-accent/20 pl-4 sm:pl-6">
                "AI 分析僅是開始。想更進一步修正動作細節，或報名實體課程取得真人指導嗎？"
              </blockquote>
              
              <div className="grid sm:grid-cols-2 gap-4 sm:gap-6">
                <div className="flex items-center gap-3 group">
                  <div className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center text-accent group-hover:bg-accent group-hover:text-white transition-all shrink-0">
                    <Instagram className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <p className="text-[9px] sm:text-[10px] uppercase tracking-widest font-bold opacity-50">Instagram</p>
                    <p className="text-sm sm:text-lg font-bold text-ink">molson_momo</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-3 group">
                  <div className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center text-accent group-hover:bg-accent group-hover:text-white transition-all shrink-0">
                    <Mail className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <p className="text-[9px] sm:text-[10px] uppercase tracking-widest font-bold opacity-50">Email</p>
                    <p className="text-sm sm:text-lg font-bold text-ink">molson0411@gmail.com</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto p-12 border-t border-ink/10 mt-12 flex flex-col md:flex-row justify-between items-center gap-8">
        <div className="text-[10px] uppercase tracking-[0.3em] opacity-30">
          © 2026 SwimFlow Biomechanics Lab. All Rights Reserved.
        </div>
        <div className="flex gap-8">
          <a href="#" className="text-[10px] uppercase tracking-widest text-ink/40 hover:text-accent transition-colors">Methodology</a>
          <a href="#" className="text-[10px] uppercase tracking-widest text-ink/40 hover:text-accent transition-colors">Expert Database</a>
          <a href="#" className="text-[10px] uppercase tracking-widest text-ink/40 hover:text-accent transition-colors">Privacy</a>
        </div>
      </footer>
    </div>
  );
}
