import { db, updateDashboardMetadata, migrateParticipantCounts, getCachedCategories, invalidateProgramsCache, getCachedPointsConfig, DEFAULT_POINTS, recalculateAllResultsPoints, invalidatePointsConfigCache } from './firebase.js';
import {
    collection, addDoc, getDocs, doc, deleteDoc, updateDoc, setDoc,
    onSnapshot, serverTimestamp, writeBatch, query, where, collectionGroup, orderBy
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { normalizeClasses } from './categories.js';

let unsubscribePrograms = null;
let unsubscribeParticipants = null;
let unsubscribeResults = null;
let currentCategoryId = null;
let allCategories = [];
let localPrograms = [];
let localProgramsAll = [];
let localParticipants = [];
let localResults = [];
let participantUnsubs = [];

// ─────────────────────────────────────────────
// Init View
// ─────────────────────────────────────────────
export async function initProgramsView(container, topActions) {
    if (unsubscribePrograms) unsubscribePrograms();
    if (unsubscribeParticipants) unsubscribeParticipants();
    if (unsubscribeResults) {
        unsubscribeResults();
        unsubscribeResults = null;
    }
    participantUnsubs.forEach(unsub => unsub());
    participantUnsubs = [];

    localPrograms = [];
    localProgramsAll = [];
    localParticipants = [];
    localResults = [];

    // Clear top actions to allow a unified premium responsive SaaS header inside the main container
    topActions.innerHTML = '';

    container.innerHTML = `
        <div class="programs-view-header">
            <div class="programs-header-left">
                <h2 class="programs-view-heading">Manage Programs</h2>
                <p class="programs-view-subtitle">Manage competition and general programs</p>
            </div>
            <div class="programs-header-right filter-bar-scrollable">
                <div class="programs-filters-grid">
                    <div class="search-input-wrapper">
                        <span class="search-icon">🔍</span>
                        <input type="text" id="progSearchInput" class="form-input search-input-premium" placeholder="Search program..." />
                    </div>
                    <select id="progCatSelect" class="form-input select-premium" style="width: 230px;">
                        <option value="">Select Category...</option>
                        <option value="general_programs">⭐ General Programs (Non-Category)</option>
                    </select>
                    <select id="progGenderSelect" class="form-input select-premium">
                        <option value="">All Genders</option>
                        <option value="Boys">Boys</option>
                        <option value="Girls">Girls</option>
                    </select>
                    <select id="progStageSelect" class="form-input select-premium">
                        <option value="">All Stages</option>
                        <option value="Stage">Stage</option>
                        <option value="Off Stage">Off Stage</option>
                    </select>
                </div>
                <div class="programs-actions-group">
                    <button class="btn btn-general" id="btnCreateGeneralProgram">+ General</button>
                    <button class="btn btn-primary" id="btnCreateProgram" disabled>+ Program</button>
                </div>
            </div>
        </div>

        <div class="programs-table-container" id="programsGridContainer">
            <div class="empty-state" style="margin-top:2rem;">
                <div class="empty-state-icon">📝</div>
                <h3>Loading Programs...</h3>
                <p>Establishing secure connection to database.</p>
            </div>
        </div>
    `;

    const catSel = document.getElementById('progCatSelect');
    const genderSel = document.getElementById('progGenderSelect');
    const stageSel = document.getElementById('progStageSelect');
    const btnCreateProgram = document.getElementById('btnCreateProgram');
    const btnCreateGeneralProgram = document.getElementById('btnCreateGeneralProgram');
    const searchInput = document.getElementById('progSearchInput');

    // Load Global Categories via Caching Layer
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

    if (catSel) {
        catSel.addEventListener('change', (e) => {
            currentCategoryId = e.target.value;
            if (btnCreateProgram) {
                if (currentCategoryId && currentCategoryId !== "general_programs") {
                    btnCreateProgram.disabled = false;
                } else {
                    btnCreateProgram.disabled = true;
                }
            }
            applyProgramFiltersAndRender();
        });
    }

    if (genderSel) {
        genderSel.addEventListener('change', () => {
            applyProgramFiltersAndRender();
        });
    }

    if (stageSel) {
        stageSel.addEventListener('change', () => {
            applyProgramFiltersAndRender();
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', debounce(() => {
            applyProgramFiltersAndRender();
        }, 300));
    }

    if (btnCreateProgram) {
        btnCreateProgram.addEventListener('click', () => {
            if (!currentCategoryId || currentCategoryId === 'general_programs') {
                window.showToast("Please select a category before creating a program.", "error");
                return;
            }
            openProgramModal();
        });
    }
    if (btnCreateGeneralProgram) btnCreateGeneralProgram.addEventListener('click', () => openGeneralProgramModal());

    // Scroll handler to close fixed menus when scrolling to prevent floating drifts
    const handleScroll = () => {
        const activeDropdown = document.querySelector('.active-body-dropdown');
        if (activeDropdown) activeDropdown.remove();
    };
    window.addEventListener('scroll', handleScroll, true);

    window.currentViewCleanup = () => {
        if (unsubscribePrograms) {
            unsubscribePrograms();
            unsubscribePrograms = null;
        }
        if (unsubscribeParticipants) {
            unsubscribeParticipants();
            unsubscribeParticipants = null;
        }
        if (unsubscribeResults) {
            unsubscribeResults();
            unsubscribeResults = null;
        }
        participantUnsubs.forEach(unsub => unsub());
        participantUnsubs = [];
        window.removeEventListener('scroll', handleScroll, true);
    };

    // Single delegated click listener on container for prog-dots-btn
    container.addEventListener('click', (e) => {
        const dotsBtn = e.target.closest('.prog-dots-btn');
        if (dotsBtn) {
            e.stopPropagation();
            openProgramsDropdown(dotsBtn);
        }
    });

    // Start live sync of all programs immediately
    loadProgramsAllData();
}

function debounce(fn, ms) {
    let t = null;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
}

