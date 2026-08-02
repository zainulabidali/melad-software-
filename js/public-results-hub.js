import { db } from './firebase.js';
import {
    collection, doc, getDoc, getDocs, onSnapshot, query, where
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// ─────────────────────────────────────────────
// STATE & INSTITUTE RESOLUTION
// ─────────────────────────────────────────────
function resolveInstituteId() {
    const urlParams = new URLSearchParams(window.location.search);
    let id = urlParams.get('id') || urlParams.get('instId');
    if (id) {
        try {
            localStorage.setItem('currentInstituteId', id);
            localStorage.setItem('melad_institute_id', id);
        } catch (e) { }
        return id;
    }
    return localStorage.getItem('currentInstituteId') ||
        localStorage.getItem('melad_institute_id') ||
        sessionStorage.getItem('currentInstituteId') ||
        sessionStorage.getItem('melad_institute_id');
}

const instId = resolveInstituteId();
const CACHE_KEY = `hub_cache_${instId}`;

let eventConfig = null;
let instituteDetails = null;
let dashboardData = null;

let leaderboardData = [];
let categoryPerformanceData = [];

let publishedResultsList = []; // All published result docs
let categoriesList = [];

let selectedCategory = '';
let selectedProgramId = '';

// Helper: Escape HTML
function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Ordinal Formatter (1st, 2nd, 3rd, 4th...) - Guarantees NO NaN ever
function formatOrdinal(n) {
    const num = parseInt(n, 10);
    if (isNaN(num) || num <= 0) return '';
    const j = num % 10, k = num % 100;
    if (j === 1 && k !== 11) return num + 'st';
    if (j === 2 && k !== 12) return num + 'nd';
    if (j === 3 && k !== 13) return num + 'rd';
    return num + 'th';
}

// ─────────────────────────────────────────────
// LOCAL STORAGE CACHING STRATEGY
// ─────────────────────────────────────────────
function loadCachedHubData() {
    if (!instId) return false;
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return false;
        const cache = JSON.parse(raw);

        if (cache.eventConfig) eventConfig = cache.eventConfig;
        if (cache.instituteDetails) instituteDetails = cache.instituteDetails;
        if (cache.dashboardData) dashboardData = cache.dashboardData;
        if (cache.leaderboardData) leaderboardData = cache.leaderboardData;
        if (cache.categoryPerformanceData) categoryPerformanceData = cache.categoryPerformanceData;
        if (cache.publishedResultsList) publishedResultsList = cache.publishedResultsList;

        updateHeader();
        populateCategorySelect();
        populateProgramSelect();
        updateSummaryStats();
        renderTeamChampionship();
        renderCategoryStandings();

        return true;
    } catch (e) {
        console.warn("Cache load notice:", e);
        return false;
    }
}

function saveHubDataCache() {
    if (!instId) return;
    try {
        const cacheObj = {
            eventConfig,
            instituteDetails,
            dashboardData,
            leaderboardData,
            categoryPerformanceData,
            publishedResultsList,
            lastUpdated: Date.now()
        };
        localStorage.setItem(CACHE_KEY, JSON.stringify(cacheObj));
    } catch (e) {
        console.warn("Cache save notice:", e);
    }
}

// ─────────────────────────────────────────────
// HEADER RENDERER
// ─────────────────────────────────────────────
function updateHeader() {
    const displayEventName = eventConfig?.eventName || instituteDetails?.name || "Official Results";
    const displayMadrasaName = eventConfig?.madrasaName || instituteDetails?.name || "Madrasa";
    const displayEventTagline = eventConfig?.eventTagline || "";
    const displayEventLocation = eventConfig?.eventLocation || eventConfig?.madrasaLocation || eventConfig?.location || "";
    const displayEventLogo = eventConfig?.eventLogo || null;

    const elEventName = document.getElementById('hubEventName');
    const elTagline = document.getElementById('hubEventTagline');
    const elMadrasaName = document.getElementById('hubMadrasaName');
    const elLocation = document.getElementById('hubEventLocation');
    const logoImg = document.getElementById('hubLogoImg');
    const logoFallback = document.getElementById('hubLogoFallback');

    if (elEventName) elEventName.textContent = displayEventName;

    if (elTagline) {
        if (displayEventTagline) {
            elTagline.textContent = displayEventTagline;
            elTagline.style.display = 'block';
        } else {
            elTagline.style.display = 'none';
        }
    }

    if (elMadrasaName) elMadrasaName.textContent = displayMadrasaName;

    if (elLocation) {
        if (displayEventLocation) {
            // Display location text ONLY without location icon
            elLocation.textContent = displayEventLocation;
            elLocation.style.display = 'inline-block';
        } else {
            elLocation.style.display = 'none';
        }
    }

    if (logoImg && logoFallback) {
        if (displayEventLogo) {
            logoImg.src = displayEventLogo;
            logoImg.style.display = 'block';
            logoFallback.style.display = 'none';
        } else {
            logoImg.style.display = 'none';
            logoFallback.style.display = 'none';
        }
    }
}

