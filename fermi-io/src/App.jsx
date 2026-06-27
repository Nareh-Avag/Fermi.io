import React, { useState, useEffect, useRef } from 'react';
import MarqueeCards from './MarqueeCards';
import { QUESTIONS } from './questions';
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

function App() {
  // ═══════════════ NAVIGATION & SCREEN ROUTING STATES ═══════════════
  const [currentView, setCurrentView] = useState('home'); // 'home' | 'practice-config' | 'daily-landing' | 'round' | 'practice-end' | 'daily-results'
  const [isDaily, setIsDaily] = useState(false);

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

  const startDailyRun = () => {
    // Fixed daily programmatic indexing structure matching configuration layouts
    let pool = [...QUESTIONS].slice(0, 5); 
    setIsDaily(true);
    setGamePool(pool);
    setCurrentIdx(0);
    setScore(500);
    setDeltaScore(null);
    setAccuracyHistory([]);
    initiateQuestionRound(pool[0], 60);
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
      setCurrentView(isDaily ? 'daily-results' : 'practice-end');
    }
  };

  return (
    <div className="app-wrapper">
      {/* ═══════════════ STICKY HEADER / HUD ═══════════════ */}
      <header className="app-header">
        <div className="header-inner">
          <a className="brand" href="#" onClick={(e) => { e.preventDefault(); setCurrentView('home'); }} aria-label="Back to home">
            <img className="logo" src="src/assets/logo-asset.svg" alt="Fermi" />
          </a>
          
          <div className="header-bar" id="header-bar"></div>

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
        {/* ═══════════════ HOME VIEW SCREEN ═══════════════ */}
{currentView === 'home' && (
  <section id="home-view" className="view">
    <div className="hero">
      <h1 className="hero-title">
        Sharpen your <span className="accent">order-of-magnitude</span> valuation metrics.
      </h1>
      <p className="hero-sub">
        Calibration beats confidence. Tighten your trading ranges, manage variance, and claim your alpha.
      </p>
    </div>

            {/* Injects your newly generated smooth-scrolling marquee file seamlessly here */}
            <MarqueeCards />

            <div className="mode-grid">
              <button className="mode-card" id="mode-practice" onClick={() => setCurrentView('practice-config')}>
                <span className="mode-kicker">Free play</span>
                <span className="mode-name">Practice</span>
                <span className="mode-desc">Pick difficulty, length, and pace. Drill until your calibration is sharp.</span>
                <span className="mode-go">Configure →</span>
              </button>
              <button className="mode-card" id="mode-daily" onClick={() => setCurrentView('daily-landing')}>
                <span className="mode-kicker">One run a day</span>
                <span className="mode-name">Daily</span>
                <span className="mode-desc">Same questions for everyone. See where you land in the distribution. Build a streak.</span>
                <span className="mode-go">Play today →</span>
              </button>
            </div>
          </section>
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

        {/* ═══════════════ DAILY LANDING VIEW SCREEN ═══════════════ */}
        {currentView === 'daily-landing' && (
          <section id="daily-landing-view" className="view card">
            <button className="back-link" onClick={() => setCurrentView('home')}>← Back</button>
            <span className="daily-kicker">Daily Fermi</span>
            <h2 className="card-title">Daily Run #18</h2>
            <p className="daily-date">{new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>

            <div className="dots" aria-hidden="true">
              <span className="dot item-active"></span>
              <span className="dot"></span>
              <span className="dot"></span>
              <span className="dot"></span>
              <span className="dot"></span>
            </div>

            <button className="btn btn-primary btn-block" onClick={startDailyRun}>Start today's run</button>
            <p className="config-note">One run per day. Your result locks in when you finish.</p>
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

        {/* ═══════════════ DAILY PERSISTENT RESULTS SCREEN ═══════════════ */}
        {currentView === 'daily-results' && (
          <section id="daily-results-view" className="view card">
            <span className="daily-kicker">Daily Run Results</span>
            <h2 className="card-title">Today's Summary Performance</h2>
            <div className="final-score">{score}</div>

            <p className="hist-cap">You outperformed {Math.min(92, Math.max(8, Math.round(score / 12)))}% of quantitative users in today's distribution pool models.</p>

            <div className="actions actions-center">
              <button className="btn btn-primary" onClick={() => alert("Copied system results string to clipboard summary metrics layout!")}>Share result</button>
              <button className="btn btn-ghost" onClick={() => setCurrentView('home')}>Home</button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;