import { db, updateDashboardMetadata, getCachedCategories, getCachedPrograms, computeDenseRanking } from './firebase.js';
import {
    collection, getDocs, doc, getDoc, setDoc, onSnapshot, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// ─────────────────────────────────────────────
// Point Systems & Grading Mapping
// ─────────────────────────────────────────────
const POSITION_POINTS = { 'First': 10, 'Second': 8, 'Third': 6, 'Participation': 0 };

function getGradeAndPoints(score) {
    if (score >= 90) return { grade: 'A+', points: 5 };
    if (score >= 80) return { grade: 'A', points: 4 };
    if (score >= 70) return { grade: 'B+', points: 3 };
    if (score >= 60) return { grade: 'B', points: 2 };
    if (score >= 50) return { grade: 'C', points: 1 };
    return { grade: '', points: 0 };
}

// ─────────────────────────────────────────────
// Module State
// ─────────────────────────────────────────────
let markEntryFilter = {
    search: '',
    categoryId: '',
    gender: '',
    stage: '',
    status: ''
};

let allPrograms = [];
let allResults = new Map(); // programId -> resultDoc
let unsubscribeMarkEntry = null;

// ─────────────────────────────────────────────
// Init View
// ─────────────────────────────────────────────
export async function initMarkEntryView(container, topActions) {
    if (!window.currentInstituteId) {
        container.innerHTML = '<div class="empty-state"><h3>Access Denied</h3><p>Please log in again.</p></div>';
        return;
    }

    if (unsubscribeMarkEntry) {
        unsubscribeMarkEntry();
        unsubscribeMarkEntry = null;
    }

    allPrograms = [];
    allResults.clear();

    // Load Categories for filter using the pre-existing cache
    let catOptions = '<option value="">All Categories</option>';
    try {
        const categories = await getCachedCategories(window.currentInstituteId);
        categories.forEach(c => {
            catOptions += `<option value="${c.id}">${window.escapeHTML(c.name)}</option>`;
        });
        catOptions += `<option value="general_programs">General Programs</option>`;
    } catch (e) { console.error(e); }

    topActions.innerHTML = `
        <style>
            /* Premium SaaS compact toolbar styles */
            .me-toolbar-desktop {
                display: flex !important;
                gap: 8px !important;
                align-items: center !important;
                width: 100% !important;
                background: #ffffff !important;
                border: 1px solid #e2e8f0 !important;
                border-radius: 8px !important;
                padding: 6px 12px !important;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02) !important;
                margin-bottom: 0.5rem !important;
            }
            .me-toolbar-desktop .form-input, .me-toolbar-desktop select {
                height: 32px !important;
                padding: 2px 8px !important;
                font-size: 0.8rem !important;
                font-weight: 600 !important;
                border-radius: 6px !important;
                border: 1px solid #cbd5e1 !important;
                background-color: #ffffff !important;
                color: #334155 !important;
                outline: none !important;
                transition: all 0.2s ease !important;
            }
            .me-toolbar-desktop input[type="text"] {
                flex: 1.5 !important;
                min-width: 140px !important;
            }
            .me-toolbar-desktop select {
                flex: 1 !important;
                min-width: 110px !important;
                cursor: pointer !important;
            }
            .me-toolbar-desktop .form-input:focus, .me-toolbar-desktop select:focus {
                border-color: #6366f1 !important;
                box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.1) !important;
            }
            
            /* Responsive styling for Mobile */
            @media (max-width: 768px) {
                .me-toolbar-desktop {
                    display: none !important;
                }
                .me-toolbar-mobile {
                    display: flex !important;
                    flex-direction: column !important;
                    gap: 6px !important;
                    background: #ffffff !important;
                    border: 1px solid #e2e8f0 !important;
                    border-radius: 8px !important;
                    padding: 8px !important;
                    margin-bottom: 0.5rem !important;
                    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02) !important;
                    width: 100% !important;
                }
                .me-toolbar-mobile .me-row-1 {
                    display: flex !important;
                    width: 100% !important;
                }
                .me-toolbar-mobile .me-row-2, .me-toolbar-mobile .me-row-3 {
                    display: grid !important;
                    grid-template-columns: 1fr 1fr !important;
                    gap: 6px !important;
                    width: 100% !important; 
                }
                .me-toolbar-mobile .form-input, .me-toolbar-mobile select {
                    height: 32px !important;
                    padding: 2px 8px !important;
                    font-size: 0.8rem !important;
                    font-weight: 600 !important;
                    border-radius: 6px !important;
                    border: 1px solid #cbd5e1 !important;
                    width: 100% !important;
                }
            }
            @media (min-width: 769px) {
                .me-toolbar-mobile {
                    display: none !important;
                }
            }

            /* Table layouts */
            .me-table-container {
                width: 100% !important;
                overflow-x: auto !important;
                background: #ffffff !important;
                border: 1px solid #e2e8f0 !important;
                border-radius: 12px !important;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02) !important;
                margin-top: 0.5rem !important;
            }
            .me-table {
                width: 100% !important;
                border-collapse: collapse !important;
                text-align: left !important;
                font-size: 0.85rem !important;
            }
            .me-table th {
                background: #f8fafc !important;
                padding: 10px 12px !important;
                font-weight: 700 !important;
                color: #475569 !important;
                font-size: 0.78rem !important;
                text-transform: uppercase !important;
                border-bottom: 2px solid #e2e8f0 !important;
            }
            .me-table td {
                padding: 10px 12px !important;
                border-bottom: 1px solid #e2e8f0 !important;
                vertical-align: middle !important;
                color: #334155 !important;
            }
            .me-table tr:hover {
                background: #f8fafc !important;
            }
            .me-action-btn {
                display: inline-flex !important;
                align-items: center !important;
                gap: 4px !important;
                padding: 5px 12px !important;
                font-size: 0.78rem !important;
                font-weight: 700 !important;
                border-radius: 6px !important;
                background: #6366f1 !important;
                color: #ffffff !important;
                border: none !important;
                cursor: pointer !important;
                transition: all 0.2s ease !important;
            }
            .me-action-btn:hover {
                background: #4f46e5 !important;
            }
            
            /* Responsive hidden columns on mobile */
            @media (max-width: 768px) {
                .me-table th.me-desktop-col,
                .me-table td.me-desktop-col {
                    display: none !important;
                }
                .me-table th, .me-table td {
                    padding: 8px 10px !important;
                    font-size: 0.8rem !important;
                }
            }
        </style>

        <!-- Desktop Compact SaaS Toolbar -->
        <div class="me-toolbar-desktop">
            <input type="text" id="meSearchInput" class="form-input" placeholder="Search programs..." />
            <select id="meCatFilter" class="form-input">${catOptions}</select>
            <select id="meGenderFilter" class="form-input">
                <option value="">All Genders</option>
                <option value="Boys">Boys</option>
                <option value="Girls">Girls</option>
                <option value="Mixed">Mixed</option>
            </select>
            <select id="meStageFilter" class="form-input">
                <option value="">All Stages</option>
                <option value="Stage">Stage</option>
                <option value="Off Stage">Off Stage</option>
            </select>
            <select id="meStatusFilter" class="form-input">
                <option value="">All Statuses</option>
                <option value="Pending">Pending</option>
                <option value="Active">Active</option>
                <option value="Submitted">Submitted</option>
                <option value="Published">Published</option>
            </select>
        </div>

        <!-- Mobile 3-Row Compact Toolbar -->
        <div class="me-toolbar-mobile">
            <!-- Row 1: Search -->
            <div class="me-row-1">
                <input type="text" id="meSearchInputMobile" class="form-input" placeholder="Search Program" />
            </div>
            <!-- Row 2: Category and Gender -->
            <div class="me-row-2">
                <select id="meCatFilterMobile" class="form-input">${catOptions}</select>
                <select id="meGenderFilterMobile" class="form-input">
                    <option value="">All Genders</option>
                    <option value="Boys">Boys</option>
                    <option value="Girls">Girls</option>
                    <option value="Mixed">Mixed</option>
                </select>
            </div>
            <!-- Row 3: Stage and Status -->
            <div class="me-row-3">
                <select id="meStageFilterMobile" class="form-input">
                    <option value="">All Stages</option>
                    <option value="Stage">Stage</option>
                    <option value="Off Stage">Off Stage</option>
                </select>
                <select id="meStatusFilterMobile" class="form-input">
                    <option value="">All Statuses</option>
                    <option value="Pending">Pending</option>
                    <option value="Active">Active</option>
                    <option value="Submitted">Submitted</option>
                    <option value="Published">Published</option>
                </select>
            </div>
        </div>
    `;

    container.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem; flex-wrap:wrap; gap:0.5rem;">
            <div>
                <h2 class="teams-view-heading" style="font-size:1.25rem; font-weight:700; margin:0; color:#0f172a;">Program Mark Entry</h2>
            </div>
            <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                <button class="btn btn-secondary" id="btnCopySharedLink" style="font-weight:700;">🔗 Copy Shared Link</button>
                <button class="btn btn-primary" id="btnGoJudges" style="font-weight:700;">🧑‍⚖️ Judges Management</button>
            </div>
        </div>
        <div class="me-table-container" id="markEntryGrid">
            <div class="loader-container"><div class="spinner"></div></div>
        </div>
    `;

    document.getElementById('btnGoJudges')?.addEventListener('click', () => window.navigateTo('judges'));
    document.getElementById('btnCopySharedLink')?.addEventListener('click', () => {
        const instId = window.currentInstituteId || '';
        const origin = window.location.origin;
        const pathname = window.location.pathname;
        let basePath = pathname.substring(0, pathname.lastIndexOf('/') + 1);
        const link = `${origin}${basePath}admin-dashboard.html?mode=standalone&instituteId=${instId}`;
        
        if (navigator.clipboard) {
            navigator.clipboard.writeText(link).then(() => {
                window.showToast("Shared Mark Entry Link copied to clipboard!", "success");
            }).catch(() => {
                prompt("Copy Shared Mark Entry Link:", link);
            });
        } else {
            prompt("Copy Shared Mark Entry Link:", link);
        }
    });

    // Wire filter listeners (Sync desktop <-> mobile)
    const inputs = [
        { dt: 'meSearchInput', mb: 'meSearchInputMobile', key: 'search', type: 'input' },
        { dt: 'meCatFilter', mb: 'meCatFilterMobile', key: 'categoryId', type: 'change' },
        { dt: 'meGenderFilter', mb: 'meGenderFilterMobile', key: 'gender', type: 'change' },
        { dt: 'meStageFilter', mb: 'meStageFilterMobile', key: 'stage', type: 'change' },
        { dt: 'meStatusFilter', mb: 'meStatusFilterMobile', key: 'status', type: 'change' }
    ];

    function syncFilter(key, value) {
        markEntryFilter[key] = value;
        inputs.forEach(item => {
            if (item.key === key) {
                const elDt = document.getElementById(item.dt);
                const elMb = document.getElementById(item.mb);
                if (elDt && elDt.value !== value) elDt.value = value;
                if (elMb && elMb.value !== value) elMb.value = value;
            }
        });
        renderMarkEntryGrid();
    }

    inputs.forEach(item => {
        const elDt = document.getElementById(item.dt);
        const elMb = document.getElementById(item.mb);
        
        if (elDt) {
            elDt.addEventListener(item.type, (e) => {
                const val = item.key === 'search' ? e.target.value.toLowerCase().trim() : e.target.value;
                syncFilter(item.key, val);
            });
        }
        if (elMb) {
            elMb.addEventListener(item.type, (e) => {
                const val = item.key === 'search' ? e.target.value.toLowerCase().trim() : e.target.value;
                syncFilter(item.key, val);
            });
        }
    });

    await loadMarkEntryData();
}

// ─────────────────────────────────────────────
// Data Loading & Syncing
// ─────────────────────────────────────────────
async function loadMarkEntryData() {
    try {
        // Fetch all categories first to construct mapping
        const categories = await getCachedCategories(window.currentInstituteId);
        const catMap = new Map(categories.map(c => [c.id, c.name]));

        // Fetch all programs from caching layer
        const cachedPrograms = await getCachedPrograms(window.currentInstituteId);
        
        allPrograms = cachedPrograms.map(p => {
            const pType = (p.programType || p.type || 'individual').toLowerCase();
            const regType = (pType === 'general') ? (p.registrationType || 'individual') : pType;
            const categoryName = p.categoryId === 'general_programs' ? 'General' : (catMap.get(p.categoryId) || p.categoryName || 'General');
            
            return {
                id: p.id,
                programName: p.programName || 'Unnamed Program',
                programType: pType,
                type: regType === 'group' ? 'Group' : 'Individual',
                registrationType: regType,
                genderCategory: p.genderCategory || 'Mixed',
                programLocation: p.programLocation || p.location || 'Stage',
                groupSize: p.maxParticipants || p.groupSize || 1,
                categoryId: p.categoryId || '',
                categoryName: categoryName,
                classId: p.classId || '',
                className: p.className || ''
            };
        });

        // Real-time listener for results to map status reactively
        const resultsRef = collection(db, "institutes", window.currentInstituteId, "results");
        unsubscribeMarkEntry = onSnapshot(resultsRef, (snapshot) => {
            allResults.clear();
            snapshot.forEach(d => {
                const r = d.data();
                if (r.programId) {
                    allResults.set(r.programId, { id: d.id, ...r });
                }
            });
            renderMarkEntryGrid();
        });

    } catch (err) {
        console.error("Error loading Mark Entry data:", err);
        const grid = document.getElementById('markEntryGrid');
        if (grid) grid.innerHTML = '<div class="empty-state"><h3>Error</h3><p>Failed to load data.</p></div>';
    }
}

// ─────────────────────────────────────────────
// Render High-Density Table
// ─────────────────────────────────────────────
function renderMarkEntryGrid() {
    const grid = document.getElementById('markEntryGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const filtered = allPrograms.filter(p => {
        // Text Search
        if (markEntryFilter.search && !p.programName.toLowerCase().includes(markEntryFilter.search)) return false;
        // Filters
        if (markEntryFilter.categoryId && p.categoryId !== markEntryFilter.categoryId) return false;
        if (markEntryFilter.gender && p.genderCategory !== markEntryFilter.gender) return false;
        if (markEntryFilter.stage && p.programLocation !== markEntryFilter.stage) return false;

        // Status filter
        const status = getProgramStatus(p.id);
        if (markEntryFilter.status && status !== markEntryFilter.status) return false;

        return true;
    });

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="padding: 2.5rem 1rem; text-align: center;">
                <div class="empty-state-icon" style="font-size: 2rem;">🖋️</div>
                <h3 style="margin-top: 0.5rem; font-size: 1.1rem; color: #1e293b;">No Matching Programs</h3>
                <p style="color: #64748b; font-size: 0.85rem;">Try adjusting your search query or filters.</p>
            </div>`;
        return;
    }

    let rowsHTML = filtered.map(p => {
        const status = getProgramStatus(p.id);
        const badge = getStatusBadgeHTML(status);
        const displayType = p.programType === 'general' ? 'General' : p.type;
        
        return `
            <tr>
                <td style="font-weight: 700; color: #1e293b;">
                    ${window.escapeHTML(p.programName)}
                </td>
                <td style="font-weight: 600;">
                    <span class="me-type-badge">${window.escapeHTML(displayType)}</span>
                </td>
                <td class="me-desktop-col" style="font-weight: 600; color: #475569;">
                    ${window.escapeHTML(p.categoryName)}
                </td>
                <td>
                    ${badge}
                </td>
                <td style="text-align: center;">
                    <button class="me-action-btn btn-me-open" data-id="${p.id}">
                        🖋️ <span class="me-desktop-col">Mark Entry</span>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    grid.innerHTML = `
        <table class="me-table">
            <thead>
                <tr>
                    <th style="width: 40%;">Program Name</th>
                    <th style="width: 15%;">Type</th>
                    <th style="width: 15%;" class="me-desktop-col">Category</th>
                    <th style="width: 15%;">Status</th>
                    <th style="width: 15%; text-align: center;">Action</th>
                </tr>
            </thead>
            <tbody id="meTableBody">
                ${rowsHTML}
            </tbody>
        </table>
    `;

    const tbody = grid.querySelector('#meTableBody');
    if (tbody) {
        tbody.querySelectorAll('.btn-me-open').forEach(btn => {
            const id = btn.getAttribute('data-id');
            const prog = filtered.find(p => p.id === id);
            if (prog) {
                btn.onclick = () => openMarkEntryModal(prog);
            }
        });
    }
}

function getProgramStatus(progId) {
    const res = allResults.get(progId);
    if (!res) return 'Pending';
    if (res.status === 'published') return 'Published';
    if (res.markEntryStatus === 'submitted') return 'Submitted';
    return 'Active';
}

function getStatusBadgeHTML(status) {
    const styles = {
        'Pending': 'background:#f1f5f9; color:#64748b; border:1px solid #cbd5e1;',
        'Active': 'background:#f0fdf4; color:#166534; border:1px solid #bbf7d0;',
        'Submitted': 'background:#eff6ff; color:#1e40af; border:1px solid #bfdbfe;',
        'Published': 'background:#faf5ff; color:#6b21a8; border:1px solid #e9d5ff;'
    };
    return `<span class="me-badge" style="${styles[status]}">${status}</span>`;
}

// ─────────────────────────────────────────────
// Loading Subcollection Data
// ─────────────────────────────────────────────
async function loadStudentsForProgram(prog) {
    const snap = await getDocs(collection(db, "institutes", window.currentInstituteId, "programs", prog.id, "participants"));
    const isGroup = prog.programType === 'group' || prog.registrationType === 'group' || prog.type === 'Group';
    const list = [];

    snap.docs.forEach(d => {
        const p = d.data();
        if (isGroup) {
            const groups = Array.isArray(p.groups) ? p.groups : [];
            if (groups.length > 0) {
                groups.forEach(g => {
                    list.push({
                        id: g.id || `${p.teamId || d.id}_${g.name || 'group'}`,
                        name: g.name || p.teamName || 'Group',
                        chestNumber: '—',
                        teamId: p.teamId || '',
                        teamName: p.teamName || ''
                    });
                });
            } else {
                list.push({
                    id: p.teamId || d.id,
                    name: p.teamName || 'Team',
                    chestNumber: '—',
                    teamId: p.teamId || '',
                    teamName: p.teamName || ''
                });
            }
        } else {
            list.push({
                id: p.studentId || d.id,
                name: p.studentName || '—',
                chestNumber: p.chestNumber || '—',
                teamId: p.teamId || '',
                teamName: p.teamName || ''
            });
        }
    });
    return list;
}

// ─────────────────────────────────────────────
// Two-Step Marks Entry Modal
// ─────────────────────────────────────────────
export async function openMarkEntryModal(prog) {
    const modal = document.getElementById('dynamicModal');
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');

    modal.classList.add('result-fullscreen-modal');
    modalTitle.textContent = '🖋️ Mark Entry Selection';
    modalBody.innerHTML = `<div style="text-align:center;padding:2rem;"><div class="spinner"></div><p style="margin-top:0.75rem;color:#64748b;">Loading active judges list...</p></div>`;
    modal.classList.remove('hidden');

    document.getElementById('closeDynamicModalBtn').onclick = () => {
        modal.classList.add('hidden');
        modal.classList.remove('result-fullscreen-modal');
    };

    try {
        // Fetch all active judges from judges module
        const judgesSnap = await getDocs(collection(db, "institutes", window.currentInstituteId, "judges"));
        const activeJudges = [];
        judgesSnap.forEach(d => {
            const data = d.data();
            if (data.status !== 'disabled') {
                activeJudges.push({ id: d.id, name: data.name || d.id });
            }
        });

        const participants = await loadStudentsForProgram(prog);
        const existingResult = allResults.get(prog.id);

        if (participants.length === 0) {
            modalBody.innerHTML = `
                <div style="text-align:center; padding:3rem; color:#ef4444;">
                    <strong>⚠️ No participants registered.</strong><br><br>
                    <p style="color:#64748b; font-size:0.875rem;">Please register participants under the Programs tab first.</p>
                    <button class="btn btn-secondary btn-sm mt-4" id="jCloseNoticeBtn">Close</button>
                </div>`;
            document.getElementById('jCloseNoticeBtn').onclick = () => modal.classList.add('hidden');
            return;
        }

        if (activeJudges.length === 0) {
            modalBody.innerHTML = `
                <div style="text-align:center; padding:3rem; color:#ef4444;">
                    <strong>⚠️ No active judges registered.</strong><br><br>
                    <p style="color:#64748b; font-size:0.875rem;">Please add active judges in the **Judges** module before scoring.</p>
                    <button class="btn btn-secondary btn-sm mt-4" id="jCloseNoticeBtn">Close</button>
                </div>`;
            document.getElementById('jCloseNoticeBtn').onclick = () => modal.classList.add('hidden');
            return;
        }

        // Show Judge selection step
        renderJudgeSelectionUI(modalBody, modal, prog, activeJudges, participants, existingResult);

    } catch (e) {
        console.error("Modal load error:", e);
        modalBody.innerHTML = `<div style="text-align:center;padding:2rem;color:#ef4444;">Failed to initialize judges selection.</div>`;
    }
}

function renderJudgeSelectionUI(modalBody, modal, prog, activeJudges, participants, existingResult) {
    const savedJudges = existingResult && Array.isArray(existingResult.judges) ? existingResult.judges : [];

    const listHTML = activeJudges.map(j => {
        const isChecked = savedJudges.includes(j.name);
        return `
            <label style="display:flex; align-items:center; gap:0.6rem; padding:0.6rem 0.75rem; border-radius:8px; border:1px solid #e2e8f0; background:#f8fafc; cursor:pointer; font-weight:600; font-size:0.875rem; color:#1e293b; transition:all 0.2s;">
                <input type="checkbox" class="j-select-checkbox" data-name="${window.escapeHTML(j.name)}" ${isChecked ? 'checked' : ''} style="cursor:pointer;" />
                <span>🧑‍⚖️ ${window.escapeHTML(j.name)}</span>
            </label>
        `;
    }).join('');

    modalBody.innerHTML = `
        <div style="max-width:520px; margin:0 auto; display:flex; flex-direction:column; gap:1.25rem; padding:0.5rem 0;">
            <div style="background:#e0e7ff; border:1px solid #c7d2fe; border-radius:12px; padding:1.25rem; text-align:center; color:#1e1b4b;">
                <span style="font-size:2.2rem; display:block; margin-bottom:0.25rem;">🧑‍⚖️</span>
                <h3 style="margin:0; font-size:1.2rem; font-weight:800;">Assign Judges to Competition</h3>
                <p style="font-size:0.8rem; color:#4338ca; font-weight:700; margin-top:0.3rem; margin-bottom:0;">
                    ${window.escapeHTML(prog.programName)} [${window.escapeHTML(prog.categoryName)}]
                </p>
            </div>

            <div>
                <label class="form-label" style="font-weight:700; color:#475569; margin-bottom:0.45rem;">SELECT ACTIVE JUDGES *</label>
                <div style="display:flex; flex-direction:column; gap:0.45rem; max-height:260px; overflow-y:auto; border:1px solid #cbd5e1; border-radius:10px; padding:0.75rem; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,0.02);">
                    ${listHTML}
                </div>
            </div>

            <div class="modal-actions" style="margin-top:0.25rem;">
                <button type="button" class="btn btn-secondary" id="jSelectCancelBtn">Cancel</button>
                <button type="button" class="btn btn-primary" id="jSelectProceedBtn" style="margin-left:auto; font-weight:700;">
                    Proceed to Spreadsheet ➔
                </button>
            </div>
        </div>
    `;

    document.getElementById('jSelectCancelBtn').onclick = () => modal.classList.add('hidden');
    
    document.getElementById('jSelectProceedBtn').onclick = () => {
        const checkedNames = [];
        modalBody.querySelectorAll('.j-select-checkbox:checked').forEach(cb => {
            checkedNames.push(cb.getAttribute('data-name'));
        });

        if (checkedNames.length === 0) {
            window.showToast("Please assign at least one judge.", "error");
            return;
        }

        // Change modal title header to dynamic scoresheet and proceed
        document.getElementById('dynamicModalTitle').textContent = `🖋️ Mark Entry Spreadsheet`;
        renderSpreadsheetUI(modalBody, modal, prog, checkedNames, participants, existingResult);
    };
}

function renderSpreadsheetUI(modalBody, modal, prog, judges, participants, existingResult) {
    const isGroup = prog.programType === 'group' || prog.registrationType === 'group' || prog.type === 'Group';
    const savedMarksMap = new Map();

    if (existingResult && Array.isArray(existingResult.marksData)) {
        existingResult.marksData.forEach(m => {
            const key = m.studentId || m.groupId || '';
            if (key) {
                savedMarksMap.set(key, m);
            }
        });
    }

    // Dynamic Columns count
    const judgeHeadersHTML = judges.map((name, i) => `
        <th style="padding:0.6rem 0.75rem; border:1px solid #cbd5e1; text-align:center; color:#1e293b;">
            <div style="font-size:0.85rem; font-weight:700; color:#0f172a; line-height:1.2;">${window.escapeHTML(name)}</div>
            <div style="font-size:0.72rem; font-weight:600; color:#64748b; margin-top:0.15rem; text-transform:uppercase; letter-spacing:0.3px;">Judge ${i + 1}</div>
        </th>`).join('');

    const rowsHTML = participants.map((p, idx) => {
        const saved = savedMarksMap.get(p.id) || {};
        const savedMarks = Array.isArray(saved.marks) ? saved.marks : [];
        const codeLetter = saved.codeLetter || '';
        
        // Generate inputs for each judge
        const judgeInputsHTML = judges.map((name, jIdx) => {
            const savedJudges = existingResult && Array.isArray(existingResult.judges) ? existingResult.judges : [];
            const oldIdx = savedJudges.indexOf(name);
            const val = (oldIdx !== -1 && savedMarks[oldIdx] !== undefined && savedMarks[oldIdx] !== null) ? savedMarks[oldIdx] : '';
            return `
                <td style="padding:0.5rem; border:1px solid #cbd5e1; text-align:center;">
                    <input type="number" class="form-input judge-mark-input" 
                        data-judge-idx="${jIdx}" min="0" max="100" placeholder="0" 
                        value="${val}" 
                        style="width:70px; text-align:center; font-size:0.85rem; padding:0.35rem 0.5rem; margin:0 auto; background:#fff; border-color:#cbd5e1;" />
                </td>`;
        }).join('');

        return `
            <tr class="mark-entry-row" data-student-id="${p.id}" data-student-name="${window.escapeHTML(p.name)}" data-team-id="${p.teamId}" data-team-name="${window.escapeHTML(p.teamName)}">
                ${!isGroup ? `
                <td style="padding:0.75rem; border:1px solid #cbd5e1; font-weight:700; color:#475569;">
                    ${window.escapeHTML(p.chestNumber)}
                </td>` : ''}
                <td style="padding:0.5rem; border:1px solid #cbd5e1; text-align:center;">
                    <input type="text" class="form-input code-letter-input" 
                        placeholder="Letter" value="${window.escapeHTML(codeLetter)}" 
                        style="width:70px; text-align:center; font-size:0.85rem; padding:0.35rem 0.5rem; text-transform:uppercase;" />
                </td>
                <td style="padding:0.75rem; border:1px solid #cbd5e1;">
                    <div style="font-weight:700; color:#1e293b;">${window.escapeHTML(p.name)}</div>
                    ${p.teamName ? `<div style="font-size:0.75rem; color:#64748b; margin-top:0.15rem;">👥 ${window.escapeHTML(p.teamName)}</div>` : ''}
                </td>
                ${judgeInputsHTML}
                <td style="padding:0.75rem; border:1px solid #cbd5e1; text-align:center; font-weight:800; color:#1e293b; background:#f8fafc;" class="cell-final-mark">
                    —
                </td>
                <td style="padding:0.75rem; border:1px solid #cbd5e1; text-align:center; font-weight:700;" class="cell-grade">
                    —
                </td>
                <td style="padding:0.75rem; border:1px solid #cbd5e1; text-align:center; font-weight:700; color:#64748b;" class="cell-rank">
                    —
                </td>
            </tr>
        `;
    }).join('');

    modalBody.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:1.25rem;">
            <!-- Header bar -->
            <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:12px; padding:1.25rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
                <div>
                    <h3 style="margin:0; font-size:1.3rem; font-weight:800; color:#0f172a;">${window.escapeHTML(prog.programName)}</h3>
                    <div style="font-size:0.82rem; color:#475569; font-weight:600; margin-top:0.25rem; display:flex; gap:0.8rem; align-items:center;">
                        <span style="background:#e0e7ff; color:#4338ca; padding:0.15rem 0.6rem; border-radius:6px;">📋 ${window.escapeHTML(prog.categoryName)}</span>
                        <span>Stage: <strong>${prog.programLocation}</strong></span>
                        <span>Gender: <strong>${prog.genderCategory}</strong></span>
                        <span>Total: <strong>${participants.length}</strong> participants</span>
                    </div>
                </div>
                <div style="background:#fffbea; border:1px solid #fef08a; border-radius:8px; padding:0.5rem 0.8rem; font-size:0.75rem; color:#854d0e; font-weight:600;">
                    💡 Maximum Mark per Judge: <strong>100</strong>. Enter numbers between <strong>0 and 100</strong> only.
                </div>
            </div>

            <!-- Spreadsheet Table Wrapper -->
            <div style="overflow-x:auto; background:#fff; border:1px solid #cbd5e1; border-radius:12px; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                <table style="width:100%; border-collapse:collapse; min-width:800px;">
                    <thead>
                        <tr style="background:#f8fafc; border-bottom:2px solid #cbd5e1;">
                            ${!isGroup ? `<th style="padding:0.75rem; border:1px solid #cbd5e1; text-align:left; font-size:0.78rem; font-weight:700; color:#475569; width:90px;">CHEST #</th>` : ''}
                            <th style="padding:0.75rem; border:1px solid #cbd5e1; text-align:center; font-size:0.78rem; font-weight:700; color:#475569; width:90px;">CODE LETTER</th>
                            <th style="padding:0.75rem; border:1px solid #cbd5e1; text-align:left; font-size:0.78rem; font-weight:700; color:#475569;">${isGroup ? 'TEAM NAME' : 'STUDENT NAME'}</th>
                            ${judgeHeadersHTML}
                            <th style="padding:0.75rem; border:1px solid #cbd5e1; text-align:center; font-size:0.78rem; font-weight:700; color:#475569; width:95px;">FINAL MARK</th>
                            <th style="padding:0.75rem; border:1px solid #cbd5e1; text-align:center; font-size:0.78rem; font-weight:700; color:#475569; width:90px;">GRADE</th>
                            <th style="padding:0.75rem; border:1px solid #cbd5e1; text-align:center; font-size:0.78rem; font-weight:700; color:#475569; width:80px;">RANK</th>
                        </tr>
                    </thead>
                    <tbody id="meSpreadsheetBody">
                        ${rowsHTML}
                    </tbody>
                </table>
            </div>

            <!-- Footer / Actions -->
            <div class="modal-actions" style="margin-top:0.5rem;">
                <button type="button" class="btn btn-secondary" id="meCancelBtn">Cancel</button>
                <div style="display:flex; gap:0.6rem; margin-left:auto;">
                    <button type="button" class="btn btn-secondary" id="meDraftBtn" style="font-weight:600;">
                        <span class="btn-text">📝 Save Draft</span>
                        <span class="btn-spinner hidden"></span>
                    </button>
                    <button type="button" class="btn btn-primary" id="meSubmitBtn" style="font-weight:700;">
                        <span class="btn-text">📤 Submit Marks</span>
                        <span class="btn-spinner hidden"></span>
                    </button>
                </div>
            </div>
        </div>
    `;

    // Hook listeners
    const tbody = document.getElementById('meSpreadsheetBody');
    
    // Keystroke input validator and auto calculator
    tbody.querySelectorAll('.judge-mark-input').forEach(input => {
        input.addEventListener('input', () => {
            let val = input.value.trim();
            if (val === '') {
                recalculateSpreadsheet(judges.length);
                return;
            }
            let num = parseFloat(val);
            if (isNaN(num)) num = 0;
            if (num < 0) num = 0;
            if (num > 100) num = 100;
            input.value = num;

            recalculateSpreadsheet(judges.length);
        });
    });

    tbody.querySelectorAll('.code-letter-input').forEach(input => {
        input.addEventListener('input', () => {
            input.value = input.value.toUpperCase();
        });
    });

    // Run first calculations on load
    recalculateSpreadsheet(judges.length);

    // Save Handlers
    document.getElementById('meCancelBtn').onclick = () => {
        modal.classList.add('hidden');
        modal.classList.remove('result-fullscreen-modal');
    };

    document.getElementById('meDraftBtn').onclick = () => persistMarks(prog, judges, false);
    document.getElementById('meSubmitBtn').onclick = async () => {
        const confirmed = await window.customConfirm("Are you sure you want to submit these marks? This locks editing until unsubmitted/unpublished.");
        if (!confirmed) return;
        persistMarks(prog, judges, true);
    };
}

// ─────────────────────────────────────────────
// Real-time Spreadsheet Calculation
// ─────────────────────────────────────────────
function recalculateSpreadsheet(judgesCount) {
    const rows = [];
    document.querySelectorAll('.mark-entry-row').forEach(tr => {
        let sum = 0;
        let filledCount = 0;
        const marks = [];

        tr.querySelectorAll('.judge-mark-input').forEach(input => {
            const val = input.value.trim();
            if (val !== '') {
                const mark = parseFloat(val) || 0;
                sum += mark;
                filledCount++;
                marks.push(mark);
            } else {
                marks.push(null);
            }
        });

        // If any mark is filled, calculate average. Empty is 0
        const finalMark = filledCount > 0 ? Number((sum / judgesCount).toFixed(2)) : 0;
        const hasScores = filledCount > 0;

        rows.push({
            tr,
            finalMark,
            hasScores
        });
    });

    // Ranks calculation (dense) using the centralized helper
    // Ranks apply to rows that have at least some scores
    const activeRows = rows.filter(r => r.hasScores);
    computeDenseRanking(activeRows, r => r.finalMark, 'rank');

    // Render cells in real time
    rows.forEach(r => {
        const finalCell = r.tr.querySelector('.cell-final-mark');
        const gradeCell = r.tr.querySelector('.cell-grade');
        const rankCell = r.tr.querySelector('.cell-rank');

        if (r.hasScores) {
            finalCell.textContent = r.finalMark;
            const { grade } = getGradeAndPoints(r.finalMark);
            gradeCell.innerHTML = grade ? `<span class="badge" style="background:#e0e7ff; color:#4338ca; font-size:0.75rem; font-weight:700; border:1px solid #c7d2fe;">${grade}</span>` : '—';
            
            // Highlight ranks 1, 2, 3
            if (r.rank === 1) {
                rankCell.innerHTML = `<span style="background:#fef3c7; color:#d97706; padding:0.15rem 0.5rem; border-radius:6px; font-weight:800; font-size:0.82rem; border:1px solid #fde68a;">🥇 1st</span>`;
            } else if (r.rank === 2) {
                rankCell.innerHTML = `<span style="background:#f1f5f9; color:#475569; padding:0.15rem 0.5rem; border-radius:6px; font-weight:800; font-size:0.82rem; border:1px solid #cbd5e1;">🥈 2nd</span>`;
            } else if (r.rank === 3) {
                rankCell.innerHTML = `<span style="background:#fff7ed; color:#ea580c; padding:0.15rem 0.5rem; border-radius:6px; font-weight:800; font-size:0.82rem; border:1px solid #ffedd5;">🥉 3rd</span>`;
            } else {
                rankCell.textContent = `${r.rank}th`;
            }
        } else {
            finalCell.textContent = '—';
            gradeCell.textContent = '—';
            rankCell.textContent = '—';
        }
    });
}

// ─────────────────────────────────────────────
// Save Marks & Synchronize Judges Assigned Lists
// ─────────────────────────────────────────────
async function persistMarks(prog, judges, isSubmit) {
    // 1. Database reference exists validation
    if (!db) {
        window.showToast("Unable to save: Database reference is not initialized.", "error");
        return;
    }

    // 2. Program exists validation
    if (!prog || !prog.id) {
        window.showToast("Unable to save: Program information is missing.", "error");
        return;
    }

    // 3. Judge IDs/Names exist validation
    if (!judges || judges.length === 0) {
        window.showToast("Unable to save: No judges assigned to this competition.", "error");
        return;
    }

    const rows = document.querySelectorAll('.mark-entry-row');

    // 4. Participants exist validation
    if (rows.length === 0) {
        window.showToast("Unable to save: No registered participants found for this program.", "error");
        return;
    }

    // 5. Marks are between 0–100 validation
    let marksValid = true;
    let outOfRangeValue = null;
    rows.forEach(tr => {
        tr.querySelectorAll('.judge-mark-input').forEach(input => {
            const val = input.value.trim();
            if (val !== '') {
                const num = parseFloat(val);
                if (isNaN(num) || num < 0 || num > 100) {
                    marksValid = false;
                    outOfRangeValue = val;
                }
            }
        });
    });

    if (!marksValid) {
        window.showToast(`Unable to save: Mark value "${outOfRangeValue}" is invalid. Marks must be between 0 and 100.`, "error");
        return;
    }

    const isGroup = prog.programType === 'group' || prog.registrationType === 'group' || prog.type === 'Group';
    const marksData = [];
    let filledCount = 0;

    // First, recalculate locally to get correct final ranks
    recalculateSpreadsheet(judges.length);

    // Re-verify rows with ranks
    const sortedRows = [];
    rows.forEach(tr => {
        const studentId = tr.getAttribute('data-student-id') || '';
        const studentName = tr.getAttribute('data-student-name') || '';
        const teamId = tr.getAttribute('data-team-id') || '';
        const teamName = tr.getAttribute('data-team-name') || '';
        const codeLetter = tr.querySelector('.code-letter-input').value.trim().toUpperCase();

        const marks = [];
        let sum = 0;
        let enteredCount = 0;

        tr.querySelectorAll('.judge-mark-input').forEach(input => {
            const val = input.value.trim();
            if (val !== '') {
                const num = parseFloat(val) || 0;
                marks.push(num);
                sum += num;
                enteredCount++;
            } else {
                marks.push(null);
            }
        });

        const hasScores = enteredCount > 0;
        const finalMark = enteredCount > 0 ? Number((sum / judges.length).toFixed(2)) : 0;

        if (hasScores) filledCount++;

        sortedRows.push({
            studentId, studentName, teamId, teamName, codeLetter, marks, finalMark, hasScores, rank: null
        });
    });

    // Re-apply dense ranks accurately using the centralized helper
    const activeRows = sortedRows.filter(r => r.hasScores);
    computeDenseRanking(activeRows, r => r.finalMark, 'rank');

    // Build final marksData payload
    sortedRows.forEach(r => {
        if (r.hasScores) {
            const { grade, points: gp } = getGradeAndPoints(r.finalMark);
            const posMap = { 1: 'First', 2: 'Second', 3: 'Third' };
            const position = posMap[r.rank] || '';
            const pp = POSITION_POINTS[position] || 0;
            const totalPoints = gp + pp;

            marksData.push({
                studentId: isGroup ? '' : r.studentId,
                groupId: isGroup ? r.studentId : '',
                studentName: r.studentName || '',
                teamId: r.teamId || '',
                teamName: r.teamName || '',
                codeLetter: r.codeLetter || '',
                marks: r.marks || [],
                finalMark: r.finalMark || 0,
                grade: grade || '',
                gradePoints: gp || 0,
                rank: r.rank || null,
                position: position || '',
                positionPoints: pp || 0,
                totalPoints: totalPoints || 0
            });
        } else {
            // Keep empty entries intact for drafting
            marksData.push({
                studentId: isGroup ? '' : r.studentId,
                groupId: isGroup ? r.studentId : '',
                studentName: r.studentName || '',
                teamId: r.teamId || '',
                teamName: r.teamName || '',
                codeLetter: r.codeLetter || '',
                marks: r.marks || [],
                finalMark: 0,
                grade: '',
                gradePoints: 0,
                rank: null,
                position: '',
                positionPoints: 0,
                totalPoints: 0
            });
        }
    });

    // Build winners array (ranks 1, 2, 3 only) for backward compatibility in portals
    const winners = [];
    const activeWinners = marksData.filter(r => r.finalMark > 0 && r.rank !== null && r.rank <= 3);
    
    // Sort active winners strictly by rank ascending (so Rank 1 comes first, then 2, then 3)
    activeWinners.sort((a, b) => a.rank - b.rank);

    activeWinners.forEach(r => {
        winners.push({
            studentId: isGroup ? '' : (r.studentId || ''),
            groupId: isGroup ? (r.groupId || '') : '',
            studentName: r.studentName || '',
            teamId: r.teamId || '',
            teamName: r.teamName || '',
            position: r.position || '',
            grade: r.grade || '',
            marks: r.totalPoints || 0, // standard points mapped to marks in results card
            remarks: `Average: ${r.finalMark} (Grade Points: ${r.gradePoints} + Position Points: ${r.positionPoints})`
        });
    });

    const btn = isSubmit ? document.getElementById('meSubmitBtn') : document.getElementById('meDraftBtn');
    const text = btn.querySelector('.btn-text');
    const spinner = btn.querySelector('.btn-spinner');

    btn.disabled = true;
    text.classList.add('hidden');
    spinner.classList.remove('hidden');

    try {
        const payload = {
            programId: prog.id,
            programName: prog.programName,
            programType: prog.programType,
            registrationType: prog.registrationType || '',
            categoryId: prog.categoryId || '',
            categoryName: prog.categoryName || '',
            classId: prog.classId || '',
            className: prog.className || '',
            genderCategory: prog.genderCategory || '',
            programLocation: prog.programLocation || '',
            participantCount: rows.length,
            judges,
            marksData,
            winners,
            status: 'draft',
            markEntryStatus: isSubmit ? 'submitted' : 'in-progress',
            updatedAt: serverTimestamp()
        };

        // 6. Detailed Console Logging
        console.log("=== PERSISTING MARKS ===");
        console.log("Program ID:", prog.id);
        console.log("Program Name:", prog.programName);
        console.log("Program Type:", prog.programType);
        console.log("Is Group Program:", isGroup);
        console.log("Judge IDs/Names:", judges);
        console.log("Status (Firestore):", isSubmit ? 'submitted' : 'in-progress');
        marksData.forEach((m, idx) => {
            console.log(`Row #${idx + 1} (${isGroup ? 'Group/Team ID' : 'Student ID'}: ${isGroup ? m.groupId : m.studentId}):`, {
                studentId: m.studentId,
                groupId: m.groupId,
                studentName: m.studentName,
                teamId: m.teamId,
                teamName: m.teamName,
                marks: m.marks,
                finalMark: m.finalMark,
                grade: m.grade,
                rank: m.rank,
                totalPoints: m.totalPoints
            });
        });
        console.log("Winners Array:", winners);
        console.log("Payload:", payload);
        console.log("========================");

        const existingDoc = allResults.get(prog.id);
        const ref = collection(db, "institutes", window.currentInstituteId, "results");

        const batch = writeBatch(db);

        // Bilateral synchronization of judge assigned competitions
        const judgesSnap = await getDocs(collection(db, "institutes", window.currentInstituteId, "judges"));
        judgesSnap.forEach(d => {
            const j = d.data();
            const jName = j.name;
            const comps = Array.isArray(j.competitions) ? j.competitions : [];
            const wasAssigned = existingDoc && Array.isArray(existingDoc.judges) && existingDoc.judges.includes(jName);
            const isNowAssigned = judges.includes(jName);

            if (isNowAssigned && !comps.includes(prog.programName)) {
                // Add Malayalam Essay to Mushaid profile
                const newComps = [...comps, prog.programName];
                batch.update(d.ref, { competitions: newComps, updatedAt: serverTimestamp() });
            } else if (!isNowAssigned && wasAssigned && comps.includes(prog.programName)) {
                // Remove Malayalam Essay from Marshad profile
                const newComps = comps.filter(c => c !== prog.programName);
                batch.update(d.ref, { competitions: newComps, updatedAt: serverTimestamp() });
            }
        });

        // Save Results Document
        if (existingDoc) {
            if (existingDoc.publishedAt) payload.publishedAt = existingDoc.publishedAt;
            if (existingDoc.status === 'published') {
                payload.status = 'published';
                payload.markEntryStatus = 'submitted';
            }
            batch.set(doc(ref, existingDoc.id), payload, { merge: true });
        } else {
            payload.createdAt = serverTimestamp();
            batch.set(doc(ref, `result_${prog.id}`), payload);
        }

        await batch.commit();
        await updateDashboardMetadata(window.currentInstituteId);
        window.showToast(isSubmit ? "📤 Marks submitted successfully!" : "📝 Draft saved successfully!", "success");
        document.getElementById('dynamicModal').classList.add('hidden');
        document.getElementById('dynamicModal').classList.remove('result-fullscreen-modal');

    } catch (err) {
        console.error("Failed persisting marks:", err);
        // 7. Descriptive error reporting
        window.showToast(`Unable to save: ${err.message || err}`, "error");
    } finally {
        btn.disabled = false;
        text.classList.remove('hidden');
        spinner.classList.add('hidden');
    }
}
