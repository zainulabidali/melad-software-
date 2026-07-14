import { db, updateDashboardMetadata, getCachedCategories, getCachedPrograms, computeDenseRanking, getCachedPointsConfig, DEFAULT_POINTS } from './firebase.js';
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

const GRADE_LEVEL_SCORE = {
    'A+': 5,
    'A': 4,
    'B+': 3,
    'B': 2,
    'C': 1
};
const SCORE_TO_GRADE = {
    5: 'A+',
    4: 'A',
    3: 'B+',
    2: 'B',
    1: 'C'
};

function isValidManualGrade(grade) {
    return grade === 'A+' || grade === 'A' || grade === 'B+' || grade === 'B' || grade === 'C';
}

function resolveEffectiveGrade({
    automaticGrade,
    adminManualGrade,
    legacyManualGrade,
    manualGrades,
    judgeSubmissionStatus,
    judgeIds
}) {
    if (isValidManualGrade(adminManualGrade)) {
        return adminManualGrade;
    }
    if (isValidManualGrade(legacyManualGrade)) {
        return legacyManualGrade;
    }
    if (Array.isArray(manualGrades) && manualGrades.length > 0) {
        const validJudgeGrades = [];
        manualGrades.forEach((g, idx) => {
            if (isValidManualGrade(g)) {
                let isSubmitted = true;
                if (Array.isArray(judgeIds) && judgeIds[idx]) {
                    const jid = judgeIds[idx];
                    const status = judgeSubmissionStatus ? judgeSubmissionStatus[jid] : null;
                    isSubmitted = (status === 'submitted' || status === true);
                }
                if (isSubmitted) {
                    validJudgeGrades.push(g);
                }
            }
        });
        if (validJudgeGrades.length > 0) {
            return aggregateManualGrades(validJudgeGrades);
        }
    }
    return automaticGrade || '';
}

function aggregateManualGrades(grades) {
    const scores = grades.map(g => GRADE_LEVEL_SCORE[g]).filter(s => s !== undefined);
    if (scores.length === 0) return '';
    const average = scores.reduce((sum, val) => sum + val, 0) / scores.length;
    const resolvedLevel = Math.round(average);
    return SCORE_TO_GRADE[resolvedLevel] || '';
}

