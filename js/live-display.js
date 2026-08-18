import { db } from './firebase.js';
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// ─────────────────────────────────────────────
// STATE & CONFIGURATION
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

let dashboardData = null;
let eventConfig = null;

let leaderboardData = [];
let categoryPerformanceData = [];
let latestPublishedResults = [];
let previousTeamPoints = {};
let teamColorMap = {};

let slidesList = [];
let currentSlideIndex = 0;
let rotatorTimer = null;

const ROTATION_DURATION = 8000; // Exactly 8 seconds per screen

// Master palette for team colors
const TEAM_COLORS_PALETTE = [
    'linear-gradient(90deg, #F59E0B, #D97706)', // Gold/Amber
    'linear-gradient(90deg, #3B82F6, #1D4ED8)', // Blue
    'linear-gradient(90deg, #10B981, #047857)', // Emerald
    'linear-gradient(90deg, #8B5CF6, #6D28D9)', // Purple
    'linear-gradient(90deg, #EC4899, #BE185D)', // Pink
    'linear-gradient(90deg, #06B6D4, #0891B2)', // Cyan
    'linear-gradient(90deg, #6366F1, #4F46E5)', // Indigo
    'linear-gradient(90deg, #F43F5E, #E11D48)', // Rose
    'linear-gradient(90deg, #14B8A6, #0F766E)', // Teal
    'linear-gradient(90deg, #84CC16, #65A30D)'  // Lime
];

// ─────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────
function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatTimeAMPM(timestamp) {
    const date = timestamp ? new Date(timestamp) : new Date();
    let hours = date.getHours();
    let minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const strHours = hours < 10 ? '0' + hours : hours;
    const strMinutes = minutes < 10 ? '0' + minutes : minutes;
    return `${strHours}:${strMinutes} ${ampm}`;
}

function formatTimeAgo(timestamp) {
    if (!timestamp) return 'Just now';
    const diffMs = Date.now() - timestamp;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return formatTimeAMPM(timestamp);
}

function assignTeamColors() {
    const teamNames = new Set();
    leaderboardData.forEach(t => { if (t.name) teamNames.add(t.name); });
    categoryPerformanceData.forEach(cat => {
        if (Array.isArray(cat.teams)) {
            cat.teams.forEach(t => { if (t.name) teamNames.add(t.name); });
        }
    });

    const sortedNames = Array.from(teamNames).sort();
    sortedNames.forEach((name, idx) => {
        if (!teamColorMap[name]) {
            teamColorMap[name] = TEAM_COLORS_PALETTE[idx % TEAM_COLORS_PALETTE.length];
        }
    });
}

function animateValue(element, start, end, duration = 500, suffix = "") {
    if (!element) return;
    if (isNaN(start)) start = 0;
    if (isNaN(end)) end = 0;
    if (start === end) {
        element.textContent = `${end}${suffix}`;
        return;
    }

    const startTime = performance.now();
    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easeProgress = progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;

        const currentVal = Math.round(start + (end - start) * easeProgress);
        element.textContent = `${currentVal}${suffix}`;

        if (progress < 1) {
            requestAnimationFrame(update);
        } else {
            element.textContent = `${end}${suffix}`;
        }
    }
    requestAnimationFrame(update);
}

