import { db, computeDenseRanking, getCategoryComparisonKey } from './firebase.js';
import {
    collection, doc, getDoc, getDocs, onSnapshot, query, where
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// ─────────────────────────────────────────────
// State & Helpers
// ─────────────────────────────────────────────
let allResults = [];
let allPrograms = [];
let allTeams = [];
let previousTeamPoints = {};

// Safe Team Name Resolver using leaderboardData (which contains fresh team names)
function resolveTeamName(teamId, fallbackName) {
    if (teamId && Array.isArray(leaderboardData)) {
        const team = leaderboardData.find(t => String(t.id) === String(teamId));
        if (team && team.name) return team.name;
    }
    return fallbackName || '—';
}
let instId = new URLSearchParams(window.location.search).get('id') || new URLSearchParams(window.location.search).get('instId');
let instituteDetails = null;
let eventConfig = null;
let currentDisplayedResult = null;
let cachedLogoImg = null;
let cachedLogoSrc = null;

// Optimizations state
let activeResultUnsubscribe = null;
let activeResultKey = "";
let isInitInProgress = false;
let isInitialized = false;
let leaderboardData = [];
let cachedCategoryPerformance = null;
let isCategoryPerformanceStale = true;

function getEffectiveEventName() {
    return eventConfig?.eventName || instituteDetails?.name || "Results Portal";
}

function updateHeroHeader() {
    const headerEventName = document.getElementById('headerEventName');
    const headerEventTagline = document.getElementById('headerEventTagline');
    const headerMadrasaName = document.getElementById('headerMadrasaName');
    const headerEventLocation = document.getElementById('headerEventLocation');
    const headerEventDate = document.getElementById('headerEventDate');
    const headerOrganizerName = document.getElementById('headerOrganizerName');
    const headerLogo = document.getElementById('headerLogo');
    const headerLogoFallback = document.getElementById('headerLogoFallback');

    const metaMadrasa = document.getElementById('metaMadrasa');
    const metaLocation = document.getElementById('metaLocation');
    const metaDate = document.getElementById('metaDate');
    const metaOrganizer = document.getElementById('metaOrganizer');

    const displayEventName = eventConfig?.eventName || instituteDetails?.name || "Results Portal";
    const displayMadrasaName = eventConfig?.madrasaName || instituteDetails?.name || "";
    const displayEventTagline = eventConfig?.eventTagline || "";
    const displayEventLocation = eventConfig?.eventLocation || "";
    const displayOrganizerName = eventConfig?.organizerName || "";
    const displayEventLogo = eventConfig?.eventLogo || null;

    // Date formatting helper
    let displayEventDate = "";
    if (eventConfig?.eventStartDate) {
        const start = new Date(eventConfig.eventStartDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        if (eventConfig?.eventEndDate && eventConfig.eventEndDate !== eventConfig.eventStartDate) {
            const end = new Date(eventConfig.eventEndDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            displayEventDate = `${start} - ${end}`;
        } else {
            displayEventDate = start;
        }
    }

    if (headerEventName) headerEventName.textContent = displayEventName.toUpperCase();

    if (headerEventTagline) {
        if (displayEventTagline) {
            headerEventTagline.textContent = displayEventTagline;
            headerEventTagline.style.display = 'block';
        } else {
            headerEventTagline.style.display = 'none';
        }
    }

    // Bind metadata tags
    if (headerMadrasaName && displayMadrasaName) {
        headerMadrasaName.textContent = displayMadrasaName;
        if (metaMadrasa) metaMadrasa.style.display = 'flex';
    } else if (metaMadrasa) {
        metaMadrasa.style.display = 'none';
    }

    if (headerEventLocation && displayEventLocation) {
        headerEventLocation.textContent = displayEventLocation;
        if (metaLocation) metaLocation.style.display = 'flex';
    } else if (metaLocation) {
        metaLocation.style.display = 'none';
    }

    if (headerEventDate && displayEventDate) {
        headerEventDate.textContent = displayEventDate;
        if (metaDate) metaDate.style.display = 'flex';
    } else if (metaDate) {
        metaDate.style.display = 'none';
    }

    if (headerOrganizerName && displayOrganizerName) {
        headerOrganizerName.textContent = displayOrganizerName;
        if (metaOrganizer) metaOrganizer.style.display = 'flex';
    } else if (metaOrganizer) {
        metaOrganizer.style.display = 'none';
    }

    // Logo image or fallback
    if (headerLogo && headerLogoFallback) {
        if (displayEventLogo) {
            headerLogo.src = displayEventLogo;
            headerLogo.style.display = 'block';
            headerLogoFallback.style.display = 'none';
        } else {
            headerLogo.style.display = 'none';
            headerLogoFallback.style.display = 'block';
        }
    }

    // Populate Mobile-Only Header Concurrently
    const mobHeaderEventName = document.getElementById('mobHeaderEventName');
    const mobHeaderMadrasaName = document.getElementById('mobHeaderMadrasaName');
    const mobHeaderEventLocation = document.getElementById('mobHeaderEventLocation');
    const mobHeaderLogo = document.getElementById('mobHeaderLogo');
    const mobHeaderLogoFallback = document.getElementById('mobHeaderLogoFallback');

    if (mobHeaderEventName) mobHeaderEventName.textContent = displayEventName.toUpperCase();
    if (mobHeaderMadrasaName) mobHeaderMadrasaName.textContent = displayMadrasaName || "COMPETITION";
    if (mobHeaderEventLocation) mobHeaderEventLocation.textContent = displayEventLocation || "";

    if (mobHeaderLogo && mobHeaderLogoFallback) {
        if (displayEventLogo) {
            mobHeaderLogo.src = displayEventLogo;
            mobHeaderLogo.style.display = 'block';
            mobHeaderLogoFallback.style.display = 'none';
        } else {
            mobHeaderLogo.style.display = 'none';
            mobHeaderLogoFallback.style.display = 'block';
        }
    }
}

function updateTeamChampionship() {
    const leaderboardContainer = document.getElementById('teamLeaderboardContainer');
    const podiumContainer = document.getElementById('teamPodiumContainer');
    const championshipSection = document.getElementById('teamChampionshipSection');

    if (!leaderboardContainer || !podiumContainer || !championshipSection) return;

    // Use precalculated leaderboard from metadata/dashboard document
    let teamsArray = leaderboardData.map(t => ({ name: t.name, points: t.points }));

    // Sort and rank
    teamsArray.sort((a, b) => b.points - a.points);
    computeDenseRanking(teamsArray, t => t.points, 'rank');

    // Show championship section if no poster is currently being displayed
    const resultsList = document.getElementById('resultsList');
    const mobResultsList = document.getElementById('mobResultsList');
    const mobChampionshipSection = document.getElementById('mobChampionshipSection');
    const catPerfSection = document.getElementById('categoryPerformanceSection');
    const mobCatPerfSection = document.getElementById('mobCategoryPerformanceSection');

    if (!currentDisplayedResult) {
        championshipSection.style.display = 'flex';
        if (mobChampionshipSection) mobChampionshipSection.style.display = 'flex';
        if (catPerfSection) catPerfSection.style.display = 'flex';
        if (mobCatPerfSection) mobCatPerfSection.style.display = 'flex';
        resultsList.style.display = 'none';
        if (mobResultsList) mobResultsList.style.display = 'none';
    }

    if (teamsArray.length === 0) {
        podiumContainer.innerHTML = '';
        leaderboardContainer.innerHTML = `
            <div style="text-align:center; padding:3rem; color:#64748b; font-style:italic; font-weight:500; width: 100%;">
                No team points have been published yet.
            </div>
        `;
        const mobLeaderboardContainer = document.getElementById('mobLeaderboardContainer');
        if (mobLeaderboardContainer) {
            mobLeaderboardContainer.innerHTML = `
                <div style="text-align:center; padding:2rem 1rem; color:#64748b; font-style:italic; font-weight:600; width: 100%;">
                    No team points have been published yet.
                </div>
            `;
        }
        return;
    }

    // Split into podium (top 3) and leaderboard list (r >= 4)
    const podiumTeams = teamsArray.filter(t => t.rank <= 3);
    const listTeams = teamsArray.filter(t => t.rank > 3);

    // 2. Render Top 3 Podium
    podiumContainer.innerHTML = podiumTeams.map((t) => {
        const rank = t.rank;
        let cardModifier = '';
        let rankBadgeClass = '';
        let rankContent = '';
        let crownHTML = '';

        if (rank === 1) {
            cardModifier = 'podium-card-1st';
            rankBadgeClass = 'podium-rank-1st';
            rankContent = '🥇';
            crownHTML = '<span class="podium-crown">👑</span>';
        } else if (rank === 2) {
            cardModifier = 'podium-card-2nd';
            rankBadgeClass = 'podium-rank-2nd';
            rankContent = '🥈';
        } else if (rank === 3) {
            cardModifier = 'podium-card-3rd';
            rankBadgeClass = 'podium-rank-3rd';
            rankContent = '🥉';
        }

        const prevPoints = previousTeamPoints[t.name] || 0;

        return `
            <div class="podium-card ${cardModifier}" style="opacity: 1;">
                <div class="podium-rank-circle ${rankBadgeClass}">
                    ${crownHTML}
                    ${rankContent}
                </div>
                <div class="podium-team-title">${escapeHTML(t.name)}</div>
                <div class="podium-points" id="cnt-${t.name.replace(/\s+/g, '_')}" data-target="${t.points}" data-start="${prevPoints}">
                    ${prevPoints}
                </div>
                <div class="podium-points-label">points</div>
            </div>
        `;
    }).join('');

    // 3. Render remaining teams list (rank >= 4)
    const maxPoints = Math.max(...teamsArray.map(t => t.points), 1);

    if (listTeams.length === 0) {
        leaderboardContainer.innerHTML = '';
    } else {
        leaderboardContainer.innerHTML = listTeams.map((t, index) => {
            const pct = Math.min((t.points / maxPoints) * 100, 100);
            const prevPoints = previousTeamPoints[t.name] || 0;
            const animationDelay = `${index * 60}ms`;

            return `
                <div class="championship-card" style="animation-delay: ${animationDelay}; opacity: 1;">
                    <div class="team-info">
                        <div class="rank-badge rank-badge-other">
                            #${t.rank}
                        </div>
                        <div class="team-details-wrap">
                            <span class="team-title">${escapeHTML(t.name)}</span>
                        </div>
                    </div>
                    <div class="points-section">
                        <div class="progress-container">
                            <div class="progress-fill" style="width: ${pct}%"></div>
                        </div>
                        <div class="points-display" id="cnt-${t.name.replace(/\s+/g, '_')}" data-target="${t.points}" data-start="${prevPoints}">
                            ${prevPoints} pts
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // 4. Render Mobile Horizontal Leaderboard
    const mobileLeaderboardContainer = document.getElementById('mobLeaderboardContainer');
    if (mobileLeaderboardContainer) {
        const teamColors = [
            'linear-gradient(90deg, #fbbf24, #d97706)', // Gold/Orange (1st)
            'linear-gradient(90deg, #94a3b8, #475569)', // Silver/Slate (2nd)
            'linear-gradient(90deg, #fdba74, #c2410c)', // Bronze/Red (3rd)
            'linear-gradient(90deg, #3b82f6, #1d4ed8)', // Blue
            'linear-gradient(90deg, #10b981, #047857)', // Emerald
            'linear-gradient(90deg, #8b5cf6, #6d28d9)', // Violet
            'linear-gradient(90deg, #ec4899, #be185d)', // Pink
            'linear-gradient(90deg, #06b6d4, #0891b2)', // Cyan
            'linear-gradient(90deg, #6366f1, #4f46e5)', // Indigo
            'linear-gradient(90deg, #14b8a6, #0f766e)'  // Teal
        ];

        mobileLeaderboardContainer.innerHTML = teamsArray.map((t, index) => {
            const rank = t.rank;
            let rankClass = '';
            let rankBadgeText = `${rank}`;
            if (rank === 1) { rankClass = 'rank-1st'; rankBadgeText = '🥇'; }
            else if (rank === 2) { rankClass = 'rank-2nd'; rankBadgeText = '🥈'; }
            else if (rank === 3) { rankClass = 'rank-3rd'; rankBadgeText = '🥉'; }

            const pct = Math.min((t.points / maxPoints) * 100, 100);
            const prevPoints = previousTeamPoints[t.name] || 0;
            const accentColor = teamColors[index % teamColors.length];
            const animationDelay = `${index * 60}ms`;

            return `
                <div class="app-scoreboard-row" style="animation-delay: ${animationDelay}; opacity: 1;">
                    <div class="app-scoreboard-meta">
                        <div class="app-team-name-wrap">
                            <span class="app-rank-badge ${rankClass}">${rankBadgeText}</span>
                            <span>${escapeHTML(t.name)}</span>
                        </div>
                        <div class="app-team-points" id="cnt-mob-${t.name.replace(/\s+/g, '_')}" data-target="${t.points}" data-start="${prevPoints}">
                            ${prevPoints} Points
                        </div>
                    </div>
                    <div class="app-progress-track">
                        <div class="app-progress-bar" style="width: ${pct}%; background: ${accentColor};"></div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // 5. Animate point counters from start value to target value for ALL teams
    teamsArray.forEach(t => {
        // Desktop counter
        const elId = `cnt-${t.name.replace(/\s+/g, '_')}`;
        const el = document.getElementById(elId);
        if (el) {
            const start = parseInt(el.dataset.start, 10) || 0;
            const target = parseInt(el.dataset.target, 10) || 0;
            const isPodium = t.rank <= 3;
            animateCounterValue(el, start, target, 1200, isPodium, " pts");
        }

        // Mobile counter
        const elMobId = `cnt-mob-${t.name.replace(/\s+/g, '_')}`;
        const elMob = document.getElementById(elMobId);
        if (elMob) {
            const start = parseInt(elMob.dataset.start, 10) || 0;
            const target = parseInt(elMob.dataset.target, 10) || 0;
            animateCounterValue(elMob, start, target, 1200, false, " Points");
        }

        // Save current points as previous points for next update
        previousTeamPoints[t.name] = t.points;
    });

    updateCategoryPerformance();
}

// ─────────────────────────────────────────────
// Category Performance Chart Generator (Cached)
// ─────────────────────────────────────────────
function prepareCategoryPerformanceData() {
    if (!isCategoryPerformanceStale && cachedCategoryPerformance !== null) {
        return cachedCategoryPerformance;
    }

    if (!allResults || allResults.length === 0) {
        cachedCategoryPerformance = [];
        isCategoryPerformanceStale = false;
        return cachedCategoryPerformance;
    }

    // 1. Identify all teams across the portal (leaderboardData and allResults)
    const teamSet = new Set();
    if (Array.isArray(leaderboardData)) {
        leaderboardData.forEach(t => { if (t.name) teamSet.add(t.name); });
    }

    // 2. Accumulate points per category per team using exact Team Championship calculation
    const categoryMap = {}; // { [normCatName]: { [teamName]: points } }
    const canonicalCategoryNames = {}; // { [normCatName]: "Display Name" }
    const processedProgramIds = new Set();

    allResults.forEach(r => {
        if (r.status !== 'published') return;
        if (r.publicDisabled === true) return;
        if (r.leaderboardEnabled === false) return;

        // Deduplicate results by programId or result id (latest published result first)
        const progKey = r.programId || r.id;
        if (processedProgramIds.has(progKey)) return;
        processedProgramIds.add(progKey);

        const rawCatName = r.categoryName ? r.categoryName.trim() : '';
        if (!rawCatName) return;
        
        const catName = getCategoryComparisonKey(rawCatName);
        if (!canonicalCategoryNames[catName]) {
            canonicalCategoryNames[catName] = rawCatName;
        }

        if (!categoryMap[catName]) {
            categoryMap[catName] = {};
        }

        if (Array.isArray(r.marksData) && r.marksData.length > 0) {
            r.marksData.forEach(w => {
                if (w.teamId && w.teamId !== 'teamless' && w.totalPoints > 0) {
                    const pts = Number(w.totalPoints || 0);
                    categoryMap[catName][w.teamId] = (categoryMap[catName][w.teamId] || 0) + pts;
                    teamSet.add(w.teamId);
                }
            });
        } else if (Array.isArray(r.winners)) {
            r.winners.forEach(w => {
                if (w.teamId && w.teamId !== 'teamless' && w.marks > 0) {
                    const pts = Number(w.marks || 0);
                    categoryMap[catName][w.teamId] = (categoryMap[catName][w.teamId] || 0) + pts;
                    teamSet.add(w.teamId);
                }
            });
        }
    });

    const categoryNames = Object.keys(categoryMap);
    if (categoryNames.length === 0) {
        cachedCategoryPerformance = [];
        isCategoryPerformanceStale = false;
        return cachedCategoryPerformance;
    }

    // Sort category names logically (Play, Nursery, LKG, UKG, Class 1, etc.)
    const getCategorySortStats = (name) => {
        const n = (name || '').toLowerCase().trim();
        if (n.includes('play')) return -4;
        if (n.includes('nursery')) return -3;
        if (n.includes('lkg')) return -2;
        if (n.includes('ukg')) return -1;
        const m = n.match(/class\s*(\d+)/i) || n.match(/std\s*(\d+)/i) || n.match(/standard\s*(\d+)/i) || n.match(/(\d+)/);
        if (m) return parseInt(m[1], 10);
        return 999;
    };

    categoryNames.sort((a, b) => {
        const valA = getCategorySortStats(a);
        const valB = getCategorySortStats(b);
        if (valA !== valB) return valA - valB;
        return a.localeCompare(b);
    });

    // Assign consistent color mapping for each team across all categories
    const allTeamsSorted = Array.from(teamSet).map(id => {
        const teamObj = Array.isArray(leaderboardData) ? leaderboardData.find(t => t.id === id || t.name === id) : null;
        return teamObj ? teamObj.name : id;
    }).sort();

    // Assign consistent color mapping for each team across all categories
    const teamColorsPalette = [
        'linear-gradient(90deg, #3b82f6, #1d4ed8)', // Blue
        'linear-gradient(90deg, #10b981, #047857)', // Emerald / Green
        'linear-gradient(90deg, #f59e0b, #d97706)', // Amber / Orange
        'linear-gradient(90deg, #8b5cf6, #6d28d9)', // Purple / Violet
        'linear-gradient(90deg, #ec4899, #be185d)', // Pink
        'linear-gradient(90deg, #06b6d4, #0891b2)', // Cyan
        'linear-gradient(90deg, #6366f1, #4f46e5)', // Indigo
        'linear-gradient(90deg, #f43f5e, #e11d48)', // Rose
        'linear-gradient(90deg, #14b8a6, #0f766e)', // Teal
        'linear-gradient(90deg, #84cc16, #65a30d)'  // Lime
    ];

    const teamColorMap = {};
    Array.from(teamSet).forEach((teamId, idx) => {
        teamColorMap[teamId] = teamColorsPalette[idx % teamColorsPalette.length];
    });

    // Prepare complete structured category performance data
    cachedCategoryPerformance = categoryNames.map(catName => {
        const teamScoresObj = categoryMap[catName] || {};

        // Include ALL teams (even 0 point teams) so public sees full comparison
        const teamList = Array.from(teamSet).map(id => {
            let tName = id;
            if (Array.isArray(leaderboardData)) {
                const found = leaderboardData.find(t => t.id === id || t.name === id);
                if (found) tName = found.name;
            }
            return {
                name: tName,
                id: id,
                points: teamScoresObj[id] || 0,
                color: teamColorMap[id] || 'linear-gradient(90deg, #3b82f6, #1d4ed8)'
            };
        });

        // Sort teams inside category from highest points to lowest points (0 points at bottom)
        teamList.sort((a, b) => b.points - a.points);

        const maxPoints = Math.max(...teamList.map(t => t.points), 1);

        const processedTeams = teamList.map(t => ({
            ...t,
            pct: t.points > 0 ? Math.min(Math.round((t.points / maxPoints) * 100), 100) : 0
        }));

        return {
            categoryName: canonicalCategoryNames[catName] || catName,
            teams: processedTeams
        };
    });

    isCategoryPerformanceStale = false;
    return cachedCategoryPerformance;
}

function updateCategoryPerformance() {
    const desktopSection = document.getElementById('categoryPerformanceSection');
    const mobSection = document.getElementById('mobCategoryPerformanceSection');
    const desktopContainer = document.getElementById('categoryPerformanceContainer');
    const mobContainer = document.getElementById('mobCategoryPerformanceContainer');

    if (!desktopSection && !mobSection) return;

    // Toggle visibility based on whether single poster result is being viewed
    if (!currentDisplayedResult) {
        if (desktopSection) desktopSection.style.display = 'flex';
        if (mobSection) mobSection.style.display = 'flex';
    } else {
        if (desktopSection) desktopSection.style.display = 'none';
        if (mobSection) mobSection.style.display = 'none';
        return;
    }

    const data = prepareCategoryPerformanceData();

    if (!data || data.length === 0) {
        const emptyHTML = `
            <div style="text-align:center; padding:2.5rem; color:#64748b; font-style:italic; font-weight:500; width:100%;">
                No category performance data published yet.
            </div>
        `;
        if (desktopContainer) desktopContainer.innerHTML = emptyHTML;
        if (mobContainer) mobContainer.innerHTML = emptyHTML;
        return;
    }

    // Build Desktop HTML
    let desktopHTML = '';
    // Build Mobile HTML
    let mobHTML = '';

    data.forEach(item => {
        const catName = item.categoryName;
        const teams = item.teams;

        desktopHTML += `
            <div class="cat-perf-card">
                <div class="cat-perf-title">
                    <span>📁</span> ${escapeHTML(catName)}
                </div>
                <div class="cat-perf-bars">
                    ${teams.map(t => `
                        <div class="cat-perf-row">
                            <div class="cat-perf-team-name">${escapeHTML(t.name)}</div>
                            <div class="cat-perf-track">
                                <div class="cat-perf-bar" style="width: ${t.pct}%; background: ${t.color};"></div>
                            </div>
                            <div class="cat-perf-val">${t.points} pts</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        mobHTML += `
            <div class="app-cat-perf-card">
                <div class="app-cat-perf-title">
                    <span>📁</span> ${escapeHTML(catName)}
                </div>
                <div class="app-cat-perf-bars">
                    ${teams.map(t => `
                        <div class="app-cat-perf-row">
                            <div class="app-cat-perf-team-name">${escapeHTML(t.name)}</div>
                            <div class="app-cat-perf-track">
                                <div class="app-cat-perf-bar" style="width: ${t.pct}%; background: ${t.color};"></div>
                            </div>
                            <div class="app-cat-perf-val">${t.points} pts</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    });

    if (desktopContainer) desktopContainer.innerHTML = desktopHTML;
    if (mobContainer) mobContainer.innerHTML = mobHTML;
}

function animateCounterValue(element, start, end, duration, isPodium = false, suffix = " pts") {
    if (start === end) {
        element.textContent = isPodium ? end : `${end}${suffix}`;
        return;
    }
    const range = end - start;
    let current = start;
    const increment = end > start ? 1 : -1;
    const stepTime = Math.max(Math.abs(Math.floor(duration / Math.abs(range))), 15);

    const timer = setInterval(() => {
        current += Math.ceil(Math.abs(range) / 20) * increment;
        if ((increment === 1 && current >= end) || (increment === -1 && current <= end)) {
            current = end;
            clearInterval(timer);
        }
        element.textContent = isPodium ? current : `${current}${suffix}`;
    }, stepTime);
}

// Tracks the selected background style (1..10 or 'custom') per card result ID
const cardBgMap = {};

// Tracks the selected template style (1, 2, 3, or 4) per card result ID
const cardTemplateMap = {};

// LocalStorage storage keys for custom background support (device-only local persistence)
const CUSTOM_BG_KEY = 'melad_custom_poster_bg_data';

function getStoredCustomBg(cardId) {
    try {
        const stored = JSON.parse(localStorage.getItem(CUSTOM_BG_KEY) || '{}');
        const url = stored[cardId];
        if (url && typeof url === 'string' && url.startsWith('data:image/')) {
            return url;
        }
        return null;
    } catch (e) {
        return null;
    }
}

function setStoredCustomBg(cardId, dataUrl) {
    try {
        const stored = JSON.parse(localStorage.getItem(CUSTOM_BG_KEY) || '{}');
        stored[cardId] = dataUrl;
        localStorage.setItem(CUSTOM_BG_KEY, JSON.stringify(stored));
    } catch (e) {
        console.warn('LocalStorage save failed:', e);
    }
}

function getPosterBgUrl(cardId, bgChoice) {
    if (bgChoice === 'custom') {
        const customBg = getStoredCustomBg(cardId);
        if (customBg) return customBg;
    }
    const num = parseInt(bgChoice, 10);
    const validNum = (!isNaN(num) && num >= 1 && num <= 10) ? num : 1;
    return `../assets/poster-backgrounds/bg${validNum}.jpg`;
}

// Preloaded background images cache
const preloadedBgs = {};

function preloadAllBackgrounds() {
    for (let i = 1; i <= 10; i++) {
        const img = new Image();
        img.src = `../assets/poster-backgrounds/bg${i}.jpg`;
        preloadedBgs[i] = img;
    }
}

// Start preloading assets immediately on script load
preloadAllBackgrounds();

function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}

function normalizeCategoryName(name) {
    if (!name) return "";
    const cleaned = name.trim().replace(/\s+/g, ' ');
    return cleaned.split(' ').map(word => {
        if (!word) return "";
        return word.split('-').map(subWord => {
            if (!subWord) return "";
            return subWord.charAt(0).toUpperCase() + subWord.slice(1).toLowerCase();
        }).join('-');
    }).join(' ');
}

// ─────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────
async function init() {
    if (isInitialized || isInitInProgress) return;
    isInitInProgress = true;

    if (!instId) {
        renderError("Invalid Link", "The results link is missing a valid institute identifier.");
        isInitInProgress = false;
        return;
    }

    try {
        // 1. Fetch Madrasa/Institute Profile Details
        const instSnap = await getDoc(doc(db, "institutes", instId));
        if (!instSnap.exists()) {
            renderError("Madrasa Not Found", "The requested Madrasa results portal does not exist.");
            isInitInProgress = false;
            return;
        }

        instituteDetails = { id: instSnap.id, ...instSnap.data() };

        // Timezone-safe UTC absolute timestamp comparison (Option B)
        const expiryDateObj = instituteDetails.expiryDate?.toDate?.() || (instituteDetails.expiryDate ? new Date(instituteDetails.expiryDate) : null);
        const isExpired = expiryDateObj && (new Date().getTime() > expiryDateObj.getTime());

        if (isExpired || instituteDetails.status === 'deactivated' || instituteDetails.status === 'inactive') {
            renderError("Subscription Expired", "This results portal has been suspended because the institute's subscription has expired or is deactivated.");
            hideOverlay();
            isInitInProgress = false;
            return;
        }

        // Real-time Event settings resolution with self-healing fallback
        const configRef = doc(db, "institutes", instId, "metadata", "eventConfig");
        onSnapshot(configRef, (configSnap) => {
            if (configSnap.exists()) {
                eventConfig = configSnap.data();
            } else {
                eventConfig = null;
            }

            if (eventConfig?.eventLogo) {
                if (cachedLogoSrc !== eventConfig.eventLogo) {
                    cachedLogoSrc = eventConfig.eventLogo;
                    const img = new Image();
                    img.onload = () => {
                        cachedLogoImg = img;
                        if (currentDisplayedResult) {
                            renderSingleResult(currentDisplayedResult);
                        }
                    };
                    img.src = eventConfig.eventLogo;
                    cachedLogoImg = img;
                }
            } else {
                cachedLogoImg = null;
                cachedLogoSrc = null;
            }

            updateHeroHeader();

            if (currentDisplayedResult) {
                renderSingleResult(currentDisplayedResult);
            }
        }, (e) => {
            console.warn("Public results custom event settings bypassed: read restricted, falling back to name.", e);
        });

        // Setup single document listener for precalculated leaderboard metadata
        const dashboardMetaRef = doc(db, "institutes", instId, "metadata", "dashboard");
        onSnapshot(dashboardMetaRef, (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                leaderboardData = data.leaderboard || [];
            } else {
                leaderboardData = [];
            }
            isCategoryPerformanceStale = true;
            updateTeamChampionship();
        }, (err) => {
            console.warn("Dashboard metadata listener error:", err);
        });

        // Fetch published results once to populate selector dropdowns
        const resultsRef = collection(db, "institutes", instId, "results");
        const publishedQuery = query(
            resultsRef,
            where("status", "==", "published")
        );

        try {
            const querySnapshot = await getDocs(publishedQuery);
            const published = querySnapshot.docs
                .map(d => {
                    const data = d.data();
                    const rawCategoryName = data.categoryName || "";
                    let normalizedCatName = "";
                    if (data.categoryName) {
                        normalizedCatName = normalizeCategoryName(data.categoryName);
                    }
                    return {
                        id: d.id,
                        ...data,
                        rawCategoryName: rawCategoryName,
                        categoryName: normalizedCatName
                    };
                })
                .filter(r => r.publicDisabled !== true);

            // Sort by published timestamp descending for base listing
            allResults = published.sort((a, b) => {
                const timeA = a.publishedAt?.seconds || 0;
                const timeB = b.publishedAt?.seconds || 0;
                return timeB - timeA;
            });
            isCategoryPerformanceStale = true;
            updateCategoryPerformance();

            // Initialize default style 1 for all cards
            allResults.forEach(r => {
                if (!cardBgMap[r.id]) {
                    cardBgMap[r.id] = 1;
                }
                if (!cardTemplateMap[r.id]) {
                    cardTemplateMap[r.id] = 1;
                }
            });

            // Populate category filter select dropdown dynamically (Initial state)
            setupFilters();

            document.getElementById('filterBar').style.display = 'flex';
            const mobFilterBar = document.getElementById('mobFilterBar');
            if (mobFilterBar) mobFilterBar.style.display = 'flex';
            hideOverlay();

            isInitialized = true;
            isInitInProgress = false;
        } catch (err) {
            console.error("Failed to fetch initial published results list:", err);
            renderError("Access Denied", "Unable to establish database connection.");
            hideOverlay();
            isInitInProgress = false;
        }

    } catch (err) {
        console.error(err);
        renderError("Connection Failed", "Failed to connect to Madrasa records database.");
        hideOverlay();
        isInitInProgress = false;
    }
}

function hideOverlay() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 400);
    }
}

// ─────────────────────────────────────────────
// Setup Dynamic Category / Program Filters
// ─────────────────────────────────────────────
// State variables for selected filter options
let selectedCategory = "";
let selectedGender = "";
let selectedProgramId = "";

function setupFilters() {
    const catContainer = document.getElementById('catFilterContainer');
    const catTrigger = document.getElementById('catSelectTrigger');
    const catText = document.getElementById('catSelectedVal');
    const catPanel = document.getElementById('catSelectPanel');

    const genderContainer = document.getElementById('genderFilterContainer');
    const genderTrigger = document.getElementById('genderSelectTrigger');
    const genderText = document.getElementById('genderSelectedVal');
    const genderPanel = document.getElementById('genderSelectPanel');

    const progContainer = document.getElementById('progFilterContainer');
    const progTrigger = document.getElementById('progSelectTrigger');
    const progText = document.getElementById('progSelectedVal');
    const progPanel = document.getElementById('progSelectPanel');

    // Mobile Selectors
    const mobCatTrigger = document.getElementById('mobCatSelectTrigger');
    const mobCatText = document.getElementById('mobCatSelectedVal');
    const mobCatSheet = document.getElementById('mobCatBottomSheet');
    const mobCatOverlay = document.getElementById('mobCatOverlay');
    const mobCatCloseBtn = document.getElementById('mobCatCloseBtn');
    const mobCatList = document.getElementById('mobCatOptionsList');

    const mobGenderTrigger = document.getElementById('mobGenderSelectTrigger');
    const mobGenderText = document.getElementById('mobGenderSelectedVal');
    const mobGenderSheet = document.getElementById('mobGenderBottomSheet');
    const mobGenderOverlay = document.getElementById('mobGenderOverlay');
    const mobGenderCloseBtn = document.getElementById('mobGenderCloseBtn');
    const mobGenderList = document.getElementById('mobGenderOptionsList');

    const mobProgTrigger = document.getElementById('mobProgSelectTrigger');
    const mobProgText = document.getElementById('mobProgSelectedVal');
    const mobProgSheet = document.getElementById('mobProgBottomSheet');
    const mobProgOverlay = document.getElementById('mobProgOverlay');
    const mobProgCloseBtn = document.getElementById('mobProgCloseBtn');
    const mobProgList = document.getElementById('mobProgOptionsList');

    // Reset options
    selectedCategory = "";
    selectedGender = "";
    selectedProgramId = "";
    catText.textContent = "Select Category";
    catText.classList.add('placeholder');
    genderText.textContent = "Select Gender";
    genderText.classList.add('placeholder');
    genderContainer.classList.add('disabled');
    progText.textContent = "Select Program";
    progText.classList.add('placeholder');
    progContainer.classList.add('disabled');

    if (mobCatText) {
        mobCatText.textContent = "Select Category";
        mobCatText.style.color = '';
    }
    if (mobGenderText) {
        mobGenderText.textContent = "Select Gender";
        mobGenderText.style.color = '';
    }
    if (mobProgText) {
        mobProgText.textContent = "Select Program";
        mobProgText.style.color = '';
    }
    if (mobGenderTrigger) {
        mobGenderTrigger.classList.add('disabled');
    }
    if (mobProgTrigger) {
        mobProgTrigger.classList.add('disabled');
    }

    // Helper to toggle panel open/close
    const togglePanel = (container) => {
        const isOpen = container.classList.contains('open');
        // Close all other panels first
        document.querySelectorAll('.glass-select-container').forEach(c => c.classList.remove('open'));
        if (!isOpen) {
            container.classList.add('open');
        }
    };

    // Mobile Bottom Sheet Helpers
    const openBottomSheet = (sheet) => {
        sheet.classList.add('open');
        document.body.style.overflow = 'hidden';
    };

    const closeBottomSheet = (sheet) => {
        sheet.classList.remove('open');
        document.body.style.overflow = '';
    };

    // Global click listener to close panels when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.glass-select-container')) {
            document.querySelectorAll('.glass-select-container').forEach(c => c.classList.remove('open'));
        }
    });

    catTrigger.onclick = (e) => {
        e.stopPropagation();
        togglePanel(catContainer);
    };

    genderTrigger.onclick = (e) => {
        e.stopPropagation();
        if (genderContainer.classList.contains('disabled')) return;
        togglePanel(genderContainer);
    };

    progTrigger.onclick = (e) => {
        e.stopPropagation();
        if (progContainer.classList.contains('disabled')) return;
        togglePanel(progContainer);
    };

    if (mobCatTrigger && mobCatSheet) {
        mobCatTrigger.onclick = () => openBottomSheet(mobCatSheet);
        mobCatOverlay.onclick = () => closeBottomSheet(mobCatSheet);
        mobCatCloseBtn.onclick = () => closeBottomSheet(mobCatSheet);
    }

    if (mobGenderTrigger && mobGenderSheet) {
        mobGenderTrigger.onclick = () => {
            if (mobGenderTrigger.classList.contains('disabled')) return;
            openBottomSheet(mobGenderSheet);
        };
        mobGenderOverlay.onclick = () => closeBottomSheet(mobGenderSheet);
        mobGenderCloseBtn.onclick = () => closeBottomSheet(mobGenderSheet);
    }

    if (mobProgTrigger && mobProgSheet) {
        mobProgTrigger.onclick = () => {
            if (mobProgTrigger.classList.contains('disabled')) return;
            openBottomSheet(mobProgSheet);
        };
        mobProgOverlay.onclick = () => closeBottomSheet(mobProgSheet);
        mobProgCloseBtn.onclick = () => closeBottomSheet(mobProgSheet);
    }

    // Load categories dynamically
    const getCategorySortStats = (name) => {
        const n = (name || '').toLowerCase().trim();
        if (n.includes('play')) return -4;
        if (n.includes('nursery')) return -3;
        if (n.includes('lkg')) return -2;
        if (n.includes('ukg')) return -1;
        const m = n.match(/class\s*(\d+)/i) || n.match(/std\s*(\d+)/i) || n.match(/standard\s*(\d+)/i) || n.match(/(\d+)/);
        if (m) return parseInt(m[1], 10);
        return 999;
    };

    const categories = [...new Set(allResults.map(r => r.categoryName))].sort((a, b) => {
        const valA = getCategorySortStats(a);
        const valB = getCategorySortStats(b);
        if (valA !== valB) return valA - valB;
        return (a || '').localeCompare(b || '');
    });

    const selectCategory = (c) => {
        selectedCategory = c;

        // Update Desktop
        catText.textContent = c;
        catText.classList.remove('placeholder');
        catContainer.classList.remove('open');

        // Update Mobile
        if (mobCatText) {
            mobCatText.textContent = c;
            mobCatText.style.color = '#0f172a';
        }

        // Reset gender
        selectedGender = "";
        genderText.textContent = "Select Gender";
        genderText.classList.add('placeholder');
        genderContainer.classList.remove('disabled');

        if (mobGenderText) {
            mobGenderText.textContent = "Select Gender";
            mobGenderText.style.color = '';
        }
        if (mobGenderTrigger) {
            mobGenderTrigger.classList.remove('disabled');
        }

        // Reset program
        selectedProgramId = "";
        progText.textContent = "Select Program";
        progText.classList.add('placeholder');
        progContainer.classList.add('disabled'); // program disabled until gender is chosen

        if (mobProgText) {
            mobProgText.textContent = "Select Program";
            mobProgText.style.color = '';
        }
        if (mobProgTrigger) {
            mobProgTrigger.classList.add('disabled');
        }

        populateCategories();
        populateGenders();
        populatePrograms();
    };

    const selectGender = (g) => {
        selectedGender = g;

        // Update Desktop
        genderText.textContent = g;
        genderText.classList.remove('placeholder');
        genderContainer.classList.remove('open');

        // Update Mobile
        if (mobGenderText) {
            mobGenderText.textContent = g;
            mobGenderText.style.color = '#0f172a';
        }

        // Reset program
        selectedProgramId = "";
        progText.textContent = "Select Program";
        progText.classList.add('placeholder');
        progContainer.classList.remove('disabled'); // enable programs now

        if (mobProgText) {
            mobProgText.textContent = "Select Program";
            mobProgText.style.color = '';
        }
        if (mobProgTrigger) {
            mobProgTrigger.classList.remove('disabled');
        }

        populateGenders();
        populatePrograms();
    };

    const selectProgram = (pId, pName) => {
        selectedProgramId = pId;

        // Desktop
        progText.textContent = pName;
        progText.classList.remove('placeholder');
        progContainer.classList.remove('open');

        // Mobile
        if (mobProgText) {
            mobProgText.textContent = pName;
            mobProgText.style.color = '#0f172a';
        }

        populatePrograms();
    };

    const populateCategories = () => {
        catPanel.innerHTML = '';
        if (mobCatList) mobCatList.innerHTML = '';

        categories.forEach(c => {
            const isSelected = c === selectedCategory;

            // Desktop
            const item = document.createElement('div');
            item.className = `glass-select-item ${isSelected ? 'selected' : ''}`;
            let checkHTML = isSelected ? `<span class="glass-select-check">✓</span>` : '';
            item.innerHTML = `<span>${escapeHTML(c)}</span>${checkHTML}`;
            item.onclick = (e) => {
                e.stopPropagation();
                selectCategory(c);
            };
            catPanel.appendChild(item);

            // Mobile
            if (mobCatList) {
                const mobItem = document.createElement('div');
                mobItem.className = `bottom-sheet-item ${isSelected ? 'selected' : ''}`;
                let mobCheckHTML = isSelected ? `<span class="bottom-sheet-check">✓</span>` : '';
                mobItem.innerHTML = `<span>${escapeHTML(c)}</span>${mobCheckHTML}`;
                mobItem.onclick = () => {
                    selectCategory(c);
                    closeBottomSheet(mobCatSheet);
                };
                mobCatList.appendChild(mobItem);
            }
        });
    };

    const normalizeGender = (g) => {
        if (!g) return "Mixed";
        const tg = g.trim().toLowerCase();
        if (tg === 'boys' || tg === 'boy' || tg === 'male') return "Boys";
        if (tg === 'girls' || tg === 'girl' || tg === 'female') return "Girls";
        return "Mixed";
    };

    const populateGenders = () => {
        genderPanel.innerHTML = '';
        if (mobGenderList) mobGenderList.innerHTML = '';
        if (!selectedCategory) return;

        const genders = [...new Set(
            allResults
                .filter(r => r.categoryName === selectedCategory)
                .map(r => normalizeGender(r.genderCategory))
        )].sort();

        genders.forEach(g => {
            const isSelected = g === selectedGender;

            // Desktop
            const item = document.createElement('div');
            item.className = `glass-select-item ${isSelected ? 'selected' : ''}`;
            let checkHTML = isSelected ? `<span class="glass-select-check">✓</span>` : '';
            item.innerHTML = `<span>${escapeHTML(g)}</span>${checkHTML}`;
            item.onclick = (e) => {
                e.stopPropagation();
                selectGender(g);
            };
            genderPanel.appendChild(item);

            // Mobile
            if (mobGenderList) {
                const mobItem = document.createElement('div');
                mobItem.className = `bottom-sheet-item ${isSelected ? 'selected' : ''}`;
                let mobCheckHTML = isSelected ? `<span class="bottom-sheet-check">✓</span>` : '';
                mobItem.innerHTML = `<span>${escapeHTML(g)}</span>${mobCheckHTML}`;
                mobItem.onclick = () => {
                    selectGender(g);
                    closeBottomSheet(mobGenderSheet);
                };
                mobGenderList.appendChild(mobItem);
            }
        });
    };

    const populatePrograms = () => {
        progPanel.innerHTML = '';
        if (mobProgList) mobProgList.innerHTML = '';
        if (!selectedCategory || !selectedGender) return;

        const programs = allResults
            .filter(r => r.categoryName === selectedCategory && normalizeGender(r.genderCategory) === selectedGender)
            .sort((a, b) => (a.programName || '').localeCompare(b.programName || ''));

        programs.forEach(r => {
            const isSelected = r.id === selectedProgramId;
            const pName = r.programName || 'Program';

            // Desktop
            const item = document.createElement('div');
            item.className = `glass-select-item ${isSelected ? 'selected' : ''}`;
            let checkHTML = isSelected ? `<span class="glass-select-check">✓</span>` : '';
            item.innerHTML = `<span>${escapeHTML(pName)}</span>${checkHTML}`;
            item.onclick = (e) => {
                e.stopPropagation();
                selectProgram(r.id, pName);
            };
            progPanel.appendChild(item);

            // Mobile
            if (mobProgList) {
                const mobItem = document.createElement('div');
                mobItem.className = `bottom-sheet-item ${isSelected ? 'selected' : ''}`;
                let mobCheckHTML = isSelected ? `<span class="bottom-sheet-check">✓</span>` : '';
                mobItem.innerHTML = `<span>${escapeHTML(pName)}</span>${mobCheckHTML}`;
                mobItem.onclick = () => {
                    selectProgram(r.id, pName);
                    closeBottomSheet(mobProgSheet);
                };
                mobProgList.appendChild(mobItem);
            }
        });
    };

    // Populate category dropdown initially
    populateCategories();

    // Unified Search execution
    const executeSearch = (btn) => {
        if (btn.classList.contains('loading')) return;

        if (!selectedCategory || !selectedGender || !selectedProgramId) {
            showToast("⚠️ Please select Category, Gender, and Program!");
            return;
        }

        const searchKey = `${instId}_${selectedProgramId}`;
        const originalText = btn.innerHTML;

        if (activeResultKey === searchKey && activeResultUnsubscribe) {
            // Already listening to the same program result
            if (currentDisplayedResult) {
                renderSingleResult(currentDisplayedResult);
            }
            btn.innerHTML = originalText;
            btn.classList.remove('loading');
            return;
        }

        // Add ripple visual effect
        const rect = btn.getBoundingClientRect();
        const circle = document.createElement('span');
        circle.style.position = 'absolute';
        circle.style.background = 'rgba(255,255,255,0.35)';
        circle.style.borderRadius = '50%';
        circle.style.pointerEvents = 'none';
        circle.style.width = circle.style.height = '120px';
        circle.style.left = `${btn.clientWidth / 2 - 60}px`;
        circle.style.top = `${btn.clientHeight / 2 - 60}px`;
        circle.style.transform = 'scale(0)';
        circle.style.animation = 'ripple 0.6s linear';
        btn.appendChild(circle);
        setTimeout(() => circle.remove(), 600);

        // Add loading state
        btn.innerHTML = `<span>⏳ Searching...</span>`;
        btn.classList.add('loading');

        // Unsubscribe previous listener
        if (activeResultUnsubscribe) {
            activeResultUnsubscribe();
            activeResultUnsubscribe = null;
        }
        activeResultKey = "";

        const resultDocRef = doc(db, "institutes", instId, "results", selectedProgramId);

        activeResultKey = searchKey;
        activeResultUnsubscribe = onSnapshot(resultDocRef, (docSnap) => {
            btn.innerHTML = originalText;
            btn.classList.remove('loading');

            if (!docSnap.exists() || docSnap.data().status !== "published" || docSnap.data().publicDisabled === true) {
                currentDisplayedResult = null;
                renderEmpty("Result Not Found", "The requested program standings have not been published yet.");
                return;
            }

            const data = docSnap.data();
            if (data.categoryName) {
                data.categoryName = normalizeCategoryName(data.categoryName);
            }
            const targetResult = { id: docSnap.id, ...data };

            if (!cardBgMap[targetResult.id]) {
                const savedBg = localStorage.getItem(`melad_card_bg_${targetResult.id}`);
                cardBgMap[targetResult.id] = savedBg ? (savedBg === 'custom' ? 'custom' : (parseInt(savedBg, 10) || 1)) : 1;
            }
            if (!cardTemplateMap[targetResult.id]) {
                cardTemplateMap[targetResult.id] = 1;
            }

            currentDisplayedResult = targetResult;
            renderSingleResult(targetResult);
        }, (err) => {
            btn.innerHTML = originalText;
            btn.classList.remove('loading');
            console.error("Single result snapshot error:", err);
            if (activeResultUnsubscribe) {
                activeResultUnsubscribe();
                activeResultUnsubscribe = null;
            }
            activeResultKey = "";
            showToast("⚠️ Failed to retrieve results. Please try again.");
        });
    };

    // Bind triggers
    document.getElementById('btnFilterSearch').onclick = (e) => {
        executeSearch(e.currentTarget);
    };

    const mobBtnSearch = document.getElementById('mobBtnFilterSearch');
    if (mobBtnSearch) {
        mobBtnSearch.onclick = (e) => {
            executeSearch(e.currentTarget);
        };
    }
}

