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
let localCategories = [];
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
            padding-top: 0.5rem;
            padding-bottom: 0.5rem;
            margin-bottom: 1.25rem;
            border-bottom: 2px solid #e2e8f0;
            width: 100%;
            box-sizing: border-box;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none; /* Hide scrollbar for Firefox */
            position: sticky;
            top: 0;
            z-index: 100;
            background: var(--bg-main, #f8fafc);
        }
        .sched-tabs-container::-webkit-scrollbar {
            display: none; /* Hide scrollbar for Chrome/Safari/Opera */
        }
        .sched-tab-wrapper {
            display: inline-flex;
            align-items: center;
            flex-shrink: 0;
            position: relative;
        }
        .sched-tab-btn {
            background: #f8fafc;
            border: 1px solid #cbd5e1;
            color: #475569;
            padding: 0.5rem 1rem;
            border-radius: 12px 12px 0 0;
            font-size: 0.875rem;
            font-weight: 700;
            cursor: pointer;
            white-space: nowrap;
            transition: all 0.2s ease;
            display: inline-flex;
            align-items: center;
            gap: 0.4rem;
            min-height: 44px;
            box-sizing: border-box;
            flex-shrink: 0;
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
        .sched-tab-menu-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            margin-left: 6px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 1.1rem;
            font-weight: bold;
            color: #64748b;
            transition: all 0.2s ease;
        }
        .sched-tab-menu-btn:hover {
            background: rgba(0, 0, 0, 0.08);
            color: #0f172a;
        }
        
        /* Modern contextual action menu */
        .sched-tab-dropdown-menu {
            display: none;
            position: fixed;
            background: #ffffff;
            border: 1px solid rgba(226, 232, 240, 0.8);
            border-radius: 12px;
            box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.15), 0 8px 10px -6px rgba(15, 23, 42, 0.15);
            z-index: 10000;
            min-width: 150px;
            padding: 0.35rem;
            opacity: 0;
            transform: scale(0.95);
            transition: opacity 180ms cubic-bezier(0.16, 1, 0.3, 1), transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
            pointer-events: none;
            box-sizing: border-box;
        }
        .sched-tab-dropdown-menu.show {
            opacity: 1;
            transform: scale(1);
            pointer-events: auto;
        }
        .sched-dropdown-item {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.5rem 0.75rem;
            color: #334155;
            font-size: 0.85rem;
            font-weight: 600;
            text-decoration: none;
            cursor: pointer;
            border-radius: 8px;
            transition: background 0.15s, color 0.15s;
        }
        .sched-dropdown-item:hover {
            background: #f1f5f9;
            color: #0f172a;
        }
        .sched-dropdown-item.text-danger {
            color: #ef4444;
        }
        .sched-dropdown-item.text-danger:hover {
            background: #fee2e2;
            color: #dc2626;
        }

        /* Top Stage Setup Bar & Config Bar Responsive Design */
        .sched-config-bar {
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 14px;
            padding: 1.25rem;
            margin-bottom: 1.25rem;
            display: flex;
            flex-direction: column;
            gap: 1.25rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.02);
            width: 100%;
            box-sizing: border-box;
        }
        @media (min-width: 992px) {
            .sched-config-bar {
                flex-direction: row;
                align-items: center;
                justify-content: space-between;
            }
        }
        .sched-config-inputs {
            display: grid;
            grid-template-columns: 1fr;
            gap: 1rem;
            width: 100%;
            align-items: center;
        }
        /* Mobile: One field per row, full width */
        @media (max-width: 576px) {
            .sched-config-inputs {
                grid-template-columns: 1fr;
            }
            .sched-config-group {
                flex-direction: column;
                align-items: flex-start;
                width: 100%;
            }
            .sched-config-group label {
                margin-bottom: 0.25rem;
            }
            .sched-config-group .sched-tbl-input {
                width: 100% !important;
            }
            .sched-config-bar .btn {
                width: 100%;
            }
        }
        /* Tablet: 2 rows. title and 3 fields */
        @media (min-width: 577px) and (max-width: 991px) {
            .sched-config-inputs {
                grid-template-columns: repeat(2, 1fr);
            }
            .sched-config-title {
                grid-column: span 2;
            }
            .sched-config-group {
                width: 100%;
            }
            .sched-config-group .sched-tbl-input {
                width: 100% !important;
            }
        }
        /* Desktop: same row */
        @media (min-width: 992px) {
            .sched-config-inputs {
                display: flex;
                flex-direction: row;
                width: auto;
                flex-wrap: nowrap;
            }
            .sched-config-group {
                width: auto;
            }
            .sched-config-group .sched-tbl-input {
                width: auto !important;
            }
        }
        .sched-config-group {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.85rem;
            font-weight: 700;
            color: #334155;
        }

        /* Custom Searchable Dropdown */
        .custom-select-container {
            position: relative;
            width: 100%;
        }
        .custom-select-trigger {
            width: 100%;
            padding: 0.65rem 1rem;
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            font-size: 0.9rem;
            font-weight: 600;
            color: #0f172a;
            text-align: left;
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: pointer;
            outline: none;
            transition: border-color 0.2s, box-shadow 0.2s;
            min-height: 44px;
        }
        .custom-select-trigger:focus,
        .custom-select-container.open .custom-select-trigger {
            border-color: #4338ca;
            box-shadow: 0 0 0 2px rgba(67, 56, 202, 0.1);
        }
        .custom-select-trigger-text {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            padding-right: 1rem;
        }
        .custom-select-trigger-arrow {
            font-size: 0.75rem;
            color: #64748b;
            transition: transform 0.2s;
        }
        .custom-select-container.open .custom-select-trigger-arrow {
            transform: rotate(180deg);
        }
        .custom-select-dropdown {
            display: none;
            position: absolute;
            top: 100%;
            left: 0;
            width: 100%;
            margin-top: 4px;
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 12px;
            box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.1), 0 8px 10px -6px rgba(15, 23, 42, 0.1);
            z-index: 10005;
            overflow: hidden;
            opacity: 0;
            transform: scale(0.95);
            transform-origin: top center;
            transition: opacity 150ms cubic-bezier(0.16, 1, 0.3, 1), transform 150ms cubic-bezier(0.16, 1, 0.3, 1);
            pointer-events: none;
            box-sizing: border-box;
        }
        .custom-select-container.open .custom-select-dropdown {
            display: block;
            opacity: 1;
            transform: scale(1);
            pointer-events: auto;
        }
        .custom-select-search-wrapper {
            padding: 8px;
            background: #f8fafc;
            border-bottom: 1px solid #cbd5e1;
            position: sticky;
            top: 0;
            z-index: 10;
        }
        .custom-select-search-input {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            font-size: 0.85rem;
            font-weight: 600;
            outline: none;
            box-sizing: border-box;
        }
        .custom-select-search-input:focus {
            border-color: #4338ca;
            box-shadow: 0 0 0 2px rgba(67, 56, 202, 0.1);
        }
        .custom-select-options-list {
            list-style: none;
            margin: 0;
            padding: 0;
            max-height: 250px;
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
        }
        .custom-select-option {
            padding: 10px 12px;
            font-size: 0.85rem;
            font-weight: 600;
            color: #334155;
            cursor: pointer;
            transition: background 0.15s, color 0.15s;
            display: flex;
            align-items: center;
            min-height: 44px;
            box-sizing: border-box;
        }
        .custom-select-option:hover,
        .custom-select-option.highlighted {
            background: #f1f5f9;
            color: #0f172a;
        }
        .custom-select-option.selected {
            background: #e0e7ff;
            color: #3730a3;
        }
        .custom-select-no-results {
            padding: 15px;
            text-align: center;
            font-size: 0.85rem;
            font-weight: 600;
            color: #64748b;
        }
        .sched-cat-badge {
            display: inline-block;
            padding: 0.15rem 0.5rem;
            font-size: 0.7rem;
            font-weight: 800;
            border-radius: 6px;
            background: #f1f5f9;
            color: #475569;
            border: 1px solid #cbd5e1;
            text-transform: uppercase;
            letter-spacing: 0.025em;
            box-sizing: border-box;
        }

        /* Add Program Redesigned Modal Responsive Container & Cards */
        .modal-container.add-program-modal-container {
            max-width: 960px !important;
            width: 95% !important;
            padding: 1.25rem !important;
        }
        .add-prog-card:hover {
            border-color: #4338ca !important;
            box-shadow: 0 4px 12px rgba(67, 56, 202, 0.12) !important;
        }
        @media (max-width: 768px) {
            .add-prog-filter-bar {
                grid-template-columns: repeat(2, 1fr) !important;
            }
        }
        @media (max-width: 576px) {
            .add-prog-filter-bar {
                grid-template-columns: 1fr !important;
            }
            #programCardsGrid {
                grid-template-columns: 1fr !important;
            }
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
        .table-responsive {
            display: block;
            width: 100%;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
        }
        .sched-compact-table {
            min-width: 900px;
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
            gap: 0.4rem;
            align-items: center;
        }
        .btn-tbl-act {
            background: transparent;
            border: none;
            cursor: pointer;
            padding: 0.5rem 0.6rem;
            border-radius: 8px;
            font-size: 1.05rem;
            color: #64748b;
            transition: all 0.15s;
            min-width: 44px;
            min-height: 44px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            box-sizing: border-box;
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

        .sched-topbar-actions {
            display: inline-flex;
            gap: 0.5rem;
            align-items: center;
            flex-wrap: wrap;
        }
        @media (max-width: 576px) {
            .sched-topbar-actions {
                display: flex;
                flex-direction: column;
                width: 100%;
                gap: 0.5rem;
            }
            .sched-topbar-actions .btn {
                width: 100% !important;
                display: block;
                text-align: center;
            }
        }
        @media (max-width: 768px) {
            .topbar {
                flex-wrap: wrap !important;
                height: auto !important;
                padding: 1rem 1.25rem !important;
                gap: 0.75rem;
            }
            .topbar-actions {
                width: 100% !important;
                margin-top: 0.25rem;
            }
        }

        @media print {
            body * { visibility: hidden !important; }
            #printableStageTable, #printableStageTable * { visibility: visible !important; }
            #printableStageTable { position: absolute; left: 0; top: 0; width: 100% !important; margin: 0 !important; padding: 0 !important; border: none !important; box-shadow: none !important; }
            .sched-tabs-container, .sched-config-bar, .topbar, .sidebar, .bottom-nav, .sched-bulk-bar, .modal-overlay, #settingsWarningModal { display: none !important; }
            
            /* Hide non-printable table columns and icons */
            .sched-compact-table th:first-child, .sched-compact-table td:first-child { display: none !important; }
            .sched-compact-table th:nth-child(7), .sched-compact-table td:nth-child(7) { display: none !important; }
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

    window.currentViewCleanup = () => {
        if (unsubPrograms) { unsubPrograms(); unsubPrograms = null; }
        if (unsubSchedules) { unsubSchedules(); unsubSchedules = null; }
        if (unsubStages) { unsubStages(); unsubStages = null; }
        const dropdown = document.getElementById('schedTabDropdown');
        if (dropdown) {
            dropdown.remove();
        }
    };

    // Render Top Actions specifically for currently active Stage inside a responsive wrapper
    topActions.innerHTML = `
        <div class="sched-topbar-actions">
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
                <div class="table-responsive">
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

    // Fetch categories cache
    getCachedCategories(instId).then(cats => {
        localCategories = cats || [];
        mergeAndRender();
    }).catch(err => {
        console.error("Error loading categories:", err);
    });

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

function resolveCategoryName(prog) {
    if (!prog) return 'Uncategorized';
    if (prog.categoryName) return prog.categoryName;
    if (prog.category) return prog.category;
    if (prog.categoryId) {
        const cat = localCategories.find(c => c.id === prog.categoryId || c.name === prog.categoryId);
        if (cat) return cat.name;
        return prog.categoryId === 'general_programs' ? 'General' : prog.categoryId;
    }
    return 'Uncategorized';
}

function getBreakIcon(title = '') {
    const t = String(title).toLowerCase();
    if (t.includes('tea')) return '☕';
    if (t.includes('lunch') || t.includes('food') || t.includes('meal')) return '🍽️';
    if (t.includes('prayer') || t.includes('salah') || t.includes('namaz')) return '🕌';
    if (t.includes('setup') || t.includes('stage')) return '🎪';
    if (t.includes('judge') || t.includes('meeting')) return '⚖️';
    if (t.includes('prize') || t.includes('award') || t.includes('ceremony')) return '🏆';
    return '⏰';
}

function mergeAndRender() {
    // Map programs and schedule documents
    mergedSchedules = localSchedules.map(sched => {
        const isBreak = !!sched.isBreak || sched.type === 'break' || (!sched.programId && !!sched.programName);
        const prog = isBreak ? {} : (localPrograms.find(p => p.id === sched.programId || p.id === sched.id) || {});
        const catName = isBreak ? 'Break' : resolveCategoryName(prog);
        return {
            id: sched.id,
            isBreak: isBreak,
            breakTitle: sched.breakTitle || sched.programName || 'Break',
            programId: sched.programId || '',
            programName: isBreak ? (sched.breakTitle || sched.programName || 'Break') : (sched.programName || prog.programName || 'Unnamed Program'),
            programNumber: isBreak ? '' : (prog.programNumber || sched.programNumber || ''),
            programType: isBreak ? 'Break' : (prog.programType || sched.programType || ''),
            categoryName: catName,
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

    // Populate stageConfigs dynamically from localStages doc data to persist stage config
    localStages.forEach(stObj => {
        if (stObj.name) {
            stageConfigs[stObj.name] = {
                date: stObj.date || stObj.scheduleDate || stageConfigs[stObj.name]?.date || new Date().toISOString().split('T')[0],
                startTime: stObj.startTime || stageConfigs[stObj.name]?.startTime || '09:00',
                defaultDuration: parseInt(stObj.defaultDuration || stObj.duration, 10) || stageConfigs[stObj.name]?.defaultDuration || 20,
                color: stObj.color || '',
                icon: stObj.icon || ''
            };
        }
    });

    renderStageTabs();
    if (localStages.length > 0) {
        renderConfigBar();
        refreshScheduleTable();
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

function formatTimeTo12Hour(timeStr) {
    if (!timeStr) return '';
    const parts = timeStr.split(':');
    if (parts.length < 2) return timeStr;
    let h = parseInt(parts[0], 10);
    const m = parts[1];
    if (isNaN(h)) return timeStr;
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${m} ${ampm}`;
}

// Automatically recalculates Start and End times down the active stage table
async function triggerTimeCascade(stageItems, saveToDb = true) {
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

            if (saveToDb) {
                const ref = doc(db, "institutes", window.currentInstituteId, "schedules", item.id);
                batch.update(ref, {
                    startTime: startStr,
                    endTime: endStr,
                    runningOrder: idx + 1,
                    updatedAt: serverTimestamp()
                });
            }
        }

        currentMins = endMins;
    });

    if (changed && saveToDb) {
        await batch.commit().catch(e => console.error("Time cascade sync error", e));
    }
}

