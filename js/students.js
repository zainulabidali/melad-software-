import { auth, db, updateDashboardMetadata, getCachedCategories, getCachedTeams, getCachedPrograms } from './firebase.js';
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
    increment,
    runTransaction
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { normalizeClasses } from './categories.js';

let unsubscribeStudents = null;
let unsubscribeParticipants = null;

let currentTeamId = null;
let currentCategoryId = null;
let currentClassId = null;
let currentGender = '';

let allCategories = [];
let allPrograms = [];
let teamMap = new Map();

let localStudents = [];
let localStudentsAll = [];
let localParticipants = [];
let participantUnsubs = [];

function findNextAvailableChestNumber(startFrom, chestStart, chestEnd, excludeSet = new Set()) {
    let start = parseInt(startFrom, 10);
    const startBound = parseInt(chestStart, 10) || 1;
    const endBound = parseInt(chestEnd, 10) || Infinity;

    if (isNaN(start) || start < startBound || start > endBound) {
        start = startBound;
    }

    let current = start;
    // 1. Search from start to endBound
    while (current <= endBound) {
        const currentStr = current.toString();
        const isTaken = localStudentsAll.some(s => s.chestNumber === currentStr) || excludeSet.has(currentStr);
        if (!isTaken) return current;
        current++;
    }
    // 2. Wrap around: search from startBound to start - 1
    current = startBound;
    while (current < start) {
        const currentStr = current.toString();
        const isTaken = localStudentsAll.some(s => s.chestNumber === currentStr) || excludeSet.has(currentStr);
        if (!isTaken) return current;
        current++;
    }
    return null; // Truly full
}

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
    currentGender = '';

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
                    <input type="text" id="stuSearchInput" class="form-input search-input-premium" placeholder="Search student..." />
                </div>
                <select id="stuCatSelect" class="form-input select-premium" style="width: 170px;">
                    <option value="">Select Category..</option>
                </select>
                <select id="stuClassSelect" class="form-input select-premium" style="width: 150px;" disabled>
                    <option value="">Select Class...</option>
                </select>
                <select id="stuTeamSelect" class="form-input select-premium" style="width: 170px;">
                    <option value="">All Teams</option>
                </select>
                <select id="stuGenderSelect" class="form-input select-premium" style="width: 170px;">
                    <option value="">All Students </option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                </select>
                <button class="btn btn-secondary" id="btnImportExcel" style="display:flex; align-items:center; gap:0.25rem;"> Import Excel</button>
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
    const genderSel = document.getElementById('stuGenderSelect');
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

    if (genderSel) {
        genderSel.addEventListener('change', (e) => {
            currentGender = e.target.value;
            applyStudentFiltersAndRender();
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', debounce(() => {
            applyStudentFiltersAndRender();
        }, 300));
    }

    if (btnAddStudents) {
        btnAddStudents.addEventListener('click', () => window.navigateTo('add-student'));
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

    // 5. Gender post-filter
    if (currentGender) {
        filtered = filtered.filter(s => s.gender === currentGender);
    }

    localStudents = sortStudents(filtered, allCategories);
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
                <div>Sl No.</div>
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

    localStudents.forEach((stu, idx) => {
        const id = stu.id;
        const chest = stu.chestNumber || '—';
        const teamName = teamMap.get(stu.teamId) || '—';

        tableHTML += `
            <div class="student-row">
                <div class="student-sl-cell" style="font-weight: 700; color: #475569;">
                    ${idx + 1}
                </div>
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
        // Fetch all individual and group participant records for this team securely without collectionGroup
        const promises = allPrograms.map(async (prog) => {
            const partRef = collection(db, "institutes", window.currentInstituteId, "programs", prog.id, "participants");
            const q = query(partRef, where("teamId", "==", stu.teamId));
            const snap = await getDocs(q);
            return snap.docs.map(d => ({ id: d.id, ...d.data(), programId: prog.id }));
        });
        const results = await Promise.all(promises);
        const teamParticipants = results.flat();

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
    if (!await window.customConfirm(`Move ${docs.length} students to the new structure? This will migrate them once and use the flat collection from now on.`, "Migrate Students")) return;
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
        window.handleError(e, "migrating legacy students");
        btn.disabled = false;
        btn.textContent = "Retry Move";
    }
}

export async function initAddStudentView(container, topActions) {
    // Clear topbar actions
    topActions.innerHTML = '';

    container.innerHTML = `
        <div style="text-align:center; padding:3rem; color:#4f46e5;">
            <div class="spinner" style="margin:0 auto 1rem; width:40px; height:40px; border:4px solid rgba(99,102,241,0.1); border-top-color:#4f46e5; border-radius:50%; animation:spin 1s linear infinite;"></div>
            <p style="color:#64748b; font-size:0.875rem; font-weight:600;">Loading configurations...</p>
        </div>
    `;

    // Ensure we have categories and teams loaded
    try {
        if (allCategories.length === 0) {
            const categoriesData = await getCachedCategories(window.currentInstituteId);
            allCategories = categoriesData.map(cat => ({ id: cat.id, ...cat, classes: normalizeClasses(cat.classes) }));
        }
        if (teamMap.size === 0) {
            const teamsData = await getCachedTeams(window.currentInstituteId);
            teamsData.forEach(team => {
                teamMap.set(team.id, team.name);
            });
        }
    } catch (e) {
        console.error("Error loading categories or teams for add view:", e);
    }

    container.innerHTML = `
        <style>
        .premium-container {
            font-family: 'Inter', sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 1.5rem;
            display: flex;
            flex-direction: column;
            gap: 1.5rem;
        }
        .premium-card {
            background: #ffffff;
            border-radius: 16px;
            border: 1px solid #e2e8f0;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
            padding: 2rem;
            display: flex;
            flex-direction: column;
            gap: 1.5rem;
        }
        .flow-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1.25rem;
        }
        @media (max-width: 600px) {
            .flow-grid {
                grid-template-columns: 1fr;
            }
        }
        .preview-panel {
            background: #f8fafc;
            border: 1px solid #cbd5e1;
            border-radius: 12px;
            padding: 1.25rem;
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
            font-size: 0.9rem;
            color: #475569;
        }
        .preview-title {
            font-size: 0.75rem;
            font-weight: 700;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 0.25rem;
        }
        .stat-badge {
            background: #f1f5f9;
            color: #475569;
            border-radius: 6px;
            padding: 0.35rem 0.75rem;
            font-size: 0.8rem;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
        }
        .stat-badge.valid {
            background: #dcfce7;
            color: #15803d;
        }
        .stat-badge.duplicate {
            background: #fef3c7;
            color: #b45309;
        }
        .stat-badge.invalid {
            background: #fee2e2;
            color: #b91c1c;
        }
        .warning-card {
            background: #fffbeb;
            border: 1px solid #fde68a;
            border-radius: 12px;
            padding: 1rem;
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
            font-size: 0.85rem;
            color: #92400e;
        }
        </style>

        <div class="premium-container">
            <div class="premium-card">
                <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 1rem; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h2 style="margin:0; font-size:1.4rem; font-weight:800; color:#0f172a;">Student Registration</h2>
                        <p style="margin:0.25rem 0 0 0; font-size:0.875rem; color:#64748b;">Enroll multiple students at once into a specific category, team, gender, and class.</p>
                    </div>
                    <button class="btn btn-secondary" id="btnBackToDirectory" style="min-height:38px;">⬅ Back</button>
                </div>

                <!-- Sequence Dropdowns -->
                <div class="flow-grid">
                    <div class="form-group" style="margin:0;">
                        <label class="form-label">1. Category *</label>
                        <select id="seqCategory" class="form-input">
                            <option value="">Select Category...</option>
                            ${allCategories.map(cat => `<option value="${cat.id}">${window.escapeHTML(cat.name)}</option>`).join('')}
                        </select>
                    </div>

                    <div class="form-group" style="margin:0;">
                        <label class="form-label" style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; font-weight:700; color:#475569; user-select:none;">
                            <input type="checkbox" id="seqIsCompetitive" checked style="width:1.15rem; height:1.15rem; cursor:pointer;">
                            2. Assign to Team *
                        </label>
                        <select id="seqTeam" class="form-input" disabled style="margin-top:0.25rem;">
                            <option value="">Select Team (Disabled)...</option>
                            ${Array.from(teamMap.entries()).map(([id, name]) => `<option value="${id}">${window.escapeHTML(name)}</option>`).join('')}
                        </select>
                    </div>

                    <div class="form-group" style="margin:0;">
                        <label class="form-label">3. Gender *</label>
                        <select id="seqGender" class="form-input" disabled>
                            <option value="">Select Gender (Disabled)...</option>
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                            <option value="Other">Other</option>
                        </select>
                    </div>

                    <div class="form-group" style="margin:0;">
                        <label class="form-label">4. Class *</label>
                        <select id="seqClass" class="form-input" disabled>
                            <option value="">Select Class (Disabled)...</option>
                        </select>
                    </div>
                </div>

                <!-- Chest Number Live Preview -->
                <div id="chestPreviewPanel" class="preview-panel" style="display: none;">
                    <div class="preview-title">Chest Number Preview (Auto-Generated)</div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem 1rem;">
                        <div>Highest Existing: <strong id="lblHighestChest" style="color: #0f172a;">—</strong></div>
                        <div>Next Available: <strong id="lblNextChest" style="color: #4f46e5;">—</strong></div>
                        <div style="grid-column: span 2; border-top: 1px solid #e2e8f0; margin-top: 0.25rem; padding-top: 0.25rem;">
                            Expected Range for Batch: <strong id="lblExpectedRange" style="color: #0f172a;">—</strong>
                        </div>
                    </div>
                </div>

                <!-- Student Names Area -->
                <div class="form-group" style="margin:0;">
                    <label class="form-label">5. Student Names (One per line) *</label>
                    <textarea id="bulkNamesTextarea" class="form-input" disabled rows="8" placeholder="Type or paste names here...&#10;Muhammed Ali&#10;Abdul Rahman&#10;Fathima..." style="padding: 0.8rem 1rem; font-family: monospace; line-height: 1.5; font-size: 0.9rem; resize: vertical;"></textarea>
                </div>

                <!-- Statistics panel -->
                <div id="statsPanel" style="display: none; justify-content: flex-start; gap: 0.75rem; flex-wrap: wrap; margin-top: -0.5rem;">
                    <span class="stat-badge">Total Count: <strong id="statTotal">0</strong></span>
                    <span class="stat-badge valid">Valid: <strong id="statValid">0</strong></span>
                    <span class="stat-badge duplicate">Duplicates: <strong id="statDuplicate">0</strong></span>
                    <span class="stat-badge invalid">Invalid: <strong id="statInvalid">0</strong></span>
                </div>

                <!-- Warning card for duplicates -->
                <div id="duplicateWarningCard" class="warning-card" style="display: none;">
                    <h4 style="margin: 0; font-size: 0.9rem; font-weight: 700; display: flex; align-items: center; gap: 0.35rem;">
                        ⚠️ Duplicate Entries Detected
                    </h4>
                    <p style="margin: 0; line-height: 1.4;">The following names are duplicates (in this batch or already exist in this category/team/class):</p>
                    <div id="duplicateListContainer" style="max-height: 120px; overflow-y: auto; font-family: monospace; font-size: 0.8rem; background: rgba(255, 255, 255, 0.5); padding: 0.5rem; border-radius: 6px; border: 1px solid #fde68a;">
                        <!-- Duplicates filled dynamically -->
                    </div>
                </div>

                <!-- Action Buttons -->
                <div style="display: flex; gap: 0.75rem; justify-content: flex-end; border-top: 1px solid #e2e8f0; padding-top: 1.25rem;">
                    <button class="btn btn-secondary" id="btnCancelRegistration" style="min-height:40px; font-weight:700;">Cancel</button>
                    <button class="btn btn-primary" id="btnSaveBulkStudents" disabled style="min-height:40px; font-weight:700;">
                        <span class="btn-text">💾 Save Students</span>
                        <span class="btn-spinner hidden" style="display:inline-block; width:16px; height:16px; border:2px solid #fff; border-top-color:transparent; border-radius:50%; animation:spin 0.6s linear infinite; margin-left:0.35rem;"></span>
                    </button>
                </div>
            </div>
        </div>
    `;

    const seqCategory = document.getElementById('seqCategory');
    const seqTeam = document.getElementById('seqTeam');
    const seqGender = document.getElementById('seqGender');
    const seqClass = document.getElementById('seqClass');
    const bulkNamesTextarea = document.getElementById('bulkNamesTextarea');
    const btnSave = document.getElementById('btnSaveBulkStudents');
    const statsPanel = document.getElementById('statsPanel');
    const chestPreviewPanel = document.getElementById('chestPreviewPanel');

    // Go back buttons
    document.getElementById('btnBackToDirectory').onclick = () => window.navigateTo('students');
    document.getElementById('btnCancelRegistration').onclick = () => window.navigateTo('students');

    function updateFlowState() {
        const catId = seqCategory.value;
        const isCompetitive = document.getElementById('seqIsCompetitive')?.checked !== false;
        const teamId = isCompetitive ? seqTeam.value : 'teamless';
        const gender = seqGender.value;
        const classId = seqClass.value;

        // Reset flow
        if (!catId) {
            seqTeam.value = "";
            seqTeam.disabled = true;
            seqTeam.style.display = 'block';
            seqTeam.innerHTML = '<option value="">Select Team (Disabled)...</option>';
            
            seqGender.value = "";
            seqGender.disabled = true;
            seqGender.innerHTML = `
                <option value="">Select Gender (Disabled)...</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
            `;
            
            seqClass.value = "";
            seqClass.disabled = true;
            seqClass.innerHTML = '<option value="">Select Class (Disabled)...</option>';
            
            bulkNamesTextarea.value = "";
            bulkNamesTextarea.disabled = true;
            chestPreviewPanel.style.display = 'none';
            statsPanel.style.display = 'none';
            btnSave.disabled = true;
            return;
        }

        // Enable/Disable & Show/Hide Team Select
        if (isCompetitive) {
            seqTeam.style.display = 'block';
            seqTeam.disabled = false;
            if (seqTeam.innerHTML.includes('(Disabled)')) {
                seqTeam.innerHTML = '<option value="">Select Team...</option>' + 
                    Array.from(teamMap.entries()).map(([id, name]) => `<option value="${id}">${window.escapeHTML(name)}</option>`).join('');
            }
        } else {
            seqTeam.style.display = 'none';
            seqTeam.disabled = true;
            seqTeam.value = "";
        }

        if (isCompetitive && !seqTeam.value) {
            seqGender.value = "";
            seqGender.disabled = true;
            seqGender.innerHTML = `
                <option value="">Select Gender (Disabled)...</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
            `;
            
            seqClass.value = "";
            seqClass.disabled = true;
            seqClass.innerHTML = '<option value="">Select Class (Disabled)...</option>';
            
            bulkNamesTextarea.value = "";
            bulkNamesTextarea.disabled = true;
            chestPreviewPanel.style.display = 'none';
            statsPanel.style.display = 'none';
            btnSave.disabled = true;
            return;
        }

        // Enable Gender
        seqGender.disabled = false;
        if (seqGender.innerHTML.includes('(Disabled)')) {
            seqGender.innerHTML = `
                <option value="">Select Gender...</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
            `;
            seqGender.value = gender;
        }

        if (!gender) {
            seqClass.value = "";
            seqClass.disabled = true;
            seqClass.innerHTML = '<option value="">Select Class (Disabled)...</option>';
            
            bulkNamesTextarea.value = "";
            bulkNamesTextarea.disabled = true;
            chestPreviewPanel.style.display = 'none';
            statsPanel.style.display = 'none';
            btnSave.disabled = true;
            return;
        }

        // Enable Class
        seqClass.disabled = false;
        const cat = allCategories.find(c => c.id === catId);
        if (seqClass.innerHTML.includes('(Disabled)') || seqClass.innerHTML === "") {
            seqClass.innerHTML = '<option value="">Select Class...</option>';
            if (cat && cat.classes) {
                cat.classes.forEach(cls => {
                    const opt = document.createElement('option');
                    opt.value = cls.id;
                    opt.textContent = cls.name;
                    seqClass.appendChild(opt);
                });
            }
            if (classId && cat?.classes.some(cls => cls.id === classId)) {
                seqClass.value = classId;
            }
        }

        if (!seqClass.value) {
            bulkNamesTextarea.value = "";
            bulkNamesTextarea.disabled = true;
            chestPreviewPanel.style.display = 'none';
            statsPanel.style.display = 'none';
            btnSave.disabled = true;
            return;
        }

        // Enable Names Textarea
        bulkNamesTextarea.disabled = false;
        chestPreviewPanel.style.display = 'flex';
        calculateChestPreviewAndStats();
    }

    function calculateChestPreviewAndStats() {
        const catId = seqCategory.value;
        const classId = seqClass.value;
        const isCompetitive = document.getElementById('seqIsCompetitive')?.checked !== false;
        const teamId = isCompetitive ? seqTeam.value : '';
        const rawNames = bulkNamesTextarea.value;

        const cat = allCategories.find(c => c.id === catId);
        if (!cat) return;

        // 1. Calculate highest existing chest number
        const catStudents = localStudentsAll.filter(s => s.categoryId === catId);
        const chestNums = catStudents.map(s => parseInt(s.chestNumber, 10)).filter(num => !isNaN(num));
        const highestChest = chestNums.length > 0 ? Math.max(...chestNums) : 0;
        
        const chestStart = parseInt(cat.chestStart, 10) || 1;
        const chestEnd = parseInt(cat.chestEnd, 10) || Infinity;
        
        const lblHighestChest = document.getElementById('lblHighestChest');
        lblHighestChest.textContent = highestChest > 0 ? `#${highestChest}` : 'None';

        // 2. Parse batch names
        const lines = rawNames.split('\n');
        const validNames = [];
        const invalidLines = [];
        const batchDuplicates = [];
        const dbDuplicates = [];

        const seenInBatch = new Set();

        lines.forEach((line, idx) => {
            const name = line.trim();
            if (!name) return;

            if (name.length < 2) {
                invalidLines.push({ name, lineNum: idx + 1, reason: "Name too short" });
                return;
            }

            const nameLower = name.toLowerCase();
            if (seenInBatch.has(nameLower)) {
                batchDuplicates.push({ name, lineNum: idx + 1 });
                return;
            }
            seenInBatch.add(nameLower);

            const isDbDup = localStudentsAll.some(s => 
                s.name.trim().toLowerCase() === nameLower && 
                s.categoryId === catId && 
                s.teamId === teamId && 
                s.classId === classId
            );

            if (isDbDup) {
                dbDuplicates.push({ name, lineNum: idx + 1 });
            }

            validNames.push(name);
        });

        const totalCount = lines.filter(l => l.trim() !== "").length;
        const validCount = validNames.length;
        const dupCount = batchDuplicates.length + dbDuplicates.length;
        const invalidCount = invalidLines.length;

        document.getElementById('statTotal').textContent = totalCount;
        document.getElementById('statValid').textContent = validNames.length - dbDuplicates.length;
        document.getElementById('statDuplicate').textContent = dupCount;
        document.getElementById('statInvalid').textContent = invalidCount;

        if (totalCount > 0) {
            statsPanel.style.display = 'flex';
        } else {
            statsPanel.style.display = 'none';
        }

        // Next Available and Range calculation
        const lblNextChest = document.getElementById('lblNextChest');
        const lblExpectedRange = document.getElementById('lblExpectedRange');

        let nextChest = parseInt(cat.nextChestNumber || chestStart, 10);

        let tempExclude = new Set();
        let rangeStart = null;
        let rangeEnd = null;
        let limitReached = false;

        const studentsToAllocateCount = validNames.length;

        for (let i = 0; i < studentsToAllocateCount; i++) {
            const allocated = findNextAvailableChestNumber(nextChest, chestStart, chestEnd, tempExclude);
            if (allocated === null) {
                limitReached = true;
                break;
            }
            if (i === 0) rangeStart = allocated;
            rangeEnd = allocated;
            tempExclude.add(allocated.toString());
            nextChest = allocated + 1;
        }

        const firstAvailable = findNextAvailableChestNumber(parseInt(cat.nextChestNumber || chestStart, 10), chestStart, chestEnd, new Set());

        if (firstAvailable) {
            lblNextChest.textContent = `#${firstAvailable}`;
            lblNextChest.style.color = '#4f46e5';
        } else {
            lblNextChest.textContent = 'Limit reached';
            lblNextChest.style.color = '#ef4444';
        }

        if (studentsToAllocateCount === 0) {
            lblExpectedRange.textContent = '—';
            lblExpectedRange.style.color = '#475569';
        } else if (limitReached) {
            lblExpectedRange.textContent = 'Chest range limit exceeded!';
            lblExpectedRange.style.color = '#ef4444';
        } else {
            lblExpectedRange.textContent = rangeStart === rangeEnd ? `#${rangeStart}` : `#${rangeStart} – #${rangeEnd}`;
            lblExpectedRange.style.color = '#15803d';
        }

        // Smart Duplicate Warnings UI Panel
        const warningCard = document.getElementById('duplicateWarningCard');
        const warningListContainer = document.getElementById('duplicateListContainer');

        if (dupCount > 0) {
            warningCard.style.display = 'flex';
            warningListContainer.innerHTML = '';

            batchDuplicates.forEach(d => {
                const div = document.createElement('div');
                div.innerHTML = `⚠️ Line ${d.lineNum}: <strong>${window.escapeHTML(d.name)}</strong> (Duplicate in current batch)`;
                warningListContainer.appendChild(div);
            });

            dbDuplicates.forEach(d => {
                const div = document.createElement('div');
                div.innerHTML = `👤 Line ${d.lineNum}: <strong>${window.escapeHTML(d.name)}</strong> (Already exists in same category/team/class)`;
                warningListContainer.appendChild(div);
            });
        } else {
            warningCard.style.display = 'none';
        }

        btnSave.disabled = (validCount === 0 || limitReached || invalidCount > 0);
    }

    // Attach sequence listeners
    seqCategory.addEventListener('change', () => {
        seqTeam.innerHTML = '<option value="">Select Team (Disabled)...</option>';
        seqClass.innerHTML = '<option value="">Select Class (Disabled)...</option>';
        updateFlowState();
    });
    seqTeam.addEventListener('change', updateFlowState);
    seqGender.addEventListener('change', updateFlowState);
    seqClass.addEventListener('change', updateFlowState);
    document.getElementById('seqIsCompetitive')?.addEventListener('change', updateFlowState);

    bulkNamesTextarea.addEventListener('input', calculateChestPreviewAndStats);

    btnSave.onclick = async (e) => {
        e.preventDefault();
        
        const catId = seqCategory.value;
        const classId = seqClass.value;
        const isCompetitive = document.getElementById('seqIsCompetitive')?.checked !== false;
        const teamId = isCompetitive ? seqTeam.value : '';
        
        const lines = bulkNamesTextarea.value.split('\n');
        const validNames = [];
        const seen = new Set();
        
        lines.forEach(line => {
            const name = line.trim();
            if (name && name.length >= 2 && !seen.has(name.toLowerCase())) {
                validNames.push(name);
                seen.add(name.toLowerCase());
            }
        });

        if (validNames.length === 0) {
            window.showToast("Please enter at least one valid student name.", "error");
            return;
        }

        const dupCount = document.getElementById('duplicateWarningCard').style.display !== 'none';
        if (dupCount) {
            const confirmSave = await window.customConfirm(
                "Duplicate student names were detected. Are you sure you want to proceed and save?",
                "Potential Duplicates Found",
                { danger: true, okText: "Save Anyway", cancelText: "Cancel" }
            );
            if (!confirmSave) return;
        }

        btnSave.disabled = true;
        btnSave.querySelector('.btn-text').classList.add('hidden');
        btnSave.querySelector('.btn-spinner').classList.remove('hidden');

        try {
            const instId = window.currentInstituteId;
            const catRef = doc(db, "institutes", instId, "categories", catId);
            
            await runTransaction(db, async (transaction) => {
                const catSnap = await transaction.get(catRef);
                if (!catSnap.exists()) {
                    throw new Error("Category configuration not found.");
                }

                const catData = catSnap.data();
                const chestStart = parseInt(catData.chestStart, 10) || 1;
                const chestEnd = parseInt(catData.chestEnd, 10) || Infinity;
                
                let nextChest = parseInt(catData.nextChestNumber || chestStart, 10);

                const colRef = collection(db, "institutes", instId, "students");
                const catObj = allCategories.find(c => c.id === catId);
                const clsObj = catObj?.classes.find(c => c.id === classId);

                const allocatedStudents = [];
                const tempExclude = new Set();
                for (const name of validNames) {
                    const allocated = findNextAvailableChestNumber(nextChest, chestStart, chestEnd, tempExclude);
                    if (allocated === null) {
                        throw new Error("No available chest numbers remaining for this category.");
                    }
                    allocatedStudents.push({ name, chestNumber: allocated.toString() });
                    tempExclude.add(allocated.toString());
                    nextChest = allocated + 1;
                }

                allocatedStudents.forEach(stu => {
                    const newStuRef = doc(colRef);
                    transaction.set(newStuRef, {
                        chestNumber: stu.chestNumber,
                        name: stu.name,
                        gender: seqGender.value,
                        categoryId: catId,
                        categoryName: catObj?.name || '',
                        classId: classId,
                        className: clsObj?.name || '',
                        teamId: teamId,
                        isTeamParticipant: isCompetitive,
                        createdAt: serverTimestamp()
                    });
                });

                transaction.update(catRef, {
                    nextChestNumber: nextChest,
                    updatedAt: serverTimestamp()
                });

                if (teamId) {
                    const teamRef = doc(db, "institutes", instId, "teams", teamId);
                    transaction.update(teamRef, { memberCount: increment(validNames.length) });
                }
            });

            await updateDashboardMetadata(instId);
            window.showToast(`Successfully enrolled ${validNames.length} students!`, "success");
            window.navigateTo('students');

        } catch (err) {
            window.handleError(err, "registering students in bulk");
        } finally {
            btnSave.disabled = false;
            btnSave.querySelector('.btn-text').classList.remove('hidden');
            btnSave.querySelector('.btn-spinner').classList.add('hidden');
        }
    };
}

