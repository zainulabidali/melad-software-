import { db } from './firebase.js';
import {
    collection,
    addDoc,
    getDocs,
    doc,
    deleteDoc,
    updateDoc,
    onSnapshot,
    serverTimestamp,
    writeBatch,
    query,
    where,
    collectionGroup
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { normalizeClasses } from './categories.js';

let unsubscribeStudents = null;
let unsubscribeParticipants = null;

let currentTeamId = null;
let currentCategoryId = null;
let currentClassId = null;

let allCategories = [];
let allPrograms = [];
let teamMap = new Map();

let localStudents = [];
let localStudentsAll = [];
let localParticipants = [];
let participantUnsubs = [];

function getStudentPrograms(studentId) {
    const studentProgs = [];
    localParticipants.forEach(p => {
        // 1. Individual Registration
        if (p.type === 'individual' && p.studentId === studentId) {
            const prog = allPrograms.find(pr => pr.id === p.programId);
            if (prog) {
                const pType = (prog.programType || prog.type || 'individual').toLowerCase();
                let typeLabel = 'Individual';
                let regMode = 'Individual';
                if (pType === 'general') {
                    typeLabel = 'General';
                    regMode = prog.registrationType === 'group' ? 'Group' : 'Individual';
                }
                const cat = allCategories.find(c => c.id === prog.categoryId || c.name === prog.categoryId);
                const catName = cat?.name || (prog.categoryId === 'general_programs' ? 'General' : prog.categoryId || 'General');
                const loc = prog.programLocation || prog.location || 'Off Stage';

                studentProgs.push({
                    id: p.programId,
                    name: prog.programName || 'Unknown Program',
                    type: typeLabel,
                    location: loc,
                    category: catName,
                    regMode: regMode,
                    teamName: ''
                });
            }
        }
        // 2. Group Registration
        else if (p.type === 'group' && Array.isArray(p.groups)) {
            p.groups.forEach(g => {
                if (Array.isArray(g.members) && g.members.some(m => m.studentId === studentId)) {
                    const prog = allPrograms.find(pr => pr.id === p.programId);
                    if (prog) {
                        const pType = (prog.programType || prog.type || 'group').toLowerCase();
                        let typeLabel = 'Group';
                        let regMode = 'Group';
                        if (pType === 'general') {
                            typeLabel = 'General';
                            regMode = 'Group';
                        }
                        const cat = allCategories.find(c => c.id === prog.categoryId || c.name === prog.categoryId);
                        const catName = cat?.name || (prog.categoryId === 'general_programs' ? 'General' : prog.categoryId || 'General');
                        const loc = prog.programLocation || prog.location || 'Off Stage';
                        const tName = p.teamName || teamMap.get(p.teamId) || '';

                        studentProgs.push({
                            id: p.programId,
                            name: prog.programName || 'Unknown Program',
                            type: typeLabel,
                            location: loc,
                            category: catName,
                            regMode: regMode,
                            teamName: tName
                        });
                    }
                }
            });
        }
    });

    // Deduplicate studentProgs by programId to be safe
    const seen = new Set();
    const uniqueProgs = [];
    for (const sp of studentProgs) {
        if (!seen.has(sp.id)) {
            seen.add(sp.id);
            uniqueProgs.push(sp);
        }
    }
    return uniqueProgs;
}

export async function initStudentsView(container, topActions) {
    if (unsubscribeStudents) {
        unsubscribeStudents();
        unsubscribeStudents = null;
    }
    if (unsubscribeParticipants) {
        unsubscribeParticipants();
        unsubscribeParticipants = null;
    }
    participantUnsubs.forEach(unsub => unsub());
    participantUnsubs = [];

    localStudents = [];
    localStudentsAll = [];
    localParticipants = [];

    // Clear top actions
    topActions.innerHTML = '';

    container.innerHTML = `
        <div class="students-view-header">
            <div class="students-header-left">
                <h2 class="students-view-heading">Student Directory</h2>
                <p class="students-view-subtitle">Manage student profiles and assignments</p>
            </div>
            <div class="students-header-right filter-bar-scrollable">
                <div class="search-input-wrapper">
                    <span class="search-icon">🔍</span>
                    <input type="text" id="stuSearchInput" class="form-input search-input-premium" placeholder="Search student..." />
                </div>
                <select id="stuCatSelect" class="form-input select-premium" style="width: 170px;">
                    <option value="">Select Category...</option>
                </select>
                <select id="stuClassSelect" class="form-input select-premium" style="width: 150px;" disabled>
                    <option value="">Select Class...</option>
                </select>
                <select id="stuTeamSelect" class="form-input select-premium" style="width: 170px;">
                    <option value="">All Teams (Filter)</option>
                </select>
                <button class="btn btn-primary" id="btnAddStudents" disabled>+ Student</button>
            </div>
        </div>

        <div class="students-table-container" id="studentsTableContainer">
            <div class="empty-state" style="grid-column: 1 / -1; margin-top:2rem;">
                <div class="empty-state-icon">🎓</div>
                <h3>Loading Student Directory...</h3>
                <p>Establishing secure connection to database.</p>
            </div>
        </div>
    `;

    const catSel = document.getElementById('stuCatSelect');
    const classSel = document.getElementById('stuClassSelect');
    const teamSel = document.getElementById('stuTeamSelect');
    const btnAddStudents = document.getElementById('btnAddStudents');
    const searchInput = document.getElementById('stuSearchInput');

    // Scroll handler to close fixed menus
    window.addEventListener('scroll', () => {
        const activeDropdown = document.querySelector('.active-body-dropdown');
        if (activeDropdown) activeDropdown.remove();
    }, true);

    // Single delegated click listener on container for student-dots-btn
    container.addEventListener('click', (e) => {
        const dotsBtn = e.target.closest('.student-dots-btn');
        if (dotsBtn) {
            e.stopPropagation();
            openStudentDropdown(dotsBtn);
        }
    });

    // 1. Load Global Categories
    try {
        const catSnap = await getDocs(collection(db, "institutes", window.currentInstituteId, "categories"));
        allCategories = [];
        catSnap.forEach(d => {
            const data = d.data();
            allCategories.push({ id: d.id, ...data, classes: normalizeClasses(data.classes) });
            const opt = document.createElement('option');
            opt.value = d.id;
            opt.textContent = data.name;
            if (catSel) catSel.appendChild(opt);
        });
    } catch (e) { console.error("Error loading categories", e); }

    // 2. Load Teams & populate global teamMap
    try {
        teamMap.clear();
        const teamSnap = await getDocs(collection(db, "institutes", window.currentInstituteId, "teams"));
        teamSnap.forEach(d => {
            teamMap.set(d.id, d.data().name);
            const opt = document.createElement('option');
            opt.value = d.id;
            opt.textContent = d.data().name;
            if (teamSel) teamSel.appendChild(opt);
        });
    } catch (e) { console.error("Error loading teams", e); }

    // 3. Load all Programs once
    try {
        const progSnap = await getDocs(collection(db, "institutes", window.currentInstituteId, "programs"));
        allPrograms = progSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) { console.error("Error loading programs", e); }

    if (catSel) {
        catSel.addEventListener('change', (e) => {
            currentCategoryId = e.target.value;
            currentClassId = null;
            if (classSel) {
                classSel.innerHTML = '<option value="">Select Class...</option>';
                classSel.disabled = true;
            }
            if (btnAddStudents) btnAddStudents.disabled = true;

            if (currentCategoryId) {
                const cat = allCategories.find(c => c.id === currentCategoryId);
                if (cat && cat.classes && classSel) {
                    cat.classes.forEach(cls => {
                        const opt = document.createElement('option');
                        opt.value = cls.id;
                        opt.textContent = cls.name;
                        classSel.appendChild(opt);
                    });
                    classSel.disabled = false;
                }
            }
            applyStudentFiltersAndRender();
        });
    }

    if (classSel) {
        classSel.addEventListener('change', (e) => {
            currentClassId = e.target.value;
            if (btnAddStudents) {
                btnAddStudents.disabled = !(currentCategoryId && currentClassId);
            }
            applyStudentFiltersAndRender();
        });
    }

    if (teamSel) {
        teamSel.addEventListener('change', (e) => {
            currentTeamId = e.target.value;
            applyStudentFiltersAndRender();
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', debounce(() => {
            applyStudentFiltersAndRender();
        }, 300));
    }

    if (btnAddStudents) {
        btnAddStudents.addEventListener('click', openBulkAddModal);
    }

    // Load full student collection immediately
    loadStudentsData();
}

