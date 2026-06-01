import { db, updateDashboardMetadata, getCachedCategories, getCachedTeams, getCachedPrograms } from './firebase.js';
import {
    collection,
    addDoc,
    getDocs,
    getDoc,
    doc,
    deleteDoc,
    updateDoc,
    onSnapshot,
    serverTimestamp,
    writeBatch,
    query,
    where,
    collectionGroup,
    setDoc,
    increment
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
                <button class="btn btn-secondary" id="btnImportExcel" style="display:flex; align-items:center; gap:0.25rem;">📊 Import Excel</button>
                <button class="btn btn-primary" id="btnAddStudents">+ Student</button>
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

    // Single delegated click listener on container
    container.addEventListener('click', (e) => {
        const dotsBtn = e.target.closest('.student-dots-btn');
        if (dotsBtn) {
            e.stopPropagation();
            openStudentDropdown(dotsBtn);
            return;
        }

        const viewProgsBtn = e.target.closest('.btn-view-progs-direct');
        if (viewProgsBtn) {
            e.stopPropagation();
            const stuData = JSON.parse(viewProgsBtn.dataset.stu);
            openViewProgramsModal(stuData);
        }
    });

    // 1. Load Global Categories via Caching Layer
    try {
        const categoriesData = await getCachedCategories(window.currentInstituteId);
        allCategories = [];
        categoriesData.forEach(cat => {
            allCategories.push({ id: cat.id, ...cat, classes: normalizeClasses(cat.classes) });
            const opt = document.createElement('option');
            opt.value = cat.id;
            opt.textContent = cat.name;
            if (catSel) catSel.appendChild(opt);
        });
    } catch (e) { console.error("Error loading categories", e); }

    // 2. Load Teams & populate global teamMap via Caching Layer
    try {
        teamMap.clear();
        const teamsData = await getCachedTeams(window.currentInstituteId);
        teamsData.forEach(team => {
            teamMap.set(team.id, team.name);
            const opt = document.createElement('option');
            opt.value = team.id;
            opt.textContent = team.name;
            if (teamSel) teamSel.appendChild(opt);
        });
    } catch (e) { console.error("Error loading teams", e); }

    // 3. Load all Programs once via Caching Layer
    try {
        allPrograms = await getCachedPrograms(window.currentInstituteId);
    } catch (e) { console.error("Error loading programs", e); }

    if (catSel) {
        catSel.addEventListener('change', (e) => {
            currentCategoryId = e.target.value;
            currentClassId = null;
            if (classSel) {
                classSel.innerHTML = '<option value="">Select Class...</option>';
                classSel.disabled = true;
            }

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
        btnAddStudents.addEventListener('click', openAddStudentModal);
    }

    const btnImportExcel = document.getElementById('btnImportExcel');
    if (btnImportExcel) {
        btnImportExcel.addEventListener('click', openBulkImportModal);
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
                    <span class="student-programs-badge btn-view-progs-direct" data-stu='${JSON.stringify(stu).replace(/'/g, "&#39;")}' style="cursor:pointer; background:rgba(99, 102, 241, 0.08); color:#4f46e5; border:1px solid rgba(99, 102, 241, 0.15); display:inline-flex; align-items:center; gap:0.25rem;" title="Click to view registered programs">
                        👥 View Programs
                    </span>
                </div>
                <div class="student-actions-cell">
                    <div class="actions-dropdown-container">
                        <button class="btn-action-icon btn-action-more dots-btn student-dots-btn" data-id="${id}" data-all='${JSON.stringify(stu).replace(/'/g, "&#39;")}'>
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

