import React, { useState, useRef, useEffect, useMemo, Component } from 'react';
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
  Trash2,
  CalendarDays,
  X,
  ShieldCheck,
  PencilLine,
  CheckCircle2
} from 'lucide-react';
import { analyzeSwim, updateAnalysisReportStatus, uploadVideoForAnalysis } from './services/gemini';
import { AnalysisReport, AnalysisMode } from './types';
import { cn } from './lib/utils';
import { Toaster, toast } from 'sonner';
import {
  auth,
  db,
  googleProvider,
  completeGoogleRedirectSignIn,
  getAuthErrorMessage,
  saveUserProfile,
  signInWithGoogle,
  logout,
  handleFirestoreError,
  OperationType
} from './firebase';
import { onAuthStateChanged, signInWithPopup, User } from 'firebase/auth';
import { collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, deleteDoc, doc, updateDoc, Timestamp, getDocs, limit, getDoc, setDoc } from 'firebase/firestore';

type TrainingCalendarRecord = {
  id: string;
  date: Date;
  mode: AnalysisMode;
  stroke?: string;
  event?: string;
  impression?: string;
  isMock?: boolean;
  sourceReport?: AnalysisReport & { id: string, createdAt: any, event?: string };
};

type AdminReviewStatus = 'pending' | 'approved' | 'revised';

type AdminReviewRecord = {
  id: string;
  thumbnailLabel: string;
  analyzedAt: string;
  createdAtMs: number;
  stroke: string;
  event: string;
  conclusion: string;
  status: AdminReviewStatus;
  visibilityStatus: 'active' | 'deleted' | 'archived';
  adminFeedback?: string;
  aiReport?: AnalysisReport;
  videoUrl?: string;
};

// Firestore data model:
// analysis_reports/{reportId} stores:
// - status: "active" | "deleted" | "archived"
// - reviewStatus: "pending" | "approved" | "revised"
// - adminFeedback: string | null
// - videoUrl: string | null
// Backend writes createdAt, strokeType, aiReport, status, reviewStatus, adminFeedback, and videoUrl.

const trainingCalendarMockData = createTrainingCalendarMockData();

const tutorialSteps = [
  {
    title: '綁定專屬帳戶',
    description: '系統需要為您保存專屬的分析報告與訓練紀錄，請先使用 Google 帳戶進行安全登入。',
    kind: 'login',
  },
  {
    title: '認識雙軌系統',
    description: '本系統提供兩大核心功能：【模式 A：AI 動作診斷】與【模式 B：科學訓練課表】。您可依據當下需求自由切換。',
    kind: 'text',
  },
  {
    title: '模式 A 操作指南',
    items: [
      '上傳您的游泳影片。',
      '透過時空標籤精準鎖定目標人物。',
      '獲取帶有時間軸跳轉互動的 AI 深度診斷報告。',
    ],
    kind: 'list',
  },
  {
    title: '模式 B 操作指南',
    items: [
      '選擇指定的訓練學員。',
      '設定訓練週期與強化目標。',
      '由系統自動生成符合運動科學的多日訓練菜單。',
    ],
    kind: 'list',
  },
] as const;

const modeBEventOptions = [
  '50公尺自由式',
  '100公尺自由式',
  '200公尺自由式',
  '400公尺自由式',
  '800公尺自由式',
  '1500公尺自由式',
  '50公尺蝶式',
  '100公尺蝶式',
  '200公尺蝶式',
  '50公尺仰式',
  '100公尺仰式',
  '200公尺仰式',
  '50公尺蛙式',
  '100公尺蛙式',
  '200公尺蛙式',
  '100公尺混合式',
  '200公尺混合式',
  '400公尺混合式',
];

type RaceEntryState = {
  id: number;
  event: string;
  time: string;
  poolLength: string;
  splits: string[];
  strokeCounts: string[];
};

type AthleteProfile = {
  gender: 'M' | 'F' | '';
  birthDate: string;
};

function extractDistanceFromEvent(event: string) {
  const match = event.match(/(\d+)\s*公尺/);
  return match ? Number(match[1]) : 0;
}

function calculateLapCount(event: string, poolLength: string) {
  const distance = extractDistanceFromEvent(event);
  const pool = Number(poolLength);
  if (!distance || !pool) return 0;
  return Math.max(1, Math.ceil(distance / pool));
}

function resizeLapValues(length: number, current: string[] = []) {
  return Array.from({ length }, (_item, index) => current[index] || '');
}

function createRaceEntry(): RaceEntryState {
  const event = modeBEventOptions[0];
  const poolLength = '50';
  const lapCount = calculateLapCount(event, poolLength);

  return {
    id: Date.now(),
    event,
    time: '',
    poolLength,
    splits: [],
    strokeCounts: [],
  };
}

function lapValuesToNumbers(values: string[]) {
  return values.map((value) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  });
}

function createTrainingCalendarMockData(): TrainingCalendarRecord[] {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const days = [3, 9, 15, 22].map((day) => Math.min(day, lastDay));

  return [
    {
      id: 'mock-technique-1',
      date: new Date(year, month, days[0]),
      mode: 'A',
      stroke: 'Freestyle',
      event: '50 Free',
      impression: 'Catch timing is improving; keep hips higher through breathing.',
      isMock: true,
    },
    {
      id: 'mock-css-1',
      date: new Date(year, month, days[1]),
      mode: 'B',
      stroke: 'Freestyle',
      event: 'CSS Test',
      impression: 'CSS pace is stable; stroke count data is still needed for SWOLF.',
      isMock: true,
    },
    {
      id: 'mock-technique-2',
      date: new Date(year, month, days[2]),
      mode: 'A',
      stroke: 'Breaststroke',
      event: 'Technique Review',
      impression: 'Kick recovery is compact, but glide line can stay cleaner.',
      isMock: true,
    },
    {
      id: 'mock-race-1',
      date: new Date(year, month, days[3]),
      mode: 'B',
      stroke: 'Mixed',
      event: 'Race Data',
      impression: 'Speed profile shows a strong opening with room for pacing control.',
      isMock: true,
    },
  ];
}

function toCalendarDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getReportCreatedDate(item: AnalysisReport & { createdAt: any }) {
  if (item.createdAt?.toDate) {
    return item.createdAt.toDate() as Date;
  }

  if (item.createdAt instanceof Date) {
    return item.createdAt;
  }

  return null;
}

function extractModeAFindingLabels(report: AnalysisReport | undefined) {
  if (!report?.findings?.length) {
    return [];
  }

  return report.findings
    .map((finding) => [finding.metaphor, finding.analysis].filter(Boolean).join(' - '))
    .map((finding) => finding.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function getLatestModeAFindingsFromHistory(
  reports: (AnalysisReport & { id: string, createdAt: any, event?: string, videoUrl?: string })[]
) {
  const latestModeA = reports
    .filter((item) => item.mode === 'A')
    .sort((a, b) => (getReportCreatedDate(b)?.getTime() || 0) - (getReportCreatedDate(a)?.getTime() || 0))[0];

  return extractModeAFindingLabels(latestModeA);
}

async function fetchLatestModeAFindings(userId: string, fallbackHistory: (AnalysisReport & { id: string, createdAt: any, event?: string, videoUrl?: string })[]) {
  try {
    const snapshot = await getDocs(query(
      collection(db, 'reports'),
      where('uid', '==', userId),
      where('mode', '==', 'A'),
      orderBy('createdAt', 'desc'),
      limit(1)
    ));
    const latestReport = snapshot.docs[0]?.data() as AnalysisReport | undefined;
    const findings = extractModeAFindingLabels(latestReport);
    if (findings.length > 0) {
      return findings;
    }
  } catch (error) {
    console.warn('[跨模式聯動] 無法從 Firestore 讀取最新 Mode A 診斷，改用目前 history 狀態:', error);
  }

  return getLatestModeAFindingsFromHistory(fallbackHistory);
}

function toMonthKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function getMonthStart(monthKey: string) {
  const [yearValue, monthValue] = monthKey.split('-').map(Number);
  return new Date(yearValue, monthValue - 1, 1);
}

function getMonthRange(monthKey: string) {
  const [yearValue, monthValue] = monthKey.split('-').map(Number);
  const start = new Date(yearValue, monthValue - 1, 1, 0, 0, 0, 0);
  const end = new Date(yearValue, monthValue, 0, 23, 59, 59, 999);
  return { start, end };
}

function formatMonthOption(monthKey: string) {
  return getMonthStart(monthKey).toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: 'long',
  });
}

