import { db } from './firebase.js';
import {
    collection, addDoc, doc, deleteDoc, onSnapshot,
    serverTimestamp, getDocs, query, orderBy
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// ─────────────────────────────────────────────
// Marks System
// ─────────────────────────────────────────────
const POSITION_MARKS = { First: 10, Second: 6, Third: 3, Participation: 0 };
const GRADE_BONUS = { A: 5, B: 3, C: 1 };
const MEDALS = { First: '🥇', Second: '🥈', Third: '🥉', Participation: '🎖' };

function calcMarks(position, grade) {
    return (POSITION_MARKS[position] ?? 0) + (GRADE_BONUS[grade] ?? 0);
}

// ─────────────────────────────────────────────
// Module-level state
// ─────────────────────────────────────────────
let unsubscribeResults = null;
let allPrograms = [];   // { id, programName, type, genderCategory, programLocation, teamId, teamName, categoryId, categoryName }
let programsLoaded = false;

// ─────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────
export function initResultsView(container, topActions) {
    if (unsubscribeResults) unsubscribeResults();
    programsLoaded = false;
    allPrograms = [];

    topActions.innerHTML = `
        <button class="btn btn-primary" id="btnPublishResult">🏆 Enter Result</button>
    `;

    container.innerHTML = `
        <div class="grid" id="resultsGrid">
            <div class="loader-container"><div class="spinner"></div></div>
        </div>
    `;

    document.getElementById('btnPublishResult').addEventListener('click', openJudgingModal);
    loadResultsData();
}

// ─────────────────────────────────────────────
// Published Results — List View
// ─────────────────────────────────────────────
function loadResultsData() {
    const q = query(
        collection(db, "institutes", window.currentInstituteId, "results"),
        orderBy('publishedAt', 'desc')
    );

    unsubscribeResults = onSnapshot(q, (snapshot) => {
        const grid = document.getElementById('resultsGrid');
        if (!grid) return;
        grid.innerHTML = '';

        if (snapshot.empty) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column:1/-1; margin-top:2rem;">
                    <div class="empty-state-icon">🏆</div>
                    <h3>No Results Yet</h3>
                    <p>Click "Enter Result" to publish the first result.</p>
                </div>`;
            return;
        }

        snapshot.forEach(docSnap => {
            const r = docSnap.data();
            const winners = r.winners || [];
            const date = r.publishedAt?.toDate?.()
                ? r.publishedAt.toDate().toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
                : '—';

            const winnersHTML = winners.map(w => {
                const medal = MEDALS[w.position] || '🏅';
                const gradeTag = w.grade ? `<span style="background:#e0e7ff;color:#4338ca;border-radius:4px;padding:0 5px;font-size:0.7rem;font-weight:700;margin-left:4px;">${w.grade}</span>` : '';
                const marksTag = (w.marks != null) ? `<span style="font-size:0.7rem;color:#64748b;margin-left:4px;">${w.marks}pts</span>` : '';
                return `
                    <div style="display:flex;align-items:center;gap:0.5rem;padding:0.45rem 0.6rem;border-radius:8px;margin-bottom:0.3rem;background:#f8fafc;border:1px solid #e2e8f0;">
                        <span style="font-size:1.1rem;">${medal}</span>
                        <span style="font-weight:600;color:#1e293b;font-size:0.875rem;">${window.escapeHTML(w.studentName)}</span>
                        ${gradeTag}${marksTag}
                    </div>`;
            }).join('');

            const isDraft = r.status === 'draft';
            const statusBadge = isDraft 
                ? '<span class="badge" style="font-size:0.72rem; background:#fef3c7; color:#d97706;">Draft</span>' 
                : '<span class="badge" style="font-size:0.72rem; background:#dcfce7; color:#15803d;">Published</span>';

            const card = document.createElement('div');
            card.className = 'card';
            card.innerHTML = `
                <div class="card-header">
                    <div style="display:flex; align-items:center; gap:0.5rem;">
                        <h3 class="card-title" style="font-size:1rem; margin:0;">${window.escapeHTML(r.programName)}</h3>
                        ${statusBadge}
                    </div>
                    <span class="badge badge-active" style="font-size:0.72rem;">${window.escapeHTML(r.categoryName || '—')}</span>
                </div>
                <div class="card-body" style="padding-top:0.25rem;">
                    <p style="font-size:0.72rem;color:#94a3b8;margin-bottom:0.6rem;">
                        ${window.escapeHTML(r.teamName || '—')} · ${isDraft ? 'Not Published' : date}
                    </p>
                    ${winnersHTML || '<p class="text-muted" style="font-size:0.8rem;">No winners.</p>'}
                </div>
                <div class="card-actions">
                    ${isDraft ? `<button class="btn btn-primary btn-sm btn-publish-draft" data-id="${docSnap.id}">🏆 Publish</button>` : ''}
                    <button class="btn btn-danger btn-sm btn-revoke" data-id="${docSnap.id}">🗑 Revoke</button>
                </div>
            `;
            grid.appendChild(card);
        });

        document.querySelectorAll('.btn-publish-draft').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.target.getAttribute('data-id');
                if (!confirm("Publish this result to the public portal?")) return;
                try {
                    await updateDoc(doc(db, "institutes", window.currentInstituteId, "results", id), {
                        status: 'published',
                        publishedAt: serverTimestamp()
                    });
                    window.showToast("Result published successfully!");
                } catch (err) {
                    window.showToast("Failed to publish.", "error");
                }
            });
        });

        document.querySelectorAll('.btn-revoke').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.target.getAttribute('data-id');
                if (!confirm("Revoke this result? It will be removed from the public view.")) return;
                try {
                    await deleteDoc(doc(db, "institutes", window.currentInstituteId, "results", id));
                    window.showToast("Result revoked.");
                } catch (err) {
                    window.showToast("Failed to revoke.", "error");
                }
            });
        });

    }, (err) => {
        console.error("Results listener error:", err);
        window.showToast("Error loading results.", "error");
    });
}

// ─────────────────────────────────────────────
// Load All Programs (global programs)
// ─────────────────────────────────────────────
async function loadAllPrograms() {
    if (programsLoaded) return;

    allPrograms = [];
    
    try {
        const progsSnap = await getDocs(
            collection(db, "institutes", window.currentInstituteId, "programs")
        );

        progsSnap.forEach(progDoc => {
            const p = progDoc.data();
            const pType = (p.programType || p.type || 'individual').toLowerCase();
            allPrograms.push({
                id: progDoc.id,
                programName: p.programName || '',
                programType: pType,
                type: pType === 'group' ? 'Group' : 'Individual', // For backward compatibility
                genderCategory: p.genderCategory || 'Mixed',
                programLocation: p.programLocation || 'Stage',
                groupSize: p.maxParticipants || p.groupSize || 1,
                teamId: '',
                teamName: '', 
                categoryId: p.categoryId || '',
                categoryName: p.categoryId || '' 
            });
        });

        programsLoaded = true;
    } catch (err) {
        console.error("Error loading programs:", err);
        throw err;
    }
}

// ─────────────────────────────────────────────
// Load Participants from programs/{progId}/participants
// ─────────────────────────────────────────────
async function loadStudentsForProgram(prog) {
    const snap = await getDocs(
        collection(
            db,
            "institutes", window.currentInstituteId,
            "programs", prog.id,
            "participants"
        )
    );

    const isGroup = prog.programType === 'group';

    return snap.docs.map(d => {
        const p = d.data();
        if (isGroup) {
            return {
                id: p.teamId || d.id, // ID is the teamId for groups
                name: p.teamName || 'Team',
                chestNumber: 'GROUP',
                isGroupEntry: true,
                teamId: p.teamId,
                teamName: p.teamName
            };
        } else {
            return {
                id: p.studentId || d.id,
                name: p.studentName || '—',
                chestNumber: p.chestNumber || '',
                teamId: p.teamId,
                teamName: p.teamName
            };
        }
    });
}

// ─────────────────────────────────────────────
// Main Judging Modal
// ─────────────────────────────────────────────
async function openJudgingModal() {
    const modal = document.getElementById('dynamicModal');
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');

    modalTitle.textContent = '🏆 Enter Result';
    modalBody.innerHTML = `<div style="text-align:center;padding:2rem;"><div class="spinner"></div><p style="margin-top:0.75rem;color:#64748b;font-size:0.875rem;">Loading programs…</p></div>`;
    modal.classList.remove('hidden');
    document.getElementById('closeDynamicModalBtn').onclick = () => modal.classList.add('hidden');

    try {
        await loadAllPrograms();
    } catch (err) {
        modalBody.innerHTML = `<p style="color:#ef4444;text-align:center;padding:2rem;">Failed to load programs. Please try again.</p>`;
        return;
    }

    renderJudgingUI(modalBody, modal);
}

function renderJudgingUI(modalBody, modal) {
    // ── Active filter state ────────────────────
    let filterGender = '';
    let filterLocation = '';
    let filterType = '';
    let selectedProg = null;   // full program object
    let participants = [];     // loaded students

    const chipStyle = (active) =>
        active
            ? 'display:inline-flex;align-items:center;gap:0.25rem;padding:0.3rem 0.8rem;border-radius:999px;font-size:0.78rem;font-weight:700;cursor:pointer;border:none;background:#4338ca;color:#fff;transition:all 0.15s;'
            : 'display:inline-flex;align-items:center;gap:0.25rem;padding:0.3rem 0.8rem;border-radius:999px;font-size:0.78rem;font-weight:600;cursor:pointer;border:1px solid #e2e8f0;background:#f8fafc;color:#475569;transition:all 0.15s;';

    // ── Full modal layout ──────────────────────
    modalBody.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:1rem;">

            <!-- Filters -->
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:0.85rem;">
                <p style="font-size:0.72rem;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.6rem;">FILTER PROGRAMS</p>
                <div style="display:flex;flex-wrap:wrap;gap:0.6rem;align-items:center;">

                    <div style="display:flex;flex-wrap:wrap;gap:0.3rem;">
                        <span style="font-size:0.72rem;color:#64748b;align-self:center;margin-right:0.15rem;">Gender:</span>
                        <button class="chip-filter" data-group="gender" data-val="" style="${chipStyle(!filterGender)}">All</button>
                        <button class="chip-filter" data-group="gender" data-val="Boys" style="${chipStyle(false)}">👦 Boys</button>
                        <button class="chip-filter" data-group="gender" data-val="Girls" style="${chipStyle(false)}">👧 Girls</button>
                        <button class="chip-filter" data-group="gender" data-val="Mixed" style="${chipStyle(false)}">👫 Mixed</button>
                    </div>

                    <div style="display:flex;flex-wrap:wrap;gap:0.3rem;">
                        <span style="font-size:0.72rem;color:#64748b;align-self:center;margin-right:0.15rem;">Location:</span>
                        <button class="chip-filter" data-group="location" data-val="" style="${chipStyle(!filterLocation)}">All</button>
                        <button class="chip-filter" data-group="location" data-val="Stage" style="${chipStyle(false)}">🎭 Stage</button>
                        <button class="chip-filter" data-group="location" data-val="Off Stage" style="${chipStyle(false)}">📴 Off Stage</button>
                    </div>

                    <div style="display:flex;flex-wrap:wrap;gap:0.3rem;">
                        <span style="font-size:0.72rem;color:#64748b;align-self:center;margin-right:0.15rem;">Type:</span>
                        <button class="chip-filter" data-group="type" data-val="" style="${chipStyle(!filterType)}">All</button>
                        <button class="chip-filter" data-group="type" data-val="Individual" style="${chipStyle(false)}">👤 Individual</button>
                        <button class="chip-filter" data-group="type" data-val="Group" style="${chipStyle(false)}">👥 Group</button>
                    </div>

                </div>
            </div>

            <!-- Program Select -->
            <div class="form-group" style="margin:0;">
                <label class="form-label">Select Program *</label>
                <select id="jProgramSelect" class="form-input">
                    <option value="">— Choose a Program —</option>
                </select>
                <div id="jProgInfo" style="display:none; margin-top:0.5rem; font-size:0.78rem; color:#64748b; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:0.45rem 0.75rem;"></div>
            </div>

            <!-- Winners Section (hidden until program is selected) -->
            <div id="jWinnersSection" style="display:none; flex-direction:column; gap:0.75rem;">

                <div style="background:#fffbea;border:1px solid #fef08a;border-radius:10px;padding:0.65rem 0.85rem;font-size:0.78rem;color:#854d0e;">
                    📊 <strong>Auto Marks:</strong> 🥇 First = 10 &bull; 🥈 Second = 6 &bull; 🥉 Third = 3
                    &nbsp;&nbsp;|&nbsp;&nbsp; A Grade +5 &bull; B Grade +3 &bull; C Grade +1
                </div>

                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <h4 style="font-size:0.9375rem;font-weight:700;color:#1e293b;margin:0;">🏅 Winners</h4>
                    <button type="button" class="btn btn-secondary btn-sm" id="jAddWinnerBtn">+ Add Winner</button>
                </div>

                <div id="jWinnersContainer" style="display:flex;flex-direction:column;gap:0.65rem;"></div>

                <div class="modal-actions" style="margin-top:0.25rem; flex-wrap:wrap;">
                    <button type="button" class="btn btn-secondary" id="jCancelBtn">Cancel</button>
                    <div style="display:flex; gap:0.5rem; margin-left:auto;">
                        <button type="button" class="btn btn-secondary" id="jDraftBtn">
                            <span class="btn-text">📝 Save as Draft</span>
                            <span class="btn-spinner hidden"></span>
                        </button>
                        <button type="button" class="btn btn-primary" id="jPublishBtn">
                            <span class="btn-text">🏆 Publish Result</span>
                            <span class="btn-spinner hidden"></span>
                        </button>
                    </div>
                </div>
            </div>

        </div>
    `;

    // ── Populate program dropdown ────────────────
    function populateProgramDropdown() {
        const sel = document.getElementById('jProgramSelect');
        const filtered = allPrograms.filter(p => {
            if (filterGender && p.genderCategory !== filterGender) return false;
            if (filterLocation && p.programLocation !== filterLocation) return false;
            if (filterType && p.type !== filterType) return false;
            return true;
        });

        let opts = `<option value="">— Choose a Program (${filtered.length} found) —</option>`;
        filtered.forEach(p => {
            opts += `<option value="${p.id}-|-${p.teamId}-|-${p.categoryId}">${window.escapeHTML(p.programName)} [${window.escapeHTML(p.categoryName)}]</option>`;
        });
        sel.innerHTML = opts;

        // Reset program state
        selectedProg = null;
        participants = [];
        document.getElementById('jProgInfo').style.display = 'none';
        document.getElementById('jWinnersSection').style.display = 'none';
        document.getElementById('jWinnersContainer').innerHTML = '';
    }

    populateProgramDropdown();

    // ── Filter chip clicks ──────────────────────
    document.querySelectorAll('.chip-filter').forEach(chip => {
        chip.addEventListener('click', () => {
            const group = chip.dataset.group;
            const val = chip.dataset.val;

            if (group === 'gender') filterGender = val;
            if (group === 'location') filterLocation = val;
            if (group === 'type') filterType = val;

            // Restyle all chips in that group
            document.querySelectorAll(`.chip-filter[data-group="${group}"]`).forEach(c => {
                c.style.cssText = chipStyle(c.dataset.val === val);
            });

            populateProgramDropdown();
        });
    });

    // ── Program selected ────────────────────────
    document.getElementById('jProgramSelect').addEventListener('change', async (e) => {
        const val = e.target.value;
        const infoBox = document.getElementById('jProgInfo');
        const winnersSection = document.getElementById('jWinnersSection');
        const winnersCont = document.getElementById('jWinnersContainer');

        infoBox.style.display = 'none';
        winnersSection.style.display = 'none';
        winnersCont.innerHTML = '';
        selectedProg = null;
        participants = [];

        if (!val) return;

        // Parse compound key: id-|-teamId-|-categoryId
        const [progId, teamId, categoryId] = val.split('-|-');
        selectedProg = allPrograms.find(p => p.id === progId && p.teamId === teamId && p.categoryId === categoryId);
        if (!selectedProg) return;

        // Show program info badge bar
        const genderColors = { Boys: '#dbeafe|#1d4ed8', Girls: '#fce7f3|#be185d', Mixed: '#dcfce7|#15803d' };
        const locColors = { Stage: '#dbeafe|#1d4ed8', 'Off Stage': '#fce7f3|#be185d' };
        const badge = (txt, map) => {
            const [bg, col] = (map[txt] || '#f1f5f9|#475569').split('|');
            return `<span style="background:${bg};color:${col};border-radius:999px;padding:0.15rem 0.6rem;font-size:0.72rem;font-weight:700;">${txt}</span>`;
        };
        const sizeInfo = selectedProg.type === 'Group'
            ? `&nbsp;· max <strong>${selectedProg.groupSize}</strong> participants`
            : '';

        infoBox.innerHTML = `
            📋 <strong>${window.escapeHTML(selectedProg.categoryName)}</strong>
            &nbsp;${badge(selectedProg.genderCategory, genderColors)}
            ${badge(selectedProg.programLocation, locColors)}
            ${badge(selectedProg.type, {})}
            ${sizeInfo}
        `;
        infoBox.style.display = 'block';

        // Load participants from subcollection
        try {
            infoBox.innerHTML += ' &nbsp;<em style="color:#94a3b8;">Loading participants…</em>';
            participants = await loadStudentsForProgram(selectedProg);
            infoBox.innerHTML = infoBox.innerHTML.replace(/ &nbsp;<em.*<\/em>/, '');

            if (participants.length === 0) {
                infoBox.innerHTML += `
                    &nbsp;
                    <span style="background:#fef3c7;color:#92400e;border-radius:6px;padding:0.15rem 0.6rem;font-size:0.72rem;font-weight:700;">
                        ⚠️ No participants assigned
                    </span>`;
                // Show a helper notice instead of the winner section
                const notice = document.createElement('div');
                notice.style.cssText = 'background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:0.85rem;font-size:0.82rem;color:#9a3412;text-align:center;';
                notice.innerHTML = `
                    <strong>⚠️ No participants assigned to this program.</strong><br>
                    <span style="font-size:0.78rem;color:#c2410c;">
                        Go to <strong>Programs</strong> → click <strong>👥 Participants</strong> on this program to assign students first.
                    </span>`;
                winnersSection.style.display = 'none';
                infoBox.parentNode.insertBefore(notice, winnersSection);
                return;
            }

            infoBox.innerHTML += `&nbsp;· <strong>${participants.length}</strong> participant${participants.length !== 1 ? 's' : ''} loaded`;
        } catch (err) {
            console.error("Error loading participants:", err);
            participants = [];
        }

        // Show winners section & seed 3 rows
        winnersSection.style.display = 'flex';
        addWinnerRow({ position: 'First' });
        addWinnerRow({ position: 'Second' });
        addWinnerRow({ position: 'Third' });
    });

    // ── Winner row builder ──────────────────────
    let winnerCount = 0;

    function buildParticipantOptions(selectedId = '') {
        const isGroup = selectedProg && selectedProg.programType === 'group';
        const label = isGroup ? "— Select Team —" : "— Select Participant —";
        
        if (participants.length === 0) {
            return `<option value="">Type name manually</option>`;
        }
        let opts = `<option value="">${label}</option>`;
        participants.forEach(s => {
            const display = isGroup ? s.name : `${s.name} (#${s.chestNumber || ''})`;
            opts += `<option value="${s.id}" data-name="${window.escapeHTML(s.name)}" ${s.id === selectedId ? 'selected' : ''}>${window.escapeHTML(display)}</option>`;
        });
        opts += `<option value="__manual__">✏️ Enter manually…</option>`;
        return opts;
    }

    function addWinnerRow(prefill = {}) {
        winnerCount++;
        const rowId = `wrow_${winnerCount}`;
        const cont = document.getElementById('jWinnersContainer');
        const row = document.createElement('div');
        row.id = rowId;
        row.className = 'winner-builder-row';
        row.style.cssText = 'background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:0.85rem;position:relative;';

        const initPos = prefill.position || '';
        const initGrade = prefill.grade || '';
        const initMarks = prefill.marks != null ? prefill.marks : calcMarks(initPos, initGrade);

        row.innerHTML = `
            <button type="button" class="remove-winner-btn"
                style="position:absolute;top:0.5rem;right:0.5rem;background:none;border:none;color:#ef4444;cursor:pointer;font-size:1rem;line-height:1;">✕</button>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.5rem;">
                <!-- Position -->
                <div>
                    <label style="font-size:0.72rem;font-weight:600;color:#64748b;display:block;margin-bottom:0.25rem;">Position *</label>
                    <select class="form-input jr-position" style="font-size:0.85rem;padding:0.4rem 0.5rem;">
                        <option value="">— Select —</option>
                        <option value="First"         ${initPos === 'First' ? 'selected' : ''}>🥇 First</option>
                        <option value="Second"        ${initPos === 'Second' ? 'selected' : ''}>🥈 Second</option>
                        <option value="Third"         ${initPos === 'Third' ? 'selected' : ''}>🥉 Third</option>
                        <option value="Participation" ${initPos === 'Participation' ? 'selected' : ''}>🎖 Participation</option>
                    </select>
                </div>
                <!-- Grade -->
                <div>
                    <label style="font-size:0.72rem;font-weight:600;color:#64748b;display:block;margin-bottom:0.25rem;">Grade (Optional)</label>
                    <select class="form-input jr-grade" style="font-size:0.85rem;padding:0.4rem 0.5rem;">
                        <option value="">— None —</option>
                        <option value="A" ${initGrade === 'A' ? 'selected' : ''}>A Grade (+5)</option>
                        <option value="B" ${initGrade === 'B' ? 'selected' : ''}>B Grade (+3)</option>
                        <option value="C" ${initGrade === 'C' ? 'selected' : ''}>C Grade (+1)</option>
                    </select>
                </div>
            </div>

            <!-- Participant / Team selector -->
            <div style="margin-bottom:0.5rem;">
                <label style="font-size:0.72rem;font-weight:600;color:#64748b;display:block;margin-bottom:0.25rem;">${selectedProg && selectedProg.programType === 'group' ? 'Team *' : 'Participant *'}</label>
                <select class="form-input jr-student-select" style="font-size:0.85rem;padding:0.4rem 0.5rem;">
                    ${buildParticipantOptions()}
                </select>
                <input type="text" class="form-input jr-student-name" placeholder="${selectedProg && selectedProg.programType === 'group' ? 'Team name' : 'Student name'}"
                    style="font-size:0.85rem;padding:0.4rem 0.5rem;margin-top:0.35rem;display:${participants.length === 0 ? 'block' : 'none'};"
                    value="${window.escapeHTML(prefill.studentName || '')}">
            </div>

            <!-- Auto marks display -->
            <div style="display:flex;align-items:center;justify-content:space-between;">
                <div class="marks-display" style="font-size:0.78rem;color:#4338ca;font-weight:700;background:#e0e7ff;border-radius:6px;padding:0.25rem 0.65rem;">
                    📊 ${initMarks > 0 ? initMarks + ' pts' : '0 pts'}
                </div>
                <div>
                    <label style="font-size:0.72rem;font-weight:600;color:#64748b;margin-right:0.3rem;">Override marks:</label>
                    <input type="number" class="form-input jr-marks-override"
                        min="0" max="1000" placeholder="auto"
                        style="width:80px;font-size:0.82rem;padding:0.3rem 0.5rem;display:inline-block;"
                        value="">
                </div>
            </div>
        `;

        // Auto-calc marks when position/grade changes
        function updateMarksDisplay() {
            const pos = row.querySelector('.jr-position').value;
            const grade = row.querySelector('.jr-grade').value;
            const m = calcMarks(pos, grade);
            row.querySelector('.marks-display').textContent = `📊 ${m} pts`;
        }
        row.querySelector('.jr-position').addEventListener('change', updateMarksDisplay);
        row.querySelector('.jr-grade').addEventListener('change', updateMarksDisplay);

        // Participant select → show/hide manual name input
        const stuSel = row.querySelector('.jr-student-select');
        const stuName = row.querySelector('.jr-student-name');
        stuSel.addEventListener('change', () => {
            if (stuSel.value === '__manual__') {
                stuName.style.display = 'block';
                stuName.focus();
            } else if (stuSel.value) {
                const opt = stuSel.options[stuSel.selectedIndex];
                stuName.value = opt.dataset.name || '';
                stuName.style.display = 'none';
            } else {
                stuName.style.display = participants.length === 0 ? 'block' : 'none';
                stuName.value = '';
            }
        });

        row.querySelector('.remove-winner-btn').addEventListener('click', () => row.remove());
        cont.appendChild(row);
    }

    document.getElementById('jAddWinnerBtn').addEventListener('click', () => addWinnerRow());
    document.getElementById('jCancelBtn').addEventListener('click', () => modal.classList.add('hidden'));

    // ── Publish ─────────────────────────────────
    document.getElementById('jPublishBtn').addEventListener('click', () => saveResult(false));
    document.getElementById('jDraftBtn').addEventListener('click', () => saveResult(true));

    async function saveResult(isDraft) {
        if (!selectedProg) {
            window.showToast("Please select a program first.", "error");
            return;
        }

        const rows = document.querySelectorAll('.winner-builder-row');
        const winners = [];
        let hasError = false;

        rows.forEach((row, idx) => {
            const position = row.querySelector('.jr-position').value;
            const grade = row.querySelector('.jr-grade').value || null;
            const stuSel = row.querySelector('.jr-student-select');
            const stuName = row.querySelector('.jr-student-name');

            let studentId = '';
            let studentName = '';
            let teamId = '';
            let teamName = '';

            const isGroup = selectedProg.programType === 'group';

            if (stuSel.value && stuSel.value !== '__manual__') {
                const pInfo = participants.find(p => p.id === stuSel.value);
                if (pInfo) {
                    if (isGroup) {
                        teamId = pInfo.teamId;
                        teamName = pInfo.teamName;
                        // Map team name to studentName for UI compatibility in public view
                        studentName = pInfo.teamName;
                    } else {
                        studentId = pInfo.id;
                        studentName = pInfo.name;
                        teamId = pInfo.teamId;
                        teamName = pInfo.teamName;
                    }
                }
            } else {
                studentName = stuName.value.trim();
                if (isGroup) teamName = studentName;
            }

            if (!position) {
                window.showToast(`Row ${idx + 1}: Please select a position.`, "error");
                hasError = true;
                return;
            }
            if (!studentName) {
                window.showToast(`Row ${idx + 1}: Please enter or select a ${isGroup ? 'team' : 'student'}.`, "error");
                hasError = true;
                return;
            }

            const overrideInput = row.querySelector('.jr-marks-override').value.trim();
            const marks = overrideInput !== '' ? parseFloat(overrideInput) : calcMarks(position, grade);

            if (isGroup) {
                winners.push({ teamId, teamName, studentName, position, grade, marks }); // studentName kept for backward compatibility in public portal UI
            } else {
                winners.push({ studentId, studentName, teamId, teamName, position, grade, marks });
            }
        });

        if (hasError) return;
        if (winners.length === 0) {
            window.showToast("Add at least one winner before saving.", "error");
            return;
        }

        const btn = isDraft ? document.getElementById('jDraftBtn') : document.getElementById('jPublishBtn');
        const text = btn.querySelector('.btn-text');
        const spinner = btn.querySelector('.btn-spinner');
        btn.disabled = true;
        text.classList.add('hidden');
        spinner.classList.remove('hidden');

        try {
            await addDoc(
                collection(db, "institutes", window.currentInstituteId, "results"),
                {
                    programId: selectedProg.id,
                    programName: selectedProg.programName,
                    categoryId: selectedProg.categoryId,
                    categoryName: selectedProg.categoryName,
                    teamId: selectedProg.teamId,
                    teamName: selectedProg.teamName,
                    winners,
                    status: isDraft ? 'draft' : 'published',
                    publishedAt: isDraft ? null : serverTimestamp()
                }
            );
            window.showToast(isDraft ? "📝 Result saved as draft." : "✅ Result published successfully!");
            modal.classList.add('hidden');
        } catch (err) {
            console.error("Publish error:", err);
            window.showToast("Failed to save result. Please try again.", "error");
        } finally {
            btn.disabled = false;
            text.classList.remove('hidden');
            spinner.classList.add('hidden');
        }
    }
}