// ─────────────────────────────────────────────
// SUMMARY STATS RENDERER
// ─────────────────────────────────────────────
function updateSummaryStats() {
    const totalProgCount = dashboardData?.programsCount || publishedResultsList.length || 0;
    const completedCount = dashboardData?.publishedResultsCount || publishedResultsList.length || 0;
    const pendingCount = dashboardData?.pendingProgramsCount !== undefined
        ? dashboardData.pendingProgramsCount
        : Math.max(0, totalProgCount - completedCount);
    const progressPct = dashboardData?.overallProgressPct !== undefined
        ? dashboardData.overallProgressPct
        : (totalProgCount > 0 ? Math.round((completedCount / totalProgCount) * 100) : 0);

    const elPublished = document.getElementById('statPublishedVal');
    const elPending = document.getElementById('statPendingVal');
    const elTotal = document.getElementById('statTotalVal');
    const elProgress = document.getElementById('statProgressVal');

    if (elPublished) elPublished.textContent = completedCount;
    if (elPending) elPending.textContent = pendingCount;
    if (elTotal) elTotal.textContent = totalProgCount;
    if (elProgress) elProgress.textContent = `${progressPct}%`;
}

// ─────────────────────────────────────────────
// SELECTORS & FILTERS (Category & Program Only)
// ─────────────────────────────────────────────
function populateCategorySelect() {
    const select = document.getElementById('hubCategorySelect');
    if (!select) return;

    const catSet = new Set();
    publishedResultsList.forEach(r => {
        if (r.categoryName) catSet.add(r.categoryName);
    });

    categoriesList = Array.from(catSet).sort();

    select.innerHTML = '<option value="">All Categories</option>' +
        categoriesList.map(cat => `<option value="${escapeHTML(cat)}" ${selectedCategory === cat ? 'selected' : ''}>${escapeHTML(cat)}</option>`).join('');
}

function populateProgramSelect() {
    const select = document.getElementById('hubProgramSelect');
    if (!select) return;

    let filtered = publishedResultsList;

    if (selectedCategory) {
        filtered = filtered.filter(r => r.categoryName === selectedCategory);
    }

    select.innerHTML = '<option value="">All Programs</option>' +
        filtered.map(r => {
            const progNum = r.programCode || r.programNumber ? `#${r.programCode || r.programNumber} - ` : '';
            return `<option value="${r.id}" ${selectedProgramId === r.id ? 'selected' : ''}>${progNum}${escapeHTML(r.programName || 'Program')} (${escapeHTML(r.categoryName || '')})</option>`;
        }).join('');
}

