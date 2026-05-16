import { db } from './firebase.js';
import { collection, addDoc, getDocs, doc, deleteDoc, updateDoc, onSnapshot, serverTimestamp, writeBatch, query, where } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { normalizeClasses } from './categories.js';

let unsubscribeStudents = null;
let currentTeamId = null;
let currentCategoryId = null;
let currentClassId = null;
let allCategories = [];

export async function initStudentsView(container, topActions) {
    if (unsubscribeStudents) {
        unsubscribeStudents();
        unsubscribeStudents = null;
    }

    topActions.innerHTML = `
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center;">
            <select id="stuCatSelect" class="form-input" style="width: 180px;">
                <option value="">Select Category...</option>
            </select>
            <select id="stuClassSelect" class="form-input" style="width: 180px;" disabled>
                <option value="">Select Class...</option>
            </select>
            <select id="stuTeamSelect" class="form-input" style="width: 180px;">
                <option value="">All Teams (Filter)</option>
            </select>
            <button class="btn btn-primary" id="btnAddStudents" disabled>+ Add Students</button>
        </div>
    `;

    container.innerHTML = `
        <div class="grid" id="studentsGrid">
            <div class="empty-state" style="grid-column: 1 / -1; margin-top:2rem;">
                <div class="empty-state-icon">🎓</div>
                <h3>Select a Category & Class</h3>
                <p>Use the dropdowns above to view and manage students.</p>
            </div>
        </div>
    `;

    const catSel = document.getElementById('stuCatSelect');
    const classSel = document.getElementById('stuClassSelect');
    const teamSel = document.getElementById('stuTeamSelect');

    // 1. Load Global Categories
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

    // 2. Load Teams
    try {
        const teamSnap = await getDocs(collection(db, "institutes", window.currentInstituteId, "teams"));
        teamSnap.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.id;
            opt.textContent = d.data().name;
            teamSel.appendChild(opt);
        });
    } catch (e) { console.error("Error loading teams", e); }

    catSel.addEventListener('change', (e) => {
        currentCategoryId = e.target.value;
        currentClassId = null;
        classSel.innerHTML = '<option value="">Select Class...</option>';
        classSel.disabled = true;
        document.getElementById('btnAddStudents').disabled = true;
        resetStudentGrid();

        if (currentCategoryId) {
            const cat = allCategories.find(c => c.id === currentCategoryId);
            if (cat && cat.classes) {
                cat.classes.forEach(cls => {
                    const opt = document.createElement('option');
                    opt.value = cls.id;
                    opt.textContent = cls.name;
                    classSel.appendChild(opt);
                });
                classSel.disabled = false;
            }
        }
    });

    classSel.addEventListener('change', (e) => {
        currentClassId = e.target.value;
        updateView();
    });

    teamSel.addEventListener('change', (e) => {
        currentTeamId = e.target.value;
        updateView();
    });

    function updateView() {
        const btn = document.getElementById('btnAddStudents');
        if (currentCategoryId && currentClassId) {
            btn.disabled = false;
            loadStudentsData();
        } else {
            btn.disabled = true;
            resetStudentGrid();
        }
    }

    document.getElementById('btnAddStudents').addEventListener('click', openBulkAddModal);
}

function resetStudentGrid() {
    if (unsubscribeStudents) unsubscribeStudents();
    const grid = document.getElementById('studentsGrid');
    if (grid) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1; margin-top:2rem;">
                <div class="empty-state-icon">🎓</div>
                <h3>Select a Category & Class</h3>
                <p>Use the dropdowns above to view and manage students.</p>
            </div>
        `;
    }
}

/**
 * PRIMARY SOURCE: All reads use the flat collection
 */
function loadStudentsData() {
    if (unsubscribeStudents) unsubscribeStudents();

    const studentsRef = collection(db, "institutes", window.currentInstituteId, "students");
    let q = query(studentsRef, where("categoryId", "==", currentCategoryId), where("classId", "==", currentClassId));

    if (currentTeamId) {
        q = query(q, where("teamId", "==", currentTeamId));
    }

    unsubscribeStudents = onSnapshot(q, (snapshot) => {
        const grid = document.getElementById('studentsGrid');
        if (!grid) return;
        grid.innerHTML = '';

        if (snapshot.empty) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column:1/-1; margin-top:2rem;">
                    <div class="empty-state-icon">👤</div>
                    <h3>No Students Found</h3>
                    <p>Click "+ Add Students" to enroll students in this class.</p>
                    <div id="legacyMigrationCheck" style="margin-top:1.25rem;"></div>
                </div>`;
            checkLegacyStudents(); // One-time helper check
            return;
        }

        snapshot.forEach(docSnap => {
            renderStudentCard(grid, docSnap.id, docSnap.data());
        });

        attachCardEvents();
    });
}

