// Teams Module
import { db, updateDashboardMetadata, migrateTeamMemberCounts, invalidateTeamsCache } from './firebase.js';
import {
    collection,
    addDoc,
    getDocs,
    getDoc,
    setDoc,
    doc,
    deleteDoc,
    updateDoc,
    onSnapshot,
    serverTimestamp,
    writeBatch,
    query,
    where,
    collectionGroup,
    increment
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

let unsubscribeTeams = null;
let unsubscribeStudents = null;
let localTeams = [];
let localStudents = [];

export function initTeamsView(container, topActions) {
    // Clear any existing active listeners to avoid leak memory
    if (unsubscribeTeams) unsubscribeTeams();
    if (unsubscribeStudents) unsubscribeStudents();

    localTeams = [];
    localStudents = [];

    // Right-aligned header action buttons
    topActions.innerHTML = `
        <button class="btn btn-secondary" id="btnGoCategories" style="margin-right: 0.5rem; font-weight:600;">🏷️ Categories / Classes</button>
        <button class="btn btn-primary" id="btnCreateTeam">+ Create Team</button>
    `;

    // Dynamic container scaffolding
    container.innerHTML = `
        <div class="teams-view-header">
            <div>
                <h2 class="teams-view-heading">Manage Teams</h2>
                <p class="teams-view-subtitle">Create and manage competition teams and categories</p>
            </div>
        </div>
        
        <!-- Premium Real-time Statistics Bar -->
        <div id="teamsStatsBarContainer"></div>

        <!-- High-Density modern SaaS Table/List Container -->
        <div class="teams-table-container" id="teamsTableContainer">
            <div class="loader-container">
                <div class="spinner"></div>
            </div>
        </div>
    `;

    // Bind navigation and create clicks
    document.getElementById("btnGoCategories")?.addEventListener("click", () => window.navigateTo("categories"));
    document.getElementById("btnCreateTeam")?.addEventListener("click", () => openTeamModal());

    // Scroll handler to close fixed menus when scrolling to prevent floating drifts
    const handleScroll = () => {
        const activeDropdown = document.querySelector('.active-body-dropdown');
        if (activeDropdown) activeDropdown.remove();
    };
    window.addEventListener('scroll', handleScroll, true);

    window.currentViewCleanup = () => {
        if (unsubscribeTeams) {
            unsubscribeTeams();
            unsubscribeTeams = null;
        }
        if (unsubscribeStudents) {
            unsubscribeStudents();
            unsubscribeStudents = null;
        }
        window.removeEventListener('scroll', handleScroll, true);
    };

    // Single delegated click listener on container for team-dots-btn
    container.addEventListener('click', (e) => {
        const dotsBtn = e.target.closest('.team-dots-btn');
        if (dotsBtn) {
            e.stopPropagation();
            openTeamDropdown(dotsBtn);
        }
    });

    // Start synchronising teams and students collections in real time
    startRealtimeSync();
}

function startRealtimeSync() {
    const instId = window.currentInstituteId;
    if (!instId) return;

    const teamsRef = collection(db, "institutes", instId, "teams");

    // Listen to teams
    unsubscribeTeams = onSnapshot(teamsRef, (snap) => {
        localTeams = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        window.cachedTeams = { data: localTeams, lastFetched: Date.now() };
        renderTeamsUI();
    }, (err) => {
        console.error("Teams listener error:", err);
        window.showToast("Failed to load teams data.", "error");
    });
}

function renderTeamsUI() {
    const tableContainer = document.getElementById("teamsTableContainer");
    const statsContainer = document.getElementById("teamsStatsBarContainer");
    if (!tableContainer) return;

    const totalTeams = localTeams.length;
    
    let totalStudents = 0;
    let averageMembers = "0.0";
    let needsMigration = false;

    localTeams.forEach(team => {
        if (team.memberCount !== undefined) {
            totalStudents += team.memberCount;
        } else {
            needsMigration = true;
        }
    });

    if (!needsMigration && totalTeams > 0) {
        averageMembers = (totalStudents / totalTeams).toFixed(1);
    }

    const totalStudentsText = needsMigration ? "Calculating..." : totalStudents;
    const averageMembersText = needsMigration ? "Calculating..." : averageMembers;

    // 1. Dynamic in-memory stats collection
    if (statsContainer) {
        if (totalTeams > 0) {
            statsContainer.innerHTML = `
                <div class="teams-stats-bar">
                    <div class="teams-stat-item">
                        <span class="teams-stat-label">Total Teams</span>
                        <span class="teams-stat-val">${totalTeams}</span>
                    </div>
                    <div class="teams-stat-divider"></div>
                    <div class="teams-stat-item">
                        <span class="teams-stat-label">Total Students</span>
                        <span class="teams-stat-val">${totalStudentsText}</span>
                    </div>
                    <div class="teams-stat-divider"></div>
                    <div class="teams-stat-item">
                        <span class="teams-stat-label">Avg. Members / Team</span>
                        <span class="teams-stat-val">${averageMembersText}</span>
                    </div>
                </div>
            `;
        } else {
            statsContainer.innerHTML = "";
        }
    }

    // 2. Elegant premium empty state if no records exist
    if (totalTeams === 0) {
        tableContainer.innerHTML = `
            <div class="teams-empty-state">
                <div class="teams-empty-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
                    </svg>
                </div>
                <h3>No teams created yet</h3>
                <p>Get started by creating your first competition team.</p>
                <button class="btn btn-primary" id="btnCreateTeamEmpty" style="margin-top:0.75rem;">+ Create Team</button>
            </div>
        `;
        const btnEmpty = document.getElementById("btnCreateTeamEmpty");
        if (btnEmpty) {
            btnEmpty.onclick = () => openTeamModal();
        }
        return;
    }

    // 3. Render High-Density List/Table
    let tableHTML = `
        <div class="teams-table">
            <div class="teams-table-header">
                <div>Team Name</div>
                <div>Description</div>
                <div>Members</div>
                <div style="text-align: right;">Actions</div>
            </div>
            <div class="teams-table-body">
    `;

    localTeams.forEach((team) => {
        const teamId = team.id;
        
        let membersLabel = "";
        if (team.memberCount !== undefined) {
            const count = team.memberCount;
            membersLabel = count === 1 ? "1 Member" : `${count} Members`;
        } else {
            membersLabel = `<span class="spinner-small" style="display:inline-block; width:10px; height:10px; border:2px solid #ccc; border-top:2px solid #000; border-radius:50%; animation:spin 1s linear infinite; margin-right:4px; vertical-align:middle;"></span> Migrating...`;
            migrateTeamMemberCounts(window.currentInstituteId);
        }

        tableHTML += `
            <div class="team-row">
                <div class="team-name-cell">
                    ${window.escapeHTML(team.name)}
                </div>
                <div class="team-desc-cell">
                    ${window.escapeHTML(team.description || "No description")}
                </div>
                <div class="team-members-cell">
                    <span class="team-members-badge">
                        👥 ${membersLabel}
                    </span>
                </div>
                <div class="team-actions-cell">
                    <div class="actions-dropdown-container">
                        <button class="btn-action-icon btn-action-more dots-btn team-dots-btn" 
                            data-id="${teamId}"
                            data-name="${window.escapeHTML(team.name)}"
                            data-desc="${window.escapeHTML(team.description || "")}">
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

function openTeamModal(teamId = null, currentName = "", currentDesc = "") {
    const modalTitle = document.getElementById("dynamicModalTitle");
    const modalBody = document.getElementById("dynamicModalBody");
    const modalOverlay = document.getElementById("dynamicModal");

    modalTitle.textContent = teamId ? "Edit Team" : "Create Team";

    modalBody.innerHTML = `
        <form id="teamForm">
            <div class="form-group">
                <label class="form-label">Team Name</label>
                <input
                    type="text"
                    id="teamName"
                    class="form-input"
                    required
                    value="${currentName}">
            </div>

            <div class="form-group mb-6">
                <label class="form-label">Description (Optional)</label>
                <textarea
                    id="teamDesc"
                    class="form-input"
                    rows="3">${currentDesc}</textarea>
            </div>

            <div class="modal-actions">
                <button type="submit"
                    class="btn btn-primary w-full"
                    id="saveTeamBtn">
                    <span class="btn-text">
                        ${teamId ? "Save Changes" : "Create"}
                    </span>
                    <span class="btn-spinner hidden"></span>
                </button>
            </div>
        </form>
    `;

    modalOverlay.classList.remove("hidden");

    document.getElementById("closeDynamicModalBtn").onclick =
        () => modalOverlay.classList.add("hidden");

    document
        .getElementById("teamForm")
        .addEventListener("submit", async (e) => {
            e.preventDefault();

            const saveBtn = document.getElementById("saveTeamBtn");
            const spinner = saveBtn.querySelector(".btn-spinner");
            const text = saveBtn.querySelector(".btn-text");

            saveBtn.disabled = true;
            text.classList.add("hidden");
            spinner.classList.remove("hidden");

            try {
                const name = document.getElementById("teamName").value.trim();
                const desc = document.getElementById("teamDesc").value.trim();

                const teamsRef = collection(
                    db,
                    "institutes",
                    window.currentInstituteId,
                    "teams"
                );

                if (teamId) {
                    await updateDoc(
                        doc(
                            db,
                            "institutes",
                            window.currentInstituteId,
                            "teams",
                            teamId
                        ),
                        {
                            name,
                            description: desc
                        }
                    );
                    window.showToast("Team updated.");
                } else {
                    await addDoc(teamsRef, {
                        name,
                        description: desc,
                        memberCount: 0,
                        createdAt: serverTimestamp()
                    });
                    window.showToast("Team created.");
                }

                await updateDashboardMetadata(window.currentInstituteId);
                invalidateTeamsCache(window.currentInstituteId);
                modalOverlay.classList.add("hidden");
            } catch (err) {
                window.handleError(err, "saving team");
            } finally {
                saveBtn.disabled = false;
                text.classList.remove("hidden");
                spinner.classList.add("hidden");
            }
        });
}

async function deleteTeam(teamId) {
    if (!await window.customConfirm("Are you sure you want to delete this team? All member students and their program registrations will also be removed.", "Delete Team", { danger: true, okText: "Delete" })) return;

    try {
        const instId = window.currentInstituteId;
        const batch = writeBatch(db);

        // 1. Find all students belonging to this team
        const studentsSnap = await getDocs(query(
            collection(db, "institutes", instId, "students"),
            where("teamId", "==", teamId)
        ));

        if (!studentsSnap.empty) {
            // 2. For each student, cascade-remove their individual participant records
            const programCountDeltas = new Map(); // programId -> cumulative delta

            for (const stuDoc of studentsSnap.docs) {
                const stuId = stuDoc.id;

                // Individual participant docs (all programs)
                const indivSnap = await getDocs(query(
                    collectionGroup(db, "participants"),
                    where("studentId", "==", stuId),
                    where("type", "==", "individual")
                ));
                indivSnap.forEach(d => {
                    if (d.ref.path.startsWith(`institutes/${instId}/`)) {
                        const data = d.data();
                        batch.delete(d.ref);
                        if (data.programId) {
                            programCountDeltas.set(
                                data.programId,
                                (programCountDeltas.get(data.programId) || 0) - 1
                            );
                        }
                    }
                });

                // Group participant docs for this team
                const groupSnap = await getDocs(query(
                    collectionGroup(db, "participants"),
                    where("type", "==", "group"),
                    where("teamId", "==", teamId)
                ));
                groupSnap.forEach(d => {
                    if (d.ref.path.startsWith(`institutes/${instId}/`)) {
                        const data = d.data();
                        const groups = Array.isArray(data.groups) ? data.groups : [];
                        const studentInGroup = groups.some(g =>
                            Array.isArray(g.members) && g.members.some(m => m.studentId === stuId)
                        );
                        if (studentInGroup) {
                            const updatedGroups = groups.map(g => ({
                                ...g,
                                members: (g.members || []).filter(m => m.studentId !== stuId)
                            }));
                            batch.update(d.ref, { groups: updatedGroups });
                        }
                    }
                });

                // Delete the student doc
                batch.delete(stuDoc.ref);
            }

            // 3. Apply participantCount decrements to affected programs
            for (const [programId, delta] of programCountDeltas) {
                const progRef = doc(db, "institutes", instId, "programs", programId);
                batch.update(progRef, { participantCount: increment(delta) });
            }
        }

        // 4. Delete the team document itself
        batch.delete(doc(db, "institutes", instId, "teams", teamId));

        await batch.commit();
        await updateDashboardMetadata(instId);
        invalidateTeamsCache(instId);
        window.showToast("Team deleted successfully.");
    } catch (err) {
        window.handleError(err, "deleting team");
    }
}

function openTeamDropdown(btn) {
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

    dropdown.innerHTML = `
        <button class="dropdown-item btn-edit-team" style="display:flex; align-items:center; gap:0.5rem; width:100%; border:none; background:transparent; padding:0.5rem 0.85rem; font-size:12px; font-weight:600; color:#475569; text-align:left; cursor:pointer;">
            ✏️ Edit
        </button>
        <button class="dropdown-item btn-leader-access" style="display:flex; align-items:center; gap:0.5rem; width:100%; border:none; background:transparent; padding:0.5rem 0.85rem; font-size:12px; font-weight:600; color:#475569; text-align:left; cursor:pointer;">
            🔑 Leader Access
        </button>
        <button class="dropdown-item btn-delete-team text-danger" style="display:flex; align-items:center; gap:0.5rem; width:100%; border:none; background:transparent; padding:0.5rem 0.85rem; font-size:12px; font-weight:600; color:#dc2626; text-align:left; cursor:pointer;">
            🗑️ Delete
        </button>
    `;

    // 3. Append directly to body
    document.body.appendChild(dropdown);

    // 4. Position fixed menu dynamically to avoid clipping
    const rect = btn.getBoundingClientRect();
    const menuWidth = 150;
    const menuHeight = 130; // Increased height to fit three buttons nicely

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
    dropdown.querySelector('.btn-edit-team').addEventListener('click', () => {
        dropdown.remove();
        openTeamModal(id, name, desc);
    });

    dropdown.querySelector('.btn-leader-access').addEventListener('click', () => {
        dropdown.remove();
        openLeaderAccessModal(id, name);
    });

    dropdown.querySelector('.btn-delete-team').addEventListener('click', () => {
        dropdown.remove();
        deleteTeam(id);
    });
}

function generateSecureToken() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    const array = new Uint8Array(24);
    window.crypto.getRandomValues(array);
    for (let i = 0; i < array.length; i++) {
        token += chars[array[i] % chars.length];
    }
    return token;
}

function openLeaderAccessModal(teamId, teamName) {
    const modalTitle = document.getElementById("dynamicModalTitle");
    const modalBody = document.getElementById("dynamicModalBody");
    const modalOverlay = document.getElementById("dynamicModal");

    modalTitle.textContent = "Leader Access Management";

    const team = localTeams.find(t => t.id === teamId);
    const memberCount = team ? (team.memberCount || 0) : 0;
    const isAccessEnabled = team ? (team.leaderAccessEnabled || false) : false;
    let token = team ? (team.leaderAccessToken || '') : '';
    
    if (!token && isAccessEnabled) {
        token = generateSecureToken();
    }
    
    const instName = window.currentInstituteDetails?.name || window.currentInstituteDetails?.instituteName || "Institute";
    const origin = window.location.origin;
    const path = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/'));
    const portalUrl = `${origin}${path}/leader-portal.html?instId=${window.currentInstituteId}&token=${token}`;

    modalBody.innerHTML = `
        <div style="font-family:'Inter', sans-serif;">
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:1rem; margin-bottom:1.5rem;">
                <h4 style="margin:0 0 0.5rem 0; font-size:1rem; color:#1e293b;">${window.escapeHTML(teamName)}</h4>
                <div style="font-size:0.8rem; color:#64748b; display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
                    <div>Institute: <strong>${window.escapeHTML(instName)}</strong></div>
                    <div>Students: <strong>👥 ${memberCount}</strong></div>
                </div>
            </div>

            <div style="margin-bottom:1.5rem;">
                <label class="form-label" style="display:flex; justify-content:space-between; align-items:center; font-weight:600; font-size:0.85rem; color:#475569;">
                    <span>Portal Access Status</span>
                    <span id="accessStatusBadge" class="pw-badge-compact ${isAccessEnabled ? 'pw-badge-eligible' : 'pw-badge-elsewhere'}">
                        ${isAccessEnabled ? 'Active' : 'Inactive'}
                    </span>
                </label>
                <div style="display:flex; align-items:center; gap:0.75rem; margin-top:0.5rem;">
                    <label class="switch-container" style="position:relative; display:inline-block; width:50px; height:26px;">
                        <input type="checkbox" id="leaderAccessToggle" ${isAccessEnabled ? 'checked' : ''} style="opacity:0; width:0; height:0;">
                        <span class="slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#ccc; transition:.4s; border-radius:34px;"></span>
                    </label>
                    <span style="font-size:0.85rem; font-weight:600; color:#475569;" id="toggleLabelText">
                        ${isAccessEnabled ? 'Access Link is Enabled' : 'Access Link is Disabled'}
                    </span>
                </div>
            </div>

            <div id="leaderLinkSection" class="${isAccessEnabled ? '' : 'hidden'}" style="margin-bottom:1.5rem;">
                <div class="form-group">
                    <label class="form-label" style="font-weight:600; font-size:0.85rem; color:#475569;">Leader Portal Access Link</label>
                    <div style="display:flex; gap:0.5rem; margin-top:0.5rem;">
                        <input type="text" id="leaderPortalUrl" class="form-input" readonly value="${token ? portalUrl : 'Not Generated Yet'}" style="font-family:monospace; font-size:0.75rem; flex:1; background:#f1f5f9; cursor:text;">
                        <button class="btn btn-secondary" id="btnCopyLeaderUrl" style="padding:0 1rem; font-size:0.8rem; font-weight:600;">📋 Copy</button>
                    </div>
                </div>
                <div style="display:flex; gap:0.5rem; margin-top:0.75rem;">
                    <button class="btn btn-secondary w-full" id="btnOpenLeaderUrl" style="font-size:0.8rem; font-weight:600;" ${token ? '' : 'disabled'}>🌐 Open Portal</button>
                    <button class="btn btn-secondary w-full text-danger" id="btnRegenerateLeaderToken" style="font-size:0.8rem; font-weight:600; color:#dc2626; border-color:rgba(220,38,38,0.2);" ${token ? '' : 'disabled'}>🔄 Regenerate Link</button>
                </div>
            </div>

            <div class="pw-summary-panel" style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:1rem; margin-bottom:1.5rem; margin-top:1rem;">
                <h5 style="margin:0 0 0.5rem 0; font-size:0.8rem; text-transform:uppercase; color:#15803d; letter-spacing:0.5px;">📋 Permission Summary</h5>
                <ul style="margin:0; padding-left:1.2rem; font-size:0.75rem; color:#166534; line-height:1.4;">
                    <li>Leader can register team students into eligible programs.</li>
                    <li>Leader can view, add, edit, or remove participant assignments for this team only.</li>
                    <li>Leader cannot access other teams, mark entry, results, settings, or delete/edit programs.</li>
                </ul>
            </div>

            <div class="modal-actions" style="margin-top:1.5rem;">
                <button class="btn btn-primary w-full" id="btnSaveLeaderAccess" style="font-weight:700;">Save Access Settings</button>
            </div>
        </div>
    `;

    // Add slider styling to modal head or body
    if (!document.getElementById('sliderToggleStyles')) {
        const style = document.createElement('style');
        style.id = 'sliderToggleStyles';
        style.innerHTML = `
            .switch-container input:checked + .slider { background-color: #22c55e; }
            .switch-container .slider:before {
                position: absolute; content: ""; height: 18px; width: 18px; left: 4px; bottom: 4px;
                background-color: white; transition: .4s; border-radius: 50%;
            }
            .switch-container input:checked + .slider:before { transform: translateX(24px); }
        `;
        document.head.appendChild(style);
    }

    modalOverlay.classList.remove("hidden");

    document.getElementById("closeDynamicModalBtn").onclick = () => modalOverlay.classList.add("hidden");

    const toggle = document.getElementById("leaderAccessToggle");
    const badge = document.getElementById("accessStatusBadge");
    const labelText = document.getElementById("toggleLabelText");
    const linkSection = document.getElementById("leaderLinkSection");
    const urlInput = document.getElementById("leaderPortalUrl");
    const copyBtn = document.getElementById("btnCopyLeaderUrl");
    const openBtn = document.getElementById("btnOpenLeaderUrl");
    const regenBtn = document.getElementById("btnRegenerateLeaderToken");

    let modalToken = token;
    let oldToken = team ? (team.leaderAccessToken || '') : '';

    toggle.addEventListener('change', () => {
        const isChecked = toggle.checked;
        if (isChecked) {
            badge.textContent = "Active";
            badge.className = "pw-badge-compact pw-badge-eligible";
            labelText.textContent = "Access Link is Enabled";
            linkSection.classList.remove("hidden");
            
            if (!modalToken) {
                modalToken = generateSecureToken();
                const newUrl = `${origin}${path}/leader-portal.html?instId=${window.currentInstituteId}&token=${modalToken}`;
                urlInput.value = newUrl;
                openBtn.disabled = false;
                regenBtn.disabled = false;
            }
        } else {
            badge.textContent = "Inactive";
            badge.className = "pw-badge-compact pw-badge-elsewhere";
            labelText.textContent = "Access Link is Disabled";
            linkSection.classList.add("hidden");
        }
    });

    copyBtn.onclick = () => {
        if (!urlInput.value || urlInput.value === 'Not Generated Yet') return;
        navigator.clipboard.writeText(urlInput.value);
        window.showToast("Link copied to clipboard!");
    };

    openBtn.onclick = () => {
        if (!urlInput.value || urlInput.value === 'Not Generated Yet') return;
        window.open(urlInput.value, '_blank');
    };

    regenBtn.onclick = async () => {
        const confirmRegen = await window.customConfirm("Are you sure you want to regenerate the access link? The existing link will immediately stop working.", "Regenerate Access Link", { danger: true, okText: "Regenerate" });
        if (confirmRegen) {
            modalToken = generateSecureToken();
            const newUrl = `${origin}${path}/leader-portal.html?instId=${window.currentInstituteId}&token=${modalToken}`;
            urlInput.value = newUrl;
            window.showToast("New link generated. Click Save to activate it.");
        }
    };

    document.getElementById("btnSaveLeaderAccess").onclick = async () => {
        const saveBtn = document.getElementById("btnSaveLeaderAccess");
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";

        try {
            const enabled = toggle.checked;
            const finalToken = enabled ? modalToken : (token || '');

            const instId = window.currentInstituteId;
            const batch = writeBatch(db);

            // Update team document
            const teamRef = doc(db, "institutes", instId, "teams", teamId);
            batch.update(teamRef, {
                leaderAccessEnabled: enabled,
                leaderAccessToken: finalToken,
                leaderAccessUpdatedAt: serverTimestamp()
            });

            // Handle token document updates
            if (enabled) {
                const newTokenRef = doc(db, "institutes", instId, "leaderAccess", finalToken);
                batch.set(newTokenRef, {
                    teamId: teamId,
                    enabled: true,
                    updatedAt: serverTimestamp()
                });
            }

            // If old token exists and is different from final token, or if disabled, delete the old token lookup doc
            if (oldToken && (oldToken !== finalToken || !enabled)) {
                const oldTokenRef = doc(db, "institutes", instId, "leaderAccess", oldToken);
                batch.delete(oldTokenRef);
            }

            await batch.commit();
            
            // Local update of localTeams cache so UI displays updated state next time modal is opened
            if (team) {
                team.leaderAccessEnabled = enabled;
                team.leaderAccessToken = finalToken;
            }

            window.showToast("Leader access settings saved successfully!");
            modalOverlay.classList.add("hidden");
        } catch (e) {
            console.error("Save leader settings error:", e);
            window.showToast("Failed to save leader access settings.", "error");
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = "Save Access Settings";
        }
    };
}