function timestampToSeconds(timestamp: string) {
  const match = timestamp.match(/^(\d{2}):(\d{2})$/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

const MODE_A_REF_MARKER = '(Ref: Mode A)';

function stripModeARefMarker(text: string | undefined) {
  return text?.replaceAll(MODE_A_REF_MARKER, '').replace(/\s{2,}/g, ' ').trim();
}

function VideoRetentionAlert() {
  return (
    <div className="bg-slate-50 border-l-4 border-[#93B7BE] p-4 my-4 rounded-r-md">
      <p className="text-sm text-gray-600">
        為保護隱私與節省系統資源，影片將於上傳 24 小時後自動銷毀並停止回放。您的專屬 AI 診斷與教練指導紀錄將為您永久保存。
      </p>
    </div>
  );
}

function parseTextWithTimestamps(
  text: string | undefined,
  onSeek: (timestamp: string) => void
) {
  if (!text) return null;

  const parts: React.ReactNode[] = [];
  const timestampPattern = /\[(\d{2}:\d{2})\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = timestampPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const timestamp = match[1];
    parts.push(
      <button
        key={`${timestamp}-${match.index}`}
        type="button"
        onClick={() => onSeek(timestamp)}
        className="mx-1 inline-flex items-center rounded-md bg-[#93B7BE] px-2 py-0.5 align-baseline text-[10px] font-bold leading-none tracking-widest text-[#2D3047] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg active:scale-95"
      >
        [{timestamp}]
      </button>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function TimestampText({
  text,
  onSeek,
}: {
  text?: string;
  onSeek: (timestamp: string) => void;
}) {
  return <>{parseTextWithTimestamps(text, onSeek)}</>;
}

function ModeALinkedPlanText({
  text,
  onSeek,
}: {
  text?: string;
  onSeek: (timestamp: string) => void;
}) {
  const hasModeARef = Boolean(text?.includes(MODE_A_REF_MARKER));

  return (
    <>
      <TimestampText text={stripModeARefMarker(text)} onSeek={onSeek} />
      {hasModeARef && (
        <span className="bg-accent/10 text-accent border border-accent/20 px-2 py-0.5 rounded-full text-[9px] font-bold inline-flex items-center gap-1 ml-2">
          <CheckCircle2 className="w-3 h-3" />
          動作診斷連動建議
        </span>
      )}
    </>
  );
}

function buildMonthCalendarDays(baseDate: Date) {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const cells: { date: Date | null; key: string }[] = [];

  for (let index = 0; index < startOffset; index += 1) {
    cells.push({ date: null, key: `empty-start-${index}` });
  }

  for (let day = 1; day <= totalDays; day += 1) {
    const date = new Date(year, month, day);
    cells.push({ date, key: toCalendarDateKey(date) });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ date: null, key: `empty-end-${cells.length}` });
  }

  return cells;
}

function mapAnalysisReportDoc(reviewDoc: { id: string; data: () => any }, index: number): AdminReviewRecord {
  const data = reviewDoc.data();
  const aiReport = data.aiReport as AnalysisReport | undefined;
  const createdAtDate = data.createdAt?.toDate ? data.createdAt.toDate() as Date : null;
  const status = ['pending', 'approved', 'revised'].includes(data.reviewStatus)
    ? data.reviewStatus as AdminReviewStatus
    : ['pending', 'approved', 'revised'].includes(data.status)
      ? data.status as AdminReviewStatus
      : 'pending';
  const visibilityStatus = ['active', 'deleted', 'archived'].includes(data.status)
    ? data.status as AdminReviewRecord['visibilityStatus']
    : 'active';

  return {
    id: reviewDoc.id,
    thumbnailLabel: `VIDEO ${String(index + 1).padStart(2, '0')}`,
    analyzedAt: createdAtDate
      ? createdAtDate.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
      : 'Pending timestamp',
    createdAtMs: createdAtDate?.getTime() || 0,
    stroke: data.strokeType || aiReport?.stroke || 'Unknown Stroke',
    event: aiReport?.mode === 'B' ? 'Race Data Analysis' : 'Technique Analysis',
    conclusion: aiReport?.impression || aiReport?.performanceMetrics?.analysis || aiReport?.metrics?.analysis || aiReport?.growthAdvice || 'No AI conclusion available.',
    status,
    visibilityStatus,
    adminFeedback: data.adminFeedback || undefined,
    aiReport,
    videoUrl: typeof data.videoUrl === 'string' ? data.videoUrl : undefined,
  };
}

function AdminReviewDashboard() {
  const [adminUser, setAdminUser] = useState<User | null>(null);
  const [isAdminAuthReady, setIsAdminAuthReady] = useState(false);
  const [reviews, setReviews] = useState<AdminReviewRecord[]>([]);
  const [selectedReview, setSelectedReview] = useState<AdminReviewRecord | null>(null);
  const [adminFeedback, setAdminFeedback] = useState('');
  const [isReviewLoading, setIsReviewLoading] = useState(true);
  const [reviewError, setReviewError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (!isMounted) return;
      setAdminUser(currentUser);
      setIsAdminAuthReady(true);
    });

    completeGoogleRedirectSignIn()
      .then((redirectUser) => {
        if (!isMounted) return;
        if (redirectUser) {
          setAdminUser(redirectUser);
        }
        setIsAdminAuthReady(true);
      })
      .catch((error) => {
        if (!isMounted) return;
        setReviewError(getAuthErrorMessage(error));
        setIsAdminAuthReady(true);
      });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!adminUser) {
      setReviews([]);
      setIsReviewLoading(false);
      return;
    }

    setIsReviewLoading(true);
    setReviewError(null);

    // Firestore may require a composite index for status + createdAt.
    // If this query fails, follow the Firebase console link printed in DevTools.
    const reviewsQuery = query(
      collection(db, 'analysis_reports'),
      where('status', '==', 'active'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(reviewsQuery, (snapshot) => {
      const mappedReviews = snapshot.docs
        .map((reviewDoc, index) => mapAnalysisReportDoc(reviewDoc, index))
        .sort((a, b) => {
          if (a.status === 'pending' && b.status !== 'pending') return -1;
          if (a.status !== 'pending' && b.status === 'pending') return 1;
          return b.createdAtMs - a.createdAtMs;
        });

      setReviews(mappedReviews);
      setIsReviewLoading(false);
    }, (error) => {
      console.error('Failed to load analysis_reports:', error);
      setReviewError(error instanceof Error ? error.message : String(error));
      setIsReviewLoading(false);
    });

    return () => unsubscribe();
  }, [adminUser]);

  const handleAdminSignIn = async () => {
    try {
      await signInWithGoogle();
      toast.success('Signed in.');
    } catch (error) {
      toast.error(getAuthErrorMessage(error));
    }
  };

  const handleApprove = async (reviewId: string) => {
    try {
      await updateDoc(doc(db, 'analysis_reports', reviewId), {
        reviewStatus: 'approved',
      });
      toast.success('Marked as precise.');
    } catch (error) {
      console.error('Failed to approve review:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to approve review.');
    }
  };

  const openRevisionModal = (review: AdminReviewRecord) => {
    setSelectedReview(review);
    setAdminFeedback(review.adminFeedback || '');
  };

  const handleHideReview = async (reviewId: string) => {
    try {
      await updateAnalysisReportStatus(reviewId, 'deleted');
      toast.success('Report hidden and excluded from future RAG.');
    } catch (error) {
      console.error('Failed to hide review:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to hide report.');
    }
  };

  const handleSubmitRevision = async () => {
    if (!selectedReview) return;

    const trimmedFeedback = adminFeedback.trim();
    if (!trimmedFeedback) {
      toast.error('Please enter the coach correction logic.');
      return;
    }

    try {
      await updateDoc(doc(db, 'analysis_reports', selectedReview.id), {
        reviewStatus: 'revised',
        adminFeedback: trimmedFeedback,
      });
      setSelectedReview(null);
      setAdminFeedback('');
      toast.success('Revision saved for future AI reference.');
    } catch (error) {
      console.error('Failed to revise review:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to save revision.');
    }
  };

  const statusStyles: Record<AdminReviewStatus, string> = {
    pending: 'bg-ink/5 text-ink/60',
    approved: 'bg-accent/10 text-accent',
    revised: 'bg-yellow-100 text-yellow-700',
  };

  return (
    <div className="min-h-screen bg-paper text-ink font-sans selection:bg-accent selection:text-white">
      <header className="border-b border-ink/10 bg-white/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-ink text-white flex items-center justify-center">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.28em] font-bold text-accent">Hidden Admin Route</p>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-ink">Admin Review Dashboard</h1>
            </div>
          </div>
          <div className="rounded-full border border-ink/10 px-4 py-2 text-[10px] uppercase tracking-widest font-bold text-ink/50">
            {adminUser ? adminUser.email : '/admin/reviews'}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
        <section className="rounded-[2rem] border border-ink/10 bg-white p-5 sm:p-8 shadow-xl shadow-ink/5">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-[0.28em] font-bold text-accent">AI Quality Loop</p>
              <h2 className="text-2xl sm:text-4xl font-bold text-ink">Recent AI Analysis Reports</h2>
              <p className="text-sm text-ink/55 max-w-2xl leading-relaxed">
                Review AI-generated technique reports, approve precise analysis, or save coach corrections as future model reference data.
              </p>
              {reviewError && (
                <p className="text-sm font-bold text-red-500">
                  {reviewError}
                </p>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              {(['pending', 'approved', 'revised'] as AdminReviewStatus[]).map((status) => (
                <div key={status} className="rounded-2xl border border-ink/10 px-4 py-3">
                  <p className="text-lg font-bold text-ink">{reviews.filter((item) => item.status === status).length}</p>
                  <p className="text-[9px] uppercase tracking-widest text-ink/40">{status}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {!adminUser && isAdminAuthReady && (
          <section className="rounded-[2rem] border border-ink/10 bg-white p-8 text-center shadow-xl shadow-ink/5">
            <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-ink text-white flex items-center justify-center">
              <LogIn className="h-6 w-6" />
            </div>
            <h2 className="text-2xl font-bold text-ink">Admin sign-in required</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink/55">
              Sign in with an admin account to load Firestore analysis reports and review AI output.
            </p>
            <button
              type="button"
              onClick={handleAdminSignIn}
              className="mt-6 rounded-full bg-ink px-6 py-3 text-[11px] uppercase tracking-widest font-bold text-white hover:bg-accent transition-colors"
            >
              Sign in with Google
            </button>
          </section>
        )}

        {adminUser && isReviewLoading && (
          <section className="rounded-[2rem] border border-ink/10 bg-white p-8 text-center shadow-xl shadow-ink/5">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full border-4 border-accent/20 border-t-accent animate-spin" />
            <p className="text-sm font-bold uppercase tracking-widest text-ink/50">Loading Firestore reviews...</p>
          </section>
        )}

        {adminUser && !isReviewLoading && reviews.length === 0 && (
          <section className="rounded-[2rem] border border-ink/10 bg-white p-8 text-center shadow-xl shadow-ink/5">
            <h2 className="text-2xl font-bold text-ink">No analysis reports yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink/55">
              New Gemini analysis results will appear here after the backend writes to analysis_reports.
            </p>
          </section>
        )}

        <section className="grid gap-4">
          {reviews.map((review) => (
            <article
              key={review.id}
              className="rounded-[2rem] border border-ink/10 bg-white p-4 sm:p-6 shadow-sm hover:shadow-lg hover:shadow-ink/5 transition-all"
            >
              <div className="grid md:grid-cols-[160px_1fr] gap-5">
                <div className="aspect-video md:aspect-square rounded-2xl border border-ink/10 bg-paper overflow-hidden">
                  {review.videoUrl ? (
                    <video
                      src={review.videoUrl}
                      controls
                      preload="metadata"
                      className="h-full w-full bg-ink object-contain"
                    />
                  ) : (
                    <div className="h-full w-full bg-[linear-gradient(135deg,#303036_0%,#303036_48%,#30BCED_48%,#30BCED_52%,#f7f9fb_52%)] flex items-end p-4">
                      <span className="rounded-full bg-white/90 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-ink">
                        {review.thumbnailLabel}
                      </span>
                    </div>
                  )}
                </div>

                <div className="space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn(
                          'rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest',
                          statusStyles[review.status]
                        )}>
                          {review.status}
                        </span>
                        <span className="text-[10px] font-mono uppercase tracking-widest text-ink/35">
                          {review.analyzedAt}
                        </span>
                      </div>
                      <h3 className="text-xl sm:text-2xl font-bold text-ink">{review.stroke}</h3>
                      <p className="text-xs uppercase tracking-widest font-bold text-accent">{review.event}</p>
                    </div>
                    {review.status === 'approved' && <CheckCircle2 className="h-6 w-6 text-accent shrink-0" />}
                  </div>

                  <div className="rounded-2xl border border-ink/10 bg-paper/70 p-4">
                    <p className="text-[10px] uppercase tracking-[0.22em] font-bold text-ink/35 mb-2">AI Core Conclusion</p>
                    <p className="text-sm sm:text-base leading-relaxed text-ink/75">{review.conclusion}</p>
                    {review.adminFeedback && (
                      <div className="mt-4 border-t border-ink/10 pt-4">
                        <p className="text-[10px] uppercase tracking-[0.22em] font-bold text-accent mb-2">Admin Feedback</p>
                        <p className="text-sm leading-relaxed text-ink/70">{review.adminFeedback}</p>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3">
                    <button
                      type="button"
                      onClick={() => handleHideReview(review.id)}
                      className="flex-1 rounded-full border border-red-200 px-5 py-3 text-red-500 text-[11px] uppercase tracking-widest font-bold hover:border-red-500 hover:bg-red-50 transition-colors flex items-center justify-center gap-2"
                    >
                      <Trash2 className="h-4 w-4" />
                      刪除/隱藏
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApprove(review.id)}
                      className="flex-1 rounded-full bg-ink px-5 py-3 text-white text-[11px] uppercase tracking-widest font-bold hover:bg-accent transition-colors flex items-center justify-center gap-2"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      標記為精準 (Approve)
                    </button>
                    <button
                      type="button"
                      onClick={() => openRevisionModal(review)}
                      className="flex-1 rounded-full border border-ink/15 px-5 py-3 text-ink text-[11px] uppercase tracking-widest font-bold hover:border-accent hover:text-accent transition-colors flex items-center justify-center gap-2"
                    >
                      <PencilLine className="h-4 w-4" />
                      糾正 AI 誤判 (Revise)
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </section>
      </main>

      <AnimatePresence>
        {selectedReview && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-ink/35 backdrop-blur-sm"
              onClick={() => setSelectedReview(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              className="relative w-full max-w-xl rounded-[2rem] bg-white p-6 sm:p-8 shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4 mb-6">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.28em] font-bold text-accent">Revise AI Judgment</p>
                  <h2 className="text-2xl font-bold text-ink mt-1">糾正 AI 誤判</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedReview(null)}
                  className="h-10 w-10 rounded-full bg-ink text-white hover:bg-accent transition-colors flex items-center justify-center"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <label className="block space-y-3">
                <span className="text-xs font-bold uppercase tracking-widest text-ink/55">
                  請輸入教練的正確診斷邏輯（此紀錄將作為未來 AI 分析的參考依據）
                </span>
                <textarea
                  value={adminFeedback}
                  onChange={(event) => setAdminFeedback(event.target.value)}
                  className="min-h-40 w-full rounded-2xl border border-ink/15 bg-paper/70 p-4 text-sm leading-relaxed text-ink outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent/20"
                  placeholder="Example: The issue is not early breathing; the primary correction should be left-side hand entry crossing the midline..."
                />
              </label>

              <div className="mt-6 flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedReview(null)}
                  className="flex-1 rounded-full border border-ink/15 px-5 py-3 text-[11px] uppercase tracking-widest font-bold text-ink/60 hover:text-ink transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmitRevision}
                  className="flex-1 rounded-full bg-ink px-5 py-3 text-[11px] uppercase tracking-widest font-bold text-white hover:bg-accent transition-colors"
                >
                  Save Revision
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Confirm Modal Component
function AthleteProfileModal({
  isOpen,
  initialProfile,
  isLoading,
  isSaving,
  onSave,
  onCancel,
}: {
  isOpen: boolean;
  initialProfile: AthleteProfile;
  isLoading?: boolean;
  isSaving?: boolean;
  onSave: (profile: AthleteProfile) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<AthleteProfile>(initialProfile);

  useEffect(() => {
    if (isOpen) {
      setDraft(initialProfile);
    }
  }, [initialProfile, isOpen]);

  const canSave = Boolean(draft.gender && draft.birthDate);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !isLoading && !isSaving && onCancel()}
            className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 20 }}
            className="relative w-full max-w-md rounded-[2rem] border border-ink/10 bg-white p-7 shadow-2xl"
          >
            <div className="mb-6 flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#2D3047] text-white">
                <UserIcon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-accent">Mode B Calibration</p>
                <h3 className="mt-1 text-2xl font-bold italic font-serif text-ink leading-tight">
                  建立專屬泳者生理檔案 (Athlete Profile)
                </h3>
              </div>
            </div>

            {isLoading ? (
              <div className="flex flex-col items-center justify-center gap-4 rounded-2xl bg-paper/60 p-10 text-center">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#93B7BE]/30 border-t-[#2D3047]" />
                <p className="text-[11px] font-bold uppercase tracking-widest text-ink/50">
                  Loading athlete profile...
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-4">
                  <label className="block space-y-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-ink/50">Gender</span>
                    <select
                      value={draft.gender}
                      onChange={(event) => setDraft((current) => ({ ...current, gender: event.target.value as AthleteProfile['gender'] }))}
                      className="w-full rounded-2xl border border-ink/10 bg-paper/50 px-4 py-3 text-sm font-bold text-ink outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent/20"
                    >
                      <option value="">Select gender</option>
                      <option value="M">Male</option>
                      <option value="F">Female</option>
                    </select>
                  </label>

                  <label className="block space-y-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-ink/50">Birth Date</span>
                    <input
                      type="date"
                      value={draft.birthDate}
                      onChange={(event) => setDraft((current) => ({ ...current, birthDate: event.target.value }))}
                      className="w-full rounded-2xl border border-ink/10 bg-paper/50 px-4 py-3 text-sm font-bold text-ink outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent/20"
                    />
                  </label>
                </div>

                <button
                  type="button"
                  disabled={!canSave || isSaving}
                  onClick={() => canSave && onSave(draft)}
                  className="mt-7 w-full rounded-full bg-[#2D3047] px-5 py-4 text-[11px] font-bold uppercase tracking-widest text-white shadow-lg shadow-ink/20 transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#93B7BE] hover:shadow-lg active:scale-95 disabled:cursor-not-allowed disabled:bg-gray-400 disabled:shadow-none disabled:hover:translate-y-0"
                >
                  {isSaving ? 'Saving...' : 'Save & Continue'}
                </button>
              </>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

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
                className="flex-1 py-3 rounded-full font-bold uppercase tracking-widest text-[10px] border border-ink/10 hover:bg-accent hover:text-white hover:border-accent transition-all"
              >
                Cancel
              </button>
              <button 
                onClick={onConfirm}
                className="flex-1 py-3 rounded-full font-bold uppercase tracking-widest text-[10px] bg-red-500 text-white hover:bg-red-600 transition-all shadow-lg shadow-red-500/20"
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
              className="w-full bg-ink text-white py-4 rounded-full font-bold uppercase tracking-widest hover:bg-accent transition-all"
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
  const isAdminReviewRoute = window.location.pathname.endsWith('/admin/reviews')
    || window.location.hash.replace(/^#/, '') === '/admin/reviews';

  return (
    <ErrorBoundary>
      {isAdminReviewRoute ? <AdminReviewDashboard /> : <AppContent />}
      <Toaster position="top-center" richColors />
    </ErrorBoundary>
  );
}

function AppContent() {
  const loadingMessages = [
    '正在提取關鍵影格...',
    '正在進行生物力學比對...',
    '正在生成技術診斷報告...'
  ];
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [mode, setMode] = useState<AnalysisMode | null>(null);
  const [activeTab, setActiveTab] = useState<'input' | 'report' | 'history'>('input');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [progress, setProgress] = useState(0);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [history, setHistory] = useState<(AnalysisReport & { id: string, createdAt: any, event?: string, videoUrl?: string })[]>([]);
  const [availableMonths, setAvailableMonths] = useState<string[]>([toMonthKey(new Date())]);
  const [selectedMonth, setSelectedMonth] = useState(() => toMonthKey(new Date()));
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ isOpen: boolean, id: string }>({ isOpen: false, id: '' });
  
  // Mode A Inputs
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [textInput, setTextInput] = useState('');
  const [eventA, setEventA] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [targetDescription, setTargetDescription] = useState('');
  const [currentReportVideoUrl, setCurrentReportVideoUrl] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);

  // Mode B Inputs
  const [raceEntries, setRaceEntries] = useState<RaceEntryState[]>(() => [createRaceEntry()]);
  const [athleteProfile, setAthleteProfile] = useState<AthleteProfile>({ gender: '', birthDate: '' });
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [isProfileSaving, setIsProfileSaving] = useState(false);
  const [pendingModeBAfterProfile, setPendingModeBAfterProfile] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const monthOptions = useMemo(() => {
    const options = new Set([toMonthKey(new Date()), selectedMonth, ...availableMonths]);
    return Array.from(options).sort((a, b) => b.localeCompare(a));
  }, [availableMonths, selectedMonth]);
  const calendarBaseDate = useMemo(() => getMonthStart(selectedMonth), [selectedMonth]);
  const todayKey = useMemo(() => toCalendarDateKey(new Date()), []);
  const calendarDays = useMemo(() => buildMonthCalendarDays(calendarBaseDate), [calendarBaseDate]);
  const monthLabel = useMemo(
    () => calendarBaseDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    [calendarBaseDate]
  );
  const calendarRecords = useMemo<TrainingCalendarRecord[]>(() => {
    const savedRecords = history
      .map((item) => {
        const date = getReportCreatedDate(item);
        if (!date) return null;

        return {
          id: item.id,
          date,
          mode: item.mode,
          stroke: item.stroke,
          event: item.event,
          impression: item.impression || item.performanceMetrics?.analysis || item.metrics?.analysis || item.growthAdvice,
          sourceReport: item,
        } satisfies TrainingCalendarRecord;
      })
      .filter(Boolean) as TrainingCalendarRecord[];

    return [...savedRecords, ...trainingCalendarMockData];
  }, [history]);
  const recordsByDate = useMemo(() => (
    calendarRecords.reduce<Record<string, TrainingCalendarRecord[]>>((acc, record) => {
      const key = toCalendarDateKey(record.date);
      acc[key] = [...(acc[key] || []), record];
      return acc;
    }, {})
  ), [calendarRecords]);
  const selectedCalendarRecords = selectedCalendarDate ? recordsByDate[selectedCalendarDate] || [] : [];
  const tutorialStep = tutorialSteps[currentStep];
  const isLastTutorialStep = currentStep === tutorialSteps.length - 1;
  const isAuthenticated = Boolean(user);
  const modeBMetrics = report?.performanceMetrics || report?.metrics;

  const isAthleteProfileComplete = Boolean(athleteProfile.gender && athleteProfile.birthDate);

  const handleSelectModeB = () => {
    if (!isAthleteProfileComplete) {
      setPendingModeBAfterProfile(true);
      setShowProfileModal(true);
      return;
    }

    setMode('B');
  };

  const handleOpenProfileEditor = () => {
    setPendingModeBAfterProfile(false);
    setShowProfileModal(true);
  };

  const handleSaveAthleteProfile = async (profile: AthleteProfile) => {
    if (!user) {
      toast.error('Please login before saving athlete profile.');
      return;
    }

    setIsProfileSaving(true);
    try {
      await saveUserProfile(user);
      await setDoc(doc(db, 'users', user.uid), {
        gender: profile.gender,
        birthDate: profile.birthDate,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setAthleteProfile(profile);
      setShowProfileModal(false);
      toast.success('泳者檔案已更新');
      if (pendingModeBAfterProfile) {
        setMode('B');
        setPendingModeBAfterProfile(false);
      }
    } catch (error) {
      console.error('[Athlete Profile] Failed to save profile:', error);
      handleFirestoreError(error, OperationType.UPDATE, 'users');
    } finally {
      setIsProfileSaving(false);
    }
  };

  const handlePlaybackRateChange = (rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
  };

  const handleSeek = (timestamp: string) => {
    if (!videoRef.current) {
      toast.info('目前沒有可連動的分析影片。');
      return;
    }

    videoRef.current.currentTime = timestampToSeconds(timestamp);
    videoRef.current.playbackRate = playbackRate;
    videoRef.current.play().catch((error) => {
      console.error('Failed to autoplay analysis video after seek:', error);
    });
  };

  const handleCloseTutorial = () => {
    setShowTutorial(false);
    localStorage.setItem('hasSeenTutorial', 'true');
  };

  const handleGoogleLogin = async () => {
    setIsSigningIn(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      await saveUserProfile(result.user);
      setUser(result.user);
      toast.success('登入成功');
    } catch (error) {
      console.error('[驗證錯誤]', error);
      toast.error(getAuthErrorMessage(error));
    } finally {
      setIsSigningIn(false);
    }
  };

  useEffect(() => {
    setSelectedCalendarDate(null);
  }, [selectedMonth]);

  useEffect(() => {
    if (!localStorage.getItem('hasSeenTutorial')) {
      setShowTutorial(true);
    }
  }, []);

  useEffect(() => {
    if (!showTutorial || !user || currentStep !== 0) {
      return;
    }

    const autoAdvanceTimer = setTimeout(() => {
      setCurrentStep(1);
    }, 700);

    return () => clearTimeout(autoAdvanceTimer);
  }, [currentStep, showTutorial, user]);

  useEffect(() => {
    if (!isAnalyzing) {
      setLoadingMessageIndex(0);
      return;
    }

    const messageInterval = setInterval(() => {
      setLoadingMessageIndex((current) => (current + 1) % loadingMessages.length);
    }, 2200);

    return () => clearInterval(messageInterval);
  }, [isAnalyzing, loadingMessages.length]);

  useEffect(() => {
    let isMounted = true;
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      if (!isMounted) return;
      setUser(u);
      setIsAuthReady(true);
      if (u) {
        setIsSigningIn(false);
        setIsProfileLoading(true);
        setShowProfileModal(true);
        getDoc(doc(db, 'users', u.uid))
          .then((snapshot) => {
            if (!isMounted) return;
            const data = snapshot.data();
            const cloudGender = data?.gender;
            const cloudBirthDate = data?.birthDate;

            if ((cloudGender === 'M' || cloudGender === 'F') && typeof cloudBirthDate === 'string' && cloudBirthDate) {
              setAthleteProfile({ gender: cloudGender, birthDate: cloudBirthDate });
              setShowProfileModal(false);
              setPendingModeBAfterProfile(false);
            } else {
              setAthleteProfile({ gender: '', birthDate: '' });
              setPendingModeBAfterProfile(false);
              setShowProfileModal(true);
            }
          })
          .catch((error) => {
            if (!isMounted) return;
            console.error('[Athlete Profile] Failed to load cloud profile:', error);
            handleFirestoreError(error, OperationType.GET, 'users');
            setShowProfileModal(false);
          })
          .finally(() => {
            if (!isMounted) return;
            setIsProfileLoading(false);
          });
      } else {
        setAthleteProfile({ gender: '', birthDate: '' });
        setShowProfileModal(false);
        setIsProfileLoading(false);
        setIsProfileSaving(false);
        setPendingModeBAfterProfile(false);
      }
    });

    completeGoogleRedirectSignIn()
      .then((redirectUser) => {
        if (redirectUser && isMounted) {
          setUser(redirectUser);
          setIsAuthReady(true);
          setIsSigningIn(false);
          toast.success('登入成功');
        }
      })
      .catch((error) => {
        if (!isMounted) return;
        setIsAuthReady(true);
        setIsSigningIn(false);
        toast.error(getAuthErrorMessage(error));
      });

    return () => {
      isMounted = false;
      unsubscribe();
    };
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
        setUser(signedInUser);
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
        const months = snapshot.docs
          .map((reportDoc) => getReportCreatedDate(reportDoc.data() as AnalysisReport & { createdAt: any }))
          .filter((date): date is Date => Boolean(date))
          .map((date) => toMonthKey(date));

        setAvailableMonths(Array.from(new Set([toMonthKey(new Date()), ...months])).sort((a, b) => b.localeCompare(a)));
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'reports');
      });

      return () => unsubscribe();
    }

    setAvailableMonths([toMonthKey(new Date())]);
  }, [user]);

  useEffect(() => {
    if (user) {
      const { start, end } = getMonthRange(selectedMonth);
      const q = query(
        collection(db, 'reports'),
        where('uid', '==', user.uid),
        where('createdAt', '>=', Timestamp.fromDate(start)),
        where('createdAt', '<=', Timestamp.fromDate(end)),
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
    }

    setHistory([]);
  }, [user, selectedMonth]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log('[前端追蹤] 檔案選擇事件已觸發');
    if (!isAuthenticated) {
      console.warn('[前端阻斷] 未登入，禁止選擇影片檔案');
      toast.error('請先登入 Google 帳戶，以啟用 AI 影片分析功能。');
      e.target.value = '';
      return;
    }

    const file = e.target.files?.[0];
    console.log('[前端追蹤] 目前選擇的檔案狀態:', file || null);
    if (file) {
      if (!file.type.startsWith('video/')) {
        console.warn('[前端阻斷] 選擇的檔案不是影片，提早結束執行');
        toast.error('請上傳影片檔。');
        e.target.value = '';
        return;
      }
      setVideoFile(file);
      setVideoPreview(URL.createObjectURL(file));
    }
  };

  const handleAnalyze = async () => {
    console.log('[前端追蹤] 1. 按鈕已點擊，準備處理上傳');
    console.log('[前端追蹤] 2. 目前選擇的檔案狀態:', videoFile);

    if (!isAuthenticated) {
      console.warn('[前端阻斷] 未登入，禁止執行核心分析功能', { mode });
      toast.error('請先登入 Google 帳戶。');
      return;
    }

    if (!mode) {
      console.warn('[前端阻斷] 缺少檔案或必要條件，提早結束執行', { mode, videoFile });
      return;
    }
    
    if (mode === 'A' && !eventA) {
      console.warn('[前端阻斷] 缺少檔案或必要條件，提早結束執行', { mode, eventA, videoFile });
      toast.error('請填寫游泳項目 (例如：50公尺自由式)');
      return;
    }
    if (mode === 'B') {
      if (!isAthleteProfileComplete) {
        console.warn('[Mode B Profile] 缺少泳者生理檔案，開啟資料收集彈窗');
        setShowProfileModal(true);
        return;
      }

      const isValid = raceEntries.every(entry => 
        entry.event && entry.time && entry.poolLength
      );
      if (!isValid) {
        console.warn('[前端阻斷] 缺少檔案或必要條件，提早結束執行', { mode, raceEntries });
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
      if (mode === 'A' && !videoFile) {
        console.warn('[前端阻斷] 缺少檔案或必要條件，將以無影片狀態呼叫分析', { mode, videoFile });
      }

      console.log('[前端追蹤] 3. 開始上傳至 Firebase Storage...');
      const uploadedVideo = mode === 'A' && videoFile
        ? await uploadVideoForAnalysis(videoFile)
        : null;
      const historicalFindings = mode === 'B' && user
        ? await fetchLatestModeAFindings(user.uid, history)
        : [];
      if (mode === 'B') {
        console.log('[跨模式聯動] 送入 Mode B 的歷史 Mode A 瑕疵:', historicalFindings);
      }
      console.log('[前端追蹤] 4. 上傳成功，取得網址:', uploadedVideo?.downloadURL || null);

      console.log('[前端追蹤] 5. 準備呼叫 /api/analyze');
      const result = await analyzeSwim(mode, {
        videoStoragePath: uploadedVideo?.storagePath,
        videoStorageBucket: uploadedVideo?.bucket,
        videoMimeType: uploadedVideo?.mimeType,
        videoUrl: uploadedVideo?.downloadURL,
        startTime: mode === 'A' ? startTime.trim() || undefined : undefined,
        endTime: mode === 'A' ? endTime.trim() || undefined : undefined,
        targetDescription: mode === 'A' ? targetDescription.trim() || undefined : undefined,
        textInput: mode === 'A' ? textInput : undefined,
        event: mode === 'A' ? eventA : undefined,
        athleteProfile: mode === 'B' ? athleteProfile : undefined,
        historicalFindings: mode === 'B' && historicalFindings.length > 0 ? historicalFindings : undefined,
        raceEntries: mode === 'B' ? raceEntries.map(e => ({
          event: e.event,
          time: e.time,
          strokeCounts: lapValuesToNumbers(e.strokeCounts),
          poolLength: e.poolLength,
          splits: lapValuesToNumbers(e.splits)
        })) : undefined
      });
      const normalizedResult: AnalysisReport = result.mode === 'B'
        ? {
            ...result,
            performanceMetrics: result.performanceMetrics || result.metrics,
            metrics: result.metrics || result.performanceMetrics,
          }
        : result;
      console.log('[前端追蹤] 6. /api/analyze 已回傳結果:', result);

      // Save to Firestore if logged in
      if (user) {
        try {
          console.log('[前端追蹤] 7. 準備寫入個人 reports 歷史紀錄');
          await addDoc(collection(db, 'reports'), {
            ...normalizedResult,
            uid: user.uid,
            createdAt: serverTimestamp(),
            event: mode === 'A' ? eventA : raceEntries[0].event,
            athleteProfile: mode === 'B' ? athleteProfile : null,
            videoUrl: uploadedVideo?.downloadURL || null
          });
          console.log('[前端追蹤] 8. 個人 reports 歷史紀錄寫入完成');
        } catch (err) {
          console.error('[前端上傳錯誤]:', err);
          handleFirestoreError(err, OperationType.CREATE, 'reports');
        }
      }

      setProgress(100);
      setTimeout(() => {
        setReport(normalizedResult);
        setCurrentReportVideoUrl(uploadedVideo?.downloadURL || null);
        setActiveTab('report');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 500);
    } catch (error) {
      console.error('[前端上傳錯誤]:', error);
      console.error('Analysis failed:', error);
      toast.error(error instanceof Error ? error.message : '分析失敗，請稍後再試。');
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
    setTextInput('');
    setEventA('');
    setStartTime('');
    setEndTime('');
    setTargetDescription('');
    setCurrentReportVideoUrl(null);
    setPlaybackRate(1);
    setRaceEntries([createRaceEntry()]);
  };

  const addRaceEntry = () => {
    setRaceEntries([
      ...raceEntries,
      createRaceEntry()
    ]);
  };

  const removeRaceEntry = (id: number) => {
    if (raceEntries.length > 1) {
      setRaceEntries(raceEntries.filter(e => e.id !== id));
    }
  };

  const updateRaceEntry = (id: number, field: 'event' | 'time' | 'poolLength', value: string) => {
    setRaceEntries(raceEntries.map((entry) => {
      if (entry.id !== id) return entry;

      const nextEntry = { ...entry, [field]: value };
      if (field === 'event' || field === 'poolLength') {
        const lapCount = calculateLapCount(nextEntry.event, nextEntry.poolLength);
        return {
          ...nextEntry,
          splits: resizeLapValues(lapCount),
          strokeCounts: resizeLapValues(lapCount),
        };
      }

      return nextEntry;
    }));
  };

  const handleArrayChange = (entryId: number, field: 'splits' | 'strokeCounts', index: number, value: string) => {
    setRaceEntries(entries => entries.map(entry => {
      if (entry.id !== entryId) return entry;
      const newArray = [...(entry[field] || [])];
      newArray[index] = value;
      return { ...entry, [field]: newArray };
    }));
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
      {showTutorial && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full mx-4">
            <div className="mb-6">
              <p className="text-[10px] uppercase tracking-[0.24em] font-bold text-[#93B7BE] mb-2">
                SwimFlow AI Onboarding
              </p>
              <h2 className="text-2xl font-bold text-[#2D3047] font-serif italic">
                {tutorialStep.title}
              </h2>
            </div>

            {'description' in tutorialStep && (
              <p className="text-sm leading-relaxed text-ink/70">
                {tutorialStep.description}
              </p>
            )}

            {tutorialStep.kind === 'login' && (
              user ? (
                <button
                  type="button"
                  disabled
                  className="mt-5 w-full rounded-full bg-green-600 px-5 py-3 text-[11px] font-bold uppercase tracking-widest text-white cursor-default"
                >
                  已成功登入：{user.displayName || user.email || 'Google 使用者'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={!isAuthReady || isSigningIn}
                  className="mt-5 w-full rounded-full bg-[#2D3047] px-5 py-3 text-[11px] font-bold uppercase tracking-widest text-white hover:bg-[#93B7BE] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSigningIn ? 'Signing in...' : '使用 Google 帳戶登入'}
                </button>
              )
            )}

            {'items' in tutorialStep && (
              <ul className="mt-1 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-ink/70">
                {tutorialStep.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}

            <div className="mt-8 flex items-center justify-center gap-2">
              {tutorialSteps.map((step, index) => (
                <span
                  key={step.title}
                  className={cn(
                    "h-2.5 w-2.5 rounded-full transition-all duration-200",
                    index === currentStep ? "bg-[#2D3047] scale-110" : "bg-slate-200"
                  )}
                />
              ))}
            </div>

            <div className="mt-8 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleCloseTutorial}
                className="text-[11px] font-bold uppercase tracking-widest text-ink/45 hover:text-[#2D3047] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg active:scale-95"
              >
                略過教學
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentStep((step) => Math.max(step - 1, 0))}
                  disabled={currentStep === 0}
                  className="rounded-full bg-[#2D3047] px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-white hover:bg-[#93B7BE] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  上一步
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (isLastTutorialStep) {
                      handleCloseTutorial();
                      return;
                    }
                    setCurrentStep((step) => Math.min(step + 1, tutorialSteps.length - 1));
                  }}
                  className="rounded-full bg-[#2D3047] px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-white hover:bg-[#93B7BE] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg active:scale-95"
                >
                  {isLastTutorialStep ? '開始使用' : '下一步'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <AthleteProfileModal
        isOpen={showProfileModal}
        initialProfile={athleteProfile}
        isLoading={isProfileLoading}
        isSaving={isProfileSaving}
        onSave={handleSaveAthleteProfile}
        onCancel={() => {
          setShowProfileModal(false);
          setPendingModeBAfterProfile(false);
        }}
      />
      {/* Header */}
      <header className="border-b border-ink/10 p-4 md:p-6 flex flex-col sm:flex-row justify-between items-center bg-white/80 backdrop-blur-md sticky top-0 z-50 gap-4 sm:gap-0">
        <div className="flex items-center gap-3 cursor-pointer w-full sm:w-auto" onClick={resetMode} role="button" tabIndex={0}>
          <div className="bg-ink p-2 rounded-2xl shadow-lg shadow-ink/20">
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
                  "p-2 rounded-full transition-all",
                  activeTab === 'history' ? "bg-ink text-white shadow-lg shadow-ink/20 hover:bg-accent" : "bg-ink/5 text-ink/60 hover:bg-ink hover:text-white"
                )}
                title="History"
              >
                <History className="w-5 h-5" />
              </button>
              <button
                onClick={handleOpenProfileEditor}
                className="p-2 bg-ink/5 text-ink/60 hover:bg-ink hover:text-white rounded-full transition-all"
                title="Edit Profile"
              >
                <UserIcon className="w-5 h-5" />
              </button>
              <button 
                onClick={logout}
                className="p-2 bg-ink text-white hover:bg-accent rounded-full transition-all"
                title="Logout"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <button 
              onClick={handleSignIn}
              disabled={!isAuthReady || isSigningIn}
              className="flex items-center gap-2 bg-ink text-white px-6 py-2 rounded-full text-[11px] uppercase tracking-widest font-bold hover:bg-accent transition-all shadow-lg shadow-ink/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <LogIn className="w-4 h-4" /> {isSigningIn ? 'Signing in...' : 'Login'}
            </button>
          )}

          {mode && (
            <div className="flex gap-2 bg-ink/5 p-1 rounded-full">
              <button 
                onClick={() => setActiveTab('input')}
                className={cn(
                  "text-xs sm:text-[11px] uppercase tracking-widest px-4 sm:px-6 py-2 transition-all rounded-full font-bold",
                  activeTab === 'input' ? "bg-white text-accent shadow-sm" : "text-ink/60 hover:text-ink"
                )}
              >
                Input
              </button>
              <button 
                onClick={() => report && setActiveTab('report')}
                disabled={!report}
                className={cn(
                  "text-xs sm:text-[11px] uppercase tracking-widest px-4 sm:px-6 py-2 transition-all rounded-full font-bold",
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
                <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
                  <label className="flex items-center justify-between gap-3 rounded-full border border-ink/30 bg-white px-4 py-2 text-ink shadow-sm shadow-ink/5 sm:justify-start">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Month</span>
                    <select
                      value={selectedMonth}
                      onChange={(event) => setSelectedMonth(event.target.value)}
                      className="bg-transparent text-xs font-bold text-ink outline-none"
                    >
                      {monthOptions.map((monthKey) => (
                        <option key={monthKey} value={monthKey}>
                          {formatMonthOption(monthKey)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    onClick={() => setActiveTab('input')}
                    className="rounded-full bg-ink px-5 py-2 text-[10px] uppercase tracking-widest font-bold text-white hover:bg-accent flex items-center justify-center gap-2"
                  >
                    <ArrowLeft className="w-3 h-3" /> Back to App
                  </button>
                </div>
              </div>

              <div className="bg-white border border-ink/10 rounded-[2rem] p-4 sm:p-8 shadow-xl shadow-ink/5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                  <div className="flex items-center gap-3">
                    <div className="h-11 w-11 rounded-full bg-ink text-white flex items-center justify-center">
                      <CalendarDays className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.24em] font-bold text-accent">Training Calendar</p>
                      <h3 className="text-xl sm:text-2xl font-bold text-ink">{monthLabel}</h3>
                    </div>
                  </div>
                  <p className="text-xs text-ink/50 max-w-sm leading-relaxed">
                    Blue dots mark days with analysis records. Mock data is included for preview.
                  </p>
                </div>

                <div className="grid grid-cols-7 gap-2 sm:gap-3 text-center">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((weekday) => (
                    <div key={weekday} className="py-2 text-[10px] sm:text-xs font-bold uppercase tracking-widest text-ink/40">
                      {weekday}
                    </div>
                  ))}
                  {calendarDays.map((cell) => {
                    const dateKey = cell.date ? toCalendarDateKey(cell.date) : cell.key;
                    const recordsForDay = cell.date ? recordsByDate[dateKey] || [] : [];
                    const hasRecords = recordsForDay.length > 0;
                    const isToday = dateKey === todayKey;

                    return (
                      <button
                        key={cell.key}
                        type="button"
                        disabled={!cell.date}
                        onClick={() => hasRecords && setSelectedCalendarDate(dateKey)}
                        className={cn(
                          "min-h-14 sm:min-h-20 rounded-2xl border border-transparent p-2 flex flex-col items-center justify-center gap-1 transition-all",
                          !cell.date && "pointer-events-none opacity-0",
                          cell.date && "bg-paper/60 text-ink hover:border-accent/40 hover:bg-white",
                          hasRecords && "cursor-pointer shadow-sm hover:shadow-md hover:-translate-y-0.5",
                          isToday && "bg-ink text-white hover:bg-accent hover:text-white"
                        )}
                      >
                        {cell.date && (
                          <>
                            <span className="text-sm sm:text-base font-bold">{cell.date.getDate()}</span>
                            <span className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              hasRecords ? (isToday ? "bg-white" : "bg-ink") : "bg-transparent"
                            )} />
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <AnimatePresence>
                {selectedCalendarDate && (
                  <div className="fixed inset-0 z-[90]">
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 bg-ink/30 backdrop-blur-sm"
                      onClick={() => setSelectedCalendarDate(null)}
                    />
                    <motion.aside
                      initial={{ opacity: 0, x: 40 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 40 }}
                      className="absolute inset-x-4 bottom-4 top-auto max-h-[82vh] overflow-y-auto rounded-[2rem] bg-white p-5 shadow-2xl md:inset-y-6 md:left-auto md:right-6 md:w-[420px] md:max-h-none md:p-7"
                    >
                      <div className="flex items-start justify-between gap-4 mb-6">
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.24em] font-bold text-accent">Daily Summary</p>
                          <h3 className="text-2xl font-bold text-ink">
                            {new Date(`${selectedCalendarDate}T00:00:00`).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric'
                            })}
                          </h3>
                        </div>
                        <button
                          onClick={() => setSelectedCalendarDate(null)}
                          className="h-10 w-10 rounded-full bg-ink text-white hover:bg-accent transition-colors flex items-center justify-center"
                          type="button"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>

                      <div className="space-y-3">
                        {selectedCalendarRecords.map((record) => (
                          <button
                            key={record.id}
                            type="button"
                            onClick={() => {
                              if (!record.sourceReport) return;
                              setReport(record.sourceReport);
                              setCurrentReportVideoUrl(record.sourceReport.videoUrl || null);
                              setMode(record.sourceReport.mode);
                              setSelectedCalendarDate(null);
                              setActiveTab('report');
                            }}
                            className="w-full text-left rounded-2xl border border-ink/10 bg-paper/60 p-4 hover:border-accent/50 hover:bg-white transition-all"
                          >
                            <div className="flex items-center justify-between gap-3 mb-3">
                              <span className="rounded-full bg-accent/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-accent">
                                Mode {record.mode}
                              </span>
                              {record.isMock && (
                                <span className="text-[10px] font-bold uppercase tracking-widest text-ink/30">Mock</span>
                              )}
                            </div>
                            <h4 className="text-base font-bold text-ink">{record.event || record.stroke || 'Analysis Report'}</h4>
                            <p className="text-xs text-ink/50 mt-1">Stroke: {record.stroke || 'N/A'}</p>
                            <p className="text-sm leading-relaxed text-ink/70 mt-3">
                              {record.impression || 'No summary available.'}
                            </p>
                          </button>
                        ))}
                      </div>
                    </motion.aside>
                  </div>
                )}
              </AnimatePresence>

              {history.length === 0 ? (
                <div className="bg-white border border-ink/5 p-16 rounded-[3rem] text-center space-y-4">
                  <div className="w-16 h-16 bg-ink text-white rounded-full flex items-center justify-center mx-auto">
                    <History className="w-8 h-8" />
                  </div>
                  <div>
                    <p className="font-serif italic text-ink">該月份尚無分析紀錄</p>
                    <p className="mt-2 text-xs font-bold uppercase tracking-widest text-ink/40">
                      {formatMonthOption(selectedMonth)}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid gap-4">
                  {history.map((item) => (
                    <div 
                      key={item.id}
                      onClick={() => {
                        setReport(item);
                        setCurrentReportVideoUrl(item.videoUrl || null);
                        setMode(item.mode);
                        setActiveTab('report');
                      }}
                      className="bg-white border border-ink/5 p-6 rounded-[2rem] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer flex items-center justify-between group"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
                        <div className={cn(
                          "w-12 h-12 rounded-2xl flex items-center justify-center text-white shrink-0",
                          item.mode === 'A' ? "bg-ink" : "bg-ink"
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
                className="group bg-white border border-ink/10 p-8 text-left hover:border-accent/70 transition-all rounded-[2rem] shadow-xl shadow-ink/5 hover:shadow-2xl hover:shadow-accent/10 hover:-translate-y-1"
              >
                <div className="w-12 h-12 sm:w-14 sm:h-14 bg-ink text-white rounded-full flex items-center justify-center mb-6 group-hover:bg-accent transition-colors">
                  <Play className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <h2 className="text-xl sm:text-2xl font-bold mb-2 uppercase tracking-tight font-serif italic text-ink">模式 A：動作技術診斷</h2>
                <p className="text-xs sm:text-sm text-ink/60 mb-6 leading-relaxed">上傳側面影片，分析姿勢問題並與奧運選手對標。適合修正泳姿細節。</p>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-accent">
                  Start Diagnosis <ChevronRight className="w-4 h-4" />
                </div>
              </button>

              <button 
                onClick={handleSelectModeB}
                className="group bg-white border border-ink/10 p-8 text-left hover:border-accent/70 transition-all rounded-[2rem] shadow-xl shadow-ink/5 hover:shadow-2xl hover:shadow-accent/10 hover:-translate-y-1"
              >
                <div className="w-12 h-12 sm:w-14 sm:h-14 bg-ink text-white rounded-full flex items-center justify-center mb-6 group-hover:bg-accent transition-colors">
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
                      {!isAuthenticated && (
                        <div className="rounded-2xl border border-[#2D3047]/15 bg-white p-4 text-center text-sm font-bold text-[#2D3047] shadow-sm">
                          請先點擊右上角登入 Google 帳戶，以啟用 AI 影片分析功能。
                        </div>
                      )}
                      <div className="space-y-2">
                        <label className="text-xs sm:text-[10px] uppercase tracking-widest font-bold opacity-50">游泳項目 (必填)</label>
                        <input 
                          type="text" 
                          placeholder="例如：50公尺自由式"
                          value={eventA}
                          onChange={(e) => setEventA(e.target.value)}
                          disabled={!isAuthenticated}
                          className={cn(
                            "w-full bg-white border border-ink/10 p-4 rounded-2xl focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all text-sm sm:text-base",
                            !isAuthenticated && "opacity-50 cursor-not-allowed"
                          )}
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs sm:text-[10px] uppercase tracking-widest font-bold opacity-50">上傳影片 (推薦)</label>
                        <div 
                          onClick={() => isAuthenticated && fileInputRef.current?.click()}
                          className={cn(
                            "border-2 border-dashed border-ink/10 aspect-video flex flex-col items-center justify-center transition-all overflow-hidden relative group rounded-[2rem]",
                            isAuthenticated
                              ? "cursor-pointer hover:bg-white hover:border-accent/50"
                              : "opacity-50 cursor-not-allowed"
                          )}
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
                            disabled={!isAuthenticated}
                            className="hidden"
                          />
                        </div>
                      </div>

                      <div className="rounded-[2rem] border border-ink bg-ink p-5 sm:p-6 text-white shadow-xl shadow-ink/10 space-y-4">
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.24em] font-bold text-accent">Target Tracking</p>
                          <h3 className="text-lg sm:text-xl font-bold uppercase tracking-tight font-serif italic">目標鎖定</h3>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-3">
                          <input
                            type="text"
                            value={startTime}
                            onChange={(e) => setStartTime(e.target.value)}
                            placeholder="起始時間"
                            disabled={!isAuthenticated}
                            className={cn(
                              "w-full rounded-2xl border border-white/15 bg-white/95 p-4 text-sm text-ink placeholder:text-ink/35 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all",
                              !isAuthenticated && "opacity-50 cursor-not-allowed"
                            )}
                          />
                          <input
                            type="text"
                            value={endTime}
                            onChange={(e) => setEndTime(e.target.value)}
                            placeholder="結束時間"
                            disabled={!isAuthenticated}
                            className={cn(
                              "w-full rounded-2xl border border-white/15 bg-white/95 p-4 text-sm text-ink placeholder:text-ink/35 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all",
                              !isAuthenticated && "opacity-50 cursor-not-allowed"
                            )}
                          />
                        </div>
                        <textarea
                          value={targetDescription}
                          onChange={(e) => setTargetDescription(e.target.value)}
                          placeholder="請描述目標學員特徵，例如：第3水道、戴紅色泳帽、黑色泳褲"
                          disabled={!isAuthenticated}
                          className={cn(
                            "w-full rounded-2xl border border-white/15 bg-white/95 p-4 h-28 text-sm text-ink placeholder:text-ink/35 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all resize-none",
                            !isAuthenticated && "opacity-50 cursor-not-allowed"
                          )}
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs sm:text-[10px] uppercase tracking-widest font-bold opacity-50">補充描述 (選填)</label>
                        <textarea 
                          placeholder="描述您的動作感受或想改進的地方..."
                          value={textInput}
                          onChange={(e) => setTextInput(e.target.value)}
                          disabled={!isAuthenticated}
                          className={cn(
                            "w-full bg-white border border-ink/10 p-4 h-32 rounded-2xl focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all resize-none text-sm sm:text-base",
                            !isAuthenticated && "opacity-50 cursor-not-allowed"
                          )}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-8">
                      {!isAuthenticated && (
                        <div className="rounded-2xl border border-[#2D3047]/15 bg-white p-4 text-center text-sm font-bold text-[#2D3047] shadow-sm">
                          請先登入 Google 帳戶，以載入專屬學員名單並生成訓練菜單。
                        </div>
                      )}
                      {raceEntries.map((entry, index) => (
                        <div
                          key={entry.id}
                          className={cn(
                            "p-6 sm:p-8 bg-white border border-ink/5 rounded-[2rem] shadow-sm space-y-6 relative group",
                            !isAuthenticated && "opacity-50 cursor-not-allowed"
                          )}
                        >
                          {(() => {
                            const distanceMatch = entry.event.match(/\d+/);
                            const distance = distanceMatch ? parseInt(distanceMatch[0], 10) : 0;
                            const poolLengthNum = parseInt(entry.poolLength || '50', 10);
                            const laps = distance > 0 ? Math.ceil(distance / poolLengthNum) : 1;

                            return (
                              <>
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-xs sm:text-[10px] font-bold text-accent uppercase tracking-widest">Entry #{index + 1}</span>
                            {raceEntries.length > 1 && (
                              <button 
                                onClick={() => removeRaceEntry(entry.id)}
                                disabled={!isAuthenticated}
                                className={cn(
                                  "text-xs sm:text-[10px] uppercase tracking-widest font-bold text-red-400 hover:text-red-500 transition-colors",
                                  !isAuthenticated && "cursor-not-allowed hover:text-red-400"
                                )}
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
                                disabled={!isAuthenticated}
                                className="w-full bg-paper/50 border border-ink/10 p-4 rounded-2xl focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all text-sm sm:text-base disabled:cursor-not-allowed"
                              >
                                {modeBEventOptions.map(ev => (
                                  <option key={ev} value={ev}>{ev}</option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-2">
                              <label className="text-xs sm:text-[10px] uppercase tracking-widest font-bold opacity-50">比賽秒數 (必填)</label>
                              <input 
                                type="text" 
                                placeholder="例如：58.5"
                                value={entry.time}
                                onChange={(e) => updateRaceEntry(entry.id, 'time', e.target.value)}
                                disabled={!isAuthenticated}
                                className="w-full bg-paper/50 border border-ink/10 p-4 rounded-2xl focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all text-sm sm:text-base disabled:cursor-not-allowed"
                              />
                            </div>
                          </div>

                          <div className="grid md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                              <label className="text-xs sm:text-[10px] uppercase tracking-widest font-bold opacity-50">泳池長度 (必填)</label>
                              <select 
                                value={entry.poolLength}
                                onChange={(e) => updateRaceEntry(entry.id, 'poolLength', e.target.value)}
                                disabled={!isAuthenticated}
                                className="w-full bg-paper/50 border border-ink/10 p-4 rounded-2xl focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all text-sm sm:text-base disabled:cursor-not-allowed"
                              >
                                <option value="25">25 公尺</option>
                                <option value="50">50 公尺</option>
                              </select>
                            </div>
                            <div className="rounded-2xl border border-accent/15 bg-accent/5 p-4">
                              <p className="text-[10px] uppercase tracking-widest font-bold text-accent">Total Laps</p>
                              <p className="mt-1 text-2xl font-bold text-ink">{laps} 趟</p>
                            </div>
                          </div>

                          <div className="md:col-span-2 space-y-4 pt-4 border-t border-ink/10">
                            <div className="flex items-center gap-2 mb-2">
                              <h4 className="text-xs sm:text-[10px] uppercase tracking-widest font-bold opacity-50">各趟分段數據 (自動展開)</h4>
                              <span className="text-[10px] font-bold text-accent bg-accent/10 px-2 py-0.5 rounded-full">共 {laps} 趟</span>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                              {Array.from({ length: laps }).map((_, index) => (
                                <div key={index} className="bg-paper/50 border border-ink/10 p-4 rounded-2xl space-y-3">
                                  <p className="text-[10px] font-bold text-accent uppercase tracking-widest border-b border-ink/10 pb-2">
                                    第 {index + 1} 趟 ({poolLengthNum}m)
                                  </p>
                                  <div className="space-y-1.5">
                                    <label className="text-[9px] uppercase tracking-widest font-bold opacity-50">分段秒數</label>
                                    <input 
                                      type="text" 
                                      placeholder="如: 14.5"
                                      value={(entry.splits && entry.splits[index]) || ''}
                                      onChange={(e) => handleArrayChange(entry.id, 'splits', index, e.target.value)}
                                      disabled={!isAuthenticated}
                                      className="w-full bg-white border border-ink/10 p-2.5 rounded-xl text-sm focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all disabled:opacity-50"
                                    />
                                  </div>
                                  <div className="space-y-1.5">
                                    <label className="text-[9px] uppercase tracking-widest font-bold opacity-50">划手數 (選填)</label>
                                    <input 
                                      type="text" 
                                      placeholder="如: 18"
                                      value={(entry.strokeCounts && entry.strokeCounts[index]) || ''}
                                      onChange={(e) => handleArrayChange(entry.id, 'strokeCounts', index, e.target.value)}
                                      disabled={!isAuthenticated}
                                      className="w-full bg-white border border-ink/10 p-2.5 rounded-xl text-sm focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all disabled:opacity-50"
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                              </>
                            );
                          })()}
                        </div>
                      ))}

                      <button 
                        onClick={addRaceEntry}
                        disabled={!isAuthenticated}
                        className={cn(
                          "w-full border-2 border-dashed border-accent/20 p-6 rounded-[2rem] flex items-center justify-center gap-2 text-[11px] uppercase tracking-widest font-bold",
                          isAuthenticated
                            ? "bg-accent/5 text-accent hover:bg-accent/10 transition-all"
                            : "bg-gray-400 text-white opacity-50 cursor-not-allowed"
                        )}
                      >
                        <span className="text-xl">+</span> Add Another Race Entry
                      </button>
                    </div>
                  )}

                  {isAnalyzing ? (
                    <div className="w-full rounded-[2rem] border border-accent/30 bg-white p-6 shadow-xl shadow-accent/10">
                      <div className="flex flex-col items-center gap-5 text-center">
                        <div className="relative h-14 w-14">
                          <div className="absolute inset-0 rounded-full border-4 border-accent/15" />
                          <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-accent animate-spin" />
                          <div className="absolute inset-2 rounded-full bg-accent/10" />
                        </div>
                        <div className="space-y-2">
                          <p className="text-sm font-bold tracking-[0.2em] text-ink uppercase">AI Analysis Running</p>
                          <AnimatePresence mode="wait">
                            <motion.p
                              key={loadingMessageIndex}
                              initial={{ opacity: 0, y: 8 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -8 }}
                              className="text-sm font-bold text-accent"
                            >
                              {loadingMessages[loadingMessageIndex]}
                            </motion.p>
                          </AnimatePresence>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-ink/10">
                          <motion.div
                            className="h-full rounded-full bg-accent"
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.round(progress)}%` }}
                            transition={{ duration: 0.4, ease: 'easeOut' }}
                          />
                        </div>
                        <p className="font-mono text-[10px] font-bold tracking-widest text-ink/40">
                          {Math.round(progress)}%
                        </p>
                      </div>
                    </div>
                  ) : (
                    <button 
                      onClick={handleAnalyze}
                      disabled={!isAuthenticated}
                      className={cn(
                        "w-full text-white py-6 rounded-full font-bold uppercase tracking-[0.3em] flex items-center justify-center gap-4",
                        isAuthenticated
                          ? "bg-[#2D3047] hover:bg-[#93B7BE] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg active:scale-95 shadow-lg shadow-ink/20"
                          : "bg-gray-400 opacity-50 cursor-not-allowed"
                      )}
                    >
                      Start AI Analysis
                    </button>
                  )}
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
                      {currentReportVideoUrl && (
                        <section className="rounded-[2rem] border border-ink/10 bg-ink p-4 sm:p-6 text-white shadow-xl shadow-ink/10">
                          <div className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-black">
                            <video
                              ref={videoRef}
                              src={currentReportVideoUrl}
                              controls
                              preload="metadata"
                              className="aspect-video w-full bg-black object-contain"
                              onLoadedMetadata={() => handlePlaybackRateChange(playbackRate)}
                            />
                          </div>
                          <VideoRetentionAlert />
                          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-accent">Playback Controls</p>
                              <h3 className="font-serif text-lg font-bold italic tracking-tight">專業播放控制面板</h3>
                            </div>
                            <div className="flex gap-2">
                              {[1, 0.5, 0.25].map((rate) => (
                                <button
                                  key={rate}
                                  type="button"
                                  onClick={() => handlePlaybackRateChange(rate)}
                                  className={cn(
                                    "rounded-full px-4 py-2 text-[10px] font-bold uppercase tracking-widest",
                                    playbackRate === rate
                                      ? "bg-accent text-ink"
                                      : "bg-white/10 text-white hover:bg-accent hover:text-ink"
                                  )}
                                >
                                  {rate}x
                                </button>
                              ))}
                            </div>
                          </div>
                        </section>
                      )}
                      {!currentReportVideoUrl && <VideoRetentionAlert />}

                      <section className="relative">
                        <Quote className="absolute -top-6 -left-6 w-12 h-12 opacity-5 text-accent hidden sm:block" />
                        <h3 className="text-sm sm:text-xs uppercase tracking-[0.2em] font-bold mb-6 sm:mb-8 flex items-center gap-2 text-accent">
                          <Activity className="w-4 h-4" /> Technical Diagnosis
                        </h3>
                        <div className="space-y-6 sm:space-y-8">
                          {report.findings?.map((finding, idx) => (
                            <div key={idx} className="pl-4 sm:pl-6 border-l-4 border-accent/20">
                              <p className="text-lg sm:text-2xl font-serif italic leading-relaxed mb-2 text-ink">
                                {"\""}<TimestampText text={finding.metaphor} onSeek={handleSeek} />{"\""}
                              </p>
                              <p className="text-[11px] sm:text-sm text-ink/60 font-medium uppercase tracking-wider leading-relaxed">
                                <TimestampText text={finding.analysis} onSeek={handleSeek} />
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
                                  <TimestampText text={suggestion.mnemonic} onSeek={handleSeek} />
                                </p>
                              </div>
                              <div className="bg-paper/50 border border-ink/5 p-5 sm:p-8 flex-grow rounded-3xl">
                                <h4 className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] font-bold mb-2 text-accent leading-tight">
                                  核心練習：<TimestampText text={suggestion.drill.name} onSeek={handleSeek} />
                                </h4>
                                <p className="text-xs sm:text-sm leading-relaxed text-ink/70">
                                  <TimestampText text={suggestion.drill.purpose} onSeek={handleSeek} />
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    </div>
                  )}

                  {/* Mode B Specific Content */}
                  {report.mode === 'B' && modeBMetrics && (
                    <div className="space-y-12">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6">
                        {[
                          { label: 'SWOLF', value: modeBMetrics.swolf, icon: Activity },
                          { label: 'DPS (m)', value: modeBMetrics.dps, icon: Target },
                          { label: 'CSS', value: modeBMetrics.css, icon: Timer },
                          { label: 'FINA Points', value: modeBMetrics.finaPoints, icon: Trophy },
                        ].map((stat) => (
                          <div key={stat.label} className="bg-white border border-ink/10 p-4 sm:p-6 rounded-[2rem] flex flex-col items-center justify-center text-center shadow-sm hover:shadow-md transition-shadow">
                            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-[#2D3047] text-white">
                              <stat.icon className="w-4 h-4 sm:w-5 sm:h-5" />
                            </div>
                            <p className="text-[9px] sm:text-[10px] uppercase tracking-widest font-bold opacity-50 mb-0.5">{stat.label}</p>
                            <p className="text-lg sm:text-3xl font-bold text-ink">{stat.value || '--'}</p>
                          </div>
                        ))}
                      </div>

                      <section>
                        <h3 className="text-sm sm:text-xs uppercase tracking-[0.2em] font-bold mb-4 flex items-center gap-2 text-accent">
                          <FileText className="w-4 h-4" /> Efficiency Analysis
                        </h3>
                        <p className="text-lg sm:text-2xl leading-relaxed text-ink/80 font-serif italic">
                          {"\""}<TimestampText text={modeBMetrics.analysis} onSeek={handleSeek} />{"\""}
                        </p>
                      </section>

                      {report.trainingPlan && (
                        <section className="space-y-5">
                          <h3 className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold flex items-center gap-2 text-[#2D3047]">
                            <Dumbbell className="w-4 h-4 text-[#93B7BE]" /> Scientific Training Plan
                          </h3>
                          <div className="grid md:grid-cols-2 gap-4">
                            <div className="bg-white border border-ink/10 p-6 rounded-[2rem] shadow-sm">
                              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl bg-[#2D3047] text-white">
                                <Waves className="w-5 h-5" />
                              </div>
                              <h4 className="text-[9px] sm:text-[10px] uppercase tracking-widest font-bold text-accent mb-2">Warmup (暖身)</h4>
                              <p className="text-xs sm:text-sm leading-relaxed text-ink/75"><TimestampText text={report.trainingPlan.warmup} onSeek={handleSeek} /></p>
                            </div>
                            <div className="bg-white border border-ink/10 p-6 rounded-[2rem] shadow-sm">
                              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl bg-[#2D3047] text-white">
                                <Target className="w-5 h-5" />
                              </div>
                              <h4 className="text-[9px] sm:text-[10px] uppercase tracking-widest font-bold text-accent mb-2">Drills (技術練習)</h4>
                              <p className="text-xs sm:text-sm leading-relaxed text-ink/75"><ModeALinkedPlanText text={report.trainingPlan.drills} onSeek={handleSeek} /></p>
                            </div>
                            <div className="md:col-span-2 bg-[#2D3047] border border-ink/10 p-6 rounded-[2rem] shadow-xl shadow-ink/10 text-white">
                              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#93B7BE] text-[#2D3047]">
                                <Dumbbell className="w-5 h-5" />
                              </div>
                              <h4 className="text-[9px] sm:text-[10px] uppercase tracking-widest font-bold text-[#93B7BE] mb-2">Main Set (主課表)</h4>
                              <p className="text-sm sm:text-base font-bold leading-relaxed"><TimestampText text={report.trainingPlan.mainSet} onSeek={handleSeek} /></p>
                            </div>
                            <div className="bg-white border border-ink/10 p-6 rounded-[2rem] shadow-sm md:col-span-2">
                              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl bg-[#2D3047] text-white">
                                <RotateCcw className="w-5 h-5" />
                              </div>
                              <h4 className="text-[9px] sm:text-[10px] uppercase tracking-widest font-bold text-accent mb-2">Cool Down (緩和)</h4>
                              <p className="text-xs sm:text-sm leading-relaxed text-ink/75"><TimestampText text={report.trainingPlan.coolDown} onSeek={handleSeek} /></p>
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
                      <p className="text-base sm:text-xl leading-relaxed italic font-serif text-ink/80">
                        <TimestampText text={report.growthAdvice} onSeek={handleSeek} />
                      </p>
                    </div>
                  </section>

                  {/* Missing Data Warning */}
                  {report.missingData && report.missingData.length > 0 && (
                    <div className="bg-yellow-100 border border-yellow-400 p-4 text-yellow-800 text-xs mt-8">
                      <p className="font-bold mb-1 uppercase tracking-widest">⚠️ Missing Data for Precise Analysis:</p>
                      <ul className="list-disc list-inside">
                        {report.missingData.map((item, i) => (
                          <li key={i}>
                            <TimestampText text={item} onSeek={handleSeek} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex justify-center pt-12">
                    <button 
                      onClick={resetMode}
                      className="px-10 py-4 bg-ink text-white rounded-2xl font-bold uppercase tracking-widest hover:bg-accent transition-all shadow-lg shadow-ink/20"
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
              <div className="bg-ink p-1 rounded-xl w-fit">
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