// ─────────────────────────────────────────────
// HEADER METRICS & EVENT DETAILS UPDATE
// ─────────────────────────────────────────────
function updateHeader() {
    // 1. Meelad Name & Logo
    const meeladTitle = eventConfig?.eventName || eventConfig?.madrasaName || "MEELAD CHAMPIONSHIP";
    const meeladElem = document.getElementById('liveMeeladName');
    if (meeladElem) meeladElem.textContent = meeladTitle.toUpperCase();

    const logoImg = document.getElementById('headerLogoImg');
    const logoFallback = document.getElementById('headerLogoFallback');
    const displayLogo = eventConfig?.eventLogo || null;

    if (logoImg && logoFallback) {
        if (displayLogo) {
            logoImg.src = displayLogo;
            logoImg.style.display = 'block';
            logoFallback.style.display = 'none';
        } else {
            logoImg.style.display = 'none';
            logoFallback.style.display = 'block';
        }
    }

    // 2. Metrics calculation from precalculated dashboard document
    const totalProgCount = dashboardData?.programsCount || 0;
    const completedCount = dashboardData?.publicPublishedResultsCount || 0;
    const pendingCount = dashboardData?.publicPendingProgramsCount !== undefined
        ? dashboardData.publicPendingProgramsCount
        : Math.max(0, totalProgCount - completedCount);
    const progressPct = dashboardData?.publicOverallProgressPct !== undefined
        ? dashboardData.publicOverallProgressPct
        : (totalProgCount > 0 ? Math.round((completedCount / totalProgCount) * 100) : 0);

    const statCompleted = document.getElementById('statCompletedProg');
    const statProgress = document.getElementById('statProgressPct');
    const statPending = document.getElementById('statPendingProg');
    const statLastUpdated = document.getElementById('statLastUpdated');

    if (statCompleted) {
        statCompleted.textContent = `${completedCount} / ${totalProgCount}`;
    }
    if (statProgress) {
        const oldPct = parseInt((statProgress.textContent || '0').replace('%', ''), 10) || 0;
        animateValue(statProgress, oldPct, progressPct, 500, '%');
    }
    if (statPending) {
        const oldPending = parseInt(statPending.textContent || '0', 10) || 0;
        animateValue(statPending, oldPending, pendingCount, 500, '');
    }
    if (statLastUpdated) {
        const lastUpdatedDate = dashboardData?.lastUpdated?.seconds
            ? new Date(dashboardData.lastUpdated.seconds * 1000)
            : new Date();
        statLastUpdated.textContent = formatTimeAMPM(lastUpdatedDate);
    }
}

// ─────────────────────────────────────────────
// RENDERERS FOR SCREENS
// ─────────────────────────────────────────────

// 1. Render Team Championship Screen
function renderTeamChampionship() {
    const grid = document.getElementById('teamChampionshipGrid');
    if (!grid) return;

    assignTeamColors();

    if (!leaderboardData || leaderboardData.length === 0) {
        grid.innerHTML = `
            <div style="text-align: center; padding: 5rem; color: #94A3B8; font-size: 1.4rem;">
                No team standings available yet.
            </div>
        `;
        return;
    }

    const maxPoints = Math.max(...leaderboardData.map(t => t.points || 0), 1);

    grid.innerHTML = leaderboardData.map((t, idx) => {
        const rank = idx + 1;
        let rankClass = 'rank-default';
        let badgeClass = 'badge-default';
        let rankBadgeContent = `#${rank}`;

        if (rank === 1) {
            rankClass = 'rank-1';
            badgeClass = 'badge-gold';
            rankBadgeContent = '🥇';
        } else if (rank === 2) {
            rankClass = 'rank-2';
            badgeClass = 'badge-silver';
            rankBadgeContent = '🥈';
        } else if (rank === 3) {
            rankClass = 'rank-3';
            badgeClass = 'badge-bronze';
            rankBadgeContent = '🥉';
        }

        const points = t.points || 0;
        const pct = Math.min(Math.round((points / maxPoints) * 100), 100);
        const colorGradient = teamColorMap[t.name] || 'linear-gradient(90deg, #F59E0B, #D97706)';
        const pointId = `team-pts-${t.name.replace(/\s+/g, '_')}`;

        return `
            <div class="team-card-row ${rankClass}">
                <div class="team-card-left">
                    <div class="team-rank-badge ${badgeClass}">${rankBadgeContent}</div>
                    <span class="team-name-text">${escapeHTML(t.name)}</span>
                </div>
                <div class="team-card-center">
                    <div class="team-bar-track">
                        <div class="team-bar-fill" style="width: ${pct}%; background: ${colorGradient};"></div>
                    </div>
                </div>
                <div class="team-card-right">
                    <span class="team-points-num" id="${pointId}">${points}</span>
                    <span class="team-points-unit">Points</span>
                </div>
            </div>
        `;
    }).join('');

    // Trigger point counting animations
    leaderboardData.forEach(t => {
        const prev = previousTeamPoints[t.name] || 0;
        const pointId = `team-pts-${t.name.replace(/\s+/g, '_')}`;
        const el = document.getElementById(pointId);
        if (el) {
            animateValue(el, prev, t.points || 0, 500, '');
        }
        previousTeamPoints[t.name] = t.points || 0;
    });
}

