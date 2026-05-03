import { db } from './firebase.js';
import { collection, addDoc, getDocs, doc, deleteDoc, updateDoc, onSnapshot, serverTimestamp, writeBatch, query, where } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

let unsubscribeCategories = null;
let currentTeamForCategory = null;

export async function initCategoriesView(container, topActions) {
    if (unsubscribeCategories) unsubscribeCategories();

    topActions.innerHTML = `
        <select id="teamSelector" class="form-input" style="width: 250px; display: inline-block; margin-right: 1rem;">
            <option value="">Select a Team...</option>
        </select>
        <button class="btn btn-primary" id="btnCreateCategory" disabled>+ Add Category</button>
    `;

    container.innerHTML = `
        <div class="grid" id="categoriesGrid">
            <div class="empty-state" style="grid-column: 1 / -1; margin-top:2rem;">
                <div class="empty-state-icon">👈</div>
                <h3>Select a Team</h3>
                <p>Please select a team from the dropdown above to view categories.</p>
            </div>
        </div>
    `;

    const teamSelect = document.getElementById('teamSelector');
    const teamsRef = collection(db, "institutes", window.currentInstituteId, "teams");

    try {
        const snap = await getDocs(teamsRef);
        snap.forEach(tDoc => {
            const opt = document.createElement('option');
            opt.value = tDoc.id;
            opt.textContent = tDoc.data().name;
            teamSelect.appendChild(opt);
        });
    } catch (e) {
        console.error("Error loading teams dropdown", e);
        window.showToast("Failed to load teams", "error");
    }

    teamSelect.addEventListener('change', (e) => {
        currentTeamForCategory = e.target.value;
        const btn = document.getElementById('btnCreateCategory');

        if (currentTeamForCategory) {
            btn.disabled = false;
            loadCategoriesData(currentTeamForCategory);
        } else {
            btn.disabled = true;
            if (unsubscribeCategories) unsubscribeCategories();
            document.getElementById('categoriesGrid').innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1; margin-top:2rem;">
                    <div class="empty-state-icon">👈</div>
                    <h3>Select a Team</h3>
                    <p>Please select a team from the dropdown above to view categories.</p>
                </div>
            `;
        }
    });

    document.getElementById('btnCreateCategory').addEventListener('click', () => {
        if (currentTeamForCategory) openCategoryModal();
    });
}

function loadCategoriesData(teamId) {
    if (unsubscribeCategories) unsubscribeCategories();

    const catRef = collection(db, "institutes", window.currentInstituteId, "teams", teamId, "categories");

    unsubscribeCategories = onSnapshot(catRef, (snapshot) => {
        const grid = document.getElementById('categoriesGrid');
        grid.innerHTML = '';

        if (snapshot.empty) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1; margin-top:2rem;">
                    <div class="empty-state-icon">🏷️</div>
                    <h3>No Categories Found</h3>
                    <p>Click "Add Category" to create one for this team.</p>
                </div>
            `;
            return;
        }

        snapshot.forEach(docSnap => {
            const cat = docSnap.data();
            const catId = docSnap.id;
            const classes = cat.classes || [];

            const classChipsHTML = classes.length > 0
                ? `<div style="display:flex; flex-wrap:wrap; gap:0.35rem; margin-top:0.5rem;">
                    ${classes.map(c => `<span style="background:#e0e7ff; color:#4338ca; border-radius:999px; padding:0.2rem 0.6rem; font-size:0.75rem; font-weight:600;">Class ${window.escapeHTML(c)}</span>`).join('')}
                   </div>`
                : '';

            const card = document.createElement('div');
            card.className = 'card';
            card.innerHTML = `
                <div class="card-header">
                    <h3 class="card-title">${window.escapeHTML(cat.name)}</h3>
                </div>
                <div class="card-body">
                    <p class="text-muted">${window.escapeHTML(cat.description || 'No description')}</p>
                    ${classChipsHTML}
                </div>
                <div class="card-actions">
                    <button class="btn btn-secondary btn-sm edit-cat-btn"
                        data-id="${catId}"
                        data-name="${window.escapeHTML(cat.name)}"
                        data-desc="${window.escapeHTML(cat.description || '')}"
                        data-classes="${window.escapeHTML(JSON.stringify(classes))}">Edit</button>
                    <button class="btn btn-danger btn-sm delete-cat-btn" data-id="${catId}">Delete</button>
                </div>
            `;
            grid.appendChild(card);
        });

        document.querySelectorAll('.edit-cat-btn').forEach(btn => {
            btn.onclick = (e) => {
                const t = e.target;
                let classes = [];
                try { classes = JSON.parse(t.dataset.classes); } catch (_) { }
                openCategoryModal(t.dataset.id, t.dataset.name, t.dataset.desc, classes);
            };
        });
        document.querySelectorAll('.delete-cat-btn').forEach(btn => {
            btn.onclick = (e) => deleteCategory(e.target.dataset.id);
        });
    });
}

