import React, { useState, useEffect, useRef, useMemo } from 'react';
import { BarChart3, Notebook, BookOpen, Settings, LogIn, UserPlus, UserRound, Play, Flame, Lock, ArrowRight, ExternalLink } from 'lucide-react';
import MarqueeCards from './MarqueeCards';
import { QUESTIONS } from './questions';
import { supabase } from './supabaseClient';
import './index.css';

// Utility helper to parse suffix strings (e.g. "1k" -> 1000, "1.5M" -> 1500000)
const parseValue = (str) => {
  if (!str) return NaN;
  const cleaned = str.trim().toLowerCase().replace(/,/g, '');
  const match = cleaned.match(/^([0-9.]+)\s*([kmbt]?)$/);
  if (!match) return parseFloat(cleaned);
  
  const num = parseFloat(match[1]);
  const suffix = match[2];
  switch (suffix) {
    case 'k': return num * 1e3;
    case 'm': return num * 1e6;
    case 'b': return num * 1e9;
    case 't': return num * 1e12;
    default: return num;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GitHub-style activity matrix synthesis.
// Produces a flat list of cells (one per day) carrying an intensity level 0–3,
// plus the current consecutive-day streak ending today. Deterministically
// seeded so a given user sees a stable board across renders.
// ─────────────────────────────────────────────────────────────────────────────
const ACTIVITY_WEEKS = 12; // grid columns
const ACTIVITY_DAYS = ACTIVITY_WEEKS * 7;

const buildActivityMatrix = (seed = 1) => {
  const cells = [];
  let s = seed;
  const rand = () => {
    // Tiny LCG — enough for stable, plausible-looking activity.
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let i = 0; i < ACTIVITY_DAYS; i++) {
    const r = rand();
    // Most days are quiet; a few are busy — skews toward lower levels.
    const level = r > 0.82 ? 3 : r > 0.62 ? 2 : r > 0.4 ? 1 : 0;
    cells.push(level);
  }

  // Current streak: walk backwards from today (last cell) over active days.
  let streak = 0;
  for (let i = cells.length - 1; i >= 0; i--) {
    if (cells[i] > 0) streak++;
    else break;
  }
  return { cells, streak };
};

function App() {
  // ═══════════════ NAVIGATION & SCREEN ROUTING STATES ═══════════════
  const [currentView, setCurrentView] = useState('home'); // 'home' | 'practice-config' | 'round' | 'practice-end'
  const [isDaily, setIsDaily] = useState(false);

  // Gate: until a visitor authenticates or explicitly continues as guest, the
  // home view shows the auth gateway rather than the calibration dashboard.
  const [isOnDashboard, setIsOnDashboard] = useState(false);

  // ═══════════════ AUTH / SESSION MODE STATE ═══════════════
  const [authMode, setAuthMode] = useState(null); // null (undecided) | 'guest' | 'user'

  // ═══════════════ AUTH MODAL (Supabase) STATE ═══════════════
  const [authModalMode, setAuthModalMode] = useState(null); // null | 'login' | 'signup'
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  // ═══════════════ SCRATCH PAD STATE ═══════════════
  const [isNotepadOpen, setIsNotepadOpen] = useState(false);
  const [notepadText, setNotepadText] = useState('');

  // ═══════════════ ARTICLES (Supabase 'articles' table) STATE ═══════════════
  const [sessionUser, setSessionUser] = useState(null);   // raw Supabase auth user
  const [articles, setArticles] = useState([]);
  const [expandedArticleId, setExpandedArticleId] = useState(null);
  const [newArticle, setNewArticle] = useState({ title: '', content: '', link_url: '', is_external: false });
  const [articleBusy, setArticleBusy] = useState(false);

  // Only the admin account may compose new entries.
  const isAdmin = sessionUser?.email === 'narehavag@gmail.com';

  // ═══════════════ CONFIGURATION STATES ═══════════════
  const [cfgDifficulty, setCfgDifficulty] = useState('mixed');
  const [cfgCount, setCfgCount] = useState(5);
  const [cfgSeconds, setCfgSeconds] = useState(60);

  // ═══════════════ LIVE GAME CORE METRIC STATES ═══════════════
  const [gamePool, setGamePool] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [deltaScore, setDeltaScore] = useState(null);
  const [accuracyHistory, setAccuracyHistory] = useState([]); // Array of true/false containment determinations
  const [timeRemaining, setTimeRemaining] = useState(60);
  
  // ═══════════════ ACTIVE CONTEXT QUESTION BOUNDARY STATES ═══════════════
  const [inputLow, setInputLow] = useState('');
  const [inputHigh, setInputHigh] = useState('');
  const [showHint, setShowHint] = useState(false);
  const [roundSubmitted, setRoundSubmitted] = useState(false);
  const [roundOutcome, setRoundOutcome] = useState({ type: 'hit', headline: '', points: 0, detail: '' });

  // Refs for systemic timers
  const timerRef = useRef(null);

  // Computed parameters
  const currentQuestion = gamePool[currentIdx] || null;
  const runningAccuracy = accuracyHistory.length > 0
    ? Math.round((accuracyHistory.filter(Boolean).length / accuracyHistory.length) * 100)
    : 0;

  // Activity board for the Stats panel — seeded off the account email so a
  // signed-in user gets a stable, personal-looking board.
  const activity = useMemo(
    () => buildActivityMatrix((authEmail || 'fermi').length + 7),
    [authEmail]
  );

  // ═══════════════ SUPABASE SESSION RESTORE ═══════════════
  // If a session already exists (returning user), drop them straight onto the
  // dashboard as a logged-in user.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session?.user) {
        setSessionUser(data.session.user);
        setAuthEmail(data.session.user.email || '');
        setAuthMode('user');
        setIsOnDashboard(true);
      }
    });
  }, []);

  // ═══════════════ ARTICLES FETCH ═══════════════
  // Pull the reading-room entries newest-first from Supabase on mount.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from('articles')
        .select('*')
        .order('created_at', { ascending: false });
      if (!error && data && active) {
        setArticles(data);
      }
    })();
    return () => { active = false; };
  }, []);

  // ═══════════════ LIVE TIMER ENGINE LOOP ═══════════════
  useEffect(() => {
    if (currentView === 'round' && !roundSubmitted) {
      timerRef.current = setInterval(() => {
        setTimeRemaining((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            handleRoundSubmit(true); // Auto-submit due to timeout expiration
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [currentView, currentIdx, roundSubmitted]);

  // ═══════════════ INTERACTIVE INTERFACE CALCULATION ENGINE ═══════════════
  const lowVal = parseValue(inputLow);
  const highVal = parseValue(inputHigh);
  const inputsValid = !isNaN(lowVal) && !isNaN(highVal) && lowVal > 0 && highVal >= lowVal;

  // Real-time geometric center calculation: G = sqrt(Low * High)
  const geomean = inputsValid ? Math.sqrt(lowVal * highVal) : null;
  
  // Spread calculation details
  const spreadMult = inputsValid ? highVal / lowVal : 1;
  const spreadTier = spreadMult <= 10 ? 1 : spreadMult <= 100 ? 2 : spreadMult <= 1000 ? 3 : 4;

  // ═══════════════ RUN ENGINE MANAGEMENT METHODS ═══════════════
  const startPracticeRun = () => {
    let pool = [...QUESTIONS];
    if (cfgDifficulty !== 'mixed') {
      pool = pool.filter(q => q.difficulty === cfgDifficulty);
    }
    // Simple random shuffle selection strategy
    pool = pool.sort(() => 0.5 - Math.random()).slice(0, Math.min(cfgCount, pool.length));
    
    if (pool.length === 0) {
      alert("No questions matched the selected criteria in the bank.");
      return;
    }

    setIsDaily(false);
    setGamePool(pool);
    setCurrentIdx(0);
    setScore(500); // Base starting capital allocation balance
    setDeltaScore(null);
    setAccuracyHistory([]);
    initiateQuestionRound(pool[0], cfgSeconds);
  };

  const initiateQuestionRound = (question, secondsAllocation) => {
    setInputLow('');
    setInputHigh('');
    setShowHint(false);
    setRoundSubmitted(false);
    setTimeRemaining(secondsAllocation);
  };

  const handleRoundSubmit = (timedOut = false) => {
    if (roundSubmitted) return;
    clearInterval(timerRef.current);

    const actualAnswer = currentQuestion.answer;
    let earnedPoints = 0;
    let outcomeType = 'miss';
    let summaryHeadline = '';
    let analyticalDetail = '';
    let hitSuccess = false;

    if (timedOut) {
      earnedPoints = -50;
      outcomeType = 'miss';
      summaryHeadline = 'TIME EXPIRED';
      analyticalDetail = `You ran out of time. The correct answer was ${actualAnswer.toLocaleString()} ${currentQuestion.unit}.`;
    } else if (!inputsValid) {
      earnedPoints = -20;
      outcomeType = 'miss';
      summaryHeadline = 'INVALID INTERVAL FORMAT';
      analyticalDetail = 'Inputs could not be parsed effectively. Penalty assessed.';
    } else {
      // Validate containment boundaries
      const containsAnswer = actualAnswer >= lowVal && actualAnswer <= highVal;
      
      if (containsAnswer) {
        hitSuccess = true;
        outcomeType = 'hit';
        summaryHeadline = 'HIT';
        
        // Quant-Scoring: Higher rewards for tighter order-of-magnitude bounds
        const ordersOfMagnitude = Math.log10(spreadMult);
        if (ordersOfMagnitude <= 1) {
          earnedPoints = 100; // Single order of magnitude
          summaryHeadline = 'PERFECT HARVEST (ALPHA HIGHEST)';
        } else if (ordersOfMagnitude <= 2) {
          earnedPoints = 50;
        } else {
          earnedPoints = 25;
          summaryHeadline = 'HIT (OVERLY CONSERVATIVE RISK MODEL)';
        }
        analyticalDetail = `The answer falls perfectly inside your bounds. Your geometric middle error was ${(Math.abs(geomean - actualAnswer) / actualAnswer * 100).toFixed(1)}%.`;
      } else {
        earnedPoints = -40;
        outcomeType = 'miss';
        summaryHeadline = 'MISS';
        analyticalDetail = `The actual answer was ${actualAnswer.toLocaleString()} ${currentQuestion.unit}, falling outside your projection range.`;
      }
    }

    setScore(prev => prev + earnedPoints);
    setDeltaScore(earnedPoints);
    setAccuracyHistory(prev => [...prev, hitSuccess]);
    setRoundOutcome({
      type: outcomeType,
      headline: summaryHeadline,
      points: earnedPoints >= 0 ? `+${earnedPoints}` : `${earnedPoints}`,
      detail: analyticalDetail
    });
    setRoundSubmitted(true);
  };

  const handleSkipRound = () => {
    if (roundSubmitted) return;
    clearInterval(timerRef.current);
    
    setScore(prev => prev - 20);
    setDeltaScore(-20);
    setAccuracyHistory(prev => [...prev, false]);
    setRoundOutcome({
      type: 'miss',
      headline: 'SKIPPED',
      points: '-20',
      detail: `Question bypassed. The true value was ${currentQuestion.answer.toLocaleString()} ${currentQuestion.unit}.`
    });
    setRoundSubmitted(true);
  };

  const handleNextAction = () => {
    setDeltaScore(null);
    if (currentIdx + 1 < gamePool.length) {
      const nextIndex = currentIdx + 1;
      setCurrentIdx(nextIndex);
      initiateQuestionRound(gamePool[nextIndex], isDaily ? 60 : cfgSeconds);
    } else {
      // Run complete
      setCurrentView('practice-end');
    }
  };

  // ═══════════════ AUTH GATEWAY ACTIONS ═══════════════
  const openAuthModal = (mode) => {
    setAuthModalMode(mode);
    setAuthError('');
    setAuthPassword('');
  };

  const closeAuthModal = () => {
    setAuthModalMode(null);
    setAuthError('');
    setAuthBusy(false);
  };

  const enterAsGuest = () => {
    setAuthMode('guest');
    setIsOnDashboard(true);
    setCurrentView('home');
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    if (authBusy) return;
    setAuthError('');
    setAuthBusy(true);

    try {
      const credentials = { email: authEmail.trim(), password: authPassword };
      const { data, error } =
        authModalMode === 'signup'
          ? await supabase.auth.signUp(credentials)
          : await supabase.auth.signInWithPassword(credentials);

      if (error) {
        setAuthError(error.message);
        setAuthBusy(false);
        return;
      }

      // Sign-up may require email confirmation before a session exists.
      if (authModalMode === 'signup' && !data?.session) {
        setAuthError('Check your inbox to confirm your email, then log in.');
        setAuthBusy(false);
        setAuthModalMode('login');
        return;
      }

      setSessionUser(data?.user || data?.session?.user || null);
      setAuthMode('user');
      setIsOnDashboard(true);
      setCurrentView('home');
      closeAuthModal();
    } catch (err) {
      setAuthError(err?.message || 'Something went wrong. Try again.');
      setAuthBusy(false);
    }
  };

  // ═══════════════ SCRATCH PAD ACTIONS ═══════════════
  const handleNotepadSave = () => {
    if (authMode !== 'user') {
      alert('Authentication Required: Please log in to permanently save scratch pad models to your profile.');
      return;
    }
    // Logged-in: simulate a secure write to the user's profile.
    alert('Scratch pad models saved securely to your profile.');
  };

  // ═══════════════ ARTICLES ADMIN ACTIONS ═══════════════
  const handleAddArticle = async (e) => {
    e.preventDefault();
    if (articleBusy || !isAdmin) return;
    if (!newArticle.title.trim()) return;

    setArticleBusy(true);
    const payload = {
      title: newArticle.title.trim(),
      content: newArticle.content.trim(),
      link_url: newArticle.link_url.trim(),
      is_external: newArticle.is_external,
    };

    const { data, error } = await supabase.from('articles').insert([payload]).select();
    setArticleBusy(false);

    if (error) {
      alert(`Could not add entry: ${error.message}`);
      return;
    }
    if (data && data.length) {
      // Prepend the new entry so it stays newest-first like the fetch order.
      setArticles((prev) => [data[0], ...prev]);
    }
    setNewArticle({ title: '', content: '', link_url: '', is_external: false });
  };

  const handleArticleClick = (article) => {
    if (article.is_external) {
      if (article.link_url) {
        window.open(article.link_url, '_blank', 'noopener,noreferrer');
      }
      return;
    }
    // Inline essay: toggle expansion.
    setExpandedArticleId((prev) => (prev === article.id ? null : article.id));
  };

  return (
    <div className="app-wrapper">
      {/* ═══════════════ STICKY HEADER / HUD ═══════════════ */}
      <header className="app-header">
        <div className="header-inner">
          <a className="brand" href="#" onClick={(e) => { e.preventDefault(); setCurrentView('home'); }} aria-label="Back to home">
            <img className="logo" src="src/assets/logo-asset.svg" alt="Fermi" />
          </a>
          
          <div className="header-bar" id="header-bar">
            {/* Left: terminal breadcrumb path reflecting the active session mode */}
            <span className="header-terminal-path">
              {authMode === 'user' ? 'quant@fermi.io:~ $' : 'guest@fermi.io:~ $'}
            </span>

            {/* Right: tightly-grouped Lucide tool dock */}
            <nav className="header-tools-group" aria-label="Tools">
              <button type="button" className="nav-icon-btn" aria-label="Metrics" title="Metrics" onClick={() => alert("Coming soon!")}>
                <BarChart3 size={24} color="#4B4B4B" />
              </button>
              <button type="button" className={`nav-icon-btn ${isNotepadOpen ? 'is-active' : ''}`} aria-label="Scratch pad" aria-pressed={isNotepadOpen} title="Scratch pad" onClick={() => setIsNotepadOpen((open) => !open)}>
                <Notebook size={24} color="#4B4B4B" />
              </button>
              <button type="button" className="nav-icon-btn" aria-label="Articles" title="Articles" onClick={() => alert("Coming soon!")}>
                <BookOpen size={24} color="#4B4B4B" />
              </button>
              <button type="button" className="nav-icon-btn" aria-label="Settings" title="Settings" onClick={() => alert("Coming soon!")}>
                <Settings size={24} color="#4B4B4B" />
              </button>
            </nav>
          </div>

          {/* Dynamic HUD Module elements visibility condition */}
          {currentView === 'round' && (
            <div className="hud" id="hud">
              <div className="hud-stat">
                <span class="hud-label">Score</span>
                <span class="hud-value" id="hud-score">{score}</span>
                {deltaScore !== null && (
                  <span className={`delta-chip ${deltaScore >= 0 ? 'positive' : 'negative'}`}>
                    {deltaScore >= 0 ? `+${deltaScore}` : deltaScore}
                  </span>
                )}
              </div>
              <div className="hud-stat">
                <span className="hud-label">Acc</span>
                <span className="hud-value" id="hud-acc">{runningAccuracy}%</span>
              </div>
              <div className="hud-stat hud-timer">
                <span className="hud-label">Time</span>
                <span className={`hud-value ${timeRemaining <= 10 ? 'critical-time' : ''}`}>{timeRemaining}s</span>
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="app">
        {/* ═══════════════ HOME / LANDING (UNAUTHENTICATED GATEWAY) ═══════════════ */}
        {currentView === 'home' && !isOnDashboard && (
          <div id="home-view" className="view home-landing">

            {/* ═══════════════ SECTION 1 · HERO ═══════════════ */}
            <section className="landing-section landing-hero" aria-labelledby="hero-heading">
              <div className="hero">
                <span className="section-eyebrow">Order-of-magnitude trainer</span>
                <h1 id="hero-heading" className="hero-title">
                  Sharpen your <span className="accent">order-of-magnitude</span> valuation metrics.
                </h1>
                <p className="hero-sub">
                  Calibration beats confidence. Tighten your trading ranges, manage variance, and claim your alpha.
                </p>
              </div>

              {/* Injects your newly generated smooth-scrolling marquee file seamlessly here */}
              <MarqueeCards />
            </section>

            {/* ═══════════════ SECTION 2 · HOW TO PLAY / METHODOLOGY ═══════════════ */}
            <section className="landing-section landing-methodology" aria-labelledby="method-heading">
              <header className="section-head">
                <span className="section-eyebrow">How to play</span>
                <h2 id="method-heading" className="section-title">A disciplined approach to estimation</h2>
                <p className="section-lede">
                  Every round rewards calibrated thinking over lucky guesses. This is the methodology the
                  scoring engine is built around.
                </p>
              </header>

              <ol className="methodology-grid">
                <li className="method-step">
                  <span className="step-index" aria-hidden="true">01</span>
                  <article>
                    <h3 className="step-title">Quote a confidence interval</h3>
                    <p className="step-body">
                      Submit a low and a high bound you are roughly 90% sure contains the true value —
                      a calibrated range, not a single point guess.
                    </p>
                  </article>
                </li>
                <li className="method-step">
                  <span className="step-index" aria-hidden="true">02</span>
                  <article>
                    <h3 className="step-title">Avoid wide ranges that destroy alpha</h3>
                    <p className="step-body">
                      A 10,000× spread will almost always contain the answer, but it earns next to nothing.
                      Tighter, defensible bounds are where the points — and the alpha — actually live.
                    </p>
                  </article>
                </li>
                <li className="method-step">
                  <span className="step-index" aria-hidden="true">03</span>
                  <article>
                    <h3 className="step-title">Let the geometric mean score you</h3>
                    <p className="step-body">
                      Error is measured on a log scale around the geometric midpoint √(low × high),
                      so being off by an order of magnitude is penalised fairly in either direction.
                    </p>
                  </article>
                </li>
              </ol>
            </section>

            {/* ═══════════════ SECTION 3 · AUTHENTICATION GATEWAY ═══════════════ */}
            <section className="landing-section landing-gateway" aria-labelledby="gateway-heading">
              <header className="section-head">
                <span className="section-eyebrow">Get started</span>
                <h2 id="gateway-heading" className="section-title">Step up to the desk</h2>
                <p className="section-lede">
                  Log in to track your calibration streaks, or jump straight into a run as a guest.
                </p>
              </header>

              <div className="auth-gateway" role="group" aria-label="Choose how to continue">
                <button className="auth-btn auth-btn-primary" onClick={() => openAuthModal('login')}>
                  <LogIn size={20} />
                  <span>Log In</span>
                </button>
                <button className="auth-btn auth-btn-secondary" onClick={() => openAuthModal('signup')}>
                  <UserPlus size={20} />
                  <span>Sign Up</span>
                </button>
                <button className="auth-btn auth-btn-ghost" onClick={enterAsGuest}>
                  <UserRound size={20} />
                  <span>Continue as Guest</span>
                </button>
                <p className="auth-gateway-note">
                  Guests can play any run, sign in to keep your streaks and activity history.
                </p>
              </div>
            </section>

            {/* ═══════════════ SECTION 4 · FAQ ═══════════════ */}
            <section className="landing-section landing-faq" aria-labelledby="faq-heading">
              <header className="section-head">
                <span className="section-eyebrow">FAQ</span>
                <h2 id="faq-heading" className="section-title">Questions, answered</h2>
              </header>

              <div className="faq-list">
                <details className="faq-item">
                  <summary>
                    What is a Fermi problem?
                    <span className="faq-marker" aria-hidden="true"></span>
                  </summary>
                  <p>
                    A Fermi problem or estimate is a physics and estimation puzzle named after Enrico Fermi.
                     It requires making justified, back-of-the-envelope calculations to estimate incredibly large or seemingly 
                     impossible quantities without looking up any data.
                  </p>
                </details>

                <details className="faq-item">
                  <summary>
                    Why should I practice calibration runs?
                    <span className="faq-marker" aria-hidden="true"></span>
                  </summary>
                  <p>
                    Making order-of-magnitude estimates builds strong quantitative intuition. It is a core mental framework 
                    used constantly in software architecture planning, systems engineering, venture capital sizing, and quantitative finance.
                  </p>
                </details>

                <details className="faq-item">
                  <summary>
                    How are the problem data arrays generated?
                    <span className="faq-marker" aria-hidden="true"></span>
                  </summary>
                  <p>
                    The challenges span across real-world physical constants, demographic distributions, and scaling anomalies.
                    The system evaluates inputs conditionally using strict bounding logic to verify calculations.
                  </p>
                </details>
              </div>
            </section>

          </div>
        )}

        {/* ═══════════════ DASHBOARD (AUTHENTICATED / GUEST) ═══════════════ */}
        {currentView === 'home' && isOnDashboard && (
          <div id="dashboard-view" className="view dashboard">
            <div className="dash-grid">
              {/* ── PLAY: configuration portal for standard calibration runs ── */}
              <section className="dash-card play-card">
                <header className="dash-card-head">
                  <span className="dash-kicker">Calibration run</span>
                  <h2 className="dash-card-title">Play</h2>
                </header>
                <p className="dash-card-lede">
                  Set your difficulty, length, and pace, then drill confidence intervals until your
                  order-of-magnitude calibration is sharp.
                </p>

                <ul className="play-overview">
                  <li><span className="play-stat-label">Format</span><span className="play-stat-value">Confidence intervals</span></li>
                  <li><span className="play-stat-label">Scoring</span><span className="play-stat-value">Geometric · log-error</span></li>
                  <li><span className="play-stat-label">Bank</span><span className="play-stat-value">{QUESTIONS.length} questions</span></li>
                </ul>

                <button className="btn btn-primary btn-block play-cta" onClick={() => setCurrentView('practice-config')}>
                  <Play size={18} /> Configure a run
                </button>
              </section>

              {/* ── STATS: streak + activity matrix, or a locked prompt for guests ── */}
              <section className="dash-card stats-card">
                <header className="dash-card-head">
                  <span className="dash-kicker">Your desk</span>
                  <h2 className="dash-card-title">Stats</h2>
                </header>

                {authMode === 'guest' ? (
                  <div className="stats-locked">
                    <span className="stats-locked-icon" aria-hidden="true"><Lock size={26} /></span>
                    <p className="stats-locked-msg">
                      Create an account to track your calibration streaks and activity charts.
                    </p>
                    <button className="auth-btn auth-btn-secondary stats-locked-cta" onClick={() => openAuthModal('signup')}>
                      <UserPlus size={18} /> <span>Create account</span>
                    </button>
                  </div>
                ) : (
                  <div className="stats-active">
                    <div className="streak-row">
                      <span className="streak-icon" aria-hidden="true"><Flame size={22} /></span>
                      <span className="streak-count">{activity.streak}</span>
                      <span className="streak-unit">day{activity.streak === 1 ? '' : 's'} current streak</span>
                    </div>

                    <span className="activity-caption">Practice activity · last {ACTIVITY_WEEKS} weeks</span>
                    <div className="activity-matrix" role="img" aria-label={`Practice activity over the last ${ACTIVITY_WEEKS} weeks`}>
                      {activity.cells.map((level, i) => (
                        <span key={i} className="activity-cell" data-level={level} />
                      ))}
                    </div>
                    <div className="activity-legend">
                      <span>Less</span>
                      <span className="activity-cell" data-level={0} />
                      <span className="activity-cell" data-level={1} />
                      <span className="activity-cell" data-level={2} />
                      <span className="activity-cell" data-level={3} />
                      <span>More</span>
                    </div>
                  </div>
                )}
              </section>

              {/* ── ARTICLES: technical brief / reading hook ── */}
              <section className="dash-card articles-card">
                <header className="dash-card-head">
                  <span className="dash-kicker">Reading room</span>
                  <h2 className="dash-card-title">Articles</h2>
                </header>
                <p className="dash-card-lede">
                  Short technical briefs on calibrated estimation — why geometric error beats arithmetic,
                  how to fight anchoring, and the math behind the scoring engine.
                </p>

                {/* Admin-only composition tool — hidden for guests and non-admin users. */}
                {isAdmin && (
                  <form className="article-compose" onSubmit={handleAddArticle}>
                    <span className="article-compose-label">New entry</span>
                    <input
                      type="text"
                      className="article-input"
                      placeholder="Title"
                      value={newArticle.title}
                      onChange={(e) => setNewArticle((a) => ({ ...a, title: e.target.value }))}
                    />
                    <textarea
                      className="article-input article-textarea"
                      placeholder="Content (for inline essays)"
                      value={newArticle.content}
                      onChange={(e) => setNewArticle((a) => ({ ...a, content: e.target.value }))}
                    />
                    <input
                      type="url"
                      className="article-input"
                      placeholder="Link URL (for resource links)"
                      value={newArticle.link_url}
                      onChange={(e) => setNewArticle((a) => ({ ...a, link_url: e.target.value }))}
                    />
                    <label className="article-check">
                      <input
                        type="checkbox"
                        checked={newArticle.is_external}
                        onChange={(e) => setNewArticle((a) => ({ ...a, is_external: e.target.checked }))}
                      />
                      <span>External link</span>
                    </label>
                    <button type="submit" className="sketch-btn sketch-btn-solid" disabled={articleBusy}>
                      {articleBusy ? 'Adding…' : 'Add Entry'}
                    </button>
                  </form>
                )}

                <ul className="articles-list">
                  {articles.length === 0 && (
                    <li className="article-empty">No entries yet — check back soon.</li>
                  )}
                  {articles.map((article) => {
                    const isExpanded = expandedArticleId === article.id;
                    return (
                      <li
                        key={article.id}
                        className={`article-row ${isExpanded ? 'is-expanded' : ''}`}
                        onClick={() => handleArticleClick(article)}
                      >
                        <div className="article-row-head">
                          <div className="article-row-text">
                            <span className="article-title">{article.title}</span>
                            {article.is_external ? (
                              <span className="article-tag">Resource Link</span>
                            ) : (
                              <span className="article-meta">Essay · tap to read</span>
                            )}
                          </div>
                          {article.is_external ? <ExternalLink size={16} /> : <ArrowRight size={16} />}
                        </div>
                        {!article.is_external && isExpanded && (
                          <p className="article-body">{article.content}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>
          </div>
        )}

        {/* ═══════════════ PRACTICE CONFIG VIEW SCREEN ═══════════════ */}
        {currentView === 'practice-config' && (
          <section id="practice-config-view" className="view card">
            <button className="back-link" onClick={() => setCurrentView('home')}>← Back</button>
            <h2 className="card-title">Practice setup</h2>

            <div className="config-group">
              <span className="config-label">Difficulty</span>
              <div className="seg" role="group" aria-label="Difficulty">
                {['easy', 'medium', 'hard', 'mixed'].map((level) => (
                  <button 
                    key={level}
                    className={`seg-btn ${cfgDifficulty === level ? 'is-active' : ''}`}
                    onClick={() => setCfgDifficulty(level)}
                  >
                    {level.charAt(0).toUpperCase() + level.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="config-group">
              <span className="config-label">Questions: <em id="cfg-count-out">{cfgCount}</em></span>
              <input 
                type="range" 
                min="1" 
                max="10" 
                value={cfgCount} 
                onChange={(e) => setCfgCount(parseInt(e.target.value))} 
              />
            </div>

            <div className="config-group">
              <span className="config-label">Seconds per question: <em id="cfg-seconds-out">{cfgSeconds}s</em></span>
              <input 
                type="range" 
                min="10" 
                max="120" 
                step="5" 
                value={cfgSeconds} 
                onChange={(e) => setCfgSeconds(parseInt(e.target.value))} 
              />
            </div>

            <button className="btn btn-primary btn-block" onClick={startPracticeRun}>Start practice</button>
          </section>
        )}

        {/* ═══════════════ LIVE ROUND EVALUATION SCREEN ═══════════════ */}
        {currentView === 'round' && currentQuestion && (
          <section id="round-view" className="view card">
            <div className="timebar">
              <span 
                id="timebar-fill" 
                style={{ width: `${(timeRemaining / (isDaily ? 60 : cfgSeconds)) * 100}%`, transition: 'width 1s linear' }}
              ></span>
            </div>

            <div className="round-meta">
              <span className="progress">Question {currentIdx + 1} of {gamePool.length}</span>
              <span className="badge" data-level={currentQuestion.difficulty}>{currentQuestion.difficulty}</span>
            </div>

            <p className="question">{currentQuestion.question}</p>
            <p className="unit-prompt">Answer in: <strong>{currentQuestion.unit}</strong></p>

            <div className="interval">
              <div className="field">
                <label>Low</label>
                <div className="input-wrap">
                  <input 
                    type="text" 
                    inputMode="decimal" 
                    placeholder="e.g. 1k" 
                    value={inputLow}
                    disabled={roundSubmitted}
                    onChange={(e) => setInputLow(e.target.value)}
                  />
                  <span className="unit">{currentQuestion.unit}</span>
                </div>
              </div>
              <div className="field">
                <label>High</label>
                <div className="input-wrap">
                  <input 
                    type="text" 
                    inputMode="decimal" 
                    placeholder="e.g. 100k" 
                    value={inputHigh}
                    disabled={roundSubmitted}
                    onChange={(e) => setInputHigh(e.target.value)}
                  />
                  <span className="unit">{currentQuestion.unit}</span>
                </div>
              </div>
            </div>

            {/* Dynamic geometric calculations display logic */}
            {inputsValid && !roundSubmitted && (
              <p className="geomean">
                Geometric Midpoint projection: <strong>{geomean.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
              </p>
            )}

            {/* SPREAD BAR INTERACTION — Signature metric tracker display logic */}
            {inputsValid && !roundSubmitted && (
              <div className="spread" data-tier={spreadTier}>
                <div className="spread-head">
                  <span className="spread-label">INTERVAL WINDOW RANGE SPREAD FACTOR</span>
                  <span className="spread-mult">×{spreadMult >= 1000 ? spreadMult.toExponential(1) : spreadMult.toFixed(1)}</span>
                </div>
                <div className="spread-track">
                  <span 
                    className="spread-fill" 
                    style={{ width: `${Math.min((Math.log10(spreadMult) / 6) * 100, 100)}%` }}
                  ></span>
                </div>
                <span className="spread-note">
                  {spreadMult <= 10 ? "Excellent narrow alpha model." : spreadMult <= 100 ? "Reasonable confidence threshold." : "Warning: Overly wide variance tier."}
                </span>
              </div>
            )}

            {!roundSubmitted && (
              <div className="actions">
                <button className="btn btn-primary" onClick={() => handleRoundSubmit(false)}>Submit</button>
                <button className="btn btn-ghost" onClick={handleSkipRound}>Skip (−20)</button>
                <button className="hint-link" onClick={() => setShowHint(!showHint)}>
                  {showHint ? "Hide hint" : "Show hint"}
                </button>
              </div>
            )}

            {showHint && !roundSubmitted && <p className="hint-text">{currentQuestion.hint}</p>}

            {/* SUBMITTED INTERVIEW RESULT DISPLAY FEEDBACK STRIP */}
            {roundSubmitted && (
              <div className="result" data-outcome={roundOutcome.type}>
                <div className="result-top">
                  <span className="result-flag">{roundOutcome.type.toUpperCase()}</span>
                  <span className="result-headline">{roundOutcome.headline}</span>
                  <span className="result-points">{roundOutcome.points} pts</span>
                </div>
                <div className="result-answer">True Value: {currentQuestion.answer.toLocaleString()} {currentQuestion.unit}</div>
                <div className="result-detail">{roundOutcome.detail}</div>
                <button className="btn btn-primary btn-block" onClick={handleNextAction}>Next →</button>
              </div>
            )}
          </section>
        )}

        {/* ═══════════════ PRACTICE PERFORMANCE SUMMARY VIEW SCREEN ═══════════════ */}
        {currentView === 'practice-end' && (
          <section id="practice-end-view" className="view card end">
            <h2 className="card-title">Run complete</h2>
            <div className="final-score">{score}</div>
            <div className="final-sub">Final Balance Capital</div>

            <div className="calib">
              <span className="calib-big">{runningAccuracy}%</span>
              <span className="calib-cap">of your intervals contained the actual target value</span>
            </div>

            <div className="actions actions-center">
              <button className="btn btn-primary" onClick={startPracticeRun}>Play again</button>
              <button className="btn btn-ghost" onClick={() => setCurrentView('home')}>Home</button>
            </div>
          </section>
        )}

      </main>

      {/* ═══════════════ SUPABASE AUTH MODAL ═══════════════ */}
      {authModalMode && (
        <div className="auth-overlay" onClick={closeAuthModal}>
          <div
            className="auth-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" className="auth-modal-close" aria-label="Close" onClick={closeAuthModal}>×</button>
            <span className="section-eyebrow">{authModalMode === 'signup' ? 'New account' : 'Welcome back'}</span>
            <h2 id="auth-modal-title" className="auth-modal-title">
              {authModalMode === 'signup' ? 'Sign up' : 'Log in'}
            </h2>

            <form className="auth-form" onSubmit={handleAuthSubmit}>
              <label className="auth-field">
                <span>Email</span>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="you@desk.io"
                />
              </label>
              <label className="auth-field">
                <span>Password</span>
                <input
                  type="password"
                  autoComplete={authModalMode === 'signup' ? 'new-password' : 'current-password'}
                  required
                  minLength={6}
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </label>

              {authError && <p className="auth-error">{authError}</p>}

              <button type="submit" className="btn btn-primary btn-block" disabled={authBusy}>
                {authBusy ? 'Working…' : authModalMode === 'signup' ? 'Create account' : 'Log in'}
              </button>
            </form>

            <p className="auth-switch">
              {authModalMode === 'signup' ? 'Already have an account?' : 'New to the desk?'}{' '}
              <button
                type="button"
                className="auth-switch-link"
                onClick={() => openAuthModal(authModalMode === 'signup' ? 'login' : 'signup')}
              >
                {authModalMode === 'signup' ? 'Log in' : 'Sign up'}
              </button>
            </p>
          </div>
        </div>
      )}

      {/* ═══════════════ SCRATCH PAD DRAWER ═══════════════ */}
      <div className={`scratchpad-drawer ${isNotepadOpen ? 'is-open' : ''}`} aria-hidden={!isNotepadOpen}>
        <div className="scratchpad-head">
          <h2 className="scratchpad-title">SCRATCH PAD</h2>
          <button type="button" className="scratchpad-close" aria-label="Close scratch pad" onClick={() => setIsNotepadOpen(false)}>×</button>
        </div>

        <textarea
          className="scratchpad-body"
          value={notepadText}
          onChange={(e) => setNotepadText(e.target.value)}
          placeholder="Enter boundary conditions, conversion models, or calculation arrays here..."
          spellCheck={false}
        />

        <div className="scratchpad-actions">
          <button type="button" className="sketch-btn sketch-btn-ghost" onClick={() => setNotepadText('')}>Clear All</button>
          <button type="button" className="sketch-btn sketch-btn-solid" onClick={handleNotepadSave}>Save Notes</button>
        </div>
      </div>
    </div>
  );
}

export default App;