import { db, getCachedCategories, getCachedTeams, getCachedPrograms } from './firebase.js';
import {
    collection, doc, getDocs, onSnapshot, serverTimestamp, addDoc, deleteDoc, updateDoc, query, orderBy, limit
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
let unsubscribeExports = null;
let exportsList = [];

// Filter / Search states
let searchVal = '';
let filterTypeVal = '';
let filterStatusVal = '';
let sortByVal = 'newest';

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
                <h3 style="font-size:1rem; font-weight:800; color:#0f172a; margin-top:0; margin-bottom:1.25rem; display:flex; align-items:center; gap:0.4rem;">
                    📜 Export History Logs
                </h3>
                
                <!-- Desktop Table Grid -->
                <div class="exp-desktop-table" style="overflow-x:auto; background:#fff; border:1px solid #e2e8f0; border-radius:12px; width:100%;">
                    <table style="width:100%; border-collapse:collapse; min-width:850px; font-size:0.85rem; color:#1e293b;">
                        <thead>
                            <tr style="background:#f8fafc; border-bottom:2px solid #cbd5e1; text-align:left;">
                                <th style="color:#475569; font-weight:700;">Export Type</th>
                                <th style="color:#475569; font-weight:700;">File Name</th>
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

    await loadStaticData();
    subscribeExportsHistory();
}

