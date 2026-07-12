import { db, updateDashboardMetadata, getCachedPrograms, getCachedCategories } from './firebase.js';
import {
    collection, doc, getDocs, setDoc, onSnapshot, deleteDoc, updateDoc, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// ─────────────────────────────────────────────
// Module State
// ─────────────────────────────────────────────
let judgesFilter = {
    search: ''
};

let allJudges = [];
let unsubscribeJudges = null;

// ─────────────────────────────────────────────
// Init View
// ─────────────────────────────────────────────
export async function initJudgesView(container, topActions) {
    if (!window.currentInstituteId) {
        container.innerHTML = '<div class="empty-state"><h3>Access Denied</h3><p>Please log in again.</p></div>';
        return;
    }

    if (unsubscribeJudges) {
        unsubscribeJudges();
        unsubscribeJudges = null;
    }

    allJudges = [];

    topActions.innerHTML = `
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center;">
            <button class="btn btn-secondary" id="btnBackToMarkEntry" style="font-weight:600;">← Back to Mark Entry</button>
            <input type="text" id="judgeSearchInput" class="form-input" placeholder="Search judge..." style="width:220px;" />
            <button class="btn btn-primary" id="btnAddJudge">+ Add Judge</button>
        </div>
    `;

    container.innerHTML = `
        <div class="grid" id="judgesGrid">
            <div class="loader-container"><div class="spinner"></div></div>
        </div>
    `;

    const searchInput = document.getElementById('judgeSearchInput');
    const addBtn = document.getElementById('btnAddJudge');
    document.getElementById('btnBackToMarkEntry')?.addEventListener('click', () => window.navigateTo('mark-entry'));

    searchInput.oninput = (e) => {
        judgesFilter.search = e.target.value.toLowerCase().trim();
        renderJudgesGrid();
    };

    addBtn.onclick = () => openJudgeModal();

    await loadJudgesData();
}

// ─────────────────────────────────────────────
// Data Sync real-time
// ─────────────────────────────────────────────
async function loadJudgesData() {
    try {
        const ref = collection(db, "institutes", window.currentInstituteId, "judges");
        unsubscribeJudges = onSnapshot(ref, (snapshot) => {
            allJudges = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
            renderJudgesGrid();
        });
    } catch (e) {
        console.error("Failed to fetch judges:", e);
        const grid = document.getElementById('judgesGrid');
        if (grid) grid.innerHTML = '<div class="empty-state"><h3>Error</h3><p>Failed to load judges.</p></div>';
    }
}

// ─────────────────────────────────────────────
// Render Cards Grid
// ─────────────────────────────────────────────
function renderJudgesGrid() {
    const grid = document.getElementById('judgesGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const filtered = allJudges.filter(j => {
        if (judgesFilter.search) {
            const name = (j.name || '').toLowerCase();
            const mobile = (j.mobile || '').toLowerCase();
            return name.includes(judgesFilter.search) || mobile.includes(judgesFilter.search);
        }
        return true;
    });

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column:1/-1; margin-top:2rem;">
                <div class="empty-state-icon">🧑‍⚖️</div>
                <h3>No Judges Found</h3>
                <p>Click "+ Add Judge" to register a judge.</p>
            </div>`;
        return;
    }

    filtered.forEach(j => {
        const isDisabled = j.status === 'disabled';
        const statusBadge = isDisabled 
            ? '<span class="badge" style="font-size:0.68rem; background:#fff1f2; color:#be123c; border:1px solid #fecdd3;">Disabled</span>' 
            : '<span class="badge" style="font-size:0.68rem; background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0;">Active</span>';

        const comps = Array.isArray(j.competitions) ? j.competitions : [];

        const card = document.createElement('div');
        card.className = 'card';
        if (isDisabled) card.style.opacity = '0.65';

        card.innerHTML = `
            <div class="card-header">
                <h3 class="card-title" style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap; font-size:1.05rem;">
                    🧑‍⚖️ ${window.escapeHTML(j.name)}
                    ${statusBadge}
                </h3>
            </div>
            <div class="card-body" style="display:flex; flex-direction:column; gap:0.4rem;">
                <p style="font-size:0.85rem; color:#475569; margin:0;">
                    📱 <strong>Phone Number:</strong> ${window.escapeHTML(j.mobile)}
                </p>
                <p style="font-size:0.85rem; color:#475569; margin:0;">
                    📚 <strong>Assigned Programs:</strong> ${comps.length}
                </p>
                ${j.notes ? `<p style="font-size:0.8rem; color:#64748b; margin:0; margin-top:0.2rem;">✏️ <em>${window.escapeHTML(j.notes)}</em></p>` : ''}
            </div>
            <div class="card-actions" style="margin-top:auto; padding-top:1rem; gap:0.4rem; display:flex;">
                <button class="btn btn-secondary btn-sm btn-j-view" data-id="${j.id}">👁️ View</button>
                <button class="btn btn-secondary btn-sm btn-j-edit" data-id="${j.id}">✏️ Edit</button>
                <button class="btn btn-danger btn-sm btn-j-delete" data-id="${j.id}">🗑 Delete</button>
            </div>
        `;

        card.querySelector('.btn-j-view').onclick = () => showViewPopup(j);
        card.querySelector('.btn-j-edit').onclick = () => openJudgeModal(j.id, j);
        card.querySelector('.btn-j-delete').onclick = () => triggerDeleteJudge(j);

        grid.appendChild(card);
    });
}

// ─────────────────────────────────────────────
// Form Modals & Validations
// ─────────────────────────────────────────────
function cleanMobile(mobileStr) {
    return mobileStr.replace(/[^\d+]/g, '');
}

function openJudgeModal(judgeId = null, existing = {}) {
    const modal = document.getElementById('dynamicModal');
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');

    modalTitle.textContent = judgeId ? "✏️ Edit Judge Profile" : "➕ Register New Judge";
    modalBody.innerHTML = `
        <form id="judgeModalForm" autocomplete="off" style="display:flex; flex-direction:column; gap:1rem;">
            <div class="form-group">
                <label class="form-label">Judge Name *</label>
                <input type="text" id="jFormName" class="form-input" required placeholder="e.g. Zainul Abid" value="${window.escapeHTML(existing.name || '')}" />
            </div>
            <div class="form-group">
                <label class="form-label">Mobile Number *</label>
                <input type="text" id="jFormMobile" class="form-input" required placeholder="e.g. +91 9207 000010" value="${window.escapeHTML(existing.mobile || '')}" />
                <div style="font-size:0.7rem; color:#64748b; margin-top:0.25rem;">Must be a valid digit format between 7 and 15 numbers. Spaces/dashes will be cleaned automatically.</div>
            </div>
            <div class="form-group">
                <label class="form-label">Notes (Optional)</label>
                <textarea id="jFormNotes" class="form-input" rows="2" placeholder="e.g. Chief Sanskrit judge">${window.escapeHTML(existing.notes || '')}</textarea>
            </div>
            <div class="modal-actions" style="margin-top:0.5rem;">
                <button type="submit" class="btn btn-primary w-full" id="jFormSubmitBtn">
                    <span class="btn-text">${judgeId ? 'Save Changes' : 'Register Judge'}</span>
                    <span class="btn-spinner hidden"></span>
                </button>
            </div>
        </form>
    `;

    modal.classList.remove('hidden');
    document.getElementById('closeDynamicModalBtn').onclick = () => modal.classList.add('hidden');

    const form = document.getElementById('judgeModalForm');
    form.onsubmit = async (e) => {
        e.preventDefault();
        const name = document.getElementById('jFormName').value.trim();
        const rawMobile = document.getElementById('jFormMobile').value.trim();
        const notes = document.getElementById('jFormNotes').value.trim();

        if (!name || !rawMobile) {
            window.showToast("Name and Mobile are required.", "error");
            return;
        }

        const cleanedMobile = cleanMobile(rawMobile);
        if (cleanedMobile.length < 7 || cleanedMobile.length > 15) {
            window.showToast("Invalid mobile number format. Too short or long.", "error");
            return;
        }

        // Duplicate Check
        const isDuplicate = allJudges.some(j => j.id !== judgeId && cleanMobile(j.mobile) === cleanedMobile);
        if (isDuplicate) {
            window.showToast("This mobile number is already registered under another judge.", "error");
            return;
        }

        const btn = document.getElementById('jFormSubmitBtn');
        const text = btn.querySelector('.btn-text');
        const spinner = btn.querySelector('.btn-spinner');

        btn.disabled = true;
        text.classList.add('hidden');
        spinner.classList.remove('hidden');

        try {
            const ref = collection(db, "institutes", window.currentInstituteId, "judges");
            const payload = {
                name,
                mobile: cleanedMobile,
                notes,
                competitions: existing.competitions || [],
                competitionIds: existing.competitionIds || [],
                status: existing.status || 'active',
                updatedAt: serverTimestamp()
            };

            if (judgeId) {
                await setDoc(doc(ref, judgeId), payload, { merge: true });
                window.showToast("Judge profile updated!", "success");
            } else {
                payload.createdAt = serverTimestamp();
                const newDocRef = doc(ref);
                await setDoc(newDocRef, payload);
                window.showToast("Judge registered successfully!", "success");
            }
            await updateDashboardMetadata(window.currentInstituteId);
            modal.classList.add('hidden');
        } catch (err) {
            console.error(err);
            window.showToast("Failed to save judge profile.", "error");
        } finally {
            btn.disabled = false;
            text.classList.remove('hidden');
            spinner.classList.add('hidden');
        }
    };
}

// ─────────────────────────────────────────────
// Deletion Protection
// ─────────────────────────────────────────────
async function triggerDeleteJudge(judge) {
    const comps = Array.isArray(judge.competitions) ? judge.competitions : [];
    if (comps.length === 0) {
        // Direct safe delete allowed
        const confirmed = await window.customConfirm(`Are you sure you want to permanently delete judge "${judge.name}"?`);
        if (!confirmed) return;
        executeDeleteJudge(judge.id);
        return;
    }

    // assigned delete protection
    const modal = document.getElementById('dynamicModal');
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');

    modalTitle.textContent = "⚠️ Delete Protection";
    modalBody.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:1.25rem; padding:0.5rem;">
            <div style="background:#fff1f2; border:1px solid #fecdd3; border-radius:12px; padding:1.25rem; text-align:center; color:#be123c;">
                <span style="font-size:2rem;">⚠️</span>
                <h4 style="margin:0.5rem 0 0.35rem 0; font-weight:800; font-size:1.05rem;">Assigned to Competitions</h4>
                <p style="font-size:0.8rem; color:#9f1239; line-height:1.4; margin:0;">
                    <strong>${window.escapeHTML(judge.name)}</strong> is currently assigned as a scoring judge for:<br>
                    <span style="font-weight:700; color:#1e1b4b; background:#ffe4e6; padding:0.2rem 0.5rem; border-radius:4px; display:inline-block; margin-top:0.35rem;">
                        ${comps.map(c => window.escapeHTML(c)).join(' · ')}
                    </span>
                </p>
            </div>
            
            <p style="font-size:0.8rem; color:#475569; text-align:center; line-height:1.5; margin:0;">
                Deleting this judge profile directly will disrupt existing marks spreadsheets. Please choose an option:
            </p>

            <div style="display:flex; flex-direction:column; gap:0.5rem; margin-top:0.25rem;">
                <button class="btn btn-secondary w-full" id="btnProtectDisable" style="font-weight:700; border-color:#93c5fd; color:#1d4ed8; background:#eff6ff; text-align:left; padding:0.6rem 1rem;">
                    🔒 Disable Judge (Recommended)
                    <div style="font-size:0.68rem; font-weight:normal; color:#60a5fa; margin-top:0.15rem;">Hides judge from new selections, but preserves old score history.</div>
                </button>
                
                <button class="btn btn-danger w-full" id="btnProtectRemove" style="font-weight:700; text-align:left; padding:0.6rem 1rem;">
                    🗑 Remove Assignments & Delete
                    <div style="font-size:0.68rem; font-weight:normal; opacity:0.85; margin-top:0.15rem;">Purges judge names from all program scorings sheets, then deletes profile.</div>
                </button>
                
                <button class="btn btn-secondary w-full" id="btnProtectCancel" style="font-weight:700;">Cancel</button>
            </div>
        </div>
    `;

    modal.classList.remove('hidden');
    document.getElementById('closeDynamicModalBtn').onclick = () => modal.classList.add('hidden');

    document.getElementById('btnProtectCancel').onclick = () => modal.classList.add('hidden');
    
    document.getElementById('btnProtectDisable').onclick = async () => {
        try {
            await updateDoc(doc(db, "institutes", window.currentInstituteId, "judges", judge.id), {
                status: 'disabled'
            });
            await updateDashboardMetadata(window.currentInstituteId);
            window.showToast("Judge has been disabled and hidden from new assignments.", "success");
            modal.classList.add('hidden');
        } catch (e) {
            window.showToast("Failed to disable judge.", "error");
        }
    };

    document.getElementById('btnProtectRemove').onclick = async () => {
        const confirmed = await window.customConfirm("Remove this judge name from all program sheets permanently and delete?");
        if (!confirmed) return;
        
        const btn = document.getElementById('btnProtectRemove');
        btn.disabled = true;
        btn.textContent = "Processing cleanup...";

        try {
            // Find all results containing this judge's name, update
            const resultsSnap = await getDocs(collection(db, "institutes", window.currentInstituteId, "results"));
            const batch = writeBatch(db);

            resultsSnap.forEach(d => {
                const r = d.data();
                if (Array.isArray(r.judges) && r.judges.includes(judge.name)) {
                    const newJudges = r.judges.filter(x => x !== judge.name);
                    batch.update(d.ref, {
                        judges: newJudges,
                        updatedAt: serverTimestamp()
                    });
                }
            });

            // Delete judge
            batch.delete(doc(db, "institutes", window.currentInstituteId, "judges", judge.id));
            await batch.commit();
            await updateDashboardMetadata(window.currentInstituteId);
            window.showToast("Removed from all sheets and deleted judge.", "success");
            modal.classList.add('hidden');
        } catch (e) {
            console.error("Cleanup deletion failed:", e);
            window.showToast("Failed to delete judge assignments.", "error");
        } finally {
            btn.disabled = false;
        }
    };
}

