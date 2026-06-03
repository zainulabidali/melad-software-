import { db } from './firebase.js';
import {
    collection, doc, getDoc, onSnapshot, query, where
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// ─────────────────────────────────────────────
// State & Helpers
// ─────────────────────────────────────────────
let allResults = [];
let instId = new URLSearchParams(window.location.search).get('id') || new URLSearchParams(window.location.search).get('instId');
let instituteDetails = null;

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

        // Custom Event settings resolution with self-healing fallback (SECTION 2 Event Customization)
        let displayEventName = instituteDetails.name || "Results Portal";
        try {
            const configSnap = await getDoc(doc(db, "institutes", instId, "metadata", "eventConfig"));
            if (configSnap.exists()) {
                const configData = configSnap.data();
                if (configData.eventName) {
                    displayEventName = configData.eventName;
                }
            }
        } catch (e) {
            console.warn("Public results custom event settings bypassed: read restricted, falling back to name.");
        }

        document.getElementById('madrasaName').textContent = displayEventName;

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
    const sortedWinners = [...(r.marksData || [])]
        .filter(w => w.finalMark && w.finalMark > 0)
        .sort((a, b) => (b.finalMark || 0) - (a.finalMark || 0))
        .slice(0, 3);

    const isGroup = r.programType === 'group' || (r.programType === 'general' && r.registrationType === 'group');

    if (templateId === 2) {
        const medalMap = { 1: '🥇 1st', 2: '🥈 2nd', 3: '🥉 3rd' };
        const winnersHTML = sortedWinners.map((w, idx) => {
            const rank = idx + 1;
            const nameText = isGroup ? (w.studentName || 'TEAM A') : (w.studentName || '—');
            return `
                <div style="display: flex; align-items: center; gap: 4px; padding: 4px 6px; background: rgba(255,255,255,0.08); border: 0.5px solid rgba(255,255,255,0.15); border-radius: 6px; font-size: 6px; color: white;">
                    <span style="font-weight: 800; color: #fbbf24;">${medalMap[rank]}</span>
                    <div style="display: flex; flex-direction: column; overflow: hidden; text-align: left;">
                        <span style="font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 90px;">${escapeHTML(nameText.toUpperCase())}</span>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div style="position: absolute; top: 15px; left: 10px; right: 10px; text-align: center; z-index: 2; line-height: 1;">
                <div style="font-family: 'Cinzel', serif; font-size: 9px; font-weight: 700; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(r.programName)}</div>
                <div style="font-size: 5px; color: #fbbf24; text-transform: uppercase;">${escapeHTML(r.categoryName)}</div>
                <div style="font-size: 4px; color: rgba(255,255,255,0.6);">RESULT ${resultNumber}</div>
            </div>
            <div style="position: absolute; bottom: 30px; left: 10px; right: 10px; display: flex; flex-direction: column; gap: 3px; z-index: 2;">
                ${winnersHTML}
            </div>
            <div style="position: absolute; bottom: 6px; left: 5px; right: 5px; text-align: center; font-size: 5px; color: rgba(255,255,255,0.6); z-index: 2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${escapeHTML(madrasaName)}
            </div>
        `;
    } else if (templateId === 3) {
        const ordinalMap = { 1: '1st', 2: '2nd', 3: '3rd' };
        const winnersHTML = sortedWinners.map((w, idx) => {
            const rank = idx + 1;
            const nameText = isGroup ? (w.studentName || 'TEAM A') : (w.studentName || '—');
            return `
                <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 0.5px solid rgba(255,255,255,0.15); padding-bottom: 3px; font-size: 6px; color: white;">
                    <span style="font-family: 'Playfair Display', serif; font-style: italic; color: #fbbf24;">${ordinalMap[rank]}</span>
                    <span style="font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 90px; text-align: right;">${escapeHTML(nameText.toUpperCase())}</span>
                </div>
            `;
        }).join('');

        return `
            <div style="position: absolute; top: 15px; left: 10px; right: 10px; text-align: center; z-index: 2; line-height: 1;">
                <div style="font-family: 'Cinzel', serif; font-size: 9px; font-weight: 700; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(r.programName)}</div>
                <div style="font-size: 5px; color: #fbbf24; text-transform: uppercase;">${escapeHTML(r.categoryName)}</div>
                <div style="font-family: 'Playfair Display', serif; font-size: 6px; font-style: italic; color: rgba(255, 255, 255, 0.85); margin-top: 1px;">Result ${resultNumber}</div>
            </div>
            <div style="position: absolute; bottom: 30px; left: 10px; right: 10px; display: flex; flex-direction: column; gap: 2px; z-index: 2;">
                ${winnersHTML}
            </div>
            <div style="position: absolute; bottom: 6px; left: 5px; right: 5px; text-align: center; font-size: 5px; color: rgba(255,255,255,0.6); z-index: 2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${escapeHTML(madrasaName)}
            </div>
        `;
    } else if (templateId === 4) {
        const winnersHTML = sortedWinners.map((w, idx) => {
            const rank = idx + 1;
            const nameText = isGroup ? (w.studentName || 'TEAM A') : (w.studentName || '—');
            const teamText = w.teamName || '—';
            return `
                <div style="display: grid; grid-template-columns: 20px 1fr 1fr; padding: 3px 4px; font-size: 5px; color: white; border-bottom: 0.5px solid rgba(255,255,255,0.08); line-height: 1;">
                    <span style="font-weight: 800; color: ${rank === 1 ? '#fbbf24' : 'white'};">${rank}</span>
                    <span style="font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left;">${escapeHTML(nameText)}</span>
                    <span style="color: #cbd5e1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left;">${escapeHTML(teamText)}</span>
                </div>
            `;
        }).join('');

        return `
            <div style="position: absolute; top: 15px; left: 10px; right: 10px; text-align: center; z-index: 2; line-height: 1;">
                <div style="font-family: 'Cinzel', serif; font-size: 9px; font-weight: 700; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(r.programName)}</div>
                <div style="font-size: 5px; color: #fbbf24; text-transform: uppercase;">${escapeHTML(r.categoryName)}</div>
                <div style="font-size: 4px; color: rgba(255,255,255,0.6);">RESULT ${resultNumber}</div>
            </div>
            <div style="position: absolute; bottom: 30px; left: 10px; right: 10px; background: rgba(255,255,255,0.05); border-radius: 6px; border: 0.5px solid rgba(255,255,255,0.1); overflow: hidden; z-index: 2;">
                <div style="display: grid; grid-template-columns: 20px 1fr 1fr; padding: 3px 4px; background: rgba(255,255,255,0.12); font-size: 4px; font-weight: 800; color: #fbbf24; border-bottom: 0.5px solid rgba(255,255,255,0.15);">
                    <span style="text-align: left;">RK</span>
                    <span style="text-align: left;">NAME</span>
                    <span style="text-align: left;">TEAM</span>
                </div>
                ${winnersHTML}
            </div>
            <div style="position: absolute; bottom: 6px; left: 5px; right: 5px; text-align: center; font-size: 5px; color: rgba(255,255,255,0.6); z-index: 2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${escapeHTML(madrasaName)}
            </div>
        `;
    } else {
        const winnersHTML = sortedWinners.map((w, idx) => {
            const rank = idx + 1;
            const nameText = isGroup ? (w.studentName || 'TEAM A') : (w.studentName || '—');

            return `
                <div style="display: flex; align-items: center; gap: 4px; padding: 4px 6px; margin-bottom: 3px; border-radius: 6px; background: rgba(255, 255, 255, .08); border: 0.5px solid rgba(255, 255, 255, .18); color: white; font-size: 6px; line-height: 1;">
                    <div style="width: 12px; height: 12px; border-radius: 50%; display: flex; justify-content: center; align-items: center; font-size: 6px; font-weight: 800; background: ${rank === 1 ? 'linear-gradient(135deg, #FFE082, #FFB300)' : rank === 2 ? 'linear-gradient(135deg, #F1F5F9, #94A3B8)' : 'linear-gradient(135deg, #FFEDD5, #D97706)'}; color: black; flex-shrink: 0;">
                        ${rank}
                    </div>
                    <div style="display: flex; flex-direction: column; overflow: hidden; text-align: left;">
                        <span style="font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 95px;">${escapeHTML(nameText.toUpperCase())}</span>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div style="position: absolute; top: 15px; left: 10px; right: 10px; display: flex; flex-direction: column; gap: 2px; z-index: 2; line-height: 1.1; text-align: left;">
                <span style="font-size: 5px; color: #fbbf24; text-transform: uppercase;">${escapeHTML(r.categoryName)}</span>
                <div style="font-family: 'Cinzel', serif; font-size: 9px; font-weight: 700; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(r.programName)}</div>
                <div style="font-size: 4px; color: rgba(255,255,255,0.6);">RESULT ${resultNumber}</div>
            </div>
            <div style="position: absolute; bottom: 30px; left: 10px; right: 10px; display: flex; flex-direction: column; z-index: 2;">
                ${winnersHTML}
            </div>
            <div style="position: absolute; bottom: 6px; left: 5px; right: 5px; text-align: center; font-size: 5px; color: rgba(255,255,255,0.6); z-index: 2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${escapeHTML(madrasaName)}
            </div>
        `;
    }
}

function getPosterInnerHTML(r, bgId, templateId, resultNumber, madrasaName) {
    const sortedWinners = [...(r.marksData || [])]
        .filter(w => w.finalMark && w.finalMark > 0)
        .sort((a, b) => (b.finalMark || 0) - (a.finalMark || 0))
        .slice(0, 3);

    const isGroup = r.programType === 'group' || (r.programType === 'general' && r.registrationType === 'group');

    if (templateId === 2) {
        const medalMap = { 1: '🥇 1st Place', 2: '🥈 2nd Place', 3: '🥉 3rd Place' };
        const winnersHTML = sortedWinners.map((w, idx) => {
            const rank = idx + 1;
            const nameText = isGroup ? (w.studentName || 'TEAM A') : (w.studentName || '—');
            const teamText = w.teamName || '—';

            return `
                <div class="t2-card">
                    <div class="t2-rank-badge">${medalMap[rank]}</div>
                    <div class="t2-details">
                        <div class="t2-student">${escapeHTML(nameText.toUpperCase())}</div>
                        <div class="t2-team">TEAM: ${escapeHTML(teamText.toUpperCase())}</div>
                        <div class="t2-institute">INSTITUTE: ${escapeHTML(madrasaName.toUpperCase())}</div>
                    </div>
                </div>
            `;
        }).join('');

        const finalWinnersHTML = winnersHTML || `<div style="text-align:center;padding:2rem 1.5rem;color:rgba(255,255,255,0.4);font-style:italic;">No standings recorded for this event.</div>`;

        return `
            <div class="t2-header" style="position: absolute; top: 40px; left: 35px; right: 35px; text-align: center; display: flex; flex-direction: column; gap: 4px; z-index: 10;">
                <div class="t2-program-title" style="font-family: 'Cinzel', serif; font-size: clamp(20px, 4.5vw, 32px); font-weight: 700; color: #ffffff; text-transform: uppercase; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">${escapeHTML(r.programName)}</div>
                <div class="t2-category-title" style="font-size: 14px; font-weight: 600; color: #fbbf24; letter-spacing: 2px; text-transform: uppercase; text-shadow: 0 1px 2px rgba(0,0,0,0.4);">${escapeHTML(r.categoryName)}</div>
                <div class="t2-result-num" style="font-size: 12px; font-weight: 700; color: rgba(255,255,255,0.7); letter-spacing: 1.5px;">RESULT ${resultNumber}</div>
            </div>

            <div class="t2-card-list" style="position: absolute; bottom: 85px; left: 35px; right: 35px; display: flex; flex-direction: column; gap: 10px; z-index: 10;">
                ${finalWinnersHTML}
            </div>

            <div class="poster-footer">
                ${escapeHTML(madrasaName)}
            </div>
        `;
    } else if (templateId === 3) {
        const ordinalMap = { 1: '1st Place', 2: '2nd Place', 3: '3rd Place' };
        const winnersHTML = sortedWinners.map((w, idx) => {
            const rank = idx + 1;
            const nameText = isGroup ? (w.studentName || 'TEAM A') : (w.studentName || '—');
            const teamText = w.teamName || '—';

            return `
                <div class="t3-winner-row" style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255, 255, 255, 0.15); padding-bottom: 10px; margin-bottom: 8px;">
                    <span class="t3-rank" style="font-family: 'Playfair Display', serif; font-size: 18px; font-style: italic; color: #fbbf24; font-weight: 600; min-width: 80px; text-shadow: 0 1px 2px rgba(0,0,0,0.3);">${ordinalMap[rank]}</span>
                    <div class="t3-winner-details" style="text-align: right; display: flex; flex-direction: column; gap: 1px;">
                        <div class="t3-name" style="font-size: 16px; font-weight: 800; color: #ffffff; letter-spacing: 0.5px; text-shadow: 0 1px 2px rgba(0,0,0,0.4);">${escapeHTML(nameText.toUpperCase())}</div>
                        <div class="t3-team" style="font-size: 12px; color: #cbd5e1; font-weight: 500; text-shadow: 0 1px 2px rgba(0,0,0,0.3);">${escapeHTML(teamText.toUpperCase())}</div>
                    </div>
                </div>
            `;
        }).join('');

        const finalWinnersHTML = winnersHTML || `<div style="text-align:center;padding:2rem 1.5rem;color:rgba(255,255,255,0.4);font-style:italic;">No standings recorded for this event.</div>`;

        return `
            <div class="t3-header" style="position: absolute; top: 40px; left: 35px; right: 35px; text-align: center; display: flex; flex-direction: column; gap: 4px; z-index: 10;">
                <div class="t3-program" style="font-family: 'Cinzel', serif; font-size: clamp(22px, 5vw, 36px); font-weight: 800; color: #ffffff; line-height: 1.1; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">${escapeHTML(r.programName)}</div>
                <div class="t3-category" style="font-size: 12px; color: #fbbf24; font-weight: 600; letter-spacing: 3px; text-transform: uppercase; text-shadow: 0 1px 2px rgba(0,0,0,0.4);">${escapeHTML(r.categoryName)}</div>
                <div class="t3-result-num" style="font-family: 'Playfair Display', serif; font-size: 18px; font-style: italic; color: rgba(255, 255, 255, 0.85); text-shadow: 0 1px 2px rgba(0,0,0,0.3); margin-top: 2px;">Result ${resultNumber}</div>
            </div>

            <div class="t3-winners-list" style="position: absolute; bottom: 85px; left: 35px; right: 35px; display: flex; flex-direction: column; z-index: 10;">
                ${finalWinnersHTML}
            </div>

            <div class="poster-footer">
                ${escapeHTML(madrasaName)}
            </div>
        `;
    } else if (templateId === 4) {
        const winnersHTML = sortedWinners.map((w, idx) => {
            const rank = idx + 1;
            const nameText = isGroup ? (w.studentName || 'TEAM A') : (w.studentName || '—');
            const teamText = w.teamName || '—';
            const rankGlow = rank === 1 ? 'color: #fbbf24; font-weight: 800;' : 'color: #ffffff;';

            return `
                <div class="t4-table-row" style="display: grid; grid-template-columns: 60px 1fr 1fr; padding: 10px 12px; align-items: center; border-bottom: 1px solid rgba(255, 255, 255, 0.08);">
                    <span class="t4-col-rank" style="font-weight: 800; font-size: 16px; ${rankGlow}">${rank}</span>
                    <span class="t4-col-name" style="font-weight: 700; font-size: 13px; color: #ffffff; text-align: left; text-transform: uppercase; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 5px;">${escapeHTML(nameText)}</span>
                    <span class="t4-col-team" style="font-size: 12px; color: #cbd5e1; font-weight: 600; text-align: left; text-transform: uppercase; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(teamText)}</span>
                </div>
            `;
        }).join('');

        const finalWinnersHTML = winnersHTML || `<div style="text-align:center;padding:2rem 1.5rem;color:rgba(255,255,255,0.4);font-style:italic;">No standings recorded for this event.</div>`;

        return `
            <div class="t4-header" style="position: absolute; top: 40px; left: 35px; right: 35px; text-align: center; display: flex; flex-direction: column; gap: 2px; z-index: 10;">
                <div class="t4-program" style="font-family: 'Cinzel', serif; font-size: clamp(20px, 4.5vw, 32px); font-weight: 700; color: #ffffff; text-transform: uppercase; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">${escapeHTML(r.programName)}</div>
                <div class="t4-category" style="font-size: 13px; font-weight: 600; color: #fbbf24; letter-spacing: 2px; text-transform: uppercase; text-shadow: 0 1px 2px rgba(0,0,0,0.4);">${escapeHTML(r.categoryName)}</div>
                <div class="t4-result-num" style="font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.7); letter-spacing: 1.5px; margin-top: 1px;">RESULT ${resultNumber}</div>
            </div>

            <div class="t4-leaderboard" style="position: absolute; bottom: 85px; left: 35px; right: 35px; background: rgba(255, 255, 255, 0.05); border-radius: 14px; border: 1px solid rgba(255, 255, 255, 0.1); overflow: hidden; z-index: 10;">
                <div class="t4-table-header" style="display: grid; grid-template-columns: 60px 1fr 1fr; padding: 10px 12px; background: rgba(255, 255, 255, 0.12); font-size: 11px; font-weight: 800; letter-spacing: 0.5px; color: #fbbf24; border-bottom: 1px solid rgba(255, 255, 255, 0.15);">
                    <span style="text-align: left;">RANK</span>
                    <span style="text-align: left;">PARTICIPANT</span>
                    <span style="text-align: left;">TEAM</span>
                </div>
                <div class="t4-rows">
                    ${finalWinnersHTML}
                </div>
            </div>

            <div class="poster-footer">
                ${escapeHTML(madrasaName)}
            </div>
        `;
    } else {
        const winnersHTML = sortedWinners.map((w, idx) => {
            const rank = idx + 1;
            const rankClass = `rank-circle-${rank}`;

            let detailsHTML = '';
            if (isGroup) {
                const teamNameText = w.teamName || '—';
                const subgroupName = w.studentName || 'TEAM A';

                detailsHTML = `
                    <div class="team-main">
                        ${escapeHTML(subgroupName.toUpperCase())}
                    </div>
                    <div class="team-subtitle">
                        ${escapeHTML(teamNameText.toUpperCase())}
                    </div>
                `;
            } else {
                const studentNameText = w.studentName || '—';
                const teamNameText = w.teamName || '—';
                detailsHTML = `
                    <h3>${escapeHTML(studentNameText.toUpperCase())}</h3>
                    <p>${escapeHTML(teamNameText.toUpperCase())}</p>
                `;
            }

            return `
                <div class="winner-card">
                    <div class="rank-circle ${rankClass}">
                        ${rank}
                    </div>
                    <div style="display:flex; flex-direction:column;">
                        ${detailsHTML}
                    </div>
                </div>
            `;
        }).join('');

        const finalWinnersHTML = winnersHTML || `<div style="text-align:center;padding:2.5rem 1.5rem;color:rgba(255,255,255,0.4);font-style:italic;">No standings recorded for this event.</div>`;

        return `
            <div class="poster-header" style="position: absolute; top: 60px; left: 40px; right: 40px; display: flex; flex-direction: column; gap: 6px; z-index: 10;">
                <span class="category">${escapeHTML(r.categoryName)}</span>
                <div class="program">${escapeHTML(r.programName)}</div>
                <div class="result-number">RESULT ${resultNumber}</div>
            </div>

            <div class="p-winners-list" style="position: absolute; bottom: 85px; left: 40px; right: 40px; z-index: 10;">
                ${finalWinnersHTML}
            </div>

            <div class="poster-footer">
                ${escapeHTML(madrasaName)}
            </div>
        `;
    }
}

function renderSingleResult(r) {
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
    const madrasaName = instituteDetails?.name || "Madrasa Results Portal";

    const posterInnerHTML = getPosterInnerHTML(r, bgId, templateId, resultNumber, madrasaName);

    list.innerHTML = `
        <div class="poster-container" id="container-${r.id}">
            
            <div class="result-poster" id="poster-${r.id}" style="background-image: url('../assets/poster-backgrounds/bg${bgId}.jpg')">
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
                <button class="btn-action-secondary btn-share" data-id="${r.id}">📤 Share Image</button>
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
    document.querySelector('.btn-download').onclick = () => {
        downloadPosterAsImage(r.id);
    };

    document.querySelector('.btn-share').onclick = () => {
        sharePosterContent(r.id);
    };
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
// Unified Off-screen 4:5 Aspect Ratio Canvas Drawer
// ─────────────────────────────────────────────
function generatePosterCanvas(r) {
    const bgId = cardBgMap[r.id] || 1;
    const templateId = cardTemplateMap[r.id] || 1;
    const madrasaName = (instituteDetails?.name || "Madrasa Results Portal").toUpperCase();
    const programName = (r.programName || "Program Standing").toUpperCase();
    const categoryName = (r.categoryName || "General Category").toUpperCase();

    // Sort all published results chronologically by publication time ascending to get index order number
    const sortedPublished = [...allResults].sort((a, b) => {
        const timeA = a.publishedAt?.seconds || 0;
        const timeB = b.publishedAt?.seconds || 0;
        return timeA - timeB;
    });

    const resultNumber = sortedPublished.findIndex(x => x.id === r.id) + 1;

    // Fetch top 3 winners
    const sorted = [...(r.marksData || [])]
        .filter(w => w.finalMark && w.finalMark > 0)
        .sort((a, b) => (b.finalMark || 0) - (a.finalMark || 0))
        .slice(0, 3);

    // Create high-res off-screen canvas (1200x1500 for exact 4:5 aspect ratio)
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 1500;
    const ctx = canvas.getContext('2d');

    // Draw preloaded background
    const bgImg = preloadedBgs[bgId];
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

    const isGroup = r.programType === 'group' || (r.programType === 'general' && r.registrationType === 'group');

    if (templateId === 2) {
        // Template 2: Card-Based Winners Layout (separated premium cards)
        // Header
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 88px "Cinzel", Georgia, serif';
        ctx.fillText(programName, 600, 210);

        ctx.fillStyle = '#fbbf24';
        ctx.font = '600 42px "Inter", sans-serif';
        ctx.fillText(categoryName, 600, 280);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.font = '600 36px "Inter", sans-serif';
        ctx.fillText(`RESULT ${resultNumber}`, 600, 340);

        // Cards
        const startY = 440;
        const rowHeight = 270;
        const medalMap = { 0: '🥇 1ST PLACE', 1: '🥈 2ND PLACE', 2: '🥉 3RD PLACE' };

        for (let i = 0; i < sorted.length; i++) {
            const w = sorted[i];
            const y = startY + (i * rowHeight);

            // Card body
            ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.beginPath();
            ctx.roundRect(100, y, 1000, 210, 45);
            ctx.fill();

            // Card border
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
            ctx.lineWidth = 3;
            ctx.stroke();

            // Rank Badge on left
            ctx.textAlign = 'left';
            ctx.fillStyle = '#fbbf24';
            ctx.font = 'bold 36px "Inter", sans-serif';
            ctx.fillText(medalMap[i], 140, y + 120);

            // Separator line
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(420, y + 35);
            ctx.lineTo(420, y + 175);
            ctx.stroke();

            // Details on right
            const nameText = isGroup ? (w.studentName || 'TEAM A') : (w.studentName || '—');
            const teamText = w.teamName || '—';

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 38px "Inter", sans-serif';
            ctx.fillText(nameText.toUpperCase(), 455, y + 78);

            ctx.fillStyle = '#cbd5e1';
            ctx.font = '600 24px "Inter", sans-serif';
            ctx.fillText(`TEAM: ${teamText.toUpperCase()}`, 455, y + 128);

            ctx.fillStyle = '#fbbf24';
            ctx.font = 'bold 20px "Inter", sans-serif';
            ctx.fillText(`INSTITUTE: ${madrasaName}`, 455, y + 170);
        }
    } else if (templateId === 3) {
        // Template 3: Editorial Layout
        // Header
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 96px "Cinzel", Georgia, serif';
        ctx.fillText(programName, 600, 220);

        ctx.fillStyle = '#fbbf24';
        ctx.font = '600 42px "Inter", sans-serif';
        ctx.fillText(categoryName, 600, 290);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.font = 'italic 48px "Playfair Display", Georgia, serif';
        ctx.fillText(`Result ${resultNumber}`, 600, 360);

        // Vertical elements
        const startY = 490;
        const rowHeight = 240;
        const ordinalMap = { 0: '1st Place', 1: '2nd Place', 2: '3rd Place' };

        for (let i = 0; i < sorted.length; i++) {
            const w = sorted[i];
            const y = startY + (i * rowHeight);

            // Draw thin divider line underneath except for last
            if (i < sorted.length - 1) {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(120, y + 195);
                ctx.lineTo(1080, y + 195);
                ctx.stroke();
            }

            // Left Rank
            ctx.textAlign = 'left';
            ctx.fillStyle = '#fbbf24';
            ctx.font = 'italic 42px "Playfair Display", Georgia, serif';
            ctx.fillText(ordinalMap[i], 120, y + 110);

            // Right Details
            const nameText = isGroup ? (w.studentName || 'TEAM A') : (w.studentName || '—');
            const teamText = w.teamName || '—';

            ctx.textAlign = 'right';
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 42px "Inter", sans-serif';
            ctx.fillText(nameText.toUpperCase(), 1080, y + 90);

            ctx.fillStyle = '#cbd5e1';
            ctx.font = '600 24px "Inter", sans-serif';
            ctx.fillText(teamText.toUpperCase(), 1080, y + 140);
        }
    } else if (templateId === 4) {
        // Template 4: Leaderboard Layout (Sports style table)
        // Header
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 88px "Cinzel", Georgia, serif';
        ctx.fillText(programName, 600, 200);

        ctx.fillStyle = '#fbbf24';
        ctx.font = '600 42px "Inter", sans-serif';
        ctx.fillText(categoryName, 600, 270);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.font = '600 34px "Inter", sans-serif';
        ctx.fillText(`RESULT ${resultNumber}`, 600, 325);

        // Leaderboard Table Outer Container Box
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.beginPath();
        ctx.roundRect(100, 410, 1000, 480, 32);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Table Header row background
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.beginPath();
        ctx.roundRect(100, 410, 1000, 95, { tl: 32, tr: 32, bl: 0, br: 0 });
        ctx.fill();

        // Table Header labels
        ctx.textAlign = 'left';
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 30px "Inter", sans-serif';
        ctx.fillText("RANK", 150, 470);
        ctx.fillText("PARTICIPANT", 320, 470);
        ctx.fillText("TEAM", 750, 470);

        // Table Rows
        const startY = 505;
        const rowHeight = 125;

        for (let i = 0; i < sorted.length; i++) {
            const w = sorted[i];
            const y = startY + (i * rowHeight);

            // Divider line
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(100, y);
            ctx.lineTo(1100, y);
            ctx.stroke();

            // Values
            ctx.fillStyle = i === 0 ? '#fbbf24' : '#ffffff';
            ctx.font = 'bold 36px "Inter", sans-serif';
            ctx.fillText(`${i + 1}`, 150, y + 80);

            const nameText = isGroup ? (w.studentName || 'TEAM A') : (w.studentName || '—');
            const teamText = w.teamName || '—';

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 32px "Inter", sans-serif';
            ctx.fillText(nameText.toUpperCase(), 320, y + 80);

            ctx.fillStyle = '#cbd5e1';
            ctx.font = '600 28px "Inter", sans-serif';
            ctx.fillText(teamText.toUpperCase(), 750, y + 80);
        }
    } else {
        // Template 1 (Current Design)
        ctx.textAlign = 'left';
        ctx.font = '600 52px "Inter", sans-serif';
        ctx.fillStyle = '#fbbf24';
        ctx.fillText(categoryName, 100, 180);

        ctx.font = 'bold 128px "Cinzel", Georgia, serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(programName, 100, 300);

        ctx.font = '600 52px "Inter", sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.fillText(`RESULT ${resultNumber}`, 100, 380);

        const startY = 480;
        const rowHeight = 230;

        for (let i = 0; i < sorted.length; i++) {
            const w = sorted[i];
            const y = startY + (i * rowHeight);

            ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.beginPath();
            ctx.roundRect(100, y, 1000, 170, 45);
            ctx.fill();

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
            ctx.lineWidth = 3;
            ctx.stroke();

            if (i === 0) {
                const goldGrad = ctx.createLinearGradient(135, y + 35, 235, y + 135);
                goldGrad.addColorStop(0, '#FFE082');
                goldGrad.addColorStop(1, '#FFB300');
                ctx.fillStyle = goldGrad;
            } else if (i === 1) {
                const silverGrad = ctx.createLinearGradient(135, y + 35, 235, y + 135);
                silverGrad.addColorStop(0, '#F1F5F9');
                silverGrad.addColorStop(1, '#94A3B8');
                ctx.fillStyle = silverGrad;
            } else {
                const bronzeGrad = ctx.createLinearGradient(135, y + 35, 235, y + 135);
                bronzeGrad.addColorStop(0, '#FFEDD5');
                bronzeGrad.addColorStop(1, '#D97706');
                ctx.fillStyle = bronzeGrad;
            }
            ctx.beginPath();
            ctx.arc(185, y + 85, 50, 0, Math.PI * 2);
            ctx.fill();

            ctx.font = 'bold 42px "Inter", sans-serif';
            ctx.fillStyle = '#000000';
            ctx.textAlign = 'center';
            ctx.fillText(`${i + 1}`, 185, y + 99);

            ctx.textAlign = 'left';
            if (isGroup) {
                const teamNameText = w ? w.teamName : '—';
                const subgroupName = w ? (w.studentName || 'TEAM A') : '—';

                ctx.font = 'bold 38px "Inter", sans-serif';
                ctx.fillStyle = '#ffffff';
                ctx.fillText(subgroupName.toUpperCase(), 270, y + 72);

                ctx.font = '600 24px "Inter", sans-serif';
                ctx.fillStyle = '#D4A017';
                ctx.fillText(teamNameText.toUpperCase(), 270, y + 122);
            } else {
                const studentNameText = w ? w.studentName : '—';
                const teamNameText = w ? (w.teamName || '—') : '—';

                ctx.font = 'bold 38px "Inter", sans-serif';
                ctx.fillStyle = '#ffffff';
                ctx.fillText(studentNameText.toUpperCase(), 270, y + 72);

                ctx.font = '600 24px "Inter", sans-serif';
                ctx.fillStyle = '#cbd5e1';
                ctx.fillText(teamNameText.toUpperCase(), 270, y + 122);
            }
        }
    }

    // Centered Madrasa Footer Branding
    ctx.textAlign = 'center';
    ctx.font = 'bold 44px "Inter", sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText(madrasaName, 600, 1430);

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

    const madrasaName = instituteDetails?.name || "Madrasa Results";

    // Fetch top 3 winners
    const sorted = [...(r.marksData || [])]
        .filter(w => w.finalMark && w.finalMark > 0)
        .sort((a, b) => (b.finalMark || 0) - (a.finalMark || 0))
        .slice(0, 3);

    const isGroup = r.programType === 'group' || (r.programType === 'general' && r.registrationType === 'group');
    const w1 = sorted[0] ? `${isGroup ? sorted[0].teamName : sorted[0].studentName} (${isGroup ? 'Group' : sorted[0].teamName})` : '—';
    const w2 = sorted[1] ? `${isGroup ? sorted[1].teamName : sorted[1].studentName} (${isGroup ? 'Group' : sorted[1].teamName})` : '—';
    const w3 = sorted[2] ? `${isGroup ? sorted[2].teamName : sorted[2].studentName} (${isGroup ? 'Group' : sorted[2].teamName})` : '—';

    const portalUrl = window.location.href;
    const shareText = `🏆 *${r.programName.toUpperCase()}* Result Published!\n\n🕌 *${madrasaName}*\n🏷️ Category: *${r.categoryName}*\n\n🥇 *1st:* ${w1}\n🥈 *2nd:* ${w2}\n🥉 *3rd:* ${w3}\n\n👉 Check official standings on the portal:\n${portalUrl}`;

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