function debounce(fn, ms) {
    let t = null;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
}

function applyStudentFiltersAndRender() {
    const q = (document.getElementById('stuSearchInput')?.value || '').trim().toLowerCase();

    let filtered = localStudentsAll;

    // 1. Search locally by name or chest number
    if (q) {
        filtered = filtered.filter(s => {
            const nameMatch = (s.name || '').toLowerCase().includes(q);
            const chestMatch = (s.chestNumber || '').toLowerCase().includes(q);
            const chestHashMatch = `#${s.chestNumber || ''}`.toLowerCase().includes(q);
            return nameMatch || chestMatch || chestHashMatch;
        });
    }

    // 2. Cascaded category post-filter
    if (currentCategoryId) {
        filtered = filtered.filter(s => s.categoryId === currentCategoryId);
    }

    // 3. Cascaded class post-filter
    if (currentClassId) {
        filtered = filtered.filter(s => s.classId === currentClassId);
    }

    // 4. Cascaded team post-filter
    if (currentTeamId) {
        filtered = filtered.filter(s => s.teamId === currentTeamId);
    }

    localStudents = filtered;
    renderStudentsUI();
}

function loadStudentsData() {
    if (unsubscribeStudents) unsubscribeStudents();
    participantUnsubs.forEach(unsub => unsub());
    participantUnsubs = [];

    const studentsRef = collection(db, "institutes", window.currentInstituteId, "students");

    // Live sync to ALL students in flat collection
    unsubscribeStudents = onSnapshot(studentsRef, (snapshot) => {
        localStudentsAll = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        applyStudentFiltersAndRender();
    }, (err) => {
        console.error("Students listener error:", err);
        window.showToast("Failed to load students.", "error");
    });

    setupParticipantsListeners();
}