// 2. Render Category Leaders Screen
function renderCategoryLeaders(catName) {
    const container = document.getElementById('categoryLeadersContainer');
    if (!container) return;

    const catData = categoryPerformanceData.find(c => c.categoryName === catName);
    if (!catData || !catData.teams || catData.teams.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 5rem; color: #94A3B8; font-size: 1.4rem;">
                No published results for ${escapeHTML(catName)} yet.
            </div>
        `;
        return;
    }

    const sortedTeams = catData.teams;
    const firstPlace = sortedTeams[0] || null;
    const secondPlace = sortedTeams[1] || null;
    const thirdPlace = sortedTeams[2] || null;

    let html = '';

    if (firstPlace) {
        const firstColor = teamColorMap[firstPlace.name] || 'linear-gradient(90deg, #F59E0B, #D97706)';
        html += `
            <div class="cat-leader-hero-card">
                <div class="cat-hero-badge">🥇</div>
                <div class="cat-hero-info">
                    <div class="cat-hero-rank-label">1st Place Category Leader</div>
                    <div class="cat-hero-team-name">${escapeHTML(firstPlace.name)}</div>
                    <div class="cat-hero-bar-wrap">
                        <div class="team-bar-track">
                            <div class="team-bar-fill" style="width: ${firstPlace.pct}%; background: ${firstColor};"></div>
                        </div>
                    </div>
                </div>
                <div class="cat-hero-points-wrap">
                    <div class="cat-hero-points-num">${firstPlace.points}</div>
                    <div class="cat-hero-points-unit">Points</div>
                </div>
            </div>
        `;
    }

    if (secondPlace || thirdPlace) {
        html += `<div class="cat-runners-grid">`;

        if (secondPlace) {
            html += `
                <div class="cat-runner-card">
                    <div class="cat-runner-left">
                        <div class="cat-runner-badge">🥈</div>
                        <div class="cat-runner-title-group">
                            <span class="cat-runner-rank-label">Second Place</span>
                            <span class="cat-runner-team-name">${escapeHTML(secondPlace.name)}</span>
                        </div>
                    </div>
                    <div class="cat-runner-points">${secondPlace.points} <span style="font-size:1rem; color:#94A3B8;">pts</span></div>
                </div>
            `;
        }

        if (thirdPlace) {
            html += `
                <div class="cat-runner-card">
                    <div class="cat-runner-left">
                        <div class="cat-runner-badge">🥉</div>
                        <div class="cat-runner-title-group">
                            <span class="cat-runner-rank-label">Third Place</span>
                            <span class="cat-runner-team-name">${escapeHTML(thirdPlace.name)}</span>
                        </div>
                    </div>
                    <div class="cat-runner-points">${thirdPlace.points} <span style="font-size:1rem; color:#94A3B8;">pts</span></div>
                </div>
            `;
        }

        html += `</div>`;
    }

    container.innerHTML = html;
}

// 3. Render Category Comparison Screen
function renderCategoryComparison(catName) {
    const container = document.getElementById('categoryComparisonContainer');
    if (!container) return;

    const catData = categoryPerformanceData.find(c => c.categoryName === catName);
    if (!catData || !catData.teams || catData.teams.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 5rem; color: #94A3B8; font-size: 1.4rem;">
                No comparison data for ${escapeHTML(catName)}.
            </div>
        `;
        return;
    }

    container.innerHTML = catData.teams.map((t) => {
        let rankBadge = `#${t.rank}`;
        if (t.rank === 1) rankBadge = '🥇';
        else if (t.rank === 2) rankBadge = '🥈';
        else if (t.rank === 3) rankBadge = '🥉';

        const colorGradient = teamColorMap[t.name] || 'linear-gradient(90deg, #3B82F6, #1D4ED8)';

        return `
            <div class="cat-comp-card">
                <div class="cat-comp-team-info">
                    <div class="cat-comp-rank-badge">${rankBadge}</div>
                    <span class="cat-comp-team-name">${escapeHTML(t.name)}</span>
                </div>
                <div class="cat-comp-bar-container">
                    <div class="cat-comp-bar-track">
                        <div class="cat-comp-bar-fill" style="width: ${t.pct}%; background: ${colorGradient};"></div>
                    </div>
                </div>
                <div class="cat-comp-points-num">${t.points} <span style="font-size:1.1rem; color:#94A3B8;">pts</span></div>
            </div>
        `;
    }).join('');
}

