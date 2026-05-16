import { db } from './firebase.js';
import {
    collection, addDoc, getDocs, doc, deleteDoc, updateDoc, setDoc,
    onSnapshot, serverTimestamp, writeBatch, query, where
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { normalizeClasses } from './categories.js';

let unsubscribePrograms = null;
let currentCategoryId = null;
let allCategories = [];

// ─────────────────────────────────────────────
// Init View
// ─────────────────────────────────────────────
export async function initProgramsView(container, topActions) {
    if (unsubscribePrograms) unsubscribePrograms();

    topActions.innerHTML = `
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center;">
            <select id="progCatSelect" class="form-input" style="width: 250px;">
                <option value="">Select Category...</option>
            </select>
            <button class="btn btn-primary" id="btnCreateProgram" disabled>+ Add Program</button>
        </div>
    `;

    container.innerHTML = `
        <div class="grid" id="programsGrid">
            <div class="empty-state" style="grid-column: 1 / -1; margin-top:2rem;">
                <div class="empty-state-icon">📝</div>
                <h3>Select a Category</h3>
                <p>Use the dropdown above to view programs.</p>
            </div>
        </div>
    `;

    const catSel = document.getElementById('progCatSelect');

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
            catSel.appendChild(opt);
        });
    } catch (e) { console.error("Error loading categories", e); }

    catSel.addEventListener('change', (e) => {
        currentCategoryId = e.target.value;
        const btn = document.getElementById('btnCreateProgram');
        if (currentCategoryId) {
            btn.disabled = false;
            loadProgramsData();
        } else {
            btn.disabled = true;
            resetProgramGrid();
        }
    });

    document.getElementById('btnCreateProgram').addEventListener('click', () => openProgramModal());
}