function setupParticipantsListeners() {
    participantUnsubs.forEach(unsub => unsub());
    participantUnsubs = [];

    if (allPrograms.length === 0) {
        localParticipants = [];
        renderStudentsUI();
        return;
    }

    const participantsMap = new Map();

    allPrograms.forEach(prog => {
        const progId = prog.id;
        const partRef = collection(db, "institutes", window.currentInstituteId, "programs", progId, "participants");

        const unsub = onSnapshot(partRef, (snapshot) => {
            const docs = snapshot.docs.map(d => ({
                id: d.id,
                programId: progId,
                ...d.data()
            }));
            participantsMap.set(progId, docs);

            // Combine all participants from the local maps
            const allParts = [];
            participantsMap.forEach(parts => {
                allParts.push(...parts);
            });
            localParticipants = allParts;

            renderStudentsUI();
        }, (err) => {
            console.error(`Participants subcollection listener error for ${progId}:`, err);
            participantsMap.set(progId, []);

            const allParts = [];
            participantsMap.forEach(parts => {
                allParts.push(...parts);
            });
            localParticipants = allParts;

            renderStudentsUI();
        });

        participantUnsubs.push(unsub);
    });
}

function renderStudentsUI() {
    const tableContainer = document.getElementById("studentsTableContainer");
    if (!tableContainer) return;

    if (localStudents.length === 0) {
        tableContainer.innerHTML = `
            <div class="empty-state" style="grid-column:1/-1; margin-top:2rem;">
                <div class="empty-state-icon">👤</div>
                <h3>No Students Found</h3>
                <p>Click "+ Add Students" to enroll students in this class.</p>
                <div id="legacyMigrationCheck" style="margin-top:1.25rem;"></div>
            </div>`;
        checkLegacyStudents();
        return;
    }

    let tableHTML = `
        <div class="students-table">
            <div class="students-table-header">
                <div>Chest No.</div>
                <div>Student Name</div>
                <div>Gender</div>
                <div>Category</div>
                <div>Class</div>
                <div>Team</div>
                <div>Programs</div>
                <div style="text-align: right;">Actions</div>
            </div>
            <div class="students-table-body">
    `;

    localStudents.forEach((stu) => {
        const id = stu.id;
        const chest = stu.chestNumber || '—';
        const teamName = teamMap.get(stu.teamId) || '—';

        const studentProgs = getStudentPrograms(id);
        const tooltipText = studentProgs.map(p => `• ${p.name} (${p.type})`).join('\n') || 'No programs registered';

        const programsBadgeLabel = studentProgs.length === 1 ? '1 Program' : `${studentProgs.length} Programs`;

        tableHTML += `
            <div class="student-row">
                <div class="student-chest-cell">
                    #${window.escapeHTML(chest)}
                </div>
                <div class="student-name-cell">
                    ${window.escapeHTML(stu.name)}
                </div>
                <div class="student-gender-cell">
                    ${window.escapeHTML(stu.gender || '—')}
                </div>
                <div class="student-cat-cell">
                    ${window.escapeHTML(stu.categoryName || 'General')}
                </div>
                <div class="student-class-cell">
                    ${window.escapeHTML(stu.className || 'Standard')}
                </div>
                <div class="student-team-cell">
                    ${window.escapeHTML(teamName)}
                </div>
                <div class="student-programs-cell">
                    <span class="student-programs-badge" title="${window.escapeHTML(tooltipText)}">
                        👥 ${programsBadgeLabel}
                    </span>
                </div>
                <div class="student-actions-cell">
                    <div class="actions-dropdown-container">
                        <button class="btn-action-icon btn-action-more dots-btn student-dots-btn" data-id="${id}" data-all='${JSON.stringify(stu).replace(/'/g, "&#39;")}' data-progs='${JSON.stringify(studentProgs).replace(/'/g, "&#39;")}'>
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" style="width:0.95rem; height:0.95rem;">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 12.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 18.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        `;
    });

    tableHTML += `
            </div>
        </div>
    `;

    tableContainer.innerHTML = tableHTML;
}