function openEditModal(stuId, data) {
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');
    const modalOverlay = document.getElementById('dynamicModal');

    const isCompetitive = data.teamId && data.isTeamParticipant !== false;

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
            <div class="form-group" style="display:flex; align-items:center; gap:0.5rem; margin-top:1rem;">
                <label class="form-label" style="margin:0; display:flex; align-items:center; gap:0.5rem; cursor:pointer; font-weight:700; color:#475569; user-select:none;">
                    <input type="checkbox" id="eIsCompetitive" ${isCompetitive ? 'checked' : ''} style="width:1.15rem; height:1.15rem; cursor:pointer;">
                    Assign to Team
                </label>
            </div>
            <div class="form-group" id="eTeamGroup" style="${isCompetitive ? '' : 'display:none;'}">
                <label class="form-label">Team</label>
                <select id="eTeam" class="form-input">
                    ${Array.from(teamMap.entries()).map(([id, name]) => `<option value="${id}" ${data.teamId === id ? 'selected' : ''}>${window.escapeHTML(name)}</option>`).join('')}
                </select>
            </div>
            <div class="modal-actions">
                <button type="submit" class="btn btn-primary w-full" id="saveEditStuBtn">Save Changes</button>
            </div>
        </form>
    `;

    const checkbox = document.getElementById('eIsCompetitive');
    const teamGroup = document.getElementById('eTeamGroup');
    if (checkbox && teamGroup) {
        checkbox.onchange = () => {
            if (checkbox.checked) {
                teamGroup.style.display = 'block';
            } else {
                teamGroup.style.display = 'none';
            }
        };
    }

    modalOverlay.classList.remove('hidden');
    document.getElementById('editStudentForm').onsubmit = async (e) => {
        e.preventDefault();
        const btn = document.getElementById('saveEditStuBtn');
        btn.disabled = true;

        const newName = document.getElementById('eName').value.trim();
        const newGender = document.getElementById('eGender').value;
        const newIsCompetitive = document.getElementById('eIsCompetitive').checked;
        const newTeamId = newIsCompetitive ? document.getElementById('eTeam').value : '';
        const oldTeamId = data.teamId || '';

        if (!newName || newName.length < 2) {
            window.showToast("Student name must be at least 2 characters.", "error");
            btn.disabled = false;
            return;
        }

        try {
            const instId = window.currentInstituteId;
            const batch = writeBatch(db);

            // 1. Update student document itself
            const studentRef = doc(db, "institutes", instId, "students", stuId);
            batch.update(studentRef, {
                name: newName,
                gender: newGender,
                teamId: newTeamId,
                isTeamParticipant: newIsCompetitive,
                updatedAt: serverTimestamp()
            });

            // 2. Query individual participant registrations
            const indivSnap = await getDocs(query(
                collectionGroup(db, "participants"),
                where("studentId", "==", stuId),
                where("type", "==", "individual")
            ));
            indivSnap.forEach(d => {
                if (d.ref.path.startsWith(`institutes/${instId}/`)) {
                    batch.update(d.ref, {
                        studentName: newName,
                        gender: newGender,
                        teamId: newTeamId,
                        teamName: newTeamId ? (teamMap.get(newTeamId) || '') : 'No Team',
                        updatedAt: serverTimestamp()
                    });
                }
            });

            // 3. Query group participant docs and update member name inside members array
            if (oldTeamId) {
                const groupSnap = await getDocs(query(
                    collectionGroup(db, "participants"),
                    where("type", "==", "group"),
                    where("teamId", "==", oldTeamId)
                ));
                groupSnap.forEach(d => {
                    if (d.ref.path.startsWith(`institutes/${instId}/`)) {
                        const data = d.data();
                        const groupsList = Array.isArray(data.groups) ? data.groups : [];
                        let modified = false;
                        const updatedGroups = groupsList.map(g => {
                            const members = Array.isArray(g.members) ? g.members : [];
                            const updatedMembers = members.map(m => {
                                if (m.studentId === stuId) {
                                    modified = true;
                                    return { ...m, studentName: newName };
                                }
                                return m;
                            });
                            return { ...g, members: updatedMembers };
                        });
                        if (modified) {
                            batch.update(d.ref, { groups: updatedGroups, updatedAt: serverTimestamp() });
                        }
                    }
                });
            }

            // 4. Update team member counts
            if (oldTeamId !== newTeamId) {
                if (oldTeamId) {
                    const oldTeamRef = doc(db, "institutes", instId, "teams", oldTeamId);
                    batch.update(oldTeamRef, { memberCount: increment(-1) });
                }
                if (newTeamId) {
                    const newTeamRef = doc(db, "institutes", instId, "teams", newTeamId);
                    batch.update(newTeamRef, { memberCount: increment(1) });
                }
            }

            await batch.commit();
            await updateDashboardMetadata(instId);
            window.showToast("Student updated successfully.");
            modalOverlay.classList.add('hidden');
        } catch (err) {
            window.handleError(err, "updating student");
            btn.disabled = false;
        }
    };
}

// ─────────────────────────────────────────────
// Redesigned Student Deletion Service
// ─────────────────────────────────────────────

class BatchCommitter {
    constructor(db) {
        this.db = db;
        this.batch = writeBatch(db);
        this.opsCount = 0;
        this.commits = [];
    }

    addSet(ref, data, options) {
        if (options) {
            this.batch.set(ref, data, options);
        } else {
            this.batch.set(ref, data);
        }
        this.checkLimit();
    }

    addUpdate(ref, data) {
        this.batch.update(ref, data);
        this.checkLimit();
    }

    addDelete(ref) {
        this.batch.delete(ref);
        this.checkLimit();
    }

    checkLimit() {
        this.opsCount++;
        if (this.opsCount >= 450) {
            this.commits.push(this.batch.commit());
            this.batch = writeBatch(this.db);
            this.opsCount = 0;
        }
    }

    async commitAll() {
        if (this.opsCount > 0) {
            this.commits.push(this.batch.commit());
        }
        await Promise.all(this.commits);
    }
}

async function validatePreDelete(instId) {
    const user = auth.currentUser;
    if (!user) {
        throw new Error("unauthenticated");
    }

    // 1. Fetch User profile document
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
        throw new Error("permission-denied");
    }

    const userData = userSnap.data();
    if (userData.role !== 'admin' && userData.role !== 'super_admin') {
        throw new Error("permission-denied");
    }

    if (userData.role === 'admin' && userData.instituteId !== instId) {
        throw new Error("permission-denied");
    }

    // 2. Fetch Institute details
    const instRef = doc(db, "institutes", instId);
    const instSnap = await getDoc(instRef);
    if (!instSnap.exists()) {
        throw new Error("not-found");
    }

    const instData = instSnap.data();
    if (instData.status !== 'active') {
        throw new Error("deactivated");
    }

    const now = new Date().getTime();
    const expiryDateObj = instData.expiryDate?.toDate?.() || (instData.expiryDate ? new Date(instData.expiryDate) : null);
    if (expiryDateObj && now >= expiryDateObj.getTime()) {
        throw new Error("expired");
    }

    return { user, userData };
}

async function executeStudentDeletion(studentIds) {
    const instId = window.currentInstituteId;
    if (!instId) {
        throw new Error("Institute ID is not set.");
    }
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
        return;
    }

    let lastQueryLabel = "validatePreDelete";
    let authUid = 'N/A';
    let userRole = 'N/A';

    try {
        // 1. Pre-delete Validation
        const { user, userData } = await validatePreDelete(instId);
        authUid = user.uid;
        userRole = userData.role;

        const deletionDate = new Date();
        const expiryDate = new Date(deletionDate.getTime() + 24 * 60 * 60 * 1000); // 24 Hours
        const deletedBy = user.email || user.uid || 'Admin';

        // 2. Fetch Student details to get data and teamId
        const studentsDataMap = new Map(); // studentId -> studentData
        const teamMemberCountDeltas = new Map(); // teamId -> count decrement
        
        lastQueryLabel = `Fetch student documents (bulk count: ${studentIds.length})`;
        
        const fetchPromises = studentIds.map(async (stuId) => {
            const studentRef = doc(db, "institutes", instId, "students", stuId);
            const snap = await getDoc(studentRef);
            if (snap.exists()) {
                const sData = snap.data();
                studentsDataMap.set(stuId, sData);
                if (sData.teamId) {
                    teamMemberCountDeltas.set(sData.teamId, (teamMemberCountDeltas.get(sData.teamId) || 0) + 1);
                }
            }
        });
        await Promise.all(fetchPromises);

        const committer = new BatchCommitter(db);

        // 3. Write Recovery Bin backup and Student deletes to batch
        for (const [stuId, sData] of studentsDataMap.entries()) {
            const binRef = doc(db, "institutes", instId, "recoveryBin", stuId);
            committer.addSet(binRef, {
                type: 'student',
                originalId: stuId,
                originalPath: `institutes/${instId}/students/${stuId}`,
                data: sData,
                deletedBy,
                deletedAt: deletionDate.toISOString(),
                expiryTime: expiryDate.toISOString()
            });

            const studentRef = doc(db, "institutes", instId, "students", stuId);
            committer.addDelete(studentRef);
        }

        const studentIdsSet = new Set(studentIds);
        const programCountDeltas = new Map(); // programId -> count change

        // 4. Clean up Participant Registrations (100% Index-Free Strategy)
        lastQueryLabel = `getCachedPrograms(window.currentInstituteId)`;
        const allProgs = await getCachedPrograms(instId);

        // Fetch all program participants in parallel using standard subcollection paths (no index required)
        lastQueryLabel = `Fetch participants for all ${allProgs.length} programs`;
        const progParticipantsSnaps = await Promise.all(
            allProgs.map(prog => getDocs(collection(db, "institutes", instId, "programs", prog.id, "participants")))
        );

        for (let idx = 0; idx < allProgs.length; idx++) {
            const prog = allProgs[idx];
            const progId = prog.id;
            const partSnap = progParticipantsSnaps[idx];

            let individualDeletedCount = 0;
            let groupsDeletedTotal = 0;

            partSnap.forEach(d => {
                const data = d.data();
                if (data.type === 'individual') {
                    if (studentIdsSet.has(data.studentId)) {
                        committer.addDelete(d.ref);
                        individualDeletedCount++;
                    }
                } else if (data.type === 'group') {
                    const groups = Array.isArray(data.groups) ? data.groups : [];
                    let groupsDeleted = 0;
                    const updatedGroups = [];

                    groups.forEach(g => {
                        const remainingMembers = (g.members || []).filter(m => !studentIdsSet.has(m.studentId));
                        if (remainingMembers.length > 0) {
                            updatedGroups.push({
                                ...g,
                                members: remainingMembers
                            });
                        } else {
                            groupsDeleted++;
                        }
                    });

                    groupsDeletedTotal += groupsDeleted;

                    if (updatedGroups.length === 0) {
                        committer.addDelete(d.ref);
                    } else {
                        committer.addUpdate(d.ref, { groups: updatedGroups });
                    }
                }
            });

            if (individualDeletedCount > 0) {
                programCountDeltas.set(
                    progId,
                    (programCountDeltas.get(progId) || 0) - individualDeletedCount
                );
            }
            if (groupsDeletedTotal > 0) {
                programCountDeltas.set(
                    progId,
                    (programCountDeltas.get(progId) || 0) - groupsDeletedTotal
                );
            }
        }

        // 5. Update Program Participant Counts
        for (const [progId, delta] of programCountDeltas.entries()) {
            if (delta !== 0) {
                const progRef = doc(db, "institutes", instId, "programs", progId);
                committer.addUpdate(progRef, { participantCount: increment(delta) });
            }
        }

        // 6. Update Team Member Counts
        for (const [teamId, count] of teamMemberCountDeltas.entries()) {
            if (count !== 0) {
                const teamRef = doc(db, "institutes", instId, "teams", teamId);
                committer.addUpdate(teamRef, { memberCount: increment(-count) });
            }
        }

        // 7. Commit all batches
        lastQueryLabel = `batch.commitAll()`;
        await committer.commitAll();

        // 8. Update Dashboard Metadata
        lastQueryLabel = `updateDashboardMetadata("${instId}")`;
        await updateDashboardMetadata(instId);

        console.log(`Successfully deleted ${studentIds.length} students. Recovery Bin backups created.`);
    } catch (e) {
        console.error("Student deletion failure diagnostic log:", {
            authUid: authUid || auth.currentUser?.uid || 'N/A',
            userRole: userRole || 'N/A',
            instituteId: instId || 'N/A',
            studentIds: studentIds,
            queryPath: lastQueryLabel,
            firestoreErrorCode: e.code || 'N/A',
            firestoreErrorMessage: e.message || 'N/A'
        });
        throw e;
    }
}

export async function deleteStudent(stuId) {
    const confirmed = await window.customConfirm(
        "Are you sure you want to delete this student? This will move them to the Recovery Bin for 24 hours and remove them from all program registrations.",
        "Delete Student",
        { danger: true, okText: "Delete" }
    );
    if (!confirmed) return;

    try {
        await executeStudentDeletion([stuId]);
        window.showToast("Student deleted successfully.", "success");
    } catch (err) {
        window.handleError(err, "deleting student");
    }
}

export async function deleteStudents(studentIds) {
    if (!Array.isArray(studentIds) || studentIds.length === 0) return;
    const confirmed = await window.customConfirm(
        `Are you sure you want to delete the ${studentIds.length} selected students? They will be moved to the Recovery Bin and removed from all program registrations.`,
        "Delete Selected Students",
        { danger: true, okText: "Delete Bulk" }
    );
    if (!confirmed) return;

    try {
        await executeStudentDeletion(studentIds);
        window.showToast(`${studentIds.length} students deleted successfully.`, "success");
    } catch (err) {
        window.handleError(err, "deleting selected students");
    }
}

export async function deleteAllStudents() {
    const confirmed = await window.customConfirm(
        "⚠️ WARNING: This will delete ALL students in this institute! They will be moved to the Recovery Bin and removed from all program registrations. This action is highly destructive.",
        "Delete All Students",
        { danger: true, okText: "Delete All" }
    );
    if (!confirmed) return;

    try {
        const instId = window.currentInstituteId;
        const snap = await getDocs(collection(db, "institutes", instId, "students"));
        const studentIds = snap.docs.map(d => d.id);
        if (studentIds.length === 0) {
            window.showToast("No students to delete.", "info");
            return;
        }

        await executeStudentDeletion(studentIds);
        window.showToast(`All ${studentIds.length} students deleted successfully.`, "success");
    } catch (err) {
        window.handleError(err, "deleting all students");
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

                const allocated = findNextAvailableChestNumber(nextChest, chestStart, chestEnd, allocatedInThisBatch);
                if (allocated === null) {
                    stu.errors = stu.errors || [];
                    stu.errors.push("Chest range limit reached for category.");
                    failedRows.push(stu);
                    continue;
                }

                chestNumber = allocated.toString();
                allocatedInThisBatch.add(chestNumber);
                // Update nextChestNumber in our local map object so the next student gets the next available number
                catInfo.nextChestNumber = allocated + 1;
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

function sortStudents(students, categories) {
    if (!Array.isArray(students)) return [];
    return [...students].sort((a, b) => {
        // 1. Category index in class-based sorted order
        const catA = categories.find(c => c.id === a.categoryId || c.name === a.categoryId || c.name === a.categoryName);
        const catB = categories.find(c => c.id === b.categoryId || c.name === b.categoryId || c.name === b.categoryName);
        const idxA = catA ? categories.indexOf(catA) : 999;
        const idxB = catB ? categories.indexOf(catB) : 999;
        
        if (idxA !== idxB) {
            return idxA - idxB;
        }

        // 2. Numeric chest number sort
        const numA = parseInt(a.chestNumber, 10);
        const numB = parseInt(b.chestNumber, 10);
        const hasA = !isNaN(numA);
        const hasB = !isNaN(numB);

        if (hasA && hasB) {
            return numA - numB;
        }
        if (hasA) return -1;
        if (hasB) return 1;

        // 3. String name sort
        return (a.name || '').localeCompare(b.name || '');
    });
}
