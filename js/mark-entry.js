import { db, updateDashboardMetadata, getCachedCategories, getCachedPrograms, getCachedStudentsMap, computeDenseRanking, getCachedPointsConfig, DEFAULT_POINTS, getGradeAndPoints, getGradePointsForGrade, isValidManualGrade, resolveEffectiveGrade, aggregateManualGrades } from './firebase.js';
import {
    collection, getDocs, doc, getDoc, setDoc, onSnapshot, serverTimestamp, writeBatch, runTransaction
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// ─────────────────────────────────────────────
// Point Systems & Grading Mapping
// ─────────────────────────────────────────────
let activePointsConfig = DEFAULT_POINTS;

// Inject Grade Selector CSS Styles
const gradeOverrideStyle = document.createElement('style');
gradeOverrideStyle.textContent = `
    .grade-selector-popover {
        position: absolute;
        background: #ffffff;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1);
        z-index: 99999;
        min-width: 90px;
        padding: 0.25rem;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .grade-selector-option {
        padding: 0.4rem 0.75rem;
        font-size: 0.85rem;
        font-weight: 700;
        color: #334155;
        cursor: pointer;
        border-radius: 6px;
        transition: all 0.15s;
        text-align: center;
    }
    .grade-selector-option:hover {
        background: #f1f5f9;
        color: #0f172a;
    }
    .grade-selector-option.active {
        background: #e0e7ff;
        color: #4338ca;
    }
    .cell-grade.interactive {
        cursor: pointer;
        position: relative;
        transition: background-color 0.2s;
    }
    .cell-grade.interactive:hover {
        background-color: #f8fafc;
    }
`;
document.head.appendChild(gradeOverrideStyle);

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

export function getLatestResultDocSync(progId) {
    if (!progId) return null;
    return allResults.get(progId) || null;
}

export async function getLatestResultDoc(progId) {
    if (!progId) return null;
    let res = allResults.get(progId);
    if (!res && db && window.currentInstituteId) {
        try {
            const docRef = doc(collection(db, "institutes", window.currentInstituteId, "results"), `result_${progId}`);
            const snap = await getDoc(docRef);
            if (snap.exists()) {
                res = { id: snap.id, ...snap.data() };
                allResults.set(progId, res);
            }
        } catch (e) {
            console.error("Error fetching result doc from Firestore:", e);
        }
    }
    return res || null;
}

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
                programNumber: p.programNumber || '',
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

    const urlParams = new URLSearchParams(window.location.search);
    const isStandalone = urlParams.get('mode') === 'standalone';

    const filtered = allPrograms.filter(p => {
        if (isStandalone) {
            const sJudgeId = sessionStorage.getItem('standaloneJudgeId');
            if (sJudgeId) {
                const sJudgeName = sessionStorage.getItem('standaloneJudgeName') || '';
                const sComps = sessionStorage.getItem('standaloneCompetitions') ? JSON.parse(sessionStorage.getItem('standaloneCompetitions')) : [];
                const sCompIds = sessionStorage.getItem('standaloneCompetitionIds') ? JSON.parse(sessionStorage.getItem('standaloneCompetitionIds')) : [];
                
                let isEligible = false;
                if (sCompIds.includes(p.id)) {
                    isEligible = true;
                } else {
                    const matches = allPrograms.filter(progItem => 
                        sComps.some(compName => compName.toLowerCase().trim() === progItem.programName.toLowerCase().trim())
                    );
                    if (matches.some(m => m.id === p.id)) {
                        isEligible = true;
                    } else {
                        const resDoc = allResults.get(p.id);
                        if (resDoc) {
                            if (resDoc.judgeSubmissionStatus && typeof resDoc.judgeSubmissionStatus === 'object') {
                                if (sJudgeId in resDoc.judgeSubmissionStatus) {
                                    isEligible = true;
                                }
                            }
                            if (Array.isArray(resDoc.judgeIds) && resDoc.judgeIds.includes(sJudgeId)) {
                                isEligible = true;
                            }
                            if (sJudgeName && Array.isArray(resDoc.judges)) {
                                if (resDoc.judges.some(name => name.toLowerCase().trim() === sJudgeName.toLowerCase().trim())) {
                                    isEligible = true;
                                }
                            }
                        }
                    }
                }
                if (!isEligible) return false;
            }
        }

        // Text Search
        if (markEntryFilter.search) {
            const q = markEntryFilter.search;
            const cleanQ = q.replace(/#/g, '');
            const nameMatch = p.programName.toLowerCase().includes(q);
            
            const progNumStr = p.programNumber ? String(p.programNumber).toLowerCase() : '';
            const cleanProgNum = progNumStr.replace(/#/g, '');
            const numberMatch = cleanProgNum && cleanQ && cleanProgNum.includes(cleanQ);
            
            if (!nameMatch && !numberMatch) return false;
        }
        // Filters
        if (markEntryFilter.categoryId && p.categoryId !== markEntryFilter.categoryId) return false;
        if (markEntryFilter.gender && p.genderCategory !== markEntryFilter.gender) return false;
        if (markEntryFilter.stage && p.programLocation !== markEntryFilter.stage) return false;

        // Status filter
        const status = getProgramStatus(p.id);
        if (markEntryFilter.status && status !== markEntryFilter.status) return false;

        return true;
    });

    // Debug Requirements
    const debugJudgeId = sessionStorage.getItem('standaloneJudgeId');
    const debugComps = sessionStorage.getItem('standaloneCompetitions') ? JSON.parse(sessionStorage.getItem('standaloneCompetitions')) : [];
    const debugCompIds = sessionStorage.getItem('standaloneCompetitionIds') ? JSON.parse(sessionStorage.getItem('standaloneCompetitionIds')) : [];
    console.log("Total programs in allPrograms (Mark Entry Standalone):", allPrograms.length);
    console.log("Standalone Judge ID (Mark Entry Standalone):", debugJudgeId);
    console.log("Judge competitionIds (Mark Entry Standalone):", debugCompIds);
    console.log("Judge competitions (Mark Entry Standalone):", debugComps);
    console.log("Final filtered program IDs (Mark Entry Standalone):", filtered.map(p => p.id));

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
                    ${p.programNumber ? `[#${p.programNumber}] ` : ''}${window.escapeHTML(p.programName)}
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
    const [snap, studentMap] = await Promise.all([
        getDocs(collection(db, "institutes", window.currentInstituteId, "programs", prog.id, "participants")),
        getCachedStudentsMap(window.currentInstituteId)
    ]);
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
            const studentId = p.studentId || d.id;
            const liveStudent = studentMap ? studentMap.get(studentId) : null;
            const chestNumber = liveStudent ? liveStudent.chestNumber : (p.chestNumber || '—');
            list.push({
                id: studentId,
                name: liveStudent ? liveStudent.name : (p.studentName || '—'),
                chestNumber: chestNumber || '—',
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
    if (!window.currentInstituteId) {
        alert("No institute selected.");
        return;
    }

    try {
        activePointsConfig = await getCachedPointsConfig(window.currentInstituteId, true);
    } catch (e) {
        console.error("Failed to load points config in mark entry:", e);
        activePointsConfig = DEFAULT_POINTS;
    }

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

    const urlParams = new URLSearchParams(window.location.search);
    const isStandalone = urlParams.get('mode') === 'standalone';

    if (isStandalone) {
        const sJudgeId = sessionStorage.getItem('standaloneJudgeId');
        if (sJudgeId) {
            try {
                const judgeSnap = await getDoc(doc(db, "institutes", window.currentInstituteId, "judges", sJudgeId));
                if (!judgeSnap.exists() || judgeSnap.data().status === 'disabled') {
                    modalBody.innerHTML = `
                        <div style="text-align:center; padding:3rem; color:#ef4444;">
                            <strong>🔒 Access Denied</strong><br><br>
                            <p style="color:#64748b; font-size:0.875rem;">Your judge account is invalid or has been deactivated.</p>
                            <button class="btn btn-secondary btn-sm mt-4" id="jCloseNoticeBtn">Close</button>
                        </div>`;
                    document.getElementById('jCloseNoticeBtn').onclick = () => {
                        modal.classList.add('hidden');
                        modal.classList.remove('result-fullscreen-modal');
                    };
                    return;
                }

                const judgeData = judgeSnap.data();
                const compIds = Array.isArray(judgeData.competitionIds) ? judgeData.competitionIds : [];
                const comps = Array.isArray(judgeData.competitions) ? judgeData.competitions : [];

                let isEligible = false;
                if (compIds.includes(prog.id)) {
                    isEligible = true;
                } else {
                    const matches = allPrograms.filter(progItem => 
                        comps.some(compName => compName.toLowerCase().trim() === progItem.programName.toLowerCase().trim())
                    );
                    if (matches.some(m => m.id === prog.id)) {
                        isEligible = true;
                    } else {
                        const resDoc = allResults.get(prog.id);
                        if (resDoc) {
                            if (resDoc.judgeSubmissionStatus && typeof resDoc.judgeSubmissionStatus === 'object') {
                                if (judgeSnap.id in resDoc.judgeSubmissionStatus) {
                                    isEligible = true;
                                }
                            }
                            if (Array.isArray(resDoc.judgeIds) && resDoc.judgeIds.includes(judgeSnap.id)) {
                                isEligible = true;
                            }
                            if (judgeData.name && Array.isArray(resDoc.judges)) {
                                if (resDoc.judges.some(name => name.toLowerCase().trim() === judgeData.name.toLowerCase().trim())) {
                                    isEligible = true;
                                }
                            }
                        }
                    }
                }

                if (!isEligible) {
                    modalBody.innerHTML = `
                        <div style="text-align:center; padding:3rem; color:#ef4444;">
                            <strong>🔒 Access Denied</strong><br><br>
                            <p style="color:#64748b; font-size:0.875rem;">You are not assigned to judge this competition (${window.escapeHTML(prog.programName)}).</p>
                            <button class="btn btn-secondary btn-sm mt-4" id="jCloseNoticeBtn">Close</button>
                        </div>`;
                    document.getElementById('jCloseNoticeBtn').onclick = () => {
                        modal.classList.add('hidden');
                        modal.classList.remove('result-fullscreen-modal');
                    };
                    return;
                }
            } catch (err) {
                console.error("Verification error:", err);
                modalBody.innerHTML = `<div style="text-align:center;padding:2rem;color:#ef4444;">Failed to verify access.</div>`;
                return;
            }
        }
    }

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
        const existingResult = await getLatestResultDoc(prog.id);

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

function renderJudgeSelectionUI(modalBody, modal, prog, activeJudges, participants, _legacyResultDoc = null) {
    const existingResult = getLatestResultDocSync(prog.id) || _legacyResultDoc;
    const urlParams = new URLSearchParams(window.location.search);
    const isStandalone = urlParams.get('mode') === 'standalone';
    const hasUrlJudgeId = urlParams.get('judgeId');
    const sJudgeName = sessionStorage.getItem('standaloneJudgeName');
    const sJudgeId = sessionStorage.getItem('standaloneJudgeId');

    if (isStandalone && sJudgeId && sJudgeName) {
        modalBody.innerHTML = `
            <div style="max-width:520px; margin:0 auto; display:flex; flex-direction:column; gap:1.25rem; padding:0.5rem 0;">
                <div style="background:#e0e7ff; border:1px solid #c7d2fe; border-radius:12px; padding:1.25rem; text-align:center; color:#1e1b4b;">
                    <span style="font-size:2.2rem; display:block; margin-bottom:0.25rem;">🧑‍⚖️</span>
                    <h3 style="margin:0; font-size:1.2rem; font-weight:800;">Confirm Judge Identity</h3>
                    <p style="font-size:0.85rem; color:#4338ca; font-weight:700; margin-top:0.35rem; margin-bottom:0;">
                        ${prog.programNumber ? `[#${prog.programNumber}] ` : ''}${window.escapeHTML(prog.programName)} [${window.escapeHTML(prog.categoryName)}]
                    </p>
                </div>
                
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:1.25rem; text-align:center;">
                    <p style="font-size:0.95rem; color:#334155; margin:0;">
                        You are entering marks as:<br>
                        <strong style="font-size:1.2rem; color:#1e1b4b; display:block; margin-top:0.5rem;">🧑‍⚖️ ${window.escapeHTML(sJudgeName)}</strong>
                    </p>
                    ${!hasUrlJudgeId ? `
                    <button type="button" class="btn btn-secondary btn-sm mt-3" id="jChangeIdentityBtn" style="font-size:0.75rem; padding:0.25rem 0.5rem; font-weight:700;">
                        🔄 Change Judge Identity
                    </button>` : ''}
                </div>

                <div class="modal-actions" style="margin-top:0.25rem;">
                    <button type="button" class="btn btn-secondary" id="jSelectCancelBtn">Cancel</button>
                    <button type="button" class="btn btn-primary" id="jSelectProceedBtn" style="margin-left:auto; font-weight:700;">
                        Proceed to Spreadsheet ➔
                    </button>
                </div>
            </div>
        `;
        
        document.getElementById('jSelectCancelBtn').onclick = () => {
            modal.classList.add('hidden');
            modal.classList.remove('result-fullscreen-modal');
        };

        if (!hasUrlJudgeId) {
            document.getElementById('jChangeIdentityBtn').onclick = () => {
                sessionStorage.removeItem('standaloneJudgeId');
                sessionStorage.removeItem('standaloneJudgeName');
                sessionStorage.removeItem('standaloneCompetitions');
                sessionStorage.removeItem('standaloneCompetitionIds');
                renderJudgeSelectionUI(modalBody, modal, prog, activeJudges, participants, existingResult);
            };
        }
        
        document.getElementById('jSelectProceedBtn').onclick = async () => {
            const latestRes = await getLatestResultDoc(prog.id);
            let judgesList = latestRes && Array.isArray(latestRes.judges) ? [...latestRes.judges] : [];
            if (!judgesList.includes(sJudgeName)) {
                judgesList.push(sJudgeName);
            }
            document.getElementById('dynamicModalTitle').textContent = `🖋️ Mark Entry — ${sJudgeName}`;
            renderSpreadsheetUI(modalBody, modal, prog, judgesList, participants, latestRes);
        };
        return;
    }

    if (isStandalone) {
        const listHTML = activeJudges.map((j, i) => `
            <label style="display:flex; align-items:center; gap:0.6rem; padding:0.6rem 0.75rem; border-radius:8px; border:1px solid #e2e8f0; background:#f8fafc; cursor:pointer; font-weight:600; font-size:0.875rem; color:#1e293b; transition:all 0.2s;">
                <input type="radio" name="jStandaloneRadio" class="j-select-radio" data-id="${window.escapeHTML(j.id)}" data-name="${window.escapeHTML(j.name)}" ${i === 0 ? 'checked' : ''} style="cursor:pointer;" />
                <span>🧑‍⚖️ ${window.escapeHTML(j.name)}</span>
            </label>
        `).join('');

        modalBody.innerHTML = `
            <div style="max-width:520px; margin:0 auto; display:flex; flex-direction:column; gap:1.25rem; padding:0.5rem 0;">
                <div style="background:#e0e7ff; border:1px solid #c7d2fe; border-radius:12px; padding:1.25rem; text-align:center; color:#1e1b4b;">
                    <span style="font-size:2.2rem; display:block; margin-bottom:0.25rem;">🧑‍⚖️</span>
                    <h3 style="margin:0; font-size:1.2rem; font-weight:800;">Select Your Judge Identity</h3>
                    <p style="font-size:0.85rem; color:#4338ca; font-weight:700; margin-top:0.35rem; margin-bottom:0;">
                        ${prog.programNumber ? `[#${prog.programNumber}] ` : ''}${window.escapeHTML(prog.programName)} [${window.escapeHTML(prog.categoryName)}]
                    </p>
                </div>
                
                <div>
                    <label class="form-label" style="font-weight:700; color:#475569; margin-bottom:0.45rem;">CHOOSE YOUR IDENTITY *</label>
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
        
        document.getElementById('jSelectCancelBtn').onclick = () => {
            modal.classList.add('hidden');
            modal.classList.remove('result-fullscreen-modal');
        };
        
        document.getElementById('jSelectProceedBtn').onclick = async () => {
            const selectedRadio = modalBody.querySelector('.j-select-radio:checked');
            if (!selectedRadio) {
                window.showToast("Please select your judge identity.", "error");
                return;
            }
            
            const selectedId = selectedRadio.getAttribute('data-id');
            const selectedName = selectedRadio.getAttribute('data-name');
            
            try {
                const judgeSnap = await getDoc(doc(db, "institutes", window.currentInstituteId, "judges", selectedId));
                if (!judgeSnap.exists() || judgeSnap.data().status === 'disabled') {
                    window.showToast("The selected judge account is disabled or invalid.", "error");
                    return;
                }
                
                const jData = judgeSnap.data();
                const compIds = Array.isArray(jData.competitionIds) ? jData.competitionIds : [];
                const comps = Array.isArray(jData.competitions) ? jData.competitions : [];
                
                let isEligible = false;
                if (compIds.includes(prog.id)) {
                    isEligible = true;
                } else {
                    const matches = allPrograms.filter(progItem => 
                        comps.some(compName => compName.toLowerCase().trim() === progItem.programName.toLowerCase().trim())
                    );
                    if (matches.some(m => m.id === prog.id)) {
                        isEligible = true;
                    } else {
                        const resDoc = allResults.get(prog.id);
                        if (resDoc) {
                            if (resDoc.judgeSubmissionStatus && typeof resDoc.judgeSubmissionStatus === 'object') {
                                if (selectedId in resDoc.judgeSubmissionStatus) {
                                    isEligible = true;
                                }
                            }
                            if (Array.isArray(resDoc.judgeIds) && resDoc.judgeIds.includes(selectedId)) {
                                isEligible = true;
                            }
                            if (selectedName && Array.isArray(resDoc.judges)) {
                                if (resDoc.judges.some(name => name.toLowerCase().trim() === selectedName.toLowerCase().trim())) {
                                    isEligible = true;
                                }
                            }
                        }
                    }
                }
                
                if (!isEligible) {
                    window.showToast(`Access Denied: You are not assigned to judge this competition (${window.escapeHTML(prog.programName)}).`, "error");
                    return;
                }

                sessionStorage.setItem('standaloneJudgeId', selectedId);
                sessionStorage.setItem('standaloneJudgeName', selectedName);
                sessionStorage.setItem('standaloneCompetitions', JSON.stringify(comps));
                sessionStorage.setItem('standaloneCompetitionIds', JSON.stringify(compIds));
                
                let judgesList = existingResult && Array.isArray(existingResult.judges) ? [...existingResult.judges] : [];
                if (!judgesList.includes(selectedName)) {
                    judgesList.push(selectedName);
                }
                document.getElementById('dynamicModalTitle').textContent = `🖋️ Mark Entry — ${selectedName}`;
                renderSpreadsheetUI(modalBody, modal, prog, judgesList, participants, existingResult);
                
            } catch (err) {
                console.error("Verification error:", err);
                window.showToast("Failed to verify judge profile.", "error");
            }
        };
        return;
    }

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
        <div style="max-width:540px; margin:0 auto; display:flex; flex-direction:column; gap:1.25rem; padding:0.5rem 0;">
            <div style="background:#e0e7ff; border:1px solid #c7d2fe; border-radius:12px; padding:1.25rem; text-align:center; color:#1e1b4b;">
                <span style="font-size:2.2rem; display:block; margin-bottom:0.25rem;">🧑‍⚖️</span>
                <h3 style="margin:0; font-size:1.2rem; font-weight:800;">Assign Judges to Competition</h3>
                <p style="font-size:0.8rem; color:#4338ca; font-weight:700; margin-top:0.3rem; margin-bottom:0;">
                    ${prog.programNumber ? `[#${prog.programNumber}] ` : ''}${window.escapeHTML(prog.programName)} [${window.escapeHTML(prog.categoryName)}]
                </p>
            </div>

            <div>
                <label class="form-label" style="font-weight:700; color:#475569; margin-bottom:0.45rem;">SELECT ACTIVE JUDGES *</label>
                <div style="display:flex; flex-direction:column; gap:0.45rem; max-height:220px; overflow-y:auto; border:1px solid #cbd5e1; border-radius:10px; padding:0.75rem; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,0.02);">
                    ${listHTML}
                </div>
            </div>

            <!-- OPTIONAL PARTICIPANT LETTER ASSIGNMENT BUTTON -->
            <div>
                <button type="button" class="btn btn-secondary" id="btnOpenLetterModal" 
                    style="width:100%; padding:0.65rem 1rem; border-radius:10px; font-weight:700; background:#f8fafc; border:1px dashed #6366f1; color:#4338ca; display:flex; align-items:center; justify-content:center; gap:0.5rem; transition:all 0.2s; cursor:pointer;">
                    🏷️ Assign Participant Letters (Optional)
                </button>
            </div>

            <div class="modal-actions" style="margin-top:0.25rem; display:flex; gap:0.5rem; justify-content:flex-end;">
                <button type="button" class="btn btn-secondary" id="jSelectCancelBtn">Cancel</button>
                <button type="button" class="btn btn-secondary" id="jSelectProceedBtn" style="margin-left:auto; font-weight:700;">
                    Proceed to Spreadsheet ➔
                </button>
                <button type="button" class="btn btn-primary" id="jSelectAssignBtn" style="font-weight:700;">
                    <span class="btn-text">Assign Judges</span>
                    <span class="btn-spinner hidden"></span>
                </button>
            </div>
        </div>
    `;

    // Bind separate letter assignment modal button
    document.getElementById('btnOpenLetterModal').onclick = async () => {
        const latestRes = await getLatestResultDoc(prog.id);
        openParticipantLetterModal(modalBody, modal, prog, activeJudges, participants, latestRes);
    };

    document.getElementById('jSelectCancelBtn').onclick = () => {
        modal.classList.add('hidden');
        modal.classList.remove('result-fullscreen-modal');
    };
    
    document.getElementById('jSelectAssignBtn').onclick = async () => {
        const checkedNames = [];
        modalBody.querySelectorAll('.j-select-checkbox:checked').forEach(cb => {
            checkedNames.push(cb.getAttribute('data-name'));
        });

        if (checkedNames.length === 0) {
            window.showToast("Please assign at least one judge.", "error");
            return;
        }

        await saveJudgeAssignment(prog, checkedNames, activeJudges, existingResult, modal);
    };

    document.getElementById('jSelectProceedBtn').onclick = async () => {
        const checkedNames = [];
        modalBody.querySelectorAll('.j-select-checkbox:checked').forEach(cb => {
            checkedNames.push(cb.getAttribute('data-name'));
        });

        if (checkedNames.length === 0) {
            window.showToast("Please assign at least one judge.", "error");
            return;
        }

        const latestRes = await getLatestResultDoc(prog.id);
        // Change modal title header to dynamic scoresheet and proceed
        document.getElementById('dynamicModalTitle').textContent = `🖋️ Judges List`;
        renderSpreadsheetUI(modalBody, modal, prog, checkedNames, participants, latestRes);
    };
}

function getProgramLetterPool(totalParticipants) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const pool = [];
    const count = Math.max(1, totalParticipants);
    for (let i = 0; i < count; i++) {
        if (i < 26) {
            pool.push(alphabet[i]);
        } else {
            const firstChar = alphabet[Math.floor(i / 26) - 1];
            const secondChar = alphabet[i % 26];
            pool.push(firstChar + secondChar);
        }
    }
    return pool;
}

function openParticipantLetterModal(modalBody, modal, prog, activeJudges, participants, _legacyResultDoc = null) {
    const existingResult = getLatestResultDocSync(prog.id) || _legacyResultDoc;
    document.getElementById('dynamicModalTitle').textContent = '🏷️ Participant Letter Assignment';
    
    const isPublished = (existingResult && (existingResult.status === 'published' || existingResult.markEntryStatus === 'published')) || 
                        (prog && (prog.status === 'published' || prog.markEntryStatus === 'published' || prog.isPublished === true));

    const savedMarksMap = new Map();
    if (existingResult && Array.isArray(existingResult.marksData)) {
        existingResult.marksData.forEach(m => {
            const key = m.studentId || m.groupId || '';
            if (key) savedMarksMap.set(key, m);
        });
    }

    const letterPool = getProgramLetterPool(participants.length);

    // Extract unique teams for Quick Filter
    const uniqueTeams = Array.from(new Set(participants.map(p => p.teamName).filter(Boolean))).sort();
    const teamOptionsHTML = uniqueTeams.map(t => `<option value="${window.escapeHTML(t)}">${window.escapeHTML(t)}</option>`).join('');

    // Generate Desktop Rows
    const participantLetterRowsHTML = participants.map(p => {
        const saved = savedMarksMap.get(p.id) || {};
        const codeLetter = (saved.codeLetter || '').toUpperCase();
        const hasLetter = codeLetter !== '';
        const isBtnDisabled = hasLetter || isPublished;
        const searchText = `${p.chestNumber} ${p.name} ${p.teamName || ''}`.toLowerCase();
        
        return `
            <tr class="pw-letter-row" data-student-id="${p.id}" data-team="${window.escapeHTML(p.teamName || '')}" data-search-text="${window.escapeHTML(searchText)}">
                <td style="padding:0.35rem 0.65rem; font-weight:800; color:#475569; width:80px; font-size:0.82rem;">
                    ${window.escapeHTML(p.chestNumber)}
                </td>
                <td style="padding:0.35rem 0.65rem; font-weight:700; color:#1e293b; font-size:0.85rem;">
                    ${window.escapeHTML(p.name)}
                </td>
                <td style="padding:0.35rem 0.65rem; font-weight:600; color:#64748b; font-size:0.8rem;">
                    ${window.escapeHTML(p.teamName || '—')}
                </td>
                <td style="padding:0.35rem 0.65rem; text-align:center; width:80px;">
                    <div class="letter-badge-display" data-student-id="${p.id}" style="${hasLetter ? 'background:#e0e7ff; color:#4338ca; border:1px solid #c7d2fe;' : 'background:#f1f5f9; color:#94a3b8; border:1px solid #cbd5e1;'} min-width:32px; height:30px; border-radius:6px; font-weight:800; font-size:0.88rem; display:inline-flex; align-items:center; justify-content:center;">
                        ${window.escapeHTML(codeLetter || '—')}
                    </div>
                    <input type="hidden" class="pw-letter-input code-letter-input" data-student-id="${p.id}" value="${window.escapeHTML(codeLetter)}" />
                </td>
                <td style="padding:0.35rem 0.65rem; text-align:center; width:120px;">
                    <button type="button" class="btn btn-sm btn-pw-generate" data-student-id="${p.id}"
                        style="${isBtnDisabled ? 'background:#ecfdf5; color:#059669; border:1px solid #a7f3d0; cursor:default;' : 'background:#6366f1; color:#fff; border:none;'} padding:0.25rem 0.6rem; font-size:0.75rem; font-weight:700; border-radius:6px; transition:all 0.2s;"
                        ${isBtnDisabled ? 'disabled' : ''}>
                        ${hasLetter ? '✓ Assigned' : (isPublished ? 'Read Only' : '🎲 Generate')}
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    // Generate Mobile Stacked Cards
    const participantLetterCardsHTML = participants.map(p => {
        const saved = savedMarksMap.get(p.id) || {};
        const codeLetter = (saved.codeLetter || '').toUpperCase();
        const hasLetter = codeLetter !== '';
        const isBtnDisabled = hasLetter || isPublished;
        const searchText = `${p.chestNumber} ${p.name} ${p.teamName || ''}`.toLowerCase();

        return `
            <div class="pw-letter-card" data-student-id="${p.id}" data-team="${window.escapeHTML(p.teamName || '')}" data-search-text="${window.escapeHTML(searchText)}"
                style="background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:0.65rem 0.85rem; display:flex; flex-direction:column; gap:0.4rem; box-shadow:0 1px 2px rgba(0,0,0,0.02);">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-weight:800; color:#475569; font-size:0.8rem; background:#f1f5f9; padding:0.15rem 0.5rem; border-radius:4px; border:1px solid #e2e8f0;">
                        #${window.escapeHTML(p.chestNumber)}
                    </span>
                    <div class="letter-badge-display" data-student-id="${p.id}" style="${hasLetter ? 'background:#e0e7ff; color:#4338ca; border:1px solid #c7d2fe;' : 'background:#f1f5f9; color:#94a3b8; border:1px solid #cbd5e1;'} min-width:32px; height:30px; border-radius:6px; font-weight:800; font-size:0.88rem; display:inline-flex; align-items:center; justify-content:center;">
                        ${window.escapeHTML(codeLetter || '—')}
                    </div>
                </div>
                <div>
                    <div style="font-weight:700; color:#0f172a; font-size:0.9rem;">${window.escapeHTML(p.name)}</div>
                    <div style="font-size:0.78rem; color:#64748b; margin-top:0.1rem;">Team: <strong>${window.escapeHTML(p.teamName || '—')}</strong></div>
                </div>
                <div style="text-align:right; margin-top:0.2rem;">
                    <button type="button" class="btn btn-sm btn-pw-generate" data-student-id="${p.id}"
                        style="${isBtnDisabled ? 'background:#ecfdf5; color:#059669; border:1px solid #a7f3d0; cursor:default;' : 'background:#6366f1; color:#fff; border:none;'} padding:0.25rem 0.65rem; font-size:0.75rem; font-weight:700; border-radius:6px; transition:all 0.2s;"
                        ${isBtnDisabled ? 'disabled' : ''}>
                        ${hasLetter ? '✓ Assigned' : (isPublished ? 'Read Only' : '🎲 Generate Letter')}
                    </button>
                </div>
            </div>
        `;
    }).join('');

    const publishedBannerHTML = isPublished ? `
        <div style="background:#fffbeef; border:1px solid #fde68a; border-radius:8px; padding:0.5rem 0.85rem; color:#92400e; font-size:0.78rem; font-weight:700; display:flex; align-items:center; gap:0.5rem;">
            <span style="font-size:1rem;">ℹ️</span>
            <span>This program has already been published. Participant letters can no longer be modified.</span>
        </div>
    ` : '';

    modalBody.innerHTML = `
        <style>
            .pw-table-wrapper {
                max-height: calc(76vh - 140px);
                overflow-y: auto;
                border: 1px solid #cbd5e1;
                border-radius: 10px;
                background: #fff;
                box-shadow: 0 1px 3px rgba(0,0,0,0.02);
            }
            .pw-desktop-table {
                width: 100%;
                border-collapse: collapse;
            }
            .pw-desktop-table th {
                position: sticky;
                top: 0;
                z-index: 5;
                background: #f8fafc;
                border-bottom: 2px solid #cbd5e1;
                padding: 0.45rem 0.65rem;
                font-size: 0.72rem;
                color: #475569;
                font-weight: 700;
                text-align: left;
            }
            .pw-desktop-table tr:hover {
                background: #f8fafc;
            }
            @media (max-width: 640px) {
                .pw-desktop-table-view { display: none !important; }
                .pw-cards-mobile-view { display: flex !important; flex-direction: column; gap: 0.5rem; max-height: calc(75vh - 160px); overflow-y: auto; padding: 0.2rem; }
            }
            @media (min-width: 641px) {
                .pw-cards-mobile-view { display: none !important; }
            }
        </style>

        <div style="max-width:780px; margin:0 auto; display:flex; flex-direction:column; gap:0.65rem; padding:0.25rem 0;">
            ${publishedBannerHTML}

            <!-- Header bar with Top-Right Bulk Action Controls -->
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:0.75rem 1rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
                <div>
                    <h3 style="margin:0; font-size:1.05rem; font-weight:800; color:#0f172a;">
                        ${prog.programNumber ? `[#${prog.programNumber}] ` : ''}${window.escapeHTML(prog.programName)}
                    </h3>
                    <div style="font-size:0.78rem; color:#64748b; font-weight:600; margin-top:0.2rem; display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
                        <span style="background:#e0e7ff; color:#4338ca; padding:0.1rem 0.45rem; border-radius:4px; font-weight:700;">📋 ${window.escapeHTML(prog.categoryName)}</span>
                        <span>Type: <strong>${window.escapeHTML(prog.programType || prog.type || 'Individual')}</strong></span>
                        <span>Total: <strong>${participants.length}</strong> participants</span>
                    </div>
                </div>
                <div style="display:flex; flex-direction:column; align-items:flex-end; gap:0.35rem;">
                    <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
                        <button type="button" class="btn btn-sm" id="btnAutoGenerateAll" 
                            style="background:${isPublished ? '#e2e8f0' : '#6366f1'}; color:${isPublished ? '#94a3b8' : '#fff'}; font-weight:700; padding:0.3rem 0.7rem; border-radius:6px; border:none; font-size:0.76rem; cursor:${isPublished ? 'not-allowed' : 'pointer'}; transition:all 0.2s;"
                            ${isPublished ? 'disabled' : ''}>
                            🎲 Auto Generate All
                        </button>
                        <button type="button" class="btn btn-sm" id="btnResetLetters" 
                            style="background:${isPublished ? '#f8fafc' : '#f1f5f9'}; color:${isPublished ? '#94a3b8' : '#ef4444'}; font-weight:700; padding:0.3rem 0.7rem; border-radius:6px; border:1px solid ${isPublished ? '#e2e8f0' : '#fca5a5'}; font-size:0.76rem; cursor:${isPublished ? 'not-allowed' : 'pointer'}; transition:all 0.2s;"
                            ${isPublished ? 'disabled' : ''}>
                            🔄 Reset Letters
                        </button>
                    </div>
                    <div style="font-size:0.72rem; color:#64748b; font-weight:600;">
                        Available Pool: <strong>${letterPool[0] || 'A'} – ${letterPool[letterPool.length - 1] || 'A'}</strong> (${participants.length} Letters)
                    </div>
                </div>
            </div>

            <!-- Instant Search & Quick Team Filter Bar -->
            <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:0.45rem 0.75rem; display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
                <div style="flex:1; min-width:180px;">
                    <input type="text" id="pwLetterSearch" class="form-input" placeholder="🔍 Search Student Name, Chest #, Team..." 
                        style="width:100%; height:32px; font-size:0.8rem; padding:0.2rem 0.6rem; border-radius:6px; border:1px solid #cbd5e1;" />
                </div>
                ${uniqueTeams.length > 0 ? `
                    <div style="width:150px;">
                        <select id="pwTeamFilter" class="form-input" style="width:100%; height:32px; font-size:0.8rem; padding:0.2rem 0.5rem; border-radius:6px; border:1px solid #cbd5e1;">
                            <option value="">All Teams</option>
                            ${teamOptionsHTML}
                        </select>
                    </div>
                ` : ''}
            </div>

            <!-- Desktop View: Participant High-Density Table -->
            <div class="pw-table-wrapper pw-desktop-table-view">
                <table class="pw-desktop-table">
                    <thead>
                        <tr>
                            <th style="width:80px;">CHEST #</th>
                            <th>STUDENT / GROUP</th>
                            <th>TEAM</th>
                            <th style="text-align:center; width:80px;">LETTER</th>
                            <th style="text-align:center; width:120px;">ACTION</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${participantLetterRowsHTML}
                    </tbody>
                </table>
            </div>

            <!-- Mobile View: Participant Stacked Cards -->
            <div class="pw-cards-mobile-view">
                ${participantLetterCardsHTML}
            </div>

            <!-- Actions footer -->
            <div class="modal-actions" style="margin-top:0.2rem; display:flex; gap:0.5rem; justify-content:space-between; align-items:center;">
                <button type="button" class="btn btn-secondary" id="btnReturnToJudges" style="font-weight:700; font-size:0.82rem; padding:0.4rem 0.85rem;">
                    ⬅️ Return to Judge Assignment
                </button>
            </div>
        </div>
    `;

    // Filter Logic: Instant Search & Team Quick Filter
    const applyFilters = () => {
        const searchVal = document.getElementById('pwLetterSearch')?.value.trim().toLowerCase() || '';
        const teamVal = document.getElementById('pwTeamFilter')?.value || '';

        modalBody.querySelectorAll('.pw-letter-row').forEach(row => {
            const text = row.getAttribute('data-search-text') || '';
            const team = row.getAttribute('data-team') || '';
            const matchesSearch = !searchVal || text.includes(searchVal);
            const matchesTeam = !teamVal || team === teamVal;
            row.style.display = matchesSearch && matchesTeam ? '' : 'none';
        });

        modalBody.querySelectorAll('.pw-letter-card').forEach(card => {
            const text = card.getAttribute('data-search-text') || '';
            const team = card.getAttribute('data-team') || '';
            const matchesSearch = !searchVal || text.includes(searchVal);
            const matchesTeam = !teamVal || team === teamVal;
            card.style.display = matchesSearch && matchesTeam ? '' : 'none';
        });
    };

    const searchEl = document.getElementById('pwLetterSearch');
    if (searchEl) searchEl.oninput = applyFilters;
    const teamEl = document.getElementById('pwTeamFilter');
    if (teamEl) teamEl.onchange = applyFilters;

    // Bind Bulk Action Control listeners
    document.getElementById('btnAutoGenerateAll').onclick = () => {
        if (isPublished) {
            window.showToast("This program is published and participant letters cannot be modified.", "warning");
            return;
        }
        autoGenerateAllParticipantLetters(prog, participants, existingResult, modalBody);
    };

    document.getElementById('btnResetLetters').onclick = () => {
        if (isPublished) {
            window.showToast("This program is published and participant letters cannot be modified.", "warning");
            return;
        }
        resetAllParticipantLetters(prog, participants, existingResult, modalBody);
    };

    // Bind return button
    document.getElementById('btnReturnToJudges').onclick = async () => {
        const latestRes = await getLatestResultDoc(prog.id);
        renderJudgeSelectionUI(modalBody, modal, prog, activeJudges, participants, latestRes);
    };

    // Bind Generate buttons
    modalBody.querySelectorAll('.btn-pw-generate').forEach(btn => {
        btn.onclick = () => {
            if (isPublished) {
                window.showToast("This program is published and participant letters cannot be modified.", "warning");
                return;
            }
            const studentId = btn.getAttribute('data-student-id');
            const rowEl = modalBody.querySelector(`.pw-letter-row[data-student-id="${studentId}"]`) || modalBody.querySelector(`.pw-letter-card[data-student-id="${studentId}"]`);
            if (rowEl) {
                triggerLuckyDrawLetterAssignment(prog, studentId, rowEl, existingResult, participants.length);
            }
        };
    });
}

function updateParticipantLetterUI(studentId, letter) {
    document.querySelectorAll(`.letter-badge-display[data-student-id="${studentId}"]`).forEach(badge => {
        badge.textContent = letter || '—';
        if (letter) {
            badge.style.background = '#e0e7ff';
            badge.style.color = '#4338ca';
            badge.style.border = '1px solid #c7d2fe';
        } else {
            badge.style.background = '#f1f5f9';
            badge.style.color = '#94a3b8';
            badge.style.border = '1px solid #cbd5e1';
        }
    });

    document.querySelectorAll(`.code-letter-input[data-student-id="${studentId}"], .pw-letter-input[data-student-id="${studentId}"]`).forEach(inp => {
        inp.value = letter;
    });

    document.querySelectorAll(`.btn-pw-generate[data-student-id="${studentId}"]`).forEach(btn => {
        if (letter) {
            btn.innerHTML = btn.classList.contains('btn-pw-generate-sp') ? '✓' : '✓ Assigned';
            btn.style.background = '#ecfdf5';
            btn.style.color = '#059669';
            btn.style.border = '1px solid #a7f3d0';
            btn.disabled = true;
        } else {
            btn.innerHTML = btn.classList.contains('btn-pw-generate-sp') ? '🎲' : '🎲 Generate Letter';
            btn.style.background = '#6366f1';
            btn.style.color = '#fff';
            btn.style.border = 'none';
            btn.disabled = false;
        }
    });
}

async function autoGenerateAllParticipantLetters(prog, participants, existingResult, modalBody) {
    const isPublished = (existingResult && (existingResult.status === 'published' || existingResult.markEntryStatus === 'published')) || 
                        (prog && (prog.status === 'published' || prog.markEntryStatus === 'published' || prog.isPublished === true));
    if (isPublished) {
        window.showToast("This program is published and participant letters cannot be modified.", "warning");
        return;
    }

    if (!participants || participants.length === 0) {
        window.showToast("No participants registered for this program.", "warning");
        return;
    }

    const confirmed = await window.customConfirm("Generate unique letters for all participants?");
    if (!confirmed) return;

    const btn = document.getElementById('btnAutoGenerateAll');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '🎲 Generating Letters...';
    }

    // Preserve scroll positions
    const desktopScrollContainer = modalBody.querySelector('.pw-table-wrapper');
    const mobileScrollContainer = modalBody.querySelector('.pw-cards-mobile-view');
    const savedDesktopScroll = desktopScrollContainer ? desktopScrollContainer.scrollTop : 0;
    const savedMobileScroll = mobileScrollContainer ? mobileScrollContainer.scrollTop : 0;

    // Exact N-letter pool for this program
    const letterPool = getProgramLetterPool(participants.length);
    
    // Fisher-Yates Shuffle
    const shuffledPool = [...letterPool];
    for (let i = shuffledPool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledPool[i], shuffledPool[j]] = [shuffledPool[j], shuffledPool[i]];
    }

    const badgeElements = modalBody.querySelectorAll('.letter-badge-display');
    const generateBtns = modalBody.querySelectorAll('.btn-pw-generate');
    const dummyPool = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const animationIntervals = [40, 40, 50, 50, 60, 70, 80, 100, 120, 150, 190, 240, 300];
    let step = 0;

    badgeElements.forEach(badge => {
        badge.style.transition = 'transform 0.1s ease, border-color 0.1s ease, color 0.1s ease';
        badge.style.borderColor = '#6366f1';
        badge.style.color = '#4338ca';
    });
    generateBtns.forEach(b => {
        b.disabled = true;
        b.innerHTML = '🎲 ...';
    });

    function runBulkAnimationStep() {
        if (step < animationIntervals.length - 1) {
            badgeElements.forEach(badge => {
                const randomChar = dummyPool[Math.floor(Math.random() * dummyPool.length)];
                badge.textContent = randomChar;
                badge.style.transform = step % 2 === 0 ? 'scale(1.15)' : 'scale(1.0)';
            });
            step++;
            if (desktopScrollContainer) desktopScrollContainer.scrollTop = savedDesktopScroll;
            if (mobileScrollContainer) mobileScrollContainer.scrollTop = savedMobileScroll;
            setTimeout(runBulkAnimationStep, animationIntervals[step]);
        } else {
            // Final land on generated letters
            const assignmentMap = new Map();
            participants.forEach((p, idx) => {
                const assignedLetter = shuffledPool[idx];
                assignmentMap.set(p.id, assignedLetter);
                updateParticipantLetterUI(p.id, assignedLetter);
            });

            if (desktopScrollContainer) desktopScrollContainer.scrollTop = savedDesktopScroll;
            if (mobileScrollContainer) mobileScrollContainer.scrollTop = savedMobileScroll;

            // Auto Save All to Firestore
            autoSaveBulkParticipantLetters(prog, assignmentMap, existingResult).then(() => {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '✓ Successfully Generated';
                    btn.style.background = '#ecfdf5';
                    btn.style.color = '#059669';
                    setTimeout(() => {
                        btn.innerHTML = '🎲 Auto Generate All';
                        btn.style.background = '#6366f1';
                        btn.style.color = '#fff';
                    }, 2500);
                }
            });
        }
    }

    runBulkAnimationStep();
}

async function resetAllParticipantLetters(prog, participants, existingResult, modalBody) {
    const isPublished = (existingResult && (existingResult.status === 'published' || existingResult.markEntryStatus === 'published')) || 
                        (prog && (prog.status === 'published' || prog.markEntryStatus === 'published' || prog.isPublished === true));
    if (isPublished) {
        window.showToast("This program is published and participant letters cannot be modified.", "warning");
        return;
    }

    const confirmed = await window.customConfirm("Remove all assigned letters for this program?");
    if (!confirmed) return;

    const btn = document.getElementById('btnResetLetters');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '🔄 Resetting...';
    }

    try {
        participants.forEach(p => {
            updateParticipantLetterUI(p.id, '');
        });

        await clearAllParticipantLettersInFirestore(prog, existingResult);

        window.showToast("All participant letters for this program have been removed.", "success");
    } catch (err) {
        console.error("Reset letters error:", err);
        window.showToast("Failed to reset letters: " + (err.message || err), "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '🔄 Reset Letters';
        }
    }
}

async function autoSaveBulkParticipantLetters(prog, assignmentMap, existingResult) {
    if (!db || !prog || !prog.id) return;

    try {
        const isGroup = prog.programType === 'group' || prog.registrationType === 'group' || prog.type === 'Group';
        const resultsRef = collection(db, "institutes", window.currentInstituteId, "results");
        const docRef = doc(resultsRef, `result_${prog.id}`);
        const docSnap = await getDoc(docRef);

        let existingDoc = docSnap.exists() ? docSnap.data() : (existingResult || null);
        let marksData = existingDoc && Array.isArray(existingDoc.marksData) ? [...existingDoc.marksData] : [];

        const participants = await loadStudentsForProgram(prog);
        participants.forEach(p => {
            const codeLetter = assignmentMap.get(p.id) || '';
            let targetEntry = marksData.find(m => (isGroup ? m.groupId === p.id : m.studentId === p.id));
            if (targetEntry) {
                targetEntry.codeLetter = codeLetter;
            } else {
                marksData.push({
                    studentId: isGroup ? '' : p.id,
                    groupId: isGroup ? p.id : '',
                    studentName: p.name || '',
                    teamId: p.teamId || '',
                    teamName: p.teamName || '',
                    codeLetter: codeLetter,
                    marks: [],
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
            marksData: marksData,
            status: existingDoc?.status || 'draft',
            markEntryStatus: existingDoc?.markEntryStatus || 'in-progress',
            updatedAt: serverTimestamp()
        };

        await setDoc(docRef, payload, { merge: true });
        
        // Update local cache
        const localDoc = allResults.get(prog.id) || {};
        allResults.set(prog.id, { ...localDoc, ...payload, id: `result_${prog.id}` });
        
        window.showToast("Saved unique letters for all participants.", "success");
    } catch (err) {
        console.error("Auto-save bulk letters error:", err);
        window.showToast("Failed to save generated letters: " + (err.message || err), "error");
    }
}

async function clearAllParticipantLettersInFirestore(prog, existingResult) {
    if (!db || !prog || !prog.id) return;

    const resultsRef = collection(db, "institutes", window.currentInstituteId, "results");
    const docRef = doc(resultsRef, `result_${prog.id}`);
    const docSnap = await getDoc(docRef);

    let existingDoc = docSnap.exists() ? docSnap.data() : (existingResult || null);
    if (!existingDoc || !Array.isArray(existingDoc.marksData)) return;

    let marksData = existingDoc.marksData.map(m => ({ ...m, codeLetter: '' }));

    const payload = {
        marksData: marksData,
        updatedAt: serverTimestamp()
    };

    await setDoc(docRef, payload, { merge: true });

    // Update local cache
    const localDoc = allResults.get(prog.id) || {};
    allResults.set(prog.id, { ...localDoc, marksData: marksData, id: `result_${prog.id}` });
}

function triggerLuckyDrawLetterAssignment(prog, studentId, rowElement, existingResult, participantsCount = 26) {
    const isPublished = (existingResult && (existingResult.status === 'published' || existingResult.markEntryStatus === 'published')) || 
                        (prog && (prog.status === 'published' || prog.markEntryStatus === 'published' || prog.isPublished === true));
    if (isPublished) {
        window.showToast("This program is published and participant letters cannot be modified.", "warning");
        return;
    }

    const badgeEls = document.querySelectorAll(`.letter-badge-display[data-student-id="${studentId}"]`);
    const generateBtn = rowElement.querySelector('.btn-pw-generate, .btn-pw-generate-sp');
    
    if (badgeEls.length === 0) return;

    // FIX 1 & 2: Check if this participant ALREADY has an assigned letter
    const existingInput = document.querySelector(`.code-letter-input[data-student-id="${studentId}"], .pw-letter-input[data-student-id="${studentId}"]`);
    const currentAssignedLetter = (existingInput?.value || '').trim().toUpperCase();

    if (currentAssignedLetter) {
        // Participant ALREADY has a letter! Ensure UI displays assigned state and exit cleanly without throwing error toast.
        updateParticipantLetterUI(studentId, currentAssignedLetter);
        return;
    }

    // Preserve scroll positions
    const desktopScrollContainer = document.querySelector('.pw-table-wrapper');
    const mobileScrollContainer = document.querySelector('.pw-cards-mobile-view');
    const savedDesktopScroll = desktopScrollContainer ? desktopScrollContainer.scrollTop : 0;
    const savedMobileScroll = mobileScrollContainer ? mobileScrollContainer.scrollTop : 0;
    
    // Gather all currently assigned letters in DOM inputs & saved data across all participants for this program
    const assignedLetters = new Set();
    document.querySelectorAll('.code-letter-input, .pw-letter-input').forEach(inp => {
        const val = inp.value.trim().toUpperCase();
        if (val) assignedLetters.add(val);
    });
    if (existingResult && Array.isArray(existingResult.marksData)) {
        existingResult.marksData.forEach(m => {
            if (m.codeLetter) assignedLetters.add(m.codeLetter.trim().toUpperCase());
        });
    }
    
    // Exact letter pool according to participant count N
    const programLetterPool = getProgramLetterPool(participantsCount);
    const availablePool = programLetterPool.filter(l => !assignedLetters.has(l));

    if (availablePool.length === 0) {
        // Only display warning toast if participant has NO letter AND available pool is exhausted
        window.showToast("No available unique letters left to assign for this program.", "warning");
        if (generateBtn) {
            generateBtn.disabled = false;
            generateBtn.innerHTML = generateBtn.classList.contains('btn-pw-generate-sp') ? '🎲' : '🎲 Generate Letter';
        }
        return;
    }

    // Pick target letter
    const chosenIndex = Math.floor(Math.random() * availablePool.length);
    const assignedLetter = availablePool[chosenIndex];

    // Disable button & styling for slot animation
    if (generateBtn) {
        generateBtn.disabled = true;
        generateBtn.style.opacity = '0.8';
        generateBtn.innerHTML = '🎲 ...';
    }

    // Prepare Animation sequence (1.5 - 2 seconds lucky draw effect using program letter pool)
    const animationIntervals = [40, 40, 50, 50, 60, 70, 80, 100, 120, 150, 190, 240, 300];
    let step = 0;

    badgeEls.forEach(b => {
        b.style.transition = 'transform 0.1s ease, border-color 0.1s ease, color 0.1s ease';
        b.style.borderColor = '#6366f1';
        b.style.color = '#4338ca';
        b.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.2)';
    });

    function runAnimationStep() {
        if (step < animationIntervals.length - 1) {
            const randomChar = programLetterPool[Math.floor(Math.random() * programLetterPool.length)];
            badgeEls.forEach(b => {
                b.textContent = randomChar;
                b.style.transform = step % 2 === 0 ? 'scale(1.15)' : 'scale(1.0)';
            });
            step++;
            if (desktopScrollContainer) desktopScrollContainer.scrollTop = savedDesktopScroll;
            if (mobileScrollContainer) mobileScrollContainer.scrollTop = savedMobileScroll;
            setTimeout(runAnimationStep, animationIntervals[step]);
        } else {
            // Final land on assigned letter!
            updateParticipantLetterUI(studentId, assignedLetter);

            if (desktopScrollContainer) desktopScrollContainer.scrollTop = savedDesktopScroll;
            if (mobileScrollContainer) mobileScrollContainer.scrollTop = savedMobileScroll;

            // Auto Save to Firestore
            autoSaveParticipantLetter(prog, studentId, assignedLetter, existingResult);
        }
    }

    runAnimationStep();
}

async function autoSaveParticipantLetter(prog, studentId, codeLetter, existingResult) {
    if (!db || !prog || !prog.id) return;

    try {
        const isGroup = prog.programType === 'group' || prog.registrationType === 'group' || prog.type === 'Group';
        const resultsRef = collection(db, "institutes", window.currentInstituteId, "results");
        const docRef = doc(resultsRef, `result_${prog.id}`);
        const docSnap = await getDoc(docRef);

        let existingDoc = docSnap.exists() ? docSnap.data() : (existingResult || null);
        let marksData = existingDoc && Array.isArray(existingDoc.marksData) ? [...existingDoc.marksData] : [];

        let targetEntry = marksData.find(m => (isGroup ? m.groupId === studentId : m.studentId === studentId));
        if (targetEntry) {
            targetEntry.codeLetter = codeLetter;
        } else {
            const participants = await loadStudentsForProgram(prog);
            const pInfo = participants.find(p => p.id === studentId);
            marksData.push({
                studentId: isGroup ? '' : studentId,
                groupId: isGroup ? studentId : '',
                studentName: pInfo ? pInfo.name : '',
                teamId: pInfo ? pInfo.teamId : '',
                teamName: pInfo ? pInfo.teamName : '',
                codeLetter: codeLetter,
                marks: [],
                finalMark: 0,
                grade: '',
                gradePoints: 0,
                rank: null,
                position: '',
                positionPoints: 0,
                totalPoints: 0
            });
        }

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
            marksData: marksData,
            status: existingDoc?.status || 'draft',
            markEntryStatus: existingDoc?.markEntryStatus || 'in-progress',
            updatedAt: serverTimestamp()
        };

        await setDoc(docRef, payload, { merge: true });
        
        // Update local cache
        const localDoc = allResults.get(prog.id) || {};
        allResults.set(prog.id, { ...localDoc, ...payload, id: `result_${prog.id}` });
        
        window.showToast(`Saved letter ${codeLetter} for participant.`, "success");
    } catch (err) {
        console.error("Auto-save code letter error:", err);
        window.showToast("Failed to auto-save letter: " + (err.message || err), "error");
    }
}

function renderSpreadsheetUI(modalBody, modal, prog, judges, participants, _legacyResultDoc = null) {
    const existingResult = getLatestResultDocSync(prog.id) || _legacyResultDoc;
    const isGroup = prog.programType === 'group' || prog.registrationType === 'group' || prog.type === 'Group';
    const pType = (prog.programType || prog.registrationType || prog.type || 'individual').toLowerCase();
    let classType = 'individual';
    if (pType === 'general') classType = 'general';
    else if (pType === 'group') classType = 'group';
    const savedMarksMap = new Map();

    const urlParams = new URLSearchParams(window.location.search);
    const isStandalone = urlParams.get('mode') === 'standalone';
    const sJudgeName = isStandalone ? sessionStorage.getItem('standaloneJudgeName') : '';
    const sJudgeId = isStandalone ? sessionStorage.getItem('standaloneJudgeId') : '';

    if (existingResult && Array.isArray(existingResult.marksData)) {
        existingResult.marksData.forEach(m => {
            const key = m.studentId || m.groupId || '';
            if (key) {
                savedMarksMap.set(key, m);
            }
        });
    }

    const isResultSubmitted = existingResult && existingResult.markEntryStatus === 'submitted';
    const showCalculations = !isStandalone || isResultSubmitted;

    // Dynamic Columns count
    let judgeHeadersHTML = '';
    if (isStandalone) {
        judgeHeadersHTML = `
            <th style="padding:0.6rem 0.75rem; border:1px solid #cbd5e1; text-align:center; color:#1e293b; width:150px;">
                <div style="font-size:0.85rem; font-weight:700; color:#0f172a; line-height:1.2;">${window.escapeHTML(sJudgeName)}</div>
                <div style="font-size:0.72rem; font-weight:600; color:#64748b; margin-top:0.15rem; text-transform:uppercase; letter-spacing:0.3px;">Your Scores</div>
            </th>`;
    } else {
        judgeHeadersHTML = judges.map((name, i) => `
            <th style="padding:0.6rem 0.75rem; border:1px solid #cbd5e1; text-align:center; color:#1e293b;">
                <div style="font-size:0.85rem; font-weight:700; color:#0f172a; line-height:1.2;">${window.escapeHTML(name)}</div>
                <div style="font-size:0.72rem; font-weight:600; color:#64748b; margin-top:0.15rem; text-transform:uppercase; letter-spacing:0.3px;">Judge ${i + 1}</div>
            </th>`).join('');
    }

    const rowsHTML = participants.map((p, idx) => {
        const saved = savedMarksMap.get(p.id) || {};
        const savedMarks = Array.isArray(saved.marks) ? saved.marks : [];
        const codeLetter = saved.codeLetter || '';
        
        const legacyGrade = saved.manualGrade || '';
        const adminManualGrade = saved.adminManualGrade || '';
        const manualGrades = Array.isArray(saved.manualGrades) ? saved.manualGrades : [];

        let screenManualGrade = '';
        if (isStandalone) {
            const jIdx = judges.indexOf(sJudgeName);
            if (jIdx !== -1 && manualGrades[jIdx]) {
                screenManualGrade = manualGrades[jIdx];
            }
        } else {
            screenManualGrade = adminManualGrade || legacyGrade;
        }
        
        let judgeInputsHTML = '';
        if (isStandalone) {
            const jIdx = judges.indexOf(sJudgeName);
            const savedJudges = existingResult && Array.isArray(existingResult.judges) ? existingResult.judges : [];
            const oldIdx = savedJudges.indexOf(sJudgeName);
            const val = (oldIdx !== -1 && savedMarks[oldIdx] !== undefined && savedMarks[oldIdx] !== null) ? savedMarks[oldIdx] : '';
            judgeInputsHTML = `
                <td style="padding:0.5rem; border:1px solid #cbd5e1; text-align:center;">
                    <input type="number" class="form-input judge-mark-input" 
                        data-judge-idx="${jIdx}" min="0" max="100" placeholder="0" 
                        value="${val}" 
                        data-initial-val="${val}"
                        style="width:70px; text-align:center; font-size:0.85rem; padding:0.35rem 0.5rem; margin:0 auto; background:#fff; border-color:#cbd5e1;" />
                </td>`;
        } else {
            judgeInputsHTML = judges.map((name, jIdx) => {
                const savedJudges = existingResult && Array.isArray(existingResult.judges) ? existingResult.judges : [];
                const oldIdx = savedJudges.indexOf(name);
                const val = (oldIdx !== -1 && savedMarks[oldIdx] !== undefined && savedMarks[oldIdx] !== null) ? savedMarks[oldIdx] : '';
                return `
                    <td style="padding:0.5rem; border:1px solid #cbd5e1; text-align:center;">
                        <input type="number" class="form-input judge-mark-input" 
                            data-judge-idx="${jIdx}" min="0" max="100" placeholder="0" 
                            value="${val}" 
                            data-initial-val="${val}"
                            style="width:70px; text-align:center; font-size:0.85rem; padding:0.35rem 0.5rem; margin:0 auto; background:#fff; border-color:#cbd5e1;" />
                    </td>`;
            }).join('');
        }

        return `
            <tr class="mark-entry-row" data-student-id="${p.id}" data-student-name="${window.escapeHTML(p.name)}" data-team-id="${p.teamId}" data-team-name="${window.escapeHTML(p.teamName)}" data-manual-grade="${window.escapeHTML(screenManualGrade)}" data-judge-manual-grades="${window.escapeHTML(JSON.stringify(manualGrades))}">
                <td style="padding:0.4rem 0.5rem; border:1px solid #cbd5e1; text-align:center; white-space:nowrap;">
                    <div style="display:inline-flex; align-items:center; gap:4px; justify-content:center;">
                        <input type="text" class="form-input code-letter-input" 
                            data-student-id="${p.id}"
                            placeholder="—" value="${window.escapeHTML(codeLetter)}" 
                            style="width:48px; text-align:center; font-size:0.85rem; font-weight:800; padding:0.25rem 0.35rem; text-transform:uppercase;" />
                        <button type="button" class="btn btn-sm btn-pw-generate-sp" data-student-id="${p.id}" title="Generate Unique Letter"
                            style="padding:0.2rem 0.45rem; font-size:0.75rem; background:${codeLetter ? '#ecfdf5' : '#6366f1'}; color:${codeLetter ? '#059669' : '#fff'}; border:${codeLetter ? '1px solid #a7f3d0' : 'none'}; border-radius:4px; cursor:pointer; font-weight:700; transition:all 0.2s;"
                            ${codeLetter ? 'disabled' : ''}>
                            ${codeLetter ? '✓' : '🎲'}
                        </button>
                    </div>
                </td>
                ${!isGroup ? `
                <td style="padding:0.75rem; border:1px solid #cbd5e1; font-weight:700; color:#475569;">
                    ${window.escapeHTML(p.chestNumber)}
                </td>` : ''}
                <td style="padding:0.75rem; border:1px solid #cbd5e1;">
                    <div style="font-weight:700; color:#1e293b;">${window.escapeHTML(p.name)}</div>
                </td>
                ${judgeInputsHTML}
                <td style="padding:0.75rem; border:1px solid #cbd5e1; text-align:center; font-weight:800; color:#1e293b; background:#f8fafc; ${!showCalculations ? 'display:none;' : ''}" class="cell-final-mark">
                    —
                </td>
                <td style="padding:0.75rem; border:1px solid #cbd5e1; text-align:center; font-weight:700; ${!showCalculations ? 'display:none;' : ''}" class="cell-grade">
                    —
                </td>
                <td style="padding:0.75rem; border:1px solid #cbd5e1; text-align:center; font-weight:700; color:#64748b; ${!showCalculations ? 'display:none;' : ''}" class="cell-rank">
                    —
                </td>
            </tr>
        `;
    }).join('');

    let statusBannerHTML = '';
    if (isStandalone) {
        const submissionStatus = existingResult && existingResult.judgeSubmissionStatus ? existingResult.judgeSubmissionStatus[sJudgeId] : '';
        if (submissionStatus === 'submitted' || submissionStatus === true) {
            statusBannerHTML = `
                <div style="background:#d1fae5; border:1px solid #10b981; color:#065f46; border-radius:8px; padding:0.75rem 1rem; font-size:0.85rem; font-weight:700; margin-bottom:0.75rem;">
                    ✓ Your marks have been saved and submitted successfully.
                </div>
            `;
        } else {
            statusBannerHTML = `
                <div style="background:#fef3c7; border:1px solid #f59e0b; color:#92400e; border-radius:8px; padding:0.75rem 1rem; font-size:0.85rem; font-weight:700; margin-bottom:0.75rem;">
                    ⏳ Your marks are currently in draft. Please submit them when completed.
                </div>
            `;
        }

        const savedJudges = existingResult && Array.isArray(existingResult.judges) ? existingResult.judges : [];
        const judgeIds = existingResult && Array.isArray(existingResult.judgeIds) ? existingResult.judgeIds : [];
        
        let otherPending = false;
        if (!isResultSubmitted) {
            const submissionStatusMap = existingResult && existingResult.judgeSubmissionStatus ? existingResult.judgeSubmissionStatus : {};
            if (judgeIds.length > 0) {
                otherPending = judgeIds.some(jid => jid !== sJudgeId && submissionStatusMap[jid] !== 'submitted' && submissionStatusMap[jid] !== true);
            } else {
                otherPending = judges.length > 1;
            }
        }
        
        if (otherPending) {
            statusBannerHTML += `
                <div style="background:#eff6ff; border:1px solid #3b82f6; color:#1e40af; border-radius:8px; padding:0.75rem 1rem; font-size:0.85rem; font-weight:600; margin-bottom:0.75rem;">
                    ℹ️ Waiting for the other assigned judge to complete marking.
                </div>
            `;
        }
    }

    modalBody.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:1.25rem;">
            <!-- Header bar -->
            <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:12px; padding:1.25rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
                <div>
                    <h3 style="margin:0; font-size:1.3rem; font-weight:800; color:#0f172a;">${prog.programNumber ? `[#${prog.programNumber}] ` : ''}${window.escapeHTML(prog.programName)}</h3>
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

            ${statusBannerHTML}

            <!-- Grade Mode Selector Dropdown -->
            <div style="display:flex; justify-content:flex-end; align-items:center; margin-bottom:-0.25rem; padding:0 0.25rem;">
                <div style="display:flex; align-items:center; gap:0.5rem;">
                    <label style="font-size:0.78rem; font-weight:700; color:#475569;">Grade Mode:</label>
                    <select id="meGradeModeSelect" class="form-input" style="height:32px; padding:0.2rem 0.5rem; font-size:0.78rem; font-weight:700; border-radius:8px; width:150px; background:#fff; border:1px solid #cbd5e1; cursor:pointer; margin-top:0;">
                        <option value="auto">Automatic Grade</option>
                        <option value="manual">Manual Grade</option>
                        <option value="none">Remove Grade</option>
                    </select>
                </div>
            </div>

            <!-- Spreadsheet Table Wrapper -->
            <div style="overflow-x:auto; background:#fff; border:1px solid #cbd5e1; border-radius:12px; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                <table style="width:100%; border-collapse:collapse; min-width:800px;">
                    <thead>
                        <tr style="background:#f8fafc; border-bottom:2px solid #cbd5e1;">
                            <th style="padding:0.75rem; border:1px solid #cbd5e1; text-align:center; font-size:0.78rem; font-weight:700; color:#475569; width:110px;">LETTER</th>
                            ${!isGroup ? `<th style="padding:0.75rem; border:1px solid #cbd5e1; text-align:left; font-size:0.78rem; font-weight:700; color:#475569; width:90px;">CHEST #</th>` : ''}
                            <th style="padding:0.75rem; border:1px solid #cbd5e1; text-align:left; font-size:0.78rem; font-weight:700; color:#475569;">${isGroup ? 'TEAM NAME' : 'STUDENT NAME'}</th>
                            ${judgeHeadersHTML}
                            <th class="cell-calc-header" style="padding:0.75rem; border:1px solid #cbd5e1; text-align:center; font-size:0.78rem; font-weight:700; color:#475569; width:95px; ${!showCalculations ? 'display:none;' : ''}">FINAL MARK</th>
                            <th class="cell-calc-header" style="padding:0.75rem; border:1px solid #cbd5e1; text-align:center; font-size:0.78rem; font-weight:700; color:#475569; width:90px; ${!showCalculations ? 'display:none;' : ''}">GRADE</th>
                            <th class="cell-calc-header" style="padding:0.75rem; border:1px solid #cbd5e1; text-align:center; font-size:0.78rem; font-weight:700; color:#475569; width:80px; ${!showCalculations ? 'display:none;' : ''}">RANK</th>
                        </tr>
                    </thead>
                    <tbody id="meSpreadsheetBody" data-is-standalone="${isStandalone}" data-judge-idx="${isStandalone ? judges.indexOf(sJudgeName) : -1}" data-grade-mode="${window.escapeHTML(existingResult?.gradeMode || 'auto')}" data-class-type="${classType}">
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

    // Bind in-spreadsheet generate button listeners
    tbody.querySelectorAll('.btn-pw-generate-sp').forEach(btn => {
        btn.onclick = () => {
            const studentId = btn.getAttribute('data-student-id');
            const rowEl = tbody.querySelector(`.mark-entry-row[data-student-id="${studentId}"]`);
            if (rowEl) {
                triggerLuckyDrawLetterAssignment(prog, studentId, rowEl, existingResult);
            }
        };
    });

    tbody.querySelectorAll('.code-letter-input').forEach(input => {
        input.oninput = () => {
            const val = input.value.trim().toUpperCase();
            input.value = val;
            const studentId = input.getAttribute('data-student-id');
            const btn = tbody.querySelector(`.btn-pw-generate-sp[data-student-id="${studentId}"]`);
            if (btn) {
                if (val) {
                    btn.innerHTML = '✓';
                    btn.style.background = '#ecfdf5';
                    btn.style.color = '#059669';
                    btn.style.border = '1px solid #a7f3d0';
                    btn.disabled = true;
                } else {
                    btn.innerHTML = '🎲';
                    btn.style.background = '#6366f1';
                    btn.style.color = '#fff';
                    btn.style.border = 'none';
                    btn.disabled = false;
                }
            }
        };
    });
    
    let manualGradeMode = (existingResult?.gradeMode === 'manual');

    // Grade mode select listener
    const meGradeModeSelect = document.getElementById('meGradeModeSelect');
    if (meGradeModeSelect) {
        meGradeModeSelect.value = existingResult?.gradeMode || 'auto';
        meGradeModeSelect.onchange = () => {
            const currentMode = meGradeModeSelect.value;
            tbody.setAttribute('data-grade-mode', currentMode);
            manualGradeMode = (currentMode === 'manual');
            updateManualGradeUI();
            recalculateSpreadsheet(judges.length);
        };
    }

    function updateManualGradeUI() {
        const gradeModeSelect = document.getElementById('meGradeModeSelect');
        const currentMode = gradeModeSelect ? gradeModeSelect.value : (tbody.getAttribute('data-grade-mode') || 'auto');
        const isManual = (currentMode === 'manual');

        // Toggle visibility of columns if showCalculations is false
        if (!showCalculations) {
            document.querySelectorAll('.cell-calc-header, .cell-final-mark, .cell-grade, .cell-rank').forEach(el => {
                el.style.display = isManual ? '' : 'none';
            });
        }

        // Toggle interaction on Grade cells
        const gradeCells = tbody.querySelectorAll('.cell-grade');
        gradeCells.forEach(cell => {
            if (isManual) {
                cell.classList.add('interactive');
                cell.style.cursor = 'pointer';
            } else {
                cell.classList.remove('interactive');
                cell.style.cursor = '';
            }
        });
    }

    // Initialize UI states
    updateManualGradeUI();

    // Event delegation for cell-grade clicks
    tbody.addEventListener('click', (e) => {
        const cell = e.target.closest('.cell-grade');
        if (!cell) return;
        if (!manualGradeMode) return;

        const tr = cell.closest('.mark-entry-row');
        if (!tr) return;

        openGradeSelector(cell, tr);
    });

    function openGradeSelector(cell, tr) {
        const existing = document.querySelector('.grade-selector-popover');
        if (existing) existing.remove();

        const popover = document.createElement('div');
        popover.className = 'grade-selector-popover';

        const currentManualGrade = tr.getAttribute('data-manual-grade') || '';
        const options = ['AUTO', ...(activePointsConfig?.grades || []).map(g => g.name)];

        options.forEach(opt => {
            const optDiv = document.createElement('div');
            optDiv.className = 'grade-selector-option';
            optDiv.textContent = opt;

            if (opt === 'AUTO' && !currentManualGrade) {
                optDiv.classList.add('active');
            } else if (opt === currentManualGrade) {
                optDiv.classList.add('active');
            }

            optDiv.addEventListener('click', (event) => {
                event.stopPropagation();
                if (opt === 'AUTO') {
                    tr.removeAttribute('data-manual-grade');
                } else {
                    tr.setAttribute('data-manual-grade', opt);
                }
                recalculateSpreadsheet(judges.length);
                popover.remove();
            });

            popover.appendChild(optDiv);
        });

        document.body.appendChild(popover);
        const rect = cell.getBoundingClientRect();
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

        popover.style.top = `${rect.bottom + scrollTop + 4}px`;
        popover.style.left = `${rect.left + scrollLeft}px`;

        const closeHandler = (event) => {
            if (!popover.contains(event.target) && event.target !== cell) {
                popover.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', closeHandler);
        }, 10);
    }
    
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

    // Run first calculations on load (always recalculate so calculations are ready)
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
    const tbody = document.getElementById('meSpreadsheetBody');
    const isStandalone = tbody ? (tbody.getAttribute('data-is-standalone') === 'true') : false;
    const gradeMode = tbody ? (tbody.getAttribute('data-grade-mode') || 'auto') : 'auto';
    const classType = tbody ? (tbody.getAttribute('data-class-type') || 'individual') : 'individual';

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

        const activeScreenManualGrade = r.tr.getAttribute('data-manual-grade') || null;

        if (r.hasScores || activeScreenManualGrade) {
            finalCell.textContent = r.hasScores ? r.finalMark : '—';
            
            const { grade: automaticGrade } = getGradeAndPoints(r.finalMark, activePointsConfig, classType);
            
            let effectiveGrade = '';
            let isOverridden = false;

            if (isStandalone) {
                effectiveGrade = activeScreenManualGrade || automaticGrade || '';
                isOverridden = isValidManualGrade(activeScreenManualGrade, activePointsConfig);
            } else {
                const adminManualGrade = activeScreenManualGrade;
                let aggregatedJudgeGrade = '';
                const jGradesStr = r.tr.getAttribute('data-judge-manual-grades');
                if (jGradesStr) {
                    try {
                        const jGrades = JSON.parse(jGradesStr);
                        const validJudgeGrades = jGrades.filter(g => isValidManualGrade(g, activePointsConfig));
                        if (validJudgeGrades.length > 0) {
                            aggregatedJudgeGrade = aggregateManualGrades(validJudgeGrades, activePointsConfig);
                        }
                        isOverridden = isValidManualGrade(adminManualGrade, activePointsConfig) || jGrades.some(g => isValidManualGrade(g, activePointsConfig));
                    } catch (e) {
                        console.error("Failed to parse judge manual grades:", e);
                    }
                } else {
                    isOverridden = isValidManualGrade(adminManualGrade, activePointsConfig);
                }
                effectiveGrade = adminManualGrade || aggregatedJudgeGrade || automaticGrade || '';
            }
            
            if (gradeMode === 'none') {
                effectiveGrade = '';
                isOverridden = false;
            }

            if (effectiveGrade) {
                const indicator = isOverridden ? ' <span style="font-size:0.65rem; color:#6366f1; margin-left:2px;">✎</span>' : '';
                gradeCell.innerHTML = `<span class="badge" style="background:#e0e7ff; color:#4338ca; font-size:0.75rem; font-weight:700; border:1px solid #c7d2fe;">${effectiveGrade}${indicator}</span>`;
            } else {
                gradeCell.textContent = (gradeMode === 'none') ? '' : '—';
            }
            
            // Highlight ranks 1, 2, 3
            if (r.hasScores) {
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
                rankCell.textContent = '—';
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
    const gradeMode = document.getElementById('meGradeModeSelect')?.value || 'auto';
    if (!db) {
        window.showToast("Unable to save: Database reference is not initialized.", "error");
        return;
    }

    if (!prog || !prog.id) {
        window.showToast("Unable to save: Program information is missing.", "error");
        return;
    }

    if (!judges || judges.length === 0) {
        window.showToast("Unable to save: No judges assigned to this competition.", "error");
        return;
    }

    const rows = document.querySelectorAll('.mark-entry-row');

    if (rows.length === 0) {
        window.showToast("Unable to save: No registered participants found for this program.", "error");
        return;
    }

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
    const urlParams = new URLSearchParams(window.location.search);
    const isStandalone = urlParams.get('mode') === 'standalone';
    const sJudgeName = isStandalone ? sessionStorage.getItem('standaloneJudgeName') : '';
    const sJudgeId = isStandalone ? sessionStorage.getItem('standaloneJudgeId') : '';

    const btn = isSubmit ? document.getElementById('meSubmitBtn') : document.getElementById('meDraftBtn');
    const text = btn ? btn.querySelector('.btn-text') : null;
    const spinner = btn ? btn.querySelector('.btn-spinner') : null;

    if (btn) {
        btn.disabled = true;
        if (text) text.classList.add('hidden');
        if (spinner) spinner.classList.remove('hidden');
    }

    try {
        const judgesSnap = await getDocs(collection(db, "institutes", window.currentInstituteId, "judges"));
        const nameToIdMap = new Map();
        judgesSnap.forEach(d => {
            nameToIdMap.set(d.data().name, d.id);
        });

        const resultsRef = collection(db, "institutes", window.currentInstituteId, "results");
        const docRef = doc(resultsRef, `result_${prog.id}`);

        await runTransaction(db, async (transaction) => {
            const docSnap = await transaction.get(docRef);
            let existingDoc = docSnap.exists() ? docSnap.data() : null;

            let dbJudges = existingDoc && Array.isArray(existingDoc.judges) ? [...existingDoc.judges] : [];
            let dbJudgeIds = existingDoc && Array.isArray(existingDoc.judgeIds) ? [...existingDoc.judgeIds] : [];
            let dbJudgeSubmissionStatus = existingDoc && existingDoc.judgeSubmissionStatus ? { ...existingDoc.judgeSubmissionStatus } : {};

            if (isStandalone) {
                if (!dbJudges.includes(sJudgeName)) {
                    dbJudges.push(sJudgeName);
                }
                const currentJudgeId = nameToIdMap.get(sJudgeName) || sJudgeId;
                if (!dbJudgeIds.includes(currentJudgeId)) {
                    dbJudgeIds.push(currentJudgeId);
                }
                
                const currentJudgeIdx = dbJudges.indexOf(sJudgeName);
                
                const judgeRef = doc(db, "institutes", window.currentInstituteId, "judges", sJudgeId);
                const judgeSnap = await transaction.get(judgeRef);
                if (!judgeSnap.exists() || judgeSnap.data().status === 'disabled') {
                    throw new Error("Your judge profile is disabled or not found.");
                }
                
                const jData = judgeSnap.data();
                const compIds = Array.isArray(jData.competitionIds) ? jData.competitionIds : [];
                const comps = Array.isArray(jData.competitions) ? jData.competitions : [];
                
                let isEligible = false;
                if (compIds.length > 0) {
                    isEligible = compIds.includes(prog.id);
                } else {
                    const matches = allPrograms.filter(progItem => 
                        comps.some(compName => compName.toLowerCase().trim() === progItem.programName.toLowerCase().trim())
                    );
                    if (matches.length === 1 && matches[0].id === prog.id) {
                        isEligible = true;
                    }
                }
                if (!isEligible) {
                    throw new Error("You are not assigned to judge this competition.");
                }

                const inputMarksMap = new Map();
                rows.forEach(tr => {
                    const studentId = tr.getAttribute('data-student-id') || '';
                    const codeLetter = tr.querySelector('.code-letter-input').value.trim().toUpperCase();
                    const input = tr.querySelector('.judge-mark-input');
                    const val = input ? input.value.trim() : '';
                    const markVal = val !== '' ? parseFloat(val) : null;
                    inputMarksMap.set(studentId, { codeLetter, markVal });
                });

                let dbMarksData = existingDoc && Array.isArray(existingDoc.marksData) ? [...existingDoc.marksData] : [];
                const updatedMarksData = [];

                rows.forEach(tr => {
                    const studentId = tr.getAttribute('data-student-id') || '';
                    const studentName = tr.getAttribute('data-student-name') || '';
                    const teamId = tr.getAttribute('data-team-id') || '';
                    const teamName = tr.getAttribute('data-team-name') || '';

                    const screenInfo = inputMarksMap.get(studentId);
                    const codeLetter = screenInfo ? screenInfo.codeLetter : '';
                    const screenMark = screenInfo ? screenInfo.markVal : null;

                    const dbEntry = dbMarksData.find(m => (isGroup ? m.groupId === studentId : m.studentId === studentId));
                    let marks = dbEntry && Array.isArray(dbEntry.marks) ? [...dbEntry.marks] : [];

                    while (marks.length < dbJudges.length) {
                        marks.push(null);
                    }

                    marks[currentJudgeIdx] = screenMark;

                    let manualGrades = dbEntry && Array.isArray(dbEntry.manualGrades) ? [...dbEntry.manualGrades] : [];
                    while (manualGrades.length < dbJudges.length) {
                        manualGrades.push(null);
                    }
                    const rowManualGrade = tr.getAttribute('data-manual-grade') || null;
                    manualGrades[currentJudgeIdx] = rowManualGrade;

                    const adminManualGrade = dbEntry ? (dbEntry.adminManualGrade || null) : null;
                    const legacyManualGrade = dbEntry ? (dbEntry.manualGrade || null) : null;

                    updatedMarksData.push({
                        studentId: isGroup ? '' : studentId,
                        groupId: isGroup ? studentId : '',
                        studentName,
                        teamId,
                        teamName,
                        codeLetter: codeLetter || (dbEntry ? dbEntry.codeLetter : ''),
                        marks,
                        finalMark: 0,
                        grade: '',
                        gradePoints: 0,
                        adminManualGrade: adminManualGrade,
                        manualGrade: legacyManualGrade,
                        manualGrades: manualGrades,
                        rank: null,
                        position: '',
                        positionPoints: 0,
                        totalPoints: 0
                    });
                });

                dbJudgeSubmissionStatus[currentJudgeId] = isSubmit ? 'submitted' : 'saved';

                // Check legacy compatibility resolver too
                const allSubmitted = dbJudges.every(name => {
                    const jId = nameToIdMap.get(name);
                    return jId && (dbJudgeSubmissionStatus[jId] === 'submitted' || dbJudgeSubmissionStatus[jId] === true);
                });

                let winners = [];
                let markEntryStatus = 'in-progress';
                if (allSubmitted) {
                    markEntryStatus = 'submitted';
                    updatedMarksData.forEach(entry => {
                        let sum = 0;
                        let count = 0;
                        entry.marks.forEach(m => {
                            if (m !== null && m !== undefined) {
                                sum += m;
                                count++;
                            }
                        });
                        entry.finalMark = count > 0 ? Number((sum / dbJudges.length).toFixed(2)) : 0;
                    });

                    const activeEntries = updatedMarksData.filter(e => e.marks.some(m => m !== null && m !== undefined));
                    computeDenseRanking(activeEntries, e => e.finalMark, 'rank');

                    const pType = (prog.programType || prog.type || 'individual').toLowerCase();
                    let classType = 'individual';
                    if (pType === 'general') classType = 'general';
                    else if (pType === 'group') classType = 'group';

                    const config = activePointsConfig[classType] || DEFAULT_POINTS[classType];
                    const positionPointsMap = {
                        'First': config.first !== undefined ? Number(config.first) : 10,
                        'Second': config.second !== undefined ? Number(config.second) : 8,
                        'Third': config.third !== undefined ? Number(config.third) : 6,
                        'Participation': 0
                    };

                    updatedMarksData.forEach(entry => {
                        const hasScores = entry.marks.some(m => m !== null && m !== undefined);
                        if (hasScores) {
                            const { grade: automaticGrade } = getGradeAndPoints(entry.finalMark, activePointsConfig, classType);
                            const effectiveGrade = resolveEffectiveGrade({
                                automaticGrade,
                                adminManualGrade: entry.adminManualGrade,
                                legacyManualGrade: entry.manualGrade,
                                manualGrades: entry.manualGrades,
                                judgeSubmissionStatus: dbJudgeSubmissionStatus,
                                judgeIds: dbJudgeIds,
                                pointsConfig: activePointsConfig
                            });
                            
                            const savedGrade = (gradeMode === 'none') ? '' : effectiveGrade;
                            const pointsGrade = (gradeMode === 'none') ? (automaticGrade || '') : effectiveGrade;
                            const gp = pointsGrade ? getGradePointsForGrade(pointsGrade, activePointsConfig, classType) : 0;

                            const posMap = { 1: 'First', 2: 'Second', 3: 'Third' };
                            const position = posMap[entry.rank] || '';
                            const pp = positionPointsMap[position] || 0;
                            entry.grade = savedGrade;
                            entry.gradePoints = gp;
                            entry.position = position || '';
                            entry.positionPoints = pp || 0;
                            entry.totalPoints = gp + pp;
                        }
                    });

                    const activeWinners = updatedMarksData.filter(r => r.finalMark > 0 && r.rank !== null && r.rank <= 3);
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
                            manualGrade: r.manualGrade || null,
                            marks: r.totalPoints || 0,
                            remarks: `Average: ${r.finalMark} (Grade Points: ${r.gradePoints} + Position Points: ${r.positionPoints})`
                        });
                    });
                }

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
                    judges: dbJudges,
                    judgeIds: dbJudgeIds,
                    marksData: updatedMarksData,
                    winners,
                    status: existingDoc?.status || 'draft',
                    markEntryStatus,
                    judgeSubmissionStatus: dbJudgeSubmissionStatus,
                    gradeMode,
                    updatedAt: serverTimestamp()
                };

                if (existingDoc && existingDoc.publishedAt) payload.publishedAt = existingDoc.publishedAt;
                if (existingDoc && existingDoc.status === 'published') {
                    payload.status = 'published';
                    payload.markEntryStatus = 'submitted';
                }

                transaction.set(docRef, payload, { merge: true });

            } else {
                dbJudges = [...judges];
                dbJudgeIds = judges.map(name => nameToIdMap.get(name) || '');

                judges.forEach(name => {
                    const jId = nameToIdMap.get(name);
                    if (jId) {
                        dbJudgeSubmissionStatus[jId] = isSubmit ? 'submitted' : 'saved';
                    }
                });

                let dbMarksData = existingDoc && Array.isArray(existingDoc.marksData) ? [...existingDoc.marksData] : [];
                const updatedMarksData = [];

                rows.forEach(tr => {
                    const studentId = tr.getAttribute('data-student-id') || '';
                    const studentName = tr.getAttribute('data-student-name') || '';
                    const teamId = tr.getAttribute('data-team-id') || '';
                    const teamName = tr.getAttribute('data-team-name') || '';
                    const codeLetter = tr.querySelector('.code-letter-input').value.trim().toUpperCase();

                    const dbEntry = dbMarksData.find(m => (isGroup ? m.groupId === studentId : m.studentId === studentId));
                    let marks = dbEntry && Array.isArray(dbEntry.marks) ? [...dbEntry.marks] : [];

                    while (marks.length < dbJudges.length) {
                        marks.push(null);
                    }

                    judges.forEach((name, screenIdx) => {
                        const dbIdx = dbJudges.indexOf(name);
                        if (dbIdx !== -1) {
                            const input = tr.querySelector(`.judge-mark-input[data-judge-idx="${screenIdx}"]`);
                            const val = input ? input.value.trim() : '';
                            const isChanged = input && (val !== input.getAttribute('data-initial-val'));
                            if (isChanged) {
                                marks[dbIdx] = val !== '' ? parseFloat(val) : null;
                            } else {
                                const existingVal = dbEntry && Array.isArray(dbEntry.marks) && dbEntry.marks[dbIdx] !== undefined ? dbEntry.marks[dbIdx] : null;
                                marks[dbIdx] = existingVal;
                            }
                        }
                    });

                    const rowManualGrade = tr.getAttribute('data-manual-grade') || null;
                    const manualGrades = dbEntry && Array.isArray(dbEntry.manualGrades) ? [...dbEntry.manualGrades] : [];
                    const legacyManualGrade = dbEntry ? (dbEntry.manualGrade || null) : null;

                    updatedMarksData.push({
                        studentId: isGroup ? '' : studentId,
                        groupId: isGroup ? studentId : '',
                        studentName,
                        teamId,
                        teamName,
                        codeLetter,
                        marks,
                        finalMark: 0,
                        grade: '',
                        gradePoints: 0,
                        adminManualGrade: rowManualGrade,
                        manualGrade: legacyManualGrade,
                        manualGrades: manualGrades,
                        rank: null,
                        position: '',
                        positionPoints: 0,
                        totalPoints: 0
                    });
                });

                updatedMarksData.forEach(entry => {
                    let sum = 0;
                    let count = 0;
                    entry.marks.forEach(m => {
                        if (m !== null && m !== undefined) {
                            sum += m;
                            count++;
                        }
                    });
                    entry.finalMark = count > 0 ? Number((sum / dbJudges.length).toFixed(2)) : 0;
                });

                const activeEntries = updatedMarksData.filter(e => e.marks.some(m => m !== null && m !== undefined));
                computeDenseRanking(activeEntries, e => e.finalMark, 'rank');

                const pType = (prog.programType || prog.type || 'individual').toLowerCase();
                let classType = 'individual';
                if (pType === 'general') classType = 'general';
                else if (pType === 'group') classType = 'group';

                const config = activePointsConfig[classType] || DEFAULT_POINTS[classType];
                const positionPointsMap = {
                    'First': config.first !== undefined ? Number(config.first) : 10,
                    'Second': config.second !== undefined ? Number(config.second) : 8,
                    'Third': config.third !== undefined ? Number(config.third) : 6,
                    'Participation': 0
                };

                updatedMarksData.forEach(entry => {
                    const hasScores = entry.marks.some(m => m !== null && m !== undefined);
                    if (hasScores) {
                        const { grade: automaticGrade } = getGradeAndPoints(entry.finalMark, activePointsConfig, classType);
                        const effectiveGrade = resolveEffectiveGrade({
                            automaticGrade,
                            adminManualGrade: entry.adminManualGrade,
                            legacyManualGrade: entry.manualGrade,
                            manualGrades: entry.manualGrades,
                            judgeSubmissionStatus: dbJudgeSubmissionStatus,
                            judgeIds: dbJudgeIds,
                            pointsConfig: activePointsConfig
                        });
                        
                        const savedGrade = (gradeMode === 'none') ? '' : effectiveGrade;
                        const pointsGrade = (gradeMode === 'none') ? (automaticGrade || '') : effectiveGrade;
                        const gp = pointsGrade ? getGradePointsForGrade(pointsGrade, activePointsConfig, classType) : 0;

                        const posMap = { 1: 'First', 2: 'Second', 3: 'Third' };
                        const position = posMap[entry.rank] || '';
                        const pp = positionPointsMap[position] || 0;
                        entry.grade = savedGrade;
                        entry.gradePoints = gp;
                        entry.position = position || '';
                        entry.positionPoints = pp || 0;
                        entry.totalPoints = gp + pp;
                    }
                });

                const winners = [];
                const activeWinners = updatedMarksData.filter(r => r.finalMark > 0 && r.rank !== null && r.rank <= 3);
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
                        manualGrade: r.manualGrade || null,
                        marks: r.totalPoints || 0,
                        remarks: `Average: ${r.finalMark} (Grade Points: ${r.gradePoints} + Position Points: ${r.positionPoints})`
                    });
                });

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
                    judges: dbJudges,
                    judgeIds: dbJudgeIds,
                    marksData: updatedMarksData,
                    winners,
                    status: existingDoc?.status || 'draft',
                    markEntryStatus: isSubmit ? 'submitted' : 'in-progress',
                    judgeSubmissionStatus: dbJudgeSubmissionStatus,
                    gradeMode,
                    updatedAt: serverTimestamp()
                };

                if (existingDoc && existingDoc.publishedAt) payload.publishedAt = existingDoc.publishedAt;
                if (existingDoc && existingDoc.status === 'published') {
                    payload.status = 'published';
                    payload.markEntryStatus = 'submitted';
                }

                transaction.set(docRef, payload, { merge: true });
            }
        });

        if (!isStandalone) {
            const batch = writeBatch(db);
            const existingDoc = allResults.get(prog.id);
            const judgesSnap = await getDocs(collection(db, "institutes", window.currentInstituteId, "judges"));
            judgesSnap.forEach(d => {
                const j = d.data();
                const jName = j.name;
                const comps = Array.isArray(j.competitions) ? j.competitions : [];
                const compIds = Array.isArray(j.competitionIds) ? j.competitionIds : [];
                const wasAssigned = existingDoc && Array.isArray(existingDoc.judges) && existingDoc.judges.includes(jName);
                const isNowAssigned = judges.includes(jName);

                if (isNowAssigned) {
                    let compsUpdated = false;
                    let newComps = [...comps];
                    let newCompIds = [...compIds];
                    if (!comps.includes(prog.programName)) {
                        newComps.push(prog.programName);
                        compsUpdated = true;
                    }
                    if (!compIds.includes(prog.id)) {
                        newCompIds.push(prog.id);
                        compsUpdated = true;
                    }
                    if (compsUpdated) {
                        batch.update(d.ref, { competitions: newComps, competitionIds: newCompIds, updatedAt: serverTimestamp() });
                    }
                } else if (wasAssigned) {
                    const newComps = comps.filter(c => c !== prog.programName);
                    const newCompIds = compIds.filter(id => id !== prog.id);
                    batch.update(d.ref, { competitions: newComps, competitionIds: newCompIds, updatedAt: serverTimestamp() });
                }
            });
            await batch.commit();
        }

        await updateDashboardMetadata(window.currentInstituteId);
        window.showToast(isSubmit ? "📤 Marks submitted successfully!" : "📝 Draft saved successfully!", "success");
        document.getElementById('dynamicModal').classList.add('hidden');
        document.getElementById('dynamicModal').classList.remove('result-fullscreen-modal');

    } catch (err) {
        console.error("Failed persisting marks:", err);
        window.showToast(`Unable to save: ${err.message || err}`, "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            if (text) text.classList.remove('hidden');
            if (spinner) spinner.classList.add('hidden');
        }
    }
}