function openViewProgramsModal(stu) {
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');
    const modalOverlay = document.getElementById('dynamicModal');
    const closeHeaderBtn = document.getElementById('closeDynamicModalBtn');

    const teamName = teamMap.get(stu.teamId) || '—';

    modalTitle.textContent = '👁 View Student & Programs';

    const studentProgs = getStudentPrograms(stu.id);

    let studentProgsHTML = "";
    if (studentProgs.length === 0) {
        studentProgsHTML = `
            <div style="text-align:center; padding:2rem; background:#f8fafc; border:1px dashed #cbd5e1; border-radius:8px; color:#64748b; font-size:0.85rem; font-style:italic;">
                Not registered in any programs yet.
            </div>
        `;
    } else {
        studentProgsHTML = `
            <div style="display:flex; flex-direction:column; gap:0.6rem; max-height:260px; overflow-y:auto; padding-right:4px;">
                ${studentProgs.map((p) => {
            return `
                        <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:0.8rem 1rem; box-shadow:0 1px 2px rgba(0,0,0,0.02); display:flex; flex-direction:column; gap:0.4rem;">
                            <div style="font-size:0.92rem; font-weight:700; color:#0f172a;">
                                ${window.escapeHTML(p.name)}
                            </div>
                            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.3rem 0.75rem; font-size:0.78rem; color:#64748b;">
                                <div><span style="font-weight:600; color:#475569;">Type:</span> ${window.escapeHTML(p.type)}</div>
                                <div><span style="font-weight:600; color:#475569;">Mode:</span> ${window.escapeHTML(p.regMode)}</div>
                                <div><span style="font-weight:600; color:#475569;">Location:</span> ${window.escapeHTML(p.location)}</div>
                                <div><span style="font-weight:600; color:#475569;">Category:</span> ${window.escapeHTML(p.category)}</div>
                                ${p.teamName ? `<div style="grid-column: span 2;"><span style="font-weight:600; color:#475569;">Team:</span> ${window.escapeHTML(p.teamName)}</div>` : ''}
                            </div>
                        </div>
                    `;
        }).join('')}
            </div>
        `;
    }

    modalBody.innerHTML = `
        <div style="font-family:'Inter',sans-serif; color:#0f172a;">
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:1rem; margin-bottom:1.25rem; display:flex; flex-direction:column; gap:0.5rem;">
                <div style="font-size:0.72rem; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.05em;">Student Profile</div>
                <div style="font-size:1.05rem; font-weight:800; color:#0f172a; display:flex; align-items:center; gap:0.5rem;">
                    👤 ${window.escapeHTML(stu.name)}
                    <span style="background:#e0e7ff; color:#4338ca; border-radius:999px; padding:0.15rem 0.6rem; font-size:0.7rem; font-weight:700;">#${window.escapeHTML(stu.chestNumber || '')}</span>
                </div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.5rem 1rem; margin-top:0.25rem; font-size:0.85rem;">
                    <div><span style="color:#64748b; font-weight:600;">Gender:</span> ${window.escapeHTML(stu.gender || '—')}</div>
                    <div><span style="color:#64748b; font-weight:600;">Team:</span> ${window.escapeHTML(teamName)}</div>
                    <div><span style="color:#64748b; font-weight:600;">Category:</span> ${window.escapeHTML(stu.categoryName || 'General')}</div>
                    <div><span style="color:#64748b; font-weight:600;">Class:</span> ${window.escapeHTML(stu.className || 'Standard')}</div>
                </div>
            </div>

            <div style="margin-bottom:0.5rem;">
                <div style="font-size:0.72rem; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:0.75rem;">REGISTERED PROGRAMS (${studentProgs.length})</div>
                ${studentProgsHTML}
            </div>

            <div class="modal-actions" style="margin-top:1.5rem; border-top:1px solid #e2e8f0; padding-top:1rem;">
                <button class="btn btn-secondary w-full" id="closeViewModalBtn" style="min-height:38px; font-weight:700;">Close</button>
            </div>
        </div>
    `;

    const closeModal = () => {
        modalOverlay.classList.add('hidden');
        document.body.style.overflow = '';
        document.removeEventListener('keydown', handleEsc);
        modalOverlay.removeEventListener('click', handleOverlayClick);
        if (closeHeaderBtn) closeHeaderBtn.onclick = null;
    };

    const handleEsc = (e) => {
        if (e.key === 'Escape') closeModal();
    };

    const handleOverlayClick = (e) => {
        if (e.target === modalOverlay) closeModal();
    };

    // Bind Close Toggles
    const closeBtnEl = document.getElementById('closeViewModalBtn');
    if (closeBtnEl) closeBtnEl.onclick = closeModal;
    if (closeHeaderBtn) closeHeaderBtn.onclick = closeModal;
    modalOverlay.addEventListener('click', handleOverlayClick);
    document.addEventListener('keydown', handleEsc);

    // Disable background scrolling & show modal
    document.body.style.overflow = 'hidden';
    modalOverlay.classList.remove('hidden');
}

