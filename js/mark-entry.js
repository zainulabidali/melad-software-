import { db } from './firebase.js';
import {
    collection, getDocs, doc, getDoc, setDoc, onSnapshot, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { normalizeClasses } from './categories.js';

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
    classId: '',
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
            <input type="text" id="meSearchInput" class="form-input" placeholder="Search programs..." style="width:180px;" />
            <select id="meCatFilter" class="form-input" style="width:140px;">${catOptions}</select>
            <select id="meClassFilter" class="form-input" style="width:140px;" disabled>
                <option value="">All Classes</option>
            </select>
            <select id="meGenderFilter" class="form-input" style="width:120px;">
                <option value="">All Genders</option>
                <option value="Boys">Boys</option>
                <option value="Girls">Girls</option>
                <option value="Mixed">Mixed</option>
            </select>
            <select id="meStageFilter" class="form-input" style="width:120px;">
                <option value="">All Stages</option>
                <option value="Stage">Stage</option>
                <option value="Off Stage">Off Stage</option>
            </select>
            <select id="meStatusFilter" class="form-input" style="width:120px;">
                <option value="">All Statuses</option>
                <option value="Pending">Pending</option>
                <option value="In Progress">In Progress</option>
                <option value="Submitted">Submitted</option>
                <option value="Published">Published</option>
            </select>
        </div>
    `;

    container.innerHTML = `
        <div class="grid" id="markEntryGrid">
            <div class="loader-container"><div class="spinner"></div></div>
        </div>
    `;

    // Wire filters
    const searchInput = document.getElementById('meSearchInput');
    const catFilter = document.getElementById('meCatFilter');
    const classFilter = document.getElementById('meClassFilter');
    const genderFilter = document.getElementById('meGenderFilter');
    const stageFilter = document.getElementById('meStageFilter');
    const statusFilter = document.getElementById('meStatusFilter');

    searchInput.oninput = (e) => {
        markEntryFilter.search = e.target.value.toLowerCase().trim();
        renderMarkEntryGrid();
    };

    catFilter.onchange = async (e) => {
        markEntryFilter.categoryId = e.target.value;
        markEntryFilter.classId = '';
        classFilter.innerHTML = '<option value="">All Classes</option>';
        classFilter.disabled = true;

        if (markEntryFilter.categoryId) {
            const catDoc = await getDoc(doc(db, "institutes", window.currentInstituteId, "categories", markEntryFilter.categoryId));
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
        renderMarkEntryGrid();
    };

    classFilter.onchange = (e) => {
        markEntryFilter.classId = e.target.value;
        renderMarkEntryGrid();
    };

    genderFilter.onchange = (e) => {
        markEntryFilter.gender = e.target.value;
        renderMarkEntryGrid();
    };

    stageFilter.onchange = (e) => {
        markEntryFilter.stage = e.target.value;
        renderMarkEntryGrid();
    };

    statusFilter.onchange = (e) => {
        markEntryFilter.status = e.target.value;
        renderMarkEntryGrid();
    };

    await loadMarkEntryData();
}

// ─────────────────────────────────────────────
// Data Loading & Syncing
// ─────────────────────────────────────────────
async function loadMarkEntryData() {
    try {
        // Fetch all programs
        const progsSnap = await getDocs(collection(db, "institutes", window.currentInstituteId, "programs"));
        allPrograms = progsSnap.docs.map(progDoc => {
            const p = progDoc.data();
            const pType = (p.programType || p.type || 'individual').toLowerCase();
            const regType = (pType === 'general') ? (p.registrationType || 'individual') : pType;
            return {
                id: progDoc.id,
                programName: p.programName || 'Unnamed Program',
                programType: pType,
                type: regType === 'group' ? 'Group' : 'Individual',
                genderCategory: p.genderCategory || 'Mixed',
                programLocation: p.programLocation || p.location || 'Stage',
                groupSize: p.maxParticipants || p.groupSize || 1,
                categoryId: p.categoryId || '',
                categoryName: p.categoryName || p.categoryId || 'General',
                classId: p.classId || '',
                className: p.className || ''
            };
        });

        // Real-time listener for results to map status
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
// Render Cards Grid
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
        if (markEntryFilter.classId && p.classId !== markEntryFilter.classId) return false;
        if (markEntryFilter.gender && p.genderCategory !== markEntryFilter.gender) return false;
        if (markEntryFilter.stage && p.programLocation !== markEntryFilter.stage) return false;

        // Status filter
        const status = getProgramStatus(p.id);
        if (markEntryFilter.status && status !== markEntryFilter.status) return false;

        return true;
    });

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column:1/-1; margin-top:2rem;">
                <div class="empty-state-icon">🖋️</div>
                <h3>No Matching Programs</h3>
                <p>Try adjusting your search query or filters.</p>
            </div>`;
        return;
    }

    filtered.forEach(p => {
        const status = getProgramStatus(p.id);
        const badge = getStatusBadgeHTML(status);

        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <div class="card-header">
                <h3 class="card-title">${window.escapeHTML(p.programName)}</h3>
                <div style="display:flex; gap:0.3rem; flex-wrap:wrap; align-items:center;">
                    ${badge}
                </div>
            </div>
            <div class="card-body">
                <p style="font-size:0.82rem; color:#64748b; margin-bottom:0.4rem;">
                    <strong>Category:</strong> ${window.escapeHTML(p.categoryName)} ${p.className ? `· ${window.escapeHTML(p.className)}` : ''}
                </p>
                <p style="font-size:0.82rem; color:#64748b;">
                    <strong>Type:</strong> ${window.escapeHTML(p.type)} · ${window.escapeHTML(p.genderCategory)} · ${window.escapeHTML(p.programLocation)}
                </p>
            </div>
            <div class="card-actions" style="margin-top:0.75rem;">
                <button class="btn btn-primary btn-sm btn-me-open" data-id="${p.id}">🖋️ Mark Entry</button>
            </div>
        `;

        card.querySelector('.btn-me-open').onclick = () => openMarkEntryModal(p);
        grid.appendChild(card);
    });
}

function getProgramStatus(progId) {
    const res = allResults.get(progId);
    if (!res) return 'Pending';
    if (res.status === 'published') return 'Published';
    if (res.markEntryStatus === 'submitted') return 'Submitted';
    return 'In Progress';
}

function getStatusBadgeHTML(status) {
    const styles = {
        'Pending': 'background:#f1f5f9; color:#64748b; border:1px solid #cbd5e1;',
        'In Progress': 'background:#eff6ff; color:#1d4ed8; border:1px solid #93c5fd;',
        'Submitted': 'background:#fff7ed; color:#ea580c; border:1px solid #ffedd5;',
        'Published': 'background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0;'
    };
    return `<span class="badge" style="font-size:0.73rem; font-weight:700; ${styles[status]}">${status}</span>`;
}

// ─────────────────────────────────────────────
// Loading Subcollection Data
// ─────────────────────────────────────────────
async function loadStudentsForProgram(prog) {
    const snap = await getDocs(collection(db, "institutes", window.currentInstituteId, "programs", prog.id, "participants"));
    const isGroup = prog.programType === 'group' || prog.type === 'Group';
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
    const isGroup = prog.programType === 'group';
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
        <th style="padding:0.75rem; border:1px solid #cbd5e1; text-align:center; font-size:0.78rem; text-transform:uppercase; color:#475569;">
            ${window.escapeHTML(name)}
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
    document.getElementById('meSubmitBtn').onclick = () => {
        if (!confirm("Are you sure you want to submit these marks? This locks editing until unsubmitted/unpublished.")) return;
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

    // Ranks calculation (dense or competition)
    // Ranks apply to rows that have at least some scores
    const activeRows = rows.filter(r => r.hasScores);
    activeRows.sort((a, b) => b.finalMark - a.finalMark);

    for (let i = 0; i < activeRows.length; i++) {
        if (i > 0 && activeRows[i].finalMark === activeRows[i - 1].finalMark) {
            activeRows[i].rank = activeRows[i - 1].rank;
        } else {
            activeRows[i].rank = i + 1; // Standard competition ranking
        }
    }

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

    const isGroup = prog.programType === 'group';
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

    // Re-apply ranks accurately
    const activeRows = sortedRows.filter(r => r.hasScores);
    activeRows.sort((a, b) => b.finalMark - a.finalMark);
    for (let i = 0; i < activeRows.length; i++) {
        if (i > 0 && activeRows[i].finalMark === activeRows[i - 1].finalMark) {
            activeRows[i].rank = activeRows[i - 1].rank;
        } else {
            activeRows[i].rank = i + 1;
        }
    }

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