async function saveJudgeAssignment(prog, selectedJudgeNames, activeJudges, existingResult, modal) {
    if (!db) {
        window.showToast("Database reference not initialized.", "error");
        return;
    }

    const btn = document.getElementById('jSelectAssignBtn');
    const text = btn ? btn.querySelector('.btn-text') : null;
    const spinner = btn ? btn.querySelector('.btn-spinner') : null;

    if (btn) {
        btn.disabled = true;
        if (text) text.classList.add('hidden');
        if (spinner) spinner.classList.remove('hidden');
    }

    try {
        // 1. Verify existing marks
        if (existingResult && Array.isArray(existingResult.marksData)) {
            const hasMarks = existingResult.marksData.some(m => Array.isArray(m.marks) && m.marks.some(mark => mark !== null && mark !== undefined));
            if (hasMarks) {
                const currentJudges = existingResult.judges || [];
                const isDifferent = (selectedJudgeNames.length !== currentJudges.length) ||
                                    selectedJudgeNames.some((name, idx) => currentJudges[idx] !== name);
                if (isDifferent) {
                    alert("Marks already exist for this competition. Judge assignment cannot be changed until the existing marks are cleared or handled by the administrator.");
                    return;
                }
            }
        }

        const isGroup = prog.programType === 'group' || prog.registrationType === 'group' || prog.type === 'Group';

        // Load/create active judges map name -> docId
        const judgesSnap = await getDocs(collection(db, "institutes", window.currentInstituteId, "judges"));
        const nameToIdMap = new Map();
        judgesSnap.forEach(d => {
            nameToIdMap.set(d.data().name, d.id);
        });

        const judgeIds = selectedJudgeNames.map(name => nameToIdMap.get(name) || '');
        const dbJudgeSubmissionStatus = existingResult && existingResult.judgeSubmissionStatus ? { ...existingResult.judgeSubmissionStatus } : {};

        // Remove status for removed judges
        Object.keys(dbJudgeSubmissionStatus).forEach(jid => {
            if (!judgeIds.includes(jid)) {
                delete dbJudgeSubmissionStatus[jid];
            }
        });
        // Initialize new judges to 'in-progress'
        judgeIds.forEach(jid => {
            if (jid && !dbJudgeSubmissionStatus[jid]) {
                dbJudgeSubmissionStatus[jid] = 'in-progress';
            }
        });

        // 2. Prepare marksData
        const participants = await loadStudentsForProgram(prog);
        const marksData = [];

        participants.forEach(p => {
            let existingEntry = null;
            if (existingResult && Array.isArray(existingResult.marksData)) {
                existingEntry = existingResult.marksData.find(m => (isGroup ? m.groupId === p.id : m.studentId === p.id));
            }
            const codeLetter = existingEntry ? existingEntry.codeLetter || '' : '';

            // We construct a clean null array matching selected judges count
            const marks = new Array(selectedJudgeNames.length).fill(null);

            marksData.push({
                studentId: isGroup ? '' : p.id,
                groupId: isGroup ? p.id : '',
                studentName: p.name || '',
                teamId: p.teamId || '',
                teamName: p.teamName || '',
                codeLetter: codeLetter,
                marks: marks,
                finalMark: 0,
                grade: '',
                gradePoints: 0,
                rank: null,
                position: '',
                positionPoints: 0,
                totalPoints: 0
            });
        });

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
            participantCount: participants.length,
            judges: selectedJudgeNames,
            judgeIds: judgeIds,
            marksData: marksData,
            winners: [],
            status: existingResult?.status || 'draft',
            markEntryStatus: existingResult?.markEntryStatus || 'in-progress',
            judgeSubmissionStatus: dbJudgeSubmissionStatus,
            updatedAt: serverTimestamp()
        };

        const batch = writeBatch(db);
        const resultsRef = collection(db, "institutes", window.currentInstituteId, "results");

        if (existingResult) {
            if (existingResult.publishedAt) payload.publishedAt = existingResult.publishedAt;
            if (existingResult.status === 'published') {
                payload.status = 'published';
                payload.markEntryStatus = 'submitted';
            }
            batch.set(doc(resultsRef, existingResult.id), payload, { merge: true });
        } else {
            payload.createdAt = serverTimestamp();
            batch.set(doc(resultsRef, `result_${prog.id}`), payload);
        }

        // Bilateral synchronization
        judgesSnap.forEach(d => {
            const j = d.data();
            const jName = j.name;
            const comps = Array.isArray(j.competitions) ? j.competitions : [];
            const compIds = Array.isArray(j.competitionIds) ? j.competitionIds : [];
            
            const wasAssigned = existingResult && Array.isArray(existingResult.judges) && existingResult.judges.includes(jName);
            const isNowAssigned = selectedJudgeNames.includes(jName);

            if (isNowAssigned) {
                let compsUpdated = false;
                let newComps = [...comps];
                let newCompIds = [...compIds];
                if (!comps.includes(prog.programName)) {
                    newComps.push(prog.programName);
                    compsUpdated = true;
                }
                if (!compIds.includes(prog.id)) {
                    newCompIds.push(prog.id);
                    compsUpdated = true;
                }
                if (compsUpdated) {
                    batch.update(d.ref, { competitions: newComps, competitionIds: newCompIds, updatedAt: serverTimestamp() });
                }
            } else if (wasAssigned) {
                const newComps = comps.filter(c => c !== prog.programName);
                const newCompIds = compIds.filter(id => id !== prog.id);
                batch.update(d.ref, { competitions: newComps, competitionIds: newCompIds, updatedAt: serverTimestamp() });
            }
        });

        await batch.commit();
        await updateDashboardMetadata(window.currentInstituteId);

        window.showToast("🧑‍⚖️ Judge assignments updated successfully!", "success");
        modal.classList.add('hidden');
        modal.classList.remove('result-fullscreen-modal');

    } catch (err) {
        console.error("Failed saving judge assignments:", err);
        window.showToast(`Unable to save assignments: ${err.message || err}`, "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            if (text) text.classList.remove('hidden');
            if (spinner) spinner.classList.add('hidden');
        }
    }
}