function openCategoryModal(catId = null, currentName = '', currentDesc = '', currentClasses = []) {
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');
    const modalOverlay = document.getElementById('dynamicModal');

    modalTitle.textContent = catId ? "Edit Category" : "Add Category";

    // Build initial chips HTML
    const buildChipsHTML = (classes) => classes.map((c, i) =>
        `<span class="class-chip" data-index="${i}" style="display:inline-flex; align-items:center; gap:0.3rem; background:#e0e7ff; color:#4338ca; border-radius:999px; padding:0.2rem 0.65rem; font-size:0.8rem; font-weight:600; margin:0.2rem;">
            Class ${window.escapeHTML(c)}
            <button type="button" class="remove-chip-btn" data-val="${window.escapeHTML(c)}" style="background:none; border:none; color:#6366f1; cursor:pointer; font-size:0.9rem; line-height:1; padding:0;">✕</button>
        </span>`
    ).join('');

    modalBody.innerHTML = `
        <form id="categoryForm">
            <div class="form-group">
                <label class="form-label">Category Name</label>
                <input type="text" id="catName" class="form-input" required value="${currentName}">
            </div>
            <div class="form-group">
                <label class="form-label">Description (Optional)</label>
                <textarea id="catDesc" class="form-input" rows="2">${currentDesc}</textarea>
            </div>

            <div class="form-group">
                <label class="form-label">Classes Included (Optional)</label>
                <div style="display:flex; gap:0.5rem; align-items:center;">
                    <input type="text" id="classInput" class="form-input" placeholder="e.g. 5, 6, 7" style="flex:1;">
                    <button type="button" id="addClassBtn" class="btn btn-secondary btn-sm" style="white-space:nowrap;">+ Add Class</button>
                </div>
                <div id="classChipsContainer" style="display:flex; flex-wrap:wrap; gap:0.35rem; margin-top:0.6rem; min-height:1.5rem;">
                    ${buildChipsHTML(currentClasses)}
                </div>
                <p style="font-size:0.72rem; color:#94a3b8; margin-top:0.4rem;">Type a class number and click Add Class. Each class is added individually.</p>
            </div>

            <div class="modal-actions" style="margin-top:1rem;">
                <button type="submit" class="btn btn-primary w-full" id="saveCatBtn">
                    <span class="btn-text">${catId ? 'Save Changes' : 'Create'}</span>
                    <span class="btn-spinner hidden"></span>
                </button>
            </div>
        </form>
    `;

    modalOverlay.classList.remove('hidden');
    document.getElementById('closeDynamicModalBtn').onclick = () => modalOverlay.classList.add('hidden');

    // ── Classes chip logic ──────────────────────────────
    let selectedClasses = [...currentClasses];

    function renderChips() {
        document.getElementById('classChipsContainer').innerHTML = buildChipsHTML(selectedClasses);
        document.querySelectorAll('.remove-chip-btn').forEach(btn => {
            btn.onclick = () => {
                const val = btn.dataset.val;
                selectedClasses = selectedClasses.filter(c => c !== val);
                renderChips();
            };
        });
    }

    // Attach remove handlers to pre-populated chips
    renderChips();

    document.getElementById('addClassBtn').addEventListener('click', () => {
        const input = document.getElementById('classInput');
        const val = input.value.trim();
        if (!val) return;
        if (!selectedClasses.includes(val)) {
            selectedClasses.push(val);
            renderChips();
        }
        input.value = '';
        input.focus();
    });

    // Allow pressing Enter in the class input to add
    document.getElementById('classInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('addClassBtn').click();
        }
    });

    // ── Form submit ──────────────────────────────────────
    document.getElementById('categoryForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const saveBtn = document.getElementById('saveCatBtn');
        const spinner = saveBtn.querySelector('.btn-spinner');
        const text = saveBtn.querySelector('.btn-text');

        saveBtn.disabled = true;
        text.classList.add('hidden');
        spinner.classList.remove('hidden');

        try {
            const name = document.getElementById('catName').value.trim();
            const desc = document.getElementById('catDesc').value.trim();
            const payload = { name, description: desc, classes: selectedClasses };

            const catRefCol = collection(db, "institutes", window.currentInstituteId, "teams", currentTeamForCategory, "categories");

            if (catId) {
                await updateDoc(
                    doc(db, "institutes", window.currentInstituteId, "teams", currentTeamForCategory, "categories", catId),
                    payload
                );
                window.showToast("Category updated.");
            } else {
                payload.createdAt = serverTimestamp();
                await addDoc(catRefCol, payload);
                window.showToast("Category created.");
            }
            modalOverlay.classList.add('hidden');
        } catch (err) {
            console.error(err);
            window.showToast("An error occurred", "error");
        } finally {
            saveBtn.disabled = false;
            text.classList.remove('hidden');
            spinner.classList.add('hidden');
        }
    });
}

async function deleteCategory(catId) {
    if (!confirm("Are you sure you want to delete this category? All nested programs, participants, and students will also be permanently deleted.")) return;

    try {
        const instId = window.currentInstituteId;
        const teamId = currentTeamForCategory;
        const batch = writeBatch(db);

        // 1. Delete all students in this category
        const studentsSnap = await getDocs(collection(db, "institutes", instId, "teams", teamId, "categories", catId, "students"));
        studentsSnap.forEach(s => batch.delete(s.ref));

        // 2. Delete all participants of this team from global programs matching this category
        // First get the category name since programs use the name as categoryId
        const catDoc = await getDocs(query(collection(db, "institutes", instId, "teams", teamId, "categories"), where("__name__", "==", catId)));
        if (!catDoc.empty) {
            const catName = catDoc.docs[0].data().name;
            const progsSnap = await getDocs(query(collection(db, "institutes", instId, "programs"), where("categoryId", "==", catName)));
            for (const p of progsSnap.docs) {
                const partSnap = await getDocs(collection(db, "institutes", instId, "programs", p.id, "participants"));
                partSnap.forEach(part => {
                    if (part.data().teamId === teamId) batch.delete(part.ref);
                });
            }
        }

        // 3. Delete the category itself
        batch.delete(doc(db, "institutes", instId, "teams", teamId, "categories", catId));

        await batch.commit();
        window.showToast("Category and all nested data deleted successfully.");
    } catch (err) {
        console.error(err);
        window.showToast("Error deleting category and its data", "error");
    }
}
