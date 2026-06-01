import { db } from './firebase.js';
import {
    collection, addDoc, getDocs, doc, deleteDoc, updateDoc, setDoc,
    onSnapshot, serverTimestamp, writeBatch, query, where, collectionGroup
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
                <div class="search-input-wrapper">
                    <span class="search-icon">🔍</span>
                    <input type="text" id="progSearchInput" class="form-input search-input-premium" placeholder="Search program..." />
                </div>
                <select id="progCatSelect" class="form-input select-premium" style="width: 230px;">
                    <option value="">Select Category...</option>
                    <option value="general_programs">⭐ General Programs (Non-Category)</option>
                </select>
                <button class="btn btn-general" id="btnCreateGeneralProgram">+ General</button>
                <button class="btn btn-primary" id="btnCreateProgram" disabled>+ Program</button>
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
    const btnCreateProgram = document.getElementById('btnCreateProgram');
    const btnCreateGeneralProgram = document.getElementById('btnCreateGeneralProgram');
    const searchInput = document.getElementById('progSearchInput');

    // Load Global Categories
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

    if (searchInput) {
        searchInput.addEventListener('input', debounce(() => {
            applyProgramFiltersAndRender();
        }, 300));
    }

    if (btnCreateProgram) btnCreateProgram.addEventListener('click', () => openProgramModal());
    if (btnCreateGeneralProgram) btnCreateGeneralProgram.addEventListener('click', () => openGeneralProgramModal());

    // Scroll handler to close fixed menus when scrolling to prevent floating drifts
    window.addEventListener('scroll', () => {
        const activeDropdown = document.querySelector('.active-body-dropdown');
        if (activeDropdown) activeDropdown.remove();
    }, true);

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

    let filtered = localProgramsAll;

    // 1. Search locally by name, type, or category name
    if (q) {
        filtered = filtered.filter(p => {
            const nameMatch = (p.programName || '').toLowerCase().includes(q);
            const typeMatch = (p.programType || p.type || '').toLowerCase().includes(q);
            
            // find category name
            const cat = allCategories.find(c => c.id === p.categoryId || c.name === p.categoryId);
            const catName = cat?.name || (p.categoryId === 'general_programs' ? 'General' : p.categoryId || '');
            const catMatch = catName.toLowerCase().includes(q);

            return nameMatch || typeMatch || catMatch;
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

    localPrograms = filtered;
    renderProgramsUI();
}

function loadProgramsAllData() {
    if (unsubscribePrograms) unsubscribePrograms();
    if (unsubscribeResults) unsubscribeResults();
    participantUnsubs.forEach(unsub => unsub());
    participantUnsubs = [];

    const programsRef = collection(db, "institutes", window.currentInstituteId, "programs");
    unsubscribePrograms = onSnapshot(programsRef, (snapshot) => {
        localProgramsAll = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        setupParticipantsListeners();
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

function setupParticipantsListeners() {
    // Unsubscribe from any active subcollection listeners
    participantUnsubs.forEach(unsub => unsub());
    participantUnsubs = [];

    if (localProgramsAll.length === 0) {
        localParticipants = [];
        renderProgramsUI();
        return;
    }

    const participantsMap = new Map();

    localProgramsAll.forEach(prog => {
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

            renderProgramsUI();
        }, (err) => {
            console.error(`Participants subcollection listener error for ${progId}:`, err);
            participantsMap.set(progId, []);

            const allParts = [];
            participantsMap.forEach(parts => {
                allParts.push(...parts);
            });
            localParticipants = allParts;

            renderProgramsUI();
        });

        participantUnsubs.push(unsub);
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
            btnEmpty.onclick = () => openProgramModal();
        }
        return;
    }

    gridContainer.innerHTML = `
        <div class="programs-table">
            <div class="programs-table-header">
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

    localPrograms.forEach(prog => {
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

        // Participant Count Calculation from localParticipants
        let participantCount = 0;
        let participantText = '0 Registrations';
        if (pType === 'group') {
            let groupCount = 0;
            localParticipants.forEach(p => {
                if (p.programId === progId && p.type === 'group' && Array.isArray(p.groups)) {
                    groupCount += p.groups.length;
                }
            });
            participantCount = groupCount;
            participantText = `${groupCount} Teams`;
        } else if (pType === 'general') {
            if (prog.registrationType === 'group') {
                let groupCount = 0;
                localParticipants.forEach(p => {
                    if (p.programId === progId && p.type === 'group' && Array.isArray(p.groups)) {
                        groupCount += p.groups.length;
                    }
                });
                participantCount = groupCount;
                participantText = `${groupCount} Teams`;
            } else {
                let count = 0;
                localParticipants.forEach(p => {
                    if (p.programId === progId && p.type === 'individual') {
                        count++;
                    }
                });
                participantCount = count;
                participantText = `${count} Registrations`;
            }
        } else {
            let count = 0;
            localParticipants.forEach(p => {
                if (p.programId === progId && p.type === 'individual') {
                    count++;
                }
            });
            participantCount = count;
            participantText = `${count} Participants`;
        }

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

        let status = 'Pending';
        let statusDotClass = 'status-dot-pending';

        if (participantCount > 0) {
            status = 'Active';
            statusDotClass = 'status-dot-active';
        }
        if (resultSubmitted) {
            status = 'Submitted';
            statusDotClass = 'status-dot-submitted';
        }
        if (resultPublished) {
            status = 'Published';
            statusDotClass = 'status-dot-published';
        }

        const isGeneral = pType === 'general';
        const rowClass = isGeneral ? 'program-row general-program-row' : 'program-row';

        const row = document.createElement('div');
        row.className = rowClass;
        row.innerHTML = `
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
            <div class="program-participants-cell">
                <span class="program-participants-text">👥 ${participantText}</span>
            </div>
            <div class="program-status-cell">
                <span class="status-indicator-badge">
                    <span class="status-dot ${statusDotClass}"></span>
                    <span class="status-text">${window.escapeHTML(status)}</span>
                </span>
            </div>
            <div class="program-actions-cell">
                <div class="actions-dropdown-container">
                    <button class="btn-action-icon btn-action-more dots-btn prog-dots-btn" 
                        data-id="${progId}" 
                        data-all='${JSON.stringify(prog).replace(/'/g, "&#39;")}'>
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
// Add / Edit Program Modal
// ─────────────────────────────────────────────
function openProgramModal(progId = null, data = {}) {
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');
    const modalOverlay = document.getElementById('dynamicModal');

    modalTitle.textContent = progId ? "Edit Program" : "Add Program";
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
                    <span class="btn-text">${progId ? 'Save Changes' : 'Add Program'}</span>
                    <span class="btn-spinner hidden"></span>
                </button>
            </div>
        </form>
    `;

    modalOverlay.classList.remove('hidden');
    document.getElementById('closeDynamicModalBtn').onclick = () => modalOverlay.classList.add('hidden');

    document.getElementById('pType').addEventListener('change', (e) => {
        const gsRow = document.getElementById('groupSizeRow');
        const gsIn = document.getElementById('pGroupSize');
        if (e.target.value === 'group') {
            gsRow.style.display = 'block';
            gsIn.required = true;
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
                categoryId: currentCategoryId
            };

            const progCollection = collection(db, "institutes", window.currentInstituteId, "programs");

            if (progId) {
                await updateDoc(doc(progCollection, progId), payload);
                window.showToast("Program updated.");
            } else {
                payload.createdAt = serverTimestamp();
                await addDoc(progCollection, payload);
                window.showToast("Program added.");
            }
            modalOverlay.classList.add('hidden');
        } catch (err) {
            console.error(err);
            window.showToast("Error saving program.", "error");
        } finally {
            btn.disabled = false;
            text.classList.remove('hidden');
            spinner.classList.add('hidden');
        }
    });
}

// ─────────────────────────────────────────────
// Add / Edit General Program Modal
// ─────────────────────────────────────────────
function openGeneralProgramModal(progId = null, data = {}) {
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');
    const modalOverlay = document.getElementById('dynamicModal');

    modalTitle.textContent = progId ? "Edit General Program" : "Add General Program";
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
                await addDoc(progCollection, payload);
                window.showToast("General Program added.");
            }
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
// Delete Program
// ─────────────────────────────────────────────
async function deleteProgram(id) {
    if (!confirm("Delete this program? All team participants will also be removed.")) return;
    try {
        const batch = writeBatch(db);
        // Find all participants to delete
        const pSnap = await getDocs(collection(db, "institutes", window.currentInstituteId, "programs", id, "participants"));
        pSnap.forEach(d => batch.delete(d.ref));

        batch.delete(doc(db, "institutes", window.currentInstituteId, "programs", id));
        await batch.commit();
        window.showToast("Program deleted.");
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
    const progDataStr = btn.dataset.all;

    dropdown.innerHTML = `
        <button class="dropdown-item btn-view-parts" style="display:flex; align-items:center; gap:0.5rem; width:100%; border:none; background:transparent; padding:0.5rem 0.85rem; font-size:12px; font-weight:600; color:#475569; text-align:left; cursor:pointer;">
            👥 Participants
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
        const allData = JSON.parse(progDataStr);
        window.navigateToParticipantsWorkflow?.(id, allData);
    });

    dropdown.querySelector('.btn-edit-prog').addEventListener('click', () => {
        dropdown.remove();
        const allData = JSON.parse(progDataStr);
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
