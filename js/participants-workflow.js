import { db } from './firebase.js';
import {
    collection,
    getDocs,
    query,
    where,
    doc,
    getDoc,
    setDoc,
    deleteDoc,
    writeBatch,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

function debounce(fn, ms) {
    let t = null;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
}

function normalizeText(s) {
    return (s || '').toString().trim().toLowerCase();
}

function uniqById(list) {
    const m = new Map();
    for (const x of list) m.set(x.id, x);
    return [...m.values()];
}

function uid(prefix = 'id') {
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function safeDocId(value) {
    return (value || '').toString().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

function buildStudentRow({ student, checked, disabled }) {
    const s = student;
    const id = s.id;
    const checkedAttr = checked ? 'checked' : '';
    const disabledAttr = disabled ? 'disabled' : '';
    return `
    <div class="stu-row ${checked ? 'stu-row-checked' : ''} ${disabled ? 'stu-row-disabled' : ''}" data-stu-id="${id}">
      <label class="stu-check">
        <input type="checkbox" ${checkedAttr} ${disabledAttr} data-stu-check="${id}" />
        <span class="stu-check-ui"></span>
      </label>
      <div class="stu-meta">
        <div class="stu-name">${window.escapeHTML(s.name)}</div>
        <div class="stu-sub">#${window.escapeHTML(s.chestNumber || '—')} · ${window.escapeHTML(s.gender || '')} ${disabled ? '· <span class="badge-assigned" style="color: #059669; font-weight: 700; background: #ecfdf5; padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.7rem; border: 1px solid #a7f3d0; margin-left: 0.25rem;">Assigned</span>' : ''}</div>
      </div>
    </div>
  `;
}

export async function initParticipantsWorkflowView(container, topActions, { progId, progData }) {
    // 1. Initial State Variables
    const pType = (progData.programType || progData.type || 'individual').toLowerCase();
    const isGroupEvent = pType === 'group';
    const progName = progData.programName || 'Program';
    const genderFilter = progData.genderCategory || 'Mixed';
    let inheritedCategoryId = progData.categoryId || '';

    const teams = [];
    const teamById = new Map();
    const categoriesById = new Map();

    let selectedTeamId = '';
    let selectedCategoryId = '';
    let selectedClassId = '';

    let studentsAll = []; // Full list fetched from Firestore for selected Team + Category
    let studentsFiltered = []; // Filtered list based on inline class/search inputs
    let savedIndividualStudentIds = new Set();
    let assignedParticipantsAll = []; // Stores detailed objects of assigned participants
    let editingParticipantId = null; // Scoped variable for inline editing
    const selectedStudentIds = new Set(); // Holds selected checkboxes
    let groups = []; // For group event: list of created groups
    let groupContainerRef = null; // Reference to the program group container doc
    const participantDocIds = new Map(); // studentId -> firestoreDocId

    // 2. Set Up Main Page UI structure
    container.innerHTML = `
    <div class="pw-page" data-pw-root>
      <div class="pw-sticky-header">
        <div class="pw-header-left">
          <div class="pw-breadcrumb">Admin Panel · Programs · Participants</div>
          <h2 class="pw-title">👥 ${window.escapeHTML(progName)}</h2>
          <div class="pw-subtitle">${window.escapeHTML(isGroupEvent ? 'Group competition management' : 'Individual participant management')} · Gender Constraint: <strong>${window.escapeHTML(genderFilter)}</strong></div>
        </div>
        <div class="pw-header-right">
          <button class="btn btn-secondary" id="pwBackBtn">← Back to Programs</button>
        </div>
      </div>

      <div class="pw-content">
        <div class="pw-grid">
          <!-- Left Sidebar Panel - Compact 2-Step Accordion -->
          <aside class="pw-panel" id="pwAccordionRoot">
            <div class="pw-accordion-item is-active" data-step="team">
              <div class="pw-accordion-header">
                <h3 class="pw-step-title">1) Team <span id="pwTeamSelectedLabel" style="font-size: 0.8rem; font-weight: normal; margin-left: 0.5rem; color: #64748b;"></span></h3>
                <span class="pw-accordion-icon">▼</span>
              </div>
              <div class="pw-accordion-body">
                <div class="pw-field">
                  <input type="text" id="pwTeamSearch" class="form-input" placeholder="Search team..." />
                  <div id="pwTeamList" class="pw-select-list" role="listbox" style="margin-top: 0.5rem;"></div>
                </div>
                <div class="pw-help" style="margin-top:0.5rem;">Select a team to continue.</div>
              </div>
            </div>

            <div class="pw-accordion-item" data-step="students">
              <div class="pw-accordion-header">
                <h3 class="pw-step-title">2) Students</h3>
                <span class="pw-accordion-icon">▼</span>
              </div>
              <div class="pw-accordion-body">
                <div class="pw-field">
                  <input type="text" id="pwStudentSearch" class="form-input" placeholder="Search students by name/chest..." disabled />
                  <div class="pw-stu-filters" style="display:flex; gap:0.5rem; margin-top:0.5rem;">
                    <select id="pwClassFilter" class="form-input" disabled style="flex:1;">
                      <option value="">All Classes</option>
                    </select>
                  </div>
                  <div id="pwStudentList" class="pw-student-list" style="margin-top:0.5rem;"></div>
                  <div id="pwStudentsSkeleton" class="pw-skeleton" style="display:none;"></div>
                </div>
                <div class="pw-help" style="margin-top:0.5rem;">Select students to add or assign.</div>
              </div>
            </div>
          </aside>

          <!-- Right Main panel - Actions and Previews -->
          <main class="pw-main">
            <div class="pw-progress-row">
              <div class="pw-pill" data-pill="team">Team: <span id="pwTeamPill">—</span></div>
              <div class="pw-pill" data-pill="selected">Selected: <span id="pwSelectedCount">0</span></div>
            </div>

            ${isGroupEvent ? `
              <!-- Group Management Sections -->
              <section class="pw-section">
                <div class="pw-section-head">
                  <h3>Group Registration</h3>
                  <div class="pw-muted">Create multiple groups under this team.</div>
                </div>

                <div class="pw-group-create">
                  <div class="pw-form-grid">
                    <div>
                      <label class="form-label">New Group Name *</label>
                      <input id="pwNewGroupName" class="form-input" placeholder="e.g. Group A" />
                    </div>
                    <div>
                      <label class="form-label">Action</label>
                      <div class="pw-members-bar">
                        <span id="pwNewGroupMembersCount">0 selected</span>
                        <button class="btn btn-primary" id="pwCreateGroupBtn" disabled>+ Create Group</button>
                      </div>
                    </div>
                  </div>

                  <div class="pw-selected-preview">
                    <div class="pw-selected-title">Selected Students (Add to group)</div>
                    <div id="pwSelectedStudentsPreview" class="pw-preview-list"></div>
                  </div>
                </div>

                <div class="pw-divider"></div>

                <section class="pw-groups-list-head">
                  <h3>Existing Registered Groups</h3>
                  <div class="pw-muted">Manage group names, add/remove members, or delete groups.</div>
                </section>
                <div id="pwGroupsList" class="pw-groups-list"></div>
              </section>
            ` : `
              <!-- Individual Management Sections -->
              <section class="pw-section">
                <div class="pw-section-head">
                  <h3>Individual Registration</h3>
                  <div class="pw-muted">Assign the selected students as individual participants.</div>
                </div>
                <div class="pw-divider"></div>
                <div class="pw-actions-row">
                  <button class="btn btn-secondary" id="pwClearSelectedBtn">Clear Selection</button>
                  <button class="btn btn-primary" id="pwSaveParticipantsBtn" disabled>Save Participants</button>
                </div>
                <div class="pw-save-status" id="pwSaveStatus" aria-live="polite"></div>
                <!-- Assigned Participants Management Panel -->
                <div id="pwAssignedManagementPanel" style="margin-top: 1.5rem; border-top: 1px solid #e2e8f0; padding-top: 1.5rem; display: none;">
                </div>
              </section>
            `}

            <section class="pw-section pw-bottom-note">
              <div class="pw-note-box">
                <strong>Validation Constraints:</strong> Prevents duplicate registrations, disallows empty submissions, and ensures full gender filter compliance.
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  `;

    // 3. UI Helpers
    function setPill(which, val) {
        const el = document.getElementById(`pw${which}Pill`);
        if (el) el.textContent = val || '—';
    }

    function openAccordionStep(stepName) {
        document.querySelectorAll('.pw-accordion-item').forEach(item => {
            if (item.getAttribute('data-step') === stepName) {
                item.classList.add('is-active');
            } else {
                item.classList.remove('is-active');
            }
        });
    }

    function toggleStudentSelection(student) {
        const id = student.id;
        if (savedIndividualStudentIds.has(id)) return;
        if (selectedStudentIds.has(id)) {
            selectedStudentIds.delete(id);
        } else {
            selectedStudentIds.add(id);
        }
        refreshSelectedPreviews();
        renderStudentList();
    }

    function refreshSelectedPreviews() {
        const preview = document.getElementById('pwSelectedStudentsPreview');
        if (preview) {
            const selected = studentsAll.filter(s => selectedStudentIds.has(s.id));
            const listHTML = selected
                .slice(0, 250)
                .map(s => `
            <div class="pw-preview-item" data-preview-stu="${s.id}">
              <div class="pw-preview-main">
                <span class="pw-preview-name">${window.escapeHTML(s.name)}</span>
                <span class="pw-preview-chip">#${window.escapeHTML(s.chestNumber || '—')}</span>
              </div>
              <button class="pw-preview-remove" data-preview-remove="${s.id}" title="Remove">✕</button>
            </div>
          `)
                .join('');

            preview.innerHTML = listHTML || `<div class="pw-empty">No students selected.</div>`;

            // Wire up individual remove buttons in preview list
            preview.querySelectorAll('[data-preview-remove]').forEach(btn => {
                btn.onclick = () => {
                    const id = btn.getAttribute('data-preview-remove');
                    selectedStudentIds.delete(id);
                    refreshSelectedPreviews();
                    renderStudentList();
                };
            });
        }

        // Update counts
        const countEl = document.getElementById('pwSelectedCount');
        if (countEl) countEl.textContent = selectedStudentIds.size;
        
        const groupCount = document.getElementById('pwNewGroupMembersCount');
        if (groupCount) groupCount.textContent = `${selectedStudentIds.size} selected`;

        // Update main buttons
        if (isGroupEvent) {
            const createBtn = document.getElementById('pwCreateGroupBtn');
            if (createBtn) createBtn.disabled = selectedStudentIds.size === 0;

            const noSelection = selectedStudentIds.size === 0;
            document.querySelectorAll('.pw-add-to-group-btn, .pw-remove-from-group-btn').forEach(btn => {
                btn.disabled = noSelection;
            });
        } else {
            const saveBtn = document.getElementById('pwSaveParticipantsBtn');
            if (saveBtn) {
                const isBusy = saveBtn.dataset.locked === '1';
                saveBtn.disabled = isBusy || selectedStudentIds.size === 0;
            }
        }
    }

    function renderStudentList() {
        const el = document.getElementById('pwStudentList');
        if (!el) return;

        if (!studentsFiltered || studentsFiltered.length === 0) {
            el.innerHTML = `<div class="pw-empty">No eligible students found.</div>`;
            return;
        }

        const frag = studentsFiltered
            .slice(0, 2000)
            .map(s => {
                const checked = selectedStudentIds.has(s.id);
                return buildStudentRow({ student: s, checked, disabled: savedIndividualStudentIds.has(s.id) });
            })
            .join('');

        el.innerHTML = frag;

        // Wire checkbox listeners
        el.querySelectorAll('[data-stu-check]').forEach(ch => {
            ch.onclick = (e) => e.stopPropagation();
            ch.onchange = (e) => {
                e.stopPropagation();
                const id = ch.getAttribute('data-stu-check');
                if (savedIndividualStudentIds.has(id)) {
                    ch.checked = false;
                    selectedStudentIds.delete(id);
                    window.showToast('This student is already assigned to this program.', 'error');
                    return;
                }
                if (ch.checked) {
                    selectedStudentIds.add(id);
                } else {
                    selectedStudentIds.delete(id);
                }
                refreshSelectedPreviews();
                renderStudentList();
            };
        });

        // Wire entire row clicks
        el.querySelectorAll('.stu-row').forEach(row => {
            row.onclick = (e) => {
                if (e.target && e.target.closest('.stu-check')) return;
                const id = row.getAttribute('data-stu-id');
                if (savedIndividualStudentIds.has(id)) return;
                const stu = studentsAll.find(x => x.id === id);
                if (!stu) return;
                toggleStudentSelection(stu);
            };
        });
    }

    function renderSelectList(listEl, items, selectedId, { getLabel = (x) => x.name } = {}) {
        if (!listEl) return;
        if (!items || items.length === 0) {
            listEl.innerHTML = `<div class="pw-empty">No items found.</div>`;
            return;
        }
        listEl.innerHTML = items
            .map(it => {
                const id = it.id;
                const label = window.escapeHTML(getLabel(it));
                const active = id === selectedId ? 'pw-item-active' : '';
                return `
          <button type="button" class="pw-item ${active}" data-select-id="${id}">
            ${label}
          </button>
        `;
            })
            .join('');
    }

    // 4. Data Loading Methods
    async function loadTeams() {
        const snap = await getDocs(collection(db, "institutes", window.currentInstituteId, "teams"));
        teams.length = 0;
        teamById.clear();
        snap.forEach(d => {
            const t = d.data();
            const item = { id: d.id, name: t.name || d.id };
            teams.push(item);
            teamById.set(item.id, item);
        });
    }

    async function loadCategories() {
        const snap = await getDocs(collection(db, "institutes", window.currentInstituteId, "categories"));
        const out = [];
        snap.forEach(d => {
            const data = d.data();
            out.push({ id: d.id, name: data.name || d.id, classes: data.classes || [] });
            categoriesById.set(d.id, data);
        });
        return out;
    }

    function getClassesForCategory(catId) {
        const catData = categoriesById.get(catId);
        const classes = catData?.classes || [];
        return classes.map(c => {
            if (typeof c === 'string') {
                return { id: c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: c.trim() };
            }
            return { id: c.id, name: c.name || c.id };
        });
    }

    async function loadStudentsForSelection() {
        const showSkel = document.getElementById('pwStudentsSkeleton');
        const listEl = document.getElementById('pwStudentList');
        if (showSkel) showSkel.style.display = 'block';
        if (listEl) listEl.innerHTML = '';

        selectedStudentIds.clear();
        savedIndividualStudentIds = new Set();
        assignedParticipantsAll = [];
        participantDocIds.clear();
        refreshSelectedPreviews();

        try {
            if (!isGroupEvent) {
                const participantsRef = collection(db, "institutes", window.currentInstituteId, "programs", progId, "participants");
                let existingSnap;
                try {
                    existingSnap = await getDocs(query(
                        participantsRef,
                        where('type', '==', 'individual'),
                        where('teamId', '==', selectedTeamId)
                    ));
                } catch (err) {
                    existingSnap = await getDocs(participantsRef);
                }
                existingSnap.forEach(d => {
                    const data = d.data();
                    if (data.type === 'individual' && data.teamId === selectedTeamId && (data.categoryId || '') === inheritedCategoryId && data.studentId) {
                        savedIndividualStudentIds.add(data.studentId);
                        participantDocIds.set(data.studentId, d.id);
                        assignedParticipantsAll.push({
                            studentId: data.studentId,
                            studentName: data.studentName || '',
                            chestNumber: data.chestNumber || '',
                            className: data.className || data.class || '—'
                        });
                    }
                });
            }

            // Fetch eligible students only by category and team
            let q = query(
                collection(db, "institutes", window.currentInstituteId, "students"),
                where('categoryId', '==', inheritedCategoryId),
                where('teamId', '==', selectedTeamId)
            );

            // Apply Firestore gender queries directly
            if (genderFilter === 'Boys') q = query(q, where('gender', '==', 'Male'));
            if (genderFilter === 'Girls') q = query(q, where('gender', '==', 'Female'));

            let snap;
            try {
                snap = await getDocs(q);
            } catch (err) {
                let qFallback = query(
                    collection(db, "institutes", window.currentInstituteId, "students"),
                    where('categoryId', '==', inheritedCategoryId)
                );
                snap = await getDocs(qFallback);
            }

            studentsAll = snap.docs.map(d => {
                const s = d.data();
                return {
                    id: d.id || '',
                    name: s.name || '',
                    chestNumber: s.chestNumber || '',
                    gender: s.gender || '',
                    teamId: s.teamId || '',
                    categoryId: s.categoryId || '',
                    categoryName: s.categoryName || '',
                    classId: s.classId || s.class || '',
                    className: s.className || ''
                };
            });

            // Fallback safety filters
            studentsAll = studentsAll.filter(s => s.teamId === selectedTeamId);
            if (genderFilter === 'Boys') {
                studentsAll = studentsAll.filter(s => s.gender === 'Male');
            } else if (genderFilter === 'Girls') {
                studentsAll = studentsAll.filter(s => s.gender === 'Female');
            }

            studentsAll = uniqById(studentsAll);
            studentsFiltered = studentsAll;
            applyStudentSearchFilter();
            renderAssignedManagement();

        } catch (e) {
            console.error("Error loading students:", e);
            if (listEl) listEl.innerHTML = `<div class="pw-empty">Failed to load eligible students.</div>`;
        } finally {
            if (showSkel) showSkel.style.display = 'none';
        }
    }

    function applyStudentSearchFilter() {
        const q = normalizeText(document.getElementById('pwStudentSearch')?.value);
        const classSel = selectedClassId;

        let filtered = studentsAll;
        if (q) {
            filtered = filtered.filter(s => {
                const hay = `${s.name} ${s.chestNumber || ''}`.toLowerCase();
                return hay.includes(q);
            });
        }
        if (classSel) {
            filtered = filtered.filter(s => s.classId === classSel);
        }

        studentsFiltered = filtered;
        renderStudentList();
    }

    // 5. Group Persistence & Management Methods
    async function getOrCreateTeamParticipantContainer() {
        const partRef = collection(db, "institutes", window.currentInstituteId, "programs", progId, "participants");
        const q = query(
            partRef,
            where('type', '==', 'group'),
            where('teamId', '==', selectedTeamId),
            where('categoryId', '==', selectedCategoryId)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
            const d = snap.docs[0];
            groupContainerRef = d.ref;
            return { ref: d.ref, data: d.data() };
        }

        const newRef = doc(partRef);
        await setDoc(newRef, {
            teamId: selectedTeamId || '',
            teamName: teamById.get(selectedTeamId)?.name || '',
            categoryId: selectedCategoryId || inheritedCategoryId || '',
            classId: selectedClassId || '',
            programId: progId || '',
            type: 'group',
            groups: [],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        groupContainerRef = newRef;
        return { ref: newRef, data: { groups: [] } };
    }

    async function loadGroupsForTeam() {
        const partRef = collection(db, "institutes", window.currentInstituteId, "programs", progId, "participants");
        const q = query(
            partRef,
            where('type', '==', 'group'),
            where('teamId', '==', selectedTeamId),
            where('categoryId', '==', selectedCategoryId)
        );

        const listEl = document.getElementById('pwGroupsList');
        if (listEl) listEl.innerHTML = `<div class="pw-empty">Loading groups...</div>`;

        const snap = await getDocs(q);
        if (snap.empty) {
            groups = [];
            if (listEl) listEl.innerHTML = `<div class="pw-empty">No groups created yet.</div>`;
            refreshSelectedPreviews();
            renderAssignedManagement();
            return;
        }

        const d = snap.docs[0];
        const data = d.data();
        groupContainerRef = d.ref;
        groups = (data.groups || []).map(g => ({
            id: g.id,
            name: g.name,
            members: g.members || []
        }));

        renderGroupsList();
        renderAssignedManagement();
    }

    async function persistGroups() {
        if (!groupContainerRef) {
            await getOrCreateTeamParticipantContainer();
        }
        if (!groupContainerRef) return;

        const normalizedGroups = groups.map(g => ({
            id: g.id || '',
            name: g.name || '',
            members: (g.members || []).map(m => ({
                studentId: m.studentId || '',
                studentName: m.studentName || ''
            }))
        }));

        await setDoc(groupContainerRef, {
            teamId: selectedTeamId || '',
            teamName: teamById.get(selectedTeamId)?.name || '',
            categoryId: selectedCategoryId || inheritedCategoryId || '',
            classId: selectedClassId || '',
            programId: progId || '',
            type: 'group',
            groups: normalizedGroups,
            updatedAt: serverTimestamp()
        }, { merge: true });
    }

    async function updateGroup(groupId, updateFn) {
        try {
            const groupIdx = groups.findIndex(g => g.id === groupId);
            if (groupIdx === -1) return;

            groups[groupIdx] = updateFn(groups[groupIdx]);
            await persistGroups();
            window.showToast('Group updated successfully!', 'success');
            await loadGroupsForTeam();
        } catch (e) {
            console.error(e);
            window.showToast('Failed to update group.', 'error');
        }
    }

    function renderGroupsList() {
        const el = document.getElementById('pwGroupsList');
        if (!el) return;

        if (!groups || groups.length === 0) {
            el.innerHTML = `<div class="pw-empty">No groups created yet.</div>`;
            return;
        }

        el.innerHTML = groups.map((g, idx) => {
            const membersCount = g.members?.length || 0;
            return `
        <div class="pw-group-card" data-group-id="${g.id}">
          <div class="pw-group-top">
            <div class="pw-group-title">
              <div class="pw-group-index">#${idx + 1}</div>
              <div class="pw-group-name">${window.escapeHTML(g.name)}</div>
              <div class="pw-group-badge">${membersCount} members</div>
            </div>
            <div class="pw-group-actions">
              <button class="btn btn-secondary btn-sm pw-edit-group-btn" data-edit-group-id="${g.id}">Edit Name</button>
              <button class="btn btn-danger btn-sm pw-delete-group-btn" data-delete-group-id="${g.id}">Delete</button>
            </div>
          </div>

          <div class="pw-group-members-preview">
            ${membersCount === 0 ? `<div class="pw-empty">No members inside this group.</div>` : g.members.map(m => `
              <span class="pw-member-chip">${window.escapeHTML(m.studentName)}</span>
            `).join('')}
          </div>

          <div class="pw-group-edit-members">
            <div class="pw-inline-actions">
              <div class="pw-muted" style="font-size: 0.8rem;">Select students on the left, then click action:</div>
            </div>
            <div class="pw-group-member-actions-row">
              <button class="btn btn-primary btn-sm pw-add-to-group-btn" data-add-group-id="${g.id}" ${selectedStudentIds.size === 0 ? 'disabled' : ''}>Add Selected</button>
              <button class="btn btn-secondary btn-sm pw-remove-from-group-btn" data-remove-group-id="${g.id}" ${selectedStudentIds.size === 0 ? 'disabled' : ''}>Remove Selected</button>
            </div>
          </div>
        </div>
      `;
        }).join('');

        // Wire group-level clicks
        el.querySelectorAll('[data-edit-group-id]').forEach(btn => {
            btn.onclick = () => {
                const id = btn.getAttribute('data-edit-group-id');
                const g = groups.find(x => x.id === id);
                if (!g) return;
                const next = window.prompt('Enter new name for the group:', g.name);
                if (next == null) return;
                const newName = next.trim();
                if (!newName) {
                    window.showToast('Group name cannot be empty.', 'error');
                    return;
                }
                updateGroup(id, (group) => ({ ...group, name: newName }));
            };
        });

        el.querySelectorAll('[data-delete-group-id]').forEach(btn => {
            btn.onclick = async () => {
                const id = btn.getAttribute('data-delete-group-id');
                if (!confirm('Are you sure you want to delete this group?')) return;
                groups = groups.filter(x => x.id !== id);
                await persistGroups();
                window.showToast('Group deleted.', 'success');
                await loadGroupsForTeam();
            };
        });

        el.querySelectorAll('[data-add-group-id]').forEach(btn => {
            btn.onclick = async () => {
                const id = btn.getAttribute('data-add-group-id');
                if (selectedStudentIds.size === 0) {
                    window.showToast('Select students first.', 'error');
                    return;
                }
                const g = groups.find(x => x.id === id);
                if (!g) return;

                const existingMemberIds = new Set((g.members || []).map(m => m.studentId));
                const toAdd = studentsAll
                    .filter(s => selectedStudentIds.has(s.id))
                    .filter(s => !existingMemberIds.has(s.id))
                    .map(s => ({ studentId: s.id, studentName: s.name }));

                if (toAdd.length === 0) {
                    window.showToast('All selected students are already in this group.', 'success');
                    return;
                }

                g.members = [...(g.members || []), ...toAdd];
                await persistGroups();
                window.showToast('Students added to group!', 'success');
                selectedStudentIds.clear();
                refreshSelectedPreviews();
                await loadGroupsForTeam();
            };
        });

        el.querySelectorAll('[data-remove-group-id]').forEach(btn => {
            btn.onclick = async () => {
                const id = btn.getAttribute('data-remove-group-id');
                if (selectedStudentIds.size === 0) {
                    window.showToast('Select students first.', 'error');
                    return;
                }
                const g = groups.find(x => x.id === id);
                if (!g) return;

                const removeIds = new Set([...selectedStudentIds]);
                const newMembers = (g.members || []).filter(m => !removeIds.has(m.studentId));

                if (newMembers.length === 0) {
                    window.showToast('A group must have at least one member. Cannot leave it empty.', 'error');
                    return;
                }

                g.members = newMembers;
                await persistGroups();
                window.showToast('Students removed from group.', 'success');
                selectedStudentIds.clear();
                refreshSelectedPreviews();
                await loadGroupsForTeam();
            };
        });
    }

    // 6. Accordion Navigation Binding
    document.querySelectorAll('.pw-accordion-header').forEach(header => {
        header.onclick = () => {
            const item = header.closest('.pw-accordion-item');
            const step = item.getAttribute('data-step');
            if (step === 'students' && !selectedTeamId) {
                window.showToast('Please select a team first.', 'error');
                return;
            }
            openAccordionStep(step);
        };
    });

    // Back behavior
    document.getElementById('pwBackBtn').onclick = () => {
        const root = document.querySelector('[data-pw-root]');
        const returnBack = () => {
            topActions.innerHTML = '';
            const progTab = document.querySelector('.nav-item[data-view="programs"]');
            if (progTab) {
                progTab.click();
            } else if (typeof window.navigateTo === 'function') {
                window.navigateTo('programs');
            }
        };

        if (root) {
            root.style.animation = 'pwSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) reverse forwards';
            setTimeout(returnBack, 300);
        } else {
            returnBack();
        }
    };

    // 7. Initial Initialization
    async function initialize() {
        await loadTeams();
        const categories = await loadCategories();

        // Resolve name-based inheritedCategoryId to canonical ID
        if (inheritedCategoryId && !categoriesById.has(inheritedCategoryId)) {
            for (const [id, data] of categoriesById.entries()) {
                if (normalizeText(data.name) === normalizeText(inheritedCategoryId)) {
                    inheritedCategoryId = id;
                    selectedCategoryId = id;
                    break;
                }
            }
        } else {
            selectedCategoryId = inheritedCategoryId;
        }

        // Populate class inline filter
        const classes = getClassesForCategory(inheritedCategoryId);
        const classFilter = document.getElementById('pwClassFilter');
        if (classFilter) {
            classFilter.innerHTML = `<option value="">All Classes</option>` +
                classes.map(c => `<option value="${c.id}">${window.escapeHTML(c.name)}</option>`).join('');
        }

        // Render teams list
        renderSelectList(document.getElementById('pwTeamList'), teams, '', { getLabel: x => x.name });

        // Team search input listener
        document.getElementById('pwTeamSearch')?.addEventListener('input', debounce((e) => {
            const q = normalizeText(e.target.value);
            const filtered = q ? teams.filter(t => normalizeText(t.name).includes(q)) : teams;
            renderSelectList(document.getElementById('pwTeamList'), filtered, selectedTeamId, { getLabel: x => x.name });
        }, 80));

        // Team list item selection listener
        document.getElementById('pwTeamList')?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-select-id]');
            if (!btn) return;

            const id = btn.getAttribute('data-select-id');
            selectedTeamId = id;
            selectedStudentIds.clear();
            groups = [];

            // Set Pill updates
            const tName = teamById.get(selectedTeamId)?.name;
            setPill('Team', tName);
            const labelEl = document.getElementById('pwTeamSelectedLabel');
            if (labelEl) labelEl.textContent = tName ? `· ${tName}` : '';
            document.getElementById('pwSelectedCount').textContent = '0';

            // Enable search and filters
            const searchInput = document.getElementById('pwStudentSearch');
            if (searchInput) searchInput.disabled = false;
            if (classFilter) classFilter.disabled = false;

            // Re-render select list for active styling
            renderSelectList(document.getElementById('pwTeamList'), teams, selectedTeamId, { getLabel: x => x.name });

            // Query students
            loadStudentsForSelection();
            if (isGroupEvent) loadGroupsForTeam();

            openAccordionStep('students');
        });

        // Class filter dropdown change
        classFilter?.addEventListener('change', (e) => {
            selectedClassId = e.target.value;
            applyStudentSearchFilter();
        });

        // Student search input change
        document.getElementById('pwStudentSearch')?.addEventListener('input', debounce(() => {
            applyStudentSearchFilter();
        }, 120));

        // Clear Selection
        document.getElementById('pwClearSelectedBtn')?.addEventListener('click', () => {
            selectedStudentIds.clear();
            refreshSelectedPreviews();
            renderStudentList();
        });

        // Save Individual Selection
        document.getElementById('pwSaveParticipantsBtn')?.addEventListener('click', async () => {
            if (!selectedTeamId || !inheritedCategoryId) {
                window.showToast('Please select a team.', 'error');
                return;
            }
            if (selectedStudentIds.size === 0) {
                window.showToast('Select at least one student first.', 'error');
                return;
            }

            const btn = document.getElementById('pwSaveParticipantsBtn');
            const statusEl = document.getElementById('pwSaveStatus');
            if (btn.dataset.locked === '1') return;
            btn.dataset.locked = '1';
            btn.disabled = true;
            const previousLabel = btn.textContent;
            btn.textContent = 'Saving...';
            if (statusEl) statusEl.textContent = 'Saving participant registrations...';

            try {
                const partRef = collection(db, "institutes", window.currentInstituteId, "programs", progId, "participants");
                let existingSnap;
                try {
                    existingSnap = await getDocs(query(
                        partRef,
                        where('type', '==', 'individual'),
                        where('teamId', '==', selectedTeamId)
                    ));
                } catch (err) {
                    existingSnap = await getDocs(partRef);
                }
                const existingStudentIds = new Set();
                existingSnap.forEach(d => {
                    const data = d.data();
                    if (data.type === 'individual' && data.teamId === selectedTeamId && (data.categoryId || '') === inheritedCategoryId && data.studentId) {
                        existingStudentIds.add(data.studentId);
                    }
                });

                const toAdd = [...selectedStudentIds]
                    .filter(id => !existingStudentIds.has(id))
                    .map(id => studentsAll.find(s => s.id === id))
                    .filter(Boolean);

                if (toAdd.length === 0) {
                    window.showToast('All selected students are already assigned to this program.', 'success');
                    if (statusEl) statusEl.textContent = 'No new participants to save.';
                    btn.dataset.locked = '0';
                    refreshSelectedPreviews();
                    return;
                }

                const batch = writeBatch(db);
                for (const s of toAdd) {
                    const newDoc = doc(partRef, `individual_${safeDocId(selectedTeamId)}_${safeDocId(s.id)}`);
                    batch.set(newDoc, {
                        type: 'individual',
                        studentId: s.id || '',
                        studentName: s.name || '',
                        chestNumber: s.chestNumber || '',
                        gender: s.gender || '',
                        teamId: selectedTeamId || '',
                        teamName: teamById.get(selectedTeamId)?.name || '',
                        categoryId: inheritedCategoryId || '',
                        categoryName: categoriesById.get(inheritedCategoryId)?.name || s.categoryName || '',
                        classId: s.classId || '',
                        className: s.className || '',
                        programId: progId || '',
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp()
                    });
                }
                await batch.commit();
                toAdd.forEach(s => savedIndividualStudentIds.add(s.id));
                window.showToast(`${toAdd.length} participant${toAdd.length === 1 ? '' : 's'} saved successfully!`, 'success');
                if (statusEl) statusEl.textContent = `${toAdd.length} participant${toAdd.length === 1 ? '' : 's'} saved.`;
                selectedStudentIds.clear();
                await loadStudentsForSelection();
            } catch (e) {
                console.error(e);
                window.showToast('Failed to save participants.', 'error');
                if (statusEl) statusEl.textContent = 'Save failed. Please check your connection and try again.';
            } finally {
                btn.textContent = previousLabel;
                btn.dataset.locked = '0';
                refreshSelectedPreviews();
            }
        });

        // Create New Group Action
        document.getElementById('pwCreateGroupBtn')?.addEventListener('click', async () => {
            const nameInput = document.getElementById('pwNewGroupName');
            const groupName = (nameInput.value || '').trim();

            if (!groupName) {
                window.showToast('Group name is required.', 'error');
                return;
            }
            if (!selectedTeamId || !inheritedCategoryId) {
                window.showToast('Please select a team.', 'error');
                return;
            }
            if (selectedStudentIds.size === 0) {
                window.showToast('Select at least one student for the group.', 'error');
                return;
            }

            const createBtn = document.getElementById('pwCreateGroupBtn');
            if (createBtn.dataset.locked === '1') return;
            createBtn.dataset.locked = '1';
            createBtn.disabled = true;

            try {
                const groupId = uid('group');
                const members = studentsAll
                    .filter(s => selectedStudentIds.has(s.id))
                    .map(s => ({
                        studentId: s.id || '',
                        studentName: s.name || ''
                    }));

                if (members.length === 0) {
                    window.showToast('Empty groups cannot be saved.', 'error');
                    createBtn.dataset.locked = '0';
                    createBtn.disabled = false;
                    return;
                }

                const containerDoc = await getOrCreateTeamParticipantContainer();
                const docRef = containerDoc.ref;
                const existingGroups = containerDoc.data.groups || [];

                const newGroup = { id: groupId, name: groupName, members };
                const updatedGroups = [...existingGroups, newGroup].map(g => ({
                    id: g.id || '',
                    name: g.name || '',
                    members: (g.members || []).map(m => ({
                        studentId: m.studentId || '',
                        studentName: m.studentName || ''
                    }))
                }));

                await setDoc(docRef, {
                    teamId: selectedTeamId || '',
                    teamName: teamById.get(selectedTeamId)?.name || '',
                    categoryId: inheritedCategoryId || '',
                    classId: selectedClassId || '',
                    programId: progId || '',
                    type: 'group',
                    groups: updatedGroups,
                    updatedAt: serverTimestamp()
                }, { merge: true });

                window.showToast('Group created successfully!', 'success');
                nameInput.value = '';
                selectedStudentIds.clear();
                await loadGroupsForTeam();
                refreshSelectedPreviews();
            } catch (e) {
                console.error(e);
                window.showToast('Failed to create group.', 'error');
            } finally {
                createBtn.dataset.locked = '0';
                createBtn.disabled = false;
            }
        });
    }

    function renderAssignedManagement() {
        const panel = document.getElementById('pwAssignedManagementPanel');
        if (!panel) return;

        if (!selectedTeamId || isGroupEvent) {
            panel.style.display = 'none';
            return;
        }

        panel.style.display = 'block';

        let listHTML = '';
        if (assignedParticipantsAll.length === 0) {
            listHTML = `<div class="pw-empty" style="padding:1rem; text-align:center; color:#64748b; background:#f8fafc; border-radius:8px; border:1px dashed #cbd5e1; font-size:0.85rem;">No participants currently assigned to this program for this team.</div>`;
        } else {
            listHTML = assignedParticipantsAll.map(p => {
                const isEditing = editingParticipantId === p.studentId;

                if (isEditing) {
                    return `
                        <div class="pw-assigned-card editing" style="background:#f8fafc; border:1px solid #3b82f6; border-radius:8px; padding:1rem; margin-bottom:1rem; box-shadow:0 1px 3px rgba(0,0,0,0.1);">
                            <div style="display:flex; flex-direction:column; gap:0.75rem;">
                                <div>
                                    <label class="form-label" style="font-size:0.75rem; font-weight:700; color:#475569;">STUDENT NAME</label>
                                    <input type="text" id="pwEditName_${p.studentId}" class="form-input" value="${window.escapeHTML(p.studentName)}" style="font-size:0.85rem;" />
                                </div>
                                <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem;">
                                    <div>
                                        <label class="form-label" style="font-size:0.75rem; font-weight:700; color:#475569;">ID / CHEST NUMBER</label>
                                        <input type="text" id="pwEditChest_${p.studentId}" class="form-input" value="${window.escapeHTML(p.chestNumber)}" style="font-size:0.85rem;" />
                                    </div>
                                    <div>
                                        <label class="form-label" style="font-size:0.75rem; font-weight:700; color:#475569;">CLASS</label>
                                        <input type="text" id="pwEditClass_${p.studentId}" class="form-input" value="${window.escapeHTML(p.className)}" style="font-size:0.85rem;" />
                                    </div>
                                </div>
                                <div style="display:flex; gap:0.5rem; justify-content:flex-end; margin-top:0.25rem;">
                                    <button class="btn btn-secondary btn-sm pw-cancel-edit-btn" data-id="${p.studentId}" style="padding:0.25rem 0.6rem; font-size:0.75rem; font-weight:600;">Cancel</button>
                                    <button class="btn btn-primary btn-sm pw-save-edit-btn" data-id="${p.studentId}" style="padding:0.25rem 0.6rem; font-size:0.75rem; font-weight:600;">Save Changes</button>
                                </div>
                            </div>
                        </div>
                    `;
                }

                return `
                    <div class="pw-assigned-card" style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:0.85rem 1rem; margin-bottom:0.75rem; display:flex; justify-content:space-between; align-items:center; box-shadow:0 1px 2px rgba(0,0,0,0.05); transition:all 0.2s;">
                        <div style="flex:1; min-width:0; padding-right:1rem;">
                            <div style="font-size:0.95rem; font-weight:700; color:#1e293b; text-transform:uppercase; margin-bottom:0.35rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                                [ ${window.escapeHTML(p.studentName)} ]
                            </div>
                            <div style="display:flex; gap:1rem; font-size:0.8rem; color:#64748b;">
                                <span><strong>ID:</strong> #${window.escapeHTML(p.chestNumber)}</span>
                                <span><strong>Class:</strong> ${window.escapeHTML(p.className)}</span>
                            </div>
                        </div>
                        <div style="display:flex; gap:0.4rem; flex-shrink:0;">
                            <button class="btn btn-secondary btn-sm pw-edit-assigned-btn" data-id="${p.studentId}" style="padding:0.25rem 0.6rem; font-size:0.75rem; font-weight:600; border-color:#cbd5e1; color:#475569; background:#fff;">Edit</button>
                            <button class="btn btn-danger btn-sm pw-delete-assigned-btn" data-id="${p.studentId}" style="padding:0.25rem 0.6rem; font-size:0.75rem; font-weight:600; background:#fef2f2; border-color:#fca5a5; color:#dc2626;">Delete</button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        panel.innerHTML = `
            <div class="pw-section-head" style="margin-bottom:1rem; display:flex; flex-direction:column; gap:0.15rem;">
                <h3 style="font-size:1.05rem; font-weight:700; color:#0f172a; display:flex; align-items:center; gap:0.5rem; margin:0;">
                    📋 Assigned Participants Management
                    <span style="font-size:0.8rem; font-weight:normal; color:#64748b; background:#f1f5f9; padding:0.15rem 0.45rem; border-radius:4px; margin-left:auto;">${assignedParticipantsAll.length} assigned</span>
                </h3>
                <div class="pw-muted" style="font-size:0.78rem; color:#64748b;">Manage already assigned individual participants.</div>
            </div>
            <div class="pw-assigned-list" style="display:flex; flex-direction:column; max-height:450px; overflow-y:auto; padding-right:0.25rem;">
                ${listHTML}
            </div>
        `;

        // Wire Event Listeners

        // 1. Edit Button click
        panel.querySelectorAll('.pw-edit-assigned-btn').forEach(btn => {
            btn.onclick = () => {
                const id = btn.getAttribute('data-id');
                editingParticipantId = id;
                renderAssignedManagement();
            };
        });

        // 2. Cancel Edit Button click
        panel.querySelectorAll('.pw-cancel-edit-btn').forEach(btn => {
            btn.onclick = () => {
                editingParticipantId = null;
                renderAssignedManagement();
            };
        });

        // 3. Save Edit Button click
        panel.querySelectorAll('.pw-save-edit-btn').forEach(btn => {
            btn.onclick = async () => {
                const id = btn.getAttribute('data-id');
                const nameInput = document.getElementById(`pwEditName_${id}`);
                const chestInput = document.getElementById(`pwEditChest_${id}`);
                const classInput = document.getElementById(`pwEditClass_${id}`);

                const newName = (nameInput.value || '').trim();
                const newChest = (chestInput.value || '').trim();
                const newClass = (classInput.value || '').trim();

                if (!newName) {
                    window.showToast("Student Name is required.", "error");
                    return;
                }

                const spinner = document.getElementById('pwStudentsSkeleton');
                if (spinner) spinner.style.display = 'block';

                try {
                    const partRef = collection(db, "institutes", window.currentInstituteId, "programs", progId, "participants");
                    let docId = participantDocIds.get(id);
                    if (!docId) {
                        docId = `individual_${safeDocId(selectedTeamId)}_${safeDocId(id)}`;
                    }
                    const docRef = doc(partRef, docId);

                    await setDoc(docRef, {
                        studentName: newName,
                        chestNumber: newChest,
                        className: newClass,
                        updatedAt: serverTimestamp()
                    }, { merge: true });

                    window.showToast("Participant updated successfully!", "success");

                    editingParticipantId = null;

                    await loadStudentsForSelection();

                } catch (e) {
                    console.error("Edit failure:", e);
                    window.showToast("Failed to save changes.", "error");
                } finally {
                    if (spinner) spinner.style.display = 'none';
                }
            };
        });

        // 4. Delete Button click
        panel.querySelectorAll('.pw-delete-assigned-btn').forEach(btn => {
            btn.onclick = async () => {
                const id = btn.getAttribute('data-id');
                if (!confirm("Are you sure you want to delete this participant?")) return;

                const spinner = document.getElementById('pwStudentsSkeleton');
                if (spinner) spinner.style.display = 'block';

                try {
                    const partRef = collection(db, "institutes", window.currentInstituteId, "programs", progId, "participants");
                    let docId = participantDocIds.get(id);
                    if (!docId) {
                        docId = `individual_${safeDocId(selectedTeamId)}_${safeDocId(id)}`;
                    }
                    const docRef = doc(partRef, docId);

                    await deleteDoc(docRef);

                    // Fully update local state to avoid cached/ghost entries
                    savedIndividualStudentIds.delete(id);
                    selectedStudentIds.delete(id);

                    window.showToast("Participant deleted successfully!", "success");

                    await loadStudentsForSelection();

                } catch (e) {
                    console.error("Delete failure:", e);
                    window.showToast("Failed to delete participant.", "error");
                } finally {
                    if (spinner) spinner.style.display = 'none';
                }
            };
        });
            }

    // Start running the initialization
    await initialize();
}
        