// ─────────────────────────────────────────────
// Dropdown Menu Helpers (Contextual Positioning)
// ─────────────────────────────────────────────
function closeDropdown(dropdown) {
    if (!dropdown) return;
    dropdown.classList.remove('show');
    setTimeout(() => {
        if (!dropdown.classList.contains('show')) {
            dropdown.style.display = 'none';
        }
    }, 180);
}

function getOrCreateDropdown() {
    let dropdown = document.getElementById('schedTabDropdown');
    if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.id = 'schedTabDropdown';
        dropdown.className = 'sched-tab-dropdown-menu';
        dropdown.style.position = 'fixed';
        dropdown.style.zIndex = '10000';
        dropdown.style.display = 'none';
        dropdown.innerHTML = `
            <a class="sched-dropdown-item edit-stage-opt">✏️ Edit Stage</a>
            <a class="sched-dropdown-item delete-stage-opt text-danger">🗑️ Delete Stage</a>
        `;
        document.body.appendChild(dropdown);

        // Bind clicks once
        dropdown.querySelector('.edit-stage-opt').onclick = (e) => {
            e.stopPropagation();
            const id = dropdown.dataset.stageId;
            closeDropdown(dropdown);
            openEditStageModal(id);
        };

        dropdown.querySelector('.delete-stage-opt').onclick = (e) => {
            e.stopPropagation();
            const id = dropdown.dataset.stageId;
            closeDropdown(dropdown);
            deleteStage(id);
        };

        // Close on click outside
        document.addEventListener('click', (e) => {
            if (!e.target.classList.contains('sched-tab-menu-btn')) {
                closeDropdown(dropdown);
            }
        });

        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeDropdown(dropdown);
            }
        });
    }
    return dropdown;
}