// ─────────────────────────────────────────────
// Rendering Standings Poster Card
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
function getPosterGenderLabel(g) {
    if (!g) return "";
    const tg = String(g).trim().toLowerCase();
    if (tg === 'boys' || tg === 'boy' || tg === 'male') return "BOYS";
    if (tg === 'girls' || tg === 'girl' || tg === 'female') return "GIRLS";
    if (tg === 'general' || tg === 'common' || tg === 'all' || tg === 'mixed') return "GENERAL";
    return tg.toUpperCase();
}

function getCategoryWithGenderHTML(categoryName, genderCategory, isMini = false) {
    const cat = escapeHTML((categoryName || '').toUpperCase());
    const genderLabel = getPosterGenderLabel(genderCategory);
    if (!genderLabel) return cat;

    if (isMini) {
        return `${cat} <span style="opacity: 0.75; font-size: 0.85em; font-weight: 600; letter-spacing: 0.5px;">• ${escapeHTML(genderLabel)}</span>`;
    }
    return `${cat} <span class="poster-gender-tag" style="opacity: 0.75; font-size: 0.88em; font-weight: 600; margin-left: 4px; letter-spacing: 1.5px; text-transform: uppercase;">• ${escapeHTML(genderLabel)}</span>`;
}

function getMiniPosterHTML(r, bgId, templateId, resultNumber, madrasaName) {
    const activeWinners = [...(r.marksData || [])]
        .filter(w => w.finalMark && w.finalMark > 0)
        .sort((a, b) => (b.finalMark || 0) - (a.finalMark || 0));
    computeDenseRanking(activeWinners, w => w.finalMark, 'rank');
    const sortedWinners = activeWinners.filter(w => w.rank <= 3);

    const isGroup = r.programType === 'group' || (r.programType === 'general' && r.registrationType === 'group');

    if (templateId === 2) {
        const w1 = sortedWinners[0];
        const w2 = sortedWinners[1];
        const w3 = sortedWinners[2];

        const name1 = w1 ? (isGroup ? (w1.studentName || 'TEAM A') : (w1.studentName || '—')) : '—';
        const team1 = w1 ? resolveTeamName(w1.teamId, w1.teamName) : '—';

        const name2 = w2 ? (isGroup ? (w2.studentName || 'TEAM B') : (w2.studentName || '—')) : '—';
        const team2 = w2 ? resolveTeamName(w2.teamId, w2.teamName) : '—';

        const name3 = w3 ? (isGroup ? (w3.studentName || 'TEAM C') : (w3.studentName || '—')) : '—';
        const team3 = w3 ? resolveTeamName(w3.teamId, w3.teamName) : '—';

        const hasWinners = sortedWinners.length > 0;

        const bentoGridHTML = hasWinners ? `
            <div style="display: flex; flex-direction: column; gap: 4px; width: 100%; box-sizing: border-box;">
                <!-- 1st Place Card -->
                <div style="background: rgba(255, 255, 255, 0.05); border: 0.5px solid rgba(255, 255, 255, 0.1); border-left: 2px solid #fbbf24; border-radius: 8px; padding: 4px 6px; display: flex; align-items: center; justify-content: space-between; position: relative;">
                    <div style="display: flex; flex-direction: column; text-align: left; overflow: hidden; max-width: 90px;">
                        <span style="font-size: 6px; font-weight: 700; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: uppercase;">${escapeHTML(name1)}</span>
                        <span style="font-size: 4px; color: rgba(255,255,255,0.4); text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(team1)}</span>
                    </div>
                    <span style="font-size: 10px; font-weight: 900; color: rgba(251, 191, 36, 0.15); line-height: 1;">${w1 ? String(w1.rank).padStart(2, '0') : '01'}</span>
                </div>

                <!-- 2nd & 3rd Row -->
                <div style="display: flex; gap: 4px; width: 100%;">
                    <!-- 2nd Place Card -->
                    <div style="background: rgba(255, 255, 255, 0.05); border: 0.5px solid rgba(255, 255, 255, 0.1); border-top: 1.5px solid #cbd5e1; border-radius: 8px; padding: 4px 6px; width: calc(50% - 2px); display: flex; flex-direction: column; justify-content: space-between; position: relative; min-height: 28px; box-sizing: border-box;">
                        <span style="font-size: 9px; font-weight: 900; color: rgba(203, 213, 225, 0.15); position: absolute; right: 4px; top: 2px; line-height: 1;">${w2 ? String(w2.rank).padStart(2, '0') : '02'}</span>
                        <div style="display: flex; flex-direction: column; text-align: left; overflow: hidden; margin-top: auto; z-index: 2;">
                            <span style="font-size: 5px; font-weight: 700; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: uppercase;">${escapeHTML(name2)}</span>
                            <span style="font-size: 3.5px; color: rgba(255,255,255,0.4); text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(team2)}</span>
                        </div>
                    </div>

                    <!-- 3rd Place Card -->
                    <div style="background: rgba(255, 255, 255, 0.05); border: 0.5px solid rgba(255, 255, 255, 0.1); border-top: 1.5px solid #d97706; border-radius: 8px; padding: 4px 6px; width: calc(50% - 2px); display: flex; flex-direction: column; justify-content: space-between; position: relative; min-height: 28px; box-sizing: border-box;">
                        <span style="font-size: 9px; font-weight: 900; color: rgba(217, 119, 6, 0.15); position: absolute; right: 4px; top: 2px; line-height: 1;">${w3 ? String(w3.rank).padStart(2, '0') : '03'}</span>
                        <div style="display: flex; flex-direction: column; text-align: left; overflow: hidden; margin-top: auto; z-index: 2;">
                            <span style="font-size: 5px; font-weight: 700; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: uppercase;">${escapeHTML(name3)}</span>
                            <span style="font-size: 3.5px; color: rgba(255,255,255,0.4); text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(team3)}</span>
                        </div>
                    </div>
                </div>
            </div>
        ` : `
            <div style="text-align: center; color: rgba(255,255,255,0.3); font-size: 5px; font-style: italic; padding: 10px 0; width: 100%;">
                No standings
            </div>
        `;

        return `
            <!-- Mini Dark Overlay & Blur -->
            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(15, 23, 42, 0.32); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); z-index: 1;"></div>

            <!-- Mini Bento Container -->
            <div style="position: absolute; top: 10px; bottom: 10px; left: 10px; right: 10px; background: rgba(255,255,255,0.06); border: 0.5px solid rgba(255,255,255,0.12); border-radius: 12px; padding: 10px; display: flex; flex-direction: column; justify-content: space-between; z-index: 2; box-sizing: border-box;">
                <div style="text-align: center; line-height: 1.1;">
                    <span style="font-size: 4px; color: #fbbf24; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 2px;">${getCategoryWithGenderHTML(r.categoryName, r.genderCategory || r.gender, true)}</span>
                    <div style="font-family: 'Plus Jakarta Sans', 'Inter', sans-serif; font-size: 6.5px; font-weight: 800; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: uppercase;">${escapeHTML(r.programName)}</div>
                    <div style="display: inline-block; background: rgba(255,255,255,0.08); border: 0.25px solid rgba(255,255,255,0.15); border-radius: 4px; padding: 1px 3px; font-size: 3.5px; font-weight: 700; color: white; margin-top: 2px;">RESULT ${resultNumber}</div>
                </div>

                ${bentoGridHTML}

                <div style="display: flex; align-items: center; gap: 3px; width: 100%;">
                    <div style="flex-grow: 1; height: 0.25px; background: rgba(255,255,255,0.12);"></div>
                    <span style="font-size: 4px; color: rgba(255,255,255,0.5); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; white-space: normal; word-wrap: break-word; overflow: visible; line-height: 1.2; text-align: center; max-width: 60px;">${escapeHTML(madrasaName.toUpperCase())}</span>
                    <div style="flex-grow: 1; height: 0.25px; background: rgba(255,255,255,0.12);"></div>
                </div>
            </div>
        `;
    } else if (templateId === 3) {
        const rankLabels = { 1: '1ST', 2: '2ND', 3: '3RD' };
        const winnersHTML = sortedWinners.map((w) => {
            const rank = w.rank;
            const nameText = isGroup ? (w.studentName || 'TEAM A') : (w.studentName || '—');
            const teamText = w.teamId ? resolveTeamName(w.teamId, w.teamName) : (w.teamName || '—');
            const rankColors = { 1: '#fbbf24', 2: '#cbd5e1', 3: '#fdba74' };
            const rankColor = rankColors[rank] || '#ffffff';
            const rankLabel = rankLabels[rank] || `${rank}TH`;

            return `
                <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 0.25px solid rgba(255,255,255,0.1); padding-bottom: 2px; box-sizing: border-box; width: 100%;">
                    <div style="display: flex; flex-direction: column; text-align: left; line-height: 1;">
                        <span style="font-size: 5px; font-weight: 800; color: ${rankColor};">${String(rank).padStart(2, '0')}</span>
                        <span style="font-size: 3px; font-weight: 700; color: rgba(255,255,255,0.4); letter-spacing: 0.2px;">${rankLabel}</span>
                    </div>
                    <div style="display: flex; flex-direction: column; text-align: right; overflow: hidden; max-width: 60px; line-height: 1;">
                        <span style="font-size: 4.5px; font-weight: 700; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: uppercase;">${escapeHTML(nameText)}</span>
                        <span style="font-size: 3px; color: rgba(255,255,255,0.4); text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(teamText)}</span>
                    </div>
                </div>
            `;
        }).join('');

        const finalWinnersHTML = winnersHTML || `
            <div style="text-align: center; color: rgba(255,255,255,0.3); font-size: 5px; font-style: italic; padding: 10px 0; width: 100%;">
                No standings
            </div>
        `;

        return `
            <!-- Mini Dark Overlay & Blur -->
            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(15, 23, 42, 0.35); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); z-index: 1;"></div>

            <!-- Mini Editorial Container -->
            <div style="position: absolute; top: 8px; bottom: 8px; left: 8px; right: 8px; display: flex; flex-direction: column; justify-content: space-between; z-index: 2; box-sizing: border-box;">
                
                <!-- Mini Header -->
                <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
                    <div style="display: flex; flex-direction: column; text-align: left; max-width: 70px; line-height: 1;">
                        <span style="font-size: 3px; font-weight: 700; color: rgba(255, 255, 255, 0.45); letter-spacing: 0.5px;">STANDINGS</span>
                        <div style="font-family: 'Plus Jakarta Sans', 'Inter', sans-serif; font-size: 5px; font-weight: 800; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: uppercase; margin-top: 1px;">${escapeHTML(r.programName)}</div>
                        <span style="font-size: 3.5px; font-weight: 700; color: #fbbf24; letter-spacing: 0.5px; text-transform: uppercase; margin-top: 1px;">${getCategoryWithGenderHTML(r.categoryName, r.genderCategory || r.gender, true)}</span>
                    </div>
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 1px;">
                        <svg style="width: 6px; height: 6px; color: #fbbf24; opacity: 0.85;" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 11.55C9.64 9.35 6.48 8 3 8v11c3.48 0 6.64 1.35 9 3.55 2.36-2.2 5.52-3.55 9-3.55V8c-3.48 0-6.64 1.35-9 3.55zM12 8c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3z"/>
                        </svg>
                    </div>
                </div>

                <!-- Mini Winners List -->
                <div style="display: flex; flex-direction: column; gap: 2px; width: 100%; margin: 2px 0;">
                    ${finalWinnersHTML}
                </div>

                <!-- Mini Footer -->
                <div style="display: flex; align-items: center; gap: 3px; width: 100%;">
                    <div style="flex-grow: 1; height: 0.25px; background: rgba(255,255,255,0.12);"></div>
                    <span style="font-size: 4px; color: rgba(255, 255, 255, 0.45); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; white-space: normal; word-wrap: break-word; overflow: visible; line-height: 1.2; text-align: center; max-width: 60px;">${escapeHTML(madrasaName.toUpperCase())}</span>
                    <div style="flex-grow: 1; height: 0.25px; background: rgba(255,255,255,0.12);"></div>
                </div>
            </div>
        `;
    } else if (templateId === 4) {
        const rankLabels = { 1: '1ST', 2: '2ND', 3: '3RD' };
        const winnersHTML = sortedWinners.map((w) => {
            const rank = w.rank;
            const nameText = isGroup ? (w.studentName || 'TEAM A') : (w.studentName || '—');
            const teamText = w.teamId ? resolveTeamName(w.teamId, w.teamName) : (w.teamName || '—');
            const rankColors = { 1: '#fbbf24', 2: '#cbd5e1', 3: '#fdba74' };
            const rankColor = rankColors[rank] || '#ffffff';
            const rankLabel = rankLabels[rank] || `${rank}TH`;

            return `
                <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(255, 255, 255, 0.03); border: 0.25px solid rgba(255, 255, 255, 0.1); border-left: 1.5px solid ${rankColor}; border-radius: 4px; padding: 4px 6px; box-sizing: border-box; width: 100%;">
                    <div style="display: flex; flex-direction: column; text-align: left; line-height: 1;">
                        <span style="font-size: 5px; font-weight: 800; color: ${rankColor};">${String(rank).padStart(2, '0')}</span>
                        <span style="font-size: 3px; font-weight: 700; color: rgba(255,255,255,0.45);">${rankLabel}</span>
                    </div>
                    <div style="display: flex; flex-direction: column; text-align: right; overflow: hidden; max-width: 50px; line-height: 1;">
                        <span style="font-size: 4.5px; font-weight: 700; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: uppercase;">${escapeHTML(nameText)}</span>
                        <span style="font-size: 3px; color: rgba(255,255,255,0.4); text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(teamText)}</span>
                    </div>
                </div>
            `;
        }).join('');

        const finalWinnersHTML = winnersHTML || `
            <div style="text-align: center; color: rgba(255,255,255,0.3); font-size: 4px; font-style: italic; padding: 5px 0;">
                No standings
            </div>
        `;

        return `
            <!-- Mini Dark Overlay & Blur -->
            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(15, 23, 42, 0.35); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); z-index: 1;"></div>

            <!-- Mini Split Screen Container -->
            <div style="position: absolute; top: 8px; bottom: 8px; left: 8px; right: 8px; display: flex; flex-direction: column; justify-content: space-between; z-index: 2; box-sizing: border-box;">
                
                <div style="display: flex; flex-grow: 1; width: 100%; gap: 6px; padding-bottom: 4px; box-sizing: border-box;">
                    <!-- Left Mini Panel (35% width) -->
                    <div style="width: 35%; display: flex; flex-direction: column; justify-content: space-between; border-right: 0.25px solid rgba(255, 255, 255, 0.15); padding-right: 4px; box-sizing: border-box; text-align: left; line-height: 1.1;">
                        <div>
                            <span style="font-size: 3px; font-weight: 700; color: rgba(255, 255, 255, 0.45); letter-spacing: 0.3px; display: block;">OFFICIAL RESULT</span>
                            <div style="font-family: 'Plus Jakarta Sans', 'Inter', sans-serif; font-size: 5px; font-weight: 800; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: uppercase; margin-top: 1px;">${escapeHTML(r.programName)}</div>
                            <span style="font-size: 3.5px; font-weight: 700; color: #fbbf24; letter-spacing: 0.5px; text-transform: uppercase; margin-top: 1px; display: block;">${getCategoryWithGenderHTML(r.categoryName, r.genderCategory || r.gender, true)}</span>
                            <div style="display: inline-block; border: 0.25px solid rgba(255, 255, 255, 0.25); border-radius: 2px; padding: 1px 3px; font-size: 3px; font-weight: 800; color: rgba(255, 255, 255, 0.85); letter-spacing: 0.5px; text-transform: uppercase; margin-top: 2px;">R-${resultNumber}</div>
                        </div>
                        <svg style="width: 6px; height: 6px; color: #fbbf24; opacity: 0.85; margin-bottom: 2px;" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 11.55C9.64 9.35 6.48 8 3 8v11c3.48 0 6.64 1.35 9 3.55 2.36-2.2 5.52-3.55 9-3.55V8c-3.48 0-6.64 1.35-9 3.55zM12 8c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3z"/>
                        </svg>
                    </div>

                    <!-- Right Mini Panel (65% width) -->
                    <div style="width: 65%; display: flex; flex-direction: column; justify-content: center; gap: 3px; box-sizing: border-box;">
                        ${finalWinnersHTML}
                    </div>
                </div>

                <!-- Mini Footer -->
                <div style="display: flex; align-items: center; gap: 3px; width: 100%;">
                    <div style="flex-grow: 1; height: 0.25px; background: rgba(255,255,255,0.12);"></div>
                    <span style="font-size: 4px; color: rgba(255, 255, 255, 0.45); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; white-space: normal; word-wrap: break-word; overflow: visible; line-height: 1.2; text-align: center; max-width: 60px;">${escapeHTML(madrasaName.toUpperCase())}</span>
                    <div style="flex-grow: 1; height: 0.25px; background: rgba(255,255,255,0.12);"></div>
                </div>
            </div>
        `;
    } else {
        const rankAccentColors = {
            1: '#fbbf24',
            2: '#cbd5e1',
            3: '#d97706'
        };

        const winnersHTML = sortedWinners.map((w) => {
            const rank = w.rank;
            const nameText = isGroup ? (w.studentName || 'TEAM A') : (w.studentName || '—');
            const teamText = w.teamId ? resolveTeamName(w.teamId, w.teamName) : (w.teamName || '—');
            const accentColor = rankAccentColors[rank] || '#ffffff';

            return `
                <div style="display: flex; align-items: center; gap: 4px; padding: 4px 6px; background: rgba(255, 255, 255, 0.04); border: 0.5px solid rgba(255, 255, 255, 0.08); border-left: 2px solid ${accentColor}; border-radius: 5px; color: white; font-size: 5px; line-height: 1; text-align: left;">
                    <span style="font-weight: 800; color: ${accentColor}; font-size: 6px; min-width: 8px; text-align: center;">#${rank}</span>
                    <div style="display: flex; flex-direction: column; overflow: hidden;">
                        <span style="font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 90px; text-transform: uppercase;">${escapeHTML(nameText.toUpperCase())}</span>
                        <span style="font-size: 4px; color: rgba(255,255,255,0.4); text-transform: uppercase;">${escapeHTML(teamText.toUpperCase())}</span>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <!-- Mini Dark Overlay & Blur -->
            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(15, 23, 42, 0.50); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); z-index: 1;"></div>
            
            <!-- Mini Liquid Glass Container -->
            <div style="position: absolute; top: 10px; bottom: 10px; left: 10px; right: 10px; background: rgba(255,255,255,0.06); border: 0.5px solid rgba(255,255,255,0.12); border-radius: 12px; padding: 10px; display: flex; flex-direction: column; justify-content: space-between; z-index: 2; box-sizing: border-box;">
                <div style="text-align: center; line-height: 1.1;">
                    <div style="display: flex; justify-content: center; gap: 4px; align-items: center; margin-bottom: 2px;">
                        <span style="font-size: 4px; color: #fbbf24; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">${getCategoryWithGenderHTML(r.categoryName, r.genderCategory || r.gender, true)}</span>
                        <span style="background: rgba(255,255,255,0.08); border: 0.25px solid rgba(255,255,255,0.15); border-radius: 4px; padding: 1px 3px; font-size: 3.5px; font-weight: 700; color: white;">R${resultNumber}</span>
                    </div>
                    <div style="font-family: 'Plus Jakarta Sans', 'Inter', sans-serif; font-size: 6.5px; font-weight: 800; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: uppercase;">${escapeHTML(r.programName)}</div>
                </div>
                
                <div style="display: flex; flex-direction: column; gap: 4px; margin: 4px 0;">
                    ${winnersHTML}
                </div>
                
                <div style="display: flex; align-items: center; gap: 3px; width: 100%;">
                    <div style="flex-grow: 1; height: 0.25px; background: rgba(255,255,255,0.12);"></div>
                    <span style="font-size: 4px; color: rgba(255,255,255,0.5); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; white-space: normal; word-wrap: break-word; overflow: visible; line-height: 1.2; text-align: center; max-width: 60px;">${escapeHTML(madrasaName.toUpperCase())}</span>
                    <div style="flex-grow: 1; height: 0.25px; background: rgba(255,255,255,0.12);"></div>
                </div>
            </div>
        `;
    }
}

function getPosterInnerHTML(r, bgId, templateId, resultNumber, madrasaName) {
    const activeWinners = [...(r.marksData || [])]
        .filter(w => w.finalMark && w.finalMark > 0)
        .sort((a, b) => (b.finalMark || 0) - (a.finalMark || 0));
    computeDenseRanking(activeWinners, w => w.finalMark, 'rank');
    const sortedWinners = activeWinners.filter(w => w.rank <= 3);

    const isGroup = r.programType === 'group' || (r.programType === 'general' && r.registrationType === 'group');

    const ordinalLabel = (rank) => {
        const labels = { 1: '1ST', 2: '2ND', 3: '3RD' };
        return labels[rank] || `${rank}TH`;
    };

    const displayEventName = eventConfig?.eventName || madrasaName || "Results Portal";
    const displayMadrasaName = eventConfig?.madrasaName || madrasaName || "";
    const displayEventTagline = eventConfig?.eventTagline || "";
    const displayEventLogo = eventConfig?.eventLogo || null;

    const brandLogoHTML = displayEventLogo ? `<div class="poster-brand-logo-wrap"><img src="${displayEventLogo}" alt="Logo" class="poster-brand-logo" crossorigin="anonymous" /></div>` : '';
    const brandTaglineHTML = displayEventTagline ? `<div class="poster-brand-tagline">${escapeHTML(displayEventTagline)}</div>` : '';
    const brandHeaderHTML = `
        <div class="poster-brand-header">
            ${brandLogoHTML}
            <div class="poster-brand-text-wrap">
                <div class="poster-brand-event-name">${escapeHTML(displayEventName.toUpperCase())}</div>
                ${brandTaglineHTML}
            </div>
        </div>
    `;

    if (templateId === 2) {
        const w1 = sortedWinners[0];
        const w2 = sortedWinners[1];
        const w3 = sortedWinners[2];

        const name1 = w1 ? (isGroup ? (w1.studentName || 'TEAM A') : (w1.studentName || '—')) : '—';
        const team1 = w1 ? resolveTeamName(w1.teamId, w1.teamName) : '—';

        const name2 = w2 ? (isGroup ? (w2.studentName || 'TEAM B') : (w2.studentName || '—')) : '—';
        const team2 = w2 ? resolveTeamName(w2.teamId, w2.teamName) : '—';

        const name3 = w3 ? (isGroup ? (w3.studentName || 'TEAM C') : (w3.studentName || '—')) : '—';
        const team3 = w3 ? resolveTeamName(w3.teamId, w3.teamName) : '—';

        const hasWinners = sortedWinners.length > 0;

        const bentoGridHTML = hasWinners ? `
            <div class="t2-bento-grid">
                <!-- 1st Place Card -->
                <div class="t2-card-bento t2-card-1st">
                    <div class="t2-details">
                        <span style="color: #fbbf24; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px; display: block;">${w1 ? ordinalLabel(w1.rank) : '1ST'} STANDING</span>
                        <div class="t2-student">${escapeHTML(name1.toUpperCase())}</div>
                        <div class="t2-team">TEAM: ${escapeHTML(team1.toUpperCase())}</div>
                    </div>
                    <div class="t2-rank-large" style="color: rgba(251, 191, 36, 0.15);">${w1 ? String(w1.rank).padStart(2, '0') : '01'}</div>
                </div>

                <!-- 2nd & 3rd Place Row -->
                <div class="t2-bento-row">
                    <!-- 2nd Place Card -->
                    <div class="t2-card-bento t2-card-2nd">
                        <div class="t2-rank-large" style="color: rgba(203, 213, 225, 0.15); position: absolute; right: 16px; top: 12px;">${w2 ? String(w2.rank).padStart(2, '0') : '02'}</div>
                        <div class="t2-details" style="margin-top: auto; z-index: 2;">
                            <span style="color: #cbd5e1; font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px; display: block;">${w2 ? ordinalLabel(w2.rank) : '2ND'} STANDING</span>
                            <div class="t2-student" style="font-size: 15px;">${escapeHTML(name2.toUpperCase())}</div>
                            <div class="t2-team" style="font-size: 10px;">TEAM: ${escapeHTML(team2.toUpperCase())}</div>
                        </div>
                    </div>

                    <!-- 3rd Place Card -->
                    <div class="t2-card-bento t2-card-3rd">
                        <div class="t2-rank-large" style="color: rgba(217, 119, 6, 0.15); position: absolute; right: 16px; top: 12px;">${w3 ? String(w3.rank).padStart(2, '0') : '03'}</div>
                        <div class="t2-details" style="margin-top: auto; z-index: 2;">
                            <span style="color: #fdba74; font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px; display: block;">${w3 ? ordinalLabel(w3.rank) : '3RD'} STANDING</span>
                            <div class="t2-student" style="font-size: 15px;">${escapeHTML(name3.toUpperCase())}</div>
                            <div class="t2-team" style="font-size: 10px;">TEAM: ${escapeHTML(team3.toUpperCase())}</div>
                        </div>
                    </div>
                </div>
            </div>
        ` : `
            <div style="text-align:center;padding:2rem 1.5rem;color:rgba(255,255,255,0.4);font-style:italic;font-size:14px;width:100%;">
                No standings recorded for this event.
            </div>
        `;

        return `
            <div class="t2-container">
                ${brandHeaderHTML}
                <div class="t2-header">
                    <span class="t2-category-badge">${getCategoryWithGenderHTML(r.categoryName, r.genderCategory || r.gender)}</span>
                    <h1 class="t2-program-title">${escapeHTML(r.programName.toUpperCase())}</h1>
                    <div class="t2-badge-row">
                        <span class="t2-result-badge">RESULT ${resultNumber}</span>
                    </div>
                </div>

                ${bentoGridHTML}

                <div class="t2-footer">
                    <div class="t2-footer-line"></div>
                    <span class="t2-footer-text">${escapeHTML(displayMadrasaName.toUpperCase())}</span>
                    <div class="t2-footer-line"></div>
                </div>
            </div>
        `;
    } else if (templateId === 3) {
        const rankLabels = { 1: '1ST PLACE', 2: '2ND PLACE', 3: '3RD PLACE' };
        const winnersHTML = sortedWinners.map((w) => {
            const rank = w.rank;
            const nameText = isGroup ? (w.studentName || 'TEAM A') : (w.studentName || '—');
            const teamText = w.teamId ? resolveTeamName(w.teamId, w.teamName) : (w.teamName || '—');
            const rankLabel = rankLabels[rank] || `${rank}TH PLACE`;

            return `
                <div class="t3-row-editorial t3-rank-row-${rank <= 3 ? rank : 3}">
                    <div class="t3-row-left">
                        <span class="t3-rank-num-edit">${String(rank).padStart(2, '0')}</span>
                        <span class="t3-rank-label">${rankLabel}</span>
                    </div>
                    <div class="t3-row-right">
                        <span class="t3-student-name">${escapeHTML(nameText.toUpperCase())}</span>
                        <span class="t3-team-name">${escapeHTML(teamText.toUpperCase())}</span>
                    </div>
                </div>
            `;
        }).join('');

        const finalWinnersHTML = winnersHTML || `<div style="text-align:center;padding:2rem 1.5rem;color:rgba(255,255,255,0.4);font-style:italic;">No standings recorded for this event.</div>`;

        return `
            <div class="t3-container">
                ${brandHeaderHTML}
                <div class="t3-header">
                    <div class="t3-header-left">
                        <h1 class="t3-program-title">${escapeHTML(r.programName.toUpperCase())}</h1>
                        <span class="t3-category">${getCategoryWithGenderHTML(r.categoryName, r.genderCategory || r.gender)}</span>
                        <span class="t3-result-badge">RESULT ${resultNumber}</span>
                    </div>
                   
                </div>

                <div class="t3-winners-list">
                    ${finalWinnersHTML}
                </div>

                <div class="t3-footer">
                    <div class="t3-footer-line"></div>
                    <span class="t3-footer-text">${escapeHTML(displayMadrasaName.toUpperCase())}</span>
                    <div class="t3-footer-line"></div>
                </div>
            </div>
        `;
    } else if (templateId === 4) {
        const rankLabels = { 1: '1ST PLACE', 2: '2ND PLACE', 3: '3RD PLACE' };
        const winnersHTML = sortedWinners.map((w) => {
            const rank = w.rank;
            const nameText = isGroup ? (w.studentName || 'TEAM A') : (w.studentName || '—');
            const teamText = w.teamId ? resolveTeamName(w.teamId, w.teamName) : (w.teamName || '—');
            const rankLabel = rankLabels[rank] || `${rank}TH PLACE`;

            return `
                <div class="t4-rank-block t4-rank-${rank <= 3 ? rank : 3}">
                    <div class="t4-rank-left">
                        <span class="t4-rank-num">${String(rank).padStart(2, '0')}</span>
                        <span class="t4-rank-label">${rankLabel}</span>
                    </div>
                    <div class="t4-rank-right">
                        <span class="t4-student-name">${escapeHTML(nameText.toUpperCase())}</span>
                        <span class="t4-team-name">${escapeHTML(teamText.toUpperCase())}</span>
                    </div>
                </div>
            `;
        }).join('');

        const finalWinnersHTML = winnersHTML || `
            <div style="text-align:center;padding:2rem 1.5rem;color:rgba(255,255,255,0.4);font-style:italic;">
                No standings recorded for this event.
            </div>
        `;

        return `
            <div class="t4-container">
                ${brandHeaderHTML}
                <div class="t4-split-content">
                    
                    <!-- Left Panel (35%) -->
                    <div class="t4-left-panel">
                        <div class="t4-left-header">
                            <h1 class="t4-program-title">${escapeHTML(r.programName.toUpperCase())}</h1>
                            <span class="t4-category">${getCategoryWithGenderHTML(r.categoryName, r.genderCategory || r.gender)}</span>
                            <span class="t4-result-badge">RESULT ${resultNumber}</span>
                        </div>
                        
                        
                    </div>

                    <!-- Right Panel (65%) -->
                    <div class="t4-right-panel">
                        ${finalWinnersHTML}
                    </div>

                </div>

                <!-- Shared Footer at bottom -->
                <div class="t4-footer">
                    <div class="t4-footer-line"></div>
                    <span class="t4-footer-text">${escapeHTML(displayMadrasaName.toUpperCase())}</span>
                    <div class="t4-footer-line"></div>
                </div>
            </div>
        `;
    } else {
        const winnersHTML = sortedWinners.map((w) => {
            const rank = w.rank;
            const nameText = isGroup ? (w.studentName || 'TEAM A') : (w.studentName || '—');
            const teamText = w.teamId ? resolveTeamName(w.teamId, w.teamName) : (w.teamName || '—');

            return `
                <div class="t1-row t1-rank-${rank <= 3 ? rank : 3}">
                    <div class="t1-rank-num">#${rank}</div>
                    <div class="t1-details">
                        <div class="t1-name">${escapeHTML(nameText.toUpperCase())}</div>
                        <div class="t1-team">${escapeHTML(teamText.toUpperCase())}</div>
                    </div>
                </div>
            `;
        }).join('');

        const finalWinnersHTML = winnersHTML || `
            <div style="text-align:center;padding:2rem 1.5rem;color:rgba(255,255,255,0.4);font-style:italic;font-size:14px;">
                No standings recorded for this event.
            </div>
        `;

        return `
            <div class="t1-container">
                ${brandHeaderHTML}
                <div class="t1-header">
                    <div class="t1-header-left">
                        <span class="t1-category">${getCategoryWithGenderHTML(r.categoryName, r.genderCategory || r.gender)}</span>
                        <h1 class="t1-title">${escapeHTML(r.programName.toUpperCase())}</h1>
                    </div>
                    <div class="t1-header-divider"></div>
                    <div class="t1-header-right">
                        <span class="t1-result-label">RESULT</span>
                        <span class="t1-result-number">${String(resultNumber).padStart(2, '0')}</span>
                    </div>
                </div>

                <div class="t1-list">
                    ${finalWinnersHTML}
                </div>

                <div class="t1-footer">
                    <div class="t1-footer-line"></div>
                    <span class="t1-footer-text">${escapeHTML(displayMadrasaName.toUpperCase())}</span>
                    <div class="t1-footer-line"></div>
                </div>
            </div>
        `;
    }
}

function renderSingleResult(r) {
    currentDisplayedResult = r;
    const list = document.getElementById('resultsList');
    const mobList = document.getElementById('mobResultsList');
    const mobPosterRoot = document.getElementById('mobPosterRoot');
    if (!list) return;

    // Hide Team Championship dashboard
    const championshipSection = document.getElementById('teamChampionshipSection');
    if (championshipSection) {
        championshipSection.style.display = 'none';
    }
    const mobChampionshipSection = document.getElementById('mobChampionshipSection');
    if (mobChampionshipSection) {
        mobChampionshipSection.style.display = 'none';
    }
    const catPerfSection = document.getElementById('categoryPerformanceSection');
    if (catPerfSection) {
        catPerfSection.style.display = 'none';
    }
    const mobCatPerfSection = document.getElementById('mobCategoryPerformanceSection');
    if (mobCatPerfSection) {
        mobCatPerfSection.style.display = 'none';
    }

    // Reveal lists
    list.style.display = 'block';
    list.className = 'poster-animate-entry';
    if (mobList) {
        mobList.style.display = 'flex';
        mobList.className = 'app-results-container poster-animate-entry';
    }

    const bgId = cardBgMap[r.id] || 1;
    const templateId = cardTemplateMap[r.id] || 1;
    const currentBgUrl = getPosterBgUrl(r.id, bgId);

    const sortedPublished = [...allResults].sort((a, b) => {
        const timeA = a.publishedAt?.seconds || 0;
        const timeB = b.publishedAt?.seconds || 0;
        return timeA - timeB;
    });

    const resultNumber = sortedPublished.findIndex(x => x.id === r.id) + 1;
    const madrasaName = getEffectiveEventName();

    const posterInnerHTML = getPosterInnerHTML(r, bgId, templateId, resultNumber, madrasaName);

    const storedCustom = getStoredCustomBg(r.id);
    const hasCustomImage = !!(storedCustom && cardBgMap[r.id] === 'custom');

    const combinedHTML = `
        <div class="poster-container" id="container-${r.id}">
            
            <div class="result-poster template-${templateId}" id="poster-${r.id}" style="background-image: url('${currentBgUrl}')">
                ${posterInnerHTML}
            </div>

            <!-- Dynamic Template Selection Picker -->
            <div class="template-picker-card" style="background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(25px); -webkit-backdrop-filter: blur(25px); border: 1px solid rgba(16, 120, 80, 0.15); border-radius: 28px; padding: 24px 20px; margin: 30px auto 10px auto; max-width: 500px; width: 100%; box-shadow: 0 15px 35px rgba(0, 0, 0, 0.04); box-sizing: border-box; text-align: center;">
                <button type="button" class="btn-action-primary btn-change-template" data-id="${r.id}" style="width: 100%; padding: 14px; border-radius: 18px; font-weight: 800; font-size: 15px; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">📐 Change Template</button>
            </div>

            <!-- Background Image Selection Thumbnail Strip (□ □ □ □) -->
            <div class="bg-picker-card">
                <span class="bg-picker-title">🎨 BACKGROUND DESIGN</span>
                <div class="thumbnail-list">
                    <div class="thumb ${bgId === 1 ? 'active' : ''}" data-id="${r.id}" data-bg="1">
                        <img src="../assets/poster-backgrounds/bg1.jpg" alt="Bg 1">
                    </div>
                    <div class="thumb ${bgId === 2 ? 'active' : ''}" data-id="${r.id}" data-bg="2">
                        <img src="../assets/poster-backgrounds/bg2.jpg" alt="Bg 2">
                    </div>
                    <div class="thumb ${bgId === 3 ? 'active' : ''}" data-id="${r.id}" data-bg="3">
                        <img src="../assets/poster-backgrounds/bg3.jpg" alt="Bg 3">
                    </div>
                    <div class="thumb ${bgId === 4 ? 'active' : ''}" data-id="${r.id}" data-bg="4">
                        <img src="../assets/poster-backgrounds/bg4.jpg" alt="Bg 4">
                    </div>
                    <div class="thumb ${bgId === 5 ? 'active' : ''}" data-id="${r.id}" data-bg="5">
                        <img src="../assets/poster-backgrounds/bg5.jpg" alt="Bg 5">
                    </div>
                    <div class="thumb ${bgId === 6 ? 'active' : ''}" data-id="${r.id}" data-bg="6">
                        <img src="../assets/poster-backgrounds/bg6.jpg" alt="Bg 6">
                    </div>
                    <div class="thumb ${bgId === 7 ? 'active' : ''}" data-id="${r.id}" data-bg="7">
                        <img src="../assets/poster-backgrounds/bg7.jpg" alt="Bg 7">
                    </div>
                    <div class="thumb ${bgId === 8 ? 'active' : ''}" data-id="${r.id}" data-bg="8">
                        <img src="../assets/poster-backgrounds/bg8.jpg" alt="Bg 8">
                    </div>
                    <div class="thumb ${bgId === 9 ? 'active' : ''}" data-id="${r.id}" data-bg="9">
                        <img src="../assets/poster-backgrounds/bg9.jpg" alt="Bg 9">
                    </div>
                    <div class="thumb ${bgId === 10 ? 'active' : ''}" data-id="${r.id}" data-bg="10">
                        <img src="../assets/poster-backgrounds/bg10.jpg" alt="Bg 10">
                    </div>
                    <div class="thumb thumb-upload-btn ${hasCustomImage ? 'has-image' : ''} ${bgId === 'custom' ? 'active' : ''}" data-id="${r.id}" data-bg="custom" title="Upload Custom Background">
                        ${hasCustomImage ? `
                            <img src="${storedCustom}" alt="Custom Bg" style="width:100%;height:100%;object-fit:cover;border-radius:12px;">
                        ` : `
                            <span class="upload-btn-icon">➕</span>
                            <span class="upload-btn-label">UPLOAD</span>
                        `}
                    </div>
                    <input type="file" class="custom-bg-file-input" id="customBgInput-${r.id}" accept="image/*" style="display:none;" />
                </div>
            </div>

            <!-- Balanced Actions Buttons Row -->
            <div class="poster-actions" style="margin-top: clamp(20px, 4vw, 30px); display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 500px; margin-inline: auto; box-sizing: border-box;">
                <button class="btn-action-primary btn-download" data-id="${r.id}" style="width: 100%; padding: 14px; border-radius: 18px; font-weight: 800; font-size: 15px; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">📥 Download Poster Image</button>
                <button type="button" class="btn-action-secondary btn-back-leaderboard" style="width: 100%; padding: 14px; border-radius: 18px; font-weight: 800; font-size: 15px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">🏆 View Live Standings</button>
            </div>

        </div>
    `;

    list.innerHTML = combinedHTML;
    if (mobPosterRoot) {
        mobPosterRoot.innerHTML = combinedHTML;
    }

    // Wire template modal trigger
    document.querySelectorAll('.btn-change-template').forEach(btn => {
        btn.onclick = () => {
            const modal = document.getElementById('templateModal');
            const grid = document.getElementById('templateGrid');

            const templates = [
                { id: 1, name: 'Template 1 (Current)' },
                { id: 2, name: 'Template 2 (Cards)' },
                { id: 3, name: 'Template 3 (Editorial)' },
                { id: 4, name: 'Template 4 (Leaderboard)' }
            ];

            grid.innerHTML = templates.map(t => {
                const isActive = t.id === templateId;
                const miniPosterHTML = getMiniPosterHTML(r, bgId, t.id, resultNumber, madrasaName);
                return `
                    <div class="template-option-card ${isActive ? 'active' : ''}" data-template="${t.id}">
                        <div class="mini-poster-preview" style="background-image: url('${currentBgUrl}')">
                            ${miniPosterHTML}
                        </div>
                        <span class="template-option-title">${t.name}</span>
                    </div>
                `;
            }).join('');

            modal.classList.add('show');

            // Wire selections
            grid.querySelectorAll('.template-option-card').forEach(card => {
                card.onclick = (e) => {
                    const selectedTplId = parseInt(e.currentTarget.dataset.template, 10);
                    cardTemplateMap[r.id] = selectedTplId;
                    modal.classList.remove('show');
                    renderSingleResult(r);
                };
            });
        };
    });

    // Close Modal handler
    document.getElementById('closeTemplateModalBtn').onclick = () => {
        document.getElementById('templateModal').classList.remove('show');
    };

    document.getElementById('templateModal').onclick = (e) => {
        if (e.target === document.getElementById('templateModal')) {
            document.getElementById('templateModal').classList.remove('show');
        }
    };

    // Wire thumbnail selector click triggers
    document.querySelectorAll('.thumb').forEach(box => {
        box.onclick = (e) => {
            const cardId = e.currentTarget.dataset.id;
            const bgVal = e.currentTarget.dataset.bg;

            if (bgVal === 'custom') {
                const existingCustom = getStoredCustomBg(cardId);
                const isAlreadyActive = cardBgMap[cardId] === 'custom';

                if (!existingCustom || isAlreadyActive) {
                    const fileInput = document.getElementById(`customBgInput-${cardId}`);
                    if (fileInput) fileInput.click();
                    if (!existingCustom) return;
                }
                cardBgMap[cardId] = 'custom';
            } else {
                cardBgMap[cardId] = parseInt(bgVal, 10);
            }

            try { localStorage.setItem(`melad_card_bg_${cardId}`, cardBgMap[cardId]); } catch (err) { }

            const bgUrl = getPosterBgUrl(cardId, cardBgMap[cardId]);

            document.querySelectorAll(`[id="poster-${cardId}"]`).forEach(posterEl => {
                posterEl.style.backgroundImage = `url('${bgUrl}')`;
            });

            document.querySelectorAll(`[id="container-${cardId}"]`).forEach(containerEl => {
                containerEl.querySelectorAll('.thumb').forEach(b => {
                    b.classList.remove('active');
                    if (b.dataset.bg === String(cardBgMap[cardId])) {
                        b.classList.add('active');
                    }
                });
            });
        };
    });

    // Wire custom background file upload listener
    document.querySelectorAll('.custom-bg-file-input').forEach(input => {
        input.onchange = (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    const maxDim = 1500;
                    if (width > maxDim || height > maxDim) {
                        if (width > height) {
                            height = Math.round((height * maxDim) / width);
                            width = maxDim;
                        } else {
                            width = Math.round((width * maxDim) / height);
                            height = maxDim;
                        }
                    }
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);

                    setStoredCustomBg(r.id, dataUrl);
                    cardBgMap[r.id] = 'custom';
                    try { localStorage.setItem(`melad_card_bg_${r.id}`, 'custom'); } catch (err) { }

                    renderSingleResult(r);
                    showToast("✓ Custom background updated!");
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        };
    });

    // Wire Card Actions
    document.querySelectorAll('.btn-download').forEach(btn => {
        btn.onclick = () => {
            downloadPosterAsImage(r.id);
        };
    });

    const goBackToStandings = () => {
        currentDisplayedResult = null;
        list.style.display = 'none';
        if (mobList) mobList.style.display = 'none';
        if (championshipSection) {
            championshipSection.style.display = 'flex';
        }
        if (mobChampionshipSection) {
            mobChampionshipSection.style.display = 'flex';
        }
        updateTeamChampionship();
    };

    document.querySelectorAll('.btn-back-leaderboard').forEach(btn => {
        btn.onclick = goBackToStandings;
    });

    const mobBtnBack = document.getElementById('mobBtnBackToStandings');
    if (mobBtnBack) {
        mobBtnBack.onclick = goBackToStandings;
    }
}

function renderError(title, msg) {
    const championshipSection = document.getElementById('teamChampionshipSection');
    if (championshipSection) championshipSection.style.display = 'none';
    const mobChampionshipSection = document.getElementById('mobChampionshipSection');
    if (mobChampionshipSection) mobChampionshipSection.style.display = 'none';
    const catPerfSection = document.getElementById('categoryPerformanceSection');
    if (catPerfSection) catPerfSection.style.display = 'none';
    const mobCatPerfSection = document.getElementById('mobCategoryPerformanceSection');
    if (mobCatPerfSection) mobCatPerfSection.style.display = 'none';

    const list = document.getElementById('resultsList');
    const mobList = document.getElementById('mobResultsList');
    const mobPosterRoot = document.getElementById('mobPosterRoot');

    const emptyHTML = `
        <div class="empty-state" style="text-align: center; padding: 3rem 1.5rem; max-width: 500px; margin: 30px auto; background: rgba(255,255,255,0.85); border-radius: 28px; border: 1px solid rgba(220,38,38,0.15); box-shadow: 0 15px 35px rgba(0,0,0,0.02);">
            <div class="empty-icon" style="font-size: 3rem; margin-bottom: 1rem;">❌</div>
            <h2 style="color:#dc2626; margin-bottom:0.5rem; font-family:'Playfair Display', serif; font-weight:700;">${escapeHTML(title)}</h2>
            <p style="color:#64748b; font-weight:500; margin-bottom: 1.5rem;">${escapeHTML(msg)}</p>
            <button type="button" class="btn-action-secondary btn-back-leaderboard" style="width: 100%; padding: 14px; border-radius: 18px; font-weight: 800; font-size: 15px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">🏆 View Live Standings</button>
        </div>
    `;

    if (list) {
        list.style.display = 'block';
        list.className = 'poster-animate-entry';
        list.innerHTML = emptyHTML;
    }
    if (mobList && mobPosterRoot) {
        mobList.style.display = 'flex';
        mobList.className = 'app-results-container poster-animate-entry';
        mobPosterRoot.innerHTML = emptyHTML;
    }

    const wireBackClicks = () => {
        currentDisplayedResult = null;
        if (list) list.style.display = 'none';
        if (mobList) mobList.style.display = 'none';
        if (championshipSection) championshipSection.style.display = 'flex';
        if (mobChampionshipSection) mobChampionshipSection.style.display = 'flex';
        updateTeamChampionship();
    };

    document.querySelectorAll('.btn-back-leaderboard').forEach(btn => {
        btn.onclick = wireBackClicks;
    });
    const mobBtnBackToStandings = document.getElementById('mobBtnBackToStandings');
    if (mobBtnBackToStandings) mobBtnBackToStandings.onclick = wireBackClicks;
}

function renderEmpty(title, msg) {
    const championshipSection = document.getElementById('teamChampionshipSection');
    if (championshipSection) championshipSection.style.display = 'none';
    const mobChampionshipSection = document.getElementById('mobChampionshipSection');
    if (mobChampionshipSection) mobChampionshipSection.style.display = 'none';

    const list = document.getElementById('resultsList');
    const mobList = document.getElementById('mobResultsList');
    const mobPosterRoot = document.getElementById('mobPosterRoot');

    const emptyHTML = `
        <div class="empty-state" style="text-align: center; padding: 3rem 1.5rem; max-width: 500px; margin: 30px auto; background: rgba(255,255,255,0.85); border-radius: 28px; border: 1px solid rgba(16,120,80,0.12); box-shadow: 0 15px 35px rgba(0,0,0,0.02);">
            <div class="empty-icon" style="font-size: 3rem; margin-bottom: 1rem;">🔍</div>
            <h3 style="font-family:'Playfair Display', serif; font-weight:700; color:#064e3b; margin-bottom:0.5rem;">${escapeHTML(title)}</h3>
            <p style="color:#64748b; font-weight:500; margin-bottom: 1.5rem;">${escapeHTML(msg)}</p>
            <button type="button" class="btn-action-secondary btn-back-leaderboard" style="width: 100%; padding: 14px; border-radius: 18px; font-weight: 800; font-size: 15px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">🏆 View Live Standings</button>
        </div>
    `;

    if (list) {
        list.style.display = 'block';
        list.className = 'poster-animate-entry';
        list.innerHTML = emptyHTML;
    }
    if (mobList && mobPosterRoot) {
        mobList.style.display = 'flex';
        mobList.className = 'app-results-container poster-animate-entry';
        mobPosterRoot.innerHTML = emptyHTML;
    }

    const wireBackClicks = () => {
        currentDisplayedResult = null;
        if (list) list.style.display = 'none';
        if (mobList) mobList.style.display = 'none';
        if (championshipSection) championshipSection.style.display = 'flex';
        if (mobChampionshipSection) mobChampionshipSection.style.display = 'flex';
        updateTeamChampionship();
    };

    document.querySelectorAll('.btn-back-leaderboard').forEach(btn => {
        btn.onclick = wireBackClicks;
    });
    const mobBtnBackToStandings = document.getElementById('mobBtnBackToStandings');
    if (mobBtnBackToStandings) mobBtnBackToStandings.onclick = wireBackClicks;
}

// Helper to pre-blur background image via canvas 2D context filter
async function getBlurredBgDataUrl(bgUrl) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = 450;
                canvas.height = 562.5;
                const ctx = canvas.getContext('2d');

                // Native canvas blur filter
                ctx.filter = 'blur(3px)';
                // Render with a bleed margin to avoid edge bleeding
                const bleed = 24;
                ctx.drawImage(img, -bleed, -bleed, canvas.width + bleed * 2, canvas.height + bleed * 2);

                resolve(canvas.toDataURL('image/jpeg', 0.95));
            } catch (err) {
                console.error("Canvas blur failed, falling back to raw background URL:", err);
                resolve(bgUrl);
            }
        };
        img.onerror = (err) => {
            console.error("Failed to load background image for blur:", err);
            resolve(bgUrl);
        };
        img.src = bgUrl;
    });
}