function resetProgramGrid() {
    if (unsubscribePrograms) unsubscribePrograms();
    document.getElementById('programsGrid').innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1; margin-top:2rem;">
            <div class="empty-state-icon">📝</div>
            <h3>Select a Category</h3>
        </div>
    `;
}

// ─────────────────────────────────────────────
// Badge helpers
// ─────────────────────────────────────────────
const LOCATION_BADGE = { 'Stage': '#dbeafe|#1d4ed8', 'Off Stage': '#fce7f3|#be185d' };
const GENDER_BADGE = { 'Boys': '#dbeafe|#1d4ed8', 'Girls': '#fce7f3|#be185d', 'Mixed': '#dcfce7|#15803d' };

function coloredBadge(value, map) {
    const [bg, color] = (map[value] || '#f1f5f9|#475569').split('|');
    return `<span style="background:${bg}; color:${color}; border-radius:999px; padding:0.15rem 0.65rem; font-size:0.73rem; font-weight:700;">${window.escapeHTML(value)}</span>`;
}

// ─────────────────────────────────────────────
// Load Programs (real-time)
// ─────────────────────────────────────────────
function loadProgramsData() {
    if (unsubscribePrograms) unsubscribePrograms();

    const programsRef = collection(db, "institutes", window.currentInstituteId, "programs");
    // Support both ID and Name during transition
    const cat = allCategories.find(c => c.id === currentCategoryId);
    const qPrograms = query(programsRef, where("categoryId", "in", [currentCategoryId, cat?.name || '']));

    unsubscribePrograms = onSnapshot(qPrograms, (snapshot) => {
        const grid = document.getElementById('programsGrid');
        grid.innerHTML = '';

        if (snapshot.empty) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column:1/-1; margin-top:2rem;">
                    <div class="empty-state-icon">📑</div>
                    <h3>No Programs</h3>
                    <p>Click "+ Add Program" to create one.</p>
                </div>`;
            return;
        }

        snapshot.forEach(docSnap => {
            const prog = docSnap.data();
            const progId = docSnap.id;

            const pType = (prog.programType || prog.type || 'individual').toLowerCase();
            const typeLine = pType === 'group' && prog.maxParticipants
                ? `Group · ${prog.maxParticipants} max per team`
                : 'Individual';

            const card = document.createElement('div');
            card.className = 'card';
            card.innerHTML = `
                <div class="card-header">
                    <h3 class="card-title">${window.escapeHTML(prog.programName)}</h3>
                    <div style="display:flex; gap:0.3rem; flex-wrap:wrap;">
                        ${prog.programLocation ? coloredBadge(prog.programLocation, LOCATION_BADGE) : ''}
                        ${prog.genderCategory ? coloredBadge(prog.genderCategory, GENDER_BADGE) : ''}
                    </div>
                </div>
                <div class="card-body">
                    <p style="font-size:0.82rem; margin-bottom:0.3rem;">
                        <strong>Type:</strong> ${window.escapeHTML(typeLine)}
                    </p>
                    ${prog.description ? `<p class="text-muted" style="font-size:0.82rem;">${window.escapeHTML(prog.description)}</p>` : ''}
                </div>
                <div class="card-actions" style="flex-wrap:wrap; gap:0.4rem;">
                    <button class="btn btn-secondary btn-sm edit-prog-btn"
                        data-id="${progId}"
                        data-all='${JSON.stringify(prog).replace(/'/g, "&#39;")}'>✏️ Edit</button>
                    <button class="btn btn-primary btn-sm participants-btn"
                        data-id="${progId}"
                        data-all='${JSON.stringify(prog).replace(/'/g, "&#39;")}'>👥 Participants</button>
                    <button class="btn btn-danger btn-sm delete-prog-btn"
                        data-id="${progId}">🗑 Delete</button>
                </div>
            `;
            grid.appendChild(card);
        });

        document.querySelectorAll('.edit-prog-btn').forEach(btn => {
            btn.onclick = (e) => openProgramModal(e.target.dataset.id, JSON.parse(e.target.dataset.all));
        });
        document.querySelectorAll('.participants-btn').forEach(btn => {
            btn.onclick = (e) => openParticipantsModal(e.target.dataset.id, JSON.parse(e.target.dataset.all));
        });
        document.querySelectorAll('.delete-prog-btn').forEach(btn => {
            btn.onclick = (e) => deleteProgram(e.target.dataset.id);
        });
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
// Participants Modal
// ─────────────────────────────────────────────
async function openParticipantsModal(progId, progData) {
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');
    const modalOverlay = document.getElementById('dynamicModal');

    const pType = (progData.programType || progData.type || 'individual').toLowerCase();
    const isGroup = pType === 'group';
    const maxCount = isGroup ? (progData.maxParticipants || progData.groupSize || 999) : 999;
    const genderFilter = progData.genderCategory;
    const typeName = isGroup ? `Group Event (max ${maxCount} per team)` : 'Individual Event (Unlimited participants per team)';

    modalTitle.textContent = `👥 ${progData.programName} — Participants`;
    modalBody.innerHTML = `<div style="text-align:center;padding:2rem;"><div class="spinner"></div></div>`;
    modalOverlay.classList.remove('hidden');
    document.getElementById('closeDynamicModalBtn').onclick = () => modalOverlay.classList.add('hidden');

    // ── Load Teams for Participants Dropdown ──
    const teams = [];
    try {
        const tSnap = await getDocs(collection(db, "institutes", window.currentInstituteId, "teams"));
        tSnap.forEach(t => teams.push({ id: t.id, name: t.data().name }));
    } catch (err) { console.error(err); }

    const teamOptions = teams.map(t => `<option value="${t.id}">${window.escapeHTML(t.name)}</option>`).join('');

    modalBody.innerHTML = `
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:0.65rem 0.85rem;font-size:0.8rem;color:#166534;margin-bottom:1rem;">
            📋 <strong>${typeName}</strong> &nbsp;·&nbsp; Gender: <strong>${genderFilter}</strong>
        </div>
        <div style="margin-bottom:1rem;">
            <label class="form-label">Select Team to manage participants:</label>
            <select id="partTeamSelect" class="form-input">
                <option value="">-- Choose Team --</option>
                ${teamOptions}
            </select>
        </div>
        <div id="partContentArea" style="display:none; grid-template-columns:${isGroup ? '1fr' : '1fr 1fr'}; gap:1rem;">
            <!-- Current Participants -->
            <div>
                <p style="font-size:0.75rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.5rem;">
                    ${isGroup ? 'Registered Team Entry' : `Current Participants (<span id="partCount">0</span> assigned)`}
                </p>
                <div id="currentPartList" style="display:flex;flex-direction:column;gap:0.35rem;min-height:60px;"></div>
                
                ${isGroup ? `
                    <div style="margin-top:1rem;">
                        <button id="btnRegisterTeam" class="btn btn-primary w-full" style="display:none;">+ Register This Team</button>
                    </div>
                ` : ''}
            </div>

            <!-- Available Students (Only for Individual) -->
            ${!isGroup ? `
            <div>
                <p style="font-size:0.75rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.5rem;">Available Students</p>
                <input type="text" id="stuSearch" class="form-input" placeholder="🔍 Search by name or chest no."
                    style="font-size:0.82rem;padding:0.4rem 0.65rem;margin-bottom:0.4rem;">
                <div id="availableStuList" style="display:flex;flex-direction:column;gap:0.35rem;max-height:280px;overflow-y:auto;"></div>
            </div>
            ` : ''}
        </div>
    `;

    document.getElementById('partTeamSelect').addEventListener('change', async (e) => {
        const teamId = e.target.value;
        const contentArea = document.getElementById('partContentArea');
        if (!teamId) {
            contentArea.style.display = 'none';
            return;
        }
        contentArea.style.display = 'grid';
        loadParticipantsForTeam(teamId);
    });

    let currentParticipants = [];
    let availableStudents = [];

    async function loadParticipantsForTeam(teamId) {
        currentParticipants = [];
        availableStudents = [];
        
        try {
            // 1. Get current registrations
            const partSnap = await getDocs(collection(db, "institutes", window.currentInstituteId, "programs", progId, "participants"));
            partSnap.forEach(d => {
                if (d.data().teamId === teamId) {
                    currentParticipants.push({ docId: d.id, ...d.data() });
                }
            });

            // 2. Get students from FLAT collection for this team/category
            if (!isGroup) {
                const sSnap = await getDocs(query(
                    collection(db, "institutes", window.currentInstituteId, "students"),
                    where("teamId", "==", teamId),
                    where("categoryId", "==", currentCategoryId)
                ));
                sSnap.forEach(d => {
                    const s = d.data();
                    if (genderFilter === 'Boys' && s.gender !== 'Male') return;
                    if (genderFilter === 'Girls' && s.gender !== 'Female') return;
                    availableStudents.push({ id: d.id, name: s.name, chestNumber: s.chestNumber, gender: s.gender });
                });
            }
            renderInner(teamId);
        } catch (err) {
            console.error(err);
        }
    }

    function renderInner(teamId) {
        const teamName = teams.find(t => t.id === teamId)?.name || 'Team';

        if (isGroup) {
            const isRegistered = currentParticipants.length > 0;
            const regBtn = document.getElementById('btnRegisterTeam');
            
            if (isRegistered) {
                const p = currentParticipants[0];
                document.getElementById('currentPartList').innerHTML = `
                    <div style="display:flex;align-items:center;justify-content:space-between;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:0.4rem 0.65rem;">
                        <div>
                            <span style="font-size:0.83rem;color:#1e293b;">✅ Registered as a Group</span>
                        </div>
                        <button class="remove-part-btn" data-doc="${p.docId}"
                            style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:0.9rem;padding:0 0.2rem;line-height:1;">✕ Unregister</button>
                    </div>
                `;
                if (regBtn) regBtn.style.display = 'none';
            } else {
                document.getElementById('currentPartList').innerHTML = `<p style="font-size:0.8rem;color:#94a3b8;font-style:italic;">Team not registered yet.</p>`;
                if (regBtn) {
                    regBtn.style.display = 'block';
                    regBtn.onclick = async () => {
                        regBtn.disabled = true;
                        try {
                            const partRef = collection(db, "institutes", window.currentInstituteId, "programs", progId, "participants");
                            const newDocRef = doc(partRef);
                            await setDoc(newDocRef, { teamId, teamName, isGroupEntry: true, categoryId: currentCategoryId });
                            currentParticipants.push({ docId: newDocRef.id, teamId, isGroupEntry: true });
                            renderInner(teamId);
                        } catch (err) { window.showToast("Error", "error"); regBtn.disabled = false; }
                    };
                }
            }
        } else {
            const assignedIds = new Set(currentParticipants.map(p => p.studentId));
            const canAdd = true; // No limit for individuals

            const countEl = document.getElementById('partCount');
            if (countEl) countEl.textContent = currentParticipants.length;

            document.getElementById('currentPartList').innerHTML = currentParticipants.length === 0
                ? `<p style="font-size:0.8rem;color:#94a3b8;font-style:italic;">None assigned yet.</p>`
                : currentParticipants.map(p => `
                        <div style="display:flex;align-items:center;justify-content:space-between;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:0.4rem 0.65rem;">
                            <div>
                                <span style="font-weight:600;font-size:0.83rem;color:#166534;">#${window.escapeHTML(p.chestNumber || '?')}</span>
                                <span style="font-size:0.83rem;color:#1e293b;margin-left:0.4rem;">${window.escapeHTML(p.studentName)}</span>
                            </div>
                            <button class="remove-part-btn" data-doc="${p.docId}"
                                style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:0.9rem;padding:0 0.2rem;line-height:1;">✕</button>
                        </div>
                    `).join('');

            document.getElementById('availableStuList').innerHTML = buildAvailableHTML(availableStudents, assignedIds, canAdd);
            
            // Bind add
            document.querySelectorAll('.add-part-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    btn.disabled = true;
                    const stu = availableStudents.find(s => s.id === btn.dataset.id);
                    if (!stu) return;

                    try {
                        const partRef = collection(db, "institutes", window.currentInstituteId, "programs", progId, "participants");
                        const newDocRef = doc(partRef);
                        await setDoc(newDocRef, {
                            studentId: stu.id, studentName: stu.name, chestNumber: stu.chestNumber, teamId, teamName, categoryId: currentCategoryId
                        });
                        currentParticipants.push({ docId: newDocRef.id, studentId: stu.id, studentName: stu.name, chestNumber: stu.chestNumber, teamId });
                        renderInner(teamId);
                    } catch (err) { window.showToast("Error", "error"); btn.disabled = false; }
                });
            });
        }

        // Bind remove for both group and individual
        document.querySelectorAll('.remove-part-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                try {
                    await deleteDoc(doc(db, "institutes", window.currentInstituteId, "programs", progId, "participants", btn.dataset.doc));
                    currentParticipants = currentParticipants.filter(p => p.docId !== btn.dataset.doc);
                    renderInner(teamId);
                } catch (err) { window.showToast("Error", "error"); btn.disabled = false; }
            });
        });
    }

    // Only bind search if individual (search box exists)
    const searchBox = document.getElementById('stuSearch');
    if (searchBox) {
        searchBox.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase();
            const assignedIds2 = new Set(currentParticipants.map(p => p.studentId));
            const canAdd2 = true; // Unlimited for individuals
            const filtered = availableStudents.filter(s =>
                s.name.toLowerCase().includes(q) || (s.chestNumber || '').toLowerCase().includes(q)
            );
            document.getElementById('availableStuList').innerHTML = buildAvailableHTML(filtered, assignedIds2, canAdd2);
        });
    }

    function buildAvailableHTML(students, assignedIds, canAdd) {
        if (students.length === 0) {
            return `<p style="font-size:0.8rem;color:#94a3b8;font-style:italic;padding:0.4rem;">No eligible students found.</p>`;
        }
        return students.map(s => {
            const already = assignedIds.has(s.id);
            if (already) {
                return `
                    <div style="display:flex;align-items:center;justify-content:space-between;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:0.4rem 0.65rem;opacity:0.5;">
                        <div>
                            <span style="font-weight:600;font-size:0.82rem;">#${window.escapeHTML(s.chestNumber || '?')}</span>
                            <span style="font-size:0.82rem;margin-left:0.4rem;">${window.escapeHTML(s.name)}</span>
                        </div>
                        <span style="font-size:0.72rem;color:#94a3b8;">Added</span>
                    </div>`;
            }
            return `
                <div style="display:flex;align-items:center;justify-content:space-between;background:${canAdd ? '#fff' : '#f8fafc'};border:1px solid #e2e8f0;border-radius:8px;padding:0.4rem 0.65rem;">
                    <div>
                        <span style="font-weight:600;font-size:0.82rem;color:#334155;">#${window.escapeHTML(s.chestNumber || '?')}</span>
                        <span style="font-size:0.82rem;color:#1e293b;margin-left:0.4rem;">${window.escapeHTML(s.name)}</span>
                    </div>
                    <button class="add-part-btn btn btn-primary btn-sm" data-id="${s.id}"
                        style="padding:0.2rem 0.6rem;font-size:0.75rem;${!canAdd ? 'opacity:0.4;cursor:not-allowed;' : ''}"
                        ${!canAdd ? 'disabled' : ''}>+ Add</button>
                </div>`;
        }).join('');
    }

    render();
}

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
