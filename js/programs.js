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
                        data-all='${JSON.stringify(prog).replace(/'/g, "&#39;")}'>👥 Reg Participants</button>
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
            btn.onclick = (e) => {
                e.preventDefault();
                window.navigateToParticipantsWorkflow?.(e.target.dataset.id, JSON.parse(e.target.dataset.all));
            };
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
