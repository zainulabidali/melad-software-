import { db, computeDenseRanking } from './firebase.js';
import {
    collection, doc, getDoc, onSnapshot, query, where
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// ─────────────────────────────────────────────
// State & Helpers
// ─────────────────────────────────────────────
let allResults = [];
let instId = new URLSearchParams(window.location.search).get('id') || new URLSearchParams(window.location.search).get('instId');
let instituteDetails = null;
let eventConfig = null;
let currentDisplayedResult = null;
let cachedLogoImg = null;
let cachedLogoSrc = null;

function getEffectiveEventName() {
    return eventConfig?.eventName || instituteDetails?.name || "Results Portal";
}

// Tracks the selected background style (1, 2, 3, or 4) per card result ID
const cardBgMap = {};

// Tracks the selected template style (1, 2, 3, or 4) per card result ID
const cardTemplateMap = {};

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

// ─────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────
async function init() {
    if (!instId) {
        renderError("Invalid Link", "The results link is missing a valid institute identifier.");
        return;
    }

    try {
        // 1. Fetch Madrasa/Institute Profile Details
        const instSnap = await getDoc(doc(db, "institutes", instId));
        if (!instSnap.exists()) {
            renderError("Madrasa Not Found", "The requested Madrasa results portal does not exist.");
            return;
        }

        instituteDetails = { id: instSnap.id, ...instSnap.data() };

        // Timezone-safe UTC absolute timestamp comparison (Option B)
        const expiryDateObj = instituteDetails.expiryDate?.toDate?.() || (instituteDetails.expiryDate ? new Date(instituteDetails.expiryDate) : null);
        const isExpired = expiryDateObj && (new Date().getTime() > expiryDateObj.getTime());

        if (isExpired || instituteDetails.status === 'deactivated' || instituteDetails.status === 'inactive') {
            renderError("Subscription Expired", "This results portal has been suspended because the institute's subscription has expired or is deactivated.");
            hideOverlay();
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

            const displayEventName = getEffectiveEventName();
            const headerEl = document.getElementById('madrasaName');
            if (headerEl) {
                headerEl.textContent = displayEventName;
            }
            if (currentDisplayedResult) {
                renderSingleResult(currentDisplayedResult);
            }
        }, (e) => {
            console.warn("Public results custom event settings bypassed: read restricted, falling back to name.", e);
        });

        // 2. Setup Real-time Firestore Listeners on Results (Strictly Published results only)
        const resultsRef = collection(db, "institutes", instId, "results");
        const publishedQuery = query(
            resultsRef,
            where("status", "==", "published")
        );

        onSnapshot(publishedQuery, (snapshot) => {
            const published = snapshot.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(r => r.publicDisabled !== true);

            // Sort by published timestamp descending for base listing
            allResults = published.sort((a, b) => {
                const timeA = a.publishedAt?.seconds || 0;
                const timeB = b.publishedAt?.seconds || 0;
                return timeB - timeA;
            });

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
            hideOverlay();
        }, (err) => {
            console.error("Standings snapshot error:", err);
            renderError("Access Denied", "Unable to establish database connection.");
            hideOverlay();
        });

    } catch (err) {
        console.error(err);
        renderError("Connection Failed", "Failed to connect to Madrasa records database.");
        hideOverlay();
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
let selectedProgram = "";

function setupFilters() {
    const catContainer = document.getElementById('catFilterContainer');
    const catTrigger = document.getElementById('catSelectTrigger');
    const catText = document.getElementById('catSelectedVal');
    const catPanel = document.getElementById('catSelectPanel');

    const progContainer = document.getElementById('progFilterContainer');
    const progTrigger = document.getElementById('progSelectTrigger');
    const progText = document.getElementById('progSelectedVal');
    const progPanel = document.getElementById('progSelectPanel');

    // Reset options
    selectedCategory = "";
    selectedProgram = "";
    catText.textContent = "Select Category";
    catText.classList.add('placeholder');
    progText.textContent = "Select Program";
    progText.classList.add('placeholder');
    progContainer.classList.add('disabled');

    // Helper to toggle panel open/close
    const togglePanel = (container) => {
        const isOpen = container.classList.contains('open');
        // Close all other panels first
        document.querySelectorAll('.glass-select-container').forEach(c => c.classList.remove('open'));
        if (!isOpen) {
            container.classList.add('open');
        }
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

    progTrigger.onclick = (e) => {
        e.stopPropagation();
        if (progContainer.classList.contains('disabled')) return;
        togglePanel(progContainer);
    };

    // Load categories dynamically
    const categories = [...new Set(allResults.map(r => r.categoryName))].sort();

    const populateCategories = () => {
        catPanel.innerHTML = '';
        categories.forEach(c => {
            const isSelected = c === selectedCategory;
            const item = document.createElement('div');
            item.className = `glass-select-item ${isSelected ? 'selected' : ''}`;

            let checkHTML = '';
            if (isSelected) {
                checkHTML = `<span class="glass-select-check">✓</span>`;
            }

            item.innerHTML = `
                <span>${escapeHTML(c)}</span>
                ${checkHTML}
            `;

            item.onclick = (e) => {
                e.stopPropagation();
                selectedCategory = c;
                catText.textContent = c;
                catText.classList.remove('placeholder');
                catContainer.classList.remove('open');

                // Reset program
                selectedProgram = "";
                progText.textContent = "Select Program";
                progText.classList.add('placeholder');
                progContainer.classList.remove('disabled');

                // Re-populate categories & populate programs
                populateCategories();
                populatePrograms();
            };
            catPanel.appendChild(item);
        });
    };

    const populatePrograms = () => {
        progPanel.innerHTML = '';
        if (!selectedCategory) return;

        // Load only programs under that category
        const programs = [...new Set(
            allResults
                .filter(r => r.categoryName === selectedCategory)
                .map(r => r.programName)
        )].sort();

        programs.forEach(p => {
            const isSelected = p === selectedProgram;
            const item = document.createElement('div');
            item.className = `glass-select-item ${isSelected ? 'selected' : ''}`;

            let checkHTML = '';
            if (isSelected) {
                checkHTML = `<span class="glass-select-check">✓</span>`;
            }

            item.innerHTML = `
                <span>${escapeHTML(p)}</span>
                ${checkHTML}
            `;

            item.onclick = (e) => {
                e.stopPropagation();
                selectedProgram = p;
                progText.textContent = p;
                progText.classList.remove('placeholder');
                progContainer.classList.remove('open');

                // Re-populate programs
                populatePrograms();
            };
            progPanel.appendChild(item);
        });
    };

    // Populate category dropdown initially
    populateCategories();

    // Handle Search click workflow
    document.getElementById('btnFilterSearch').onclick = () => {
        if (!selectedCategory || !selectedProgram) {
            showToast("⚠️ Please select both Category and Program!");
            return;
        }

        // Query the single matching result
        const currentResult = allResults.find(r => r.categoryName === selectedCategory && r.programName === selectedProgram);
        if (!currentResult) {
            renderEmpty("Result Not Found", "The requested program standings have not been published yet.");
            return;
        }

        // Generate Result Poster
        renderSingleResult(currentResult);
    };
}

// ─────────────────────────────────────────────
// Rendering Standings Poster Card
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// Dynamic Poster HTML Layout Engines
// ─────────────────────────────────────────────
function getMiniPosterHTML(r, bgId, templateId, resultNumber, madrasaName) {
    const activeWinners = [...(r.marksData || [])].filter(w => w.finalMark && w.finalMark > 0);
    computeDenseRanking(activeWinners, w => w.finalMark, 'rank');
    const sortedWinners = activeWinners.slice(0, 3);

    const isGroup = r.programType === 'group' || (r.programType === 'general' && r.registrationType === 'group');

    if (templateId === 2) {
        const w1 = sortedWinners[0];
        const w2 = sortedWinners[1];
        const w3 = sortedWinners[2];

        const name1 = w1 ? (isGroup ? (w1.studentName || 'TEAM A') : (w1.studentName || '—')) : '—';
        const team1 = w1 ? (w1.teamName || '—') : '—';

        const name2 = w2 ? (isGroup ? (w2.studentName || 'TEAM B') : (w2.studentName || '—')) : '—';
        const team2 = w2 ? (w2.teamName || '—') : '—';

        const name3 = w3 ? (isGroup ? (w3.studentName || 'TEAM C') : (w3.studentName || '—')) : '—';
        const team3 = w3 ? (w3.teamName || '—') : '—';

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
            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(15, 23, 42, 0.50); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); z-index: 1;"></div>

            <!-- Mini Bento Container -->
            <div style="position: absolute; top: 10px; bottom: 10px; left: 10px; right: 10px; background: rgba(255,255,255,0.06); border: 0.5px solid rgba(255,255,255,0.12); border-radius: 12px; padding: 10px; display: flex; flex-direction: column; justify-content: space-between; z-index: 2; box-sizing: border-box;">
                <div style="text-align: center; line-height: 1.1;">
                    <span style="font-size: 4px; color: #fbbf24; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 2px;">${escapeHTML(r.categoryName.toUpperCase())}</span>
                    <div style="font-family: 'Plus Jakarta Sans', 'Inter', sans-serif; font-size: 6.5px; font-weight: 800; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: uppercase;">${escapeHTML(r.programName)}</div>
                    <div style="display: inline-block; background: rgba(255,255,255,0.08); border: 0.25px solid rgba(255,255,255,0.15); border-radius: 4px; padding: 1px 3px; font-size: 3.5px; font-weight: 700; color: white; margin-top: 2px;">RESULT ${resultNumber}</div>
                </div>

                ${bentoGridHTML}

                <div style="display: flex; align-items: center; gap: 3px; width: 100%;">
                    <div style="flex-grow: 1; height: 0.25px; background: rgba(255,255,255,0.12);"></div>
                    <span style="font-size: 4px; color: rgba(255,255,255,0.5); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60px;">${escapeHTML(madrasaName.toUpperCase())}</span>
                    <div style="flex-grow: 1; height: 0.25px; background: rgba(255,255,255,0.12);"></div>
                </div>
            </div>
        `;
    } else if (templateId === 3) {
        const rankLabels = { 1: '1ST', 2: '2ND', 3: '3RD' };
        const winnersHTML = sortedWinners.map((w) => {
            const rank = w.rank;
            const nameText = isGroup ? (w.studentName || 'TEAM A') : (w.studentName || '—');
            const teamText = w.teamName || '—';
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
            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(15, 23, 42, 0.55); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); z-index: 1;"></div>

            <!-- Mini Editorial Container -->
            <div style="position: absolute; top: 8px; bottom: 8px; left: 8px; right: 8px; display: flex; flex-direction: column; justify-content: space-between; z-index: 2; box-sizing: border-box;">
                
                <!-- Mini Header -->
                <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
                    <div style="display: flex; flex-direction: column; text-align: left; max-width: 70px; line-height: 1;">
                        <span style="font-size: 3px; font-weight: 700; color: rgba(255, 255, 255, 0.45); letter-spacing: 0.5px;">STANDINGS</span>
                        <div style="font-family: 'Plus Jakarta Sans', 'Inter', sans-serif; font-size: 5px; font-weight: 800; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: uppercase; margin-top: 1px;">${escapeHTML(r.programName)}</div>
                        <span style="font-size: 3.5px; font-weight: 700; color: #fbbf24; letter-spacing: 0.5px; text-transform: uppercase; margin-top: 1px;">${escapeHTML(r.categoryName)}</span>
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
                    <span style="font-size: 4px; color: rgba(255, 255, 255, 0.45); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60px;">${escapeHTML(madrasaName.toUpperCase())}</span>
                    <div style="flex-grow: 1; height: 0.25px; background: rgba(255,255,255,0.12);"></div>
                </div>
            </div>
        `;
    } else if (templateId === 4) {
        const rankLabels = { 1: '1ST', 2: '2ND', 3: '3RD' };
        const winnersHTML = sortedWinners.map((w) => {
            const rank = w.rank;
            const nameText = isGroup ? (w.studentName || 'TEAM A') : (w.studentName || '—');
            const teamText = w.teamName || '—';
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
            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(15, 23, 42, 0.55); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); z-index: 1;"></div>

            <!-- Mini Split Screen Container -->
            <div style="position: absolute; top: 8px; bottom: 8px; left: 8px; right: 8px; display: flex; flex-direction: column; justify-content: space-between; z-index: 2; box-sizing: border-box;">
                
                <div style="display: flex; flex-grow: 1; width: 100%; gap: 6px; padding-bottom: 4px; box-sizing: border-box;">
                    <!-- Left Mini Panel (35% width) -->
                    <div style="width: 35%; display: flex; flex-direction: column; justify-content: space-between; border-right: 0.25px solid rgba(255, 255, 255, 0.15); padding-right: 4px; box-sizing: border-box; text-align: left; line-height: 1.1;">
                        <div>
                            <span style="font-size: 3px; font-weight: 700; color: rgba(255, 255, 255, 0.45); letter-spacing: 0.3px; display: block;">OFFICIAL RESULT</span>
                            <div style="font-family: 'Plus Jakarta Sans', 'Inter', sans-serif; font-size: 5px; font-weight: 800; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: uppercase; margin-top: 1px;">${escapeHTML(r.programName)}</div>
                            <span style="font-size: 3.5px; font-weight: 700; color: #fbbf24; letter-spacing: 0.5px; text-transform: uppercase; margin-top: 1px; display: block;">${escapeHTML(r.categoryName)}</span>
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
                    <span style="font-size: 4px; color: rgba(255, 255, 255, 0.45); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60px;">${escapeHTML(madrasaName.toUpperCase())}</span>
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
            const teamText = w.teamName || '—';
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
                        <span style="font-size: 4px; color: #fbbf24; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">${escapeHTML(r.categoryName.toUpperCase())}</span>
                        <span style="background: rgba(255,255,255,0.08); border: 0.25px solid rgba(255,255,255,0.15); border-radius: 4px; padding: 1px 3px; font-size: 3.5px; font-weight: 700; color: white;">R${resultNumber}</span>
                    </div>
                    <div style="font-family: 'Plus Jakarta Sans', 'Inter', sans-serif; font-size: 6.5px; font-weight: 800; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: uppercase;">${escapeHTML(r.programName)}</div>
                </div>
                
                <div style="display: flex; flex-direction: column; gap: 4px; margin: 4px 0;">
                    ${winnersHTML}
                </div>
                
                <div style="display: flex; align-items: center; gap: 3px; width: 100%;">
                    <div style="flex-grow: 1; height: 0.25px; background: rgba(255,255,255,0.12);"></div>
                    <span style="font-size: 4px; color: rgba(255,255,255,0.5); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60px;">${escapeHTML(madrasaName.toUpperCase())}</span>
                    <div style="flex-grow: 1; height: 0.25px; background: rgba(255,255,255,0.12);"></div>
                </div>
            </div>
        `;
    }
}

function getPosterInnerHTML(r, bgId, templateId, resultNumber, madrasaName) {
    const activeWinners = [...(r.marksData || [])].filter(w => w.finalMark && w.finalMark > 0);
    computeDenseRanking(activeWinners, w => w.finalMark, 'rank');
    const sortedWinners = activeWinners.slice(0, 3);

    const isGroup = r.programType === 'group' || (r.programType === 'general' && r.registrationType === 'group');

    const ordinalLabel = (rank) => {
        const labels = { 1: '1ST', 2: '2ND', 3: '3RD' };
        return labels[rank] || `${rank}TH`;
    };

    const displayEventName = eventConfig?.eventName || madrasaName || "Results Portal";
    const displayMadrasaName = eventConfig?.madrasaName || madrasaName || "";
    const displayEventTagline = eventConfig?.eventTagline || "";
    const displayEventLogo = eventConfig?.eventLogo || null;

    const brandLogoHTML = displayEventLogo ? `<div class="poster-brand-logo-wrap"><img src="${displayEventLogo}" alt="Logo" class="poster-brand-logo" /></div>` : '';
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
        const team1 = w1 ? (w1.teamName || '—') : '—';

        const name2 = w2 ? (isGroup ? (w2.studentName || 'TEAM B') : (w2.studentName || '—')) : '—';
        const team2 = w2 ? (w2.teamName || '—') : '—';

        const name3 = w3 ? (isGroup ? (w3.studentName || 'TEAM C') : (w3.studentName || '—')) : '—';
        const team3 = w3 ? (w3.teamName || '—') : '—';

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
                    <span class="t2-category-badge">${escapeHTML(r.categoryName.toUpperCase())}</span>
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
            const teamText = w.teamName || '—';
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
                        <span class="t3-category">${escapeHTML(r.categoryName.toUpperCase())}</span>
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
            const teamText = w.teamName || '—';
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
                            <span class="t4-category">${escapeHTML(r.categoryName.toUpperCase())}</span>
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
            const teamText = w.teamName || '—';

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
                        <span class="t1-category">${escapeHTML(r.categoryName.toUpperCase())}</span>
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
    if (!list) return;

    const bgId = cardBgMap[r.id] || 1;
    const templateId = cardTemplateMap[r.id] || 1;

    const sortedPublished = [...allResults].sort((a, b) => {
        const timeA = a.publishedAt?.seconds || 0;
        const timeB = b.publishedAt?.seconds || 0;
        return timeA - timeB;
    });

    const resultNumber = sortedPublished.findIndex(x => x.id === r.id) + 1;
    const madrasaName = getEffectiveEventName();

    const posterInnerHTML = getPosterInnerHTML(r, bgId, templateId, resultNumber, madrasaName);

    list.innerHTML = `
        <div class="poster-container" id="container-${r.id}">
            
            <div class="result-poster template-${templateId}" id="poster-${r.id}" style="background-image: url('../assets/poster-backgrounds/bg${bgId}.jpg')">
                ${posterInnerHTML}
            </div>

            <!-- Dynamic Template Selection Picker -->
            <div class="template-picker-card" style="background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(25px); -webkit-backdrop-filter: blur(25px); border: 1px solid rgba(16, 120, 80, 0.15); border-radius: 28px; padding: 24px 20px; margin: 30px auto 10px auto; max-width: 450px; width: 100%; box-shadow: 0 15px 35px rgba(0, 0, 0, 0.04); box-sizing: border-box; text-align: center;">
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
                </div>
            </div>

            <!-- Balanced Actions Buttons Row -->
            <div class="poster-actions">
                <button class="btn-action-primary btn-download" data-id="${r.id}">📥 Download Image</button>
               
            </div>

        </div>
    `;

    // Wire template modal trigger
    document.querySelector('.btn-change-template').onclick = () => {
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
                    <div class="mini-poster-preview" style="background-image: url('../assets/poster-backgrounds/bg${bgId}.jpg')">
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
            const bgNum = parseInt(e.currentTarget.dataset.bg, 10);

            cardBgMap[cardId] = bgNum;

            const posterEl = document.getElementById(`poster-${cardId}`);
            if (posterEl) {
                posterEl.style.backgroundImage = `url('../assets/poster-backgrounds/bg${bgNum}.jpg')`;
            }

            const containerEl = document.getElementById(`container-${cardId}`);
            if (containerEl) {
                containerEl.querySelectorAll('.thumb').forEach(b => {
                    b.classList.remove('active');
                });
                e.currentTarget.classList.add('active');
            }
        };
    });

    // Wire Card Actions
    const btnDownload = document.querySelector('.btn-download');
    if (btnDownload) {
        btnDownload.onclick = () => {
            downloadPosterAsImage(r.id);
        };
    }

    const btnShare = document.querySelector('.btn-share');
    if (btnShare) {
        btnShare.onclick = () => {
            sharePosterContent(r.id);
        };
    }
}

function renderError(title, msg) {
    document.getElementById('resultsList').innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">❌</div>
            <h2 style="color:#dc2626; margin-bottom:0.5rem; font-family:'Playfair Display', serif;">${escapeHTML(title)}</h2>
            <p>${escapeHTML(msg)}</p>
        </div>
    `;
}

function renderEmpty(title, msg) {
    document.getElementById('resultsList').innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">🔍</div>
            <h3 style="font-family:'Playfair Display', serif;">${escapeHTML(title)}</h3>
            <p>${escapeHTML(msg)}</p>
        </div>
    `;
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

    // Locate on-screen poster element or create temporary element
    let posterEl = document.getElementById(`poster-${r.id}`);
    let tempContainer = null;

    if (!posterEl) {
        const sortedPublished = [...allResults].sort((a, b) => (a.publishedAt?.seconds || 0) - (b.publishedAt?.seconds || 0));
        const resultNumber = sortedPublished.findIndex(x => x.id === r.id) + 1;
        const madrasaName = getEffectiveEventName();
        const posterInnerHTML = getPosterInnerHTML(r, bgId, templateId, resultNumber, madrasaName);

        tempContainer = document.createElement('div');
        tempContainer.style.position = 'fixed';
        tempContainer.style.left = '-9999px';
        tempContainer.style.top = '-9999px';
        tempContainer.style.width = '450px';
        tempContainer.style.height = '562.5px';
        tempContainer.style.zIndex = '-9999';
        tempContainer.innerHTML = `<div class="result-poster template-${templateId}" style="width:450px; height:562.5px; background-image: url('../assets/poster-backgrounds/bg${bgId}.jpg')">${posterInnerHTML}</div>`;
        document.body.appendChild(tempContainer);
        posterEl = tempContainer.firstElementChild;
    }

    // Create fixed-size 450x562.5 rendering target clone to guarantee exact 4:5 proportions and scaling
    const captureWrapper = document.createElement('div');
    captureWrapper.style.position = 'fixed';
    captureWrapper.style.left = '-9999px';
    captureWrapper.style.top = '-9999px';
    captureWrapper.style.width = '450px';
    captureWrapper.style.height = '562.5px';
    captureWrapper.style.zIndex = '-9999';

    const clonedPoster = posterEl.cloneNode(true);
    clonedPoster.style.width = '450px';
    clonedPoster.style.height = '562.5px';
    clonedPoster.style.transform = 'none';
    clonedPoster.style.margin = '0';
    clonedPoster.style.boxShadow = 'none';

    captureWrapper.appendChild(clonedPoster);
    document.body.appendChild(captureWrapper);

    try {
        // Ensure fonts and images are fully loaded before capture
        if (document.fonts && document.fonts.ready) {
            await document.fonts.ready;
        }

        const images = Array.from(clonedPoster.querySelectorAll('img'));
        await Promise.all(images.map(img => {
            if (img.complete) return Promise.resolve();
            return new Promise(resolve => {
                img.onload = resolve;
                img.onerror = resolve;
            });
        }));

        // Render high-resolution canvas at 1200x1500 (450 * 2.6666667 = 1200)
        const scaleFactor = 1200 / 450;
        const canvas = await html2canvas(clonedPoster, {
            scale: scaleFactor,
            useCORS: true,
            allowTaint: true,
            backgroundColor: null,
            logging: false,
            scrollX: 0,
            scrollY: 0
        });

        return canvas;
    } catch (err) {
        console.error("Poster capture failed:", err);
        return null;
    } finally {
        if (captureWrapper && captureWrapper.parentNode) {
            document.body.removeChild(captureWrapper);
        }
        if (tempContainer && tempContainer.parentNode) {
            document.body.removeChild(tempContainer);
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
    const activeWinners = [...(r.marksData || [])].filter(w => w.finalMark && w.finalMark > 0);
    computeDenseRanking(activeWinners, w => w.finalMark, 'rank');
    const sorted = activeWinners.slice(0, 3);

    const isGroup = r.programType === 'group' || (r.programType === 'general' && r.registrationType === 'group');

    const formatWinner = (w) => {
        if (!w) return '—';
        const namePart = isGroup ? w.studentName : w.studentName;
        const teamPart = isGroup ? 'Group' : w.teamName;
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
