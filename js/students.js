import { db } from './firebase.js';
import { collection, addDoc, getDocs, doc, deleteDoc, updateDoc, onSnapshot, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

let unsubscribeStudents = null;
let currentTeamStu = null;
let currentCatStu = null;

export async function initStudentsView(container, topActions) {
    if (unsubscribeStudents) unsubscribeStudents();

    topActions.innerHTML = `
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center;">
            <select id="stuTeamSelect" class="form-input" style="width: 200px;">
                <option value="">Select Team...</option>
            </select>
            <select id="stuCatSelect" class="form-input" style="width: 200px;" disabled>
                <option value="">Select Category...</option>
            </select>
            <button class="btn btn-primary" id="btnAddStudents" disabled>+ Add Students</button>
        </div>
    `;

    container.innerHTML = `
        <div class="grid" id="studentsGrid">
            <div class="empty-state" style="grid-column: 1 / -1; margin-top:2rem;">
                <div class="empty-state-icon">🎓</div>
                <h3>Select a Team &amp; Category</h3>
                <p>Use the dropdowns above to view students.</p>
            </div>
        </div>
    `;

    const teamSel = document.getElementById('stuTeamSelect');
    const catSel = document.getElementById('stuCatSelect');

    try {
        const snap = await getDocs(collection(db, "institutes", window.currentInstituteId, "teams"));
        snap.forEach(tDoc => {
            const opt = document.createElement('option');
            opt.value = tDoc.id;
            opt.textContent = tDoc.data().name;
            teamSel.appendChild(opt);
        });
    } catch (e) { console.error("Error loading teams", e); }

    teamSel.addEventListener('change', async (e) => {
        currentTeamStu = e.target.value;
        currentCatStu = null;
        catSel.innerHTML = '<option value="">Select Category...</option>';
        catSel.disabled = true;
        document.getElementById('btnAddStudents').disabled = true;
        resetStudentGrid();

        if (currentTeamStu) {
            try {
                const cSnap = await getDocs(
                    collection(db, "institutes", window.currentInstituteId, "teams", currentTeamStu, "categories")
                );
                cSnap.forEach(cDoc => {
                    const opt = document.createElement('option');
                    opt.value = cDoc.id;
                    opt.textContent = cDoc.data().name;
                    catSel.appendChild(opt);
                });
                catSel.disabled = false;
            } catch (err) { console.error(err); }
        }
    });

    catSel.addEventListener('change', (e) => {
        currentCatStu = e.target.value;
        const btn = document.getElementById('btnAddStudents');
        if (currentCatStu && currentTeamStu) {
            btn.disabled = false;
            loadStudentsData();
        } else {
            btn.disabled = true;
            resetStudentGrid();
        }
    });

    document.getElementById('btnAddStudents').addEventListener('click', openBulkAddModal);
}

function resetStudentGrid() {
    if (unsubscribeStudents) unsubscribeStudents();
    document.getElementById('studentsGrid').innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1; margin-top:2rem;">
            <div class="empty-state-icon">🎓</div>
            <h3>Select a Team &amp; Category</h3>
            <p>Use the dropdowns above to view students.</p>
        </div>
    `;
}

function loadStudentsData() {
    if (unsubscribeStudents) unsubscribeStudents();

    const studentsRef = collection(
        db,
        "institutes", window.currentInstituteId,
        "teams", currentTeamStu,
        "categories", currentCatStu,
        "students"
    );

    unsubscribeStudents = onSnapshot(studentsRef, (snapshot) => {
        const grid = document.getElementById('studentsGrid');
        grid.innerHTML = '';

        if (snapshot.empty) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column:1/-1; margin-top:2rem;">
                    <div class="empty-state-icon">👤</div>
                    <h3>No Students</h3>
                    <p>Click "+ Add Students" to enroll students.</p>
                </div>`;
            return;
        }

        snapshot.forEach(docSnap => {
            const stu = docSnap.data();
            const card = document.createElement('div');
            card.className = 'card';
            card.innerHTML = `
                <div class="card-header">
                    <h3 class="card-title">${window.escapeHTML(stu.name)}</h3>
                    <span style="background:#e0e7ff; color:#4338ca; border-radius:999px; padding:0.2rem 0.75rem; font-size:0.78rem; font-weight:700;">#${window.escapeHTML(stu.chestNumber || '')}</span>
                </div>
                <div class="card-body">
                    <p><strong>Gender:</strong> ${window.escapeHTML(stu.gender)}</p>
                </div>
                <div class="card-actions">
                    <button class="btn btn-secondary btn-sm edit-stu-btn"
                        data-id="${docSnap.id}"
                        data-all='${JSON.stringify({ chestNumber: stu.chestNumber, name: stu.name, gender: stu.gender }).replace(/'/g, "&#39;")}'>Edit</button>
                    <button class="btn btn-danger btn-sm delete-stu-btn" data-id="${docSnap.id}">Delete</button>
                </div>
            `;
            grid.appendChild(card);
        });

        document.querySelectorAll('.edit-stu-btn').forEach(btn => {
            btn.onclick = (e) => openEditModal(e.target.dataset.id, JSON.parse(e.target.dataset.all));
        });
        document.querySelectorAll('.delete-stu-btn').forEach(btn => {
            btn.onclick = (e) => deleteStudent(e.target.dataset.id);
        });
    });
}

