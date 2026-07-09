import { db, computeDenseRanking, getCachedPointsConfig, DEFAULT_POINTS } from './firebase.js';
import {
    collection, doc, getDoc, getDocs, setDoc, onSnapshot, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// Point Systems & Grading Mapping (identical to mark-entry.js)
let activePointsConfig = DEFAULT_POINTS;

function getGradeAndPoints(score, classType = 'individual') {
    const config = activePointsConfig[classType] || DEFAULT_POINTS[classType];
    const gradePointsMap = {
        'A+': config.gradeAPlus !== undefined ? Number(config.gradeAPlus) : 5,
        'A': config.gradeA !== undefined ? Number(config.gradeA) : 4,
        'B+': config.gradeBPlus !== undefined ? Number(config.gradeBPlus) : 3,
        'B': config.gradeB !== undefined ? Number(config.gradeB) : 2,
        'C': config.gradeC !== undefined ? Number(config.gradeC) : 1
    };

    let grade = '';
    if (score >= 90) grade = 'A+';
    else if (score >= 80) grade = 'A';
    else if (score >= 70) grade = 'B+';
    else if (score >= 60) grade = 'B';
    else if (score >= 50) grade = 'C';

    const points = grade ? (gradePointsMap[grade] || 0) : 0;
    return { grade, points };
}

// Module State
let currentJudge = null;
let currentInstituteId = null;
let assignedPrograms = [];
let resultsMap = new Map(); // progId -> resultDoc
let activeTab = 'all'; // 'all', 'pending', 'completed'
let searchQuery = '';
let currentScoringProg = null;
let unsubscribeResultsListener = null;

// Global Toast Helper
window.showToast = function (message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `jp-toast`;
    toast.style.background = type === 'error' ? '#ef4444' : (type === 'warning' ? '#f59e0b' : '#10b981');
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

window.escapeHTML = function (str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

// Initialize Portal on Load
document.addEventListener('DOMContentLoaded', async () => {
    await initJudgePortal();
});

async function initJudgePortal() {
    const mainContainer = document.getElementById('jpMainContainer');
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    if (!token) {
        renderError("Access Link Missing", "Please request a valid secure access link from your institute event administrator.");
        return;
    }

    try {
        // Parse instituteId and judgeId from token format: instId_judgeId_suffix
        const parts = token.split('_');
        if (parts.length < 2) {
            renderError("Invalid Access Link", "The access link format is invalid.");
            return;
        }

        const instId = parts[0];
        const judgeId = parts[1];

        const judgeDocRef = doc(db, "institutes", instId, "judges", judgeId);
        const judgeSnap = await getDoc(judgeDocRef);

        if (!judgeSnap.exists()) {
            renderError("Judge Profile Not Found", "The judge profile linked to this URL no longer exists.");
            return;
        }

        const judgeData = judgeSnap.data();
        if (judgeData.status === 'disabled') {
            renderError("Account Disabled", "Your judge account has been deactivated by the administrator.");
            return;
        }

        currentJudge = { id: judgeSnap.id, ...judgeData };
        currentInstituteId = instId;

        try {
            activePointsConfig = await getCachedPointsConfig(currentInstituteId);
        } catch (e) {
            console.error("Failed to load points config in judge portal:", e);
            activePointsConfig = DEFAULT_POINTS;
        }

        // Update Header
        document.getElementById('jpJudgeWelcome').textContent = `Welcome, ${currentJudge.name}`;
        document.getElementById('jpHeaderBadge').innerHTML = `<span class="badge" style="background:#e0e7ff; color:#4338ca; border:1px solid #c7d2fe; font-weight:700;">Active Judge</span>`;

        // Listen to Real-Time Results & Load Programs
        setupRealtimeSync();

    } catch (err) {
        console.error("Judge authentication error:", err);
        renderError("Connection Error", "Unable to authenticate secure link. Please check your internet connection.");
    }
}

function renderError(title, msg) {
    const mainContainer = document.getElementById('jpMainContainer');
    mainContainer.innerHTML = `
        <div style="background:#fff; border:1px solid #fecdd3; border-radius:16px; padding:2rem; text-align:center; margin-top:2rem; box-shadow:0 4px 12px rgba(0,0,0,0.03);">
            <div style="font-size:3rem; margin-bottom:0.5rem;">🔒</div>
            <h2 style="color:#9f1239; font-size:1.3rem; font-weight:800; margin:0 0 0.5rem 0;">${window.escapeHTML(title)}</h2>
            <p style="color:#475569; font-size:0.9rem; line-height:1.5; margin:0;">${window.escapeHTML(msg)}</p>
        </div>
    `;
}

function setupRealtimeSync() {
    const resultsRef = collection(db, "institutes", currentInstituteId, "results");
    
    unsubscribeResultsListener = onSnapshot(resultsRef, async (snapshot) => {
        resultsMap.clear();
        snapshot.docs.forEach(d => {
            resultsMap.set(d.data().programId || d.id.replace('result_', ''), { id: d.id, ...d.data() });
        });

        // Load programs on initial load or re-render
        if (assignedPrograms.length === 0) {
            await loadAssignedPrograms();
        } else {
            if (currentScoringProg) {
                // If currently inside scoring view, keep it fresh
            } else {
                renderHomeScreen();
            }
        }
    }, (err) => {
        console.error("Realtime results sync error:", err);
    });
}

async function loadAssignedPrograms() {
    try {
        const progSnap = await getDocs(collection(db, "institutes", currentInstituteId, "programs"));
        const comps = Array.isArray(currentJudge.competitions) ? currentJudge.competitions : [];
        
        assignedPrograms = [];
        progSnap.docs.forEach(d => {
            const p = d.data();
            const pName = (p.programName || p.name || '').trim();
            if (comps.some(c => c.toLowerCase().trim() === pName.toLowerCase())) {
                assignedPrograms.push({ id: d.id, ...p });
            }
        });

        renderHomeScreen();
    } catch (e) {
        console.error("Failed to load assigned programs:", e);
        window.showToast("Failed to load assigned competitions.", "error");
    }
}

// ─────────────────────────────────────────────
// Home Screen Rendering
// ─────────────────────────────────────────────
function renderHomeScreen() {
    const mainContainer = document.getElementById('jpMainContainer');
    currentScoringProg = null;

    let filtered = assignedPrograms.filter(p => {
        if (searchQuery) {
            const name = (p.programName || p.name || '').toLowerCase();
            const cat = (p.categoryName || '').toLowerCase();
            return name.includes(searchQuery) || cat.includes(searchQuery);
        }
        return true;
    });

    // Segment into pending vs completed for judge
    let pendingCount = 0;
    let completedCount = 0;

    const cardsHTML = filtered.map(p => {
        const resDoc = resultsMap.get(p.id);
        const isCompleted = isJudgeScoringCompleted(p, resDoc);
        if (isCompleted) completedCount++;
        else pendingCount++;

        if (activeTab === 'pending' && isCompleted) return '';
        if (activeTab === 'completed' && !isCompleted) return '';

        const statusBadge = isCompleted 
            ? `<span class="jp-badge jp-badge-completed">✓ Completed</span>`
            : `<span class="jp-badge jp-badge-pending">⏳ Pending</span>`;

        const displayType = p.programType === 'general' ? 'General' : (p.type || 'Individual');

        return `
            <div class="jp-program-card">
                <div class="jp-prog-header">
                    <div>
                        <h3 class="jp-prog-name">${p.programNumber ? `[#${p.programNumber}] ` : ''}${window.escapeHTML(p.programName || p.name)}</h3>
                    </div>
                    ${statusBadge}
                </div>
                <div class="jp-prog-meta">
                    <span>📋 ${window.escapeHTML(p.categoryName || 'General')}</span>
                    <span>📍 Stage: ${window.escapeHTML(p.programLocation || 'Stage')}</span>
                    <span>👥 Type: ${window.escapeHTML(displayType)}</span>
                </div>
                <button class="jp-btn-open btn-open-prog" data-id="${p.id}">
                    🖋️ Enter / Edit Marks
                </button>
            </div>
        `;
    }).join('');

    mainContainer.innerHTML = `
        <div style="margin-bottom:1rem;">
            <input type="text" id="jpSearchInput" class="form-input" placeholder="🔍 Search assigned programs..." value="${window.escapeHTML(searchQuery)}" style="width:100%; height:46px; border-radius:12px; font-size:0.95rem; padding:0 1rem; border:1px solid #cbd5e1; box-shadow:0 1px 3px rgba(0,0,0,0.02);" />
        </div>

        <div class="jp-tabs">
            <button class="jp-tab ${activeTab === 'all' ? 'active' : ''}" data-tab="all">All (${assignedPrograms.length})</button>
            <button class="jp-tab ${activeTab === 'pending' ? 'active' : ''}" data-tab="pending">Pending</button>
            <button class="jp-tab ${activeTab === 'completed' ? 'active' : ''}" data-tab="completed">Completed</button>
        </div>

        <div id="jpProgramList">
            ${cardsHTML || `<div style="text-align:center; padding:3rem; color:#94a3b8; background:#fff; border-radius:14px; border:1px solid #e2e8f0;">
                <div style="font-size:2.5rem; margin-bottom:0.5rem;">📝</div>
                <h4 style="margin:0; color:#475569;">No competition sheets found</h4>
                <p style="font-size:0.8rem; margin-top:0.25rem;">There are no programs matching your current filter.</p>
            </div>`}
        </div>
    `;

    // Bind listeners
    document.getElementById('jpSearchInput').oninput = (e) => {
        searchQuery = e.target.value.toLowerCase().trim();
        renderHomeScreen();
    };

    mainContainer.querySelectorAll('.jp-tab').forEach(btn => {
        btn.onclick = () => {
            activeTab = btn.getAttribute('data-tab');
            renderHomeScreen();
        };
    });

    mainContainer.querySelectorAll('.btn-open-prog').forEach(btn => {
        btn.onclick = () => {
            const id = btn.getAttribute('data-id');
            const prog = assignedPrograms.find(p => p.id === id);
            if (prog) openScoringView(prog);
        };
    });
}

function isJudgeScoringCompleted(prog, resDoc) {
    if (!resDoc || !Array.isArray(resDoc.marksData) || resDoc.marksData.length === 0) return false;
    const judgesList = Array.isArray(resDoc.judges) ? resDoc.judges : [];
    const judgeIdx = judgesList.indexOf(currentJudge.name);
    if (judgeIdx === -1) return false;

    // Check if every participant has a mark filled by this judge
    return resDoc.marksData.every(m => {
        return Array.isArray(m.marks) && m.marks[judgeIdx] !== undefined && m.marks[judgeIdx] !== null;
    });
}

// ─────────────────────────────────────────────
// Scoring View Implementation
// ─────────────────────────────────────────────
async function openScoringView(prog) {
    currentScoringProg = prog;
    const mainContainer = document.getElementById('jpMainContainer');

    mainContainer.innerHTML = `
        <div style="text-align:center; padding:3rem;">
            <div class="spinner" style="margin:0 auto 1rem auto;"></div>
            <p style="color:#64748b; font-weight:600;">Loading contestants list...</p>
        </div>
    `;

    try {
        const participants = await loadParticipants(prog);
        const resDoc = resultsMap.get(prog.id);

        if (participants.length === 0) {
            mainContainer.innerHTML = `
                <button class="jp-back-btn" id="jpBackHome">← Back to Programs List</button>
                <div style="text-align:center; padding:3rem; background:#fff; border-radius:14px; border:1px solid #cbd5e1;">
                    <div style="font-size:2.5rem; margin-bottom:0.5rem;">👥</div>
                    <h3 style="margin:0; color:#0f172a;">No Contestants Registered</h3>
                    <p style="font-size:0.85rem; color:#64748b; margin-top:0.25rem;">There are no registered participants for this program yet.</p>
                </div>
            `;
            document.getElementById('jpBackHome').onclick = () => renderHomeScreen();
            return;
        }

        renderScoringUI(prog, participants, resDoc);
    } catch (e) {
        console.error("Failed loading scoring view:", e);
        window.showToast("Failed to load contestants.", "error");
    }
}

async function loadParticipants(prog) {
    const snap = await getDocs(collection(db, "institutes", currentInstituteId, "programs", prog.id, "participants"));
    const isGroup = prog.programType === 'group' || prog.registrationType === 'group' || prog.type === 'Group';
    const list = [];

    snap.docs.forEach(d => {
        const p = d.data();
        if (isGroup) {
            const groups = Array.isArray(p.groups) ? p.groups : [];
            if (groups.length > 0) {
                groups.forEach(g => {
                    list.push({
                        id: g.id || `${p.teamId || d.id}_${g.name || 'group'}`,
                        name: g.name || p.teamName || 'Group',
                        chestNumber: '—',
                        teamId: p.teamId || '',
                        teamName: p.teamName || ''
                    });
                });
            } else {
                list.push({
                    id: p.teamId || d.id,
                    name: p.teamName || 'Team',
                    chestNumber: '—',
                    teamId: p.teamId || '',
                    teamName: p.teamName || ''
                });
            }
        } else {
            list.push({
                id: p.studentId || d.id,
                name: p.studentName || '—',
                chestNumber: p.chestNumber || '—',
                teamId: p.teamId || '',
                teamName: p.teamName || ''
            });
        }
    });
    return list;
}

function renderScoringUI(prog, participants, resDoc) {
    const mainContainer = document.getElementById('jpMainContainer');
    const isGroup = prog.programType === 'group' || prog.registrationType === 'group' || prog.type === 'Group';
    
    const judgesList = resDoc && Array.isArray(resDoc.judges) ? [...resDoc.judges] : [];
    if (!judgesList.includes(currentJudge.name)) {
        judgesList.push(currentJudge.name);
    }
    const judgeIdx = judgesList.indexOf(currentJudge.name);

    const savedMarksMap = new Map();
    if (resDoc && Array.isArray(resDoc.marksData)) {
        resDoc.marksData.forEach(m => {
            const key = m.studentId || m.groupId || '';
            if (key) savedMarksMap.set(key, m);
        });
    }

    const rowsHTML = participants.map(p => {
        const saved = savedMarksMap.get(p.id) || {};
        const savedMarks = Array.isArray(saved.marks) ? saved.marks : [];
        const val = (savedMarks[judgeIdx] !== undefined && savedMarks[judgeIdx] !== null) ? savedMarks[judgeIdx] : '';

        return `
            <div class="jp-score-row" data-id="${p.id}" data-name="${window.escapeHTML(p.name)}" data-team-id="${p.teamId}" data-team-name="${window.escapeHTML(p.teamName)}">
                <div class="jp-contestant-info">
                    ${!isGroup ? `<span class="jp-chest-num">Chest #${window.escapeHTML(p.chestNumber)}</span>` : ''}
                    <div class="jp-contestant-name">${window.escapeHTML(p.name)}</div>
                    ${p.teamName ? `<div class="jp-team-name">👥 ${window.escapeHTML(p.teamName)}</div>` : ''}
                </div>
                <div class="jp-score-input-wrap">
                    <input type="number" class="jp-score-input jp-mark-input" min="0" max="100" placeholder="0" value="${val}" data-code="${window.escapeHTML(saved.codeLetter || '')}" />
                    <span style="font-size:0.68rem; color:#64748b; font-weight:600;">/ 100</span>
                </div>
            </div>
        `;
    }).join('');

    mainContainer.innerHTML = `
        <button class="jp-back-btn" id="jpBackHome">← Back to Programs List</button>

        <div style="background:#1e1b4b; color:white; border-radius:14px; padding:1.25rem; margin-bottom:1.25rem; box-shadow:0 4px 12px rgba(0,0,0,0.05);">
            <h2 style="margin:0 0 0.35rem 0; font-family:'Outfit',sans-serif; font-size:1.25rem; font-weight:800;">${prog.programNumber ? `[#${prog.programNumber}] ` : ''}${window.escapeHTML(prog.programName || prog.name)}</h2>
            <div style="font-size:0.82rem; color:rgba(255,255,255,0.8); display:flex; gap:0.75rem; flex-wrap:wrap; font-weight:600;">
                <span>📋 ${window.escapeHTML(prog.categoryName || 'General')}</span>
                <span>📍 ${window.escapeHTML(prog.programLocation || 'Stage')}</span>
                <span>👥 ${participants.length} Contestants</span>
            </div>
        </div>

        <div id="jpScoringList">
            ${rowsHTML}
        </div>

        <div class="jp-sticky-footer">
            <button class="btn btn-secondary w-full" id="jpDraftBtn" style="font-weight:700; height:48px; font-size:0.95rem; flex:1;">
                📝 Save Draft
            </button>
            <button class="btn btn-primary w-full" id="jpSubmitBtn" style="font-weight:800; height:48px; font-size:0.95rem; flex:1; background:#4338ca;">
                📤 Submit Marks
            </button>
        </div>
    `;

    document.getElementById('jpBackHome').onclick = () => renderHomeScreen();

    // Input constraints validation
    mainContainer.querySelectorAll('.jp-mark-input').forEach(input => {
        input.oninput = () => {
            let val = input.value.trim();
            if (val === '') return;
            let num = parseFloat(val);
            if (isNaN(num)) num = 0;
            if (num < 0) num = 0;
            if (num > 100) num = 100;
            input.value = num;
        };
    });

    document.getElementById('jpDraftBtn').onclick = () => saveMarks(prog, participants, judgesList, judgeIdx, resDoc, false);
    document.getElementById('jpSubmitBtn').onclick = async () => {
        const confirmed = confirm("Submit these marks? This will update the live results dashboard.");
        if (!confirmed) return;
        saveMarks(prog, participants, judgesList, judgeIdx, resDoc, true);
    };
}

// ─────────────────────────────────────────────
// Save Marks to Firestore Synchronization
// ─────────────────────────────────────────────
async function saveMarks(prog, participants, judgesList, judgeIdx, existingResDoc, isSubmit) {
    const rows = document.querySelectorAll('.jp-score-row');
    const isGroup = prog.programType === 'group' || prog.registrationType === 'group' || prog.type === 'Group';

    // Build existing marks lookup to preserve other judges' scores
    const existingMarksMap = new Map();
    if (existingResDoc && Array.isArray(existingResDoc.marksData)) {
        existingResDoc.marksData.forEach(m => {
            const key = m.studentId || m.groupId || '';
            if (key) existingMarksMap.set(key, m);
        });
    }

    const marksData = [];
    let filledCount = 0;

    const sortedRows = [];
    rows.forEach(row => {
        const id = row.getAttribute('data-id');
        const name = row.getAttribute('data-name');
        const teamId = row.getAttribute('data-team-id');
        const teamName = row.getAttribute('data-team-name');
        const input = row.querySelector('.jp-mark-input');
        const codeLetter = input.getAttribute('data-code') || '';

        const val = input.value.trim();
        const existing = existingMarksMap.get(id) || {};
        const marks = Array.isArray(existing.marks) ? [...existing.marks] : [];

        // Ensure array length covers all judges
        while (marks.length < judgesList.length) {
            marks.push(null);
        }

        if (val !== '') {
            marks[judgeIdx] = parseFloat(val) || 0;
            filledCount++;
        } else {
            marks[judgeIdx] = null;
        }

        // Calculate average finalMark across filled judge scores
        let sum = 0;
        let validJudgesCount = 0;
        marks.forEach(m => {
            if (m !== null && m !== undefined) {
                sum += m;
                validJudgesCount++;
            }
        });

        const hasScores = validJudgesCount > 0;
        const finalMark = validJudgesCount > 0 ? Number((sum / validJudgesCount).toFixed(2)) : 0;

        sortedRows.push({
            id, name, teamId, teamName, codeLetter, marks, finalMark, hasScores, rank: null
        });
    });

    // Compute ranks using dense ranking helper
    const activeRows = sortedRows.filter(r => r.hasScores);
    computeDenseRanking(activeRows, r => r.finalMark, 'rank');

    const pType = (prog.programType || prog.type || 'individual').toLowerCase();
    let classType = 'individual';
    if (pType === 'general') classType = 'general';
    else if (pType === 'group') classType = 'group';

    const config = activePointsConfig[classType] || DEFAULT_POINTS[classType];
    const positionPointsMap = {
        'First': config.first !== undefined ? Number(config.first) : 10,
        'Second': config.second !== undefined ? Number(config.second) : 8,
        'Third': config.third !== undefined ? Number(config.third) : 6,
        'Participation': 0
    };

    sortedRows.forEach(r => {
        if (r.hasScores) {
            const { grade, points: gp } = getGradeAndPoints(r.finalMark, classType);
            const posMap = { 1: 'First', 2: 'Second', 3: 'Third' };
            const position = posMap[r.rank] || '';
            const pp = positionPointsMap[position] || 0;
            const totalPoints = gp + pp;

            marksData.push({
                studentId: isGroup ? '' : r.id,
                groupId: isGroup ? r.id : '',
                studentName: r.name || '',
                teamId: r.teamId || '',
                teamName: r.teamName || '',
                codeLetter: r.codeLetter || '',
                marks: r.marks || [],
                finalMark: r.finalMark || 0,
                grade: grade || '',
                gradePoints: gp || 0,
                rank: r.rank || null,
                position: position || '',
                positionPoints: pp || 0,
                totalPoints: totalPoints || 0
            });
        } else {
            marksData.push({
                studentId: isGroup ? '' : r.id,
                groupId: isGroup ? r.id : '',
                studentName: r.name || '',
                teamId: r.teamId || '',
                teamName: r.teamName || '',
                codeLetter: r.codeLetter || '',
                marks: r.marks || [],
                finalMark: 0,
                grade: '',
                gradePoints: 0,
                rank: null,
                position: '',
                positionPoints: 0,
                totalPoints: 0
            });
        }
    });

    // Build winners array (ranks 1, 2, 3)
    const winners = [];
    const activeWinners = marksData.filter(r => r.finalMark > 0 && r.rank !== null && r.rank <= 3);
    activeWinners.sort((a, b) => a.rank - b.rank);

    activeWinners.forEach(r => {
        winners.push({
            studentId: isGroup ? '' : (r.studentId || ''),
            groupId: isGroup ? (r.groupId || '') : '',
            studentName: r.studentName || '',
            teamId: r.teamId || '',
            teamName: r.teamName || '',
            position: r.position || '',
            grade: r.grade || '',
            marks: r.totalPoints || 0,
            remarks: `Average: ${r.finalMark} (Grade Points: ${r.gradePoints} + Position Points: ${r.positionPoints})`
        });
    });

    const draftBtn = document.getElementById('jpDraftBtn');
    const submitBtn = document.getElementById('jpSubmitBtn');
    if (draftBtn) draftBtn.disabled = true;
    if (submitBtn) submitBtn.disabled = true;

    try {
        const payload = {
            programId: prog.id,
            programName: prog.programName || prog.name || '',
            programType: prog.programType || prog.type || 'individual',
            registrationType: prog.registrationType || '',
            categoryId: prog.categoryId || '',
            categoryName: prog.categoryName || '',
            classId: prog.classId || '',
            className: prog.className || '',
            genderCategory: prog.genderCategory || '',
            programLocation: prog.programLocation || '',
            participantCount: participants.length,
            judges: judgesList,
            marksData,
            winners,
            status: existingResDoc?.status || 'draft',
            markEntryStatus: isSubmit ? 'submitted' : 'in-progress',
            updatedAt: serverTimestamp()
        };

        const resultsRef = collection(db, "institutes", currentInstituteId, "results");
        if (existingResDoc) {
            if (existingResDoc.publishedAt) payload.publishedAt = existingResDoc.publishedAt;
            if (existingResDoc.status === 'published') payload.status = 'published';
            await setDoc(doc(resultsRef, existingResDoc.id), payload, { merge: true });
        } else {
            payload.createdAt = serverTimestamp();
            await setDoc(doc(resultsRef, `result_${prog.id}`), payload);
        }

        window.showToast(isSubmit ? "📤 Marks submitted successfully!" : "📝 Draft saved successfully!", "success");
        setTimeout(() => renderHomeScreen(), 600);
    } catch (e) {
        console.error("Failed to save judge scores:", e);
        window.showToast("Failed to save marks.", "error");
    } finally {
        if (draftBtn) draftBtn.disabled = false;
        if (submitBtn) submitBtn.disabled = false;
    }
}