// 4. Render Broadcast Results Ribbon (Infinite Marquee)
function renderLatestPublishedResultsGrid() {
    const track = document.getElementById('ribbonTrack');
    if (!track) return;

    if (!latestPublishedResults || latestPublishedResults.length === 0) {
        track.innerHTML = `
            <div class="latest-result-empty">
                Waiting for published competition results...
            </div>
        `;
        return;
    }

    // Take recent published results for ribbon
    const items = latestPublishedResults.slice(0, 8);

    const renderCard = (item) => {
        const progCode = item.programCode ? `Prog ${item.programCode}` : 'Result';
        const progName = item.programName || 'Competition';
        const catName = item.categoryName || '';
        const winnerName = item.winnerName || 'Winner';
        const winningTeam = item.winningTeam || 'Team';
        const timeAgoText = formatTimeAgo(item.publishedAt);

        return `
            <div class="ribbon-card">
                <div class="ribbon-card-top">
                    <span class="ribbon-prog-num">${escapeHTML(progCode)}</span>
                    ${catName ? `<span class="ribbon-cat-badge">${escapeHTML(catName)}</span>` : ''}
                    <span class="ribbon-time-ago">${escapeHTML(timeAgoText)}</span>
                </div>
                <div class="ribbon-prog-name" title="${escapeHTML(progName)}">${escapeHTML(progName)}</div>
                <div class="ribbon-winner-row">
                    <div class="ribbon-winner-left">
                        <span class="ribbon-medal">🥇</span>
                        <span class="ribbon-winner-name">${escapeHTML(winnerName)}</span>
                    </div>
                    ${winningTeam ? `<span class="ribbon-team-badge">${escapeHTML(winningTeam)}</span>` : ''}
                </div>
            </div>
        `;
    };

    const cardsHTML = items.map(renderCard).join('');

    // Duplicate content (Set 1 + Set 2) to guarantee a 100% infinite seamless loop
    track.innerHTML = cardsHTML + cardsHTML;
}

// ─────────────────────────────────────────────
// SLIDE ROTATION ENGINE
// ─────────────────────────────────────────────
function buildSlidesSequence() {
    slidesList = [];

    // Slide 1: Team Championship
    slidesList.push({
        type: 'championship',
        title: 'Team Championship',
        icon: '🏆',
        categoryName: null
    });

    if (categoryPerformanceData.length > 0) {
        // Category Leaders per category
        categoryPerformanceData.forEach(cat => {
            slidesList.push({
                type: 'catLeaders',
                title: 'Category Leaders',
                icon: '👑',
                categoryName: cat.categoryName
            });
        });

        // Category Comparison per category
        categoryPerformanceData.forEach(cat => {
            slidesList.push({
                type: 'catComparison',
                title: 'Category Comparison',
                icon: '📊',
                categoryName: cat.categoryName
            });
        });
    }

    if (currentSlideIndex >= slidesList.length) {
        currentSlideIndex = 0;
    }
}

function displayCurrentSlide() {
    if (slidesList.length === 0) buildSlidesSequence();
    const slide = slidesList[currentSlideIndex];
    if (!slide) return;

    const screenTeam = document.getElementById('screenTeamChampionship');
    const screenLeaders = document.getElementById('screenCategoryLeaders');
    const screenComp = document.getElementById('screenCategoryComparison');

    const viewIcon = document.getElementById('viewIcon');
    const viewTitle = document.getElementById('viewTitle');
    const viewCatBadge = document.getElementById('viewCategoryBadge');

    if (viewIcon) viewIcon.textContent = slide.icon;
    if (viewTitle) viewTitle.textContent = slide.title;

    if (slide.categoryName && viewCatBadge) {
        viewCatBadge.textContent = slide.categoryName;
        viewCatBadge.style.display = 'inline-block';
    } else if (viewCatBadge) {
        viewCatBadge.style.display = 'none';
    }

    // Hide all screen views first
    [screenTeam, screenLeaders, screenComp].forEach(s => {
        if (s) s.classList.remove('active');
    });

    if (slide.type === 'championship') {
        renderTeamChampionship();
        if (screenTeam) screenTeam.classList.add('active');
    } else if (slide.type === 'catLeaders') {
        renderCategoryLeaders(slide.categoryName);
        if (screenLeaders) screenLeaders.classList.add('active');
    } else if (slide.type === 'catComparison') {
        renderCategoryComparison(slide.categoryName);
        if (screenComp) screenComp.classList.add('active');
    }

    resetProgressAnimation();
}