/**
 * ONE-TIME MIGRATION HELPER
 * Checks if data exists in legacy nested paths when flat collection is empty
 */
async function checkLegacyStudents() {
    if (!currentTeamId || !currentCategoryId) return;
    const container = document.getElementById('legacyMigrationCheck');
    if (!container) return;

    const legacyPath = `institutes/${window.currentInstituteId}/teams/${currentTeamId}/categories/${currentCategoryId}/students`;
    try {
        const legacySnap = await getDocs(collection(db, legacyPath));
        if (!legacySnap.empty) {
            container.innerHTML = `
                <div style="background:#f0f9ff; border:1px solid #bae6fd; padding:1.25rem; border-radius:12px; text-align:center;">
                    <p style="font-size:0.875rem; color:#0369a1; font-weight:600; margin-bottom:0.5rem;">Legacy Data Detected</p>
                    <p style="font-size:0.8rem; color:#075985; margin-bottom:1rem;">We found ${legacySnap.size} students in the old nested structure for this team/category.</p>
                    <button class="btn btn-primary btn-sm" id="btnMigrateLegacy">🚀 Move to Global Collection</button>
                </div>
            `;
            document.getElementById('btnMigrateLegacy').onclick = () => migrateLegacyStudents(legacySnap.docs);
        }
    } catch (e) { /* legacy path doesn't exist */ }
}