async function openViewProgramsModal(stu) {
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');
    const modalOverlay = document.getElementById('dynamicModal');
    const closeHeaderBtn = document.getElementById('closeDynamicModalBtn');

    const teamName = teamMap.get(stu.teamId) || '—';

    modalTitle.textContent = '👁 View Student & Programs';
    
    // Render initial loading spinner inside modal
    modalBody.innerHTML = `
        <div style="text-align:center; padding:3rem; color:#4f46e5;">
            <div class="spinner" style="margin:0 auto 1rem; width:40px; height:40px; border:4px solid rgba(99,102,241,0.1); border-top-color:#4f46e5; border-radius:50%; animation:spin 1s linear infinite;"></div>
            <p style="color:#64748b; font-size:0.875rem; font-weight:600;">Retrieving registered programs...</p>
        </div>
        <div class="modal-actions" style="margin-top:1.5rem; border-top:1px solid #e2e8f0; padding-top:1rem; display:none;">
            <button class="btn btn-secondary w-full" id="closeViewModalBtn" style="min-height:38px; font-weight:700;">Close</button>
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

    // Bind Close Toggles immediately
    if (closeHeaderBtn) closeHeaderBtn.onclick = closeModal;
    modalOverlay.addEventListener('click', handleOverlayClick);
    document.addEventListener('keydown', handleEsc);

    // Disable background scrolling & show modal
    document.body.style.overflow = 'hidden';
    modalOverlay.classList.remove('hidden');

    let studentProgs = [];
    try {
        // Fetch all individual and group participant records for this team
        const q = query(
            collectionGroup(db, "participants"),
            where("teamId", "==", stu.teamId)
        );
        const snap = await getDocs(q);
        const teamParticipants = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Process student programs locally from teamParticipants
        teamParticipants.forEach(p => {
            const prog = allPrograms.find(pr => pr.id === p.programId);
            if (!prog) return;

            if (p.type === 'individual' && p.studentId === stu.id) {
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
            } else if (p.type === 'group' && Array.isArray(p.groups)) {
                p.groups.forEach(g => {
                    if (Array.isArray(g.members) && g.members.some(m => m.studentId === stu.id)) {
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
                });
            }
        });
    } catch (e) {
        console.error("Error fetching student programs on demand:", e);
    }

    // Deduplicate
    const seen = new Set();
    const uniqueProgs = [];
    for (const sp of studentProgs) {
        if (!seen.has(sp.id)) {
            seen.add(sp.id);
            uniqueProgs.push(sp);
        }
    }

    let studentProgsHTML = "";
    if (uniqueProgs.length === 0) {
        studentProgsHTML = `
            <div style="text-align:center; padding:2rem; background:#f8fafc; border:1px dashed #cbd5e1; border-radius:8px; color:#64748b; font-size:0.85rem; font-style:italic;">
                Not registered in any programs yet.
            </div>
        `;
    } else {
        studentProgsHTML = `
            <div style="display:flex; flex-direction:column; gap:0.6rem; max-height:260px; overflow-y:auto; padding-right:4px;">
                ${uniqueProgs.map((p) => {
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
                <div style="font-size:0.72rem; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:0.75rem;">REGISTERED PROGRAMS (${uniqueProgs.length})</div>
                ${studentProgsHTML}
            </div>

            <div class="modal-actions" style="margin-top:1.5rem; border-top:1px solid #e2e8f0; padding-top:1rem;">
                <button class="btn btn-secondary w-full" id="closeViewModalBtn" style="min-height:38px; font-weight:700;">Close</button>
            </div>
        </div>
    `;

    // Re-bind Close Button on newly rendered HTML
    const closeBtnEl = document.getElementById('closeViewModalBtn');
    if (closeBtnEl) closeBtnEl.onclick = closeModal;
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

        if (currentTeamId) {
            const teamRef = doc(db, "institutes", window.currentInstituteId, "teams", currentTeamId);
            batch.update(teamRef, { memberCount: increment(docs.length) });
        }

        await batch.commit();
        await updateDashboardMetadata(window.currentInstituteId);
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

function openAddStudentModal() {
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');
    const modalOverlay = document.getElementById('dynamicModal');

    modalTitle.textContent = '🎓 Add Student';
    modalBody.innerHTML = `
        <style>
        .student-form-grid {
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
        }
        .student-form-grid .form-row-1,
        .student-form-grid .form-row-2,
        .student-form-grid .form-row-3 {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 0.75rem;
        }
        @media (max-width: 600px) {
            .student-form-grid .form-row-1,
            .student-form-grid .form-row-2,
            .student-form-grid .form-row-3 {
                grid-template-columns: 1fr;
                gap: 0.75rem;
            }
        }
        </style>
        <form id="addStudentForm" style="font-family:'Inter', sans-serif; display:flex; flex-direction:column; gap:1rem;">
            <div class="student-form-grid">
                <!-- Row 1: Name & Gender -->
                <div class="form-row-1">
                    <div class="form-group" style="margin:0;">
                        <label class="form-label">Student Name *</label>
                        <input type="text" id="addStuName" class="form-input" required placeholder="Full Name">
                    </div>
                    <div class="form-group" style="margin:0;">
                        <label class="form-label">Gender *</label>
                        <select id="addStuGender" class="form-input" required>
                            <option value="">Select Gender...</option>
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                            <option value="Other">Other</option>
                        </select>
                    </div>
                </div>
                
                <!-- Row 2: Category & Class -->
                <div class="form-row-2">
                    <div class="form-group" style="margin:0;">
                        <label class="form-label">Category *</label>
                        <select id="addStuCategory" class="form-input" required>
                            <option value="">Select Category...</option>
                            ${allCategories.map(cat => `<option value="${cat.id}">${window.escapeHTML(cat.name)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group" style="margin:0;">
                        <label class="form-label">Class *</label>
                        <select id="addStuClass" class="form-input" required disabled>
                            <option value="">Select Class...</option>
                        </select>
                    </div>
                </div>

                <!-- Row 3: Team & Chest Number Preview -->
                <div class="form-row-3">
                    <div class="form-group" style="margin:0;">
                        <label class="form-label">Team *</label>
                        <select id="addStuTeam" class="form-input" required>
                            <option value="">Select Team...</option>
                            ${Array.from(teamMap.entries()).map(([id, name]) => `<option value="${id}">${window.escapeHTML(name)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group" style="margin:0;">
                        <label class="form-label">Chest Number Preview</label>
                        <div id="addStuChestPreview" style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; padding:0.5rem 0.75rem; font-size:0.9rem; font-weight:700; color:#475569; min-height:36px; display:flex; align-items:center;">
                            Select category to preview...
                        </div>
                    </div>
                </div>
            </div>
            
            <div style="font-size:0.72rem; color:#64748b; background:#f0f9ff; border:1px solid #bae6fd; border-radius:6px; padding:0.5rem 0.75rem; line-height:1.4;">
                ℹ️ Chest Number will be generated automatically based on the selected category.
            </div>

            <div class="modal-actions" style="margin-top:0.5rem;">
                <button type="button" class="btn btn-secondary" id="cancelAddStuBtn">Cancel</button>
                <button type="submit" class="btn btn-primary" id="saveAddStuBtn">
                    <span class="btn-text">💾 Save Student</span>
                    <span class="btn-spinner hidden"></span>
                </button>
            </div>
        </form>
    `;

    modalOverlay.classList.remove('hidden');

    const form = document.getElementById('addStudentForm');
    const catSelect = document.getElementById('addStuCategory');
    const classSelect = document.getElementById('addStuClass');
    const previewEl = document.getElementById('addStuChestPreview');
    const cancelBtn = document.getElementById('cancelAddStuBtn');
    const saveBtn = document.getElementById('saveAddStuBtn');

    cancelBtn.onclick = () => modalOverlay.classList.add('hidden');

    function updateClassDropdownAndPreview() {
        const catId = catSelect.value;
        classSelect.innerHTML = '<option value="">Select Class...</option>';
        classSelect.disabled = true;
        previewEl.innerHTML = 'Select category to preview...';

        if (!catId) return;

        const cat = allCategories.find(c => c.id === catId);
        if (cat) {
            // Populate classes
            if (Array.isArray(cat.classes)) {
                cat.classes.forEach(cls => {
                    const opt = document.createElement('option');
                    opt.value = cls.id;
                    opt.textContent = cls.name;
                    classSelect.appendChild(opt);
                });
                classSelect.disabled = false;
            }

            // Calculate next chest preview with self-healing skip logic
            const chestStart = parseInt(cat.chestStart, 10);
            const chestEnd = parseInt(cat.chestEnd, 10);
            let nextChest = parseInt(cat.nextChestNumber || chestStart, 10);

            if (isNaN(chestStart) || isNaN(chestEnd)) {
                previewEl.innerHTML = `<span style="color:#ef4444; font-size:0.8rem;">Invalid range in Category Settings</span>`;
                return;
            }

            let assignedChest = null;
            while (nextChest <= chestEnd) {
                const chestStr = nextChest.toString();
                const isTaken = localStudentsAll.some(s => s.chestNumber === chestStr);
                if (!isTaken) {
                    assignedChest = chestStr;
                    break;
                }
                nextChest++;
            }

            if (assignedChest) {
                previewEl.innerHTML = `Next Available: <span style="color:#4f46e5; margin-left:0.25rem;">#${assignedChest}</span>`;
            } else {
                previewEl.innerHTML = `<span style="color:#ef4444; font-size:0.8rem;">No available chest numbers remaining</span>`;
            }
        }
    }

    // Pre-populate if category/class/team are selected in main filter
    if (currentCategoryId) {
        catSelect.value = currentCategoryId;
        updateClassDropdownAndPreview();
    }
    if (currentClassId && currentCategoryId) {
        classSelect.value = currentClassId;
    }
    if (currentTeamId) {
        document.getElementById('addStuTeam').value = currentTeamId;
    }

    catSelect.addEventListener('change', updateClassDropdownAndPreview);

    form.onsubmit = async (e) => {
        e.preventDefault();
        
        const name = document.getElementById('addStuName').value.trim();
        const gender = document.getElementById('addStuGender').value;
        const catId = catSelect.value;
        const classId = classSelect.value;
        const teamId = document.getElementById('addStuTeam').value;

        if (!name || !gender || !catId || !classId || !teamId) {
            window.showToast("Please fill in all required fields.", "error");
            return;
        }

        saveBtn.disabled = true;
        saveBtn.querySelector('.btn-text').classList.add('hidden');
        saveBtn.querySelector('.btn-spinner').classList.remove('hidden');

        try {
            // Fetch fresh category document
            const catRef = doc(db, "institutes", window.currentInstituteId, "categories", catId);
            const catSnap = await getDoc(catRef);
            if (!catSnap.exists()) {
                window.showToast("Selected Category does not exist.", "error");
                saveBtn.disabled = false;
                saveBtn.querySelector('.btn-text').classList.remove('hidden');
                saveBtn.querySelector('.btn-spinner').classList.add('hidden');
                return;
            }

            const catData = catSnap.data();
            const chestStart = parseInt(catData.chestStart, 10);
            const chestEnd = parseInt(catData.chestEnd, 10);
            let nextChest = parseInt(catData.nextChestNumber || chestStart, 10);

            if (isNaN(chestStart) || isNaN(chestEnd)) {
                window.showToast("Category chest range is not configured properly in Category Settings.", "error");
                saveBtn.disabled = false;
                saveBtn.querySelector('.btn-text').classList.remove('hidden');
                saveBtn.querySelector('.btn-spinner').classList.add('hidden');
                return;
            }

            // Pre-allocate chest number with self-healing skip logic
            let assignedChest = null;
            while (nextChest <= chestEnd) {
                const chestStr = nextChest.toString();
                const isTaken = localStudentsAll.some(s => s.chestNumber === chestStr);
                if (!isTaken) {
                    assignedChest = chestStr;
                    nextChest++;
                    break;
                }
                nextChest++;
            }

            if (!assignedChest) {
                window.showToast("No available chest numbers remaining for this category.", "error");
                saveBtn.disabled = false;
                saveBtn.querySelector('.btn-text').classList.remove('hidden');
                saveBtn.querySelector('.btn-spinner').classList.add('hidden');
                return;
            }

            const batch = writeBatch(db);
            const colRef = collection(db, "institutes", window.currentInstituteId, "students");
            const newDocRef = doc(colRef);

            const catObj = allCategories.find(c => c.id === catId);
            const clsObj = catObj?.classes.find(c => c.id === classId);
            
            batch.set(newDocRef, {
                chestNumber: assignedChest,
                name: name,
                gender: gender,
                categoryId: catId,
                categoryName: catObj?.name || '',
                classId: classId,
                className: clsObj?.name || '',
                teamId: teamId,
                createdAt: serverTimestamp()
            });

            // Commit the updated nextChestNumber on the Category doc
            batch.update(catRef, {
                nextChestNumber: nextChest,
                updatedAt: serverTimestamp()
            });

            if (teamId) {
                const teamRef = doc(db, "institutes", window.currentInstituteId, "teams", teamId);
                batch.update(teamRef, { memberCount: increment(1) });
            }

            await batch.commit();
            await updateDashboardMetadata(window.currentInstituteId);
            window.showToast(`Student ${name} successfully enrolled with Chest No #${assignedChest}!`, "success");
            modalOverlay.classList.add('hidden');
        } catch (err) {
            console.error("Error creating student:", err);
            window.showToast("Failed to create student.", "error");
        } finally {
            saveBtn.disabled = false;
            saveBtn.querySelector('.btn-text').classList.remove('hidden');
            saveBtn.querySelector('.btn-spinner').classList.add('hidden');
        }
    };
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
                        <th style="text-align:left; padding:0.5rem 0.4rem; color:#64748b; font-weight:600;">Student Name</th>
                        <th style="text-align:left; padding:0.5rem 0.4rem; color:#64748b; font-weight:600; width:150px;">Gender</th>
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
            const name = row.querySelector('.s-name').value.trim();
            const gender = row.querySelector('.s-gender').value;
            if (name) students.push({ name, gender });
        });

        if (students.length === 0) return window.showToast("Fill in at least one student.", "error");

        const btn = document.getElementById('saveBulkBtn');
        btn.disabled = true;

        try {
            // Fetch fresh category state
            const catRef = doc(db, "institutes", window.currentInstituteId, "categories", currentCategoryId);
            const catSnap = await getDoc(catRef);
            if (!catSnap.exists()) {
                window.showToast("Category not found.", "error");
                btn.disabled = false;
                return;
            }
            const catData = catSnap.data();
            const chestStart = parseInt(catData.chestStart, 10);
            const chestEnd = parseInt(catData.chestEnd, 10);
            let nextChest = parseInt(catData.nextChestNumber || chestStart, 10);

            if (isNaN(chestStart) || isNaN(chestEnd)) {
                window.showToast("Category chest range is not configured properly in Category Settings.", "error");
                btn.disabled = false;
                return;
            }

            // Pre-allocate chest numbers with self-healing skip logic
            const allocatedStudents = [];
            for (const stu of students) {
                let assignedChest = null;
                while (nextChest <= chestEnd) {
                    const chestStr = nextChest.toString();
                    const isTaken = localStudentsAll.some(s => s.chestNumber === chestStr);
                    if (!isTaken) {
                        assignedChest = chestStr;
                        nextChest++;
                        break;
                    }
                    nextChest++;
                }

                if (!assignedChest) {
                    window.showToast("Chest number limit reached for this category. Please extend the range in Category Settings.", "error");
                    btn.disabled = false;
                    return;
                }

                allocatedStudents.push({
                    ...stu,
                    chestNumber: assignedChest
                });
            }

            const batch = writeBatch(db);
            const colRef = collection(db, "institutes", window.currentInstituteId, "students");
            allocatedStudents.forEach(stu => {
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

            // Commit the updated nextChestNumber on the Category doc
            batch.update(catRef, {
                nextChestNumber: nextChest,
                updatedAt: serverTimestamp()
            });

            if (currentTeamId) {
                const teamRef = doc(db, "institutes", window.currentInstituteId, "teams", currentTeamId);
                batch.update(teamRef, { memberCount: increment(students.length) });
            }

            await batch.commit();
            await updateDashboardMetadata(window.currentInstituteId);
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
                <label class="form-label">Chest Number (Read Only)</label>
                <input type="text" id="eChest" class="form-input" disabled readonly style="background:#f1f5f9; cursor:not-allowed; font-weight:700; color:#334155;" value="#${window.escapeHTML(data.chestNumber || '—')}">
                <p style="font-size:0.72rem; color:#94a3b8; margin-top:0.25rem;">Chest number is allocated automatically and cannot be changed.</p>
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
                name: document.getElementById('eName').value.trim(),
                gender: document.getElementById('eGender').value,
                updatedAt: serverTimestamp()
            });
            await updateDashboardMetadata(window.currentInstituteId);
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
    if (!confirm("Delete this student? This will also remove them from all program registrations.")) return;
    try {
        const instId = window.currentInstituteId;
        const student = localStudentsAll.find(s => s.id === stuId);
        const teamId = student?.teamId || '';

        const batch = writeBatch(db);

        // ── 1. Individual participant registrations ──────────────────────
        // Use collectionGroup to find every participant doc with studentId == stuId
        const programCountDeltas = new Map(); // programId -> count change

        const indivSnap = await getDocs(query(
            collectionGroup(db, "participants"),
            where("studentId", "==", stuId),
            where("type", "==", "individual")
        ));
        indivSnap.forEach(d => {
            const data = d.data();
            batch.delete(d.ref);
            if (data.programId) {
                programCountDeltas.set(
                    data.programId,
                    (programCountDeltas.get(data.programId) || 0) - 1
                );
            }
        });

        // ── 2. Group participant docs ─────────────────────────────────────
        // Groups embed student data as groups[].members[] arrays.
        // Query by teamId to scope the search, then filter programmatically.
        if (teamId) {
            const groupSnap = await getDocs(query(
                collectionGroup(db, "participants"),
                where("type", "==", "group"),
                where("teamId", "==", teamId)
            ));
            groupSnap.forEach(d => {
                const data = d.data();
                const groups = Array.isArray(data.groups) ? data.groups : [];
                const studentInGroup = groups.some(g =>
                    Array.isArray(g.members) && g.members.some(m => m.studentId === stuId)
                );
                if (studentInGroup) {
                    const updatedGroups = groups.map(g => ({
                        ...g,
                        members: (g.members || []).filter(m => m.studentId !== stuId)
                    }));
                    batch.update(d.ref, { groups: updatedGroups });
                }
            });
        }

        // ── 3. Decrement participantCount on every affected program ───────
        for (const [programId, delta] of programCountDeltas) {
            const progRef = doc(db, "institutes", instId, "programs", programId);
            batch.update(progRef, { participantCount: increment(delta) });
        }

        // ── 4. Delete the student document ───────────────────────────────
        batch.delete(doc(db, "institutes", instId, "students", stuId));

        // ── 5. Decrement team memberCount ─────────────────────────────────
        if (teamId) {
            const teamRef = doc(db, "institutes", instId, "teams", teamId);
            batch.update(teamRef, { memberCount: increment(-1) });
        }

        await batch.commit();
        await updateDashboardMetadata(instId);
        window.showToast("Student deleted and all registrations removed.");
    } catch (e) {
        console.error(e);
        window.showToast("Delete failed", "error");
    }
}

// ─────────────────────────────────────────────
// Excel Import System
// ─────────────────────────────────────────────

async function openBulkImportModal() {
    if (typeof XLSX === 'undefined') {
        window.showToast("Loading Excel importer engine...", "info");
        try {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        } catch (err) {
            console.error("Failed to load SheetJS:", err);
            window.showToast("Failed to load Excel parsing engine. Please check internet connection.", "error");
            return;
        }
    }

    const modal = document.getElementById('dynamicModal');
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');

    modalTitle.textContent = "📊 Import Students from Excel";
    modalBody.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:1.25rem; padding:0.25rem;">
            <p style="font-size:0.85rem; color:#475569; margin:0; line-height:1.5;">
                Upload student profiles directly from an Excel spreadsheet. You can import students belonging to different categories, classes, and teams simultaneously.
            </p>

            <!-- Template download and file input -->
            <div style="display:flex; flex-direction:column; gap:0.75rem; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:1rem;">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
                    <span style="font-size:0.8rem; font-weight:700; color:#475569;">1. Need a template?</span>
                    <button class="btn btn-secondary btn-sm" id="btnDownloadTemplate" style="font-size:0.75rem;">📥 Download Sample Template</button>
                </div>
                <div style="border-top:1px solid #e2e8f0; padding-top:0.75rem; margin-top:0.25rem; display:flex; flex-direction:column; gap:0.5rem;">
                    <label style="font-size:0.8rem; font-weight:700; color:#475569;">2. Select Excel File (.xlsx, .xls) *</label>
                    <input type="file" id="excelFileInput" accept=".xlsx, .xls" class="form-input" style="padding:0.4rem;" />
                    <span style="font-size:0.7rem; color:#64748b;">Maximum file size: 10 MB.</span>
                </div>
            </div>

            <div style="display:flex; gap:0.5rem; justify-content:flex-end;">
                <button class="btn btn-secondary" id="btnImportCancel">Cancel</button>
                <button class="btn btn-primary" id="btnImportNext" disabled>Next: Preview ➔</button>
            </div>
        </div>
    `;

    modal.classList.remove('hidden');
    document.getElementById('closeDynamicModalBtn').onclick = () => modal.classList.add('hidden');
    document.getElementById('btnImportCancel').onclick = () => modal.classList.add('hidden');

    document.getElementById('btnDownloadTemplate').onclick = () => {
        try {
            const headers = ["Chest No", "Student Name", "Gender", "Category", "Class", "Team"];
            
            const firstCategory = allCategories[0];
            const firstClass = firstCategory?.classes[0]?.name || "10";
            const firstTeam = Array.from(teamMap.values())[0] || "Team A";
            const secondTeam = Array.from(teamMap.values())[1] || "Team B";

            const sampleRows = [
                ["101", "Ahmed", "Male", firstCategory?.name || "Senior Boys", firstClass, firstTeam],
                ["102", "Afsal", "Male", firstCategory?.name || "Senior Boys", firstClass, firstTeam],
                ["103", "Nihad", "Male", firstCategory?.name || "Senior Boys", firstClass, secondTeam]
            ];

            const ws_data = [headers, ...sampleRows];
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet(ws_data);
            XLSX.utils.book_append_sheet(wb, ws, "Students");
            
            XLSX.writeFile(wb, "Student_Import_Template.xlsx");
        } catch (err) {
            console.error("Template generation failed:", err);
            window.showToast("Failed to generate Excel template.", "error");
        }
    };

    const fileInput = document.getElementById('excelFileInput');
    const btnNext = document.getElementById('btnImportNext');

    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            if (file.size > 10 * 1024 * 1024) {
                window.showToast("File size exceeds 10 MB limit.", "error");
                fileInput.value = '';
                btnNext.disabled = true;
                return;
            }
            btnNext.disabled = false;
        } else {
            btnNext.disabled = true;
        }
    };

    btnNext.onclick = () => {
        const file = fileInput.files[0];
        if (!file) return;

        btnNext.disabled = true;
        btnNext.innerHTML = `Parsing... <div class="spinner-sm" style="display:inline-block; vertical-align:middle; width:12px; height:12px; border:2px solid #fff; border-top-color:transparent; border-radius:50%; animation:spin 0.6s linear infinite; margin-left:0.35rem;"></div>`;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                
                const jsonRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
                if (jsonRows.length === 0) {
                    window.showToast("The selected Excel file is empty.", "error");
                    btnNext.disabled = false;
                    btnNext.textContent = "Next: Preview ➔";
                    return;
                }

                const headers = jsonRows[0].map(h => (h || '').toString().trim());
                const requiredHeaders = ["Student Name", "Gender", "Category", "Class"];
                const headerIndices = {};
                
                requiredHeaders.forEach(req => {
                    headerIndices[req] = headers.findIndex(h => h.toLowerCase() === req.toLowerCase());
                });
                headerIndices["Chest No"] = headers.findIndex(h => h.toLowerCase() === "chest no");
                headerIndices["Team"] = headers.findIndex(h => h.toLowerCase() === "team");

                const missingHeaders = requiredHeaders.filter(req => headerIndices[req] === -1);
                if (missingHeaders.length > 0) {
                    window.showToast(`Missing required columns: ${missingHeaders.join(', ')}`, "error");
                    btnNext.disabled = false;
                    btnNext.textContent = "Next: Preview ➔";
                    return;
                }

                const rows = jsonRows.slice(1);
                const validList = [];
                const invalidList = [];
                const duplicateList = [];
                const sheetChestNumbers = new Set();

                rows.forEach((row, idx) => {
                    const rowNum = idx + 2; 
                    
                    const isEmpty = row.every(val => (val === undefined || val === null || val.toString().trim() === ''));
                    if (isEmpty) return;

                    const chestRaw = headerIndices["Chest No"] !== -1 ? row[headerIndices["Chest No"]] : '';
                    const nameRaw = row[headerIndices["Student Name"]];
                    const genderRaw = row[headerIndices["Gender"]];
                    const categoryRaw = row[headerIndices["Category"]];
                    const classRaw = row[headerIndices["Class"]];
                    const teamRaw = headerIndices["Team"] !== -1 ? row[headerIndices["Team"]] : '';

                    const chestNumber = (chestRaw || '').toString().trim().toUpperCase();
                    const name = (nameRaw || '').toString().trim();
                    const gender = (genderRaw || '').toString().trim();
                    const categoryName = (categoryRaw || '').toString().trim();
                    const className = (classRaw || '').toString().trim();
                    const teamName = (teamRaw || '').toString().trim();

                    const errors = [];

                    if (!name) errors.push("Missing Student Name");

                    let normalizedGender = 'Other';
                    if (gender) {
                        const gLower = gender.toLowerCase().trim();
                        if (gLower === 'male' || gLower === 'm') normalizedGender = 'Male';
                        else if (gLower === 'female' || gLower === 'f') normalizedGender = 'Female';
                        else if (gLower === 'other' || gLower === 'o') normalizedGender = 'Other';
                        else errors.push(`Invalid Gender "${gender}"`);
                    } else {
                        errors.push("Missing Gender");
                    }

                    let matchedCategory = null;
                    if (categoryName) {
                        matchedCategory = allCategories.find(c => c.name.toLowerCase().trim() === categoryName.toLowerCase().trim());
                        if (!matchedCategory) {
                            errors.push(`Category "${categoryName}" does not exist`);
                        }
                    } else {
                        errors.push("Missing Category");
                    }

                    let matchedClass = null;
                    if (className && matchedCategory) {
                        matchedClass = matchedCategory.classes.find(cls => cls.name.toLowerCase().trim() === className.toLowerCase().trim());
                        if (!matchedClass) {
                            errors.push(`Class "${className}" is invalid for category "${matchedCategory.name}"`);
                        }
                    } else if (!className) {
                        errors.push("Missing Class");
                    }

                    let matchedTeamId = '';
                    if (teamName) {
                        const matchedTeamEntry = Array.from(teamMap.entries()).find(([id, name]) => name.toLowerCase().trim() === teamName.toLowerCase().trim());
                        if (matchedTeamEntry) {
                            matchedTeamId = matchedTeamEntry[0];
                        } else {
                            errors.push(`Team "${teamName}" does not exist`);
                        }
                    }

                    if (chestNumber && matchedCategory) {
                        const chestInt = parseInt(chestNumber, 10);
                        const cStart = parseInt(matchedCategory.chestStart, 10);
                        const cEnd = parseInt(matchedCategory.chestEnd, 10);
                        if (isNaN(chestInt)) {
                            errors.push(`Chest No "${chestNumber}" must be a valid integer`);
                        } else if (isNaN(cStart) || isNaN(cEnd)) {
                            errors.push(`Category "${matchedCategory.name}" chest range bounds are not configured`);
                        } else if (chestInt < cStart || chestInt > cEnd) {
                            errors.push(`Chest No "${chestNumber}" is out of range (${cStart}–${cEnd}) for Category "${matchedCategory.name}"`);
                        }
                    }

                    let isDuplicateInSheet = false;
                    if (chestNumber) {
                        if (sheetChestNumbers.has(chestNumber)) {
                            errors.push(`Duplicate Chest No "${chestNumber}" in Excel`);
                            isDuplicateInSheet = true;
                        } else {
                            sheetChestNumbers.add(chestNumber);
                        }
                    }

                    const isDuplicateInDb = chestNumber && localStudentsAll.some(s => s.chestNumber === chestNumber);

                    const studentObj = {
                        rowNumber: rowNum,
                        chestNumber,
                        name,
                        gender: normalizedGender,
                        categoryId: matchedCategory ? matchedCategory.id : '',
                        categoryName: matchedCategory ? matchedCategory.name : '',
                        classId: matchedClass ? matchedClass.id : '',
                        className: matchedClass ? matchedClass.name : '',
                        teamId: matchedTeamId,
                        teamName: teamName || '',
                        isDuplicateInDb,
                        isDuplicateInSheet,
                        errors
                    };

                    if (errors.length > 0) {
                        invalidList.push(studentObj);
                    } else if (isDuplicateInDb) {
                        duplicateList.push(studentObj);
                    } else {
                        validList.push(studentObj);
                    }
                });

                showPreviewScreen(validList, invalidList, duplicateList);

            } catch (err) {
                console.error("Spreadsheet parse failed:", err);
                window.showToast("Failed to parse the Excel file.", "error");
                btnNext.disabled = false;
                btnNext.textContent = "Next: Preview ➔";
            }
        };
        reader.readAsArrayBuffer(file);
    };
}

function showPreviewScreen(validList, invalidList, duplicateList) {
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');

    const totalRows = validList.length + invalidList.length + duplicateList.length;

    modalTitle.textContent = "📋 Import Preview & Approval";

    let errorsHTML = '';
    if (invalidList.length > 0) {
        errorsHTML = `
            <div style="background:#fff1f2; border:1px solid #fecdd3; border-radius:10px; padding:0.85rem; margin-bottom:0.75rem;">
                <h4 style="margin:0 0 0.4rem 0; color:#9f1239; font-size:0.85rem; font-weight:800; display:flex; align-items:center; gap:0.35rem;">
                    ⚠️ Errors Found in ${invalidList.length} Rows
                </h4>
                <div style="max-height:100px; overflow-y:auto; font-size:0.75rem; color:#be123c; display:flex; flex-direction:column; gap:0.2rem;">
                    ${invalidList.map(item => `
                        <div>Row <strong>${item.rowNumber}</strong> (Name: ${window.escapeHTML(item.name || 'Unknown')}): ${item.errors.join(' · ')}</div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    let duplicatesHTML = '';
    if (duplicateList.length > 0) {
        duplicatesHTML = `
            <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:10px; padding:0.85rem; margin-bottom:0.75rem;">
                <h4 style="margin:0 0 0.4rem 0; color:#b45309; font-size:0.85rem; font-weight:800; display:flex; align-items:center; gap:0.35rem;">
                    👤 Duplicate Chest Numbers (${duplicateList.length} Rows)
                </h4>
                <p style="font-size:0.75rem; color:#92400e; margin:0 0 0.6rem 0; line-height:1.4;">
                    These chest numbers already exist in the database. Choose duplicate handling logic:
                </p>
                <div style="display:flex; flex-direction:column; gap:0.4rem; font-size:0.8rem; color:#78350f;">
                    <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; font-weight:700;">
                        <input type="radio" name="dupAction" value="skip" checked style="width:1.1rem; height:1.1rem; cursor:pointer;" />
                        Skip Duplicates (Safest - ignores duplicates)
                    </label>
                    <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; font-weight:700;">
                        <input type="radio" name="dupAction" value="overwrite" style="width:1.1rem; height:1.1rem; cursor:pointer;" />
                        Overwrite Existing Profiles (Preserves program registrations)
                    </label>
                </div>
                <div style="max-height:80px; overflow-y:auto; font-size:0.75rem; color:#92400e; display:flex; flex-direction:column; gap:0.2rem; margin-top:0.5rem; border-top:1px solid #fef3c7; padding-top:0.4rem;">
                    ${duplicateList.map(item => `
                        <div>Row <strong>${item.rowNumber}</strong>: Chest No <strong>${item.chestNumber}</strong> (${window.escapeHTML(item.name)})</div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    modalBody.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:1rem; padding:0.25rem;">
            <!-- Statistics Cards -->
            <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:0.4rem; text-align:center;">
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:0.5rem 0.25rem;">
                    <div style="font-size:1.1rem; font-weight:800; color:#334155;">${totalRows}</div>
                    <div style="font-size:0.6rem; font-weight:700; color:#64748b; text-transform:uppercase; margin-top:0.15rem;">Total Rows</div>
                </div>
                <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:0.5rem 0.25rem;">
                    <div style="font-size:1.1rem; font-weight:800; color:#166534;">${validList.length}</div>
                    <div style="font-size:0.6rem; font-weight:700; color:#15803d; text-transform:uppercase; margin-top:0.15rem;">To Import</div>
                </div>
                <div style="background:#fff1f2; border:1px solid #fecdd3; border-radius:8px; padding:0.5rem 0.25rem;">
                    <div style="font-size:1.1rem; font-weight:800; color:#9f1239;">${invalidList.length}</div>
                    <div style="font-size:0.6rem; font-weight:700; color:#9e1239; text-transform:uppercase; margin-top:0.15rem;">Invalid</div>
                </div>
                <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:0.5rem 0.25rem;">
                    <div style="font-size:1.1rem; font-weight:800; color:#92400e;">${duplicateList.length}</div>
                    <div style="font-size:0.6rem; font-weight:700; color:#b45309; text-transform:uppercase; margin-top:0.15rem;">Duplicates</div>
                </div>
            </div>

            ${errorsHTML}
            ${duplicatesHTML}

            <!-- Valid items preview list -->
            <div>
                <div style="font-size:0.75rem; font-weight:700; color:#64748b; text-transform:uppercase; margin-bottom:0.4rem;">Students to Enroll (${validList.length})</div>
                <div style="max-height:160px; overflow-y:auto; border:1px solid #cbd5e1; border-radius:8px; padding:0.25rem; background:#fff; font-size:0.8rem;">
                    ${validList.length > 0 
                        ? `<table style="width:100%; border-collapse:collapse;">
                            <thead style="position:sticky; top:0; background:#f1f5f9; font-weight:700; z-index:10;">
                                <tr style="border-bottom:1px solid #e2e8f0; text-align:left;">
                                    <th style="padding:0.4rem;">Chest</th>
                                    <th style="padding:0.4rem;">Name</th>
                                    <th style="padding:0.4rem;">Category / Class</th>
                                    <th style="padding:0.4rem;">Team</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${validList.map(item => `
                                    <tr style="border-bottom:1px solid #f1f5f9;">
                                        <td style="padding:0.35rem; font-weight:700; color:#1e1b4b;">${item.chestNumber || '<span style="color:#6366f1; font-style:italic; font-size:0.75rem;">(Auto)</span>'}</td>
                                        <td style="padding:0.35rem; color:#0f172a;">${window.escapeHTML(item.name)}</td>
                                        <td style="padding:0.35rem; color:#475569;">${window.escapeHTML(item.categoryName)} / ${window.escapeHTML(item.className)}</td>
                                        <td style="padding:0.35rem; color:#475569;">${window.escapeHTML(item.teamName || '—')}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                           </table>`
                        : '<div style="font-size:0.8rem; color:#94a3b8; text-align:center; padding:1.5rem 0;">No clean rows to import</div>'
                    }
                </div>
            </div>

            <!-- Warning Banner -->
            ${validList.length > 0 ? `
            <div style="font-size:0.72rem; color:#475569; background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:0.6rem 0.85rem; line-height:1.4;">
                ℹ️ <strong>Import Notice:</strong> The import will run in background chunks to avoid performance lockup. Please do not close the browser tab until completion.
            </div>
            ` : ''}

            <!-- Action buttons -->
            <div style="display:flex; gap:0.5rem; justify-content:flex-end; border-top:1px solid #e2e8f0; padding-top:1rem; margin-top:0.25rem;">
                <button class="btn btn-secondary" id="btnPreviewBack">Back</button>
                <button class="btn btn-primary" id="btnImportCommit" ${validList.length === 0 && duplicateList.length === 0 ? 'disabled' : ''}>
                    🚀 Commit & Import (${validList.length})
                </button>
            </div>
        </div>
    `;

    document.getElementById('btnPreviewBack').onclick = () => {
        openBulkImportModal();
    };

    const btnCommit = document.getElementById('btnImportCommit');
    if (btnCommit) {
        btnCommit.onclick = () => {
            const dupRadios = document.getElementsByName('dupAction');
            let duplicateAction = 'skip';
            dupRadios.forEach(r => {
                if (r.checked) duplicateAction = r.value;
            });

            executeImportProcess(validList, duplicateList, duplicateAction);
        };
    }
}

async function executeImportProcess(validList, duplicateList, duplicateAction) {
    const modal = document.getElementById('dynamicModal');
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');

    const importQueue = [...validList];
    if (duplicateAction === 'overwrite') {
        importQueue.push(...duplicateList);
    }

    if (importQueue.length === 0) {
        window.showToast("No students to import.", "error");
        return;
    }

    modalTitle.textContent = "⚙️ Executing Excel Import";
    modalBody.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:1.25rem; padding:0.5rem; text-align:center;">
            <div style="font-size:2.5rem; margin-top:0.5rem;">⚡</div>
            <h4 style="margin:0; font-weight:800; font-size:1.05rem; color:#0f172a;" id="importProgressTitle">Importing Students...</h4>
            <p style="font-size:0.8rem; color:#64748b; line-height:1.4; margin:0;" id="importProgressDesc">
                Processing records in chunked database batches. Please wait.
            </p>

            <!-- Progress bar -->
            <div style="width:100%; height:12px; background:#e2e8f0; border-radius:99px; overflow:hidden; position:relative; margin:0.5rem 0;">
                <div id="importProgressBar" style="width:0%; height:100%; background:#4338ca; border-radius:99px; transition:width 0.25s;"></div>
            </div>
            <div style="font-size:0.75rem; font-weight:700; color:#4338ca;" id="importProgressPercent">0% Complete</div>
        </div>
    `;

    const chunkSize = 150;
    const totalStudents = importQueue.length;
    const totalChunks = Math.ceil(totalStudents / chunkSize);
    const importBatchId = `xlsx_import_${Date.now()}`;
    const importedAt = serverTimestamp();

    const failedRows = [];

    for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
        const start = chunkIdx * chunkSize;
        const end = Math.min(start + chunkSize, totalStudents);
        const chunk = importQueue.slice(start, end);

        const progress = Math.round((start / totalStudents) * 100);
        document.getElementById('importProgressBar').style.width = `${progress}%`;
        document.getElementById('importProgressPercent').textContent = `${progress}% Complete`;
        document.getElementById('importProgressTitle').textContent = `Processing Batch ${chunkIdx + 1} of ${totalChunks}...`;
        document.getElementById('importProgressDesc').textContent = `Writing rows ${start + 1} to ${end} of ${totalStudents}.`;

        const batch = writeBatch(db);
        const colRef = collection(db, "institutes", window.currentInstituteId, "students");
        const teamDiffs = new Map();

        // 1. Identify which categories are used in this chunk and have missing chest numbers
        const referencedCategoryIds = new Set();
        chunk.forEach(stu => {
            if (!stu.chestNumber && stu.categoryId) {
                referencedCategoryIds.add(stu.categoryId);
            }
        });

        // 2. Fetch fresh category document states
        const categoryDataMap = new Map();
        for (const catId of referencedCategoryIds) {
            try {
                const catRef = doc(db, "institutes", window.currentInstituteId, "categories", catId);
                const catSnap = await getDoc(catRef);
                if (catSnap.exists()) {
                    categoryDataMap.set(catId, { ref: catRef, ...catSnap.data() });
                }
            } catch (err) {
                console.error("Error fetching category for import allocation:", err);
            }
        }

        // 3. Keep track of newly allocated chest numbers in this specific batch to avoid duplicates
        const allocatedInThisBatch = new Set();

        for (const stu of chunk) {
            let chestNumber = stu.chestNumber;

            if (!chestNumber) {
                // Auto-allocate Option A
                const catInfo = categoryDataMap.get(stu.categoryId);
                if (!catInfo) {
                    stu.errors = stu.errors || [];
                    stu.errors.push("Category configuration not found.");
                    failedRows.push(stu);
                    continue;
                }

                const chestStart = parseInt(catInfo.chestStart, 10);
                const chestEnd = parseInt(catInfo.chestEnd, 10);
                let nextChest = parseInt(catInfo.nextChestNumber || chestStart, 10);

                if (isNaN(chestStart) || isNaN(chestEnd)) {
                    stu.errors = stu.errors || [];
                    stu.errors.push("Category chest range is invalid.");
                    failedRows.push(stu);
                    continue;
                }

                let assignedChest = null;
                while (nextChest <= chestEnd) {
                    const chestStr = nextChest.toString();
                    const isTakenInDb = localStudentsAll.some(s => s.chestNumber === chestStr);
                    const isTakenInBatch = allocatedInThisBatch.has(chestStr);
                    if (!isTakenInDb && !isTakenInBatch) {
                        assignedChest = chestStr;
                        allocatedInThisBatch.add(chestStr);
                        nextChest++;
                        break;
                    }
                    nextChest++;
                }

                if (!assignedChest) {
                    stu.errors = stu.errors || [];
                    stu.errors.push("Chest range limit reached for category.");
                    failedRows.push(stu);
                    continue;
                }

                chestNumber = assignedChest;
                // Update nextChestNumber in our local map object so the next student gets the next available number
                catInfo.nextChestNumber = nextChest;
            }

            const isOverwrite = stu.isDuplicateInDb;
            const existingStu = isOverwrite ? localStudentsAll.find(s => s.chestNumber === chestNumber) : null;
            
            const payload = {
                chestNumber: chestNumber,
                name: stu.name,
                gender: stu.gender,
                categoryId: stu.categoryId,
                categoryName: stu.categoryName,
                classId: stu.classId,
                className: stu.className,
                teamId: stu.teamId,
                importBatchId,
                updatedAt: importedAt
            };

            if (isOverwrite && existingStu) {
                const docRef = doc(db, "institutes", window.currentInstituteId, "students", existingStu.id);
                batch.update(docRef, payload);

                const oldTeamId = existingStu.teamId || '';
                const newTeamId = stu.teamId || '';
                if (oldTeamId !== newTeamId) {
                    if (oldTeamId) teamDiffs.set(oldTeamId, (teamDiffs.get(oldTeamId) || 0) - 1);
                    if (newTeamId) teamDiffs.set(newTeamId, (teamDiffs.get(newTeamId) || 0) + 1);
                }
            } else {
                payload.createdAt = importedAt;
                const newDocRef = doc(colRef);
                batch.set(newDocRef, payload);

                if (stu.teamId) {
                    teamDiffs.set(stu.teamId, (teamDiffs.get(stu.teamId) || 0) + 1);
                }
            }
        }

        // Add Category nextChestNumber updates to batch
        for (const [catId, catInfo] of categoryDataMap.entries()) {
            batch.update(catInfo.ref, {
                nextChestNumber: catInfo.nextChestNumber,
                updatedAt: importedAt
            });
        }

        for (const [teamId, delta] of teamDiffs.entries()) {
            if (delta !== 0) {
                const teamRef = doc(db, "institutes", window.currentInstituteId, "teams", teamId);
                batch.update(teamRef, { memberCount: increment(delta) });
            }
        }

        try {
            await batch.commit();
        } catch (err) {
            console.error(`Chunk ${chunkIdx + 1} failed during commit:`, err);
            failedRows.push(...chunk);
        }
    }

    document.getElementById('importProgressBar').style.width = `100%`;
    document.getElementById('importProgressPercent').textContent = `100% Complete`;

    try {
        await updateDashboardMetadata(window.currentInstituteId);
    } catch (e) {
        console.error("Failed to aggregate dashboard metadata", e);
    }

    const successCount = totalStudents - failedRows.length;

    if (failedRows.length === 0) {
        modalBody.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:1.25rem; padding:0.5rem; text-align:center;">
                <div style="font-size:3rem; margin-top:0.5rem;">🎉</div>
                <h4 style="margin:0; font-weight:800; font-size:1.15rem; color:#15803d;">Import Completed Successfully!</h4>
                <p style="font-size:0.85rem; color:#475569; line-height:1.5; margin:0;">
                    Successfully imported/updated <strong>${successCount}</strong> student profiles in the database.<br>
                    All team counts and dashboard stats have been re-aggregated and updated.
                </p>
                <div style="display:flex; gap:0.5rem; justify-content:center; margin-top:0.5rem;">
                    <button class="btn btn-primary w-full" id="btnImportFinish">Done</button>
                </div>
            </div>
        `;
        document.getElementById('btnImportFinish').onclick = () => {
            modal.classList.add('hidden');
            loadStudentsData();
        };
        window.showToast(`Imported ${successCount} students successfully!`, "success");
    } else {
        const csvHeaders = "Chest No,Student Name,Gender,Category,Class,Team\n";
        const csvRows = failedRows.map(r => `"${r.chestNumber}","${r.name}","${r.gender}","${r.categoryName}","${r.className}","${r.teamName}"`).join("\n");
        const encodedUri = "data:text/csv;charset=utf-8," + encodeURIComponent(csvHeaders + csvRows);

        modalBody.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:1.25rem; padding:0.5rem; text-align:center;">
                <div style="font-size:3rem; margin-top:0.5rem;">⚠️</div>
                <h4 style="margin:0; font-weight:800; font-size:1.15rem; color:#b45309;">Import Completed with Errors</h4>
                <p style="font-size:0.85rem; color:#475569; line-height:1.5; margin:0;">
                    Successfully imported/updated <strong>${successCount}</strong> students, but <strong>${failedRows.length}</strong> rows failed due to database writes exceptions.
                </p>

                <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:10px; padding:0.85rem; text-align:left; display:flex; flex-direction:column; gap:0.5rem;">
                    <div style="font-weight:700; color:#b45309; font-size:0.8rem;">👉 Next Actions:</div>
                    <a href="${encodedUri}" download="failed_import_rows.csv" class="btn btn-secondary w-full" style="text-decoration:none; text-align:center; padding:0.4rem; font-size:0.8rem; display:block;">
                        📥 Download Failed Rows (.csv)
                    </a>
                    <button class="btn btn-danger w-full" id="btnImportRollback" style="font-size:0.8rem;">
                        🗑️ Rollback Partial Import (${successCount} rows)
                    </button>
                </div>

                <div style="display:flex; gap:0.5rem; justify-content:center;">
                    <button class="btn btn-secondary w-full" id="btnImportFinish">Close Dialog</button>
                </div>
            </div>
        `;

        document.getElementById('btnImportFinish').onclick = () => {
            modal.classList.add('hidden');
            loadStudentsData();
        };
        
        document.getElementById('btnImportRollback').onclick = async () => {
            const btn = document.getElementById('btnImportRollback');
            btn.disabled = true;
            btn.textContent = "Rolling back...";
            
            try {
                const snap = await getDocs(query(
                    collection(db, "institutes", window.currentInstituteId, "students"),
                    where("importBatchId", "==", importBatchId)
                ));
                
                const rollbackBatch = writeBatch(db);
                const teamCounts = new Map();
                
                snap.forEach(d => {
                    const data = d.data();
                    rollbackBatch.delete(d.ref);
                    if (data.teamId) {
                        teamCounts.set(data.teamId, (teamCounts.get(data.teamId) || 0) + 1);
                    }
                });

                for (const [teamId, count] of teamCounts.entries()) {
                    const teamRef = doc(db, "institutes", window.currentInstituteId, "teams", teamId);
                    rollbackBatch.update(teamRef, { memberCount: increment(-count) });
                }

                await rollbackBatch.commit();
                await updateDashboardMetadata(window.currentInstituteId);
                window.showToast("Rollback completed successfully. State restored.", "success");
                modal.classList.add('hidden');
                loadStudentsData();
            } catch (rollbackErr) {
                console.error("Rollback failed:", rollbackErr);
                window.showToast("Rollback failed. Some records might remain.", "error");
                btn.disabled = false;
                btn.textContent = "Retry Rollback";
            }
        };
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