function resetProgressAnimation() {
    const fill = document.getElementById('rotatorProgressFill');
    if (!fill) return;

    fill.style.transition = 'none';
    fill.style.width = '0%';

    // Force reflow
    void fill.offsetWidth;

    fill.style.transition = `width ${ROTATION_DURATION}ms linear`;
    fill.style.width = '100%';
}

function startAutoRotationEngine() {
    if (rotatorTimer) clearInterval(rotatorTimer);

    displayCurrentSlide();

    rotatorTimer = setInterval(() => {
        currentSlideIndex = (currentSlideIndex + 1) % slidesList.length;
        displayCurrentSlide();
    }, ROTATION_DURATION);
}

// ─────────────────────────────────────────────
// OPTIMIZED REALTIME LISTENERS (MAX 1-2 LISTENERS)
// ─────────────────────────────────────────────
async function initLiveDisplayEngine() {
    if (!instId) {
        const grid = document.getElementById('teamChampionshipGrid');
        if (grid) {
            grid.innerHTML = `
                <div style="text-align: center; padding: 4rem 2rem; color: #CBD5E1;">
                    <div style="font-size: 3rem; margin-bottom: 1rem;">🏆</div>
                    <h2 style="font-size: 1.5rem; font-weight: 800; color: #F59E0B; margin-bottom: 0.5rem;">No Championship Selected</h2>
                    <p style="font-size: 1rem; color: #94A3B8;">Please open Live Display from the Admin Dashboard.</p>
                </div>
            `;
        }
        return;
    }

    // LISTENER 1: Event Config Metadata (Logo, Title)
    const configRef = doc(db, "institutes", instId, "metadata", "eventConfig");
    onSnapshot(configRef, (snap) => {
        if (snap.exists()) {
            eventConfig = snap.data();
        } else {
            eventConfig = null;
        }
        updateHeader();
    }, err => console.warn("Event config snapshot error:", err));

    // LISTENER 2 (PRIMARY): Precalculated Dashboard Aggregates Document
    const dashMetaRef = doc(db, "institutes", instId, "metadata", "dashboard");
    onSnapshot(dashMetaRef, (snap) => {
        if (snap.exists()) {
            const data = snap.data();
            dashboardData = data;
            leaderboardData = data.publicLeaderboard || [];
            categoryPerformanceData = data.publicCategoryPerformance || [];
            latestPublishedResults = data.publicLatestPublishedResults || [];
        } else {
            dashboardData = null;
            leaderboardData = [];
            categoryPerformanceData = [];
            latestPublishedResults = [];
        }

        assignTeamColors();
        buildSlidesSequence();
        updateHeader();
        renderLatestPublishedResultsGrid();

        // Update active slide view selectively
        const slide = slidesList[currentSlideIndex];
        if (slide) {
            if (slide.type === 'championship') renderTeamChampionship();
            else if (slide.type === 'catLeaders') renderCategoryLeaders(slide.categoryName);
            else if (slide.type === 'catComparison') renderCategoryComparison(slide.categoryName);
        }
    }, err => console.warn("Dashboard metadata snapshot error:", err));

    // Start 8-second Auto-Rotation loop
    buildSlidesSequence();
    startAutoRotationEngine();
}