// ─────────────────────────────────────────────
// PROGRAM RESULT CARD RENDERER (Clean Sheet)
// ─────────────────────────────────────────────
function renderProgramResultCard() {
    const container = document.getElementById('hubProgramResultContent');
    const section = document.getElementById('hubProgramResultSection');
    if (!container || !section) return;

    if (!selectedProgramId) {
        section.style.display = 'none';
        return;
    }

    const result = publishedResultsList.find(r => r.id === selectedProgramId);
    if (!result) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    const progName = result.programName || 'Program Result';
    const catName = result.categoryName || 'General';
    const progCode = result.programCode || result.programNumber || '';
    const progCodeDisplay = progCode ? `${progCode}` : '';

    // Official Program Location Resolution (Source of Truth: programLocation)
    let stageDisplay = result.programLocation || result.location || result.stageType || result.venue || result.stage || '';
    if (!stageDisplay) {
        if (result.isStage === true || result.type === 'stage') {
            stageDisplay = 'Stage';
        } else if (result.isStage === false || result.type === 'off-stage' || result.type === 'off_stage' || result.type === 'offstage') {
            stageDisplay = 'Off Stage';
        } else {
            stageDisplay = 'Stage';
        }
    } else {
        const locLower = String(stageDisplay).trim().toLowerCase();
        if (locLower === 'stage') stageDisplay = 'Stage';
        else if (locLower === 'off stage' || locLower === 'offstage' || locLower === 'off_stage') stageDisplay = 'Off Stage';
    }

    const pubTime = result.publishedAt?.seconds
        ? new Date(result.publishedAt.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';

    // Position holders / Winners
    let winnersList = result.winners || result.positions || [];

    // Fallback if structured positions map exists (1st, 2nd, 3rd)
    if ((!winnersList || winnersList.length === 0) && (result.first || result['1st'] || result.second || result['2nd'] || result.third || result['3rd'])) {
        winnersList = [];
        if (result.first || result['1st']) winnersList.push({ position: 1, ...(result.first || result['1st']) });
        if (result.second || result['2nd']) winnersList.push({ position: 2, ...(result.second || result['2nd']) });
        if (result.third || result['3rd']) winnersList.push({ position: 3, ...(result.third || result['3rd']) });
    }

    // Sort by position numeric
    winnersList.sort((a, b) => (parseInt(a.position || a.rank || 99, 10) - parseInt(b.position || b.rank || 99, 10)));

    let winnersHTML = '';

    if (winnersList.length === 0) {
        winnersHTML = `
            <div class="empty-state-box">
                <div>Results published. Winner details unavailable.</div>
            </div>
        `;
    } else {
        winnersHTML = winnersList.map((w, idx) => {
            const rawPos = w.position !== undefined ? w.position : (w.rank !== undefined ? w.rank : (idx + 1));
            const posNum = parseInt(rawPos, 10) || (idx + 1);
            const ordText = formatOrdinal(posNum);

            let rankBadgeClass = 'rank-other';
            if (posNum === 1) rankBadgeClass = 'rank-1st';
            else if (posNum === 2) rankBadgeClass = 'rank-2nd';
            else if (posNum === 3) rankBadgeClass = 'rank-3rd';

            const studentName = w.studentName || w.name || w.participantName || 'Participant';
            // Strip "Team " prefix to display ONLY the team name (e.g. FALAH, SWALAH)
            const rawTeam = w.teamName || w.team || '';
            const cleanTeamName = rawTeam.replace(/^Team\s+/i, '').trim();

            const gradeText = w.grade || w.marks || w.totalMarks ? `${w.grade || w.marks || w.totalMarks}` : '';

            return `
                <div class="winner-sheet-row">
                    <div class="winner-rank-label ${rankBadgeClass}">${ordText}</div>
                    <div class="winner-info-wrap">
                        <div class="winner-student-name">${escapeHTML(studentName)}</div>
                        ${cleanTeamName ? `<div class="winner-team-name">${escapeHTML(cleanTeamName)}</div>` : ''}
                    </div>
                    ${gradeText ? `<div class="winner-grade-badge">${escapeHTML(gradeText)}</div>` : ''}
                </div>
            `;
        }).join('');
    }

    container.innerHTML = `
        <div class="result-meta-top">
            <div class="result-meta-left">
                ${progCodeDisplay ? `<span class="prog-number-pill">${escapeHTML(progCodeDisplay)}</span>` : ''}
                <span class="prog-cat-subtext">${escapeHTML(catName)} • ${escapeHTML(stageDisplay)}</span>
            </div>
            <div style="text-align: right;">
                <span class="status-published-pill">PUBLISHED</span>
                ${pubTime ? `<div style="font-size: 0.7rem; color: #9CA3AF; margin-top: 0.15rem;">${pubTime}</div>` : ''}
            </div>
        </div>

        <h2 class="result-prog-title">${escapeHTML(progName)}</h2>

        <div class="winners-sheet-list">
            ${winnersHTML}
        </div>
    `;
}

// ─────────────────────────────────────────────
// TEAM CHAMPIONSHIP RENDERER
// ─────────────────────────────────────────────
function renderTeamChampionship() {
    const tbody = document.getElementById('hubTeamChampionshipBody');
    if (!tbody) return;

    if (!leaderboardData || leaderboardData.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="empty-state-box">No overall team standings calculated yet.</td>
            </tr>
        `;
        return;
    }

    const maxPoints = Math.max(...leaderboardData.map(t => t.points || 0), 1);

    tbody.innerHTML = leaderboardData.map((t, idx) => {
        const rank = idx + 1;
        let rClass = '';
        if (rank === 1) rClass = 'r1';
        else if (rank === 2) rClass = 'r2';
        else if (rank === 3) rClass = 'r3';

        const points = t.points || 0;
        const pct = Math.min(Math.round((points / maxPoints) * 100), 100);

        return `
            <tr>
                <td class="rank-num-cell ${rClass}">${rank}</td>
                <td class="team-name-cell">${escapeHTML(t.name)}</td>
                <td class="points-cell">${points}</td>
                <td>
                    <div class="progress-bar-wrap">
                        <div class="track-bar">
                            <div class="fill-bar" style="width: ${pct}%;"></div>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// ─────────────────────────────────────────────
// CATEGORY STANDINGS RENDERER (Accordion Cards)
// ─────────────────────────────────────────────
function renderCategoryStandings() {
    const container = document.getElementById('hubCategoryAccordionContent');
    if (!container) return;

    if (!categoryPerformanceData || categoryPerformanceData.length === 0) {
        container.innerHTML = `
            <div class="empty-state-box">
                <div>No category standings available yet.</div>
            </div>
        `;
        return;
    }

    container.innerHTML = categoryPerformanceData.map((cat, catIdx) => {
        const catName = cat.categoryName || 'Category';
        const teams = cat.teams || [];
        if (teams.length === 0) return '';

        const catMaxPts = Math.max(...teams.map(t => t.points || 0), 1);

        const teamsRows = teams.map((t, idx) => {
            const rank = idx + 1;
            let rClass = '';
            if (rank === 1) rClass = 'r1';
            else if (rank === 2) rClass = 'r2';
            else if (rank === 3) rClass = 'r3';

            const pts = t.points || 0;
            const pct = Math.min(Math.round((pts / catMaxPts) * 100), 100);

            return `
                <tr>
                    <td class="rank-num-cell ${rClass}">${rank}</td>
                    <td class="team-name-cell">${escapeHTML(t.name)}</td>
                    <td class="points-cell">${pts}</td>
                    <td>
                        <div class="progress-bar-wrap">
                            <div class="track-bar">
                                <div class="fill-bar" style="width: ${pct}%;"></div>
                            </div>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        return `
            <div class="cat-accordion-card ${catIdx === 0 ? 'open' : ''}" data-cat-id="cat-${catIdx}">
                <div class="cat-accordion-header">
                    <div class="cat-title-left">
                        <div class="cat-accent-bar"></div>
                        <span class="cat-name-text">${escapeHTML(catName)}</span>
                    </div>
                    <div class="cat-right-wrap">
                        <span class="cat-teams-count">${teams.length} Teams</span>
                        <svg class="cat-chevron" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
                    </div>
                </div>
                <div class="cat-accordion-body">
                    <table class="championship-table">
                        <thead>
                            <tr>
                                <th>RANK</th>
                                <th>TEAM</th>
                                <th>POINTS</th>
                                <th>PROGRESS</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${teamsRows}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }).join('');

    // Bind Accordion Toggle Clicks
    const cards = container.querySelectorAll('.cat-accordion-card');
    cards.forEach(card => {
        const header = card.querySelector('.cat-accordion-header');
        if (header) {
            header.addEventListener('click', () => {
                card.classList.toggle('open');
            });
        }
    });
}

// ─────────────────────────────────────────────
// BOTTOM NAVIGATION HANDLER
// ─────────────────────────────────────────────
function initBottomNav() {
    const btnHome = document.getElementById('navHome');
    const btnPrograms = document.getElementById('navPrograms');
    const btnResults = document.getElementById('navResults');
    const btnTeams = document.getElementById('navTeams');
    const btnAbout = document.getElementById('navAbout');

    const navItems = [btnHome, btnPrograms, btnResults, btnTeams, btnAbout];

    function setActive(activeBtn) {
        navItems.forEach(item => { if (item) item.classList.remove('active'); });
        if (activeBtn) activeBtn.classList.add('active');
    }

    if (btnHome) {
        btnHome.addEventListener('click', () => {
            setActive(btnHome);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }
    if (btnPrograms) {
        btnPrograms.addEventListener('click', () => {
            setActive(btnPrograms);
            document.getElementById('secSearch')?.scrollIntoView({ behavior: 'smooth' });
        });
    }
    if (btnResults) {
        btnResults.addEventListener('click', () => {
            setActive(btnResults);
            const resSec = document.getElementById('hubProgramResultSection');
            if (resSec && resSec.style.display !== 'none') {
                resSec.scrollIntoView({ behavior: 'smooth' });
            } else {
                document.getElementById('secSearch')?.scrollIntoView({ behavior: 'smooth' });
            }
        });
    }
    if (btnTeams) {
        btnTeams.addEventListener('click', () => {
            setActive(btnTeams);
            document.getElementById('secTeamChampionship')?.scrollIntoView({ behavior: 'smooth' });
        });
    }
    if (btnAbout) {
        btnAbout.addEventListener('click', () => {
            setActive(btnAbout);
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        });
    }
}

// ─────────────────────────────────────────────
// INITIALIZATION & SILENT FIRESTORE LISTENERS
// ─────────────────────────────────────────────
async function initPublicResultsHub() {
    if (!instId) {
        const header = document.getElementById('hubEventName');
        if (header) header.textContent = 'No Institute ID Provided';
        return;
    }

    // Step 1: Instantly load cached data from Local Storage if available
    const hasCache = loadCachedHubData();

    // Step 2: In background, fetch/listen to Firestore to verify & update cache silently
    try {
        const instSnap = await getDoc(doc(db, "institutes", instId));
        if (instSnap.exists()) {
            instituteDetails = { id: instSnap.id, ...instSnap.data() };
            updateHeader();
            saveHubDataCache();
        }
    } catch (e) {
        console.warn("Institute profile fetch notice:", e);
    }

    // Listener A: eventConfig
    const configRef = doc(db, "institutes", instId, "metadata", "eventConfig");
    onSnapshot(configRef, snap => {
        if (snap.exists()) {
            eventConfig = snap.data();
            updateHeader();
            saveHubDataCache();
        }
    }, err => console.warn("eventConfig snapshot notice:", err));

    // Listener B: metadata/dashboard (Aggregates)
    const dashRef = doc(db, "institutes", instId, "metadata", "dashboard");
    onSnapshot(dashRef, snap => {
        if (snap.exists()) {
            const data = snap.data();
            dashboardData = data;
            leaderboardData = data.leaderboard || [];
            categoryPerformanceData = data.categoryPerformance || [];

            updateSummaryStats();
            renderTeamChampionship();
            renderCategoryStandings();
            saveHubDataCache();
        }
    }, err => console.warn("Dashboard metadata snapshot notice:", err));

    // Real-time Published Results listener for dropdown options, result sheets & cache synchronization
    try {
        const resultsRef = collection(db, "institutes", instId, "results");
        const pubQuery = query(resultsRef, where("status", "==", "published"));

        onSnapshot(pubQuery, (querySnap) => {
            publishedResultsList = querySnap.docs.map(d => ({ id: d.id, ...d.data() }))
                .filter(r => r.publicDisabled !== true);

            publishedResultsList.sort((a, b) => {
                const tA = a.publishedAt?.seconds || 0;
                const tB = b.publishedAt?.seconds || 0;
                return tB - tA;
            });

            populateCategorySelect();
            populateProgramSelect();
            updateSummaryStats();
            if (selectedProgramId) renderProgramResultCard();

            saveHubDataCache();
        }, (err) => console.warn("Published results snapshot notice:", err));
    } catch (e) {
        console.error("Error loading published results:", e);
    }

    // Bind Category & Program Selectors
    const catSelect = document.getElementById('hubCategorySelect');
    const progSelect = document.getElementById('hubProgramSelect');

    if (catSelect) {
        catSelect.addEventListener('change', (e) => {
            selectedCategory = e.target.value;
            populateProgramSelect();
        });
    }

    if (progSelect) {
        progSelect.addEventListener('change', (e) => {
            selectedProgramId = e.target.value;
            renderProgramResultCard();
        });
    }

    initBottomNav();
}

// Launch on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    initPublicResultsHub();
});
