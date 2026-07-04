import { db, getCachedCategories } from './firebase.js';
import {
    collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc,
    writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// ─────────────────────────────────────────────
// Module State & Real-time Subscriptions
// ─────────────────────────────────────────────
let unsubPrograms = null;
let unsubSchedules = null;
let unsubStages = null;

let localPrograms = [];
let localSchedules = [];
let localStages = [];
let mergedSchedules = [];

let activeStage = '';
let selectedScheduleIds = new Set();

// Per-stage configuration cache (stored in memory / synced)
let stageConfigs = {}; // { stageName: { date: '2026-08-15', startTime: '09:00', defaultDuration: 20 } }

// ─────────────────────────────────────────────
// CSS Injection for Minimalist Table Workflow
// ─────────────────────────────────────────────
function injectTableScheduleStyles() {
    if (document.getElementById('sched-table-styles')) return;

    const style = document.createElement('style');
    style.id = 'sched-table-styles';
    style.innerHTML = `
        /* Stage Tabs Bar */
        .sched-tabs-container {
            display: flex;
            gap: 0.5rem;
            overflow-x: auto;
            padding-bottom: 0.5rem;
            margin-bottom: 1.25rem;
            border-bottom: 2px solid #e2e8f0;
            width: 100%;
            box-sizing: border-box;
            -webkit-overflow-scrolling: touch;
        }
        .sched-tab-btn {
            background: #f8fafc;
            border: 1px solid #cbd5e1;
            color: #475569;
            padding: 0.65rem 1.15rem;
            border-radius: 12px 12px 0 0;
            font-size: 0.875rem;
            font-weight: 700;
            cursor: pointer;
            white-space: nowrap;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            gap: 0.4rem;
        }
        .sched-tab-btn:hover {
            background: #f1f5f9;
            color: #0f172a;
        }
        .sched-tab-btn.active {
            background: #ffffff;
            border-color: #4338ca;
            border-bottom: 3px solid #4338ca;
            color: #4338ca;
            box-shadow: 0 -2px 6px rgba(0,0,0,0.03);
        }

        /* Top Stage Setup Bar */
        .sched-config-bar {
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 14px;
            padding: 1rem 1.25rem;
            margin-bottom: 1.25rem;
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 1rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.02);
        }
        .sched-config-inputs {
            display: flex;
            align-items: center;
            gap: 1rem;
            flex-wrap: wrap;
        }
        .sched-config-group {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.85rem;
            font-weight: 700;
            color: #334155;
        }

        /* Compact Table Styles */
        .sched-table-wrapper {
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 2px 5px rgba(0,0,0,0.03);
            width: 100%;
            box-sizing: border-box;
        }
        .sched-compact-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.875rem;
            text-align: left;
        }
        .sched-compact-table th {
            background: #f8fafc;
            color: #475569;
            font-weight: 800;
            padding: 0.75rem 0.85rem;
            border-bottom: 2px solid #cbd5e1;
            text-transform: uppercase;
            font-size: 0.72rem;
            letter-spacing: 0.05em;
            position: sticky;
            top: 0;
            z-index: 10;
        }
        .sched-compact-table td {
            padding: 0.6rem 0.85rem;
            border-bottom: 1px solid #e2e8f0;
            vertical-align: middle;
            color: #1e293b;
        }
        .sched-table-row {
            transition: background 0.15s;
        }
        .sched-table-row:hover {
            background: #f8fafc;
        }
        .sched-table-row.dragging {
            opacity: 0.4;
            background: #f1f5f9;
        }
        .sched-table-row.is-locked {
            background: #fffbeb;
        }

        /* Table Inputs */
        .sched-tbl-input {
            width: 100%;
            padding: 0.4rem 0.6rem;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            font-size: 0.85rem;
            font-family: inherit;
            font-weight: 600;
            color: #0f172a;
            background: #ffffff;
            outline: none;
        }
        .sched-tbl-input:focus {
            border-color: #4338ca;
            box-shadow: 0 0 0 2px rgba(67, 56, 202, 0.1);
        }
        .sched-tbl-select {
            padding: 0.4rem 0.6rem;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            font-size: 0.825rem;
            font-weight: 700;
            outline: none;
            cursor: pointer;
            background: #ffffff;
        }

        /* Action Buttons */
        .sched-row-actions {
            display: inline-flex;
            gap: 0.25rem;
            align-items: center;
        }
        .btn-tbl-act {
            background: transparent;
            border: none;
            cursor: pointer;
            padding: 0.3rem 0.45rem;
            border-radius: 6px;
            font-size: 0.85rem;
            color: #64748b;
            transition: all 0.15s;
        }
        .btn-tbl-act:hover {
            background: #e2e8f0;
            color: #0f172a;
        }

        /* Bulk Bar */
        .sched-bulk-bar {
            background: #e0e7ff;
            border: 1px solid #c7d2fe;
            color: #3730a3;
            border-radius: 12px;
            padding: 0.75rem 1.25rem;
            margin-bottom: 1rem;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 1rem;
            flex-wrap: wrap;
        }

        @media print {
            body * { visibility: hidden !important; }
            #printableStageTable, #printableStageTable * { visibility: visible !important; }
            #printableStageTable { position: absolute; left: 0; top: 0; width: 100% !important; margin: 0 !important; padding: 0 !important; border: none !important; box-shadow: none !important; }
            .sched-tabs-container, .sched-config-bar, .topbar, .sidebar, .bottom-nav, .sched-bulk-bar, .modal-overlay, #settingsWarningModal { display: none !important; }
            
            /* Hide non-printable table columns and icons */
            .sched-compact-table th:first-child, .sched-compact-table td:first-child { display: none !important; }
            .sched-compact-table th:last-child, .sched-compact-table td:last-child { display: none !important; }
            .sched-lock-btn, .btn-tbl-act, .sched-row-actions { display: none !important; }
            
            /* Clean form elements formatting for print */
            .sched-tbl-input, .sched-tbl-select { border: none !important; background: transparent !important; appearance: none !important; font-weight: bold !important; padding: 0 !important; text-align: center; }
            .sched-compact-table { border: 2px solid #0f172a !important; width: 100% !important; }
            .sched-compact-table th, .sched-compact-table td { border: 1px solid #64748b !important; color: #000 !important; }
        }
    `;
    document.head.appendChild(style);
}

// ─────────────────────────────────────────────
// Init View
// ─────────────────────────────────────────────
export async function initScheduleView(container, topActions) {
    if (!window.currentInstituteId) {
        container.innerHTML = '<div class="empty-state"><h3>Access Denied</h3><p>Please log in again.</p></div>';
        return;
    }

    injectTableScheduleStyles();

    if (unsubPrograms) unsubPrograms();
    if (unsubSchedules) unsubSchedules();
    if (unsubStages) unsubStages();
    selectedScheduleIds.clear();

    // Render Top Actions specifically for currently active Stage
    topActions.innerHTML = `
        <div style="display:inline-flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
            <button class="btn btn-primary" id="btnCreateStageTop" style="font-weight:700;">
                🎪 + Create Stage
            </button>
            <button class="btn btn-secondary" id="btnPrintStage" style="font-weight:700;">
                🖨️ Print 
            </button>
          
            <button class="btn btn-secondary" id="btnShareStage" style="font-weight:700;">
                💬 Share
            </button>
        </div>
    `;

    container.innerHTML = `
        <div style="display:flex; flex-direction:column; width:100%; box-sizing:border-box;">
            <!-- Stage Navigation Tabs -->
            <div class="sched-tabs-container" id="schedTabsBar">
                <!-- Injected dynamically -->
            </div>

            <!-- Top Stage Config & Action Bar -->
            <div class="sched-config-bar" id="schedConfigBar">
                <!-- Injected dynamically -->
            </div>

            <!-- Bulk Actions Bar -->
            <div class="sched-bulk-bar hidden" id="schedBulkBar">
                <div style="display:flex; align-items:center; gap:0.75rem;">
                    <input type="checkbox" id="chkSelectAllRows" style="width:1.2rem; height:1.2rem; cursor:pointer;">
                    <span style="font-weight:800; font-size:0.875rem;" id="lblSelectedCount">0 Selected</span>
                </div>
                <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                    <button class="btn btn-secondary btn-sm" id="btnBulkDuration">⏳ Duration</button>
                    <button class="btn btn-secondary btn-sm" id="btnBulkStatus">🚦 Status</button>
                    <button class="btn btn-secondary btn-sm" id="btnBulkMove">🎪 Move Stage</button>
                    <button class="btn btn-secondary btn-sm text-danger" id="btnBulkDelete">🗑️ Delete</button>
                </div>
            </div>

            <!-- Printable Main Table Wrapper -->
            <div class="sched-table-wrapper" id="printableStageTable">
                <table class="sched-compact-table">
                    <thead>
                        <tr>
                            <th style="width:40px; text-align:center;"><input type="checkbox" id="chkHeaderAll" style="cursor:pointer;"></th>
                            <th style="width:60px; text-align:center;">Order</th>
                            <th>Program Name</th>
                            <th style="width:110px;">Duration</th>
                            <th style="width:100px;">Start</th>
                            <th style="width:100px;">End</th>
                            <th style="width:140px;">Status</th>
                            <th style="width:180px; text-align:right;">Quick Controls</th>
                        </tr>
                    </thead>
                    <tbody id="schedTableBody">
                        <tr><td colspan="8" style="text-align:center; padding:2rem; color:#64748b;">Loading Stage Schedule...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;

    bindHeaderEvents();
    startRealtimeListeners();
}

// ─────────────────────────────────────────────
// Header & Global Triggers
// ─────────────────────────────────────────────
function bindHeaderEvents() {
    document.getElementById('btnCreateStageTop')?.addEventListener('click', openCreateStageModal);
    document.getElementById('btnPrintStage')?.addEventListener('click', printActiveStage);
    document.getElementById('btnPDFStage')?.addEventListener('click', printActiveStage);
    document.getElementById('btnShareStage')?.addEventListener('click', shareActiveStageWhatsApp);

    // Bulk header trigger
    document.getElementById('chkHeaderAll')?.addEventListener('change', (e) => {
        const checked = e.target.checked;
        const chks = document.querySelectorAll('.sched-row-chk');
        chks.forEach(c => {
            c.checked = checked;
            const id = c.dataset.id;
            if (checked) selectedScheduleIds.add(id);
            else selectedScheduleIds.delete(id);
        });
        updateBulkBar();
    });

    document.getElementById('btnBulkDuration')?.addEventListener('click', executeBulkDuration);
    document.getElementById('btnBulkStatus')?.addEventListener('click', executeBulkStatus);
    document.getElementById('btnBulkMove')?.addEventListener('click', executeBulkMove);
    document.getElementById('btnBulkDelete')?.addEventListener('click', executeBulkDelete);
}

function updateBulkBar() {
    const bar = document.getElementById('schedBulkBar');
    const lbl = document.getElementById('lblSelectedCount');
    if (!bar || !lbl) return;

    if (selectedScheduleIds.size > 0) {
        bar.classList.remove('hidden');
        lbl.textContent = `${selectedScheduleIds.size} Selected`;
    } else {
        bar.classList.add('hidden');
        const hChk = document.getElementById('chkHeaderAll');
        if (hChk) hChk.checked = false;
    }
}

// ─────────────────────────────────────────────
// Real-Time Listeners & Data Cascade Engine
// ─────────────────────────────────────────────
function startRealtimeListeners() {
    const instId = window.currentInstituteId;

    // 1. Listen to Published Programs
    unsubPrograms = onSnapshot(collection(db, "institutes", instId, "programs"), (snap) => {
        localPrograms = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        mergeAndRender();
    });

    // 2. Listen to Schedule documents
    unsubSchedules = onSnapshot(collection(db, "institutes", instId, "schedules"), (snap) => {
        localSchedules = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        mergeAndRender();
    });

    // 3. Listen to Stages collection dynamically from database!
    unsubStages = onSnapshot(collection(db, "institutes", instId, "stages"), (snap) => {
        localStages = snap.docs.map(d => {
            const data = d.data();
            return {
                id: d.id,
                name: data.name || data.stageName || d.id,
                status: data.status || 'active',
                order: data.order !== undefined ? data.order : (data.runningOrder !== undefined ? data.runningOrder : 99),
                ...data
            };
        }).filter(s => s.status === 'active' || s.status !== 'inactive');

        // Sort dynamically by order, then name
        localStages.sort((a, b) => {
            if (a.order !== b.order) return a.order - b.order;
            return a.name.localeCompare(b.name);
        });

        mergeAndRender();
    }, (err) => {
        console.error("Stages snapshot listener error:", err);
    });
}

function mergeAndRender() {
    // Map programs and schedule documents
    mergedSchedules = localSchedules.map(sched => {
        const prog = localPrograms.find(p => p.id === sched.programId || p.id === sched.id) || {};
        return {
            id: sched.id,
            programId: sched.programId || sched.id,
            programName: sched.programName || prog.programName || 'Unnamed Program',
            programNumber: prog.programNumber || sched.programNumber || '',
            stage: sched.stage || '',
            scheduleDate: sched.scheduleDate || '',
            startTime: sched.startTime || '',
            endTime: sched.endTime || '',
            duration: parseInt(sched.duration, 10) || 20,
            runningOrder: parseInt(sched.runningOrder, 10) || 1,
            status: sched.status || 'Pending',
            isLocked: !!sched.isLocked,
            isOffStage: !!sched.isOffStage
        };
    });

    renderTabs();
    if (localStages.length > 0) {
        renderConfigBar();
        renderStageTable();
    }
}

// ─────────────────────────────────────────────
// Time Cascade Math Helpers
// ─────────────────────────────────────────────
function timeToMinutes(timeStr) {
    if (!timeStr) return 540; // Default 09:00 AM = 540 mins
    const [h, m] = timeStr.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
}

function minutesToTime(mins) {
    let h = Math.floor(mins / 60) % 24;
    let m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Automatically recalculates Start and End times down the active stage table
async function triggerTimeCascade(stageItems) {
    if (!stageItems || stageItems.length === 0) return;

    const cfg = stageConfigs[activeStage] || { startTime: '09:00', defaultDuration: 20 };
    let currentMins = timeToMinutes(cfg.startTime);

    const batch = writeBatch(db);
    let changed = false;

    stageItems.sort((a, b) => a.runningOrder - b.runningOrder);

    stageItems.forEach((item, idx) => {
        const dur = parseInt(item.duration, 10) || cfg.defaultDuration || 20;
        
        let startStr = minutesToTime(currentMins);
        if (item.isLocked && item.startTime) {
            startStr = item.startTime;
            currentMins = timeToMinutes(startStr);
        }

        const endMins = currentMins + dur;
        const endStr = minutesToTime(endMins);

        if (item.startTime !== startStr || item.endTime !== endStr || item.runningOrder !== idx + 1) {
            changed = true;
            item.startTime = startStr;
            item.endTime = endStr;
            item.runningOrder = idx + 1;

            const ref = doc(db, "institutes", window.currentInstituteId, "schedules", item.id);
            batch.update(ref, {
                startTime: startStr,
                endTime: endStr,
                runningOrder: idx + 1,
                updatedAt: serverTimestamp()
            });
        }

        currentMins = endMins;
    });

    if (changed) {
        await batch.commit().catch(e => console.error("Time cascade sync error", e));
    }
}

// ─────────────────────────────────────────────
// Render Stage Navigation Tabs (Dynamically Loaded from DB)
// ─────────────────────────────────────────────
function renderTabs() {
    const bar = document.getElementById('schedTabsBar');
    const cfgBar = document.getElementById('schedConfigBar');
    const tblWrap = document.getElementById('printableStageTable');
    if (!bar) return;

    // Empty State Check when no stages exist in DB
    if (localStages.length === 0) {
        bar.innerHTML = `
            <div style="text-align:center; padding:3rem 1.5rem; width:100%; background:#ffffff; border:1px solid #cbd5e1; border-radius:16px; box-shadow:0 1px 3px rgba(0,0,0,0.02);">
                <div style="font-size:2.5rem; margin-bottom:0.5rem;">🎪</div>
                <h3 style="margin:0 0 0.4rem 0; font-weight:800; color:#0f172a; font-size:1.15rem;">No stages available</h3>
                <p style="margin:0 0 1.25rem 0; color:#64748b; font-size:0.9rem; font-weight:600;">Please create a stage first in Stage Management.</p>
                <button class="btn btn-primary" id="btnCreateStageEmpty" style="font-weight:700; padding:0.6rem 1.5rem; font-size:0.95rem;">🎪 + Create Stage</button>
            </div>
        `;
        const emptyBtn = document.getElementById('btnCreateStageEmpty');
        if (emptyBtn) emptyBtn.onclick = openCreateStageModal;

        if (cfgBar) cfgBar.style.display = 'none';
        if (tblWrap) tblWrap.style.display = 'none';
        return;
    }

    if (cfgBar) cfgBar.style.display = 'flex';
    if (tblWrap) tblWrap.style.display = 'block';

    // Verify active stage exists in loaded stages, else set to first stage
    const stageNames = localStages.map(s => s.name);
    if (!activeStage || !stageNames.includes(activeStage)) {
        activeStage = stageNames[0];
    }

    let html = '';
    localStages.forEach(stObj => {
        const stName = stObj.name;
        const count = mergedSchedules.filter(s => s.stage === stName).length;
        const isActive = stName === activeStage;
        const icon = (stName.toLowerCase().includes('off stage') || stObj.type === 'offstage') ? '📝' : '🎪';
        
        html += `
            <button class="sched-tab-btn ${isActive ? 'active' : ''}" data-stage="${window.escapeHTML(stName)}">
                <span>${icon} ${window.escapeHTML(stName)}</span>
                <span style="background:${isActive ? '#eeefee' : '#e2e8f0'}; color:${isActive ? '#4338ca' : '#475569'}; padding:0.15rem 0.55rem; border-radius:999px; font-size:0.75rem; font-weight:800;">(${count})</span>
            </button>
        `;
    });

    bar.innerHTML = html;

    bar.querySelectorAll('.sched-tab-btn').forEach(btn => {
        btn.onclick = () => {
            activeStage = btn.dataset.stage;
            selectedScheduleIds.clear();
            updateBulkBar();
            renderTabs();
            renderConfigBar();
            renderStageTable();
        };
    });
}

// ─────────────────────────────────────────────
// Stage Creation Modal (Stage Management)
// ─────────────────────────────────────────────
function openCreateStageModal() {
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');
    const modalOverlay = document.getElementById('dynamicModal');

    modalTitle.textContent = "🎪 Create New Stage";

    modalBody.innerHTML = `
        <form id="createStageForm" autocomplete="off">
            <div class="form-group">
                <label class="form-label">Stage Name *</label>
                <input type="text" id="newStageName" class="form-input" placeholder="e.g. Stage 1, Main Stage, Girls Stage, Off Stage A" required>
            </div>
            <div class="form-group">
                <label class="form-label">Stage Type *</label>
                <select id="newStageType" class="form-input" required>
                    <option value="stage">🎪 On Stage</option>
                    <option value="offstage">📝 Off Stage</option>
                </select>
            </div>
            <div class="modal-actions" style="margin-top:1.25rem;">
                <button type="submit" class="btn btn-primary w-full" id="saveStageBtn">Create Stage</button>
            </div>
        </form>
    `;

    modalOverlay.classList.remove('hidden');
    document.getElementById('closeDynamicModalBtn').onclick = () => modalOverlay.classList.add('hidden');

    document.getElementById('createStageForm').onsubmit = async (e) => {
        e.preventDefault();
        const name = document.getElementById('newStageName').value.trim();
        const type = document.getElementById('newStageType').value;
        if (!name) return;

        const btn = document.getElementById('saveStageBtn');
        btn.disabled = true;

        try {
            const docRef = doc(collection(db, "institutes", window.currentInstituteId, "stages"));
            await setDoc(docRef, {
                name: name,
                stageName: name,
                type: type,
                status: 'active',
                order: localStages.length + 1,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });

            window.showToast(`✓ Stage "${name}" created successfully!`);
            modalOverlay.classList.add('hidden');
        } catch (err) {
            console.error("Error creating stage:", err);
            window.showToast("Failed to create stage.", "error");
        } finally {
            btn.disabled = false;
        }
    };
}

// ─────────────────────────────────────────────
// Render Config & Setup Bar
// ─────────────────────────────────────────────
function renderConfigBar() {
    const bar = document.getElementById('schedConfigBar');
    if (!bar || !activeStage) return;

    if (!stageConfigs[activeStage]) {
        stageConfigs[activeStage] = {
            date: new Date().toISOString().split('T')[0],
            startTime: '09:00',
            defaultDuration: 20
        };
    }

    const cfg = stageConfigs[activeStage];

    bar.innerHTML = `
        <div class="sched-config-inputs">
            <span style="font-weight:800; font-size:1rem; color:#0f172a;">🎪 ${window.escapeHTML(activeStage)} Setup:</span>
            <div class="sched-config-group">
                <label>📅 Date:</label>
                <input type="date" id="cfgStageDate" class="sched-tbl-input" style="width:140px;" value="${cfg.date}">
            </div>
            <div class="sched-config-group">
                <label>⏱️ Start Time:</label>
                <input type="time" id="cfgStageStart" class="sched-tbl-input" style="width:110px;" value="${cfg.startTime}">
            </div>
            <div class="sched-config-group">
                <label>⏳ Gap/Duration:</label>
                <input type="number" id="cfgStageGap" class="sched-tbl-input" style="width:80px;" value="${cfg.defaultDuration}" min="1">
                <span>mins</span>
            </div>
        </div>
        <div>
            <button class="btn btn-primary" id="btnAddProgramRow" style="font-weight:700;">
                + Add Program to ${window.escapeHTML(activeStage)}
            </button>
        </div>
    `;

    document.getElementById('cfgStageDate').onchange = (e) => {
        cfg.date = e.target.value;
        updateStageSchedulesDate(cfg.date);
    };

    document.getElementById('cfgStageStart').onchange = (e) => {
        cfg.startTime = e.target.value;
        const activeItems = mergedSchedules.filter(s => s.stage === activeStage);
        triggerTimeCascade(activeItems);
    };

    document.getElementById('cfgStageGap').onchange = (e) => {
        cfg.defaultDuration = parseInt(e.target.value, 10) || 20;
        const activeItems = mergedSchedules.filter(s => s.stage === activeStage);
        triggerTimeCascade(activeItems);
    };

    document.getElementById('btnAddProgramRow').onclick = openAddProgramRowModal;
}

async function updateStageSchedulesDate(newDate) {
    const activeItems = mergedSchedules.filter(s => s.stage === activeStage);
    if (activeItems.length === 0) return;

    const batch = writeBatch(db);
    activeItems.forEach(item => {
        batch.update(doc(db, "institutes", window.currentInstituteId, "schedules", item.id), {
            scheduleDate: newDate, updatedAt: serverTimestamp()
        });
    });
    await batch.commit();
}

// ─────────────────────────────────────────────
// Render Active Stage Schedule Table
// ─────────────────────────────────────────────
function renderStageTable() {
    const tbody = document.getElementById('schedTableBody');
    if (!tbody || !activeStage) return;

    const activeItems = mergedSchedules.filter(s => s.stage === activeStage);
    activeItems.sort((a, b) => a.runningOrder - b.runningOrder);

    // Run cascade to guarantee seamless times
    triggerTimeCascade(activeItems);

    if (activeItems.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align:center; padding:3rem 1.5rem;">
                    <div style="font-size:2rem; margin-bottom:0.5rem;">📝</div>
                    <h4 style="margin:0; font-weight:800; color:#1e293b;">No Programs Scheduled in ${window.escapeHTML(activeStage)}</h4>
                    <p style="margin:0.25rem 0 1rem 0; color:#64748b; font-size:0.85rem;">Click the button below to add your first competition program slot.</p>
                    <button class="btn btn-primary" id="btnAddProgramRowEmpty">+ Add Program Slot</button>
                </td>
            </tr>
        `;
        document.getElementById('btnAddProgramRowEmpty').onclick = openAddProgramRowModal;
        return;
    }

    tbody.innerHTML = activeItems.map((item, idx) => {
        const isChecked = selectedScheduleIds.has(item.id);
        const statusColors = {
            'Not Scheduled': 'background:#f1f5f9; color:#475569;',
            'Scheduled': 'background:#fef9c3; color:#ca8a04;',
            'Pending': 'background:#fef9c3; color:#ca8a04;',
            'Running': 'background:#dbeafe; color:#1d4ed8;',
            'Completed': 'background:#dcfce7; color:#16a34a;',
            'Delayed': 'background:#ffedd5; color:#ea580c;',
            'Cancelled': 'background:#fee2e2; color:#dc2626;'
        };

        return `
            <tr class="sched-table-row ${item.isLocked ? 'is-locked' : ''}" draggable="true" data-id="${item.id}" data-idx="${idx}">
                <td style="text-align:center;">
                    <input type="checkbox" class="sched-row-chk" data-id="${item.id}" ${isChecked ? 'checked' : ''} style="cursor:pointer;">
                </td>
                <td style="text-align:center; font-weight:800; color:#4338ca;">
                    ${idx + 1}
                </td>
                <td style="font-weight:700; color:#0f172a;">
                    ${item.isLocked ? '<span title="Locked Slot" style="margin-right:4px;">🔒</span>' : ''}
                    ${item.programNumber ? `[#${item.programNumber}] ` : ''}${window.escapeHTML(item.programName)}
                </td>
                <td>
                    <input type="number" class="sched-tbl-input row-duration-in" data-id="${item.id}" value="${item.duration}" style="width:75px;" min="1"> mins
                </td>
                <td style="font-weight:700; color:#312e81;">
                    ${item.startTime || '09:00'}
                </td>
                <td style="font-weight:700; color:#312e81;">
                    ${item.endTime || '09:20'}
                </td>
                <td>
                    <select class="sched-tbl-select row-status-sel" data-id="${item.id}" style="${statusColors[item.status] || ''}">
                        <option value="Pending" ${item.status === 'Pending' || item.status === 'Not Scheduled' ? 'selected' : ''}>🟡 Pending</option>
                        <option value="Scheduled" ${item.status === 'Scheduled' ? 'selected' : ''}>🟡 Scheduled</option>
                        <option value="Running" ${item.status === 'Running' ? 'selected' : ''}>🔵 Running</option>
                        <option value="Completed" ${item.status === 'Completed' ? 'selected' : ''}>🟢 Completed</option>
                        <option value="Delayed" ${item.status === 'Delayed' ? 'selected' : ''}>🟠 Delayed</option>
                        <option value="Cancelled" ${item.status === 'Cancelled' ? 'selected' : ''}>🔴 Cancelled</option>
                    </select>
                </td>
                <td style="text-align:right;">
                    <div class="sched-row-actions">
                        <button class="btn-tbl-act btn-move-up" data-id="${item.id}" data-idx="${idx}" title="Move Up">⬆️</button>
                        <button class="btn-tbl-act btn-move-down" data-id="${item.id}" data-idx="${idx}" title="Move Down">⬇️</button>
                        <button class="btn-tbl-act btn-toggle-lock" data-id="${item.id}" title="${item.isLocked ? 'Unlock Time' : 'Lock Time'}">${item.isLocked ? '🔒' : '🔓'}</button>
                        <button class="btn-tbl-act btn-dup-row" data-id="${item.id}" title="Duplicate Slot">📋</button>
                        <button class="btn-tbl-act btn-del-row text-danger" data-id="${item.id}" title="Delete Slot">🗑️</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    attachTableEvents(tbody, activeItems);
}

// ─────────────────────────────────────────────
// Attach Table Event Listeners
// ─────────────────────────────────────────────
function attachTableEvents(tbody, activeItems) {
    tbody.querySelectorAll('.sched-row-chk').forEach(chk => {
        chk.onchange = (e) => {
            const id = e.target.dataset.id;
            if (e.target.checked) selectedScheduleIds.add(id);
            else selectedScheduleIds.delete(id);
            updateBulkBar();
        };
    });

    tbody.querySelectorAll('.row-duration-in').forEach(input => {
        input.onchange = async (e) => {
            const id = e.target.dataset.id;
            const newDur = parseInt(e.target.value, 10) || 20;
            await updateDoc(doc(db, "institutes", window.currentInstituteId, "schedules", id), {
                duration: newDur, updatedAt: serverTimestamp()
            });
            const item = activeItems.find(x => x.id === id);
            if (item) item.duration = newDur;
            triggerTimeCascade(activeItems);
        };
    });

    tbody.querySelectorAll('.row-status-sel').forEach(sel => {
        sel.onchange = async (e) => {
            const id = e.target.dataset.id;
            const newStatus = e.target.value;
            await updateDoc(doc(db, "institutes", window.currentInstituteId, "schedules", id), {
                status: newStatus, updatedAt: serverTimestamp()
            });
            window.showToast(`Status updated to ${newStatus}`);
        };
    });

    tbody.querySelectorAll('.btn-move-up').forEach(btn => {
        btn.onclick = () => moveRowOrder(activeItems, parseInt(btn.dataset.idx, 10), -1);
    });
    tbody.querySelectorAll('.btn-move-down').forEach(btn => {
        btn.onclick = () => moveRowOrder(activeItems, parseInt(btn.dataset.idx, 10), 1);
    });
    tbody.querySelectorAll('.btn-toggle-lock').forEach(btn => {
        btn.onclick = async () => {
            const id = btn.dataset.id;
            const item = activeItems.find(x => x.id === id);
            if (item) {
                await updateDoc(doc(db, "institutes", window.currentInstituteId, "schedules", id), {
                    isLocked: !item.isLocked, updatedAt: serverTimestamp()
                });
            }
        };
    });
    tbody.querySelectorAll('.btn-dup-row').forEach(btn => {
        btn.onclick = () => duplicateRowSlot(btn.dataset.id);
    });
    tbody.querySelectorAll('.btn-del-row').forEach(btn => {
        btn.onclick = () => deleteRowSlot(btn.dataset.id);
    });

    // Table Drag and Drop
    let dragSrcIdx = null;
    tbody.querySelectorAll('.sched-table-row').forEach(row => {
        row.addEventListener('dragstart', (e) => {
            dragSrcIdx = parseInt(row.dataset.idx, 10);
            row.classList.add('dragging');
            e.dataTransfer.setData('text/plain', dragSrcIdx);
        });
        row.addEventListener('dragend', () => row.classList.remove('dragging'));
        row.addEventListener('dragover', (e) => e.preventDefault());
        row.addEventListener('drop', (e) => {
            e.preventDefault();
            const targetIdx = parseInt(row.dataset.idx, 10);
            if (dragSrcIdx !== null && dragSrcIdx !== targetIdx) {
                reorderRowsByIndex(activeItems, dragSrcIdx, targetIdx);
            }
        });
    });
}

// ─────────────────────────────────────────────
// Reordering & Slot Operations
// ─────────────────────────────────────────────
async function moveRowOrder(items, currentIdx, direction) {
    const targetIdx = currentIdx + direction;
    if (targetIdx < 0 || targetIdx >= items.length) return;
    await reorderRowsByIndex(items, currentIdx, targetIdx);
}

async function reorderRowsByIndex(items, fromIdx, toIdx) {
    const itemToMove = items.splice(fromIdx, 1)[0];
    items.splice(toIdx, 0, itemToMove);

    items.forEach((item, idx) => {
        item.runningOrder = idx + 1;
    });

    await triggerTimeCascade(items);
    renderStageTable();
}

// Open modal to add published program to active stage
function openAddProgramRowModal() {
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');
    const modalOverlay = document.getElementById('dynamicModal');

    modalTitle.textContent = `Add Program to ${activeStage}`;

    // Filter published programs that are already scheduled in current stage
    const currentStageProgIds = mergedSchedules.filter(s => s.stage === activeStage).map(s => s.programId);
    const availablePrograms = localPrograms.filter(p => !currentStageProgIds.includes(p.id));

    if (availablePrograms.length === 0) {
        modalBody.innerHTML = `<div class="empty-state"><p>All published programs are already added to ${window.escapeHTML(activeStage)}.</p></div>`;
        modalOverlay.classList.remove('hidden');
        document.getElementById('closeDynamicModalBtn').onclick = () => modalOverlay.classList.add('hidden');
        return;
    }

    let options = availablePrograms.map(p => `<option value="${p.id}">${p.programNumber ? `[#${p.programNumber}] ` : ''}${window.escapeHTML(p.programName)} (${p.programType || 'individual'})</option>`).join('');

    modalBody.innerHTML = `
        <form id="addProgSlotForm">
            <div class="form-group">
                <label class="form-label">Select Program *</label>
                <select id="selProgId" class="form-input" required>
                    ${options}
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Duration (Minutes)</label>
                <input type="number" id="selProgDur" class="form-input" value="${stageConfigs[activeStage]?.defaultDuration || 20}" min="1" required>
            </div>
            <div class="modal-actions" style="margin-top:1.25rem;">
                <button type="submit" class="btn btn-primary w-full">Add to ${window.escapeHTML(activeStage)}</button>
            </div>
        </form>
    `;

    modalOverlay.classList.remove('hidden');
    document.getElementById('closeDynamicModalBtn').onclick = () => modalOverlay.classList.add('hidden');

    document.getElementById('addProgSlotForm').onsubmit = async (e) => {
        e.preventDefault();
        const progId = document.getElementById('selProgId').value;
        const dur = parseInt(document.getElementById('selProgDur').value, 10) || 20;
        const prog = localPrograms.find(p => p.id === progId);

        const activeItems = mergedSchedules.filter(s => s.stage === activeStage);
        const isOff = activeStage.toLowerCase().includes('off stage');

        const newDocRef = doc(collection(db, "institutes", window.currentInstituteId, "schedules"));
        await setDoc(newDocRef, {
            programId: progId,
            programName: prog?.programName || 'Unnamed Program',
            stage: activeStage,
            scheduleDate: stageConfigs[activeStage]?.date || new Date().toISOString().split('T')[0],
            duration: dur,
            runningOrder: activeItems.length + 1,
            status: 'Pending',
            isOffStage: isOff,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        window.showToast(`Added ${prog?.programName} to ${activeStage}`);
        modalOverlay.classList.add('hidden');
    };
}

async function duplicateRowSlot(id) {
    const item = mergedSchedules.find(s => s.id === id);
    if (!item) return;

    const activeItems = mergedSchedules.filter(s => s.stage === activeStage);
    const newDocRef = doc(collection(db, "institutes", window.currentInstituteId, "schedules"));
    await setDoc(newDocRef, {
        programId: item.programId,
        programName: `${item.programName} (Copy)`,
        stage: activeStage,
        scheduleDate: item.scheduleDate,
        duration: item.duration,
        runningOrder: activeItems.length + 1,
        status: 'Pending',
        isOffStage: item.isOffStage,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });
    window.showToast("Slot duplicated.");
}

async function deleteRowSlot(id) {
    const confirmed = await window.customConfirm("Remove this program slot from the stage schedule?");
    if (!confirmed) return;

    try {
        await deleteDoc(doc(db, "institutes", window.currentInstituteId, "schedules", id));
        window.showToast("Slot removed.");
    } catch (e) {
        console.error(e);
        window.showToast("Error deleting slot.", "error");
    }
}

// ─────────────────────────────────────────────
// Bulk Operations Execution
// ─────────────────────────────────────────────
function executeBulkDuration() {
    const durStr = prompt("Enter new Duration in minutes for selected items:", "20");
    if (!durStr) return;
    const dur = parseInt(durStr, 10) || 20;

    const batch = writeBatch(db);
    selectedScheduleIds.forEach(id => {
        batch.update(doc(db, "institutes", window.currentInstituteId, "schedules", id), {
            duration: dur, updatedAt: serverTimestamp()
        });
    });
    batch.commit().then(() => {
        window.showToast("Bulk duration updated.");
        selectedScheduleIds.clear();
        updateBulkBar();
    });
}

function executeBulkStatus() {
    const status = prompt("Enter new Status (Pending, Scheduled, Running, Completed, Delayed, Cancelled):", "Scheduled");
    if (!status) return;

    const batch = writeBatch(db);
    selectedScheduleIds.forEach(id => {
        batch.update(doc(db, "institutes", window.currentInstituteId, "schedules", id), {
            status: status.trim(), updatedAt: serverTimestamp()
        });
    });
    batch.commit().then(() => {
        window.showToast("Bulk status updated.");
        selectedScheduleIds.clear();
        updateBulkBar();
    });
}

function executeBulkMove() {
    if (localStages.length === 0) return;

    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');
    const modalOverlay = document.getElementById('dynamicModal');

    modalTitle.textContent = `Move ${selectedScheduleIds.size} Selected Items`;
    let options = localStages.map(s => `<option value="${window.escapeHTML(s.name)}">${window.escapeHTML(s.name)}</option>`).join('');

    modalBody.innerHTML = `
        <form id="bulkMoveForm">
            <div class="form-group">
                <label class="form-label">Select Target Stage *</label>
                <select id="selBulkStage" class="form-input" required>
                    ${options}
                </select>
            </div>
            <div class="modal-actions" style="margin-top:1.25rem;">
                <button type="submit" class="btn btn-primary w-full">Move Items</button>
            </div>
        </form>
    `;

    modalOverlay.classList.remove('hidden');
    document.getElementById('closeDynamicModalBtn').onclick = () => modalOverlay.classList.add('hidden');

    document.getElementById('bulkMoveForm').onsubmit = async (e) => {
        e.preventDefault();
        const targetStage = document.getElementById('selBulkStage').value;
        const isOff = targetStage.toLowerCase().includes('off stage');

        const batch = writeBatch(db);
        selectedScheduleIds.forEach(id => {
            batch.update(doc(db, "institutes", window.currentInstituteId, "schedules", id), {
                stage: targetStage, isOffStage: isOff, updatedAt: serverTimestamp()
            });
        });
        await batch.commit();
        window.showToast(`Moved items to ${targetStage}`);
        selectedScheduleIds.clear();
        updateBulkBar();
        modalOverlay.classList.add('hidden');
    };
}

function executeBulkDelete() {
    window.customConfirm(`Delete ${selectedScheduleIds.size} selected slots?`).then(confirmed => {
        if (!confirmed) return;
        const batch = writeBatch(db);
        selectedScheduleIds.forEach(id => {
            batch.delete(doc(db, "institutes", window.currentInstituteId, "schedules", id));
        });
        batch.commit().then(() => {
            window.showToast("Bulk delete complete.");
            selectedScheduleIds.clear();
            updateBulkBar();
        });
    });
}

// ─────────────────────────────────────────────
// Stage-Specific Exports (WhatsApp)
// ─────────────────────────────────────────────
function shareActiveStageWhatsApp() {
    const activeItems = mergedSchedules.filter(s => s.stage === activeStage);
    activeItems.sort((a, b) => a.runningOrder - b.runningOrder);

    let msg = `*🏆 MEELAD SOFTWARE COMPETITION SCHEDULE*\n`;
    msg += `*🎪 VENUE: ${activeStage.toUpperCase()}*\n`;
    msg += `📅 Date: ${stageConfigs[activeStage]?.date || 'N/A'}\n\n`;

    activeItems.forEach((item, idx) => {
        msg += `*${idx + 1}. ${item.programNumber ? `[#${item.programNumber}] ` : ''}${item.programName}*\n`;
        msg += `   ⏱️ ${item.startTime || 'TBD'} - ${item.endTime || 'TBD'} (${item.duration}m) | Status: ${item.status}\n\n`;
    });

    const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
}

// ─────────────────────────────────────────────
// Stage-Specific Dedicated Print & PDF Generator
// ─────────────────────────────────────────────
function printActiveStage() {
    const activeItems = mergedSchedules.filter(s => s.stage === activeStage);
    activeItems.sort((a, b) => a.runningOrder - b.runningOrder);

    const instName = window.currentEventDetails?.eventName || window.currentInstituteDetails?.name || 'Admin Portal';
    const stageDate = stageConfigs[activeStage]?.date || 'N/A';

    let rowsHTML = '';
    if (activeItems.length === 0) {
        rowsHTML = `<tr><td colspan="6" style="text-align:center; padding:15px; color:#64748b;">No programs scheduled for this stage.</td></tr>`;
    } else {
        rowsHTML = activeItems.map((item, idx) => `
            <tr>
                <td style="text-align:center; font-weight:bold; padding:10px; border:1px solid #cbd5e1;">${idx + 1}</td>
                <td style="font-weight:bold; padding:10px; border:1px solid #cbd5e1; color:#0f172a;">${item.programNumber ? `[#${item.programNumber}] ` : ''}${window.escapeHTML(item.programName)}</td>
                <td style="text-align:center; padding:10px; border:1px solid #cbd5e1;">${item.duration} mins</td>
                <td style="text-align:center; font-weight:bold; padding:10px; border:1px solid #cbd5e1; color:#1e40af;">${item.startTime || '—'}</td>
                <td style="text-align:center; font-weight:bold; padding:10px; border:1px solid #cbd5e1; color:#1e40af;">${item.endTime || '—'}</td>
                <td style="text-align:center; font-weight:bold; padding:10px; border:1px solid #cbd5e1;">${window.escapeHTML(item.status)}</td>
            </tr>
        `).join('');
    }

    const printHTML = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>${window.escapeHTML(instName)} - ${window.escapeHTML(activeStage)} Schedule</title>
            <style>
                body { font-family: 'Inter', system-ui, -apple-system, sans-serif; margin: 30px; color: #0f172a; }
                .print-header { text-align: center; margin-bottom: 25px; border-bottom: 3px double #0f172a; padding-bottom: 15px; }
                .print-header h1 { margin: 0 0 5px 0; font-size: 24px; text-transform: uppercase; color: #1e1b4b; letter-spacing: 0.05em; }
                .print-header h2 { margin: 0 0 8px 0; font-size: 18px; color: #4338ca; }
                .print-header p { margin: 0; font-size: 14px; color: #475569; font-weight: 600; }
                table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 14px; }
                th { background-color: #f8fafc; color: #334155; padding: 12px; border: 1px solid #cbd5e1; text-transform: uppercase; font-size: 12px; letter-spacing: 0.05em; font-weight: 800; }
                td { padding: 10px; border: 1px solid #cbd5e1; }
                .footer { margin-top: 40px; display: flex; justify-content: space-between; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 10px; }
            </style>
        </head>
        <body>
            <div class="print-header">
                <h1>${window.escapeHTML(instName)}</h1>
                <h2>COMPETITION SCHEDULE - ${window.escapeHTML(activeStage.toUpperCase())}</h2>
                <p>Date: ${window.escapeHTML(stageDate)} &nbsp;|&nbsp; Total Programs: ${activeItems.length}</p>
            </div>
            <table>
                <thead>
                    <tr>
                        <th style="width:60px; text-align:center;">SL#</th>
                        <th>PROGRAM NAME</th>
                        <th style="width:110px; text-align:center;">DURATION</th>
                        <th style="width:110px; text-align:center;">START TIME</th>
                        <th style="width:110px; text-align:center;">END TIME</th>
                        <th style="width:130px; text-align:center;">STATUS</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHTML}
                </tbody>
            </table>
            <div class="footer">
                <span>Generated on: ${new Date().toLocaleString()}</span>
                <span>Meelad Software Schedule Management</span>
            </div>
        </body>
        </html>
    `;

    let iframe = document.getElementById('schedPrintIframe');
    if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'schedPrintIframe';
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        document.body.appendChild(iframe);
    }

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(printHTML);
    doc.close();

    setTimeout(() => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
    }, 250);
}