// ─────────────────────────────────────────────
// FULLSCREEN PRESENTATION MODE ENGINE
// ─────────────────────────────────────────────
function requestFullscreenMode() {
    const el = document.documentElement;
    if (el.requestFullscreen) {
        return el.requestFullscreen();
    } else if (el.webkitRequestFullscreen) {
        return el.webkitRequestFullscreen();
    } else if (el.mozRequestFullScreen) {
        return el.mozRequestFullScreen();
    } else if (el.msRequestFullscreen) {
        return el.msRequestFullscreen();
    }
    return Promise.reject(new Error("Fullscreen API unsupported"));
}

function isFullscreenActive() {
    return !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
    );
}

function updateFullscreenOverlayState() {
    const overlay = document.getElementById('fullscreenOverlay');
    if (!overlay) return;

    if (isFullscreenActive()) {
        overlay.classList.remove('show');
        setTimeout(() => {
            if (isFullscreenActive()) overlay.style.display = 'none';
        }, 300);
    } else {
        overlay.style.display = 'flex';
        // Force reflow for opacity animation
        void overlay.offsetWidth;
        overlay.classList.add('show');
    }
}

function initFullscreenHandler() {
    const overlay = document.getElementById('fullscreenOverlay');

    // Handle user tap/click on overlay to launch fullscreen
    if (overlay) {
        overlay.addEventListener('click', () => {
            requestFullscreenMode().then(() => {
                updateFullscreenOverlayState();
            }).catch(() => {
                updateFullscreenOverlayState();
            });
        });
    }

    // Listen for browser fullscreen change events (ESC key, swipe exit, Android Chrome UI)
    const fsEvents = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];
    fsEvents.forEach(evtName => {
        document.addEventListener(evtName, () => {
            updateFullscreenOverlayState();
        });
    });

    // Check current fullscreen state cleanly on load without triggering an unprompted rejection
    updateFullscreenOverlayState();
}

// ─────────────────────────────────────────────
// STANDALONE PWA ENGINE (SERVICE WORKER, INSTALL, WAKE LOCK)
// ─────────────────────────────────────────────
let deferredInstallPrompt = null;
let wakeLockObj = null;

function registerLiveServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('../sw-live.js', { scope: '../' })
            .then(reg => console.log('[PWA SW] Registered sw-live.js with scope:', reg.scope))
            .catch(err => console.warn('[PWA SW] Registration failed:', err));
    }
}

function initPwaInstallHandler() {
    const btnInstall = document.getElementById('btnInstallPwa');
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

    if (isStandalone) {
        if (btnInstall) btnInstall.style.display = 'none';
        return;
    }

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        if (btnInstall) btnInstall.style.display = 'inline-flex';
    });

    if (btnInstall) {
        btnInstall.addEventListener('click', () => {
            if (deferredInstallPrompt) {
                deferredInstallPrompt.prompt();
                deferredInstallPrompt.userChoice.then((choiceResult) => {
                    if (choiceResult.outcome === 'accepted') {
                        console.log('[PWA] User accepted Live Display app install');
                    }
                    deferredInstallPrompt = null;
                    btnInstall.style.display = 'none';
                });
            }
        });
    }

    window.addEventListener('appinstalled', () => {
        console.log('[PWA] Live Championship Display App installed');
        if (btnInstall) btnInstall.style.display = 'none';
    });
}

async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            wakeLockObj = await navigator.wakeLock.request('screen');
            console.log('[PWA Wake Lock] Active - Screen sleep prevented');
        } catch (err) {
            console.warn('[PWA Wake Lock] Could not acquire:', err);
        }
    }
}

function initPwaFeatures() {
    // 1. Register Service Worker
    registerLiveServiceWorker();

    // 2. Setup Install Handler
    initPwaInstallHandler();

    // 3. Prevent Screen Sleeping via Wake Lock
    requestWakeLock();

    // Re-acquire Wake Lock when window gains focus/visibility
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            requestWakeLock();
        }
    });

    // 4. Lock Landscape Orientation if supported on touch/mobile devices
    if (screen.orientation && typeof screen.orientation.lock === 'function') {
        screen.orientation.lock('landscape').catch(() => {
            // Silently ignore desktop unsupported orientation lock
        });
    }
}

// ─────────────────────────────────────────────
// INITIALIZATION
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initLiveDisplayEngine();
    initFullscreenHandler();
    initPwaFeatures();
});
