// Teams Module
import { db } from './firebase.js';
import {
    collection,
    addDoc,
    doc,
    deleteDoc,
    updateDoc,
    onSnapshot,
    serverTimestamp
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

    // Right-aligned header action button
    topActions.innerHTML = `
        <button class="btn btn-primary" id="btnCreateTeam">+ Create Team</button>
    `;

    // Dynamic container scaffolding
    container.innerHTML = `
        <div class="teams-view-header">
            <div>
                <h2 class="teams-view-heading">Manage Teams</h2>
                <p class="teams-view-subtitle">Create and manage competition teams</p>
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

    // Bind create click
    document
        .getElementById("btnCreateTeam")
        .addEventListener("click", () => openTeamModal());

    // Scroll handler to close fixed menus when scrolling to prevent floating drifts
    window.addEventListener('scroll', () => {
        const activeDropdown = document.querySelector('.active-body-dropdown');
        if (activeDropdown) activeDropdown.remove();
    }, true);

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
    const studentsRef = collection(db, "institutes", instId, "students");

    let teamsLoaded = false;
    let studentsLoaded = false;

    const checkAndRender = () => {
        if (teamsLoaded && studentsLoaded) {
            renderTeamsUI();
        }
    };

    // 1. Listen to teams
    unsubscribeTeams = onSnapshot(teamsRef, (snap) => {
        localTeams = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        teamsLoaded = true;
        checkAndRender();
    }, (err) => {
        console.error("Teams listener error:", err);
        window.showToast("Failed to load teams data.", "error");
    });

    // 2. Listen to students (used to calculate team sizes in real-time)
    unsubscribeStudents = onSnapshot(studentsRef, (snap) => {
        localStudents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        studentsLoaded = true;
        checkAndRender();
    }, (err) => {
        console.error("Students listener error:", err);
        window.showToast("Failed to load students data.", "error");
    });
}

function renderTeamsUI() {
    const tableContainer = document.getElementById("teamsTableContainer");
    const statsContainer = document.getElementById("teamsStatsBarContainer");
    if (!tableContainer) return;

    const totalTeams = localTeams.length;
    const totalStudents = localStudents.length;
    const averageMembers = totalTeams > 0 ? (totalStudents / totalTeams).toFixed(1) : "0.0";

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
                        <span class="teams-stat-val">${totalStudents}</span>
                    </div>
                    <div class="teams-stat-divider"></div>
                    <div class="teams-stat-item">
                        <span class="teams-stat-label">Avg. Members / Team</span>
                        <span class="teams-stat-val">${averageMembers}</span>
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
        
        // Calculate Members Count dynamically in-memory
        const membersCount = localStudents.filter(s => s.teamId === teamId || s.teamName === team.name).length;
        const membersLabel = membersCount === 1 ? "1 Member" : `${membersCount} Members`;

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
                        createdAt: serverTimestamp()
                    });
                    window.showToast("Team created.");
                }

                modalOverlay.classList.add("hidden");
            } catch (err) {
                console.error(err);
                window.showToast("An error occurred", "error");
            } finally {
                saveBtn.disabled = false;
                text.classList.remove("hidden");
                spinner.classList.add("hidden");
            }
        });
}

async function deleteTeam(teamId) {
    if (!confirm("Are you sure you want to delete this team?")) return;

    try {
        await deleteDoc(
            doc(
                db,
                "institutes",
                window.currentInstituteId,
                "teams",
                teamId
            )
        );
        window.showToast("Team deleted successfully.");
    } catch (err) {
        console.error(err);
        window.showToast("Error deleting team", "error");
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
        <button class="dropdown-item btn-delete-team text-danger" style="display:flex; align-items:center; gap:0.5rem; width:100%; border:none; background:transparent; padding:0.5rem 0.85rem; font-size:12px; font-weight:600; color:#dc2626; text-align:left; cursor:pointer;">
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
    dropdown.querySelector('.btn-edit-team').addEventListener('click', () => {
        dropdown.remove();
        openTeamModal(id, name, desc);
    });

    dropdown.querySelector('.btn-delete-team').addEventListener('click', () => {
        dropdown.remove();
        deleteTeam(id);
    });
}