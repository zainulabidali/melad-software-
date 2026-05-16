import { db } from './firebase.js';
import { collection, getDocs, doc, updateDoc, onSnapshot, serverTimestamp, writeBatch, query, where, setDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

let unsubscribeCategories = null;

/**
 * Normalizes class data to handle both legacy strings and new object format.
 * Backward compatibility: string -> { id, name }
 */
export function normalizeClasses(classes) {
    if (!Array.isArray(classes)) return [];
    return classes.map(c => {
        if (typeof c === 'string') {
            return { 
                id: c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'), 
                name: c.trim() 
            };
        }
        return c;
    });
}

export async function initCategoriesView(container, topActions) {
    if (unsubscribeCategories) unsubscribeCategories();

    topActions.innerHTML = `
        <button class="btn btn-primary" id="btnCreateCategory">+ Add Category</button>
    `;

    container.innerHTML = `
        <div class="grid" id="categoriesGrid">
            <div class="empty-state" style="grid-column: 1 / -1; margin-top:2rem;">
                <div class="empty-state-icon">🏷️</div>
                <h3>Create Institute Categories</h3>
                <p>Categories and classes are now managed at the institute level.</p>
            </div>
        </div>
    `;

    document.getElementById('btnCreateCategory').addEventListener('click', () => openCategoryModal());
    loadCategoriesData();
}

function loadCategoriesData() {
    if (unsubscribeCategories) unsubscribeCategories();

    const catRef = collection(db, "institutes", window.currentInstituteId, "categories");

    unsubscribeCategories = onSnapshot(catRef, (snapshot) => {
        const grid = document.getElementById('categoriesGrid');
        if (!grid) return;
        grid.innerHTML = '';

        if (snapshot.empty) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1; margin-top:2rem;">
                    <div class="empty-state-icon">🏷️</div>
                    <h3>No Categories Yet</h3>
                    <p>Click "Add Category" to create a category and classes.</p>
                </div>
            `;
            return;
        }

        snapshot.forEach(docSnap => {
            const cat = docSnap.data();
            const catId = docSnap.id;
            const classes = normalizeClasses(cat.classes);

            const classChipsHTML = classes.length > 0
                ? `<div style="display:flex; flex-wrap:wrap; gap:0.35rem; margin-top:0.5rem;">
                    ${classes.map(c => `<span style="background:#fce7f3; color:#9d174d; border-radius:999px; padding:0.28rem 0.65rem; font-size:0.76rem; font-weight:700;">${window.escapeHTML(c.name)}</span>`).join('')}
                   </div>`
                : '';

            const card = document.createElement('div');
            card.className = 'card';
            card.innerHTML = `
                <div class="card-header">
                    <h3 class="card-title">${window.escapeHTML(cat.name)}</h3>
                    <span class="badge" style="background:#ede9fe; color:#5b21b6; font-size:0.75rem;">${classes.length} classes</span>
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
                        data-classes='${JSON.stringify(classes).replace(/'/g, "&#39;")}'>Edit</button>
                    <button class="btn btn-danger btn-sm delete-cat-btn" data-id="${catId}">Delete</button>
                </div>
            `;
            grid.appendChild(card);
        });

        document.querySelectorAll('.edit-cat-btn').forEach(btn => {
            btn.onclick = (e) => {
                const t = e.currentTarget;
                let classes = [];
                try { classes = JSON.parse(t.dataset.classes); } catch (_) { }
                openCategoryModal(t.dataset.id, t.dataset.name, t.dataset.desc, classes);
            };
        });
        document.querySelectorAll('.delete-cat-btn').forEach(btn => {
            btn.onclick = (e) => deleteCategory(e.currentTarget.dataset.id);
        });
    }, (error) => {
        console.error('Error loading categories:', error);
        window.showToast('Unable to load categories.', 'error');
    });
}

function openCategoryModal(catId = null, currentName = '', currentDesc = '', currentClasses = []) {
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');
    const modalOverlay = document.getElementById('dynamicModal');

    modalTitle.textContent = catId ? "Edit Category" : "Add Category";

    // Ensure classes are objects
    let selectedClasses = normalizeClasses(currentClasses);

    const buildChipsHTML = (classes) => classes.map((c) =>
        `<span class="class-chip" data-id="${c.id}" style="display:inline-flex; align-items:center; gap:0.3rem; background:#fce7f3; color:#9d174d; border-radius:999px; padding:0.23rem 0.6rem; font-size:0.8rem; font-weight:700; margin:0.2rem;">
            ${window.escapeHTML(c.name)}
            <button type="button" class="remove-chip-btn" data-id="${c.id}" style="background:none; border:none; color:#7e22ce; cursor:pointer; font-size:0.95rem; line-height:1; padding:0;">✕</button>
        </span>`
    ).join('');

    modalBody.innerHTML = `
        <form id="categoryForm">
            <div class="form-group">
                <label class="form-label">Category Name</label>
                <input type="text" id="catName" class="form-input" required value="${window.escapeHTML(currentName)}">
            </div>
            <div class="form-group">
                <label class="form-label">Description (Optional)</label>
                <textarea id="catDesc" class="form-input" rows="2">${window.escapeHTML(currentDesc)}</textarea>
            </div>
            <div class="form-group">
                <label class="form-label">Classes Included</label>
                <div style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center;">
                    <input type="text" id="classInput" class="form-input" placeholder="e.g. Class 1" style="flex:1; min-width:180px;">
                    <button type="button" id="addClassBtn" class="btn btn-secondary btn-sm">+ Add Class</button>
                </div>
                <div id="classChipsContainer" style="display:flex; flex-wrap:wrap; gap:0.35rem; margin-top:0.75rem; min-height:1.5rem;">
                    ${buildChipsHTML(selectedClasses)}
                </div>
                <p style="font-size:0.72rem; color:#94a3b8; margin-top:0.4rem;">Enter each class name and add it to the category. Duplicate names are not allowed.</p>
            </div>
            <div class="modal-actions" style="margin-top:1rem;">
                <button type="submit" class="btn btn-primary w-full" id="saveCatBtn">
                    <span class="btn-text">${catId ? 'Save Changes' : 'Create Category'}</span>
                    <span class="btn-spinner hidden"></span>
                </button>
            </div>
        </form>
    `;

    modalOverlay.classList.remove('hidden');
    document.getElementById('closeDynamicModalBtn').onclick = () => modalOverlay.classList.add('hidden');

    function renderChips() {
        document.getElementById('classChipsContainer').innerHTML = buildChipsHTML(selectedClasses);
        document.querySelectorAll('.remove-chip-btn').forEach(btn => {
            btn.onclick = () => {
                selectedClasses = selectedClasses.filter(c => c.id !== btn.dataset.id);
                renderChips();
            };
        });
    }

    document.getElementById('addClassBtn').addEventListener('click', () => {
        const input = document.getElementById('classInput');
        const value = input.value.trim();
        if (!value) return;

        const classId = value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        
        // Duplicate Prevention
        if (selectedClasses.some(c => c.id === classId)) {
            window.showToast('This class already exists in this category.', 'error');
            return;
        }

        selectedClasses.push({ id: classId, name: value });
        renderChips();
        input.value = '';
        input.focus();
    });

    document.getElementById('classInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('addClassBtn').click();
        }
    });

    document.getElementById('categoryForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const saveBtn = document.getElementById('saveCatBtn');
        const text = saveBtn.querySelector('.btn-text');
        const spinner = saveBtn.querySelector('.btn-spinner');

        const name = document.getElementById('catName').value.trim();
        if (!name) {
            window.showToast('Category name is required.', 'error');
            return;
        }

        // Empty Class Validation
        if (selectedClasses.length === 0) {
            window.showToast('Please add at least one class.', 'error');
            return;
        }

        saveBtn.disabled = true;
        text.classList.add('hidden');
        spinner.classList.remove('hidden');

        try {
            const description = document.getElementById('catDesc').value.trim();
            const payload = {
                name,
                description,
                classes: selectedClasses,
                updatedAt: serverTimestamp()
            };

            if (catId) {
                await updateDoc(doc(db, 'institutes', window.currentInstituteId, 'categories', catId), payload);
                window.showToast('Category updated successfully.');
            } else {
                const categoryId = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                if (!categoryId) {
                    window.showToast('Please enter a valid category name.', 'error');
                    return;
                }
                await setDoc(doc(db, 'institutes', window.currentInstituteId, 'categories', categoryId), {
                    ...payload,
                    createdAt: serverTimestamp()
                }, { merge: true });
                window.showToast('Category created successfully.');
            }
            modalOverlay.classList.add('hidden');
        } catch (error) {
            console.error('Error saving category:', error);
            window.showToast('Failed to save category.', 'error');
        } finally {
            saveBtn.disabled = false;
            text.classList.remove('hidden');
            spinner.classList.add('hidden');
        }
    });
}

async function deleteCategory(catId) {
    if (!confirm('Delete this category? THIS IS IRREVERSIBLE. All related student and program associations may break.')) return;

    // Safety Guard: Check for students using this category before deleting
    // (Note: This is a partial check as students might be in nested paths still)
    try {
        const instId = window.currentInstituteId;
        const batch = writeBatch(db);

        // Check flat students collection (future structure)
        const studentsSnap = await getDocs(query(collection(db, 'institutes', instId, 'students'), where('categoryId', '==', catId)));
        
        // Safety: If there are many students, warn the user or handle carefully
        if (studentsSnap.size > 0 && !confirm(`Found ${studentsSnap.size} students in this category. Delete them all?`)) {
            return;
        }
        studentsSnap.forEach(s => batch.delete(s.ref));

        // Cleanup related programs
        const progsSnap = await getDocs(query(collection(db, 'institutes', instId, 'programs'), where('categoryId', '==', catId)));
        for (const progDoc of progsSnap.docs) {
            const partSnap = await getDocs(collection(db, 'institutes', instId, 'programs', progDoc.id, 'participants'));
            partSnap.forEach(part => batch.delete(part.ref));
            batch.delete(progDoc.ref);
        }

        batch.delete(doc(db, 'institutes', instId, 'categories', catId));
        await batch.commit();
        window.showToast('Category and related records deleted successfully.');
    } catch (error) {
        console.error('Error deleting category:', error);
        window.showToast('Failed to delete category.', 'error');
    }
}