async function executeDeleteJudge(id) {
    try {
        await deleteDoc(doc(db, "institutes", window.currentInstituteId, "judges", id));
        await updateDashboardMetadata(window.currentInstituteId);
        window.showToast("Judge profile deleted successfully!", "success");
    } catch (e) {
        window.showToast("Failed to delete judge.", "error");
    }
}

// ─────────────────────────────────────────────
// View Detailed Popup
// ─────────────────────────────────────────────
async function showViewPopup(judge) {
    const modal = document.getElementById('dynamicModal');
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');

    modalTitle.textContent = "Assigned Competitions";
    modalBody.innerHTML = `
        <div style="display:flex; justify-content:center; padding:2.5rem;">
            <div class="spinner"></div>
        </div>
    `;
    modal.classList.remove('hidden');
    document.getElementById('closeDynamicModalBtn').onclick = () => modal.classList.add('hidden');

    let programs = [];
    let categories = [];
    try {
        programs = await getCachedPrograms(window.currentInstituteId) || [];
        categories = await getCachedCategories(window.currentInstituteId) || [];
    } catch (e) {
        console.error("Failed to load cached programs or categories:", e);
    }

    const assignedComps = Array.isArray(judge.competitions) ? judge.competitions : [];
    const assignedList = assignedComps.map((compName, index) => {
        const prog = programs.find(p => (p.name || '').toLowerCase().trim() === compName.toLowerCase().trim());
        
        let typeLabel = 'Individual';
        let categoryName = 'General';
        
        if (prog) {
            const pType = (prog.programType || prog.type || 'individual').toLowerCase();
            if (pType === 'group') {
                typeLabel = 'Group';
            } else if (pType === 'general') {
                typeLabel = 'General';
            } else {
                typeLabel = 'Individual';
            }
            
            const cat = categories.find(c => c.id === prog.categoryId || c.name === prog.categoryId);
            categoryName = cat?.name || (prog.categoryId === 'general_programs' ? 'General' : prog.categoryId || 'General');
        }
        
        return {
            index: index + 1,
            name: compName,
            type: typeLabel,
            category: categoryName
        };
    });

    modalTitle.textContent = `Assigned Competitions (${assignedList.length})`;
    modalBody.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:1.25rem; padding:0.25rem;">
            <!-- Judge profile summary header -->
            <div style="display:flex; align-items:center; gap:1rem; background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:1rem;">
                <div style="width:48px; height:48px; background:#4338ca; color:white; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:1.35rem; font-weight:700; flex-shrink:0;">
                    ${window.escapeHTML((judge.name || '?').slice(0, 1).toUpperCase())}
                </div>
                <div style="flex-grow:1; min-width:0;">
                    <h3 style="margin:0; font-size:1.05rem; font-weight:800; color:#0f172a; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                        ${window.escapeHTML(judge.name)}
                    </h3>
                    <div style="font-size:0.8rem; color:#64748b; margin-top:0.15rem; display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center;">
                        <span>📱 ${window.escapeHTML(judge.mobile)}</span>
                        <span>•</span>
                        <span class="badge" style="padding:0.1rem 0.4rem; font-size:0.65rem; text-transform:capitalize; background:${judge.status === 'disabled' ? '#fff1f2; color:#be123c; border:1px solid #fecdd3;' : '#f0fdf4; color:#15803d; border:1px solid #bbf7d0;'}">
                            ${judge.status === 'disabled' ? 'Disabled' : 'Active'}
                        </span>
                    </div>
                </div>
            </div>

            ${judge.notes ? `
            <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:0.65rem 0.85rem; font-size:0.8rem; color:#b45309;">
                📝 <strong>Notes:</strong> <em>${window.escapeHTML(judge.notes)}</em>
            </div>
            ` : ''}

            <!-- Competitions List -->
            <div style="display:flex; flex-direction:column; gap:0.5rem;">
                <div style="max-height:280px; overflow-y:auto; display:flex; flex-direction:column; gap:0.6rem; padding-right:0.25rem;">
                    ${assignedList.length > 0 
                        ? assignedList.map(item => `
                            <div style="font-size:0.85rem; color:#1e293b; padding:0.65rem 0.85rem; background:#ffffff; border-radius:8px; border:1px solid #e2e8f0; border-left:4px solid #4338ca; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                                <div style="font-weight:700; color:#1e293b; font-size:0.9rem;">${item.index}. ${window.escapeHTML(item.name)}</div>
                                <div style="margin-left: 1.1rem; margin-top: 0.25rem; font-size: 0.78rem; color: #475569; display: flex; flex-direction: column; gap: 0.15rem;">
                                    <div><strong>Type:</strong> ${item.type}</div>
                                    ${item.category && item.category !== 'General' ? `<div><strong>Category:</strong> ${window.escapeHTML(item.category)}</div>` : ''}
                                </div>
                            </div>
                        `).join('') 
                        : '<div style="font-size:0.8rem; color:#94a3b8; text-align:center; padding:1.5rem 0;">No active competition sheets</div>'
                    }
                </div>
            </div>

            <div style="display:flex; gap:0.5rem; justify-content:flex-end; border-top:1px solid #e2e8f0; padding-top:1rem; margin-top:0.25rem;">
                <button class="btn btn-secondary w-full" id="btnViewClose" style="font-weight:600;">Close</button>
            </div>
        </div>
    `;

    document.getElementById('btnViewClose').onclick = () => modal.classList.add('hidden');
}