// ─────────────────────────────────────────────
// Render Stage Navigation Tabs (Dynamically Loaded from DB)
// ─────────────────────────────────────────────
function renderStageTabs() {
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
        const icon = stObj.icon || ((stName.toLowerCase().includes('off stage') || stObj.type === 'offstage') ? '📝' : '🎪');
        const color = stObj.color || '';
        const customStyle = color ? `border-top: 3px solid ${color};` : '';
        
        html += `
            <div class="sched-tab-wrapper ${isActive ? 'active' : ''}">
                <button class="sched-tab-btn ${isActive ? 'active' : ''}" data-stage="${window.escapeHTML(stName)}" style="${customStyle}">
                    <span>${icon} ${window.escapeHTML(stName)}</span>
                    <span style="background:${isActive ? '#eeefee' : '#e2e8f0'}; color:${isActive ? '#4338ca' : '#475569'}; padding:0.15rem 0.55rem; border-radius:999px; font-size:0.75rem; font-weight:800; margin-right: 4px;">(${count})</span>
                    <span class="sched-tab-menu-btn" data-id="${stObj.id}">⋮</span>
                </button>
            </div>
        `;
    });

    bar.innerHTML = html;

    // Attach tab switches and dropdown triggers
    bar.querySelectorAll('.sched-tab-btn').forEach(btn => {
        btn.onclick = (e) => {
            // Prevent tab switch if clicking the menu button
            if (e.target.classList.contains('sched-tab-menu-btn')) {
                return;
            }
            activeStage = btn.dataset.stage;
            selectedScheduleIds.clear();
            updateBulkBar();
            renderStageTabs();
            renderConfigBar();
            refreshScheduleTable();
        };

        const menuBtn = btn.querySelector('.sched-tab-menu-btn');
        if (menuBtn) {
            menuBtn.onclick = (e) => {
                e.stopPropagation();
                const id = menuBtn.dataset.id;
                const dropdown = getOrCreateDropdown();
                
                // Toggle logic
                const isCurrentlyOpenForThisStage = (dropdown.style.display === 'block' && dropdown.dataset.stageId === id);
                
                if (isCurrentlyOpenForThisStage) {
                    closeDropdown(dropdown);
                } else {
                    dropdown.dataset.stageId = id;
                    dropdown.style.display = 'block'; // Make block first to get client width/height
                    
                    const rect = menuBtn.getBoundingClientRect();
                    const dropdownWidth = dropdown.offsetWidth || 150;
                    const dropdownHeight = dropdown.offsetHeight || 88;
                    const isMobile = window.innerWidth <= 768;
                    
                    let left = 0;
                    let top = 0;
                    let origin = 'top center';
                    
                    if (isMobile) {
                        left = rect.left + rect.width / 2 - dropdownWidth / 2;
                        top = rect.bottom + 8;
                        origin = 'top center';
                        
                        // Keep within viewport
                        if (left < 10) left = 10;
                        if (left + dropdownWidth > window.innerWidth - 10) {
                            left = window.innerWidth - dropdownWidth - 10;
                        }
                    } else {
                        // Desktop: Right alignment with space check
                        left = rect.right + 8;
                        top = rect.top + rect.height / 2 - dropdownHeight / 2;
                        origin = 'left center';
                        
                        if (left + dropdownWidth > window.innerWidth - 10) {
                            left = rect.left - dropdownWidth - 8;
                            origin = 'right center';
                        }
                        
                        // Keep within viewport vertically
                        if (top < 10) top = 10;
                        if (top + dropdownHeight > window.innerHeight - 10) {
                            top = window.innerHeight - dropdownHeight - 10;
                        }
                    }
                    
                    dropdown.style.left = `${left}px`;
                    dropdown.style.top = `${top}px`;
                    dropdown.style.transformOrigin = origin;
                    
                    // Force a reflow before adding class for transition
                    dropdown.offsetHeight;
                    dropdown.classList.add('show');
                }
            };
        }
    });

    // Scroll active tab into view
    const activeTab = bar.querySelector('.sched-tab-btn.active');
    if (activeTab) {
        activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
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
// Stage Helper Operations (Load, Edit, Save, Delete)
// ─────────────────────────────────────────────
function loadStageData(stageId) {
    return localStages.find(s => s.id === stageId) || null;
}

function openEditStageModal(stageId) {
    const stageObj = loadStageData(stageId);
    if (!stageObj) {
        window.showToast("Stage not found.", "error");
        return;
    }

    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');
    const modalOverlay = document.getElementById('dynamicModal');

    modalTitle.textContent = `✏️ Edit Stage: ${stageObj.name}`;

    const cfg = stageConfigs[stageObj.name] || {
        date: stageObj.date || stageObj.scheduleDate || new Date().toISOString().split('T')[0],
        startTime: stageObj.startTime || '09:00',
        defaultDuration: stageObj.defaultDuration || stageObj.duration || 20
    };

    modalBody.innerHTML = `
        <form id="editStageForm" autocomplete="off">
            <div class="form-group">
                <label class="form-label">Stage Name *</label>
                <input type="text" id="editStageName" class="form-input" value="${window.escapeHTML(stageObj.name)}" required>
            </div>
            <div class="form-group">
                <label class="form-label">Stage Type *</label>
                <select id="editStageType" class="form-input" required>
                    <option value="stage" ${stageObj.type === 'stage' ? 'selected' : ''}>🎪 On Stage</option>
                    <option value="offstage" ${stageObj.type === 'offstage' ? 'selected' : ''}>📝 Off Stage</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Stage Date</label>
                <input type="date" id="editStageDate" class="form-input" value="${cfg.date || ''}">
            </div>
            <div class="form-group">
                <label class="form-label">Start Time</label>
                <input type="time" id="editStageStart" class="form-input" value="${cfg.startTime || '09:00'}">
            </div>
            <div class="form-group">
                <label class="form-label">Gap Between Programs (Minutes)</label>
                <input type="number" id="editStageGap" class="form-input" value="${cfg.defaultDuration || 20}" min="1">
            </div>
            <div class="form-group">
                <label class="form-label">Stage Color (Theme)</label>
                <input type="color" id="editStageColor" class="form-input" value="${stageObj.color || '#4338ca'}" style="height: 44px; padding: 4px;">
            </div>
            <div class="form-group">
                <label class="form-label">Stage Icon (Emoji)</label>
                <input type="text" id="editStageIcon" class="form-input" value="${stageObj.icon || ''}" placeholder="e.g. 🎪, 📝, 🏆">
            </div>
            <div class="modal-actions" style="margin-top:1.25rem;">
                <button type="submit" class="btn btn-primary w-full" id="saveStageChangesBtn">Save Changes</button>
            </div>
        </form>
    `;

    modalOverlay.classList.remove('hidden');
    document.getElementById('closeDynamicModalBtn').onclick = () => modalOverlay.classList.add('hidden');

    document.getElementById('editStageForm').onsubmit = async (e) => {
        e.preventDefault();
        const newName = document.getElementById('editStageName').value.trim();
        const newType = document.getElementById('editStageType').value;
        const newDate = document.getElementById('editStageDate').value;
        const newStartTime = document.getElementById('editStageStart').value;
        const newGap = parseInt(document.getElementById('editStageGap').value, 10) || 20;
        const newColor = document.getElementById('editStageColor').value;
        const newIcon = document.getElementById('editStageIcon').value.trim();

        if (!newName) return;

        const btn = document.getElementById('saveStageChangesBtn');
        btn.disabled = true;

        try {
            await saveStageChanges(stageId, {
                name: newName,
                type: newType,
                date: newDate,
                startTime: newStartTime,
                defaultDuration: newGap,
                color: newColor,
                icon: newIcon
            });

            window.showToast(`✓ Stage "${newName}" updated successfully!`);
            modalOverlay.classList.add('hidden');
        } catch (err) {
            console.error("Error updating stage:", err);
            window.showToast("Failed to save stage changes.", "error");
        } finally {
            btn.disabled = false;
        }
    };
}

async function saveStageChanges(stageId, updatedFields) {
    const stageObj = loadStageData(stageId);
    if (!stageObj) throw new Error("Stage not found");

    const oldName = stageObj.name;
    const newName = updatedFields.name;
    const newType = updatedFields.type;

    const batch = writeBatch(db);
    
    // Update local config cache
    stageConfigs[newName] = {
        date: updatedFields.date,
        startTime: updatedFields.startTime,
        defaultDuration: updatedFields.defaultDuration,
        color: updatedFields.color,
        icon: updatedFields.icon
    };

    // 1. Update the stage document itself
    const stageRef = doc(db, "institutes", window.currentInstituteId, "stages", stageId);
    batch.update(stageRef, {
        name: newName,
        stageName: newName,
        type: newType,
        date: updatedFields.date,
        startTime: updatedFields.startTime,
        defaultDuration: updatedFields.defaultDuration,
        color: updatedFields.color,
        icon: updatedFields.icon,
        updatedAt: serverTimestamp()
    });

    // 2. Propagate name/type changes to schedules if stage is renamed
    const isOff = newType === 'offstage' || newName.toLowerCase().includes('off stage');
    
    const affectedSchedules = localSchedules.filter(s => s.stage === oldName);
    affectedSchedules.forEach(s => {
        const sRef = doc(db, "institutes", window.currentInstituteId, "schedules", s.id);
        batch.update(sRef, {
            stage: newName,
            isOffStage: isOff,
            scheduleDate: updatedFields.date,
            updatedAt: serverTimestamp()
        });
    });

    await batch.commit();

    // If activeStage was the renamed stage, update activeStage state
    if (activeStage === oldName) {
        activeStage = newName;
    }
}

async function deleteStage(stageId) {
    const stageObj = loadStageData(stageId);
    if (!stageObj) return;

    const stageName = stageObj.name;

    // First confirmation
    const confirmDelete = await window.customConfirm(
        `Delete "${stageName}"?\nThis action cannot be undone.`,
        "Delete Stage",
        { danger: true, okText: "Delete Permanently" }
    );
    if (!confirmDelete) return;

    // Second confirmation if stage contains scheduled programs
    const affectedSchedules = localSchedules.filter(s => s.stage === stageName);
    if (affectedSchedules.length > 0) {
        const confirmSlots = await window.customConfirm(
            "This stage contains scheduled programs. Deleting it will also remove all schedule slots.",
            "Warning: Scheduled Programs Exist",
            { danger: true, okText: "Delete Permanently" }
        );
        if (!confirmSlots) return;
    }

    try {
        const batch = writeBatch(db);
        
        // Remove stage doc
        const stageRef = doc(db, "institutes", window.currentInstituteId, "stages", stageId);
        batch.delete(stageRef);

        // Remove all schedules belonging to that stage
        affectedSchedules.forEach(s => {
            const sRef = doc(db, "institutes", window.currentInstituteId, "schedules", s.id);
            batch.delete(sRef);
        });

        await batch.commit();
        window.showToast(`✓ Stage "${stageName}" deleted successfully!`);

        // Select another stage if deleted stage was active
        if (activeStage === stageName) {
            const remainingStages = localStages.filter(s => s.id !== stageId);
            if (remainingStages.length > 0) {
                activeStage = remainingStages[0].name;
            } else {
                activeStage = '';
            }
        }
    } catch (err) {
        console.error("Error deleting stage:", err);
        window.showToast("Failed to delete stage.", "error");
    }
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
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
            <button class="btn btn-primary" id="btnAddProgramRow" style="font-weight:700;">
                + Add Program
            </button>
            <button class="btn btn-secondary" id="btnAddBreakRow" style="font-weight:700; background:#fef3c7; color:#92400e; border:1px solid #fde68a;">
                ☕ + Add Break
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
        triggerTimeCascade(activeItems, true);
    };

    document.getElementById('cfgStageGap').onchange = (e) => {
        cfg.defaultDuration = parseInt(e.target.value, 10) || 20;
        const activeItems = mergedSchedules.filter(s => s.stage === activeStage);
        triggerTimeCascade(activeItems, true);
    };

    document.getElementById('btnAddProgramRow').onclick = openAddProgramRowModal;
    document.getElementById('btnAddBreakRow').onclick = openAddBreakModal;
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
function refreshScheduleTable() {
    const tbody = document.getElementById('schedTableBody');
    if (!tbody || !activeStage) return;

    const activeItems = mergedSchedules.filter(s => s.stage === activeStage);
    activeItems.sort((a, b) => a.runningOrder - b.runningOrder);

    // Run cascade in-memory to guarantee seamless times on display, but do not write to db on load/render!
    triggerTimeCascade(activeItems, false);

    if (activeItems.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align:center; padding:3rem 1.5rem;">
                    <div style="font-size:2rem; margin-bottom:0.5rem;">📝</div>
                    <h4 style="margin:0; font-weight:800; color:#1e293b;">No Programs Scheduled in ${window.escapeHTML(activeStage)}</h4>
                    <p style="margin:0.25rem 0 1rem 0; color:#64748b; font-size:0.85rem;">Add a competition program slot or inserting a break slot below.</p>
                    <div style="display:flex; gap:0.5rem; justify-content:center; margin-top:0.75rem;">
                        <button class="btn btn-primary" id="btnAddProgramRowEmpty">+ Add Program Slot</button>
                        <button class="btn btn-secondary" id="btnAddBreakRowEmpty" style="background:#fef3c7; color:#92400e; border:1px solid #fde68a; font-weight:700;">☕ + Add Break Slot</button>
                    </div>
                </td>
            </tr>
        `;
        document.getElementById('btnAddProgramRowEmpty').onclick = openAddProgramRowModal;
        document.getElementById('btnAddBreakRowEmpty').onclick = openAddBreakModal;
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

        if (item.isBreak) {
            const icon = getBreakIcon(item.programName);
            return `
                <tr class="sched-table-row is-break-row ${item.isLocked ? 'is-locked' : ''}" draggable="true" data-id="${item.id}" data-idx="${idx}" style="background:#fffbeb; border-left:4px solid #f59e0b;">
                    <td style="text-align:center;">
                        <input type="checkbox" class="sched-row-chk" data-id="${item.id}" ${isChecked ? 'checked' : ''} style="cursor:pointer;">
                    </td>
                    <td style="text-align:center; font-weight:800; color:#b45309;">
                        ${idx + 1}
                    </td>
                    <td style="font-weight:700; color:#92400e;">
                        <div style="display:flex; align-items:center; gap:0.5rem;">
                            <span style="font-size:1.1rem;">${icon}</span>
                            <div>
                                ${item.isLocked ? '<span title="Locked Slot" style="margin-right:4px;">🔒</span>' : ''}
                                <span style="font-weight:800; font-size:0.95rem; color:#78350f;">${window.escapeHTML(item.programName)}</span>
                                <span style="margin-left:6px; background:#fef3c7; color:#92400e; border:1px solid #fde68a; padding:0.15rem 0.5rem; border-radius:6px; font-weight:800; font-size:0.7rem; text-transform:uppercase;">BREAK</span>
                            </div>
                        </div>
                    </td>
                    <td>
                        <input type="number" class="sched-tbl-input row-duration-in" data-id="${item.id}" value="${item.duration}" style="width:75px; border-color:#fde68a; background:#ffffff;" min="1"> mins
                    </td>
                    <td style="font-weight:700; color:#b45309;">
                        ${formatTimeTo12Hour(item.startTime || '09:00')}
                    </td>
                    <td style="font-weight:700; color:#b45309;">
                        ${formatTimeTo12Hour(item.endTime || '09:20')}
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
        }

        return `
            <tr class="sched-table-row ${item.isLocked ? 'is-locked' : ''}" draggable="true" data-id="${item.id}" data-idx="${idx}">
                <td style="text-align:center;">
                    <input type="checkbox" class="sched-row-chk" data-id="${item.id}" ${isChecked ? 'checked' : ''} style="cursor:pointer;">
                </td>
                <td style="text-align:center; font-weight:800; color:#4338ca;">
                    ${idx + 1}
                </td>
                <td style="font-weight:700; color:#0f172a;">
                    <div style="display:flex; flex-direction:column; align-items:flex-start; gap:0.25rem;">
                        <div style="line-height:1.2;">
                            ${item.isLocked ? '<span title="Locked Slot" style="margin-right:4px;">🔒</span>' : ''}
                            ${item.programNumber ? `<span style="color:#64748b; font-weight:600;">[#${item.programNumber}]</span> ` : ''}${window.escapeHTML(item.programName)}
                        </div>
                        <div style="margin-top:2px;">
                            <span class="sched-cat-badge">${window.escapeHTML(item.categoryName || 'Uncategorized')}</span>
                        </div>
                    </div>
                </td>
                <td>
                    <input type="number" class="sched-tbl-input row-duration-in" data-id="${item.id}" value="${item.duration}" style="width:75px;" min="1"> mins
                </td>
                <td style="font-weight:700; color:#312e81;">
                    ${formatTimeTo12Hour(item.startTime || '09:00')}
                </td>
                <td style="font-weight:700; color:#312e81;">
                    ${formatTimeTo12Hour(item.endTime || '09:20')}
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
            triggerTimeCascade(activeItems, true);
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

    await triggerTimeCascade(items, true);
    refreshScheduleTable();
}

// Open modal to add break slot to active stage
function openAddBreakModal() {
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');
    const modalOverlay = document.getElementById('dynamicModal');

    modalTitle.textContent = `☕ Add Break Slot to ${activeStage}`;

    modalBody.innerHTML = `
        <form id="addBreakSlotForm">
            <div class="form-group">
                <label class="form-label">Break Title *</label>
                <select id="selBreakTitleSelect" class="form-input" required>
                    <option value="Tea Break">☕ Tea Break</option>
                    <option value="Lunch Break">🍽️ Lunch Break</option>
                    <option value="Prayer Break">🕌 Prayer Break</option>
                    <option value="Stage Setup">🎪 Stage Setup</option>
                    <option value="Judge Meeting">⚖️ Judge Meeting</option>
                    <option value="Prize Distribution">🏆 Prize Distribution</option>
                    <option value="Other">✏️ Other (Custom Title)</option>
                </select>
            </div>
            <div class="form-group hidden" id="customBreakTitleGroup">
                <label class="form-label">Custom Break Title *</label>
                <input type="text" id="txtCustomBreakTitle" class="form-input" placeholder="e.g. Refreshment Break, Announcement">
            </div>
            <div class="form-group">
                <label class="form-label">Duration (Minutes) *</label>
                <input type="number" id="selBreakDur" class="form-input" value="${stageConfigs[activeStage]?.defaultDuration || 20}" min="1" required>
            </div>
            <div class="modal-actions" style="margin-top:1.25rem;">
                <button type="submit" class="btn btn-primary w-full" id="btnSaveBreakSlot">Save Break Slot</button>
            </div>
        </form>
    `;

    modalOverlay.classList.remove('hidden');

    const breakSelect = document.getElementById('selBreakTitleSelect');
    const customGroup = document.getElementById('customBreakTitleGroup');
    const customInput = document.getElementById('txtCustomBreakTitle');

    breakSelect.onchange = () => {
        if (breakSelect.value === 'Other') {
            customGroup.classList.remove('hidden');
            customInput.required = true;
            customInput.focus();
        } else {
            customGroup.classList.add('hidden');
            customInput.required = false;
        }
    };

    const closeModal = () => modalOverlay.classList.add('hidden');
    document.getElementById('closeDynamicModalBtn').onclick = closeModal;

    document.getElementById('addBreakSlotForm').onsubmit = async (e) => {
        e.preventDefault();
        const selectVal = breakSelect.value;
        const customVal = customInput.value.trim();
        const breakTitle = (selectVal === 'Other') ? (customVal || 'Break') : selectVal;
        const duration = parseInt(document.getElementById('selBreakDur').value, 10) || 20;

        const btn = document.getElementById('btnSaveBreakSlot');
        btn.disabled = true;

        try {
            const activeItems = mergedSchedules.filter(s => s.stage === activeStage);
            const isOff = activeStage.toLowerCase().includes('off stage');

            const newDocRef = doc(collection(db, "institutes", window.currentInstituteId, "schedules"));
            await setDoc(newDocRef, {
                isBreak: true,
                programId: '',
                programName: breakTitle,
                breakTitle: breakTitle,
                stage: activeStage,
                scheduleDate: stageConfigs[activeStage]?.date || new Date().toISOString().split('T')[0],
                duration: duration,
                runningOrder: activeItems.length + 1,
                status: 'Scheduled',
                isOffStage: isOff,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });

            window.showToast(`✓ Break "${breakTitle}" added to ${activeStage}`);
            closeModal();
        } catch (err) {
            console.error("Error adding break slot:", err);
            window.showToast("Failed to add break slot.", "error");
        } finally {
            btn.disabled = false;
        }
    };
}

// Open modal to add published program to active stage
async function openAddProgramRowModal() {
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

    // Resolve category details using getCachedCategories
    const categories = await getCachedCategories(window.currentInstituteId) || [];
    const getProgramCategoryName = (p) => {
        if (p.categoryName) return p.categoryName;
        const cat = categories.find(c => c.id === p.categoryId);
        return cat ? cat.name : (p.categoryId === 'general_programs' ? 'General' : '');
    };

    const getProgramLocation = (p) => {
        if (p.programLocation) return p.programLocation;
        if (p.location) return p.location;
        if (p.isOffStage !== undefined) return p.isOffStage ? 'Off Stage' : 'Stage';
        return 'Stage';
    };

    // Build unique list of category names for filter dropdown
    const categoryNamesList = [];
    categories.forEach(c => {
        if (c.name && !categoryNamesList.includes(c.name)) categoryNamesList.push(c.name);
    });
    availablePrograms.forEach(p => {
        const cName = getProgramCategoryName(p) || 'General';
        if (cName && !categoryNamesList.includes(cName)) categoryNamesList.push(cName);
    });

    const categoryOptionsHtml = categoryNamesList.map(cName => 
        `<option value="${window.escapeHTML(cName)}">${window.escapeHTML(cName)}</option>`
    ).join('');

    // Sort available programs ascending by programNumber (numerically if possible)
    const sortedPrograms = [...availablePrograms].sort((a, b) => {
        const numA = parseInt(a.programNumber, 10);
        const numB = parseInt(b.programNumber, 10);
        if (isNaN(numA) && isNaN(numB)) {
            return (a.programNumber || '').localeCompare(b.programNumber || '');
        }
        if (isNaN(numA)) return 1;
        if (isNaN(numB)) return -1;
        return numA - numB;
    });

    // Make dynamic modal wide for comfortable desktop & mobile browsing
    const modalContainer = modalOverlay.querySelector('.modal-container');
    if (modalContainer) {
        modalContainer.classList.add('add-program-modal-container');
    }

    modalBody.innerHTML = `
        <form id="addProgSlotForm" autocomplete="off" style="display:flex; flex-direction:column; gap:12px;">
            <!-- Integrated Aligned Filter Header -->
            <div class="add-prog-filter-bar" style="display:grid; grid-template-columns: repeat(4, 1fr); gap:10px; background:#f8fafc; padding:12px; border-radius:12px; border:1px solid #cbd5e1;">
                <div>
                    <label style="display:block; font-size:0.75rem; font-weight:700; color:#475569; margin-bottom:4px;">Category</label>
                    <select id="programCategoryFilter" class="form-input" style="width:100%; font-size:0.85rem; font-weight:600; padding:6px 10px; height:38px; border-radius:8px;">
                        <option value="">All Categories</option>
                        ${categoryOptionsHtml}
                    </select>
                </div>
                <div>
                    <label style="display:block; font-size:0.75rem; font-weight:700; color:#475569; margin-bottom:4px;">Gender</label>
                    <select id="programGenderFilter" class="form-input" style="width:100%; font-size:0.85rem; font-weight:600; padding:6px 10px; height:38px; border-radius:8px;">
                        <option value="">All</option>
                        <option value="Boys">Boys</option>
                        <option value="Girls">Girls</option>
                        <option value="Mixed">Mixed</option>
                    </select>
                </div>
                <div>
                    <label style="display:block; font-size:0.75rem; font-weight:700; color:#475569; margin-bottom:4px;">Program Location</label>
                    <select id="programLocationFilter" class="form-input" style="width:100%; font-size:0.85rem; font-weight:600; padding:6px 10px; height:38px; border-radius:8px;">
                        <option value="">All</option>
                        <option value="Stage">Stage</option>
                        <option value="Off Stage">Off Stage</option>
                    </select>
                </div>
                <div>
                    <label style="display:block; font-size:0.75rem; font-weight:700; color:#475569; margin-bottom:4px;">Search</label>
                    <input type="text" id="programSearchInput" class="form-input" placeholder="Search name or number..." style="width:100%; font-size:0.85rem; font-weight:600; padding:6px 10px; height:38px; border-radius:8px;" autocomplete="off">
                </div>
            </div>

            <!-- List Header Count -->
            <div style="display:flex; justify-content:space-between; align-items:center; padding:0 4px;">
                <span id="progCountLabel" style="font-size:0.825rem; font-weight:700; color:#475569;">Available Programs</span>
                <span style="font-size:0.75rem; color:#64748b; font-weight:500;">Tip: Double-click card to add directly</span>
            </div>

            <!-- Scrollable Cards Grid Container -->
            <div id="programCardsGrid" style="
                max-height: 420px;
                overflow-y: auto;
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
                gap: 10px;
                padding: 4px;
                border: 1px solid #e2e8f0;
                border-radius: 12px;
                background: #ffffff;
                -webkit-overflow-scrolling: touch;
            ">
                <!-- Program cards injected dynamically -->
            </div>

            <input type="hidden" id="selProgId" name="programId" required>

            <!-- Bottom Action Controls -->
            <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; background:#f8fafc; padding:12px 16px; border-radius:12px; border:1px solid #cbd5e1; flex-wrap:wrap; margin-top:4px;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <label style="font-weight:700; font-size:0.85rem; color:#334155; white-space:nowrap;">Duration (Mins):</label>
                    <input type="number" id="selProgDur" class="form-input" value="${stageConfigs[activeStage]?.defaultDuration || 20}" min="1" style="width:90px; height:38px; font-weight:700;" required>
                </div>
                <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                    <span id="selectedProgNotice" style="font-size:0.85rem; font-weight:700; color:#4338ca;">No program selected</span>
                    <button type="submit" class="btn btn-primary" id="btnSubmitAddSlot" style="font-weight:700; padding:0.6rem 1.5rem;" disabled>+ Add to ${window.escapeHTML(activeStage)}</button>
                </div>
            </div>
        </form>
    `;

    modalOverlay.classList.remove('hidden');

    // UI Control references
    const categoryFilter = document.getElementById('programCategoryFilter');
    const genderFilter = document.getElementById('programGenderFilter');
    const locationFilter = document.getElementById('programLocationFilter');
    const searchInput = document.getElementById('programSearchInput');
    const gridEl = document.getElementById('programCardsGrid');
    const hiddenInput = document.getElementById('selProgId');
    const submitBtn = document.getElementById('btnSubmitAddSlot');
    const selectedNotice = document.getElementById('selectedProgNotice');
    const countLabel = document.getElementById('progCountLabel');

    let filteredPrograms = [...sortedPrograms];
    let selectedProgId = '';

    function renderProgramCards() {
        if (countLabel) {
            countLabel.textContent = `Showing ${filteredPrograms.length} of ${sortedPrograms.length} programs`;
        }

        if (filteredPrograms.length === 0) {
            gridEl.innerHTML = `
                <div style="grid-column: 1 / -1; padding:3rem 1.5rem; text-align:center; color:#64748b;">
                    <div style="font-size:2rem; margin-bottom:0.4rem;">🔍</div>
                    <h4 style="margin:0 0 0.25rem 0; font-weight:700; color:#1e293b;">No programs match the selected filters</h4>
                    <p style="margin:0; font-size:0.85rem;">Try clearing or adjusting your search and filter options.</p>
                </div>
            `;
            return;
        }

        gridEl.innerHTML = filteredPrograms.map(p => {
            const isSelected = p.id === selectedProgId;
            const catName = getProgramCategoryName(p) || 'General';
            const genderVal = p.genderCategory || p.gender || 'Mixed';
            const typeName = p.programType ? (p.programType.charAt(0).toUpperCase() + p.programType.slice(1)) : 'Individual';
            const locVal = getProgramLocation(p);

            return `
                <div class="add-prog-card ${isSelected ? 'selected' : ''}" data-id="${p.id}" style="
                    background: ${isSelected ? '#e0e7ff' : '#ffffff'};
                    border: 2px solid ${isSelected ? '#4338ca' : '#cbd5e1'};
                    border-radius: 12px;
                    padding: 12px 14px;
                    cursor: pointer;
                    transition: all 0.15s ease;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    box-shadow: ${isSelected ? '0 4px 12px rgba(67, 56, 202, 0.15)' : 'none'};
                ">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                        <div style="font-weight:800; font-size:0.925rem; color:#0f172a; line-height:1.3;">
                            ${p.programNumber ? `<span style="color:#4338ca; background:#eeefee; padding:2px 6px; border-radius:6px; margin-right:6px; font-size:0.85rem; font-weight:800;">[#${window.escapeHTML(String(p.programNumber))}]</span>` : ''}
                            <span>${window.escapeHTML(p.programName)}</span>
                        </div>
                        ${isSelected ? `<span style="background:#4338ca; color:#ffffff; width:20px; height:20px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:0.75rem; font-weight:bold; flex-shrink:0;">✓</span>` : ''}
                    </div>
                    <div style="display:flex; flex-wrap:wrap; gap:5px; align-items:center; margin-top:2px;">
                        <span class="sched-cat-badge" style="background:#f1f5f9; color:#334155; border-color:#cbd5e1; font-weight:700;">
                            🏷️ ${window.escapeHTML(catName)}
                        </span>
                        <span class="sched-cat-badge" style="background:#f0fdf4; color:#166534; border-color:#bbf7d0; font-weight:700;">
                            👤 ${window.escapeHTML(genderVal)}
                        </span>
                        <span class="sched-cat-badge" style="background:#fefce8; color:#854d0e; border-color:#fef08a; font-weight:700;">
                            👥 ${window.escapeHTML(typeName)}
                        </span>
                        <span class="sched-cat-badge" style="background:${locVal === 'Stage' ? '#eff6ff' : '#faf5ff'}; color:${locVal === 'Stage' ? '#1d4ed8' : '#7e22ce'}; border-color:${locVal === 'Stage' ? '#bfdbfe' : '#e9d5ff'}; font-weight:700;">
                            ${locVal === 'Stage' ? '🎪 Stage' : '📝 Off Stage'}
                        </span>
                    </div>
                </div>
            `;
        }).join('');

        // Attach click and double click handlers to cards
        gridEl.querySelectorAll('.add-prog-card').forEach(card => {
            card.onclick = () => {
                const id = card.dataset.id;
                selectProgramCard(id);
            };
            card.ondblclick = () => {
                const id = card.dataset.id;
                selectProgramCard(id);
                document.getElementById('addProgSlotForm').requestSubmit();
            };
        });
    }

    function selectProgramCard(id) {
        selectedProgId = id;
        hiddenInput.value = id;
        const prog = sortedPrograms.find(p => p.id === id);

        if (prog) {
            submitBtn.disabled = false;
            selectedNotice.textContent = `Selected: ${prog.programNumber ? `[#${prog.programNumber}] ` : ''}${prog.programName}`;
        } else {
            submitBtn.disabled = true;
            selectedNotice.textContent = "No program selected";
        }

        renderProgramCards();
    }

    function applyFilters() {
        const query = searchInput.value.toLowerCase().trim();
        const selectedCat = categoryFilter.value;
        const selectedGen = genderFilter.value;
        const selectedLoc = locationFilter.value;

        filteredPrograms = sortedPrograms.filter(p => {
            // 1. Category Filter
            if (selectedCat) {
                const pCat = getProgramCategoryName(p) || 'General';
                if (pCat !== selectedCat) return false;
            }

            // 2. Gender Filter
            if (selectedGen) {
                const pGen = (p.genderCategory || p.gender || 'Mixed').trim();
                if (pGen.toLowerCase() !== selectedGen.toLowerCase()) return false;
            }

            // 3. Location Filter
            if (selectedLoc) {
                const pLoc = getProgramLocation(p);
                if (pLoc !== selectedLoc) return false;
            }

            // 4. Search Query
            if (query) {
                const nameStr = String(p.programName || '').toLowerCase();
                const numStr = String(p.programNumber ?? '').toLowerCase();
                const nameMatch = nameStr.includes(query);
                const numMatch = numStr.includes(query);
                const bothCombined = `${numStr} ${nameStr}`.includes(query);
                if (!nameMatch && !numMatch && !bothCombined) return false;
            }

            return true;
        });

        renderProgramCards();
    }

    categoryFilter.onchange = applyFilters;
    genderFilter.onchange = applyFilters;
    locationFilter.onchange = applyFilters;
    searchInput.oninput = applyFilters;

    const closeModal = () => {
        modalOverlay.classList.add('hidden');
        if (modalContainer) {
            modalContainer.classList.remove('add-program-modal-container');
        }
    };
    document.getElementById('closeDynamicModalBtn').onclick = closeModal;

    // Render initial cards grid
    renderProgramCards();

    // Form submit handler
    document.getElementById('addProgSlotForm').onsubmit = async (e) => {
        e.preventDefault();
        const progId = hiddenInput.value;
        if (!progId) {
            window.showToast("Please select a program card first.", "error");
            return;
        }

        const dur = parseInt(document.getElementById('selProgDur').value, 10) || 20;
        const prog = sortedPrograms.find(p => p.id === progId);
        if (!prog) return;

        submitBtn.disabled = true;

        try {
            const activeItems = mergedSchedules.filter(s => s.stage === activeStage);
            const isOff = activeStage.toLowerCase().includes('off stage');

            const newDocRef = doc(collection(db, "institutes", window.currentInstituteId, "schedules"));
            await setDoc(newDocRef, {
                programId: progId,
                programName: prog.programName || 'Unnamed Program',
                stage: activeStage,
                scheduleDate: stageConfigs[activeStage]?.date || new Date().toISOString().split('T')[0],
                duration: dur,
                runningOrder: activeItems.length + 1,
                status: 'Pending',
                isOffStage: isOff,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });

            window.showToast(`✓ Program "${prog.programName}" added to ${activeStage}`);

            // Preserve current scroll position of cards grid
            const currentScrollTop = gridEl.scrollTop;

            // Remove newly scheduled program from available list in memory
            const addedIdx = sortedPrograms.findIndex(p => p.id === progId);
            if (addedIdx !== -1) {
                sortedPrograms.splice(addedIdx, 1);
            }

            // Reset current selection state so next program can be selected
            selectedProgId = '';
            hiddenInput.value = '';
            selectedNotice.textContent = "No program selected";

            // Re-apply existing filters & search without resetting filter fields
            applyFilters();

            // Restore scroll position
            gridEl.scrollTop = currentScrollTop;
        } catch (err) {
            console.error("Error adding program to schedule:", err);
            window.showToast("Failed to add program slot.", "error");
            submitBtn.disabled = false;
        }
    };
}

async function duplicateRowSlot(id) {
    const item = mergedSchedules.find(s => s.id === id);
    if (!item) return;

    const activeItems = mergedSchedules.filter(s => s.stage === activeStage);
    const newDocRef = doc(collection(db, "institutes", window.currentInstituteId, "schedules"));
    await setDoc(newDocRef, {
        isBreak: !!item.isBreak,
        breakTitle: item.breakTitle || item.programName || '',
        programId: item.programId || '',
        programName: item.isBreak ? `${item.programName} (Copy)` : `${item.programName} (Copy)`,
        stage: activeStage,
        scheduleDate: item.scheduleDate,
        duration: item.duration,
        runningOrder: activeItems.length + 1,
        status: 'Pending',
        isOffStage: item.isOffStage,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });
    window.showToast(item.isBreak ? "Break slot duplicated." : "Slot duplicated.");
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
        if (item.isBreak) {
            const icon = getBreakIcon(item.programName);
            msg += `*${idx + 1}. ${icon} ${item.programName} [BREAK]*\n`;
            msg += `   ⏱️ ${formatTimeTo12Hour(item.startTime || 'TBD')} - ${formatTimeTo12Hour(item.endTime || 'TBD')} (${item.duration}m) | Status: ${item.status}\n\n`;
        } else {
            msg += `*${idx + 1}. ${item.programNumber ? `[#${item.programNumber}] ` : ''}${item.programName}*\n`;
            msg += `   🏷️ Category: ${item.categoryName || 'Uncategorized'}\n`;
            msg += `   ⏱️ ${formatTimeTo12Hour(item.startTime || 'TBD')} - ${formatTimeTo12Hour(item.endTime || 'TBD')} (${item.duration}m) | Status: ${item.status}\n\n`;
        }
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
        rowsHTML = `<tr><td colspan="5" style="text-align:center; padding:15px; color:#64748b;">No programs scheduled for this stage.</td></tr>`;
    } else {
        rowsHTML = activeItems.map((item, idx) => {
            if (item.isBreak) {
                const icon = getBreakIcon(item.programName);
                return `
                    <tr style="background-color: #fffbeb;">
                        <td style="text-align:center; font-weight:700; color:#b45309; padding:6px 10px; border:1px solid #cbd5e1; font-size:12px;">${idx + 1}</td>
                        <td style="padding:6px 10px; border:1px solid #cbd5e1; color:#78350f; word-wrap:break-word;">
                            <div style="font-weight:800; font-size:13px; line-height:1.25; color:#78350f;">
                                ${icon} ${window.escapeHTML(item.programName)} <span style="font-size:10px; background:#fef3c7; color:#92400e; padding:1px 6px; border-radius:4px; margin-left:6px; border:1px solid #fde68a; font-weight:800;">BREAK</span>
                            </div>
                        </td>
                        <td style="text-align:center; color:#b45309; font-weight:600; padding:6px 10px; border:1px solid #cbd5e1; font-size:12px;">${item.duration} mins</td>
                        <td style="text-align:center; font-weight:700; padding:6px 10px; border:1px solid #cbd5e1; color:#b45309; font-size:12px;">${item.startTime || '—'}</td>
                        <td style="text-align:center; font-weight:700; padding:6px 10px; border:1px solid #cbd5e1; color:#b45309; font-size:12px;">${item.endTime || '—'}</td>
                    </tr>
                `;
            }

            return `
                <tr>
                    <td style="text-align:center; font-weight:700; color:#334155; padding:6px 10px; border:1px solid #cbd5e1; font-size:12px;">${idx + 1}</td>
                    <td style="padding:6px 10px; border:1px solid #cbd5e1; color:#0f172a; word-wrap:break-word;">
                        <div style="font-weight:700; font-size:13px; line-height:1.25; color:#0f172a;">
                            ${item.programNumber ? `<span style="color:#3730a3; font-weight:800; margin-right:4px;">[#${item.programNumber}]</span>` : ''}${window.escapeHTML(item.programName)}
                        </div>
                        <div style="font-size:10.5px; color:#64748b; font-weight:500; margin-top:2px; line-height:1.2;">
                            ${window.escapeHTML(item.categoryName || 'Uncategorized')}
                        </div>
                    </td>
                    <td style="text-align:center; color:#334155; font-weight:600; padding:6px 10px; border:1px solid #cbd5e1; font-size:12px;">${item.duration} mins</td>
                    <td style="text-align:center; font-weight:700; padding:6px 10px; border:1px solid #cbd5e1; color:#1e40af; font-size:12px;">${item.startTime || '—'}</td>
                    <td style="text-align:center; font-weight:700; padding:6px 10px; border:1px solid #cbd5e1; color:#1e40af; font-size:12px;">${item.endTime || '—'}</td>
                </tr>
            `;
        }).join('');
    }

    const printHTML = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>${window.escapeHTML(instName)} - ${window.escapeHTML(activeStage)} Schedule</title>
            <style>
                @page {
                    size: A4 portrait;
                    margin: 12mm 15mm;
                }
                * {
                    box-sizing: border-box;
                }
                body {
                    font-family: 'Inter', system-ui, -apple-system, sans-serif;
                    margin: 0;
                    padding: 15px;
                    color: #0f172a;
                    background: #ffffff;
                    -webkit-print-color-adjust: exact !important;
                    print-color-adjust: exact !important;
                }
                .print-container {
                    width: 100%;
                    margin: 0 auto;
                }
                .print-header {
                    text-align: center;
                    margin-bottom: 18px;
                    border-bottom: 3px double #0f172a;
                    padding-bottom: 12px;
                }
                .print-header h1 {
                    margin: 0 0 4px 0;
                    font-size: 22px;
                    text-transform: uppercase;
                    color: #1e1b4b;
                    letter-spacing: 0.04em;
                    font-weight: 800;
                }
                .print-header h2 {
                    margin: 0 0 6px 0;
                    font-size: 16px;
                    color: #4338ca;
                    font-weight: 700;
                    letter-spacing: 0.03em;
                }
                .print-header p {
                    margin: 0;
                    font-size: 13px;
                    color: #475569;
                    font-weight: 600;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 10px;
                    font-size: 13px;
                    table-layout: fixed;
                }
                th {
                    background-color: #f8fafc;
                    color: #334155;
                    padding: 8px 10px;
                    border: 1px solid #cbd5e1;
                    text-transform: uppercase;
                    font-size: 11px;
                    letter-spacing: 0.05em;
                    font-weight: 800;
                }
                td {
                    padding: 6px 10px;
                    border: 1px solid #cbd5e1;
                    vertical-align: middle;
                }
                .footer {
                    margin-top: 25px;
                    display: flex;
                    justify-content: space-between;
                    font-size: 11px;
                    color: #64748b;
                    border-top: 1px solid #e2e8f0;
                    padding-top: 8px;
                }
            </style>
        </head>
        <body>
            <div class="print-container">
                <div class="print-header">
                    <h1>${window.escapeHTML(instName)}</h1>
                    <h2>COMPETITION SCHEDULE - ${window.escapeHTML(activeStage.toUpperCase())}</h2>
                    <p>Date: ${window.escapeHTML(stageDate)} &nbsp;|&nbsp; Total Programs: ${activeItems.length}</p>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th style="width:50px; text-align:center;">SL#</th>
                            <th style="text-align:left;">PROGRAM NAME</th>
                            <th style="width:95px; text-align:center;">DURATION</th>
                            <th style="width:105px; text-align:center;">START TIME</th>
                            <th style="width:105px; text-align:center;">END TIME</th>
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
