import { auth, db } from './firebase.js';
import {
    signInAnonymously,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import {
    collection,
    getDocs,
    getDoc,
    setDoc,
    deleteDoc,
    doc,
    query,
    where,
    writeBatch,
    serverTimestamp,
    increment,
    collectionGroup
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// Helper utilities
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

function normalizeText(s) {
    return (s || '').toString().trim().toLowerCase();
}

window.escapeHTML = function (str) {
    if (!str) return '';
    return str.toString().replace(/[&<>'"]/g,
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
};

// UI Toast
window.showToast = function (message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-message">${message}</span>
        <button class="toast-close">&times;</button>
    `;
    container.appendChild(toast);

    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.onclick = () => {
        toast.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    };

    setTimeout(() => {
        if (document.body.contains(toast)) {
            toast.style.animation = 'slideOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }
    }, 4000);
};

// UI Confirm dialog mapping to native browser confirm as fallback
window.customConfirm = async function (message, title = "Confirm action") {
    return window.confirm(`${title}\n\n${message}`);
};

// State Variables
let instId = '';
let token = '';
let teamId = '';
let teamDetails = null;
let instituteDetails = null;

let allPrograms = [];
let teamStudents = [];
let teamParticipants = []; // all participants in the team
let programParticipantsMap = new Map(); // programId -> Set of registered student IDs for current team

// Active View State
let currentView = 'dashboard'; // 'dashboard' | 'assignment'
let activeProgram = null;

// Assignment View Specific state
let selectedStudentIds = new Set();
let savedIndividualStudentIds = new Set();
let assignedParticipantsAll = [];
let participantDocIds = new Map();
let registrationsMap = new Map(); // studentId -> Set of registered program names
let studentGroupsMap = new Map(); // studentId -> { groupName, memberCount, members }
let allEventGroups = []; // Array of groups from all teams in this program
let activeFilter = 'all';
let editingParticipantId = null;

let resultSubmitted = false;
let resultPublished = false;

// Initialize on DOM Load
window.addEventListener('DOMContentLoaded', () => {
    initPortal();
});

async function initPortal() {
    const urlParams = new URLSearchParams(window.location.search);
    instId = urlParams.get('instId') || urlParams.get('instituteId') || '';
    token = urlParams.get('token') || '';

    if (!instId || !token) {
        showError("Invalid URL parameters", "The leader portal access link is missing either the institute ID or the token. Please contact the administrator.");
        return;
    }

    try {
        // Validate Token Document (Public Read)
        const tokenRef = doc(db, "institutes", instId, "leaderAccess", token);
        const tokenSnap = await getDoc(tokenRef);
        
        if (!tokenSnap.exists()) {
            showError("Access Denied", "The access link is invalid. It may have been rotated or deleted by the administrator.");
            return;
        }

        const tokenData = tokenSnap.data();
        if (!tokenData.enabled) {
            showError("Access Disabled", "This leader link has been deactivated by the administrator.");
            return;
        }

        teamId = tokenData.teamId;

        // Perform Anonymous Auth to Firestore
        onAuthStateChanged(auth, async (user) => {
            if (!user) {
                // Not authenticated, login anonymously
                try {
                    await signInAnonymously(auth);
                } catch (authErr) {
                    console.error("Auth failed:", authErr);
                    showError("Authentication Failed", "Failed to login anonymously. Please check connection and try again.");
                }
                return;
            }

            // Authenticated anonymously, establish/refresh session document
            try {
                const sessionRef = doc(db, "institutes", instId, "leaderSessions", user.uid);
                await setDoc(sessionRef, {
                    token: token,
                    teamId: teamId,
                    enabled: true,
                    updatedAt: serverTimestamp()
                });

                // Load initial dashboard data
                await loadPortalData();
            } catch (sessErr) {
                console.error("Session creation failed:", sessErr);
                showError("Authorization Error", "Access denied by Firebase Security Rules. Please make sure the token is valid.");
            }
        });

    } catch (err) {
        console.error("Portal Init Error:", err);
        showError("Error", "An unexpected error occurred while verifying the access token.");
    }
}

function showError(title, message) {
    document.getElementById("portalLoading").classList.add("hidden");
    document.getElementById("portalError").classList.remove("hidden");
    document.getElementById("portalErrorTitle").textContent = title;
    document.getElementById("portalErrorMessage").textContent = message;
}

async function loadPortalData() {
    try {
        // Fetch Institute details
        const instRef = doc(db, "institutes", instId);
        const instSnap = await getDoc(instRef);
        if (instSnap.exists()) {
            instituteDetails = instSnap.data();
            const instBadge = document.getElementById("headerInstituteName");
            if (instBadge) {
                instBadge.textContent = instituteDetails.name || instituteDetails.instituteName || "JK HIMAMI";
            }
        }

        // Fetch Team Details (Rule verified)
        const teamRef = doc(db, "institutes", instId, "teams", teamId);
        const teamSnap = await getDoc(teamRef);
        if (!teamSnap.exists()) {
            showError("Team Not Found", "The team assigned to this link does not exist.");
            return;
        }
        teamDetails = teamSnap.data();

        // Fetch team students
        const studentsSnap = await getDocs(query(
            collection(db, "institutes", instId, "students"),
            where("teamId", "==", teamId)
        ));
        teamStudents = studentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Fetch all programs (Public Read)
        const programsSnap = await getDocs(collection(db, "institutes", instId, "programs"));
        allPrograms = programsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Calculate and load all participant counts for this team
        await refreshTeamParticipants();

        // Render dashboard
        renderDashboard();

        document.getElementById("portalLoading").classList.add("hidden");
        document.getElementById("portalContent").classList.remove("hidden");
    } catch (err) {
        console.error("Load portal data error:", err);
        showError("Data Error", "Failed to fetch isolated team students and programs. Please refresh page.");
    }
}

async function refreshTeamParticipants() {
    teamParticipants = [];
    programParticipantsMap.clear();

    // Query collectionGroup participants for our team only
    try {
        const q = query(collectionGroup(db, "participants"), where("teamId", "==", teamId));
        const snap = await getDocs(q);
        
        snap.forEach(d => {
            const data = d.data();
            // Securely filter to match our current institute path
            if (d.ref.path.startsWith(`institutes/${instId}/`)) {
                const pathTokens = d.ref.path.split('/');
                const pId = data.programId || pathTokens[3];
                if (!pId) return;

                teamParticipants.push({ id: d.id, programId: pId, ...data });

                if (!programParticipantsMap.has(pId)) {
                    programParticipantsMap.set(pId, new Set());
                }

                if (data.type === 'individual' && data.studentId) {
                    programParticipantsMap.get(pId).add(data.studentId);
                } else if (data.type === 'group' && Array.isArray(data.groups)) {
                    data.groups.forEach(g => {
                        if (Array.isArray(g.members)) {
                            g.members.forEach(m => {
                                if (m.studentId) {
                                    programParticipantsMap.get(pId).add(m.studentId);
                                }
                            });
                        }
                    });
                }
            }
        });
    } catch (err) {
        console.error("Error loading team registrations:", err);
    }
}

function renderDashboard() {
    // Top Team Summary
    document.getElementById("headerTeamName").textContent = teamDetails.name || "Unknown Team";
    document.getElementById("statTotalStudents").textContent = teamStudents.length;
    
    const boysCount = teamStudents.filter(s => s.gender === 'Male').length;
    const girlsCount = teamStudents.filter(s => s.gender === 'Female').length;
    document.getElementById("statGenderSplit").textContent = `👦 ${boysCount} / 👧 ${girlsCount}`;

    // Total registrations
    let regCount = 0;
    programParticipantsMap.forEach((set) => {
        regCount += set.size;
    });
    document.getElementById("statTotalRegistrations").textContent = `${regCount} Entries`;

    // Filter programs to only those eligible for the team students' categories
    const teamCategoryIds = [...new Set(teamStudents.map(s => s.categoryId).filter(Boolean))];
    
    // Eligible Programs: matching categories OR general programs
    const eligiblePrograms = allPrograms.filter(p => {
        const catId = p.categoryId || '';
        return catId === 'general_programs' || teamCategoryIds.includes(catId);
    });

    document.getElementById("totalEligibleProgramsLabel").textContent = `${eligiblePrograms.length} Programs`;

    const container = document.getElementById("programsListContainer");
    container.innerHTML = "";

    if (eligiblePrograms.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:3rem; color:#64748b; font-style:italic; font-weight:500; grid-column: 1 / -1;">No eligible programs found for this team's student categories.</div>`;
        return;
    }

    eligiblePrograms.forEach(p => {
        const pId = p.id;
        const pType = (p.programType || p.type || 'individual').toLowerCase();
        const isGroup = pType === 'group' || (pType === 'general' && p.registrationType === 'group');
        const countSet = programParticipantsMap.get(pId);
        const assignedCount = countSet ? countSet.size : 0;
        
        let limitLabel = '';
        if (isGroup) {
            limitLabel = `Group limit: ${p.maxParticipants || '—'}`;
        } else {
            limitLabel = `Max: ${p.maxParticipants || '—'}`;
        }

        const card = document.createElement("div");
        card.className = "program-card";
        card.innerHTML = `
            <div class="program-info">
                <span class="pw-badge-compact ${isGroup ? 'pw-badge-registered' : 'pw-badge-male'}" style="align-self: flex-start; margin-bottom: 0.25rem;">
                    ${isGroup ? 'Group' : 'Individual'}
                </span>
                <strong style="font-size: 1.05rem; color: #1e293b;">${p.programNumber ? `[#${p.programNumber}] ` : ''}${window.escapeHTML(p.programName)}</strong>
                <div class="program-meta">
                    <span>Category: <strong>${window.escapeHTML(p.categoryName || p.categoryId || 'General')}</strong></span>
                    <span>•</span>
                    <span>Gender: <strong>${window.escapeHTML(p.genderCategory || 'Mixed')}</strong></span>
                    <span>•</span>
                    <span>Location: <strong>${window.escapeHTML(p.programLocation || 'Off Stage')}</strong></span>
                </div>
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:0.5rem; min-width: 140px;">
                <span class="pw-badge-compact pw-badge-eligible" style="font-weight: 700; font-size: 0.8rem; padding: 4px 10px;">
                    👥 ${assignedCount} Registered
                </span>
                <button class="btn btn-primary btn-sm btn-open-program" data-id="${pId}" style="font-weight:600; width:100%; border-radius:8px;">
                    Open
                </button>
            </div>
        `;

        card.querySelector(".btn-open-program").onclick = () => {
            openProgramAssignment(p);
        };

        container.appendChild(card);
    });
}

// Assignment View Routing & Logic
async function openProgramAssignment(prog) {
    activeProgram = prog;
    currentView = 'assignment';
    document.getElementById("viewDashboard").classList.add("hidden");
    document.getElementById("viewAssignment").classList.remove("hidden");

    // Clear buffer and highlights
    selectedStudentIds.clear();
    editingParticipantId = null;

    // Load assignment UI components
    const pType = (prog.programType || prog.type || 'individual').toLowerCase();
    const isGroupEvent = pType === 'group' || (pType === 'general' && prog.registrationType === 'group');
    const genderFilter = prog.genderCategory || 'Mixed';
    const isGeneral = pType === 'general' || prog.categoryId === 'general_programs';

    document.getElementById("assignBreadcrumb").textContent = `Programs · ${prog.categoryId === 'general_programs' ? 'General' : prog.categoryId || 'General'} · Add Students`;
    document.getElementById("assignProgramName").textContent = `👥 ${prog.programNumber ? `[#${prog.programNumber}] ` : ''}${prog.programName}`;
    document.getElementById("assignCategoryLabel").textContent = prog.categoryName || prog.categoryId || 'General';
    document.getElementById("assignGenderLabel").textContent = genderFilter;
    document.getElementById("assignLocationLabel").textContent = prog.programLocation || 'Off Stage';
    
    const typeBadge = document.getElementById("assignTypeBadge");
    typeBadge.textContent = isGroupEvent ? 'Group Event' : 'Individual Event';
    typeBadge.className = `pw-badge-compact ${isGroupEvent ? 'pw-badge-registered' : 'pw-badge-male'}`;

    document.getElementById("assignTeamBadge").textContent = `Team: ${teamDetails.name}`;

    // Show Loader
    document.getElementById("assignStudentsSkeleton").style.display = 'block';
    document.getElementById("assignStudentList").innerHTML = '';

    try {
        // 1. Check if results are submitted or published
        const resultsRef = collection(db, "institutes", instId, "results");
        const resultsSnap = await getDocs(query(resultsRef, where("programId", "==", prog.id)));
        resultSubmitted = false;
        resultPublished = false;
        if (!resultsSnap.empty) {
            const resDoc = resultsSnap.docs[0].data();
            if (resDoc.status === 'published') resultPublished = true;
            if (resDoc.markEntryStatus === 'submitted') resultSubmitted = true;
        }

        // Apply freeze warning badge
        const headerContainer = document.querySelector(".pw-header-title-row");
        const existingWarning = document.getElementById("pwFreezeBadge");
        if (existingWarning) existingWarning.remove();

        if (resultSubmitted || resultPublished) {
            const badge = document.createElement("span");
            badge.id = "pwFreezeBadge";
            badge.className = "pw-badge-compact pw-badge-cannot";
            badge.style.marginLeft = "10px";
            badge.textContent = resultPublished ? "🔒 Results Published (Locked)" : "🔒 Marks Submitted (Locked)";
            headerContainer.appendChild(badge);
        }

        // 2. Fetch registrations mapping for duplicate checks
        registrationsMap.clear();
        studentGroupsMap.clear();
        allEventGroups = [];

        // Scan other registrations for our team students
        const allProgs = allPrograms;
        const programsMap = new Map(allProgs.map(p => [p.id, p]));

        // Fetch team registrations across all programs to detect duplicate assignments
        const cgQuery = query(collectionGroup(db, "participants"), where("teamId", "==", teamId));
        const cgSnap = await getDocs(cgQuery);
        cgSnap.forEach(d => {
            const data = d.data();
            if (d.ref.path.startsWith(`institutes/${instId}/`)) {
                const pathTokens = d.ref.path.split('/');
                const pId = data.programId || pathTokens[3];
                if (!pId) return;

                const program = programsMap.get(pId);
                if (!program) return;
                const pName = (program.programNumber ? `[#${program.programNumber}] ` : '') + (program.programName || 'Unknown Program');
                const progType = (program.programType || program.type || 'individual').toLowerCase();

                if (data.type === 'individual' && data.studentId) {
                    const sId = data.studentId;
                    if (!registrationsMap.has(sId)) registrationsMap.set(sId, new Set());
                    registrationsMap.get(sId).add(pName);
                } else if (data.type === 'group' && Array.isArray(data.groups)) {
                    data.groups.forEach(g => {
                        const gName = g.name || 'Unnamed Group';
                        const mCount = g.members?.length || 0;
                        if (Array.isArray(g.members)) {
                            g.members.forEach(m => {
                                const sId = m.studentId;
                                if (sId) {
                                    if (!registrationsMap.has(sId)) registrationsMap.set(sId, new Set());
                                    registrationsMap.get(sId).add(`${pName} (${gName})`);
                                    
                                    if (pId === prog.id) {
                                        studentGroupsMap.set(sId, {
                                            groupName: gName,
                                            teamName: data.teamName || 'Other Team',
                                            memberCount: mCount,
                                            members: g.members || []
                                        });
                                    }
                                }
                            });
                        }
                    });
                }
            }
        });

        // 3. Load program specific participant details for this team
        savedIndividualStudentIds = new Set();
        assignedParticipantsAll = [];
        participantDocIds.clear();

        if (!isGroupEvent) {
            const participantsRef = collection(db, "institutes", instId, "programs", prog.id, "participants");
            const existingSnap = await getDocs(query(participantsRef, where('type', '==', 'individual'), where('teamId', '==', teamId)));
            existingSnap.forEach(d => {
                const data = d.data();
                if (data.studentId) {
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
        } else {
            // Load group event details
            const partRef = collection(db, "institutes", instId, "programs", prog.id, "participants");
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

        // Render elements
        renderStudentsCheklist();
        renderAssignedRightPanel();
        renderSelectionBufferAndSummary();

        // Bind checklist events
        setupChecklistListeners();

    } catch (e) {
        console.error("Error setting up program assignment:", e);
        window.showToast("Failed to open program assignments.", "error");
        goBackToDashboard();
    } finally {
        document.getElementById("assignStudentsSkeleton").style.display = 'none';
    }
}

function goBackToDashboard() {
    currentView = 'dashboard';
    document.getElementById("viewDashboard").classList.remove("hidden");
    document.getElementById("viewAssignment").classList.add("hidden");
    refreshTeamParticipants().then(() => renderDashboard());
}

document.getElementById("btnBackToDashboard").onclick = () => {
    goBackToDashboard();
};

function renderStudentsCheklist() {
    const listEl = document.getElementById('assignStudentList');
    if (!listEl) return;

    const prog = activeProgram;
    const pType = (prog.programType || prog.type || 'individual').toLowerCase();
    const isGroupEvent = pType === 'group' || (pType === 'general' && prog.registrationType === 'group');
    const genderFilter = prog.genderCategory || 'Mixed';
    const inheritedCategoryId = prog.categoryId || '';
    const isGeneral = pType === 'general' || inheritedCategoryId === 'general_programs';

    // Filter student checklist by category eligibility and gender
    let filtered = teamStudents;
    
    // Category check (except for general programs)
    if (!isGeneral) {
        filtered = filtered.filter(s => s.categoryId === inheritedCategoryId);
    }

    // Gender check
    if (genderFilter === 'Boys') {
        filtered = filtered.filter(s => s.gender === 'Male');
    } else if (genderFilter === 'Girls') {
        filtered = filtered.filter(s => s.gender === 'Female');
    }

    // Class filter (Search/Filter Pills)
    const searchQuery = normalizeText(document.getElementById("assignStudentSearch")?.value || '');
    if (searchQuery) {
        filtered = filtered.filter(s => 
            normalizeText(s.name).includes(searchQuery) || 
            normalizeText(s.chestNumber).includes(searchQuery)
        );
    }

    if (activeFilter === 'eligible') {
        // Show only eligible students (not assigned yet in this program)
        filtered = filtered.filter(s => {
            const isAssigned = savedIndividualStudentIds.has(s.id) || (isGroupEvent && allEventGroups.some(g => g.teamId === teamId && g.members?.some(m => m.studentId === s.id)));
            return !isAssigned;
        });
    } else if (activeFilter === 'selected') {
        // Show only currently checked items
        filtered = filtered.filter(s => selectedStudentIds.has(s.id));
    }

    document.getElementById("assignStudentsCountLabel").textContent = `Total: ${filtered.length}`;

    if (filtered.length === 0) {
        listEl.innerHTML = `<div class="pw-empty" style="padding:2rem; text-align:center; color:#64748b; font-size:0.8rem;">No eligible students found matching conditions.</div>`;
        return;
    }

    listEl.innerHTML = filtered.map(s => {
        const isSelected = selectedStudentIds.has(s.id);
        const isAssigned = savedIndividualStudentIds.has(s.id) || (isGroupEvent && allEventGroups.some(g => g.teamId === teamId && g.members?.some(m => m.studentId === s.id)));
        
        let statusText = 'Eligible';
        let statusClass = 'pw-badge-eligible';
        let statusDot = '🟢';

        if (isAssigned) {
            statusText = isGroupEvent ? 'Already in Group' : 'Registered Here';
            statusClass = 'pw-badge-registered';
            statusDot = '🔵';
        } else {
            const hasOtherRegs = registrationsMap.has(s.id) && registrationsMap.get(s.id).size > 0;
            if (hasOtherRegs) {
                statusText = 'Registered Elsewhere';
                statusClass = 'pw-badge-elsewhere';
                statusDot = '🟡';
            }
        }

        // Group status if group event
        let groupInfoHTML = '';
        const groupInfo = studentGroupsMap.get(s.id);
        if (groupInfo && isGroupEvent) {
            groupInfoHTML = `<span class="pw-badge-compact pw-badge-elsewhere">👥 ${window.escapeHTML(groupInfo.groupName)}</span>`;
        }

        const registeredProgs = Array.from(registrationsMap.get(s.id) || []);
        const tagsHTML = registeredProgs.map(name => `
            <span class="stu-tag" title="${window.escapeHTML(name)}">
                <span class="stu-tag-check">✔</span> ${window.escapeHTML(name.length > 15 ? name.slice(0, 15) + '...' : name)}
            </span>
        `).join('');

        const cardClass = `stu-card ${isSelected ? 'is-selected' : ''} ${isAssigned ? 'is-assigned' : ''}`;

        return `
            <div class="${cardClass}" data-stu-id="${s.id}">
                <div class="stu-card-check">
                    <span class="pw-checkbox"></span>
                </div>
                <div class="stu-card-body">
                    <div class="stu-card-title" style="font-weight:700;">${window.escapeHTML(s.name)}</div>
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

    // Bind card click event
    listEl.querySelectorAll(".stu-card").forEach(card => {
        card.onclick = () => {
            const id = card.getAttribute('data-stu-id');
            const s = teamStudents.find(x => x.id === id);
            if (!s) return;

            const isAssigned = savedIndividualStudentIds.has(id) || (isGroupEvent && allEventGroups.some(g => g.teamId === teamId && g.members?.some(m => m.studentId === id)));
            if (isAssigned) {
                window.showToast("This student is already registered for this program.", "error");
                return;
            }

            if (resultSubmitted || resultPublished) {
                window.showToast("Modifications locked. Results or marks have already been submitted.", "error");
                return;
            }

            if (selectedStudentIds.has(id)) {
                selectedStudentIds.delete(id);
            } else {
                selectedStudentIds.add(id);
            }

            renderStudentsCheklist();
            renderSelectionBufferAndSummary();
        };
    });
}

function setupChecklistListeners() {
    const searchInput = document.getElementById("assignStudentSearch");
    if (searchInput) {
        searchInput.oninput = () => {
            renderStudentsCheklist();
        };
    }

    const pills = document.querySelectorAll("#assignFilterPills .pw-filter-pill");
    pills.forEach(pill => {
        pill.onclick = () => {
            pills.forEach(p => p.classList.remove("is-active"));
            pill.classList.add("is-active");
            activeFilter = pill.getAttribute("data-filter");
            renderStudentsCheklist();
        };
    });
}

function renderSelectionBufferAndSummary() {
    const previewContainer = document.getElementById("assignSelectedStudentsPreview");
    const bufferCard = document.getElementById("assignSelectionBuffer");
    const prog = activeProgram;
    const pType = (prog.programType || prog.type || 'individual').toLowerCase();
    const isGroupEvent = pType === 'group' || (pType === 'general' && prog.registrationType === 'group');
    const maxVal = prog.maxParticipants || 0;

    const selectedCount = selectedStudentIds.size;
    document.getElementById("assignSelectedCountBadge").textContent = selectedCount;

    if (selectedCount === 0) {
        bufferCard.classList.add("is-empty");
        previewContainer.innerHTML = `<div style="padding:1.5rem; text-align:center; color:#94a3b8; font-size:0.8rem; font-style:italic;">No students currently selected in checklist.</div>`;
    } else {
        bufferCard.classList.remove("is-empty");
        const chips = [...selectedStudentIds].map(id => {
            const s = teamStudents.find(x => x.id === id);
            if (!s) return '';
            return `
                <div class="pw-chip">
                    <span>${window.escapeHTML(s.name)}</span>
                    <button class="pw-chip-remove" data-id="${s.id}">&times;</button>
                </div>
            `;
        }).join('');
        previewContainer.innerHTML = chips;

        previewContainer.querySelectorAll(".pw-chip-remove").forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const id = btn.getAttribute("data-id");
                selectedStudentIds.delete(id);
                renderStudentsCheklist();
                renderSelectionBufferAndSummary();
            };
        });
    }

    // Summary calculations
    document.getElementById("assignMetricSelected").textContent = `${selectedCount} / ${maxVal || '—'}`;
    const metricSlots = document.getElementById("assignMetricSlots");
    const progressFill = document.getElementById("assignProgressBarFill");

    if (maxVal) {
        const remaining = Math.max(0, maxVal - selectedCount);
        metricSlots.textContent = remaining;
        const pct = Math.min(100, (selectedCount / maxVal) * 100);
        progressFill.style.width = `${pct}%`;

        if (selectedCount > maxVal) {
            progressFill.classList.add('is-limit');
            progressFill.style.background = '#ef4444';
        } else {
            progressFill.classList.remove('is-limit');
            progressFill.style.background = 'var(--pw-primary)';
        }
    } else {
        metricSlots.textContent = '—';
        progressFill.style.width = '0%';
    }

    // Warning Alerts
    const alertContainer = document.getElementById("assignAlertContainer");
    alertContainer.innerHTML = "";

    if (maxVal && selectedCount > maxVal) {
        alertContainer.innerHTML += `
            <div class="pw-alert is-danger" style="margin-top: 0.5rem;">
                <span>⚠️ Limit exceeded! Maximum allowed is ${maxVal} members.</span>
            </div>
        `;
    }

    // Check conflict warning for multiple programs
    let hasConflict = false;
    selectedStudentIds.forEach(id => {
        if (registrationsMap.has(id) && registrationsMap.get(id).size > 0) {
            hasConflict = true;
        }
    });

    if (hasConflict) {
        alertContainer.innerHTML += `
            <div class="pw-alert" style="margin-top: 0.5rem;">
                <span>⚠️ One or more selected students are registered in other programs. This is a warning only; registrations are still allowed.</span>
            </div>
        `;
    }

    // Dynamic Footer Save Button Area
    const footer = document.getElementById("assignActionFooter");
    footer.innerHTML = "";

    if (isGroupEvent) {
        footer.innerHTML = `
            <div style="width:100%; display:flex; flex-direction:column; gap:0.5rem;">
                <input id="pwNewGroupName" class="form-input" placeholder="New Group Name (e.g. Group A)" style="font-size: 0.8rem; padding: 0.55rem 0.75rem;" ${resultSubmitted || resultPublished ? 'disabled' : ''} />
                <button class="btn btn-primary w-full" id="pwCreateGroupBtn" style="font-weight:700; min-height:38px;">+ Create Group</button>
            </div>
        `;
        
        const createBtn = document.getElementById("pwCreateGroupBtn");
        createBtn.disabled = selectedCount === 0 || (maxVal && selectedCount > maxVal) || resultSubmitted || resultPublished;

        createBtn.onclick = async () => {
            const groupName = document.getElementById("pwNewGroupName").value.trim();
            if (!groupName) {
                window.showToast("Group Name is required.", "error");
                return;
            }
            await createGroupRegistration(groupName);
        };
    } else {
        footer.innerHTML = `
            <div style="width:100%; display:flex; flex-direction:column; gap:0.5rem;">
                <button class="btn btn-primary w-full" id="pwSaveParticipantsBtn" style="font-weight:700; min-height:38px;">💾 Save Participants</button>
                <div id="pwSaveStatus" style="font-size:0.72rem; color:#64748b; text-align:center;"></div>
            </div>
        `;

        const saveBtn = document.getElementById("pwSaveParticipantsBtn");
        saveBtn.disabled = selectedCount === 0 || (maxVal && selectedCount > maxVal) || resultSubmitted || resultPublished;

        saveBtn.onclick = async () => {
            await saveIndividualRegistrations(saveBtn);
        };
    }
}

async function saveIndividualRegistrations(btn) {
    btn.disabled = true;
    btn.textContent = "Saving...";
    const statusEl = document.getElementById("pwSaveStatus");
    if (statusEl) statusEl.textContent = 'Saving participant registrations...';

    const prog = activeProgram;

    try {
        const partRef = collection(db, "institutes", instId, "programs", prog.id, "participants");
        
        // Scan current assigned students
        const existingSnap = await getDocs(query(partRef, where('type', '==', 'individual'), where('teamId', '==', teamId)));
        const existingStudentIds = new Set();
        existingSnap.forEach(d => {
            const data = d.data();
            if (data.studentId) existingStudentIds.add(data.studentId);
        });

        const toAdd = [...selectedStudentIds]
            .filter(id => !existingStudentIds.has(id))
            .map(id => teamStudents.find(s => s.id === id))
            .filter(Boolean);

        if (toAdd.length === 0) {
            window.showToast("All selected students are already assigned.", "success");
            selectedStudentIds.clear();
            await openProgramAssignment(prog);
            return;
        }

        const batch = writeBatch(db);
        for (const s of toAdd) {
            const newDoc = doc(partRef, `individual_${safeDocId(teamId)}_${safeDocId(s.id)}`);
            batch.set(newDoc, {
                type: 'individual',
                studentId: s.id || '',
                studentName: s.name || '',
                chestNumber: s.chestNumber || '',
                gender: s.gender || '',
                teamId: teamId,
                teamName: teamDetails.name || '',
                categoryId: prog.categoryId || 'general_programs',
                categoryName: prog.categoryName || 'General Programs',
                classId: s.classId || '',
                className: s.className || '',
                programId: prog.id || '',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
        }

        const progRef = doc(db, "institutes", instId, "programs", prog.id);
        batch.update(progRef, { participantCount: increment(toAdd.length) });

        await batch.commit();
        window.showToast(`${toAdd.length} participants saved successfully!`);
        selectedStudentIds.clear();
        
        // Reload details
        await openProgramAssignment(prog);
    } catch (e) {
        console.error("Save registrations error:", e);
        window.showToast("Failed to save registrations.", "error");
        if (statusEl) statusEl.textContent = 'Save failed.';
    } finally {
        btn.disabled = false;
        btn.textContent = '💾 Save Participants';
    }
}

async function createGroupRegistration(groupName) {
    const prog = activeProgram;
    const createBtn = document.getElementById("pwCreateGroupBtn");
    createBtn.disabled = true;

    try {
        const partRef = collection(db, "institutes", instId, "programs", prog.id, "participants");
        const docId = `group_${safeDocId(teamId)}`;
        const docRef = doc(partRef, docId);

        // Fetch current team group document if exists
        const docSnap = await getDoc(docRef);
        let existingGroups = [];
        if (docSnap.exists()) {
            existingGroups = docSnap.data().groups || [];
        }

        const members = teamStudents
            .filter(s => selectedStudentIds.has(s.id))
            .map(s => ({
                studentId: s.id || '',
                studentName: s.name || ''
            }));

        const newGroup = { id: uid('group'), name: groupName, members };
        const updatedGroups = [...existingGroups, newGroup];

        await setDoc(docRef, {
            teamId: teamId,
            teamName: teamDetails.name || '',
            categoryId: prog.categoryId || '',
            programId: prog.id || '',
            type: 'group',
            groups: updatedGroups,
            updatedAt: serverTimestamp()
        }, { merge: true });

        const progRef = doc(db, "institutes", instId, "programs", prog.id);
        await setDoc(progRef, { participantCount: increment(1) }, { merge: true });

        window.showToast("Group created successfully!");
        selectedStudentIds.clear();

        await openProgramAssignment(prog);
    } catch (e) {
        console.error("Group creation failed:", e);
        window.showToast("Failed to create group.", "error");
        createBtn.disabled = false;
    }
}

function renderAssignedRightPanel() {
    const container = document.getElementById("assignRightPanelBody");
    const titleText = document.getElementById("assignRightPanelTitleText");
    const subtitleText = document.getElementById("assignRightPanelSubtitleText");

    const prog = activeProgram;
    const pType = (prog.programType || prog.type || 'individual').toLowerCase();
    const isGroupEvent = pType === 'group' || (pType === 'general' && prog.registrationType === 'group');

    container.innerHTML = "";

    if (isGroupEvent) {
        titleText.textContent = "📂 Registered Groups";
        subtitleText.textContent = "Manage created groups and member registers for your team.";

        const teamGroups = allEventGroups.filter(g => g.teamId === teamId);
        if (teamGroups.length === 0) {
            container.innerHTML = `<div class="pw-empty" style="padding:2rem; text-align:center; color:#64748b; font-size:0.8rem; border:1.5px dashed #cbd5e1; border-radius:8px;">No groups created.</div>`;
            return;
        }

        container.innerHTML = teamGroups.map(g => {
            const memberNames = (g.members || []).map(m => `
                <div style="display:flex; justify-content:space-between; align-items:center; background:#f1f5f9; padding:0.4rem 0.6rem; border-radius:6px; font-size:0.75rem; color:#334155; font-weight:600;">
                    <span>${window.escapeHTML(m.studentName)}</span>
                </div>
            `).join('');

            return `
                <div class="pw-group-card" style="border:1.5px solid var(--pw-border); border-radius:10px; padding:1rem; margin-bottom:0.75rem; background:white;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                        <h4 style="margin:0; font-size:0.9rem; font-weight:800; color:#1e293b;">${window.escapeHTML(g.name)}</h4>
                        <button class="btn btn-secondary btn-sm btn-delete-group text-danger" data-id="${g.id}" style="padding:3px 8px; font-size:0.7rem; font-weight:700; color:#dc2626; border-color:rgba(220,38,38,0.2);" ${resultSubmitted || resultPublished ? 'disabled' : ''}>🗑️ Delete Group</button>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:0.35rem; margin-top:0.75rem;">
                        ${memberNames}
                    </div>
                </div>
            `;
        }).join('');

        // Bind delete group buttons
        container.querySelectorAll(".btn-delete-group").forEach(btn => {
            btn.onclick = async () => {
                const gId = btn.getAttribute("data-id");
                await deleteGroup(gId);
            };
        });

    } else {
        titleText.textContent = "📋 Assigned Participants";
        subtitleText.textContent = "List of saved individual registrations for this team.";

        if (assignedParticipantsAll.length === 0) {
            container.innerHTML = `<div class="pw-empty" style="padding:2rem; text-align:center; color:#64748b; font-size:0.8rem; border:1.5px dashed #cbd5e1; border-radius:8px;">No participants assigned.</div>`;
            return;
        }

        let tableRows = assignedParticipantsAll.map(p => `
            <tr>
                <td>#${window.escapeHTML(p.chestNumber || '—')}</td>
                <td style="font-weight:700; color:var(--pw-slate-900);">${window.escapeHTML(p.studentName)}</td>
                <td>${window.escapeHTML(p.className)}</td>
                <td>
                    <button class="btn-action-icon pw-part-dots-btn" data-id="${p.studentId}" ${resultSubmitted || resultPublished ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" style="width:0.85rem; height:0.85rem;">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 12.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 18.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />
                        </svg>
                    </button>
                </td>
            </tr>
        `).join('');

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

        container.innerHTML = `
            ${editingFormHTML}
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

        // Bind Edit panel buttons
        container.querySelectorAll(".pw-cancel-edit-btn").forEach(btn => {
            btn.onclick = () => {
                editingParticipantId = null;
                renderAssignedRightPanel();
            };
        });

        container.querySelectorAll(".pw-save-edit-btn").forEach(btn => {
            btn.onclick = async () => {
                const sId = btn.getAttribute("data-id");
                const newName = document.getElementById(`pwEditName_${sId}`).value.trim();
                const newClass = document.getElementById(`pwEditClass_${sId}`).value.trim();

                if (!newName) {
                    window.showToast("Student Name is required.", "error");
                    return;
                }

                await saveEditParticipant(sId, newName, newClass);
            };
        });

        // Bind dropdown click
        container.querySelectorAll(".pw-part-dots-btn").forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                if (resultSubmitted || resultPublished) return;
                openParticipantDropdownMenu(btn);
            };
        });
    }

    // Update Header participant count label
    document.getElementById("assignParticipantCount").textContent = `👥 ${assignedParticipantsAll.length} Participant${assignedParticipantsAll.length === 1 ? '' : 's'}`;
}

async function saveEditParticipant(studentId, name, className) {
    try {
        const prog = activeProgram;
        const partRef = collection(db, "institutes", instId, "programs", prog.id, "participants");
        const docId = participantDocIds.get(studentId) || `individual_${safeDocId(teamId)}_${safeDocId(studentId)}`;
        const docRef = doc(partRef, docId);

        await setDoc(docRef, {
            studentName: name,
            className: className,
            updatedAt: serverTimestamp()
        }, { merge: true });

        window.showToast("Participant entry updated successfully!");
        editingParticipantId = null;
        await openProgramAssignment(prog);
    } catch (err) {
        console.error("Save edit failed:", err);
        window.showToast("Failed to save changes.", "error");
    }
}

function openParticipantDropdownMenu(btn) {
    // Clean up existing dropdowns
    const existing = document.querySelector('.active-body-dropdown');
    if (existing) existing.remove();

    const id = btn.getAttribute('data-id');

    const dropdown = document.createElement('div');
    dropdown.className = 'actions-dropdown-menu active-body-dropdown';
    dropdown.innerHTML = `
        <button class="dropdown-item pw-dropdown-edit-btn" data-id="${id}" style="display:flex; align-items:center; gap:0.5rem; width:100%; border:none; background:transparent; padding:0.5rem 0.85rem; font-size:12px; font-weight:600; color:#475569; text-align:left; cursor:pointer;">✏️ Edit</button>
        <button class="dropdown-item btn-danger-item pw-dropdown-delete-btn text-danger" data-id="${id}" style="display:flex; align-items:center; gap:0.5rem; width:100%; border:none; background:transparent; padding:0.5rem 0.85rem; font-size:12px; font-weight:600; color:#dc2626; text-align:left; cursor:pointer;">🗑️ Delete</button>
    `;

    document.body.appendChild(dropdown);

    const rect = btn.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + window.scrollY}px`;
    dropdown.style.left = `${rect.left + window.scrollX - 120 + rect.width}px`;

    dropdown.querySelector('.pw-dropdown-edit-btn').onclick = () => {
        dropdown.remove();
        editingParticipantId = id;
        renderAssignedRightPanel();
    };

    dropdown.querySelector('.pw-dropdown-delete-btn').onclick = async () => {
        dropdown.remove();
        await deleteParticipant(id);
    };

    // Close on click outside
    const closeMenu = (e) => {
        if (!e.target.closest('.pw-part-dots-btn') && !e.target.closest('.active-body-dropdown')) {
            dropdown.remove();
            document.removeEventListener('click', closeMenu);
        }
    };
    document.addEventListener('click', closeMenu);
}

async function deleteParticipant(studentId) {
    const student = assignedParticipantsAll.find(x => x.studentId === studentId);
    if (!student) return;

    const confirmed = await window.customConfirm(`Are you sure you want to remove registration for ${student.studentName}?`);
    if (!confirmed) return;

    const prog = activeProgram;

    try {
        const partRef = collection(db, "institutes", instId, "programs", prog.id, "participants");
        const docId = participantDocIds.get(studentId) || `individual_${safeDocId(teamId)}_${safeDocId(studentId)}`;
        const docRef = doc(partRef, docId);

        await deleteDoc(docRef);

        const progRef = doc(db, "institutes", instId, "programs", prog.id);
        await setDoc(progRef, { participantCount: increment(-1) }, { merge: true });

        window.showToast("Registration removed successfully!");
        selectedStudentIds.delete(studentId);
        
        await openProgramAssignment(prog);
    } catch (e) {
        console.error("Delete registration error:", e);
        window.showToast("Failed to delete participant registration.", "error");
    }
}

async function deleteGroup(gId) {
    const prog = activeProgram;
    const confirmed = await window.customConfirm("Are you sure you want to delete this group? All group member registrations will also be removed.");
    if (!confirmed) return;

    try {
        const partRef = collection(db, "institutes", instId, "programs", prog.id, "participants");
        const docId = `group_${safeDocId(teamId)}`;
        const docRef = doc(partRef, docId);

        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) return;

        const currentGroups = docSnap.data().groups || [];
        const updatedGroups = currentGroups.filter(g => g.id !== gId);

        if (updatedGroups.length === 0) {
            // Delete the entire document if no groups remain
            await deleteDoc(docRef);
        } else {
            await setDoc(docRef, {
                groups: updatedGroups,
                updatedAt: serverTimestamp()
            }, { merge: true });
        }

        const progRef = doc(db, "institutes", instId, "programs", prog.id);
        await setDoc(progRef, { participantCount: increment(-1) }, { merge: true });

        window.showToast("Group deleted successfully!");
        await openProgramAssignment(prog);
    } catch (e) {
        console.error("Delete group error:", e);
        window.showToast("Failed to delete group.", "error");
    }
}