async function migrateLegacyStudents(docs) {
    if (!confirm(`Move ${docs.length} students to the new structure? This will migrate them once and use the flat collection from now on.`)) return;
    const btn = document.getElementById('btnMigrateLegacy');
    btn.disabled = true;
    btn.textContent = "Moving...";

    try {
        const batch = writeBatch(db);
        const globalRef = collection(db, "institutes", window.currentInstituteId, "students");
        const cat = allCategories.find(c => c.id === currentCategoryId);
        const cls = cat?.classes?.find(c => c.id === currentClassId);

        docs.forEach(d => {
            const data = d.data();
            const newDoc = doc(globalRef);
            batch.set(newDoc, {
                ...data,
                categoryId: currentCategoryId,
                categoryName: cat?.name || 'General',
                classId: currentClassId,
                className: cls?.name || 'Standard',
                teamId: currentTeamId || '',
                migratedAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
        });

        await batch.commit();
        window.showToast(`Successfully moved ${docs.length} students.`);
        document.getElementById('legacyMigrationCheck').innerHTML = '';
        loadStudentsData();
    } catch (e) {
        console.error(e);
        window.showToast("Migration failed. Please try again.", "error");
        btn.disabled = false;
        btn.textContent = "Retry Move";
    }
}

function openBulkAddModal() {
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');
    const modalOverlay = document.getElementById('dynamicModal');

    const cat = allCategories.find(c => c.id === currentCategoryId);
    const cls = cat?.classes.find(c => c.id === currentClassId);

    modalTitle.textContent = '🎓 Add Students';
    modalBody.innerHTML = `
        <div style="margin-bottom:0.75rem; display:flex; justify-content:space-between; align-items:center;">
            <p style="font-size:0.85rem; color:#64748b; margin:0;">Adding to: <strong>${cat?.name} / ${cls?.name}</strong></p>
            <button type="button" id="addRowBtn" class="btn btn-secondary btn-sm">+ Add Row</button>
        </div>
        <div style="overflow-x:auto;">
            <table style="width:100%; border-collapse:collapse; font-size:0.875rem;">
                <thead>
                    <tr style="border-bottom:2px solid #e2e8f0;">
                        <th style="text-align:left; padding:0.5rem 0.4rem; color:#64748b; font-weight:600; width:30%;">Chest No.</th>
                        <th style="text-align:left; padding:0.5rem 0.4rem; color:#64748b; font-weight:600;">Student Name</th>
                        <th style="text-align:left; padding:0.5rem 0.4rem; color:#64748b; font-weight:600; width:130px;">Gender</th>
                        <th style="width:32px;"></th>
                    </tr>
                </thead>
                <tbody id="studentRowsBody"></tbody>
            </table>
        </div>
        <div class="modal-actions" style="margin-top:1.25rem;">
            <button type="button" class="btn btn-secondary" id="cancelBulkBtn">Cancel</button>
            <button type="button" class="btn btn-primary" id="saveBulkBtn">
                <span class="btn-text">💾 Save All Students</span>
                <span class="btn-spinner hidden"></span>
            </button>
        </div>
    `;

    modalOverlay.classList.remove('hidden');
    document.getElementById('cancelBulkBtn').onclick = () => modalOverlay.classList.add('hidden');
    document.getElementById('addRowBtn').onclick = () => addStudentRow();

    addStudentRow();
    addStudentRow();

    document.getElementById('saveBulkBtn').onclick = async () => {
        const rows = document.querySelectorAll('.student-entry-row');
        const students = [];
        rows.forEach(row => {
            const chest = row.querySelector('.s-chest').value.trim();
            const name = row.querySelector('.s-name').value.trim();
            const gender = row.querySelector('.s-gender').value;
            if (chest && name) students.push({ chestNumber: chest, name, gender });
        });

        if (students.length === 0) return window.showToast("Fill in at least one student.", "error");

        const btn = document.getElementById('saveBulkBtn');
        btn.disabled = true;

        try {
            const batch = writeBatch(db);
            const colRef = collection(db, "institutes", window.currentInstituteId, "students");
            students.forEach(stu => {
                batch.set(doc(colRef), {
                    ...stu,
                    categoryId: currentCategoryId,
                    categoryName: cat?.name || '',
                    classId: currentClassId,
                    className: cls?.name || '',
                    teamId: currentTeamId || '',
                    createdAt: serverTimestamp()
                });
            });
            await batch.commit();
            window.showToast(`${students.length} students added!`);
            modalOverlay.classList.add('hidden');
        } catch (e) {
            console.error(e);
            window.showToast("Save failed", "error");
        } finally {
            btn.disabled = false;
        }
    };
}

function addStudentRow() {
    const tbody = document.getElementById('studentRowsBody');
    const tr = document.createElement('tr');
    tr.className = 'student-entry-row';
    tr.style.cssText = 'border-bottom:1px solid #f1f5f9;';
    tr.innerHTML = `
        <td style="padding:0.4rem 0.4rem;"><input type="text" class="form-input s-chest" placeholder="e.g. A101"></td>
        <td style="padding:0.4rem 0.4rem;"><input type="text" class="form-input s-name" placeholder="Full name"></td>
        <td style="padding:0.4rem 0.4rem;">
            <select class="form-input s-gender">
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
            </select>
        </td>
        <td style="padding:0.4rem 0.2rem;"><button type="button" class="remove-row-btn" style="background:none; border:none; color:#ef4444; cursor:pointer;">✕</button></td>
    `;
    tr.querySelector('.remove-row-btn').onclick = () => tr.remove();
    tbody.appendChild(tr);
}

function openEditModal(stuId, data) {
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');
    const modalOverlay = document.getElementById('dynamicModal');

    modalTitle.textContent = 'Edit Student';
    modalBody.innerHTML = `
        <form id="editStudentForm">
            <div class="form-group">
                <label class="form-label">Chest Number</label>
                <input type="text" id="eChest" class="form-input" required value="${window.escapeHTML(data.chestNumber || '')}">
            </div>
            <div class="form-group">
                <label class="form-label">Student Name</label>
                <input type="text" id="eName" class="form-input" required value="${window.escapeHTML(data.name || '')}">
            </div>
            <div class="form-group">
                <label class="form-label">Gender</label>
                <select id="eGender" class="form-input">
                    <option value="Male" ${data.gender === 'Male' ? 'selected' : ''}>Male</option>
                    <option value="Female" ${data.gender === 'Female' ? 'selected' : ''}>Female</option>
                    <option value="Other" ${data.gender === 'Other' ? 'selected' : ''}>Other</option>
                </select>
            </div>
            <div class="modal-actions">
                <button type="submit" class="btn btn-primary w-full" id="saveEditStuBtn">Save Changes</button>
            </div>
        </form>
    `;

    modalOverlay.classList.remove('hidden');
    document.getElementById('editStudentForm').onsubmit = async (e) => {
        e.preventDefault();
        const btn = document.getElementById('saveEditStuBtn');
        btn.disabled = true;

        try {
            await updateDoc(doc(db, "institutes", window.currentInstituteId, "students", stuId), {
                chestNumber: document.getElementById('eChest').value.trim(),
                name: document.getElementById('eName').value.trim(),
                gender: document.getElementById('eGender').value,
                updatedAt: serverTimestamp()
            });
            window.showToast("Student updated");
            modalOverlay.classList.add('hidden');
        } catch (e) {
            console.error(e);
            window.showToast("Update failed", "error");
            btn.disabled = false;
        }
    };
}

async function deleteStudent(stuId) {
    if (!confirm("Delete this student?")) return;
    try {
        await deleteDoc(doc(db, "institutes", window.currentInstituteId, "students", stuId));
        window.showToast("Student deleted");
    } catch (e) {
        console.error(e);
        window.showToast("Delete failed", "error");
    }
}

function openStudentDropdown(btn) {
    // 1. Remove any existing dynamic body-appended dropdown
    const existing = document.querySelector('.active-body-dropdown');
    if (existing) existing.remove();

    // 2. Create the dropdown element
    const dropdown = document.createElement('div');
    dropdown.className = 'actions-dropdown-menu active-body-dropdown';
    
    // Get datasets
    const id = btn.dataset.id;
    const stuDataStr = btn.dataset.all;
    const progsDataStr = btn.dataset.progs;

    dropdown.innerHTML = `
        <button class="dropdown-item btn-view-stu" style="display:flex; align-items:center; gap:0.5rem; width:100%; border:none; background:transparent; padding:0.5rem 0.85rem; font-size:12px; font-weight:600; color:#475569; text-align:left; cursor:pointer;">
            👁️ View Programs
        </button>
        <button class="dropdown-item btn-edit-stu" style="display:flex; align-items:center; gap:0.5rem; width:100%; border:none; background:transparent; padding:0.5rem 0.85rem; font-size:12px; font-weight:600; color:#475569; text-align:left; cursor:pointer;">
            ✏️ Edit Student
        </button>
        <button class="dropdown-item btn-delete-stu text-danger" style="display:flex; align-items:center; gap:0.5rem; width:100%; border:none; background:transparent; padding:0.5rem 0.85rem; font-size:12px; font-weight:600; color:#dc2626; text-align:left; cursor:pointer;">
            🗑️ Delete Student
        </button>
    `;

    // 3. Append directly to body
    document.body.appendChild(dropdown);

    // 4. Position fixed menu dynamically to avoid clipping
    const rect = btn.getBoundingClientRect();
    const menuWidth = 150;
    const menuHeight = 110;

    let leftPos = rect.right - menuWidth;
    if (leftPos < 10) leftPos = 10;
    if (leftPos + menuWidth > window.innerWidth - 10) {
        leftPos = window.innerWidth - menuWidth - 10;
    }
    dropdown.style.left = `${leftPos}px`;

    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    if (spaceBelow < menuHeight + 15 && spaceAbove > spaceBelow) {
        let topPos = rect.top - menuHeight - 4;
        if (topPos < 10) topPos = 10;
        dropdown.style.top = `${topPos}px`;
        dropdown.classList.add('open-upward');
    } else {
        let topPos = rect.bottom + 4;
        if (topPos + menuHeight > window.innerHeight - 10) {
            topPos = window.innerHeight - menuHeight - 10;
        }
        if (topPos < 10) topPos = 10;
        dropdown.style.top = `${topPos}px`;
        dropdown.classList.remove('open-upward');
    }

    // Prevent clicks inside the dropdown from closing it unless an item is clicked
    dropdown.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // 5. Bind actions (always remove dropdown from body FIRST)
    dropdown.querySelector('.btn-view-stu').addEventListener('click', () => {
        dropdown.remove();
        const stu = JSON.parse(stuDataStr);
        openViewProgramsModal(stu);
    });

    dropdown.querySelector('.btn-edit-stu').addEventListener('click', () => {
        dropdown.remove();
        const stu = JSON.parse(stuDataStr);
        openEditModal(id, stu);
    });

    dropdown.querySelector('.btn-delete-stu').addEventListener('click', () => {
        dropdown.remove();
        deleteStudent(id);
    });
}