// ─────────────────────────────────────────────
// Standard ArabicShaper Engine (arabic-persian-reshaper by Shen Yiming / Alex Clay)
// ─────────────────────────────────────────────
const ArabicShaper = (function () {
    var charsMap = [
        /* code,isolated,initial, medial, final */
        [0x0621, 0xFE80, null, null, null], /* HAMZA */
        [0x0622, 0xFE81, null, null, 0xFE82], /* ALEF_MADDA */
        [0x0623, 0xFE83, null, null, 0xFE84], /* ALEF_HAMZA_ABOVE */
        [0x0624, 0xFE85, null, null, 0xFE86], /* WAW_HAMZA */
        [0x0625, 0xFE87, null, null, 0xFE88], /* ALEF_HAMZA_BELOW */
        [0x0626, 0xFE89, 0xFE8B, 0xFE8C, 0xFE8A], /* YEH_HAMZA */
        [0x0627, 0xFE8D, null, null, 0xFE8E], /* ALEF */
        [0x0628, 0xFE8F, 0xFE91, 0xFE92, 0xFE90], /* BEH */
        [0x0629, 0xFE93, null, null, 0xFE94], /* TEH_MARBUTA */
        [0x062A, 0xFE95, 0xFE97, 0xFE98, 0xFE96], /* TEH */
        [0x062B, 0xFE99, 0xFE9B, 0xFE9C, 0xFE9A], /* THEH */
        [0x062C, 0xFE9D, 0xFE9F, 0xFEA0, 0xFE9E], /* JEEM */
        [0x062D, 0xFEA1, 0xFEA3, 0xFEA4, 0xFEA2], /* HAH */
        [0x062E, 0xFEA5, 0xFEA7, 0xFEA8, 0xFEA6], /* KHAH */
        [0x062F, 0xFEA9, null, null, 0xFEAA], /* DAL */
        [0x0630, 0xFEAB, null, null, 0xFEAC], /* THAL */
        [0x0631, 0xFEAD, null, null, 0xFEAE], /* REH */
        [0x0632, 0xFEAF, null, null, 0xFEB0], /* ZAIN */
        [0x0698, 0xFB8A, null, null, 0xFB8B], /* ZHEH */
        [0x0633, 0xFEB1, 0xFEB3, 0xFEB4, 0xFEB2], /* SEEN */
        [0x0634, 0xFEB5, 0xFEB7, 0xFEB8, 0xFEB6], /* SHEEN */
        [0x0635, 0xFEB9, 0xFEBB, 0xFEBC, 0xFEBA], /* SAD */
        [0x0636, 0xFEBD, 0xFEBF, 0xFEC0, 0xFEBE], /* DAD */
        [0x0637, 0xFEC1, 0xFEC3, 0xFEC4, 0xFEC2], /* TAH */
        [0x0638, 0xFEC5, 0xFEC7, 0xFEC8, 0xFEC6], /* ZAH */
        [0x0639, 0xFEC9, 0xFECB, 0xFECC, 0xFECA], /* AIN */
        [0x063A, 0xFECD, 0xFECF, 0xFED0, 0xFECE], /* GHAIN */
        [0x0640, 0x0640, 0x0640, 0x0640, 0x0640], /* TATWEEL */
        [0x0641, 0xFED1, 0xFED3, 0xFED4, 0xFED2], /* FEH */
        [0x0642, 0xFED5, 0xFED7, 0xFED8, 0xFED6], /* QAF */
        [0x0643, 0xFED9, 0xFEDB, 0xFEDC, 0xFEDA], /* KAF */
        [0x0644, 0xFEDD, 0xFEDF, 0xFEE0, 0xFEDE], /* LAM */
        [0x0645, 0xFEE1, 0xFEE3, 0xFEE4, 0xFEE2], /* MEEM */
        [0x0646, 0xFEE5, 0xFEE7, 0xFEE8, 0xFEE6], /* NOON */
        [0x0647, 0xFEE9, 0xFEEB, 0xFEEC, 0xFEEA], /* HEH */
        [0x0648, 0xFEED, null, null, 0xFEEE], /* WAW */
        [0x0649, 0xFEEF, 0xFBE8, 0xFBE9, 0xFEF0], /* ALEF_MAKSURA */
        [0x064A, 0xFEF1, 0xFEF3, 0xFEF4, 0xFEF2], /* YEH Arabic */
        [0x06CC, 0xFBFC, 0xFBFE, 0xFBFF, 0xFEF0], /* YEH Farsi */
        [0x0686, 0xFB7A, 0xFB7C, 0xFB7D, 0xFB7B], /* CHEH */
        [0x067E, 0xFB56, 0xFB58, 0xFB59, 0xFB57],
        [0x06AF, 0xFB92, 0xFB94, 0xFB95, 0xFB93],
        [0x06A9, 0xFB8E, 0xFB90, 0xFB91, 0xFB8F]
    ];
    var combCharsMap = [
        [[0x0644, 0x0622], 0xFEF5, null, null, 0xFEF6], /* LAM_ALEF_MADDA */
        [[0x0644, 0x0623], 0xFEF7, null, null, 0xFEF8], /* LAM_ALEF_HAMZA_ABOVE */
        [[0x0644, 0x0625], 0xFEF9, null, null, 0xFEFA], /* LAM_ALEF_HAMZA_BELOW */
        [[0x0644, 0x0627], 0xFEFB, null, null, 0xFEFC]  /* LAM_ALEF */
    ];
    var transChars = [
        0x0610, 0x0612, 0x0613, 0x0614, 0x0615, 0x064B, 0x064C, 0x064D, 0x064E, 0x064F,
        0x0650, 0x0651, 0x0652, 0x0653, 0x0654, 0x0655, 0x0656, 0x0657, 0x0658, 0x0670,
        0x06D6, 0x06D7, 0x06D8, 0x06D9, 0x06DA, 0x06DB, 0x06DC, 0x06DF, 0x06E0, 0x06E1,
        0x06E2, 0x06E3, 0x06E4, 0x06E7, 0x06E8, 0x06EA, 0x06EB, 0x06EC, 0x06ED
    ];

    function CharacterMapContains(c) {
        for (var i = 0; i < charsMap.length; ++i)
            if (charsMap[i][0] == c) return true;
        return false;
    }

    function GetCharRep(c) {
        for (var i = 0; i < charsMap.length; ++i)
            if (charsMap[i][0] == c) return charsMap[i];
        return false;
    }

    function GetCombCharRep(c1, c2) {
        for (var i = 0; i < combCharsMap.length; ++i)
            if (combCharsMap[i][0][0] == c1 && combCharsMap[i][0][1] == c2) return combCharsMap[i];
        return false;
    }

    function IsTransparent(c) {
        for (var i = 0; i < transChars.length; ++i)
            if (transChars[i] == c) return true;
        return false;
    }

    function convertArabic(normal) {
        if (!normal || typeof normal !== 'string') return normal;
        var crep, combcrep, shaped = "";
        for (var i = 0; i < normal.length; ++i) {
            var current = normal.charCodeAt(i);
            if (CharacterMapContains(current)) {
                var prev = null, next = null, prevID = i - 1, nextID = i + 1;
                for (; prevID >= 0; --prevID) {
                    if (!IsTransparent(normal.charCodeAt(prevID))) break;
                }
                prev = (prevID >= 0) ? normal.charCodeAt(prevID) : null;
                crep = prev ? GetCharRep(prev) : false;
                if (!crep || (crep[2] == null && crep[3] == null)) prev = null;

                for (; nextID < normal.length; ++nextID) {
                    if (!IsTransparent(normal.charCodeAt(nextID))) break;
                }
                next = (nextID < normal.length) ? normal.charCodeAt(nextID) : null;
                crep = next ? GetCharRep(next) : false;
                if (!crep || (crep[3] == null && crep[4] == null)) next = null;

                if (current == 0x0644 && next != null &&
                    (next == 0x0622 || next == 0x0623 || next == 0x0625 || next == 0x0627)) {
                    combcrep = GetCombCharRep(current, next);
                    if (combcrep) {
                        if (prev != null) {
                            shaped += String.fromCharCode(combcrep[4]);
                        } else {
                            shaped += String.fromCharCode(combcrep[1]);
                        }
                        i = i + 1;
                        continue;
                    }
                }
                crep = GetCharRep(current);
                if (prev != null && next != null && crep[3] != null) {
                    shaped += String.fromCharCode(crep[3]);
                    continue;
                } else if (prev != null && crep[4] != null) {
                    shaped += String.fromCharCode(crep[4]);
                    continue;
                } else if (next != null && crep[2] != null) {
                    shaped += String.fromCharCode(crep[2]);
                    continue;
                } else {
                    shaped += String.fromCharCode(crep[1]);
                }
            } else {
                shaped += String.fromCharCode(current);
            }
        }
        return shaped;
    }

    return {
        convertArabic: convertArabic
    };
})();

