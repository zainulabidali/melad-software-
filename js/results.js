import { db, updateDashboardMetadata, computeDenseRanking, getCachedCategories, getCachedPrograms } from './firebase.js';
import {
    collection, doc, getDocs, onSnapshot, serverTimestamp, updateDoc, deleteDoc, writeBatch, setDoc, getDoc
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

    // Main layout with custom tabs
    container.innerHTML = `
        <div class="results-tab-bar" style="display: flex; gap: 1rem; border-bottom: 2px solid #e2e8f0; margin-bottom: 1.5rem; padding-bottom: 0.5rem; width: 100%;">
            <button class="tab-btn active" id="tabProgramResults" style="background: none; border: none; font-size: 1rem; font-weight: 800; color: #4f46e5; border-bottom: 3px solid #4f46e5; padding-bottom: 0.5rem; cursor: pointer; transition: all 0.2s; font-family: inherit;">📊 Program Results</button>
            <button class="tab-btn" id="tabClassAwards" style="background: none; border: none; font-size: 1rem; font-weight: 800; color: #64748b; padding-bottom: 0.5rem; cursor: pointer; transition: all 0.2s; font-family: inherit;">🏆 Class Awards</button>
        </div>

        <div id="programResultsContent" style="display: block; width: 100%;">
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
        </div>

        <div id="classAwardsContent" style="display: none; width: 100%;">
            <!-- Class Awards Content Injected Here -->
        </div>
    `;

    document.getElementById('btnGoTopScorers')?.addEventListener('click', () => window.navigateTo('top-scorers'));

    // Wire tab switching
    const tabProgramResults = document.getElementById('tabProgramResults');
    const tabClassAwards = document.getElementById('tabClassAwards');
    const programResultsContent = document.getElementById('programResultsContent');
    const classAwardsContent = document.getElementById('classAwardsContent');

    tabProgramResults.onclick = () => {
        tabProgramResults.classList.add('active');
        tabProgramResults.style.color = '#4f46e5';
        tabProgramResults.style.borderBottom = '3px solid #4f46e5';
        tabClassAwards.classList.remove('active');
        tabClassAwards.style.color = '#64748b';
        tabClassAwards.style.borderBottom = 'none';

        programResultsContent.style.display = 'block';
        classAwardsContent.style.display = 'none';
        topActions.style.display = 'flex';
    };

    tabClassAwards.onclick = async () => {
        tabClassAwards.classList.add('active');
        tabClassAwards.style.color = '#4f46e5';
        tabClassAwards.style.borderBottom = '3px solid #4f46e5';
        tabProgramResults.classList.remove('active');
        tabProgramResults.style.color = '#64748b';
        tabProgramResults.style.borderBottom = 'none';

        programResultsContent.style.display = 'none';
        classAwardsContent.style.display = 'block';
        topActions.style.display = 'none';

        await initClassAwardsUI(classAwardsContent);
    };

    // Wire filters
    const searchFilter = document.getElementById('resSearchFilter');
    const catFilter = document.getElementById('resCatFilter');
    const genderFilter = document.getElementById('resGenderFilter');
    const stageFilter = document.getElementById('resStageFilter');
    const statusFilter = document.getElementById('resStatusFilter');
    const publishAllBtn = document.getElementById('btnPublishAll');

    searchFilter.oninput = debounce((e) => {
        resultsFilter.search = e.target.value.toLowerCase().trim();
        renderResultsView();
    }, 200);

    window.currentViewCleanup = () => {
        if (unsubscribeResults) {
            unsubscribeResults();
            unsubscribeResults = null;
        }
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
        // Load Programs from Cache
        const cachedProgs = await getCachedPrograms(window.currentInstituteId);
        allPrograms = cachedProgs.map(p => {
            const pType = (p.programType || p.type || 'individual').toLowerCase();
            return {
                id: p.id,
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

    const showGrade = r.gradeMode !== 'none';
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
            
            // Extract and clean Code Letter
            const rawCodeLetter = item.codeLetter;
            let codeLetterDisplay = '';
            if (rawCodeLetter !== undefined && rawCodeLetter !== null) {
                const valStr = String(rawCodeLetter).trim();
                const valLower = valStr.toLowerCase();
                if (valStr !== '' && 
                    valLower !== 'n/a' && 
                    valLower !== '-' && 
                    valLower !== 'none' && 
                    valLower !== 'null' && 
                    valLower !== 'undefined') {
                    codeLetterDisplay = valStr;
                }
            }

            const teamDisplay = item.teamName || '—';
            const finalMark = hasScore ? item.finalMark : '—';
            const grade = (showGrade && hasScore) ? (item.grade || '') : '';
            const points = hasScore ? `${item.totalPoints || 0}pts` : '—';

            return `
                <tr class="res-detail-table-row">
                    <td class="res-detail-td-rank">${positionHTML}</td>
                    <td class="res-detail-td-name">${window.escapeHTML(displayName)}</td>
                    <td class="res-detail-td-code">${window.escapeHTML(codeLetterDisplay)}</td>
                    <td class="res-detail-td-team">${window.escapeHTML(teamDisplay)}</td>
                    <td class="res-detail-td-mark">${finalMark}</td>
                    <td class="res-detail-td-grade">
                        ${(showGrade && grade && grade !== '—') ? `<span class="badge" style="background:#e0e7ff; color:#4338ca; border:1px solid #c7d2fe; font-size:0.75rem; font-weight:700; padding:0.15rem 0.5rem;">${grade}</span>` : ''}
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
                            <th style="width:100px;">Code Letter</th>
                            <th style="width:180px;">Team</th>
                            <th style="width:110px; text-align:center;">Avg Mark</th>
                            <th style="width:90px; text-align:center;">${showGrade ? 'Grade' : ''}</th>
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
                    const compIds = Array.isArray(j.competitionIds) ? j.competitionIds : [];
                    
                    const wasAssigned = Array.isArray(r.judges) && r.judges.includes(jName);
                    if (wasAssigned && comps.includes(r.programName)) {
                        const newComps = comps.filter(c => c !== r.programName);
                        const newCompIds = compIds.filter(id => id !== r.programId);
                        batch.update(d.ref, { 
                            competitions: newComps, 
                            competitionIds: newCompIds, 
                            updatedAt: serverTimestamp() 
                        });
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

function debounce(fn, ms) {
    let t = null;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
}

// ─────────────────────────────────────────────
// Class Awards Management UI and Logic
// ─────────────────────────────────────────────
async function initClassAwardsUI(container) {
    container.innerHTML = `
        <div class="loader-container"><div class="spinner"></div></div>
    `;

    try {
        const instId = window.currentInstituteId;
        const categories = await getCachedCategories(instId);
        
        // Extract all unique classes
        const allClasses = [];
        const seenClassIds = new Set();
        categories.forEach(cat => {
            const normalized = normalizeClasses(cat.classes);
            normalized.forEach(cls => {
                if (!seenClassIds.has(cls.id)) {
                    seenClassIds.add(cls.id);
                    allClasses.push(cls);
                }
            });
        });
        allClasses.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

        // Load all students once for quick searching/filtering
        const studentsSnap = await getDocs(collection(db, "institutes", instId, "students"));
        const allStudents = studentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Render main layout
        container.innerHTML = `
            <style>
                .class-awards-container {
                    max-width: 800px;
                    margin: 0 auto;
                    display: flex;
                    flex-direction: column;
                    gap: 1.5rem;
                    font-family: 'Inter', sans-serif;
                }
                .ca-config-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
                    gap: 1.25rem;
                }
                .search-student-dropdown {
                    position: absolute;
                    width: 100%;
                    max-height: 350px;
                    overflow-y: auto;
                    -webkit-overflow-scrolling: touch;
                    overscroll-behavior: contain;
                    background: #ffffff;
                    border: 1px solid #cbd5e1;
                    border-radius: 8px;
                    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05);
                    z-index: 1000;
                    margin-top: 4px;
                    display: none;
                }
                .selected-student-card {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    background: #f8fafc;
                    border: 1px solid #cbd5e1;
                    border-radius: 10px;
                    padding: 0.6rem 1rem;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.02);
                }
            </style>

            <div class="class-awards-container">
                <!-- Info Card -->
                <div class="card" style="padding: 1.25rem; border-color: #cbd5e1; background: #ffffff; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
                    <div>
                        <h3 style="margin: 0; font-size: 1.15rem; font-weight: 800; color: #0f172a; display: flex; align-items: center; gap: 0.5rem;">
                            🏆 Class Awards Management
                        </h3>
                        <p style="margin: 0.25rem 0 0 0; font-size: 0.82rem; color: #64748b; font-weight: 500;">
                            Assign winners for Class-wise Academic, Attendance, and Custom awards by Class / Standard.
                        </p>
                    </div>
                    <button type="button" id="btnOtherEntry" class="btn btn-secondary" style="font-weight: 700; border-radius: 8px; font-size: 0.85rem; padding: 0.5rem 1rem; background: #f8fafc; border-color: #cbd5e1; color: #1e293b; display: flex; align-items: center; gap: 0.4rem;">
                        ➕ Other Entry
                    </button>
                </div>

                <!-- Config Card -->
                <div class="card" style="padding: 1.25rem; border-color: #cbd5e1; background: #ffffff; border-radius: 12px; display: flex; flex-direction: column; gap: 1rem;">
                    <div class="ca-config-grid">
                        <div class="form-group" style="margin: 0;">
                            <label class="form-label" style="font-weight: 700; font-size: 0.85rem; color: #475569;">1. Award Class / Standard *</label>
                            <select id="caClassSelect" class="form-input" style="height: 40px; margin-top: 0.25rem;">
                                <option value="">Select Award Class...</option>
                                ${allClasses.map(cls => `<option value="${cls.id}" data-name="${window.escapeHTML(cls.name)}">${window.escapeHTML(cls.name)}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group" style="margin: 0;">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <label class="form-label" style="font-weight: 700; font-size: 0.85rem; color: #475569; margin: 0;">2. Award Type *</label>
                                <button type="button" id="btnManageAwardTypes" style="background:none; border:none; color:#4f46e5; font-size:0.75rem; font-weight:700; cursor:pointer; padding:0; display:flex; align-items:center; gap:0.25rem;">
                                    ⚙️ Manage
                                </button>
                            </div>
                            <select id="caAwardTypeSelect" class="form-input" style="height: 40px; margin-top: 0.25rem;">
                                <!-- Dynamically loaded options -->
                            </select>
                        </div>
                    </div>
                </div>

                <!-- Winners Card -->
                <div id="caWinnersCard" class="card" style="padding: 1.5rem; border-color: #cbd5e1; background: #ffffff; border-radius: 12px; display: none; flex-direction: column; gap: 1.25rem;">
                    <h4 style="margin: 0; font-size: 0.95rem; font-weight: 800; color: #1e1b4b; border-bottom: 1.5px solid #f1f5f9; padding-bottom: 0.5rem;">
                        🏆 Set Winners for <span id="caConfigLabel" style="color: #4f46e5;">Class • Type</span>
                    </h4>

                    <!-- 1st Place -->
                    <div class="form-group" style="margin: 0; position: relative;" id="caFirstPlaceContainer">
                        <label class="form-label" style="font-weight: 700; color: #16a34a; font-size: 0.85rem;">🥇 1st Place Winners *</label>
                        <div id="caFirstPlaceArea" style="margin-top: 0.35rem;">
                            <!-- Search input or selected cards dynamically injected -->
                        </div>
                    </div>

                    <!-- 2nd Place -->
                    <div class="form-group" style="margin: 0; position: relative;" id="caSecondPlaceContainer">
                        <label class="form-label" style="font-weight: 700; color: #ea580c; font-size: 0.85rem;">🥈 2nd Place Winners *</label>
                        <div id="caSecondPlaceArea" style="margin-top: 0.35rem;">
                            <!-- Search input or selected cards dynamically injected -->
                        </div>
                    </div>

                    <!-- 3rd Place -->
                    <div class="form-group" style="margin: 0; position: relative;" id="caThirdPlaceContainer">
                        <label class="form-label" style="font-weight: 700; color: #b45309; font-size: 0.85rem;">🥉 3rd Place Winners (Optional)</label>
                        <div id="caThirdPlaceArea" style="margin-top: 0.35rem;">
                            <!-- Search input or selected cards dynamically injected -->
                        </div>
                    </div>

                    <!-- Save Actions -->
                    <div style="display: flex; gap: 0.75rem; justify-content: flex-end; border-top: 1px solid #f1f5f9; padding-top: 1.25rem;">
                        <button class="btn btn-primary" id="btnSaveClassAwards" style="min-height: 40px; font-weight: 700; min-width: 140px; border-radius: 8px;">
                            💾 Save Selections
                        </button>
                    </div>
                </div>
            </div>
        `;

        const classSelect = document.getElementById('caClassSelect');
        const awardTypeSelect = document.getElementById('caAwardTypeSelect');
        const winnersCard = document.getElementById('caWinnersCard');
        const configLabel = document.getElementById('caConfigLabel');
        const firstPlaceArea = document.getElementById('caFirstPlaceArea');
        const secondPlaceArea = document.getElementById('caSecondPlaceArea');
        const thirdPlaceArea = document.getElementById('caThirdPlaceArea');
        const saveBtn = document.getElementById('btnSaveClassAwards');

        let selectedClassId = '';
        let selectedClassName = '';
        let selectedAwardTypeId = '';
        let selectedAwardTypeName = '';
        let classStudents = [];

        let firstPlaceWinners = [];
        let secondPlaceWinners = [];
        let thirdPlaceWinners = [];

        let awardTypes = [
            { id: "attendance", name: "Attendance" },
            { id: "examination", name: "Examination" }
        ];

        const loadAwardTypesConfig = async () => {
            try {
                const configSnap = await getDoc(doc(db, "institutes", instId, "metadata", "awardTypesConfig"));
                if (configSnap.exists()) {
                    const data = configSnap.data();
                    if (Array.isArray(data.awardTypes)) {
                        awardTypes = data.awardTypes;
                    }
                }
            } catch (err) {
                console.error("Error loading award types:", err);
            }
        };

        const renderAwardTypeSelect = () => {
            let html = '<option value="">Select Award Type...</option>';
            awardTypes.forEach(t => {
                html += `<option value="${t.id}" data-name="${window.escapeHTML(t.name)}">${window.escapeHTML(t.name)}</option>`;
            });
            awardTypeSelect.innerHTML = html;
            if (selectedAwardTypeId) {
                awardTypeSelect.value = selectedAwardTypeId;
            }
        };

        const openManageAwardTypesModal = () => {
            const overlay = document.createElement('div');
            overlay.className = 'custom-modal-overlay';
            overlay.style.opacity = '1';

            const dialog = document.createElement('div');
            dialog.className = 'custom-modal-dialog';
            dialog.style.transform = 'scale(1)';
            dialog.style.maxWidth = '480px';

            const renderModalContent = () => {
                dialog.innerHTML = `
                    <div class="custom-modal-header" style="margin-bottom:1rem;">
                        <div class="custom-modal-icon" style="background:rgba(79, 70, 229, 0.08); color:#4f46e5;">⚙️</div>
                        <div>
                            <h3 class="custom-modal-title">Manage Award Types</h3>
                            <p class="custom-modal-message" style="font-size:0.8rem;">Add, rename, or delete custom award categories.</p>
                        </div>
                    </div>

                    <div style="max-height:220px; overflow-y:auto; margin-bottom:1.25rem; border:1px solid #e2e8f0; border-radius:8px; padding:0.5rem;">
                        ${awardTypes.map(t => `
                            <div style="display:flex; justify-content:space-between; align-items:center; padding:0.4rem 0.5rem; border-bottom:1px solid #f1f5f9;">
                                <span style="font-weight:600; font-size:0.85rem; color:#1e293b;">${window.escapeHTML(t.name)}</span>
                                <div style="display:flex; gap:0.4rem;">
                                    <button type="button" class="btn btn-secondary btn-sm btn-rename-at" data-id="${t.id}" style="padding:2px 8px; font-size:0.75rem; min-height:28px;">Edit</button>
                                    <button type="button" class="btn btn-danger btn-sm btn-delete-at" data-id="${t.id}" style="padding:2px 8px; font-size:0.75rem; min-height:28px;">Delete</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>

                    <div style="display:flex; gap:0.5rem; margin-bottom:1.25rem;">
                        <input type="text" id="newAwardTypeName" class="form-input" placeholder="Enter new award type name..." style="height:36px; font-size:0.85rem; flex:1;">
                        <button type="button" class="btn btn-primary" id="btnAddAwardType" style="min-height:36px; padding:0 1rem; font-size:0.82rem; font-weight:700;">
                            + Add
                        </button>
                    </div>

                    <div class="custom-modal-actions">
                        <button type="button" class="custom-dialog-btn custom-dialog-btn-secondary" id="btnCloseManageModal">Close</button>
                    </div>
                `;

                // Bind add button
                dialog.querySelector('#btnAddAwardType').onclick = async () => {
                    const input = dialog.querySelector('#newAwardTypeName');
                    const name = input.value.trim();
                    if (!name) return;

                    const lowerName = name.toLowerCase();
                    if (awardTypes.some(t => t.name.toLowerCase() === lowerName)) {
                        window.showToast("An award type with this name already exists.", "warning");
                        return;
                    }

                    const newType = {
                        id: 'aw_' + Date.now(),
                        name: name
                    };

                    awardTypes.push(newType);
                    await setDoc(doc(db, "institutes", instId, "metadata", "awardTypesConfig"), { awardTypes });
                    window.showToast("Award type added successfully!", "success");
                    renderModalContent();
                    renderAwardTypeSelect();
                };

                // Bind edit (rename) buttons
                dialog.querySelectorAll('.btn-rename-at').forEach(btn => {
                    btn.onclick = async () => {
                        const id = btn.getAttribute('data-id');
                        const target = awardTypes.find(t => t.id === id);
                        if (!target) return;

                        const newName = prompt("Rename Award Type:", target.name);
                        if (!newName || !newName.trim() || newName.trim() === target.name) return;

                        const lowerName = newName.trim().toLowerCase();
                        if (awardTypes.some(t => t.id !== id && t.name.toLowerCase() === lowerName)) {
                            window.showToast("An award type with this name already exists.", "warning");
                            return;
                        }

                        target.name = newName.trim();
                        await setDoc(doc(db, "institutes", instId, "metadata", "awardTypesConfig"), { awardTypes });
                        window.showToast("Award type renamed successfully!", "success");
                        renderModalContent();
                        renderAwardTypeSelect();
                    };
                });

                // Bind delete buttons
                dialog.querySelectorAll('.btn-delete-at').forEach(btn => {
                    btn.onclick = async () => {
                        const id = btn.getAttribute('data-id');
                        const target = awardTypes.find(t => t.id === id);
                        if (!target) return;

                        // Check if used in class_awards
                        const metadataSnap = await getDocs(collection(db, "institutes", instId, "metadata"));
                        const isUsed = metadataSnap.docs.some(d => {
                            if (!d.id.startsWith("class_award_")) return false;
                            const data = d.data();
                            return data.awardTypeId === id || data.awardType === target.name;
                        });

                        if (isUsed) {
                            const confirmed = await window.customConfirm(
                                "This award type is already used in saved award records. Existing award data will be preserved.",
                                "Warning",
                                { danger: true, okText: "Delete Option", cancelText: "Cancel" }
                            );
                            if (!confirmed) return;
                        } else {
                            const confirmed = await window.customConfirm(`Are you sure you want to delete the award type "${target.name}"?`);
                            if (!confirmed) return;
                        }

                        awardTypes = awardTypes.filter(t => t.id !== id);
                        await setDoc(doc(db, "institutes", instId, "metadata", "awardTypesConfig"), { awardTypes });
                        window.showToast("Award type deleted successfully.", "success");
                        renderModalContent();
                        renderAwardTypeSelect();
                    };
                });

                // Bind close button
                dialog.querySelector('#btnCloseManageModal').onclick = () => {
                    overlay.remove();
                };
            };

            overlay.appendChild(dialog);
            document.body.appendChild(overlay);
            renderModalContent();
        };

        const openOldStudentModal = (place, editIndex = null) => {
            const list = place === 1 ? firstPlaceWinners : (place === 2 ? secondPlaceWinners : thirdPlaceWinners);
            const editingItem = editIndex !== null ? list[editIndex] : null;

            const overlay = document.createElement('div');
            overlay.className = 'custom-modal-overlay';
            overlay.style.opacity = '1';

            const dialog = document.createElement('div');
            dialog.className = 'custom-modal-dialog';
            dialog.style.transform = 'scale(1)';
            dialog.style.maxWidth = '460px';
            dialog.style.width = '90%';

            const placeLabel = place === 1 ? '1st Place' : (place === 2 ? '2nd Place' : '3rd Place');
            const defaultClassId = editingItem ? (editingItem.classId || selectedClassId) : selectedClassId;

            dialog.innerHTML = `
                <div class="custom-modal-header" style="margin-bottom:1rem;">
                    <div class="custom-modal-icon" style="background:rgba(126, 34, 206, 0.08); color:#7e22ce;">🟣</div>
                    <div>
                        <h3 class="custom-modal-title">${editingItem ? 'Edit Old Student Entry' : 'Add Old Student Entry'}</h3>
                        <p class="custom-modal-message" style="font-size:0.8rem;">Manual entry for alumni / former students for ${placeLabel}.</p>
                    </div>
                </div>

                <div style="display:flex; flex-direction:column; gap:0.9rem; margin-bottom:1.25rem;">
                    <div class="form-group" style="margin:0;">
                        <label class="form-label" style="font-weight:700; font-size:0.82rem; color:#475569;">Student Name *</label>
                        <input type="text" id="osStudentName" class="form-input" placeholder="Enter full name of old student..." value="${editingItem ? window.escapeHTML(editingItem.name) : ''}" style="height:38px; font-size:0.85rem;" autocomplete="off">
                    </div>

                    <div class="form-group" style="margin:0;">
                        <label class="form-label" style="font-weight:700; font-size:0.82rem; color:#475569;">Award Class *</label>
                        <select id="osAwardClassSelect" class="form-input" style="height:38px; font-size:0.85rem;">
                            <option value="">Select Award Class...</option>
                            ${allClasses.map(cls => `<option value="${cls.id}" data-name="${window.escapeHTML(cls.name)}" ${cls.id === defaultClassId ? 'selected' : ''}>${window.escapeHTML(cls.name)}</option>`).join('')}
                        </select>
                    </div>

                    <div class="form-group" style="margin:0;">
                        <label class="form-label" style="font-weight:700; font-size:0.82rem; color:#475569;">Award Type *</label>
                        <input type="text" id="osAwardTypeDisplay" class="form-input" value="${window.escapeHTML(selectedAwardTypeName)}" readonly disabled style="height:38px; font-size:0.85rem; background:#f8fafc; color:#64748b; font-weight:600;">
                    </div>

                    <div class="form-group" style="margin:0;">
                        <label class="form-label" style="font-weight:700; font-size:0.82rem; color:#475569;">Remarks (Optional)</label>
                        <input type="text" id="osRemarks" class="form-input" placeholder="e.g. Passed Out, Former Student, Alumni" value="${editingItem && editingItem.remarks ? window.escapeHTML(editingItem.remarks) : ''}" style="height:38px; font-size:0.85rem;" autocomplete="off">
                    </div>
                </div>

                <div class="custom-modal-actions" style="display:flex; gap:0.5rem; justify-content:flex-end;">
                    <button type="button" class="btn btn-secondary" id="btnCloseOSModal" style="min-height:36px; padding:0 1rem; font-size:0.82rem; font-weight:700;">Cancel</button>
                    <button type="button" class="btn btn-primary" id="btnSaveOSModal" style="min-height:36px; padding:0 1.25rem; font-size:0.82rem; font-weight:700; background:#7e22ce; border-color:#7e22ce;">
                        ${editingItem ? 'Update Entry' : 'Add Entry'}
                    </button>
                </div>
            `;

            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            const nameInput = dialog.querySelector('#osStudentName');
            const classSelect = dialog.querySelector('#osAwardClassSelect');
            const remarksInput = dialog.querySelector('#osRemarks');

            dialog.querySelector('#btnCloseOSModal').onclick = () => overlay.remove();

            dialog.querySelector('#btnSaveOSModal').onclick = () => {
                const nameVal = nameInput.value.trim();
                const classIdVal = classSelect.value;
                const classOpt = classSelect.options[classSelect.selectedIndex];
                const classNameVal = classOpt ? (classOpt.getAttribute('data-name') || '') : '';
                const remarksVal = remarksInput.value.trim();

                if (!nameVal) {
                    window.showToast("Student Name is required.", "warning");
                    nameInput.focus();
                    return;
                }

                if (!classIdVal) {
                    window.showToast("Award Class is required.", "warning");
                    classSelect.focus();
                    return;
                }

                const lowerName = nameVal.toLowerCase();

                // Validation against duplicate entries in place 1, 2, and 3
                const placesData = [
                    { placeNum: 1, nameStr: '1st Place', items: firstPlaceWinners },
                    { placeNum: 2, nameStr: '2nd Place', items: secondPlaceWinners },
                    { placeNum: 3, nameStr: '3rd Place', items: thirdPlaceWinners }
                ];

                for (const p of placesData) {
                    const isSamePlace = p.placeNum === place;
                    const conflictIndex = p.items.findIndex((x, idx) => {
                        if (isSamePlace && editIndex !== null && idx === editIndex) return false;
                        return x.name.toLowerCase() === lowerName;
                    });

                    if (conflictIndex !== -1) {
                        window.showToast(`${nameVal} is already added as a ${p.nameStr} winner for this award.`, "warning");
                        return;
                    }
                }

                const newWinner = {
                    studentId: null,
                    name: nameVal,
                    chestNumber: '',
                    className: classNameVal,
                    classId: classIdVal,
                    sourceType: 'old_student',
                    isOldStudent: true,
                    awardType: selectedAwardTypeName,
                    remarks: remarksVal
                };

                if (editingItem && editIndex !== null) {
                    list[editIndex] = newWinner;
                } else {
                    list.push(newWinner);
                }

                updateWinnerUI(place);
                overlay.remove();
                window.showToast(`Old Student "${nameVal}" ${editingItem ? 'updated' : 'added'} successfully!`, "success");
            };
        };

        const updateWinnerUI = (place) => {
            const area = place === 1 ? firstPlaceArea : (place === 2 ? secondPlaceArea : thirdPlaceArea);
            const list = place === 1 ? firstPlaceWinners : (place === 2 ? secondPlaceWinners : thirdPlaceWinners);
            const dropdownId = place === 1 ? 'caFirstPlaceDropdown' : (place === 2 ? 'caSecondPlaceDropdown' : 'caThirdPlaceDropdown');
            const inputId = place === 1 ? 'caFirstPlaceInput' : (place === 2 ? 'caSecondPlaceInput' : 'caThirdPlaceInput');
            const manualId = place === 1 ? 'caFirstPlaceManual' : (place === 2 ? 'caSecondPlaceManual' : 'caThirdPlaceManual');

            let cardsHTML = '';
            if (list.length > 0) {
                cardsHTML = `
                    <div style="display:flex; flex-direction:column; gap:0.5rem; margin-bottom:0.75rem;">
                        ${list.map((w, idx) => {
                            const chestDisplay = w.chestNumber ? `#${w.chestNumber}` : '—';
                            const sClass = w.className || 'No Class';
                            const isOS = w.sourceType === 'old_student' || w.isOldStudent === true;
                            return `
                                <div class="selected-student-card" style="margin-bottom:0;">
                                    <div style="display:flex; align-items:center; gap:0.6rem;">
                                        <span style="font-size:1.1rem;">${isOS ? '🟣' : '👤'}</span>
                                        <div>
                                            <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
                                                <strong style="color:#0f172a; font-size:0.9rem;">${window.escapeHTML(w.name)}</strong>
                                                ${isOS ? '<span style="background:#f3e8ff; color:#7e22ce; border:1px solid #d8b4fe; padding:2px 8px; border-radius:9999px; font-weight:700; font-size:0.7rem; display:inline-flex; align-items:center; gap:2px;">🟣 OLD STUDENT</span>' : ''}
                                            </div>
                                            <div style="font-size:0.75rem; color:#64748b; font-weight:500; margin-top:2px;">
                                                Class: <span style="font-weight:600; color:#1e293b;">${window.escapeHTML(sClass)}</span> &bull; Chest: <span style="font-weight:700; color:#1e293b;">${window.escapeHTML(chestDisplay)}</span>
                                                ${w.sourceType === 'manual' ? ' &bull; <span style="color:#ef4444; font-weight:700;">Manual Entry</span>' : ''}
                                                ${isOS && w.remarks ? ' &bull; Remarks: <span style="font-weight:600; color:#475569;">' + window.escapeHTML(w.remarks) + '</span>' : ''}
                                            </div>
                                        </div>
                                    </div>
                                    <div style="display:flex; align-items:center; gap:0.25rem;">
                                        <button type="button" class="btn-remove-winner" data-place="${place}" data-index="${idx}" style="background:none; border:none; color:#ef4444; font-size:1.15rem; font-weight:bold; cursor:pointer; padding:0.25rem;" title="Remove Winner">✕</button>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                `;
            }

            area.innerHTML = `
                ${cardsHTML}
                <div style="display:flex; gap:0.5rem; align-items:center; position:relative; width:100%;">
                    <div style="position:relative; flex:1;">
                        <input type="text" id="${inputId}" class="form-input" placeholder="Search student by name or chest number..." style="height:38px; font-size:0.85rem;" autocomplete="off">
                        <div id="${dropdownId}" class="search-student-dropdown"></div>
                    </div>
                    <button type="button" class="btn btn-secondary btn-sm" id="${manualId}" style="font-weight:700; height:38px; flex-shrink:0;">
                        + Manual
                    </button>
                </div>
            `;

            // Bind remove buttons
            area.querySelectorAll('.btn-remove-winner').forEach(btn => {
                btn.onclick = () => {
                    const idx = parseInt(btn.getAttribute('data-index'));
                    if (place === 1) {
                        firstPlaceWinners.splice(idx, 1);
                    } else if (place === 2) {
                        secondPlaceWinners.splice(idx, 1);
                    } else {
                        thirdPlaceWinners.splice(idx, 1);
                    }
                    updateWinnerUI(place);
                };
            });

            // Bind manual button
            area.querySelector(`#${manualId}`).onclick = () => {
                const manualName = prompt("Enter manual student name:");
                if (!manualName || !manualName.trim()) return;

                const newWinner = {
                    studentId: null,
                    name: manualName.trim(),
                    chestNumber: '',
                    className: selectedClassName || '',
                    classId: selectedClassId || '',
                    sourceType: 'manual'
                };

                // Validate duplicate
                const lowerName = newWinner.name.toLowerCase();
                const placesData = [
                    { placeNum: 1, nameStr: '1st Place', items: firstPlaceWinners },
                    { placeNum: 2, nameStr: '2nd Place', items: secondPlaceWinners },
                    { placeNum: 3, nameStr: '3rd Place', items: thirdPlaceWinners }
                ];

                for (const p of placesData) {
                    if (p.items.some(w => w.name.toLowerCase() === lowerName)) {
                        window.showToast(`${newWinner.name} is already added as a ${p.nameStr} winner for this award.`, "warning");
                        return;
                    }
                }

                if (place === 1) {
                    firstPlaceWinners.push(newWinner);
                } else if (place === 2) {
                    secondPlaceWinners.push(newWinner);
                } else {
                    thirdPlaceWinners.push(newWinner);
                }
                updateWinnerUI(place);
            };

            // Bind searchable dropdown logic
            const input = area.querySelector(`#${inputId}`);
            const dropdown = area.querySelector(`#${dropdownId}`);

            const filterStudents = (val) => {
                dropdown.innerHTML = '';
                const q = val.toLowerCase().trim();
                const matched = classStudents.filter(s => 
                    s.name.toLowerCase().includes(q) || (s.chestNumber && s.chestNumber.toLowerCase().includes(q))
                );

                if (matched.length === 0) {
                    dropdown.innerHTML = '<div style="padding:0.6rem 0.8rem; color:#64748b; font-style:italic; font-size:0.82rem;">No matching students found.</div>';
                    dropdown.style.display = 'block';
                    return;
                }

                matched.forEach(s => {
                    const item = document.createElement('div');
                    item.style.padding = '0.4rem 0.75rem';
                    item.style.cursor = 'pointer';
                    item.style.borderBottom = '1px solid #f1f5f9';
                    item.style.fontSize = '0.83rem';
                    item.style.color = '#334155';
                    item.style.lineHeight = '1.25';
                    item.onmouseenter = () => { item.style.background = '#f8fafc'; };
                    item.onmouseleave = () => { item.style.background = '#ffffff'; };
                    
                    const chestNum = s.chestNumber ? `#${s.chestNumber}` : '—';
                    const sClass = s.className || s.classId || 'No Class';
                    item.innerHTML = `
                        <div style="display:flex; justify-content:space-between; align-items:center; width:100%; gap:0.5rem;">
                            <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                                <span style="font-weight:700; color:#1e293b;">${window.escapeHTML(s.name)}</span>
                                <span style="font-size:0.72rem; color:#64748b; margin-left:6px;">(${window.escapeHTML(sClass)})</span>
                            </div>
                            <span style="background:#e2e8f0; color:#475569; padding:2px 6px; border-radius:4px; font-size:0.72rem; font-weight:700; flex-shrink:0;">${window.escapeHTML(chestNum)}</span>
                        </div>
                    `;
                    item.onclick = () => {
                        const newWinner = {
                            studentId: s.id,
                            name: s.name,
                            chestNumber: s.chestNumber || '',
                            className: s.className || s.classId || '',
                            classId: s.classId || '',
                            sourceType: 'existing'
                        };

                        // Validate duplicate
                        const placesData = [
                            { placeNum: 1, nameStr: '1st Place', items: firstPlaceWinners },
                            { placeNum: 2, nameStr: '2nd Place', items: secondPlaceWinners },
                            { placeNum: 3, nameStr: '3rd Place', items: thirdPlaceWinners }
                        ];

                        for (const p of placesData) {
                            if (p.items.some(w => w.studentId === s.id || w.name.toLowerCase() === s.name.toLowerCase())) {
                                window.showToast(`${s.name} is already added as a ${p.nameStr} winner for this award.`, "warning");
                                return;
                            }
                        }

                        if (place === 1) {
                            firstPlaceWinners.push(newWinner);
                        } else if (place === 2) {
                            secondPlaceWinners.push(newWinner);
                        } else {
                            thirdPlaceWinners.push(newWinner);
                        }
                        updateWinnerUI(place);
                        dropdown.style.display = 'none';
                    };
                    dropdown.appendChild(item);
                });
                dropdown.style.display = 'block';
            };

            input.onfocus = () => {
                filterStudents(input.value);
            };

            input.oninput = (e) => {
                filterStudents(e.target.value);
            };
        };

        // Click outside dropdowns to close them
        const documentClickClose = (e) => {
            if (!e.target.closest('#caFirstPlaceContainer')) {
                const drop = document.getElementById('caFirstPlaceDropdown');
                if (drop) drop.style.display = 'none';
            }
            if (!e.target.closest('#caSecondPlaceContainer')) {
                const drop = document.getElementById('caSecondPlaceDropdown');
                if (drop) drop.style.display = 'none';
            }
            if (!e.target.closest('#caThirdPlaceContainer')) {
                const drop = document.getElementById('caThirdPlaceDropdown');
                if (drop) drop.style.display = 'none';
            }
        };
        document.addEventListener('click', documentClickClose);

        // Ensure cleanup of event listener on view change
        const prevCleanup = window.currentViewCleanup;
        window.currentViewCleanup = () => {
            if (prevCleanup) prevCleanup();
            document.removeEventListener('click', documentClickClose);
        };

        const loadConfigState = async () => {
            selectedClassId = classSelect.value;
            const selectedOpt = classSelect.options[classSelect.selectedIndex];
            selectedClassName = selectedOpt ? selectedOpt.getAttribute('data-name') || '' : '';
            
            selectedAwardTypeId = awardTypeSelect.value;
            const selectedATOpt = awardTypeSelect.options[awardTypeSelect.selectedIndex];
            selectedAwardTypeName = selectedATOpt ? selectedATOpt.getAttribute('data-name') || '' : '';

            if (!selectedClassId || !selectedAwardTypeId) {
                winnersCard.style.display = 'none';
                return;
            }

            // Update Label
            configLabel.innerHTML = `${window.escapeHTML(selectedClassName)} &bull; ${window.escapeHTML(selectedAwardTypeName)}`;

            // Filter class students - Allow selecting only from students in the selected class (X) or the next class (X + 1)
            const extractClassNumber = (nameOrId) => {
                if (!nameOrId) return null;
                const match = nameOrId.match(/\d+/);
                return match ? parseInt(match[0], 10) : null;
            };

            const selectedClassNum = extractClassNumber(selectedClassName);
            if (selectedClassNum !== null) {
                classStudents = allStudents.filter(s => {
                    const studentClassNum = extractClassNumber(s.className || s.classId);
                    return studentClassNum === selectedClassNum || studentClassNum === (selectedClassNum + 1);
                });
            } else {
                // Fallback for non-numeric classes
                classStudents = allStudents.filter(s => 
                    s.classId === selectedClassId || 
                    (s.className && s.className.toLowerCase() === selectedClassName.toLowerCase())
                );
            }

            if (classStudents.length === 0) {
                winnersCard.style.display = 'flex';
                firstPlaceArea.innerHTML = `<div style="padding:0.75rem; background:#fee2e2; color:#b91c1c; border-radius:8px; border:1px solid #fecaca; font-size:0.85rem; font-weight:600;">No students are registered in this institute yet. Go to Students view to register them first.</div>`;
                secondPlaceArea.innerHTML = '';
                thirdPlaceArea.innerHTML = '';
                saveBtn.style.display = 'none';
                return;
            }

            saveBtn.style.display = 'inline-block';
            winnersCard.style.display = 'flex';

            // Load Existing Awards Selection from Firestore
            firstPlaceWinners = [];
            secondPlaceWinners = [];
            thirdPlaceWinners = [];

            firstPlaceArea.innerHTML = '<div style="font-size:0.85rem; color:#64748b;">Loading selections...</div>';
            secondPlaceArea.innerHTML = '';
            thirdPlaceArea.innerHTML = '';

            try {
                const awardDocRef = doc(db, "institutes", instId, "metadata", `class_award_${selectedClassId}_${selectedAwardTypeId}`);
                const awardSnap = await getDoc(awardDocRef);

                if (awardSnap.exists()) {
                    const data = awardSnap.data();
                    
                    // Normalize firstPlaceWinners
                    if (Array.isArray(data.firstPlaceWinners)) {
                        firstPlaceWinners = data.firstPlaceWinners;
                    } else if (data.firstPlace) {
                        firstPlaceWinners = [data.firstPlace];
                    } else if (data.firstPlaceWinner) {
                        firstPlaceWinners = [data.firstPlaceWinner];
                    }

                    // Normalize secondPlaceWinners
                    if (Array.isArray(data.secondPlaceWinners)) {
                        secondPlaceWinners = data.secondPlaceWinners;
                    } else if (data.secondPlace) {
                        secondPlaceWinners = [data.secondPlace];
                    } else if (data.secondPlaceWinner) {
                        secondPlaceWinners = [data.secondPlaceWinner];
                    }

                    // Normalize thirdPlaceWinners
                    if (Array.isArray(data.thirdPlaceWinners)) {
                        thirdPlaceWinners = data.thirdPlaceWinners;
                    } else if (data.thirdPlace) {
                        thirdPlaceWinners = [data.thirdPlace];
                    } else if (data.thirdPlaceWinner) {
                        thirdPlaceWinners = [data.thirdPlaceWinner];
                    }
                }
            } catch (err) {
                console.error("Error fetching class awards:", err);
            }

            updateWinnerUI(1);
            updateWinnerUI(2);
            updateWinnerUI(3);
        };

        const openBulkOtherEntryModal = async () => {
            const overlay = document.createElement('div');
            overlay.className = 'custom-modal-overlay';
            overlay.style.opacity = '1';

            const dialog = document.createElement('div');
            dialog.className = 'custom-modal-dialog';
            dialog.style.transform = 'scale(1)';
            dialog.style.maxWidth = '620px';
            dialog.style.width = '94%';
            dialog.style.maxHeight = '90vh';
            dialog.style.overflowY = 'auto';

            const defaultAwardTypeId = selectedAwardTypeId || (awardTypes.length > 0 ? awardTypes[0].id : '');
            let activeEditingDocId = null;

            dialog.innerHTML = `
                <div class="custom-modal-header" style="margin-bottom:1rem;">
                    <div class="custom-modal-icon" style="background:rgba(79, 70, 229, 0.08); color:#4f46e5;">➕</div>
                    <div>
                        <h3 class="custom-modal-title" id="boeModalTitle">Bulk Other Entry</h3>
                        <p class="custom-modal-message" style="font-size:0.8rem;">Manual award entry for alumni, previous year, or passed out students.</p>
                    </div>
                </div>

                <div style="display:flex; flex-direction:column; gap:1rem; margin-bottom:1.25rem;">
                    <!-- Step 1: Award Type -->
                    <div class="form-group" style="margin:0;">
                        <label class="form-label" style="font-weight:700; font-size:0.85rem; color:#475569;">1. Award Type *</label>
                        <select id="boeAwardTypeSelect" class="form-input" style="height:38px; font-size:0.85rem; margin-top:0.25rem;">
                            <option value="">Select Award Type...</option>
                            ${awardTypes.map(t => `<option value="${t.id}" data-name="${window.escapeHTML(t.name)}" ${t.id === defaultAwardTypeId ? 'selected' : ''}>${window.escapeHTML(t.name)}</option>`).join('')}
                        </select>
                    </div>

                    <!-- Step 2: Class / Standard -->
                    <div class="form-group" style="margin:0;">
                        <label class="form-label" style="font-weight:700; font-size:0.85rem; color:#475569;">2. Class / Standard *</label>
                        <input type="text" id="boeClassInput" list="boeClassDatalist" class="form-input" placeholder="Example: 10 Pass, Passed Out 10, Old Batch 2025, Hifz Batch, Special Batch" style="height:38px; font-size:0.85rem; margin-top:0.25rem;" autocomplete="off">
                        <datalist id="boeClassDatalist"></datalist>
                    </div>

                    <!-- Step 3: Winner Entries -->
                    <div style="border-top:1px solid #e2e8f0; padding-top:1rem; display:flex; flex-direction:column; gap:1rem;">
                        <h4 style="margin:0; font-size:0.9rem; font-weight:800; color:#1e1b4b;">3. Winner Entry</h4>

                        <!-- 1st Place -->
                        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:0.75rem;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                                <label style="font-weight:700; color:#16a34a; font-size:0.83rem;">🥇 1st Place Winners</label>
                                <button type="button" class="btn btn-secondary btn-sm" id="btnAddFirstRow" style="font-size:0.75rem; font-weight:700; padding:2px 8px;">+ Add Another</button>
                            </div>
                            <div id="boeFirstRows" style="display:flex; flex-direction:column; gap:0.4rem;"></div>
                        </div>

                        <!-- 2nd Place -->
                        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:0.75rem;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                                <label style="font-weight:700; color:#ea580c; font-size:0.83rem;">🥈 2nd Place Winners</label>
                                <button type="button" class="btn btn-secondary btn-sm" id="btnAddSecondRow" style="font-size:0.75rem; font-weight:700; padding:2px 8px;">+ Add Another</button>
                            </div>
                            <div id="boeSecondRows" style="display:flex; flex-direction:column; gap:0.4rem;"></div>
                        </div>

                        <!-- 3rd Place -->
                        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:0.75rem;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                                <label style="font-weight:700; color:#b45309; font-size:0.83rem;">🥉 3rd Place Winners (Optional)</label>
                                <button type="button" class="btn btn-secondary btn-sm" id="btnAddThirdRow" style="font-size:0.75rem; font-weight:700; padding:2px 8px;">+ Add Another</button>
                            </div>
                            <div id="boeThirdRows" style="display:flex; flex-direction:column; gap:0.4rem;"></div>
                        </div>
                    </div>

                    <!-- Step 4: Saved Entries Section -->
                    <div style="border-top:1.5px solid #cbd5e1; padding-top:1rem; margin-top:0.5rem; display:flex; flex-direction:column; gap:0.75rem;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <h4 style="margin:0; font-size:0.9rem; font-weight:800; color:#1e1b4b; display:flex; align-items:center; gap:0.4rem;">
                                📋 Saved Entries
                            </h4>
                            <span id="boeSavedCount" style="font-size:0.75rem; font-weight:700; color:#64748b; background:#f1f5f9; padding:2px 8px; border-radius:9999px;">Loading...</span>
                        </div>
                        <div id="boeSavedEntriesList" style="display:flex; flex-direction:column; gap:0.6rem; max-height:280px; overflow-y:auto; padding-right:4px;"></div>
                    </div>
                </div>

                <div class="custom-modal-actions" style="display:flex; gap:0.5rem; justify-content:flex-end; border-top:1px solid #e2e8f0; padding-top:0.75rem;">
                    <button type="button" class="btn btn-secondary" id="btnCloseBOEModal" style="min-height:36px; padding:0 1rem; font-size:0.82rem; font-weight:700;">Close</button>
                    <button type="button" class="btn btn-primary" id="btnSaveBOEModal" style="min-height:36px; padding:0 1.25rem; font-size:0.82rem; font-weight:700;">
                        💾 Save Entry
                    </button>
                </div>
            `;

            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            const firstRowsContainer = dialog.querySelector('#boeFirstRows');
            const secondRowsContainer = dialog.querySelector('#boeSecondRows');
            const thirdRowsContainer = dialog.querySelector('#boeThirdRows');
            const classInput = dialog.querySelector('#boeClassInput');
            const classDatalist = dialog.querySelector('#boeClassDatalist');
            const savedEntriesListContainer = dialog.querySelector('#boeSavedEntriesList');
            const savedCountLabel = dialog.querySelector('#boeSavedCount');
            const atSelect = dialog.querySelector('#boeAwardTypeSelect');

            let savedDocsCache = [];

            const addInputRow = (container, val = '') => {
                const row = document.createElement('div');
                row.style.display = 'flex';
                row.style.gap = '0.4rem';
                row.style.alignItems = 'center';
                row.innerHTML = `
                    <input type="text" class="form-input boe-name-input" placeholder="Enter student name..." value="${window.escapeHTML(val)}" style="height:34px; font-size:0.82rem; flex:1;" autocomplete="off">
                    <button type="button" class="btn-remove-boe-row" style="background:none; border:none; color:#ef4444; font-size:1.1rem; font-weight:bold; cursor:pointer; padding:0 0.3rem;" title="Remove row">✕</button>
                `;
                row.querySelector('.btn-remove-boe-row').onclick = () => {
                    row.remove();
                };
                container.appendChild(row);
            };

            const resetFormInputs = () => {
                activeEditingDocId = null;
                dialog.querySelector('#boeModalTitle').textContent = 'Bulk Other Entry';
                firstRowsContainer.innerHTML = '';
                secondRowsContainer.innerHTML = '';
                thirdRowsContainer.innerHTML = '';
                addInputRow(firstRowsContainer);
                addInputRow(secondRowsContainer);
                addInputRow(thirdRowsContainer);
            };

            resetFormInputs();

            dialog.querySelector('#btnAddFirstRow').onclick = () => addInputRow(firstRowsContainer);
            dialog.querySelector('#btnAddSecondRow').onclick = () => addInputRow(secondRowsContainer);
            dialog.querySelector('#btnAddThirdRow').onclick = () => addInputRow(thirdRowsContainer);

            dialog.querySelector('#btnCloseBOEModal').onclick = () => overlay.remove();

            const loadAndRenderSavedEntries = async () => {
                try {
                    savedEntriesListContainer.innerHTML = '<div style="font-size:0.82rem; color:#64748b; font-style:italic;">Loading saved records...</div>';
                    const metadataSnap = await getDocs(collection(db, "institutes", instId, "metadata"));
                    savedDocsCache = metadataSnap.docs.filter(d => d.id.startsWith("class_award_"));

                    // Populate Autocomplete Class Suggestions Datalist
                    const uniqueClassNames = Array.from(new Set(savedDocsCache.map(d => d.data().className).filter(Boolean))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
                    classDatalist.innerHTML = uniqueClassNames.map(cn => `<option value="${window.escapeHTML(cn)}">`).join('');

                    renderSavedEntriesList();
                } catch (err) {
                    console.error("Error loading saved award entries:", err);
                    savedEntriesListContainer.innerHTML = '<div style="font-size:0.82rem; color:#ef4444;">Failed to load saved entries.</div>';
                }
            };

            const renderSavedEntriesList = () => {
                const selAwardTypeId = atSelect.value;
                let filtered = savedDocsCache;
                if (selAwardTypeId) {
                    filtered = savedDocsCache.filter(d => {
                        const data = d.data();
                        return data.awardTypeId === selAwardTypeId || (data.awardType && data.awardType.toLowerCase() === selAwardTypeId.toLowerCase());
                    });
                }

                savedCountLabel.textContent = `${filtered.length} Record${filtered.length === 1 ? '' : 's'}`;

                if (filtered.length === 0) {
                    savedEntriesListContainer.innerHTML = '<div style="padding:0.75rem; background:#f8fafc; border:1px border-dashed #cbd5e1; border-radius:8px; color:#64748b; font-size:0.82rem; font-style:italic; text-align:center;">No saved award entries found for the selected filter.</div>';
                    return;
                }

                savedEntriesListContainer.innerHTML = filtered.map(d => {
                    const data = d.data();
                    const docId = d.id;
                    const cName = data.className || 'No Class Name';
                    const aType = data.awardType || 'Award';

                    const fWinners = Array.isArray(data.firstPlaceWinners) ? data.firstPlaceWinners : (data.firstPlace ? [data.firstPlace] : []);
                    const sWinners = Array.isArray(data.secondPlaceWinners) ? data.secondPlaceWinners : (data.secondPlace ? [data.secondPlace] : []);
                    const tWinners = Array.isArray(data.thirdPlaceWinners) ? data.thirdPlaceWinners : (data.thirdPlace ? [data.thirdPlace] : []);

                    const formatNames = (arr) => arr.map(w => w.name).join(', ') || '—';

                    return `
                        <div class="card" style="padding:0.65rem 0.85rem; border:1px solid #cbd5e1; background:#ffffff; border-radius:8px; display:flex; flex-direction:column; gap:0.35rem; box-shadow:0 1px 2px rgba(0,0,0,0.03);">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
                                    <span style="background:#e0e7ff; color:#3730a3; font-weight:800; font-size:0.72rem; padding:2px 8px; border-radius:4px;">${window.escapeHTML(aType)}</span>
                                    <strong style="color:#0f172a; font-size:0.88rem;">${window.escapeHTML(cName)}</strong>
                                </div>
                                <div style="display:flex; gap:0.3rem;">
                                    <button type="button" class="btn btn-secondary btn-sm btn-edit-boe" data-docid="${docId}" style="padding:2px 8px; font-size:0.75rem; font-weight:700;">✏️ Edit</button>
                                    <button type="button" class="btn btn-danger btn-sm btn-delete-boe" data-docid="${docId}" style="padding:2px 8px; font-size:0.75rem; font-weight:700;">🗑️ Delete</button>
                                </div>
                            </div>
                            <div style="font-size:0.75rem; color:#475569; display:flex; flex-direction:column; gap:0.15rem; background:#f8fafc; padding:0.4rem 0.6rem; border-radius:6px;">
                                ${fWinners.length > 0 ? `<div>🥇 <strong style="color:#16a34a;">1st Place:</strong> ${window.escapeHTML(formatNames(fWinners))}</div>` : ''}
                                ${sWinners.length > 0 ? `<div>🥈 <strong style="color:#ea580c;">2nd Place:</strong> ${window.escapeHTML(formatNames(sWinners))}</div>` : ''}
                                ${tWinners.length > 0 ? `<div>🥉 <strong style="color:#b45309;">3rd Place:</strong> ${window.escapeHTML(formatNames(tWinners))}</div>` : ''}
                            </div>
                        </div>
                    `;
                }).join('');

                // Bind Edit Buttons
                savedEntriesListContainer.querySelectorAll('.btn-edit-boe').forEach(btn => {
                    btn.onclick = () => {
                        const docId = btn.getAttribute('data-docid');
                        const targetDoc = savedDocsCache.find(d => d.id === docId);
                        if (!targetDoc) return;

                        const data = targetDoc.data();
                        activeEditingDocId = docId;
                        dialog.querySelector('#boeModalTitle').textContent = `Editing ${data.className || ''} • ${data.awardType || ''}`;

                        atSelect.value = data.awardTypeId || '';
                        classInput.value = data.className || '';

                        firstRowsContainer.innerHTML = '';
                        secondRowsContainer.innerHTML = '';
                        thirdRowsContainer.innerHTML = '';

                        const fWinners = Array.isArray(data.firstPlaceWinners) ? data.firstPlaceWinners : (data.firstPlace ? [data.firstPlace] : []);
                        const sWinners = Array.isArray(data.secondPlaceWinners) ? data.secondPlaceWinners : (data.secondPlace ? [data.secondPlace] : []);
                        const tWinners = Array.isArray(data.thirdPlaceWinners) ? data.thirdPlaceWinners : (data.thirdPlace ? [data.thirdPlace] : []);

                        if (fWinners.length > 0) {
                            fWinners.forEach(w => addInputRow(firstRowsContainer, w.name));
                        } else {
                            addInputRow(firstRowsContainer);
                        }

                        if (sWinners.length > 0) {
                            sWinners.forEach(w => addInputRow(secondRowsContainer, w.name));
                        } else {
                            addInputRow(secondRowsContainer);
                        }

                        if (tWinners.length > 0) {
                            tWinners.forEach(w => addInputRow(thirdRowsContainer, w.name));
                        } else {
                            addInputRow(thirdRowsContainer);
                        }

                        dialog.scrollTop = 0;
                        window.showToast("Loaded entry into form for editing.", "info");
                    };
                });

                // Bind Delete Buttons
                savedEntriesListContainer.querySelectorAll('.btn-delete-boe').forEach(btn => {
                    btn.onclick = async () => {
                        const docId = btn.getAttribute('data-docid');
                        const targetDoc = savedDocsCache.find(d => d.id === docId);
                        if (!targetDoc) return;

                        const data = targetDoc.data();
                        const confirmed = await window.customConfirm(
                            `Are you sure you want to delete the award record for "${data.className || 'Class'}" • "${data.awardType || 'Award'}"?`,
                            "Delete Entry?",
                            { danger: true, okText: "Delete", cancelText: "Cancel" }
                        );

                        if (!confirmed) return;

                        try {
                            await deleteDoc(doc(db, "institutes", instId, "metadata", docId));
                            window.showToast("Award entry deleted successfully.", "success");
                            await loadAndRenderSavedEntries();

                            if (selectedClassId === data.classId && selectedAwardTypeId === data.awardTypeId) {
                                await loadConfigState();
                            }
                        } catch (err) {
                            console.error("Error deleting award doc:", err);
                            window.showToast("Failed to delete award entry.", "error");
                        }
                    };
                });
            };

            atSelect.onchange = renderSavedEntriesList;

            dialog.querySelector('#btnSaveBOEModal').onclick = async () => {
                const atId = atSelect.value;
                const atOpt = atSelect.options[atSelect.selectedIndex];
                const atName = atOpt ? (atOpt.getAttribute('data-name') || '') : '';

                const cName = classInput.value.trim();

                if (!atId) {
                    window.showToast("Please select an Award Type.", "warning");
                    atSelect.focus();
                    return;
                }

                if (!cName) {
                    window.showToast("Please enter a Class / Standard.", "warning");
                    classInput.focus();
                    return;
                }

                const matchedClass = allClasses.find(cls => cls.name.toLowerCase() === cName.toLowerCase());
                const cId = matchedClass ? matchedClass.id : ('cls_' + cName.toLowerCase().replace(/[^a-z0-9]/g, '_'));

                const getNames = (container) => {
                    const inputs = container.querySelectorAll('.boe-name-input');
                    const names = [];
                    inputs.forEach(inp => {
                        const val = inp.value.trim();
                        if (val) names.push(val);
                    });
                    return names;
                };

                const firstNames = getNames(firstRowsContainer);
                const secondNames = getNames(secondRowsContainer);
                const thirdNames = getNames(thirdRowsContainer);

                if (firstNames.length === 0 && secondNames.length === 0 && thirdNames.length === 0) {
                    window.showToast("Please enter at least one student name.", "warning");
                    return;
                }

                const saveModalBtn = dialog.querySelector('#btnSaveBOEModal');
                saveModalBtn.disabled = true;
                saveModalBtn.textContent = "💾 Saving...";

                try {
                    const targetDocId = `class_award_${cId}_${atId}`;
                    const awardDocRef = doc(db, "institutes", instId, "metadata", targetDocId);

                    // If editing a document and docId changed (due to class/type change), clean up old document
                    if (activeEditingDocId && activeEditingDocId !== targetDocId) {
                        await deleteDoc(doc(db, "institutes", instId, "metadata", activeEditingDocId));
                    }

                    const createWinnerObj = (name) => ({
                        studentId: null,
                        name: name,
                        chestNumber: '',
                        className: cName,
                        classId: cId,
                        sourceType: 'old_student',
                        isOldStudent: true,
                        awardType: atName
                    });

                    const firstWinners = firstNames.map(createWinnerObj);
                    const secondWinners = secondNames.map(createWinnerObj);
                    const thirdWinners = thirdNames.map(createWinnerObj);

                    const payload = {
                        classId: cId,
                        className: cName,
                        awardTypeId: atId,
                        awardType: atName,
                        firstPlaceWinners: firstWinners,
                        secondPlaceWinners: secondWinners,
                        thirdPlaceWinners: thirdWinners,
                        updatedAt: serverTimestamp()
                    };

                    await setDoc(awardDocRef, payload);
                    window.showToast(`Award entries saved for ${cName} • ${atName}!`, "success");

                    resetFormInputs();
                    await loadAndRenderSavedEntries();

                    if (selectedClassId === cId && selectedAwardTypeId === atId) {
                        await loadConfigState();
                    }
                } catch (err) {
                    console.error("Error saving bulk other entry:", err);
                    window.showToast("Failed to save award entries.", "error");
                } finally {
                    saveModalBtn.disabled = false;
                    saveModalBtn.textContent = "💾 Save Entry";
                }
            };

            await loadAndRenderSavedEntries();
        };

        classSelect.onchange = loadConfigState;
        awardTypeSelect.onchange = loadConfigState;

        await loadAwardTypesConfig();
        renderAwardTypeSelect();
        document.getElementById('btnManageAwardTypes').onclick = openManageAwardTypesModal;
        document.getElementById('btnOtherEntry').onclick = openBulkOtherEntryModal;

        saveBtn.onclick = async () => {
            if (!selectedClassId || !selectedAwardTypeId) return;

            // Save-time duplicate checks across place 1, 2, and 3
            let duplicateFound = null;
            let duplicatePlace = '';
            
            const placesData = [
                { placeNum: 1, nameStr: '1st Place', items: firstPlaceWinners },
                { placeNum: 2, nameStr: '2nd Place', items: secondPlaceWinners },
                { placeNum: 3, nameStr: '3rd Place', items: thirdPlaceWinners }
            ];

            for (let pIdx = 0; pIdx < placesData.length; pIdx++) {
                const currentPlace = placesData[pIdx];
                for (let i = 0; i < currentPlace.items.length; i++) {
                    const w = currentPlace.items[i];
                    for (let otherIdx = 0; otherIdx < placesData.length; otherIdx++) {
                        const checkPlace = placesData[otherIdx];
                        const isSame = pIdx === otherIdx;
                        
                        const isDup = checkPlace.items.some((x, idx) => {
                            if (isSame && idx === i) return false;
                            if (w.studentId && x.studentId) {
                                return x.studentId === w.studentId;
                            }
                            return x.name.toLowerCase() === w.name.toLowerCase();
                        });

                        if (isDup) {
                            duplicateFound = w;
                            duplicatePlace = checkPlace.nameStr;
                            break;
                        }
                    }
                    if (duplicateFound) break;
                }
                if (duplicateFound) break;
            }

            if (duplicateFound) {
                window.showToast(`${duplicateFound.name} is already added as a ${duplicatePlace} winner for this award.`, "warning");
                return;
            }

            saveBtn.disabled = true;
            saveBtn.textContent = '💾 Saving...';

            try {
                const docId = `class_award_${selectedClassId}_${selectedAwardTypeId}`;
                const awardDocRef = doc(db, "institutes", instId, "metadata", docId);

                if (firstPlaceWinners.length === 0 && secondPlaceWinners.length === 0 && thirdPlaceWinners.length === 0) {
                    // All empty, delete the record
                    await deleteDoc(awardDocRef);
                    window.showToast("Class awards cleared successfully.", "success");
                } else {
                    const payload = {
                        classId: selectedClassId,
                        className: selectedClassName,
                        awardTypeId: selectedAwardTypeId,
                        awardType: selectedAwardTypeName,
                        firstPlaceWinners: firstPlaceWinners,
                        secondPlaceWinners: secondPlaceWinners,
                        thirdPlaceWinners: thirdPlaceWinners,
                        updatedAt: serverTimestamp()
                    };

                    await setDoc(awardDocRef, payload);
                    window.showToast("Class awards saved successfully!", "success");
                }
            } catch (err) {
                console.error("Error saving class awards:", err);
                window.showToast("Failed to save class awards.", "error");
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = '💾 Save Selections';
            }
        };

    } catch (err) {
        console.error("Error initializing Class Awards UI:", err);
        container.innerHTML = `<div style="padding:1.5rem; background:#fee2e2; color:#b91c1c; border-radius:8px; border:1px solid #fecaca; font-weight:600; text-align:center;">Failed to initialize Class Awards view: ${err.message || err}</div>`;
    }
}