function applyProgramFiltersAndRender() {
    const q = (document.getElementById('progSearchInput')?.value || '').trim().toLowerCase();
    const genderVal = document.getElementById('progGenderSelect')?.value || '';
    const stageVal = document.getElementById('progStageSelect')?.value || '';

    let filtered = localProgramsAll;

    // 1. Search locally by name, type, category name, or program number
    if (q) {
        const cleanQ = q.replace(/#/g, '');
        filtered = filtered.filter(p => {
            const nameMatch = (p.programName || '').toLowerCase().includes(q);
            const typeMatch = (p.programType || p.type || '').toLowerCase().includes(q);
            
            // find category name
            const cat = allCategories.find(c => c.id === p.categoryId || c.name === p.categoryId);
            const catName = cat?.name || (p.categoryId === 'general_programs' ? 'General' : p.categoryId || '');
            const catMatch = catName.toLowerCase().includes(q);

            // program number match
            const progNumStr = p.programNumber ? String(p.programNumber).toLowerCase() : '';
            const cleanProgNum = progNumStr.replace(/#/g, '');
            const numberMatch = cleanProgNum && cleanQ && cleanProgNum.includes(cleanQ);

            return nameMatch || typeMatch || catMatch || numberMatch;
        });
    }

    // 2. Cascaded category post-filter
    if (currentCategoryId) {
        if (currentCategoryId === "general_programs") {
            filtered = filtered.filter(p => (p.programType || p.type) === "general");
        } else {
            const cat = allCategories.find(c => c.id === currentCategoryId);
            filtered = filtered.filter(p => p.categoryId === currentCategoryId || p.categoryId === cat?.name);
        }
    }

    // 3. Gender post-filter
    if (genderVal) {
        filtered = filtered.filter(p => {
            const progGender = (p.genderCategory || 'Mixed').trim().toLowerCase();
            return progGender === genderVal.toLowerCase();
        });
    }

    // 4. Stage post-filter
    if (stageVal) {
        filtered = filtered.filter(p => {
            const progLoc = (p.programLocation || p.location || 'Off Stage').trim().toLowerCase();
            return progLoc === stageVal.toLowerCase();
        });
    }

    filtered.sort((a, b) => {
        const cleanA = String(a.programNumber || '').replace(/[^0-9]/g, '');
        const cleanB = String(b.programNumber || '').replace(/[^0-9]/g, '');
        
        const numA = parseInt(cleanA, 10);
        const numB = parseInt(cleanB, 10);
        
        const hasA = !isNaN(numA) && cleanA !== '';
        const hasB = !isNaN(numB) && cleanB !== '';
        
        if (hasA && hasB) {
            if (numA !== numB) return numA - numB;
            return (a.programName || '').localeCompare(b.programName || '');
        }
        if (hasA) return -1;
        if (hasB) return 1;
        
        return String(a.programNumber || '').localeCompare(String(b.programNumber || ''), undefined, { numeric: true });
    });

    localPrograms = filtered;
    renderProgramsUI();
}

function loadProgramsAllData() {
    if (unsubscribePrograms) unsubscribePrograms();
    if (unsubscribeResults) unsubscribeResults();
    participantUnsubs.forEach(unsub => unsub());
    participantUnsubs = [];

    const programsRef = collection(db, "institutes", window.currentInstituteId, "programs");
    unsubscribePrograms = onSnapshot(programsRef, async (snapshot) => {
        const rawProgs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        
        // Self-healing backfill for program numbers
        const needsBackfill = rawProgs.some(p => p.programNumber === undefined || p.programNumber === null);
        if (needsBackfill) {
            await backfillProgramNumbers(window.currentInstituteId, rawProgs);
            return;
        }

        localProgramsAll = rawProgs;
        window.cachedPrograms = { data: localProgramsAll, lastFetched: Date.now() };
        applyProgramFiltersAndRender();
    }, (err) => {
        console.error("Programs listener error:", err);
        window.showToast("Failed to load programs.", "error");
    });

    const resultsRef = collection(db, "institutes", window.currentInstituteId, "results");
    unsubscribeResults = onSnapshot(resultsRef, (snapshot) => {
        localResults = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderProgramsUI();
    }, (err) => {
        console.error("Results snapshot error in programs:", err);
    });
}



function renderProgramsUI() {
    const gridContainer = document.getElementById('programsGridContainer');
    if (!gridContainer) return;

    if (localPrograms.length === 0) {
        gridContainer.innerHTML = `
            <div class="programs-empty-state">
                <div class="programs-empty-icon">🎭</div>
                <h3>Program Management</h3>
                <p>No programs have been created yet.</p>
                ${currentCategoryId !== "general_programs" ? '<button class="btn btn-primary" id="btnCreateProgramEmpty" style="margin-top:0.75rem;">+ Create Program</button>' : ''}
            </div>`;
        const btnEmpty = document.getElementById("btnCreateProgramEmpty");
        if (btnEmpty) {
            btnEmpty.onclick = () => {
                if (!currentCategoryId || currentCategoryId === 'general_programs') {
                    window.showToast("Please select a category before creating a program.", "error");
                    return;
                }
                openProgramModal();
            };
        }
        return;
    }

    gridContainer.innerHTML = `
        <div class="programs-table">
            <div class="programs-table-header">
                <div>Sl No.</div>
                <div>Prog No.</div>
                <div>Program Name</div>
                <div>Program Type</div>
                <div>Location</div>
                <div>Category</div>
                <div>Participants</div>
                <div>Status</div>
                <div style="text-align: right;">Actions</div>
            </div>
            <div class="programs-table-body" id="programsGrid"></div>
        </div>
    `;

    const grid = document.getElementById('programsGrid');
    if (!grid) return;

    localPrograms.forEach((prog, idx) => {
        const progId = prog.id;

        const pType = (prog.programType || prog.type || 'individual').toLowerCase();
        let typeLabel = 'Individual';
        let typeBadgeClass = 'badge-individual';

        if (pType === 'group') {
            typeLabel = 'Group';
            typeBadgeClass = 'badge-group';
        } else if (pType === 'general') {
            typeLabel = 'General';
            typeBadgeClass = 'badge-general';
        }

        // Location Badges
        const rawLoc = prog.programLocation || prog.location || 'Off Stage';
        const locBadgeClass = rawLoc === 'Stage' ? 'badge-location-stage' : 'badge-location-offstage';

        // Category Info (Gender Category)
        const gender = prog.genderCategory || 'Mixed';
        let genderBadgeClass = 'badge-gender-mixed';
        if (gender === 'Boys') genderBadgeClass = 'badge-gender-boys';
        else if (gender === 'Girls') genderBadgeClass = 'badge-gender-girls';

        const cat = allCategories.find(c => c.id === prog.categoryId || c.name === prog.categoryId);
        const catName = cat?.name || (prog.categoryId === 'general_programs' ? 'General' : prog.categoryId || 'General');

        // Dynamic Program Status Calculation (Hierarchical Override Engine)
        const resDoc = localResults.find(r => r.programId === progId);
        let resultSubmitted = false;
        let resultPublished = false;
        if (resDoc) {
            if (resDoc.status === 'published') {
                resultPublished = true;
            }
            if (resDoc.markEntryStatus === 'submitted') {
                resultSubmitted = true;
            }
        }

        // Synchronous count render with fallback trigger
        const regType = prog.registrationType || pType;
        const isGroup = pType === 'group' || (pType === 'general' && regType === 'group');

        let partHTML = '';
        let showActiveStatus = false;
        if (prog.participantCount !== undefined) {
            const count = prog.participantCount;
            const text = isGroup ? `${count} ${count === 1 ? 'Team' : 'Teams'}` : `${count} Participant${count === 1 ? '' : 's'}`;
            partHTML = `<span class="program-participants-text">👥 ${text}</span>`;
            if (count > 0) showActiveStatus = true;
        } else {
            partHTML = `<span class="program-participants-text">👥 <span class="spinner-small" style="display:inline-block; width:10px; height:10px; border:2px solid #ccc; border-top:2px solid #000; border-radius:50%; animation:spin 1s linear infinite; margin-right:4px; vertical-align:middle;"></span> Migrating...</span>`;
            // Trigger self-healing background migration
            migrateParticipantCounts(window.currentInstituteId);
        }

        let status = 'Pending';
        let statusDotClass = 'status-dot-pending';

        if (resultSubmitted) {
            status = 'Submitted';
            statusDotClass = 'status-dot-submitted';
        } else if (resultPublished) {
            status = 'Published';
            statusDotClass = 'status-dot-published';
        } else if (showActiveStatus) {
            status = 'Active';
            statusDotClass = 'status-dot-active';
        }

        const isGeneral = pType === 'general';
        const rowClass = isGeneral ? 'program-row general-program-row' : 'program-row';

        const row = document.createElement('div');
        row.className = rowClass;
        
        const cellId = `prog-part-cell-${progId}`;
        const statusCellId = `prog-status-cell-${progId}`;

        row.innerHTML = `
            <div class="program-sl-cell" style="font-weight:700; color:#475569; font-size:0.85rem;">
                ${idx + 1}
            </div>
            <div class="program-no-cell" style="font-weight:800; color:#1e1b4b; font-size:0.85rem;">
                #${prog.programNumber || '—'}
            </div>
            <div class="program-name-cell">
                <div style="display:flex; flex-direction:column; gap:0.15rem;">
                    <span class="program-title-text">${window.escapeHTML(prog.programName)}</span>
                    ${prog.description ? `<span class="program-desc-text">${window.escapeHTML(prog.description)}</span>` : ''}
                </div>
            </div>
            <div class="program-type-cell">
                <span class="program-badge ${typeBadgeClass}">${typeLabel}</span>
            </div>
            <div class="program-location-cell">
                <span class="program-badge ${locBadgeClass}">${window.escapeHTML(rawLoc)}</span>
            </div>
            <div class="program-category-cell">
                <div style="display:flex; flex-direction:column; gap:0.25rem;">
                    <span class="program-category-name">${window.escapeHTML(catName)}</span>
                    <span class="program-badge ${genderBadgeClass}">${window.escapeHTML(gender)}</span>
                </div>
            </div>
            <div class="program-participants-cell" id="${cellId}">
                ${partHTML}
            </div>
            <div class="program-status-cell" id="${statusCellId}">
                <span class="status-indicator-badge">
                    <span class="status-dot ${statusDotClass}"></span>
                    <span class="status-text">${window.escapeHTML(status)}</span>
                </span>
            </div>
            <div class="program-actions-cell">
                <div class="actions-dropdown-container">
                    <button class="btn-action-icon btn-action-more dots-btn prog-dots-btn" 
                        data-id="${progId}">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" style="width:0.95rem; height:0.95rem;">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 12.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 18.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />
                        </svg>
                    </button>
                </div>
            </div>
        `;
        grid.appendChild(row);
    });
}

// ─────────────────────────────────────────────
// Default Program Templates
// ─────────────────────────────────────────────
const DEFAULT_PROGRAM_TEMPLATES = [
    { name: "Quran Recitation", type: "individual", location: "Stage", gender: "Mixed", description: "Holy Quran recitation competition" },
    { name: "Elocution English", type: "individual", location: "Stage", gender: "Mixed", description: "English speech competition" },
    { name: "Elocution Arabic", type: "individual", location: "Stage", gender: "Mixed", description: "Arabic speech competition" },
    { name: "Elocution Urdu", type: "individual", location: "Stage", gender: "Mixed", description: "Urdu speech competition" },
    { name: "Elocution Malayalam", type: "individual", location: "Stage", gender: "Mixed", description: "Malayalam speech competition" },
    { name: "Light Music", type: "individual", location: "Stage", gender: "Mixed", description: "Singing competition" },
    { name: "Poem Recitation English", type: "individual", location: "Stage", gender: "Mixed", description: "Reciting English poetry" },
    { name: "Poem Recitation Arabic", type: "individual", location: "Stage", gender: "Mixed", description: "Reciting Arabic poetry" },
    { name: "Poem Recitation Malayalam", type: "individual", location: "Stage", gender: "Mixed", description: "Reciting Malayalam poetry" },
    { name: "Story Telling", type: "individual", location: "Stage", gender: "Mixed", description: "Story telling competition" },
    { name: "Singing", type: "individual", location: "Stage", gender: "Mixed", description: "Vocal song competition" },
    { name: "Ghazal", type: "individual", location: "Stage", gender: "Mixed", description: "Ghazal singing competition" },
    { name: "Monologue", type: "individual", location: "Stage", gender: "Mixed", description: "Acting monologue" },

    { name: "Group Song", type: "group", groupSize: 5, location: "Stage", gender: "Mixed", description: "Group vocal performance" },
    { name: "Quiz Competition", type: "group", groupSize: 3, location: "Stage", gender: "Mixed", description: "General and Islamic quiz" },
    { name: "Duffmuttu", type: "group", groupSize: 7, location: "Stage", gender: "Boys", description: "Traditional Duff performance" },
    { name: "Oppana", type: "group", groupSize: 10, location: "Stage", gender: "Girls", description: "Traditional Oppana dance" },
    { name: "Kolkali", type: "group", groupSize: 8, location: "Stage", gender: "Boys", description: "Traditional Kolkali folk art" },
    { name: "Patriotic Song Group", type: "group", groupSize: 6, location: "Stage", gender: "Mixed", description: "Patriotic choral performance" },
    { name: "Choral Speaking", type: "group", groupSize: 12, location: "Stage", gender: "Mixed", description: "Group choral recitation" },

    { name: "Pencil Drawing", type: "individual", location: "Off Stage", gender: "Mixed", description: "Sketching/pencil shading" },
    { name: "Watercolor Painting", type: "individual", location: "Off Stage", gender: "Mixed", description: "Watercolor art" },
    { name: "Calligraphy Arabic", type: "individual", location: "Off Stage", gender: "Mixed", description: "Arabic script calligraphy" },
    { name: "Calligraphy English", type: "individual", location: "Off Stage", gender: "Mixed", description: "English script calligraphy" },
    { name: "Essay Writing English", type: "individual", location: "Off Stage", gender: "Mixed", description: "English essay writing" },
    { name: "Essay Writing Arabic", type: "individual", location: "Off Stage", gender: "Mixed", description: "Arabic essay writing" },
    { name: "Essay Writing Malayalam", type: "individual", location: "Off Stage", gender: "Mixed", description: "Malayalam essay writing" },
    { name: "Story Writing Malayalam", type: "individual", location: "Off Stage", gender: "Mixed", description: "Malayalam story writing" },
    { name: "Poem Writing Malayalam", type: "individual", location: "Off Stage", gender: "Mixed", description: "Malayalam poem writing" },
    { name: "Clay Modeling", type: "individual", location: "Off Stage", gender: "Mixed", description: "Clay sculpting competition" },
    { name: "Map Drawing", type: "individual", location: "Off Stage", gender: "Mixed", description: "Geographical map drawing" },
    { name: "Digital Painting", type: "individual", location: "Off Stage", gender: "Mixed", description: "Graphic digital illustration" },

    { name: "Collage making", type: "group", groupSize: 3, location: "Off Stage", gender: "Mixed", description: "Magazine collage collage art" },
    { name: "Wall Magazine", type: "group", groupSize: 4, location: "Off Stage", gender: "Mixed", description: "Wall poster/magazine creation" }
];

// ─────────────────────────────────────────────
// Add / Edit Program Modal (Bulk Creation Workflow Support)
// ─────────────────────────────────────────────
function openProgramModal(progId = null, data = {}) {
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');
    const modalOverlay = document.getElementById('dynamicModal');
    const modalEl = modalOverlay.querySelector('.modal');

    // Helper to close modal and reset size
    const handleClose = () => {
        if (modalEl) modalEl.classList.remove('modal-large');
        modalOverlay.classList.add('hidden');
    };

    if (progId) {
        // --- SINGLE EDIT MODE (Compatibility) ---
        if (modalEl) modalEl.classList.remove('modal-large');
        modalTitle.textContent = `Edit Program ${data.programNumber ? `#${data.programNumber}` : ''}`;
        const pType = (data.programType || data.type || 'individual').toLowerCase();
        const isGroup = pType === 'group';

        modalBody.innerHTML = `
            <form id="programForm" autocomplete="off">
                <div class="form-group">
                    <label class="form-label">Program Name *</label>
                    <input type="text" id="pName" class="form-input" required
                        value="${window.escapeHTML(data.programName || '')}">
                </div>
                <div class="form-group">
                    <label class="form-label">Description (Optional)</label>
                    <textarea id="pDesc" class="form-input" rows="2">${window.escapeHTML(data.description || '')}</textarea>
                </div>
                <div class="form-group">
                    <label class="form-label">Type *</label>
                    <select id="pType" class="form-input" required>
                        <option value="individual" ${!isGroup ? 'selected' : ''}>Individual</option>
                        <option value="group"      ${isGroup ? 'selected' : ''}>Group</option>
                    </select>
                </div>
                <div class="form-group" id="groupSizeRow" style="display:${isGroup ? 'block' : 'none'};">
                    <label class="form-label">Group Size * <span style="font-size:0.75rem;color:#94a3b8;">(max participants per team)</span></label>
                    <input type="number" id="pGroupSize" class="form-input" min="2" placeholder="e.g. 5"
                        value="${isGroup && (data.maxParticipants || data.groupSize) ? (data.maxParticipants || data.groupSize) : ''}">
                </div>
                <div class="form-group">
                    <label class="form-label">Program Location *</label>
                    <select id="pLocation" class="form-input" required>
                        <option value="Stage"     ${data.programLocation === 'Stage' ? 'selected' : ''}>Stage</option>
                        <option value="Off Stage" ${data.programLocation === 'Off Stage' ? 'selected' : ''}>Off Stage</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Gender Category *</label>
                    <select id="pGender" class="form-input" required>
                        <option value="Boys"  ${data.genderCategory === 'Boys' ? 'selected' : ''}>Boys</option>
                        <option value="Girls" ${data.genderCategory === 'Girls' ? 'selected' : ''}>Girls</option>
                        <option value="Mixed" ${data.genderCategory === 'Mixed' ? 'selected' : ''}>Mixed</option>
                    </select>
                </div>
                <div class="modal-actions" style="margin-top:1.25rem;">
                    <button type="submit" class="btn btn-primary w-full" id="saveProgBtn">
                        <span class="btn-text">Save Changes</span>
                        <span class="btn-spinner hidden"></span>
                    </button>
                </div>
            </form>
        `;

        modalOverlay.classList.remove('hidden');
        document.getElementById('closeDynamicModalBtn').onclick = handleClose;

        document.getElementById('pType').addEventListener('change', (e) => {
            const gsRow = document.getElementById('groupSizeRow');
            const gsIn = document.getElementById('pGroupSize');
            if (e.target.value === 'group') {
                gsRow.style.display = 'block';
                gsIn.required = true;
                if (!gsIn.value) gsIn.value = '5';
            } else {
                gsRow.style.display = 'none';
                gsIn.required = false;
                gsIn.value = '';
            }
        });

        document.getElementById('programForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const type = document.getElementById('pType').value;
            const gsRaw = document.getElementById('pGroupSize').value.trim();

            if (type === 'group') {
                const gsNum = parseInt(gsRaw, 10);
                if (!gsRaw || isNaN(gsNum) || gsNum < 2) {
                    window.showToast("Group size must be 2 or more.", "error");
                    return;
                }
            }

            const btn = document.getElementById('saveProgBtn');
            const text = btn.querySelector('.btn-text');
            const spinner = btn.querySelector('.btn-spinner');
            btn.disabled = true;
            text.classList.add('hidden');
            spinner.classList.remove('hidden');

            try {
                const payload = {
                    programName: document.getElementById('pName').value.trim(),
                    description: document.getElementById('pDesc').value.trim(),
                    programType: type,
                    maxParticipants: type === 'individual' ? null : parseInt(gsRaw, 10),
                    programLocation: document.getElementById('pLocation').value,
                    genderCategory: document.getElementById('pGender').value,
                    categoryId: data.categoryId || currentCategoryId
                };

                const progCollection = collection(db, "institutes", window.currentInstituteId, "programs");
                await updateDoc(doc(progCollection, progId), payload);
                window.showToast("Program updated.");
                await updateDashboardMetadata(window.currentInstituteId);
                invalidateProgramsCache(window.currentInstituteId);
                handleClose();
            } catch (err) {
                console.error(err);
                window.showToast("Error saving program.", "error");
            } finally {
                btn.disabled = false;
                text.classList.remove('hidden');
                spinner.classList.add('hidden');
            }
        });
    } else {
        // --- BULK CREATE MODE ---
        if (!currentCategoryId || currentCategoryId === 'general_programs') {
            window.showToast("Please select a category before creating a program.", "error");
            return;
        }
        if (modalEl) modalEl.classList.add('modal-large');

        modalTitle.textContent = "Bulk Add Programs";
        const categoryOptionsHTML = allCategories.map(cat => {
            const selected = cat.id === currentCategoryId ? 'selected' : '';
            return `<option value="${cat.id}" ${selected}>${window.escapeHTML(cat.name)}</option>`;
        }).join('');

        modalBody.innerHTML = `
            <div class="bulk-prog-container">
                <!-- Filter Section -->
                <div class="bulk-filter-bar" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:0.5rem; margin-bottom:1rem; padding:0.75rem; background:#f8fafc; border:1.5px solid #e2e8f0; border-radius:10px; transition: opacity 0.2s ease;">
                    <div class="form-group-compact" style="display:flex; flex-direction:column; gap:0.15rem;">
                        <label class="form-label-compact" style="font-size:0.68rem; font-weight:700; color:#64748b; text-transform:uppercase;">Category</label>
                        <select id="bulkCat" class="form-input-compact select-premium" style="font-size:0.78rem; padding:0.35rem 0.5rem; border-radius:6px; border:1px solid #e2e8f0;">
                            ${categoryOptionsHTML}
                        </select>
                    </div>
                    <div class="form-group-compact" style="display:flex; flex-direction:column; gap:0.15rem;">
                        <label class="form-label-compact" style="font-size:0.68rem; font-weight:700; color:#64748b; text-transform:uppercase;">Type Scope</label>
                        <select id="bulkTypeScope" class="form-input-compact select-premium" style="font-size:0.78rem; padding:0.35rem 0.5rem; border-radius:6px; border:1px solid #e2e8f0;">
                            <option value="competition" selected>Competition Program</option>
                            <option value="general">General Program</option>
                        </select>
                    </div>
                    <div class="form-group-compact" style="display:flex; flex-direction:column; gap:0.15rem;">
                        <label class="form-label-compact" style="font-size:0.68rem; font-weight:700; color:#64748b; text-transform:uppercase;">Gender</label>
                        <select id="bulkGender" class="form-input-compact select-premium" style="font-size:0.78rem; padding:0.35rem 0.5rem; border-radius:6px; border:1px solid #e2e8f0;">
                            <option value="Boys" selected>Boys</option>
                            <option value="Girls">Girls</option>
                            <option value="Mixed">Mixed</option>
                        </select>
                    </div>
                </div>

                <!-- Custom program rows list -->
                <div class="bulk-table-container" style="max-height: 40vh; overflow-y: auto; border: 1.5px solid #e2e8f0; border-radius: 10px; margin-bottom: 1rem; background: #ffffff;">
                    <table class="bulk-table" style="width:100%; border-collapse:collapse; font-size:0.8rem; text-align:left;">
                        <thead style="background:#f8fafc; position:sticky; top:0; z-index:10; border-bottom:1.5px solid #e2e8f0;">
                            <tr>
                                <th style="padding:0.6rem 0.75rem; width:40px; border-bottom:1.5px solid #e2e8f0;"><input type="checkbox" id="bulkSelectAll" checked style="cursor:pointer;" /></th>
                                <th style="padding:0.6rem 0.75rem; border-bottom:1.5px solid #e2e8f0;">Program Name *</th>
                                <th style="padding:0.6rem 0.75rem; width:130px; border-bottom:1.5px solid #e2e8f0;">Location *</th>
                                <th style="padding:0.6rem 0.75rem; width:120px; border-bottom:1.5px solid #e2e8f0;">Type *</th>
                                <th style="padding:0.6rem 0.75rem; width:100px; border-bottom:1.5px solid #e2e8f0;">Group Size</th>
                                <th style="padding:0.6rem 0.75rem; width:70px; border-bottom:1.5px solid #e2e8f0; text-align:center;">Action</th>
                            </tr>
                        </thead>
                        <tbody id="bulkTableBody">
                            <!-- Empty State initially -->
                        </tbody>
                    </table>
                </div>

                <!-- Footer actions inside body -->
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem; margin-bottom:1rem;">
                    <button type="button" class="btn btn-general btn-sm" id="bulkAddCustomRow" style="font-size:0.75rem; padding:0.35rem 0.75rem;">+ Add Custom Program</button>
                    <div style="font-size:0.75rem; color:#64748b; font-weight:600;" id="bulkSelectionStats">0 / 0 Selected</div>
                </div>

                <div class="modal-actions" style="border-top:1.5px solid #e2e8f0; padding-top:0.75rem; margin-top:0.5rem; display:flex; justify-content:flex-end; gap:0.5rem;">
                    <button type="button" class="btn btn-secondary" id="bulkCloseBtn" style="font-weight:700;">Cancel</button>
                    <button type="button" class="btn btn-primary" id="bulkSaveBtn" style="font-weight:700;">
                        <span class="btn-text" id="bulkSaveText">Create Selected Programs</span>
                        <span class="btn-spinner hidden" id="bulkSaveSpinner"></span>
                    </button>
                </div>
            </div>
        `;

        modalOverlay.classList.remove('hidden');
        document.getElementById('closeDynamicModalBtn').onclick = handleClose;
        document.getElementById('bulkCloseBtn').onclick = handleClose;

        // Lock selectors when rows exist
        const updateFiltersLockState = () => {
            const hasRows = document.querySelectorAll('.bulk-row').length > 0;
            document.getElementById('bulkCat').disabled = hasRows;
            document.getElementById('bulkTypeScope').disabled = hasRows;
            document.getElementById('bulkGender').disabled = hasRows;

            const filterBar = document.querySelector('.bulk-filter-bar');
            if (filterBar) {
                filterBar.style.opacity = hasRows ? '0.7' : '1';
            }
            if (!hasRows) {
                const typeScopeVal = document.getElementById('bulkTypeScope').value;
                if (typeScopeVal === 'general') {
                    document.getElementById('bulkCat').disabled = true;
                    document.getElementById('bulkCat').closest('.form-group-compact').style.opacity = '0.5';
                } else {
                    document.getElementById('bulkCat').closest('.form-group-compact').style.opacity = '1';
                }
            }
        };

        // Dynamic metrics update
        const updateBulkStats = () => {
            const checks = document.querySelectorAll('.bulk-row-check');
            const checkedCount = Array.from(checks).filter(c => c.checked).length;
            document.getElementById('bulkSelectionStats').textContent = `${checkedCount} / ${checks.length} Selected`;
            const selectAll = document.getElementById('bulkSelectAll');
            if (selectAll) {
                selectAll.checked = (checkedCount === checks.length && checks.length > 0);
            }
        };

        const renderEmptyState = () => {
            const tbody = document.getElementById('bulkTableBody');
            tbody.innerHTML = `
                <tr id="bulkEmptyState">
                    <td colspan="6" style="text-align:center; padding:2.5rem 0; color:#94a3b8; font-style:italic;">
                        No custom programs added yet. Complete selections above and click "+ Add Custom Program".
                    </td>
                </tr>
            `;
            updateBulkStats();
            updateFiltersLockState();
        };

        // Type Scope listener (toggles category accessibility)
        document.getElementById('bulkTypeScope').addEventListener('change', (e) => {
            const catGroup = document.getElementById('bulkCat').closest('.form-group-compact');
            if (e.target.value === 'general') {
                catGroup.style.opacity = '0.5';
                document.getElementById('bulkCat').disabled = true;
            } else {
                catGroup.style.opacity = '1';
                document.getElementById('bulkCat').disabled = false;
            }
        });

        // Add custom row functionality
        document.getElementById('bulkAddCustomRow').onclick = () => {
            const catId = document.getElementById('bulkCat').value;
            const typeScope = document.getElementById('bulkTypeScope').value;
            const gender = document.getElementById('bulkGender').value;

            if (typeScope === 'competition' && !catId) {
                window.showToast("Category is required for competition programs.", "error");
                return;
            }
            if (!gender) {
                window.showToast("Please ensure gender selection is complete.", "error");
                return;
            }

            const tbody = document.getElementById('bulkTableBody');
            const emptyState = document.getElementById('bulkEmptyState');
            if (emptyState) {
                tbody.removeChild(emptyState);
            }

            const tr = document.createElement('tr');
            tr.className = 'bulk-row';
            tr.innerHTML = `
                <td style="padding:0.45rem 0.75rem; border-bottom:1px solid #e2e8f0; vertical-align: middle;"><input type="checkbox" class="bulk-row-check" checked style="cursor:pointer;" /></td>
                <td style="padding:0.45rem 0.75rem; border-bottom:1px solid #e2e8f0; vertical-align: middle;"><input type="text" class="bulk-row-name form-input" placeholder="Program Name *" style="font-size:0.75rem; width:100%; border:1px solid #cbd5e1; border-radius:4px; padding:0.25rem 0.4rem; height:auto; min-height:initial;" /></td>
                <td style="padding:0.45rem 0.75rem; border-bottom:1px solid #e2e8f0; vertical-align: middle;">
                    <select class="bulk-row-loc form-input" style="font-size:0.75rem; width:100%; border:1px solid #cbd5e1; border-radius:4px; padding:0.2rem 0.4rem; height:auto; min-height:initial;">
                        <option value="Stage" selected>Stage</option>
                        <option value="Off Stage">Off Stage</option>
                    </select>
                </td>
                <td style="padding:0.45rem 0.75rem; border-bottom:1px solid #e2e8f0; vertical-align: middle;">
                    <select class="bulk-row-type form-input" style="font-size:0.75rem; width:100%; border:1px solid #cbd5e1; border-radius:4px; padding:0.2rem 0.4rem; height:auto; min-height:initial;">
                        <option value="individual" selected>Individual</option>
                        <option value="group">Group</option>
                    </select>
                </td>
                <td style="padding:0.45rem 0.75rem; border-bottom:1px solid #e2e8f0; vertical-align: middle;"><input type="number" class="bulk-row-size form-input" min="2" placeholder="Size" style="font-size:0.75rem; width:100%; border:1px solid #cbd5e1; border-radius:4px; padding:0.25rem 0.4rem; display:none; height:auto; min-height:initial;" /></td>
                <td style="padding:0.45rem 0.75rem; border-bottom:1px solid #e2e8f0; text-align:center; vertical-align: middle;">
                    <button type="button" class="bulk-row-delete" style="background:none; border:none; color:#ef4444; font-size:1.3rem; cursor:pointer; padding:0 0.25rem; line-height:1; font-weight:700;" title="Delete Row">&times;</button>
                </td>
            `;
            tbody.appendChild(tr);
            updateBulkStats();
            updateFiltersLockState();
        };

        // Table event handlers delegation
        const tableBody = document.getElementById('bulkTableBody');
        tableBody.addEventListener('change', (e) => {
            if (e.target.classList.contains('bulk-row-type')) {
                const row = e.target.closest('tr');
                const sizeInput = row.querySelector('.bulk-row-size');
                if (e.target.value === 'group') {
                    sizeInput.style.display = 'block';
                    sizeInput.required = true;
                    if (!sizeInput.value) sizeInput.value = '5';
                } else {
                    sizeInput.style.display = 'none';
                    sizeInput.required = false;
                    sizeInput.value = '';
                }
            }
            updateBulkStats();
        });

        tableBody.addEventListener('click', (e) => {
            if (e.target.classList.contains('bulk-row-check')) {
                updateBulkStats();
            } else if (e.target.classList.contains('bulk-row-delete')) {
                const row = e.target.closest('tr');
                row.remove();
                
                const tbody = document.getElementById('bulkTableBody');
                if (tbody.querySelectorAll('.bulk-row').length === 0) {
                    renderEmptyState();
                } else {
                    updateBulkStats();
                    updateFiltersLockState();
                }
            }
        });

        document.getElementById('bulkSelectAll').onclick = (e) => {
            const checked = e.target.checked;
            document.querySelectorAll('.bulk-row-check').forEach(c => c.checked = checked);
            updateBulkStats();
        };

        // Save selected batch programs
        document.getElementById('bulkSaveBtn').onclick = async () => {
            const catId = document.getElementById('bulkCat').value;
            const typeScope = document.getElementById('bulkTypeScope').value;
            const gender = document.getElementById('bulkGender').value;

            const rows = document.querySelectorAll('.bulk-row');
            const selectedPayloads = [];

            for (const row of rows) {
                const checked = row.querySelector('.bulk-row-check').checked;
                if (!checked) continue;

                const name = row.querySelector('.bulk-row-name').value.trim();
                if (!name) {
                    window.showToast("Program name cannot be blank.", "error");
                    return;
                }

                const location = row.querySelector('.bulk-row-loc').value;
                const pType = row.querySelector('.bulk-row-type').value;
                const sizeVal = row.querySelector('.bulk-row-size').value.trim();

                let maxParticipants = null;
                if (typeScope === 'competition') {
                    if (pType === 'group') {
                        const sizeNum = parseInt(sizeVal, 10);
                        if (!sizeVal || isNaN(sizeNum) || sizeNum < 2) {
                            window.showToast(`Group size for program "${name}" must be 2 or more.`, "error");
                            return;
                        }
                        maxParticipants = sizeNum;
                    }

                    selectedPayloads.push({
                        programName: name,
                        description: "",
                        programType: pType,
                        maxParticipants: maxParticipants,
                        programLocation: location,
                        genderCategory: gender,
                        categoryId: catId
                    });
                } else {
                    if (pType === 'group') {
                        const sizeNum = parseInt(sizeVal, 10);
                        if (sizeVal && (isNaN(sizeNum) || sizeNum < 2)) {
                            window.showToast(`Group size for program "${name}" must be 2 or more.`, "error");
                            return;
                        }
                        maxParticipants = sizeNum || null;
                    }

                    selectedPayloads.push({
                        programName: name,
                        description: "",
                        location: location,
                        programLocation: location,
                        genderCategory: gender,
                        registrationType: pType === 'group' ? 'group' : 'individual',
                        maxParticipants: maxParticipants,
                        leaderboardEnabled: true,
                        programType: "general",
                        categoryId: "general_programs"
                    });
                }
            }

            if (selectedPayloads.length === 0) {
                window.showToast("No programs selected for creation.", "error");
                return;
            }

            // Real-time duplicates warnings warning check before commits
            let hasDuplicate = false;
            for (const payload of selectedPayloads) {
                const exists = localProgramsAll.some(p => 
                    p.categoryId === payload.categoryId &&
                    p.programName.trim().toLowerCase() === payload.programName.toLowerCase() &&
                    (p.programLocation || p.location) === payload.programLocation &&
                    p.genderCategory === payload.genderCategory
                );
                if (exists) {
                    hasDuplicate = true;
                    break;
                }
            }
            if (hasDuplicate) {
                const proceed = await window.customConfirm("Warning: One or more of the programs already exists in this category/gender/location combination. Do you still want to proceed and create duplicates?");
                if (!proceed) return;
            }

            const btn = document.getElementById('bulkSaveBtn');
            const text = document.getElementById('bulkSaveText');
            const spinner = document.getElementById('bulkSaveSpinner');

            btn.disabled = true;
            text.classList.add('hidden');
            spinner.classList.remove('hidden');

            try {
                const progCollection = collection(db, "institutes", window.currentInstituteId, "programs");
                const batch = writeBatch(db);

                let maxNum = localProgramsAll.reduce((max, p) => (p.programNumber && p.programNumber > max ? p.programNumber : max), 100);

                selectedPayloads.forEach(payload => {
                    maxNum++;
                    payload.programNumber = maxNum;
                    payload.createdAt = serverTimestamp();
                    const newDocRef = doc(progCollection);
                    batch.set(newDocRef, payload);
                });

                await batch.commit();
                window.showToast(`Successfully created ${selectedPayloads.length} programs.`);

                await updateDashboardMetadata(window.currentInstituteId);
                invalidateProgramsCache(window.currentInstituteId);
                handleClose();
            } catch (err) {
                console.error("Bulk save error:", err);
                window.showToast("Error saving programs.", "error");
            } finally {
                btn.disabled = false;
                text.classList.remove('hidden');
                spinner.classList.add('hidden');
            }
        };

        // Initialize empty state
        renderEmptyState();
    }
}

// ─────────────────────────────────────────────
// Add / Edit General Program Modal
// ─────────────────────────────────────────────
function openGeneralProgramModal(progId = null, data = {}) {
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');
    const modalOverlay = document.getElementById('dynamicModal');

    modalTitle.textContent = progId ? `Edit General Program ${data.programNumber ? `#${data.programNumber}` : ''}` : "Add General Program";
    const regType = data.registrationType || 'individual';
    const isLeaderboardEnabled = data.leaderboardEnabled !== false;

    modalBody.innerHTML = `
        <form id="generalProgramForm" autocomplete="off">
            <div class="form-group">
                <label class="form-label">Program Name *</label>
                <input type="text" id="pName" class="form-input" required
                    value="${window.escapeHTML(data.programName || '')}">
            </div>
            <div class="form-group">
                <label class="form-label">Description (Optional)</label>
                <textarea id="pDesc" class="form-input" rows="2">${window.escapeHTML(data.description || '')}</textarea>
            </div>
            <div class="form-group">
                <label class="form-label">Program Type</label>
                <input type="text" class="form-input" value="General" readonly disabled style="background:#f1f5f9; cursor:not-allowed;">
            </div>
            <div class="form-group">
                <label class="form-label">Program Location *</label>
                <select id="pLocation" class="form-input" required>
                    <option value="Stage"     ${(data.location || data.programLocation) === 'Stage' ? 'selected' : ''}>Stage</option>
                    <option value="Off Stage" ${(data.location || data.programLocation) === 'Off Stage' ? 'selected' : ''}>Off Stage</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Gender Category *</label>
                <select id="pGender" class="form-input" required>
                    <option value="Boys"  ${data.genderCategory === 'Boys' ? 'selected' : ''}>Boys</option>
                    <option value="Girls" ${data.genderCategory === 'Girls' ? 'selected' : ''}>Girls</option>
                    <option value="Mixed" ${data.genderCategory === 'Mixed' ? 'selected' : ''}>Mixed</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Registration Type *</label>
                <select id="pRegType" class="form-input" required>
                    <option value="individual" ${regType === 'individual' ? 'selected' : ''}>Individual Registration</option>
                    <option value="group"      ${regType === 'group' ? 'selected' : ''}>Group Registration</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Maximum Participants (Optional)</label>
                <input type="number" id="pMaxParticipants" class="form-input" min="1" placeholder="e.g. 5"
                    value="${data.maxParticipants || ''}">
            </div>
            <div class="form-group" style="display:flex; align-items:center; gap:0.5rem; margin-top:1rem;">
                <input type="checkbox" id="pLeaderboard" style="width:1.2rem; height:1.2rem; cursor:pointer;" ${isLeaderboardEnabled ? 'checked' : ''}>
                <label for="pLeaderboard" class="form-label" style="margin-bottom:0; cursor:pointer; font-weight:600;">Count In Team Leaderboard</label>
            </div>
            <div class="modal-actions" style="margin-top:1.25rem;">
                <button type="submit" class="btn btn-general w-full" id="saveProgBtn">
                    <span class="btn-text">${progId ? 'Save Changes' : 'Add General Program'}</span>
                    <span class="btn-spinner hidden"></span>
                </button>
            </div>
        </form>
    `;

    modalOverlay.classList.remove('hidden');
    document.getElementById('closeDynamicModalBtn').onclick = () => modalOverlay.classList.add('hidden');

    document.getElementById('generalProgramForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const btn = document.getElementById('saveProgBtn');
        const text = btn.querySelector('.btn-text');
        const spinner = btn.querySelector('.btn-spinner');
        btn.disabled = true;
        text.classList.add('hidden');
        spinner.classList.remove('hidden');

        try {
            const locVal = document.getElementById('pLocation').value;
            const maxPartVal = document.getElementById('pMaxParticipants').value.trim();
            const payload = {
                programName: document.getElementById('pName').value.trim(),
                description: document.getElementById('pDesc').value.trim(),
                location: locVal,
                programLocation: locVal, // support both
                genderCategory: document.getElementById('pGender').value,
                registrationType: document.getElementById('pRegType').value,
                maxParticipants: maxPartVal ? parseInt(maxPartVal, 10) : null,
                leaderboardEnabled: document.getElementById('pLeaderboard').checked,
                programType: "general",
                categoryId: "general_programs" // standard category placeholder for listing
            };

            const progCollection = collection(db, "institutes", window.currentInstituteId, "programs");

            if (progId) {
                await updateDoc(doc(progCollection, progId), payload);
                window.showToast("General Program updated.");
            } else {
                payload.createdAt = serverTimestamp();
                const maxNum = localProgramsAll.reduce((max, p) => (p.programNumber && p.programNumber > max ? p.programNumber : max), 100);
                payload.programNumber = maxNum + 1;
                await addDoc(progCollection, payload);
                window.showToast("General Program added.");
            }
            await updateDashboardMetadata(window.currentInstituteId);
            invalidateProgramsCache(window.currentInstituteId);
            modalOverlay.classList.add('hidden');
        } catch (err) {
            console.error(err);
            window.showToast("Error saving general program.", "error");
        } finally {
            btn.disabled = false;
            text.classList.remove('hidden');
            spinner.classList.add('hidden');
        }
    });
}