function preprocessArabicInContainer(container) {
    if (!container) return;
    const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );
    let node;
    const arabicRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
    while ((node = walker.nextNode())) {
        if (node.nodeValue && arabicRegex.test(node.nodeValue)) {
            node.nodeValue = ArabicShaper.convertArabic(node.nodeValue);
        }
    }
}

// ─────────────────────────────────────────────
// Unified Off-screen High-Res (1200x1500) DOM Capture Drawer
// ─────────────────────────────────────────────
async function generatePosterCanvas(r) {
    if (typeof html2canvas === 'undefined') {
        console.error('html2canvas library is not loaded');
        return null;
    }

    const bgId = cardBgMap[r.id] || 1;
    const templateId = cardTemplateMap[r.id] || 1;
    const bgUrl = getPosterBgUrl(r.id, bgId);

    // 1. Generate the blurred background data URL
    const blurredBgDataUrl = await getBlurredBgDataUrl(bgUrl);

    // 2. Fetch/Generate the poster inner HTML
    const sortedPublished = [...allResults].sort((a, b) => (a.publishedAt?.seconds || 0) - (b.publishedAt?.seconds || 0));
    const resultNumber = sortedPublished.findIndex(x => x.id === r.id) + 1;
    const madrasaName = getEffectiveEventName();
    const posterInnerHTML = getPosterInnerHTML(r, bgId, templateId, resultNumber, madrasaName);

    // 3. Create isolated iframe rendering environment
    const iframe = document.createElement('iframe');
    // Hide iframe securely but do NOT use display:none or visibility:hidden because the browser may optimize layout out
    iframe.style.position = 'fixed';
    iframe.style.left = '-9999px';
    iframe.style.top = '-9999px';
    iframe.style.width = '1200px'; // Set large desktop viewport size to avoid mobile media queries
    iframe.style.height = '1500px';
    iframe.style.border = 'none';
    iframe.style.zIndex = '-9999';
    document.body.appendChild(iframe);

    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
    iframeDoc.open();
    iframeDoc.write('<!DOCTYPE html><html><head></head><body style="margin:0;padding:0;overflow:hidden;background:transparent;"></body></html>');
    iframeDoc.close();

    // 4. Set base tag in iframe head to resolve relative URLs from the host page path
    const baseEl = iframeDoc.createElement('base');
    baseEl.href = window.location.href;
    iframeDoc.head.appendChild(baseEl);

    // 5. Clone host page style sheets into the iframe
    document.querySelectorAll('link[rel="stylesheet"], style').forEach(el => {
        iframeDoc.head.appendChild(el.cloneNode(true));
    });

    // 6. Append an override style block to the iframe head:
    // - Disable pseudo elements (::before/::after) for html2canvas-capture to prevent createPattern errors
    // - Force exact desktop dimensions and layouts to prevent mobile viewport squishing inside the iframe
    const overrideStyle = iframeDoc.createElement('style');
    overrideStyle.textContent = `
        /* Force desktop scale dimensions inside the capture iframe */
        .result-poster.html2canvas-capture {
            width: 450px !important;
            height: 562.5px !important;
            max-width: none !important;
            max-height: none !important;
            min-width: 450px !important;
            min-height: 562.5px !important;
            transform: none !important;
            border-radius: 0 !important;
        }

        /* Override template responsive rules to keep desktop proportions */
        .t1-container {
            top: 24px !important;
            bottom: 24px !important;
            left: 24px !important;
            right: 24px !important;
            padding: 24px !important;
            border-radius: 32px !important;
        }
        .t1-title {
            font-size: 22px !important;
        }
        .t1-row {
            padding: 16px !important;
            border-radius: 20px !important;
            gap: 16px !important;
        }
        .t1-rank-num {
            font-size: 26px !important;
            min-width: 42px !important;
        }
        .t1-name {
            font-size: 15px !important;
        }
        .t1-team {
            font-size: 11px !important;
        }

        .t2-container {
            top: 24px !important;
            bottom: 24px !important;
            left: 24px !important;
            right: 24px !important;
        }
        .t2-program-title {
            font-size: 22px !important;
        }
        .t2-bento-row {
            flex-direction: row !important;
            gap: 12px !important;
        }
        .t2-card-2nd, .t2-card-3rd {
            width: calc(50% - 6px) !important;
            min-height: 120px !important;
            padding: 16px 20px !important;
            border-radius: 24px !important;
        }
        .t2-card-1st {
            padding: 16px 20px !important;
            border-radius: 28px !important;
            min-height: 110px !important;
        }
        .t2-student {
            font-size: 16px !important;
        }
        .t2-rank-large {
            font-size: 48px !important;
        }

        .t3-container {
            top: 36px !important;
            bottom: 36px !important;
            left: 36px !important;
            right: 36px !important;
        }
        .t3-program-title {
            font-size: 24px !important;
        }

        .t4-container {
            top: 24px !important;
            bottom: 24px !important;
            left: 24px !important;
            right: 24px !important;
        }
        .t4-split-content {
            flex-direction: row !important;
            gap: 24px !important;
        }
        .t4-left-panel {
            width: 35% !important;
            border-right: 1px solid rgba(255, 255, 255, 0.15) !important;
            border-bottom: none !important;
            padding-right: 16px !important;
            padding-bottom: 0 !important;
        }
        .t4-right-panel {
            width: 65% !important;
            gap: 16px !important;
        }
        .t4-academic-decor {
            display: flex !important;
        }
        .t4-rank-block {
            padding: 16px 20px !important;
            border-radius: 16px !important;
        }
        .t4-rank-num {
            font-size: 32px !important;
        }

        /* Force solid background colors on decorative footer lines inside iframe to bypass 0-width linear-gradient pattern rendering bugs in html2canvas */
        .t1-footer-line, .t2-footer-line, .t3-footer-line, .t4-footer-line {
            background: rgba(255, 255, 255, 0.15) !important;
            height: 1px !important;
        }

        /* Disable all pseudo elements to avoid html2canvas 0-size canvas pattern bugs */
        .html2canvas-capture::before,
        .html2canvas-capture::after,
        .html2canvas-capture *::before,
        .html2canvas-capture *::after {
            display: none !important;
            content: none !important;
            background: none !important;
            background-image: none !important;
        }
    `;
    iframeDoc.head.appendChild(overrideStyle);

    // 7. Create the poster target inside the iframe body
    const posterInIframe = iframeDoc.createElement('div');
    posterInIframe.className = `result-poster template-${templateId} html2canvas-capture`;
    posterInIframe.style.width = '450px';
    posterInIframe.style.height = '562.5px';
    posterInIframe.style.position = 'relative';
    posterInIframe.style.overflow = 'hidden';
    posterInIframe.style.margin = '0';
    posterInIframe.style.boxShadow = 'none';
    posterInIframe.style.transform = 'none';
    posterInIframe.style.borderRadius = '0';
    posterInIframe.style.backgroundImage = 'none'; // We replace it with explicit img/div layers

    // Decide overlay opacity/color
    const overlayColor = (templateId === 3 || templateId === 4) ? 'rgba(15, 23, 42, 0.35)' : 'rgba(15, 23, 42, 0.32)';

    // Insert blurred background layer, overlay layer, and original content
    posterInIframe.innerHTML = `
        <img class="h2c-blur-bg" src="${blurredBgDataUrl}" style="position: absolute; top: -20px; left: -20px; right: -20px; bottom: -20px; width: calc(100% + 40px); height: calc(100% + 40px); object-fit: cover; z-index: 0; pointer-events: none;" crossorigin="anonymous" />
        <div class="h2c-overlay" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: ${overlayColor}; z-index: 1; pointer-events: none;"></div>
        ${posterInnerHTML}
    `;

    iframeDoc.body.appendChild(posterInIframe);

    // Preprocess ONLY Arabic text nodes inside the off-screen capture iframe for PNG export
    preprocessArabicInContainer(posterInIframe);

    try {
        // 8. Wait for fonts inside the iframe to be ready
        if (iframe.contentWindow.document.fonts && iframe.contentWindow.document.fonts.ready) {
            await iframe.contentWindow.document.fonts.ready;
        }

        // 9. Wait for all img elements in the iframe to load
        const images = Array.from(posterInIframe.querySelectorAll('img'));
        await Promise.all(images.map(img => {
            return new Promise(resolve => {
                if (img.complete) {
                    if (img.naturalWidth === 0 || img.naturalHeight === 0) {
                        // Fallback/sanitize if failed
                        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                    }
                    resolve();
                } else {
                    img.onload = () => resolve();
                    img.onerror = () => {
                        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                        resolve();
                    };
                }
            });
        }));

        // 10. Wait for CSS and layout calculations to stabilize via requestAnimationFrame and small timeout
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await new Promise(resolve => setTimeout(resolve, 350));

        // 11. Run html2canvas on the poster element inside the iframe
        const scaleFactor = 1200 / 450;
        const canvas = await html2canvas(posterInIframe, {
            scale: scaleFactor,
            useCORS: true,
            allowTaint: false,
            backgroundColor: null,
            logging: false,
            scrollX: 0,
            scrollY: 0,
            width: 450,
            height: 562.5
        });

        return canvas;
    } catch (err) {
        console.error("Poster capture failed:", err);
        return null;
    } finally {
        // Clean up iframe
        if (iframe && iframe.parentNode) {
            document.body.removeChild(iframe);
        }
    }
}