/**
 * ONE-TIME MIGRATION HELPER
 * Checks if data exists in legacy nested paths when flat collection is empty
 */
async function checkLegacyStudents() {
    // Requires a team selection to check the legacy team-nested path
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
        
        await batch.commit();
        window.showToast(`Successfully moved ${docs.length} students.`);
        // Remove migration banner and reload
        document.getElementById('legacyMigrationCheck').innerHTML = '';
        loadStudentsData();
    } catch (e) {
        console.error(e);
        window.showToast("Migration failed. Please try again.", "error");
        btn.disabled = false;
        btn.textContent = "Retry Move";
    }
}

function renderStudentCard(grid, id, stu) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
        <div class="card-header">
            <h3 class="card-title">${window.escapeHTML(stu.name)}</h3>
            <span style="background:#e0e7ff; color:#4338ca; border-radius:999px; padding:0.2rem 0.75rem; font-size:0.78rem; font-weight:700;">#${window.escapeHTML(stu.chestNumber || '')}</span>
        </div>
        <div class="card-body">
            <p style="font-size:0.85rem; margin-bottom:0.25rem;"><strong>Gender:</strong> ${window.escapeHTML(stu.gender || '—')}</p>
            <p style="font-size:0.85rem; color:#64748b;">${window.escapeHTML(stu.categoryName || 'General')} · ${window.escapeHTML(stu.className || 'Standard')}</p>
        </div>
        <div class="card-actions">
            <button class="btn btn-secondary btn-sm edit-stu-btn"
                data-id="${id}"
                data-all='${JSON.stringify(stu).replace(/'/g, "&#39;")}'>Edit</button>
            <button class="btn btn-danger btn-sm delete-stu-btn" data-id="${id}">Delete</button>
        </div>
    `;
    grid.appendChild(card);
}

function attachCardEvents() {
    document.querySelectorAll('.edit-stu-btn').forEach(btn => {
        btn.onclick = (e) => openEditModal(e.currentTarget.dataset.id, JSON.parse(e.currentTarget.dataset.all));
    });
    document.querySelectorAll('.delete-stu-btn').forEach(btn => {
        btn.onclick = (e) => deleteStudent(e.currentTarget.dataset.id);
    });
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
                        <th style="text-align:left; padding:0.5rem 0.4rem; color:#64748b; font-weight:600; width:30%;">Chest No.</th>
                        <th style="text-align:left; padding:0.5rem 0.4rem; color:#64748b; font-weight:600;">Student Name</th>
                        <th style="text-align:left; padding:0.5rem 0.4rem; color:#64748b; font-weight:600; width:130px;">Gender</th>
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
            const chest = row.querySelector('.s-chest').value.trim();
            const name = row.querySelector('.s-name').value.trim();
            const gender = row.querySelector('.s-gender').value;
            if (chest && name) students.push({ chestNumber: chest, name, gender });
        });

        if (students.length === 0) return window.showToast("Fill in at least one student.", "error");

        const btn = document.getElementById('saveBulkBtn');
        btn.disabled = true;

        try {
            const batch = writeBatch(db);
            const colRef = collection(db, "institutes", window.currentInstituteId, "students");
            students.forEach(stu => {
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
            await batch.commit();
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
        <td style="padding:0.4rem 0.4rem;"><input type="text" class="form-input s-chest" placeholder="e.g. A101"></td>
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
                <label class="form-label">Chest Number</label>
                <input type="text" id="eChest" class="form-input" required value="${window.escapeHTML(data.chestNumber || '')}">
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
                chestNumber: document.getElementById('eChest').value.trim(),
                name: document.getElementById('eName').value.trim(),
                gender: document.getElementById('eGender').value,
                updatedAt: serverTimestamp()
            });
            window.showToast("Student updated");
            modalOverlay.classList.add('hidden');
        } catch (e) {
            console.error(e);
            window.showToast("Update failed", "error");
            btn.disabled = false;
        }
    };
}

async function deleteStudent(id) {
    if (!confirm("Delete this student?")) return;
    try {
        await deleteDoc(doc(db, "institutes", window.currentInstituteId, "students", id));
        window.showToast("Student deleted");
    } catch (e) {
        console.error(e);
        window.showToast("Delete failed", "error");
    }
}