// ─────────────────────────────────────────────
// BULK ADD MODAL
// ─────────────────────────────────────────────
function openBulkAddModal() {
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');
    const modalOverlay = document.getElementById('dynamicModal');

    modalTitle.textContent = '🎓 Add Students';

    modalBody.innerHTML = `
        <div style="margin-bottom:0.75rem; display:flex; justify-content:space-between; align-items:center;">
            <p style="font-size:0.85rem; color:#64748b; margin:0;">Fill in each row. All students will be saved at once.</p>
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
                <tbody id="studentRowsBody">
                </tbody>
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
    document.getElementById('closeDynamicModalBtn').onclick = () => modalOverlay.classList.add('hidden');
    document.getElementById('cancelBulkBtn').onclick = () => modalOverlay.classList.add('hidden');

    // Seed 3 rows
    addStudentRow();
    addStudentRow();
    addStudentRow();

    document.getElementById('addRowBtn').addEventListener('click', addStudentRow);

    document.getElementById('saveBulkBtn').addEventListener('click', async () => {
        const rows = document.querySelectorAll('.student-entry-row');
        const students = [];
        let hasError = false;

        rows.forEach((row, idx) => {
            const chest = row.querySelector('.s-chest').value.trim();
            const name = row.querySelector('.s-name').value.trim();
            const gender = row.querySelector('.s-gender').value;

            if (!chest && !name) return; // Skip completely empty rows
            if (!chest || !name) {
                window.showToast(`Row ${idx + 1}: Chest number and name are required.`, 'error');
                hasError = true;
                return;
            }
            students.push({ chestNumber: chest, name, gender });
        });

        if (hasError) return;
        if (students.length === 0) {
            window.showToast("Please fill in at least one student row.", "error");
            return;
        }

        const btn = document.getElementById('saveBulkBtn');
        const text = btn.querySelector('.btn-text');
        const spinner = btn.querySelector('.btn-spinner');
        btn.disabled = true;
        text.classList.add('hidden');
        spinner.classList.remove('hidden');

        try {
            const batch = writeBatch(db);
            const colRef = collection(
                db,
                "institutes", window.currentInstituteId,
                "teams", currentTeamStu,
                "categories", currentCatStu,
                "students"
            );

            students.forEach(stu => {
                const newDocRef = doc(colRef);
                batch.set(newDocRef, { ...stu, createdAt: serverTimestamp() });
            });

            await batch.commit();
            window.showToast(`✅ ${students.length} student${students.length > 1 ? 's' : ''} added successfully!`);
            modalOverlay.classList.add('hidden');
        } catch (err) {
            console.error(err);
            window.showToast("Error saving students. Please try again.", "error");
        } finally {
            btn.disabled = false;
            text.classList.remove('hidden');
            spinner.classList.add('hidden');
        }
    });
}

function addStudentRow() {
    const tbody = document.getElementById('studentRowsBody');
    const tr = document.createElement('tr');
    tr.className = 'student-entry-row';
    tr.style.cssText = 'border-bottom:1px solid #f1f5f9;';
    tr.innerHTML = `
        <td style="padding:0.4rem 0.4rem;">
            <input type="text" class="form-input s-chest" placeholder="e.g. A101" style="padding:0.4rem 0.6rem; font-size:0.85rem;">
        </td>
        <td style="padding:0.4rem 0.4rem;">
            <input type="text" class="form-input s-name" placeholder="Full name" style="padding:0.4rem 0.6rem; font-size:0.85rem;">
        </td>
        <td style="padding:0.4rem 0.4rem;">
            <select class="form-input s-gender" style="padding:0.4rem 0.5rem; font-size:0.85rem;">
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
            </select>
        </td>
        <td style="padding:0.4rem 0.2rem; text-align:center;">
            <button type="button" class="remove-row-btn" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:1.1rem; line-height:1; padding:0.2rem;">✕</button>
        </td>
    `;
    tr.querySelector('.remove-row-btn').addEventListener('click', () => tr.remove());
    tbody.appendChild(tr);
    // Focus the chest number input of the new row
    tr.querySelector('.s-chest').focus();
}

// ─────────────────────────────────────────────
// EDIT MODAL (single student)
// ─────────────────────────────────────────────
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
            <div class="form-group mb-6">
                <label class="form-label">Gender</label>
                <select id="eGender" class="form-input">
                    <option value="Male" ${data.gender === 'Male' ? 'selected' : ''}>Male</option>
                    <option value="Female" ${data.gender === 'Female' ? 'selected' : ''}>Female</option>
                    <option value="Other" ${data.gender === 'Other' ? 'selected' : ''}>Other</option>
                </select>
            </div>
            <div class="modal-actions">
                <button type="submit" class="btn btn-primary w-full" id="saveEditStuBtn">
                    <span class="btn-text">Save Changes</span>
                    <span class="btn-spinner hidden"></span>
                </button>
            </div>
        </form>
    `;

    modalOverlay.classList.remove('hidden');
    document.getElementById('closeDynamicModalBtn').onclick = () => modalOverlay.classList.add('hidden');

    document.getElementById('editStudentForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('saveEditStuBtn');
        btn.disabled = true;
        btn.querySelector('.btn-text').classList.add('hidden');
        btn.querySelector('.btn-spinner').classList.remove('hidden');

        try {
            await updateDoc(
                doc(db, "institutes", window.currentInstituteId, "teams", currentTeamStu, "categories", currentCatStu, "students", stuId),
                {
                    chestNumber: document.getElementById('eChest').value.trim(),
                    name: document.getElementById('eName').value.trim(),
                    gender: document.getElementById('eGender').value
                }
            );
            window.showToast("Student updated");
            modalOverlay.classList.add('hidden');
        } catch (err) {
            console.error(err);
            window.showToast("Error updating student", "error");
        } finally {
            btn.disabled = false;
            btn.querySelector('.btn-text').classList.remove('hidden');
            btn.querySelector('.btn-spinner').classList.add('hidden');
        }
    });
}

// ─────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────
async function deleteStudent(id) {
    if (!confirm("Delete this student?")) return;
    try {
        await deleteDoc(
            doc(db, "institutes", window.currentInstituteId, "teams", currentTeamStu, "categories", currentCatStu, "students", id)
        );
        window.showToast("Student deleted");
    } catch (e) {
        console.error(e);
        window.showToast("Error", "error");
    }
}