function getGradeAndPoints(score, classType = 'individual') {
    const config = activePointsConfig[classType] || DEFAULT_POINTS[classType];
    const gradePointsMap = {
        'A+': config.gradeAPlus !== undefined ? Number(config.gradeAPlus) : 5,
        'A': config.gradeA !== undefined ? Number(config.gradeA) : 4,
        'B+': config.gradeBPlus !== undefined ? Number(config.gradeBPlus) : 3,
        'B': config.gradeB !== undefined ? Number(config.gradeB) : 2,
        'C': config.gradeC !== undefined ? Number(config.gradeC) : 1
    };

    let grade = '';
    if (score >= 90) grade = 'A+';
    else if (score >= 80) grade = 'A';
    else if (score >= 70) grade = 'B+';
    else if (score >= 60) grade = 'B';
    else if (score >= 50) grade = 'C';

    const points = grade ? (gradePointsMap[grade] || 0) : 0;
    return { grade, points };
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
                const sComps = sessionStorage.getItem('standaloneCompetitions') ? JSON.parse(sessionStorage.getItem('standaloneCompetitions')) : [];
                const sCompIds = sessionStorage.getItem('standaloneCompetitionIds') ? JSON.parse(sessionStorage.getItem('standaloneCompetitionIds')) : [];
                
                let isEligible = false;
                if (sCompIds.length > 0) {
                    isEligible = sCompIds.includes(p.id);
                } else {
                    // Legacy unique name resolver
                    const matches = allPrograms.filter(progItem => 
                        sComps.some(compName => compName.toLowerCase().trim() === progItem.programName.toLowerCase().trim())
                    );
                    if (matches.length === 1 && matches[0].id === p.id) {
                        isEligible = true;
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
    if (!window.currentInstituteId) {
        alert("No institute selected.");
        return;
    }

    try {
        activePointsConfig = await getCachedPointsConfig(window.currentInstituteId);
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
                if (compIds.length > 0) {
                    isEligible = compIds.includes(prog.id);
                } else {
                    // Legacy unique program resolver
                    const matches = allPrograms.filter(progItem => 
                        comps.some(compName => compName.toLowerCase().trim() === progItem.programName.toLowerCase().trim())
                    );
                    if (matches.length > 1) {
                        modalBody.innerHTML = `
                            <div style="text-align:center; padding:3rem; color:#ef4444;">
                                <strong>⚠️ Ambiguous Assignment</strong><br><br>
                                <p style="color:#64748b; font-size:0.875rem;">This legacy judge assignment matches multiple programs. Please update the judge's program assignment from the admin panel.</p>
                                <button class="btn btn-secondary btn-sm mt-4" id="jCloseNoticeBtn">Close</button>
                            </div>`;
                        document.getElementById('jCloseNoticeBtn').onclick = () => {
                            modal.classList.add('hidden');
                            modal.classList.remove('result-fullscreen-modal');
                        };
                        return;
                    } else if (matches.length === 1) {
                        isEligible = (matches[0].id === prog.id);
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
        
        document.getElementById('jSelectProceedBtn').onclick = () => {
            let judgesList = existingResult && Array.isArray(existingResult.judges) ? [...existingResult.judges] : [];
            if (!judgesList.includes(sJudgeName)) {
                judgesList.push(sJudgeName);
            }
            document.getElementById('dynamicModalTitle').textContent = `🖋️ Mark Entry — ${sJudgeName}`;
            renderSpreadsheetUI(modalBody, modal, prog, judgesList, participants, existingResult);
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
                if (compIds.length > 0) {
                    isEligible = compIds.includes(prog.id);
                } else if (comps.length > 0) {
                    const matches = allPrograms.filter(progItem => 
                        comps.some(compName => compName.toLowerCase().trim() === progItem.programName.toLowerCase().trim())
                    );
                    if (matches.length === 1) {
                        isEligible = (matches[0].id === prog.id);
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
        <div style="max-width:520px; margin:0 auto; display:flex; flex-direction:column; gap:1.25rem; padding:0.5rem 0;">
            <div style="background:#e0e7ff; border:1px solid #c7d2fe; border-radius:12px; padding:1.25rem; text-align:center; color:#1e1b4b;">
                <span style="font-size:2.2rem; display:block; margin-bottom:0.25rem;">🧑‍⚖️</span>
                <h3 style="margin:0; font-size:1.2rem; font-weight:800;">Assign Judges to Competition</h3>
                <p style="font-size:0.8rem; color:#4338ca; font-weight:700; margin-top:0.3rem; margin-bottom:0;">
                    ${prog.programNumber ? `[#${prog.programNumber}] ` : ''}${window.escapeHTML(prog.programName)} [${window.escapeHTML(prog.categoryName)}]
                </p>
            </div>

            <div>
                <label class="form-label" style="font-weight:700; color:#475569; margin-bottom:0.45rem;">SELECT ACTIVE JUDGES *</label>
                <div style="display:flex; flex-direction:column; gap:0.45rem; max-height:260px; overflow-y:auto; border:1px solid #cbd5e1; border-radius:10px; padding:0.75rem; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,0.02);">
                    ${listHTML}
                </div>
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
        document.getElementById('dynamicModalTitle').textContent = `🖋️ Judges List`;
        renderSpreadsheetUI(modalBody, modal, prog, checkedNames, participants, existingResult);
    };
}

function renderSpreadsheetUI(modalBody, modal, prog, judges, participants, existingResult) {
    const isGroup = prog.programType === 'group' || prog.registrationType === 'group' || prog.type === 'Group';
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

            <!-- Manual Grade Toggle Button Bar -->
            <div style="display:flex; justify-content:flex-end; align-items:center; margin-bottom:-0.25rem; padding:0 0.25rem;">
                <button type="button" id="meManualGradeToggleBtn" class="btn btn-secondary" style="padding:0.4rem 0.75rem; font-size:0.78rem; font-weight:700; border-radius:8px; display:inline-flex; align-items:center; gap:0.3rem; cursor:pointer; height:32px;">
                    Manual Grade
                </button>
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
                            <th class="cell-calc-header" style="padding:0.75rem; border:1px solid #cbd5e1; text-align:center; font-size:0.78rem; font-weight:700; color:#475569; width:95px; ${!showCalculations ? 'display:none;' : ''}">FINAL MARK</th>
                            <th class="cell-calc-header" style="padding:0.75rem; border:1px solid #cbd5e1; text-align:center; font-size:0.78rem; font-weight:700; color:#475569; width:90px; ${!showCalculations ? 'display:none;' : ''}">GRADE</th>
                            <th class="cell-calc-header" style="padding:0.75rem; border:1px solid #cbd5e1; text-align:center; font-size:0.78rem; font-weight:700; color:#475569; width:80px; ${!showCalculations ? 'display:none;' : ''}">RANK</th>
                        </tr>
                    </thead>
                    <tbody id="meSpreadsheetBody" data-is-standalone="${isStandalone}" data-judge-idx="${isStandalone ? judges.indexOf(sJudgeName) : -1}">
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
    
    let manualGradeMode = false;

    // Toggle button click listener
    const meManualGradeToggleBtn = document.getElementById('meManualGradeToggleBtn');
    if (meManualGradeToggleBtn) {
        meManualGradeToggleBtn.onclick = () => {
            manualGradeMode = !manualGradeMode;
            updateManualGradeUI();
        };
    }

    function updateManualGradeUI() {
        const toggleBtn = document.getElementById('meManualGradeToggleBtn');
        if (!toggleBtn) return;

        if (manualGradeMode) {
            toggleBtn.innerHTML = '✓ Manual Grade';
            toggleBtn.style.background = '#e0e7ff';
            toggleBtn.style.color = '#4338ca';
            toggleBtn.style.borderColor = '#c7d2fe';
        } else {
            toggleBtn.innerHTML = 'Manual Grade';
            toggleBtn.style.background = '#f8fafc';
            toggleBtn.style.color = '#475569';
            toggleBtn.style.borderColor = '#cbd5e1';
        }

        // Toggle visibility of columns if showCalculations is false
        if (!showCalculations) {
            document.querySelectorAll('.cell-calc-header, .cell-final-mark, .cell-grade, .cell-rank').forEach(el => {
                el.style.display = manualGradeMode ? '' : 'none';
            });
        }

        // Toggle interaction on Grade cells
        const gradeCells = tbody.querySelectorAll('.cell-grade');
        gradeCells.forEach(cell => {
            if (manualGradeMode) {
                cell.classList.add('interactive');
                cell.style.cursor = 'pointer';
            } else {
                cell.classList.remove('interactive');
                cell.style.cursor = '';
            }
        });
    }

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
        const options = ['AUTO', 'A+', 'A', 'B+', 'B', 'C'];

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
            
            const { grade: automaticGrade } = getGradeAndPoints(r.finalMark);
            
            let effectiveGrade = '';
            let isOverridden = false;

            if (isStandalone) {
                effectiveGrade = activeScreenManualGrade || automaticGrade || '';
                isOverridden = isValidManualGrade(activeScreenManualGrade);
            } else {
                const adminManualGrade = activeScreenManualGrade;
                let aggregatedJudgeGrade = '';
                const jGradesStr = r.tr.getAttribute('data-judge-manual-grades');
                if (jGradesStr) {
                    try {
                        const jGrades = JSON.parse(jGradesStr);
                        const validJudgeGrades = jGrades.filter(isValidManualGrade);
                        if (validJudgeGrades.length > 0) {
                            aggregatedJudgeGrade = aggregateManualGrades(validJudgeGrades);
                        }
                        isOverridden = isValidManualGrade(adminManualGrade) || jGrades.some(isValidManualGrade);
                    } catch (e) {
                        console.error("Failed to parse judge manual grades:", e);
                    }
                } else {
                    isOverridden = isValidManualGrade(adminManualGrade);
                }
                effectiveGrade = adminManualGrade || aggregatedJudgeGrade || automaticGrade || '';
            }
            
            if (effectiveGrade) {
                const indicator = isOverridden ? ' <span style="font-size:0.65rem; color:#6366f1; margin-left:2px;">✎</span>' : '';
                gradeCell.innerHTML = `<span class="badge" style="background:#e0e7ff; color:#4338ca; font-size:0.75rem; font-weight:700; border:1px solid #c7d2fe;">${effectiveGrade}${indicator}</span>`;
            } else {
                gradeCell.textContent = '—';
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
                            const { grade: automaticGrade } = getGradeAndPoints(entry.finalMark, classType);
                            const effectiveGrade = resolveEffectiveGrade({
                                automaticGrade,
                                adminManualGrade: entry.adminManualGrade,
                                legacyManualGrade: entry.manualGrade,
                                manualGrades: entry.manualGrades,
                                judgeSubmissionStatus: dbJudgeSubmissionStatus,
                                judgeIds: dbJudgeIds
                            });

                            const gradePointsMap = {
                                'A+': config.gradeAPlus !== undefined ? Number(config.gradeAPlus) : 5,
                                'A': config.gradeA !== undefined ? Number(config.gradeA) : 4,
                                'B+': config.gradeBPlus !== undefined ? Number(config.gradeBPlus) : 3,
                                'B': config.gradeB !== undefined ? Number(config.gradeB) : 2,
                                'C': config.gradeC !== undefined ? Number(config.gradeC) : 1
                            };
                            const gp = effectiveGrade ? (gradePointsMap[effectiveGrade] || 0) : 0;

                            const posMap = { 1: 'First', 2: 'Second', 3: 'Third' };
                            const position = posMap[entry.rank] || '';
                            const pp = positionPointsMap[position] || 0;
                            entry.grade = effectiveGrade;
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
                        const { grade: automaticGrade } = getGradeAndPoints(entry.finalMark, classType);
                        const effectiveGrade = resolveEffectiveGrade({
                            automaticGrade,
                            adminManualGrade: entry.adminManualGrade,
                            legacyManualGrade: entry.manualGrade,
                            manualGrades: entry.manualGrades,
                            judgeSubmissionStatus: dbJudgeSubmissionStatus,
                            judgeIds: dbJudgeIds
                        });

                        const gradePointsMap = {
                            'A+': config.gradeAPlus !== undefined ? Number(config.gradeAPlus) : 5,
                            'A': config.gradeA !== undefined ? Number(config.gradeA) : 4,
                            'B+': config.gradeBPlus !== undefined ? Number(config.gradeBPlus) : 3,
                            'B': config.gradeB !== undefined ? Number(config.gradeB) : 2,
                            'C': config.gradeC !== undefined ? Number(config.gradeC) : 1
                        };
                        const gp = effectiveGrade ? (gradePointsMap[effectiveGrade] || 0) : 0;

                        const posMap = { 1: 'First', 2: 'Second', 3: 'Third' };
                        const position = posMap[entry.rank] || '';
                        const pp = positionPointsMap[position] || 0;
                        entry.grade = effectiveGrade;
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