// ─────────────────────────────────────────────
// Poster Image Direct Download
// ─────────────────────────────────────────────
async function downloadPosterAsImage(cardId) {
    const r = allResults.find(x => x.id === cardId);
    if (!r) return;

    showToast("Generating image download...");
    const canvas = await generatePosterCanvas(r);
    if (!canvas) {
        showToast("⚠️ Image download failed. Please try again.");
        return;
    }

    // Trigger standard browser download handler
    const link = document.createElement('a');
    link.download = `result_${r.programName.toLowerCase().replace(/\s+/g, '_')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast(`✓ Image downloaded: result_${r.programName.toLowerCase().replace(/\s+/g, '_')}.png`);
}

// ─────────────────────────────────────────────
// Native Web Share API or Clipboard Fallsharing
// ─────────────────────────────────────────────
async function sharePosterContent(cardId) {
    const r = allResults.find(x => x.id === cardId);
    if (!r) return;

    const madrasaName = getEffectiveEventName();

    // Fetch top 3 winners using dense ranking
    const activeWinners = [...(r.marksData || [])]
        .filter(w => w.finalMark && w.finalMark > 0)
        .sort((a, b) => (b.finalMark || 0) - (a.finalMark || 0));
    computeDenseRanking(activeWinners, w => w.finalMark, 'rank');
    const sorted = activeWinners.filter(w => w.rank <= 3);

    const isGroup = r.programType === 'group' || (r.programType === 'general' && r.registrationType === 'group');

    const formatWinner = (w) => {
        if (!w) return '—';
        const namePart = isGroup ? w.studentName : w.studentName;
        const teamPart = isGroup ? 'Group' : (w.teamId ? resolveTeamName(w.teamId, w.teamName) : (w.teamName || '—'));
        return `${namePart} (${teamPart})`;
    };

    const ordinalLabel = (rank) => {
        const labels = { 1: '1st', 2: '2nd', 3: '3rd' };
        return labels[rank] || `${rank}th`;
    };

    const w1 = sorted[0] ? formatWinner(sorted[0]) : '—';
    const w2 = sorted[1] ? formatWinner(sorted[1]) : '—';
    const w3 = sorted[2] ? formatWinner(sorted[2]) : '—';

    const r1Label = sorted[0] ? ordinalLabel(sorted[0].rank) : '1st';
    const r2Label = sorted[1] ? ordinalLabel(sorted[1].rank) : '2nd';
    const r3Label = sorted[2] ? ordinalLabel(sorted[2].rank) : '3rd';

    const medal1 = sorted[0] && sorted[0].rank === 1 ? '🥇' : (sorted[0] && sorted[0].rank === 2 ? '🥈' : (sorted[0] && sorted[0].rank === 3 ? '🥉' : '🏅'));
    const medal2 = sorted[1] && sorted[1].rank === 1 ? '🥇' : (sorted[1] && sorted[1].rank === 2 ? '🥈' : (sorted[1] && sorted[1].rank === 3 ? '🥉' : '🏅'));
    const medal3 = sorted[2] && sorted[2].rank === 1 ? '🥇' : (sorted[2] && sorted[2].rank === 2 ? '🥈' : (sorted[2] && sorted[2].rank === 3 ? '🥉' : '🏅'));

    const portalUrl = window.location.href;
    const shareText = `🏆 *${r.programName.toUpperCase()}* Result Published!\n\n🕌 *${madrasaName}*\n🏷️ Category: *${r.categoryName}*\n\n${medal1} *${r1Label}:* ${w1}\n${medal2} *${r2Label}:* ${w2}\n${medal3} *${r3Label}:* ${w3}\n\n👉 Check official standings on the portal:\n${portalUrl}`;

    // Helper function for clipboard text copy fallback
    const copyToClipboardFallback = () => {
        navigator.clipboard.writeText(shareText).then(() => {
            showToast("✓ Copied standings summary & portal link to clipboard!");

            // Open WhatsApp Web/Mobile with prefilled text
            const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
            window.open(waUrl, '_blank');
        }).catch(err => {
            console.error("Clipboard copy failure:", err);
            showToast("Sharing copy failed.");
        });
    };

    // Generate image canvas
    const canvas = await generatePosterCanvas(r);
    if (!canvas) {
        copyToClipboardFallback();
        return;
    }

    // Attempt direct image file sharing through Web Share API if supported
    if (navigator.canShare && navigator.share) {
        canvas.toBlob((blob) => {
            if (!blob) {
                console.error("Failed to generate blob from canvas");
                copyToClipboardFallback();
                return;
            }

            const fileName = `result_${r.programName.toLowerCase().replace(/\s+/g, '_')}.png`;
            const file = new File([blob], fileName, { type: 'image/png' });

            // Double check if sharing this specific file is allowed by the browser
            if (navigator.canShare({ files: [file] })) {
                navigator.share({
                    files: [file],
                    title: `${r.programName} Standings`,
                    text: shareText
                }).then(() => {
                    showToast("✓ Shared standings image successfully!");
                }).catch(err => {
                    console.warn("Native sharing cancelled or failed:", err);
                    copyToClipboardFallback();
                });
            } else {
                console.warn("Direct image sharing not supported by this browser");
                copyToClipboardFallback();
            }
        }, 'image/png');
    } else {
        // Fallback for browsers that do not support Web Share API (desktop)
        copyToClipboardFallback();
    }
}

// Start Portal Load
init();

window.addEventListener('pagehide', () => {
    if (activeResultUnsubscribe) {
        activeResultUnsubscribe();
    }
});
