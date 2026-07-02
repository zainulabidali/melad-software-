import { db, updateDashboardMetadata, invalidateCategoriesCache, sortCategories } from './firebase.js';
import { collection, getDocs, doc, updateDoc, onSnapshot, serverTimestamp, writeBatch, query, where, setDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

let unsubscribeCategories = null;
let unsubscribeStudents = null;
let unsubscribePrograms = null;

let localCategories = [];
let localStudents = [];
let localPrograms = [];

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

export function initCategoriesView(container, topActions) {
    if (unsubscribeCategories) unsubscribeCategories();
    if (unsubscribeStudents) unsubscribeStudents();
    if (unsubscribePrograms) unsubscribePrograms();

    localCategories = [];
    localStudents = [];
    localPrograms = [];

    topActions.innerHTML = `
        <button class="btn btn-secondary" id="btnBackToTeams" style="margin-right: 0.5rem; font-weight:600;">← Back to Teams</button>
        <button class="btn btn-primary" id="btnCreateCategory">+ Add Category</button>
    `;

    container.innerHTML = `
        <div class="teams-view-header">
            <div>
                <h2 class="teams-view-heading">Manage Categories & Classes</h2>
                <p class="teams-view-subtitle">Organize student groups and class structures</p>
            </div>
        </div>

        <div class="categories-table-container" id="categoriesTableContainer">
            <div class="loader-container">
                <div class="spinner"></div>
            </div>
        </div>
    `;

    document.getElementById('btnBackToTeams')?.addEventListener('click', () => window.navigateTo('teams'));
    document.getElementById('btnCreateCategory').addEventListener('click', () => openCategoryModal());

    // Scroll handler to close fixed menus when scrolling to prevent floating drifts
    window.addEventListener('scroll', () => {
        const activeDropdown = document.querySelector('.active-body-dropdown');
        if (activeDropdown) activeDropdown.remove();
    }, true);

    // Single delegated click listener on container for cat-dots-btn
    container.addEventListener('click', (e) => {
        const dotsBtn = e.target.closest('.cat-dots-btn');
        if (dotsBtn) {
            e.stopPropagation();
            openCategoryDropdown(dotsBtn);
        }
    });

    startRealtimeSync();
}

function startRealtimeSync() {
    const instId = window.currentInstituteId;
    if (!instId) return;

    const catRef = collection(db, "institutes", instId, "categories");
    const studentsRef = collection(db, "institutes", instId, "students");
    const programsRef = collection(db, "institutes", instId, "programs");

    let categoriesLoaded = false;
    let studentsLoaded = false;
    let programsLoaded = false;

    const checkAndRender = () => {
        if (categoriesLoaded && studentsLoaded && programsLoaded) {
            renderCategoriesUI();
        }
    };

    // 1. Listen to Categories
    unsubscribeCategories = onSnapshot(catRef, (snap) => {
        const rawCats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        localCategories = sortCategories(rawCats);
        window.cachedCategories = { data: localCategories, lastFetched: Date.now() };
        categoriesLoaded = true;
        checkAndRender();
    }, (err) => {
        console.error("Categories listener error:", err);
        window.showToast("Failed to load categories.", "error");
    });

    // 2. Listen to Students (used to calculate category sizes in real-time)
    unsubscribeStudents = onSnapshot(studentsRef, (snap) => {
        localStudents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        studentsLoaded = true;
        checkAndRender();
    }, (err) => {
        console.error("Students listener error:", err);
        window.showToast("Failed to load students.", "error");
    });

    // 3. Listen to Programs (used to calculate category programs in real-time)
    unsubscribePrograms = onSnapshot(programsRef, (snap) => {
        localPrograms = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        programsLoaded = true;
        checkAndRender();
    }, (err) => {
        console.error("Programs listener error:", err);
        window.showToast("Failed to load programs.", "error");
    });
}

function renderCategoriesUI() {
    const tableContainer = document.getElementById("categoriesTableContainer");
    if (!tableContainer) return;

    const totalCategories = localCategories.length;

    if (totalCategories === 0) {
        tableContainer.innerHTML = `
            <div class="teams-empty-state">
                <div class="teams-empty-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581a2.25 2.25 0 0 0 3.182 0l4.318-4.318a2.25 2.25 0 0 0 0-3.182L11.16 3.659A2.25 2.25 0 0 0 9.568 3ZM6 7.5h.008v.008H6V7.5Z" />
                    </svg>
                </div>
                <h3>No categories yet</h3>
                <p>Click "Add Category" to create a category and classes.</p>
                <button class="btn btn-primary" id="btnCreateCategoryEmpty" style="margin-top:0.75rem;">+ Add Category</button>
            </div>
        `;
        const btnEmpty = document.getElementById("btnCreateCategoryEmpty");
        if (btnEmpty) {
            btnEmpty.onclick = () => openCategoryModal();
        }
        return;
    }

    let tableHTML = `
        <div class="categories-table">
            <div class="categories-table-header">
                <div>Category Name</div>
                <div>Classes</div>
                <div class="category-desc-header-item">Description</div>
                <div>Students</div>
                <div>Programs</div>
                <div style="text-align: right;">Actions</div>
            </div>
            <div class="categories-table-body">
    `;

    localCategories.forEach((cat) => {
        const catId = cat.id;
        const classes = normalizeClasses(cat.classes);

        // Calculate Student and Program counts dynamically in memory
        const studentsCount = localStudents.filter(s => s.categoryId === catId || s.categoryName === cat.name).length;
        const programsCount = localPrograms.filter(p => p.categoryId === catId || p.categoryName === cat.name).length;

        const classesHTML = classes.length > 0
            ? `<div class="category-classes-cell">
                ${classes.map(c => `<span class="class-pill">${window.escapeHTML(c.name)}</span>`).join('')}
               </div>`
            : '<span style="color:#94a3b8; font-size:0.85rem; font-style:italic;">No classes</span>';

        tableHTML += `
            <div class="category-row">
                <div class="category-name-cell">
                    ${window.escapeHTML(cat.name)}
                </div>
                <div>
                    ${classesHTML}
                </div>
                <div class="category-desc-cell">
                    ${window.escapeHTML(cat.description || "No description")}
                </div>
                <div class="category-students-cell">
                    <span class="category-count-badge category-count-students">
                        🎓 ${studentsCount}
                    </span>
                </div>
                <div class="category-programs-cell">
                    <span class="category-count-badge category-count-programs">
                        🎭 ${programsCount}
                    </span>
                </div>
                <div class="category-actions-cell">
                    <div class="actions-dropdown-container">
                        <button class="btn-action-icon btn-action-more dots-btn cat-dots-btn" 
                            data-id="${catId}"
                            data-name="${window.escapeHTML(cat.name)}"
                            data-desc="${window.escapeHTML(cat.description || '')}"
                            data-cheststart="${cat.chestStart || ''}"
                            data-chestend="${cat.chestEnd || ''}"
                            data-classes='${JSON.stringify(classes).replace(/'/g, "&#39;")}'>
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

function openCategoryModal(catId = null, currentName = '', currentDesc = '', currentClasses = [], currentChestStart = '', currentChestEnd = '') {
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');
    const modalOverlay = document.getElementById('dynamicModal');

    modalTitle.textContent = catId ? "Edit Category" : "Add Category";

    let selectedClasses = normalizeClasses(currentClasses);

    const buildChipsHTML = (classes) => classes.map((c) =>
        `<span class="class-chip" data-id="${c.id}" style="display:inline-flex; align-items:center; gap:0.3rem; background:#f1f5f9; color:#334155; border:1px solid #cbd5e1; border-radius:999px; padding:0.25rem 0.65rem; font-size:0.75rem; font-weight:700; margin:0.2rem;">
            ${window.escapeHTML(c.name)}
            <button type="button" class="remove-chip-btn" data-id="${c.id}" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:0.95rem; line-height:1; padding:0; font-weight:bold; margin-left:0.15rem;">✕</button>
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
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem; margin-bottom:1rem;">
                <div class="form-group" style="margin:0;">
                    <label class="form-label">Chest Number Start *</label>
                    <input type="number" id="catChestStart" class="form-input" min="1" required placeholder="e.g. 100" value="${window.escapeHTML((currentChestStart !== undefined && currentChestStart !== null) ? currentChestStart.toString() : '')}">
                </div>
                <div class="form-group" style="margin:0;">
                    <label class="form-label">Chest Number End *</label>
                    <input type="number" id="catChestEnd" class="form-input" min="1" required placeholder="e.g. 199" value="${window.escapeHTML((currentChestEnd !== undefined && currentChestEnd !== null) ? currentChestEnd.toString() : '')}">
                </div>
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

    // Make chips interactive initially
    document.querySelectorAll('.remove-chip-btn').forEach(btn => {
        btn.onclick = () => {
            selectedClasses = selectedClasses.filter(c => c.id !== btn.dataset.id);
            renderChips();
        };
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

        const chestStartRaw = document.getElementById('catChestStart').value.trim();
        const chestEndRaw = document.getElementById('catChestEnd').value.trim();

        if (!chestStartRaw || !chestEndRaw) {
            window.showToast('Chest number start and end ranges are required.', 'error');
            return;
        }

        const chestStart = parseInt(chestStartRaw, 10);
        const chestEnd = parseInt(chestEndRaw, 10);

        if (isNaN(chestStart) || isNaN(chestEnd)) {
            window.showToast('Chest number ranges must be valid integers.', 'error');
            return;
        }

        if (chestStart >= chestEnd) {
            window.showToast('Chest start number must be strictly less than chest end number.', 'error');
            return;
        }

        // Overlap Check with other active categories
        const hasOverlap = localCategories.some(cat => {
            if (cat.id === catId) return false;
            const cStart = parseInt(cat.chestStart, 10);
            const cEnd = parseInt(cat.chestEnd, 10);
            if (isNaN(cStart) || isNaN(cEnd)) return false;
            return (chestStart <= cEnd && chestEnd >= cStart);
        });

        if (hasOverlap) {
            window.showToast('Chest number range overlaps with another category.', 'error');
            return;
        }

        if (selectedClasses.length === 0) {
            window.showToast('Please add at least one class.', 'error');
            return;
        }

        saveBtn.disabled = true;
        text.classList.add('hidden');
        spinner.classList.remove('hidden');

        try {
            const description = document.getElementById('catDesc').value.trim();

            let nextChestNumber = chestStart;
            if (catId) {
                const originalCat = localCategories.find(c => c.id === catId);
                const prevNext = originalCat?.nextChestNumber;
                if (prevNext !== undefined && prevNext !== null) {
                    nextChestNumber = prevNext;
                }
                if (nextChestNumber < chestStart || nextChestNumber > chestEnd) {
                    nextChestNumber = chestStart;
                }
            }

            const payload = {
                name,
                description,
                classes: selectedClasses,
                chestStart,
                chestEnd,
                nextChestNumber,
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
            await updateDashboardMetadata(window.currentInstituteId);
            invalidateCategoriesCache(window.currentInstituteId);
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
    if (!await window.customConfirm('Delete this category? THIS IS IRREVERSIBLE. All related student and program associations may break.', 'Delete Category', { danger: true, okText: 'Delete' })) return;

    try {
        const instId = window.currentInstituteId;
        const batch = writeBatch(db);

        // 1. Delete all students in this category
        const studentsSnap = await getDocs(query(collection(db, 'institutes', instId, 'students'), where('categoryId', '==', catId)));

        if (studentsSnap.size > 0 && !await window.customConfirm(`Found ${studentsSnap.size} students in this category. Delete them all?`, 'Delete Category Students', { danger: true, okText: 'Delete All' })) {
            return;
        }
        studentsSnap.forEach(s => batch.delete(s.ref));

        // 2. Delete all programs in this category — including participants + results
        const progsSnap = await getDocs(query(collection(db, 'institutes', instId, 'programs'), where('categoryId', '==', catId)));

        // Fetch judges once (needed for cleaning competition assignments)
        const judgesSnap = progsSnap.empty ? null : await getDocs(collection(db, 'institutes', instId, 'judges'));

        for (const progDoc of progsSnap.docs) {
            // Delete participants subcollection
            const partSnap = await getDocs(collection(db, 'institutes', instId, 'programs', progDoc.id, 'participants'));
            partSnap.forEach(part => batch.delete(part.ref));

            // Delete linked results + clean judge assignments
            const resultsSnap = await getDocs(query(
                collection(db, 'institutes', instId, 'results'),
                where('programId', '==', progDoc.id)
            ));
            for (const resDoc of resultsSnap.docs) {
                const r = resDoc.data();
                const progName = r.programName || '';
                if (judgesSnap) {
                    judgesSnap.forEach(jDoc => {
                        const j = jDoc.data();
                        const comps = Array.isArray(j.competitions) ? j.competitions : [];
                        const wasAssigned = Array.isArray(r.judges) && r.judges.includes(j.name);
                        if (wasAssigned && comps.includes(progName)) {
                            const newComps = comps.filter(c => c !== progName);
                            batch.update(jDoc.ref, { competitions: newComps, updatedAt: serverTimestamp() });
                        }
                    });
                }
                batch.delete(resDoc.ref);
            }

            // Delete program doc itself
            batch.delete(progDoc.ref);
        }

        // 3. Delete category document
        batch.delete(doc(db, 'institutes', instId, 'categories', catId));

        await batch.commit();
        await updateDashboardMetadata(window.currentInstituteId);
        invalidateCategoriesCache(instId);
        window.showToast('Category and all related records deleted successfully.');
    } catch (error) {
        window.handleError(error, 'deleting category');
    }
}

function openCategoryDropdown(btn) {
    // 1. Remove any existing dynamic body-appended dropdown
    const existing = document.querySelector('.active-body-dropdown');
    if (existing) existing.remove();

    // 2. Create the dropdown element
    const dropdown = document.createElement('div');
    dropdown.className = 'actions-dropdown-menu active-body-dropdown';
    
    // Get datasets
    const id = btn.dataset.id;
    const name = btn.dataset.name;
    const desc = btn.dataset.desc;
    const classesStr = btn.dataset.classes;
    const chestStart = btn.dataset.cheststart;
    const chestEnd = btn.dataset.chestend;

    dropdown.innerHTML = `
        <button class="dropdown-item btn-edit-cat" style="display:flex; align-items:center; gap:0.5rem; width:100%; border:none; background:transparent; padding:0.5rem 0.85rem; font-size:12px; font-weight:600; color:#475569; text-align:left; cursor:pointer;">
            ✏️ Edit
        </button>
        <button class="dropdown-item btn-delete-cat text-danger" style="display:flex; align-items:center; gap:0.5rem; width:100%; border:none; background:transparent; padding:0.5rem 0.85rem; font-size:12px; font-weight:600; color:#dc2626; text-align:left; cursor:pointer;">
            🗑️ Delete
        </button>
    `;

    // 3. Append directly to body
    document.body.appendChild(dropdown);

    // 4. Position fixed menu dynamically to avoid clipping
    const rect = btn.getBoundingClientRect();
    const menuWidth = 150;
    const menuHeight = 90;

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
    dropdown.querySelector('.btn-edit-cat').addEventListener('click', () => {
        dropdown.remove();
        let parsedClasses = [];
        try { parsedClasses = JSON.parse(classesStr); } catch (_) {}
        openCategoryModal(id, name, desc, parsedClasses, chestStart, chestEnd);
    });

    dropdown.querySelector('.btn-delete-cat').addEventListener('click', () => {
        dropdown.remove();
        deleteCategory(id);
    });
}
