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
            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(15, 23, 42, 0.65); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); z-index: 1;"></div>

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
            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(15, 23, 42, 0.7); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); z-index: 1;"></div>

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
            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(15, 23, 42, 0.7); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); z-index: 1;"></div>

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
            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(15, 23, 42, 0.65); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); z-index: 1;"></div>
            
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
    const displayEventTagline = eventConfig?.eventTagline || "";
    const displayEventLogo = eventConfig?.eventLogo || null;

    const brandLogoHTML = displayEventLogo ? `<div class="poster-brand-logo-wrap"><img src="${displayEventLogo}" alt="Logo" class="poster-brand-logo" /></div>` : '';
    const brandTaglineHTML = displayEventTagline ? `<div class="poster-brand-tagline">${escapeHTML(displayEventTagline)}</div>` : '';
    const brandHeaderHTML = `
        <div class="poster-brand-header">
            ${brandLogoHTML}
            <div class="poster-brand-name">${escapeHTML(displayEventName.toUpperCase())}</div>
            ${brandTaglineHTML}
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
                    <span class="t2-footer-text">${escapeHTML(displayEventName.toUpperCase())}</span>
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
                        <span class="t3-official-label">OFFICIAL RESULTS STANDINGS</span>
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
                    <span class="t3-footer-text">${escapeHTML(displayEventName.toUpperCase())}</span>
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
                            <span class="t4-official-badge">OFFICIAL RESULT</span>
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
                    <span class="t4-footer-text">${escapeHTML(displayEventName.toUpperCase())}</span>
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
                    <div class="t1-badge-row">
                        <span class="t1-category">${escapeHTML(r.categoryName.toUpperCase())}</span>
                        <span class="t1-result-badge">RESULT ${resultNumber}</span>
                    </div>
                    <h1 class="t1-title">${escapeHTML(r.programName.toUpperCase())}</h1>
                </div>

                <div class="t1-list">
                    ${finalWinnersHTML}
                </div>

                <div class="t1-footer">
                    <div class="t1-footer-line"></div>
                    <span class="t1-footer-text">${escapeHTML(displayEventName.toUpperCase())}</span>
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

function drawCanvasBrandHeader(ctx, eventName, eventTagline, logoImg, topY = 60) {
    let currY = topY;
    ctx.textAlign = 'center';
    
    if (logoImg && logoImg.complete) {
        const maxDim = 80;
        let w = logoImg.width || maxDim;
        let h = logoImg.height || maxDim;
        const ratio = Math.min(maxDim / w, maxDim / h, 1);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
        ctx.drawImage(logoImg, 600 - w / 2, currY, w, h);
        currY += h + 14;
    }

    ctx.textBaseline = 'top';
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 32px "Plus Jakarta Sans", "Inter", sans-serif';
    ctx.fillText(eventName.toUpperCase(), 600, currY);
    currY += 40;

    if (eventTagline) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        let taglineFontSize = 20;
        ctx.font = `italic 500 ${taglineFontSize}px "Inter", "Noto Sans Malayalam", sans-serif`;
        let taglineWidth = ctx.measureText(eventTagline).width;
        if (taglineWidth > 900) {
            taglineFontSize = Math.floor(20 * (900 / taglineWidth));
            if (taglineFontSize < 13) taglineFontSize = 13;
            ctx.font = `italic 500 ${taglineFontSize}px "Inter", "Noto Sans Malayalam", sans-serif`;
        }
        ctx.fillText(eventTagline, 600, currY);
        currY += 32;
    } else {
        currY += 8;
    }
    return currY;
}

// ─────────────────────────────────────────────
// Unified Off-screen 4:5 Aspect Ratio Canvas Drawer
// ─────────────────────────────────────────────
function generatePosterCanvas(r) {
    const bgId = cardBgMap[r.id] || 1;
    const templateId = cardTemplateMap[r.id] || 1;
    const displayEventName = (eventConfig?.eventName || getEffectiveEventName()).toUpperCase();
    const displayEventTagline = eventConfig?.eventTagline || "";
    const programName = (r.programName || "Program Standing").toUpperCase();
    const categoryName = (r.categoryName || "General Category").toUpperCase();

    // Sort all published results chronologically by publication time ascending to get index order number
    const sortedPublished = [...allResults].sort((a, b) => {
        const timeA = a.publishedAt?.seconds || 0;
        const timeB = b.publishedAt?.seconds || 0;
        return timeA - timeB;
    });

    const resultNumber = sortedPublished.findIndex(x => x.id === r.id) + 1;

    // Fetch top 3 winners using dense ranking
    const activeWinners = [...(r.marksData || [])].filter(w => w.finalMark && w.finalMark > 0);
    computeDenseRanking(activeWinners, w => w.finalMark, 'rank');
    const sorted = activeWinners.slice(0, 3);

    const ordinalLabel = (rank) => {
        const labels = { 1: '1ST', 2: '2ND', 3: '3RD' };
        return labels[rank] || `${rank}TH`;
    };

    const ordinalMap = { 1: '1ST PLACE', 2: '2ND PLACE', 3: '3RD PLACE' };

    // Create high-res off-screen canvas (1200x1500 for exact 4:5 aspect ratio)
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 1500;
    const ctx = canvas.getContext('2d');

    // Draw preloaded background
    const bgImg = preloadedBgs[bgId];
    if (templateId === 1 || templateId === 2 || templateId === 3 || templateId === 4) {
        ctx.save();
        ctx.filter = 'blur(12px)';
        if (bgImg && bgImg.complete) {
            ctx.drawImage(bgImg, -40, -40, 1280, 1580);
        } else {
            const grad = ctx.createLinearGradient(0, 0, 1200, 1500);
            grad.addColorStop(0, '#022c22');
            grad.addColorStop(1, '#064e3b');
            ctx.fillStyle = grad;
            ctx.fillRect(-40, -40, 1280, 1580);
        }
        ctx.restore();

        // Dark overlay depending on template
        if (templateId === 3 || templateId === 4) {
            ctx.fillStyle = 'rgba(15, 23, 42, 0.70)';
        } else {
            ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
        }
        ctx.fillRect(0, 0, 1200, 1500);
    } else {
        if (bgImg && bgImg.complete) {
            ctx.drawImage(bgImg, 0, 0, 1200, 1500);
        } else {
            // Fallback emerald-pine gradient if image load lags
            const grad = ctx.createLinearGradient(0, 0, 1200, 1500);
            grad.addColorStop(0, '#022c22');
            grad.addColorStop(1, '#064e3b');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 1200, 1500);
        }

        // Overlay dark subtle gradient for readability
        const gradient = ctx.createLinearGradient(0, 0, 0, 1500);
        gradient.addColorStop(0, 'rgba(0, 0, 0, 0.15)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 1200, 1500);
    }

    const isGroup = r.programType === 'group' || (r.programType === 'general' && r.registrationType === 'group');

    if (templateId === 2) {
        // Template 2: Bento Grid Layout
        let currY = drawCanvasBrandHeader(ctx, displayEventName, displayEventTagline, cachedLogoImg, 50);

        // Category Name
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 28px "Inter", sans-serif';
        ctx.fillText(categoryName, 600, currY);
        currY += 36;

        // Result Label glass pill badge
        const badgeText = `RESULT ${resultNumber}`;
        ctx.font = 'bold 24px "Inter", sans-serif';
        const textWidth = ctx.measureText(badgeText).width;
        const badgeW = textWidth + 36;
        const badgeH = 44;
        const badgeX = 600 - badgeW / 2;
        const badgeY = currY;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.beginPath();
        ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 22);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeText, 600, badgeY + badgeH / 2);
        currY += badgeH + 16;

        // Program Name
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#ffffff';
        let progFontSize = 46;
        ctx.font = `800 ${progFontSize}px "Plus Jakarta Sans", "Inter", sans-serif`;
        let progWidth = ctx.measureText(programName).width;
        if (progWidth > 900) {
            progFontSize = Math.floor(46 * (900 / progWidth));
            if (progFontSize < 26) progFontSize = 26;
            ctx.font = `800 ${progFontSize}px "Plus Jakarta Sans", "Inter", sans-serif`;
        }
        ctx.fillText(programName, 600, currY);

        // Fetch top 3 winners details
        const w1 = sorted[0];
        const w2 = sorted[1];
        const w3 = sorted[2];

        const name1 = w1 ? (isGroup ? (w1.studentName || 'TEAM A') : (w1.studentName || '—')) : '—';
        const team1 = w1 ? (w1.teamName || '—') : '—';

        const name2 = w2 ? (isGroup ? (w2.studentName || 'TEAM B') : (w2.studentName || '—')) : '—';
        const team2 = w2 ? (w2.teamName || '—') : '—';

        const name3 = w3 ? (isGroup ? (w3.studentName || 'TEAM C') : (w3.studentName || '—')) : '—';
        const team3 = w3 ? (w3.teamName || '—') : '—';

        // 1st Place Card (Width 1000px, Height 260px, X = 100, Y = 490)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.beginPath();
        ctx.roundRect(100, 490, 1000, 260, 56);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 1st Place Left Highlight Bar
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.roundRect(100, 490, 16, 260, { tl: 56, bl: 56, tr: 0, br: 0 });
        ctx.fill();

        // 1st Place Details
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 24px "Inter", sans-serif';
        ctx.fillText(`${w1 ? ordinalLabel(w1.rank) : '1ST'} STANDING`, 160, 555);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 44px "Inter", sans-serif';
        ctx.fillText(name1.toUpperCase(), 160, 620);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = '600 28px "Inter", sans-serif';
        ctx.fillText(`TEAM: ${team1.toUpperCase()}`, 160, 680);

        // 1st Place Rank large transparent number
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(251, 191, 36, 0.15)';
        ctx.font = '900 120px "Inter", sans-serif';
        ctx.fillText(w1 ? String(w1.rank).padStart(2, '0') : "01", 1040, 650);

        // 2nd Place Card (Width 480px, Height 430px, X = 100, Y = 780)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.beginPath();
        ctx.roundRect(100, 780, 480, 430, 48);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 2nd Place Top Highlight Bar
        ctx.fillStyle = '#cbd5e1';
        ctx.beginPath();
        ctx.roundRect(100, 780, 480, 12, { tl: 48, tr: 48, bl: 0, br: 0 });
        ctx.fill();

        // 2nd Place Rank large transparent number
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(203, 213, 225, 0.15)';
        ctx.font = '900 110px "Inter", sans-serif';
        ctx.fillText(w2 ? String(w2.rank).padStart(2, '0') : "02", 540, 920);

        // 2nd Place Details
        ctx.textAlign = 'left';
        ctx.fillStyle = '#cbd5e1';
        ctx.font = 'bold 22px "Inter", sans-serif';
        ctx.fillText(`${w2 ? ordinalLabel(w2.rank) : '2ND'} STANDING`, 140, 1030);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 36px "Inter", sans-serif';
        ctx.fillText(name2.toUpperCase(), 140, 1090);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = '600 24px "Inter", sans-serif';
        ctx.fillText(`TEAM: ${team2.toUpperCase()}`, 140, 1145);

        // 3rd Place Card (Width 480px, Height 430px, X = 620, Y = 780)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.beginPath();
        ctx.roundRect(620, 780, 480, 430, 48);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 3rd Place Top Highlight Bar
        ctx.fillStyle = '#d97706';
        ctx.beginPath();
        ctx.roundRect(620, 780, 480, 12, { tl: 48, tr: 48, bl: 0, br: 0 });
        ctx.fill();

        // 3rd Place Rank large transparent number
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(217, 119, 6, 0.15)';
        ctx.font = '900 110px "Inter", sans-serif';
        ctx.fillText(w3 ? String(w3.rank).padStart(2, '0') : "03", 1060, 920);

        // 3rd Place Details
        ctx.textAlign = 'left';
        ctx.fillStyle = '#fdba74';
        ctx.font = 'bold 22px "Inter", sans-serif';
        ctx.fillText(`${w3 ? ordinalLabel(w3.rank) : '3RD'} STANDING`, 660, 1030);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 36px "Inter", sans-serif';
        ctx.fillText(name3.toUpperCase(), 660, 1090);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = '600 24px "Inter", sans-serif';
        ctx.fillText(`TEAM: ${team3.toUpperCase()}`, 660, 1145);

        // Centered Madrasa Footer Branding with divider lines
        ctx.textAlign = 'center';
        ctx.font = 'bold 32px "Inter", sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        const footerText = displayEventName;
        const footerTextWidth = ctx.measureText(footerText).width;

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.moveTo(160, 1312);
        ctx.lineTo(600 - (footerTextWidth / 2) - 30, 1312);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(600 + (footerTextWidth / 2) + 30, 1312);
        ctx.lineTo(1040, 1312);
        ctx.stroke();

        ctx.fillText(footerText, 600, 1322);
    } else if (templateId === 3) {
        // Template 3: Editorial Layout
        let headerBottomY = drawCanvasBrandHeader(ctx, displayEventName, displayEventTagline, cachedLogoImg, 50);
        let currY = Math.max(headerBottomY + 10, 210);
        
        // Left side texts
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        
        // "OFFICIAL RESULTS STANDINGS"
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.font = 'bold 20px "Inter", sans-serif';
        ctx.fillText("OFFICIAL RESULTS STANDINGS", 120, currY);
        currY += 32;

        // Program Name
        let progFontSize = 44;
        ctx.font = `800 ${progFontSize}px "Plus Jakarta Sans", "Inter", sans-serif`;
        let progWidth = ctx.measureText(programName).width;
        if (progWidth > 750) {
            progFontSize = Math.floor(44 * (750 / progWidth));
            if (progFontSize < 26) progFontSize = 26;
            ctx.font = `800 ${progFontSize}px "Plus Jakarta Sans", "Inter", sans-serif`;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillText(programName, 120, currY);
        currY += 52;

        // Category Name
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 26px "Inter", sans-serif';
        ctx.fillText(categoryName, 120, currY);
        currY += 36;

        // Result badge (rounded rectangle outline)
        const badgeText = `RESULT ${resultNumber}`;
        ctx.font = 'bold 22px "Inter", sans-serif';
        const bTextWidth = ctx.measureText(badgeText).width;
        const bX = 120;
        const bY = currY;
        const bW = bTextWidth + 30;
        const bH = 42;
        
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(bX, bY, bW, bH, 8);
        ctx.stroke();
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeText, bX + 15, bY + bH / 2);

        // Right side emblem (academic open book icon)
        ctx.save();
        ctx.fillStyle = '#fbbf24';
        ctx.translate(1000, 170);
        ctx.scale(2.5, 2.5);
        const path = new Path2D("M12 11.55C9.64 9.35 6.48 8 3 8v11c3.48 0 6.64 1.35 9 3.55 2.36-2.2 5.52-3.55 9-3.55V8c-3.48 0-6.64 1.35-9 3.55zM12 8c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3z");
        ctx.fill(path);
        ctx.restore();

        // Right side vertical labels
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.font = 'bold 15px "Inter", sans-serif';
        ctx.fillText("COMPETITION", 1030, 270);
        ctx.fillText("EXCELLENCE", 1030, 295);
        ctx.fillText("ACHIEVEMENT", 1030, 320);

        // Winner Rows
        const startY = 500;
        const rowHeight = 220;
        const rankColors = { 1: '#fbbf24', 2: '#cbd5e1', 3: '#fdba74' };

        for (let i = 0; i < sorted.length; i++) {
            const w = sorted[i];
            const y = startY + (i * rowHeight);
            const rank = i + 1;

            // Draw thin divider line underneath except for last
            if (i < sorted.length - 1) {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(120, y + 180);
                ctx.lineTo(1080, y + 180);
                ctx.stroke();
            }

            // Left Rank details
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = rankColors[rank];
            ctx.font = 'bold 90px "Inter", sans-serif';
            ctx.fillText(`0${rank}`, 120, y + 90);

            ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.font = 'bold 18px "Inter", sans-serif';
            ctx.fillText(ordinalMap[rank], 120, y + 135);

            // Right Student & Team details
            const nameText = isGroup ? (w.studentName || 'TEAM A') : (w.studentName || '—');
            const teamText = w.teamName || '—';

            ctx.textAlign = 'right';
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 44px "Inter", sans-serif';
            
            let maxNameWidth = 650;
            let finalName = nameText.toUpperCase();
            if (ctx.measureText(finalName).width > maxNameWidth) {
                while (ctx.measureText(finalName + '...').width > maxNameWidth && finalName.length > 0) {
                    finalName = finalName.slice(0, -1);
                }
                finalName += '...';
            }
            ctx.fillText(finalName, 1080, y + 80);

            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.font = '600 26px "Inter", sans-serif';
            
            let finalTeam = teamText.toUpperCase();
            if (ctx.measureText(finalTeam).width > maxNameWidth) {
                while (ctx.measureText(finalTeam + '...').width > maxNameWidth && finalTeam.length > 0) {
                    finalTeam = finalTeam.slice(0, -1);
                }
                finalTeam += '...';
            }
            ctx.fillText(finalTeam, 1080, y + 130);
        }

        // Draw Editorial Footer
        ctx.textAlign = 'center';
        ctx.font = 'bold 24px "Inter", sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        const footerText = displayEventName;
        const footerTextWidth = ctx.measureText(footerText).width;

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.moveTo(120, 1370);
        ctx.lineTo(600 - (footerTextWidth / 2) - 30, 1370);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(600 + (footerTextWidth / 2) + 30, 1370);
        ctx.lineTo(1080, 1370);
        ctx.stroke();

        ctx.fillText(footerText, 600, 1380);
    } else if (templateId === 4) {
        // Template 4: Premium Split-Screen Dashboard Layout
        let headerBottomY = drawCanvasBrandHeader(ctx, displayEventName, displayEventTagline, cachedLogoImg, 50);

        // Vertical split divider line at X = 480
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(480, headerBottomY + 10);
        ctx.lineTo(480, 1260);
        ctx.stroke();

        let currY = Math.max(headerBottomY + 15, 210);

        // Left Panel (X = 120)
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        
        // "OFFICIAL RESULT" badge/header
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = 'bold 20px "Inter", sans-serif';
        ctx.fillText("OFFICIAL RESULT", 120, currY);
        currY += 32;

        // Program Name (Auto-wrap or scale down)
        let progFontSize = 42;
        ctx.font = `800 ${progFontSize}px "Plus Jakarta Sans", "Inter", sans-serif`;
        let progWidth = ctx.measureText(programName).width;
        if (progWidth > 320) {
            progFontSize = Math.floor(42 * (320 / progWidth));
            if (progFontSize < 22) progFontSize = 22;
            ctx.font = `800 ${progFontSize}px "Plus Jakarta Sans", "Inter", sans-serif`;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillText(programName, 120, currY);
        currY += 50;

        // Category Name
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 24px "Inter", sans-serif';
        ctx.fillText(categoryName, 120, currY);
        currY += 36;

        // Result Badge (Outlined Box)
        const badgeText = `RESULT ${resultNumber}`;
        ctx.font = 'bold 20px "Inter", sans-serif';
        const bTextWidth = ctx.measureText(badgeText).width;
        const bX = 120;
        const bY = currY;
        const bW = bTextWidth + 26;
        const bH = 40;

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(bX, bY, bW, bH, 8);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeText, bX + 13, bY + bH / 2);

        // Left Panel Bottom Ornaments
        // SVG Open-book icon at X = 120, Y = 1000
        ctx.save();
        ctx.fillStyle = '#fbbf24';
        ctx.translate(120, 960);
        ctx.scale(2.5, 2.5);
        const path = new Path2D("M12 11.55C9.64 9.35 6.48 8 3 8v11c3.48 0 6.64 1.35 9 3.55 2.36-2.2 5.52-3.55 9-3.55V8c-3.48 0-6.64 1.35-9 3.55zM12 8c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3z");
        ctx.fill(path);
        ctx.restore();

        // Stacked Vertical Labels
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.font = 'bold 15px "Inter", sans-serif';
        ctx.fillText("COMPETITION", 120, 1070);
        ctx.fillText("EXCELLENCE", 120, 1095);
        ctx.fillText("ACHIEVEMENT", 120, 1120);

        // Right Panel cards (X = 520 to 1080, Width = 560)
        const startY = 360;
        const rowHeight = 220;
        const rankColors = { 1: '#fbbf24', 2: '#cbd5e1', 3: '#fdba74' };

        for (let i = 0; i < sorted.length; i++) {
            const w = sorted[i];
            const y = startY + (i * rowHeight);
            const rank = w.rank;
            const accentColor = rankColors[rank] || '#ffffff';

            // Card container box background (Width = 560, Height = 180)
            ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
            ctx.beginPath();
            ctx.roundRect(520, y, 560, 180, 24);
            ctx.fill();

            // Card stroke/border
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Left colored highlight bar (Gold, Silver, Bronze)
            ctx.fillStyle = accentColor;
            ctx.beginPath();
            ctx.roundRect(520, y, 10, 180, { tl: 24, bl: 24, tr: 0, br: 0 });
            ctx.fill();

            // Left text details: Rank Number & Label
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = accentColor;
            ctx.font = 'bold 64px "Inter", sans-serif';
            ctx.fillText(`0${rank}`, 560, y + 105);

            ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
            ctx.font = 'bold 16px "Inter", sans-serif';
            ctx.fillText(ordinalMap[rank], 560, y + 140);

            // Right text details: Participant Name & Team
            const nameText = isGroup ? (w.studentName || 'TEAM A') : (w.studentName || '—');
            const teamText = w.teamName || '—';

            ctx.textAlign = 'right';
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 38px "Inter", sans-serif';
            
            let maxNameWidth = 320;
            let finalName = nameText.toUpperCase();
            if (ctx.measureText(finalName).width > maxNameWidth) {
                while (ctx.measureText(finalName + '...').width > maxNameWidth && finalName.length > 0) {
                    finalName = finalName.slice(0, -1);
                }
                finalName += '...';
            }
            ctx.fillText(finalName, 1040, y + 80);

            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.font = '600 24px "Inter", sans-serif';
            
            let finalTeam = teamText.toUpperCase();
            if (ctx.measureText(finalTeam).width > maxNameWidth) {
                while (ctx.measureText(finalTeam + '...').width > maxNameWidth && finalTeam.length > 0) {
                    finalTeam = finalTeam.slice(0, -1);
                }
                finalTeam += '...';
            }
            ctx.fillText(finalTeam, 1040, y + 130);
        }

        // Centered shared footer at bottom
        ctx.textAlign = 'center';
        ctx.font = 'bold 24px "Inter", sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        const footerText = displayEventName;
        const footerTextWidth = ctx.measureText(footerText).width;

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.moveTo(120, 1370);
        ctx.lineTo(600 - (footerTextWidth / 2) - 30, 1370);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(600 + (footerTextWidth / 2) + 30, 1370);
        ctx.lineTo(1080, 1370);
        ctx.stroke();

        ctx.fillText(footerText, 600, 1380);
    } else {
        // Template 1 (Redesigned Liquid Glass)
        // Main Liquid Glass Container
        ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.beginPath();
        ctx.roundRect(80, 80, 1040, 1340, 80);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Subtle top reflection gradient
        const reflectGrad = ctx.createLinearGradient(80, 80, 1120, 750);
        reflectGrad.addColorStop(0, 'rgba(255, 255, 255, 0.05)');
        reflectGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = reflectGrad;
        ctx.beginPath();
        ctx.roundRect(80, 80, 1040, 670, { tl: 80, tr: 80, bl: 0, br: 0 });
        ctx.fill();

        let currY = drawCanvasBrandHeader(ctx, displayEventName, displayEventTagline, cachedLogoImg, 110);

        // Category Name
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 28px "Inter", sans-serif';
        ctx.fillText(categoryName, 600, currY);
        currY += 36;

        // Result Label glass pill badge
        const badgeText = `RESULT ${resultNumber}`;
        ctx.font = 'bold 24px "Inter", sans-serif';
        const textWidth = ctx.measureText(badgeText).width;
        const badgeW = textWidth + 36;
        const badgeH = 44;
        const badgeX = 600 - badgeW / 2;
        const badgeY = currY;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.beginPath();
        ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 22);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeText, 600, badgeY + badgeH / 2);
        currY += badgeH + 16;

        // Program Name
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#ffffff';
        let progFontSize = 46;
        ctx.font = `800 ${progFontSize}px "Plus Jakarta Sans", "Inter", sans-serif`;
        let progWidth = ctx.measureText(programName).width;
        if (progWidth > 880) {
            progFontSize = Math.floor(46 * (880 / progWidth));
            if (progFontSize < 28) progFontSize = 28;
            ctx.font = `800 ${progFontSize}px "Plus Jakarta Sans", "Inter", sans-serif`;
        }
        ctx.fillText(programName, 600, currY);

        // Ranking rows
        const startY = 490;
        const rowHeight = 220;
        const rankAccentColors = {
            0: '#fbbf24',
            1: '#cbd5e1',
            2: '#d97706'
        };

        for (let i = 0; i < sorted.length; i++) {
            const w = sorted[i];
            const y = startY + (i * rowHeight);
            const accentColor = rankAccentColors[i] || '#ffffff';

            // Card background
            ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
            ctx.beginPath();
            ctx.roundRect(160, y, 880, 180, 32);
            ctx.fill();

            // Card border
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Left accent highlight bar
            ctx.fillStyle = accentColor;
            ctx.beginPath();
            ctx.roundRect(160, y, 12, 180, { tl: 32, bl: 32, tr: 0, br: 0 });
            ctx.fill();

            // Rank Number text shadow & value
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = accentColor;
            ctx.font = 'bold 64px "Inter", sans-serif';
            ctx.fillText(`#${i + 1}`, 245, y + 112);

            // Participant Name & Team
            const nameText = isGroup ? (w.studentName || 'TEAM A') : (w.studentName || '—');
            const teamText = w.teamName || '—';

            ctx.textAlign = 'left';
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 42px "Inter", sans-serif';
            ctx.fillText(nameText.toUpperCase(), 340, y + 80);

            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.font = '600 28px "Inter", sans-serif';
            ctx.fillText(teamText.toUpperCase(), 340, y + 130);
        }

        // Centered Madrasa Footer Branding with divider lines
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.font = 'bold 32px "Inter", sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        const footerText = displayEventName;
        const footerTextWidth = ctx.measureText(footerText).width;

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.moveTo(160, 1312);
        ctx.lineTo(600 - (footerTextWidth / 2) - 30, 1312);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(600 + (footerTextWidth / 2) + 30, 1312);
        ctx.lineTo(1040, 1312);
        ctx.stroke();

        ctx.fillText(footerText, 600, 1322);
    }

    // Centered Madrasa Footer Branding for other templates
    if (templateId !== 1 && templateId !== 2 && templateId !== 3 && templateId !== 4) {
        ctx.textAlign = 'center';
        ctx.font = 'bold 44px "Inter", sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.fillText(displayEventName, 600, 1430);
    }

    return canvas;
}

// ─────────────────────────────────────────────
// Poster Image Direct Download
// ─────────────────────────────────────────────
function downloadPosterAsImage(cardId) {
    const r = allResults.find(x => x.id === cardId);
    if (!r) return;

    const canvas = generatePosterCanvas(r);

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
function sharePosterContent(cardId) {
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
    const canvas = generatePosterCanvas(r);

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