// ─────────────────────────────────────────────
// Participants Modal (deprecated)
// ─────────────────────────────────────────────
// NOTE: This file was accidentally corrupted with a half-pasted/deprecated Participants modal.
// Participants management is implemented in `js/participants-workflow.js` instead.
// Keeping this section intentionally empty to ensure programs.js stays valid JS.


// ─────────────────────────────────────────────
// Delete Program (Full Cascade)
// ─────────────────────────────────────────────
async function deleteProgram(id) {
    const confirmed = await window.customConfirm("Delete this program? All participants, results, and judge assignments will also be removed.");
    if (!confirmed) return;
    try {
        const instId = window.currentInstituteId;
        const batch = writeBatch(db);

        // 1. Delete all participants subcollection docs
        const pSnap = await getDocs(collection(db, "institutes", instId, "programs", id, "participants"));
        pSnap.forEach(d => batch.delete(d.ref));

        // 2. Find and delete linked results + clean judge assignments
        const resultsSnap = await getDocs(query(
            collection(db, "institutes", instId, "results"),
            where("programId", "==", id)
        ));

        if (!resultsSnap.empty) {
            const judgesSnap = await getDocs(collection(db, "institutes", instId, "judges"));
            for (const resDoc of resultsSnap.docs) {
                const r = resDoc.data();
                const progName = r.programName || '';

                // Remove this program from each judge's competitions[]
                judgesSnap.forEach(jDoc => {
                    const j = jDoc.data();
                    const comps = Array.isArray(j.competitions) ? j.competitions : [];
                    const compIds = Array.isArray(j.competitionIds) ? j.competitionIds : [];
                    const wasAssigned = Array.isArray(r.judges) && r.judges.includes(j.name);
                    if (wasAssigned && comps.includes(progName)) {
                        const newComps = comps.filter(c => c !== progName);
                        const newCompIds = compIds.filter(cid => cid !== r.programId);
                        batch.update(jDoc.ref, { 
                            competitions: newComps, 
                            competitionIds: newCompIds, 
                            updatedAt: serverTimestamp() 
                        });
                    }
                });

                // Delete the result doc
                batch.delete(resDoc.ref);
            }
        }

        // 3. Delete the program document itself
        batch.delete(doc(db, "institutes", instId, "programs", id));

        await batch.commit();
        await updateDashboardMetadata(instId);
        invalidateProgramsCache(instId);
        window.showToast("Program and all related data deleted.");
    } catch (e) {
        console.error(e);
        window.showToast("Error deleting program.", "error");
    }
}

