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

export function initTeamsView(container, topActions) {

    if (unsubscribeTeams) unsubscribeTeams();

    topActions.innerHTML = `
        <button class="btn btn-primary" id="btnCreateTeam">+ Create Team</button>
    `;

    container.innerHTML = `
        <div class="grid" id="teamsGrid">
            <div class="loader-container">
                <div class="spinner"></div>
            </div>
        </div>
    `;

    document
        .getElementById("btnCreateTeam")
        .addEventListener("click", () => openTeamModal());

    loadTeamsData();
}

function loadTeamsData() {

    const teamsRef = collection(
        db,
        "institutes",
        window.currentInstituteId,
        "teams"
    );

    unsubscribeTeams = onSnapshot(
        teamsRef,
        (snapshot) => {

            const grid = document.getElementById("teamsGrid");
            grid.innerHTML = "";

            if (snapshot.empty) {
                grid.innerHTML = `
                    <div class="empty-state" style="grid-column:1/-1;margin-top:2rem;">
                        <div class="empty-state-icon">👥</div>
                        <h3>No Teams Found</h3>
                        <p>Click "Create Team" to add your first team.</p>
                    </div>
                `;
                return;
            }

            snapshot.forEach((docSnap) => {

                const team = docSnap.data();
                const teamId = docSnap.id;

                const card = document.createElement("div");
                card.className = "card";

                card.innerHTML = `
                    <div class="card-header">
                        <h3 class="card-title">${window.escapeHTML(team.name)}</h3>
                    </div>

                    <div class="card-body">
                        <p class="text-muted">
                            ${window.escapeHTML(team.description || "No description")}
                        </p>
                    </div>

                    <div class="card-actions">
                        <button class="btn btn-secondary btn-sm edit-team-btn"
                            data-id="${teamId}"
                            data-name="${window.escapeHTML(team.name)}"
                            data-desc="${window.escapeHTML(team.description || "")}">
                            Edit
                        </button>

                        <button class="btn btn-danger btn-sm delete-team-btn"
                            data-id="${teamId}">
                            Delete
                        </button>
                    </div>
                `;

                grid.appendChild(card);
            });

            document.querySelectorAll(".edit-team-btn").forEach((btn) => {
                btn.onclick = (e) =>
                    openTeamModal(
                        e.target.dataset.id,
                        e.target.dataset.name,
                        e.target.dataset.desc
                    );
            });

            document.querySelectorAll(".delete-team-btn").forEach((btn) => {
                btn.onclick = (e) => deleteTeam(e.target.dataset.id);
            });
        },
        (err) => {
            console.error("Teams listener error", err);
            window.showToast("Failed to load teams", "error");
        }
    );
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

                const name =
                    document.getElementById("teamName").value.trim();

                const desc =
                    document.getElementById("teamDesc").value.trim();

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