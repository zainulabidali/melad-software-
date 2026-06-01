import { db } from './firebase.js';
import {
    collection, getDocs, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { normalizeClasses } from './categories.js';

// ─────────────────────────────────────────────
// Module State
// ─────────────────────────────────────────────
let allCategories = [];
let allTeams = [];
let studentLookupMap = new Map(); // studentId -> studentDetails
let unsubscribeResults = null;
let computedScorers = []; // List of all students with points accumulated

let filters = {
    search: '',
    categoryId: '',
    teamId: '',
    gender: '',
    stage: '',
    status: ''
};

// ─────────────────────────────────────────────
// Init View
// ─────────────────────────────────────────────
export async function initTopScorersView(container, topActions) {
    if (!window.currentInstituteId) {
        container.innerHTML = '<div class="empty-state"><h3>Access Denied</h3><p>Please log in again.</p></div>';
        return;
    }

    if (unsubscribeResults) {
        unsubscribeResults();
        unsubscribeResults = null;
    }

    allCategories = [];
    allTeams = [];
    studentLookupMap.clear();
    computedScorers = [];

    // Clear topactions as we do not need action buttons there
    topActions.innerHTML = '';

    // Load Filters Options
    await loadStaticData();

    // Render Scaffolding
    let catOptions = '<option value="">All Categories</option>';
    allCategories.forEach(c => {
        catOptions += `<option value="${c.id}">${window.escapeHTML(c.name)}</option>`;
    });

    let teamOptions = '<option value="">All Teams</option>';
    allTeams.forEach(t => {
        teamOptions += `<option value="${t.id}">${window.escapeHTML(t.name)}</option>`;
    });

    container.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:1.25rem; width:100%;">
            
            <!-- Filters Toolbar -->
            <div class="top-scorers-filter-toolbar">
                <div class="filter-item ts-search-wrapper">
                    <input type="text" id="tsSearchInput" class="form-input filter-input" placeholder="🔍 Search by chest or name..." />
                </div>
                <div class="filter-item ts-cat-wrapper">
                    <select id="tsCatFilter" class="form-input filter-select">${catOptions}</select>
                </div>
                <div class="filter-item ts-gender-wrapper">
                    <select id="tsGenderFilter" class="form-input filter-select">
                        <option value="">All Genders</option>
                        <option value="Boys">Boys</option>
                        <option value="Girls">Girls</option>
                        <option value="Mixed">Mixed</option>
                    </select>
                </div>
                <div class="filter-item ts-stage-wrapper">
                    <select id="tsStageFilter" class="form-input filter-select">
                        <option value="">All Stages</option>
                        <option value="Stage">Stage Only</option>
                        <option value="Off Stage">Off Stage Only</option>
                    </select>
                </div>
                <div class="filter-item ts-status-wrapper">
                    <select id="tsTeamFilter" class="form-input filter-select">${teamOptions}</select>
                    <select id="tsStatusFilter" class="form-input filter-select" style="display:none;">
                        <option value="">All Statuses</option>
                    </select>
                </div>
            </div>

            <!-- Summary Cards Grid -->
            <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap:1rem; margin:0;">
                
                <!-- Card 1: Vocal of the Fest -->
                <div class="card" style="padding:1.25rem; border-color:#c7d2fe; background:linear-gradient(135deg, #f5f3ff 0%, #ffffff 100%); display:flex; flex-direction:column; gap:0.4rem; position:relative; overflow:hidden;">
                    <span style="font-size:2rem; position:absolute; right:0.5rem; top:0.5rem; opacity:0.18;">🎤</span>
                    <div style="font-size:0.72rem; font-weight:700; color:#4338ca; text-transform:uppercase; letter-spacing:0.05em;">🏆 Vocal of the Fest</div>
                    <div id="cardVocalBody" style="margin-top:0.25rem;">
                        <span style="color:#64748b; font-size:0.85rem; font-style:italic;">No stage points recorded.</span>
                    </div>
                </div>

                <!-- Card 2: Pen of the Fest -->
                <div class="card" style="padding:1.25rem; border-color:#fed7aa; background:linear-gradient(135deg, #fff7ed 0%, #ffffff 100%); display:flex; flex-direction:column; gap:0.4rem; position:relative; overflow:hidden;">
                    <span style="font-size:2rem; position:absolute; right:0.5rem; top:0.5rem; opacity:0.18;">🖋️</span>
                    <div style="font-size:0.72rem; font-weight:700; color:#c2410c; text-transform:uppercase; letter-spacing:0.05em;">🏆 Pen of the Fest</div>
                    <div id="cardPenBody" style="margin-top:0.25rem;">
                        <span style="color:#64748b; font-size:0.85rem; font-style:italic;">No off-stage points recorded.</span>
                    </div>
                </div>

                <!-- Card 3: Total Participants -->
                <div class="card" style="padding:1.25rem; border-color:#cbd5e1; display:flex; flex-direction:column; gap:0.2rem; justify-content:center;">
                    <div style="font-size:0.72rem; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:0.05em;">👥 Total Participants</div>
                    <h2 style="font-size:2rem; font-weight:850; margin:0.25rem 0 0 0; color:#1e293b;" id="cardTotalPart">0</h2>
                    <span style="font-size:0.7rem; color:#64748b; font-weight:600;">Scoring individual contestants</span>
                </div>

                <!-- Card 4: Highest Score -->
                <div class="card" style="padding:1.25rem; border-color:#cbd5e1; display:flex; flex-direction:column; gap:0.2rem; justify-content:center;">
                    <div style="font-size:0.72rem; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:0.05em;">⭐ Highest Score</div>
                    <h2 style="font-size:2rem; font-weight:850; margin:0.25rem 0 0 0; color:#1e293b;" id="cardHighScore">0 pts</h2>
                    <span style="font-size:0.7rem; color:#64748b; font-weight:600;">Contestant record score</span>
                </div>
            </div>

            <!-- Standings Table Card -->
            <div class="card" style="padding:1.25rem; border-color:#cbd5e1; width:100%; box-shadow:0 1px 3px rgba(0,0,0,0.05); min-height:0; display:flex; flex-direction:column;">
                <h3 style="font-size:1.05rem; font-weight:800; color:#0f172a; margin-top:0; margin-bottom:1rem; display:flex; align-items:center; gap:0.4rem;">
                    🏆 Contenders Rankings
                </h3>
                <div style="overflow-x:auto; background:#fff; border:1px solid #e2e8f0; border-radius:12px; width:100%;" id="tsTableContainer">
                    <!-- Table dynamically loaded -->
                </div>
            </div>
        </div>
    `;

    // Hook filters event listeners
    document.getElementById('tsSearchInput').oninput = (e) => {
        filters.search = e.target.value;
        renderContendersList();
    };

    document.getElementById('tsCatFilter').onchange = (e) => {
        filters.categoryId = e.target.value;
        renderContendersList();
    };

    document.getElementById('tsTeamFilter').onchange = (e) => {
        filters.teamId = e.target.value;
        renderContendersList();
    };

    document.getElementById('tsGenderFilter').onchange = (e) => {
        filters.gender = e.target.value;
        renderContendersList();
    };

    document.getElementById('tsStageFilter').onchange = (e) => {
        filters.stage = e.target.value;
        renderContendersList();
    };

    const statusFilter = document.getElementById('tsStatusFilter');
    if (statusFilter) {
        statusFilter.onchange = (e) => {
            filters.status = e.target.value;
            renderContendersList();
        };
    }

    // Subscribe to results live update
    subscribeResultsLive();
}

// ─────────────────────────────────────────────
// Load Static Filter Details
// ─────────────────────────────────────────────
async function loadStaticData() {
    const instId = window.currentInstituteId;
    try {
        // Categories
        const catSnap = await getDocs(collection(db, "institutes", instId, "categories"));
        allCategories = catSnap.docs.map(d => ({ id: d.id, name: d.data().name }));

        // Teams
        const teamSnap = await getDocs(collection(db, "institutes", instId, "teams"));
        allTeams = teamSnap.docs.map(d => ({ id: d.id, name: d.data().name }));

        // Students lookup mapping cache
        const stuSnap = await getDocs(collection(db, "institutes", instId, "students"));
        stuSnap.forEach(d => {
            const data = d.data();
            studentLookupMap.set(d.id, {
                studentId: d.id,
                studentName: data.name || '—',
                chestNumber: data.chestNumber || '—',
                gender: data.gender || 'Mixed',
                teamId: data.teamId || '',
                teamName: data.teamName || '—',
                categoryId: data.categoryId || '',
                categoryName: data.categoryName || 'General'
            });
        });

    } catch (e) {
        console.error("Static data load failure in Top Scorers:", e);
    }
}

// ─────────────────────────────────────────────
// Real-time Results Listener
// ─────────────────────────────────────────────
function subscribeResultsLive() {
    const instId = window.currentInstituteId;
    const resultsRef = collection(db, "institutes", instId, "results");

    unsubscribeResults = onSnapshot(resultsRef, (snapshot) => {
        const publishedResults = snapshot.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(r => r.status === 'published');

        recalculateScorers(publishedResults);
    });
}

// ─────────────────────────────────────────────
// Aggregation & Dynamic Calculations
// ─────────────────────────────────────────────
function recalculateScorers(publishedResults) {
    const scorersMap = new Map(); // studentId -> computedContenderObj

    publishedResults.forEach(r => {
        const pType = (r.programType || r.type || 'individual').toLowerCase();
        // Enforce strict scoring isolation rules: ONLY count individual programs
        if (pType !== 'individual') return;

        const isStage = r.programLocation === 'Stage';
        const marksList = Array.isArray(r.marksData) ? r.marksData : [];

        marksList.forEach(item => {
            // Must have studentId and scored points
            const stuId = item.studentId;
            if (!stuId) return;

            const pts = item.totalPoints || 0;
            if (pts <= 0) return;

            // Load student profile details
            let stu = studentLookupMap.get(stuId);
            if (!stu) {
                // Double Fallback for legacy registration maps
                stu = {
                    studentId: stuId,
                    studentName: item.studentName || '—',
                    chestNumber: item.chestNumber || '—',
                    gender: item.gender || r.genderCategory || 'Mixed',
                    teamId: item.teamId || '',
                    teamName: item.teamName || '—',
                    categoryId: r.categoryId || '',
                    categoryName: r.categoryName || 'General'
                };
            }

            // Resolve chestNumber with absolute fallback (PART 4 & PART 5)
            let chestNumber = stu.chestNumber || item.chestNumber || '—';
            if (chestNumber === '—' || !chestNumber || chestNumber === 'undefined' || chestNumber === 'null') {
                const mappedStudent = studentLookupMap.get(stuId);
                if (mappedStudent && mappedStudent.chestNumber && mappedStudent.chestNumber !== '—') {
                    chestNumber = mappedStudent.chestNumber;
                } else {
                    chestNumber = '—';
                }
            }
            stu.chestNumber = chestNumber;

            if (!scorersMap.has(stuId)) {
                scorersMap.set(stuId, {
                    ...stu,
                    stagePoints: 0,
                    offStagePoints: 0,
                    totalPoints: 0
                });
            }

            const contender = scorersMap.get(stuId);
            contender.totalPoints += pts;
            
            if (isStage) {
                contender.stagePoints += pts;
            } else {
                contender.offStagePoints += pts;
            }
        });
    });

    computedScorers = [...scorersMap.values()];

    // Run summary card calculations
    calculateFestContenders();
    
    // Trigger render main grid
    renderContendersList();
}

// ─────────────────────────────────────────────
// Summary Cards & Ties Handling
// ─────────────────────────────────────────────
function calculateFestContenders() {
    const cardVocal = document.getElementById('cardVocalBody');
    const cardPen = document.getElementById('cardPenBody');
    const cardTotalPart = document.getElementById('cardTotalPart');
    const cardHighScore = document.getElementById('cardHighScore');

    if (!cardVocal || !cardPen) return;

    // 1. Total Scouring Participants Count
    const scoringCount = computedScorers.filter(x => x.totalPoints > 0).length;
    cardTotalPart.textContent = scoringCount;

    // 2. Highest Score
    let highScore = 0;
    computedScorers.forEach(x => {
        if (x.totalPoints > highScore) highScore = x.totalPoints;
    });
    cardHighScore.textContent = `${highScore} pts`;

    // 3. Vocal of the Fest (Stage Only)
    let maxStagePoints = 0;
    computedScorers.forEach(x => {
        if (x.stagePoints > maxStagePoints) maxStagePoints = x.stagePoints;
    });

    if (maxStagePoints > 0) {
        const vocalWinners = computedScorers.filter(x => x.stagePoints === maxStagePoints);
        
        cardVocal.innerHTML = vocalWinners.map(w => `
            <div style="display:flex; flex-direction:column; border-bottom:1px solid #f1f5f9; padding-bottom:0.4rem; margin-bottom:0.4rem;">
                <span style="font-weight:800; font-size:1.15rem; color:#1e1b4b;">${window.escapeHTML(w.studentName)}</span>
                <div style="font-size:0.75rem; color:#4338ca; font-weight:700; margin-top:0.1rem; display:flex; gap:0.5rem;">
                    <span>#${window.escapeHTML(w.chestNumber)}</span>
                    <span>·</span>
                    <span>${window.escapeHTML(w.teamName)}</span>
                    <span style="margin-left:auto; background:#eff6ff; padding:0.05rem 0.4rem; border-radius:4px; border:1px solid #bfdbfe;">${w.stagePoints} pts</span>
                </div>
            </div>
        `).join('');
    } else {
        cardVocal.innerHTML = `<span style="color:#64748b; font-size:0.85rem; font-style:italic;">No stage points recorded.</span>`;
    }

    // 4. Pen of the Fest (Off Stage Only)
    let maxOffStagePoints = 0;
    computedScorers.forEach(x => {
        if (x.offStagePoints > maxOffStagePoints) maxOffStagePoints = x.offStagePoints;
    });

    if (maxOffStagePoints > 0) {
        const penWinners = computedScorers.filter(x => x.offStagePoints === maxOffStagePoints);
        
        cardPen.innerHTML = penWinners.map(w => `
            <div style="display:flex; flex-direction:column; border-bottom:1px solid #f1f5f9; padding-bottom:0.4rem; margin-bottom:0.4rem;">
                <span style="font-weight:800; font-size:1.15rem; color:#1e1b4b;">${window.escapeHTML(w.studentName)}</span>
                <div style="font-size:0.75rem; color:#c2410c; font-weight:700; margin-top:0.1rem; display:flex; gap:0.5rem;">
                    <span>#${window.escapeHTML(w.chestNumber)}</span>
                    <span>·</span>
                    <span>${window.escapeHTML(w.teamName)}</span>
                    <span style="margin-left:auto; background:#fff7ed; padding:0.05rem 0.4rem; border-radius:4px; border:1px solid #ffedd5;">${w.offStagePoints} pts</span>
                </div>
            </div>
        `).join('');
    } else {
        cardPen.innerHTML = `<span style="color:#64748b; font-size:0.85rem; font-style:italic;">No off-stage points recorded.</span>`;
    }
}

// ─────────────────────────────────────────────
// Dynamic Rendering and Filtering
// ─────────────────────────────────────────────
function renderContendersList() {
    const container = document.getElementById('tsTableContainer');
    if (!container) return;

    // Apply active Search and Select filters
    let filtered = computedScorers.filter(c => {
        // Search
        if (filters.search) {
            const query = filters.search.trim().toLowerCase();
            const chest = (c.chestNumber || '').toLowerCase();
            const name = (c.studentName || '').toLowerCase();
            if (!chest.includes(query) && !name.includes(query)) return false;
        }

        // Category
        if (filters.categoryId && c.categoryId !== filters.categoryId) return false;

        // Team
        if (filters.teamId && c.teamId !== filters.teamId) return false;

        // Gender
        if (filters.gender && c.gender !== filters.gender) return false;

        // Stage
        if (filters.stage === 'Stage' && c.stagePoints <= 0) return false;
        if (filters.stage === 'Off Stage' && c.offStagePoints <= 0) return false;

        return true;
    });

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="padding:3rem 1.25rem;">
                <div class="empty-state-icon">🏆</div>
                <h3>No top scorers available yet.</h3>
                <p style="color:#64748b;">Try adjusting filters or publishing results.</p>
            </div>
        `;
        return;
    }

    // Sort list by active stage or total points
    filtered.sort((a, b) => {
        if (filters.stage === 'Stage') {
            return b.stagePoints - a.stagePoints;
        } else if (filters.stage === 'Off Stage') {
            return b.offStagePoints - a.offStagePoints;
        } else {
            return b.totalPoints - a.totalPoints;
        }
    });

    // Compute active standard competition ranks handling ties
    for (let i = 0; i < filtered.length; i++) {
        const item = filtered[i];
        const pts = filters.stage === 'Stage' ? item.stagePoints 
                   : (filters.stage === 'Off Stage' ? item.offStagePoints : item.totalPoints);
        
        if (i > 0) {
            const prev = filtered[i - 1];
            const prevPts = filters.stage === 'Stage' ? prev.stagePoints 
                           : (filters.stage === 'Off Stage' ? prev.offStagePoints : prev.totalPoints);
            
            if (pts === prevPts) {
                item.rank = prev.rank;
            } else {
                item.rank = i + 1;
            }
        } else {
            item.rank = 1;
        }
    }

    container.innerHTML = `
        <table style="width:100%; border-collapse:collapse; min-width:700px; font-size:0.82rem; color:#1e293b;">
            <thead>
                <tr style="background:#f8fafc; border-bottom:2px solid #cbd5e1; text-align:left;">
                    <th style="padding:0.5rem 0.75rem; color:#475569; font-weight:700; width:80px; text-align:center;">Rank</th>
                    <th style="padding:0.5rem 0.75rem; color:#475569; font-weight:700; width:90px; text-align:center;">Chest No</th>
                    <th style="padding:0.5rem 0.75rem; color:#475569; font-weight:700;">Student Name</th>
                    <th style="padding:0.5rem 0.75rem; color:#475569; font-weight:700; width:90px;">Gender</th>
                    <th style="padding:0.5rem 0.75rem; color:#475569; font-weight:700; width:150px;">Team Name</th>
                    <th style="padding:0.5rem 0.75rem; color:#475569; font-weight:700; width:120px;">Category</th>
                    <th style="padding:0.5rem 0.75rem; color:#475569; font-weight:700; width:130px; text-align:center;">Stage (Points)</th>
                    <th style="padding:0.5rem 0.75rem; color:#475569; font-weight:700; width:100px; text-align:center;">Total Points</th>
                </tr>
            </thead>
            <tbody>
                ${filtered.map(c => {
                    let rankHTML = `Rank #${c.rank}`;
                    if (c.rank === 1) rankHTML = '<span style="font-size:1.1rem;">🥇</span> #1';
                    else if (c.rank === 2) rankHTML = '<span style="font-size:1.1rem;">🥈</span> #2';
                    else if (c.rank === 3) rankHTML = '<span style="font-size:1.1rem;">🥉</span> #3';

                    const displayedPoints = filters.stage === 'Stage' ? c.stagePoints 
                                         : (filters.stage === 'Off Stage' ? c.offStagePoints : c.totalPoints);

                    let displayChest = c.chestNumber || '—';
                    if (displayChest === 'undefined' || displayChest === 'null') displayChest = '—';

                    return `
                        <tr style="border-bottom:1px solid #e2e8f0; hover:background:#f8fafc;">
                            <td style="padding:0.5rem 0.75rem; text-align:center; font-weight:800; color:#475569;">${rankHTML}</td>
                            <td style="padding:0.5rem 0.75rem; text-align:center; font-weight:800; color:#0f172a;">${window.escapeHTML(displayChest)}</td>
                            <td style="padding:0.5rem 0.75rem; font-weight:700; color:#1e293b;">${window.escapeHTML(c.studentName)}</td>
                            <td style="padding:0.5rem 0.75rem; color:#475569; font-weight:600;">${window.escapeHTML(c.gender)}</td>
                            <td style="padding:0.5rem 0.75rem; color:#475569; font-weight:600;">${window.escapeHTML(c.teamName)}</td>
                            <td style="padding:0.5rem 0.75rem; color:#64748b;">${window.escapeHTML(c.categoryName)}</td>
                            <td style="padding:0.5rem 0.75rem; text-align:center; color:#64748b;">
                                <div style="display:flex; flex-direction:column; gap:0.05rem; font-size:0.72rem;">
                                    <span>Stage: <strong>${c.stagePoints}</strong></span>
                                    <span>Off-stage: <strong>${c.offStagePoints}</strong></span>
                                </div>
                            </td>
                            <td style="padding:0.5rem 0.75rem; text-align:center; font-weight:850; color:#4338ca; font-size:0.9rem;">
                                ${displayedPoints} pts
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}