function openProgramsDropdown(btn) {
    // 1. Remove any existing dynamic body-appended dropdown
    const existing = document.querySelector('.active-body-dropdown');
    if (existing) existing.remove();

    // 2. Create the dropdown element
    const dropdown = document.createElement('div');
    dropdown.className = 'actions-dropdown-menu active-body-dropdown';
    
    // Get datasets
    const id = btn.dataset.id;

    dropdown.innerHTML = `
        <button class="dropdown-item btn-view-parts" style="display:flex; align-items:center; gap:0.5rem; width:100%; border:none; background:transparent; padding:0.5rem 0.85rem; font-size:12px; font-weight:600; color:#475569; text-align:left; cursor:pointer;">
            👥 Add Students
        </button>
        <button class="dropdown-item btn-edit-prog" style="display:flex; align-items:center; gap:0.5rem; width:100%; border:none; background:transparent; padding:0.5rem 0.85rem; font-size:12px; font-weight:600; color:#475569; text-align:left; cursor:pointer;">
            ✏️ Edit Program
        </button>
        <button class="dropdown-item btn-delete-prog text-danger" style="display:flex; align-items:center; gap:0.5rem; width:100%; border:none; background:transparent; padding:0.5rem 0.85rem; font-size:12px; font-weight:600; color:#dc2626; text-align:left; cursor:pointer;">
            🗑️ Delete Program
        </button>
    `;

    // 3. Append directly to body
    document.body.appendChild(dropdown);

    // 4. Position fixed menu dynamically to avoid clipping
    const rect = btn.getBoundingClientRect();
    const menuWidth = 155;
    const menuHeight = 120;

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
    dropdown.querySelector('.btn-view-parts').addEventListener('click', () => {
        dropdown.remove();
        const allData = getProgramFromLocalCache(id);
        window.navigateToParticipantsWorkflow?.(id, allData);
    });

    dropdown.querySelector('.btn-edit-prog').addEventListener('click', () => {
        dropdown.remove();
        const allData = getProgramFromLocalCache(id);
        const type = (allData.programType || allData.type || 'individual').toLowerCase();
        if (type === 'general') {
            openGeneralProgramModal(id, allData);
        } else {
            openProgramModal(id, allData);
        }
    });

    dropdown.querySelector('.btn-delete-prog').addEventListener('click', () => {
        dropdown.remove();
        deleteProgram(id);
    });
}

