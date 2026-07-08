import { db, getCachedTeams, getCachedCategories, getCachedPrograms, updateDashboardMetadata } from './firebase.js';
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
    serverTimestamp,
    increment,
    collectionGroup
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

export async function initParticipantsWorkflowView(container, topActions, { progId, progData }) {
    // 1. Initial State Variables
    const pType = (progData.programType || progData.type || 'individual').toLowerCase();
    const isGroupEvent = pType === 'group' || (pType === 'general' && progData.registrationType === 'group');
    const progNumberStr = progData.programNumber ? `[#${progData.programNumber}] ` : '';
    const progName = progNumberStr + (progData.programName || 'Program');
    const genderFilter = progData.genderCategory || 'Mixed';
    let inheritedCategoryId = progData.categoryId || '';

    const teams = [];
    const teamById = new Map();
    const categoriesById = new Map();

    let selectedTeamId = '';
    let selectedCategoryId = '';
    let selectedClassId = '';
    let activeFilter = 'all'; // 'all' | 'eligible' | 'assigned' | 'unassigned' | 'selected'

    let studentsAll = []; // Full list fetched from Firestore for selected Team + Category
    let studentsFiltered = []; // Filtered list based on search/class/pill filters
    let registrationsMap = new Map(); // studentId -> Set of registered program names
    let studentGroupsMap = new Map(); // studentId -> { groupName, teamName, memberCount, members }
    let allEventGroups = []; // Array of groups from all teams in this program
    let savedIndividualStudentIds = new Set();
    let assignedParticipantsAll = []; // Stores detailed objects of assigned participants for current team
    let editingParticipantId = null; // Scoped variable for inline editing
    const selectedStudentIds = new Set(); // Holds selected checkbox buffer student IDs
    let groups = []; // For group event: list of created groups in the current team
    let selectedGroupId = '';
    const selectedGroupMemberIds = new Set();
    let groupContainerRef = null; // Reference to the program group container doc
    const participantDocIds = new Map(); // studentId -> firestoreDocId

    // Keyboard Navigation Highlight State
    let activeStudentIndex = -1;
    let renderLimit = 80;

    // Real-time calculated status variables
    let resultSubmitted = false;
    let resultPublished = false;

    // 2. Set Up Main Page UI Structure (Three-Panel Layout)
    container.innerHTML = `
    <div class="pw-page" data-pw-root>
      <!-- Header -->
      <div class="pw-sticky-header">
        <div class="pw-header-left">
          <div class="pw-breadcrumb">Admin Panel · Programs · Add Students</div>
          <div class="pw-header-title-row">
            <h2 class="pw-title">👥 ${window.escapeHTML(progName)}</h2>
          </div>
          <div class="pw-header-meta-row">
            <span class="pw-meta-item">Category: <strong id="pwHeaderCategoryLabel">Loading...</strong></span>
            <span class="pw-meta-divider">•</span>
            <span class="pw-meta-item">Gender: <strong>${window.escapeHTML(genderFilter)}</strong></span>
            <span class="pw-meta-divider">•</span>
            <span class="pw-meta-item">Location: <strong>${window.escapeHTML(progData.programLocation || '—')}</strong></span>
            <span class="pw-meta-divider">•</span>
            <span class="pw-badge-compact ${isGroupEvent ? 'pw-badge-registered' : 'pw-badge-male'}">
              ${isGroupEvent ? 'Group' : 'Individual'}
            </span>
            <span class="pw-badge-compact pw-badge-cannot" id="pwHeaderStatusBadge">Pending</span>
          </div>
          <div class="pw-header-status-row">
            <span class="pw-badge-compact pw-badge-team" id="pwHeaderTeamBadge" style="display: none;">Team: —</span>
            <span class="pw-badge-compact pw-badge-selected-count" id="pwHeaderSelectedCountBadge" style="display: none;">Selected: 0</span>
            <span class="pw-badge-compact pw-badge-registered" id="pwHeaderParticipantCount">👥 0 Participants</span>
          </div>
        </div>
        <div class="pw-header-right">
          <button class="btn btn-secondary" id="pwBackBtn">← Back to Programs</button>
        </div>
      </div>

      <!-- Main Layout Panels wrapper -->
      <div class="pw-content">
        <div class="pw-grid">
          
          <!-- 1. LEFT PANEL: Student Directory -->
          <aside class="pw-panel">
            <div class="pw-panel-header">
              <div class="pw-panel-title">
                <span>🎓 Student List</span>
                <span id="pwStudentsCountLabel" style="font-size: 0.72rem; color: var(--pw-slate-500); font-weight: 600;">Total: 0</span>
              </div>
              <div class="pw-search-wrapper">
                <span class="pw-search-icon">🔍</span>
                <input type="text" id="pwStudentSearch" class="pw-search-input" placeholder="Search by name, chest #... (Ctrl+F)" disabled />
              </div>
              <div style="display:flex; gap:0.5rem;">
                <select id="pwClassFilter" class="pw-select-compact" disabled style="flex:1;">
                  <option value="">All Classes</option>
                </select>
              </div>
              <div class="pw-filter-scroll" id="pwFilterPills">
                <button class="pw-filter-pill is-active" data-filter="all">All</button>
                <button class="pw-filter-pill" data-filter="eligible">Available</button>
                <button class="pw-filter-pill" data-filter="selected">Selected</button>
              </div>
            </div>
            
            <div class="pw-panel-body" id="pwStudentListScroll" style="padding-top: 0.5rem;">
              <div id="pwStudentList" class="pw-student-list"></div>
              <div id="pwStudentsSkeleton" class="pw-skeleton" style="display:none; height:180px; margin-top:1rem;"></div>
            </div>
          </aside>

          <!-- 2. CENTER PANEL: Selected & Selection Summary -->
          <aside class="pw-panel">
            <div class="pw-panel-header" style="gap: 0.5rem;">
              <div class="pw-panel-title">🏢 Choose Team</div>
              <!-- Compact segmented button group -->
              <div class="pw-segments" id="pwTeamList"></div>
            </div>
            
            <div class="pw-panel-body">
              <div class="pw-selection-buffer-card is-empty">
                <div class="pw-panel-title">
                  <span>👥 Selected Students</span>
                  <span class="pw-badge-compact pw-badge-registered" id="pwSelectedCountBadge">0</span>
                </div>
                
                <!-- Selected chips preview list -->
                <div id="pwSelectedStudentsPreview" class="pw-selected-list"></div>
              </div>
              
              <!-- Registration Constraints Summary -->
              <div class="pw-summary-panel">
                <div class="pw-panel-title" style="font-size: 0.78rem; text-transform: uppercase;">📋 Registration Summary</div>
                <div class="pw-summary-metrics">
                  <div class="pw-metric-card">
                    <span class="pw-metric-label">Selected Count</span>
                    <span class="pw-metric-value" id="pwMetricSelected">0 / —</span>
                  </div>
                  <div class="pw-metric-card">
                    <span class="pw-metric-label">Remaining Slots</span>
                    <span class="pw-metric-value" id="pwMetricSlots">—</span>
                  </div>
                </div>
                
                <div class="pw-progress-wrapper">
                  <div class="pw-progress-bar-bg">
                    <div class="pw-progress-bar-fill" id="pwProgressBarFill"></div>
                  </div>
                </div>
                
                <!-- Conflicting warnings alert container -->
                <div class="pw-alert-container" id="pwAlertContainer"></div>
              </div>
            </div>
            
            <div class="pw-panel-footer">
              ${isGroupEvent ? `
                <div class="pw-group-create-container">
                  <input id="pwNewGroupName" class="form-input" placeholder="New Group Name (e.g. Group A)" style="font-size: 0.8rem; padding: 0.55rem 0.75rem;" />
                  <button class="btn btn-primary" id="pwCreateGroupBtn" disabled style="width:100%; font-weight:700; min-height:38px;">+ Create Group</button>
                </div>
              ` : `
                <div class="pw-save-container-mobile">
                  <div class="pw-mobile-save-info" style="display: none;">
                    <span class="pw-mobile-save-count" id="pwFooterSelectedCount">0</span> selected
                  </div>
                  <button class="btn btn-primary" id="pwSaveParticipantsBtn" disabled style="width:100%; font-weight:700; min-height:38px;">💾 Save Participants</button>
                </div>
                <div class="pw-save-status" id="pwSaveStatus" aria-live="polite" style="margin-top: 0.5rem; font-size:0.72rem; color:var(--pw-slate-500); text-align:center;"></div>
              `}
            </div>
          </aside>

          <!-- 3. RIGHT PANEL: Existing Groups / Active Registrations -->
          <main class="pw-panel" id="pwRightPanel">
            <div class="pw-panel-header" id="pwRightPanelHeader" style="cursor: pointer;">
              <div class="pw-panel-title">
                <span id="pwRightPanelTitleText">${isGroupEvent ? '📂 Registered Groups' : '📋 Assigned Participants'}</span>
                <span id="pwRightPanelHeaderArrow" class="pw-accordion-arrow" style="display: none;">▼</span>
              </div>
              <p class="pw-subtitle" style="margin:0;">
                ${isGroupEvent ? 'Manage created groups and member registers.' : 'List of saved individual registrations for this team.'}
              </p>
            </div>
            
            <div class="pw-panel-body" id="pwRightPanelBody">
              ${isGroupEvent ? `
                <div id="pwGroupsList" class="pw-group-list"></div>
              ` : `
                <div id="pwAssignedManagementPanel"></div>
              `}
            </div>
          </main>
          
        </div>
      </div>
      
    </div>
    `;

    // 3. UI Helpers
    function setPill(which, val) {
        // Obsolete or fallback pill updates
        const el = document.getElementById(`pw${which}Pill`);
        if (el) el.textContent = val || '—';
    }

    // Dynamic Program Status Calculation (Real-Time Badge Engine)
    function updateProgramHeaderBadges() {
        const pCountBadge = document.getElementById('pwHeaderParticipantCount');
        const statusBadge = document.getElementById('pwHeaderStatusBadge');

        let pCount = 0;
        let pText = '0 Participants';

        if (isGroupEvent) {
            pCount = groups.length;
            pText = `${pCount} ${pCount === 1 ? 'Team' : 'Teams'}`;
        } else {
            pCount = assignedParticipantsAll.length;
            pText = `${pCount} ${pCount === 1 ? 'Participant' : 'Participants'}`;
        }

        if (pCountBadge) pCountBadge.innerHTML = `👥 ${pText}`;

        const rightPanelTitleText = document.getElementById('pwRightPanelTitleText');
        if (rightPanelTitleText) {
            rightPanelTitleText.textContent = isGroupEvent 
                ? `📂 Registered Groups (${groups.length})` 
                : `📋 Assigned Participants (${assignedParticipantsAll.length})`;
        }

        let status = 'Pending';
        let badgeClass = 'pw-badge-pending';

        if (pCount > 0) {
            status = 'Active';
            badgeClass = 'pw-badge-active';
        }
        if (resultSubmitted) {
            status = 'Submitted';
            badgeClass = 'pw-badge-submitted';
        }
        if (resultPublished) {
            status = 'Published';
            badgeClass = 'pw-badge-published';
        }

        if (statusBadge) {
            statusBadge.className = `pw-badge-compact ${badgeClass}`;
            statusBadge.textContent = status;
        }
    }

    function updateActionButtonsState() {
        document.querySelectorAll('.pw-group-card').forEach(card => {
            const groupId = card.getAttribute('data-group-id');
            const addBtn = card.querySelector('[data-add-group-id]');
            const removeBtn = card.querySelector('[data-remove-group-id]');

            if (groupId === selectedGroupId) {
                card.classList.add('is-selected');
            } else {
                card.classList.remove('is-selected');
            }

            if (addBtn) {
                const shouldEnableAdd = (selectedGroupId === groupId) && (selectedStudentIds.size > 0);
                addBtn.disabled = !shouldEnableAdd;
            }

            if (removeBtn) {
                const shouldEnableRemove = (selectedGroupId === groupId) && (selectedGroupMemberIds.size > 0);
                removeBtn.disabled = !shouldEnableRemove;
            }
        });
    }

    function toggleStudentSelection(student) {
        const id = student.id;
        const isAssigned = savedIndividualStudentIds.has(id) || (isGroupEvent && groups.some(g => g.members?.some(m => m.studentId === id)));
        if (isAssigned) return;

        if (selectedStudentIds.has(id)) {
            selectedStudentIds.delete(id);
        } else {
            selectedStudentIds.add(id);
        }
        refreshSelectedPreviews();
        renderStudentList();
    }

    function refreshSelectedPreviews() {
        const badgeEl = document.getElementById('pwSelectedCountBadge');
        if (badgeEl) badgeEl.textContent = selectedStudentIds.size;

        const footerCountEl = document.getElementById('pwFooterSelectedCount');
        if (footerCountEl) footerCountEl.textContent = selectedStudentIds.size;

        const bufferCard = document.querySelector('.pw-selection-buffer-card');
        if (bufferCard) {
            if (selectedStudentIds.size === 0) {
                bufferCard.classList.add('is-empty');
            } else {
                bufferCard.classList.remove('is-empty');
            }
        }

        const previewEl = document.getElementById('pwSelectedStudentsPreview');
        if (previewEl) {
            const selected = studentsAll.filter(s => selectedStudentIds.has(s.id));
            previewEl.innerHTML = selected.map(s => {
                const initials = s.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
                return `
                    <div class="pw-selected-item">
                        <div class="pw-selected-item-avatar">${window.escapeHTML(initials)}</div>
                        <div class="pw-selected-item-name">${window.escapeHTML(s.name)}</div>
                        <div class="pw-selected-item-chest">#${window.escapeHTML(s.chestNumber || '—')}</div>
                        <button class="pw-selected-item-remove" data-id="${s.id}" title="Remove student">✕</button>
                    </div>
                `;
            }).join('') || `
                <div style="text-align:center; padding:1.5rem; color:var(--pw-slate-500); border: 1.5px dashed var(--pw-border); border-radius:var(--pw-radius-md); font-size:0.75rem;">
                    No students selected. Check cards on the left panel.
                </div>
            `;

            previewEl.querySelectorAll('.pw-selected-item-remove').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const id = btn.getAttribute('data-id');
                    selectedStudentIds.delete(id);
                    refreshSelectedPreviews();
                    renderStudentList();
                };
            });
        }

        // Metrics & Progress bar updates
        const maxVal = progData.maxParticipants || 0;
        const minVal = isGroupEvent ? 2 : 1;
        const selectedCount = selectedStudentIds.size;

        const metricSelected = document.getElementById('pwMetricSelected');
        const metricSlots = document.getElementById('pwMetricSlots');
        const progressFill = document.getElementById('pwProgressBarFill');
        const alertContainer = document.getElementById('pwAlertContainer');

        if (metricSelected) {
            metricSelected.textContent = `${selectedCount} / ${maxVal || '∞'}`;
        }

        if (metricSlots) {
            if (maxVal) {
                metricSlots.textContent = Math.max(0, maxVal - selectedCount);
            } else {
                metricSlots.textContent = '∞';
            }
        }

        if (progressFill) {
            if (maxVal) {
                const pct = Math.min(100, (selectedCount / maxVal) * 100);
                progressFill.style.width = `${pct}%`;
                progressFill.className = 'pw-progress-bar-fill';
                if (selectedCount > maxVal) {
                    progressFill.classList.add('is-limit');
                } else if (selectedCount >= minVal) {
                    progressFill.classList.add('is-valid');
                }
            } else {
                progressFill.style.width = selectedCount > 0 ? '100%' : '0%';
                progressFill.className = 'pw-progress-bar-fill is-valid';
            }
        }

        // Alerts & Warning validations
        let alertsHTML = '';
        if (maxVal && selectedCount > maxVal) {
            alertsHTML += `
                <div class="pw-alert pw-alert-danger">
                    <span class="pw-alert-icon">⚠️</span>
                    <span>Limit exceeded! Maximum allowed is ${maxVal} members.</span>
                </div>
            `;
        }
        if (selectedCount < minVal && selectedCount > 0) {
            alertsHTML += `
                <div class="pw-alert pw-alert-warning">
                    <span class="pw-alert-icon">⚠️</span>
                    <span>Need ${minVal - selectedCount} more member${minVal - selectedCount === 1 ? '' : 's'} to meet requirements.</span>
                </div>
            `;
        }

        // Duplicate warnings
        const selectedList = studentsAll.filter(s => selectedStudentIds.has(s.id));
        const elsewhereList = selectedList.filter(s => registrationsMap.has(s.id) && registrationsMap.get(s.id).size > 0);
        if (elsewhereList.length > 0) {
            const names = elsewhereList.map(s => s.name).slice(0, 2).join(', ') + (elsewhereList.length > 2 ? ` and ${elsewhereList.length - 2} others` : '');
            alertsHTML += `
                <div class="pw-alert pw-alert-warning">
                    <span class="pw-alert-icon">⚠️</span>
                    <span>Duplicate Found: ${window.escapeHTML(names)} already registered in other events.</span>
                </div>
            `;
        }

        if (alertContainer) {
            alertContainer.innerHTML = alertsHTML;
        }

        // Save & Create group locks
        if (isGroupEvent) {
            const createBtn = document.getElementById('pwCreateGroupBtn');
            if (createBtn) {
                createBtn.disabled = selectedCount === 0 || (maxVal && selectedCount > maxVal);
            }
        } else {
            const saveBtn = document.getElementById('pwSaveParticipantsBtn');
            if (saveBtn) {
                saveBtn.disabled = selectedCount === 0 || (maxVal && selectedCount > maxVal);
            }
        }

        updateProgramHeaderBadges();
        const selectedBadge = document.getElementById('pwHeaderSelectedCountBadge');
        if (selectedBadge) {
            selectedBadge.textContent = `Selected: ${selectedStudentIds.size}`;
        }
        if (isGroupEvent) {
            updateActionButtonsState();
        }
    }

    function renderStudentList() {
        const el = document.getElementById('pwStudentList');
        if (!el) return;

        if (!studentsFiltered || studentsFiltered.length === 0) {
            el.innerHTML = `<div class="pw-empty" style="text-align:center; padding:2rem; color:var(--pw-slate-500); font-weight:600;">No students match the current filters.</div>`;
            return;
        }

        const visibleStudents = studentsFiltered.slice(0, renderLimit);
        const frag = visibleStudents.map((s, idx) => {
            const isSelected = selectedStudentIds.has(s.id);
            const isAssigned = savedIndividualStudentIds.has(s.id) || (isGroupEvent && groups.some(g => g.members?.some(m => m.studentId === s.id)));
            
            // Determine duplicate status
            let statusText = 'Eligible';
            let statusClass = 'pw-badge-eligible';
            let statusDot = '🟢';
            
            if (isAssigned) {
                statusText = isGroupEvent ? 'Already in this Group' : 'Registered Here';
                statusClass = 'pw-badge-registered';
                statusDot = '🔵';
            } else {
                const hasOtherRegs = registrationsMap.has(s.id) && registrationsMap.get(s.id).size > 0;
                if (hasOtherRegs) {
                    statusText = 'Registered Elsewhere';
                    statusClass = 'pw-badge-elsewhere';
                    statusDot = '🟡';
                } else {
                    statusText = 'Eligible';
                    statusClass = 'pw-badge-eligible';
                    statusDot = '🟢';
                }
            }
            
            // Group membership check (Requirement 12)
            const groupInfo = studentGroupsMap.get(s.id);
            let groupInfoHTML = '';
            if (groupInfo && isGroupEvent) {
                const memberNames = (groupInfo.members || []).map(m => m.studentName).join(', ');
                groupInfoHTML = `
                    <span class="pw-badge-compact pw-badge-elsewhere" title="Members: ${window.escapeHTML(memberNames)}">
                        👥 ${window.escapeHTML(groupInfo.groupName)} (${groupInfo.memberCount} Members)
                    </span>
                `;
            }

            const registeredProgs = Array.from(registrationsMap.get(s.id) || []);
            const tagsHTML = registeredProgs.map(name => `
                <span class="stu-tag" title="${window.escapeHTML(name)}">
                    <span class="stu-tag-check">✔</span> ${window.escapeHTML(name.length > 15 ? name.slice(0, 15) + '...' : name)}
                </span>
            `).join('');

            // Initials avatar
            const nameHash = s.name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
            const avatarHue = nameHash % 360;
            const avatarStyle = `background: hsl(${avatarHue}, 60%, 45%);`;
            const initials = s.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

            const isKeyboardHover = idx === activeStudentIndex ? 'is-keyboard-hover' : '';
            const cardClass = `stu-card ${isSelected ? 'is-selected' : ''} ${isAssigned ? 'is-assigned' : ''} ${isKeyboardHover}`;

            return `
                <div class="${cardClass}" data-stu-id="${s.id}">
                    <div class="stu-card-check">
                        <span class="pw-checkbox"></span>
                    </div>
                    <div class="stu-avatar" style="${avatarStyle}">${window.escapeHTML(initials)}</div>
                    <div class="stu-card-body">
                        <div class="stu-card-title">${window.escapeHTML(s.name)}</div>
                        <div class="stu-card-subtitle">
                            <span>#${window.escapeHTML(s.chestNumber || '—')}</span>
                            <span class="stu-card-dot">•</span>
                            <span>Class: ${window.escapeHTML(s.className || s.classId || '—')}</span>
                            <span class="stu-card-dot">•</span>
                            <span class="pw-badge-compact ${s.gender === 'Female' ? 'pw-badge-female' : 'pw-badge-male'}">${window.escapeHTML(s.gender || '—')}</span>
                            <span class="stu-card-dot">•</span>
                            <span class="pw-badge-compact ${statusClass}">${statusDot} ${statusText}</span>
                            ${groupInfoHTML}
                        </div>
                        ${tagsHTML ? `<div class="stu-tags">${tagsHTML}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        el.innerHTML = frag;

        // Auto scrolling for keyboard list highlights
        const scrollContainer = document.getElementById('pwStudentListScroll');
        if (activeStudentIndex !== -1 && scrollContainer) {
            const activeCard = el.querySelector('.is-keyboard-hover');
            if (activeCard) {
                const containerTop = scrollContainer.scrollTop;
                const containerBottom = containerTop + scrollContainer.clientHeight;
                const elemTop = activeCard.offsetTop;
                const elemBottom = elemTop + activeCard.clientHeight;
                
                if (elemTop < containerTop) {
                    scrollContainer.scrollTop = elemTop;
                } else if (elemBottom > containerBottom) {
                    scrollContainer.scrollTop = elemBottom - scrollContainer.clientHeight;
                }
            }
        }

        // Click handler wires
        el.querySelectorAll('.stu-card').forEach(card => {
            card.onclick = (e) => {
                const id = card.getAttribute('data-stu-id');
                const stu = studentsAll.find(x => x.id === id);
                if (!stu) return;

                const isAssigned = savedIndividualStudentIds.has(id) || (isGroupEvent && groups.some(g => g.members?.some(m => m.studentId === id)));
                if (isAssigned) {
                    window.showToast("This student is already registered for this program.", "error");
                    return;
                }

                toggleStudentSelection(stu);
            };
        });
    }

    function renderTeamSegments() {
        const el = document.getElementById('pwTeamList');
        if (!el) return;
        let html = teams.map(t => {
            const active = t.id === selectedTeamId ? 'is-active' : '';
            return `
                <button type="button" class="pw-segment-btn ${active}" data-team-segment="${t.id}">
                    ${window.escapeHTML(t.name)}
                </button>
            `;
        }).join('');

        const teamlessActive = selectedTeamId === 'teamless' ? 'is-active' : '';
        html += `
            <button type="button" class="pw-segment-btn ${teamlessActive}" data-team-segment="teamless">
                No Team
            </button>
        `;
        el.innerHTML = html;
    }

    // 4. Data Loading Methods
    async function loadTeams() {
        const teamsData = await getCachedTeams(window.currentInstituteId);
        teams.length = 0;
        teamById.clear();
        teamsData.forEach(t => {
            const item = { id: t.id, name: t.name || t.id };
            teams.push(item);
            teamById.set(item.id, item);
        });
    }

    async function loadCategories() {
        const categoriesData = await getCachedCategories(window.currentInstituteId);
        const out = [];
        categoriesById.clear();
        categoriesData.forEach(cat => {
            out.push({ id: cat.id, name: cat.name || cat.id, classes: cat.classes || [] });
            categoriesById.set(cat.id, cat);
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

    function getAllClasses() {
        const all = [];
        const seen = new Set();
        for (const catData of categoriesById.values()) {
            const classes = catData?.classes || [];
            classes.forEach(c => {
                let resolved;
                if (typeof c === 'string') {
                    resolved = { id: c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: c.trim() };
                } else {
                    resolved = { id: c.id, name: c.name || c.id };
                }
                if (resolved.id && !seen.has(resolved.id)) {
                    seen.add(resolved.id);
                    all.push(resolved);
                }
            });
        }
        return all.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    }

    async function loadResultsStatus() {
        try {
            const resultsRef = collection(db, "institutes", window.currentInstituteId, "results");
            const resultsSnap = await getDocs(query(resultsRef, where("programId", "==", progId)));
            resultSubmitted = false;
            resultPublished = false;
            if (!resultsSnap.empty) {
                const resDoc = resultsSnap.docs[0].data();
                if (resDoc.status === 'published') {
                    resultPublished = true;
                }
                if (resDoc.markEntryStatus === 'submitted') {
                    resultSubmitted = true;
                }
            }
        } catch (e) {
            console.error("Error loading results status:", e);
        }
    }

    // Load registrations mapping for duplicate validations and cross-program tag indicators
    async function loadAllTeamRegistrations() {
        registrationsMap.clear();
        studentGroupsMap.clear();
        allEventGroups = [];

        try {
            const instId = window.currentInstituteId;
            const allProgs = await getCachedPrograms(instId);
            const programsMap = new Map(allProgs.map(p => [p.id, p]));
            
            let docs = [];

            // Try collectionGroup fetch
            try {
                const q = query(collectionGroup(db, "participants"), where("teamId", "==", selectedTeamId));
                const snap = await getDocs(q);
                docs = snap.docs;
            } catch (cgErr) {
                console.warn("CollectionGroup query failed, scanning collections in parallel:", cgErr);
                const promises = allProgs.map(async (prog) => {
                    const partRef = collection(db, "institutes", instId, "programs", prog.id, "participants");
                    const q = query(partRef, where("teamId", "==", selectedTeamId));
                    const snap = await getDocs(q);
                    return snap.docs;
                });
                const results = await Promise.all(promises);
                docs = results.flat();
            }

            docs.forEach(d => {
                const data = d.data();
                const pathTokens = d.ref.path.split('/');
                const pId = data.programId || pathTokens[3];
                if (!pId) return;

                const prog = programsMap.get(pId);
                if (!prog) return;
                const progName = (prog.programNumber ? `[#${prog.programNumber}] ` : '') + (prog.programName || 'Unknown Program');
                const pType = (prog.programType || prog.type || 'individual').toLowerCase();
                const isGroup = pType === 'group' || (pType === 'general' && prog.registrationType === 'group');

                if (data.type === 'individual' && data.studentId) {
                    const sId = data.studentId;
                    if (!registrationsMap.has(sId)) registrationsMap.set(sId, new Set());
                    registrationsMap.get(sId).add(progName);
                } else if (data.type === 'group' && Array.isArray(data.groups)) {
                    data.groups.forEach(g => {
                        const gName = g.name || 'Unnamed Group';
                        const memberCount = g.members?.length || 0;
                        if (Array.isArray(g.members)) {
                            g.members.forEach(m => {
                                const sId = m.studentId;
                                if (sId) {
                                    if (!registrationsMap.has(sId)) registrationsMap.set(sId, new Set());
                                    registrationsMap.get(sId).add(`${progName} (${gName})`);
                                    
                                    if (pId === progId) {
                                        studentGroupsMap.set(sId, {
                                            groupName: gName,
                                            teamName: data.teamName || 'Other Team',
                                            memberCount: memberCount,
                                            members: g.members || []
                                        });
                                    }
                                }
                            });
                        }
                    });
                }
            });

            // Load all other group names in this program across the entire institute (for quick group reuse copy)
            if (isGroupEvent) {
                const partRef = collection(db, "institutes", instId, "programs", progId, "participants");
                const programSnap = await getDocs(partRef);
                programSnap.forEach(d => {
                    const data = d.data();
                    if (data.type === 'group' && Array.isArray(data.groups)) {
                        data.groups.forEach(g => {
                            allEventGroups.push({
                                id: g.id,
                                name: g.name,
                                teamId: data.teamId,
                                teamName: data.teamName || 'Other Team',
                                members: g.members || []
                            });
                        });
                    }
                });
            }

        } catch (err) {
            console.error("Error loading all registrations:", err);
        }
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
            await loadResultsStatus();
            await loadAllTeamRegistrations();

            const targetTeamId = selectedTeamId === 'teamless' ? '' : selectedTeamId;

            if (!isGroupEvent) {
                const participantsRef = collection(db, "institutes", window.currentInstituteId, "programs", progId, "participants");
                let existingSnap;
                try {
                    existingSnap = await getDocs(query(
                        participantsRef,
                        where('type', '==', 'individual'),
                        where('teamId', '==', targetTeamId)
                    ));
                } catch (err) {
                    existingSnap = await getDocs(participantsRef);
                }
                existingSnap.forEach(d => {
                    const data = d.data();
                    const matchesCategory = (pType === 'general') || ((data.categoryId || '') === inheritedCategoryId);
                    if (data.type === 'individual' && (data.teamId || '') === targetTeamId && matchesCategory && data.studentId) {
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

            // Fetch eligible student records
            let q;
            if (pType === 'general' || inheritedCategoryId === 'general_programs') {
                q = query(
                    collection(db, "institutes", window.currentInstituteId, "students"),
                    where('teamId', '==', targetTeamId)
                );
            } else {
                q = query(
                    collection(db, "institutes", window.currentInstituteId, "students"),
                    where('categoryId', '==', inheritedCategoryId),
                    where('teamId', '==', targetTeamId)
                );
            }

            // Apply direct queries for non-general events
            if (pType !== 'general' && inheritedCategoryId !== 'general_programs') {
                if (genderFilter === 'Boys') q = query(q, where('gender', '==', 'Male'));
                if (genderFilter === 'Girls') q = query(q, where('gender', '==', 'Female'));
            }

            let snap;
            try {
                snap = await getDocs(q);
            } catch (err) {
                let qFallback;
                if (pType === 'general' || inheritedCategoryId === 'general_programs') {
                    qFallback = query(
                        collection(db, "institutes", window.currentInstituteId, "students"),
                        where('teamId', '==', targetTeamId)
                    );
                } else {
                    qFallback = query(
                        collection(db, "institutes", window.currentInstituteId, "students"),
                        where('categoryId', '==', inheritedCategoryId)
                    );
                }
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

            // Post-filtering safeties
            studentsAll = studentsAll.filter(s => (s.teamId || '') === targetTeamId);
            if (genderFilter === 'Boys') {
                studentsAll = studentsAll.filter(s => s.gender === 'Male');
            } else if (genderFilter === 'Girls') {
                studentsAll = studentsAll.filter(s => s.gender === 'Female');
            }

            studentsAll = uniqById(studentsAll);
            studentsFiltered = studentsAll;
            applyStudentSearchFilter();
            
            // Set stats details
            const label = document.getElementById('pwStudentsCountLabel');
            if (label) label.textContent = `Total: ${studentsAll.length}`;

            renderAssignedManagement();
            if (isGroupEvent) {
                const selectEl = document.getElementById('pwCopyGroupSelect');
                if (selectEl) {
                    selectEl.innerHTML = `<option value="">Copy members from existing group...</option>` +
                        allEventGroups.map(g => `<option value="${g.teamId}:${g.id}">${window.escapeHTML(g.teamName)} - ${window.escapeHTML(g.name)} (${g.members?.length || 0} members)</option>`).join('');
                }
            }

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

        // Apply quick pills filter
        if (activeFilter === 'eligible') {
            filtered = filtered.filter(s => {
                const isAssigned = savedIndividualStudentIds.has(s.id) || (isGroupEvent && groups.some(g => g.members?.some(m => m.studentId === s.id)));
                return !isAssigned;
            });
        } else if (activeFilter === 'selected') {
            filtered = filtered.filter(s => {
                const isAssigned = savedIndividualStudentIds.has(s.id) || (isGroupEvent && groups.some(g => g.members?.some(m => m.studentId === s.id)));
                return isAssigned || selectedStudentIds.has(s.id);
            });
        }

        studentsFiltered = filtered;
        activeStudentIndex = -1;
        renderLimit = 80;
        renderStudentList();
    }

    // 5. Group Persistence & Management Methods
    async function getOrCreateTeamParticipantContainer() {
        const partRef = collection(db, "institutes", window.currentInstituteId, "programs", progId, "participants");
        const targetTeamId = selectedTeamId === 'teamless' ? '' : selectedTeamId;
        let q;
        if (pType === 'general' || selectedCategoryId === 'general_programs') {
            q = query(
                partRef,
                where('type', '==', 'group'),
                where('teamId', '==', targetTeamId)
            );
        } else {
            q = query(
                partRef,
                where('type', '==', 'group'),
                where('teamId', '==', targetTeamId),
                where('categoryId', '==', selectedCategoryId)
            );
        }
        const snap = await getDocs(q);
        if (!snap.empty) {
            const d = snap.docs[0];
            groupContainerRef = d.ref;
            return { ref: d.ref, data: d.data() };
        }

        const newRef = doc(partRef);
        await setDoc(newRef, {
            teamId: targetTeamId,
            teamName: selectedTeamId === 'teamless' ? 'No Team' : (teamById.get(selectedTeamId)?.name || ''),
            categoryId: selectedCategoryId || inheritedCategoryId || 'general_programs',
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
        const targetTeamId = selectedTeamId === 'teamless' ? '' : selectedTeamId;
        let q;
        if (pType === 'general' || selectedCategoryId === 'general_programs') {
            q = query(
                partRef,
                where('type', '==', 'group'),
                where('teamId', '==', targetTeamId)
            );
        } else {
            q = query(
                partRef,
                where('type', '==', 'group'),
                where('teamId', '==', targetTeamId),
                where('categoryId', '==', selectedCategoryId)
            );
        }

        const listEl = document.getElementById('pwGroupsList');
        if (listEl) listEl.innerHTML = `<div class="pw-empty">Loading groups...</div>`;

        const snap = await getDocs(q);
        if (snap.empty) {
            groups = [];
            if (listEl) {
                listEl.innerHTML = `
                    <div style="text-align:center; padding:2rem; color:var(--pw-slate-500); border: 1.5px dashed var(--pw-border); border-radius:var(--pw-radius-md); font-size:0.8rem;">
                        No groups created yet.
                    </div>`;
            }
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

        if (!groups.some(g => g.id === selectedGroupId)) {
            selectedGroupId = '';
            selectedGroupMemberIds.clear();
        }

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

        const targetTeamId = selectedTeamId === 'teamless' ? '' : selectedTeamId;
        await setDoc(groupContainerRef, {
            teamId: targetTeamId,
            teamName: selectedTeamId === 'teamless' ? 'No Team' : (teamById.get(selectedTeamId)?.name || ''),
            categoryId: selectedCategoryId || inheritedCategoryId || '',
            classId: selectedClassId || '',
            programId: progId || '',
            type: 'group',
            groups: normalizedGroups,
            updatedAt: serverTimestamp()
        }, { merge: true });
        await updateDashboardMetadata(window.currentInstituteId);
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
            el.innerHTML = `
                <div style="text-align:center; padding:2rem; color:var(--pw-slate-500); border: 1.5px dashed var(--pw-border); border-radius:var(--pw-radius-md); font-size:0.8rem;">
                    No groups created yet.
                </div>
            `;
            return;
        }

        el.innerHTML = groups.map((g, idx) => {
            const membersCount = g.members?.length || 0;
            const isCardSelected = g.id === selectedGroupId;
            const selectedClass = isCardSelected ? 'is-selected' : '';
            return `
        <div class="pw-group-card ${selectedClass}" data-group-id="${g.id}">
          <div class="pw-group-card-header">
            <div class="pw-group-card-title">
              📁 ${window.escapeHTML(g.name)}
            </div>
            <span class="pw-group-card-badge">👥 ${membersCount} Member${membersCount === 1 ? '' : 's'}</span>
          </div>

          <div class="pw-group-card-body">
            <div class="pw-group-members-list">
              ${membersCount === 0 ? `
                <span style="font-size: 0.72rem; color: var(--pw-slate-500); font-style: italic;">No members assigned.</span>
              ` : g.members.map(m => {
                const isChipSelected = isCardSelected && selectedGroupMemberIds.has(m.studentId);
                const chipSelectedClass = isChipSelected ? 'is-selected' : '';
                return `
                <span class="stu-tag pw-group-member-chip ${chipSelectedClass}" data-group-id="${g.id}" data-student-id="${m.studentId}" style="background:var(--pw-slate-50); padding: 0.2rem 0.45rem; display: inline-flex; align-items: center; gap: 0.25rem; cursor: pointer;">
                  👤 ${window.escapeHTML(m.studentName)}
                  <button class="pw-group-member-remove-btn" data-group-id="${g.id}" data-student-id="${m.studentId}" data-student-name="${window.escapeHTML(m.studentName)}" title="Remove member">✕</button>
                </span>
                `;
              }).join('')}
            </div>
          </div>

          <div class="pw-group-card-actions">
            <div class="pw-group-card-btns-left">
              <button class="btn-group-action pw-edit-group-btn" data-edit-group-id="${g.id}">
                ✏️ Rename
              </button>
              <button class="btn-group-action btn-danger-action pw-delete-group-btn" data-delete-group-id="${g.id}">
                🗑️ Delete
              </button>
            </div>
            <div class="pw-group-card-btns-right">
              <button class="btn-group-action" data-add-group-id="${g.id}" disabled>
                ➕ Add Selected
              </button>
              <button class="btn-group-action" data-remove-group-id="${g.id}" disabled>
                ➖ Remove Selected
              </button>
            </div>
          </div>
        </div>
      `;
        }).join('');

        // Wire group actions
        el.querySelectorAll('[data-edit-group-id]').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-edit-group-id');
                const g = groups.find(x => x.id === id);
                if (!g) return;
                const next = await window.customPrompt('Enter new name for the group:', g.name, 'Rename Group');
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
            btn.onclick = async (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-delete-group-id');
                const confirmed = await window.customConfirm('Are you sure you want to delete this group?');
                if (!confirmed) return;
                groups = groups.filter(x => x.id !== id);
                if (selectedGroupId === id) {
                    selectedGroupId = '';
                    selectedGroupMemberIds.clear();
                }
                await persistGroups();

                const progRef = doc(db, "institutes", window.currentInstituteId, "programs", progId);
                await setDoc(progRef, { participantCount: increment(-1) }, { merge: true });
                await updateDashboardMetadata(window.currentInstituteId);

                window.showToast('Group deleted.', 'success');
                await loadGroupsForTeam();
            };
        });

        // Wire individual member delete button
        el.querySelectorAll('.pw-group-member-remove-btn').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                const groupId = btn.getAttribute('data-group-id');
                const studentId = btn.getAttribute('data-student-id');
                const studentName = btn.getAttribute('data-student-name');
                
                const confirmed = await window.customConfirm("Remove this student from the group?", "Remove Member", {
                    okText: "Remove",
                    cancelText: "Cancel",
                    danger: true
                });
                if (!confirmed) return;

                const g = groups.find(x => x.id === groupId);
                if (!g) return;

                g.members = (g.members || []).filter(m => m.studentId !== studentId);

                // Update local state maps instantly
                studentGroupsMap.delete(studentId);
                if (registrationsMap.has(studentId)) {
                    registrationsMap.get(studentId).delete(`${progName} (${g.name})`);
                }

                // Update other group members' maps count/info
                g.members.forEach(m => {
                    studentGroupsMap.set(m.studentId, {
                        groupName: g.name,
                        teamName: teamById.get(selectedTeamId)?.name || 'This Team',
                        memberCount: g.members.length,
                        members: g.members
                    });
                });

                // Clear selection buffer just in case
                selectedStudentIds.delete(studentId);
                selectedGroupMemberIds.delete(studentId);

                // Render UI updates immediately
                renderGroupsList();
                renderStudentList();
                refreshSelectedPreviews();

                try {
                    await persistGroups();
                    window.showToast(`${studentName} removed from group.`, 'success');
                } catch (err) {
                    console.error("Failed to persist groups:", err);
                    window.showToast("Failed to update group in database.", "error");
                }
            };
        });

        // Wire member chips toggle selection
        el.querySelectorAll('.pw-group-member-chip').forEach(chip => {
            chip.onclick = (e) => {
                if (e.target.closest('.pw-group-member-remove-btn')) return;
                const groupId = chip.getAttribute('data-group-id');
                const studentId = chip.getAttribute('data-student-id');

                if (selectedGroupId !== groupId) {
                    selectedGroupId = groupId;
                    selectedGroupMemberIds.clear();
                }

                if (selectedGroupMemberIds.has(studentId)) {
                    selectedGroupMemberIds.delete(studentId);
                } else {
                    selectedGroupMemberIds.add(studentId);
                }

                renderGroupsList();
            };
        });

        // Wire group card selection click
        el.querySelectorAll('.pw-group-card').forEach(card => {
            card.onclick = (e) => {
                if (e.target.closest('button') || e.target.closest('.pw-group-member-chip')) return;
                const groupId = card.getAttribute('data-group-id');
                if (selectedGroupId !== groupId) {
                    selectedGroupId = groupId;
                    selectedGroupMemberIds.clear();
                    updateActionButtonsState();
                }
            };
        });

        el.querySelectorAll('[data-add-group-id]').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-add-group-id');
                if (selectedGroupId !== id || selectedStudentIds.size === 0) return;
                const g = groups.find(x => x.id === id);
                if (!g) return;

                // Validation:
                // 1. Prevent duplicate members inside the same group.
                const existingMemberIds = new Set((g.members || []).map(m => m.studentId));
                const duplicates = [];
                for (const studentId of selectedStudentIds) {
                    if (existingMemberIds.has(studentId)) {
                        const s = studentsAll.find(x => x.id === studentId);
                        if (s) duplicates.push(s.name);
                    }
                }
                if (duplicates.length > 0) {
                    window.showToast(`Duplicate members: ${duplicates.join(', ')} already in the group.`, "error");
                    return;
                }

                // 2. Respect maximum member limit.
                const maxVal = progData.maxParticipants || 0;
                const currentCount = g.members?.length || 0;
                const newCount = currentCount + selectedStudentIds.size;
                if (maxVal > 0 && newCount > maxVal) {
                    window.showToast(`Cannot add members. This group has a limit of ${maxVal} members.`, "error");
                    return;
                }

                const toAdd = studentsAll
                    .filter(s => selectedStudentIds.has(s.id))
                    .map(s => ({ studentId: s.id, studentName: s.name }));

                g.members = [...(g.members || []), ...toAdd];
                
                // Update local state maps instantly
                toAdd.forEach(s => {
                    studentGroupsMap.set(s.studentId, {
                        groupName: g.name,
                        teamName: teamById.get(selectedTeamId)?.name || 'This Team',
                        memberCount: g.members.length,
                        members: g.members
                    });
                    if (!registrationsMap.has(s.studentId)) registrationsMap.set(s.studentId, new Set());
                    registrationsMap.get(s.studentId).add(`${progName} (${g.name})`);
                });
                
                // Update other group members' maps count/info
                g.members.forEach(m => {
                    studentGroupsMap.set(m.studentId, {
                        groupName: g.name,
                        teamName: teamById.get(selectedTeamId)?.name || 'This Team',
                        memberCount: g.members.length,
                        members: g.members
                    });
                });

                // Clear selection buffer
                selectedStudentIds.clear();

                // Update UI immediately
                renderGroupsList();
                renderStudentList();
                refreshSelectedPreviews();

                try {
                    await persistGroups();
                    window.showToast('Students added to group!', 'success');
                } catch (err) {
                    console.error("Failed to persist groups:", err);
                    window.showToast("Failed to update group in database.", "error");
                }
            };
        });

        el.querySelectorAll('[data-remove-group-id]').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-remove-group-id');
                if (selectedGroupId !== id || selectedGroupMemberIds.size === 0) return;
                const g = groups.find(x => x.id === id);
                if (!g) return;

                const confirmed = await window.customConfirm("Remove the selected members from the group?", "Remove Members", {
                    okText: "Remove",
                    cancelText: "Cancel",
                    danger: true
                });
                if (!confirmed) return;

                const removeIds = new Set([...selectedGroupMemberIds]);
                const newMembers = (g.members || []).filter(m => !removeIds.has(m.studentId));

                if (newMembers.length === 0) {
                    window.showToast('A group must have at least one member. Cannot leave it empty.', 'error');
                    return;
                }

                // Update local state maps instantly
                for (const studentId of removeIds) {
                    studentGroupsMap.delete(studentId);
                    if (registrationsMap.has(studentId)) {
                        registrationsMap.get(studentId).delete(`${progName} (${g.name})`);
                    }
                }

                g.members = newMembers;

                // Update remaining group members' maps count/info
                g.members.forEach(m => {
                    studentGroupsMap.set(m.studentId, {
                        groupName: g.name,
                        teamName: teamById.get(selectedTeamId)?.name || 'This Team',
                        memberCount: g.members.length,
                        members: g.members
                    });
                });

                // Clear selection buffer
                selectedGroupMemberIds.clear();

                // Update UI immediately
                renderGroupsList();
                renderStudentList();
                refreshSelectedPreviews();

                try {
                    await persistGroups();
                    window.showToast('Students removed from group.', 'success');
                } catch (err) {
                    console.error("Failed to persist groups:", err);
                    window.showToast("Failed to update group in database.", "error");
                }
            };
        });

        updateActionButtonsState();
    }

    // 6. Navigation and Initialization Bindings
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

    // Collapsible Assigned Participants/Registered Groups section on mobile
    const rightPanelHeader = document.getElementById('pwRightPanelHeader');
    const rightPanel = document.getElementById('pwRightPanel');
    if (rightPanelHeader && rightPanel) {
        rightPanelHeader.onclick = () => {
            if (window.innerWidth <= 991) {
                rightPanel.classList.toggle('is-expanded');
            }
        };
    }

    // 7. Initial Initialization
    async function initialize() {
        await loadTeams();
        const categories = await loadCategories();

        // Resolve canonical category ID
        if (inheritedCategoryId && inheritedCategoryId !== 'general_programs' && !categoriesById.has(inheritedCategoryId)) {
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

        const catData = categoriesById.get(inheritedCategoryId);
        const headerCatLabel = document.getElementById('pwHeaderCategoryLabel');
        if (headerCatLabel) {
            headerCatLabel.textContent = catData?.name || (inheritedCategoryId === 'general_programs' ? 'General Program' : inheritedCategoryId);
        }

        // Populate class dropdown
        const classes = (pType === 'general' || inheritedCategoryId === 'general_programs') ? getAllClasses() : getClassesForCategory(inheritedCategoryId);
        const classFilter = document.getElementById('pwClassFilter');
        if (classFilter) {
            classFilter.innerHTML = `<option value="">All Classes</option>` +
                classes.map(c => `<option value="${c.id}">${window.escapeHTML(c.name)}</option>`).join('');
            classFilter.disabled = false;
        }

        // Select first team as default
        if (teams.length > 0) {
            selectedTeamId = teams[0].id;
            const tName = teams[0].name;
            setPill('Team', tName);
            const teamBadge = document.getElementById('pwHeaderTeamBadge');
            if (teamBadge) {
                teamBadge.textContent = `Team: ${tName}`;
            }
        }

        renderTeamSegments();

        // Team segment selection listener
        document.getElementById('pwTeamList')?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-team-segment]');
            if (!btn) return;

            const id = btn.getAttribute('data-team-segment');
            selectedTeamId = id;
            selectedStudentIds.clear();
            selectedGroupId = '';
            selectedGroupMemberIds.clear();
            groups = [];

            // Segment UI active classes toggling
            document.querySelectorAll('[data-team-segment]').forEach(b => b.classList.remove('is-active'));
            btn.classList.add('is-active');

            const tName = selectedTeamId === 'teamless' ? 'No Team' : (teamById.get(selectedTeamId)?.name || '');
            setPill('Team', tName);
            const teamBadge = document.getElementById('pwHeaderTeamBadge');
            if (teamBadge) {
                teamBadge.textContent = `Team: ${tName || '—'}`;
            }

            // Enable inputs
            const searchInput = document.getElementById('pwStudentSearch');
            if (searchInput) searchInput.disabled = false;

            loadStudentsForSelection();
            if (isGroupEvent) loadGroupsForTeam();
        });

        // Smart Filters (pills) logic
        document.querySelectorAll('.pw-filter-pill').forEach(pill => {
            pill.onclick = () => {
                document.querySelectorAll('.pw-filter-pill').forEach(p => p.classList.remove('is-active'));
                pill.classList.add('is-active');
                activeFilter = pill.getAttribute('data-filter');
                applyStudentSearchFilter();
            };
        });

        // Keyboard navigation binding
        document.addEventListener('keydown', (e) => {
            const listEl = document.getElementById('pwStudentList');
            const searchInput = document.getElementById('pwStudentSearch');
            if (!listEl || !studentsFiltered.length) return;

            // Ctrl+F or / focuses search input
            if ((e.ctrlKey && e.key === 'f') || e.key === '/') {
                if (document.activeElement !== searchInput) {
                    e.preventDefault();
                    searchInput?.focus();
                    searchInput?.select();
                }
                return;
            }

            if (document.activeElement === searchInput) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    searchInput.blur();
                    activeStudentIndex = 0;
                    renderStudentList();
                }
                return;
            }

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                activeStudentIndex = Math.min(activeStudentIndex + 1, Math.min(studentsFiltered.length, renderLimit) - 1);
                renderStudentList();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                activeStudentIndex = Math.max(activeStudentIndex - 1, 0);
                renderStudentList();
            } else if (e.key === ' ' || e.key === 'Spacebar') {
                if (activeStudentIndex !== -1) {
                    e.preventDefault();
                    const s = studentsFiltered[activeStudentIndex];
                    if (s) toggleStudentSelection(s);
                }
            } else if (e.key === 'Enter') {
                if (activeStudentIndex !== -1) {
                    e.preventDefault();
                    const s = studentsFiltered[activeStudentIndex];
                    if (s) toggleStudentSelection(s);
                }
            }
        });

        // Infinite lazy scroll
        const scrollContainer = document.getElementById('pwStudentListScroll');
        if (scrollContainer) {
            scrollContainer.onscroll = () => {
                if (scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 50) {
                    if (renderLimit < studentsFiltered.length) {
                        renderLimit += 40;
                        renderStudentList();
                    }
                }
            };
        }

        // Class Filter Dropdown
        classFilter?.addEventListener('change', (e) => {
            selectedClassId = e.target.value;
            applyStudentSearchFilter();
        });

        // Search Input changes
        document.getElementById('pwStudentSearch')?.addEventListener('input', debounce(() => {
            applyStudentSearchFilter();
        }, 120));

        // Enable student search if team selected
        if (selectedTeamId) {
            const searchInput = document.getElementById('pwStudentSearch');
            if (searchInput) searchInput.disabled = false;
            loadStudentsForSelection();
            if (isGroupEvent) loadGroupsForTeam();
        }

        // Bulk Buttons Wiring
        document.getElementById('pwSelectAllVisibleBtn')?.addEventListener('click', () => {
            let added = 0;
            studentsFiltered.forEach(s => {
                const isAssigned = savedIndividualStudentIds.has(s.id) || (isGroupEvent && groups.some(g => g.members?.some(m => m.studentId === s.id)));
                if (!isAssigned) {
                    selectedStudentIds.add(s.id);
                    added++;
                }
            });
            refreshSelectedPreviews();
            renderStudentList();
            window.showToast(`Selected ${added} students.`, 'success');
        });

        document.getElementById('pwInvertSelectionBtn')?.addEventListener('click', () => {
            studentsFiltered.forEach(s => {
                const isAssigned = savedIndividualStudentIds.has(s.id) || (isGroupEvent && groups.some(g => g.members?.some(m => m.studentId === s.id)));
                if (!isAssigned) {
                    if (selectedStudentIds.has(s.id)) {
                        selectedStudentIds.delete(s.id);
                    } else {
                        selectedStudentIds.add(s.id);
                    }
                }
            });
            refreshSelectedPreviews();
            renderStudentList();
        });

        document.getElementById('pwClearSelectionBtn')?.addEventListener('click', () => {
            selectedStudentIds.clear();
            refreshSelectedPreviews();
            renderStudentList();
            window.showToast('Selection buffer cleared.', 'success');
        });

        // Group cloning copy member dropdown wire
        document.getElementById('pwCopyGroupSelect')?.addEventListener('change', (e) => {
            const val = e.target.value;
            if (!val) return;
            
            const [tId, gId] = val.split(':');
            const group = allEventGroups.find(g => g.teamId === tId && g.id === gId);
            if (!group) return;

            selectedStudentIds.clear();
            let copiedCount = 0;
            
            group.members.forEach(m => {
                const match = studentsAll.find(s => s.name.toLowerCase() === m.studentName.toLowerCase() || s.id === m.studentId);
                if (match) {
                    selectedStudentIds.add(match.id);
                    copiedCount++;
                }
            });

            refreshSelectedPreviews();
            renderStudentList();
            if (copiedCount > 0) {
                window.showToast(`Copied ${copiedCount} members to current selection buffer.`, 'success');
            } else {
                window.showToast('No matching students found in this team.', 'warning');
            }
            e.target.value = '';
        });

        // Duplicate Last Group button wire
        document.getElementById('pwDuplicatePrevGroupBtn')?.addEventListener('click', () => {
            if (!groups || groups.length === 0) {
                window.showToast('No existing groups in this team to duplicate.', 'error');
                return;
            }
            const lastG = groups[groups.length - 1];
            selectedStudentIds.clear();
            let copiedCount = 0;

            lastG.members.forEach(m => {
                const match = studentsAll.find(s => s.name.toLowerCase() === m.studentName.toLowerCase() || s.id === m.studentId);
                if (match) {
                    selectedStudentIds.add(match.id);
                    copiedCount++;
                }
            });

            refreshSelectedPreviews();
            renderStudentList();
            window.showToast(`Duplicated members from "${lastG.name}" (${copiedCount} copied).`, 'success');
        });

        // Individual registration save
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
            if (btn.disabled) return;
            btn.disabled = true;
            btn.textContent = 'Saving...';
            if (statusEl) statusEl.textContent = 'Saving participant registrations...';

            const targetTeamId = selectedTeamId === 'teamless' ? '' : selectedTeamId;

            try {
                const partRef = collection(db, "institutes", window.currentInstituteId, "programs", progId, "participants");
                let existingSnap;
                try {
                    existingSnap = await getDocs(query(
                        partRef,
                        where('type', '==', 'individual'),
                        where('teamId', '==', targetTeamId)
                    ));
                } catch (err) {
                    existingSnap = await getDocs(partRef);
                }
                const existingStudentIds = new Set();
                existingSnap.forEach(d => {
                    const data = d.data();
                    const matchesCategory = (pType === 'general') || ((data.categoryId || '') === inheritedCategoryId);
                    if (data.type === 'individual' && (data.teamId || '') === targetTeamId && matchesCategory && data.studentId) {
                        existingStudentIds.add(data.studentId);
                    }
                });

                const toAdd = [...selectedStudentIds]
                    .filter(id => !existingStudentIds.has(id))
                    .map(id => studentsAll.find(s => s.id === id))
                    .filter(Boolean);

                if (toAdd.length === 0) {
                    window.showToast('All selected students are already assigned.', 'success');
                    if (statusEl) statusEl.textContent = 'No new participants to save.';
                    btn.disabled = false;
                    btn.textContent = '💾 Save Participants';
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
                        teamId: targetTeamId,
                        teamName: selectedTeamId === 'teamless' ? 'No Team' : (teamById.get(selectedTeamId)?.name || ''),
                        categoryId: inheritedCategoryId || 'general_programs',
                        categoryName: categoriesById.get(inheritedCategoryId)?.name || s.categoryName || 'General Programs',
                        classId: s.classId || '',
                        className: s.className || '',
                        programId: progId || '',
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp()
                    });
                }
                const progRef = doc(db, "institutes", window.currentInstituteId, "programs", progId);
                batch.update(progRef, { participantCount: increment(toAdd.length) });
                await batch.commit();
                await updateDashboardMetadata(window.currentInstituteId);
                toAdd.forEach(s => savedIndividualStudentIds.add(s.id));
                window.showToast(`${toAdd.length} participant${toAdd.length === 1 ? '' : 's'} saved successfully!`, 'success');
                if (statusEl) statusEl.textContent = `${toAdd.length} saved.`;
                selectedStudentIds.clear();
                await loadStudentsForSelection();
            } catch (e) {
                console.error(e);
                window.showToast('Failed to save participants.', 'error');
                if (statusEl) statusEl.textContent = 'Save failed.';
            } finally {
                btn.disabled = false;
                btn.textContent = '💾 Save Participants';
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
            createBtn.disabled = true;

            try {
                const groupId = uid('group');
                const members = studentsAll
                    .filter(s => selectedStudentIds.has(s.id))
                    .map(s => ({
                        studentId: s.id || '',
                        studentName: s.name || ''
                    }));

                const containerDoc = await getOrCreateTeamParticipantContainer();
                const docRef = containerDoc.ref;
                const existingGroups = containerDoc.data.groups || [];

                const newGroup = { id: groupId, name: groupName, members };
                const updatedGroups = [...existingGroups, newGroup];

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

                const progRef = doc(db, "institutes", window.currentInstituteId, "programs", progId);
                await setDoc(progRef, { participantCount: increment(1) }, { merge: true });
                await updateDashboardMetadata(window.currentInstituteId);

                window.showToast('Group created successfully!', 'success');
                nameInput.value = '';
                selectedStudentIds.clear();
                await loadGroupsForTeam();
                refreshSelectedPreviews();
            } catch (e) {
                console.error(e);
                window.showToast('Failed to create group.', 'error');
            } finally {
                createBtn.disabled = false;
            }
        });

        updateProgramHeaderBadges();
    }

    function closeAllDropdowns() {
        const activeMenus = document.querySelectorAll('.active-body-dropdown');
        activeMenus.forEach(m => m.remove());
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
            listHTML = `<div class="pw-empty" style="padding:2rem; text-align:center; color:var(--pw-slate-500); border: 1.5px dashed var(--pw-border); border-radius:var(--pw-radius-md); font-size:0.8rem;">No participants assigned.</div>`;
        } else {
            const tableRows = assignedParticipantsAll.map(p => `
                <tr>
                    <td>#${window.escapeHTML(p.chestNumber || '—')}</td>
                    <td style="font-weight:700; color:var(--pw-slate-900);">${window.escapeHTML(p.studentName)}</td>
                    <td>${window.escapeHTML(p.className)}</td>
                    <td>
                        <button class="btn-action-icon pw-part-dots-btn" data-id="${p.studentId}">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" style="width:0.85rem; height:0.85rem;">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 12.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 18.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />
                            </svg>
                        </button>
                    </td>
                </tr>
            `).join('');

            listHTML = `
                <div class="pw-table-container">
                    <table class="pw-table">
                        <thead>
                            <tr>
                                <th>Chest No</th>
                                <th>Student Name</th>
                                <th>Class</th>
                                <th style="width: 50px;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRows}
                        </tbody>
                    </table>
                </div>
            `;
        }

        let editingFormHTML = '';
        if (editingParticipantId) {
            const p = assignedParticipantsAll.find(x => x.studentId === editingParticipantId);
            if (p) {
                editingFormHTML = `
                    <div style="background:var(--pw-slate-50); border:1.5px solid var(--pw-primary); border-radius:var(--pw-radius-sm); padding:1rem; margin-bottom:1rem; display:flex; flex-direction:column; gap:0.5rem;">
                        <h4 style="margin:0; font-size:0.85rem; font-weight:800; color:var(--pw-primary);">✏️ Edit Participant</h4>
                        <input type="text" id="pwEditName_${p.studentId}" class="form-input" value="${window.escapeHTML(p.studentName)}" style="font-size:0.8rem; padding: 0.4rem 0.6rem;" />
                        <input type="text" id="pwEditClass_${p.studentId}" class="form-input" value="${window.escapeHTML(p.className)}" style="font-size:0.8rem; padding: 0.4rem 0.6rem;" />
                        <div style="display:flex; gap:0.4rem; justify-content:flex-end; margin-top:0.25rem;">
                            <button class="btn btn-secondary btn-sm pw-cancel-edit-btn" style="font-size: 0.72rem; padding: 0.3rem 0.6rem;">Cancel</button>
                            <button class="btn btn-primary btn-sm pw-save-edit-btn" data-id="${p.studentId}" style="font-size: 0.72rem; padding: 0.3rem 0.6rem;">Save</button>
                        </div>
                    </div>
                `;
            }
        }

        panel.innerHTML = `
            ${editingFormHTML}
            <div class="pw-assigned-list">
                ${listHTML}
            </div>
        `;

        panel.querySelectorAll('.pw-cancel-edit-btn').forEach(btn => {
            btn.onclick = () => {
                editingParticipantId = null;
                renderAssignedManagement();
            };
        });

        panel.querySelectorAll('.pw-save-edit-btn').forEach(btn => {
            btn.onclick = async () => {
                const id = btn.getAttribute('data-id');
                const newName = document.getElementById(`pwEditName_${id}`).value.trim();
                const newClass = document.getElementById(`pwEditClass_${id}`).value.trim();

                if (!newName) {
                    window.showToast("Student Name is required.", "error");
                    return;
                }

                const spinner = document.getElementById('pwStudentsSkeleton');
                if (spinner) spinner.style.display = 'block';

                try {
                    const partRef = collection(db, "institutes", window.currentInstituteId, "programs", progId, "participants");
                    let docId = participantDocIds.get(id) || `individual_${safeDocId(selectedTeamId)}_${safeDocId(id)}`;
                    const docRef = doc(partRef, docId);

                    await setDoc(docRef, {
                        studentName: newName,
                        className: newClass,
                        updatedAt: serverTimestamp()
                    }, { merge: true });
                    await updateDashboardMetadata(window.currentInstituteId);

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

        updateProgramHeaderBadges();
    }

    function openParticipantDropdown(btn) {
        closeAllDropdowns();
        const id = btn.getAttribute('data-id');

        const dropdown = document.createElement('div');
        dropdown.className = 'actions-dropdown-menu active-body-dropdown';
        dropdown.innerHTML = `
            <button class="dropdown-item pw-dropdown-edit-btn" data-id="${id}">✏️ Edit</button>
            <button class="dropdown-item btn-danger-item pw-dropdown-delete-btn text-danger" data-id="${id}">🗑️ Delete</button>
        `;

        document.body.appendChild(dropdown);

        const rect = btn.getBoundingClientRect();
        dropdown.style.top = `${rect.bottom + window.scrollY}px`;
        dropdown.style.left = `${rect.left + window.scrollX - 120 + rect.width}px`;

        dropdown.querySelector('.pw-dropdown-edit-btn').onclick = () => {
            dropdown.remove();
            editingParticipantId = id;
            renderAssignedManagement();
        };

        dropdown.querySelector('.pw-dropdown-delete-btn').onclick = async () => {
            dropdown.remove();
            const student = assignedParticipantsAll.find(x => x.studentId === id);
            if (!student) return;
            const confirmed = await window.customConfirm(`Are you sure you want to delete ${student.studentName}?`);
            if (!confirmed) return;

            const spinner = document.getElementById('pwStudentsSkeleton');
            if (spinner) spinner.style.display = 'block';

            try {
                const partRef = collection(db, "institutes", window.currentInstituteId, "programs", progId, "participants");
                let docId = participantDocIds.get(id) || `individual_${safeDocId(selectedTeamId)}_${safeDocId(id)}`;
                const docRef = doc(partRef, docId);

                await deleteDoc(docRef);

                const progRef = doc(db, "institutes", window.currentInstituteId, "programs", progId);
                await setDoc(progRef, { participantCount: increment(-1) }, { merge: true });
                await updateDashboardMetadata(window.currentInstituteId);

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
    }

    container.addEventListener('click', (e) => {
        const dotsBtn = e.target.closest('.pw-part-dots-btn');
        if (dotsBtn) {
            e.stopPropagation();
            openParticipantDropdown(dotsBtn);
        }
    });

    window.addEventListener('scroll', () => {
        closeAllDropdowns();
    }, true);

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.pw-part-dots-btn') && !e.target.closest('.active-body-dropdown')) {
            closeAllDropdowns();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAllDropdowns();
        }
    });

    await initialize();
}