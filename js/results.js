import { db } from './firebase.js';
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
    classId: '',
    gender: '',
    stage: '',
    onlyPublished: false
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
        const catSnap = await getDocs(collection(db, "institutes", window.currentInstituteId, "categories"));
        catSnap.forEach(d => {
            catOptions += `<option value="${d.id}">${window.escapeHTML(d.data().name)}</option>`;
        });
    } catch (e) { console.error(e); }

    topActions.innerHTML = `
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center;">
            <select id="resCatFilter" class="form-input" style="width:140px;">${catOptions}</select>
            <select id="resClassFilter" class="form-input" style="width:140px;" disabled>
                <option value="">All Classes</option>
            </select>
            <select id="resGenderFilter" class="form-input" style="width:120px;">
                <option value="">All Genders</option>
                <option value="Boys">Boys</option>
                <option value="Girls">Girls</option>
                <option value="Mixed">Mixed</option>
            </select>
            <select id="resStageFilter" class="form-input" style="width:120px;">
                <option value="">All Stages</option>
                <option value="Stage">Stage</option>
                <option value="Off Stage">Off Stage</option>
            </select>
            <label style="display:flex; align-items:center; gap:0.35rem; font-size:0.8rem; font-weight:700; color:#475569; cursor:pointer; user-select:none;">
                <input type="checkbox" id="resOnlyPublished" style="cursor:pointer;" /> Only Published
            </label>
            <button class="btn btn-primary btn-sm" id="btnPublishAll" style="font-weight:700;">🚀 Publish All</button>
        </div>
    `;

    // Main layout with side leaderboard
    container.innerHTML = `
        <div style="display:flex; gap:1.5rem; flex-wrap:wrap; align-items:flex-start; width:100%;">
            <!-- Left Results Panel -->
            <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:1.25rem; width:100%;">
                <!-- Stats Grid -->
                <div class="grid" id="resultsStatsGrid" style="grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:0.75rem; margin:0;">
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
            <div class="card" style="width:340px; flex-shrink:0; padding:1.25rem; border-color:#cbd5e1; position:sticky; top:1rem;">
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
    `;

    // Wire filters
    const catFilter = document.getElementById('resCatFilter');
    const classFilter = document.getElementById('resClassFilter');
    const genderFilter = document.getElementById('resGenderFilter');
    const stageFilter = document.getElementById('resStageFilter');
    const onlyPublishedCheck = document.getElementById('resOnlyPublished');
    const publishAllBtn = document.getElementById('btnPublishAll');

    catFilter.onchange = async (e) => {
        resultsFilter.categoryId = e.target.value;
        resultsFilter.classId = '';
        classFilter.innerHTML = '<option value="">All Classes</option>';
        classFilter.disabled = true;

        if (resultsFilter.categoryId) {
            const catDoc = await getDoc(doc(db, "institutes", window.currentInstituteId, "categories", resultsFilter.categoryId));
            if (catDoc.exists()) {
                const classes = normalizeClasses(catDoc.data().classes || []);
                classes.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c.id;
                    opt.textContent = c.name;
                    classFilter.appendChild(opt);
                });
                classFilter.disabled = false;
            }
        }
        renderResultsView();
    };

    classFilter.onchange = (e) => {
        resultsFilter.classId = e.target.value;
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

    onlyPublishedCheck.onchange = (e) => {
        resultsFilter.onlyPublished = e.target.checked;
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
                    if (w.teamName && w.totalPoints > 0) {
                        const current = teamPoints.get(w.teamName) || 0;
                        teamPoints.set(w.teamName, current + (w.totalPoints || 0));
                    }
                });
            } else if (Array.isArray(r.winners)) {
                // Fallback for backward compatibility
                r.winners.forEach(w => {
                    if (w.teamName) {
                        const current = teamPoints.get(w.teamName) || 0;
                        teamPoints.set(w.teamName, current + (w.marks || 0));
                    }
                });
            }
        }
    });

    const sortedTeams = [...teamPoints.entries()].sort((a, b) => b[1] - a[1]);
    const leaderboardBody = document.getElementById('resLeaderboardBody');
    
    if (leaderboardBody) {
        if (sortedTeams.length === 0) {
            leaderboardBody.innerHTML = `<tr><td colspan="2" style="text-align:center; padding:1.25rem; color:#94a3b8;">No published points yet.</td></tr>`;
        } else {
            leaderboardBody.innerHTML = sortedTeams.map(([name, points], idx) => {
                const medalStyle = idx === 0 ? '🏆 ' : (idx === 1 ? '🥈 ' : (idx === 2 ? '🥉 ' : ''));
                return `
                    <tr style="border-bottom:1px solid #f1f5f9; hover:background:#f8fafc;">
                        <td style="padding:0.6rem 0.5rem; font-weight:700; color:#1e293b; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                            ${medalStyle}${window.escapeHTML(name)}
                        </td>
                        <td style="padding:0.6rem 0.5rem; text-align:right; font-weight:800; color:#4338ca;">
                            ${points} pts
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
        if (resultsFilter.onlyPublished && r.status !== 'published') return false;
        if (resultsFilter.categoryId && r.categoryId !== resultsFilter.categoryId) return false;
        if (resultsFilter.classId && r.classId !== resultsFilter.classId) return false;
        if (resultsFilter.gender && r.genderCategory !== resultsFilter.gender) return false;
        if (resultsFilter.stage && r.programLocation !== resultsFilter.stage) return false;
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
                if (!confirm("Publish this result to the public portal?")) return;
                try {
                    await updateDoc(doc(db, "institutes", window.currentInstituteId, "results", r.id), {
                        status: 'published',
                        publishedAt: serverTimestamp()
                    });
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
                if (!confirm("Revoke this result from the public view?")) return;
                try {
                    await updateDoc(doc(db, "institutes", window.currentInstituteId, "results", r.id), {
                        status: 'draft',
                        markEntryStatus: 'submitted'
                    });
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
    // Set custom large dimensions for results details popup to prevent compression and nested scrollbars
    modalEl.style.width = '90%';
    modalEl.style.maxWidth = '1250px';
    modalEl.style.height = '88vh';
    modalEl.style.maxHeight = '90vh';

    const handleClose = () => {
        // Restore default small modal styles to prevent style leakages
        modalEl.style.width = '';
        modalEl.style.maxWidth = '';
        modalEl.style.height = '';
        modalEl.style.maxHeight = '';
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

    // Compute rendered ranks dynamically (handling standard competition ties)
    for (let i = 0; i < sortedData.length; i++) {
        const item = sortedData[i];
        const hasScore = item.finalMark !== undefined && item.finalMark > 0;
        if (hasScore) {
            if (i > 0 && item.finalMark === sortedData[i - 1].finalMark) {
                item.renderedRank = sortedData[i - 1].renderedRank;
            } else {
                item.renderedRank = i + 1;
            }
        } else {
            item.renderedRank = null;
        }
    }

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

            const displayName = isGroup ? item.teamName : item.studentName;
            const teamDisplay = isGroup ? 'Group Entry' : (item.teamName || '—');
            const finalMark = hasScore ? item.finalMark : '—';
            const grade = hasScore ? (item.grade || '—') : '—';
            const points = hasScore ? `${item.totalPoints || 0}pts` : '—';

            return `
                <tr style="border-bottom:1px solid #e2e8f0; hover:background:#f8fafc;">
                    <td style="padding:0.75rem 1rem; text-align:center; font-weight:700; color:#475569;">${positionHTML}</td>
                    <td style="padding:0.75rem 1rem; font-weight:700; color:#1e293b;">${window.escapeHTML(displayName)}</td>
                    <td style="padding:0.75rem 1rem; color:#475569; font-weight:600;">${window.escapeHTML(teamDisplay)}</td>
                    <td style="padding:0.75rem 1rem; text-align:center; font-weight:800; color:#0f172a;">${finalMark}</td>
                    <td style="padding:0.75rem 1rem; text-align:center;">
                        ${grade !== '—' ? `<span class="badge" style="background:#e0e7ff; color:#4338ca; border:1px solid #c7d2fe; font-size:0.75rem; font-weight:700;">${grade}</span>` : '—'}
                    </td>
                    <td style="padding:0.75rem 1rem; text-align:center;">
                        ${points !== '—' ? `<span class="badge" style="background:#f0fdf4; color:#16a34a; border:1px solid #bbf7d0; font-size:0.75rem; font-weight:700;">${points}</span>` : '—'}
                    </td>
                    <td style="padding:0.75rem 1rem; text-align:center;">
                        <div style="display:inline-flex; gap:0.4rem; justify-content:center;">
                            <button type="button" class="btn btn-popup-edit" style="background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; font-weight:700; padding:0.3rem 0.6rem; border-radius:6px; font-size:0.78rem; cursor:pointer; display:flex; align-items:center; gap:0.25rem;">
                                ✏️ Edit
                            </button>
                            <button type="button" class="btn btn-popup-delete" style="background:#fef2f2; color:#dc2626; border:1px solid #fecaca; font-weight:700; padding:0.3rem 0.6rem; border-radius:6px; font-size:0.78rem; cursor:pointer; display:flex; align-items:center; gap:0.25rem;">
                                🗑️ Delete
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    modalBody.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:1rem; height:100%; width:100%;">
            <!-- Header Summary Row -->
            <div style="background:#linear-gradient(135deg, #f5f3ff, #ede9fe); border:1px solid #cbd5e1; border-radius:12px; padding:1rem 1.25rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem; box-shadow:0 1px 2px rgba(0,0,0,0.02);">
                <div style="display:flex; flex-direction:column; gap:0.2rem;">
                    <h4 style="margin:0; font-size:1.15rem; font-weight:800; color:#1e1b4b; line-height:1.2;">${window.escapeHTML(r.programName)}</h4>
                    <div style="font-size:0.75rem; font-weight:700; color:#4338ca; display:flex; gap:0.75rem; flex-wrap:wrap; align-items:center;">
                        <span>Category: <strong style="color:#1e1b4b;">${window.escapeHTML(r.categoryName || 'General')}</strong></span>
                        ${r.className ? `<span>Class: <strong style="color:#1e1b4b;">${window.escapeHTML(r.className)}</strong></span>` : ''}
                        <span>Type: <strong style="color:#1e1b4b;">${r.programType === 'group' ? 'Group' : 'Individual'}</strong></span>
                        <span>Gender: <strong style="color:#1e1b4b;">${window.escapeHTML(r.genderCategory || 'Mixed')}</strong></span>
                        <span>Stage: <strong style="color:#1e1b4b;">${window.escapeHTML(r.programLocation || 'Stage')}</strong></span>
                    </div>
                </div>
                <div style="display:flex; align-items:center; gap:0.75rem;">
                    <div style="text-align:right;">
                        <span style="font-size:0.7rem; font-weight:700; color:#64748b; text-transform:uppercase; display:block; margin-bottom:0.1rem;">Status</span>
                        ${statusBadge}
                    </div>
                    <div style="text-align:right;">
                        <span style="font-size:0.7rem; font-weight:700; color:#64748b; text-transform:uppercase; display:block; margin-bottom:0.1rem;">Participants</span>
                        <span style="font-weight:800; color:#1e293b; font-size:0.9rem;">${partCount} Entries</span>
                    </div>
                </div>
            </div>

            <!-- Standings Table Container (Only this scrolls) -->
            <div style="flex:1; overflow-y:auto; min-height:0; width:100%; border:1px solid #cbd5e1; border-radius:12px; background:#fff; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                <table style="width:100%; border-collapse:collapse; text-align:left; font-size:0.85rem; min-width:800px; color:#1e293b;">
                    <thead>
                        <tr style="background:#f8fafc; border-bottom:2px solid #cbd5e1; position:sticky; top:0; z-index:10;">
                            <th style="padding:0.75rem 1rem; color:#475569; font-weight:700; text-align:center; width:100px;">Position</th>
                            <th style="padding:0.75rem 1rem; color:#475569; font-weight:700;">Name</th>
                            <th style="padding:0.75rem 1rem; color:#475569; font-weight:700; width:220px;">Team</th>
                            <th style="padding:0.75rem 1rem; color:#475569; font-weight:700; width:130px; text-align:center;">Average Mark</th>
                            <th style="padding:0.75rem 1rem; color:#475569; font-weight:700; width:100px; text-align:center;">Grade</th>
                            <th style="padding:0.75rem 1rem; color:#475569; font-weight:700; width:100px; text-align:center;">Points</th>
                            <th style="padding:0.75rem 1rem; color:#475569; font-weight:700; width:180px; text-align:center;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRowsHTML}
                    </tbody>
                </table>
            </div>

            <!-- Footer Action Row -->
            <div class="modal-actions" style="margin-top:0.25rem; border-top:1px solid #e2e8f0; padding-top:0.75rem; display:flex; justify-content:flex-end;">
                <button type="button" class="btn btn-secondary" id="btnOpenResClose" style="min-width:120px; font-weight:700;">Close Details</button>
            </div>
        </div>
    `;

    modal.classList.remove('hidden');

    // Bind Close actions
    document.getElementById('closeDynamicModalBtn').onclick = handleClose;
    document.getElementById('btnOpenResClose').onclick = handleClose;

    // Bind Row actions dynamically
    modalBody.querySelectorAll('.btn-popup-edit').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const prog = allPrograms.find(p => p.id === r.programId);
            if (prog) {
                handleClose();
                openMarkEntryModal(prog);
            } else {
                window.showToast("Could not find the original program for this result.", "error");
            }
        };
    });

    modalBody.querySelectorAll('.btn-popup-delete').forEach(btn => {
        btn.onclick = async (e) => {
            e.stopPropagation();
            if (!confirm("Delete this result permanently?")) return;

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
                window.showToast("Result deleted permanently!", "success");
            } catch (err) {
                console.error("Error deleting result:", err);
                window.showToast(`Unable to delete: ${err.message || err}`, "error");
            }
        };
    });
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

    if (!confirm(`Are you sure you want to publish all ${submittedDrafts.length} submitted program results at once?`)) return;

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
        window.showToast(`Successfully published all ${submittedDrafts.length} program results!`, "success");
    } catch (err) {
        console.error("Batch publish error:", err);
        window.showToast("Failed to batch publish results.", "error");
    }
}