// Self-healing backfill function to assign sequential program numbers starting at 101
async function backfillProgramNumbers(instId, programs) {
    if (!instId || !Array.isArray(programs) || programs.length === 0) return;
    const sorted = [...programs].sort((a, b) => {
        const timeA = a.createdAt?.seconds || a.createdAt?.toMillis?.() || 0;
        const timeB = b.createdAt?.seconds || b.createdAt?.toMillis?.() || 0;
        if (timeA !== timeB) return timeA - timeB;
        return (a.programName || '').localeCompare(b.programName || '');
    });
    const batch = writeBatch(db);
    let updatedCount = 0;
    sorted.forEach((p, index) => {
        const newNumber = 101 + index;
        if (p.programNumber !== newNumber) {
            const progDocRef = doc(db, "institutes", instId, "programs", p.id);
            batch.update(progDocRef, { programNumber: newNumber });
            p.programNumber = newNumber;
            updatedCount++;
        }
    });
    if (updatedCount > 0) {
        try {
            await batch.commit();
            console.log(`Backfilled ${updatedCount} programs with sequential numbers.`);
        } catch (e) {
            console.error("Failed to backfill program numbers:", e);
        }
    }
}

function getProgramFromLocalCache(id) {
    return localProgramsAll.find(p => p.id === id);
}

