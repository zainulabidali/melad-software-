import { db, getCachedCategories, getCachedTeams, getCachedPrograms } from './firebase.js';
import {
    collection, doc, getDoc, getDocs, onSnapshot, serverTimestamp, addDoc, deleteDoc, updateDoc, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { normalizeClasses } from './categories.js';

// Helper to format category slugs and key names into beautifully capitalized human-readable titles
function formatLabel(str) {
    if (!str) return 'General';
    return str
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

// ─────────────────────────────────────────────
// Module State
// ─────────────────────────────────────────────
let allPrograms = [];
let allCategories = [];
let allTeams = [];
let allAwardTypes = [];
let unsubscribeExports = null;
let exportsList = [];

// Filter / Search states
let searchVal = '';
let filterTypeVal = '';
let filterStatusVal = '';
let sortByVal = 'newest';

// Team Background Manager state
let teamBackgroundsCache = {};
let isTeamBgEnabled = false;

async function ensureEventDetailsLoaded(force = false) {
    if ((!window.currentEventDetails || force) && window.currentInstituteId) {
        try {
            const configSnap = await getDoc(doc(db, "institutes", window.currentInstituteId, "metadata", "eventConfig"));
            if (configSnap.exists()) {
                window.currentEventDetails = configSnap.data();
            }
        } catch (err) {
            console.error("Error loading eventConfig in exports:", err);
        }
    }
}

function getEventName() {
    const evName = window.currentEventDetails?.eventName?.trim();
    if (evName) return evName;
    const instName = window.currentInstituteDetails?.name?.trim();
    if (instName) return instName;
    return 'ADMIN PORTAL';
}

function loadTeamBackgrounds() {
    try {
        const stored = localStorage.getItem('meelad_team_card_backgrounds');
        if (stored) {
            teamBackgroundsCache = JSON.parse(stored);
        } else {
            teamBackgroundsCache = {};
        }
    } catch (e) {
        console.error("Failed to load team backgrounds from LocalStorage:", e);
        teamBackgroundsCache = {};
    }
}

function resizeImageIfNeeded(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function (e) {
            const img = new Image();
            img.onload = function () {
                const maxDim = 1200;
                let width = img.width;
                let height = img.height;

                if (file.size > 5 * 1024 * 1024 || width > maxDim || height > maxDim) {
                    if (width > height) {
                        if (width > maxDim) {
                            height = Math.round((height * maxDim) / width);
                            width = maxDim;
                        }
                    } else {
                        if (height > maxDim) {
                            width = Math.round((width * maxDim) / height);
                            height = maxDim;
                        }
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                let outputType = 'image/jpeg';
                if (file.type === 'image/webp') outputType = 'image/webp';
                else if (file.type === 'image/png') {
                    if (file.size > 2 * 1024 * 1024) {
                        outputType = 'image/jpeg';
                    } else {
                        outputType = 'image/png';
                    }
                }

                const dataURL = canvas.toDataURL(outputType, 0.8);
                resolve(dataURL);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function updateTeamCardUI(teamId) {
    const previewDiv = document.getElementById(`preview-${teamId}`);
    const btnChoose = document.getElementById(`btn-choose-${teamId}`);
    const btnReplace = document.getElementById(`btn-replace-${teamId}`);
    const btnRemove = document.getElementById(`btn-remove-${teamId}`);

    const base64 = teamBackgroundsCache[teamId];
    if (base64) {
        if (previewDiv) {
            previewDiv.innerHTML = `<img src="${base64}" alt="Team Background" />`;
            previewDiv.style.borderStyle = 'solid';
        }
        if (btnChoose) btnChoose.style.display = 'none';
        if (btnReplace) btnReplace.style.display = 'block';
        if (btnRemove) btnRemove.style.display = 'block';
    } else {
        if (previewDiv) {
            previewDiv.innerHTML = '<span>No Custom Background</span>';
            previewDiv.style.borderStyle = 'dashed';
        }
        if (btnChoose) btnChoose.style.display = 'block';
        if (btnReplace) btnReplace.style.display = 'none';
        if (btnRemove) btnRemove.style.display = 'none';
    }
}

function renderTeamBgCards() {
    const grid = document.getElementById('teamBgGrid');
    if (!grid) return;

    grid.innerHTML = '';

    allTeams.forEach(t => {
        const card = document.createElement('div');
        card.className = 'team-bg-card';
        card.innerHTML = `
            <div style="font-weight: 700; color: #1e1b4b; font-size: 0.85rem;">${window.escapeHTML(t.name)}</div>
            <div class="team-bg-preview" id="preview-${t.id}">
                <span>No Custom Background</span>
            </div>
            <div class="team-bg-actions">
                <input type="file" id="file-${t.id}" accept="image/png, image/jpeg, image/jpg, image/webp" style="display:none;" />
                <button type="button" class="btn-choose-bg" id="btn-choose-${t.id}">Choose Image</button>
                <button type="button" class="btn-replace-bg" id="btn-replace-${t.id}" style="display:none;">Replace Image</button>
                <button type="button" class="btn-remove-bg" id="btn-remove-${t.id}" style="display:none;">Remove Image</button>
            </div>
        `;
        grid.appendChild(card);

        const fileInput = card.querySelector(`#file-${t.id}`);
        const btnChoose = card.querySelector(`#btn-choose-${t.id}`);
        const btnReplace = card.querySelector(`#btn-replace-${t.id}`);
        const btnRemove = card.querySelector(`#btn-remove-${t.id}`);

        btnChoose.onclick = () => fileInput.click();
        btnReplace.onclick = () => fileInput.click();

        btnRemove.onclick = () => {
            if (confirm(`Are you sure you want to remove the custom background for team "${t.name}"?`)) {
                delete teamBackgroundsCache[t.id];
                localStorage.setItem('meelad_team_card_backgrounds', JSON.stringify(teamBackgroundsCache));
                updateTeamCardUI(t.id);
                window.showToast(`Custom background for team "${t.name}" removed.`);
            }
        };

        fileInput.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
            if (!allowedTypes.includes(file.type)) {
                window.showToast('Unsupported image format. Please upload PNG, JPG, JPEG, or WEBP.', 'error');
                return;
            }

            window.showToast('Processing image...', 'info');
            try {
                const base64Str = await resizeImageIfNeeded(file);
                teamBackgroundsCache[t.id] = base64Str;
                localStorage.setItem('meelad_team_card_backgrounds', JSON.stringify(teamBackgroundsCache));
                updateTeamCardUI(t.id);
                window.showToast(`Custom background for team "${t.name}" uploaded successfully.`);
            } catch (err) {
                console.error(err);
                window.showToast('Failed to process image.', 'error');
            }
        };

        updateTeamCardUI(t.id);
    });
}

// ─────────────────────────────────────────────
// Styles Injection (Localized SaaS CSS Grid)
// ─────────────────────────────────────────────
function injectExportStyles() {
    let style = document.getElementById('export-module-styles');
    if (style) return;

    style = document.createElement('style');
    style.id = 'export-module-styles';
    style.innerHTML = `
        /* Dynamic Stats Grid */
        .exp-stats-container {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1.25rem;
            margin-bottom: 1.5rem;
            width: 100%;
        }
        .exp-stat-card {
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 16px;
            padding: 1.25rem;
            display: flex;
            align-items: center;
            gap: 1rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.02);
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .exp-stat-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
        }
        .exp-stat-icon {
            font-size: 2.25rem;
            padding: 0.5rem;
            background: #e0e7ff;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #4338ca;
            width: 48px;
            height: 48px;
            box-sizing: border-box;
        }
        .exp-stat-info {
            display: flex;
            flex-direction: column;
        }
        .exp-stat-val {
            font-size: 1.75rem;
            font-weight: 800;
            color: #1e1b4b;
            line-height: 1.1;
        }
        .exp-stat-label {
            font-size: 0.72rem;
            font-weight: 700;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-top: 0.25rem;
        }

        /* Control Panel Filters Bar */
        .exp-controls-bar {
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 16px;
            padding: 1.25rem;
            display: flex;
            flex-wrap: wrap;
            gap: 1rem;
            align-items: center;
            box-shadow: 0 1px 2px rgba(0,0,0,0.01);
            margin-bottom: 1.5rem;
            width: 100%;
            box-sizing: border-box;
        }
        .exp-control-group {
            flex: 1;
            min-width: 180px;
            display: flex;
            flex-direction: column;
            gap: 0.4rem;
        }
        .exp-control-label {
            font-size: 0.72rem;
            font-weight: 800;
            color: #475569;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .exp-input {
            width: 100%;
            padding: 0.6rem 0.8rem;
            background: #f8fafc;
            border: 1px solid #cbd5e1;
            border-radius: 10px;
            font-size: 0.85rem;
            font-family: inherit;
            font-weight: 600;
            color: #1e293b;
            outline: none;
            transition: all 0.2s;
            box-sizing: border-box;
        }
        .exp-input:focus {
            border-color: #4338ca;
            background: #ffffff;
            box-shadow: 0 0 0 3px rgba(67, 56, 202, 0.1);
        }

        /* Mobile Logs Stack */
        .exp-mobile-logs {
            display: none;
            flex-direction: column;
            gap: 1rem;
            width: 100%;
        }
        .exp-mobile-card {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 16px;
            padding: 1.25rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.01);
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
        }
        .exp-mobile-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .exp-mobile-label {
            font-size: 0.75rem;
            font-weight: 700;
            color: #64748b;
        }
        .exp-mobile-val {
            font-size: 0.85rem;
            font-weight: 600;
            color: #1e293b;
        }
        .exp-mobile-actions {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 0.5rem;
            margin-top: 0.5rem;
        }
        .exp-mobile-actions button {
            min-height: 40px; /* touch friendly */
            font-size: 0.8rem !important;
        }
        .exp-mobile-actions .btn-delete-exp {
            grid-column: span 2;
            min-height: 40px;
        }

        /* Modal Redesign Visual Layout */
        .exp-drawer-inner {
            display: flex;
            flex-direction: row;
            gap: 1.5rem;
            flex: 1;
            overflow: hidden;
            width: 100%;
        }
        .exp-type-cards {
            width: 40%;
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
            overflow-y: auto;
        }
        .exp-params-panel {
            flex: 1;
            border: 1px solid #cbd5e1;
            border-radius: 16px;
            background: #f8fafc;
            padding: 1.5rem;
            display: flex;
            flex-direction: column;
            gap: 1.25rem;
            overflow-y: auto;
        }
        .exp-type-card {
            background: #ffffff;
            border: 2px solid #e2e8f0;
            border-radius: 14px;
            padding: 1rem;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 1rem;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .exp-type-card:hover {
            transform: translateY(-1px);
            border-color: #cbd5e1;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.03);
        }
        .exp-type-card.active {
            border-color: #4338ca;
            background: #f5f3ff;
            box-shadow: 0 4px 12px rgba(67, 56, 202, 0.06);
        }

        /* Desktop specific visual fixes */
        .exp-desktop-table th, .exp-desktop-table td {
            padding: 0.85rem 1rem !important;
            vertical-align: middle;
        }
        .exp-action-btn-cluster {
            display: inline-flex;
            gap: 0.5rem;
            justify-content: center;
            align-items: center;
        }
        .exp-action-btn-cluster button {
            min-height: 38px;
            padding: 0.35rem 0.85rem !important;
            font-size: 0.8rem;
            font-weight: 700 !important;
            border-radius: 8px !important;
        }

        /* Media Queries for Mobile Stacking */
        @media (max-width: 767px) {
            .exp-desktop-table {
                display: none !important;
            }
            .exp-mobile-logs {
                display: flex !important;
            }
            .exp-drawer-inner {
                flex-direction: column !important;
                overflow-y: auto !important;
            }
            .exp-type-cards {
                width: 100% !important;
                overflow-y: visible !important;
            }
            .exp-params-panel {
                width: 100% !important;
                overflow-y: visible !important;
                padding: 1rem !important;
            }
        }

        /* Team Background Manager Styling */
        #teamBgGrid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 0.75rem;
            width: 100%;
        }
        @media (max-width: 767px) {
            #teamBgGrid {
                grid-template-columns: 1fr;
            }
        }
        .team-bg-card {
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 12px;
            padding: 0.85rem;
            display: flex;
            flex-direction: column;
            gap: 0.65rem;
            box-shadow: 0 1px 2px rgba(0,0,0,0.02);
            box-sizing: border-box;
        }
        .team-bg-preview {
            width: 100%;
            height: 100px;
            border-radius: 8px;
            border: 1.5px dashed #cbd5e1;
            background-color: #f8fafc;
            background-size: cover;
            background-position: center;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #64748b;
            font-size: 0.7rem;
            font-weight: 700;
            overflow: hidden;
            box-sizing: border-box;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .team-bg-preview img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
        .team-bg-actions {
            display: flex;
            gap: 0.5rem;
            width: 100%;
        }
        .team-bg-actions button {
            flex: 1;
            min-height: 32px;
            padding: 0.25rem 0.5rem;
            font-size: 0.72rem;
            font-weight: 700;
            border-radius: 6px;
            cursor: pointer;
            border: 1px solid #cbd5e1;
            background: #ffffff;
            color: #475569;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 1px 2px rgba(0,0,0,0.01);
        }
        .team-bg-actions button:hover {
            background: #f1f5f9;
            color: #1e293b;
        }
        .team-bg-actions .btn-remove-bg {
            color: #ef4444;
            border-color: #fca5a5;
            background: #fef2f2;
        }
        .team-bg-actions .btn-remove-bg:hover {
            background: #fee2e2;
            color: #dc2626;
        }
    `;
    document.head.appendChild(style);
}

// ─────────────────────────────────────────────
// Hidden Printing Iframe Creator
// ─────────────────────────────────────────────
function getPrintIframe() {
    let iframe = document.getElementById('exportPrintIframe');
    if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'exportPrintIframe';
        iframe.style.position = 'fixed';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = 'none';
        iframe.style.left = '-9999px';
        iframe.style.top = '-9999px';
        document.body.appendChild(iframe);
    }
    return iframe;
}

// ─────────────────────────────────────────────
// Init View
// ─────────────────────────────────────────────
function getSafeTeamName(item, studentMap, teamNamesMap) {
    if (!item) return '—';
    let tId = item.teamId;

    // Fallback to studentMap if participant document lacks teamId
    if (!tId) {
        if (item.isGroup && item.members && item.members.length > 0) {
            const stu = item.members[0].studentId ? studentMap[item.members[0].studentId] : null;
            if (stu) tId = stu.teamId;
        } else if (!item.isGroup && item.studentId) {
            const stu = studentMap[item.studentId];
            if (stu) tId = stu.teamId;
        }
    }

    if (tId && teamNamesMap && teamNamesMap[String(tId)]) {
        return teamNamesMap[String(tId)];
    }

    return item.teamName || '—';
}
export async function initExportsView(container, topActions) {
    if (!window.currentInstituteId) {
        container.innerHTML = '<div class="empty-state"><h3>Access Denied</h3><p>Please log in again.</p></div>';
        return;
    }

    injectExportStyles();

    if (unsubscribeExports) {
        unsubscribeExports();
        unsubscribeExports = null;
    }

    // Top actions button rendering
    topActions.innerHTML = `
        <div style="display:inline-flex; gap:0.5rem; align-items:center;">
            <button class="btn btn-secondary" id="syncCachesBtn" style="font-weight:700;">
                🔄 Sync Caches
            </button>
            <button class="btn btn-primary" id="newExportBtn" style="font-weight:700;">
                📥 + New Export
            </button>
        </div>
    `;

    // Render Scaffolding with dynamic Statistics Grid and Filters Bar
    container.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:1.5rem; width:100%; box-sizing:border-box;">
            <!-- Header banner -->
            <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:16px; padding:1rem 1.25rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
                <div>
                    <h3 style="margin:0; font-size:1.15rem; font-weight:800; color:#1e1b4b;">📤 Event Exports Center</h3>
                    <p style="margin:0.2rem 0 0 0; font-size:0.8rem; color:#64748b; font-weight:600;">SaaS-Grade Tournament Document Generation Center.</p>
                </div>
            </div>

            <!-- Stats grid -->
            <div class="exp-stats-container" id="exportStatsRow">
                <!-- Injected dynamically -->
            </div>

            <!-- Filters & Controls Bar -->
            <div class="exp-controls-bar">
                <div class="exp-control-group" style="flex: 2;">
                    <label class="exp-control-label">Search Filename or Scope</label>
                    <input type="text" id="expSearchInput" class="exp-input" placeholder="Type here to search..." value="${window.escapeHTML(searchVal)}">
                </div>
                <div class="exp-control-group">
                    <label class="exp-control-label">Export Type</label>
                    <select id="expFilterType" class="exp-input">
                        <option value="">All Types</option>
                        <option value="Green Room Sign">Green Room Sign</option>
                        <option value="Valuation Sheet">Valuation Sheet</option>
                        <option value="Call List">Call List</option>
                        <option value="Chest Number List">Chest Number List</option>
                        <option value="Program Participation Register">Program Participation Register</option>
                        <option value="Results">Results Reports</option>
                    </select>
                </div>
                <div class="exp-control-group">
                    <label class="exp-control-label">Status</label>
                    <select id="expFilterStatus" class="exp-input">
                        <option value="">All Statuses</option>
                        <option value="Pending">⌛ Pending</option>
                        <option value="Processing">⚙️ Processing</option>
                        <option value="Completed">✅ Completed</option>
                        <option value="Failed">❌ Failed</option>
                    </select>
                </div>
                <div class="exp-control-group">
                    <label class="exp-control-label">Sort Date</label>
                    <select id="expSortSelect" class="exp-input">
                        <option value="newest">Newest First</option>
                        <option value="oldest">Oldest First</option>
                    </select>
                </div>
            </div>

            <!-- History Logs Grid/List -->
            <div class="card" style="padding:1.25rem; border-color:#cbd5e1; width:100%; box-shadow:0 1px 3px rgba(0,0,0,0.05); box-sizing:border-box;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.25rem;">
                    <h3 style="font-size:1rem; font-weight:800; color:#0f172a; margin:0; display:flex; align-items:center; gap:0.4rem;">
                        📜 Export History Logs
                    </h3>
                    <button id="btnClearExportHistory" class="btn btn-danger btn-sm" style="min-height:28px; padding:0 0.75rem; font-size:0.75rem; font-weight:700; display:flex; align-items:center; gap:0.25rem;" disabled>
                        🗑️ Clear
                    </button>
                </div>
                
                <!-- Desktop Table Grid -->
                <div class="exp-desktop-table" style="overflow-x:auto; background:#fff; border:1px solid #e2e8f0; border-radius:12px; width:100%;">
                    <table style="width:100%; border-collapse:collapse; min-width:850px; font-size:0.85rem; color:#1e293b;">
                        <thead>
                            <tr style="background:#f8fafc; border-bottom:2px solid #cbd5e1; text-align:left;">
                                <th style="color:#475569; font-weight:700;">Export Type</th>
                                <th style="color:#475569; font-weight:700;">Scope</th>
                                <th style="color:#475569; font-weight:700; width:170px;">Created Date</th>
                                <th style="color:#475569; font-weight:700; width:140px; text-align:center;">Generated By</th>
                                <th style="color:#475569; font-weight:700; width:140px; text-align:center;">Status</th>
                                <th style="color:#475569; font-weight:700; width:220px; text-align:center;">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="exportHistoryBody">
                            <tr><td colspan="6" style="text-align:center; padding:2rem; color:#64748b;">Loading history...</td></tr>
                        </tbody>
                    </table>
                </div>

                <!-- Mobile Responsive Cards Stack -->
                <div class="exp-mobile-logs" id="exportHistoryMobile">
                    <!-- Cards injected dynamically -->
                </div>
            </div>
        </div>
    `;

    // Bind triggers
    document.getElementById("newExportBtn").onclick = openExportDrawer;
    document.getElementById("syncCachesBtn").onclick = async () => {
        const btn = document.getElementById("syncCachesBtn");
        btn.disabled = true;
        btn.textContent = '⏳ Syncing...';
        await loadStaticData(true);
        btn.disabled = false;
        btn.textContent = '🔄 Sync Caches';
        window.showToast("Caches successfully refreshed!", "success");
    };

    // Filter events
    const sInput = document.getElementById("expSearchInput");
    sInput.oninput = (e) => {
        searchVal = e.target.value;
        renderHistoryLogs();
    };

    const fType = document.getElementById("expFilterType");
    fType.value = filterTypeVal;
    fType.onchange = (e) => {
        filterTypeVal = e.target.value;
        renderHistoryLogs();
    };

    const fStatus = document.getElementById("expFilterStatus");
    fStatus.value = filterStatusVal;
    fStatus.onchange = (e) => {
        filterStatusVal = e.target.value;
        renderHistoryLogs();
    };

    const sSort = document.getElementById("expSortSelect");
    sSort.value = sortByVal;
    sSort.onchange = (e) => {
        sortByVal = e.target.value;
        renderHistoryLogs();
    };

    const clearBtn = document.getElementById("btnClearExportHistory");
    if (clearBtn) {
        clearBtn.onclick = async () => {
            const confirmed = await window.customConfirm(
                "Are you sure you want to clear all export history logs?",
                "Confirm Action",
                { danger: true, okText: "Clear All", cancelText: "Cancel" }
            );
            if (!confirmed) return;

            clearBtn.disabled = true;
            clearBtn.textContent = '⏳ Clearing...';

            try {
                const instId = window.currentInstituteId;
                const querySnap = await getDocs(collection(db, "institutes", instId, "exports"));

                const deletePromises = querySnap.docs.map(docSnap =>
                    deleteDoc(doc(db, "institutes", instId, "exports", docSnap.id))
                );
                await Promise.all(deletePromises);

                window.showToast("Export history cleared successfully.", "success");
            } catch (err) {
                console.error("Failed to clear export history:", err);
                window.showToast("Failed to clear export history.", "error");
            } finally {
                clearBtn.disabled = false;
                clearBtn.innerHTML = '🗑️ Clear';
            }
        };
    }

    // Scroll handler to close fixed menus when scrolling to prevent floating drifts
    const handleScroll = () => {
        const activeDropdown = document.querySelector('.active-body-dropdown');
        if (activeDropdown) activeDropdown.remove();
    };
    window.addEventListener('scroll', handleScroll, true);

    window.currentViewCleanup = () => {
        if (unsubscribeExports) {
            unsubscribeExports();
            unsubscribeExports = null;
        }
        window.removeEventListener('scroll', handleScroll, true);
    };

    await loadStaticData();
    subscribeExportsHistory();
}

// ─────────────────────────────────────────────
// Caching Loader
// ─────────────────────────────────────────────
async function loadStaticData(force = false) {
    try {
        await ensureEventDetailsLoaded(force);
        const instId = window.currentInstituteId;

        // Categories Preloaded Memory Cache
        const categories = await getCachedCategories(instId, force) || [];
        allCategories = categories.map(c => ({
            id: c.id,
            ...c,
            classes: normalizeClasses(c.classes)
        }));

        // Programs Preloaded Memory Cache & type normalizer
        const programs = await getCachedPrograms(instId, force) || [];
        allPrograms = programs.map(p => {
            const pType = (p.programType || p.type || 'individual').toLowerCase();
            const regType = (pType === 'general') ? (p.registrationType || 'individual') : pType;
            return {
                id: p.id,
                programName: p.programName || 'Unnamed Program',
                programNumber: p.programNumber || '',
                programType: pType,
                type: regType === 'group' ? 'Group' : 'Individual',
                genderCategory: p.genderCategory || p.gender || 'Mixed',
                gender: p.gender || p.genderCategory || 'Mixed',
                programLocation: p.programLocation || p.location || 'Stage',
                categoryId: p.categoryId || '',
                categoryName: p.categoryName || p.categoryId || 'General',
                classId: p.classId || '',
                className: p.className || ''
            };
        });

        // Teams Preloaded Memory Cache
        allTeams = await getCachedTeams(instId, force) || [];

        // Load configured dynamic award types
        await refreshAwardTypesConfig();

    } catch (e) {
        console.error("Failed loading cached collections:", e);
    }
}

// ─────────────────────────────────────────────
// Real-Time Query History Subscription
// ─────────────────────────────────────────────
function subscribeExportsHistory() {
    const instId = window.currentInstituteId;
    // Set server-side dynamic limit of 60 documents to optimize reads
    const ref = query(
        collection(db, "institutes", instId, "exports"),
        orderBy("queuedAt", "desc"),
        limit(60)
    );

    unsubscribeExports = onSnapshot(ref, (snapshot) => {
        exportsList = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
        renderHistoryLogs();
        renderExportStats();
    });
}

// ─────────────────────────────────────────────
// Stat Indicators Aggregator
// ─────────────────────────────────────────────
function renderExportStats() {
    const row = document.getElementById('exportStatsRow');
    if (!row) return;

    const total = exportsList.length;

    // Today's Exports Calculator
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayCount = exportsList.filter(e => {
        if (!e.queuedAt) return false;
        const d = new Date(e.queuedAt.seconds * 1000);
        return d >= todayStart;
    }).length;

    // Formats count
    const pdfCount = exportsList.filter(e => e.fileName && e.fileName.toLowerCase().endsWith('.pdf')).length;
    const csvCount = exportsList.filter(e => e.fileName && e.fileName.toLowerCase().endsWith('.csv')).length;

    row.innerHTML = `
        <div class="exp-stat-card">
            <span class="exp-stat-icon">📦</span>
            <div class="exp-stat-info">
                <span class="exp-stat-val">${total}</span>
                <span class="exp-stat-label">Total Exports</span>
            </div>
        </div>
        <div class="exp-stat-card">
            <span class="exp-stat-icon" style="background:#fef3c7; color:#d97706;">📅</span>
            <div class="exp-stat-info">
                <span class="exp-stat-val" style="color:#d97706;">${todayCount}</span>
                <span class="exp-stat-label">Today's Logs</span>
            </div>
        </div>
        <div class="exp-stat-card">
            <span class="exp-stat-icon" style="background:#fee2e2; color:#dc2626;">📄</span>
            <div class="exp-stat-info">
                <span class="exp-stat-val" style="color:#dc2626;">${pdfCount}</span>
                <span class="exp-stat-label">PDF Prints</span>
            </div>
        </div>
        <div class="exp-stat-card">
            <span class="exp-stat-icon" style="background:#dcfce7; color:#15803d;">📊</span>
            <div class="exp-stat-info">
                <span class="exp-stat-val" style="color:#15803d;">${csvCount}</span>
                <span class="exp-stat-label">CSV Sheets</span>
            </div>
        </div>
    `;
}

// ─────────────────────────────────────────────
// Dashboard Elements Render
// ─────────────────────────────────────────────
function renderHistoryLogs() {
    const tbody = document.getElementById('exportHistoryBody');
    const mContainer = document.getElementById('exportHistoryMobile');
    if (!tbody || !mContainer) return;

    const clearBtn = document.getElementById("btnClearExportHistory");
    if (clearBtn) {
        clearBtn.disabled = exportsList.length === 0;
    }

    // Apply Client side filters
    let filtered = exportsList.filter(e => {
        if (filterTypeVal && e.type !== filterTypeVal) return false;
        if (filterStatusVal && e.status !== filterStatusVal) return false;
        if (searchVal) {
            const queryClean = searchVal.toLowerCase();
            const filename = (e.fileName || '').toLowerCase();
            const summary = (e.summary || '').toLowerCase();
            if (!filename.includes(queryClean) && !summary.includes(queryClean)) return false;
        }
        return true;
    });

    // Apply Client side Sorting
    filtered.sort((a, b) => {
        const secA = a.queuedAt?.seconds || 0;
        const secB = b.queuedAt?.seconds || 0;
        return sortByVal === 'newest' ? secB - secA : secA - secB;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:2.5rem; color:#64748b; font-weight:600;">No exports match the selected search/filters.</td></tr>`;
        mContainer.innerHTML = `<div style="text-align:center; padding:2rem; color:#64748b; font-weight:600;">No history logs found.</div>`;
        return;
    }

    // Helper: compile status badge html
    const getStatusBadge = (status) => {
        if (status === 'Pending') return '<span class="badge" style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1; font-weight:700;">⌛ Pending</span>';
        if (status === 'Processing') return '<span class="badge" style="background:#eff6ff; color:#1d4ed8; border:1px solid #93c5fd; font-weight:700;">⚙️ Processing</span>';
        if (status === 'Completed') return '<span class="badge" style="background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0; font-weight:700;">✅ Completed</span>';
        if (status === 'Failed') return '<span class="badge" style="background:#fef2f2; color:#dc2626; border:1px solid #fecaca; font-weight:700;">❌ Failed</span>';
        return `<span class="badge">${status}</span>`;
    };

    // Helper: resolve Scope information
    const getScopeHtml = (exp) => {
        const f = exp.filters || {};

        // Category Name
        let categoryName = 'All Categories';
        if (f.categoryId) {
            const catObj = allCategories.find(c => c.id === f.categoryId);
            categoryName = catObj ? catObj.name : (f.categoryId === 'general_programs' ? 'General' : f.categoryId);
        }

        // Gender Normalization
        let genderName = 'All Genders';
        if (f.gender) {
            const gLower = f.gender.toLowerCase();
            if (gLower.includes('boy') || gLower.includes('male')) {
                genderName = 'Boys';
            } else if (gLower.includes('girl') || gLower.includes('female')) {
                genderName = 'Girls';
            } else {
                genderName = f.gender;
            }
        }

        // Class Name
        let className = 'All Classes';
        if (f.classId) {
            let foundClass = '';
            if (f.categoryId) {
                const catObj = allCategories.find(c => c.id === f.categoryId);
                if (catObj && Array.isArray(catObj.classes)) {
                    const clsObj = catObj.classes.find(cls => cls.id === f.classId);
                    if (clsObj) foundClass = clsObj.name;
                }
            }
            if (!foundClass) {
                for (const cat of allCategories) {
                    if (Array.isArray(cat.classes)) {
                        const clsObj = cat.classes.find(cls => cls.id === f.classId);
                        if (clsObj) {
                            foundClass = clsObj.name;
                            break;
                        }
                    }
                }
            }
            className = foundClass ? `Class ${foundClass}` : `Class ${f.classId}`;
        }

        // Program Name
        let programName = 'All Programs';
        if (f.programId) {
            const progObj = allPrograms.find(p => p.id === f.programId);
            programName = progObj ? progObj.programName : f.programId;
        }

        // Team Name
        let teamName = 'All Teams';
        if (f.teamId) {
            const teamObj = allTeams.find(t => t.id === f.teamId);
            teamName = teamObj ? teamObj.name : f.teamId;
        }

        const line1 = `${categoryName} • ${genderName}`;
        const line2 = `${className} • ${programName} • ${teamName}`;

        return `
            <div style="font-weight:700; color:#1e1b4b; font-size:0.85rem;">${window.escapeHTML(line1)}</div>
            <div style="font-size:0.72rem; color:#64748b; font-weight:600; margin-top:0.15rem; white-space:normal; word-break:break-word;">${window.escapeHTML(line2)}</div>
        `;
    };

    // Helper: format Created Date
    const getFormattedDateHtml = (queuedAt) => {
        if (!queuedAt) return '—';
        const dateObj = new Date(queuedAt.seconds * 1000);
        const day = String(dateObj.getDate()).padStart(2, '0');
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');

        let hours = dateObj.getHours();
        const minutes = String(dateObj.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12; // hour '0' -> '12'

        return `
            <div style="font-weight:600; color:#1e293b; font-size:0.82rem;">${day}/${month}</div>
            <div style="font-size:0.72rem; color:#64748b; font-weight:500; margin-top:0.1rem;">${hours}:${minutes} ${ampm}</div>
        `;
    };

    // 1. Render Desktop Grid
    tbody.innerHTML = filtered.map(exp => {
        const f = exp.filters || {};
        let displayType = exp.type || 'Unknown Export';
        if (displayType === 'Chest Number List' && f.chestSubmode === 'card') {
            displayType = 'Chest Number & Program Card';
        } else if (displayType === 'Program Participation Register' && f.progRegSubmode === 'list') {
            displayType = 'Program List';
        } else if (displayType === 'Program Participation Register' && f.progRegSubmode === 'student_summary') {
            displayType = 'Student-wise Participation Summary';
        }

        const rawGeneratedBy = (exp.generatedBy || 'Admin').trim();
        let displayGeneratedBy = rawGeneratedBy;
        if (displayGeneratedBy.length > 18) {
            displayGeneratedBy = displayGeneratedBy.substring(0, 15) + '…';
        }

        const canDownload = exp.status === 'Completed';
        const canRetry = exp.status === 'Failed';

        return `
            <tr style="border-bottom:1px solid #cbd5e1; hover:background:#f8fafc;">
                <td style="font-weight:800; color:#1e1b4b; vertical-align:middle;">📄 ${window.escapeHTML(displayType)}</td>
                <td style="max-width:280px; overflow:hidden; vertical-align:middle;">
                    ${getScopeHtml(exp)}
                </td>
                <td style="vertical-align:middle;">
                    ${getFormattedDateHtml(exp.queuedAt)}
                </td>
                <td style="color:#475569; font-weight:700; text-align:center; vertical-align:middle;" title="${window.escapeHTML(rawGeneratedBy)}">
                    ${window.escapeHTML(displayGeneratedBy)}
                </td>
                <td style="text-align:center; vertical-align:middle;">${getStatusBadge(exp.status)}</td>
                <td style="text-align:center; vertical-align:middle;">
                    <div class="exp-action-btn-cluster" style="display:flex; justify-content:center; gap:0.25rem; align-items:center;">
                        <button type="button" class="btn btn-print-exp" data-id="${exp.id}" ${canDownload ? '' : 'disabled'} style="background:${canDownload ? '#eff6ff' : '#f8fafc'}; color:${canDownload ? '#1d4ed8' : '#94a3b8'}; border:1px solid ${canDownload ? '#93c5fd' : '#cbd5e1'}; cursor:${canDownload ? 'pointer' : 'not-allowed'}; font-weight:700;">
                            🖨️ Print
                        </button>
                        <button type="button" class="btn-action-icon btn-action-more dots-btn exp-dots-btn" 
                            data-id="${exp.id}" 
                            data-can-download="${canDownload}"
                            data-can-retry="${canRetry}"
                            style="border:1px solid #cbd5e1; border-radius:8px; padding:0.35rem; display:inline-flex; align-items:center; justify-content:center; background:#ffffff; cursor:pointer;">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" style="width:0.95rem; height:0.95rem; color:#475569;">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 12.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 18.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />
                            </svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // 2. Render Mobile Responsive Cards
    mContainer.innerHTML = filtered.map(exp => {
        const f = exp.filters || {};
        let displayType = exp.type || 'Unknown Export';
        if (displayType === 'Chest Number List' && f.chestSubmode === 'card') {
            displayType = 'Chest Number & Program Card';
        } else if (displayType === 'Program Participation Register' && f.progRegSubmode === 'list') {
            displayType = 'Program List';
        } else if (displayType === 'Program Participation Register' && f.progRegSubmode === 'student_summary') {
            displayType = 'Student-wise Participation Summary';
        }

        const rawGeneratedBy = (exp.generatedBy || 'Admin').trim();
        let displayGeneratedBy = rawGeneratedBy;
        if (displayGeneratedBy.length > 18) {
            displayGeneratedBy = displayGeneratedBy.substring(0, 15) + '…';
        }

        const canDownload = exp.status === 'Completed';
        const canRetry = exp.status === 'Failed';

        // Extract raw date for inline mobile view
        const dateObj = exp.queuedAt ? new Date(exp.queuedAt.seconds * 1000) : null;
        const mobileDateStr = dateObj ?
            `${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')} ${dateObj.getHours() % 12 || 12}:${String(dateObj.getMinutes()).padStart(2, '0')} ${dateObj.getHours() >= 12 ? 'PM' : 'AM'}` : '—';

        return `
            <div class="exp-mobile-card">
                <div class="exp-mobile-row">
                    <span style="font-weight:800; font-size:0.95rem; color:#1e1b4b;">📄 ${window.escapeHTML(displayType)}</span>
                    <span>${getStatusBadge(exp.status)}</span>
                </div>
                <div style="border-top:1px solid #e2e8f0; padding-top:0.5rem; display:flex; flex-direction:column; gap:0.25rem;">
                    <div class="exp-mobile-row" style="align-items:flex-start;">
                        <span class="exp-mobile-label">Scope:</span>
                        <div style="text-align:right;">
                            ${getScopeHtml(exp)}
                        </div>
                    </div>
                    <div class="exp-mobile-row">
                        <span class="exp-mobile-label">Date:</span>
                        <span class="exp-mobile-val" style="font-size:0.75rem; color:#64748b;">${mobileDateStr}</span>
                    </div>
                    <div class="exp-mobile-row">
                        <span class="exp-mobile-label">By:</span>
                        <span class="exp-mobile-val" title="${window.escapeHTML(rawGeneratedBy)}">${window.escapeHTML(displayGeneratedBy)}</span>
                    </div>
                </div>
                <div class="exp-mobile-actions" style="display:flex; align-items:center; gap:0.5rem; margin-top:0.5rem;">
                    <button type="button" class="btn btn-print-exp" data-id="${exp.id}" ${canDownload ? '' : 'disabled'} style="flex:1; background:${canDownload ? '#eff6ff' : '#f8fafc'}; color:${canDownload ? '#1d4ed8' : '#94a3b8'}; border:1px solid ${canDownload ? '#93c5fd' : '#cbd5e1'}; cursor:${canDownload ? 'pointer' : 'not-allowed'}; font-weight:700; border-radius:8px; min-height:38px; display:inline-flex; align-items:center; justify-content:center; gap:0.25rem;">
                        🖨️ Print
                    </button>
                    <button type="button" class="btn-action-icon btn-action-more dots-btn exp-dots-btn" 
                        data-id="${exp.id}" 
                        data-can-download="${canDownload}"
                        data-can-retry="${canRetry}"
                        style="min-height:38px; width:44px; display:inline-flex; align-items:center; justify-content:center; border:1px solid #cbd5e1; border-radius:8px; background:#ffffff; cursor:pointer;">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" style="width:0.95rem; height:0.95rem; color:#475569;">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 12.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 18.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    // Bind triggers on both lists
    document.querySelectorAll('.btn-print-exp').forEach(btn => {
        btn.onclick = () => {
            const id = btn.getAttribute('data-id');
            const exp = exportsList.find(x => x.id === id);
            if (exp) triggerDownload(exp, false);
        };
    });

    document.querySelectorAll('.exp-dots-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            openExportsDropdown(btn);
        };
    });
}


function openExportsDropdown(btn) {
    // 1. Remove any existing dynamic body-appended dropdown
    const existing = document.querySelector('.active-body-dropdown');
    if (existing) existing.remove();

    // 2. Create the dropdown element
    const dropdown = document.createElement('div');
    dropdown.className = 'actions-dropdown-menu active-body-dropdown';

    // Get datasets
    const id = btn.dataset.id;
    const canDownload = btn.dataset.canDownload === 'true';
    const canRetry = btn.dataset.canRetry === 'true';

    dropdown.innerHTML = `
        <button class="dropdown-item btn-download-dropdown" style="display: none !important;" ${canDownload ? '' : 'disabled'}>
            📥 Download
        </button>
        ${canRetry ? `
        <button class="dropdown-item btn-retry-dropdown" style="display:flex; align-items:center; gap:0.5rem; width:100%; border:none; background:transparent; padding:0.5rem 0.85rem; font-size:12px; font-weight:600; color:#1d4ed8; text-align:left; cursor:pointer;">
            🔄 Retry
        </button>
        ` : ''}
        <button class="dropdown-item btn-delete-dropdown text-danger" style="display:flex; align-items:center; gap:0.5rem; width:100%; border:none; background:transparent; padding:0.5rem 0.85rem; font-size:12px; font-weight:600; color:#dc2626; text-align:left; cursor:pointer;">
            🗑️ Delete
        </button>
    `;

    // 3. Append directly to body
    document.body.appendChild(dropdown);

    // 4. Position fixed menu dynamically to avoid clipping
    const rect = btn.getBoundingClientRect();
    const menuWidth = 135;
    const menuHeight = canRetry ? 120 : 80;

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
    dropdown.querySelector('.btn-download-dropdown').addEventListener('click', () => {
        dropdown.remove();
        const exp = exportsList.find(x => x.id === id);
        if (exp) triggerDownload(exp, true);
    });

    if (canRetry) {
        dropdown.querySelector('.btn-retry-dropdown').addEventListener('click', () => {
            dropdown.remove();
            const exp = exportsList.find(x => x.id === id);
            if (exp) triggerRetry(exp);
        });
    }

    dropdown.querySelector('.btn-delete-dropdown').addEventListener('click', () => {
        dropdown.remove();
        const exp = exportsList.find(x => x.id === id);
        if (exp) triggerDelete(exp);
    });
}

// ─────────────────────────────────────────────
// Drawer Creation Redesign (Phase 2)
// ─────────────────────────────────────────────
function ensureExportDrawerExists() {
    let drawer = document.getElementById('exportDrawer');
    if (drawer) return drawer;

    drawer = document.createElement('div');
    drawer.id = 'exportDrawer';
    drawer.className = 'modal-overlay hidden';
    drawer.style.zIndex = '1000';

    drawer.innerHTML = `
        <div class="modal" style="width: 95%; max-width: 1050px; height: 90vh; max-height: 90vh; display: flex; flex-direction: column; border-radius: 20px;">
            <div class="modal-header" style="border-bottom:1px solid #e2e8f0; padding:1.25rem 1.5rem;">
                <h3 id="exportDrawerTitle" style="font-weight: 800; font-size:1.15rem; display:flex; align-items:center; gap:0.5rem;">📤 Generate Event Document</h3>
                <button class="close-modal" id="closeExportDrawerBtn" style="font-size:1.5rem;">&times;</button>
            </div>
            <div class="modal-body" id="exportDrawerBody" style="padding: 1.5rem; overflow: hidden; flex: 1; display:flex; flex-direction:column; min-height:0; box-sizing:border-box;">
                <!-- dynamic V2 panel grid injected -->
            </div>
        </div>
    `;
    document.body.appendChild(drawer);

    document.getElementById('closeExportDrawerBtn').onclick = closeExportDrawer;
    return drawer;
}

async function refreshAwardTypesConfig() {
    const instId = window.currentInstituteId;
    if (!instId) return;
    allAwardTypes = [
        { id: "attendance", name: "Attendance" },
        { id: "examination", name: "Examination" }
    ];
    try {
        const configSnap = await getDoc(doc(db, "institutes", instId, "metadata", "awardTypesConfig"));
        if (configSnap.exists()) {
            const data = configSnap.data();
            if (Array.isArray(data.awardTypes) && data.awardTypes.length > 0) {
                allAwardTypes = data.awardTypes;
            }
        }
    } catch (err) {
        console.error("Error loading award types config:", err);
    }
}

async function openExportDrawer() {
    loadTeamBackgrounds();
    await refreshAwardTypesConfig();
    const drawer = ensureExportDrawerExists();
    renderDrawerContent();

    drawer.classList.remove('hidden');
    drawer.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeExportDrawer() {
    const drawer = document.getElementById('exportDrawer');
    if (drawer) {
        drawer.classList.add('hidden');
        drawer.classList.remove('active');
    }
    document.body.style.overflow = '';
}

function renderDrawerContent() {
    const body = document.getElementById('exportDrawerBody');
    if (!body) return;

    let catOptions = '<option value="">All Categories</option>';
    catOptions += '<option value="general_programs">⭐ General Programs</option>';
    allCategories.forEach(c => {
        catOptions += `<option value="${c.id}">${window.escapeHTML(c.name)}</option>`;
    });

    let teamOptions = '<option value="">All Teams</option>';
    allTeams.forEach(t => {
        teamOptions += `<option value="${t.id}">${window.escapeHTML(t.name)}</option>`;
    });

    body.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:1.25rem; height:100%; width:100%; overflow:hidden;">
            <!-- Split Grid Visual Structure -->
            <div class="exp-drawer-inner">
                
                <!-- Left: Export Visual Selector Cards (Phase 2) -->
                <div class="exp-type-cards">
                    <span style="font-weight:800; color:#475569; font-size:0.75rem; text-transform:uppercase; letter-spacing:0.08em; display:block; margin-bottom:0.25rem;">
                        1. Select Export Type
                    </span>

                    <div class="exp-type-card active" data-type="Green Room Sign">
                        <span style="font-size:2rem; background:#f5f3ff; border-radius:10px; width:48px; height:48px; display:flex; align-items:center; justify-content:center; border:1px solid #ddd;">🚪</span>
                        <div style="display:flex; flex-direction:column; gap:0.1rem;">
                            <strong style="color:#1e1b4b; font-size:0.9rem;">Green Room Sign</strong>
                            <span style="font-size:0.7rem; color:#64748b; font-weight:600;">Attendance checklist & signatures</span>
                        </div>
                    </div>

                    <div class="exp-type-card" data-type="Valuation Sheet">
                        <span style="font-size:2rem; background:#fffbeb; border-radius:10px; width:48px; height:48px; display:flex; align-items:center; justify-content:center; border:1px solid #ddd;">📝</span>
                        <div style="display:flex; flex-direction:column; gap:0.1rem;">
                            <strong style="color:#1e1b4b; font-size:0.9rem;">Valuation Sheet</strong>
                            <span style="font-size:0.7rem; color:#64748b; font-weight:600;">2x2 A4 grid judges marks layouts</span>
                        </div>
                    </div>

                    <div class="exp-type-card" data-type="Call List">
                        <span style="font-size:2rem; background:#eff6ff; border-radius:10px; width:48px; height:48px; display:flex; align-items:center; justify-content:center; border:1px solid #ddd;">📣</span>
                        <div style="display:flex; flex-direction:column; gap:0.1rem;">
                            <strong style="color:#1e1b4b; font-size:0.9rem;">Call List</strong>
                            <span style="font-size:0.7rem; color:#64748b; font-weight:600;">Stage calling large numbers list</span>
                        </div>
                    </div>

                    <div class="exp-type-card" data-type="Chest Number List">
                        <span style="font-size:2rem; background:#fee2e2; border-radius:10px; width:48px; height:48px; display:flex; align-items:center; justify-content:center; border:1px solid #ddd;">🎫</span>
                        <div style="display:flex; flex-direction:column; gap:0.1rem;">
                            <strong style="color:#1e1b4b; font-size:0.9rem;">Chest Number List</strong>
                            <span style="font-size:0.7rem; color:#64748b; font-weight:600;">Check participant chest numbers & details</span>
                        </div>
                    </div>

                    <div class="exp-type-card" data-type="Program Participation Register">
                        <span style="font-size:2rem; background:#fef3c7; border-radius:10px; width:48px; height:48px; display:flex; align-items:center; justify-content:center; border:1px solid #ddd;">📋</span>
                        <div style="display:flex; flex-direction:column; gap:0.1rem;">
                            <strong style="color:#1e1b4b; font-size:0.9rem;">Program Participation Register</strong>
                            <span style="font-size:0.7rem; color:#64748b; font-weight:600;">Printable participation check matrix</span>
                        </div>
                    </div>

                    <div class="exp-type-card" data-type="Results">
                        <span style="font-size:2rem; background:#f0fdf4; border-radius:10px; width:48px; height:48px; display:flex; align-items:center; justify-content:center; border:1px solid #ddd;">🏆</span>
                        <div style="display:flex; flex-direction:column; gap:0.1rem;">
                            <strong style="color:#1e1b4b; font-size:0.9rem;">Results Reports</strong>
                            <span style="font-size:0.7rem; color:#64748b; font-weight:600;">Standings, category champs, podiums</span>
                        </div>
                    </div>
                </div>

                <!-- Right: Spaced Configurations Parameter Forms (Phase 2) -->
                <div class="exp-params-panel">
                    <span style="font-weight:800; color:#475569; font-size:0.75rem; text-transform:uppercase; letter-spacing:0.08em; border-bottom:1px solid #cbd5e1; padding-bottom:0.4rem; display:block;">
                        2. Scope Filters & Print Format
                    </span>

                    <!-- Chest Number Export Submode Selector -->
                    <div id="chestExportModeSelector" style="display:none; margin-top:0.75rem; margin-bottom:0.75rem; border:1px solid #cbd5e1; padding:2px; border-radius:10px; background:#f1f5f9; display:flex;">
                        <button type="button" class="exp-submode-btn active" data-submode="list" style="flex:1; text-align:center; padding:0.5rem; font-size:0.78rem; font-weight:700; border:none; border-radius:8px; cursor:pointer; background:#fff; color:#1e1b4b; box-shadow:0 1px 3px rgba(0,0,0,0.05); transition:all 0.2s;">Chest Number List</button>
                        <button type="button" class="exp-submode-btn" data-submode="card" style="flex:1; text-align:center; padding:0.5rem; font-size:0.78rem; font-weight:700; border:none; border-radius:8px; cursor:pointer; background:transparent; color:#64748b; transition:all 0.2s;">Chest Number & Program Card</button>
                    </div>

                    <!-- Program Participation Register Submode Selector (Three-Tab Layout) -->
                    <div id="progRegExportModeSelector" style="display:none; margin-top:0.75rem; margin-bottom:0.75rem; border:1px solid #cbd5e1; padding:2px; border-radius:10px; background:#f1f5f9; display:flex;">
                        <button type="button" class="prog-reg-submode-btn active" data-submode="register" style="flex:1; text-align:center; padding:0.5rem; font-size:0.78rem; font-weight:700; border:none; border-radius:8px; cursor:pointer; background:#fff; color:#1e1b4b; box-shadow:0 1px 3px rgba(0,0,0,0.05); transition:all 0.2s;">Program Participation Register</button>
                        <button type="button" class="prog-reg-submode-btn" data-submode="list" style="flex:1; text-align:center; padding:0.5rem; font-size:0.78rem; font-weight:700; border:none; border-radius:8px; cursor:pointer; background:transparent; color:#64748b; transition:all 0.2s;">Program List</button>
                        <button type="button" class="prog-reg-submode-btn" data-submode="student_summary" style="flex:1; text-align:center; padding:0.5rem; font-size:0.78rem; font-weight:700; border:none; border-radius:8px; cursor:pointer; background:transparent; color:#64748b; transition:all 0.2s;">Student-wise Participation Summary</button>
                    </div>

                    <!-- Sub Options (Only visible for Results) -->
                    <div id="expResultSub" style="display:none; flex-direction:column; gap:0.45rem;">
                        <label style="font-weight:700; color:#475569; font-size:0.78rem;">RESULTS SUB-OPTION *</label>
                        <select id="expResultSubVal" class="exp-input" style="background:#fff;">
                            <option value="Team Wise">Team Wise Standings & Roster</option>
                            <option value="Program Wise">Program Wise Podiums</option>
                            <option value="Student Prize Distribution">Student Prize Distribution Register</option>
                            <option value="Prize Distribution Register">Position Wise Winners</option>
                            <option value="Participants Without Major Prizes">Participants Without Major Prizes</option>
                            <option value="Class Wise Academic & Attendance">Class Wise Academic & Attendance Awards</option>
                        </select>
                    </div>

                    <!-- Award Type filter (Only visible for Class Wise Academic & Attendance Results) -->
                    <div id="expAwardTypeContainer" style="display:none; flex-direction:column; gap:0.45rem;">
                        <label style="font-weight:700; color:#475569; font-size:0.78rem;">AWARD TYPE</label>
                        <div id="expAwardTypeMultiSelect" style="position:relative; width:100%;">
                            <button type="button" id="expAwardTypeBtn" class="exp-input" style="background:#fff; text-align:left; display:flex; justify-content:space-between; align-items:center; cursor:pointer; width:100%; min-height:38px; padding:0.45rem 0.75rem; box-sizing:border-box;">
                                <span id="expAwardTypeBtnText" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:0.85rem; font-weight:600; color:#1e1b4b;">All Awards</span>
                                <span style="font-size:0.7rem; color:#64748b; margin-left:0.5rem;">▼</span>
                            </button>
                            <div id="expAwardTypeDropdown" style="display:none; position:absolute; top:100%; left:0; right:0; z-index:1050; background:#fff; border:1px solid #cbd5e1; border-radius:8px; box-shadow:0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05); margin-top:4px; max-height:260px; overflow-y:auto; padding:0.5rem; box-sizing:border-box;">
                                <input type="text" id="expAwardTypeSearch" placeholder="Search Award Types..." style="width:100%; padding:0.35rem 0.5rem; font-size:0.82rem; border:1px solid #cbd5e1; border-radius:6px; margin-bottom:0.5rem; box-sizing:border-box;" />
                                <div id="expAwardTypeList" style="display:flex; flex-direction:column; gap:0.25rem;">
                                    <label class="exp-award-opt" style="display:flex; align-items:center; gap:0.5rem; font-size:0.85rem; color:#1e1b4b; cursor:pointer; padding:0.3rem 0.4rem; border-radius:4px; transition:background 0.15s;">
                                        <input type="checkbox" class="exp-award-chk" value="All" checked style="accent-color:#4f46e5; cursor:pointer; width:15px; height:15px;" />
                                        <strong style="font-weight:700;">All Awards</strong>
                                    </label>
                                    ${allAwardTypes.map(t => `
                                        <label class="exp-award-opt" style="display:flex; align-items:center; gap:0.5rem; font-size:0.85rem; color:#334155; cursor:pointer; padding:0.3rem 0.4rem; border-radius:4px; transition:background 0.15s;">
                                            <input type="checkbox" class="exp-award-chk" value="${t.id}" data-name="${window.escapeHTML(t.name)}" style="accent-color:#4f46e5; cursor:pointer; width:15px; height:15px;" />
                                            <span>${window.escapeHTML(t.name)}</span>
                                        </label>
                                    `).join('')}
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Position Filter (Only visible for specific Results Reports) -->
                    <div id="expPositionFilterContainer" style="display:none; flex-direction:column; gap:0.45rem; background:#f8fafc; border:1px solid #cbd5e1; padding:0.75rem; border-radius:10px;">
                        <label style="font-weight:800; color:#475569; font-size:0.75rem; text-transform:uppercase; letter-spacing:0.04em;">POSITIONS FILTER</label>
                        <div style="display:flex; gap:1.25rem; align-items:center;">
                            <label style="display:inline-flex; align-items:center; gap:0.4rem; font-size:0.8rem; font-weight:700; color:#1e293b; cursor:pointer;">
                                <input type="checkbox" class="exp-pos-chk" value="First" checked style="accent-color:#4f46e5; cursor:pointer; width:16px; height:16px;" /> First
                            </label>
                            <label style="display:inline-flex; align-items:center; gap:0.4rem; font-size:0.8rem; font-weight:700; color:#1e293b; cursor:pointer;">
                                <input type="checkbox" class="exp-pos-chk" value="Second" checked style="accent-color:#4f46e5; cursor:pointer; width:16px; height:16px;" /> Second
                            </label>
                            <label style="display:inline-flex; align-items:center; gap:0.4rem; font-size:0.8rem; font-weight:700; color:#1e293b; cursor:pointer;">
                                <input type="checkbox" class="exp-pos-chk" value="Third" style="accent-color:#4f46e5; cursor:pointer; width:16px; height:16px;" /> Third
                            </label>
                            <label id="expPosGeneralProgramLabel" style="display:none; align-items:center; gap:0.4rem; font-size:0.8rem; font-weight:700; color:#1e293b; cursor:pointer;">
                                <input type="checkbox" class="exp-pos-chk" value="General Programs" style="accent-color:#4f46e5; cursor:pointer; width:16px; height:16px;" /> General Programs
                            </label>
                        </div>
                    </div>

                    <!-- Program Order Filter (Only for Program Wise Podiums) -->
                    <div id="expProgramOrderContainer" style="display:none; flex-direction:column; gap:0.45rem; width:100%; margin-bottom:0.75rem;">
                        <label style="font-weight:700; color:#475569; font-size:0.78rem;">PROGRAM ORDER</label>
                        <div style="display:flex; flex-direction:column; gap:0.45rem; background:#f8fafc; border:1px solid #cbd5e1; padding:0.75rem; border-radius:10px;">
                            <label style="display:inline-flex; align-items:center; gap:0.4rem; font-size:0.8rem; font-weight:700; color:#1e293b; cursor:pointer;">
                                <input type="radio" name="expProgramOrderFilter" value="default" checked style="accent-color:#4f46e5; cursor:pointer; width:16px; height:16px;" /> Default Order
                            </label>
                            <label style="display:inline-flex; align-items:center; gap:0.4rem; font-size:0.8rem; font-weight:700; color:#1e293b; cursor:pointer;">
                                <input type="radio" name="expProgramOrderFilter" value="result_number" style="accent-color:#4f46e5; cursor:pointer; width:16px; height:16px;" /> Result Number Wise
                            </label>
                            <label style="display:inline-flex; align-items:center; gap:0.4rem; font-size:0.8rem; font-weight:700; color:#1e293b; cursor:pointer;">
                                <input type="radio" name="expProgramOrderFilter" value="category_order" style="accent-color:#4f46e5; cursor:pointer; width:16px; height:16px;" /> Category Order
                            </label>
                        </div>
                    </div>

                    <!-- Category / Class filters -->
                    <div style="display:flex; gap:0.75rem; flex-wrap:wrap; width:100%;">
                        <div id="expCatFilterContainer" style="flex:1; min-width:140px;">
                            <label style="font-weight:700; color:#475569; font-size:0.78rem;">CATEGORY</label>
                            <select id="expCatFilter" class="exp-input" style="background:#fff;">${catOptions}</select>
                        </div>
                        <div style="flex:1; min-width:140px;">
                            <label style="font-weight:700; color:#475569; font-size:0.78rem;">CLASS / STANDARD</label>
                            <select id="expClassFilter" class="exp-input" style="background:#fff;" disabled>
                                <option value="">All Classes</option>
                            </select>
                        </div>
                    </div>

                    <!-- Program Location (Stage / Off Stage) filter -->
                    <div id="expLocationFilterContainer" style="display:none; flex-direction:column; gap:0.45rem;">
                        <label style="font-weight:700; color:#475569; font-size:0.78rem;">PROGRAM LOCATION</label>
                        <select id="expLocationFilter" class="exp-input" style="background:#fff;">
                            <option value="">All Programs</option>
                            <option value="Stage">Stage</option>
                            <option value="Off Stage">Off Stage</option>
                        </select>
                    </div>

                    <!-- Program Type (Individual / Group / General) filter -->
                    <div id="expParticipationFilterContainer" style="display:none; flex-direction:column; gap:0.45rem;">
                        <label style="font-weight:700; color:#475569; font-size:0.78rem;">PROGRAM TYPE / PARTICIPATION</label>
                        <select id="expParticipationFilter" class="exp-input" style="background:#fff;">
                            <option value="">All Program Types</option>
                            <option value="individual">Individual Programs</option>
                            <option value="group">Group Programs</option>
                            <option value="general">General Programs</option>
                        </select>
                    </div>

                    <!-- Register Format/Mode selector -->
                    <div id="expRegisterModeContainer" style="display:none; flex-direction:column; gap:0.45rem;">
                        <label style="font-weight:700; color:#475569; font-size:0.78rem;">REGISTER FORMAT / MODE</label>
                        <select id="expRegisterMode" class="exp-input" style="background:#fff;">
                            <option value="class-wise">Class-wise Register</option>
                            <option value="category-wise">Category-wise Register</option>
                        </select>
                    </div>

                    <!-- Program selection (Cascading) -->
                    <div id="expProgFilterContainer">
                        <label style="font-weight:700; color:#475569; font-size:0.78rem;">SPECIFIC PROGRAM (OPTIONAL)</label>
                        <select id="expProgFilter" class="exp-input" style="background:#fff;">
                            <option value="">All Matching Programs</option>
                        </select>
                    </div>

                    <!-- Chest Number List specific Mode Controls -->
                    <div id="chestListModeContainer" style="display:none; flex-direction:column; gap:0.45rem;">
                        <label style="font-weight:700; color:#475569; font-size:0.78rem;">CHEST NUMBER LIST FORMAT</label>
                        <select id="expChestMode" class="exp-input" style="background:#fff;">
                            <option value="class-wise">Class-wise Chest Number List</option>
                            <option value="category-wise">Category-wise Chest Number List</option>
                        </select>
                    </div>

                    <!-- Gender & Teams -->
                    <div style="display:flex; gap:0.75rem; flex-wrap:wrap; width:100%;">
                        <div style="flex:1; min-width:140px;">
                            <label style="font-weight:700; color:#475569; font-size:0.78rem;">GENDER FILTER</label>
                            <select id="expGenderFilter" class="exp-input" style="background:#fff;">
                                <option value="">All Genders</option>
                                <option value="Boys">Boys</option>
                                <option value="Girls">Girls</option>
                                <option value="Mixed">Mixed</option>
                            </select>
                        </div>
                        <div id="expTeamFilterContainer" style="flex:1; min-width:140px;">
                            <label style="font-weight:700; color:#475569; font-size:0.78rem;">TEAM / INSTITUTE FILTER</label>
                            <select id="expTeamFilter" class="exp-input" style="background:#fff;">${teamOptions}</select>
                        </div>
                    </div>

                    <!-- Results specific Filters -->
                    <div id="resultsSourceContainer" style="display:none; flex-direction:column; gap:0.5rem; background:#fff; border:1px solid #cbd5e1; padding:0.75rem 1rem; border-radius:10px;">
                        <span style="font-size:0.75rem; font-weight:700; color:#475569; display:block;">RESULTS SOURCE CONTROLS</span>
                        <div style="display:flex; gap:1.25rem;">
                            <label style="display:inline-flex; align-items:center; gap:0.4rem; font-size:0.78rem; font-weight:600; color:#475569; cursor:pointer;">
                                <input type="checkbox" id="srcIncludeSubmitted" style="cursor:pointer;" /> Include Submitted Marks
                            </label>
                            <label style="display:inline-flex; align-items:center; gap:0.4rem; font-size:0.78rem; font-weight:600; color:#475569; cursor:pointer;">
                                <input type="checkbox" id="srcIncludeDraft" style="cursor:pointer;" /> Include Draft Scores
                            </label>
                        </div>
                    </div>

                    <!-- Paper Packing Configuration (Phase 3 & 4) -->
                    <div id="paperPackingContainer" style="display:flex; flex-direction:column; gap:0.5rem; background:#fff; border:1px solid #cbd5e1; padding:0.75rem 1rem; border-radius:10px;">
                        <span style="font-size:0.75rem; font-weight:700; color:#1e1b4b; display:block; text-transform:uppercase; letter-spacing:0.04em;">🌳 ECO-PRINT PAPER OPTIMIZATION</span>
                        <div style="display:flex; align-items:center; gap:0.5rem;">
                            <input type="checkbox" id="expCompactPacking" checked style="width:1.2rem; height:1.2rem; cursor:pointer;" />
                            <label for="expCompactPacking" style="font-size:0.8rem; font-weight:700; color:#475569; cursor:pointer; user-select:none;">
                                Enable Compact A4 Packing Mode (Conserve Paper & Combine sheets)
                            </label>
                        </div>
                        <span id="packingHint" style="font-size:0.68rem; color:#64748b; display:block;">Combine multiple programs continuously to avoid wasting paper on blank space.</span>
                    </div>

                    <!-- Team Background Manager Container -->
                    <div id="teamBgContainer" style="display:none; flex-direction:column; gap:0.75rem; background:#fff; border:1px solid #cbd5e1; padding:0.75rem 1rem; border-radius:10px;">
                        <span style="font-size:0.75rem; font-weight:700; color:#1e1b4b; display:block; text-transform:uppercase; letter-spacing:0.04em;">🖼️ Team Background Manager</span>
                        <div style="display:flex; align-items:center; gap:0.5rem;">
                            <input type="checkbox" id="expEnableTeamBg" style="width:1.2rem; height:1.2rem; cursor:pointer;" />
                            <label for="expEnableTeamBg" style="font-size:0.8rem; font-weight:700; color:#475569; cursor:pointer; user-select:none;">
                                Enable Team Background Images
                            </label>
                        </div>
                        <div id="teamBgManagerContent" style="display:none; flex-direction:column; gap:0.75rem; width:100%; border-top:1.5px dashed #cbd5e1; padding-top:0.75rem;">
                            <div style="display:flex; justify-content:flex-end;">
                                <button type="button" id="btnResetAllTeamBgs" class="btn btn-danger" style="background:#ef4444; color:#fff; border:none; padding:0.4rem 0.8rem; border-radius:6px; font-size:0.72rem; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:0.25rem;">
                                    🔄 Reset All Team Backgrounds
                                </button>
                            </div>
                            <div id="teamBgGrid"></div>
                        </div>
                    </div>

                    <!-- Format & Layout -->
                    <div style="display:flex; gap:0.75rem; flex-wrap:wrap; border-top:1px solid #cbd5e1; padding-top:0.75rem; width:100%; margin-top:auto;">
                        <div style="flex:1; min-width:140px;">
                            <label style="font-weight:700; color:#475569; font-size:0.78rem;">LAYOUT ORIENTATION</label>
                            <select id="expOrientation" class="exp-input" style="background:#fff;">
                                <option value="portrait">A4 Portrait (Vertical)</option>
                                <option value="landscape">A4 Landscape (Horizontal)</option>
                                <option value="a3_portrait">A3 Portrait (Vertical)</option>
                            </select>
                        </div>
                        <div style="flex:1; min-width:140px;">
                            <label style="font-weight:700; color:#475569; font-size:0.78rem;">DOWNLOAD FORMAT</label>
                            <select id="expFormat" class="exp-input" style="background:#fff;">
                                <option value="pdf">PDF Printable Sheet</option>
                                <option value="csv">CSV Spreadsheet</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Footer Action Panel -->
            <div class="modal-actions" style="margin-top:0.25rem; border-top:1px solid #e2e8f0; padding-top:0.75rem; display:flex;">
                <button type="button" class="btn btn-secondary" id="btnNewExpCancel" style="min-height:44px; padding:0.5rem 1.5rem;">Cancel</button>
                <button type="button" class="btn btn-primary" id="btnNewExpGenerate" style="margin-left:auto; font-weight:800; min-width:180px; min-height:44px; padding:0.5rem 1.5rem; font-size:0.9rem;">
                    ⚡ Generate Export
                </button>
            </div>
        </div>
    `;

    // Visual selectors interactive logic
    let selectedType = 'Green Room Sign';
    const cards = body.querySelectorAll('.exp-type-card');
    const resultsSourceContainer = document.getElementById('resultsSourceContainer');
    const subOptionsContainer = document.getElementById('expResultSub');
    const paperPackingContainer = document.getElementById('paperPackingContainer');
    const packingHint = document.getElementById('packingHint');
    const expCatFilter = document.getElementById('expCatFilter');
    const expClassFilter = document.getElementById('expClassFilter');
    const expProgFilter = document.getElementById('expProgFilter');
    const expProgFilterContainer = document.getElementById('expProgFilterContainer');
    const chestListModeContainer = document.getElementById('chestListModeContainer');
    const chestExportModeSelector = document.getElementById('chestExportModeSelector');

    const expEnableTeamBg = document.getElementById('expEnableTeamBg');
    const teamBgManagerContent = document.getElementById('teamBgManagerContent');
    const btnResetAllTeamBgs = document.getElementById('btnResetAllTeamBgs');
    const teamBgContainer = document.getElementById('teamBgContainer');

    function updateTeamBgVisibility() {
        const activeCard = body.querySelector('.exp-type-card.active');
        const selType = activeCard ? activeCard.getAttribute('data-type') : '';
        const activeSubmode = chestExportModeSelector?.querySelector('.exp-submode-btn.active')?.getAttribute('data-submode') || 'list';

        if (teamBgContainer) {
            if (selType === 'Chest Number List' && activeSubmode === 'card') {
                teamBgContainer.style.display = 'flex';
            } else {
                teamBgContainer.style.display = 'none';
            }
        }
    }

    // Set initial toggle state (OFF by default)
    isTeamBgEnabled = false;

    if (expEnableTeamBg) {
        expEnableTeamBg.checked = isTeamBgEnabled;
        expEnableTeamBg.onchange = () => {
            isTeamBgEnabled = expEnableTeamBg.checked;
            teamBgManagerContent.style.display = isTeamBgEnabled ? 'flex' : 'none';
        };
    }

    if (btnResetAllTeamBgs) {
        btnResetAllTeamBgs.onclick = () => {
            if (confirm('Are you sure you want to reset all team background images? This will restore the default background templates for all teams.')) {
                teamBackgroundsCache = {};
                localStorage.removeItem('meelad_team_card_backgrounds');
                allTeams.forEach(t => {
                    updateTeamCardUI(t.id);
                });
                window.showToast('All team backgrounds reset to default.');
            }
        };
    }

    renderTeamBgCards();

    const updateConditionalFilters = () => {
        const activeCard = document.querySelector('.exp-type-card.active');
        const selType = activeCard ? activeCard.getAttribute('data-type') : '';
        const expResultSubVal = document.getElementById('expResultSubVal');
        const expAwardTypeContainer = document.getElementById('expAwardTypeContainer');
        const expProgFilterContainer = document.getElementById('expProgFilterContainer');
        const isClassAwards = (selType === 'Results' && expResultSubVal && expResultSubVal.value === 'Class Wise Academic & Attendance');
        const progRegSubmode = selType === 'Program Participation Register' ? (document.getElementById('progRegExportModeSelector')?.querySelector('.prog-reg-submode-btn.active')?.getAttribute('data-submode') || 'register') : 'register';

        // 1. Award Type Container
        if (expAwardTypeContainer) {
            expAwardTypeContainer.style.display = isClassAwards ? 'flex' : 'none';
        }

        // 2.5 Position Filter Container
        const expPositionFilterContainer = document.getElementById('expPositionFilterContainer');
        if (expPositionFilterContainer) {
            if (selType === 'Results' && !isClassAwards) {
                expPositionFilterContainer.style.display = 'flex';
                const generalProgramLabel = document.getElementById('expPosGeneralProgramLabel');
                if (generalProgramLabel) {
                    if (expResultSubVal && (expResultSubVal.value === 'Participants Without Major Prizes' || expResultSubVal.value === 'Student Prize Distribution')) {
                        generalProgramLabel.style.display = 'inline-flex';
                    } else {
                        generalProgramLabel.style.display = 'none';
                    }
                }
            } else {
                expPositionFilterContainer.style.display = 'none';
            }
        }

        // 2.75 Program Order Container
        const expProgramOrderContainer = document.getElementById('expProgramOrderContainer');
        if (expProgramOrderContainer) {
            if (selType === 'Results' && expResultSubVal && expResultSubVal.value === 'Program Wise') {
                expProgramOrderContainer.style.display = 'flex';
            } else {
                expProgramOrderContainer.style.display = 'none';
            }
        }

        // 2. Category Filter Container
        const expCatFilterContainer = document.getElementById('expCatFilterContainer');
        if (expCatFilterContainer) {
            expCatFilterContainer.style.display = isClassAwards ? 'none' : 'block';
        }

        // 3. Specific Program Container
        if (expProgFilterContainer) {
            if (isClassAwards) {
                expProgFilterContainer.style.display = 'none';
            } else {
                // Keep existing logic for other types
                if (selType === 'Chest Number List' || selType === 'Program Participation Register') {
                    expProgFilterContainer.style.display = 'none';
                } else {
                    expProgFilterContainer.style.display = 'block';
                }
            }
        }

        // 4. Team / Institute Filter Container
        const expTeamFilterContainer = document.getElementById('expTeamFilterContainer');
        if (expTeamFilterContainer) {
            expTeamFilterContainer.style.display = (isClassAwards || (selType === 'Program Participation Register' && progRegSubmode === 'list')) ? 'none' : 'block';
        }

        // 5. Program Location Filter Container
        const expLocationFilterContainer = document.getElementById('expLocationFilterContainer');
        if (expLocationFilterContainer) {
            const allowedLocTypes = ['Green Room Sign', 'Valuation Sheet', 'Call List', 'Results', 'Program Participation Register'];
            if (allowedLocTypes.includes(selType) && !isClassAwards) {
                expLocationFilterContainer.style.display = 'flex';
            } else {
                expLocationFilterContainer.style.display = 'none';
            }
        }
    };

    // Submode Buttons handler
    const submodeButtons = body.querySelectorAll('.exp-submode-btn');
    submodeButtons.forEach(btn => {
        btn.onclick = () => {
            submodeButtons.forEach(b => {
                b.classList.remove('active');
                b.style.background = 'transparent';
                b.style.color = '#64748b';
                b.style.boxShadow = 'none';
            });
            btn.classList.add('active');
            btn.style.background = '#fff';
            btn.style.color = '#1e1b4b';
            btn.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';

            const activeSubmode = btn.getAttribute('data-submode');
            const expFormat = document.getElementById('expFormat');
            const expOrientation = document.getElementById('expOrientation');

            if (activeSubmode === 'card') {
                chestListModeContainer.style.display = 'none';
                if (expFormat) {
                    expFormat.value = 'pdf';
                    expFormat.options[1].disabled = true; // disable CSV
                }
                if (expOrientation) {
                    expOrientation.value = 'portrait';
                    if (expOrientation.options[1]) {
                        expOrientation.options[1].style.display = 'none'; // hide A4 Landscape
                    }
                    if (expOrientation.options[2]) {
                        expOrientation.options[2].style.display = 'block'; // show A3 Portrait
                    }
                }
            } else {
                chestListModeContainer.style.display = 'flex';
                if (expFormat && expFormat.options[1]) {
                    expFormat.options[1].disabled = false;
                }
                if (expOrientation) {
                    if (expOrientation.options[1]) {
                        expOrientation.options[1].style.display = 'block'; // show A4 Landscape
                    }
                    if (expOrientation.options[2]) {
                        expOrientation.options[2].style.display = 'none'; // hide A3 Portrait
                    }
                }
            }
            updateClassFilterState();
            updateProgramsDropdown();
            updateTeamBgVisibility();
        };
    });

    // Program Participation Register Submode Buttons handler (Two-Tab Layout)
    const progRegSubmodeBtns = body.querySelectorAll('.prog-reg-submode-btn');
    progRegSubmodeBtns.forEach(btn => {
        btn.onclick = () => {
            progRegSubmodeBtns.forEach(b => {
                b.classList.remove('active');
                b.style.background = 'transparent';
                b.style.color = '#64748b';
                b.style.boxShadow = 'none';
            });
            btn.classList.add('active');
            btn.style.background = '#fff';
            btn.style.color = '#1e1b4b';
            btn.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';

            const activeSubmode = btn.getAttribute('data-submode');
            const locCont = document.getElementById('expLocationFilterContainer');
            const partCont = document.getElementById('expParticipationFilterContainer');
            const regModeCont = document.getElementById('expRegisterModeContainer');
            const expOrientation = document.getElementById('expOrientation');

            if (activeSubmode === 'list') {
                if (locCont) locCont.style.display = 'flex';
                if (partCont) partCont.style.display = 'none';
                if (regModeCont) regModeCont.style.display = 'none';
                if (expOrientation) expOrientation.value = 'portrait';
            } else if (activeSubmode === 'student_summary') {
                if (locCont) locCont.style.display = 'flex';
                if (partCont) partCont.style.display = 'none';
                if (regModeCont) regModeCont.style.display = 'none';
                if (expOrientation) expOrientation.value = 'landscape';
            } else {
                if (locCont) locCont.style.display = 'flex';
                if (partCont) partCont.style.display = 'flex';
                if (regModeCont) regModeCont.style.display = 'flex';
                if (expOrientation) expOrientation.value = 'landscape';
            }
            updateConditionalFilters();
            updateClassFilterState();
            updateProgramsDropdown();
            updateTeamBgVisibility();
        };
    });

    cards.forEach(card => {
        card.onclick = () => {
            const expOrientation = document.getElementById('expOrientation');
            if (expOrientation) {
                if (expOrientation.options[1]) expOrientation.options[1].style.display = 'block';
                if (expOrientation.options[2]) expOrientation.options[2].style.display = 'none';
            }
            cards.forEach(c => {
                c.style.border = '2px solid #e2e8f0';
                c.style.background = '#fff';
                c.classList.remove('active');
            });
            card.style.border = '2px solid #4338ca';
            card.style.background = '#f5f3ff';
            card.classList.add('active');

            selectedType = card.getAttribute('data-type');

            const locCont = document.getElementById('expLocationFilterContainer');
            const partCont = document.getElementById('expParticipationFilterContainer');
            const regModeCont = document.getElementById('expRegisterModeContainer');
            const expFormat = document.getElementById('expFormat');

            if (expFormat && expFormat.options[1]) {
                expFormat.options[1].disabled = false;
            }

            const expResultSubVal = document.getElementById('expResultSubVal');

            if (expResultSubVal) {
                expResultSubVal.onchange = () => {
                    // Reset position checkboxes
                    const posChks = document.querySelectorAll('.exp-pos-chk');
                    posChks.forEach(chk => {
                        if (chk.value === 'First' || chk.value === 'Second') {
                            chk.checked = true;
                        } else {
                            chk.checked = false;
                        }
                    });

                    updateConditionalFilters();
                    updateClassFilterState();
                    updateProgramsDropdown();
                };
            }

            if (selectedType === 'Results') {
                if (chestExportModeSelector) chestExportModeSelector.style.display = 'none';
                const progRegExportModeSelector = document.getElementById('progRegExportModeSelector');
                if (progRegExportModeSelector) progRegExportModeSelector.style.display = 'none';
                resultsSourceContainer.style.display = 'flex';
                subOptionsContainer.style.display = 'flex';
                paperPackingContainer.style.display = 'none';
                chestListModeContainer.style.display = 'none';
                expProgFilterContainer.style.display = 'block';
                if (locCont) locCont.style.display = 'flex';
                if (partCont) partCont.style.display = 'none';
                if (regModeCont) regModeCont.style.display = 'none';
                updateConditionalFilters();
            } else if (selectedType === 'Valuation Sheet') {
                if (chestExportModeSelector) chestExportModeSelector.style.display = 'none';
                const progRegExportModeSelector = document.getElementById('progRegExportModeSelector');
                if (progRegExportModeSelector) progRegExportModeSelector.style.display = 'none';
                resultsSourceContainer.style.display = 'none';
                subOptionsContainer.style.display = 'none';
                paperPackingContainer.style.display = 'flex';
                packingHint.textContent = "Automatically packing exactly 4 Valuation sheets per A4 page in a 2x2 grid (75% paper savings).";
                chestListModeContainer.style.display = 'none';
                expProgFilterContainer.style.display = 'block';
                if (locCont) locCont.style.display = 'flex';
                if (partCont) partCont.style.display = 'none';
                if (regModeCont) regModeCont.style.display = 'none';
            } else if (selectedType === 'Chest Number List') {
                const progRegExportModeSelector = document.getElementById('progRegExportModeSelector');
                if (progRegExportModeSelector) progRegExportModeSelector.style.display = 'none';
                resultsSourceContainer.style.display = 'none';
                subOptionsContainer.style.display = 'none';
                paperPackingContainer.style.display = 'none';
                expProgFilterContainer.style.display = 'none';
                if (locCont) locCont.style.display = 'none';
                if (partCont) partCont.style.display = 'none';
                if (regModeCont) regModeCont.style.display = 'none';

                if (chestExportModeSelector) {
                    chestExportModeSelector.style.display = 'flex';
                    const activeSubmode = chestExportModeSelector.querySelector('.exp-submode-btn.active')?.getAttribute('data-submode') || 'list';
                    if (activeSubmode === 'card') {
                        chestListModeContainer.style.display = 'none';
                        if (expFormat) {
                            expFormat.value = 'pdf';
                            expFormat.options[1].disabled = true;
                        }
                        const expOrientation = document.getElementById('expOrientation');
                        if (expOrientation) {
                            expOrientation.value = 'portrait';
                            if (expOrientation.options[1]) {
                                expOrientation.options[1].style.display = 'none'; // hide landscape
                            }
                            if (expOrientation.options[2]) {
                                expOrientation.options[2].style.display = 'block'; // show A3 Portrait
                            }
                        }
                    } else {
                        chestListModeContainer.style.display = 'flex';
                        const expOrientation = document.getElementById('expOrientation');
                        if (expOrientation) {
                            if (expOrientation.options[1]) expOrientation.options[1].style.display = 'block';
                            if (expOrientation.options[2]) expOrientation.options[2].style.display = 'none';
                        }
                    }
                } else {
                    chestListModeContainer.style.display = 'flex';
                }
            } else if (selectedType === 'Program Participation Register') {
                if (chestExportModeSelector) chestExportModeSelector.style.display = 'none';
                const progRegExportModeSelector = document.getElementById('progRegExportModeSelector');
                if (progRegExportModeSelector) progRegExportModeSelector.style.display = 'flex';
                resultsSourceContainer.style.display = 'none';
                subOptionsContainer.style.display = 'none';
                paperPackingContainer.style.display = 'none';
                chestListModeContainer.style.display = 'none';
                expProgFilterContainer.style.display = 'none';

                const activeSubmode = progRegExportModeSelector?.querySelector('.prog-reg-submode-btn.active')?.getAttribute('data-submode') || 'register';
                if (activeSubmode === 'list') {
                    if (locCont) locCont.style.display = 'flex';
                    if (partCont) partCont.style.display = 'none';
                    if (regModeCont) regModeCont.style.display = 'none';
                    document.getElementById('expOrientation').value = 'portrait';
                } else if (activeSubmode === 'student_summary') {
                    if (locCont) locCont.style.display = 'flex';
                    if (partCont) partCont.style.display = 'none';
                    if (regModeCont) regModeCont.style.display = 'none';
                    document.getElementById('expOrientation').value = 'landscape';
                } else {
                    if (locCont) locCont.style.display = 'flex';
                    if (partCont) partCont.style.display = 'flex';
                    if (regModeCont) regModeCont.style.display = 'flex';
                    document.getElementById('expOrientation').value = 'landscape';
                }
            } else {
                if (chestExportModeSelector) chestExportModeSelector.style.display = 'none';
                const progRegExportModeSelector = document.getElementById('progRegExportModeSelector');
                if (progRegExportModeSelector) progRegExportModeSelector.style.display = 'none';
                resultsSourceContainer.style.display = 'none';
                subOptionsContainer.style.display = 'none';
                paperPackingContainer.style.display = 'flex';
                packingHint.textContent = "Combine multiple programs continuously to avoid wasting paper on blank space.";
                chestListModeContainer.style.display = 'none';
                expProgFilterContainer.style.display = 'block';
                if (locCont) locCont.style.display = 'flex';
                if (partCont) partCont.style.display = 'none';
                if (regModeCont) regModeCont.style.display = 'none';
            }
            updateConditionalFilters();
            updateClassFilterState();
            updateProgramsDropdown();
            updateTeamBgVisibility();
        };
    });

    // Helper to determine if Class select should be enabled based on active mode
    function updateClassFilterState() {
        const activeCard = document.querySelector('.exp-type-card.active');
        const selectedType = activeCard ? activeCard.getAttribute('data-type') : '';
        const resultSubOption = document.getElementById('expResultSubVal')?.value || '';
        let isCategoryWise = false;

        if (selectedType === 'Program Participation Register') {
            const activeSubmode = document.getElementById('progRegExportModeSelector')?.querySelector('.prog-reg-submode-btn.active')?.getAttribute('data-submode') || 'register';
            if (activeSubmode === 'list') {
                isCategoryWise = true;
            } else if (activeSubmode === 'student_summary') {
                isCategoryWise = false;
            } else {
                isCategoryWise = (document.getElementById('expRegisterMode')?.value === 'category-wise');
            }
        } else if (selectedType === 'Chest Number List') {
            const activeSubmode = document.getElementById('chestExportModeSelector')?.querySelector('.exp-submode-btn.active')?.getAttribute('data-submode') || 'list';
            if (activeSubmode === 'list') {
                isCategoryWise = (document.getElementById('expChestMode')?.value === 'category-wise');
            } else {
                isCategoryWise = false;
            }
        }

        const catId = expCatFilter.value;

        if (selectedType === 'Results' && resultSubOption === 'Class Wise Academic & Attendance') {
            expClassFilter.innerHTML = '<option value="">All Classes</option>';
            const seen = new Set();
            allCategories.forEach(cat => {
                if (catId && catId !== 'general_programs' && cat.id !== catId) return;
                cat.classes.forEach(c => {
                    if (!seen.has(c.id)) {
                        seen.add(c.id);
                        expClassFilter.innerHTML += `<option value="${c.id}">${window.escapeHTML(c.name)}</option>`;
                    }
                });
            });
            expClassFilter.disabled = false;
        } else if (isCategoryWise) {
            expClassFilter.value = '';
            expClassFilter.disabled = true;
        } else {
            expClassFilter.innerHTML = '<option value="">All Classes</option>';
            expClassFilter.disabled = true;
            if (catId && catId !== 'general_programs') {
                const cat = allCategories.find(c => c.id === catId);
                if (cat && cat.classes) {
                    cat.classes.forEach(c => {
                        expClassFilter.innerHTML += `<option value="${c.id}">${window.escapeHTML(c.name)}</option>`;
                    });
                    expClassFilter.disabled = false;
                }
            }
        }
    }

    // Cascading Class select
    expCatFilter.onchange = async () => {
        updateClassFilterState();
        updateProgramsDropdown();
    };

    expClassFilter.onchange = () => updateProgramsDropdown();

    // Cascading Register Mode change
    const regModeSelect = document.getElementById('expRegisterMode');
    if (regModeSelect) {
        regModeSelect.onchange = () => {
            updateClassFilterState();
            updateProgramsDropdown();
        };
    }

    // Cascading Chest Mode change
    const chestModeSelect = document.getElementById('expChestMode');
    if (chestModeSelect) {
        chestModeSelect.onchange = () => {
            updateClassFilterState();
            updateProgramsDropdown();
        };
    }

    function updateProgramsDropdown() {
        const catId = expCatFilter.value;
        const classId = expClassFilter.value;
        const locVal = document.getElementById('expLocationFilter')?.value;

        expProgFilter.innerHTML = '<option value="">All Matching Programs</option>';

        const filtered = allPrograms.filter(p => {
            if (catId && p.categoryId !== catId) return false;
            if (classId && p.classId !== classId) return false;
            if (locVal && p.programLocation !== locVal) return false;
            return true;
        });

        filtered.forEach(p => {
            const numStr = p.programNumber ? `[#${p.programNumber}] ` : '';
            expProgFilter.innerHTML += `<option value="${p.id}">${numStr}${window.escapeHTML(p.programName)}</option>`;
        });
    }

    const expLocationFilter = document.getElementById('expLocationFilter');
    if (expLocationFilter) {
        expLocationFilter.onchange = () => updateProgramsDropdown();
    }

    updateProgramsDropdown();

    function initAwardTypeMultiSelect() {
        const btn = document.getElementById('expAwardTypeBtn');
        const dropdown = document.getElementById('expAwardTypeDropdown');
        const btnText = document.getElementById('expAwardTypeBtnText');
        const searchInput = document.getElementById('expAwardTypeSearch');
        const listContainer = document.getElementById('expAwardTypeList');
        const container = document.getElementById('expAwardTypeMultiSelect');

        if (!btn || !dropdown || !listContainer) return;

        btn.onclick = (e) => {
            e.stopPropagation();
            const isHidden = dropdown.style.display === 'none';
            dropdown.style.display = isHidden ? 'block' : 'none';
        };

        dropdown.onclick = (e) => {
            e.stopPropagation();
        };

        const onDocClick = (e) => {
            if (container && !container.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        };
        document.removeEventListener('click', onDocClick);
        document.addEventListener('click', onDocClick);

        if (searchInput) {
            searchInput.oninput = (e) => {
                const query = e.target.value.trim().toLowerCase();
                const options = listContainer.querySelectorAll('.exp-award-opt');
                options.forEach(opt => {
                    const text = opt.textContent.trim().toLowerCase();
                    opt.style.display = text.includes(query) ? 'flex' : 'none';
                });
            };
        }

        const checkboxes = listContainer.querySelectorAll('.exp-award-chk');
        const allChk = Array.from(checkboxes).find(c => c.value === 'All');
        const itemChks = Array.from(checkboxes).filter(c => c.value !== 'All');

        const updateDisplay = () => {
            const checkedItems = itemChks.filter(c => c.checked);
            if (allChk && allChk.checked) {
                btnText.textContent = 'All Awards';
            } else if (checkedItems.length === 0) {
                if (allChk) allChk.checked = true;
                btnText.textContent = 'All Awards';
            } else if (checkedItems.length === 1) {
                btnText.textContent = checkedItems[0].dataset.name || checkedItems[0].value;
            } else {
                const names = checkedItems.map(c => c.dataset.name || c.value);
                if (names.length <= 2) {
                    btnText.textContent = names.join(', ');
                } else {
                    btnText.textContent = `${names.length} Award Types Selected`;
                }
            }
        };

        checkboxes.forEach(chk => {
            chk.onchange = () => {
                if (chk.value === 'All') {
                    if (chk.checked) {
                        itemChks.forEach(c => c.checked = false);
                    } else {
                        const anyItemChecked = itemChks.some(c => c.checked);
                        if (!anyItemChecked) {
                            chk.checked = true;
                        }
                    }
                } else {
                    if (chk.checked) {
                        if (allChk) allChk.checked = false;
                    } else {
                        const anyItemChecked = itemChks.some(c => c.checked);
                        if (!anyItemChecked && allChk) {
                            allChk.checked = true;
                        }
                    }
                }
                updateDisplay();
            };
        });

        updateDisplay();
    }

    initAwardTypeMultiSelect();

    // Trigger initial click on the default card to synchronize UI state
    const defaultActiveCard = body.querySelector('.exp-type-card.active') || body.querySelector('.exp-type-card');
    if (defaultActiveCard && typeof defaultActiveCard.onclick === 'function') {
        defaultActiveCard.onclick();
    }

    document.getElementById('btnNewExpCancel').onclick = closeExportDrawer;

    // Phase 2 Form Validations & Queue write
    document.getElementById('btnNewExpGenerate').onclick = async () => {
        const btn = document.getElementById('btnNewExpGenerate');
        btn.disabled = true;
        btn.textContent = 'Queuing Export...';

        const categoryId = expCatFilter.value;
        const categoryName = categoryId === 'general_programs' ? 'General' : (categoryId ? allCategories.find(c => c.id === categoryId)?.name : 'All');
        const classId = expClassFilter.value;
        let className = '';
        if (classId) {
            for (const cat of allCategories) {
                const found = cat.classes && cat.classes.find(cls => cls.id === classId);
                if (found) {
                    className = found.name;
                    break;
                }
            }
        }
        const programId = expProgFilter.value;
        const programName = programId ? allPrograms.find(p => p.id === programId)?.programName : 'All';
        const gender = document.getElementById('expGenderFilter').value;
        const teamId = document.getElementById('expTeamFilter').value;
        const teamName = teamId ? allTeams.find(t => t.id === teamId)?.name : 'All';

        const resultSubOption = selectedType === 'Results' ? document.getElementById('expResultSubVal').value : 'Team Wise';

        let includedPositions = null;
        if (selectedType === 'Results' && resultSubOption !== 'Class Wise Academic & Attendance') {
            const posChks = document.querySelectorAll('.exp-pos-chk:checked');
            includedPositions = Array.from(posChks).map(c => c.value);
            if (includedPositions.length === 0) {
                btn.disabled = false;
                btn.innerHTML = '✨ Generate Export';
                window.showToast("Please select at least one position.", "error");
                return;
            }
        }

        let awardTypeFilter = 'All';
        if (selectedType === 'Results' && resultSubOption === 'Class Wise Academic & Attendance') {
            const listContainer = document.getElementById('expAwardTypeList');
            if (listContainer) {
                const checkboxes = listContainer.querySelectorAll('.exp-award-chk');
                const allChk = Array.from(checkboxes).find(c => c.value === 'All');
                if (allChk && allChk.checked) {
                    awardTypeFilter = 'All';
                } else {
                    const checkedItems = Array.from(checkboxes).filter(c => c.value !== 'All' && c.checked);
                    if (checkedItems.length === 0) {
                        awardTypeFilter = 'All';
                    } else {
                        awardTypeFilter = checkedItems.map(c => c.value);
                    }
                }
            }
        }

        const format = document.getElementById('expFormat').value;
        const orientation = document.getElementById('expOrientation').value;
        const srcIncludeSubmitted = selectedType === 'Results' && document.getElementById('srcIncludeSubmitted').checked;
        const srcIncludeDraft = selectedType === 'Results' && document.getElementById('srcIncludeDraft').checked;
        const compactPacking = selectedType === 'Results' ? true : document.getElementById('expCompactPacking').checked;
        
        const expProgramOrderRadio = document.querySelector('input[name="expProgramOrderFilter"]:checked');
        const programOrder = expProgramOrderRadio ? expProgramOrderRadio.value : 'default';

        const chestSort = 'chest';
        const chestMode = selectedType === 'Chest Number List' ? document.getElementById('expChestMode').value : 'class-wise';
        const programLocation = ['Green Room Sign', 'Valuation Sheet', 'Call List', 'Results', 'Program Participation Register'].includes(selectedType) ? document.getElementById('expLocationFilter').value : '';
        const participationType = selectedType === 'Program Participation Register' ? document.getElementById('expParticipationFilter').value : '';
        const registerMode = selectedType === 'Program Participation Register' ? document.getElementById('expRegisterMode').value : 'class-wise';

        // Visual Validation Flow: alert if search parameters yield 0 matching programs (Phase 2 validation)
        let filteredProgs = [...allPrograms];
        if (programId) {
            filteredProgs = allPrograms.filter(p => p.id === programId);
        } else {
            filteredProgs = allPrograms.filter(p => {
                if (participationType === 'general') {
                    if (p.categoryId !== 'general_programs' && p.programType !== 'general') return false;
                } else {
                    if (categoryId && p.categoryId !== categoryId) return false;
                }
                if (classId && p.classId !== classId) return false;
                if (gender && p.genderCategory !== gender) return false;
                if (programLocation && p.programLocation !== programLocation) return false;
                if (participationType) {
                    if (participationType === 'general') {
                        if (p.categoryId !== 'general_programs' && p.programType !== 'general') return false;
                    } else if (participationType === 'group') {
                        if (p.programType !== 'group') return false;
                    } else if (participationType === 'individual') {
                        if (p.programType !== 'individual') return false;
                    }
                }
                return true;
            });
        }

        if (filteredProgs.length === 0 && selectedType !== 'Results' && selectedType !== 'Chest Number List' && selectedType !== 'Program Participation Register') {
            window.showToast("Cannot generate export: No programs match selected parameters.", "error");
            btn.disabled = false;
            btn.textContent = '⚡ Generate Export';
            return;
        }

        const activeSubmode = selectedType === 'Chest Number List' ? (document.getElementById('chestExportModeSelector')?.querySelector('.exp-submode-btn.active')?.getAttribute('data-submode') || 'list') : 'list';
        const progRegSubmode = selectedType === 'Program Participation Register' ? (document.getElementById('progRegExportModeSelector')?.querySelector('.prog-reg-submode-btn.active')?.getAttribute('data-submode') || 'register') : 'register';

        const dateStr = new Date().toISOString().split('T')[0];
        const cleanName = (str) => str.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();

        let fileTypePrefix = cleanName(selectedType);
        if (selectedType === 'Results') {
            fileTypePrefix = cleanName(resultSubOption);
        } else if (selectedType === 'Program Participation Register') {
            if (progRegSubmode === 'list') {
                fileTypePrefix = 'PROGRAM_LIST';
            } else if (progRegSubmode === 'student_summary') {
                fileTypePrefix = 'STUDENT_WISE_PARTICIPATION_SUMMARY';
            } else {
                fileTypePrefix = `${cleanName(selectedType)}_${cleanName(registerMode)}`;
            }
        } else if (selectedType === 'Chest Number List') {
            if (activeSubmode === 'card') {
                fileTypePrefix = 'CHEST_NUMBER_PROGRAM_CARD';
            } else {
                fileTypePrefix = `${cleanName(selectedType)}_${cleanName(chestMode)}`;
            }
        }

        let scopeText = '';
        if (programId) scopeText = `_${cleanName(programName)}`;
        else if (categoryId) scopeText = `_${cleanName(categoryName)}`;

        let finalFilename = `${fileTypePrefix}${scopeText}_${dateStr}.${format}`;
        if (selectedType === 'Results' && resultSubOption === 'Program Wise') {
            if (programOrder === 'result_number') finalFilename = `${fileTypePrefix}${scopeText}_Result_Number_Wise_${dateStr}.${format}`;
            else if (programOrder === 'category_order') finalFilename = `${fileTypePrefix}${scopeText}_Category_Order_${dateStr}.${format}`;
        }

        let awardTypeSummary = 'All';
        if (Array.isArray(awardTypeFilter)) {
            const checkedNames = awardTypeFilter.map(val => {
                const found = allAwardTypes.find(t => t.id === val);
                return found ? found.name : val;
            });
            awardTypeSummary = checkedNames.join(', ');
        } else {
            awardTypeSummary = awardTypeFilter;
        }

        try {
            const instId = window.currentInstituteId;
            const ref = collection(db, "institutes", instId, "exports");

            const payload = {
                type: selectedType,
                fileName: finalFilename,
                summary: selectedType === 'Results' && resultSubOption === 'Class Wise Academic & Attendance'
                    ? `Scope: ${classId ? className : 'All Classes'} | Award Type: ${awardTypeSummary} [${format.toUpperCase()}]`
                    : (selectedType === 'Program Participation Register'
                        ? (progRegSubmode === 'list'
                            ? `Scope: ${categoryName} | Mode: Program List [${format.toUpperCase()}]`
                            : (progRegSubmode === 'student_summary'
                                ? `Scope: ${categoryName}${className ? ` (${className})` : ''} | Mode: Student-wise Summary [${format.toUpperCase()}]`
                                : `Scope: ${categoryName} | Mode: ${registerMode === 'category-wise' ? 'Category-wise' : 'Class-wise'} | Program: ${programName} | Team: ${teamName} [${format.toUpperCase()}]`))
                        : (selectedType === 'Chest Number List'
                            ? (activeSubmode === 'card'
                                ? `Scope: ${categoryName}${className ? ` (${className})` : ''} | Mode: Chest Number & Program Card | Team: ${teamName} [${format.toUpperCase()}]`
                                : `Scope: ${categoryName}${className ? ` (${className})` : ''} | Mode: ${chestMode === 'category-wise' ? 'Category-wise' : 'Class-wise'} | Team: ${teamName} [${format.toUpperCase()}]`)
                            : `Scope: ${categoryName}${className ? ` (${className})` : ''} | Program: ${programName} | Team: ${teamName} [${format.toUpperCase()}]`)),
                status: 'Pending',
                queuedAt: serverTimestamp(),
                completedIn: '—',
                generatedBy: window.currentInstituteDetails?.name || 'Admin',
                filters: {
                    type: selectedType,
                    chestSubmode: activeSubmode,
                    progRegSubmode,
                    resultSubOption,
                    includedPositions,
                    awardTypeFilter,
                    categoryId,
                    classId,
                    programId,
                    gender,
                    teamId,
                    format,
                    orientation,
                    srcIncludeSubmitted,
                    srcIncludeDraft,
                    compactPacking,
                    chestSort,
                    programLocation,
                    participationType,
                    registerMode,
                    chestMode,
                    programOrder,
                    enableTeamBg: isTeamBgEnabled
                }
            };

            const docRef = await addDoc(ref, payload);
            closeExportDrawer();

            simulateExportProcessing(docRef.id);

        } catch (err) {
            console.error("Generate write error:", err);
            window.showToast("Failed to queue export document.", "error");
            btn.disabled = false;
            btn.textContent = '⚡ Generate Export';
        }
    };
}

// ─────────────────────────────────────────────
// Queuing Status Simulation Pipeline
// ─────────────────────────────────────────────
async function simulateExportProcessing(docId) {
    const instId = window.currentInstituteId;
    const docRef = doc(db, "institutes", instId, "exports", docId);

    // Transitions from Pending ➔ Processing after 400ms
    setTimeout(async () => {
        try {
            await updateDoc(docRef, { status: 'Processing' });

            // Transitions to Completed after 900ms
            setTimeout(async () => {
                try {
                    const elapsed = (Math.random() * 0.4 + 0.5).toFixed(1);
                    await updateDoc(docRef, {
                        status: 'Completed',
                        completedIn: `${elapsed}s`
                    });
                    window.showToast("⚡ Export document generated successfully!", "success");
                } catch (e) {
                    await updateDoc(docRef, { status: 'Failed' });
                }
            }, 900);

        } catch (e) {
            await updateDoc(docRef, { status: 'Failed' });
        }
    }, 400);
}

// ─────────────────────────────────────────────
// Retry Handler for Failed Items
// ─────────────────────────────────────────────
async function triggerRetry(exp) {
    const instId = window.currentInstituteId;
    const docRef = doc(db, "institutes", instId, "exports", exp.id);

    try {
        await updateDoc(docRef, {
            status: 'Pending',
            completedIn: '—',
            queuedAt: serverTimestamp()
        });
        window.showToast("🔄 Retrying export generation...", "info");
        simulateExportProcessing(exp.id);
    } catch (e) {
        console.error(e);
    }
}

// ─────────────────────────────────────────────
// Deletion Safety Trigger
// ─────────────────────────────────────────────
async function triggerDelete(exp) {
    const confirmed = await window.customConfirm("Are you sure you want to delete this export history log?\n(This will not affect any students, results, or program records).");
    if (!confirmed) return;

    try {
        const instId = window.currentInstituteId;
        await deleteDoc(doc(db, "institutes", instId, "exports", exp.id));
        window.showToast("History log removed successfully.", "success");
    } catch (e) {
        console.error(e);
        window.showToast("Failed to delete log.", "error");
    }
}

// ─────────────────────────────────────────────
// Sub-Collection Helper: Loads students dynamically
// ─────────────────────────────────────────────
async function loadParticipants(prog, limitTeamId, studentMap = {}) {
    const snap = await getDocs(collection(db, "institutes", window.currentInstituteId, "programs", prog.id, "participants"));
    const pType = (prog.programType || '').toLowerCase();
    const activeTeamIds = new Set((allTeams || []).map(t => t.id));
    const list = [];

    console.log(`====================================================================`);
    console.log(`[EXPORT ARCHITECTURE] loadParticipants() for Program "${prog.id}" ("${prog.programName}")`);
    console.log(`Total documents read in participants subcollection: ${snap.docs.length}`);
    console.log(`Filter limitTeamId: "${limitTeamId}"`);

    // Group documents by normalized teamId to aggregate multi-container group data
    const docsByTeam = new Map();

    snap.docs.forEach((d, idx) => {
        const p = d.data();
        const normalizedId = window.normalizeTeamId ? window.normalizeTeamId(p.teamId) : (p.teamId === 'teamless' ? '' : (p.teamId || ''));

        let status = 'LOADED';
        let skipReason = '';

        if (normalizedId && activeTeamIds.size > 0 && !activeTeamIds.has(normalizedId)) {
            status = 'SKIPPED';
            skipReason = `teamId "${normalizedId}" not in activeTeamIds`;
        } else if (limitTeamId && limitTeamId !== 'all' && limitTeamId !== 'All' && normalizedId !== limitTeamId) {
            status = 'SKIPPED';
            skipReason = `normalizedId "${normalizedId}" !== limitTeamId "${limitTeamId}"`;
        }

        const isGroupData = p.type === 'group' || Array.isArray(p.groups) || pType === 'group' || pType === 'team' || pType === 'team-based' || pType === 'special';
        const groupsCount = Array.isArray(p.groups) ? p.groups.length : 0;

        console.log(`  Export Doc #${idx + 1} ID: "${d.id}" | Status: ${status} ${skipReason ? `(Reason: ${skipReason})` : ''} | type: "${p.type}" | teamId: "${normalizedId}" | categoryId: "${p.categoryId}" | groups.length: ${groupsCount}`);

        if (status === 'SKIPPED') return;

        if (!docsByTeam.has(normalizedId)) {
            docsByTeam.set(normalizedId, []);
        }
        docsByTeam.get(normalizedId).push({ docId: d.id, data: p, isGroupData });
    });

    docsByTeam.forEach((teamEntries, normalizedId) => {
        const hasGroupData = teamEntries.some(e => e.isGroupData);

        if (hasGroupData) {
            const aggregatedGroups = [];
            let teamName = '';

            teamEntries.forEach(e => {
                const p = e.data;
                if (!teamName && p.teamName) teamName = p.teamName;
                const groups = Array.isArray(p.groups) ? p.groups : [];
                groups.forEach(g => {
                    const members = (g.members || []).map(m => {
                        const resolvedStudent = studentMap[m.studentId];
                        return {
                            studentId: m.studentId || '',
                            name: resolvedStudent ? resolvedStudent.name : (m.studentName || '—'),
                            chestNumber: resolvedStudent ? resolvedStudent.chestNumber : '—'
                        };
                    });
                    aggregatedGroups.push({
                        id: g.id || `${normalizedId}_${g.name || 'group'}`,
                        isGroup: true,
                        name: g.name || p.teamName || 'Group',
                        teamName: p.teamName || teamName || '',
                        teamId: normalizedId,
                        members: members
                    });
                });
            });

            if (aggregatedGroups.length > 0) {
                aggregatedGroups.forEach(g => list.push(g));
            } else {
                list.push({
                    id: normalizedId || `team_${Date.now()}`,
                    isGroup: true,
                    name: teamName || 'Team',
                    teamName: teamName || '',
                    teamId: normalizedId,
                    members: []
                });
            }
        } else {
            teamEntries.forEach(e => {
                const p = e.data;
                const resolvedStudent = studentMap[p.studentId];
                list.push({
                    studentId: p.studentId || '',
                    name: resolvedStudent ? resolvedStudent.name : (p.studentName || '—'),
                    chestNumber: resolvedStudent ? resolvedStudent.chestNumber : (p.chestNumber || '—'),
                    teamName: p.teamName || '',
                    teamId: normalizedId
                });
            });
        }
    });

    console.log(`[EXPORT ARCHITECTURE] Total aggregated items exported for Program "${prog.id}": ${list.length}`);
    console.log(`====================================================================`);

    // De-duplicate list items by unique key (teamId + group name + member chests)
    const uniqueList = [];
    const seenKeys = new Set();

    list.forEach(item => {
        const memberChests = (item.members || []).map(m => m.chestNumber || m.studentId).sort().join('-');
        const key = item.isGroup
            ? `${item.teamId}_${(item.name || '').trim().toLowerCase()}_${memberChests}`
            : `${item.teamId}_${item.studentId}`;
        if (!seenKeys.has(key)) {
            seenKeys.add(key);
            uniqueList.push(item);
        }
    });

    return uniqueList;
}


// Helper to resolve winner participant/group name, team, and member chest numbers
function resolveWinnerParticipant(prog, w, participantsList, studentMap) {
    const parts = participantsList || [];
    const pType = (prog.programType || prog.type || '').toLowerCase();
    const isGroupEvent = pType === 'group' || prog.type === 'Group';

    let matchedPart = null;

    // 1. Match by groupId
    if (w.groupId) {
        matchedPart = parts.find(p => p.id === w.groupId);
    }
    // 2. Match by exact registered name (group name or student name)
    if (!matchedPart && w.studentName) {
        const cleanWName = w.studentName.trim().toLowerCase();
        matchedPart = parts.find(p => (p.name || '').trim().toLowerCase() === cleanWName);
    }
    // 3. Match by name and teamId
    if (!matchedPart && w.studentName && w.teamId) {
        const cleanWName = w.studentName.trim().toLowerCase();
        matchedPart = parts.find(p => (p.name || '').trim().toLowerCase() === cleanWName && String(p.teamId) === String(w.teamId));
    }
    // 4. Match by teamId if it's a group program and there's only one group for that team
    if (!matchedPart && isGroupEvent && w.teamId) {
        const teamGroups = parts.filter(p => p.isGroup && String(p.teamId) === String(w.teamId));
        if (teamGroups.length === 1) {
            matchedPart = teamGroups[0];
        }
    }
    // 5. Match by teamName if it's a group program and there's only one group for that team name
    if (!matchedPart && isGroupEvent && w.teamName) {
        const teamGroups = parts.filter(p => p.isGroup && p.teamName === w.teamName);
        if (teamGroups.length === 1) {
            matchedPart = teamGroups[0];
        }
    }

    if (matchedPart) {
        if (matchedPart.isGroup === true || Array.isArray(matchedPart.members)) {
            // Group participant
            const members = matchedPart.members || [];
            const memberStudents = [];
            const chestNos = [];

            members.forEach(m => {
                let resolvedStudent = studentMap[m.studentId];
                if (!resolvedStudent && m.name) {
                    const cleanName = m.name.trim().toLowerCase();
                    resolvedStudent = Object.values(studentMap).find(s => (s.name || '').trim().toLowerCase() === cleanName);
                }

                if (resolvedStudent) {
                    chestNos.push(resolvedStudent.chestNumber || m.chestNumber || '—');
                    memberStudents.push({
                        studentId: resolvedStudent.id || m.studentId || '',
                        name: resolvedStudent.name || m.name || '—',
                        chestNumber: resolvedStudent.chestNumber || m.chestNumber || '—',
                        className: resolvedStudent.className || '—',
                        classId: resolvedStudent.classId || '',
                        categoryName: resolvedStudent.categoryName || '—',
                        categoryId: resolvedStudent.categoryId || '',
                        teamName: resolvedStudent.teamName || matchedPart.teamName || w.teamName || '—',
                        teamId: resolvedStudent.teamId || matchedPart.teamId || w.teamId || '',
                        gender: resolvedStudent.gender || ''
                    });
                } else {
                    chestNos.push(m.chestNumber || '—');
                    memberStudents.push({
                        studentId: m.studentId || '',
                        name: m.name || '—',
                        chestNumber: m.chestNumber || '—',
                        className: '—',
                        classId: '',
                        categoryName: '—',
                        categoryId: '',
                        teamName: matchedPart.teamName || w.teamName || '—',
                        teamId: matchedPart.teamId || w.teamId || '',
                        gender: ''
                    });
                }
            });

            // Filter out empty/invalid chest numbers for display
            const validChestNos = chestNos.filter(c => c && c !== '—');
            const chestNumbersStr = validChestNos.length > 0 ? validChestNos.join(' · ') : '—';

            return {
                displayName: matchedPart.name || w.studentName || w.teamName || '—',
                chestNumbers: chestNumbersStr,
                memberStudents: memberStudents,
                teamId: matchedPart.teamId || w.teamId || '',
                teamName: matchedPart.teamName || w.teamName || '—'
            };
        } else {
            // Individual participant entry
            let resolvedStudent = studentMap[matchedPart.studentId] || studentMap[w.studentId];
            if (!resolvedStudent && matchedPart.name) {
                const cleanName = matchedPart.name.trim().toLowerCase();
                resolvedStudent = Object.values(studentMap).find(s => (s.name || '').trim().toLowerCase() === cleanName);
            }
            if (!resolvedStudent && w.studentName) {
                const cleanName = w.studentName.trim().toLowerCase();
                resolvedStudent = Object.values(studentMap).find(s => (s.name || '').trim().toLowerCase() === cleanName);
            }

            const studentInfo = resolvedStudent ? {
                studentId: resolvedStudent.id || matchedPart.studentId || w.studentId || '',
                name: resolvedStudent.name || matchedPart.name || w.studentName || '—',
                chestNumber: resolvedStudent.chestNumber || matchedPart.chestNumber || w.chestNumber || '—',
                className: resolvedStudent.className || '—',
                classId: resolvedStudent.classId || '',
                categoryName: resolvedStudent.categoryName || '—',
                categoryId: resolvedStudent.categoryId || '',
                teamName: resolvedStudent.teamName || matchedPart.teamName || w.teamName || '—',
                teamId: resolvedStudent.teamId || matchedPart.teamId || w.teamId || '',
                gender: resolvedStudent.gender || ''
            } : {
                studentId: matchedPart.studentId || w.studentId || '',
                name: matchedPart.name || w.studentName || '—',
                chestNumber: matchedPart.chestNumber || w.chestNumber || '—',
                className: '—',
                classId: '',
                categoryName: '—',
                categoryId: '',
                teamName: matchedPart.teamName || w.teamName || '—',
                teamId: matchedPart.teamId || w.teamId || '',
                gender: ''
            };

            return {
                displayName: studentInfo.name,
                chestNumbers: studentInfo.chestNumber,
                memberStudents: [studentInfo],
                teamId: matchedPart.teamId || w.teamId || '',
                teamName: matchedPart.teamName || w.teamName || '—'
            };
        }
    } else {
        // Fallback: No matched participant found in parts list
        // Try to resolve student as individual
        let resolvedStudent = studentMap[w.studentId];
        if (!resolvedStudent && w.studentName) {
            const cleanName = w.studentName.trim().toLowerCase();
            resolvedStudent = Object.values(studentMap).find(s => (s.name || '').trim().toLowerCase() === cleanName);
        }

        const studentInfo = resolvedStudent ? {
            studentId: resolvedStudent.id || w.studentId || '',
            name: resolvedStudent.name || w.studentName || '—',
            chestNumber: resolvedStudent.chestNumber || w.chestNumber || '—',
            className: resolvedStudent.className || '—',
            categoryName: resolvedStudent.categoryName || '—',
            teamName: resolvedStudent.teamName || w.teamName || '—'
        } : {
            studentId: w.studentId || '',
            name: w.studentName || '—',
            chestNumber: w.chestNumber || '—',
            className: '—',
            categoryName: '—',
            teamName: w.teamName || '—'
        };

        return {
            displayName: studentInfo.name,
            chestNumbers: studentInfo.chestNumber,
            memberStudents: [studentInfo],
            teamId: w.teamId || '',
            teamName: w.teamName || '—'
        };
    }
}

// ─────────────────────────────────────────────
// Dynamic Compilation & Download Router
// ─────────────────────────────────────────────
async function triggerDownload(exp, isDownload = false) {
    loadTeamBackgrounds();
    await ensureEventDetailsLoaded();
    window.showToast(`Loading data for ${exp.fileName}...`, "info");
    const instId = window.currentInstituteId;

    try {
        const f = exp.filters;
        if (!f) throw new Error("Filters parameters are missing.");

        if (f.type === 'Chest Number List') {
            let studentMap = {};
            try {
                const studentsSnap = await getDocs(collection(db, "institutes", instId, "students"));
                studentsSnap.forEach(d => {
                    studentMap[d.id] = { id: d.id, ...d.data() };
                });
            } catch (err) {
                console.error("Failed to load students collection:", err);
            }

            if (Object.keys(studentMap).length === 0) {
                window.showToast("No students found in the database.", "warning");
                return;
            }

            let participantsMap = {};
            if (f.chestSubmode === 'card') {
                if (!allPrograms || allPrograms.length === 0) {
                    allPrograms = await getCachedPrograms(instId) || [];
                }
                let targetPrograms = allPrograms;
                if (f.categoryId) {
                    targetPrograms = allPrograms.filter(p => p.categoryId === f.categoryId || p.categoryId === 'general_programs' || p.programType === 'general');
                }
                const participantPromises = targetPrograms.map(p => loadParticipants(p, f.teamId, studentMap));
                const allParts = await Promise.all(participantPromises);
                targetPrograms.forEach((p, idx) => {
                    participantsMap[p.id] = allParts[idx];
                });
            }

            if (f.format === 'csv') {
                compileCSV(exp, f, [], [], {}, studentMap);
            } else {
                compilePDF(exp, f, [], [], participantsMap, studentMap, isDownload);
            }
            return;
        }

        // 1. Fetch matching programs list
        let programs = [...allPrograms];
        if (f.programId) {
            programs = allPrograms.filter(p => p.id === f.programId);
        } else {
            programs = allPrograms.filter(p => {
                if (f.progRegSubmode === 'student_summary') {
                    if (f.categoryId && p.categoryId !== f.categoryId && p.categoryId !== 'general_programs' && p.programType !== 'general') return false;
                } else if (f.participationType === 'general') {
                    if (p.categoryId !== 'general_programs' && p.programType !== 'general') return false;
                } else {
                    if (f.categoryId && p.categoryId !== f.categoryId) return false;
                }
                if (f.classId && p.classId && p.classId !== f.classId) return false;
                if (f.gender && p.genderCategory && p.genderCategory !== f.gender && p.genderCategory !== 'General' && p.genderCategory !== 'Mixed') return false;
                if (f.programLocation && (p.programLocation || p.location) !== f.programLocation) return false;
                if (f.participationType) {
                    if (f.participationType === 'general') {
                        if (p.categoryId !== 'general_programs' && p.programType !== 'general') return false;
                    } else if (f.participationType === 'group') {
                        if (p.programType !== 'group') return false;
                    } else if (f.participationType === 'individual') {
                        if (p.programType !== 'individual') return false;
                    }
                }
                return true;
            });
        }

        if (programs.length === 0 && f.type !== 'Results') {
            window.showToast("No programs match the selected filters.", "warning");
            return;
        }

        // Phase 8 query scoping optimization: Only load results when explicitly requested
        let resultsList = [];
        let classAwards = [];
        if (f.type === 'Results') {
            if (f.resultSubOption === 'Class Wise Academic & Attendance') {
                const awardsSnap = await getDocs(collection(db, "institutes", instId, "metadata"));
                classAwards = awardsSnap.docs
                    .filter(d => d.id.startsWith("class_award_"))
                    .map(d => ({ id: d.id, ...d.data() }));
            } else {
                const resultsSnap = await getDocs(collection(db, "institutes", instId, "results"));
                resultsList = resultsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            }
        }

        // Resolve students cache map dynamically to ensure chest numbers are up-to-date
        let studentMap = {};
        try {
            const studentsSnap = await getDocs(collection(db, "institutes", instId, "students"));
            studentsSnap.forEach(d => {
                studentMap[d.id] = { id: d.id, ...d.data() };
            });
        } catch (err) {
            console.error("Failed to load students collection:", err);
        }

        // Phase 7 Firestore Parallel Fetch Optimization using Promise.all
        let participantsMap = {};
        if (f.progRegSubmode !== 'list' && (f.type !== 'Results' || f.resultSubOption === 'Participants Without Major Prizes' || f.resultSubOption === 'Student Prize Distribution' || f.resultSubOption === 'Prize Distribution Register' || f.resultSubOption === 'Team Wise' || f.resultSubOption === 'Program Wise')) {
            const participantPromises = programs.map(p => loadParticipants(p, f.teamId, studentMap));
            const allParts = await Promise.all(participantPromises);
            programs.forEach((p, idx) => {
                participantsMap[p.id] = allParts[idx];
            });
        }

        // 3. Compile and trigger
        if (f.format === 'csv') {
            compileCSV(exp, f, programs, resultsList, participantsMap, studentMap, classAwards);
        } else {
            compilePDF(exp, f, programs, resultsList, participantsMap, studentMap, isDownload, classAwards);
        }

    } catch (err) {
        console.error("Compilation error:", err);
        window.showToast(`Unable to download: ${err.message || err}`, "error");
    }
}

// Helper to construct verbose program labels for exports
function getProgramExportLabel(p) {
    const numStr = p.programNumber ? `${p.programNumber} – ` : '';

    // Determine type label
    let typeLabel = 'Individual';
    if (p.categoryId === 'general_programs' || p.programType === 'general') {
        typeLabel = 'General';
    } else if (p.programType === 'group') {
        typeLabel = 'Group';
    }

    const locLabel = p.programLocation || p.location || 'Stage';

    return `${numStr}${p.programName} (${typeLabel} • ${locLabel})`;
}

function getProgramGenderDisplay(p) {
    const raw = (p.genderCategory || p.gender || '').toString().trim();
    const lower = raw.toLowerCase();
    if (lower === 'boys') return 'Boys';
    if (lower === 'girls') return 'Girls';
    return 'General';
}

function getCategoryMinClassSortInfo(catName) {
    const isGeneral = (catName || '').trim().toUpperCase() === 'GENERAL';
    if (isGeneral) {
        return { isGeneral: true, minNum: -Infinity, maxNum: -Infinity, minName: '', maxName: '', catIndex: -1 };
    }

    const catIndex = allCategories.findIndex(c =>
        (c.name || '').trim().toLowerCase() === (catName || '').trim().toLowerCase() || c.id === catName
    );
    const cat = catIndex !== -1 ? allCategories[catIndex] : null;

    if (!cat || !Array.isArray(cat.classes) || cat.classes.length === 0) {
        return { isGeneral: false, minNum: Infinity, maxNum: Infinity, minName: catName, maxName: catName, catIndex: catIndex !== -1 ? catIndex : Infinity };
    }

    let minNum = Infinity;
    let maxNum = -Infinity;
    let minName = '';
    let maxName = '';

    cat.classes.forEach(cls => {
        const name = (typeof cls === 'string' ? cls : (cls.name || cls.id || '')).trim();
        let num = Infinity;
        const match = name.match(/\d+/);
        if (match) {
            num = parseInt(match[0], 10);
        } else {
            const lower = name.toLowerCase();
            if (lower.includes('lkg')) num = -2;
            else if (lower.includes('ukg')) num = -1;
            else if (lower.includes('kg') || lower.includes('nursery') || lower.includes('play')) num = -3;
        }

        if (num < minNum) {
            minNum = num;
            minName = name;
        }
        if (num > maxNum) {
            maxNum = num;
            maxName = name;
        }
    });

    if (minNum === Infinity) {
        const sortedNames = cat.classes
            .map(cls => typeof cls === 'string' ? cls : (cls.name || cls.id || ''))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
        minName = sortedNames[0] || '';
        maxName = sortedNames[sortedNames.length - 1] || '';
    }

    return {
        isGeneral: false,
        minNum,
        maxNum,
        minName,
        maxName,
        catIndex: catIndex !== -1 ? catIndex : Infinity
    };
}

function compareCategoriesByMinClass(catNameA, catNameB) {
    const infoA = getCategoryMinClassSortInfo(catNameA);
    const infoB = getCategoryMinClassSortInfo(catNameB);

    if (infoA.isGeneral) return -1;
    if (infoB.isGeneral) return 1;

    // 1. Sort by minimum class
    if (infoA.minNum !== infoB.minNum) {
        return infoA.minNum - infoB.minNum;
    }
    if (infoA.minNum === Infinity && infoB.minNum === Infinity) {
        if (infoA.minName !== infoB.minName) {
            const cmp = infoA.minName.localeCompare(infoB.minName, undefined, { numeric: true, sensitivity: 'base' });
            if (cmp !== 0) return cmp;
        }
    }

    // 2. Tie breaker: Sort by maximum class in ascending order
    if (infoA.maxNum !== infoB.maxNum) {
        return infoA.maxNum - infoB.maxNum;
    }
    if (infoA.maxNum === -Infinity && infoB.maxNum === -Infinity) {
        if (infoA.maxName !== infoB.maxName) {
            const cmp = infoA.maxName.localeCompare(infoB.maxName, undefined, { numeric: true, sensitivity: 'base' });
            if (cmp !== 0) return cmp;
        }
    }

    // 3. Final tie breaker: Preserve category creation order (catIndex in allCategories)
    if (infoA.catIndex !== infoB.catIndex) {
        return infoA.catIndex - infoB.catIndex;
    }

    return catNameA.localeCompare(catNameB, undefined, { sensitivity: 'base' });
}

// Dynamic script loader for html2pdf
async function loadHtml2Pdf() {
    if (window.html2pdf) return window.html2pdf;
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
        script.onload = () => resolve(window.html2pdf);
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

// ─────────────────────────────────────────────
// PDF Dynamic Document Compiler (Iframe Printing)
// ─────────────────────────────────────────────
async function compilePDF(exp, f, programs, resultsList, participantsMap, studentMap = {}, isDownload = false, classAwards = []) {
    let htmlContent = '';
    const orientation = f.orientation || 'portrait';

    const buildColumnItems = (progsList) => {
        // Exclude General Programs completely unless we are exporting general programs
        const isGeneralExport = f.categoryId === 'general_programs' || f.participationType === 'general';
        const filteredList = isGeneralExport
            ? progsList
            : progsList.filter(p => p.categoryId !== 'general_programs' && p.programType !== 'general');

        // Group into Stage Individual, Off-Stage Individual, and Group programs
        const indStageProgs = filteredList.filter(p => p.type === 'Individual' && p.programLocation === 'Stage');
        const indOffStageProgs = filteredList.filter(p => p.type === 'Individual' && p.programLocation !== 'Stage');
        const groupProgs = filteredList.filter(p => p.type === 'Group');

        // Sort inside each section alphabetically
        indStageProgs.sort((a, b) => (a.programName || '').localeCompare(b.programName || ''));
        indOffStageProgs.sort((a, b) => (a.programName || '').localeCompare(b.programName || ''));
        groupProgs.sort((a, b) => (a.programName || '').localeCompare(b.programName || ''));

        const items = [];

        // 1. INDIVIDUAL STAGE PROGRAMS
        indStageProgs.forEach(p => items.push({ type: 'program', program: p }));

        // Separator 1: Between Section 1 (Stage) and Section 2 (Off Stage) or Section 3 (Group)
        if (indStageProgs.length > 0 && (indOffStageProgs.length > 0 || groupProgs.length > 0)) {
            items.push({ type: 'separator' });
        }

        // 2. INDIVIDUAL OFF STAGE PROGRAMS
        indOffStageProgs.forEach(p => items.push({ type: 'program', program: p }));

        // Separator 2: Between Section 2 (Off Stage) and Section 3 (Group)
        if (indOffStageProgs.length > 0 && groupProgs.length > 0) {
            items.push({ type: 'separator' });
        }

        // 3. GROUP PROGRAMS
        groupProgs.forEach(p => items.push({ type: 'program', program: p }));

        return items;
    };

    if (f.type === 'Chest Number List') {
        const isCompact = f.compactPacking !== false; // compact layout true by default

        // 1. Filter students
        let studentsList = Object.values(studentMap);

        if (f.categoryId) {
            studentsList = studentsList.filter(s => s.categoryId === f.categoryId);
        }

        // In card submode, always apply the classId filter if present. In list submode, check chestMode.
        const shouldApplyClassFilter = f.chestSubmode === 'card' ? !!f.classId : (f.chestMode !== 'category-wise' && f.classId);
        if (shouldApplyClassFilter) {
            studentsList = studentsList.filter(s => s.classId === f.classId);
        }

        if (f.teamId) {
            studentsList = studentsList.filter(s => String(s.teamId) === String(f.teamId));
        }
        if (f.gender === 'Boys') {
            studentsList = studentsList.filter(s => s.gender === 'Male');
        } else if (f.gender === 'Girls') {
            studentsList = studentsList.filter(s => s.gender === 'Female');
        }

        if (studentsList.length === 0) {
            htmlContent = `
                <div style="text-align:center; padding:4rem; color:#dc2626; border:1px solid #fecaca; border-radius:12px; background:#fef2f2;">
                    <h3 style="margin:0;">⚠️ No matching students found.</h3>
                    <p style="color:#64748b; margin-top:0.25rem; font-weight:600;">Check your filter criteria and try again.</p>
                </div>
            `;
        } else {
            // Map team names
            const teamNamesMap = {};
            allTeams.forEach(t => {
                if (t.id) teamNamesMap[String(t.id)] = t.name;
            });

            // 2. Sort students according to chestSort parameter
            const sortRule = f.chestSort || 'chest';
            if (sortRule === 'chest') {
                studentsList.sort((a, b) => {
                    const chestA = a.chestNumber || '';
                    const chestB = b.chestNumber || '';
                    return chestA.localeCompare(chestB, undefined, { numeric: true, sensitivity: 'base' });
                });
            } else if (sortRule === 'name') {
                studentsList.sort((a, b) => {
                    const nameA = a.name || '';
                    const nameB = b.name || '';
                    return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
                });
            } else if (sortRule === 'team') {
                studentsList.sort((a, b) => {
                    const teamA = teamNamesMap[String(a.teamId)] || a.teamName || '';
                    const teamB = teamNamesMap[String(b.teamId)] || b.teamName || '';
                    return teamA.localeCompare(teamB, undefined, { sensitivity: 'base' });
                });
            }

            if (f.chestSubmode === 'card') {
                // Build student programs map
                const studentProgramsMap = {};
                studentsList.forEach(s => {
                    studentProgramsMap[s.id] = [];
                });

                // Map all programs and their participants
                for (const progId in participantsMap) {
                    const prog = allPrograms.find(pr => pr.id === progId);
                    if (!prog) continue;

                    const pList = participantsMap[progId] || [];
                    pList.forEach(p => {
                        if (!p.isGroup) {
                            if (p.studentId && studentProgramsMap[p.studentId]) {
                                studentProgramsMap[p.studentId].push({
                                    ...prog,
                                    isGroupReg: false,
                                    groupName: ''
                                });
                            }
                        } else {
                            if (Array.isArray(p.members)) {
                                p.members.forEach(m => {
                                    if (m.studentId && studentProgramsMap[m.studentId]) {
                                        studentProgramsMap[m.studentId].push({
                                            ...prog,
                                            isGroupReg: true,
                                            groupName: p.groupName || p.name || ''
                                        });
                                    }
                                });
                            }
                        }
                    });
                }

                // Deduplicate programs for each student
                for (const sId in studentProgramsMap) {
                    const progs = studentProgramsMap[sId];
                    const seen = new Set();
                    const uniqueProgs = [];
                    for (const pr of progs) {
                        if (!seen.has(pr.id)) {
                            seen.add(pr.id);
                            uniqueProgs.push(pr);
                        }
                    }
                    studentProgramsMap[sId] = uniqueProgs;
                }


                let pagesHTML = '';
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const getTextWidth = (text, font) => {
                    ctx.font = font;
                    return ctx.measureText(text).width;
                };

                // Pre-verify Poppins font loading from Google Fonts before measuring layouts
                if (document.fonts && document.fonts.load) {
                    try {
                        await Promise.all([
                            document.fonts.load('400 14px "Poppins"'),
                            document.fonts.load('500 14px "Poppins"'),
                            document.fonts.load('600 14px "Poppins"'),
                            document.fonts.load('700 14px "Poppins"'),
                            document.fonts.load('800 14px "Poppins"')
                        ]);
                        await document.fonts.ready;
                    } catch (fontErr) {
                        console.warn('Poppins font verification warning:', fontErr);
                    }
                }

                // Create offscreen test container for exact browser layout-based measurements
                const testContainer = document.createElement('div');
                testContainer.id = 'offscreen-card-test-container';
                testContainer.style.position = 'absolute';
                testContainer.style.left = '-9999px';
                testContainer.style.top = '-9999px';
                testContainer.style.visibility = 'hidden';

                const testStyle = document.createElement('style');
                testStyle.textContent = `
                    @import url('https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400;1,600&display=swap');
                    .student-card-item {
                        border: none !important;
                        border-radius: 0 !important;
                        box-shadow: none !important;
                        outline: none !important;
                        padding: 10px;
                        background: #fff;
                        box-sizing: border-box;
                        width: 6.7cm;
                        height: 10cm;
                        overflow: hidden;
                        display: flex;
                        flex-direction: column;
                        gap: 6px;
                        font-size: 0.72rem;
                        font-family: 'Poppins', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                        color: #16213E;
                    }
                    .card-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        border-bottom: 1.5px solid #E5E7EB;
                        padding-bottom: 6px;
                        margin-bottom: 6px;
                    }
                    .card-header-left {
                        display: flex;
                        flex-direction: column;
                        gap: 3px;
                        max-width: 155px;
                    }
                    .card-student-name {
                        font-family: 'Poppins', sans-serif;
                        font-weight: 800;
                        color: #16213E;
                        text-transform: uppercase;
                        line-height: 1.05;
                        letter-spacing: -0.01em;
                        margin-bottom: 4px;
                    }
                    .card-meta-line {
                        font-family: 'Poppins', sans-serif;
                        font-weight: 500;
                        color: #374151;
                        line-height: 1.15;
                        margin-top: 2px;
                        white-space: normal;
                        word-break: break-word;
                        overflow: hidden;
                        display: -webkit-box;
                        -webkit-line-clamp: 2;
                        -webkit-box-orient: vertical;
                    }
                    .card-chest-badge {
                        border: 1.5px solid #16213E;
                        border-radius: 6px;
                        padding: 6px 10px;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        text-align: center;
                        background: #f8fafc;
                        min-width: 78px;
                        min-height: 48px;
                        box-sizing: border-box;
                    }
                    .card-chest-label {
                        font-family: 'Poppins', sans-serif;
                        font-size: 0.50rem;
                        font-weight: 600;
                        color: #475569;
                        text-transform: uppercase;
                        letter-spacing: 0.05em;
                        line-height: 1;
                        margin-bottom: 2px;
                    }
                    .card-chest-number {
                        font-family: 'Poppins', sans-serif;
                        font-size: 1.40rem;
                        font-weight: 800;
                        color: #16213E;
                        line-height: 1;
                        text-align: center;
                    }
                    .team-art-theme-0 {
                        position: absolute;
                        inset: 0;
                        z-index: 0;
                        overflow: hidden;
                        pointer-events: none;
                        background: #ecfeff;
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                    .team-art-theme-0 .shape-1 {
                        position: absolute;
                        top: -40px;
                        right: -40px;
                        width: 130px;
                        height: 130px;
                        border-radius: 50%;
                        background: rgba(6, 182, 212, 0.16);
                    }
                    .team-art-theme-0 .shape-2 {
                        position: absolute;
                        bottom: -10px;
                        left: 45%;
                        width: 60px;
                        height: 40px;
                        border-radius: 30px 30px 0 0;
                        background: rgba(37, 99, 235, 0.12);
                    }
                    .team-art-theme-0 .shape-3 {
                        position: absolute;
                        top: 130px;
                        right: 12px;
                        width: 16px;
                        height: 32px;
                        background-image: radial-gradient(rgba(29, 78, 216, 0.22) 2px, transparent 2px);
                        background-size: 8px 8px;
                    }
                    .team-art-theme-0 .shape-4 {
                        position: absolute;
                        bottom: -30px;
                        left: -30px;
                        width: 90px;
                        height: 90px;
                        border-radius: 50%;
                        border: 1.5px solid rgba(30, 41, 59, 0.15);
                    }
                    .team-art-theme-0 .shape-5 {
                        position: absolute;
                        top: 20px;
                        left: 10px;
                        width: 30px;
                        height: 15px;
                        background: repeating-linear-gradient(90deg, rgba(6, 182, 212, 0.18) 0px, rgba(6, 182, 212, 0.18) 2px, transparent 2px, transparent 6px);
                    }

                    .team-art-theme-1 {
                        position: absolute;
                        inset: 0;
                        z-index: 0;
                        overflow: hidden;
                        pointer-events: none;
                    .team-art-theme-1::before {
                        content: '';
                        position: absolute;
                        bottom: -40px;
                        left: -40px;
                        width: 100px;
                        height: 100px;
                        border-radius: 50%;
                        border: 2px solid rgba(236, 72, 153, 0.25);
                        box-sizing: border-box;
                    }
                    .team-art-theme-1::after {
                        content: '';
                        position: absolute;
                        top: 50px;
                        right: 50px;
                        width: 8px;
                        height: 8px;
                        border-radius: 50%;
                        background: rgba(249, 115, 22, 0.65);
                    }

                    .team-art-theme-2 {
                        position: absolute;
                        inset: 0;
                        z-index: 0;
                        overflow: hidden;
                        pointer-events: none;
                        background: #ffffff;
                        background-image:
                            radial-gradient(circle at 105% -5%, rgba(52, 211, 153, 0.75) 0%, rgba(52, 211, 153, 0) 55%),
                            radial-gradient(circle at 82% 10%, rgba(167, 139, 250, 0.58) 0%, rgba(167, 139, 250, 0) 50%),
                            radial-gradient(circle at 72% -10%, rgba(103, 232, 249, 0.48) 0%, rgba(103, 232, 249, 0) 45%),
                            radial-gradient(circle at -5% 105%, rgba(45, 212, 191, 0.68) 0%, rgba(45, 212, 191, 0) 60%),
                            radial-gradient(circle at 15% 88%, rgba(96, 165, 250, 0.48) 0%, rgba(96, 165, 250, 0) 50%);
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                    .team-art-theme-2::before {
                        content: '';
                        position: absolute;
                        bottom: -30px;
                        left: -30px;
                        width: 110px;
                        height: 110px;
                        border-radius: 0 110px 0 0;
                        background: rgba(251, 146, 60, 0.45);
                    }
                    .team-art-theme-2 .shape-3 {
                        position: absolute;
                        bottom: 40px;
                        right: -30px;
                        width: 90px;
                        height: 90px;
                        border-radius: 50%;
                        border: 1.5px solid rgba(244, 63, 94, 0.35);
                    }
                    .team-art-theme-2 .shape-4 {
                        position: absolute;
                        top: 130px;
                        left: 10px;
                        width: 32px;
                        height: 40px;
                        background-image: radial-gradient(rgba(120, 53, 4, 0.20) 1.5px, transparent 1.5px);
                        background-size: 8px 8px;
                    }
                    .team-art-theme-2 .shape-5 {
                        position: absolute;
                        top: 90px;
                        right: 25px;
                        width: 12px;
                        height: 12px;
                        background: rgba(234, 88, 12, 0.70);
                        border-radius: 3px;
                        transform: rotate(45deg);
                    }
                    .team-art-theme-3 {
                        position: absolute;
                        inset: 0;
                        z-index: 0;
                        overflow: hidden;
                        pointer-events: none;
                        background: #f7fbfb;
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                    .team-art-theme-3 .shape-1 {
                        position: absolute;
                        top: -40px;
                        right: -40px;
                        width: 130px;
                        height: 130px;
                        border-radius: 50%;
                        border: 2px solid rgba(13, 148, 136, 0.55);
                    }
                    .team-art-theme-3 .shape-1::after {
                        content: '';
                        position: absolute;
                        inset: 15px;
                        border-radius: 50%;
                        border: 1.5px solid rgba(37, 99, 235, 0.35);
                    }
                    .team-art-theme-3 .shape-2 {
                        position: absolute;
                        bottom: -20px;
                        left: -20px;
                        width: 80px;
                        height: 100px;
                        border-radius: 40px 40px 0 0;
                        border: 2px solid rgba(13, 148, 136, 0.45);
                        border-bottom: none;
                        background: rgba(13, 148, 136, 0.08);
                    }
                    .team-art-theme-3 .shape-3 {
                        position: absolute;
                        top: 90px;
                        left: 12px;
                        width: 25px;
                        height: 40px;
                        background: repeating-linear-gradient(90deg, rgba(30, 41, 59, 0.35) 0px, rgba(30, 41, 59, 0.35) 2px, transparent 2px, transparent 6px);
                    }
                    .team-art-theme-3 .shape-4 {
                        position: absolute;
                        bottom: 90px;
                        right: -25px;
                        width: 50px;
                        height: 50px;
                        border-radius: 50%;
                        background: rgba(52, 211, 153, 0.65);
                        clip-path: inset(0 0 0 25px);
                    }
                    .team-art-theme-3 .shape-5 {
                        position: absolute;
                        top: 25px;
                        left: 20px;
                        width: 16px;
                        height: 16px;
                        background: rgba(30, 41, 59, 0.50);
                        border-radius: 2px;
                    }
                `;
                testContainer.appendChild(testStyle);
                document.body.appendChild(testContainer);

                // Collect unique teams in the current export dataset (studentsList)
                const uniqueTeams = [];
                studentsList.forEach(stu => {
                    const teamName = teamNamesMap[String(stu.teamId)] || stu.teamName || '';
                    const teamVal = teamName && teamName.trim() !== '' && teamName !== '—' ? teamName : 'NO TEAM';
                    const key = stu.teamId || teamVal.toLowerCase().trim();
                    if (!uniqueTeams.includes(key)) {
                        uniqueTeams.push(key);
                    }
                });

                const cardsPerPage = orientation === 'a3_portrait' ? 18 : 8;
                for (let pageIdx = 0; pageIdx < studentsList.length; pageIdx += cardsPerPage) {
                    const pageStudents = studentsList.slice(pageIdx, pageIdx + cardsPerPage);
                    let pageCardsHTML = '';

                    pageStudents.forEach(stu => {
                        const stuProgs = studentProgramsMap[stu.id] || [];

                        // Load settings header dynamically
                        const eventDetails = window.currentEventDetails || {};
                        const eventName = getEventName();
                        const eventTagline = eventDetails.eventTagline || '';
                        const madrasaName = eventDetails.madrasaName || '';
                        const eventLocation = eventDetails.eventLocation || '';
                        const eventLogo = eventDetails.eventLogo || null;

                        const eventHeaderHTML = `
                            <div class="card-event-header" style="display: flex; flex-direction: column; align-items: center; text-align: center; border-bottom: 1.5px solid #E5E7EB; padding-bottom: 5px; margin-bottom: 5px; gap: 3px; width: 100%;">
                                ${eventLogo ? `<img src="${eventLogo}" style="width: 30px; height: 30px; object-fit: contain; margin-bottom: 2px;" />` : ''}
                                <div style="font-family: 'Poppins', sans-serif; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; line-height: 1.1; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #16213E;">${window.escapeHTML(eventName)}</div>
                                ${eventTagline ? `<div style="font-family: 'Poppins', sans-serif; font-size: 0.52rem; font-weight: 500; color: #475569; line-height: 1.1; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${window.escapeHTML(eventTagline)}</div>` : ''}
                                <div style="font-family: 'Noto Sans Malayalam', 'Meera', 'Manjari', 'Poppins', sans-serif; font-size: 0.55rem; font-weight: 600; text-transform: uppercase; line-height: 1.1; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #16213E;">${window.escapeHTML(madrasaName)}</div>
                                ${eventLocation ? `<div style="font-family: 'Poppins', sans-serif; font-size: 0.52rem; font-weight: 500; color: #64748b; line-height: 1.1; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px;">${window.escapeHTML(eventLocation)}</div>` : ''}
                            </div>
                        `;

                        // 1. Participant name font fitting (starts at 20px ~ 15pt, min 11px ~ 8pt)
                        let nameFontSize = 20;
                        const minNameFontSize = 11;
                        const nameStr = stu.name.toUpperCase();

                        while (nameFontSize > minNameFontSize) {
                            const fontSpec = `800 ${nameFontSize}px 'Poppins', sans-serif`;
                            if (getTextWidth(nameStr, fontSpec) <= 160) {
                                break;
                            }
                            nameFontSize -= 0.5;
                        }

                        const teamName = teamNamesMap[String(stu.teamId)] || stu.teamName || '';
                        const classVal = stu.className || stu.classId || '—';
                        const catVal = stu.categoryName || stu.categoryId || '—';
                        const teamVal = teamName && teamName.trim() !== '' && teamName !== '—' ? teamName : 'NO TEAM';
                        const metaText = `Class ${classVal} • ${catVal} • ${teamVal}`;

                        // Determine cyclic theme index (0-3) based on team ID or team name within the current dataset
                        const getTeamThemeIndex = (tId, tVal) => {
                            const key = tId || (tVal || '').toString().trim().toLowerCase();
                            const idx = uniqueTeams.indexOf(key);
                            if (idx === -1) return 0;
                            return idx % 4; // returns 0, 1, 2, 3
                        };
                        const themeIdx = getTeamThemeIndex(stu.teamId, teamVal);

                        let artLayerHTML = '';
                        if (f.enableTeamBg && teamBackgroundsCache && teamBackgroundsCache[stu.teamId]) {
                            artLayerHTML = `
                                <div style="position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; background-image: url('${teamBackgroundsCache[stu.teamId]}'); background-size: cover; background-position: center; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;" aria-hidden="true"></div>
                            `;
                        } else {
                            artLayerHTML = `
                                <div class="team-art-theme-${themeIdx}" aria-hidden="true">
                                    <div class="shape-1"></div>
                                    <div class="shape-2"></div>
                                    <div class="shape-3"></div>
                                    <div class="shape-4"></div>
                                    <div class="shape-5"></div>
                                </div>
                            `;
                        }

                        // Separate programs into sections (Pass 1 — Build)
                        const stageProgs = [];
                        const offStageProgs = [];
                        const groupProgs = [];
                        const generalProgs = [];

                        stuProgs.forEach(p => {
                            const isGeneral = p.categoryId === 'general_programs' || (p.programType || '').toLowerCase() === 'general';
                            const isGroup = (p.programType || '').toLowerCase() === 'group';
                            const isStage = (p.programLocation || '').toLowerCase() === 'stage';

                            const progCopy = {
                                ...p,
                                isGeneral,
                                isGroup,
                                isStage
                            };

                            if (isGeneral) {
                                generalProgs.push(progCopy);
                            } else if (isGroup) {
                                groupProgs.push(progCopy);
                            } else if (isStage) {
                                stageProgs.push(progCopy);
                            } else {
                                offStageProgs.push(progCopy);
                            }
                        });

                        const sections = [
                            { title: 'STAGE PROGRAMS', items: stageProgs },
                            { title: 'OFF-STAGE PROGRAMS', items: offStageProgs },
                            { title: 'GROUP PROGRAMS', items: groupProgs },
                            { title: 'GENERAL PROGRAMS', items: generalProgs }
                        ].filter(sec => sec.items.length > 0);

                        // Create test card inside our offscreen container
                        const testCard = document.createElement('div');
                        testCard.className = 'student-card-item';
                        if (orientation === 'a3_portrait') {
                            testCard.style.height = '9.8cm';
                        }
                        testContainer.appendChild(testCard);

                        // Initialize spacing and typography variables
                        let metaFontSize = 10.5; // ~8pt
                        let headingFontSize = 9.3; // ~7pt default
                        let itemFontSize = 9.8; // ~7.5pt default (slightly increased default font size for readability)

                        let headerMargin = 2;
                        let metaMargin = 4;
                        let sectionGap = 5; // default gap after section ~1.3mm
                        let headingItemGap = 3.5; // default heading-to-item gap ~0.9mm
                        let programRowGap = 1.5; // default item-to-item gap ~0.4mm
                        let progLineHeight = 1.25;

                        // Helper to refresh test card content and apply dynamic styles
                        const updateTestCardDOM = () => {
                            // First calculate the font sizes for individual program items
                            sections.forEach(sec => {
                                sec.items.forEach(p => {
                                    let label = '';
                                    if (p.groupName && p.groupName !== teamNamesMap[String(p.teamId)]) {
                                        label = p.groupName;
                                    }
                                    const numStr = p.programNumber ? `${p.programNumber} - ` : '';
                                    const pNameStr = label ? `${numStr}${p.programName || 'Unknown Program'} (${label})` : `${numStr}${p.programName || 'Unknown Program'}`;
                                    const availableProgWidth = 233;

                                    let pFontSize = itemFontSize;
                                    while (pFontSize > 5.3) { // absolute minimum program font size is ~4pt (5.3px)
                                        const fontSpec = `600 ${pFontSize}px sans-serif`;
                                        if (getTextWidth(pNameStr, fontSpec) <= availableProgWidth) {
                                            break;
                                        }
                                        pFontSize -= 0.25;
                                    }
                                    p.finalFontSize = pFontSize;
                                });
                            });

                            let sectionsHTML = '';
                            sections.forEach((sec, sIdx) => {
                                const isLast = sIdx === sections.length - 1;
                                const currentSecGap = isLast ? 0 : sectionGap;

                                const headingTitle = sec.title === 'OFF-STAGE PROGRAMS' ? 'OFF STAGE PROGRAMS' : sec.title;
                                const sectionFontSize = (itemFontSize * 0.75).toFixed(1);

                                sectionsHTML += `
                                    <div class="card-section" style="margin-top: 2px; margin-bottom: ${currentSecGap}px; page-break-inside: avoid; break-inside: avoid; display: flex; flex-direction: column; align-items: flex-start; width: 100%;">
                                        <div style="font-family: 'Poppins', sans-serif; font-size: ${sectionFontSize}px; font-weight: 700; text-transform: uppercase; text-align: left; letter-spacing: 0.5px; line-height: 1.1; margin-top: ${sIdx === 0 ? 0 : sectionGap}px; margin-bottom: 2px; color: #0f172a; width: 100%; display: block;">
                                            ${headingTitle}
                                        </div>
                                        <ul class="card-program-list" style="gap: ${programRowGap}px; display: flex; flex-direction: column; align-items: flex-start; width: 100%; margin: 0; padding: 0; list-style: none;">
                                            ${sec.items.map(p => {
                                    let label = '';
                                    if (p.groupName && p.groupName !== teamNamesMap[String(p.teamId)]) {
                                        label = p.groupName;
                                    }
                                    const numStr = p.programNumber ? `${p.programNumber} - ` : '';
                                    const displayName = label ? `${numStr}${p.programName || 'Unknown Program'} (${label})` : `${numStr}${p.programName || 'Unknown Program'}`;
                                    return `
                                                    <li class="card-program-item" style="font-size: ${p.finalFontSize}px; line-height: ${progLineHeight}; margin-bottom: ${programRowGap}px; display: flex !important; align-items: flex-start !important; justify-content: flex-start !important; text-align: left !important; gap: 4px; width: 100%;">
                                                         <span style="flex-shrink: 0; font-size: 0.7em; display: inline-flex; align-items: center; justify-content: center; margin-top: 2px;"></span>
                                                        <span class="program-left" style="font-family: 'Poppins', sans-serif; font-weight: 500; color: #16213E; text-align: left !important;">${window.escapeHTML(displayName)}</span>
                                                    </li>
                                                `;
                                }).join('')}
                                        </ul>
                                    </div>
                                `;
                            });

                            testCard.innerHTML = `
                                ${artLayerHTML}
                                ${eventHeaderHTML}
                                <div class="card-header">
                                    <div class="card-header-left">
                                        <div class="card-student-name" style="font-size: ${nameFontSize}px;">${window.escapeHTML(stu.name).toUpperCase()}</div>
                                        <div class="card-meta-line" style="font-size: ${metaFontSize}px; margin-bottom: ${metaMargin}px;">
                                            ${window.escapeHTML(metaText)}
                                        </div>
                                    </div>
                                    <div class="card-chest-badge">
                                        <div class="card-chest-label">Chest No.</div>
                                        <div class="card-chest-number">${window.escapeHTML(stu.chestNumber || '—')}</div>
                                    </div>
                                </div>
                                ${sectionsHTML}
                            `;
                        };

                        // Initial render
                        updateTestCardDOM();

                        // Fit loop (Pass 2 — Fit using REAL browser DOM measurements)
                        let attempts = 0;
                        const tolerance = 1; // 1px subpixel tolerance

                        while ((testCard.scrollHeight > testCard.clientHeight + tolerance) && attempts < 25) {
                            attempts++;
                            if (attempts === 1) {
                                sectionGap = 4;
                            } else if (attempts === 2) {
                                programRowGap = 1.0;
                            } else if (attempts === 3) {
                                headingItemGap = 2.5;
                            } else if (attempts === 4) {
                                progLineHeight = 1.15;
                            } else if (attempts === 5) {
                                headerMargin = 1;
                            } else {
                                if (metaFontSize > 7.5) metaFontSize -= 0.25;
                                if (headingFontSize > 6.0) headingFontSize -= 0.25; // min heading size is ~4.5pt (6px)
                                if (itemFontSize > 5.3) itemFontSize -= 0.25; // min program size is ~4pt (5.3px)
                                if (sectionGap > 2) sectionGap -= 0.5;
                                if (programRowGap > 0.25) programRowGap -= 0.25;
                                if (headingItemGap > 1.0) headingItemGap -= 0.25;
                            }
                            updateTestCardDOM();
                        }

                        // Programmatic Verification Check for ABID card
                        if (stu.name.toUpperCase().includes('ABID')) {
                            console.log(`[ABID Verification] scrollHeight: ${testCard.scrollHeight}, clientHeight: ${testCard.clientHeight}`);
                            const burdhaRow = Array.from(testCard.querySelectorAll('.card-program-item')).find(item =>
                                item.textContent.toUpperCase().includes('BURDHA')
                            );
                            if (burdhaRow) {
                                console.log(`[ABID Verification] BURDHA row exists. Fits within boundary: ${testCard.scrollHeight <= testCard.clientHeight + tolerance}`);
                            } else {
                                console.warn(`[ABID Verification] BURDHA row NOT found!`);
                            }
                        }

                        pageCardsHTML += `<div class="card-slot">${testCard.outerHTML}</div>`;

                        // Cleanup test card from offscreen container
                        testContainer.removeChild(testCard);
                    });

                    const wrapperClass = orientation === 'a3_portrait' ? 'page-wrapper format-a3' : 'page-wrapper';
                    const gridClass = orientation === 'a3_portrait' ? 'cards-print-grid format-a3' : 'cards-print-grid';
                    pagesHTML += `
                        <div class="${wrapperClass}">
                            <div class="${gridClass}">
                                ${pageCardsHTML}
                            </div>
                        </div>
                    `;
                }

                // Cleanup main offscreen test container
                document.body.removeChild(testContainer);

                htmlContent = pagesHTML;
            } else if (f.chestMode === 'category-wise') {
                const groups = {};
                studentsList.forEach(stu => {
                    const catId = stu.categoryId || 'general';
                    const catName = stu.categoryName || 'General';
                    const teamId = stu.teamId || 'no-team';
                    const teamName = teamNamesMap[String(stu.teamId)] || stu.teamName || 'Independent';

                    if (!groups[catId]) {
                        groups[catId] = {
                            name: catName,
                            teams: {}
                        };
                    }
                    if (!groups[catId].teams[teamId]) {
                        groups[catId].teams[teamId] = {
                            name: teamName,
                            students: []
                        };
                    }
                    groups[catId].teams[teamId].students.push(stu);
                });

                const sortedCatIds = Object.keys(groups).sort((a, b) => {
                    const idxA = allCategories.findIndex(c => c.id === a);
                    const idxB = allCategories.findIndex(c => c.id === b);
                    return idxA - idxB;
                });
                const instName = getEventName();
                const pageDivClass = isCompact ? 'program-card-compact' : 'program-page-standard';

                sortedCatIds.forEach(catId => {
                    const cat = groups[catId];
                    const sortedTeamIds = Object.keys(cat.teams).sort((a, b) => cat.teams[a].name.localeCompare(cat.teams[b].name));

                    sortedTeamIds.forEach(teamId => {
                        const team = cat.teams[teamId];
                        const students = team.students;

                        htmlContent += `
                            <div class="${pageDivClass}" style="margin-bottom: 1rem; page-break-inside: avoid; break-inside: avoid;">
                                <div class="report-header" style="display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2px solid #000; padding-bottom:0.35rem; margin-bottom:0.6rem; width:100%;">
                                    <div>
                                        <div class="report-title" style="font-size:0.75rem; font-weight:800; color:#555; text-transform:uppercase; letter-spacing:0.05em;">${window.escapeHTML(instName).toUpperCase()}</div>
                                        <h2 style="margin:0.15rem 0; color:#000; font-size:1.15rem; font-weight:800; text-transform:uppercase;">CHEST NUMBER LIST</h2>
                                        <div style="font-size:0.7rem; font-weight:700; color:#666; text-transform:uppercase;">
                                            ${window.escapeHTML(cat.name).toUpperCase()} • ${window.escapeHTML(team.name).toUpperCase()}${f.gender ? ` • ${window.escapeHTML(f.gender.toUpperCase())}` : ''}
                                        </div>
                                    </div>
                                    <div style="text-align:right; font-weight:800; color:#000; line-height:1.2;">
                                        <div style="font-size:0.68rem; color:#666; text-transform:uppercase;">TOTAL ENTRIES</div>
                                        <div style="font-size:0.95rem;">${students.length} STUDENTS</div>
                                    </div>
                                </div>

                                <table class="report-table" style="margin-top: 0.5rem; width:100%;">
                                    <thead>
                                        <tr>
                                            <th style="width:50px; text-align:center; border: 1px solid #000;">SL</th>
                                            <th style="width:110px; text-align:center; border: 1px solid #000;">CHEST NO</th>
                                            <th style="border: 1px solid #000;">PARTICIPANT NAME</th>
                                            <th style="width:110px; text-align:center; border: 1px solid #000;">CLASS</th>
                                            ${!f.gender ? '<th style="width:110px; text-align:center; border: 1px solid #000;">GENDER</th>' : ''}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${students.map((item, idx) => `
                                            <tr style="height:26px; page-break-inside:avoid;">
                                                <td style="text-align:center; font-weight:700; color:#000; border: 1px solid #000;">${idx + 1}</td>
                                                <td style="text-align:center; font-weight:800; color:#000; border: 1px solid #000;">
                                                    ${window.escapeHTML(item.chestNumber || '—')}
                                                </td>
                                                <td style="font-weight:700; color:#000; border: 1px solid #000;">${window.escapeHTML(item.name).toUpperCase()}</td>
                                                <td style="text-align:center; font-weight:600; color:#000; border: 1px solid #000;">${window.escapeHTML(item.className || item.classId || '—').toUpperCase()}</td>
                                                ${!f.gender ? `<td style="text-align:center; font-weight:600; color:#000; border: 1px solid #000;">${window.escapeHTML(item.gender || '—').toUpperCase()}</td>` : ''}
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        `;
                    });
                });
            } else {
                // 3. Group students hierarchically by Category -> Class -> Team
                const groups = {};
                studentsList.forEach(stu => {
                    const catId = stu.categoryId || 'general';
                    const catName = stu.categoryName || 'General';
                    const classId = stu.classId || 'standard';
                    const className = stu.className || 'Standard';
                    const teamId = stu.teamId || 'no-team';
                    const teamName = teamNamesMap[String(stu.teamId)] || stu.teamName || 'Independent';

                    if (!groups[catId]) {
                        groups[catId] = {
                            name: catName,
                            classes: {}
                        };
                    }
                    if (!groups[catId].classes[classId]) {
                        groups[catId].classes[classId] = {
                            name: className,
                            teams: {}
                        };
                    }
                    if (!groups[catId].classes[classId].teams[teamId]) {
                        groups[catId].classes[classId].teams[teamId] = {
                            name: teamName,
                            students: []
                        };
                    }
                    groups[catId].classes[classId].teams[teamId].students.push(stu);
                });

                const sortedCatIds = Object.keys(groups).sort((a, b) => {
                    const idxA = allCategories.findIndex(c => c.id === a);
                    const idxB = allCategories.findIndex(c => c.id === b);
                    return idxA - idxB;
                });
                const instName = getEventName();
                const pageDivClass = isCompact ? 'program-card-compact' : 'program-page-standard';

                sortedCatIds.forEach(catId => {
                    const cat = groups[catId];
                    const sortedClassIds = Object.keys(cat.classes).sort((a, b) => cat.classes[a].name.localeCompare(cat.classes[b].name, undefined, { numeric: true }));

                    sortedClassIds.forEach(classId => {
                        const cls = cat.classes[classId];
                        const sortedTeamIds = Object.keys(cls.teams).sort((a, b) => cls.teams[a].name.localeCompare(cls.teams[b].name));

                        sortedTeamIds.forEach(teamId => {
                            const team = cls.teams[teamId];
                            const students = team.students;

                            htmlContent += `
                                <div class="${pageDivClass}" style="margin-bottom: 1rem; page-break-inside: avoid; break-inside: avoid;">
                                    <div class="report-header" style="display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2px solid #000; padding-bottom:0.35rem; margin-bottom:0.6rem; width:100%;">
                                        <div>
                                            <div class="report-title" style="font-size:0.75rem; font-weight:800; color:#555; text-transform:uppercase; letter-spacing:0.05em;">${window.escapeHTML(instName).toUpperCase()}</div>
                                            <h2 style="margin:0.15rem 0; color:#000; font-size:1.15rem; font-weight:800; text-transform:uppercase;">CHEST NUMBER LIST</h2>
                                            <div style="font-size:0.7rem; font-weight:700; color:#666; text-transform:uppercase;">
                                                ${window.escapeHTML(cat.name).toUpperCase()} • ${window.escapeHTML(cls.name).toUpperCase()} • ${window.escapeHTML(team.name).toUpperCase()}${f.gender ? ` • ${window.escapeHTML(f.gender.toUpperCase())}` : ''}
                                            </div>
                                        </div>
                                        <div style="text-align:right; font-weight:800; color:#000; line-height:1.2;">
                                            <div style="font-size:0.68rem; color:#666; text-transform:uppercase;">TOTAL ENTRIES</div>
                                            <div style="font-size:0.95rem;">${students.length} STUDENTS</div>
                                        </div>
                                    </div>

                                    <table class="report-table" style="margin-top: 0.5rem; width:100%;">
                                        <thead>
                                            <tr>
                                                <th style="width:50px; text-align:center; border: 1px solid #000;">SL</th>
                                                <th style="width:110px; text-align:center; border: 1px solid #000;">CHEST NO</th>
                                                <th style="border: 1px solid #000;">PARTICIPANT NAME</th>
                                                ${!f.gender ? '<th style="width:110px; text-align:center; border: 1px solid #000;">GENDER</th>' : ''}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${students.map((item, idx) => `
                                                <tr style="height:26px; page-break-inside:avoid;">
                                                    <td style="text-align:center; font-weight:700; color:#000; border: 1px solid #000;">${idx + 1}</td>
                                                    <td style="text-align:center; font-weight:800; color:#000; border: 1px solid #000;">
                                                        ${window.escapeHTML(item.chestNumber || '—')}
                                                    </td>
                                                    <td style="font-weight:700; color:#000; border: 1px solid #000;">${window.escapeHTML(item.name).toUpperCase()}</td>
                                                    ${!f.gender ? `<td style="text-align:center; font-weight:600; color:#000; border: 1px solid #000;">${window.escapeHTML(item.gender || '—').toUpperCase()}</td>` : ''}
                                                </tr>
                                            `).join('')}
                                        </tbody>
                                    </table>
                                </div>
                            `;
                        });
                    });
                });
            }
        }

        // Render PDF through iframe
        const printIframe = getPrintIframe();
        const doc = printIframe.contentDocument || printIframe.contentWindow.document;
        const pageMargin = '10mm';

        let styleBlock = '';
        if (f.chestSubmode === 'card') {
            const isA3 = orientation === 'a3_portrait';
            const pageSizeStr = isA3 ? 'A3 portrait' : 'A4 portrait';
            const gridCols = isA3 ? 'repeat(3, 9.6cm)' : '10cm 10cm';
            const gridRows = isA3 ? 'repeat(6, 6.6cm)' : 'repeat(4, 6.7cm)';
            const gridWidth = isA3 ? '28.8cm' : '20cm';
            const gridHeight = isA3 ? '39.6cm' : '26.8cm';

            styleBlock = `
                <style>
                    @page {
                        size: ${pageSizeStr};
                        margin: 0;
                    }
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                        color: #000;
                        margin: 0;
                        padding: 0;
                        background: #fff;
                        font-size: 0.75rem;
                        line-height: 1.25;
                    }
                    .page-wrapper {
                        width: 21cm;
                        height: 29.7cm;
                        box-sizing: border-box;
                        overflow: hidden;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        page-break-after: always;
                        break-after: page;
                        margin: 0 auto;
                        background: #fff;
                    }
                    .page-wrapper:last-child {
                        page-break-after: avoid;
                        break-after: avoid;
                    }
                    .page-wrapper.format-a3 {
                        width: 29.7cm;
                        height: 42.0cm;
                    }
                    .cards-print-grid {
                        display: grid;
                        grid-template-columns: ${gridCols};
                        grid-template-rows: ${gridRows};
                        gap: 0;
                        width: ${gridWidth};
                        height: ${gridHeight};
                        box-sizing: border-box;
                        page-break-inside: avoid;
                        break-inside: avoid;
                        margin: 0;
                    }
                    .cards-print-grid:last-child {
                        page-break-after: avoid;
                        break-after: avoid;
                    }
                    .card-slot {
                        width: 10cm;
                        height: 6.7cm;
                        box-sizing: border-box;
                        overflow: hidden;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        position: relative;
                        border: 0.2mm dashed #d0d0d0 !important;
                        margin: 0 !important;
                        padding: 0 !important;
                    }
                    .student-card-item {
                        border: none !important;
                        border-radius: 0 !important;
                        box-shadow: none !important;
                        outline: none !important;
                        padding: 10px;
                        background: #fff;
                        box-sizing: border-box;
                        width: 6.7cm;
                        height: 10cm;
                        overflow: hidden;
                        display: flex;
                        flex-direction: column;
                        gap: 6px;
                        font-size: 0.72rem;
                        position: absolute;
                        transform: rotate(90deg);
                        transform-origin: center center;
                        flex-shrink: 0;
                    }
                    .cards-print-grid.format-a3 .card-slot {
                        width: 9.6cm;
                        height: 6.6cm;
                    }
                    .cards-print-grid.format-a3 .student-card-item {
                        width: 6.6cm;
                        height: 9.6cm;
                    }
                    .card-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        border-bottom: 1.5px solid #E5E7EB;
                        padding-bottom: 6px;
                        margin-bottom: 6px;
                    }
                    .card-header-left {
                        display: flex;
                        flex-direction: column;
                        gap: 3px;
                        max-width: 155px;
                    }
                    .card-student-name {
                        font-family: 'Poppins', sans-serif;
                        font-size: 0.95rem;
                        font-weight: 800;
                        color: #16213E;
                        text-transform: uppercase;
                        line-height: 1.05;
                        letter-spacing: -0.01em;
                        margin-bottom: 4px;
                    }
                    .card-chest-badge {
                        border: 1.5px solid #16213E;
                        border-radius: 6px;
                        padding: 6px 10px;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        text-align: center;
                        background: #f8fafc;
                        min-width: 78px;
                        min-height: 48px;
                        box-sizing: border-box;
                    }
                    .card-chest-label {
                        font-family: 'Poppins', sans-serif;
                        font-size: 0.50rem;
                        font-weight: 600;
                        color: #475569;
                        text-transform: uppercase;
                        letter-spacing: 0.05em;
                        line-height: 1;
                        margin-bottom: 2px;
                    }
                    .card-chest-number {
                        font-family: 'Poppins', sans-serif;
                        font-size: 1.40rem;
                        font-weight: 800;
                        color: #16213E;
                        line-height: 1;
                        text-align: center;
                    }
                    .card-meta-line {
                        font-family: 'Poppins', sans-serif;
                        font-weight: 500;
                        color: #374151;
                        line-height: 1.15;
                        margin-top: 2px;
                        white-space: normal;
                        word-break: break-word;
                        overflow: hidden;
                        display: -webkit-box;
                        -webkit-line-clamp: 2;
                        -webkit-box-orient: vertical;
                    }
                    .card-team-badge-row {
                        display: flex;
                        justify-content: flex-end;
                        margin-bottom: 2px;
                        line-height: 1;
                    }
                    .card-team-badge {
                        font-size: 8px;
                        font-weight: 800;
                        color: #0f172a;
                        background: #f1f5f9;
                        border: 1px solid #cbd5e1;
                        border-radius: 4px;
                        padding: 1px 4px;
                        line-height: 1;
                        display: inline-block;
                    }
                    .card-section {
                        margin-top: 0;
                    }
                    .card-section-title {
                        font-family: 'Poppins', sans-serif;
                        font-size: 0.68rem;
                        font-weight: 700;
                        color: #0f172a;
                        text-transform: uppercase;
                        display: flex;
                        align-items: center;
                        justify-content: flex-start;
                        gap: 4px;
                        margin-bottom: 4px;
                        text-align: left;
                    }
                    .card-section-title::before {
                        content: "";
                        display: inline-block;
                        width: 3px;
                        height: 9px;
                        background: #0f172a;
                        border-radius: 1px;
                    }
                    .card-program-list {
                        margin: 0;
                        padding: 0;
                        list-style: none;
                        display: flex;
                        flex-direction: column;
                        gap: 3px;
                        align-items: flex-start;
                    }
                    .card-program-item {
                        font-family: 'Poppins', sans-serif;
                        font-size: 0.68rem;
                        font-weight: 500;
                        color: #16213E;
                        width: 100%;
                        display: flex;
                        align-items: flex-start;
                        justify-content: flex-start;
                        text-align: left;
                    }
                    .program-left {
                        white-space: normal;
                        word-break: break-word;
                        display: -webkit-box;
                        -webkit-line-clamp: 2;
                        -webkit-box-orient: vertical;
                        overflow: hidden;
                        text-align: left;
                    }
                    .card-event-header,
                    .card-header,
                    .card-section {
                        position: relative;
                        z-index: 2;
                    }
                    .team-art-theme-0 {
                        position: absolute;
                        inset: 0;
                        z-index: 0;
                        overflow: hidden;
                        pointer-events: none;
                        background: #ecfeff;
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                    .team-art-theme-0 .shape-1 {
                        position: absolute;
                        top: -40px;
                        right: -40px;
                        width: 130px;
                        height: 130px;
                        border-radius: 50%;
                        background: rgba(6, 182, 212, 0.16);
                    }
                    .team-art-theme-0 .shape-2 {
                        position: absolute;
                        bottom: -10px;
                        left: 45%;
                        width: 60px;
                        height: 40px;
                        border-radius: 30px 30px 0 0;
                        background: rgba(37, 99, 235, 0.12);
                    }
                    .team-art-theme-0 .shape-3 {
                        position: absolute;
                        top: 130px;
                        right: 12px;
                        width: 16px;
                        height: 32px;
                        background-image: radial-gradient(rgba(29, 78, 216, 0.22) 2px, transparent 2px);
                        background-size: 8px 8px;
                    }
                    .team-art-theme-0 .shape-4 {
                        position: absolute;
                        bottom: -30px;
                        left: -30px;
                        width: 90px;
                        height: 90px;
                        border-radius: 50%;
                        border: 1.5px solid rgba(30, 41, 59, 0.15);
                    }
                    .team-art-theme-0 .shape-5 {
                        position: absolute;
                        top: 20px;
                        left: 10px;
                        width: 30px;
                        height: 15px;
                        background: repeating-linear-gradient(90deg, rgba(6, 182, 212, 0.18) 0px, rgba(6, 182, 212, 0.18) 2px, transparent 2px, transparent 6px);
                    }

                    .team-art-theme-1 {
                        position: absolute;
                        inset: 0;
                        z-index: 0;
                        overflow: hidden;
                        pointer-events: none;
                        background: #faf5ff;
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                    .team-art-theme-1 .shape-1 {
                        position: absolute;
                        top: -40px;
                        right: -40px;
                        width: 130px;
                        height: 130px;
                        border-radius: 50%;
                        background: rgba(147, 51, 234, 0.15);
                    }
                    .team-art-theme-1 .shape-2 {
                        position: absolute;
                        bottom: -10px;
                        left: 45%;
                        width: 60px;
                        height: 40px;
                        border-radius: 30px 30px 0 0;
                        background: rgba(139, 92, 246, 0.12);
                    }
                    .team-art-theme-1 .shape-3 {
                        position: absolute;
                        top: 130px;
                        right: 12px;
                        width: 16px;
                        height: 32px;
                        background-image: radial-gradient(rgba(219, 39, 119, 0.22) 2px, transparent 2px);
                        background-size: 8px 8px;
                    }
                    .team-art-theme-1 .shape-4 {
                        position: absolute;
                        bottom: -30px;
                        left: -30px;
                        width: 90px;
                        height: 90px;
                        border-radius: 50%;
                        border: 1.5px solid rgba(147, 51, 234, 0.15);
                    }
                    .team-art-theme-1 .shape-5 {
                        position: absolute;
                        top: 20px;
                        left: 10px;
                        width: 30px;
                        height: 15px;
                        background: repeating-linear-gradient(90deg, rgba(219, 39, 119, 0.18) 0px, rgba(219, 39, 119, 0.18) 2px, transparent 2px, transparent 6px);
                    }

                    .team-art-theme-2 {
                        position: absolute;
                        inset: 0;
                        z-index: 0;
                        overflow: hidden;
                        pointer-events: none;
                        background: #f0fdf4;
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                    .team-art-theme-2 .shape-1 {
                        position: absolute;
                        top: -40px;
                        right: -40px;
                        width: 130px;
                        height: 130px;
                        border-radius: 50%;
                        background: rgba(52, 211, 153, 0.16);
                    }
                    .team-art-theme-2 .shape-2 {
                        position: absolute;
                        bottom: -10px;
                        left: 45%;
                        width: 60px;
                        height: 40px;
                        border-radius: 30px 30px 0 0;
                        background: rgba(16, 185, 129, 0.12);
                    }
                    .team-art-theme-2 .shape-3 {
                        position: absolute;
                        top: 130px;
                        right: 12px;
                        width: 16px;
                        height: 32px;
                        background-image: radial-gradient(rgba(132, 204, 22, 0.22) 2px, transparent 2px);
                        background-size: 8px 8px;
                    }
                    .team-art-theme-2 .shape-4 {
                        position: absolute;
                        bottom: -30px;
                        left: -30px;
                        width: 90px;
                        height: 90px;
                        border-radius: 50%;
                        border: 1.5px solid rgba(16, 185, 129, 0.15);
                    }
                    .team-art-theme-2 .shape-5 {
                        position: absolute;
                        top: 20px;
                        left: 10px;
                        width: 30px;
                        height: 15px;
                        background: repeating-linear-gradient(90deg, rgba(52, 211, 153, 0.18) 0px, rgba(52, 211, 153, 0.18) 2px, transparent 2px, transparent 6px);
                    }

                    .team-art-theme-3 {
                        position: absolute;
                        inset: 0;
                        z-index: 0;
                        overflow: hidden;
                        pointer-events: none;
                        background: #fff7ed;
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                    .team-art-theme-3 .shape-1 {
                        position: absolute;
                        top: -40px;
                        right: -40px;
                        width: 130px;
                        height: 130px;
                        border-radius: 50%;
                        background: rgba(244, 63, 94, 0.15);
                    }
                    .team-art-theme-3 .shape-2 {
                        position: absolute;
                        bottom: -10px;
                        left: 45%;
                        width: 60px;
                        height: 40px;
                        border-radius: 30px 30px 0 0;
                        background: rgba(249, 115, 22, 0.12);
                    }
                    .team-art-theme-3 .shape-3 {
                        position: absolute;
                        top: 130px;
                        right: 12px;
                        width: 16px;
                        height: 32px;
                        background-image: radial-gradient(rgba(251, 113, 133, 0.22) 2px, transparent 2px);
                        background-size: 8px 8px;
                    }
                    .team-art-theme-3 .shape-4 {
                        position: absolute;
                        bottom: -30px;
                        left: -30px;
                        width: 90px;
                        height: 90px;
                        border-radius: 50%;
                        border: 1.5px solid rgba(244, 63, 94, 0.15);
                    }
                    .team-art-theme-3 .shape-5 {
                        position: absolute;
                        top: 20px;
                        left: 10px;
                        width: 30px;
                        height: 15px;
                        background: repeating-linear-gradient(90deg, rgba(249, 115, 22, 0.18) 0px, rgba(249, 115, 22, 0.18) 2px, transparent 2px, transparent 6px);
                    }
                </style>
            `;
        } else {
            styleBlock = `
                <style>
                    @page {
                        size: A4 ${orientation};
                        margin: 0;
                    }
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                        color: #000;
                        margin: 0;
                        padding: ${pageMargin};
                        box-sizing: border-box;
                        background: #fff;
                        font-size: 0.75rem;
                        line-height: 1.25;
                    }
                    h2, h3, h4 {
                        margin: 0;
                        color: #000;
                    }
                    .report-table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-top: 0.5rem;
                        font-size: 0.75rem;
                    }
                    .report-table th, .report-table td {
                        border: 1px solid #000;
                        padding: 0.25rem 0.4rem;
                        text-align: left;
                        vertical-align: middle;
                    }
                    .report-table th {
                        background-color: #f5f5f5 !important;
                        color: #000;
                        font-weight: 800;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    .report-table tr {
                        page-break-inside: avoid;
                        break-inside: avoid;
                    }
                    .report-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: flex-start;
                        border-bottom: 2px solid #000;
                        padding-bottom: 0.35rem;
                        margin-bottom: 0.6rem;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    .report-title {
                        font-weight: 800;
                        font-size: 0.75rem;
                        color: #000;
                        text-transform: uppercase;
                        letter-spacing: 0.05em;
                    }
                    .program-card-compact {
                        margin-bottom: 0.75rem;
                        border-bottom: 1.5px dashed #000;
                        padding-bottom: 0.5rem;
                        page-break-inside: avoid;
                        break-inside: avoid;
                    }
                    .program-card-compact:last-child {
                        border-bottom: none;
                        padding-bottom: 0;
                    }
                    .program-page-standard {
                        page-break-after: always;
                        break-after: page;
                    }
                    .program-page-standard:last-child {
                        page-break-after: avoid;
                        break-after: page-inside;
                    }
                </style>
            `;
        }

        doc.open();
        doc.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>${window.escapeHTML(exp.fileName)}</title>
                ${styleBlock}
            </head>
            <body>
                <div style="max-width:100%; margin: 0 auto; box-sizing:border-box;">
                    ${htmlContent}
                </div>
            </body>
            </html>
        `);
        doc.close();

        if (isDownload) {
            setTimeout(async () => {
                try {
                    window.showToast("Preparing PDF download...", "info");

                    const prevWidth = printIframe.style.width;
                    const prevHeight = printIframe.style.height;

                    if (orientation === 'landscape') {
                        printIframe.style.width = '1123px';
                    } else if (orientation === 'a3_portrait') {
                        printIframe.style.width = '1123px';
                    } else {
                        printIframe.style.width = '794px';
                    }
                    printIframe.style.height = 'auto';
                    await new Promise(resolve => setTimeout(resolve, 150));

                    const scrollHeight = Math.max(
                        doc.body.scrollHeight,
                        doc.documentElement.scrollHeight,
                        doc.body.offsetHeight,
                        doc.documentElement.offsetHeight
                    );
                    printIframe.style.height = (scrollHeight + 100) + 'px';
                    await new Promise(resolve => setTimeout(resolve, 50));

                    const html2pdf = await loadHtml2Pdf();
                    const pdfFormat = orientation === 'a3_portrait' ? 'a3' : 'a4';
                    const pdfOrientation = orientation === 'a3_portrait' ? 'portrait' : orientation;
                    const opt = {
                        margin: 10,
                        filename: exp.fileName || 'export.pdf',
                        image: { type: 'jpeg', quality: 0.98 },
                        html2canvas: { scale: 1.5, useCORS: true, logging: false, scrollX: 0, scrollY: 0 },
                        jsPDF: { unit: 'mm', format: pdfFormat, orientation: pdfOrientation },
                        pagebreak: { mode: ['css', 'legacy'] }
                    };
                    const element = doc.body;
                    await html2pdf().set(opt).from(element).save();

                    printIframe.style.width = prevWidth;
                    printIframe.style.height = prevHeight;
                } catch (err) {
                    console.error("PDF generation failed, falling back to print dialog:", err);
                    printIframe.contentWindow.focus();
                    printIframe.contentWindow.print();
                }
            }, 500);
        } else {
            setTimeout(() => {
                printIframe.contentWindow.focus();
                printIframe.contentWindow.print();
            }, 300);
        }
        return;
    } else if (f.type === 'Program Participation Register') {
        if (f.progRegSubmode === 'list') {
            const instName = getEventName();

            // Group programs by Category
            const categoryGroups = {};
            programs.forEach(p => {
                let catName = 'GENERAL';
                if (p.categoryId === 'general_programs' || p.programType === 'general') {
                    catName = 'GENERAL';
                } else {
                    const cat = allCategories.find(c => c.id === p.categoryId);
                    catName = cat ? cat.name : (p.categoryName || 'GENERAL');
                }

                if (!categoryGroups[catName]) {
                    categoryGroups[catName] = [];
                }
                categoryGroups[catName].push(p);
            });

            // Sort Category sections: General first, then by minimum assigned class/standard
            const sortedCatNames = Object.keys(categoryGroups).sort(compareCategoriesByMinClass);

            // Sort programs inside each category: Stage programs first, then Off Stage programs (sorted using existing program order)
            sortedCatNames.forEach(catName => {
                categoryGroups[catName].sort((a, b) => {
                    const isStageA = (a.programLocation || a.location || 'Stage').toLowerCase() === 'stage' ? 0 : 1;
                    const isStageB = (b.programLocation || b.location || 'Stage').toLowerCase() === 'stage' ? 0 : 1;
                    if (isStageA !== isStageB) {
                        return isStageA - isStageB;
                    }

                    const numA = String(a.programNumber ?? '').trim();
                    const numB = String(b.programNumber ?? '').trim();
                    if (numA && numB) {
                        const cmp = numA.localeCompare(numB, undefined, { numeric: true, sensitivity: 'base' });
                        if (cmp !== 0) return cmp;
                    } else if (numA) {
                        return -1;
                    } else if (numB) {
                        return 1;
                    }
                    return (a.programName || '').localeCompare(b.programName || '');
                });
            });

            if (sortedCatNames.length === 0) {
                htmlContent = `
                    <div style="text-align:center; padding:4rem; color:#dc2626; border:1px solid #fecaca; border-radius:12px; background:#fef2f2;">
                        <h3 style="margin:0;">⚠️ No matching programs found.</h3>
                        <p style="color:#64748b; margin-top:0.25rem; font-weight:600;">Check your filter criteria and try again.</p>
                    </div>
                `;
            } else {
                const catDisplay = f.categoryId
                    ? (f.categoryId === 'general_programs' ? 'GENERAL PROGRAMS' : (allCategories.find(c => c.id === f.categoryId)?.name || 'SELECTED CATEGORY').toUpperCase())
                    : 'ALL CATEGORIES';

                htmlContent += sortedCatNames.map(catName => `
                    <div class="program-category-list-page" style="margin-bottom: 2rem;">
                        <div class="report-header" style="display:flex; justify-content:space-between; align-items:flex-end; border-bottom: 2px solid #000; padding-bottom: 0.4rem; margin-bottom: 0.75rem; width: 100%;">
                            <div>
                                <div style="font-size: 0.8rem; font-weight: 800; color: #000; letter-spacing: 0.05em; text-transform: uppercase;">
                                    PROGRAM LIST
                                </div>
                                <h2 style="margin: 0.15rem 0 0 0; color: #000; font-size: 1.25rem; font-weight: 800; text-transform: uppercase;">
                                    PROGRAM LIST BY CATEGORY
                                </h2>
                                <div style="font-size: 0.72rem; font-weight: 700; color: #000; margin-top: 0.1rem; text-transform: uppercase;">
                                    ${window.escapeHTML(instName).toUpperCase()}
                                </div>
                            </div>
                            <div style="text-align: right; font-weight: 800; color: #000; line-height: 1.3;">
                                <div style="font-size: 0.85rem; font-weight: 800; text-transform: uppercase; color: #1e1b4b;">
                                    ${window.escapeHTML(catDisplay !== 'ALL CATEGORIES' ? catDisplay : catName.toUpperCase())}
                                </div>
                                ${f.programLocation ? `<div style="font-size: 0.72rem; font-weight: 700; color: #334155; text-transform: uppercase;">LOCATION: ${window.escapeHTML(f.programLocation).toUpperCase()}</div>` : ''}
                                ${f.gender ? `<div style="font-size: 0.68rem; font-weight: 700; color: #475569; text-transform: uppercase;">GENDER: ${window.escapeHTML(f.gender).toUpperCase()}</div>` : ''}
                            </div>
                        </div>

                        <div style="background: #1e1b4b; color: #ffffff; padding: 0.4rem 0.75rem; font-size: 0.85rem; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; border-radius: 4px; margin-bottom: 0.6rem;">
                            ${window.escapeHTML(catName)}
                        </div>

                        <table class="report-table" style="width: 100%; border-collapse: collapse; font-size: 0.82rem; margin-top: 0;">
                            <thead>
                                <tr style="background: #f1f5f9;">
                                    <th style="width: 45px; text-align: center; padding: 0.45rem 0.5rem; border: 1px solid #000; font-weight: 800;">#</th>
                                    <th style="width: 130px; text-align: center; padding: 0.45rem 0.5rem; border: 1px solid #000; font-weight: 800;">PROGRAM NO</th>
                                    <th style="padding: 0.45rem 0.75rem; text-align: left; border: 1px solid #000; font-weight: 800;">PROGRAM NAME</th>
                                    <th style="width: 100px; text-align: center; padding: 0.45rem 0.5rem; border: 1px solid #000; font-weight: 800;">GENDER</th>
                                    <th style="width: 140px; text-align: center; padding: 0.45rem 0.5rem; border: 1px solid #000; font-weight: 800;">STAGE / OFF STAGE</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${categoryGroups[catName].map((p, idx) => `
                                    <tr style="border-bottom: 1px solid #000; page-break-inside: avoid;">
                                        <td style="text-align: center; font-weight: 700; padding: 0.4rem 0.5rem; border: 1px solid #000;">${idx + 1}</td>
                                        <td style="text-align: center; font-weight: 800; padding: 0.4rem 0.5rem; border: 1px solid #000; color: #1e1b4b;">${window.escapeHTML(p.programNumber || '—')}</td>
                                        <td style="padding: 0.4rem 0.75rem; font-weight: 700; border: 1px solid #000;">${window.escapeHTML(p.programName)}</td>
                                        <td style="text-align: center; font-weight: 700; padding: 0.4rem 0.5rem; border: 1px solid #000;">${window.escapeHTML(getProgramGenderDisplay(p))}</td>
                                        <td style="text-align: center; font-weight: 700; padding: 0.4rem 0.5rem; border: 1px solid #000;">
                                            ${window.escapeHTML(p.programLocation || 'Stage')}
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `).join('');
            }
        } else if (f.progRegSubmode === 'student_summary') {
            const instName = getEventName();

            const teamNamesMap = {};
            allTeams.forEach(t => {
                if (t.id) teamNamesMap[String(t.id)] = t.name;
            });

            let studentsList = Object.values(studentMap);

            if (f.categoryId) {
                const targetCat = allCategories.find(c => c.id === f.categoryId);
                const targetCatName = (targetCat ? targetCat.name : f.categoryId).trim().toLowerCase();
                studentsList = studentsList.filter(s =>
                    s.categoryId === f.categoryId || s.category === f.categoryId || (s.category || '').trim().toLowerCase() === targetCatName
                );
            }

            if (f.classId) {
                studentsList = studentsList.filter(s => s.classId === f.classId || s.class === f.classId);
            }

            if (f.teamId) {
                studentsList = studentsList.filter(s => String(s.teamId) === String(f.teamId));
            }

            if (f.gender === 'Boys') {
                studentsList = studentsList.filter(s => s.gender === 'Male' || s.gender === 'Boys');
            } else if (f.gender === 'Girls') {
                studentsList = studentsList.filter(s => s.gender === 'Female' || s.gender === 'Girls');
            }

            const studentByDocId = new Map();
            const studentByChest = new Map();

            studentsList.forEach(s => {
                if (s.id) studentByDocId.set(String(s.id), s);
                if (s.chestNumber) studentByChest.set(String(s.chestNumber).trim().toLowerCase(), s);
            });

            const studentProgramsMap = new Map();
            studentsList.forEach(s => {
                if (s.id) studentProgramsMap.set(String(s.id), []);
            });

            const validProgramIds = new Set(programs.map(p => p.id));

            for (const progId in participantsMap) {
                if (!validProgramIds.has(progId)) continue;
                const prog = allPrograms.find(pr => pr.id === progId);
                if (!prog) continue;

                const pList = participantsMap[progId] || [];
                pList.forEach(p => {
                    if (!p.isGroup) {
                        const matchedStudent = (p.studentId && studentByDocId.get(String(p.studentId)))
                            || (p.id && studentByDocId.get(String(p.id)))
                            || (p.chestNumber && studentByChest.get(String(p.chestNumber).trim().toLowerCase()));

                        if (matchedStudent && studentProgramsMap.has(String(matchedStudent.id))) {
                            studentProgramsMap.get(String(matchedStudent.id)).push(prog);
                        }
                    } else {
                        if (Array.isArray(p.members)) {
                            p.members.forEach(m => {
                                const matchedStudent = (m.studentId && studentByDocId.get(String(m.studentId)))
                                    || (m.id && studentByDocId.get(String(m.id)))
                                    || (m.chestNumber && studentByChest.get(String(m.chestNumber).trim().toLowerCase()));

                                if (matchedStudent && studentProgramsMap.has(String(matchedStudent.id))) {
                                    studentProgramsMap.get(String(matchedStudent.id)).push(prog);
                                }
                            });
                        }
                    }
                });
            }

            studentsList.forEach(s => {
                if (!s.id) return;
                const rawProgs = studentProgramsMap.get(String(s.id)) || [];
                const uniqueMap = new Map();
                rawProgs.forEach(p => {
                    if (!uniqueMap.has(p.id)) {
                        uniqueMap.set(p.id, p);
                    }
                });
                const arr = Array.from(uniqueMap.values());
                arr.sort((a, b) => {
                    const numA = String(a.programNumber ?? '').trim();
                    const numB = String(b.programNumber ?? '').trim();
                    if (numA && numB) {
                        const cmp = numA.localeCompare(numB, undefined, { numeric: true, sensitivity: 'base' });
                        if (cmp !== 0) return cmp;
                    }
                    return (a.programName || '').localeCompare(b.programName || '');
                });
                studentProgramsMap.set(String(s.id), arr);
            });

            studentsList.sort((a, b) => {
                const classA = String(a.className || a.class || a.classId || '').trim();
                const classB = String(b.className || b.class || b.classId || '').trim();
                const classCmp = classA.localeCompare(classB, undefined, { numeric: true, sensitivity: 'base' });
                if (classCmp !== 0) return classCmp;

                const chestA = String(a.chestNumber || '').trim();
                const chestB = String(b.chestNumber || '').trim();
                return chestA.localeCompare(chestB, undefined, { numeric: true, sensitivity: 'base' });
            });

            if (studentsList.length === 0) {
                htmlContent = `
                    <div style="text-align:center; padding:4rem; color:#dc2626; border:1px solid #fecaca; border-radius:12px; background:#fef2f2;">
                        <h3 style="margin:0;">⚠️ No matching students found.</h3>
                        <p style="color:#64748b; margin-top:0.25rem; font-weight:600;">Check your filter criteria and try again.</p>
                    </div>
                `;
            } else {
                const catText = f.categoryId
                    ? (allCategories.find(c => c.id === f.categoryId)?.name || f.categoryId).toUpperCase()
                    : 'ALL CATEGORIES';
                const classText = f.classId
                    ? String(f.classId).toUpperCase()
                    : 'ALL CLASSES';
                const genderText = f.gender ? String(f.gender).toUpperCase() : 'ALL GENDERS';
                const locText = f.programLocation ? String(f.programLocation).toUpperCase() : 'ALL LOCATIONS';
                const teamText = f.teamId ? (teamNamesMap[String(f.teamId)] || f.teamId).toUpperCase() : 'ALL TEAMS';

                const filterSummary = `CAT: ${catText} | CLASS: ${classText} | GENDER: ${genderText} | LOCATION: ${locText}${f.teamId ? ` | TEAM: ${teamText}` : ''}`;
                const genDateStr = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).toUpperCase();

                htmlContent = `
                    <div class="program-page-standard" style="margin-bottom: 2rem;">
                        <div class="report-header" style="display:flex; justify-content:space-between; align-items:flex-end; border-bottom: 2px solid #000; padding-bottom: 0.4rem; margin-bottom: 0.75rem; width: 100%;">
                            <div>
                                <div style="font-size: 0.8rem; font-weight: 800; color: #000; letter-spacing: 0.05em; text-transform: uppercase;">
                                    PARTICIPATION REPORT
                                </div>
                                <h2 style="margin: 0.15rem 0 0 0; color: #000; font-size: 1.25rem; font-weight: 800; text-transform: uppercase;">
                                    STUDENT-WISE PARTICIPATION SUMMARY
                                </h2>
                                <div style="font-size: 0.72rem; font-weight: 700; color: #000; margin-top: 0.1rem; text-transform: uppercase;">
                                    ${window.escapeHTML(instName).toUpperCase()}
                                </div>
                            </div>
                            <div style="text-align: right; font-weight: 800; color: #000; line-height: 1.3;">
                                <div style="font-size: 0.72rem; font-weight: 700; color: #334155;">
                                    GENERATED: ${genDateStr}
                                </div>
                                <div style="font-size: 0.68rem; font-weight: 700; color: #475569; margin-top: 0.1rem;">
                                    ${window.escapeHTML(filterSummary)}
                                </div>
                                <div style="font-size: 0.68rem; font-weight: 800; color: #1e1b4b; margin-top: 0.1rem;">
                                    TOTAL: ${studentsList.length} STUDENTS
                                </div>
                            </div>
                        </div>

                        <table class="report-table" style="width: 100%; border-collapse: collapse; font-size: 0.8rem; margin-top: 0;">
                            <thead>
                                <tr style="background: #f1f5f9;">
                                    <th style="width: 40px; text-align: center; padding: 0.45rem 0.3rem; border: 1px solid #000; font-weight: 800;">SL.NO</th>
                                    <th style="width: 75px; text-align: center; padding: 0.45rem 0.3rem; border: 1px solid #000; font-weight: 800;">CHEST NO</th>
                                    <th style="width: 210px; text-align: left; padding: 0.45rem 0.5rem; border: 1px solid #000; font-weight: 800;">STUDENT NAME</th>
                                    <th style="width: 130px; text-align: left; padding: 0.45rem 0.5rem; border: 1px solid #000; font-weight: 800;">TEAM</th>
                                    <th style="text-align: left; padding: 0.45rem 0.5rem; border: 1px solid #000; font-weight: 800;">PROGRAM LIST</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${studentsList.map((s, idx) => {
                    const progs = studentProgramsMap.get(String(s.id)) || [];
                    const totalProgs = progs.length;
                    const progNames = totalProgs > 0
                        ? progs.map(p => window.escapeHTML(p.programName)).join(', ')
                        : '—';
                    const teamName = teamNamesMap[String(s.teamId)] || s.teamName || '—';
                    const className = s.className || s.class || s.classId || '—';
                    const genderDisplay = s.gender === 'Male' ? 'Boys' : (s.gender === 'Female' ? 'Girls' : (s.gender || '—'));

                    return `
                                        <tr style="border-bottom: 1px solid #000; page-break-inside: avoid;">
                                            <td style="text-align: center; font-weight: 700; padding: 0.4rem 0.3rem; border: 1px solid #000;">${idx + 1}</td>
                                            <td style="text-align: center; font-weight: 800; padding: 0.4rem 0.3rem; border: 1px solid #000; color: #1e1b4b;">${window.escapeHTML(s.chestNumber || '—')}</td>
                                            <td style="padding: 0.4rem 0.5rem; border: 1px solid #000;">
                                                <div style="font-weight: 800; color: #000; text-transform: uppercase;">${window.escapeHTML(s.name || '—')}</div>
                                                <div style="font-size: 0.68rem; font-weight: 700; color: #475569; margin-top: 0.15rem;">Class : ${window.escapeHTML(className).toUpperCase()} &nbsp;|&nbsp; Gender : ${window.escapeHTML(genderDisplay)}</div>
                                            </td>
                                            <td style="padding: 0.4rem 0.5rem; font-weight: 600; border: 1px solid #000;">${window.escapeHTML(teamName)}</td>
                                            <td style="padding: 0.4rem 0.5rem; font-weight: 600; border: 1px solid #000; word-break: break-word; white-space: normal; line-height: 1.35;">${progNames}</td>
                                        </tr>
                                    `;
                }).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
            }
        } else {
            const isCompact = f.compactPacking !== false;

            const isRegistered = (studentId, progId) => {
                const parts = participantsMap[progId] || [];
                return parts.some(part => {
                    if (part.isGroup) {
                        return (part.members || []).some(m => m.studentId === studentId);
                    } else {
                        return part.studentId === studentId;
                    }
                });
            };

            // Retrieve matching programs list (Combine Stage & Off Stage columns)
            let matchingPrograms = [...programs];
            if (f.participationType) {
                if (f.participationType === 'general') {
                    matchingPrograms = matchingPrograms.filter(p => p.categoryId === 'general_programs' || p.programType === 'general');
                } else if (f.participationType === 'group') {
                    matchingPrograms = matchingPrograms.filter(p => p.programType === 'group');
                } else if (f.participationType === 'individual') {
                    matchingPrograms = matchingPrograms.filter(p => p.programType === 'individual');
                }
            }

            const columnItems = buildColumnItems(matchingPrograms);

            if (f.categoryId === 'general_programs') {
                if (columnItems.length === 0) {
                    htmlContent = `
                    <div style="text-align:center; padding:4rem; color:#dc2626; border:1px solid #fecaca; border-radius:12px; background:#fef2f2;">
                        <h3 style="margin:0;">⚠️ No matching general programs found.</h3>
                        <p style="color:#64748b; margin-top:0.25rem; font-weight:600;">Check your filter criteria and try again.</p>
                    </div>
                `;
                } else {
                    const instName = getEventName();
                    const teamName = f.teamId ? (allTeams.find(t => t.id === f.teamId)?.name || '') : '';
                    const pageDivClass = isCompact ? 'program-card-compact' : 'program-page-standard';

                    const N = columnItems.length;
                    let cellFontSize = '0.75rem';
                    let headerHeight = '120px';

                    if (N > 25) {
                        cellFontSize = '0.42rem';
                        headerHeight = '180px';
                    } else if (N > 18) {
                        cellFontSize = '0.48rem';
                        headerHeight = '160px';
                    } else if (N > 12) {
                        cellFontSize = '0.55rem';
                        headerHeight = '140px';
                    } else if (N > 8) {
                        cellFontSize = '0.65rem';
                        headerHeight = '130px';
                    }

                    htmlContent += `
                    <div class="${pageDivClass}" style="margin-bottom: 2rem; page-break-inside: avoid; break-inside: avoid;">
                        <div class="report-header" style="display:flex; justify-content:space-between; align-items:flex-end; border-bottom: 2px solid #000; padding-bottom: 0.4rem; margin-bottom: 0.5rem; width: 100%;">
                            <div>
                                <div style="font-size: 0.8rem; font-weight: 800; color: #000; letter-spacing: 0.05em; text-transform: uppercase;">
                                    PROGRAM PARTICIPATION REGISTER
                                </div>
                                <h2 style="margin: 0.15rem 0 0 0; color: #000; font-size: 1.25rem; font-weight: 800; text-transform: uppercase;">
                                    GENERAL PROGRAMS (NON-CATEGORY)
                                </h2>
                                <div style="font-size: 0.72rem; font-weight: 700; color: #000; margin-top: 0.1rem; text-transform: uppercase;">
                                    ${window.escapeHTML(instName).toUpperCase()} ${teamName ? `• ${window.escapeHTML(teamName).toUpperCase()}` : ''}
                                </div>
                            </div>
                            <div style="text-align: right; font-weight: 800; color: #000; line-height: 1.3;">
                                <div style="font-size: 0.9rem; text-transform: uppercase;">
                                    ${(f.participationType === 'individual' ? 'INDIVIDUAL PROGRAM' : (f.participationType === 'group' ? 'GROUP PROGRAM' : (f.participationType === 'general' ? 'GENERAL PROGRAM' : 'ALL PROGRAM TYPES')))}
                                </div>
                                <div style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase;">
                                    STAGE / OFF STAGE
                                </div>
                                ${f.gender ? `<div style="font-size: 0.68rem; font-weight: 700; color: #475569; text-transform: uppercase;">GENDER: ${window.escapeHTML(f.gender)}</div>` : ''}
                            </div>
                        </div>

                        <table class="report-table" style="margin-top: 0.5rem; font-size:${cellFontSize};">
                            <thead>
                                <tr>
                                    <th style="width:40px; min-width:40px; max-width:40px; text-align:center; padding:0.35rem 0.2rem; line-height: 1.2; border: 1px solid #000;">SL<br>NO.</th>
                                    <th style="width:60px; min-width:60px; max-width:60px; text-align:center; padding:0.35rem 0.2rem; line-height: 1.2; border: 1px solid #000;">CHEST<br>NO.</th>
                                    <th style="width:180px; min-width:180px; max-width:180px; padding:0.35rem 0.5rem; text-align:left; border: 1px solid #000;">PARTICIPANT NAME</th>
                                    ${columnItems.map(item => {
                        if (item.type === 'separator') {
                            return `<th class="program-col-separator" style="width: 12px; min-width: 12px; max-width: 12px; border: 1px solid #000; background: #f1f5f9 !important;"></th>`;
                        }
                        const p = item.program;
                        return `
                                            <th class="rotated-th program-col" style="height:${headerHeight};">
                                                <div>${window.escapeHTML(p.programNumber ? `${p.programNumber} – ${p.programName}` : p.programName).toUpperCase()}</div>
                                            </th>
                                        `;
                    }).join('')}
                                    <th style="border-left: none; border-right: none; background: #fff !important;"></th>
                                </tr>
                            </thead>
                            <tbody>
                                ${Array.from({ length: 25 }).map((_, idx) => `
                                    <tr style="height:32px; page-break-inside:avoid;">
                                        <td style="width:40px; min-width:40px; max-width:40px; text-align:center; font-weight:bold; color:#000; padding:0.35rem 0.2rem; border: 1px solid #000;">${idx + 1}</td>
                                        <td style="width:60px; min-width:60px; max-width:60px; text-align:center; font-weight:bold; color:#000; padding:0.35rem 0.2rem; border: 1px solid #000;"></td>
                                        <td style="width:180px; min-width:180px; max-width:180px; border: 1px solid #000;"></td>
                                        ${columnItems.map(item => {
                        if (item.type === 'separator') {
                            return `<td class="program-col-separator" style="width: 12px; min-width: 12px; max-width: 12px; border: 1px solid #000; background: #f1f5f9 !important;"></td>`;
                        }
                        return `<td class="program-col" style="border:1px solid #000;"></td>`;
                    }).join('')}
                                        <td style="border-left: none; border-right: none;"></td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>

                        <div class="register-footer">
                            <div>COORDINATOR SIGNATURE : ________________________</div>
                            <div>DATE : ________________________</div>
                        </div>
                    </div>
                `;
                }

                // Render PDF through iframe
                const printIframe = getPrintIframe();
                const doc = printIframe.contentDocument || printIframe.contentWindow.document;
                const pageMargin = '10mm';

                const styleBlock = `
                <style>
                    @page {
                        size: A4 ${orientation};
                        margin: 0;
                    }
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                        color: #000;
                        margin: 0;
                        padding: ${pageMargin};
                        box-sizing: border-box;
                        background: #fff;
                        font-size: 0.85rem;
                        line-height: 1.4;
                    }
                    h2, h3, h4 {
                        margin: 0;
                        color: #000;
                    }
                    .report-table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-top: 1rem;
                        border: 2px solid #000;
                    }
                    .report-table th, .report-table td {
                        border: 1px solid #000;
                    }
                    .program-col {
                        width: 32px !important;
                        min-width: 32px !important;
                        max-width: 32px !important;
                        text-align: center;
                        padding: 0 !important;
                        box-sizing: border-box;
                        border: 1px solid #000 !important;
                    }
                    .report-table th {
                        background-color: #fff !important;
                        color: #000;
                        font-weight: bold;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    .report-table tr {
                        page-break-inside: avoid;
                        break-inside: avoid;
                    }
                    .program-card-compact {
                        padding: 0;
                        margin-bottom: 2rem;
                        page-break-inside: avoid;
                        break-inside: avoid;
                        background: #fff;
                        display: flex;
                        flex-direction: column;
                        justify-content: space-between;
                    }
                    .program-page-standard {
                        padding: 0;
                        width: 100%;
                        height: 100%;
                        min-height: ${orientation === 'landscape' ? '180mm' : '258mm'};
                        display: flex;
                        flex-direction: column;
                        justify-content: space-between;
                        page-break-after: always;
                        break-after: page;
                        background: #fff;
                    }
                    .program-page-standard:last-child {
                        page-break-after: avoid;
                        break-after: page-inside;
                    }
                    .rotated-th {
                        vertical-align: middle;
                        text-align: center;
                        padding: 0.5rem 0.15rem;
                        font-weight: bold;
                        border: 1px solid #000;
                        box-sizing: border-box;
                    }
                    .rotated-th > div {
                        writing-mode: vertical-rl;
                        transform: rotate(180deg);
                        white-space: nowrap;
                        text-align: center;
                        margin: 0 auto;
                        width: 14px;
                        box-sizing: border-box;
                    }
                    .register-footer {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        font-size: 0.8rem;
                        font-weight: bold;
                        color: #000;
                        margin-top: 1.5rem;
                        padding-top: 0.5rem;
                    }
                </style>
            `;

                doc.open();
                doc.write(`
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <title>${window.escapeHTML(exp.fileName)}</title>
                    ${styleBlock}
                </head>
                <body>
                    <div style="max-width:100%; margin: 0 auto; box-sizing:border-box;">
                        ${htmlContent}
                    </div>
                </body>
                </html>
            `);
                doc.close();

                if (isDownload) {
                    setTimeout(async () => {
                        try {
                            window.showToast("Preparing PDF download...", "info");

                            const prevWidth = printIframe.style.width;
                            const prevHeight = printIframe.style.height;

                            if (orientation === 'landscape') {
                                printIframe.style.width = '1123px';
                            } else {
                                printIframe.style.width = '794px';
                            }
                            printIframe.style.height = 'auto';
                            await new Promise(resolve => setTimeout(resolve, 150));

                            const scrollHeight = Math.max(
                                doc.body.scrollHeight,
                                doc.documentElement.scrollHeight,
                                doc.body.offsetHeight,
                                doc.documentElement.offsetHeight
                            );
                            printIframe.style.height = (scrollHeight + 100) + 'px';
                            await new Promise(resolve => setTimeout(resolve, 50));

                            const html2pdf = await loadHtml2Pdf();
                            const opt = {
                                margin: 10,
                                filename: exp.fileName || 'export.pdf',
                                image: { type: 'jpeg', quality: 0.98 },
                                html2canvas: { scale: 1.5, useCORS: true, logging: false, scrollX: 0, scrollY: 0 },
                                jsPDF: { unit: 'mm', format: 'a4', orientation: orientation },
                                pagebreak: { mode: ['css', 'legacy'] }
                            };
                            const element = doc.body;
                            await html2pdf().set(opt).from(element).save();

                            printIframe.style.width = prevWidth;
                            printIframe.style.height = prevHeight;
                        } catch (err) {
                            console.error("PDF generation failed, falling back to print dialog:", err);
                            printIframe.contentWindow.focus();
                            printIframe.contentWindow.print();
                        }
                    }, 500);
                } else {
                    setTimeout(() => {
                        printIframe.contentWindow.focus();
                        printIframe.contentWindow.print();
                    }, 300);
                }
                return;
            }

            const chunkArray = (array, size) => {
                const chunks = [];
                for (let i = 0; i < array.length; i += size) {
                    chunks.push(array.slice(i, i + size));
                }
                return chunks;
            };

            // 1. Filter students
            let studentsList = Object.values(studentMap);

            if (f.categoryId === 'general_programs' || f.participationType === 'general') {
                const registeredStudentIds = new Set();
                matchingPrograms.forEach(p => {
                    const parts = participantsMap[p.id] || [];
                    parts.forEach(part => {
                        if (part.isGroup) {
                            (part.members || []).forEach(m => {
                                if (m.studentId) registeredStudentIds.add(m.studentId);
                            });
                        } else {
                            if (part.studentId) registeredStudentIds.add(part.studentId);
                        }
                    });
                });
                studentsList = studentsList.filter(s => registeredStudentIds.has(s.id));
                if (f.categoryId && f.categoryId !== 'general_programs') {
                    studentsList = studentsList.filter(s => s.categoryId === f.categoryId);
                }
            } else if (f.categoryId) {
                studentsList = studentsList.filter(s => s.categoryId === f.categoryId);
            }

            if (f.registerMode !== 'category-wise' && f.classId) {
                studentsList = studentsList.filter(s => s.classId === f.classId);
            }
            if (f.teamId) {
                studentsList = studentsList.filter(s => String(s.teamId) === String(f.teamId));
            }
            if (f.gender === 'Boys') {
                studentsList = studentsList.filter(s => s.gender === 'Male');
            } else if (f.gender === 'Girls') {
                studentsList = studentsList.filter(s => s.gender === 'Female');
            }

            if (studentsList.length === 0) {
                htmlContent = `
                <div style="text-align:center; padding:4rem; color:#dc2626; border:1px solid #fecaca; border-radius:12px; background:#fef2f2;">
                    <h3 style="margin:0;">⚠️ No matching students found.</h3>
                    <p style="color:#64748b; margin-top:0.25rem; font-weight:600;">Check your filter criteria and try again.</p>
                </div>
            `;
            } else if (matchingPrograms.length === 0) {
                htmlContent = `
                <div style="text-align:center; padding:4rem; color:#dc2626; border:1px solid #fecaca; border-radius:12px; background:#fef2f2;">
                    <h3 style="margin:0;">⚠️ No matching programs found.</h3>
                    <p style="color:#64748b; margin-top:0.25rem; font-weight:600;">Check your filter criteria and try again.</p>
                </div>
            `;
            } else {
                // Map team names
                const teamNamesMap = {};
                allTeams.forEach(t => {
                    if (t.id) teamNamesMap[String(t.id)] = t.name;
                });

                // 2. Sort students according to chestSort parameter
                const sortRule = f.chestSort || 'chest';
                if (sortRule === 'chest') {
                    studentsList.sort((a, b) => {
                        const numA = parseInt(a.chestNumber, 10);
                        const numB = parseInt(b.chestNumber, 10);
                        const hasA = !isNaN(numA);
                        const hasB = !isNaN(numB);
                        if (hasA && hasB) return numA - numB;
                        if (hasA) return -1;
                        if (hasB) return 1;
                        return (a.chestNumber || '').localeCompare(b.chestNumber || '');
                    });
                } else if (sortRule === 'name') {
                    studentsList.sort((a, b) => {
                        const nameA = a.name || '';
                        const nameB = b.name || '';
                        return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
                    });
                } else if (sortRule === 'team') {
                    studentsList.sort((a, b) => {
                        const teamA = teamNamesMap[String(a.teamId)] || a.teamName || '';
                        const teamB = teamNamesMap[String(b.teamId)] || b.teamName || '';
                        return teamA.localeCompare(teamB, undefined, { sensitivity: 'base' });
                    });
                }

                // 3. Group students hierarchically
                if (f.registerMode === 'category-wise') {
                    const groups = {};
                    studentsList.forEach(stu => {
                        const catId = stu.categoryId || 'general';
                        const catName = stu.categoryName || 'General';
                        const teamId = stu.teamId || 'no-team';
                        const teamName = teamNamesMap[String(stu.teamId)] || stu.teamName || 'Independent';

                        if (!groups[catId]) {
                            groups[catId] = {
                                name: catName,
                                teams: {}
                            };
                        }
                        if (!groups[catId].teams[teamId]) {
                            groups[catId].teams[teamId] = {
                                name: teamName,
                                students: []
                            };
                        }
                        groups[catId].teams[teamId].students.push(stu);
                    });

                    const sortedCatIds = Object.keys(groups).sort((a, b) => {
                        const idxA = allCategories.findIndex(c => c.id === a);
                        const idxB = allCategories.findIndex(c => c.id === b);
                        return idxA - idxB;
                    });
                    const instName = getEventName();
                    const pageDivClass = isCompact ? 'program-card-compact' : 'program-page-standard';

                    sortedCatIds.forEach(catId => {
                        const cat = groups[catId];
                        const sortedTeamIds = Object.keys(cat.teams).sort((a, b) => cat.teams[a].name.localeCompare(cat.teams[b].name));

                        // Filter matching programs for this specific Category
                        const progs = f.categoryId === 'general_programs' || f.participationType === 'general'
                            ? matchingPrograms
                            : matchingPrograms.filter(p => p.categoryId === catId);

                        if (progs.length === 0) {
                            htmlContent += `
                            <div class="${pageDivClass}" style="margin-bottom: 2rem; page-break-inside: avoid; break-inside: avoid;">
                                <div style="padding: 2rem; text-align: center; border: 1px dashed #cbd5e1; border-radius: 8px;">
                                    <h3>Category: ${window.escapeHTML(cat.name)}</h3>
                                    <p style="color:#64748b;">No registered programs for this Category.</p>
                                </div>
                            </div>
                        `;
                            return;
                        }

                        const columnItems = buildColumnItems(progs);
                        const N = columnItems.length;
                        let cellFontSize = '0.75rem';
                        let headerHeight = '120px';
                        let rowHeightVal = '26px';
                        let cellPaddingVal = '2px 0.2rem';
                        let nameCellPaddingVal = '2px 0.5rem';
                        let pageSize = orientation === 'landscape' ? 16 : 20;

                        if (N > 25) {
                            cellFontSize = '0.42rem';
                            headerHeight = '180px';
                            rowHeightVal = '22px';
                            cellPaddingVal = '1px 0.1rem';
                            nameCellPaddingVal = '1px 0.3rem';
                            pageSize = orientation === 'landscape' ? 15 : 28;
                        } else if (N > 18) {
                            cellFontSize = '0.48rem';
                            headerHeight = '160px';
                            rowHeightVal = '23px';
                            cellPaddingVal = '1px 0.15rem';
                            nameCellPaddingVal = '1px 0.4rem';
                            pageSize = orientation === 'landscape' ? 16 : 26;
                        } else if (N > 12) {
                            cellFontSize = '0.55rem';
                            headerHeight = '140px';
                            rowHeightVal = '24px';
                            cellPaddingVal = '1px 0.2rem';
                            nameCellPaddingVal = '1px 0.4rem';
                            pageSize = orientation === 'landscape' ? 16 : 24;
                        } else if (N > 8) {
                            cellFontSize = '0.65rem';
                            headerHeight = '130px';
                            rowHeightVal = '25px';
                            cellPaddingVal = '1.5px 0.2rem';
                            nameCellPaddingVal = '1.5px 0.4rem';
                            pageSize = orientation === 'landscape' ? 16 : 22;
                        }

                        sortedTeamIds.forEach(teamId => {
                            const team = cat.teams[teamId];
                            const students = team.students;

                            // Determine gender label from filters or actual students
                            let genderLabel = '';
                            if (f.gender === 'Boys') {
                                genderLabel = ' • BOYS';
                            } else if (f.gender === 'Girls') {
                                genderLabel = ' • GIRLS';
                            } else if (f.gender === 'Mixed') {
                                genderLabel = ' • MIXED';
                            } else {
                                // Detect from students on this team
                                const genders = [...new Set(students.map(s => s.gender).filter(Boolean))];
                                if (genders.length === 1) {
                                    if (genders[0] === 'Male') genderLabel = ' • BOYS';
                                    else if (genders[0] === 'Female') genderLabel = ' • GIRLS';
                                } else if (genders.length > 1) {
                                    genderLabel = ' • MIXED';
                                }
                            }

                            const studentChunks = chunkArray(students, pageSize);

                            studentChunks.forEach((chunk, chunkIdx) => {
                                const pageNum = chunkIdx + 1;
                                const totalPages = studentChunks.length;
                                const pageIndicator = totalPages > 1 ? ` • PAGE ${pageNum}/${totalPages}` : '';

                                htmlContent += `
                                <div class="${pageDivClass}" style="margin-bottom: 2rem; page-break-inside: avoid; break-inside: avoid;">
                                    <div class="report-header" style="display:flex; justify-content:space-between; align-items:flex-end; border-bottom: 2px solid #000; padding-bottom: 0.2rem; margin-bottom: 0.3rem; width: 100%;">
                                        <div>
                                            <div style="font-size: 0.7rem; font-weight: 800; color: #000; letter-spacing: 0.05em; text-transform: uppercase;">
                                                PROGRAM PARTICIPATION REGISTER${pageIndicator}
                                            </div>
                                            <h2 style="margin: 0.1rem 0 0 0; color: #000; font-size: 1.15rem; font-weight: 800; text-transform: uppercase;">
                                                ${window.escapeHTML(cat.name).toUpperCase()} • ${window.escapeHTML(team.name).toUpperCase()}${genderLabel}
                                            </h2>
                                            <div style="font-size: 0.7rem; font-weight: 700; color: #000; margin-top: 0.05rem; text-transform: uppercase;">
                                                ${window.escapeHTML(instName).toUpperCase()}
                                            </div>
                                        </div>
                                        <div style="text-align: right; font-weight: 800; color: #000; line-height: 1.2;">
                                            <div style="font-size: 0.8rem; text-transform: uppercase;">
                                                ${(f.participationType === 'individual' ? 'INDIVIDUAL PROGRAM' : (f.participationType === 'group' ? 'GROUP PROGRAM' : (f.participationType === 'general' ? 'GENERAL PROGRAM' : 'ALL PROGRAM TYPES')))}
                                            </div>
                                            <div style="font-size: 0.72rem; font-weight: 700; text-transform: uppercase;">
                                                STAGE / OFF STAGE
                                            </div>
                                            <div style="font-size: 0.62rem; font-weight: 700; color: #475569; margin-top: 0.05rem;">
                                                TOTAL: ${students.length} STUDENTS
                                            </div>
                                        </div>
                                    </div>

                                    <table class="report-table" style="margin-top: 0.4rem; font-size:${cellFontSize};">
                                        <thead>
                                            <tr>
                                                <th style="width:40px; min-width:40px; max-width:40px; text-align:center; padding:0.25rem 0.2rem; line-height: 1.2; border: 1px solid #000;">SL<br>NO.</th>
                                                <th style="width:60px; min-width:60px; max-width:60px; text-align:center; padding:0.25rem 0.2rem; line-height: 1.2; border: 1px solid #000;">CHEST<br>NO.</th>
                                                <th style="width:180px; min-width:180px; max-width:180px; padding:0.25rem 0.5rem; text-align:left; border: 1px solid #000;">PARTICIPANT NAME</th>
                                                <th style="width:60px; min-width:60px; max-width:60px; padding:0.25rem 0.5rem; text-align:center; border: 1px solid #000;">CLASS</th>
                                                ${columnItems.map(item => {
                                    if (item.type === 'separator') {
                                        return `<th class="program-col-separator" style="width: 12px; min-width: 12px; max-width: 12px; border: 1px solid #000; background: #f1f5f9 !important;"></th>`;
                                    }
                                    const p = item.program;
                                    return `
                                                        <th class="rotated-th program-col" style="height:${headerHeight};">
                                                            <div>${window.escapeHTML(p.programNumber ? `${p.programNumber} – ${p.programName}` : p.programName).toUpperCase()}</div>
                                                        </th>
                                                    `;
                                }).join('')}
                                                <th style="border-left: none; border-right: none; background: #fff !important;"></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${chunk.map((item, idx) => {
                                    const globalIdx = chunkIdx * pageSize + idx;
                                    return `
                                                    <tr style="height:${rowHeightVal}; page-break-inside:avoid;">
                                                        <td style="width:40px; min-width:40px; max-width:40px; text-align:center; font-weight:bold; color:#000; padding:${cellPaddingVal}; border: 1px solid #000;">${globalIdx + 1}</td>
                                                        <td style="width:60px; min-width:60px; max-width:60px; text-align:center; font-weight:bold; color:#000; padding:${cellPaddingVal}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; border: 1px solid #000;" title="${window.escapeHTML(item.chestNumber || '-')}">
                                                            ${window.escapeHTML(item.chestNumber || '-')}
                                                        </td>
                                                        <td style="width:180px; min-width:180px; max-width:180px; font-weight:bold; color:#000; padding:${nameCellPaddingVal}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; border: 1px solid #000;" title="${window.escapeHTML(item.name)}">
                                                            ${window.escapeHTML(item.name).toUpperCase()}
                                                        </td>
                                                        <td style="width:60px; min-width:60px; max-width:60px; font-weight:bold; color:#000; padding:${cellPaddingVal}; text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; border: 1px solid #000;" title="${window.escapeHTML(item.className || '')}">
                                                            ${window.escapeHTML(item.className || item.classId || '').toUpperCase()}
                                                        </td>
                                                        ${columnItems.map(col => {
                                        if (col.type === 'separator') {
                                            return `<td class="program-col-separator" style="width: 12px; min-width: 12px; max-width: 12px; border: 1px solid #000; background: #f1f5f9 !important;"></td>`;
                                        }
                                        const p = col.program;
                                        return `
                                                                <td class="program-col" style="text-align:center; font-weight:bold; font-size:1rem; border:1px solid #000;">
                                                                    ${isRegistered(item.id, p.id) ? '✔' : ''}
                                                                </td>
                                                            `;
                                    }).join('')}
                                                        <td style="border-left: none; border-right: none;"></td>
                                                    </tr>
                                                `;
                                }).join('')}
                                        </tbody>
                                    </table>

                                    <div class="register-footer" style="margin-top: 0.6rem; padding-top: 0.2rem; font-size: 0.72rem;">
                                        <div>COORDINATOR SIGNATURE : ________________________</div>
                                        <div>DATE : ________________________</div>
                                    </div>
                                </div>
                            `;
                            });
                        });
                    });
                } else {
                    // 3. Group students hierarchically by Category -> Class -> Team
                    const groups = {};
                    studentsList.forEach(stu => {
                        const catId = stu.categoryId || 'general';
                        const catName = stu.categoryName || 'General';
                        const classId = stu.classId || 'standard';
                        const className = stu.className || 'Standard';
                        const teamId = stu.teamId || 'no-team';
                        const teamName = teamNamesMap[String(stu.teamId)] || stu.teamName || 'Independent';

                        if (!groups[catId]) {
                            groups[catId] = {
                                name: catName,
                                classes: {}
                            };
                        }
                        if (!groups[catId].classes[classId]) {
                            groups[catId].classes[classId] = {
                                name: className,
                                teams: {}
                            };
                        }
                        if (!groups[catId].classes[classId].teams[teamId]) {
                            groups[catId].classes[classId].teams[teamId] = {
                                name: teamName,
                                students: []
                            };
                        }
                        groups[catId].classes[classId].teams[teamId].students.push(stu);
                    });

                    const sortedCatIds = Object.keys(groups).sort((a, b) => {
                        const idxA = allCategories.findIndex(c => c.id === a);
                        const idxB = allCategories.findIndex(c => c.id === b);
                        return idxA - idxB;
                    });
                    const instName = getEventName();
                    const pageDivClass = isCompact ? 'program-card-compact' : 'program-page-standard';

                    sortedCatIds.forEach(catId => {
                        const cat = groups[catId];
                        const sortedClassIds = Object.keys(cat.classes).sort((a, b) => cat.classes[a].name.localeCompare(cat.classes[b].name, undefined, { numeric: true }));

                        sortedClassIds.forEach(classId => {
                            const cls = cat.classes[classId];
                            const sortedTeamIds = Object.keys(cls.teams).sort((a, b) => cls.teams[a].name.localeCompare(cls.teams[b].name));

                            // Filter matching programs for this specific Category + Class
                            const progs = f.categoryId === 'general_programs' || f.participationType === 'general'
                                ? matchingPrograms.filter(p => !p.classId || p.classId === classId)
                                : matchingPrograms.filter(p => p.categoryId === catId && (!p.classId || p.classId === classId));

                            if (progs.length === 0) {
                                htmlContent += `
                                <div class="${pageDivClass}" style="margin-bottom: 2rem; page-break-inside: avoid; break-inside: avoid;">
                                    <div style="padding: 2rem; text-align: center; border: 1px dashed #cbd5e1; border-radius: 8px;">
                                        <h3>Category: ${window.escapeHTML(cat.name)} · Class: ${window.escapeHTML(cls.name)}</h3>
                                        <p style="color:#64748b;">No registered programs for this Category + Class combination.</p>
                                    </div>
                                </div>
                            `;
                                return;
                            }

                            const columnItems = buildColumnItems(progs);
                            const N = columnItems.length;
                            let cellFontSize = '0.75rem';
                            let headerHeight = '120px';
                            let rowHeightVal = '26px';
                            let cellPaddingVal = '2px 0.2rem';
                            let nameCellPaddingVal = '2px 0.5rem';
                            let pageSize = orientation === 'landscape' ? 16 : 20;

                            if (N > 25) {
                                cellFontSize = '0.42rem';
                                headerHeight = '180px';
                                rowHeightVal = '22px';
                                cellPaddingVal = '1px 0.1rem';
                                nameCellPaddingVal = '1px 0.3rem';
                                pageSize = orientation === 'landscape' ? 15 : 28;
                            } else if (N > 18) {
                                cellFontSize = '0.48rem';
                                headerHeight = '160px';
                                rowHeightVal = '23px';
                                cellPaddingVal = '1px 0.15rem';
                                nameCellPaddingVal = '1px 0.4rem';
                                pageSize = orientation === 'landscape' ? 16 : 26;
                            } else if (N > 12) {
                                cellFontSize = '0.55rem';
                                headerHeight = '140px';
                                rowHeightVal = '24px';
                                cellPaddingVal = '1px 0.2rem';
                                nameCellPaddingVal = '1px 0.4rem';
                                pageSize = orientation === 'landscape' ? 16 : 24;
                            } else if (N > 8) {
                                cellFontSize = '0.65rem';
                                headerHeight = '130px';
                                rowHeightVal = '25px';
                                cellPaddingVal = '1.5px 0.2rem';
                                nameCellPaddingVal = '1.5px 0.4rem';
                                pageSize = orientation === 'landscape' ? 16 : 22;
                            }

                            sortedTeamIds.forEach(teamId => {
                                const team = cls.teams[teamId];
                                const students = team.students;

                                // Determine gender label from filters or actual students
                                let genderLabel = '';
                                if (f.gender === 'Boys') {
                                    genderLabel = ' • BOYS';
                                } else if (f.gender === 'Girls') {
                                    genderLabel = ' • GIRLS';
                                } else if (f.gender === 'Mixed') {
                                    genderLabel = ' • MIXED';
                                } else {
                                    // Detect from students on this team
                                    const genders = [...new Set(students.map(s => s.gender).filter(Boolean))];
                                    if (genders.length === 1) {
                                        if (genders[0] === 'Male') genderLabel = ' • BOYS';
                                        else if (genders[0] === 'Female') genderLabel = ' • GIRLS';
                                    } else if (genders.length > 1) {
                                        genderLabel = ' • MIXED';
                                    }
                                }

                                const studentChunks = chunkArray(students, pageSize);

                                studentChunks.forEach((chunk, chunkIdx) => {
                                    const pageNum = chunkIdx + 1;
                                    const totalPages = studentChunks.length;
                                    const pageIndicator = totalPages > 1 ? ` • PAGE ${pageNum}/${totalPages}` : '';

                                    htmlContent += `
                                    <div class="${pageDivClass}" style="margin-bottom: 2rem; page-break-inside: avoid; break-inside: avoid;">
                                        <div class="report-header" style="display:flex; justify-content:space-between; align-items:flex-end; border-bottom: 2px solid #000; padding-bottom: 0.2rem; margin-bottom: 0.3rem; width: 100%;">
                                            <div>
                                                <div style="font-size: 0.7rem; font-weight: 800; color: #000; letter-spacing: 0.05em; text-transform: uppercase;">
                                                    PROGRAM PARTICIPATION REGISTER${pageIndicator}
                                                </div>
                                                <h2 style="margin: 0.1rem 0 0 0; color: #000; font-size: 1.15rem; font-weight: 800; text-transform: uppercase;">
                                                    ${window.escapeHTML(cat.name).toUpperCase()} • ${window.escapeHTML(cls.name).toUpperCase()}${genderLabel}
                                                </h2>
                                                <div style="font-size: 0.7rem; font-weight: 700; color: #000; margin-top: 0.05rem; text-transform: uppercase;">
                                                    ${window.escapeHTML(instName).toUpperCase()} • ${window.escapeHTML(team.name).toUpperCase()}
                                                </div>
                                            </div>
                                            <div style="text-align: right; font-weight: 800; color: #000; line-height: 1.2;">
                                                <div style="font-size: 0.8rem; text-transform: uppercase;">
                                                    ${(f.participationType === 'individual' ? 'INDIVIDUAL PROGRAM' : (f.participationType === 'group' ? 'GROUP PROGRAM' : (f.participationType === 'general' ? 'GENERAL PROGRAM' : 'ALL PROGRAM TYPES')))}
                                                </div>
                                                <div style="font-size: 0.72rem; font-weight: 700; text-transform: uppercase;">
                                                    STAGE / OFF STAGE
                                                </div>
                                                <div style="font-size: 0.62rem; font-weight: 700; color: #475569; margin-top: 0.05rem;">
                                                    TOTAL: ${students.length} STUDENTS
                                                </div>
                                            </div>
                                        </div>

                                        <table class="report-table" style="margin-top: 0.4rem; font-size:${cellFontSize};">
                                            <thead>
                                                <tr>
                                                    <th style="width:40px; min-width:40px; max-width:40px; text-align:center; padding:0.25rem 0.2rem; line-height: 1.2; border: 1px solid #000;">SL<br>NO.</th>
                                                    <th style="width:60px; min-width:60px; max-width:60px; text-align:center; padding:0.25rem 0.2rem; line-height: 1.2; border: 1px solid #000;">CHEST<br>NO.</th>
                                                    <th style="width:180px; min-width:180px; max-width:180px; padding:0.25rem 0.5rem; text-align:left; border: 1px solid #000;">PARTICIPANT NAME</th>
                                                    ${columnItems.map(item => {
                                        if (item.type === 'separator') {
                                            return `<th class="program-col-separator" style="width: 12px; min-width: 12px; max-width: 12px; border: 1px solid #000; background: #f1f5f9 !important;"></th>`;
                                        }
                                        const p = item.program;
                                        return `
                                                            <th class="rotated-th program-col" style="height:${headerHeight};">
                                                                <div>${window.escapeHTML(p.programNumber ? `${p.programNumber} – ${p.programName}` : p.programName).toUpperCase()}</div>
                                                            </th>
                                                        `;
                                    }).join('')}
                                                    <th style="border-left: none; border-right: none; background: #fff !important;"></th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                ${chunk.map((item, idx) => {
                                        const globalIdx = chunkIdx * pageSize + idx;
                                        return `
                                                        <tr style="height:${rowHeightVal}; page-break-inside:avoid;">
                                                            <td style="width:40px; min-width:40px; max-width:40px; text-align:center; font-weight:bold; color:#000; padding:${cellPaddingVal}; border: 1px solid #000;">${globalIdx + 1}</td>
                                                            <td style="width:60px; min-width:60px; max-width:60px; text-align:center; font-weight:bold; color:#000; padding:${cellPaddingVal}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; border: 1px solid #000;" title="${window.escapeHTML(item.chestNumber || '-')}">
                                                                ${window.escapeHTML(item.chestNumber || '-')}
                                                            </td>
                                                            <td style="width:180px; min-width:180px; max-width:180px; font-weight:bold; color:#000; padding:${nameCellPaddingVal}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; border: 1px solid #000;" title="${window.escapeHTML(item.name)}">
                                                                ${window.escapeHTML(item.name).toUpperCase()}
                                                            </td>
                                                            ${columnItems.map(col => {
                                            if (col.type === 'separator') {
                                                return `<td class="program-col-separator" style="width: 12px; min-width: 12px; max-width: 12px; border: 1px solid #000; background: #f1f5f9 !important;"></td>`;
                                            }
                                            const p = col.program;
                                            return `
                                                                    <td class="program-col" style="text-align:center; font-weight:bold; font-size:1rem; border:1px solid #000;">
                                                                        ${isRegistered(item.id, p.id) ? '✔' : ''}
                                                                    </td>
                                                                `;
                                        }).join('')}
                                                            <td style="border-left: none; border-right: none;"></td>
                                                        </tr>
                                                    `;
                                    }).join('')}
                                            </tbody>
                                        </table>

                                        <div class="register-footer" style="margin-top: 0.6rem; padding-top: 0.2rem; font-size: 0.72rem;">
                                            <div>COORDINATOR SIGNATURE : ________________________</div>
                                            <div>DATE : ________________________</div>
                                        </div>
                                    </div>
                                `;
                                });
                            });
                        });
                    });
                }
            }
        }

        // Render PDF through iframe
        const printIframe = getPrintIframe();
        const doc = printIframe.contentDocument || printIframe.contentWindow.document;
        const pageMargin = '8mm';

        const styleBlock = `
            <style>
                @page {
                    size: A4 ${orientation};
                    margin: 0;
                }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                    color: #000;
                    margin: 0;
                    padding: ${pageMargin};
                    box-sizing: border-box;
                    background: #fff;
                    font-size: 0.85rem;
                    line-height: 1.4;
                }
                h2, h3, h4 {
                    margin: 0;
                    color: #000;
                }
                .report-table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 0.4rem;
                    border: 2px solid #000;
                }
                .report-table th, .report-table td {
                    border: 1px solid #000;
                }
                .program-col {
                    width: 32px !important;
                    min-width: 32px !important;
                    max-width: 32px !important;
                    text-align: center;
                    padding: 0 !important;
                    box-sizing: border-box;
                    border: 1px solid #000 !important;
                }
                .report-table th {
                    background-color: #fff !important;
                    color: #000;
                    font-weight: bold;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                }
                .report-table tr {
                    page-break-inside: avoid;
                    break-inside: avoid;
                }
                .program-card-compact {
                    padding: 0;
                    margin-bottom: 2rem;
                    page-break-inside: avoid;
                    break-inside: avoid;
                    background: #fff;
                    display: flex;
                    flex-direction: column;
                    justify-content: space-between;
                }
                .program-page-standard {
                    padding: 0;
                    width: 100%;
                    height: 100%;
                    min-height: ${orientation === 'landscape' ? '184mm' : '262mm'}; /* Adjusted for 8mm margins */
                    display: flex;
                    flex-direction: column;
                    justify-content: space-between;
                    page-break-after: always;
                    break-after: page;
                    background: #fff;
                }
                .program-page-standard:last-child {
                    page-break-after: avoid;
                    break-after: page-inside;
                }
                .program-category-list-page {
                    padding: 0;
                    width: 100%;
                    box-sizing: border-box;
                    background: #fff;
                    display: block;
                    page-break-after: always;
                    break-after: page;
                }
                .program-category-list-page:last-child {
                    page-break-after: avoid;
                    break-after: avoid;
                }
                .rotated-th {
                    vertical-align: middle;
                    text-align: center;
                    padding: 0.5rem 0.15rem;
                    font-weight: bold;
                    border: 1px solid #000;
                    box-sizing: border-box;
                }
                .rotated-th > div {
                    writing-mode: vertical-rl;
                    transform: rotate(180deg);
                    white-space: nowrap;
                    text-align: center;
                    margin: 0 auto;
                    width: 14px;
                    box-sizing: border-box;
                }
                .register-footer {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    font-size: 0.72rem;
                    font-weight: bold;
                    color: #000;
                    margin-top: 0.6rem;
                    padding-top: 0.2rem;
                }
            </style>
        `;

        doc.open();
        doc.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>${window.escapeHTML(exp.fileName)}</title>
                ${styleBlock}
            </head>
            <body>
                <div style="max-width:100%; margin: 0 auto; box-sizing:border-box;">
                    ${htmlContent}
                </div>
            </body>
            </html>
        `);
        doc.close();

        if (isDownload) {
            setTimeout(async () => {
                try {
                    window.showToast("Preparing PDF download...", "info");

                    const prevWidth = printIframe.style.width;
                    const prevHeight = printIframe.style.height;

                    if (orientation === 'landscape') {
                        printIframe.style.width = '1123px';
                    } else {
                        printIframe.style.width = '794px';
                    }
                    printIframe.style.height = 'auto';
                    await new Promise(resolve => setTimeout(resolve, 150));

                    const scrollHeight = Math.max(
                        doc.body.scrollHeight,
                        doc.documentElement.scrollHeight,
                        doc.body.offsetHeight,
                        doc.documentElement.offsetHeight
                    );
                    printIframe.style.height = (scrollHeight + 100) + 'px';
                    await new Promise(resolve => setTimeout(resolve, 50));

                    const html2pdf = await loadHtml2Pdf();
                    const opt = {
                        margin: 10,
                        filename: exp.fileName || 'export.pdf',
                        image: { type: 'jpeg', quality: 0.98 },
                        html2canvas: { scale: 1.5, useCORS: true, logging: false, scrollX: 0, scrollY: 0 },
                        jsPDF: { unit: 'mm', format: 'a4', orientation: orientation },
                        pagebreak: { mode: ['css', 'legacy'] }
                    };
                    const element = doc.body;
                    await html2pdf().set(opt).from(element).save();

                    printIframe.style.width = prevWidth;
                    printIframe.style.height = prevHeight;
                } catch (err) {
                    console.error("PDF generation failed, falling back to print dialog:", err);
                    printIframe.contentWindow.focus();
                    printIframe.contentWindow.print();
                }
            }, 500);
        } else {
            setTimeout(() => {
                printIframe.contentWindow.focus();
                printIframe.contentWindow.print();
            }, 300);
        }
        return;
    }

    const isCompact = f.compactPacking !== false; // compact layout true by default

    // Phase 5 to 11: Dynamic, Participant-Aware Evaluation Card Renderer
    const renderValuationCard = (p, partsSlice, isTall = false, gridStyle = '', pageNum = null, totalPages = null) => {
        const totalCount = partsSlice.length;

        const progName = p.programName || '';
        let titleFontSize = '0.95rem';
        if (progName.length > 35) {
            titleFontSize = '0.74rem';
        } else if (progName.length > 20) {
            titleFontSize = '0.82rem';
        }

        // Density level configuration based on participant count (0-8, 9-12, 13-15, 16+)
        let rowHeight = '23px';
        let fontSize = '0.65rem';
        let padding = '0.2rem 0.35rem';
        let remarksHeight = '90px';
        let headerMarginBottom = '0.25rem';
        let metadataPadding = '0.15rem 0.3rem';
        let tableMarginTop = '0.25rem';
        let footerMarginTop = '0.3rem';
        let footerPaddingTop = '0.25rem';

        if (isTall) {
            // Comfortable density for tall vertical cards
            if (totalCount > 35) {
                rowHeight = '15.5px';
                fontSize = '0.54rem';
                padding = '0.05rem 0.15rem';
                remarksHeight = '25px';
                headerMarginBottom = '0.08rem';
                metadataPadding = '0.04rem 0.15rem';
                tableMarginTop = '0.08rem';
                footerMarginTop = '0.08rem';
                footerPaddingTop = '0.08rem';
            } else {
                rowHeight = '19.5px';
                fontSize = '0.62rem';
                padding = '0.12rem 0.25rem';
                remarksHeight = '65px';
                headerMarginBottom = '0.15rem';
                metadataPadding = '0.1rem 0.2rem';
                tableMarginTop = '0.15rem';
                footerMarginTop = '0.2rem';
                footerPaddingTop = '0.15rem';
            }
        } else {
            // Standard card constraints
            if (totalCount >= 16) {
                // Ultra-compact mode (16+ entries)
                rowHeight = '14.5px';
                fontSize = '0.52rem';
                padding = '0.04rem 0.15rem';
                remarksHeight = '12px';
                headerMarginBottom = '0.04rem';
                metadataPadding = '0.02rem 0.1rem';
                tableMarginTop = '0.04rem';
                footerMarginTop = '0.04rem';
                footerPaddingTop = '0.04rem';
            } else if (totalCount >= 13) {
                // Dense mode (13-15 entries)
                rowHeight = '17px';
                fontSize = '0.58rem';
                padding = '0.08rem 0.2rem';
                remarksHeight = '25px';
                headerMarginBottom = '0.08rem';
                metadataPadding = '0.04rem 0.15rem';
                tableMarginTop = '0.08rem';
                footerMarginTop = '0.08rem';
                footerPaddingTop = '0.08rem';
            } else if (totalCount >= 9) {
                // Compact density (9-12 entries)
                rowHeight = '19.5px';
                fontSize = '0.62rem';
                padding = '0.12rem 0.25rem';
                remarksHeight = '45px';
                headerMarginBottom = '0.15rem';
                metadataPadding = '0.1rem 0.2rem';
                tableMarginTop = '0.15rem';
                footerMarginTop = '0.2rem';
                footerPaddingTop = '0.15rem';
            }
        }

        const rowsHtml = partsSlice.map((item, idx) => {
            const sl = pageNum ? (pageNum - 1) * 30 + idx + 1 : idx + 1;
            const chestNo = item.chestNumber || '—';
            return `
                <tr style="height: ${rowHeight}; font-size: ${fontSize};">
                    <td style="text-align:center; font-weight:800; color:#475569; padding: ${padding};">${sl}</td>
                    <td style="text-align:center; font-weight:800; color:#475569; padding: ${padding};">${window.escapeHTML(chestNo)}</td>
                    <td style="padding: ${padding};"></td>
                    <td style="padding: ${padding};"></td>
                    <td style="padding: ${padding};"></td>
                </tr>
            `;
        }).join('');

        const pageIndicator = pageNum && totalPages && totalPages > 1 ?
            `<span style="font-size:0.6rem; font-weight:800; color:#dc2626; background:#fee2e2; padding:0.1rem 0.4rem; border-radius:4px; border:1px solid #fecaca; text-transform:uppercase;">Page ${pageNum} of ${totalPages}</span>` : '';

        return `
            <div class="val-card" style="${gridStyle}">
                <!-- Header Group at the Top (Phase 2) -->
                <div class="val-card-header" style="margin-bottom: ${headerMarginBottom}; width:100%; box-sizing:border-box;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; width:100%;">
                        <div style="flex:1;">
                            <div style="display:flex; justify-content:space-between; align-items:center; width:100%; box-sizing:border-box;">
                                <span style="font-size:0.55rem; font-weight:900; color:#4338ca; text-transform:uppercase; letter-spacing:0.04em;">📝 JUDGES EVALUATION CARD</span>
                                ${pageIndicator}
                            </div>
                            <h3 style="margin: 0.1rem 0 0 0; font-size:${titleFontSize}; font-weight:900; color:#1e1b4b; line-height:1.2; word-break:break-word;" title="${window.escapeHTML(p.programName)}">
                                ${p.programNumber ? `[#${p.programNumber}] ` : ''}${window.escapeHTML(p.programName)}
                            </h3>
                            <div style="font-size:0.72rem; font-weight:800; color:#4338ca; margin-top:0.05rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:230px;">
                                Category: ${window.escapeHTML(formatLabel(p.categoryName))} ${p.className ? `· Class: ${window.escapeHTML(formatLabel(p.className))}` : ''}
                            </div>
                        </div>
                    </div>
                    
                    <!-- High-Density Metadata Ribbon (Program Type, Gender, Stage / Location) -->
                    <div class="val-metadata-grid" style="display:flex; gap:0.4rem; font-size:0.6rem; color:#475569; background:#f1f5f9; padding:${metadataPadding}; border-radius:4px; margin-top:${headerMarginBottom}; font-weight:700; border:1px solid #cbd5e1; box-sizing:border-box;">
                        <span style="flex:1;"><strong>Type:</strong> ${window.escapeHTML(formatLabel(p.type))}</span>
                        <span style="flex:1; text-align:center; border-left:1px solid #cbd5e1; border-right:1px solid #cbd5e1;"><strong>Gender:</strong> ${window.escapeHTML(formatLabel(p.genderCategory))}</span>
                        <span style="flex:1; text-align:right;"><strong>Location:</strong> ${window.escapeHTML(formatLabel(p.programLocation))}</span>
                    </div>
                </div>
                
                <!-- Valuation Scoring Table starts immediately below headers (Phase 2 & 11) -->
                <div class="val-card-body" style="width:100%; box-sizing:border-box; margin-top:${tableMarginTop};">
                    <table class="val-card-table">
                        <thead>
                            <tr>
                                <th style="width:30px; text-align:center; padding:0.15rem; font-size:0.65rem;">SL</th>
                                <th style="width:45px; text-align:center; padding:0.15rem; font-size:0.65rem;">Chest No</th>
                                <th style="width:75px; text-align:center; padding:0.15rem; font-size:0.65rem;">Code</th>
                                <th style="width:85px; text-align:center; padding:0.15rem; font-size:0.65rem;">Marks (0-100)</th>
                                <th style="padding:0.15rem; font-size:0.65rem;">Remarks</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml || `<tr><td colspan="5" style="text-align:center; padding:0.5rem; color:#64748b; font-size:0.65rem;">No registered participants.</td></tr>`}
                        </tbody>
                    </table>
                </div>
                
                <!-- Flex-Growable Notes Area for Judge Remarks (Phase 3) -->
                <div class="val-notes-area" style="min-height: ${remarksHeight}; flex:1; border:1px dashed #cbd5e1; border-radius:6px; margin-top:${footerMarginTop}; padding:0.4rem; font-size:0.65rem; color:#94a3b8; box-sizing:border-box; display:flex; flex-direction:column; justify-content:flex-start;">
                    <span style="font-weight:800; color:#475569; display:block; margin-bottom:0.1rem; font-size:0.6rem;">JUDGE REMARKS / OBSERVATIONS / CALCULATIONS:</span>
                </div>
                
                <!-- Fixed Judge Footer Pinned to Absolute Bottom (Phase 4) -->
                <div class="val-judge-row" style="display:flex; justify-content:space-between; align-items:center; font-size:0.65rem; color:#1e293b; margin-top:${footerMarginTop}; border-top:1.5px solid #475569; padding-top:${footerPaddingTop}; font-weight:800; width:100%; box-sizing:border-box;">
                    <span>Judge Name: _________________</span>
                    <span>Signature: _________________</span>
                </div>
            </div>
        `;
    };

    if (f.type === 'Green Room Sign') {
        // Phase 3 Sorting: category, programName
        programs.sort((a, b) => {
            const catCmp = (a.categoryName || '').localeCompare(b.categoryName || '');
            if (catCmp !== 0) return catCmp;
            return (a.programName || '').localeCompare(b.programName || '');
        });

        programs.forEach((p, index) => {
            const parts = participantsMap[p.id] || [];

            // Sort participants by chestNumber
            parts.sort((a, b) => {
                const chestA = a.chestNumber || '';
                const chestB = b.chestNumber || '';
                return chestA.localeCompare(chestB, undefined, { numeric: true, sensitivity: 'base' });
            });

            // Compact vs Standard Page Break logic
            const pageDivClass = isCompact ? 'program-card-compact' : 'program-page-standard';

            htmlContent += `
                <div class="${pageDivClass}">
                    <div class="report-header-green" style="border-bottom:2px solid #000; padding-bottom:0.35rem; margin-bottom:0.6rem; width:100%;">
                        <div style="font-size:0.75rem; font-weight:800; color:#555; text-transform:uppercase; letter-spacing:0.05em;">GREEN ROOM SIGN-IN</div>
                        <h2 style="margin:0.15rem 0; color:#000; font-size:1.2rem; font-weight:800; text-transform:uppercase;">${p.programNumber ? `[#${p.programNumber}] ` : ''}${window.escapeHTML(p.programName)}</h2>
                        <div style="font-size:0.7rem; font-weight:700; color:#666; text-transform:uppercase;">
                            ${window.escapeHTML(p.categoryName)}${p.className ? ` • ${window.escapeHTML(p.className)}` : ''} • 
                            ${window.escapeHTML(formatLabel(p.genderCategory || p.gender || 'Mixed'))} • 
                            ${window.escapeHTML((p.programLocation || p.location || 'Stage').toUpperCase())} • 
                            ${p.programType === 'group' ? 'GROUP EVENT' : 'INDIVIDUAL EVENT'} • 
                            ${parts.length} ${p.programType === 'group' ? 'GROUPS' : 'ENTRIES'}
                        </div>
                    </div>

                    <table class="report-table" style="margin-top: 0.4rem; width:100%;">
                        <thead>
                            <tr>
                                <th style="width:40px; text-align:center; border: 1px solid #000;">SL</th>
                                <th style="width:90px; text-align:center; border: 1px solid #000;">CHEST NO</th>
                                <th style="border: 1px solid #000;">PARTICIPANT / TEAM NAME</th>
                                <th style="width:90px; text-align:center; border: 1px solid #000;">CODE LETTER</th>
                                <th style="width:150px; text-align:center; border: 1px solid #000;">SIGNATURE</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${parts.length === 0 ? `<tr><td colspan="5" style="text-align:center; padding:1rem; color:#666; border: 1px solid #000;">No registered entries.</td></tr>` :
                    parts.map((item, idx) => `
                                <tr style="height:28px; page-break-inside:avoid;">
                                    <td style="text-align:center; font-weight:700; color:#000; border: 1px solid #000;">${idx + 1}</td>
                                    <td style="text-align:center; font-weight:800; color:#000; border: 1px solid #000;">${window.escapeHTML(item.chestNumber || '—')}</td>
                                    <td style="font-weight:700; color:#000; border: 1px solid #000;">${window.escapeHTML(item.name).toUpperCase()}</td>
                                    <td style="border: 1px solid #000;"></td>
                                    <td style="border: 1px solid #000;"></td>
                                </tr>
                              `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        });
    }

    else if (f.type === 'Valuation Sheet') {
        // Sort programs alphabetically
        programs.sort((a, b) => (a.programName || '').localeCompare(b.programName || ''));

        // Packing programs into pages with 4 slots (2x2 grid)
        const pagesList = []; // array of { slots: [null, null, null, null], cards: [] }

        programs.forEach(p => {
            const parts = participantsMap[p.id] || [];
            const count = parts.length;
            const isTall = count > 20;

            let placed = false;

            // Search for an existing page that can fit this card
            for (let page of pagesList) {
                if (isTall) {
                    // Needs a column fully empty: Left (slots 0 and 2) or Right (slots 1 and 3)
                    if (page.slots[0] === null && page.slots[2] === null) {
                        page.slots[0] = p.id;
                        page.slots[2] = p.id;
                        page.cards.push({ p, parts, isTall: true, gridStyle: 'grid-row: 1 / span 2; grid-column: 1;' });
                        placed = true;
                        break;
                    } else if (page.slots[1] === null && page.slots[3] === null) {
                        page.slots[1] = p.id;
                        page.slots[3] = p.id;
                        page.cards.push({ p, parts, isTall: true, gridStyle: 'grid-row: 1 / span 2; grid-column: 2;' });
                        placed = true;
                        break;
                    }
                } else {
                    // Normal card: fits in any single empty slot
                    for (let slotIdx = 0; slotIdx < 4; slotIdx++) {
                        if (page.slots[slotIdx] === null) {
                            page.slots[slotIdx] = p.id;
                            let gridStyle = '';
                            if (slotIdx === 0) gridStyle = 'grid-row: 1; grid-column: 1;';
                            else if (slotIdx === 1) gridStyle = 'grid-row: 1; grid-column: 2;';
                            else if (slotIdx === 2) gridStyle = 'grid-row: 2; grid-column: 1;';
                            else if (slotIdx === 3) gridStyle = 'grid-row: 2; grid-column: 2;';

                            page.cards.push({ p, parts, isTall: false, gridStyle });
                            placed = true;
                            break;
                        }
                    }
                    if (placed) break;
                }
            }

            // Create new page if not placed
            if (!placed) {
                const newPage = { slots: [null, null, null, null], cards: [] };
                if (isTall) {
                    newPage.slots[0] = p.id;
                    newPage.slots[2] = p.id;
                    newPage.cards.push({ p, parts, isTall: true, gridStyle: 'grid-row: 1 / span 2; grid-column: 1;' });
                } else {
                    newPage.slots[0] = p.id;
                    newPage.cards.push({ p, parts, isTall: false, gridStyle: 'grid-row: 1; grid-column: 1;' });
                }
                pagesList.push(newPage);
            }
        });

        // Generate pages HTML
        pagesList.forEach(page => {
            htmlContent += `
                <div class="valuation-grid-sheet-2x2">
                    ${page.cards.map(item => renderValuationCard(item.p, item.parts, item.isTall, item.gridStyle)).join('')}
                </div>
            `;
        });

        // 5. Append SaaS dynamic Print Audit & Operations Report (Phase 14)
        let auditRowsHtml = '';
        let totalPageCount = pagesList.length;

        const buildAuditRow = (p, count, mode, pageWeight, compression, overflow) => {
            return `
                <tr style="height:25px;">
                    <td style="font-weight:700; padding:0.35rem 0.5rem;">${window.escapeHTML(p.programName)}</td>
                    <td style="text-align:center; font-weight:800; padding:0.35rem 0.5rem;">${count}</td>
                    <td style="text-align:center; font-weight:700; color:#4338ca; padding:0.35rem 0.5rem;">${mode}</td>
                    <td style="text-align:center; font-weight:800; padding:0.35rem 0.5rem;">${pageWeight} sheet(s)</td>
                    <td style="text-align:center; padding:0.35rem 0.5rem;">${compression}</td>
                    <td style="text-align:center; font-weight:700; color:${overflow !== 'None' ? '#dc2626' : '#475569'}; padding:0.35rem 0.5rem;">${overflow}</td>
                </tr>
            `;
        };

        pagesList.forEach(page => {
            page.cards.forEach(item => {
                const count = item.parts.length;
                let compression = "None (Standard 23px)";
                let mode = "4 Cards / A4 (2x2 Grid)";
                let pageWeight = "0.25";

                if (item.isTall) {
                    mode = "Tall Vertical Card (span 2)";
                    pageWeight = "0.50";
                    if (count > 35) {
                        compression = "Compact (15.5px)";
                    } else {
                        compression = "Comfortable (19.5px)";
                    }
                } else {
                    if (count >= 16) {
                        compression = "Ultra-compact (14.5px)";
                    } else if (count >= 13) {
                        compression = "Dense (17px)";
                    } else if (count >= 9) {
                        compression = "Compact (19.5px)";
                    }
                }

                auditRowsHtml += buildAuditRow(item.p, count, mode, pageWeight, compression, "None");
            });
        });

        htmlContent += `
            <div class="program-page-standard" style="page-break-before: always; padding: 15px; box-sizing: border-box; width:100%;">
                <div style="text-align:center; border-bottom:3px double #4338ca; padding-bottom:0.75rem; margin-bottom:1.5rem; width:100%;">
                    <span style="font-size:0.75rem; font-weight:900; color:#4338ca; letter-spacing:0.12em; text-transform:uppercase;">📊 TOURNAMENT QUALITY METRICS</span>
                    <h1 style="color:#1e1b4b; margin:0.25rem 0 0 0; font-size:1.6rem; font-weight:900;">VALUATION SHEET PRINT AUDIT REPORT</h1>
                </div>
                
                <div style="display:flex; gap:1.25rem; margin-bottom:1.5rem; width:100%;">
                    <div style="flex:1; background:#f1f5f9; border:1px solid #cbd5e1; padding:0.75rem; border-radius:8px; text-align:center;">
                        <span style="font-size:0.65rem; font-weight:800; color:#64748b; text-transform:uppercase; display:block;">Total Programs</span>
                        <span style="font-weight:900; font-size:1.4rem; color:#1e1b4b;">${programs.length}</span>
                    </div>
                    <div style="flex:1; background:#f0fdf4; border:1px solid #bbf7d0; padding:0.75rem; border-radius:8px; text-align:center;">
                        <span style="font-size:0.65rem; font-weight:800; color:#15803d; text-transform:uppercase; display:block;">Total Printed A4 Sheets</span>
                        <span style="font-weight:900; font-size:1.4rem; color:#15803d;">${totalPageCount} Sheets</span>
                    </div>
                    <div style="flex:1; background:#eff6ff; border:1px solid #93c5fd; padding:0.75rem; border-radius:8px; text-align:center;">
                        <span style="font-size:0.65rem; font-weight:800; color:#1d4ed8; text-transform:uppercase; display:block;">Est. Paper Savings</span>
                        <span style="font-weight:900; font-size:1.4rem; color:#1d4ed8;">${programs.length - totalPageCount > 0 ? `${programs.length - totalPageCount} Sheets Saved` : 'Highly Optimized'}</span>
                    </div>
                </div>

                <table class="report-table" style="font-size:0.75rem; width:100%; border-collapse:collapse;">
                    <thead>
                        <tr style="background:#f8fafc; border-bottom:2px solid #cbd5e1;">
                            <th style="padding:0.4rem 0.5rem; text-align:left;">Program Name</th>
                            <th style="width:80px; text-align:center; padding:0.4rem 0.5rem;">Entries</th>
                            <th style="width:160px; text-align:center; padding:0.4rem 0.5rem;">Adaptive Layout Mode</th>
                            <th style="width:110px; text-align:center; padding:0.4rem 0.5rem;">A4 Page Weight</th>
                            <th style="width:140px; text-align:center; padding:0.4rem 0.5rem;">Row Compression</th>
                            <th style="width:140px; text-align:center; padding:0.4rem 0.5rem;">Overflow Handling</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${auditRowsHtml}
                    </tbody>
                </table>
            </div>
        `;
    }

    else if (f.type === 'Call List') {
        const teamNamesMap = {};
        allTeams.forEach(t => { if (t.id) teamNamesMap[String(t.id)] = t.name; });

        // Sort programs strictly by Program Number in ascending numerical/natural order
        programs.sort((a, b) => {
            return String(a.programNumber || '').localeCompare(String(b.programNumber || ''), undefined, { numeric: true, sensitivity: 'base' });
        });

        programs.forEach(p => {
            const parts = participantsMap[p.id] || [];
            const pType = (p.programType || '').toLowerCase();
            const pageDivClass = isCompact ? 'program-card-compact' : 'program-page-standard';

            let bodyHtml = '';

            if (pType === 'general' || pType === 'group') {
                const tableHeaderHtml = `
                    <tr>
                        <th style="width:35px; text-align:center;">SL</th>
                        <th style="width:115px;">Chest Numbers</th>
                        <th>Student Names</th>
                        <th style="width:130px;">Group Name</th>
                        <th style="width:90px;">Team</th>
                    </tr>
                `;

                let tableBodyHtml = '';

                const hasGroups = parts.some(item => item.isGroup);

                if (pType === 'general' && !hasGroups) {
                    // Group actual participants by team for General Programs with individual registrations (1 row per team)
                    const teamsMap = {};
                    parts.forEach(item => {
                        let tName = 'General';
                        if (item.teamId) {
                            const matchedName = teamNamesMap[String(item.teamId)];
                            tName = matchedName || item.teamName || 'General';
                        } else if (item.teamName) {
                            tName = item.teamName;
                        }

                        if (!teamsMap[tName]) teamsMap[tName] = [];
                        teamsMap[tName].push(item);
                    });

                    const teamNames = Object.keys(teamsMap).sort();

                    tableBodyHtml = teamNames.length === 0 ? `
                        <tr>
                            <td colspan="5" style="text-align:center; padding:0.5rem; color:#64748b;">No registered entries.</td>
                        </tr>
                    ` : teamNames.map((tName, idx) => {
                        const teamParts = teamsMap[tName];
                        // Sort and de-duplicate chest numbers numerically
                        const chestNumbers = [...new Set(teamParts.map(item => item.chestNumber).filter(Boolean))]
                            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
                            .join(', ');

                        const studentNamesList = teamParts.map(item => item.name).filter(Boolean);
                        const studentNamesHtml = studentNamesList.length > 0
                            ? `<div class="call-student-list" style="display:flex; flex-direction:column; gap:0.05rem;">` +
                            studentNamesList.map((n, sIdx) => `
                                <div class="call-student-item" style="display:flex; align-items:flex-start; padding:0.1rem 0; ${sIdx < studentNamesList.length - 1 ? 'border-bottom:1px solid #f1f5f9;' : ''}">
                                    <span class="call-student-num" style="display:inline-block; min-width:18px; font-size:0.72rem; font-weight:700; color:#475569; background:none; border:none; border-radius:0; margin-right:0.35rem; flex-shrink:0; line-height:1.25;">${sIdx + 1}.</span>
                                    <span class="call-student-name" style="flex:1; font-size:0.72rem; font-weight:700; color:#1e1b4b; word-break:break-word; white-space:normal; line-height:1.25;">${window.escapeHTML(n)}</span>
                                </div>
                              `).join('') +
                            `</div>`
                            : '—';

                        return `
                            <tr style="page-break-inside:avoid; vertical-align:middle;">
                                <td style="text-align:center; font-weight:800; color:#64748b; padding:0.25rem 0.35rem;">${idx + 1}</td>
                                <td style="font-weight:800; color:#1e1b4b; word-break:break-word; white-space:normal; padding:0.25rem 0.35rem; letter-spacing:0.02em;">
                                    ${window.escapeHTML(chestNumbers || '—')}
                                </td>
                                <td style="font-size:0.72rem; font-weight:600; color:#334155; word-break:break-word; white-space:normal; padding:0.25rem 0.35rem; line-height:1.25;">
                                    ${studentNamesHtml}
                                </td>
                                <td style="font-weight:800; color:#475569; padding:0.25rem 0.35rem;">${window.escapeHTML(tName)} Participants</td>
                                <td style="padding:0.25rem 0.35rem;">
                                    <span class="call-team-badge">${window.escapeHTML(tName)}</span>
                                </td>
                            </tr>
                        `;
                    }).join('');
                } else {
                    // Group Programs OR General Programs with group registrations (render actual group name!)
                    tableBodyHtml = parts.length === 0 ? `
                        <tr>
                            <td colspan="5" style="text-align:center; padding:0.5rem; color:#64748b;">No registered entries.</td>
                        </tr>
                    ` : parts.map((groupItem, idx) => {
                        // Sort and de-duplicate chest numbers numerically
                        const chestNumbers = [...new Set((groupItem.members || []).map(m => m.chestNumber).filter(Boolean))]
                            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
                            .join(', ');

                        const studentNamesList = (groupItem.members || []).map(m => m.name).filter(Boolean);
                        const studentNamesHtml = studentNamesList.length > 0
                            ? `<div class="call-student-list" style="display:flex; flex-direction:column; gap:0.05rem;">` +
                            studentNamesList.map((n, sIdx) => `
                                <div class="call-student-item" style="display:flex; align-items:flex-start; padding:0.1rem 0; ${sIdx < studentNamesList.length - 1 ? 'border-bottom:1px solid #f1f5f9;' : ''}">
                                    <span class="call-student-num" style="display:inline-block; min-width:18px; font-size:0.72rem; font-weight:700; color:#475569; background:none; border:none; border-radius:0; margin-right:0.35rem; flex-shrink:0; line-height:1.25;">${sIdx + 1}.</span>
                                    <span class="call-student-name" style="flex:1; font-size:0.72rem; font-weight:700; color:#1e1b4b; word-break:break-word; white-space:normal; line-height:1.25;">${window.escapeHTML(n)}</span>
                                </div>
                              `).join('') +
                            `</div>`
                            : '—';

                        return `
                            <tr style="page-break-inside:avoid; vertical-align:middle;">
                                <td style="text-align:center; font-weight:800; color:#64748b; padding:0.25rem 0.35rem;">${idx + 1}</td>
                                <td style="font-weight:800; color:#1e1b4b; word-break:break-word; white-space:normal; padding:0.25rem 0.35rem; letter-spacing:0.02em;">
                                    ${window.escapeHTML(chestNumbers || '—')}
                                </td>
                                <td style="font-size:0.72rem; font-weight:600; color:#334155; word-break:break-word; white-space:normal; padding:0.25rem 0.35rem; line-height:1.25;">
                                    ${studentNamesHtml}
                                </td>
                                <td style="font-weight:800; color:#475569; padding:0.25rem 0.35rem;">${window.escapeHTML(groupItem.name)}</td>
                                <td style="padding:0.25rem 0.35rem;">
                                    <span class="call-team-badge">${window.escapeHTML(getSafeTeamName(groupItem, studentMap, teamNamesMap))}</span>
                                </td>
                            </tr>
                        `;
                    }).join('');
                }

                bodyHtml = `
                    <table class="report-table call-list-table" style="margin-top: 0.15rem; width:100%; border-collapse:collapse;">
                        <thead>
                            ${tableHeaderHtml}
                        </thead>
                        <tbody>
                            ${tableBodyHtml}
                        </tbody>
                    </table>
                `;
            } else {
                // Individual Programs: 5-column compact table
                
                // Sort participants by Class in ascending numerical/natural order, then by Division alphabetically.
                parts.sort((a, b) => {
                    const resolvedStudentA = a.studentId ? studentMap[a.studentId] : null;
                    const classA = resolvedStudentA ? (resolvedStudentA.className || resolvedStudentA.classId || '') : '';
                    
                    const resolvedStudentB = b.studentId ? studentMap[b.studentId] : null;
                    const classB = resolvedStudentB ? (resolvedStudentB.className || resolvedStudentB.classId || '') : '';
                    
                    return String(classA).localeCompare(String(classB), undefined, { numeric: true, sensitivity: 'base' });
                });

                const tableHeaderHtml = `
                    <tr>
                        <th style="width:50px; text-align:center;">SL</th>
                        <th style="width:110px; text-align:center;">Chest No</th>
                        <th>Participant Name</th>
                        <th style="width:100px; text-align:left;">Class</th>
                        <th style="width:160px;">Team</th>
                    </tr>
                `;

                const tableBodyHtml = parts.length === 0 ? `
                    <tr>
                        <td colspan="5" style="text-align:center; padding:0.6rem; color:#64748b;">No registered entries.</td>
                    </tr>
                ` : parts.map((item, idx) => {
                    const resolvedStudent = item.studentId ? studentMap[item.studentId] : null;
                    const className = resolvedStudent ? (resolvedStudent.className || resolvedStudent.classId || '—') : '—';
                    return `
                        <tr style="height:28px; page-break-inside:avoid;">
                            <td style="text-align:center; font-weight:800; color:#64748b;">${idx + 1}</td>
                            <td style="text-align:center;">
                                <span class="call-chest-badge">${window.escapeHTML(item.chestNumber || '—')}</span>
                            </td>
                            <td style="font-weight:800; color:#1e1b4b;">${window.escapeHTML(item.name)}</td>
                            <td style="font-weight:700; color:#475569;">${window.escapeHTML(className)}</td>
                            <td>
                                <span class="call-team-badge">${window.escapeHTML(getSafeTeamName(item, studentMap, teamNamesMap))}</span>
                            </td>
                        </tr>
                    `;
                }).join('');

                bodyHtml = `
                    <table class="report-table call-list-table" style="margin-top: 0.15rem; width:100%;">
                        <thead>
                            ${tableHeaderHtml}
                        </thead>
                        <tbody>
                            ${tableBodyHtml}
                        </tbody>
                    </table>
                `;
            }

            htmlContent += `
                <div class="${pageDivClass}" style="margin-bottom: 0.75rem; page-break-inside: avoid; break-inside: avoid;">
                    <!-- Compact 1-line Info Header Bar (Phase 4) -->
                    <div style="border-bottom:1.5px solid #1e1b4b; padding-bottom:0.15rem; margin-bottom:0.25rem; display:flex; justify-content:space-between; align-items:baseline;">
                        <div>
                            <h3 style="margin:0; font-size:1.05rem; font-weight:800; color:#1e1b4b; display:inline;">${p.programNumber ? `[#${p.programNumber}] ` : ''}${window.escapeHTML(p.programName)}</h3>
                            <span style="font-size:0.75rem; font-weight:700; color:#475569; margin-left:0.4rem;">&bull; ${window.escapeHTML(formatLabel(p.categoryName))} &bull; ${window.escapeHTML(formatLabel(p.genderCategory || p.gender || 'Mixed'))} &bull; ${window.escapeHTML((p.programLocation || p.location || 'Stage').toUpperCase())}${p.className ? ` &bull; Class: ${window.escapeHTML(formatLabel(p.className))}` : ''}</span>
                        </div>
                        <div style="font-size:0.75rem; font-weight:800; color:#1e1b4b;">
                            ${parts.length} ${pType === 'general' ? 'participants' : (pType === 'group' ? 'groups' : 'entries')}
                        </div>
                    </div>

                    ${bodyHtml}
                </div>
            `;
        });
    }

    else if (f.type === 'Results') {
        if (f.resultSubOption === 'Class Wise Academic & Attendance') {
            let filteredAwards = classAwards.filter(aw => {
                if (f.classId && aw.classId !== f.classId) return false;
                const awTypeId = aw.awardTypeId || (aw.awardType ? aw.awardType.toLowerCase() : '');
                const awType = aw.awardType || '';

                if (f.awardTypeFilter) {
                    if (Array.isArray(f.awardTypeFilter)) {
                        if (!f.awardTypeFilter.includes('All')) {
                            const match = f.awardTypeFilter.some(filterVal => {
                                const fVal = filterVal.toLowerCase();
                                return (awTypeId && awTypeId.toLowerCase() === fVal) ||
                                    (awType && awType.toLowerCase() === fVal) ||
                                    (awTypeId === filterVal) ||
                                    (awType === filterVal);
                            });
                            if (!match) return false;
                        }
                    } else if (f.awardTypeFilter !== 'All') {
                        const filterVal = f.awardTypeFilter.toLowerCase();
                        const match = (awTypeId && awTypeId.toLowerCase() === filterVal) ||
                            (awType && awType.toLowerCase() === filterVal) ||
                            (awTypeId === f.awardTypeFilter) ||
                            (awType === f.awardTypeFilter);
                        if (!match) return false;
                    }
                }
                return true;
            });

            let targetClasses = [];
            const seenClassIds = new Set();
            allCategories.forEach(cat => {
                cat.classes.forEach(c => {
                    if (!seenClassIds.has(c.id)) {
                        if (f.classId && c.id !== f.classId) return;
                        seenClassIds.add(c.id);
                        targetClasses.push(c);
                    }
                });
            });
            targetClasses.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

            // Append Bulk Other Entry / Custom Classes after regular classes
            const extraClassesMap = new Map();
            filteredAwards.forEach(aw => {
                if (aw.classId && !seenClassIds.has(aw.classId)) {
                    if (!extraClassesMap.has(aw.classId)) {
                        extraClassesMap.set(aw.classId, {
                            id: aw.classId,
                            name: aw.className || 'Other Entry'
                        });
                    }
                }
            });
            const extraClasses = Array.from(extraClassesMap.values());
            targetClasses = [...targetClasses, ...extraClasses];

            let awardHTML = '';
            const instName = getEventName();
            const todayStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

            const mainHeaderHTML = `
                <div class="report-header" style="border-bottom: 2px solid #000; padding-bottom: 0.35rem; margin-bottom: 0.75rem; width: 100%;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-end;">
                        <div>
                            <h1 style="margin: 0; color: #1e1b4b; font-size: 1.2rem; font-weight: 900; text-transform: uppercase; letter-spacing: 0.03em;">
                                CLASS WISE ACADEMIC & ATTENDANCE AWARDS
                            </h1>
                            <div style="font-size: 0.75rem; font-weight: 700; color: #475569; margin-top: 0.1rem; text-transform: uppercase;">
                                ${window.escapeHTML(instName).toUpperCase()}
                            </div>
                        </div>
                        <div style="font-size: 0.72rem; font-weight: 700; color: #64748b; text-align: right;">
                            DATE: ${todayStr}
                        </div>
                    </div>
                </div>
            `;

            targetClasses.forEach(cls => {
                const classAwardsList = filteredAwards.filter(aw => aw.classId === cls.id);
                if (classAwardsList.length === 0) return;

                // Collect unique award types present in this class's awards
                const classAwardTypes = [];
                classAwardsList.forEach(aw => {
                    const typeId = aw.awardTypeId || (aw.awardType ? aw.awardType.toLowerCase() : '');
                    const typeName = aw.awardType || formatLabel(typeId);
                    if (!classAwardTypes.some(t => t.id === typeId)) {
                        classAwardTypes.push({ id: typeId, name: typeName });
                    }
                });

                const awardTypes = classAwardTypes.filter(t => {
                    if (f.awardTypeFilter) {
                        if (Array.isArray(f.awardTypeFilter)) {
                            if (!f.awardTypeFilter.includes('All')) {
                                const match = f.awardTypeFilter.some(filterVal => {
                                    const fVal = filterVal.toLowerCase();
                                    return (t.id && t.id.toLowerCase() === fVal) ||
                                        (t.name && t.name.toLowerCase() === fVal) ||
                                        (t.id === filterVal) ||
                                        (t.name === filterVal);
                                });
                                if (!match) return false;
                            }
                        } else if (f.awardTypeFilter !== 'All') {
                            const filterVal = f.awardTypeFilter.toLowerCase();
                            const match = (t.id && t.id.toLowerCase() === filterVal) ||
                                (t.name && t.name.toLowerCase() === filterVal) ||
                                (t.id === filterVal) ||
                                (t.name === filterVal);
                            if (!match) return false;
                        }
                    }
                    return true;
                });

                if (awardTypes.length === 0) return;

                let classBodyHTML = '';

                awardTypes.forEach(type => {
                    const award = classAwardsList.find(aw => {
                        const typeId = aw.awardTypeId || (aw.awardType ? aw.awardType.toLowerCase() : '');
                        return typeId === type.id;
                    });
                    if (!award) return;

                    let firstWinners = [];
                    if (Array.isArray(award.firstPlaceWinners)) {
                        firstWinners = award.firstPlaceWinners;
                    } else if (award.firstPlace) {
                        firstWinners = [award.firstPlace];
                    } else if (award.firstPlaceWinner) {
                        firstWinners = [award.firstPlaceWinner];
                    }

                    let secondWinners = [];
                    if (Array.isArray(award.secondPlaceWinners)) {
                        secondWinners = award.secondPlaceWinners;
                    } else if (award.secondPlace) {
                        secondWinners = [award.secondPlace];
                    } else if (award.secondPlaceWinner) {
                        secondWinners = [award.secondPlaceWinner];
                    }

                    let thirdWinners = [];
                    if (Array.isArray(award.thirdPlaceWinners)) {
                        thirdWinners = award.thirdPlaceWinners;
                    } else if (award.thirdPlace) {
                        thirdWinners = [award.thirdPlace];
                    } else if (award.thirdPlaceWinner) {
                        thirdWinners = [award.thirdPlaceWinner];
                    }

                    // Hide empty award sections completely
                    if (firstWinners.length === 0 && secondWinners.length === 0 && thirdWinners.length === 0) return;

                    classBodyHTML += `
                        <div style="margin-bottom: 0.4rem; page-break-inside: avoid; break-inside: avoid;">
                            <div style="font-size: 0.8rem; font-weight: 800; color: #334155; padding-bottom: 0.15rem; margin-bottom: 0.25rem; text-transform: uppercase; letter-spacing: 0.03em;">
                                🏆 ${type.name} Award
                            </div>
                            <table class="report-table" style="width: 100%; border-collapse: collapse; font-size: 0.78rem; margin-bottom: 0.35rem;">
                                <thead>
                                    <tr style="background: #f8fafc; height: 22px;">
                                        <th style="width: 110px; padding: 0.2rem 0.35rem; border: 1px solid #cbd5e1; font-weight: 800; text-align: center;">PLACE</th>
                                        <th style="width: 110px; padding: 0.2rem 0.35rem; border: 1px solid #cbd5e1; font-weight: 800; text-align: center;">CHEST NO</th>
                                        <th style="padding: 0.2rem 0.35rem; border: 1px solid #cbd5e1; font-weight: 800; text-align: left;">STUDENT NAME</th>
                                        <th style="width: 140px; padding: 0.2rem 0.35rem; border: 1px solid #cbd5e1; font-weight: 800; text-align: left;">CLASS</th>
                                    </tr>
                                </thead>
                                <tbody>
                    `;

                    const renderWinnerRow = (w, placeLabel) => {
                        const isOS = w.sourceType === 'old_student' || w.isOldStudent === true;
                        const osBadge = isOS ? ` <span style="background: #f3e8ff; color: #6b21a8; border: 1px solid #d8b4fe; padding: 1px 5px; border-radius: 4px; font-size: 0.65rem; font-weight: 800; margin-left: 4px; display: inline-block;">🟣 OLD STUDENT</span>` : '';
                        const chestDisp = isOS ? '—' : (w.chestNumber || '—');
                        const classDisp = w.className || cls.name;

                        return `
                            <tr style="height: 22px; page-break-inside: avoid; break-inside: avoid;">
                                <td style="text-align: center; font-weight: 800; border: 1px solid #cbd5e1; color: #1e1b4b; padding: 0.18rem 0.35rem;">${placeLabel}</td>
                                <td style="text-align: center; font-weight: 800; border: 1px solid #cbd5e1; color: #1e1b4b; padding: 0.18rem 0.35rem;">${window.escapeHTML(chestDisp)}</td>
                                <td style="padding: 0.18rem 0.35rem; font-weight: 700; border: 1px solid #cbd5e1; color: #1e293b;">${window.escapeHTML(w.name).toUpperCase()}${osBadge}</td>
                                <td style="padding: 0.18rem 0.35rem; border: 1px solid #cbd5e1; color: #475569;">${window.escapeHTML(classDisp)}</td>
                            </tr>
                        `;
                    };

                    firstWinners.forEach(w => {
                        classBodyHTML += renderWinnerRow(w, '🥇 1st Place');
                    });

                    secondWinners.forEach(w => {
                        classBodyHTML += renderWinnerRow(w, '🥈 2nd Place');
                    });

                    thirdWinners.forEach(w => {
                        classBodyHTML += renderWinnerRow(w, '🥉 3rd Place');
                    });

                    classBodyHTML += `
                                </tbody>
                            </table>
                        </div>
                    `;
                });

                if (!classBodyHTML) return;

                awardHTML += `
                    <div class="class-award-card">
                        <div style="background: #f1f5f9; border-left: 3px solid #1e1b4b; padding: 0.2rem 0.45rem; margin-bottom: 0.35rem; font-size: 0.85rem; font-weight: 900; color: #1e1b4b; text-transform: uppercase;">
                            CLASS : ${window.escapeHTML(cls.name).toUpperCase()}
                        </div>
                        ${classBodyHTML}
                    </div>
                `;
            });

            if (!awardHTML) {
                htmlContent = `
                    <div style="text-align:center; padding:4rem; color:#dc2626; border:1px solid #fecaca; border-radius:12px; background:#fef2f2;">
                        <h3 style="margin:0;">⚠️ No class award records found for the selected filters.</h3>
                        <p style="color:#64748b; margin-top:0.25rem; font-weight:600;">Please add class award winners first.</p>
                    </div>
                `;
            } else {
                htmlContent = mainHeaderHTML + awardHTML;
            }
        }
        else {
            const filteredResults = filterResultsBySource(resultsList, f);

            if (filteredResults.length === 0) {
                htmlContent = `
                <div style="text-align:center; padding:4rem; color:#dc2626; border:1px solid #fecaca; border-radius:12px; background:#fef2f2;">
                    <h3 style="margin:0;">⚠️ No matching published results found.</h3>
                    <p style="color:#64748b; margin-top:0.25rem; font-weight:600;">Make sure marks have been published and filters match properly.</p>
                </div>
            `;
            }

            else {
                // Aggregator arrays
                const teamPoints = new Map();
                const categoryScores = new Map(); // categoryId -> Map(studentKey -> { name, team, points })

                const teamMap = new Map();
                allTeams.forEach(t => {
                    teamPoints.set(t.id, 0);
                    teamMap.set(t.id, t.name);
                });

                allCategories.forEach(c => categoryScores.set(c.id, new Map()));

                filteredResults.forEach(r => {
                    const prog = allPrograms.find(p => p.id === r.programId);
                    if (!prog) return;

                    if (Array.isArray(r.marksData) && r.marksData.length > 0) {
                        r.marksData.forEach(w => {
                            const pts = Number(w.totalPoints) || 0;
                            if (w.teamId && w.teamId !== 'teamless' && pts > 0) {
                                teamPoints.set(w.teamId, (teamPoints.get(w.teamId) || 0) + pts);
                            }
                            // For Category Champions accumulation
                            if (w.studentName && prog.categoryId) {
                                const map = categoryScores.get(prog.categoryId);
                                if (map) {
                                    const key = w.studentName;
                                    if (!map.has(key)) {
                                        const resolvedTeam = w.teamId ? (teamMap.get(w.teamId) || w.teamName || '—') : (w.teamName || '—');
                                        map.set(key, { name: w.studentName, teamName: resolvedTeam, points: 0 });
                                    }
                                    map.get(key).points += pts;
                                }
                            }
                        });
                    } else if (Array.isArray(r.winners)) {
                        r.winners.forEach(w => {
                            const pts = w.totalPoints !== undefined ? Number(w.totalPoints) : (Number(w.marks) || 0);
                            if (w.teamId && w.teamId !== 'teamless' && pts > 0) {
                                teamPoints.set(w.teamId, (teamPoints.get(w.teamId) || 0) + pts);
                            }
                            // For Category Champions accumulation
                            if (w.studentName && prog.categoryId) {
                                const map = categoryScores.get(prog.categoryId);
                                if (map) {
                                    const key = w.studentName;
                                    if (!map.has(key)) {
                                        const resolvedTeam = w.teamId ? (teamMap.get(w.teamId) || w.teamName || '—') : (w.teamName || '—');
                                        map.set(key, { name: w.studentName, teamName: resolvedTeam, points: 0 });
                                    }
                                    map.get(key).points += pts;
                                }
                            }
                        });
                    }
                });

                // 1. Team Championship Standings (Phase 6) - Omitted from result report export as requested
                const sortedTeamStandings = [...teamPoints.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([id, points], idx) => ({ rank: idx + 1, team: teamMap.get(id) || 'Unknown', points }));

                // 2. Category Champions Summaries (Phase 6)
                let categoryHTML = '';
                if (f.resultSubOption !== 'Program Wise' && f.resultSubOption !== 'Team Wise' && f.resultSubOption !== 'Participants Without Major Prizes') {
                    allCategories.forEach(cat => {
                        const map = categoryScores.get(cat.id);
                        if (!map || map.size === 0) return;

                        const sortedStudents = [...map.values()].sort((a, b) => b.points - a.points);
                        const champ = sortedStudents[0];
                        const runner = sortedStudents[1];
                        const third = sortedStudents[2];

                        categoryHTML += `
                        <div style="border:1px solid #cbd5e1; border-radius:12px; padding:1.25rem; background:#ffffff; margin-bottom:1.5rem; page-break-inside:avoid; box-shadow:0 2px 4px rgba(0,0,0,0.01);">
                            <h3 style="margin-top:0; color:#4338ca; border-bottom:2px solid #e2e8f0; padding-bottom:0.4rem; font-size:1rem; font-weight:800; text-transform:uppercase;">
                                🏷️ CATEGORY CHAMPIONSHIP: ${window.escapeHTML(cat.name)}
                            </h3>
                            <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:1rem; margin-top:0.75rem;">
                                
                                ${champ ? `
                                <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:0.75rem; text-align:center;">
                                    <div style="font-size:1.25rem;">🥇</div>
                                    <div style="font-size:0.65rem; font-weight:800; color:#d97706; text-transform:uppercase;">Category Champion</div>
                                    <div style="font-weight:800; color:#1e1b4b; font-size:0.85rem; margin-top:0.2rem;">${window.escapeHTML(champ.name)}</div>
                                    <div style="font-size:0.7rem; color:#475569; font-weight:600;">${window.escapeHTML(champ.teamName)}</div>
                                    <div style="font-weight:900; color:#16a34a; font-size:0.9rem; margin-top:0.2rem;">${champ.points} points</div>
                                </div>
                                ` : ''}

                                ${runner ? `
                                <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; padding:0.75rem; text-align:center;">
                                    <div style="font-size:1.25rem;">🥈</div>
                                    <div style="font-size:0.65rem; font-weight:800; color:#475569; text-transform:uppercase;">Runner Up</div>
                                    <div style="font-weight:800; color:#1e1b4b; font-size:0.85rem; margin-top:0.2rem;">${window.escapeHTML(runner.name)}</div>
                                    <div style="font-size:0.7rem; color:#475569; font-weight:600;">${window.escapeHTML(runner.teamName)}</div>
                                    <div style="font-weight:900; color:#475569; font-size:0.9rem; margin-top:0.2rem;">${runner.points} points</div>
                                </div>
                                ` : ''}

                                ${third ? `
                                <div style="background:#fff7ed; border:1px solid #ffedd5; border-radius:8px; padding:0.75rem; text-align:center;">
                                    <div style="font-size:1.25rem;">🥉</div>
                                    <div style="font-size:0.65rem; font-weight:800; color:#ea580c; text-transform:uppercase;">Third Place</div>
                                    <div style="font-weight:800; color:#1e1b4b; font-size:0.85rem; margin-top:0.2rem;">${window.escapeHTML(third.name)}</div>
                                    <div style="font-size:0.7rem; color:#475569; font-weight:600;">${window.escapeHTML(third.teamName)}</div>
                                    <div style="font-weight:900; color:#ea580c; font-size:0.9rem; margin-top:0.2rem;">${third.points} points</div>
                                </div>
                                ` : ''}

                            </div>
                        </div>
                    `;
                    });
                }

                if (categoryHTML) {
                    htmlContent += `
                    <div class="program-page-standard" style="page-break-after:always;">
                        <div style="text-align:center; margin-bottom:2rem; border-bottom:3px double #4338ca; padding-bottom:1rem;">
                            <span style="font-size:0.8rem; font-weight:800; color:#4338ca; letter-spacing:0.1em; text-transform:uppercase;">🏆 CATEGORY INDIVIDUAL TOURNAMENT GLORY</span>
                            <h1 style="color:#1e1b4b; margin:0.25rem 0 0 0; font-size:1.8rem; font-weight:900;">CATEGORY CHAMPIONSHIPS</h1>
                        </div>
                        ${categoryHTML}
                    </div>
                `;
                }

                // 3. Program Wise Results (Phase 6)
                if (f.resultSubOption === 'Team Wise') {
                    const teamWinners = new Map();
                    filteredResults.forEach(r => {
                        let winners = Array.isArray(r.winners) ? r.winners : [];
                        if (f.includedPositions) winners = winners.filter(w => f.includedPositions.includes(w.position));
                        winners.forEach(w => {
                            if (!w.teamName || w.teamName === 'No Team' || !w.teamId || w.teamId === 'teamless') return;
                            if (f.teamId && w.teamId !== f.teamId) return;

                            const prog = allPrograms.find(p => p.id === r.programId);
                            if (!prog) return;

                            const resolved = resolveWinnerParticipant(prog, w, participantsMap[r.programId || r.id], studentMap);

                            if (!teamWinners.has(resolved.teamName)) {
                                teamWinners.set(resolved.teamName, { First: [], Second: [], Third: [] });
                            }
                            const entry = {
                                programName: r.programName,
                                categoryName: r.categoryName,
                                studentName: resolved.displayName,
                                chestNumber: resolved.chestNumbers
                            };

                            if (w.position === 'First') teamWinners.get(resolved.teamName).First.push(entry);
                            else if (w.position === 'Second') teamWinners.get(resolved.teamName).Second.push(entry);
                            else if (w.position === 'Third') teamWinners.get(resolved.teamName).Third.push(entry);
                        });
                    });

                    // Utility to rank categories: SUB JUNIOR -> JUNIOR -> SENIOR
                    const getCatPriority = (catName) => {
                        const n = String(catName || '').toUpperCase().trim();
                        if (n.includes('SUB JUNIOR')) return 1;
                        if (n.includes('JUNIOR') && !n.includes('SUB')) return 2;
                        if (n.includes('SENIOR') && !n.includes('SUPER')) return 3;
                        if (typeof allCategories !== 'undefined' && Array.isArray(allCategories)) {
                            const idx = allCategories.findIndex(c => String(c.name).toUpperCase().trim() === n);
                            if (idx !== -1) return 10 + idx;
                        }
                        return 999;
                    };

                    const sortedTeamNames = [...teamWinners.keys()].sort();

                    // Add global header for Team Wise Standings & Roster
                    htmlContent += `
                        <style>
                            @page {
                                size: A4 portrait;
                                margin: 15mm;
                            }
                            .team-wise-container {
                                font-family: 'Inter', sans-serif;
                            }
                            .team-wise-container table {
                                width: 100%;
                                table-layout: fixed;
                                border-collapse: collapse;
                                page-break-inside: auto;
                            }
                            .team-wise-container th, 
                            .team-wise-container td {
                                padding: 4px 6px !important;
                                line-height: 1.15;
                                vertical-align: middle;
                                word-wrap: break-word;
                                font-size: 0.72rem !important;
                            }
                            .team-wise-container tr {
                                page-break-inside: avoid;
                                page-break-after: auto;
                            }
                            .team-wise-container thead {
                                display: table-header-group;
                            }
                            /* Column widths to optimize Student Name space */
                            .team-wise-container th:nth-child(1) { width: 50px; } /* Chest No */
                            .team-wise-container th:nth-child(2) { width: 33%; }  /* Student Name */
                            .team-wise-container th:nth-child(3) { width: 14%; }  /* Team */
                            .team-wise-container th:nth-child(4) { width: 14%; }  /* Category */
                            .team-wise-container th:nth-child(5) { width: 60px; } /* Position */
                            .team-wise-container th:nth-child(6) { width: 22%; }  /* Program */
                            
                            .team-wise-container h4.pos-heading {
                                page-break-after: avoid;
                                break-after: avoid;
                                margin-top: 0.6rem;
                                margin-bottom: 0.2rem;
                                font-size: 0.85rem;
                            }
                            .page-header-ident {
                                text-align: center;
                                color: #4338ca;
                                font-weight: 900;
                                font-size: 1.25rem;
                                margin-bottom: 0.75rem;
                                text-transform: uppercase;
                                border-bottom: 2px solid #e0e7ff;
                                padding-bottom: 0.35rem;
                            }
                        </style>
                        <div class="team-wise-container">
                            <div class="page-header-ident">
                                TEAM WISE STANDINGS & ROSTER
                            </div>
                    `;

                    sortedTeamNames.forEach((teamName, index) => {
                        const data = teamWinners.get(teamName);

                        // Sort each list by category priority
                        data.First.sort((a, b) => getCatPriority(a.categoryName) - getCatPriority(b.categoryName));
                        data.Second.sort((a, b) => getCatPriority(a.categoryName) - getCatPriority(b.categoryName));
                        data.Third.sort((a, b) => getCatPriority(a.categoryName) - getCatPriority(b.categoryName));

                        const renderRowsByGroup = (list, posLabel, actualPos) => {
                            if (list.length === 0) return `<tr><td colspan="6" style="color:#94a3b8; font-style:italic; font-size:0.75rem; text-align:center; padding: 0.35rem !important;">No ${posLabel} place winners recorded.</td></tr>`;

                            // Group by category after sorting
                            const grouped = new Map();
                            list.forEach(item => {
                                const cName = item.categoryName || 'Uncategorized';
                                if (!grouped.has(cName)) grouped.set(cName, []);
                                grouped.get(cName).push(item);
                            });

                            let html = '';
                            grouped.forEach((items, catName) => {
                                html += `
                                <tr style="background:#f1f5f9; page-break-inside: avoid;">
                                    <td colspan="6" style="padding: 0.25rem 0.4rem !important; font-weight:800; color:#1e293b; text-transform:uppercase; font-size:0.72rem !important;">
                                        ${window.escapeHTML(catName)}
                                    </td>
                                </tr>
                                `;
                                items.forEach(item => {
                                    html += `
                                    <tr>
                                        <td style="text-align:center; font-weight:800;">${window.escapeHTML(item.chestNumber)}</td>
                                        <td style="font-weight:700; color:#1e293b;">${window.escapeHTML(item.studentName)}</td>
                                        <td style="font-weight:600; color:#475569;">${window.escapeHTML(teamName)}</td>
                                        <td style="color:#475569; font-weight:600;">${window.escapeHTML(item.categoryName)}</td>
                                        <td style="text-align:center; font-weight:700; color:#4338ca;">${window.escapeHTML(actualPos)}</td>
                                        <td style="font-weight:800; color:#1e293b;">${window.escapeHTML(item.programName)}</td>
                                    </tr>
                                    `;
                                });
                            });
                            return html;
                        };

                        htmlContent += `
                        <div style="${index > 0 ? 'page-break-before: always; margin-top:1.5rem;' : ''}">
                            <div style="border-bottom:2px solid #1e1b4b; padding-bottom:0.25rem; margin-bottom:0.75rem; display:flex; justify-content:space-between; align-items:flex-end;">
                                <h2 style="color:#1e1b4b; margin:0; font-size:1.15rem;">👥 TEAM WINNERS INDEX: ${window.escapeHTML(teamName)}</h2>
                            </div>

                            <div style="page-break-inside: avoid; break-inside: avoid;">
                                <h4 class="pos-heading" style="color:#d97706; margin-top:0;">🥇 FIRST WINNERS</h4>
                                <table class="report-table" style="margin-bottom:1rem; font-size:0.75rem;">
                                    <thead>
                                        <tr style="background:#fffbeb;">
                                            <th style="text-align:center;">Chest No</th>
                                            <th>Student / Group Name</th>
                                            <th>Team</th>
                                            <th>Category</th>
                                            <th style="text-align:center;">Position</th>
                                            <th>Program</th>
                                        </tr>
                                    </thead>
                                    <tbody>${renderRowsByGroup(data.First, 'first', 'First')}</tbody>
                                </table>
                            </div>

                            <div style="page-break-inside: avoid; break-inside: avoid;">
                                <h4 class="pos-heading" style="color:#475569;">🥈 SECOND WINNERS</h4>
                                <table class="report-table" style="margin-bottom:1rem; font-size:0.75rem;">
                                    <thead>
                                        <tr style="background:#f8fafc;">
                                            <th style="text-align:center;">Chest No</th>
                                            <th>Student / Group Name</th>
                                            <th>Team</th>
                                            <th>Category</th>
                                            <th style="text-align:center;">Position</th>
                                            <th>Program</th>
                                        </tr>
                                    </thead>
                                    <tbody>${renderRowsByGroup(data.Second, 'second', 'Second')}</tbody>
                                </table>
                            </div>

                            <div style="page-break-inside: avoid; break-inside: avoid;">
                                <h4 class="pos-heading" style="color:#ea580c;">🥉 THIRD WINNERS</h4>
                                <table class="report-table" style="font-size:0.75rem;">
                                    <thead>
                                        <tr style="background:#fff7ed;">
                                            <th style="text-align:center;">Chest No</th>
                                            <th>Student / Group Name</th>
                                            <th>Team</th>
                                            <th>Category</th>
                                            <th style="text-align:center;">Position</th>
                                            <th>Program</th>
                                        </tr>
                                    </thead>
                                    <tbody>${renderRowsByGroup(data.Third, 'third', 'Third')}</tbody>
                                </table>
                            </div>
                        </div>
                    `;
                    });

                    htmlContent += `</div>`;
                }

                else if (f.resultSubOption === 'Program Wise') {
                    const pageDivClass = isCompact ? 'program-card-compact' : 'program-page-standard';
                    
                    let programsToRender = filteredResults;
                    
                    if (f.programOrder === 'result_number') {
                        const orderMap = new Map();
                        const sortedPublished = [...resultsList]
                            .filter(r => r.status === 'published' && r.publishedAt)
                            .sort((a, b) => {
                                const timeA = a.publishedAt?.seconds || 0;
                                const timeB = b.publishedAt?.seconds || 0;
                                return timeA - timeB;
                            });
                            
                        sortedPublished.forEach((r, idx) => {
                            orderMap.set(r.id, idx + 1);
                        });
                        
                        programsToRender = [...filteredResults].sort((a, b) => {
                            const numA = orderMap.has(a.id) ? orderMap.get(a.id) : 999999;
                            const numB = orderMap.has(b.id) ? orderMap.get(b.id) : 999999;
                            return numA - numB;
                        });
                    } else if (f.programOrder === 'category_order') {
                        const catOrder = new Map();
                        allCategories.forEach((cat, idx) => {
                            if (cat.id === 'general_programs') {
                                catOrder.set(cat.id, 99999);
                            } else {
                                catOrder.set(cat.id, idx);
                            }
                        });
                        
                        programsToRender = [...filteredResults].sort((a, b) => {
                            const progA = allPrograms.find(p => p.id === (a.programId || a.id));
                            const progB = allPrograms.find(p => p.id === (b.programId || b.id));
                            
                            const catIdA = progA ? progA.categoryId : a.categoryId;
                            const catIdB = progB ? progB.categoryId : b.categoryId;
                            
                            const catWeightA = catIdA === 'general_programs' ? 99999 : (catOrder.has(catIdA) ? catOrder.get(catIdA) : 88888);
                            const catWeightB = catIdB === 'general_programs' ? 99999 : (catOrder.has(catIdB) ? catOrder.get(catIdB) : 88888);
                            
                            if (catWeightA !== catWeightB) return catWeightA - catWeightB;
                            
                            const classIdA = progA ? progA.classId : null;
                            const classIdB = progB ? progB.classId : null;
                            
                            const catA = allCategories.find(c => c.id === catIdA);
                            const clsOrderMap = new Map();
                            if (catA && Array.isArray(catA.classes)) {
                                catA.classes.forEach((cls, idx) => {
                                    clsOrderMap.set(cls.id, idx);
                                });
                            }
                            const classWeightA = classIdA ? (clsOrderMap.has(classIdA) ? clsOrderMap.get(classIdA) : 999) : 999;
                            const classWeightB = classIdB ? (clsOrderMap.has(classIdB) ? clsOrderMap.get(classIdB) : 999) : 999;
                            
                            if (classWeightA !== classWeightB) return classWeightA - classWeightB;
                            
                            return 0;
                        });
                    }

                    programsToRender.forEach(r => {
                        let winnersList = Array.isArray(r.winners) ? r.winners : [];
                        if (f.includedPositions) winnersList = winnersList.filter(w => f.includedPositions.includes(w.position));
                        const combinedWinners = [...winnersList];

                        if (r.gradeMode !== 'none' && Array.isArray(r.marksData)) {
                            r.marksData.forEach(m => {
                                if (!m.grade || m.grade === 'none' || String(m.grade).trim() === '') return;
                                const isWinner = winnersList.some(w => {
                                    const mId = m.studentId || m.groupId || m.id || '';
                                    const wId = w.studentId || w.groupId || w.id || '';
                                    const mName = m.studentName || m.groupName || m.name || '';
                                    const wName = w.studentName || w.groupName || w.name || '';
                                    const mTeam = m.teamName || '';
                                    const wTeam = w.teamName || '';

                                    if (r.programType === 'group' || r.type === 'Group') {
                                        return (mTeam && wTeam && mTeam === wTeam) || (mId && wId && mId === wId) || (mName && wName && mName === wName);
                                    } else {
                                        return (mId && wId && mId === wId) || (mName && wName && mName === wName);
                                    }
                                });
                                if (!isWinner) {
                                    combinedWinners.push({
                                        position: String(m.grade).trim() + ' Grade',
                                        studentId: m.studentId,
                                        studentName: m.studentName,
                                        teamName: m.teamName,
                                        teamId: m.teamId,
                                        chestNumbers: m.chestNumbers || m.chestNumber,
                                        marks: m.totalPoints !== undefined ? m.totalPoints : 0,
                                        grade: m.grade,
                                        codeLetter: m.codeLetter,
                                        isGradeOnly: true
                                    });
                                }
                            });
                        }

                        const posOrder = { 'First': 1, 'Second': 2, 'Third': 3 };
                        const getGradePriority = (grade) => {
                            if (!grade) return 99;
                            const g = String(grade).toUpperCase().trim();
                            if (g.startsWith('A')) return 1;
                            if (g.startsWith('B')) return 2;
                            if (g.startsWith('C')) return 3;
                            return 4;
                        };

                        let finalWinners = combinedWinners;
                        if (f.gender && f.gender !== 'Mixed' && f.gender !== 'All' && f.gender !== 'All Genders') {
                            const targetGender = f.gender === 'Boys' ? 'Male' : (f.gender === 'Girls' ? 'Female' : f.gender);
                            finalWinners = finalWinners.filter(w => {
                                const prog = allPrograms.find(p => p.id === (r.programId || r.id));
                                const resolved = resolveWinnerParticipant(prog, w, participantsMap[r.programId || r.id], studentMap);
                                return resolved.memberStudents.length > 0 && resolved.memberStudents.every(stu => stu.gender === targetGender);
                            });
                        }

                        const sortedWinners = finalWinners.sort((a, b) => {
                            const pA = posOrder[a.position] || 4;
                            const pB = posOrder[b.position] || 4;
                            if (pA !== pB) return pA - pB;

                            const gA = getGradePriority(a.grade);
                            const gB = getGradePriority(b.grade);
                            if (gA !== gB) return gA - gB;

                            const mA = a.totalPoints !== undefined ? Number(a.totalPoints) : (Number(a.marks) || 0);
                            const mB = b.totalPoints !== undefined ? Number(b.totalPoints) : (Number(b.marks) || 0);
                            return mB - mA;
                        });

                        htmlContent += `
                        <div class="${pageDivClass}">
                            <div class="report-header">
                                <div>
                                    <div class="report-title">🏆 PROGRAM RESULTS PODIUM</div>
                                    <h2 style="margin-top:0.3rem; margin-bottom:0.1rem; color:#1e1b4b; font-size:1.3rem;">${window.escapeHTML(r.programName)}</h2>
                                    <div style="font-size:0.75rem; font-weight:700; color:#4338ca;">
                                        Category: ${window.escapeHTML(r.categoryName)} ${r.className ? `· Class: ${window.escapeHTML(r.className)}` : ''} ${(function () {
                                const prog = typeof allPrograms !== 'undefined' ? allPrograms.find(p => p.id === (r.programId || r.id)) : null;
                                const rawG = prog ? (prog.genderCategory || prog.gender || '').toString().trim() : (r.genderCategory || r.gender || '').toString().trim();
                                if (!rawG || rawG.toLowerCase() === 'mixed' || rawG.toLowerCase() === 'general' || rawG.toLowerCase() === 'all genders') return '';
                                return `· Gender: ${window.escapeHTML(rawG.toUpperCase())} `;
                            })()}· 
                                        Type: ${r.programType === 'group' ? 'Group Event' : 'Individual Event'}
                                    </div>
                                </div>
                                <div style="text-align:right;">
                                    <span style="font-size:0.65rem; font-weight:800; color:#64748b; text-transform:uppercase; display:block;">Stage / Venue</span>
                                    <span style="font-weight:900; font-size:1rem; color:#1e1b4b;">📍 ${window.escapeHTML(r.programLocation || 'Stage')}</span>
                                </div>
                            </div>

                            <table class="report-table">
                                <thead>
                                    <tr>
                                        <th style="width:70px; text-align:center;">Position</th>
                                        <th style="width:50px; text-align:center;">Call Letter</th>
                                        <th style="width:70px; text-align:center;">Chest No</th>
                                        <th>Student / Team Name</th>
                                        <th>Team</th>
                                        <th style="width:50px; text-align:center;">${(r.gradeMode !== 'none') ? 'Grade' : ''}</th>
                                        <th style="width:60px; text-align:center;">Marks</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${sortedWinners.length === 0 ? `<tr><td colspan="7" style="text-align:center; padding:1.5rem; color:#64748b;">No winners recorded for this program.</td></tr>` :
                                sortedWinners.map(w => {
                                    let posBadge = w.position;

                                    let wTotal = w.totalPoints !== undefined ? w.totalPoints : w.marks;
                                    let points = wTotal !== undefined ? `${wTotal} pts` : '0 pts';
                                    let match = null;

                                    if (Array.isArray(r.marksData)) {
                                        const posToRank = { 'First': 1, 'Second': 2, 'Third': 3 };
                                        const rankToMatch = posToRank[w.position];
                                        
                                        // 1. Bulletproof match by Rank/Position (guarantees correct points even if names mismatch)
                                        match = r.marksData.find(m => m.position === w.position || (rankToMatch && m.rank === rankToMatch));
                                        
                                        // 2. Fallback to name/id identity
                                        if (!match) {
                                            match = r.marksData.find(m => {
                                                const mId = m.studentId || m.groupId || m.id || '';
                                                const wId = w.studentId || w.groupId || w.id || '';
                                                const mName = m.studentName || m.groupName || m.name || '';
                                                const wName = w.studentName || w.groupName || w.name || '';
                                                const mTeam = m.teamName || '';
                                                const wTeam = w.teamName || '';
    
                                                if (r.programType === 'group' || r.type === 'Group') {
                                                    return (mTeam && wTeam && mTeam === wTeam) || (mId && wId && mId === wId) || (mName && wName && mName === wName);
                                                } else {
                                                    return (mId && wId && mId === wId) || (mName && wName && mName === wName);
                                                }
                                            });
                                        }
                                        if (match) {
                                            points = match.totalPoints !== undefined ? `${match.totalPoints} pts` : points;
                                        }
                                    }

                                    const prog = allPrograms.find(p => p.id === r.programId);
                                    const resolved = resolveWinnerParticipant(prog, w, participantsMap[r.programId || r.id], studentMap);
                                    const showGrade = r.gradeMode !== 'none';
                                    const gradeVal = showGrade ? (w.grade || (match && match.grade) || '—') : '';

                                    let codeLetterDisplay = '';
                                    if (match && match.codeLetter !== undefined && match.codeLetter !== null) {
                                        const valStr = String(match.codeLetter).trim();
                                        const valLower = valStr.toLowerCase();
                                        if (valStr !== '' &&
                                            valLower !== 'n/a' &&
                                            valLower !== '-' &&
                                            valLower !== 'none' &&
                                            valLower !== 'null' &&
                                            valLower !== 'undefined') {
                                            codeLetterDisplay = valStr;
                                        }
                                    }

                                    let classDisplay = '';
                                    if (resolved.memberStudents && resolved.memberStudents.length > 0) {
                                        const classes = [...new Set(resolved.memberStudents.map(m => m.className).filter(c => c && c !== '—'))];
                                        if (classes.length > 0) {
                                            classDisplay = classes.join(', ');
                                        }
                                    }

                                    let displayNameHtml = window.escapeHTML(resolved.displayName);
                                    if (classDisplay) {
                                        displayNameHtml += ` - <span style="font-size:0.85em; opacity:0.85;">${window.escapeHTML(classDisplay)}</span>`;
                                    }

                                    return `
                                            <tr>
                                                <td style="text-align:center; font-weight:900; color:#1e1b4b;">${posBadge}</td>
                                                <td style="text-align:center; font-weight:800; color:#0f172a;">${window.escapeHTML(codeLetterDisplay)}</td>
                                                <td style="text-align:center; font-weight:800; color:#0f172a;">${window.escapeHTML(resolved.chestNumbers)}</td>
                                                <td style="font-weight:700; color:#1e293b;">${displayNameHtml}</td>
                                                <td style="font-weight:600; color:#475569;">${window.escapeHTML(resolved.teamName || '—')}</td>
                                                <td style="text-align:center; font-weight:700; color:#4338ca;">${window.escapeHTML(gradeVal)}</td>
                                                <td style="text-align:center; font-weight:900; color:#16a34a;">${points}</td>
                                            </tr>
                                        `;
                                }).join('')}
                                </tbody>
                            </table>
                        </div>
                    `;
                    });
                }

                else if (f.resultSubOption === 'Student Prize Distribution') {
                    const studentPrizes = new Map();

                    filteredResults.forEach(r => {
                        const isGeneral = (r.programType || '').toLowerCase() === 'general' || r.categoryId === 'general_programs';
                        
                        if (isGeneral && f.includedPositions && !f.includedPositions.includes('General Programs')) {
                            return;
                        }

                        const isGroup = (r.programType || '').toLowerCase() === 'group';
                        const pLoc = (r.programLocation || '').toLowerCase();

                        let prizeCat = 2; // Default to Off Stage Individual
                        if (isGeneral) {
                            prizeCat = 4;
                        } else if (isGroup) {
                            prizeCat = 3;
                        } else if (pLoc === 'stage') {
                            prizeCat = 1;
                        }

                        let winnersList = Array.isArray(r.winners) ? r.winners : [];
                        if (f.includedPositions) winnersList = winnersList.filter(w => f.includedPositions.includes(w.position));
                        winnersList.forEach(w => {
                            const prog = allPrograms.find(p => p.id === r.programId);
                            if (!prog) return;

                            const resolved = resolveWinnerParticipant(prog, w, participantsMap[r.programId || r.id], studentMap);

                            resolved.memberStudents.forEach(stu => {
                                if (f.gender && f.gender !== 'Mixed' && f.gender !== 'All' && f.gender !== 'All Genders') {
                                    const targetGender = f.gender === 'Boys' ? 'Male' : (f.gender === 'Girls' ? 'Female' : f.gender);
                                    if (stu.gender !== targetGender) return;
                                }

                                const chestNo = stu.chestNumber || '—';
                                const stuKey = (chestNo && chestNo !== '—') ? chestNo : (stu.studentId || stu.name || 'unknown');

                                if (!studentPrizes.has(stuKey)) {
                                    studentPrizes.set(stuKey, {
                                        studentName: stu.name,
                                        chestNumber: chestNo,
                                        className: stu.className,
                                        categoryName: stu.categoryName,
                                        teamName: stu.teamName,
                                        prizes: []
                                    });
                                }

                                const listObj = studentPrizes.get(stuKey);
                                const alreadyAdded = listObj.prizes.some(p => p.programName === r.programName && p.position === w.position);
                                if (!alreadyAdded) {
                                    listObj.prizes.push({
                                        programName: r.programName,
                                        position: w.position,
                                        categoryIndex: prizeCat
                                    });
                                }
                            });
                        });
                    });

                    if (studentPrizes.size === 0) {
                        htmlContent = `<div style="text-align:center; padding:3rem; color:#64748b; font-weight:600;">No student prizes recorded under the selected parameters.</div>`;
                    } else {
                        const sortedStudents = [...studentPrizes.values()].sort((a, b) => {
                            const classA = a.className || '';
                            const classB = b.className || '';
                            const classCompare = classA.localeCompare(classB, undefined, { numeric: true, sensitivity: 'base' });
                            if (classCompare !== 0) return classCompare;

                            const chestA = a.chestNumber || '';
                            const chestB = b.chestNumber || '';
                            return chestA.localeCompare(chestB, undefined, { numeric: true, sensitivity: 'base' });
                        });

                        htmlContent = `
                        <div class="program-page-standard">
                            <div style="border-bottom:3px solid #4338ca; padding-bottom:0.4rem; margin-bottom:0.75rem;">
                                <h2 style="color:#1e1b4b; margin:0; font-weight:900;">STUDENT PRIZE DISTRIBUTION REGISTER</h2>
                                <p style="margin:0.15rem 0 0 0; font-size:0.7rem; color:#64748b; font-weight:600;">Aggregated chronological individual student prizes list.</p>
                            </div>

                            <table class="report-table" style="width: 100%; border-collapse: collapse; font-size: 10.5px; margin-top: 0.5rem;">
                                <thead>
                                    <tr style="background-color: #f8fafc;">
                                        <th style="width: 40px; text-align: right; padding: 5px 6px; border: 1px solid #cbd5e1; font-weight: 800; font-size: 10.5px;">S.No.</th>
                                        <th style="width: 70px; text-align: center; padding: 5px 6px; border: 1px solid #cbd5e1; font-weight: 800; font-size: 10.5px;">Chest No</th>
                                        <th style="text-align: left; padding: 5px 6px; border: 1px solid #cbd5e1; font-weight: 800; font-size: 10.5px;">Student Name</th>
                                        <th style="width: 80px; text-align: left; padding: 5px 6px; border: 1px solid #cbd5e1; font-weight: 800; font-size: 10px;">Class</th>
                                        <th style="width: 90px; text-align: left; padding: 5px 6px; border: 1px solid #cbd5e1; font-weight: 800; font-size: 10px;">Category</th>
                                        <th style="width: 100px; text-align: left; padding: 5px 6px; border: 1px solid #cbd5e1; font-weight: 800; font-size: 10px;">Team</th>
                                        <th style="text-align: left; padding: 5px 6px; border: 1px solid #cbd5e1; font-weight: 800; font-size: 10.5px;">Prize Details</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${sortedStudents.map((stu, index) => {
                            stu.prizes.sort((a, b) => a.categoryIndex - b.categoryIndex);
                            const prizeDetailsHtml = stu.prizes.map(p => {
                                return `<div style="font-size: 9.5px; font-weight: 600; color: #1e293b; line-height: 1.25; margin-bottom: 2px;">${window.escapeHTML(p.programName)} - ${window.escapeHTML(p.position)}</div>`;
                            }).join('');

                            return `
                                            <tr style="height: 22px; page-break-inside: avoid;">
                                                <td style="text-align:right; font-weight:700; color:#475569; font-size:10.5px; padding: 5px 6px; border: 1px solid #cbd5e1;">${index + 1}</td>
                                                <td style="text-align:center; font-weight:900; color:#0f172a; font-size:11px; padding: 5px 6px; border: 1px solid #cbd5e1;">${window.escapeHTML(stu.chestNumber)}</td>
                                                <td style="font-weight:800; color:#1e1b4b; font-size:10.5px; padding: 5px 6px; border: 1px solid #cbd5e1;">${window.escapeHTML(stu.studentName)}</td>
                                                <td style="font-weight:700; color:#475569; font-size:10px; padding: 5px 6px; border: 1px solid #cbd5e1;">${window.escapeHTML(stu.className)}</td>
                                                <td style="font-weight:700; color:#475569; font-size:10px; padding: 5px 6px; border: 1px solid #cbd5e1;">${window.escapeHTML(stu.categoryName)}</td>
                                                <td style="font-weight:700; color:#475569; font-size:10px; padding: 5px 6px; border: 1px solid #cbd5e1;">${window.escapeHTML(stu.teamName)}</td>
                                                <td style="padding: 5px 6px; border: 1px solid #cbd5e1; vertical-align: top;">
                                                    <div style="display:flex; flex-direction:column; gap:1px;">
                                                        ${prizeDetailsHtml}
                                                    </div>
                                                </td>
                                            </tr>
                                        `;
                        }).join('')}
                                </tbody>
                            </table>
                        </div>
                    `;
                    }
                }

                else if (f.resultSubOption === 'Prize Distribution Register') {
                    // Structure: Position -> Program Type -> Class -> Winners
                    const positionData = {};

                    filteredResults.forEach(r => {
                        const prog = allPrograms.find(p => p.id === r.programId);
                        if (!prog) return;

                        const pLoc = (prog.programLocation || prog.location || 'Stage');
                        const isOffStage = pLoc.toLowerCase() === 'off stage';
                        if (f.programLocation) {
                            if (f.programLocation.toLowerCase() === 'stage' && isOffStage) return;
                            if (f.programLocation.toLowerCase() === 'off stage' && !isOffStage) return;
                        }

                        const isGeneral = (prog.categoryId === 'general_programs' || prog.programType === 'general' || r.categoryId === 'general_programs' || r.programType === 'general');
                        const isGroup = prog.programType === 'group' || r.programType === 'group';
                        const isIndividual = !isGeneral && !isGroup;

                        if (f.participationType) {
                            if (f.participationType === 'general' && !isGeneral) return;
                            if (f.participationType === 'group' && !isGroup) return;
                            if (f.participationType === 'individual' && !isIndividual) return;
                        }

                        // Determine Program Type string
                        let programType = 'STAGE PROGRAMS';
                        if (isGroup || isOffStage || isGeneral) programType = 'OFF-STAGE PROGRAMS';

                        let winnersList = Array.isArray(r.winners) ? r.winners : [];
                        if (f.includedPositions) winnersList = winnersList.filter(w => f.includedPositions.includes(w.position));

                        winnersList.forEach(w => {
                            const resolved = resolveWinnerParticipant(prog, w, participantsMap[r.programId || r.id], studentMap);
                            let members = resolved.memberStudents || [];

                            members = members.filter(stu => {
                                if (f.gender) {
                                    const g = stu.gender || (studentMap[stu.studentId] && studentMap[stu.studentId].gender) || '';
                                    if (f.gender === 'Boys' && g !== 'Male') return false;
                                    if (f.gender === 'Girls' && g !== 'Female') return false;
                                }
                                if (f.classId) {
                                    const cId = stu.classId || (studentMap[stu.studentId] && studentMap[stu.studentId].classId) || '';
                                    if (cId && cId !== f.classId) return false;
                                }
                                if (f.teamId) {
                                    const tId = stu.teamId || resolved.teamId || w.teamId || (studentMap[stu.studentId] && studentMap[stu.studentId].teamId) || '';
                                    if (tId && tId !== f.teamId) return false;
                                }
                                return true;
                            });

                            if (members.length === 0) return;

                            members.forEach(stu => {
                                const sClass = stu.className || (studentMap[stu.studentId] && studentMap[stu.studentId].className) || '—';
                                const pos = w.position || 'Unknown';

                                if (!positionData[pos]) positionData[pos] = {};
                                if (!positionData[pos][programType]) positionData[pos][programType] = [];

                                positionData[pos][programType].push({
                                    position: pos,
                                    programName: r.programName || prog.programName || '—',
                                    programNumber: prog.programNumber || '',
                                    chestNumber: stu.chestNumber || '—',
                                    studentName: stu.name || '—',
                                    teamName: stu.teamName || resolved.teamName || w.teamName || '—',
                                    className: sClass
                                });
                            });
                        });
                    });

                    let totalEntries = 0;
                    let sectionsHtml = '';

                    const posOrderMap = { 'First': 1, 'Second': 2, 'Third': 3, 'Fourth': 4, 'Fifth': 5 };
                    const sortedPositions = Object.keys(positionData).sort((a, b) => {
                        const pa = posOrderMap[a] || 99;
                        const pb = posOrderMap[b] || 99;
                        return pa - pb;
                    });

                    if (sortedPositions.length === 0) {
                        htmlContent = `<div style="text-align:center; padding:3rem; color:#64748b; font-weight:600;">No prize winners found matching the selected parameters.</div>`;
                    } else {
                        const posIconMap = { 'First': '🥇', 'Second': '🥈', 'Third': '🥉' };

                        sortedPositions.forEach((pos, posIdx) => {
                            const typesData = positionData[pos];
                            const progTypesOrder = ['STAGE PROGRAMS', 'OFF-STAGE PROGRAMS'];

                            let positionHtml = '';
                            let hasAnyInPos = false;

                            const posTitle = `${posIconMap[pos] || '🏅'} ${pos.toUpperCase()} PLACE WINNERS`;

                            positionHtml += `
                            <div class="program-page-standard" style="margin-bottom:2rem; ${posIdx > 0 ? 'page-break-before:always;' : ''}">
                                <div style="border-bottom:3px solid #1e1b4b; padding-bottom:0.4rem; margin-bottom:0.75rem;">
                                    <h2 style="color:#1e1b4b; margin:0; font-weight:900; text-transform:uppercase;">${posTitle}</h2>
                                </div>
                            `;

                            progTypesOrder.forEach(pType => {
                                const items = typesData[pType];
                                if (!items || items.length === 0) return;
                                hasAnyInPos = true;
                                totalEntries += items.length;

                                // Sort items by Class (Ascending), then Program Number/Name
                                items.sort((a, b) => {
                                    const extractNum = (str) => {
                                        const m = String(str).match(/\d+/);
                                        return m ? parseInt(m[0], 10) : 999;
                                    };
                                    const classNumA = extractNum(a.className);
                                    const classNumB = extractNum(b.className);

                                    if (classNumA !== classNumB) return classNumA - classNumB;

                                    const clsComp = String(a.className).localeCompare(String(b.className), undefined, { numeric: true, sensitivity: 'base' });
                                    if (clsComp !== 0) return clsComp;

                                    const pNumA = a.programNumber ? String(a.programNumber) : '';
                                    const pNumB = b.programNumber ? String(b.programNumber) : '';
                                    if (pNumA !== pNumB) return pNumA.localeCompare(pNumB, undefined, { numeric: true, sensitivity: 'base' });

                                    const pComp = a.programName.localeCompare(b.programName, undefined, { sensitivity: 'base' });
                                    if (pComp !== 0) return pComp;

                                    return a.chestNumber.localeCompare(b.chestNumber, undefined, { numeric: true, sensitivity: 'base' });
                                });

                                positionHtml += `
                                <div style="margin-top:1rem; margin-bottom:1.25rem; page-break-inside: auto;">
                                    <h3 style="margin:0 0 0.4rem 0; color:#4338ca; font-size:1rem; font-weight:800; text-transform:uppercase; letter-spacing:0.04em;">
                                        ${window.escapeHTML(pType)}
                                    </h3>
                                    <table class="report-table pww-table" style="width: 100%; border-collapse: collapse; font-size: 10.5px; page-break-inside: auto;">
                                        <thead style="display: table-header-group;">
                                            <tr style="background-color: #f8fafc; page-break-inside: avoid;">
                                                <th style="width: 35px; text-align: center; padding: 5px; border: 1px solid #cbd5e1; font-weight: 800;">SL</th>
                                                <th style="text-align: left; padding: 5px; border: 1px solid #cbd5e1; font-weight: 800;">Program Name</th>
                                                <th style="width: 70px; text-align: center; padding: 5px; border: 1px solid #cbd5e1; font-weight: 800;">Chest No</th>
                                                <th style="text-align: left; padding: 5px; border: 1px solid #cbd5e1; font-weight: 800;">Student Name</th>
                                                <th style="width: 110px; text-align: left; padding: 5px; border: 1px solid #cbd5e1; font-weight: 800;">Team Name</th>
                                                <th style="width: 70px; text-align: center; padding: 5px; border: 1px solid #cbd5e1; font-weight: 800;">Class</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                `;

                                items.forEach((item, idx) => {
                                    const pDisp = window.escapeHTML(item.programNumber ? `[${item.programNumber}] ${item.programName}` : item.programName);

                                    positionHtml += `
                                        <tr style="height: 22px; page-break-inside: avoid;">
                                            <td style="text-align:center; font-weight:700; color:#64748b; padding: 4px 5px; border: 1px solid #cbd5e1;">${idx + 1}</td>
                                            <td style="font-weight:800; color:#1e1b4b; padding: 4px 5px; border: 1px solid #cbd5e1;">${pDisp}</td>
                                            <td style="text-align:center; font-weight:900; color:#0f172a; font-size:11px; padding: 4px 5px; border: 1px solid #cbd5e1;">${window.escapeHTML(item.chestNumber)}</td>
                                            <td style="font-weight:800; color:#1e1b4b; padding: 4px 5px; border: 1px solid #cbd5e1;">${window.escapeHTML(item.studentName)}</td>
                                            <td style="font-weight:700; color:#475569; padding: 4px 5px; border: 1px solid #cbd5e1;">${window.escapeHTML(item.teamName)}</td>
                                            <td style="text-align:center; font-weight:800; color:#4338ca; padding: 4px 5px; border: 1px solid #cbd5e1;">${window.escapeHTML(item.className)}</td>
                                        </tr>
                                    `;
                                });

                                positionHtml += `
                                        </tbody>
                                    </table>
                                </div>
                                `;
                            });

                            positionHtml += `</div>`;
                            if (hasAnyInPos) {
                                sectionsHtml += positionHtml;
                            }
                        });

                        htmlContent = `
                        <div class="pos-wise-winners-report-container">
                            <style>
                                .pww-print-header, .pww-print-footer { display: none; }
                                @media print {
                                    @page {
                                        margin: 15mm;
                                    }
                                    .pos-wise-winners-report-container {
                                        counter-reset: page;
                                    }
                                    .pww-print-header {
                                        display: block;
                                        position: fixed;
                                        top: 0;
                                        left: 0;
                                        right: 0;
                                        text-align: center;
                                        font-size: 10px;
                                        font-weight: bold;
                                        color: #94a3b8;
                                        text-transform: uppercase;
                                        padding-bottom: 5px;
                                    }
                                    .pww-print-footer {
                                        display: block;
                                        position: fixed;
                                        bottom: 0;
                                        left: 0;
                                        right: 0;
                                        text-align: center;
                                        font-size: 10px;
                                        font-weight: bold;
                                        color: #64748b;
                                        padding-top: 5px;
                                    }
                                    body {
                                        padding-top: 20px;
                                        padding-bottom: 20px;
                                    }
                                }
                                .pww-table th, .pww-table td {
                                    page-break-inside: avoid;
                                }
                            </style>
                            <div class="pww-print-header">Position Wise Winners</div>
                            <div class="pww-print-footer"></div>
                            
                            <div style="border-bottom:3px solid #4338ca; padding-bottom:0.4rem; margin-bottom:1rem; display:flex; justify-content:space-between; align-items:flex-end;">
                                <div>
                                    <h2 style="color:#1e1b4b; margin:0; font-weight:900; text-transform:uppercase;">🏆 POSITION WISE WINNERS</h2>
                                    <p style="margin:0.15rem 0 0 0; font-size:0.72rem; color:#64748b; font-weight:600;">Position-wise prize distribution register including expanded group & general participants.</p>
                                </div>
                                <div style="text-align:right; font-size:0.75rem; font-weight:800; color:#4338ca;">
                                    Total Registered Entries: ${totalEntries}
                                </div>
                            </div>
                            ${sectionsHtml}
                        </div>
                        `;
                    }
                }

                else if (f.resultSubOption === 'Participants Without Major Prizes') {
                    const teamNamesMap = {};
                    allTeams.forEach(t => {
                        if (t.id) teamNamesMap[String(t.id)] = t.name;
                    });

                    const studentDataList = [];
                    Object.entries(studentMap).forEach(([studentId, stu]) => {
                        if (f.categoryId && stu.categoryId !== f.categoryId) return;
                        if (f.classId && stu.classId !== f.classId) return;
                        if (f.teamId && stu.teamId !== f.teamId) return;
                        if (f.gender === 'Boys' && stu.gender !== 'Male') return;
                        if (f.gender === 'Girls' && stu.gender !== 'Female') return;

                        const participations = [];
                        const prizes = [];

                        programs.forEach(p => {
                            const pList = participantsMap[p.id] || [];
                            const isPart = pList.some(part => {
                                if (part.isGroup === true || Array.isArray(part.members)) {
                                    if (part.members && part.members.length > 0) {
                                        return part.members.some(m => m.studentId === studentId || m.name === stu.name);
                                    } else {
                                        return stu.teamId && String(stu.teamId) === String(part.teamId);
                                    }
                                } else {
                                    return part.studentId === studentId || part.name === stu.name;
                                }
                            });
                            if (isPart) {
                                participations.push(p.programName);
                            }
                        });

                        filteredResults.forEach(r => {
                            const prog = allPrograms.find(p => p.id === r.programId);
                            if (!prog) return;

                            const winners = Array.isArray(r.winners) ? r.winners : [];
                            winners.forEach(w => {
                                const resolved = resolveWinnerParticipant(prog, w, participantsMap[r.programId || r.id], studentMap);
                                const isMember = resolved.memberStudents.some(mst => mst.studentId === studentId || mst.name === stu.name);
                                if (isMember) {
                                    prizes.push({
                                        position: w.position,
                                        isGeneral: (prog.categoryId === 'general_programs' || prog.programType === 'general' || r.categoryId === 'general_programs' || r.programType === 'general')
                                    });
                                }
                            });
                        });

                        const hasExcludedPrize = prizes.some(p => {
                            const excludedByPosition = f.includedPositions
                                ? f.includedPositions.includes(p.position)
                                : (p.position === 'First' || p.position === 'Second');
                            if (!excludedByPosition) return false;

                            if (p.isGeneral) {
                                return f.includedPositions && f.includedPositions.includes('General Programs');
                            }
                            return true;
                        });
                        if (hasExcludedPrize) return;

                        let statusLabel = '';
                        if (participations.length === 0) {
                            statusLabel = 'No Participation';
                        } else {
                            const hasThirdPrize = prizes.some(p => p.position === 'Third');
                            statusLabel = hasThirdPrize ? 'Third Prize Only' : 'No Prize';
                        }

                        studentDataList.push({
                            studentId: studentId,
                            chestNumber: stu.chestNumber || '—',
                            name: stu.name,
                            classId: stu.classId || 'standard',
                            className: stu.className || 'Standard',
                            categoryId: stu.categoryId || 'general',
                            categoryName: stu.categoryName || 'General',
                            teamName: teamNamesMap[String(stu.teamId)] || stu.teamName || 'Independent',
                            participationsCount: participations.length,
                            participationsList: participations,
                            status: statusLabel
                        });
                    });

                    if (studentDataList.length === 0) {
                        htmlContent = `
                        <div style="text-align:center; padding:4rem; color:#dc2626; border:1px solid #fecaca; border-radius:12px; background:#fef2f2;">
                            <h3 style="margin:0;">⚠️ No eligible students found.</h3>
                            <p style="color:#64748b; margin-top:0.25rem; font-weight:600;">All students have won major prizes or none matched filters.</p>
                        </div>
                    `;
                    } else {
                        htmlContent += `
                        <div class="participants-without-prizes-report-container">
                            <style>
                                .pwmp-print-header, .pwmp-print-footer { display: none; }
                                @media print {
                                    @page {
                                        margin: 15mm;
                                    }
                                    .participants-without-prizes-report-container {
                                        counter-reset: page;
                                    }
                                    .pwmp-print-header {
                                        display: block;
                                        position: fixed;
                                        top: 0;
                                        left: 0;
                                        right: 0;
                                        text-align: center;
                                        font-size: 10px;
                                        font-weight: bold;
                                        color: #94a3b8;
                                        text-transform: uppercase;
                                        padding-bottom: 5px;
                                    }
                                    .pwmp-print-footer {
                                        display: block;
                                        position: fixed;
                                        bottom: 0;
                                        left: 0;
                                        right: 0;
                                        text-align: center;
                                        font-size: 10px;
                                        font-weight: bold;
                                        color: #64748b;
                                        padding-top: 5px;
                                    }
                                    .pwmp-print-footer::after {
                                        content: "Page " counter(page);
                                    }
                                    body {
                                        padding-top: 20px;
                                        padding-bottom: 20px;
                                    }
                                }
                            </style>
                            <div class="pwmp-print-header">Participants Without Major Prizes</div>
                            <div class="pwmp-print-footer"></div>
                        `;

                        const grouped = {};
                        studentDataList.forEach(stu => {
                            const catId = stu.categoryId;
                            const catName = stu.categoryName;
                            const classId = stu.classId;
                            const className = stu.className;

                            if (!grouped[catId]) {
                                grouped[catId] = {
                                    name: catName,
                                    classes: {}
                                };
                            }

                            if (!grouped[catId].classes[classId]) {
                                grouped[catId].classes[classId] = {
                                    name: className,
                                    students: []
                                };
                            }

                            grouped[catId].classes[classId].students.push(stu);
                        });

                        const sortedCatIds = Object.keys(grouped).sort((a, b) => grouped[a].name.localeCompare(grouped[b].name));

                        sortedCatIds.forEach(catId => {
                            const cat = grouped[catId];

                            let noParticipationCount = 0;
                            let noPrizeCount = 0;
                            let thirdPrizeCount = 0;

                            Object.values(cat.classes).forEach(cls => {
                                cls.students.forEach(s => {
                                    if (s.status === 'No Participation') noParticipationCount++;
                                    else if (s.status === 'No Prize') noPrizeCount++;
                                    else if (s.status === 'Third Prize Only') thirdPrizeCount++;
                                });
                            });

                            const totalEligible = noParticipationCount + noPrizeCount + thirdPrizeCount;

                            htmlContent += `
                            <div class="program-page-standard" style="margin-bottom: 2rem;">
                                <div style="border-bottom:3px solid #1e1b4b; padding-bottom:0.5rem; margin-bottom:1rem; display:flex; justify-content:space-between; align-items:flex-end;">
                                    <div>
                                        <h2 style="color:#1e1b4b; margin:0; text-transform:uppercase; font-weight:900;">🏅 PARTICIPANTS WITHOUT MAJOR PRIZES</h2>
                                        <h3 style="color:#4338ca; margin-top:0.25rem; font-size:1.1rem; font-weight:700;">${window.escapeHTML(cat.name)}</h3>
                                    </div>
                                    <div class="summary-section" style="background:#f1f5f9; border:1px solid #cbd5e1; border-radius:8px; padding:0.5rem 0.75rem; font-size:0.75rem; color:#334155; line-height:1.45; min-width:200px;">
                                        <div style="font-weight:800; text-transform:uppercase; border-bottom:1.5px solid #cbd5e1; padding-bottom:0.2rem; margin-bottom:0.3rem; color:#1e1b4b;">Category Summary</div>
                                        <div>No Participation: <strong>${noParticipationCount}</strong></div>
                                        <div>No Prize: <strong>${noPrizeCount}</strong></div>
                                        <div>Third Prize Only: <strong>${thirdPrizeCount}</strong></div>
                                        <div style="font-weight:700; color:#4338ca; margin-top:0.25rem;">Total Eligible: <strong>${totalEligible}</strong></div>
                                    </div>
                                </div>
                        `;

                            const sortedClassIds = Object.keys(cat.classes).sort((a, b) => {
                                const nameA = cat.classes[a].name;
                                const nameB = cat.classes[b].name;
                                return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
                            });

                            sortedClassIds.forEach(classId => {
                                const cls = cat.classes[classId];

                                const statusPriority = {
                                    'No Participation': 1,
                                    'No Prize': 2,
                                    'Third Prize Only': 3
                                };
                                const students = [...cls.students].sort((a, b) => {
                                    const pA = statusPriority[a.status] || 99;
                                    const pB = statusPriority[b.status] || 99;
                                    if (pA !== pB) return pA - pB;
                                    return a.name.localeCompare(b.name);
                                });

                                const statusColors = {
                                    'No Participation': '#64748b',
                                    'No Prize': '#475569',
                                    'Third Prize Only': '#b45309'
                                };

                                htmlContent += `
                                <div style="margin-left:0.5rem; margin-top:0.75rem; margin-bottom:0.75rem;">
                                    <h4 style="color:#1e1b4b; font-size:0.85rem; font-weight:800; margin-bottom:0.35rem;">Class: ${window.escapeHTML(cls.name)}</h4>
                                    
                                    <table class="report-table" style="margin-top:0; margin-bottom:0.5rem; width:100%;">
                                        <thead>
                                            <tr>
                                                <th style="width:70px; text-align:center;">Chest No</th>
                                                <th>Student Name</th>
                                                <th>Team / House</th>
                                                <th style="width:80px; text-align:center;">Participations</th>
                                                <th style="width:130px; text-align:center;">Status</th>
                                                <th>Programs Participated</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${students.map(s => `
                                                <tr>
                                                    <td style="text-align:center; font-weight:900; color:#0f172a;">${window.escapeHTML(s.chestNumber)}</td>
                                                    <td style="font-weight:800; color:#1e1b4b;">${window.escapeHTML(s.name)} - ${window.escapeHTML(s.className)}</td>
                                                    <td style="font-weight:700; color:#475569;">${window.escapeHTML(s.teamName)}</td>
                                                    <td style="text-align:center; font-weight:800; color:#4338ca;">${s.participationsCount}</td>
                                                    <td style="text-align:center; font-weight:700; color:${statusColors[s.status] || '#475569'}; font-size:0.75rem;">${s.status}</td>
                                                    <td style="font-size:0.72rem; color:#475569; font-weight:500;">${window.escapeHTML(s.participationsList.join(', ') || 'None')}</td>
                                                </tr>
                                            `).join('')}
                                        </tbody>
                                    </table>
                                </div>
                            `;
                            });

                            htmlContent += `</div>`;
                        });
                        htmlContent += `</div>`;
                    }
                }
            }
        }
    }

    // ─────────────────────────────────────────────
    // Hidden Iframe Print Engine execution (Phase 8 popup blocker fix)
    // ─────────────────────────────────────────────
    const printIframe = getPrintIframe();
    const doc = printIframe.contentDocument || printIframe.contentWindow.document;

    // Dynamic absolute millimetric page budgets to guarantee zero overflows or page fractures (Phase 4)
    const gridSheetHeight = orientation === 'portrait' ? '280mm' : '193mm';
    const pageMargin = f.type === 'Valuation Sheet' ? '5mm' : (f.type === 'Green Room Sign' ? '10mm' : '15mm');

    // Standard Styles Injection for dynamic high-fidelity printing
    const styleBlock = `
        <style>
            @page {
                size: A4 ${orientation};
                margin: ${f.type === 'Call List' ? '12mm 0 0 0 !important' : '0'};
            }
            body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                color: #000;
                margin: 0;
                padding: ${f.type === 'Call List' ? '0 15mm 15mm 15mm' : pageMargin};
                box-sizing: border-box;
                background: #fff;
                font-size: ${f.type === 'Green Room Sign' ? '0.75rem' : '0.85rem'};
                line-height: ${f.type === 'Green Room Sign' ? '1.25' : '1.4'};
            }
            h2, h3, h4 {
                margin: 0;
                color: #1e1b4b;
            }
            .report-table {
                width: 100%;
                border-collapse: collapse;
                margin-top: 1rem;
                font-size: 0.8rem;
            }
            .report-table th, .report-table td {
                border: 1px solid #cbd5e1;
                padding: 0.5rem 0.6rem;
                text-align: left;
                vertical-align: middle;
            }
            .report-table th {
                background-color: #f8fafc !important;
                color: #475569;
                font-weight: 800;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }
            .report-table tr {
                page-break-inside: avoid;
                break-inside: avoid;
            }
            .report-header {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                border-bottom: 2px solid #4338ca;
                padding-bottom: 0.5rem;
                margin-bottom: 1.25rem;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }
            .report-title {
                font-weight: 900;
                font-size: 1.15rem;
                color: #4338ca;
                text-transform: uppercase;
                letter-spacing: 0.05em;
            }
            
            /* Custom Large Badges for Call List */
            .call-chest-badge {
                display: inline-block;
                font-size: 1.05rem;
                font-weight: 800;
                color: #1e1b4b;
                background: #f1f5f9;
                border: 1px solid #cbd5e1;
                padding: 0.1rem 0.35rem;
                border-radius: 4px;
                text-align: center;
                min-width: 44px;
            }
            .call-list-table th, .call-list-table td {
                padding: 0.2rem 0.4rem !important;
            }
            .call-student-list {
                display: flex;
                flex-direction: column;
                gap: 0.05rem;
                padding: 0.05rem 0;
            }
            .call-student-item {
                display: flex;
                align-items: flex-start;
                padding: 0.1rem 0;
                border-bottom: 1px solid #f1f5f9;
            }
            .call-student-item:last-child {
                border-bottom: none;
            }
            .call-student-num {
                display: inline-block;
                min-width: 18px;
                font-size: 0.72rem;
                font-weight: 700;
                color: #475569;
                background: none;
                border: none;
                border-radius: 0;
                margin-right: 0.35rem;
                flex-shrink: 0;
                line-height: 1.25;
            }
            .call-student-name {
                flex: 1;
                font-size: 0.72rem;
                font-weight: 700;
                color: #1e1b4b;
                word-break: break-word;
                white-space: normal;
                line-height: 1.25;
            }

            ${f.type === 'Green Room Sign' ? `
            .report-table {
                margin-top: 0.4rem !important;
                font-size: 0.75rem !important;
            }
            .report-table th, .report-table td {
                border: 1px solid #000 !important;
                padding: 0.3rem 0.4rem !important;
            }
            .report-table th {
                background-color: #f5f5f5 !important;
                color: #000 !important;
            }
            .program-card-compact {
                margin-bottom: 0.75rem !important;
                border-bottom: 1.5px dashed #000 !important;
                padding-bottom: 0.5rem !important;
            }
            ` : ''}

            /* Compact A4 Packing Mode Styles */
            .program-card-compact {
                margin-bottom: 0.75rem;
                border-bottom: 1.5px dashed #cbd5e1;
                padding-bottom: 0.5rem;
                page-break-inside: avoid;
                break-inside: avoid;
            }
            .program-card-compact:last-child {
                border-bottom: none;
                padding-bottom: 0;
            }
            .program-page-standard {
                page-break-after: always;
                break-after: page;
            }
            .program-page-standard:last-child {
                page-break-after: avoid;
                break-after: page-inside;
            }

            /* Compact Class Award Card Styles */
            .class-award-card {
                margin-bottom: 0.85rem;
                padding-bottom: 0.6rem;
                border-bottom: 1px dashed #cbd5e1;
                page-break-inside: avoid;
                break-inside: avoid;
                width: 100%;
            }
            .class-award-card:last-child {
                border-bottom: none;
                margin-bottom: 0;
                padding-bottom: 0;
            }

            /* Valuation 2x2 grid layout sheets (Phase 3 & 4 Redesign) */
            .valuation-grid-sheet-2x2 {
                display: grid;
                grid-template-columns: 1fr 1fr;
                grid-template-rows: 1fr 1fr;
                gap: 6mm; /* Tighter layout */
                height: ${gridSheetHeight}; /* Absolute mm print margin budget */
                width: 100%;
                box-sizing: border-box;
                padding: 2px;
                page-break-after: always;
                break-after: page;
                page-break-inside: avoid;
                break-inside: avoid;
            }
            .valuation-grid-sheet-2x2:last-child {
                page-break-after: avoid;
            }

            .valuation-grid-sheet-2x2 .val-card {
                height: 100% !important;
            }

            /* Core Valuation Card Styles */
            .val-card {
                border: 1.5px solid #475569; /* Crisp clean border grids */
                border-radius: 8px;
                padding: 8px; /* Tighter margins to maximize evaluation tables */
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                background: #ffffff;
                page-break-inside: avoid;
                break-inside: avoid;
            }
            .val-card-header {
                display: flex;
                flex-direction: column;
                margin-bottom: 0.15rem;
            }
            .val-card-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 0.65rem;
                margin-top: 0.25rem;
            }
            .val-card-table th, .val-card-table td {
                border: 1px solid #cbd5e1;
                padding: 0.2rem 0.35rem; /* Tighter column details */
                text-align: left;
            }
            .val-card-table th {
                background-color: #f1f5f9 !important; /* Beautiful headers background */
                font-weight: 800;
                color: #475569;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }
        </style>
    `;

    doc.open();
    doc.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>${window.escapeHTML(exp.fileName)}</title>
            ${styleBlock}
        </head>
        <body>
            <div style="max-width:100%; margin: 0 auto; box-sizing:border-box;">
                ${htmlContent}
            </div>
        </body>
        </html>
    `);
    doc.close();

    if (isDownload) {
        setTimeout(async () => {
            try {
                window.showToast("Preparing PDF download...", "info");

                const prevWidth = printIframe.style.width;
                const prevHeight = printIframe.style.height;

                if ((orientation || 'portrait') === 'landscape') {
                    printIframe.style.width = '1123px';
                } else {
                    printIframe.style.width = '794px';
                }
                printIframe.style.height = 'auto';
                await new Promise(resolve => setTimeout(resolve, 150));

                const scrollHeight = Math.max(
                    doc.body.scrollHeight,
                    doc.documentElement.scrollHeight,
                    doc.body.offsetHeight,
                    doc.documentElement.offsetHeight
                );
                printIframe.style.height = (scrollHeight + 100) + 'px';
                await new Promise(resolve => setTimeout(resolve, 50));

                const html2pdf = await loadHtml2Pdf();
                const opt = {
                    margin: 10,
                    filename: exp.fileName || 'export.pdf',
                    image: { type: 'jpeg', quality: 0.98 },
                    html2canvas: { scale: 1.5, useCORS: true, logging: false, scrollX: 0, scrollY: 0 },
                    jsPDF: { unit: 'mm', format: 'a4', orientation: orientation || 'portrait' },
                    pagebreak: { mode: ['css', 'legacy'] }
                };
                const element = doc.body;

                if (f && (f.type === 'Results' || f.reportType === 'results')) {
                    await html2pdf().set(opt).from(element).toPdf().get('pdf').then(function (pdf) {
                        const totalPages = pdf.internal.getNumberOfPages();
                        for (let i = 1; i <= totalPages; i++) {
                            pdf.setPage(i);
                            pdf.setFontSize(10);
                            pdf.setTextColor(100);
                            if (f.resultSubOption === 'Prize Distribution Register') {
                                pdf.text('POSITION WISE WINNERS', 15, 8);
                            }
                            pdf.text(i + '/' + totalPages, pdf.internal.pageSize.getWidth() - 25, pdf.internal.pageSize.getHeight() - 5, { align: 'right' });
                        }
                    }).save();
                } else {
                    await html2pdf().set(opt).from(element).save();
                }

                printIframe.style.width = prevWidth;
                printIframe.style.height = prevHeight;
            } catch (err) {
                console.error("PDF generation failed, falling back to print dialog:", err);
                try {
                    printIframe.contentWindow.focus();
                    printIframe.contentWindow.print();
                } catch (printErr) {
                    console.warn("Print dialog could not be opened:", printErr);
                }
            }
        }, 500);
    } else {
        setTimeout(() => {
            try {
                printIframe.contentWindow.focus();
                printIframe.contentWindow.print();
            } catch (printErr) {
                console.warn("Print dialog could not be opened:", printErr);
            }
        }, 300);
    }
}

// ─────────────────────────────────────────────
// CSV Dynamic Spreadsheet Blob Generator
// ─────────────────────────────────────────────
async function compileCSV(exp, f, programs, resultsList, participantsMap, studentMap = {}, classAwards = []) {
    let csvContent = '';

    if (f.type === 'Chest Number List') {
        csvContent += "INSTITUTION,CATEGORY,CLASS,TEAM,GENDER,SL NO,CHEST NUMBER,PARTICIPANT NAME\n";

        let studentsList = Object.values(studentMap);

        if (f.categoryId) {
            studentsList = studentsList.filter(s => s.categoryId === f.categoryId);
        }
        if (f.classId) {
            studentsList = studentsList.filter(s => s.classId === f.classId);
        }
        if (f.teamId) {
            studentsList = studentsList.filter(s => String(s.teamId) === String(f.teamId));
        }
        if (f.gender === 'Boys') {
            studentsList = studentsList.filter(s => s.gender === 'Male');
        } else if (f.gender === 'Girls') {
            studentsList = studentsList.filter(s => s.gender === 'Female');
        }

        const teamNamesMap = {};
        allTeams.forEach(t => {
            if (t.id) teamNamesMap[String(t.id)] = t.name;
        });

        // Sort students according to chestSort parameter
        // Sort systematically: Category ➔ Class ➔ Team ➔ Sort Rule
        studentsList.sort((a, b) => {
            const idxA = allCategories.findIndex(c => c.id === a.categoryId || c.name === a.categoryId || c.name === a.categoryName);
            const idxB = allCategories.findIndex(c => c.id === b.categoryId || c.name === b.categoryId || c.name === b.categoryName);
            if (idxA !== idxB) {
                return idxA - idxB;
            }

            const classA = a.className || '';
            const classB = b.className || '';
            const classComp = classA.localeCompare(classB, undefined, { numeric: true });
            if (classComp !== 0) return classComp;

            const teamNameA = teamNamesMap[String(a.teamId)] || a.teamName || '';
            const teamNameB = teamNamesMap[String(b.teamId)] || b.teamName || '';
            const teamComp = teamNameA.localeCompare(teamNameB);
            if (teamComp !== 0) return teamComp;

            const sortRule = f.chestSort || 'chest';
            if (sortRule === 'chest') {
                const numA = parseInt(a.chestNumber, 10);
                const numB = parseInt(b.chestNumber, 10);
                const hasA = !isNaN(numA);
                const hasB = !isNaN(numB);
                if (hasA && hasB) return numA - numB;
                if (hasA) return -1;
                if (hasB) return 1;
                return (a.chestNumber || '').localeCompare(b.chestNumber || '');
            } else if (sortRule === 'name') {
                return (a.name || '').localeCompare(b.name || '');
            }
            return 0;
        });

        const instName = getEventName();

        studentsList.forEach((stu, idx) => {
            const catName = stu.categoryName || 'General';
            const className = stu.className || 'Standard';
            const teamName = teamNamesMap[String(stu.teamId)] || stu.teamName || 'Independent';
            csvContent += `"${instName.replace(/"/g, '""')}","${catName.replace(/"/g, '""')}","${className.replace(/"/g, '""')}","${teamName.replace(/"/g, '""')}","${(stu.gender || '').replace(/"/g, '""')}",${idx + 1},"${(stu.chestNumber || '').replace(/"/g, '""')}","${(stu.name || '').replace(/"/g, '""')}"\n`;
        });

        // Trigger standard File Download Blob
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", exp.fileName);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
    } else if (f.type === 'Program Participation Register') {
        if (f.progRegSubmode === 'list') {
            let csvContent = "\uFEFF";
            csvContent += "CATEGORY,PROGRAM NUMBER,PROGRAM NAME,GENDER,STAGE / OFF STAGE\n";

            const categoryGroups = {};
            programs.forEach(p => {
                let catName = 'GENERAL';
                if (p.categoryId === 'general_programs' || p.programType === 'general') {
                    catName = 'GENERAL';
                } else {
                    const cat = allCategories.find(c => c.id === p.categoryId);
                    catName = cat ? cat.name : (p.categoryName || 'GENERAL');
                }

                if (!categoryGroups[catName]) {
                    categoryGroups[catName] = [];
                }
                categoryGroups[catName].push(p);
            });

            // Sort Category sections: General first, then by minimum assigned class/standard
            const sortedCatNames = Object.keys(categoryGroups).sort(compareCategoriesByMinClass);

            sortedCatNames.forEach(catName => {
                categoryGroups[catName].sort((a, b) => {
                    const isStageA = (a.programLocation || a.location || 'Stage').toLowerCase() === 'stage' ? 0 : 1;
                    const isStageB = (b.programLocation || b.location || 'Stage').toLowerCase() === 'stage' ? 0 : 1;
                    if (isStageA !== isStageB) {
                        return isStageA - isStageB;
                    }

                    const numA = String(a.programNumber ?? '').trim();
                    const numB = String(b.programNumber ?? '').trim();
                    if (numA && numB) {
                        const cmp = numA.localeCompare(numB, undefined, { numeric: true, sensitivity: 'base' });
                        if (cmp !== 0) return cmp;
                    } else if (numA) {
                        return -1;
                    } else if (numB) {
                        return 1;
                    }
                    return (a.programName || '').localeCompare(b.programName || '');
                });

                categoryGroups[catName].forEach(p => {
                    const catEsc = `"${catName.replace(/"/g, '""')}"`;
                    const numEsc = `"${String(p.programNumber ?? '').replace(/"/g, '""')}"`;
                    const nameEsc = `"${(p.programName || '').replace(/"/g, '""')}"`;
                    const genEsc = `"${getProgramGenderDisplay(p).replace(/"/g, '""')}"`;
                    const locEsc = `"${(p.programLocation || 'Stage').replace(/"/g, '""')}"`;
                    csvContent += `${catEsc},${numEsc},${nameEsc},${genEsc},${locEsc}\n`;
                });
            });

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement("a");
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", exp.fileName);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            return;
        } else if (f.progRegSubmode === 'student_summary') {
            let csvContent = "\uFEFF";
            csvContent += "SL.NO,CHEST NUMBER,STUDENT NAME,CLASS / STANDARD,GENDER,TEAM,PROGRAM LIST\n";

            const teamNamesMap = {};
            allTeams.forEach(t => {
                if (t.id) teamNamesMap[String(t.id)] = t.name;
            });

            let studentsList = Object.values(studentMap);

            if (f.categoryId) {
                const targetCat = allCategories.find(c => c.id === f.categoryId);
                const targetCatName = (targetCat ? targetCat.name : f.categoryId).trim().toLowerCase();
                studentsList = studentsList.filter(s =>
                    s.categoryId === f.categoryId || s.category === f.categoryId || (s.category || '').trim().toLowerCase() === targetCatName
                );
            }

            if (f.classId) {
                studentsList = studentsList.filter(s => s.classId === f.classId || s.class === f.classId);
            }

            if (f.teamId) {
                studentsList = studentsList.filter(s => String(s.teamId) === String(f.teamId));
            }

            if (f.gender === 'Boys') {
                studentsList = studentsList.filter(s => s.gender === 'Male' || s.gender === 'Boys');
            } else if (f.gender === 'Girls') {
                studentsList = studentsList.filter(s => s.gender === 'Female' || s.gender === 'Girls');
            }

            const studentByDocId = new Map();
            const studentByChest = new Map();

            studentsList.forEach(s => {
                if (s.id) studentByDocId.set(String(s.id), s);
                if (s.chestNumber) studentByChest.set(String(s.chestNumber).trim().toLowerCase(), s);
            });

            const studentProgramsMap = new Map();
            studentsList.forEach(s => {
                if (s.id) studentProgramsMap.set(String(s.id), []);
            });

            const validProgramIds = new Set(programs.map(p => p.id));

            for (const progId in participantsMap) {
                if (!validProgramIds.has(progId)) continue;
                const prog = allPrograms.find(pr => pr.id === progId);
                if (!prog) continue;

                const pList = participantsMap[progId] || [];
                pList.forEach(p => {
                    if (!p.isGroup) {
                        const matchedStudent = (p.studentId && studentByDocId.get(String(p.studentId)))
                            || (p.id && studentByDocId.get(String(p.id)))
                            || (p.chestNumber && studentByChest.get(String(p.chestNumber).trim().toLowerCase()));

                        if (matchedStudent && studentProgramsMap.has(String(matchedStudent.id))) {
                            studentProgramsMap.get(String(matchedStudent.id)).push(prog);
                        }
                    } else {
                        if (Array.isArray(p.members)) {
                            p.members.forEach(m => {
                                const matchedStudent = (m.studentId && studentByDocId.get(String(m.studentId)))
                                    || (m.id && studentByDocId.get(String(m.id)))
                                    || (m.chestNumber && studentByChest.get(String(m.chestNumber).trim().toLowerCase()));

                                if (matchedStudent && studentProgramsMap.has(String(matchedStudent.id))) {
                                    studentProgramsMap.get(String(matchedStudent.id)).push(prog);
                                }
                            });
                        }
                    }
                });
            }

            studentsList.forEach(s => {
                if (!s.id) return;
                const rawProgs = studentProgramsMap.get(String(s.id)) || [];
                const uniqueMap = new Map();
                rawProgs.forEach(p => {
                    if (!uniqueMap.has(p.id)) {
                        uniqueMap.set(p.id, p);
                    }
                });
                const arr = Array.from(uniqueMap.values());
                arr.sort((a, b) => {
                    const numA = String(a.programNumber ?? '').trim();
                    const numB = String(b.programNumber ?? '').trim();
                    if (numA && numB) {
                        const cmp = numA.localeCompare(numB, undefined, { numeric: true, sensitivity: 'base' });
                        if (cmp !== 0) return cmp;
                    }
                    return (a.programName || '').localeCompare(b.programName || '');
                });
                studentProgramsMap.set(String(s.id), arr);
            });

            studentsList.sort((a, b) => {
                const classA = String(a.className || a.class || a.classId || '').trim();
                const classB = String(b.className || b.class || b.classId || '').trim();
                const classCmp = classA.localeCompare(classB, undefined, { numeric: true, sensitivity: 'base' });
                if (classCmp !== 0) return classCmp;

                const chestA = String(a.chestNumber || '').trim();
                const chestB = String(b.chestNumber || '').trim();
                return chestA.localeCompare(chestB, undefined, { numeric: true, sensitivity: 'base' });
            });

            studentsList.forEach((s, idx) => {
                const progs = studentProgramsMap.get(String(s.id)) || [];
                const totalProgs = progs.length;
                const progNames = totalProgs > 0
                    ? progs.map(p => p.programName).join(', ')
                    : '—';
                const teamName = teamNamesMap[String(s.teamId)] || s.teamName || '—';
                const className = s.className || s.class || s.classId || '—';
                const genderDisplay = s.gender === 'Male' ? 'Boys' : (s.gender === 'Female' ? 'Girls' : (s.gender || '—'));

                const slEsc = `"${idx + 1}"`;
                const chestEsc = `"${String(s.chestNumber || '—').replace(/"/g, '""')}"`;
                const nameEsc = `"${String(s.name || '—').replace(/"/g, '""')}"`;
                const teamEsc = `"${String(teamName).replace(/"/g, '""')}"`;
                const classEsc = `"${String(className).replace(/"/g, '""')}"`;
                const genEsc = `"${String(genderDisplay).replace(/"/g, '""')}"`;
                const progsEsc = `"${String(progNames).replace(/"/g, '""')}"`;

                csvContent += `${slEsc},${chestEsc},${nameEsc},${classEsc},${genEsc},${teamEsc},${progsEsc}\n`;
            });

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement("a");
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", exp.fileName);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            return;
        } else {
            const isRegistered = (studentId, progId) => {
                const parts = participantsMap[progId] || [];
                return parts.some(part => {
                    if (part.isGroup) {
                        return (part.members || []).some(m => m.studentId === studentId);
                    } else {
                        return part.studentId === studentId;
                    }
                });
            };

            // Get matching programs first (Combine Stage & Off Stage columns)
            let matchingPrograms = [...programs];
            if (f.participationType) {
                if (f.participationType === 'general') {
                    matchingPrograms = matchingPrograms.filter(p => p.categoryId === 'general_programs' || p.programType === 'general');
                } else if (f.participationType === 'group') {
                    matchingPrograms = matchingPrograms.filter(p => p.programType === 'group');
                } else if (f.participationType === 'individual') {
                    matchingPrograms = matchingPrograms.filter(p => p.programType === 'individual');
                }
            }

            const stageProgs = matchingPrograms.filter(p => (p.programLocation || p.location || 'Off Stage') === 'Stage');
            const offStageProgs = matchingPrograms.filter(p => (p.programLocation || p.location || 'Off Stage') !== 'Stage');

            stageProgs.sort((a, b) => (a.programName || '').localeCompare(b.programName || ''));
            offStageProgs.sort((a, b) => (a.programName || '').localeCompare(b.programName || ''));

            const columnItems = [];
            stageProgs.forEach(p => columnItems.push({ type: 'program', program: p }));

            if (stageProgs.length > 0 && offStageProgs.length > 0) {
                columnItems.push({ type: 'separator' });
            }
            offStageProgs.forEach(p => columnItems.push({ type: 'program', program: p }));

            if (f.categoryId === 'general_programs') {
                csvContent += "INSTITUTION,CATEGORY,CLASS,TEAM,GENDER,SL NO,CHEST NUMBER,PARTICIPANT NAME";

                // Append program names to CSV header
                columnItems.forEach(item => {
                    if (item.type === 'separator') {
                        csvContent += `,""`;
                    } else {
                        const p = item.program;
                        const cleanLabel = p.programNumber ? `${p.programNumber} – ${p.programName}` : p.programName;
                        csvContent += `,"${cleanLabel.replace(/"/g, '""')}"`;
                    }
                });
                csvContent += "\n";

                const instName = getEventName();
                const teamName = f.teamId ? (allTeams.find(t => t.id === f.teamId)?.name || '') : '';

                for (let idx = 0; idx < 25; idx++) {
                    csvContent += `"${instName.replace(/"/g, '""')}","GENERAL PROGRAMS (NON-CATEGORY)","","${teamName.replace(/"/g, '""')}","",${idx + 1},"",""`;
                    columnItems.forEach(() => {
                        csvContent += `,""`;
                    });
                    csvContent += "\n";
                }

                // Trigger standard File Download Blob
                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement("a");
                const url = URL.createObjectURL(blob);
                link.setAttribute("href", url);
                link.setAttribute("download", exp.fileName);
                link.style.visibility = 'hidden';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                return;
            }

            csvContent += "INSTITUTION,CATEGORY,CLASS,TEAM,GENDER,SL NO,CHEST NUMBER,PARTICIPANT NAME";

            // Append program names to CSV header
            columnItems.forEach(item => {
                if (item.type === 'separator') {
                    csvContent += `,""`;
                } else {
                    const p = item.program;
                    const cleanLabel = p.programNumber ? `${p.programNumber} – ${p.programName}` : p.programName;
                    csvContent += `,"${cleanLabel.replace(/"/g, '""')}"`;
                }
            });
            csvContent += "\n";

            let studentsList = Object.values(studentMap);

            if (f.categoryId === 'general_programs' || f.participationType === 'general') {
                const registeredStudentIds = new Set();
                matchingPrograms.forEach(p => {
                    const parts = participantsMap[p.id] || [];
                    parts.forEach(part => {
                        if (part.isGroup) {
                            (part.members || []).forEach(m => {
                                if (m.studentId) registeredStudentIds.add(m.studentId);
                            });
                        } else {
                            if (part.studentId) registeredStudentIds.add(part.studentId);
                        }
                    });
                });
                studentsList = studentsList.filter(s => registeredStudentIds.has(s.id));
                if (f.categoryId && f.categoryId !== 'general_programs') {
                    studentsList = studentsList.filter(s => s.categoryId === f.categoryId);
                }
            } else if (f.categoryId) {
                studentsList = studentsList.filter(s => s.categoryId === f.categoryId);
            }

            if (f.classId) {
                studentsList = studentsList.filter(s => s.classId === f.classId);
            }
            if (f.teamId) {
                studentsList = studentsList.filter(s => String(s.teamId) === String(f.teamId));
            }
            if (f.gender === 'Boys') {
                studentsList = studentsList.filter(s => s.gender === 'Male');
            } else if (f.gender === 'Girls') {
                studentsList = studentsList.filter(s => s.gender === 'Female');
            }

            const teamNamesMap = {};
            allTeams.forEach(t => {
                if (t.id) teamNamesMap[String(t.id)] = t.name;
            });

            // Sort systematically: Category ➔ Class ➔ Team ➔ Sort Rule
            studentsList.sort((a, b) => {
                const idxA = allCategories.findIndex(c => c.id === a.categoryId || c.name === a.categoryId || c.name === a.categoryName);
                const idxB = allCategories.findIndex(c => c.id === b.categoryId || c.name === b.categoryId || c.name === b.categoryName);
                if (idxA !== idxB) {
                    return idxA - idxB;
                }

                const classA = a.className || '';
                const classB = b.className || '';
                const classComp = classA.localeCompare(classB, undefined, { numeric: true });
                if (classComp !== 0) return classComp;

                const teamNameA = teamNamesMap[String(a.teamId)] || a.teamName || '';
                const teamNameB = teamNamesMap[String(b.teamId)] || b.teamName || '';
                const teamComp = teamNameA.localeCompare(teamNameB);
                if (teamComp !== 0) return teamComp;

                const sortRule = f.chestSort || 'chest';
                if (sortRule === 'chest') {
                    const numA = parseInt(a.chestNumber, 10);
                    const numB = parseInt(b.chestNumber, 10);
                    const hasA = !isNaN(numA);
                    const hasB = !isNaN(numB);
                    if (hasA && hasB) return numA - numB;
                    if (hasA) return -1;
                    if (hasB) return 1;
                    return (a.chestNumber || '').localeCompare(b.chestNumber || '');
                } else if (sortRule === 'name') {
                    return (a.name || '').localeCompare(b.name || '');
                }
                return 0;
            });

            const instName = getEventName();

            studentsList.forEach((stu, idx) => {
                const catName = stu.categoryName || 'General';
                const className = stu.className || 'Standard';
                const teamName = teamNamesMap[String(stu.teamId)] || stu.teamName || 'Independent';

                // Build base row
                csvContent += `"${instName.replace(/"/g, '""')}","${catName.replace(/"/g, '""')}","${className.replace(/"/g, '""')}","${teamName.replace(/"/g, '""')}","${(stu.gender || '').replace(/"/g, '""')}",${idx + 1},"${(stu.chestNumber || '').replace(/"/g, '""')}","${(stu.name || '').replace(/"/g, '""')}"`;

                // Append program checkmarks
                columnItems.forEach(item => {
                    if (item.type === 'separator') {
                        csvContent += `,""`;
                    } else {
                        const p = item.program;
                        const registered = isRegistered(stu.id, p.id);
                        csvContent += registered ? ',"✔"' : ',""';
                    }
                });
                csvContent += "\n";
            });

            // Trigger standard File Download Blob
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement("a");
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", exp.fileName);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            return;
        }
    }

    if (f.type === 'Green Room Sign') {
        csvContent += "PROGRAM,CATEGORY,TYPE,SL NO,CHEST NUMBER,PARTICIPANT NAME,CODE LETTER,SIGNATURE\n";

        programs.forEach(p => {
            const parts = participantsMap[p.id] || [];
            parts.forEach((item, idx) => {
                csvContent += `"${p.programName}","${p.categoryName}","${p.type}",${idx + 1},"${item.chestNumber || '—'}","${item.name}","",""\n`;
            });
        });
    }

    else if (f.type === 'Valuation Sheet') {
        csvContent += "PROGRAM,CATEGORY,TYPE,SL NO,CODE LETTER,MARK,TOTAL\n";

        programs.forEach(p => {
            const parts = participantsMap[p.id] || [];
            parts.forEach((item, idx) => {
                csvContent += `"${p.programName}","${p.categoryName}","${p.type}",${idx + 1},"","",""\n`;
            });
        });
    }

    else if (f.type === 'Call List') {
        csvContent += "PROGRAM,CATEGORY,TYPE,SL NO,CHEST NUMBER,PARTICIPANT NAME,CLASS,TEAM NAME\n";

        programs.forEach(p => {
            const parts = participantsMap[p.id] || [];
            parts.forEach((item, idx) => {
                const resolvedStudent = item.studentId ? studentMap[item.studentId] : null;
                const className = resolvedStudent ? (resolvedStudent.className || resolvedStudent.classId || '—') : '—';
                csvContent += `"${p.programName}","${p.categoryName}","${p.type}",${idx + 1},"${item.chestNumber || '—'}","${item.name}","${className}","${item.teamName || ''}"\n`;
            });
        });
    }

    else if (f.type === 'Results') {
        const filteredResults = filterResultsBySource(resultsList, f);

        if (f.resultSubOption === 'Team Wise') {
            csvContent += "CHEST NUMBER,STUDENT / GROUP NAME,TEAM,CATEGORY,POSITION,PROGRAM\n";

            const teamWinners = new Map();
            filteredResults.forEach(r => {
                let winners = Array.isArray(r.winners) ? r.winners : [];
                if (f.includedPositions) winners = winners.filter(w => f.includedPositions.includes(w.position));
                winners.forEach(w => {
                    if (!w.teamName) return;
                    if (f.teamId && w.teamId !== f.teamId) return;

                    const prog = allPrograms.find(p => p.id === r.programId);
                    if (!prog) return;

                    const resolved = resolveWinnerParticipant(prog, w, participantsMap[r.programId || r.id], studentMap);

                    if (!teamWinners.has(resolved.teamName)) {
                        teamWinners.set(resolved.teamName, []);
                    }
                    teamWinners.get(resolved.teamName).push({
                        position: w.position,
                        programName: r.programName,
                        categoryName: r.categoryName,
                        studentName: resolved.displayName,
                        chestNumber: resolved.chestNumbers
                    });
                });
            });

            const sortedTeams = [...teamWinners.keys()].sort();
            sortedTeams.forEach(teamName => {
                const entries = teamWinners.get(teamName);
                entries.forEach(e => {
                    csvContent += `"${e.chestNumber}","${e.studentName}","${teamName}","${e.categoryName}","${e.position}","${e.programName}"\n`;
                });
            });
        }

        else if (f.resultSubOption === 'Program Wise') {
            csvContent += "POSITION,CALL LETTER,CHEST NUMBER,STUDENT / TEAM NAME,TEAM,GRADE,MARKS\n";

            filteredResults.forEach(r => {
                let winnersList = Array.isArray(r.winners) ? r.winners : [];
                if (f.includedPositions) winnersList = winnersList.filter(w => f.includedPositions.includes(w.position));
                const combinedWinners = [...winnersList];

                if (r.gradeMode !== 'none' && Array.isArray(r.marksData)) {
                    r.marksData.forEach(m => {
                        if (!m.grade || m.grade === 'none' || String(m.grade).trim() === '') return;
                        const isWinner = winnersList.some(w => {
                                    const mId = m.studentId || m.groupId || m.id || '';
                                    const wId = w.studentId || w.groupId || w.id || '';
                                    const mName = m.studentName || m.groupName || m.name || '';
                                    const wName = w.studentName || w.groupName || w.name || '';
                                    const mTeam = m.teamName || '';
                                    const wTeam = w.teamName || '';

                                    if (r.programType === 'group' || r.type === 'Group') {
                                        return (mTeam && wTeam && mTeam === wTeam) || (mId && wId && mId === wId) || (mName && wName && mName === wName);
                                    } else {
                                        return (mId && wId && mId === wId) || (mName && wName && mName === wName);
                                    }
                                });
                        if (!isWinner) {
                            combinedWinners.push({
                                position: String(m.grade).trim() + ' Grade',
                                studentId: m.studentId,
                                studentName: m.studentName,
                                teamName: m.teamName,
                                teamId: m.teamId,
                                chestNumbers: m.chestNumbers || m.chestNumber,
                                marks: m.totalPoints !== undefined ? m.totalPoints : 0,
                                grade: m.grade,
                                codeLetter: m.codeLetter,
                                isGradeOnly: true
                            });
                        }
                    });
                }

                const posOrder = { 'First': 1, 'Second': 2, 'Third': 3 };
                const getGradePriority = (grade) => {
                    if (!grade) return 99;
                    const g = String(grade).toUpperCase().trim();
                    if (g.startsWith('A')) return 1;
                    if (g.startsWith('B')) return 2;
                    if (g.startsWith('C')) return 3;
                    return 4;
                };

                let finalWinners = combinedWinners;
                if (f.gender && f.gender !== 'Mixed' && f.gender !== 'All' && f.gender !== 'All Genders') {
                    const targetGender = f.gender === 'Boys' ? 'Male' : (f.gender === 'Girls' ? 'Female' : f.gender);
                    finalWinners = finalWinners.filter(w => {
                        const prog = allPrograms.find(p => p.id === (r.programId || r.id));
                        const resolved = resolveWinnerParticipant(prog, w, participantsMap[r.programId || r.id], studentMap);
                        return resolved.memberStudents.length > 0 && resolved.memberStudents.every(stu => stu.gender === targetGender);
                    });
                }

                const sortedWinners = finalWinners.sort((a, b) => {
                    const pA = posOrder[a.position] || 4;
                    const pB = posOrder[b.position] || 4;
                    if (pA !== pB) return pA - pB;

                    const gA = getGradePriority(a.grade);
                    const gB = getGradePriority(b.grade);
                    if (gA !== gB) return gA - gB;

                    const mA = a.totalPoints !== undefined ? Number(a.totalPoints) : (Number(a.marks) || 0);
                            const mB = b.totalPoints !== undefined ? Number(b.totalPoints) : (Number(b.marks) || 0);
                    return mB - mA;
                });

                sortedWinners.forEach(w => {
                    let wTotal = w.totalPoints !== undefined ? w.totalPoints : w.marks;
                    let points = wTotal !== undefined ? wTotal : 0;
                    let match = null;

                    if (Array.isArray(r.marksData)) {
                        match = r.marksData.find(m => {
                                            const mId = m.studentId || m.groupId || m.id || '';
                                            const wId = w.studentId || w.groupId || w.id || '';
                                            const mName = m.studentName || m.groupName || m.name || '';
                                            const wName = w.studentName || w.groupName || w.name || '';
                                            const mTeam = m.teamName || '';
                                            const wTeam = w.teamName || '';

                                            if (r.programType === 'group' || r.type === 'Group') {
                                                return (mTeam && wTeam && mTeam === wTeam) || (mId && wId && mId === wId) || (mName && wName && mName === wName);
                                            } else {
                                                return (mId && wId && mId === wId) || (mName && wName && mName === wName);
                                            }
                                        });
                        if (match) {
                            points = match.totalPoints !== undefined ? match.totalPoints : points;
                        }
                    }

                    const prog = allPrograms.find(p => p.id === r.programId);
                    if (!prog) return;

                    const resolved = resolveWinnerParticipant(prog, w, participantsMap[r.programId || r.id], studentMap);
                    const showGrade = r.gradeMode !== 'none';
                    const gradeVal = showGrade ? (w.grade || (match && match.grade) || '—') : '';

                    let codeLetterDisplay = '';
                    if (match && match.codeLetter !== undefined && match.codeLetter !== null) {
                        const valStr = String(match.codeLetter).trim();
                        const valLower = valStr.toLowerCase();
                        if (valStr !== '' &&
                            valLower !== 'n/a' &&
                            valLower !== '-' &&
                            valLower !== 'none' &&
                            valLower !== 'null' &&
                            valLower !== 'undefined') {
                            codeLetterDisplay = valStr;
                        }
                    }

                    let classDisplay = '';
                    if (resolved.memberStudents && resolved.memberStudents.length > 0) {
                        const classes = [...new Set(resolved.memberStudents.map(m => m.className).filter(c => c && c !== '—'))];
                        if (classes.length > 0) {
                            classDisplay = classes.join(', ');
                        }
                    }

                    let csvDisplayName = resolved.displayName;
                    if (classDisplay) {
                        csvDisplayName += ` - ${classDisplay}`;
                    }

                    csvContent += `"${w.position}","${codeLetterDisplay}","${resolved.chestNumbers}","${csvDisplayName}","${resolved.teamName || ''}","${gradeVal}",${points}\n`;
                });
            });
        }

        else if (f.resultSubOption === 'Student Prize Distribution') {
            csvContent += "S.No.,CHEST NUMBER,STUDENT NAME,CLASS,CATEGORY,TEAM,PRIZE DETAILS\n";

            const studentPrizes = new Map();
            filteredResults.forEach(r => {
                const isGeneral = (r.programType || '').toLowerCase() === 'general' || r.categoryId === 'general_programs';
                
                if (isGeneral && f.includedPositions && !f.includedPositions.includes('General Programs')) {
                    return;
                }

                const isGroup = (r.programType || '').toLowerCase() === 'group';
                const pLoc = (r.programLocation || '').toLowerCase();

                let prizeCat = 2; // Default to Off Stage Individual
                if (isGeneral) {
                    prizeCat = 4;
                } else if (isGroup) {
                    prizeCat = 3;
                } else if (pLoc === 'stage') {
                    prizeCat = 1;
                }

                let winnersList = Array.isArray(r.winners) ? r.winners : [];
                if (f.includedPositions) winnersList = winnersList.filter(w => f.includedPositions.includes(w.position));
                winnersList.forEach(w => {
                    const prog = allPrograms.find(p => p.id === r.programId);
                    if (!prog) return;

                    const resolved = resolveWinnerParticipant(prog, w, participantsMap[r.programId || r.id], studentMap);

                    resolved.memberStudents.forEach(stu => {
                        if (f.gender && f.gender !== 'Mixed' && f.gender !== 'All' && f.gender !== 'All Genders') {
                            const targetGender = f.gender === 'Boys' ? 'Male' : (f.gender === 'Girls' ? 'Female' : f.gender);
                            if (stu.gender !== targetGender) return;
                        }

                        const chestNo = stu.chestNumber || '—';
                        const stuKey = (chestNo && chestNo !== '—') ? chestNo : (stu.studentId || stu.name || 'unknown');

                        if (!studentPrizes.has(stuKey)) {
                            studentPrizes.set(stuKey, {
                                studentName: stu.name,
                                chestNumber: chestNo,
                                className: stu.className,
                                categoryName: stu.categoryName,
                                teamName: stu.teamName,
                                prizes: []
                            });
                        }

                        const listObj = studentPrizes.get(stuKey);
                        const alreadyAdded = listObj.prizes.some(p => p.programName === r.programName && p.position === w.position);
                        if (!alreadyAdded) {
                            listObj.prizes.push({
                                programName: r.programName,
                                position: w.position,
                                categoryIndex: prizeCat
                            });
                        }
                    });
                });
            });

            // Sort systematically: Category ➔ Class ➔ Student
            const sortedStudents = [...studentPrizes.values()].sort((a, b) => {
                const classA = a.className || '';
                const classB = b.className || '';
                const classCompare = classA.localeCompare(classB, undefined, { numeric: true, sensitivity: 'base' });
                if (classCompare !== 0) return classCompare;

                const chestA = a.chestNumber || '';
                const chestB = b.chestNumber || '';
                return chestA.localeCompare(chestB, undefined, { numeric: true, sensitivity: 'base' });
            });

            sortedStudents.forEach((stu, index) => {
                stu.prizes.sort((a, b) => a.categoryIndex - b.categoryIndex);
                const prizeList = stu.prizes.map(p => `${p.programName} - ${p.position}`);
                csvContent += `"${index + 1}","${stu.chestNumber}","${stu.studentName}","${stu.className}","${stu.categoryName}","${stu.teamName}","${prizeList.join('; ')}"\n`;
            });
        }

        else if (f.resultSubOption === 'Prize Distribution Register') {
            csvContent += "SECTION,SUB SECTION,PROGRAM NAME,CATEGORY,CHEST NUMBER,STUDENT NAME,TEAM NAME,CLASS,GRADE\n";

            const positions = ['First', 'Second', 'Third'];
            const positionTitles = {
                'First': 'SECTION 1: FIRST PLACE WINNERS',
                'Second': 'SECTION 2: SECOND PLACE WINNERS',
                'Third': 'SECTION 3: THIRD PLACE WINNERS'
            };

            const sectionsData = {
                'First': { 'Stage': [], 'Off Stage': [], 'Group': [], 'General': [] },
                'Second': { 'Stage': [], 'Off Stage': [], 'Group': [], 'General': [] },
                'Third': { 'Stage': [], 'Off Stage': [], 'Group': [], 'General': [] }
            };

            filteredResults.forEach(r => {
                const prog = allPrograms.find(p => p.id === r.programId);
                if (!prog) return;

                const pLoc = (prog.programLocation || prog.location || 'Stage');
                const isOffStage = pLoc.toLowerCase() === 'off stage';
                if (f.programLocation) {
                    if (f.programLocation.toLowerCase() === 'stage' && isOffStage) return;
                    if (f.programLocation.toLowerCase() === 'off stage' && !isOffStage) return;
                }

                const isGeneral = (prog.categoryId === 'general_programs' || prog.programType === 'general' || r.categoryId === 'general_programs' || r.programType === 'general');
                const isGroup = prog.programType === 'group' || r.programType === 'group';
                const isIndividual = !isGeneral && !isGroup;

                if (f.participationType) {
                    if (f.participationType === 'general' && !isGeneral) return;
                    if (f.participationType === 'group' && !isGroup) return;
                    if (f.participationType === 'individual' && !isIndividual) return;
                }

                let subKey = 'Stage';
                if (isGeneral) subKey = 'General';
                else if (isGroup) subKey = 'Group';
                else if (isOffStage) subKey = 'Off Stage';

                let winnersList = Array.isArray(r.winners) ? r.winners : [];
                if (f.includedPositions) winnersList = winnersList.filter(w => f.includedPositions.includes(w.position));

                winnersList.forEach(w => {
                    const posKey = w.position;
                    if (!sectionsData[posKey]) return;

                    let match = null;
                    if (Array.isArray(r.marksData)) {
                        match = r.marksData.find(m => {
                                            const mId = m.studentId || m.groupId || m.id || '';
                                            const wId = w.studentId || w.groupId || w.id || '';
                                            const mName = m.studentName || m.groupName || m.name || '';
                                            const wName = w.studentName || w.groupName || w.name || '';
                                            const mTeam = m.teamName || '';
                                            const wTeam = w.teamName || '';

                                            if (r.programType === 'group' || r.type === 'Group') {
                                                return (mTeam && wTeam && mTeam === wTeam) || (mId && wId && mId === wId) || (mName && wName && mName === wName);
                                            } else {
                                                return (mId && wId && mId === wId) || (mName && wName && mName === wName);
                                            }
                                        });
                    }
                    const showGrade = r.gradeMode !== 'none';
                    const gradeVal = showGrade ? (w.grade || (match && match.grade) || '') : '';

                    const resolved = resolveWinnerParticipant(prog, w, participantsMap[r.programId || r.id], studentMap);
                    let members = resolved.memberStudents || [];

                    members = members.filter(stu => {
                        if (f.gender) {
                            const g = stu.gender || (studentMap[stu.studentId] && studentMap[stu.studentId].gender) || '';
                            if (f.gender === 'Boys' && g !== 'Male') return false;
                            if (f.gender === 'Girls' && g !== 'Female') return false;
                        }
                        if (f.classId) {
                            const cId = stu.classId || (studentMap[stu.studentId] && studentMap[stu.studentId].classId) || '';
                            if (cId && cId !== f.classId) return false;
                        }
                        if (f.teamId) {
                            const tId = stu.teamId || resolved.teamId || w.teamId || (studentMap[stu.studentId] && studentMap[stu.studentId].teamId) || '';
                            if (tId && tId !== f.teamId) return false;
                        }
                        return true;
                    });

                    members.forEach(stu => {
                        sectionsData[posKey][subKey].push({
                            programName: r.programName || prog.programName || '—',
                            categoryName: r.categoryName || prog.categoryName || 'General',
                            chestNumber: stu.chestNumber || '—',
                            studentName: stu.name || '—',
                            teamName: stu.teamName || resolved.teamName || w.teamName || '—',
                            className: stu.className || '—',
                            grade: gradeVal
                        });
                    });
                });
            });

            positions.forEach(posKey => {
                const posTitle = positionTitles[posKey];
                ['Stage', 'Off Stage', 'Group', 'General'].forEach(subKey => {
                    const items = sectionsData[posKey][subKey];
                    items.sort((a, b) => {
                        const pComp = a.programName.localeCompare(b.programName, undefined, { sensitivity: 'base' });
                        if (pComp !== 0) return pComp;
                        return a.chestNumber.localeCompare(b.chestNumber, undefined, { numeric: true, sensitivity: 'base' });
                    });

                    items.forEach(item => {
                        const secClean = posTitle.replace(/"/g, '""');
                        const subClean = `${subKey} Programs`.replace(/"/g, '""');
                        const progClean = item.programName.replace(/"/g, '""');
                        const catClean = item.categoryName.replace(/"/g, '""');
                        const chestClean = item.chestNumber.replace(/"/g, '""');
                        const nameClean = item.studentName.replace(/"/g, '""');
                        const teamClean = getSafeTeamName(item, studentMap, teamNamesMap).replace(/"/g, '""');
                        const classClean = item.className.replace(/"/g, '""');
                        const gradeClean = item.grade.replace(/"/g, '""');

                        csvContent += `"${secClean}","${subClean}","${progClean}","${catClean}","${chestClean}","${nameClean}","${teamClean}","${classClean}","${gradeClean}"\n`;
                    });
                });
            });
        }

        else if (f.resultSubOption === 'Participants Without Major Prizes') {
            csvContent += "CATEGORY,CHEST NUMBER,STUDENT NAME,CLASS,TEAM / HOUSE,NUMBER OF PARTICIPATIONS,STATUS,PROGRAMS PARTICIPATED\n";

            const teamNamesMap = {};
            allTeams.forEach(t => {
                if (t.id) teamNamesMap[String(t.id)] = t.name;
            });

            const studentDataList = [];
            Object.entries(studentMap).forEach(([studentId, stu]) => {
                if (f.categoryId && stu.categoryId !== f.categoryId) return;
                if (f.classId && stu.classId !== f.classId) return;
                if (f.teamId && stu.teamId !== f.teamId) return;
                if (f.gender === 'Boys' && stu.gender !== 'Male') return;
                if (f.gender === 'Girls' && stu.gender !== 'Female') return;

                const participations = [];
                const prizes = [];

                programs.forEach(p => {
                    const pList = participantsMap[p.id] || [];
                    const isPart = pList.some(part => {
                        if (part.isGroup === true || Array.isArray(part.members)) {
                            if (part.members && part.members.length > 0) {
                                return part.members.some(m => m.studentId === studentId || m.name === stu.name);
                            } else {
                                return stu.teamId && String(stu.teamId) === String(part.teamId);
                            }
                        } else {
                            return part.studentId === studentId || part.name === stu.name;
                        }
                    });
                    if (isPart) {
                        participations.push(p.programName);
                    }
                });

                filteredResults.forEach(r => {
                    const prog = allPrograms.find(p => p.id === r.programId);
                    if (!prog) return;

                    const winners = Array.isArray(r.winners) ? r.winners : [];
                    winners.forEach(w => {
                        const resolved = resolveWinnerParticipant(prog, w, participantsMap[r.programId || r.id], studentMap);
                        const isMember = resolved.memberStudents.some(mst => mst.studentId === studentId || mst.name === stu.name);
                        if (isMember) {
                            prizes.push(w.position);
                        }
                    });
                });

                const hasExcludedPrize = f.includedPositions
                    ? prizes.some(p => f.includedPositions.includes(p))
                    : prizes.some(p => p === 'First' || p === 'Second');
                if (hasExcludedPrize) return;

                let statusLabel = '';
                if (participations.length === 0) {
                    statusLabel = 'No Participation';
                } else {
                    const hasThirdPrize = prizes.some(p => p === 'Third');
                    statusLabel = hasThirdPrize ? 'Third Prize Only' : 'No Prize';
                }

                studentDataList.push({
                    studentId: studentId,
                    chestNumber: stu.chestNumber || '—',
                    name: stu.name,
                    classId: stu.classId || 'standard',
                    className: stu.className || 'Standard',
                    categoryId: stu.categoryId || 'general',
                    categoryName: stu.categoryName || 'General',
                    teamName: teamNamesMap[String(stu.teamId)] || stu.teamName || 'Independent',
                    participationsCount: participations.length,
                    participationsList: participations,
                    status: statusLabel
                });
            });

            // Sorting: Category ➔ Class ➔ Status Priority ➔ Student Name
            studentDataList.sort((a, b) => {
                const catA = a.categoryName || '';
                const catB = b.categoryName || '';
                const idxA = allCategories.findIndex(c => c.name === catA);
                const idxB = allCategories.findIndex(c => c.name === catB);
                if (idxA !== -1 && idxB !== -1 && idxA !== idxB) {
                    return idxA - idxB;
                }
                const catCompare = catA.localeCompare(catB, undefined, { sensitivity: 'base' });
                if (catCompare !== 0) return catCompare;

                const classA = a.className || '';
                const classB = b.className || '';
                const classCompare = classA.localeCompare(classB, undefined, { numeric: true, sensitivity: 'base' });
                if (classCompare !== 0) return classCompare;

                const statusPriority = {
                    'No Participation': 1,
                    'No Prize': 2,
                    'Third Prize Only': 3
                };
                const pA = statusPriority[a.status] || 99;
                const pB = statusPriority[b.status] || 99;
                if (pA !== pB) return pA - pB;

                return a.name.localeCompare(b.name);
            });

            studentDataList.forEach(s => {
                csvContent += `"${s.categoryName}","${s.chestNumber}","${s.name}","${s.className}","${s.teamName}",${s.participationsCount},"${s.status}","${s.participationsList.join('; ')}"\n`;
            });
        }
    }
    else if (f.type === 'Results' && f.resultSubOption === 'Class Wise Academic & Attendance') {
        csvContent += "CLASS,AWARD TYPE,PLACE,CHEST NUMBER,STUDENT NAME\n";

        let filteredAwards = classAwards.filter(aw => {
            if (f.classId && aw.classId !== f.classId) return false;
            const awTypeId = aw.awardTypeId || (aw.awardType ? aw.awardType.toLowerCase() : '');
            const awType = aw.awardType || '';

            if (f.awardTypeFilter) {
                if (Array.isArray(f.awardTypeFilter)) {
                    if (!f.awardTypeFilter.includes('All')) {
                        const match = f.awardTypeFilter.some(filterVal => {
                            const fVal = filterVal.toLowerCase();
                            return (awTypeId && awTypeId.toLowerCase() === fVal) ||
                                (awType && awType.toLowerCase() === fVal) ||
                                (awTypeId === filterVal) ||
                                (awType === filterVal);
                        });
                        if (!match) return false;
                    }
                } else if (f.awardTypeFilter !== 'All') {
                    const filterVal = f.awardTypeFilter.toLowerCase();
                    const match = (awTypeId && awTypeId.toLowerCase() === filterVal) ||
                        (awType && awType.toLowerCase() === filterVal) ||
                        (awTypeId === f.awardTypeFilter) ||
                        (awType === f.awardTypeFilter);
                    if (!match) return false;
                }
            }
            return true;
        });

        let targetClasses = [];
        const seenClassIds = new Set();
        allCategories.forEach(cat => {
            cat.classes.forEach(c => {
                if (!seenClassIds.has(c.id)) {
                    if (f.classId && c.id !== f.classId) return;
                    seenClassIds.add(c.id);
                    targetClasses.push(c);
                }
            });
        });
        targetClasses.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

        // Append Bulk Other Entry / Custom Classes after regular classes
        const extraClassesMap = new Map();
        filteredAwards.forEach(aw => {
            if (aw.classId && !seenClassIds.has(aw.classId)) {
                if (!extraClassesMap.has(aw.classId)) {
                    extraClassesMap.set(aw.classId, {
                        id: aw.classId,
                        name: aw.className || 'Other Entry'
                    });
                }
            }
        });
        const extraClasses = Array.from(extraClassesMap.values());
        targetClasses = [...targetClasses, ...extraClasses];

        targetClasses.forEach(cls => {
            const classAwardsList = filteredAwards.filter(aw => aw.classId === cls.id);
            if (classAwardsList.length === 0) return;

            // Collect unique award types present in this class's awards
            const classAwardTypes = [];
            classAwardsList.forEach(aw => {
                const typeId = aw.awardTypeId || (aw.awardType ? aw.awardType.toLowerCase() : '');
                const typeName = aw.awardType || formatLabel(typeId);
                if (!classAwardTypes.some(t => t.id === typeId)) {
                    classAwardTypes.push({ id: typeId, name: typeName });
                }
            });

            const awardTypes = classAwardTypes.filter(t => {
                if (f.awardTypeFilter) {
                    if (Array.isArray(f.awardTypeFilter)) {
                        if (!f.awardTypeFilter.includes('All')) {
                            const match = f.awardTypeFilter.some(filterVal => {
                                const fVal = filterVal.toLowerCase();
                                return (t.id && t.id.toLowerCase() === fVal) ||
                                    (t.name && t.name.toLowerCase() === fVal) ||
                                    (t.id === filterVal) ||
                                    (t.name === filterVal);
                            });
                            if (!match) return false;
                        }
                    } else if (f.awardTypeFilter !== 'All') {
                        const filterVal = f.awardTypeFilter.toLowerCase();
                        const match = (t.id && t.id.toLowerCase() === filterVal) ||
                            (t.name && t.name.toLowerCase() === filterVal) ||
                            (t.id === filterVal) ||
                            (t.name === filterVal);
                        if (!match) return false;
                    }
                }
                return true;
            });

            awardTypes.forEach(type => {
                const award = classAwardsList.find(aw => {
                    const typeId = aw.awardTypeId || (aw.awardType ? aw.awardType.toLowerCase() : '');
                    return typeId === type.id;
                });
                if (!award) return;

                let firstWinners = [];
                if (Array.isArray(award.firstPlaceWinners)) {
                    firstWinners = award.firstPlaceWinners;
                } else if (award.firstPlace) {
                    firstWinners = [award.firstPlace];
                } else if (award.firstPlaceWinner) {
                    firstWinners = [award.firstPlaceWinner];
                }

                let secondWinners = [];
                if (Array.isArray(award.secondPlaceWinners)) {
                    secondWinners = award.secondPlaceWinners;
                } else if (award.secondPlace) {
                    secondWinners = [award.secondPlace];
                } else if (award.secondPlaceWinner) {
                    secondWinners = [award.secondPlaceWinner];
                }

                let thirdWinners = [];
                if (Array.isArray(award.thirdPlaceWinners)) {
                    thirdWinners = award.thirdPlaceWinners;
                } else if (award.thirdPlace) {
                    thirdWinners = [award.thirdPlace];
                } else if (award.thirdPlaceWinner) {
                    thirdWinners = [award.thirdPlaceWinner];
                }

                const writeCSVRow = (w, placeStr) => {
                    const isOS = w.sourceType === 'old_student' || w.isOldStudent === true;
                    const chestVal = isOS ? '' : (w.chestNumber || '');
                    const nameVal = `${w.name || ''}${isOS ? ' (Old Student)' : ''}`;
                    const classVal = w.className || cls.name;

                    csvContent += `"${classVal.replace(/"/g, '""')}","${type.name.replace(/"/g, '""')}","${placeStr}","${chestVal.replace(/"/g, '""')}","${nameVal.replace(/"/g, '""')}"\n`;
                };

                firstWinners.forEach(w => writeCSVRow(w, "1st Place"));
                secondWinners.forEach(w => writeCSVRow(w, "2nd Place"));
                thirdWinners.forEach(w => writeCSVRow(w, "3rd Place"));
            });
        });
    }

    // Trigger standard File Download Blob
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", exp.fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ─────────────────────────────────────────────
// Filters Results based on published/draft config
// ─────────────────────────────────────────────
function filterResultsBySource(results, f) {
    return results.filter(r => {
        if (f.categoryId && r.categoryId !== f.categoryId) return false;
        if (f.classId && r.classId !== f.classId) return false;
        if (f.programId && r.programId !== f.programId) return false;
        if (f.gender && f.gender !== 'Mixed' && f.gender !== 'All' && f.gender !== 'All Genders') {
            const prog = allPrograms.find(p => p.id === r.programId);
            if (prog && prog.genderCategory && prog.genderCategory !== f.gender && prog.genderCategory !== 'General' && prog.genderCategory !== 'Mixed') return false;
        }
        if (f.programLocation) {
            const prog = allPrograms.find(p => p.id === r.programId);
            const pLoc = prog ? (prog.programLocation || prog.location || 'Stage') : (r.programLocation || 'Stage');
            if (pLoc !== f.programLocation) return false;
        }

        const isDraft = r.status === 'draft';
        const isSubmitted = r.markEntryStatus === 'submitted';

        if (r.status === 'published') return true;
        if (f.srcIncludeSubmitted && isDraft && isSubmitted) return true;
        if (f.srcIncludeDraft && isDraft && !isSubmitted) return true;

        return false;
    });
}
