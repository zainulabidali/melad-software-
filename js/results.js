import { db, updateDashboardMetadata, computeDenseRanking, getCachedCategories } from './firebase.js';
import {
    collection, doc, getDocs, onSnapshot, serverTimestamp, updateDoc, deleteDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { normalizeClasses } from './categories.js';
import { openMarkEntryModal } from './mark-entry.js';

// ─────────────────────────────────────────────
// Point Systems & Badge Helpers
// ─────────────────────────────────────────────
const MEDALS = { 'First': '🥇', 'Second': '🥈', 'Third': '🥉', 'Participation': '🏅' };

// ─────────────────────────────────────────────
// Module State
// ─────────────────────────────────────────────
let resultsFilter = {
    categoryId: '',
    gender: '',
    stage: '',
    status: '',
    search: ''
};

let allPrograms = [];
let allResults = [];
let unsubscribeResults = null;

// ─────────────────────────────────────────────
// Init View
// ─────────────────────────────────────────────
export async function initResultsView(container, topActions) {
    if (!window.currentInstituteId) {
        container.innerHTML = '<div class="empty-state"><h3>Access Denied</h3><p>Please log in again.</p></div>';
        return;
    }

    if (unsubscribeResults) {
        unsubscribeResults();
        unsubscribeResults = null;
    }

    allPrograms = [];
    allResults = [];

    // Load Categories for filter
    let catOptions = '<option value="">All Categories</option>';
    try {
        const cats = await getCachedCategories();
        cats.forEach(c => {
            catOptions += `<option value="${c.id}">${window.escapeHTML(c.name)}</option>`;
        });
    } catch (e) { console.error(e); }

    topActions.innerHTML = `
        <div class="results-filter-toolbar">
            <div class="filter-item res-search-wrapper">
                <input type="text" id="resSearchFilter" class="form-input filter-input" placeholder="🔍 Search program..." />
            </div>
            <div class="filter-item res-cat-wrapper">
                <select id="resCatFilter" class="form-input filter-select">${catOptions}</select>
            </div>
            <div class="filter-item res-gender-wrapper">
                <select id="resGenderFilter" class="form-input filter-select">
                    <option value="">All Genders</option>
                    <option value="Boys">Boys</option>
                    <option value="Girls">Girls</option>
                    <option value="Mixed">Mixed</option>
                </select>
            </div>
            <div class="filter-item res-stage-wrapper">
                <select id="resStageFilter" class="form-input filter-select">
                    <option value="">All Stages</option>
                    <option value="Stage">Stage</option>
                    <option value="Off Stage">Off Stage</option>
                </select>
            </div>
            <div class="filter-item res-status-wrapper">
                <select id="resStatusFilter" class="form-input filter-select">
                    <option value="">All Statuses</option>
                    <option value="inprogress">In Progress</option>
                    <option value="submitted">Submitted</option>
                    <option value="published">Published</option>
                </select>
            </div>
            <div class="filter-item res-btn-wrapper">
                <button class="btn btn-primary btn-sm filter-btn" id="btnPublishAll" style="font-weight:700;">🚀 Publish All</button>
            </div>
        </div>
    `;

    // Main layout with side leaderboard
    container.innerHTML = `
        <div class="results-layout-container">
            <!-- Left Results Panel -->
            <div class="results-left-panel">
                <!-- Stats Grid -->
                <div class="grid results-stats-grid" id="resultsStatsGrid">
                    <div class="card" style="padding:0.75rem 1rem; border-color:#cbd5e1;">
                        <div style="font-size:0.72rem; font-weight:700; color:#64748b; text-transform:uppercase;">Pending</div>
                        <h2 style="font-size:1.8rem; font-weight:800; margin-top:0.25rem; color:#475569;" id="statPending">-</h2>
                    </div>
                    <div class="card" style="padding:0.75rem 1rem; border-color:#93c5fd; background:#f0f7ff;">
                        <div style="font-size:0.72rem; font-weight:700; color:#1d4ed8; text-transform:uppercase;">In Progress</div>
                        <h2 style="font-size:1.8rem; font-weight:800; margin-top:0.25rem; color:#1e40af;" id="statInProgress">-</h2>
                    </div>
                    <div class="card" style="padding:0.75rem 1rem; border-color:#ffedd5; background:#fff7ed;">
                        <div style="font-size:0.72rem; font-weight:700; color:#ea580c; text-transform:uppercase;">Submitted</div>
                        <h2 style="font-size:1.8rem; font-weight:800; margin-top:0.25rem; color:#c2410c;" id="statSubmitted">-</h2>
                    </div>
                    <div class="card" style="padding:0.75rem 1rem; border-color:#bbf7d0; background:#f0fdf4;">
                        <div style="font-size:0.72rem; font-weight:700; color:#16a34a; text-transform:uppercase;">Published</div>
                        <h2 style="font-size:1.8rem; font-weight:800; margin-top:0.25rem; color:#15803d;" id="statPublished">-</h2>
                    </div>
                </div>
 
                <div id="resultsGrid" style="width:100%; min-height:0;">
                    <div class="loader-container"><div class="spinner"></div></div>
                </div>
            </div>
 
            <!-- Right Leaderboard Panel -->
            <div class="results-right-panel">
                <button class="btn btn-primary" id="btnGoTopScorers" style="width:100%; padding:0.75rem 1rem; font-size:0.95rem; font-weight:700; display:flex; align-items:center; justify-content:center; gap:0.5rem; box-shadow:0 2px 4px rgba(0,0,0,0.05);">
                    🌟 Top Scorers
                </button>
                <div class="card" style="width:100%; padding:1.25rem; border-color:#cbd5e1;">
                    <h3 style="font-size:1.05rem; font-weight:800; color:#0f172a; display:flex; align-items:center; gap:0.4rem; margin-top:0; margin-bottom:0.15rem;">
                        🏆 Live Team Points
                    </h3>
                    <p style="font-size:0.75rem; color:#64748b; margin-bottom:1rem;">Live leaderboard aggregated from published results.</p>
                    <div style="overflow-x:auto;">
                        <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
                            <thead>
                                <tr style="border-bottom:2px solid #cbd5e1; text-align:left; background:#f8fafc;">
                                    <th style="padding:0.5rem; color:#475569; font-weight:700;">TEAM NAME</th>
                                    <th style="padding:0.5rem; color:#475569; font-weight:700; text-align:right; width:90px;">POINTS</th>
                                </tr>
                            </thead>
                            <tbody id="resLeaderboardBody">
                                <tr><td colspan="2" style="text-align:center; padding:1rem; color:#64748b;">Loading leaderboard...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.getElementById('btnGoTopScorers')?.addEventListener('click', () => window.navigateTo('top-scorers'));

    // Wire filters
    const searchFilter = document.getElementById('resSearchFilter');
    const catFilter = document.getElementById('resCatFilter');
    const genderFilter = document.getElementById('resGenderFilter');
    const stageFilter = document.getElementById('resStageFilter');
    const statusFilter = document.getElementById('resStatusFilter');
    const publishAllBtn = document.getElementById('btnPublishAll');

    searchFilter.oninput = (e) => {
        resultsFilter.search = e.target.value.toLowerCase().trim();
        renderResultsView();
    };

    catFilter.onchange = (e) => {
        resultsFilter.categoryId = e.target.value;
        renderResultsView();
    };

    genderFilter.onchange = (e) => {
        resultsFilter.gender = e.target.value;
        renderResultsView();
    };

    stageFilter.onchange = (e) => {
        resultsFilter.stage = e.target.value;
        renderResultsView();
    };

    statusFilter.onchange = (e) => {
        resultsFilter.status = e.target.value;
        renderResultsView();
    };

    publishAllBtn.onclick = () => triggerPublishAll();

    await loadResultsViewData();
}

// ─────────────────────────────────────────────
// Real-time Listeners & Sync
// ─────────────────────────────────────────────
async function loadResultsViewData() {
    try {
        // Load Programs
        const progsSnap = await getDocs(collection(db, "institutes", window.currentInstituteId, "programs"));
        allPrograms = progsSnap.docs.map(progDoc => {
            const p = progDoc.data();
            const pType = (p.programType || p.type || 'individual').toLowerCase();
            return {
                id: progDoc.id,
                programName: p.programName || 'Unnamed Program',
                programType: pType,
                type: pType === 'group' ? 'Group' : 'Individual',
                genderCategory: p.genderCategory || 'Mixed',
                programLocation: p.programLocation || 'Stage',
                categoryId: p.categoryId || '',
                categoryName: p.categoryName || p.categoryId || 'General',
                classId: p.classId || '',
                className: p.className || '',
                leaderboardEnabled: p.leaderboardEnabled !== false
            };
        });

        // Listen to Results real-time
        const resultsRef = collection(db, "institutes", window.currentInstituteId, "results");
        unsubscribeResults = onSnapshot(resultsRef, (snapshot) => {
            allResults = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
            renderResultsView();
        }, (err) => {
            console.error("Results snapshot listener error:", err);
        });

    } catch (err) {
        console.error("Error loading Results view:", err);
        const grid = document.getElementById('resultsGrid');
        if (grid) grid.innerHTML = '<div class="empty-state"><h3>Error</h3><p>Failed to load results.</p></div>';
    }
}

// ─────────────────────────────────────────────
// Render Results Grid & Stats & Leaderboard
// ─────────────────────────────────────────────
function renderResultsView() {
    // 1. Calculate Stats
    let countPending = 0;
    let countInProgress = 0;
    let countSubmitted = 0;
    let countPublished = 0;

    const resultsMap = new Map();
    allResults.forEach(r => {
        if (r.programId) resultsMap.set(r.programId, r);
    });

    allPrograms.forEach(p => {
        const res = resultsMap.get(p.id);
        if (!res) {
            countPending++;
        } else if (res.status === 'published') {
            countPublished++;
        } else if (res.markEntryStatus === 'submitted') {
            countSubmitted++;
        } else {
            countInProgress++;
        }
    });

    const pendingEl = document.getElementById('statPending');
    const inProgEl = document.getElementById('statInProgress');
    const subEl = document.getElementById('statSubmitted');
    const pubEl = document.getElementById('statPublished');

    if (pendingEl) pendingEl.textContent = countPending;
    if (inProgEl) inProgEl.textContent = countInProgress;
    if (subEl) subEl.textContent = countSubmitted;
    if (pubEl) pubEl.textContent = countPublished;

    // Enable/Disable Publish All button depending on Submitted count
    const publishAllBtn = document.getElementById('btnPublishAll');
    if (publishAllBtn) publishAllBtn.disabled = countSubmitted === 0;

    // 2. Dynamic Team Points Live Leaderboard
    const teamPoints = new Map();
    allResults.forEach(r => {
        if (r.status === 'published') {
            const prog = allPrograms.find(p => p.id === r.programId);
            if (prog && prog.leaderboardEnabled === false) return;

            if (Array.isArray(r.marksData) && r.marksData.length > 0) {
                r.marksData.forEach(w => {
                    if (w.teamId && w.teamId !== 'teamless' && w.teamName && w.teamName !== 'No Team' && w.totalPoints > 0) {
                        const current = teamPoints.get(w.teamName) || 0;
                        teamPoints.set(w.teamName, current + (w.totalPoints || 0));
                    }
                });
            } else if (Array.isArray(r.winners)) {
                // Fallback for backward compatibility
                r.winners.forEach(w => {
                    if (w.teamId && w.teamId !== 'teamless' && w.teamName && w.teamName !== 'No Team') {
                        const current = teamPoints.get(w.teamName) || 0;
                        teamPoints.set(w.teamName, current + (w.marks || 0));
                    }
                });
            }
        }
    });

    const teamsArray = [...teamPoints.entries()].map(([name, points]) => ({ name, points }));
    computeDenseRanking(teamsArray, t => t.points, 'rank');
    const leaderboardBody = document.getElementById('resLeaderboardBody');
    
    if (leaderboardBody) {
        if (teamsArray.length === 0) {
            leaderboardBody.innerHTML = `<tr><td colspan="2" style="text-align:center; padding:1.25rem; color:#94a3b8;">No published points yet.</td></tr>`;
        } else {
            leaderboardBody.innerHTML = teamsArray.map(item => {
                const rank = item.rank;
                const medalStyle = rank === 1 ? '🏆 ' : (rank === 2 ? '🥈 ' : (rank === 3 ? '🥉 ' : `#${rank} `));
                return `
                    <tr style="border-bottom:1px solid #f1f5f9; hover:background:#f8fafc;">
                        <td style="padding:0.6rem 0.5rem; font-weight:700; color:#1e293b; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                            ${medalStyle}${window.escapeHTML(item.name)}
                        </td>
                        <td style="padding:0.6rem 0.5rem; text-align:right; font-weight:800; color:#4338ca;">
                            ${item.points} pts
                        </td>
                    </tr>
                `;
            }).join('');
        }
    }

    // 3. Render Results Table
    const grid = document.getElementById('resultsGrid');
    if (!grid) return;
    grid.innerHTML = '';

    // Filter results
    const filteredResults = allResults.filter(r => {
        // Search filter (program name)
        if (resultsFilter.search) {
            const progName = (r.programName || '').toLowerCase();
            if (!progName.includes(resultsFilter.search)) return false;
        }
        // Category filter
        if (resultsFilter.categoryId && r.categoryId !== resultsFilter.categoryId) return false;
        // Gender filter
        if (resultsFilter.gender && r.genderCategory !== resultsFilter.gender) return false;
        // Stage filter
        if (resultsFilter.stage && r.programLocation !== resultsFilter.stage) return false;
        // Status filter
        if (resultsFilter.status) {
            const isDraft = r.status === 'draft';
            if (resultsFilter.status === 'published' && r.status !== 'published') return false;
            if (resultsFilter.status === 'submitted' && (r.status !== 'draft' || r.markEntryStatus !== 'submitted')) return false;
            if (resultsFilter.status === 'inprogress' && (r.status !== 'draft' || r.markEntryStatus === 'submitted')) return false;
        }
        return true;
    });

    if (filteredResults.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="margin-top:2rem; width:100%;">
                <div class="empty-state-icon">🏆</div>
                <h3>No Matching Results</h3>
                <p>Try adjusting your category or published filters.</p>
            </div>`;
        return;
    }

    grid.innerHTML = `
        <div style="overflow-x:auto; background:#fff; border:1px solid #cbd5e1; border-radius:12px; box-shadow:0 1px 3px rgba(0,0,0,0.05); width:100%;">
            <table style="width:100%; border-collapse:collapse; min-width:600px; font-size:0.875rem; color:#1e293b;">
                <thead>
                    <tr style="background:#f8fafc; border-bottom:2px solid #cbd5e1; text-align:left;">
                        <th style="padding:0.75rem 1rem; color:#475569; font-weight:700; width:60px; text-align:center;">#</th>
                        <th style="padding:0.75rem 1rem; color:#475569; font-weight:700;">Program Name</th>
                        <th style="padding:0.75rem 1rem; color:#475569; font-weight:700; width:150px;">Category</th>
                        <th style="padding:0.75rem 1rem; color:#475569; font-weight:700; width:160px; text-align:center;">Participants</th>
                        <th style="padding:0.75rem 1rem; color:#475569; font-weight:700; width:140px;">Status</th>
                        <th style="padding:0.75rem 1rem; color:#475569; font-weight:700; width:100px; text-align:center;">Actions</th>
                    </tr>
                </thead>
                <tbody id="resultsTableBody">
                </tbody>
            </table>
        </div>
    `;

    const tbody = document.getElementById('resultsTableBody');

    filteredResults.forEach((r, idx) => {
        const isDraft = r.status === 'draft';
        const statusBadge = isDraft 
            ? (r.markEntryStatus === 'submitted' 
                ? '<span class="badge" style="font-size:0.72rem; background:#fff7ed; color:#ea580c; border:1px solid #ffedd5;">Submitted (Draft)</span>' 
                : '<span class="badge" style="font-size:0.72rem; background:#eff6ff; color:#1d4ed8; border:1px solid #93c5fd;">In Progress (Draft)</span>')
            : '<span class="badge" style="font-size:0.72rem; background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0;">Published</span>';

        const partCount = r.participantCount || (Array.isArray(r.marksData) ? r.marksData.length : 0) || 0;
        const catText = r.className ? `${r.categoryName} (${r.className})` : r.categoryName;

        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #e2e8f0';
        tr.className = 'results-table-row';
        tr.innerHTML = `
            <td style="padding:0.75rem 1rem; text-align:center; font-weight:700; color:#64748b;">#${idx + 1}</td>
            <td style="padding:0.75rem 1rem; font-weight:700; color:#0f172a;">${window.escapeHTML(r.programName)}</td>
            <td style="padding:0.75rem 1rem; color:#475569;">${window.escapeHTML(catText)}</td>
            <td style="padding:0.75rem 1rem; text-align:center; font-weight:600; color:#475569;">${partCount} Participants</td>
            <td style="padding:0.75rem 1rem;">${statusBadge}</td>
            <td style="padding:0.75rem 1rem; text-align:center; position:relative;">
                <div style="position:relative; display:inline-block;" class="action-dropdown-container">
                    <button class="btn btn-secondary btn-sm btn-dropdown-toggle" style="padding:0.25rem 0.5rem; font-size:1.1rem; font-weight:bold; cursor:pointer; background:transparent; border:none; color:#475569; display:inline-block; line-height:1;">⋮</button>
                    <div class="action-dropdown-menu" style="position:absolute; right:0; top:100%; background:#fff; border:1px solid #cbd5e1; border-radius:8px; box-shadow:0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05); z-index:999; min-width:140px; display:none; flex-direction:column; padding:0.25rem 0;">
                        <button class="dropdown-item btn-open-result" style="text-align:left; padding:0.5rem 0.75rem; border:none; background:transparent; font-size:0.82rem; cursor:pointer; display:flex; align-items:center; gap:0.4rem; color:#1e293b;">👁️ Open Result</button>
                        ${isDraft && r.markEntryStatus === 'submitted' ? `<button class="dropdown-item btn-publish-result" style="text-align:left; padding:0.5rem 0.75rem; border:none; background:transparent; font-size:0.82rem; cursor:pointer; display:flex; align-items:center; gap:0.4rem; color:#1e293b;">🏆 Publish</button>` : ''}
                        ${!isDraft ? `<button class="dropdown-item btn-revoke-result" style="text-align:left; padding:0.5rem 0.75rem; border:none; background:transparent; font-size:0.82rem; cursor:pointer; display:flex; align-items:center; gap:0.4rem; color:#1e293b;">↩ Revoke</button>` : ''}
                    </div>
                </div>
            </td>
        `;

        // Wire Action toggle
        const toggleBtn = tr.querySelector('.btn-dropdown-toggle');
        const menu = tr.querySelector('.action-dropdown-menu');
        toggleBtn.onclick = (e) => {
            e.stopPropagation();
            // Close other menus first
            document.querySelectorAll('.action-dropdown-menu').forEach(m => {
                if (m !== menu) m.style.display = 'none';
            });
            const isVisible = menu.style.display === 'flex';
            menu.style.display = isVisible ? 'none' : 'flex';
        };

        // Wire Open Result
        tr.querySelector('.btn-open-result').onclick = (e) => {
            e.stopPropagation();
            menu.style.display = 'none';
            openResultDetailPopup(r);
        };

        // Wire Publish
        const pubBtn = tr.querySelector('.btn-publish-result');
        if (pubBtn) {
            pubBtn.onclick = async (e) => {
                e.stopPropagation();
                menu.style.display = 'none';
                const confirmed = await window.customConfirm("Publish this result to the public portal?");
                if (!confirmed) return;
                try {
                    await updateDoc(doc(db, "institutes", window.currentInstituteId, "results", r.id), {
                        status: 'published',
                        publishedAt: serverTimestamp()
                    });
                    await updateDashboardMetadata(window.currentInstituteId);
                    window.showToast("Result published successfully!", "success");
                } catch (err) {
                    console.error(err);
                    window.showToast("Failed to publish result.", "error");
                }
            };
        }

        // Wire Revoke
        const revBtn = tr.querySelector('.btn-revoke-result');
        if (revBtn) {
            revBtn.onclick = async (e) => {
                e.stopPropagation();
                menu.style.display = 'none';
                const confirmed = await window.customConfirm("Revoke this result from the public view?");
                if (!confirmed) return;
                try {
                    await updateDoc(doc(db, "institutes", window.currentInstituteId, "results", r.id), {
                        status: 'draft',
                        markEntryStatus: 'submitted'
                    });
                    await updateDashboardMetadata(window.currentInstituteId);
                    window.showToast("Result revoked successfully!", "success");
                } catch (err) {
                    console.error(err);
                    window.showToast("Failed to revoke result.", "error");
                }
            };
        }

        tbody.appendChild(tr);
    });

    // Global click outside to close dropdown
    if (!window.__resultsDropdownListenerAdded) {
        document.addEventListener('click', () => {
            document.querySelectorAll('.action-dropdown-menu').forEach(m => {
                m.style.display = 'none';
            });
        });
        window.__resultsDropdownListenerAdded = true;
    }
}

// ─────────────────────────────────────────────
// Open Result Detailed View Drawer/Popup
// ─────────────────────────────────────────────
function openResultDetailPopup(r) {
    const modal = document.getElementById('dynamicModal');
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');

    modalTitle.textContent = "🏆 Result Details";

    const modalEl = modal.querySelector('.modal');
    modalEl.classList.add('modal-result-detail');

    const handleClose = () => {
        modalEl.classList.remove('modal-result-detail');
        modal.classList.add('hidden');
    };

    const isDraft = r.status === 'draft';
    const statusBadge = isDraft 
        ? (r.markEntryStatus === 'submitted' 
            ? '<span class="badge" style="font-size:0.75rem; background:#fff7ed; color:#ea580c; border:1px solid #ffedd5;">Submitted (Draft)</span>' 
            : '<span class="badge" style="font-size:0.75rem; background:#eff6ff; color:#1d4ed8; border:1px solid #93c5fd;">In Progress (Draft)</span>')
        : '<span class="badge" style="font-size:0.75rem; background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0;">Published</span>';

    const partCount = r.participantCount || (Array.isArray(r.marksData) ? r.marksData.length : 0) || 0;
    const isGroup = r.programType === 'group';

    // Sort marksData descending strictly by finalMark for correct standings
    const sortedData = [...(r.marksData || [])].sort((a, b) => {
        const markA = a.finalMark || 0;
        const markB = b.finalMark || 0;
        return markB - markA;
    });

    // Compute rendered ranks dynamically (handling standard competition ties) using the centralized helper
    const scoredData = sortedData.filter(item => item.finalMark !== undefined && item.finalMark > 0);
    computeDenseRanking(scoredData, item => item.finalMark, 'renderedRank');

    sortedData.forEach(item => {
        if (!(item.finalMark !== undefined && item.finalMark > 0)) {
            item.renderedRank = null;
        }
    });

    let tableRowsHTML = '';
    if (sortedData.length === 0) {
        tableRowsHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem; color:#64748b;">No standings recorded for this program yet.</td></tr>`;
    } else {
        tableRowsHTML = sortedData.map(item => {
            const hasScore = item.finalMark !== undefined && item.finalMark > 0;
            
            // Format Position/Rank
            let positionHTML = '—';
            if (item.renderedRank !== null) {
                if (item.renderedRank === 1) positionHTML = '<span style="font-size:1.2rem;">🥇</span> 1st';
                else if (item.renderedRank === 2) positionHTML = '<span style="font-size:1.2rem;">🥈</span> 2nd';
                else if (item.renderedRank === 3) positionHTML = '<span style="font-size:1.2rem;">🥉</span> 3rd';
                else positionHTML = `${item.renderedRank}th`;
            }

            const displayName = item.studentName || item.groupName || item.name || '—';
            const teamDisplay = item.teamName || '—';
            const finalMark = hasScore ? item.finalMark : '—';
            const grade = hasScore ? (item.grade || '—') : '—';
            const points = hasScore ? `${item.totalPoints || 0}pts` : '—';

            return `
                <tr class="res-detail-table-row">
                    <td class="res-detail-td-rank">${positionHTML}</td>
                    <td class="res-detail-td-name">${window.escapeHTML(displayName)}</td>
                    <td class="res-detail-td-team">${window.escapeHTML(teamDisplay)}</td>
                    <td class="res-detail-td-mark">${finalMark}</td>
                    <td class="res-detail-td-grade">
                        ${grade !== '—' ? `<span class="badge" style="background:#e0e7ff; color:#4338ca; border:1px solid #c7d2fe; font-size:0.75rem; font-weight:700; padding:0.15rem 0.5rem;">${grade}</span>` : '—'}
                    </td>
                    <td class="res-detail-td-points">
                        ${points !== '—' ? `<span class="badge" style="background:#f0fdf4; color:#16a34a; border:1px solid #bbf7d0; font-size:0.75rem; font-weight:700; padding:0.15rem 0.5rem;">${points}</span>` : '—'}
                    </td>
                </tr>
            `;
        }).join('');
    }

    modalBody.innerHTML = `
        <div class="res-detail-container">
            <!-- Modern Compact Header Card -->
            <div class="res-detail-header-card">
                <div class="res-detail-header-row">
                    <div class="res-detail-title-group">
                        <h3 class="res-detail-title">${window.escapeHTML(r.programName)}</h3>
                        <span class="badge" style="background:#e0e7ff; color:#4338ca; border:1px solid #c7d2fe; font-size:0.82rem; font-weight:700; padding:0.25rem 0.65rem;">${window.escapeHTML(r.categoryName || 'General')}${r.className ? ` (${window.escapeHTML(r.className)})` : ''}</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:0.5rem;">
                        ${statusBadge}
                    </div>
                </div>
                <div class="res-detail-meta-grid">
                    <div><span style="color:#64748b; font-weight:500;">Type:</span> <span class="badge" style="background:#f1f5f9; color:#334155; border:1px solid #e2e8f0; font-size:0.78rem; font-weight:700;">${r.programType === 'group' ? '👥 Group' : '👤 Individual'}</span></div>
                    <div><span style="color:#64748b; font-weight:500;">Gender:</span> <strong style="color:#0f172a;">${window.escapeHTML(r.genderCategory || 'Mixed')}</strong></div>
                    <div><span style="color:#64748b; font-weight:500;">Stage:</span> <strong style="color:#0f172a;">📍 ${window.escapeHTML(r.programLocation || 'Stage')}</strong></div>
                    <div><span style="color:#64748b; font-weight:500;">Participants:</span> <strong style="color:#0f172a;">🎓 ${partCount} Entries</strong></div>
                </div>
            </div>

            <!-- Standings Table Container (Only this scrolls) -->
            <div class="res-detail-table-container">
                <table class="res-detail-table">
                    <thead>
                        <tr class="res-detail-table-header-row">
                            <th style="text-align:center; width:80px;">Rank</th>
                            <th>Contestant Name</th>
                            <th style="width:180px;">Team</th>
                            <th style="width:110px; text-align:center;">Avg Mark</th>
                            <th style="width:90px; text-align:center;">Grade</th>
                            <th style="width:90px; text-align:center;">Points</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRowsHTML}
                    </tbody>
                </table>
            </div>

            <!-- Footer Action Row -->
            <div class="res-detail-actions">
                <button type="button" class="btn btn-secondary" id="btnOpenResEdit" style="font-weight:700; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe;">✏️ Edit</button>
                <button type="button" class="btn btn-danger" id="btnOpenResDelete" style="font-weight:700; background:#fef2f2; color:#dc2626; border:1px solid #fecaca;">🗑️ Delete</button>
                <button type="button" class="btn btn-secondary" id="btnOpenResClose" style="min-width:90px; font-weight:700;">Close</button>
            </div>
        </div>
    `;

    modal.classList.remove('hidden');

    // Bind Close actions
    document.getElementById('closeDynamicModalBtn').onclick = handleClose;
    document.getElementById('btnOpenResClose').onclick = handleClose;

    // Bind Edit action
    const btnEdit = document.getElementById('btnOpenResEdit');
    if (btnEdit) {
        btnEdit.onclick = () => {
            const prog = allPrograms.find(p => p.id === r.programId);
            if (prog) {
                handleClose();
                openMarkEntryModal(prog);
            } else {
                window.showToast("Could not find the original program for this result.", "error");
            }
        };
    }

    // Bind Delete action
    const btnDelete = document.getElementById('btnOpenResDelete');
    if (btnDelete) {
        btnDelete.onclick = async () => {
            const confirmed = await window.customConfirm("Delete this result permanently?");
            if (!confirmed) return;

            try {
                handleClose();
                const batch = writeBatch(db);

                // 1. Purge competitions program name from assigned judges
                const judgesSnap = await getDocs(collection(db, "institutes", window.currentInstituteId, "judges"));
                judgesSnap.forEach(d => {
                    const j = d.data();
                    const jName = j.name;
                    const comps = Array.isArray(j.competitions) ? j.competitions : [];
                    
                    const wasAssigned = Array.isArray(r.judges) && r.judges.includes(jName);
                    if (wasAssigned && comps.includes(r.programName)) {
                        const newComps = comps.filter(c => c !== r.programName);
                        batch.update(d.ref, { competitions: newComps, updatedAt: serverTimestamp() });
                    }
                });

                // 2. Delete the result document itself
                const resRef = doc(db, "institutes", window.currentInstituteId, "results", r.id);
                batch.delete(resRef);

                await batch.commit();
                await updateDashboardMetadata(window.currentInstituteId);
                window.showToast("Result deleted permanently!", "success");
            } catch (err) {
                console.error("Error deleting result:", err);
                window.showToast(`Unable to delete: ${err.message || err}`, "error");
            }
        };
    }
}

// ─────────────────────────────────────────────
// Batch Publish All Action
// ─────────────────────────────────────────────
async function triggerPublishAll() {
    const submittedDrafts = allResults.filter(r => r.status === 'draft' && r.markEntryStatus === 'submitted');
    if (submittedDrafts.length === 0) {
        window.showToast("No submitted drafts available to publish.", "warning");
        return;
    }

    const confirmed = await window.customConfirm(`Are you sure you want to publish all ${submittedDrafts.length} submitted program results at once?`);
    if (!confirmed) return;

    const spinner = document.getElementById('resultsStatsGrid');
    const batch = writeBatch(db);

    try {
        submittedDrafts.forEach(r => {
            const docRef = doc(db, "institutes", window.currentInstituteId, "results", r.id);
            batch.update(docRef, {
                status: 'published',
                publishedAt: serverTimestamp()
            });
        });

        await batch.commit();
        await updateDashboardMetadata(window.currentInstituteId);
        window.showToast(`Successfully published all ${submittedDrafts.length} program results!`, "success");
    } catch (err) {
        console.error("Batch publish error:", err);
        window.showToast("Failed to batch publish results.", "error");
    }
}