// ─────────────────────────────────────────────
// Caching Loader
// ─────────────────────────────────────────────
async function loadStaticData(force = false) {
    try {
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
                programType: pType,
                type: regType === 'group' ? 'Group' : 'Individual',
                genderCategory: p.genderCategory || 'Mixed',
                programLocation: p.programLocation || p.location || 'Stage',
                categoryId: p.categoryId || '',
                categoryName: p.categoryName || p.categoryId || 'General',
                classId: p.classId || '',
                className: p.className || ''
            };
        });

        // Teams Preloaded Memory Cache
        allTeams = await getCachedTeams(instId, force) || [];

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

    // 1. Render Desktop Grid
    tbody.innerHTML = filtered.map(exp => {
        const dateStr = exp.queuedAt ? new Date(exp.queuedAt.seconds * 1000).toLocaleString() : '—';
        const generatedBy = exp.generatedBy || 'Admin';
        const filename = exp.fileName || '—';
        const canDownload = exp.status === 'Completed';
        const canRetry = exp.status === 'Failed';

        return `
            <tr style="border-bottom:1px solid #cbd5e1; hover:background:#f8fafc;">
                <td style="font-weight:800; color:#1e1b4b;">📄 ${window.escapeHTML(exp.type)}</td>
                <td style="color:#475569; font-weight:600; max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${window.escapeHTML(filename)}">
                    <span style="font-size:0.82rem; display:block;">${window.escapeHTML(filename)}</span>
                    <span style="font-size:0.68rem; color:#64748b; display:block; font-weight:500; text-overflow:ellipsis; overflow:hidden;">${window.escapeHTML(exp.summary || '')}</span>
                </td>
                <td style="color:#64748b; font-weight:500;">${dateStr}</td>
                <td style="color:#475569; font-weight:700; text-align:center;">${window.escapeHTML(generatedBy)}</td>
                <td style="text-align:center;">${getStatusBadge(exp.status)}</td>
                <td style="text-align:center;">
                    <div class="exp-action-btn-cluster">
                        <button type="button" class="btn btn-download-exp" data-id="${exp.id}" ${canDownload ? '' : 'disabled'} style="background:${canDownload ? '#f0fdf4' : '#f8fafc'}; color:${canDownload ? '#16a34a' : '#94a3b8'}; border:1px solid ${canDownload ? '#bbf7d0' : '#cbd5e1'}; cursor:${canDownload ? 'pointer' : 'not-allowed'};">
                            📥 Download
                        </button>
                        ${canRetry ? `
                        <button type="button" class="btn btn-retry-exp" data-id="${exp.id}" style="background:#eff6ff; color:#1d4ed8; border:1px solid #93c5fd; cursor:pointer;">
                            🔄 Retry
                        </button>
                        ` : ''}
                        <button type="button" class="btn btn-delete-exp" data-id="${exp.id}" style="background:#fef2f2; color:#dc2626; border:1px solid #fecaca; cursor:pointer;">
                            🗑️ Delete
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // 2. Render Mobile Responsive Cards
    mContainer.innerHTML = filtered.map(exp => {
        const dateStr = exp.queuedAt ? new Date(exp.queuedAt.seconds * 1000).toLocaleString() : '—';
        const generatedBy = exp.generatedBy || 'Admin';
        const filename = exp.fileName || '—';
        const canDownload = exp.status === 'Completed';
        const canRetry = exp.status === 'Failed';

        return `
            <div class="exp-mobile-card">
                <div class="exp-mobile-row">
                    <span style="font-weight:800; font-size:0.95rem; color:#1e1b4b;">📄 ${window.escapeHTML(exp.type)}</span>
                    <span>${getStatusBadge(exp.status)}</span>
                </div>
                <div style="border-top:1px solid #e2e8f0; padding-top:0.5rem; display:flex; flex-direction:column; gap:0.25rem;">
                    <div class="exp-mobile-row">
                        <span class="exp-mobile-label">File:</span>
                        <span class="exp-mobile-val" style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${window.escapeHTML(filename)}</span>
                    </div>
                    <div class="exp-mobile-row">
                        <span class="exp-mobile-label">Scope:</span>
                        <span class="exp-mobile-val" style="font-size:0.75rem; color:#64748b;">${window.escapeHTML(exp.summary || '')}</span>
                    </div>
                    <div class="exp-mobile-row">
                        <span class="exp-mobile-label">Date:</span>
                        <span class="exp-mobile-val">${dateStr}</span>
                    </div>
                    <div class="exp-mobile-row">
                        <span class="exp-mobile-label">By:</span>
                        <span class="exp-mobile-val">${window.escapeHTML(generatedBy)}</span>
                    </div>
                </div>
                <div class="exp-mobile-actions">
                    <button type="button" class="btn btn-download-exp" data-id="${exp.id}" ${canDownload ? '' : 'disabled'} style="width:100%; background:${canDownload ? '#f0fdf4' : '#f8fafc'}; color:${canDownload ? '#16a34a' : '#94a3b8'}; border:1px solid ${canDownload ? '#bbf7d0' : '#cbd5e1'}; cursor:${canDownload ? 'pointer' : 'not-allowed'}; font-weight:700; border-radius:8px;">
                        Download
                    </button>
                    ${canRetry ? `
                    <button type="button" class="btn btn-retry-exp" data-id="${exp.id}" style="width:100%; background:#eff6ff; color:#1d4ed8; border:1px solid #93c5fd; cursor:pointer; font-weight:700; border-radius:8px;">
                        Retry
                    </button>
                    ` : `
                    <div style="width:100%; height:1px;"></div>
                    `}
                    <button type="button" class="btn btn-delete-exp" data-id="${exp.id}" style="background:#fef2f2; color:#dc2626; border:1px solid #fecaca; cursor:pointer; font-weight:700; border-radius:8px; width:100%;">
                        🗑️ Delete Log Record
                    </button>
                </div>
            </div>
        `;
    }).join('');

    // Bind triggers on both lists
    document.querySelectorAll('.btn-download-exp').forEach(btn => {
        btn.onclick = () => {
            const id = btn.getAttribute('data-id');
            const exp = exportsList.find(x => x.id === id);
            if (exp) triggerDownload(exp);
        };
    });

    document.querySelectorAll('.btn-retry-exp').forEach(btn => {
        btn.onclick = () => {
            const id = btn.getAttribute('data-id');
            const exp = exportsList.find(x => x.id === id);
            if (exp) triggerRetry(exp);
        };
    });

    document.querySelectorAll('.btn-delete-exp').forEach(btn => {
        btn.onclick = () => {
            const id = btn.getAttribute('data-id');
            const exp = exportsList.find(x => x.id === id);
            if (exp) triggerDelete(exp);
        };
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

function openExportDrawer() {
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

                    <!-- Sub Options (Only visible for Results) -->
                    <div id="expResultSub" style="display:none; flex-direction:column; gap:0.45rem;">
                        <label style="font-weight:700; color:#475569; font-size:0.78rem;">RESULTS SUB-OPTION *</label>
                        <select id="expResultSubVal" class="exp-input" style="background:#fff;">
                            <option value="Team Wise">Team Wise Standings & Roster</option>
                            <option value="Program Wise">Program Wise Podiums</option>
                            <option value="Student Prize Distribution">Student Prize Distribution Register</option>
                            <option value="Participants Without Major Prizes">Participants Without Major Prizes</option>
                        </select>
                    </div>

                    <!-- Category / Class filters -->
                    <div style="display:flex; gap:0.75rem; flex-wrap:wrap; width:100%;">
                        <div style="flex:1; min-width:140px;">
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

                    <!-- Program selection (Cascading) -->
                    <div id="expProgFilterContainer">
                        <label style="font-weight:700; color:#475569; font-size:0.78rem;">SPECIFIC PROGRAM (OPTIONAL)</label>
                        <select id="expProgFilter" class="exp-input" style="background:#fff;">
                            <option value="">All Matching Programs</option>
                        </select>
                    </div>

                    <!-- Chest Number List specific Sort Controls -->
                    <div id="chestListSortContainer" style="display:none; flex-direction:column; gap:0.45rem;">
                        <label style="font-weight:700; color:#475569; font-size:0.78rem;">SORT BY</label>
                        <select id="expChestSortVal" class="exp-input" style="background:#fff;">
                            <option value="chest">Chest Number</option>
                            <option value="name">Name</option>
                            <option value="team">Team</option>
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
                        <div style="flex:1; min-width:140px;">
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

                    <!-- Format & Layout -->
                    <div style="display:flex; gap:0.75rem; flex-wrap:wrap; border-top:1px solid #cbd5e1; padding-top:0.75rem; width:100%; margin-top:auto;">
                        <div style="flex:1; min-width:140px;">
                            <label style="font-weight:700; color:#475569; font-size:0.78rem;">LAYOUT ORIENTATION</label>
                            <select id="expOrientation" class="exp-input" style="background:#fff;">
                                <option value="portrait">A4 Portrait (Vertical)</option>
                                <option value="landscape">A4 Landscape (Horizontal)</option>
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
    const chestListSortContainer = document.getElementById('chestListSortContainer');

    cards.forEach(card => {
        card.onclick = () => {
            cards.forEach(c => {
                c.style.border = '2px solid #e2e8f0';
                c.style.background = '#fff';
                c.classList.remove('active');
            });
            card.style.border = '2px solid #4338ca';
            card.style.background = '#f5f3ff';
            card.classList.add('active');

            selectedType = card.getAttribute('data-type');

            if (selectedType === 'Results') {
                resultsSourceContainer.style.display = 'flex';
                subOptionsContainer.style.display = 'flex';
                paperPackingContainer.style.display = 'none';
                chestListSortContainer.style.display = 'none';
                expProgFilterContainer.style.display = 'block';
            } else if (selectedType === 'Valuation Sheet') {
                resultsSourceContainer.style.display = 'none';
                subOptionsContainer.style.display = 'none';
                paperPackingContainer.style.display = 'flex';
                packingHint.textContent = "Automatically packing exactly 4 Valuation sheets per A4 page in a 2x2 grid (75% paper savings).";
                chestListSortContainer.style.display = 'none';
                expProgFilterContainer.style.display = 'block';
            } else if (selectedType === 'Chest Number List') {
                resultsSourceContainer.style.display = 'none';
                subOptionsContainer.style.display = 'none';
                paperPackingContainer.style.display = 'none';
                chestListSortContainer.style.display = 'flex';
                expProgFilterContainer.style.display = 'none';
            } else if (selectedType === 'Program Participation Register') {
                resultsSourceContainer.style.display = 'none';
                subOptionsContainer.style.display = 'none';
                paperPackingContainer.style.display = 'none';
                chestListSortContainer.style.display = 'flex';
                expProgFilterContainer.style.display = 'none';
                document.getElementById('expOrientation').value = 'landscape';
            } else {
                resultsSourceContainer.style.display = 'none';
                subOptionsContainer.style.display = 'none';
                paperPackingContainer.style.display = 'flex';
                packingHint.textContent = "Combine multiple programs continuously to avoid wasting paper on blank space.";
                chestListSortContainer.style.display = 'none';
                expProgFilterContainer.style.display = 'block';
            }
        };
    });

    // Cascading Class select
    expCatFilter.onchange = async () => {
        const catId = expCatFilter.value;
        expClassFilter.innerHTML = '<option value="">All Classes</option>';
        expClassFilter.disabled = true;

        if (catId) {
            const cat = allCategories.find(c => c.id === catId);
            if (cat && cat.classes) {
                cat.classes.forEach(c => {
                    expClassFilter.innerHTML += `<option value="${c.id}">${window.escapeHTML(c.name)}</option>`;
                });
                expClassFilter.disabled = false;
            }
        }
        updateProgramsDropdown();
    };

    expClassFilter.onchange = () => updateProgramsDropdown();

    function updateProgramsDropdown() {
        const catId = expCatFilter.value;
        const classId = expClassFilter.value;

        expProgFilter.innerHTML = '<option value="">All Matching Programs</option>';

        const filtered = allPrograms.filter(p => {
            if (catId && p.categoryId !== catId) return false;
            if (classId && p.classId !== classId) return false;
            return true;
        });

        filtered.forEach(p => {
            expProgFilter.innerHTML += `<option value="${p.id}">${window.escapeHTML(p.programName)}</option>`;
        });
    }

    updateProgramsDropdown();

    document.getElementById('btnNewExpCancel').onclick = closeExportDrawer;

    // Phase 2 Form Validations & Queue write
    document.getElementById('btnNewExpGenerate').onclick = async () => {
        const btn = document.getElementById('btnNewExpGenerate');
        btn.disabled = true;
        btn.textContent = 'Queuing Export...';

        const categoryId = expCatFilter.value;
        const categoryName = categoryId ? allCategories.find(c => c.id === categoryId)?.name : 'All';
        const classId = expClassFilter.value;
        const className = classId ? allCategories.find(c => c.id === categoryId)?.classes.find(cls => cls.id === classId)?.name : '';
        const programId = expProgFilter.value;
        const programName = programId ? allPrograms.find(p => p.id === programId)?.programName : 'All';
        const gender = document.getElementById('expGenderFilter').value;
        const teamId = document.getElementById('expTeamFilter').value;
        const teamName = teamId ? allTeams.find(t => t.id === teamId)?.name : 'All';

        const resultSubOption = selectedType === 'Results' ? document.getElementById('expResultSubVal').value : 'Team Wise';
        const format = document.getElementById('expFormat').value;
        const orientation = document.getElementById('expOrientation').value;
        const srcIncludeSubmitted = selectedType === 'Results' && document.getElementById('srcIncludeSubmitted').checked;
        const srcIncludeDraft = selectedType === 'Results' && document.getElementById('srcIncludeDraft').checked;
        const compactPacking = selectedType === 'Results' ? true : document.getElementById('expCompactPacking').checked;
        const chestSort = (selectedType === 'Chest Number List' || selectedType === 'Program Participation Register') ? document.getElementById('expChestSortVal').value : 'chest';

        // Visual Validation Flow: alert if search parameters yield 0 matching programs (Phase 2 validation)
        let filteredProgs = [...allPrograms];
        if (programId) {
            filteredProgs = allPrograms.filter(p => p.id === programId);
        } else {
            filteredProgs = allPrograms.filter(p => {
                if (categoryId && p.categoryId !== categoryId) return false;
                if (classId && p.classId !== classId) return false;
                if (gender && p.genderCategory !== gender) return false;
                return true;
            });
        }

        if (filteredProgs.length === 0 && selectedType !== 'Results' && selectedType !== 'Chest Number List' && selectedType !== 'Program Participation Register') {
            window.showToast("Cannot generate export: No programs match selected parameters.", "error");
            btn.disabled = false;
            btn.textContent = '⚡ Generate Export';
            return;
        }

        const dateStr = new Date().toISOString().split('T')[0];
        const cleanName = (str) => str.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();

        let fileTypePrefix = cleanName(selectedType);
        if (selectedType === 'Results') {
            fileTypePrefix = cleanName(resultSubOption);
        }

        let scopeText = '';
        if (programId) scopeText = `_${cleanName(programName)}`;
        else if (categoryId) scopeText = `_${cleanName(categoryName)}`;

        const finalFilename = `${fileTypePrefix}${scopeText}_${dateStr}.${format}`;

        try {
            const instId = window.currentInstituteId;
            const ref = collection(db, "institutes", instId, "exports");

            const payload = {
                type: selectedType,
                fileName: finalFilename,
                summary: `Scope: ${categoryName}${className ? ` (${className})` : ''} | Program: ${programName} | Team: ${teamName} [${format.toUpperCase()}]`,
                status: 'Pending',
                queuedAt: serverTimestamp(),
                completedIn: '—',
                generatedBy: window.currentInstituteDetails?.name || 'Admin',
                filters: {
                    type: selectedType,
                    resultSubOption,
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
                    chestSort
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
    const list = [];

    snap.docs.forEach(d => {
        const p = d.data();
        if (limitTeamId && p.teamId !== limitTeamId) return;

        if (pType === 'general') {
            if (p.type === 'group') {
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
                    list.push({
                        isGroup: true,
                        name: g.name || p.teamName || 'Group',
                        teamName: p.teamName || '',
                        teamId: p.teamId || '',
                        members: members
                    });
                });
            } else {
                const resolvedStudent = studentMap[p.studentId];
                list.push({
                    studentId: p.studentId || '',
                    name: resolvedStudent ? resolvedStudent.name : (p.studentName || '—'),
                    chestNumber: resolvedStudent ? resolvedStudent.chestNumber : (p.chestNumber || '—'),
                    teamName: p.teamName || '—',
                    teamId: p.teamId || ''
                });
            }
        } else if (pType === 'group') {
            const groups = Array.isArray(p.groups) ? p.groups : [];
            if (groups.length > 0) {
                groups.forEach(g => {
                    const members = (g.members || []).map(m => {
                        const resolvedStudent = studentMap[m.studentId];
                        return {
                            studentId: m.studentId || '',
                            name: resolvedStudent ? resolvedStudent.name : (m.studentName || '—'),
                            chestNumber: resolvedStudent ? resolvedStudent.chestNumber : '—'
                        };
                    });
                    list.push({
                        isGroup: true,
                        name: g.name || p.teamName || 'Group',
                        teamName: p.teamName || '',
                        teamId: p.teamId || '',
                        members: members
                    });
                });
            } else {
                list.push({
                    isGroup: true,
                    name: p.teamName || 'Team',
                    teamName: p.teamName || '',
                    teamId: p.teamId || '',
                    members: []
                });
            }
        } else {
            const resolvedStudent = studentMap[p.studentId];
            list.push({
                studentId: p.studentId || '',
                name: resolvedStudent ? resolvedStudent.name : (p.studentName || '—'),
                chestNumber: resolvedStudent ? resolvedStudent.chestNumber : (p.chestNumber || '—'),
                teamName: p.teamName || '',
                teamId: p.teamId || ''
            });
        }
    });
    return list;
}

// ─────────────────────────────────────────────
// Dynamic Compilation & Download Router
// ─────────────────────────────────────────────
async function triggerDownload(exp) {
    window.showToast(`Loading data for ${exp.fileName}...`, "info");
    const instId = window.currentInstituteId;

    try {
        const f = exp.filters;
        if (!f) throw new Error("Filters parameters are missing.");

        if (f.type === 'Chest Number List' || f.type === 'Program Participation Register') {
            let studentMap = {};
            try {
                const studentsSnap = await getDocs(collection(db, "institutes", instId, "students"));
                studentsSnap.forEach(d => {
                    studentMap[d.id] = d.data();
                });
            } catch (err) {
                console.error("Failed to load students collection:", err);
            }

            if (Object.keys(studentMap).length === 0) {
                window.showToast("No students found in the database.", "warning");
                return;
            }

            if (f.format === 'csv') {
                compileCSV(exp, f, [], [], {}, studentMap);
            } else {
                compilePDF(exp, f, [], [], {}, studentMap);
            }
            return;
        }

        // 1. Fetch matching programs list
        let programs = [...allPrograms];
        if (f.programId) {
            programs = allPrograms.filter(p => p.id === f.programId);
        } else {
            programs = allPrograms.filter(p => {
                if (f.categoryId && p.categoryId !== f.categoryId) return false;
                if (f.classId && p.classId && p.classId !== f.classId) return false;
                if (f.gender && p.genderCategory !== f.gender) return false;
                return true;
            });
        }

        if (programs.length === 0 && f.type !== 'Results') {
            window.showToast("No programs match the selected filters.", "warning");
            return;
        }

        // Phase 8 query scoping optimization: Only load results when explicitly requested
        let resultsList = [];
        if (f.type === 'Results') {
            const resultsSnap = await getDocs(collection(db, "institutes", instId, "results"));
            resultsList = resultsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        }

        // Resolve students cache map dynamically to ensure chest numbers are up-to-date
        let studentMap = {};
        try {
            const studentsSnap = await getDocs(collection(db, "institutes", instId, "students"));
            studentsSnap.forEach(d => {
                studentMap[d.id] = d.data();
            });
        } catch (err) {
            console.error("Failed to load students collection:", err);
        }

        // Phase 7 Firestore Parallel Fetch Optimization using Promise.all
        let participantsMap = {};
        if (f.type !== 'Results' || f.resultSubOption === 'Participants Without Major Prizes') {
            const participantPromises = programs.map(p => loadParticipants(p, f.teamId, studentMap));
            const allParts = await Promise.all(participantPromises);
            programs.forEach((p, idx) => {
                participantsMap[p.id] = allParts[idx];
            });
        }

        // 3. Compile and trigger
        if (f.format === 'csv') {
            compileCSV(exp, f, programs, resultsList, participantsMap, studentMap);
        } else {
            compilePDF(exp, f, programs, resultsList, participantsMap, studentMap);
        }

    } catch (err) {
        console.error("Compilation error:", err);
        window.showToast(`Unable to download: ${err.message || err}`, "error");
    }
}

// ─────────────────────────────────────────────
// PDF Dynamic Document Compiler (Iframe Printing)
// ─────────────────────────────────────────────
async function compilePDF(exp, f, programs, resultsList, participantsMap, studentMap = {}) {
    let htmlContent = '';
    const orientation = f.orientation || 'portrait';

    if (f.type === 'Chest Number List') {
        const isCompact = f.compactPacking !== false; // compact layout true by default

        // 1. Filter students
        let studentsList = Object.values(studentMap);

        if (f.categoryId) {
            studentsList = studentsList.filter(s => s.categoryId === f.categoryId);
        }
        if (f.classId) {
            studentsList = studentsList.filter(s => s.classId === f.classId);
        }
        if (f.teamId) {
            studentsList = studentsList.filter(s => s.teamId === f.teamId);
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
                teamNamesMap[t.id] = t.name;
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
                    const teamA = teamNamesMap[a.teamId] || a.teamName || '';
                    const teamB = teamNamesMap[b.teamId] || b.teamName || '';
                    return teamA.localeCompare(teamB, undefined, { sensitivity: 'base' });
                });
            }

            // 3. Group students hierarchically by Category -> Class -> Team
            const groups = {};
            studentsList.forEach(stu => {
                const catId = stu.categoryId || 'general';
                const catName = stu.categoryName || 'General';
                const classId = stu.classId || 'standard';
                const className = stu.className || 'Standard';
                const teamId = stu.teamId || 'no-team';
                const teamName = teamNamesMap[stu.teamId] || stu.teamName || 'Independent';

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

            const sortedCatIds = Object.keys(groups).sort((a, b) => groups[a].name.localeCompare(groups[b].name));
            const instName = window.currentInstituteDetails?.name || 'ADMIN PORTAL';
            const pageDivClass = isCompact ? 'program-card-compact' : 'program-page-standard';

            sortedCatIds.forEach(catId => {
                const cat = groups[catId];
                const sortedClassIds = Object.keys(cat.classes).sort((a, b) => cat.classes[a].name.localeCompare(cat.classes[b].name));

                sortedClassIds.forEach(classId => {
                    const cls = cat.classes[classId];
                    const sortedTeamIds = Object.keys(cls.teams).sort((a, b) => cls.teams[a].name.localeCompare(cls.teams[b].name));

                    sortedTeamIds.forEach(teamId => {
                        const team = cls.teams[teamId];
                        const students = team.students;

                        htmlContent += `
                            <div class="${pageDivClass}" style="margin-bottom: 1.5rem; page-break-inside: avoid; break-inside: avoid;">
                                <div class="report-header" style="margin-bottom: 0.75rem;">
                                    <div>
                                        <div class="report-title">${window.escapeHTML(instName)}</div>
                                        <h2 style="margin-top:0.3rem; margin-bottom:0.1rem; color:#1e1b4b; font-size:1.3rem;">🎫 CHEST NUMBER LIST</h2>
                                        <div style="font-size:0.75rem; font-weight:700; color:#4338ca;">
                                            CATEGORY: ${window.escapeHTML(cat.name)} · 
                                            CLASS: ${window.escapeHTML(cls.name)} · 
                                            TEAM: ${window.escapeHTML(team.name)}
                                            ${f.gender ? `· GENDER: ${window.escapeHTML(f.gender.toUpperCase())}` : ''}
                                        </div>
                                    </div>
                                    <div style="text-align:right;">
                                        <span style="font-size:0.65rem; font-weight:800; color:#64748b; text-transform:uppercase; display:block;">Total Participants</span>
                                        <span style="font-weight:900; font-size:1.15rem; color:#1e1b4b;">${students.length} entries</span>
                                    </div>
                                </div>

                                <table class="report-table" style="margin-top: 0.5rem; width:100%;">
                                    <thead>
                                        <tr>
                                            <th style="width:50px; text-align:center;">SL</th>
                                            <th style="width:110px; text-align:center;">Chest No</th>
                                            <th>Participant Name</th>
                                            ${!f.gender ? '<th style="width:110px; text-align:center;">Gender</th>' : ''}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${students.map((item, idx) => `
                                            <tr style="height:30px; page-break-inside:avoid;">
                                                <td style="text-align:center; font-weight:700; color:#64748b;">${idx + 1}</td>
                                                <td style="text-align:center;">
                                                    <span class="call-chest-badge">${window.escapeHTML(item.chestNumber || '—')}</span>
                                                </td>
                                                <td style="font-weight:800; color:#1e1b4b;">${window.escapeHTML(item.name)}</td>
                                                ${!f.gender ? `<td style="text-align:center; font-weight:700; color:#475569;">${window.escapeHTML(item.gender || '—')}</td>` : ''}
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

        // Render PDF through iframe
        const printIframe = getPrintIframe();
        const doc = printIframe.contentDocument || printIframe.contentWindow.document;
        const pageMargin = '15mm';

        const styleBlock = `
            <style>
                @page {
                    size: A4 ${orientation};
                    margin: ${pageMargin};
                }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                    color: #1e293b;
                    margin: 0;
                    padding: 0;
                    background: #fff;
                    font-size: 0.85rem;
                    line-height: 1.4;
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
                .program-card-compact {
                    margin-bottom: 1.5rem;
                    border-bottom: 1.5px dashed #cbd5e1;
                    padding-bottom: 1rem;
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

        setTimeout(() => {
            printIframe.contentWindow.focus();
            printIframe.contentWindow.print();
        }, 300);
        return;
    } else if (f.type === 'Program Participation Register') {
        const isCompact = f.compactPacking !== false;

        // 1. Filter students
        let studentsList = Object.values(studentMap);

        if (f.categoryId) {
            studentsList = studentsList.filter(s => s.categoryId === f.categoryId);
        }
        if (f.classId) {
            studentsList = studentsList.filter(s => s.classId === f.classId);
        }
        if (f.teamId) {
            studentsList = studentsList.filter(s => s.teamId === f.teamId);
        }
        if (f.gender === 'Boys') {
            studentsList = studentsList.filter(s => s.gender === 'Male');
        } else if (f.gender === 'Girls') {
            studentsList = studentsList.filter(s => s.gender === 'Female');
        }

        // Retrieve matching programs list
        let matchingPrograms = [...allPrograms];
        if (f.categoryId) {
            matchingPrograms = matchingPrograms.filter(p => p.categoryId === f.categoryId);
        }
        if (f.classId) {
            matchingPrograms = matchingPrograms.filter(p => !p.classId || p.classId === f.classId);
        }
        if (f.gender) {
            matchingPrograms = matchingPrograms.filter(p => p.genderCategory === f.gender);
        }
        // Sort programs alphabetically
        matchingPrograms.sort((a, b) => (a.programName || '').localeCompare(b.programName || ''));

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
                teamNamesMap[t.id] = t.name;
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
                    const teamA = teamNamesMap[a.teamId] || a.teamName || '';
                    const teamB = teamNamesMap[b.teamId] || b.teamName || '';
                    return teamA.localeCompare(teamB, undefined, { sensitivity: 'base' });
                });
            }

            // 3. Group students hierarchically by Category -> Class -> Team
            const groups = {};
            studentsList.forEach(stu => {
                const catId = stu.categoryId || 'general';
                const catName = stu.categoryName || 'General';
                const classId = stu.classId || 'standard';
                const className = stu.className || 'Standard';
                const teamId = stu.teamId || 'no-team';
                const teamName = teamNamesMap[stu.teamId] || stu.teamName || 'Independent';

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

            const sortedCatIds = Object.keys(groups).sort((a, b) => groups[a].name.localeCompare(groups[b].name));
            const instName = window.currentInstituteDetails?.name || 'ADMIN PORTAL';
            const pageDivClass = isCompact ? 'program-card-compact' : 'program-page-standard';

            sortedCatIds.forEach(catId => {
                const cat = groups[catId];
                const sortedClassIds = Object.keys(cat.classes).sort((a, b) => cat.classes[a].name.localeCompare(cat.classes[b].name));

                sortedClassIds.forEach(classId => {
                    const cls = cat.classes[classId];
                    const sortedTeamIds = Object.keys(cls.teams).sort((a, b) => cls.teams[a].name.localeCompare(cls.teams[b].name));

                    // Filter matching programs for this specific Category + Class
                    const progs = matchingPrograms.filter(p => p.categoryId === catId && (!p.classId || p.classId === classId));

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

                    const N = progs.length;
                    let cellFontSize = '0.75rem';
                    let headerHeight = '165px';
                    if (N > 35) {
                        cellFontSize = '0.55rem';
                        headerHeight = '145px';
                    } else if (N > 20) {
                        cellFontSize = '0.65rem';
                        headerHeight = '155px';
                    }

                    sortedTeamIds.forEach(teamId => {
                        const team = cls.teams[teamId];
                        const students = team.students;

                        htmlContent += `
                            <div class="${pageDivClass}" style="margin-bottom: 2rem; page-break-inside: avoid; break-inside: avoid;">
                                <div class="register-header-container" style="margin-bottom: 0.4rem;">
                                    <div style="text-align: center; width: 100%; margin-bottom: 0.3rem;">
                                        <h2 style="font-size: 1.15rem; font-weight: bold; letter-spacing: 0.05em; color: #000; margin: 0; text-transform: uppercase;">PROGRAM PARTICIPATION REGISTER</h2>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; border-bottom: 1.5px solid #000; padding-bottom: 0.25rem; font-size: 0.75rem; font-weight: bold; color: #000;">
                                        <div style="display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: center;">
                                            <span>INSTITUTION: ${window.escapeHTML(instName).toUpperCase()}</span>
                                            <span style="color: #ccc;">|</span>
                                            <span>CATEGORY: ${window.escapeHTML(cat.name).toUpperCase()}</span>
                                            <span style="color: #ccc;">|</span>
                                            <span>CLASS: ${window.escapeHTML(cls.name).toUpperCase()}</span>
                                            <span style="color: #ccc;">|</span>
                                            <span>TEAM: ${window.escapeHTML(team.name).toUpperCase()}</span>
                                            <span style="color: #ccc;">|</span>
                                            <span>GENDER: ${f.gender ? window.escapeHTML(f.gender.toUpperCase()) : 'ALL'}</span>
                                        </div>
                                        <div style="white-space: nowrap;">
                                            TOTAL PARTICIPANTS : ${students.length}
                                        </div>
                                    </div>
                                </div>

                                <table class="report-table" style="margin-top: 0.5rem; font-size:${cellFontSize};">
                                    <thead>
                                        <tr>
                                            <th style="width:40px; min-width:40px; max-width:40px; text-align:center; padding:0.35rem 0.2rem; line-height: 1.2; border: 1px solid #000;">SL<br>NO.</th>
                                            <th style="width:180px; min-width:180px; max-width:180px; padding:0.35rem 0.5rem; text-align:left; border: 1px solid #000;">PARTICIPANT NAME</th>
                                            ${progs.map(p => `
                                                <th class="rotated-th program-col" style="height:${headerHeight};">
                                                    <div>${window.escapeHTML(p.programName).toUpperCase()}</div>
                                                </th>
                                            `).join('')}
                                            <th style="border-left: none; border-right: none; background: #fff !important;"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${students.map((item, idx) => `
                                            <tr style="height:32px; page-break-inside:avoid;">
                                                <td style="width:40px; min-width:40px; max-width:40px; text-align:center; font-weight:bold; color:#000; padding:0.35rem 0.2rem; border: 1px solid #000;">${idx + 1}</td>
                                                <td style="width:180px; min-width:180px; max-width:180px; font-weight:bold; color:#000; padding:0.35rem 0.5rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; border: 1px solid #000;" title="${window.escapeHTML(item.name)}">
                                                    ${window.escapeHTML(item.name).toUpperCase()}
                                                </td>
                                                ${progs.map(() => `
                                                    <td class="program-col"></td>
                                                `).join('')}
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
                    });
                });
            });
        }

        // Render PDF through iframe
        const printIframe = getPrintIframe();
        const doc = printIframe.contentDocument || printIframe.contentWindow.document;
        const pageMargin = '10mm';

        const styleBlock = `
            <style>
                @page {
                    size: A4 landscape;
                    margin: ${pageMargin};
                }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                    color: #000;
                    margin: 0;
                    padding: 0;
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
                    min-height: 180mm; /* A4 landscape height minus margins */
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

        setTimeout(() => {
            printIframe.contentWindow.focus();
            printIframe.contentWindow.print();
        }, 300);
        return;
    }

    const isCompact = f.compactPacking !== false; // compact layout true by default

    // Phase 5 to 11: Dynamic, Participant-Aware Evaluation Card Renderer
    const renderValuationCard = (p, partsSlice, pageNum = null, totalPages = null) => {
        const totalCount = partsSlice.length;

        // Smart Row Compression based on actual registered count (Phase 9)
        let rowHeight = '23px';
        let fontSize = '0.65rem';
        let padding = '0.2rem 0.35rem';

        if (totalCount > 25) {
            rowHeight = '17px';
            fontSize = '0.6rem';
            padding = '0.1rem 0.2rem';
        } else if (totalCount > 15) {
            rowHeight = '19px';
            fontSize = '0.62rem';
            padding = '0.12rem 0.25rem';
        } else if (totalCount > 10) {
            rowHeight = '21px';
            fontSize = '0.65rem';
            padding = '0.15rem 0.3rem';
        }

        const rowsHtml = partsSlice.map((item, idx) => {
            const sl = pageNum ? (pageNum - 1) * 30 + idx + 1 : idx + 1;
            return `
                <tr style="height: ${rowHeight}; font-size: ${fontSize};">
                    <td style="text-align:center; font-weight:800; color:#475569; padding: ${padding};">${sl}</td>
                    <td style="padding: ${padding};"></td>
                    <td style="padding: ${padding};"></td>
                    <td style="padding: ${padding};"></td>
                </tr>
            `;
        }).join('');

        const pageIndicator = pageNum && totalPages && totalPages > 1 ?
            `<span style="font-size:0.6rem; font-weight:800; color:#dc2626; background:#fee2e2; padding:0.1rem 0.4rem; border-radius:4px; border:1px solid #fecaca; text-transform:uppercase;">Page ${pageNum} of ${totalPages}</span>` : '';

        return `
            <div class="val-card">
                <!-- Header Group at the Top (Phase 2) -->
                <div class="val-card-header" style="margin-bottom: 0.15rem; width:100%; box-sizing:border-box;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; width:100%;">
                        <div style="flex:1;">
                            <div style="display:flex; justify-content:space-between; align-items:center; width:100%; box-sizing:border-box;">
                                <span style="font-size:0.55rem; font-weight:900; color:#4338ca; text-transform:uppercase; letter-spacing:0.04em;">📝 JUDGES EVALUATION CARD</span>
                                ${pageIndicator}
                            </div>
                            <h3 style="margin: 0.1rem 0 0 0; font-size:0.95rem; font-weight:900; color:#1e1b4b; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:215px; line-height:1.2;" title="${window.escapeHTML(p.programName)}">
                                ${window.escapeHTML(p.programName)}
                            </h3>
                            <div style="font-size:0.72rem; font-weight:800; color:#4338ca; margin-top:0.05rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:230px;">
                                Category: ${window.escapeHTML(formatLabel(p.categoryName))} ${p.className ? `· Class: ${window.escapeHTML(formatLabel(p.className))}` : ''}
                            </div>
                        </div>
                    </div>
                    
                    <!-- High-Density Metadata Ribbon (Program Type, Gender, Stage / Location) -->
                    <div class="val-metadata-grid" style="display:flex; gap:0.4rem; font-size:0.6rem; color:#475569; background:#f1f5f9; padding:0.15rem 0.3rem; border-radius:4px; margin-top:0.15rem; font-weight:700; border:1px solid #cbd5e1; box-sizing:border-box;">
                        <span style="flex:1;"><strong>Type:</strong> ${window.escapeHTML(formatLabel(p.type))}</span>
                        <span style="flex:1; text-align:center; border-left:1px solid #cbd5e1; border-right:1px solid #cbd5e1;"><strong>Gender:</strong> ${window.escapeHTML(formatLabel(p.genderCategory))}</span>
                        <span style="flex:1; text-align:right;"><strong>Location:</strong> ${window.escapeHTML(formatLabel(p.programLocation))}</span>
                    </div>
                </div>
                
                <!-- Valuation Scoring Table starts immediately below headers (Phase 2 & 11) -->
                <div class="val-card-body" style="width:100%; box-sizing:border-box;">
                    <table class="val-card-table">
                        <thead>
                            <tr>
                                <th style="width:30px; text-align:center; padding:0.15rem; font-size:0.65rem;">SL</th>
                                <th style="width:75px; text-align:center; padding:0.15rem; font-size:0.65rem;">Code</th>
                                <th style="width:85px; text-align:center; padding:0.15rem; font-size:0.65rem;">Marks (0-100)</th>
                                <th style="padding:0.15rem; font-size:0.65rem;">Remarks</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml || `<tr><td colspan="4" style="text-align:center; padding:0.5rem; color:#64748b; font-size:0.65rem;">No registered participants.</td></tr>`}
                        </tbody>
                    </table>
                </div>
                
                <!-- Flex-Growable Notes Area for Judge Remarks (Phase 3) -->
                <div class="val-notes-area" style="flex:1; border:1px dashed #cbd5e1; border-radius:6px; margin-top:0.3rem; padding:0.4rem; font-size:0.65rem; color:#94a3b8; box-sizing:border-box; display:flex; flex-direction:column; justify-content:flex-start;">
                    <span style="font-weight:800; color:#475569; display:block; margin-bottom:0.1rem; font-size:0.6rem;">JUDGE REMARKS / OBSERVATIONS / CALCULATIONS:</span>
                </div>
                
                <!-- Fixed Judge Footer Pinned to Absolute Bottom (Phase 4) -->
                <div class="val-judge-row" style="display:flex; justify-content:space-between; align-items:center; font-size:0.65rem; color:#1e293b; margin-top:0.3rem; border-top:1.5px solid #475569; padding-top:0.25rem; font-weight:800; width:100%; box-sizing:border-box;">
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
                    <div class="report-header">
                        <div>
                            <div class="report-title">🚪 GREEN ROOM SIGN-IN</div>
                            <h2 style="margin-top:0.3rem; margin-bottom:0.1rem; color:#1e1b4b;">${window.escapeHTML(p.programName)}</h2>
                            <div style="font-size:0.75rem; font-weight:700; color:#4338ca;">
                                Category: ${window.escapeHTML(p.categoryName)} ${p.className ? `· Class: ${window.escapeHTML(p.className)}` : ''} · 
                                Type: ${p.programType === 'group' ? 'Group Event' : 'Individual Event'}
                            </div>
                        </div>
                        <div style="text-align:right;">
                            <span style="font-size:0.65rem; font-weight:800; color:#64748b; text-transform:uppercase; display:block;">Total Entries</span>
                            <span style="font-weight:900; font-size:1.15rem; color:#1e1b4b;">${parts.length} entries</span>
                        </div>
                    </div>

                    <table class="report-table">
                        <thead>
                            <tr>
                                <th style="width:50px; text-align:center;">SL</th>
                                <th style="width:100px; text-align:center;">Chest No</th>
                                <th>Participant / Team Name</th>
                                <th style="width:110px; text-align:center;">Code Letter</th>
                                <th style="width:180px; text-align:center;">Signature</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${parts.length === 0 ? `<tr><td colspan="5" style="text-align:center; padding:1.5rem; color:#64748b;">No registered entries.</td></tr>` :
                    parts.map((item, idx) => `
                                <tr style="height:35px;">
                                    <td style="text-align:center; font-weight:700; color:#475569;">${idx + 1}</td>
                                    <td style="text-align:center; font-weight:800; color:#0f172a;">${window.escapeHTML(item.chestNumber || '—')}</td>
                                    <td style="font-weight:700; color:#1e293b;">${window.escapeHTML(item.name)}</td>
                                    <td style="text-align:center;"></td>
                                    <td></td>
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

        // Phase 5 to 10 Redesign: Partition programs into four distinct scale buckets based on participant volume
        const bucket4 = []; // 1 to 10 participants -> 4 cards per A4 page (2x2 Grid)
        const bucket3 = []; // 11 to 20 participants -> 3 cards per A4 page (1x3 Vertical stack)
        const bucket2 = []; // 21 to 35 participants -> 2 cards per A4 page (1x2 Vertical stack)
        const bucket1 = []; // 35+ participants -> 1 card per page with continuation pagination

        programs.forEach(p => {
            const parts = participantsMap[p.id] || [];
            const count = parts.length;
            if (count <= 10) {
                bucket4.push({ p, parts });
            } else if (count <= 20) {
                bucket3.push({ p, parts });
            } else if (count <= 35) {
                bucket2.push({ p, parts });
            } else {
                bucket1.push({ p, parts });
            }
        });

        // 1. Process bucket4 (4 Cards / A4 Page, 2x2 Grid)
        const cardsPerSheet4 = 4;
        const totalSheets4 = Math.ceil(bucket4.length / cardsPerSheet4);
        for (let sheetIdx = 0; sheetIdx < totalSheets4; sheetIdx++) {
            const slice = bucket4.slice(sheetIdx * cardsPerSheet4, (sheetIdx + 1) * cardsPerSheet4);
            htmlContent += `
                <div class="valuation-grid-sheet-2x2">
                    ${slice.map(item => renderValuationCard(item.p, item.parts)).join('')}
                </div>
            `;
        }

        // 2. Process bucket3 (3 Cards / A4 Page, 1x3 Stack)
        const cardsPerSheet3 = 3;
        const totalSheets3 = Math.ceil(bucket3.length / cardsPerSheet3);
        for (let sheetIdx = 0; sheetIdx < totalSheets3; sheetIdx++) {
            const slice = bucket3.slice(sheetIdx * cardsPerSheet3, (sheetIdx + 1) * cardsPerSheet3);
            htmlContent += `
                <div class="valuation-grid-sheet-3pack">
                    ${slice.map(item => renderValuationCard(item.p, item.parts)).join('')}
                </div>
            `;
        }

        // 3. Process bucket2 (2 Cards / A4 Page, 1x2 Stack)
        const cardsPerSheet2 = 2;
        const totalSheets2 = Math.ceil(bucket2.length / cardsPerSheet2);
        for (let sheetIdx = 0; sheetIdx < totalSheets2; sheetIdx++) {
            const slice = bucket2.slice(sheetIdx * cardsPerSheet2, (sheetIdx + 1) * cardsPerSheet2);
            htmlContent += `
                <div class="valuation-grid-sheet-2pack">
                    ${slice.map(item => renderValuationCard(item.p, item.parts)).join('')}
                </div>
            `;
        }

        // 4. Process bucket1 (1 Card / Page, Auto-Paginating Continuation Sheets)
        bucket1.forEach(item => {
            const p = item.p;
            const parts = item.parts;
            const rowsPerPage = 30;
            const totalPages = Math.ceil(parts.length / rowsPerPage);

            for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
                const slice = parts.slice((pageNum - 1) * rowsPerPage, pageNum * rowsPerPage);
                htmlContent += `
                    <div class="valuation-grid-sheet-full">
                        ${renderValuationCard(p, slice, pageNum, totalPages)}
                    </div>
                `;
            }
        });

        // 5. Append SaaS dynamic Print Audit & Operations Report (Phase 14)
        let auditRowsHtml = '';
        let totalPageCount = 0;

        totalPageCount += Math.ceil(bucket4.length / 4);
        totalPageCount += Math.ceil(bucket3.length / 3);
        totalPageCount += Math.ceil(bucket2.length / 2);
        bucket1.forEach(item => {
            totalPageCount += Math.ceil(item.parts.length / 30);
        });

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

        bucket4.forEach(item => {
            auditRowsHtml += buildAuditRow(item.p, item.parts.length, "4 Cards / A4 (2x2 Grid)", "0.25", "None (Standard 23px)", "None");
        });
        bucket3.forEach(item => {
            auditRowsHtml += buildAuditRow(item.p, item.parts.length, "3 Cards / A4 (1x3 Stack)", "0.33", "Medium (21px)", "None");
        });
        bucket2.forEach(item => {
            auditRowsHtml += buildAuditRow(item.p, item.parts.length, "2 Cards / A4 (1x2 Stack)", "0.50", "Compact (19px)", "None");
        });
        bucket1.forEach(item => {
            const pages = Math.ceil(item.parts.length / 30);
            auditRowsHtml += buildAuditRow(item.p, item.parts.length, "1 Card / Page (Full A4)", pages.toFixed(2), "High (17px)", pages > 1 ? `Continuation (${pages} pages)` : "None");
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
        // Sort programs by location then program name
        programs.sort((a, b) => {
            const locCmp = (a.programLocation || '').localeCompare(b.programLocation || '');
            if (locCmp !== 0) return locCmp;
            return (a.programName || '').localeCompare(b.programName || '');
        });

        programs.forEach(p => {
            const parts = participantsMap[p.id] || [];
            const pType = (p.programType || '').toLowerCase();
            const pageDivClass = isCompact ? 'program-card-compact' : 'program-page-standard';

            let bodyHtml = '';

            if (pType === 'general' || pType === 'group') {
                const tableHeaderHtml = `
                    <tr>
                        <th style="width:50px; text-align:center;">SL</th>
                        <th style="width:250px;">Chest Numbers</th>
                        <th>Group Name</th>
                        <th style="width:160px;">Team</th>
                    </tr>
                `;

                let tableBodyHtml = '';

                const hasGroups = parts.some(item => item.isGroup);

                if (pType === 'general' && !hasGroups) {
                    // Group actual participants by team for General Programs with individual registrations (1 row per team)
                    const teamsMap = {};
                    parts.forEach(item => {
                        const tName = item.teamName || 'General';
                        if (!teamsMap[tName]) teamsMap[tName] = [];
                        teamsMap[tName].push(item);
                    });

                    const teamNames = Object.keys(teamsMap).sort();

                    tableBodyHtml = teamNames.length === 0 ? `
                        <tr>
                            <td colspan="4" style="text-align:center; padding:0.6rem; color:#64748b;">No registered entries.</td>
                        </tr>
                    ` : teamNames.map((tName, idx) => {
                        const teamParts = teamsMap[tName];
                        // Sort and de-duplicate chest numbers numerically
                        const chestNumbers = [...new Set(teamParts.map(item => item.chestNumber).filter(Boolean))]
                            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
                            .join(', ');

                        return `
                            <tr style="height:28px; page-break-inside:avoid; vertical-align:middle;">
                                <td style="text-align:center; font-weight:800; color:#64748b; padding:0.35rem 0.4rem;">${idx + 1}</td>
                                <td style="font-weight:800; color:#1e1b4b; word-break:break-word; white-space:normal; padding:0.35rem 0.4rem; letter-spacing:0.02em;">
                                    ${window.escapeHTML(chestNumbers || '—')}
                                </td>
                                <td style="font-weight:800; color:#475569; padding:0.35rem 0.4rem;">${window.escapeHTML(tName)} Participants</td>
                                <td style="padding:0.35rem 0.4rem;">
                                    <span class="call-team-badge">${window.escapeHTML(tName)}</span>
                                </td>
                            </tr>
                        `;
                    }).join('');
                } else {
                    // Group Programs OR General Programs with group registrations (render actual group name!)
                    tableBodyHtml = parts.length === 0 ? `
                        <tr>
                            <td colspan="4" style="text-align:center; padding:0.6rem; color:#64748b;">No registered entries.</td>
                        </tr>
                    ` : parts.map((groupItem, idx) => {
                        // Sort and de-duplicate chest numbers numerically
                        const chestNumbers = [...new Set((groupItem.members || []).map(m => m.chestNumber).filter(Boolean))]
                            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
                            .join(', ');

                        return `
                            <tr style="height:28px; page-break-inside:avoid; vertical-align:middle;">
                                <td style="text-align:center; font-weight:800; color:#64748b; padding:0.35rem 0.4rem;">${idx + 1}</td>
                                <td style="font-weight:800; color:#1e1b4b; word-break:break-word; white-space:normal; padding:0.35rem 0.4rem; letter-spacing:0.02em;">
                                    ${window.escapeHTML(chestNumbers || '—')}
                                </td>
                                <td style="font-weight:800; color:#475569; padding:0.35rem 0.4rem;">${window.escapeHTML(groupItem.name)}</td>
                                <td style="padding:0.35rem 0.4rem;">
                                    <span class="call-team-badge">${window.escapeHTML(groupItem.teamName || '—')}</span>
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
                // Individual Programs: 4-column compact table
                const tableHeaderHtml = `
                    <tr>
                        <th style="width:50px; text-align:center;">SL</th>
                        <th style="width:110px; text-align:center;">Chest No</th>
                        <th>Participant Name</th>
                        <th style="width:160px;">Team</th>
                    </tr>
                `;

                const tableBodyHtml = parts.length === 0 ? `
                    <tr>
                        <td colspan="4" style="text-align:center; padding:0.6rem; color:#64748b;">No registered entries.</td>
                    </tr>
                ` : parts.map((item, idx) => `
                    <tr style="height:28px; page-break-inside:avoid;">
                        <td style="text-align:center; font-weight:800; color:#64748b;">${idx + 1}</td>
                        <td style="text-align:center;">
                            <span class="call-chest-badge">${window.escapeHTML(item.chestNumber || '—')}</span>
                        </td>
                        <td style="font-weight:800; color:#1e1b4b;">${window.escapeHTML(item.name)}</td>
                        <td>
                            <span class="call-team-badge">${window.escapeHTML(item.teamName || '—')}</span>
                        </td>
                    </tr>
                `).join('');

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
                            <h3 style="margin:0; font-size:1.05rem; font-weight:800; color:#1e1b4b; display:inline;">${window.escapeHTML(p.programName)}</h3>
                            <span style="font-size:0.75rem; font-weight:700; color:#475569; margin-left:0.4rem;">&bull; ${window.escapeHTML(formatLabel(p.categoryName))} ${p.className ? `&bull; Class: ${window.escapeHTML(formatLabel(p.className))}` : ''} &bull; Location: ${window.escapeHTML(formatLabel(p.programLocation || 'Stage'))}</span>
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

            allTeams.forEach(t => teamPoints.set(t.name, 0));
            allCategories.forEach(c => categoryScores.set(c.id, new Map()));

            filteredResults.forEach(r => {
                const prog = allPrograms.find(p => p.id === r.programId);
                if (!prog) return;

                if (Array.isArray(r.marksData) && r.marksData.length > 0) {
                    r.marksData.forEach(w => {
                        const team = w.teamName;
                        const pts = Number(w.totalPoints) || 0;
                        if (team && pts > 0) {
                            teamPoints.set(team, (teamPoints.get(team) || 0) + pts);
                        }
                        // For Category Champions accumulation
                        if (w.studentName && prog.categoryId) {
                            const map = categoryScores.get(prog.categoryId);
                            if (map) {
                                const key = w.studentName;
                                if (!map.has(key)) {
                                    map.set(key, { name: w.studentName, teamName: w.teamName || '—', points: 0 });
                                }
                                map.get(key).points += pts;
                            }
                        }
                    });
                } else if (Array.isArray(r.winners)) {
                    r.winners.forEach(w => {
                        const team = w.teamName;
                        const pts = Number(w.marks) || 0;
                        if (team && pts > 0) {
                            teamPoints.set(team, (teamPoints.get(team) || 0) + pts);
                        }
                        // For Category Champions accumulation
                        if (w.studentName && prog.categoryId) {
                            const map = categoryScores.get(prog.categoryId);
                            if (map) {
                                const key = w.studentName;
                                if (!map.has(key)) {
                                    map.set(key, { name: w.studentName, teamName: w.teamName || '—', points: 0 });
                                }
                                map.get(key).points += pts;
                            }
                        }
                    });
                }
            });

            // 1. Team Championship Standings (Phase 6)
            const sortedTeamStandings = [...teamPoints.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([name, points], idx) => ({ rank: idx + 1, team: name, points }));

            htmlContent += `
                <div class="program-page-standard" style="page-break-after:always;">
                    <div style="text-align:center; margin-bottom:2rem; border-bottom:3px double #4338ca; padding-bottom:1rem;">
                        <span style="font-size:0.8rem; font-weight:800; color:#4338ca; letter-spacing:0.1em; text-transform:uppercase;">🏆 OFFICIAL TOURNAMENT RESULTS</span>
                        <h1 style="color:#1e1b4b; margin:0.25rem 0 0 0; font-size:1.8rem; font-weight:900;">TEAM CHAMPIONSHIP STANDINGS</h1>
                    </div>

                    <table class="report-table" style="font-size:0.95rem;">
                        <thead>
                            <tr style="background:#f8fafc;">
                                <th style="width:80px; text-align:center;">Rank</th>
                                <th>Team / Institute Name</th>
                                <th style="width:160px; text-align:center; font-weight:800;">Total Aggregate Points</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${sortedTeamStandings.map(t => `
                                <tr style="height:42px; background:${t.rank === 1 ? '#fffbeb' : 'none'};">
                                    <td style="text-align:center; font-weight:900; color:#1e1b4b; font-size:1.1rem;">
                                        ${t.rank === 1 ? '🥇 1' : (t.rank === 2 ? '🥈 2' : (t.rank === 3 ? '🥉 3' : t.rank))}
                                    </td>
                                    <td style="font-weight:800; color:#1e293b; font-size:1.05rem;">${window.escapeHTML(t.team)}</td>
                                    <td style="text-align:center; font-weight:900; color:#16a34a; font-size:1.15rem;">${t.points} pts</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;

            // 2. Category Champions Summaries (Phase 6)
            let categoryHTML = '';
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
                    const winners = Array.isArray(r.winners) ? r.winners : [];
                    winners.forEach(w => {
                        if (!w.teamName) return;
                        if (f.teamId && w.teamId !== f.teamId) return;

                        if (!teamWinners.has(w.teamName)) {
                            teamWinners.set(w.teamName, { First: [], Second: [], Third: [] });
                        }
                        let chestNumber = w.chestNumber || '—';
                        if (w.studentId && studentMap[w.studentId]) {
                            chestNumber = studentMap[w.studentId].chestNumber || chestNumber;
                        } else if (w.studentName) {
                            const found = Object.values(studentMap).find(s => s.name === w.studentName);
                            if (found) {
                                chestNumber = found.chestNumber || chestNumber;
                            }
                        }
                        const entry = {
                            programName: r.programName,
                            categoryName: r.categoryName,
                            studentName: w.studentName,
                            chestNumber: chestNumber
                        };

                        if (w.position === 'First') teamWinners.get(w.teamName).First.push(entry);
                        else if (w.position === 'Second') teamWinners.get(w.teamName).Second.push(entry);
                        else if (w.position === 'Third') teamWinners.get(w.teamName).Third.push(entry);
                    });
                });

                const sortedTeamNames = [...teamWinners.keys()].sort();
                sortedTeamNames.forEach(teamName => {
                    const data = teamWinners.get(teamName);

                    const renderRows = (list, posLabel) => {
                        if (list.length === 0) return `<tr><td colspan="4" style="color:#94a3b8; font-style:italic; font-size:0.75rem;">No ${posLabel} place winners recorded.</td></tr>`;
                        return list.map(item => `
                            <tr>
                                <td style="font-weight:800; color:#1e293b;">${window.escapeHTML(item.programName)}</td>
                                <td style="color:#475569; font-weight:600;">${window.escapeHTML(item.categoryName)}</td>
                                <td style="text-align:center; font-weight:800;">${window.escapeHTML(item.chestNumber)}</td>
                                <td style="font-weight:700; color:#4338ca;">${window.escapeHTML(item.studentName)}</td>
                            </tr>
                        `).join('');
                    };

                    htmlContent += `
                        <div class="program-page-standard">
                            <div style="border-bottom:3px solid #1e1b4b; padding-bottom:0.5rem; margin-bottom:1rem; display:flex; justify-content:space-between; align-items:flex-end;">
                                <h2 style="color:#1e1b4b; margin:0;">👥 TEAM WINNERS INDEX: ${window.escapeHTML(teamName)}</h2>
                            </div>

                            <h4 style="color:#d97706; margin-top:0.75rem; margin-bottom:0.4rem;">🥇 FIRST WINNERS</h4>
                            <table class="report-table" style="margin-bottom:1rem; font-size:0.8rem;">
                                <thead>
                                    <tr style="background:#fffbeb;">
                                        <th>Program</th>
                                        <th>Category</th>
                                        <th style="width:100px; text-align:center;">Chest No</th>
                                        <th>Winner Name</th>
                                    </tr>
                                </thead>
                                <tbody>${renderRows(data.First, 'first')}</tbody>
                            </table>

                            <h4 style="color:#475569; margin-top:1.25rem; margin-bottom:0.4rem;">🥈 SECOND WINNERS</h4>
                            <table class="report-table" style="margin-bottom:1rem; font-size:0.8rem;">
                                <thead>
                                    <tr style="background:#f8fafc;">
                                        <th>Program</th>
                                        <th>Category</th>
                                        <th style="width:100px; text-align:center;">Chest No</th>
                                        <th>Winner Name</th>
                                    </tr>
                                </thead>
                                <tbody>${renderRows(data.Second, 'second')}</tbody>
                            </table>

                            <h4 style="color:#ea580c; margin-top:1.25rem; margin-bottom:0.4rem;">🥉 THIRD WINNERS</h4>
                            <table class="report-table" style="font-size:0.8rem;">
                                <thead>
                                    <tr style="background:#fff7ed;">
                                        <th>Program</th>
                                        <th>Category</th>
                                        <th style="width:100px; text-align:center;">Chest No</th>
                                        <th>Winner Name</th>
                                    </tr>
                                </thead>
                                <tbody>${renderRows(data.Third, 'third')}</tbody>
                            </table>
                        </div>
                    `;
                });
            }

            else if (f.resultSubOption === 'Program Wise') {
                filteredResults.forEach(r => {
                    const winnersList = Array.isArray(r.winners) ? r.winners : [];

                    const posOrder = { 'First': 1, 'Second': 2, 'Third': 3 };
                    const sortedWinners = [...winnersList].sort((a, b) => (posOrder[a.position] || 4) - (posOrder[b.position] || 4));

                    htmlContent += `
                        <div class="program-page-standard">
                            <div class="report-header">
                                <div>
                                    <div class="report-title">🏆 PROGRAM RESULTS PODIUM</div>
                                    <h2 style="margin-top:0.3rem; margin-bottom:0.1rem; color:#1e1b4b; font-size:1.3rem;">${window.escapeHTML(r.programName)}</h2>
                                    <div style="font-size:0.75rem; font-weight:700; color:#4338ca;">
                                        Category: ${window.escapeHTML(r.categoryName)} ${r.className ? `· Class: ${window.escapeHTML(r.className)}` : ''} · 
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
                                        <th style="width:110px; text-align:center;">Position</th>
                                        <th style="width:110px; text-align:center;">Chest No</th>
                                        <th>Winner / Team Name</th>
                                        <th>Representing Institute</th>
                                        <th style="width:90px; text-align:center;">Grade</th>
                                        <th style="width:100px; text-align:center;">Points</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${sortedWinners.length === 0 ? `<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:#64748b;">No winners recorded for this program.</td></tr>` :
                            sortedWinners.map(w => {
                                let posBadge = '';
                                if (w.position === 'First') posBadge = '🥇 First';
                                else if (w.position === 'Second') posBadge = '🥈 Second';
                                else if (w.position === 'Third') posBadge = '🥉 Third';
                                else posBadge = w.position;

                                let grade = w.grade || '—';
                                let points = w.marks !== undefined ? `${w.marks} pts` : '0 pts';

                                if (Array.isArray(r.marksData)) {
                                    const match = r.marksData.find(m =>
                                        (r.programType === 'group' && m.teamName === w.teamName) ||
                                        (r.programType !== 'group' && m.studentId === w.studentId) ||
                                        (r.programType !== 'group' && m.studentName === w.studentName)
                                    );
                                    if (match) {
                                        grade = match.grade || grade;
                                        points = match.totalPoints !== undefined ? `${match.totalPoints} pts` : points;
                                    }
                                }

                                let chestNumber = w.chestNumber || '—';
                                if (r.programType !== 'group') {
                                    if (w.studentId && studentMap[w.studentId]) {
                                        chestNumber = studentMap[w.studentId].chestNumber || chestNumber;
                                    } else if (w.studentName) {
                                        const found = Object.values(studentMap).find(s => s.name === w.studentName);
                                        if (found) {
                                            chestNumber = found.chestNumber || chestNumber;
                                        }
                                    }
                                }

                                return `
                                            <tr>
                                                <td style="text-align:center; font-weight:900; color:#1e1b4b;">${posBadge}</td>
                                                <td style="text-align:center; font-weight:800; color:#0f172a;">${window.escapeHTML(chestNumber)}</td>
                                                <td style="font-weight:700; color:#1e293b;">${window.escapeHTML(r.programType === 'group' ? w.teamName : w.studentName)}</td>
                                                <td style="font-weight:600; color:#475569;">${window.escapeHTML(w.teamName || '—')}</td>
                                                <td style="text-align:center; font-weight:800; color:#4338ca;">${grade}</td>
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
                    const winnersList = Array.isArray(r.winners) ? r.winners : [];
                    winnersList.forEach(w => {
                        if (r.programType === 'group') return;
                        const stuKey = w.chestNumber || w.studentName;
                        if (!stuKey) return;

                        if (!studentPrizes.has(stuKey)) {
                            let chestNumber = w.chestNumber || '—';
                            let classId = '';
                            let className = '—';
                            let categoryId = '';
                            let categoryName = '—';
                            if (w.studentId && studentMap[w.studentId]) {
                                chestNumber = studentMap[w.studentId].chestNumber || chestNumber;
                                classId = studentMap[w.studentId].classId || '';
                                className = studentMap[w.studentId].className || '—';
                                categoryId = studentMap[w.studentId].categoryId || '';
                                categoryName = studentMap[w.studentId].categoryName || '—';
                            } else if (w.studentName) {
                                const found = Object.values(studentMap).find(s => s.name === w.studentName);
                                if (found) {
                                    chestNumber = found.chestNumber || chestNumber;
                                    classId = found.classId || '';
                                    className = found.className || '—';
                                    categoryId = found.categoryId || '';
                                    categoryName = found.categoryName || '—';
                                }
                            }

                            studentPrizes.set(stuKey, {
                                studentName: w.studentName,
                                chestNumber: chestNumber,
                                className: className,
                                categoryName: categoryName,
                                teamName: w.teamName || '—',
                                prizes: []
                            });
                        }

                        studentPrizes.get(stuKey).prizes.push({
                            programName: r.programName,
                            position: w.position
                        });
                    });
                });

                if (studentPrizes.size === 0) {
                    htmlContent = `<div style="text-align:center; padding:3rem; color:#64748b; font-weight:600;">No student prizes recorded under the selected parameters.</div>`;
                } else {
                    const sortedStudents = [...studentPrizes.values()].sort((a, b) => {
                        const catA = a.categoryName || '';
                        const catB = b.categoryName || '';
                        const catCompare = catA.localeCompare(catB, undefined, { sensitivity: 'base' });
                        if (catCompare !== 0) return catCompare;

                        const classA = a.className || '';
                        const classB = b.className || '';
                        const classCompare = classA.localeCompare(classB, undefined, { numeric: true, sensitivity: 'base' });
                        if (classCompare !== 0) return classCompare;

                        return a.studentName.localeCompare(b.studentName);
                    });

                    htmlContent = `
                        <div class="program-page-standard">
                            <div style="border-bottom:3px solid #4338ca; padding-bottom:0.6rem; margin-bottom:1rem;">
                                <h2 style="color:#1e1b4b; margin:0; font-weight:900;">🎖️ STUDENT PRIZE DISTRIBUTION REGISTER</h2>
                                <p style="margin:0.2rem 0 0 0; font-size:0.75rem; color:#64748b; font-weight:600;">Aggregated chronological individual student prizes list.</p>
                            </div>

                            <table class="report-table">
                                <thead>
                                    <tr>
                                        <th style="width:100px; text-align:center;">Chest No</th>
                                        <th>Student Name</th>
                                        <th>Class</th>
                                        <th>Category</th>
                                        <th>Team / Institute Name</th>
                                        <th>Prizes Summary & Placements</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${sortedStudents.map(stu => `
                                        <tr>
                                            <td style="text-align:center; font-weight:900; color:#0f172a; font-size:1.05rem;">${window.escapeHTML(stu.chestNumber)}</td>
                                            <td style="font-weight:800; color:#1e1b4b;">${window.escapeHTML(stu.studentName)}</td>
                                            <td style="font-weight:700; color:#475569;">${window.escapeHTML(stu.className)}</td>
                                            <td style="font-weight:700; color:#475569;">${window.escapeHTML(stu.categoryName)}</td>
                                            <td style="font-weight:700; color:#475569;">🏛️ ${window.escapeHTML(stu.teamName)}</td>
                                            <td style="padding:0.4rem 0.75rem;">
                                                <div style="display:flex; flex-direction:column; gap:0.25rem;">
                                                    ${stu.prizes.map(p => {
                        const icon = p.position === 'First' ? '🥇' : (p.position === 'Second' ? '🥈' : '🥉');
                        return `<span style="font-size:0.78rem; font-weight:700; color:#1e293b;">${icon} ${window.escapeHTML(p.programName)} ➔ <strong>${p.position}</strong></span>`;
                    }).join('')}
                                                </div>
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    `;
                }
            }

            else if (f.resultSubOption === 'Participants Without Major Prizes') {
                const teamNamesMap = {};
                allTeams.forEach(t => {
                    teamNamesMap[t.id] = t.name;
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
                        if (p.programType === 'group') return;
                        const pList = participantsMap[p.id] || [];
                        const isPart = pList.some(part => part.studentId === studentId || part.name === stu.name);
                        if (isPart) {
                            participations.push(p.programName);
                        }
                    });

                    filteredResults.forEach(r => {
                        if (r.programType === 'group') return;
                        const winners = Array.isArray(r.winners) ? r.winners : [];
                        winners.forEach(w => {
                            if (w.studentId === studentId || w.studentName === stu.name) {
                                prizes.push(w.position);
                            }
                        });
                    });

                    const hasMajorPrize = prizes.some(p => p === 'First' || p === 'Second');
                    if (hasMajorPrize) return;

                    const hasThirdPrize = prizes.some(p => p === 'Third');
                    const statusLabel = hasThirdPrize ? 'Third Prize Only' : 'No Prize';

                    studentDataList.push({
                        studentId: studentId,
                        chestNumber: stu.chestNumber || '—',
                        name: stu.name,
                        classId: stu.classId || 'standard',
                        className: stu.className || 'Standard',
                        categoryId: stu.categoryId || 'general',
                        categoryName: stu.categoryName || 'General',
                        teamName: teamNamesMap[stu.teamId] || stu.teamName || 'Independent',
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
                    const grouped = {};
                    studentDataList.forEach(stu => {
                        const catId = stu.categoryId;
                        const catName = stu.categoryName;
                        const status = stu.status;
                        const classId = stu.classId;
                        const className = stu.className;

                        if (!grouped[catId]) {
                            grouped[catId] = {
                                name: catName,
                                statuses: {
                                    'No Prize': { name: '=== NO PRIZE ===', classes: {} },
                                    'Third Prize Only': { name: '=== THIRD PRIZE ONLY ===', classes: {} }
                                }
                            };
                        }

                        if (!grouped[catId].statuses[status].classes[classId]) {
                            grouped[catId].statuses[status].classes[classId] = {
                                name: className,
                                students: []
                            };
                        }

                        grouped[catId].statuses[status].classes[classId].students.push(stu);
                    });

                    const sortedCatIds = Object.keys(grouped).sort((a, b) => grouped[a].name.localeCompare(grouped[b].name));
                    
                    sortedCatIds.forEach(catId => {
                        const cat = grouped[catId];
                        
                        let noPrizeCount = 0;
                        let thirdPrizeCount = 0;
                        
                        Object.values(cat.statuses['No Prize'].classes).forEach(cls => {
                            noPrizeCount += cls.students.length;
                        });
                        Object.values(cat.statuses['Third Prize Only'].classes).forEach(cls => {
                            thirdPrizeCount += cls.students.length;
                        });
                        
                        const totalEligible = noPrizeCount + thirdPrizeCount;

                        htmlContent += `
                            <div class="program-page-standard" style="margin-bottom: 2rem;">
                                <div style="border-bottom:3px solid #1e1b4b; padding-bottom:0.5rem; margin-bottom:1rem; display:flex; justify-content:space-between; align-items:flex-end;">
                                    <div>
                                        <h2 style="color:#1e1b4b; margin:0; text-transform:uppercase; font-weight:900;">🏅 PARTICIPANTS WITHOUT MAJOR PRIZES</h2>
                                        <h3 style="color:#4338ca; margin-top:0.25rem; font-size:1.1rem; font-weight:700;">${window.escapeHTML(cat.name)}</h3>
                                    </div>
                                    <div class="summary-section" style="background:#f1f5f9; border:1px solid #cbd5e1; border-radius:8px; padding:0.5rem 0.75rem; font-size:0.75rem; color:#334155; line-height:1.45; min-width:180px;">
                                        <div style="font-weight:800; text-transform:uppercase; border-bottom:1.5px solid #cbd5e1; padding-bottom:0.2rem; margin-bottom:0.3rem; color:#1e1b4b;">Category Summary</div>
                                        <div>No Prize Students: <strong>${noPrizeCount}</strong></div>
                                        <div>Third Prize Only Students: <strong>${thirdPrizeCount}</strong></div>
                                        <div style="font-weight:700; color:#4338ca; margin-top:0.25rem;">Total Eligible: <strong>${totalEligible}</strong></div>
                                    </div>
                                </div>
                        `;

                        ['No Prize', 'Third Prize Only'].forEach(statusKey => {
                            const statusGroup = cat.statuses[statusKey];
                            const sortedClassIds = Object.keys(statusGroup.classes).sort((a, b) => {
                                const nameA = statusGroup.classes[a].name;
                                const nameB = statusGroup.classes[b].name;
                                return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
                            });

                            if (sortedClassIds.length > 0) {
                                htmlContent += `
                                    <div style="margin-top:1.25rem; margin-bottom:0.5rem; border-bottom:1.5px dashed #4338ca; padding-bottom:0.25rem;">
                                        <h3 style="color:#4338ca; font-size:0.95rem; font-weight:900; letter-spacing:0.04em;">${statusGroup.name}</h3>
                                    </div>
                                `;

                                sortedClassIds.forEach(classId => {
                                    const cls = statusGroup.classes[classId];
                                    const students = [...cls.students].sort((a, b) => a.name.localeCompare(b.name));

                                    htmlContent += `
                                        <div style="margin-left:0.5rem; margin-top:0.75rem; margin-bottom:0.75rem; page-break-inside:avoid; break-inside:avoid;">
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
                                                            <td style="font-weight:800; color:#1e1b4b;">${window.escapeHTML(s.name)}</td>
                                                            <td style="font-weight:700; color:#475569;">${window.escapeHTML(s.teamName)}</td>
                                                            <td style="text-align:center; font-weight:800; color:#4338ca;">${s.participationsCount}</td>
                                                            <td style="text-align:center; font-weight:700; color:${s.status === 'No Prize' ? '#475569' : '#b45309'}; font-size:0.75rem;">${s.status}</td>
                                                            <td style="font-size:0.72rem; color:#475569; font-weight:500;">${window.escapeHTML(s.participationsList.join(', ') || 'None')}</td>
                                                        </tr>
                                                    `).join('')}
                                                </tbody>
                                            </table>
                                        </div>
                                    `;
                                });
                            }
                        });

                        htmlContent += `</div>`;
                    });
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
    const pageMargin = f.type === 'Valuation Sheet' ? '5mm' : '15mm';

    // Standard Styles Injection for dynamic high-fidelity printing
    const styleBlock = `
        <style>
            @page {
                size: A4 ${orientation};
                margin: ${pageMargin}; /* Zero wasted spaces on valuation sheets */
            }
            body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                color: #1e293b;
                margin: 0;
                padding: 0;
                background: #fff;
                font-size: 0.85rem;
                line-height: 1.4;
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

            /* Valuation 1x3 vertical stack layout sheets (Phase 3 & 4) */
            .valuation-grid-sheet-3pack {
                display: flex;
                flex-direction: column;
                gap: 6mm;
                height: ${gridSheetHeight};
                width: 100%;
                box-sizing: border-box;
                padding: 2px;
                page-break-after: always;
                break-after: page;
                page-break-inside: avoid;
                break-inside: avoid;
            }
            .valuation-grid-sheet-3pack:last-child {
                page-break-after: avoid;
            }
            .valuation-grid-sheet-3pack .val-card {
                height: calc(33.3% - 4mm) !important;
            }

            /* Valuation 1x2 vertical stack layout sheets (Phase 3 & 4) */
            .valuation-grid-sheet-2pack {
                display: flex;
                flex-direction: column;
                gap: 6mm;
                height: ${gridSheetHeight};
                width: 100%;
                box-sizing: border-box;
                padding: 2px;
                page-break-after: always;
                break-after: page;
                page-break-inside: avoid;
                break-inside: avoid;
            }
            .valuation-grid-sheet-2pack:last-child {
                page-break-after: avoid;
            }
            .valuation-grid-sheet-2pack .val-card {
                height: calc(50% - 3mm) !important;
            }

            /* Valuation 1 Card / Full Page layout sheets (Phase 3 & 4) */
            .valuation-grid-sheet-full {
                display: flex;
                flex-direction: column;
                height: ${gridSheetHeight};
                width: 100%;
                box-sizing: border-box;
                padding: 2px;
                page-break-after: always;
                break-after: page;
                page-break-inside: avoid;
                break-inside: avoid;
            }
            .valuation-grid-sheet-full:last-child {
                page-break-after: avoid;
            }
            .valuation-grid-sheet-full .val-card {
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

    // Small timeout delay ensures document renders completely before starting printing dialogue
    setTimeout(() => {
        printIframe.contentWindow.focus();
        printIframe.contentWindow.print();
    }, 300);
}

// ─────────────────────────────────────────────
// CSV Dynamic Spreadsheet Blob Generator
// ─────────────────────────────────────────────
async function compileCSV(exp, f, programs, resultsList, participantsMap, studentMap = {}) {
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
            studentsList = studentsList.filter(s => s.teamId === f.teamId);
        }
        if (f.gender === 'Boys') {
            studentsList = studentsList.filter(s => s.gender === 'Male');
        } else if (f.gender === 'Girls') {
            studentsList = studentsList.filter(s => s.gender === 'Female');
        }

        const teamNamesMap = {};
        allTeams.forEach(t => {
            teamNamesMap[t.id] = t.name;
        });

        // Sort students according to chestSort parameter
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
                const teamA = teamNamesMap[a.teamId] || a.teamName || '';
                const teamB = teamNamesMap[b.teamId] || b.teamName || '';
                return teamA.localeCompare(teamB, undefined, { sensitivity: 'base' });
            });
        }

        const instName = window.currentInstituteDetails?.name || 'ADMIN PORTAL';

        studentsList.forEach((stu, idx) => {
            const catName = stu.categoryName || 'General';
            const className = stu.className || 'Standard';
            const teamName = teamNamesMap[stu.teamId] || stu.teamName || 'Independent';
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
        csvContent += "INSTITUTION,CATEGORY,CLASS,TEAM,GENDER,SL NO,CHEST NUMBER,PARTICIPANT NAME";

        let studentsList = Object.values(studentMap);

        if (f.categoryId) {
            studentsList = studentsList.filter(s => s.categoryId === f.categoryId);
        }
        if (f.classId) {
            studentsList = studentsList.filter(s => s.classId === f.classId);
        }
        if (f.teamId) {
            studentsList = studentsList.filter(s => s.teamId === f.teamId);
        }
        if (f.gender === 'Boys') {
            studentsList = studentsList.filter(s => s.gender === 'Male');
        } else if (f.gender === 'Girls') {
            studentsList = studentsList.filter(s => s.gender === 'Female');
        }

        const teamNamesMap = {};
        allTeams.forEach(t => {
            teamNamesMap[t.id] = t.name;
        });

        // Sort students according to chestSort parameter
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
                const teamA = teamNamesMap[a.teamId] || a.teamName || '';
                const teamB = teamNamesMap[b.teamId] || b.teamName || '';
                return teamA.localeCompare(teamB, undefined, { sensitivity: 'base' });
            });
        }

        // Get matching programs
        let matchingPrograms = [...allPrograms];
        if (f.categoryId) {
            matchingPrograms = matchingPrograms.filter(p => p.categoryId === f.categoryId);
        }
        if (f.classId) {
            matchingPrograms = matchingPrograms.filter(p => !p.classId || p.classId === f.classId);
        }
        if (f.gender) {
            matchingPrograms = matchingPrograms.filter(p => p.genderCategory === f.gender);
        }
        matchingPrograms.sort((a, b) => (a.programName || '').localeCompare(b.programName || ''));

        // Append program names to CSV header
        matchingPrograms.forEach(p => {
            csvContent += `,"${p.programName.replace(/"/g, '""')}"`;
        });
        csvContent += "\n";

        const instName = window.currentInstituteDetails?.name || 'ADMIN PORTAL';

        studentsList.forEach((stu, idx) => {
            const catName = stu.categoryName || 'General';
            const className = stu.className || 'Standard';
            const teamName = teamNamesMap[stu.teamId] || stu.teamName || 'Independent';

            // Build base row
            csvContent += `"${instName.replace(/"/g, '""')}","${catName.replace(/"/g, '""')}","${className.replace(/"/g, '""')}","${teamName.replace(/"/g, '""')}","${(stu.gender || '').replace(/"/g, '""')}",${idx + 1},"${(stu.chestNumber || '').replace(/"/g, '""')}","${(stu.name || '').replace(/"/g, '""')}"`;

            // Append blank columns for programs
            matchingPrograms.forEach(() => {
                csvContent += ',""';
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
        csvContent += "PROGRAM,CATEGORY,TYPE,SL NO,CHEST NUMBER,PARTICIPANT NAME,TEAM NAME\n";

        programs.forEach(p => {
            const parts = participantsMap[p.id] || [];
            parts.forEach((item, idx) => {
                csvContent += `"${p.programName}","${p.categoryName}","${p.type}",${idx + 1},"${item.chestNumber || '—'}","${item.name}","${item.teamName || ''}"\n`;
            });
        });
    }

    else if (f.type === 'Results') {
        const filteredResults = filterResultsBySource(resultsList, f);

        if (f.resultSubOption === 'Team Wise') {
            csvContent += "TEAM NAME,PLACEMENT,PROGRAM,CATEGORY,CHEST NUMBER,WINNER NAME\n";

            const teamWinners = new Map();
            filteredResults.forEach(r => {
                const winners = Array.isArray(r.winners) ? r.winners : [];
                winners.forEach(w => {
                    if (!w.teamName) return;
                    if (f.teamId && w.teamId !== f.teamId) return;

                    if (!teamWinners.has(w.teamName)) {
                        teamWinners.set(w.teamName, []);
                    }
                    teamWinners.get(w.teamName).push({
                        position: w.position,
                        programName: r.programName,
                        categoryName: r.categoryName,
                        studentName: w.studentName,
                        chestNumber: w.chestNumber || '—'
                    });
                });
            });

            const sortedTeams = [...teamWinners.keys()].sort();
            sortedTeams.forEach(teamName => {
                const entries = teamWinners.get(teamName);
                entries.forEach(e => {
                    csvContent += `"${teamName}","${e.position}","${e.programName}","${e.categoryName}","${e.chestNumber}","${e.studentName}"\n`;
                });
            });
        }

        else if (f.resultSubOption === 'Program Wise') {
            csvContent += "PROGRAM NAME,CATEGORY,POSITION,CHEST NUMBER,NAME,TEAM NAME,GRADE,POINTS\n";

            filteredResults.forEach(r => {
                const winnersList = Array.isArray(r.winners) ? r.winners : [];
                winnersList.forEach(w => {
                    let grade = w.grade || '—';
                    let points = w.marks !== undefined ? w.marks : 0;

                    if (Array.isArray(r.marksData)) {
                        const match = r.marksData.find(m =>
                            (r.programType === 'group' && m.teamName === w.teamName) ||
                            (r.programType !== 'group' && m.studentId === w.studentId) ||
                            (r.programType !== 'group' && m.studentName === w.studentName)
                        );
                        if (match) {
                            grade = match.grade || grade;
                            points = match.totalPoints !== undefined ? match.totalPoints : points;
                        }
                    }

                    csvContent += `"${r.programName}","${r.categoryName}","${w.position}","${w.chestNumber || '—'}","${r.programType === 'group' ? w.teamName : w.studentName}","${w.teamName || ''}","${grade}",${points}\n`;
                });
            });
        }

        else if (f.resultSubOption === 'Student Prize Distribution') {
            csvContent += "CHEST NUMBER,STUDENT NAME,TEAM,PRIZES SUMMARY\n";

            const studentPrizes = new Map();
            filteredResults.forEach(r => {
                const winnersList = Array.isArray(r.winners) ? r.winners : [];
                winnersList.forEach(w => {
                    const pType = (r.programType || r.type || 'individual').toLowerCase();
                    if (pType !== 'individual') return;
                    const stuKey = w.chestNumber || w.studentName;
                    if (!stuKey) return;

                    if (!studentPrizes.has(stuKey)) {
                        studentPrizes.set(stuKey, {
                            studentName: w.studentName,
                            chestNumber: w.chestNumber || '—',
                            teamName: w.teamName || '—',
                            prizes: []
                        });
                    }

                    studentPrizes.get(stuKey).prizes.push(`${r.programName} -> ${w.position}`);
                });
            });

            const sortedStudents = [...studentPrizes.values()].sort((a, b) => a.studentName.localeCompare(b.studentName));
            sortedStudents.forEach(stu => {
                csvContent += `"${stu.chestNumber}","${stu.studentName}","${stu.teamName}","${stu.prizes.join('; ')}"\n`;
            });
        }
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

        const isDraft = r.status === 'draft';
        const isSubmitted = r.markEntryStatus === 'submitted';

        if (r.status === 'published') return true;
        if (f.srcIncludeSubmitted && isDraft && isSubmitted) return true;
        if (f.srcIncludeDraft && isDraft && !isSubmitted) return true;

        return false;
    });
}
