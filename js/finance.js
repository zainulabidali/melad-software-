import { db } from './firebase.js';
import {
    collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { safeSessionGet } from './auth.js';

// Global memory clean-up handle
let unsubFinance = null;
let localRecords = [];

function safeEscape(str) {
    if (typeof window.escapeHTML === 'function') return window.escapeHTML(str);
    if (!str) return '';
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// ─────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────
export async function initFinanceView(container, topActions) {
    const instId = window.currentInstituteId;
    if (!instId) {
        container.innerHTML = '<div class="empty-state"><h3>Access Denied</h3><p>Please log in again.</p></div>';
        return;
    }

    // Permission check: Admin or SuperAdmin only
    const userProfileStr = safeSessionGet('melad_user_profile');
    let isAllowed = false;
    if (userProfileStr) {
        try {
            const prof = JSON.parse(userProfileStr);
            if (prof.role === 'admin' || prof.role === 'super_admin' || sessionStorage.getItem('superAdminImpersonating') === 'true') {
                isAllowed = true;
            }
        } catch (e) {}
    }

    if (!isAllowed) {
        container.innerHTML = `
            <div class="card" style="padding: 2rem; text-align: center; max-width: 500px; margin: 2rem auto;">
                <h3 style="color:#dc2626; margin-bottom: 0.5rem;">Access Denied</h3>
                <p style="color:#64748b; margin-bottom: 1rem;">This page is available ONLY for Admin.</p>
                <button class="btn btn-secondary" onclick="window.navigateTo('dashboard')">Back to Dashboard</button>
            </div>
        `;
        return;
    }

    // Set Topbar Action
    topActions.innerHTML = `
        <button type="button" class="btn btn-secondary btn-sm" id="btnBackToSettings" style="font-weight:700;">
            ← Back to Settings
        </button>
    `;
    document.getElementById('btnBackToSettings')?.addEventListener('click', () => {
        if (typeof window.navigateTo === 'function') {
            window.navigateTo('settings');
        }
    });

    // Render Base Page Skeleton
    renderPageSkeleton(container);

    // Bind Add Buttons
    document.getElementById('btnOpenAddIncome').onclick = () => openAddModal('income');
    document.getElementById('btnOpenAddExpense').onclick = () => openAddModal('expense');
    document.getElementById('btnPrintFinanceReport').onclick = () => printReport();
    document.getElementById('btnPdfFinanceReport').onclick = () => printReport();
    document.getElementById('btnExportFinanceExcel').onclick = () => exportToExcel();

    // Subscribe to Firestore collection
    subscribeFinanceData(instId);
}

// Cleanup helper
function cleanupListener() {
    if (unsubFinance) {
        try { unsubFinance(); } catch (e) {}
        unsubFinance = null;
    }
}

// ─────────────────────────────────────────────
// Render Main Page Layout
// ─────────────────────────────────────────────
function renderPageSkeleton(container) {
    container.innerHTML = `
        <div class="finance-container" style="display:flex; flex-direction:column; gap:1.25rem;">
            
            <!-- 5 Top Summary Cards -->
            <div class="summary-cards-grid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:1rem;">
                
                <!-- Total Income -->
                <div class="card" style="padding:1.25rem; background:linear-gradient(135deg, #f0fdf4, #dcfce7); border:1px solid #bbf7d0; border-radius:12px;">
                    <div style="font-size:0.75rem; font-weight:700; color:#166534; text-transform:uppercase; letter-spacing:0.05em;">Total Income</div>
                    <div id="statTotalIncome" style="font-size:1.6rem; font-weight:900; color:#15803d; margin-top:0.35rem;">₹0</div>
                </div>

                <!-- Total Expense -->
                <div class="card" style="padding:1.25rem; background:linear-gradient(135deg, #fef2f2, #fee2e2); border:1px solid #fecaca; border-radius:12px;">
                    <div style="font-size:0.75rem; font-weight:700; color:#991b1b; text-transform:uppercase; letter-spacing:0.05em;">Total Expense</div>
                    <div id="statTotalExpense" style="font-size:1.6rem; font-weight:900; color:#dc2626; margin-top:0.35rem;">₹0</div>
                </div>

                <!-- Balance -->
                <div class="card" id="cardBalance" style="padding:1.25rem; background:linear-gradient(135deg, #eff6ff, #dbeafe); border:1px solid #bfdbfe; border-radius:12px;">
                    <div style="font-size:0.75rem; font-weight:700; color:#1e40af; text-transform:uppercase; letter-spacing:0.05em;">Balance</div>
                    <div id="statBalance" style="font-size:1.6rem; font-weight:900; color:#1d4ed8; margin-top:0.35rem;">₹0</div>
                </div>

                <!-- Income Entries -->
                <div class="card" style="padding:1.25rem; background:#ffffff; border:1px solid #e2e8f0; border-radius:12px;">
                    <div style="font-size:0.75rem; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.05em;">Income Entries</div>
                    <div id="statIncomeCount" style="font-size:1.6rem; font-weight:900; color:#0f172a; margin-top:0.35rem;">0</div>
                </div>

                <!-- Expense Entries -->
                <div class="card" style="padding:1.25rem; background:#ffffff; border:1px solid #e2e8f0; border-radius:12px;">
                    <div style="font-size:0.75rem; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.05em;">Expense Entries</div>
                    <div id="statExpenseCount" style="font-size:1.6rem; font-weight:900; color:#0f172a; margin-top:0.35rem;">0</div>
                </div>
            </div>

            <!-- Action Buttons Bar -->
            <div class="card" style="padding:1rem 1.25rem; display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:0.75rem; border-radius:12px;">
                <div style="display:flex; gap:0.75rem; flex-wrap:wrap;">
                    <button type="button" id="btnOpenAddIncome" class="btn" style="background:#16a34a; color:#ffffff; font-weight:800; padding:0.6rem 1.25rem; border:none; border-radius:8px; cursor:pointer;">
                        + Add Income
                    </button>
                    <button type="button" id="btnOpenAddExpense" class="btn" style="background:#dc2626; color:#ffffff; font-weight:800; padding:0.6rem 1.25rem; border:none; border-radius:8px; cursor:pointer;">
                        + Add Expense
                    </button>
                </div>
                <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                    <button type="button" id="btnPrintFinanceReport" class="btn btn-secondary btn-sm" style="font-weight:700;">
                        🖨️ Print
                    </button>
                    <button type="button" id="btnPdfFinanceReport" class="btn btn-secondary btn-sm" style="font-weight:700;">
                        📄 PDF
                    </button>
                    <button type="button" id="btnExportFinanceExcel" class="btn btn-secondary btn-sm" style="font-weight:700;">
                        📊 Excel
                    </button>
                </div>
            </div>

            <!-- Content Grid: Recent Records & Expense Summary -->
            <div style="display:grid; grid-template-columns: 2fr 1fr; gap:1.25rem;" class="finance-content-grid">
                
                <!-- Left: Recent Records -->
                <div class="card" style="padding:1.25rem; border-radius:12px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #f1f5f9; padding-bottom:0.75rem; margin-bottom:1rem;">
                        <h3 style="margin:0; font-size:1.1rem; font-weight:800; color:#0f172a;">Recent Records</h3>
                        <span style="font-size:0.8rem; color:#64748b;" id="recordCountTag">0 Records</span>
                    </div>
                    <div id="recentRecordsContainer" style="overflow-x:auto;">
                        <div style="text-align:center; padding:2rem; color:#94a3b8;">Loading records...</div>
                    </div>
                </div>

                <!-- Right: Expense Summary List -->
                <div class="card" style="padding:1.25rem; border-radius:12px;">
                    <div style="border-bottom:1px solid #f1f5f9; padding-bottom:0.75rem; margin-bottom:1rem;">
                        <h3 style="margin:0; font-size:1.1rem; font-weight:800; color:#0f172a;">Expense Summary</h3>
                        <p style="margin:0.25rem 0 0 0; font-size:0.75rem; color:#64748b;">Total expense by category</p>
                    </div>
                    <div id="expenseSummaryContainer">
                        <div style="text-align:center; padding:2rem; color:#94a3b8;">No expense data</div>
                    </div>
                </div>

            </div>
        </div>

        <style>
            @media (max-width: 900px) {
                .finance-content-grid {
                    grid-template-columns: 1fr !important;
                }
            }
        </style>
    `;
}

// ─────────────────────────────────────────────
// Real-time Firestore Subscription
// ─────────────────────────────────────────────
function subscribeFinanceData(instId) {
    cleanupListener();

    const colRef = collection(db, "institutes", instId, "finance_records");
    const q = query(colRef, orderBy("date", "desc"));

    unsubFinance = onSnapshot(q, (snapshot) => {
        localRecords = [];
        snapshot.forEach((docSnap) => {
            localRecords.push({
                id: docSnap.id,
                ...docSnap.data()
            });
        });

        updateCardsAndTables();
    }, (error) => {
        console.error("Error fetching finance records:", error);
    });

    window.currentViewCleanup = cleanupListener;
}

// ─────────────────────────────────────────────
// UI Update Logic
// ─────────────────────────────────────────────
function updateCardsAndTables() {
    let totalIncome = 0;
    let totalExpense = 0;
    let incomeCount = 0;
    let expenseCount = 0;

    const expenseCategoryMap = {
        'Stage': 0,
        'Sound': 0,
        'Food': 0,
        'Prize': 0,
        'Print': 0,
        'Decoration': 0,
        'Travel': 0,
        'Office': 0,
        'Other': 0
    };

    localRecords.forEach(r => {
        const amt = Number(r.amount) || 0;
        if (r.type === 'income') {
            totalIncome += amt;
            incomeCount++;
        } else if (r.type === 'expense') {
            totalExpense += amt;
            expenseCount++;
            const cat = r.category || 'Other';
            if (expenseCategoryMap[cat] !== undefined) {
                expenseCategoryMap[cat] += amt;
            } else {
                expenseCategoryMap[cat] = (expenseCategoryMap[cat] || 0) + amt;
            }
        }
    });

    const balance = totalIncome - totalExpense;

    // Update Summary Cards
    const elInc = document.getElementById('statTotalIncome');
    const elExp = document.getElementById('statTotalExpense');
    const elBal = document.getElementById('statBalance');
    const elIncCnt = document.getElementById('statIncomeCount');
    const elExpCnt = document.getElementById('statExpenseCount');

    if (elInc) elInc.textContent = `₹${totalIncome.toLocaleString('en-IN')}`;
    if (elExp) elExp.textContent = `₹${totalExpense.toLocaleString('en-IN')}`;
    if (elBal) {
        elBal.textContent = `₹${balance.toLocaleString('en-IN')}`;
        const cardBal = document.getElementById('cardBalance');
        if (balance < 0) {
            if (cardBal) {
                cardBal.style.background = 'linear-gradient(135deg, #fef2f2, #fee2e2)';
                cardBal.style.borderColor = '#fecaca';
            }
            elBal.style.color = '#dc2626';
        } else {
            if (cardBal) {
                cardBal.style.background = 'linear-gradient(135deg, #eff6ff, #dbeafe)';
                cardBal.style.borderColor = '#bfdbfe';
            }
            elBal.style.color = '#1d4ed8';
        }
    }
    if (elIncCnt) elIncCnt.textContent = incomeCount;
    if (elExpCnt) elExpCnt.textContent = expenseCount;

    // Update Records Count Tag
    const elCntTag = document.getElementById('recordCountTag');
    if (elCntTag) elCntTag.textContent = `${localRecords.length} Records`;

    // Render Recent Records Table
    renderRecentRecordsTable();

    // Render Expense Summary List
    renderExpenseSummaryList(expenseCategoryMap, totalExpense);
}

// ─────────────────────────────────────────────
// Render Recent Records Table
// ─────────────────────────────────────────────
function renderRecentRecordsTable() {
    const container = document.getElementById('recentRecordsContainer');
    if (!container) return;

    if (localRecords.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding:3rem 1rem; color:#94a3b8;">
                <div style="font-size:2rem; margin-bottom:0.5rem;">📝</div>
                <div style="font-weight:700; color:#64748b;">No records added yet</div>
                <div style="font-size:0.8rem; margin-top:0.25rem;">Click + Add Income or + Add Expense to get started.</div>
            </div>
        `;
        return;
    }

    let html = `
        <table style="width:100%; border-collapse:collapse; text-align:left; font-size:0.88rem;">
            <thead>
                <tr style="background:#f8fafc; border-bottom:2px solid #e2e8f0; color:#475569;">
                    <th style="padding:0.6rem 0.75rem;">Date</th>
                    <th style="padding:0.6rem 0.75rem;">Type</th>
                    <th style="padding:0.6rem 0.75rem;">Category / Source</th>
                    <th style="padding:0.6rem 0.75rem; text-align:right;">Amount</th>
                    <th style="padding:0.6rem 0.75rem;">Remarks</th>
                    <th style="padding:0.6rem 0.75rem; text-align:center;">Actions</th>
                </tr>
            </thead>
            <tbody>
    `;

    localRecords.forEach((item) => {
        const isIncome = item.type === 'income';
        const typeBadge = isIncome
            ? `<span style="background:#dcfce7; color:#15803d; font-weight:800; font-size:0.75rem; padding:3px 8px; border-radius:6px; display:inline-block;">Income</span>`
            : `<span style="background:#fee2e2; color:#b91c1c; font-weight:800; font-size:0.75rem; padding:3px 8px; border-radius:6px; display:inline-block;">Expense</span>`;

        const formattedAmt = `₹${(Number(item.amount) || 0).toLocaleString('en-IN')}`;
        const amtColor = isIncome ? '#16a34a' : '#dc2626';

        html += `
            <tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:0.75rem; font-weight:600; color:#334155; white-space:nowrap;">${safeEscape(item.date || '')}</td>
                <td style="padding:0.75rem;">${typeBadge}</td>
                <td style="padding:0.75rem; font-weight:700; color:#0f172a;">${safeEscape(item.category || item.source || '-')}</td>
                <td style="padding:0.75rem; text-align:right; font-weight:800; color:${amtColor}; white-space:nowrap;">${formattedAmt}</td>
                <td style="padding:0.75rem; color:#64748b; font-size:0.82rem;">${safeEscape(item.remarks || '-')}</td>
                <td style="padding:0.75rem; text-align:center; white-space:nowrap;">
                    <button type="button" class="btn-edit-rec" data-id="${item.id}" style="background:none; border:none; color:#2563eb; font-weight:700; cursor:pointer; font-size:0.82rem; margin-right:8px;">Edit</button>
                    <button type="button" class="btn-del-rec" data-id="${item.id}" style="background:none; border:none; color:#dc2626; font-weight:700; cursor:pointer; font-size:0.82rem;">Delete</button>
                </td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    container.innerHTML = html;

    // Attach click handlers
    container.querySelectorAll('.btn-edit-rec').forEach(btn => {
        btn.onclick = () => {
            const id = btn.getAttribute('data-id');
            const rec = localRecords.find(r => r.id === id);
            if (rec) openEditModal(rec);
        };
    });

    container.querySelectorAll('.btn-del-rec').forEach(btn => {
        btn.onclick = () => {
            const id = btn.getAttribute('data-id');
            deleteRecord(id);
        };
    });
}

// ─────────────────────────────────────────────
// Render Expense Summary List
// ─────────────────────────────────────────────
function renderExpenseSummaryList(categoryMap, totalExpense) {
    const container = document.getElementById('expenseSummaryContainer');
    if (!container) return;

    const categories = Object.keys(categoryMap);
    let html = `<div style="display:flex; flex-direction:column; gap:0.6rem;">`;

    let hasExpense = false;
    categories.forEach(cat => {
        const val = categoryMap[cat];
        if (val > 0) hasExpense = true;
        const formattedVal = `₹${val.toLocaleString('en-IN')}`;

        html += `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:0.6rem 0.75rem; background:#f8fafc; border-radius:8px; border:1px solid #e2e8f0;">
                <span style="font-weight:700; color:#334155; font-size:0.88rem;">${cat}</span>
                <span style="font-weight:800; color:${val > 0 ? '#dc2626' : '#94a3b8'}; font-size:0.9rem;">${formattedVal}</span>
            </div>
        `;
    });

    html += `</div>`;

    if (!hasExpense) {
        container.innerHTML = `
            <div style="text-align:center; padding:2rem 1rem; color:#94a3b8;">
                <div style="font-size:0.85rem;">No expenses recorded yet</div>
            </div>
        `;
    } else {
        container.innerHTML = html;
    }
}

// ─────────────────────────────────────────────
// Add & Edit Modal Logic
// ─────────────────────────────────────────────
function openAddModal(type) {
    const isIncome = type === 'income';
    const modalTitleText = isIncome ? 'Add Income' : 'Add Expense';
    const today = new Date().toISOString().split('T')[0];

    const dropdownOptions = isIncome
        ? `
            <option value="Donation">Donation</option>
            <option value="Registration">Registration</option>
            <option value="Sponsor">Sponsor</option>
            <option value="Collection">Collection</option>
            <option value="Advertisement">Advertisement</option>
            <option value="Other">Other</option>
        `
        : `
            <option value="Stage">Stage</option>
            <option value="Sound">Sound</option>
            <option value="Food">Food</option>
            <option value="Prize">Prize</option>
            <option value="Print">Print</option>
            <option value="Decoration">Decoration</option>
            <option value="Travel">Travel</option>
            <option value="Office">Office</option>
            <option value="Other">Other</option>
        `;

    const labelCategory = isIncome ? 'Source' : 'Category';

    const modalBody = `
        <form id="formFinanceRecord" style="display:flex; flex-direction:column; gap:1rem;">
            <div>
                <label style="display:block; font-size:0.82rem; font-weight:700; color:#334155; margin-bottom:0.3rem;">Date *</label>
                <input type="date" id="finDate" required value="${today}" class="form-input-compact" style="width:100%; box-sizing:border-box;" />
            </div>

            <div>
                <label style="display:block; font-size:0.82rem; font-weight:700; color:#334155; margin-bottom:0.3rem;">Amount (₹) *</label>
                <input type="number" id="finAmount" min="1" step="any" placeholder="Enter amount" required class="form-input-compact" style="width:100%; box-sizing:border-box;" />
            </div>

            <div>
                <label style="display:block; font-size:0.82rem; font-weight:700; color:#334155; margin-bottom:0.3rem;">${labelCategory} *</label>
                <select id="finCategory" class="form-input-compact" style="width:100%; box-sizing:border-box;" required>
                    ${dropdownOptions}
                </select>
            </div>

            <div>
                <label style="display:block; font-size:0.82rem; font-weight:700; color:#334155; margin-bottom:0.3rem;">Remarks</label>
                <input type="text" id="finRemarks" placeholder="Optional notes" class="form-input-compact" style="width:100%; box-sizing:border-box;" />
            </div>

            <div style="display:flex; gap:0.75rem; justify-content:flex-end; margin-top:0.5rem; border-top:1px solid #e2e8f0; padding-top:1rem;">
                <button type="button" id="btnCancelFinModal" class="btn btn-secondary btn-sm" style="font-weight:700;">Cancel</button>
                <button type="submit" class="btn btn-primary btn-sm" style="font-weight:800; background:${isIncome ? '#16a34a' : '#dc2626'}; border:none;">Save</button>
            </div>
        </form>
    `;

    showDynamicModal(modalTitleText, modalBody);

    document.getElementById('btnCancelFinModal').onclick = closeDynamicModal;
    document.getElementById('formFinanceRecord').onsubmit = async (e) => {
        e.preventDefault();
        await saveRecord({
            type: type,
            date: document.getElementById('finDate').value,
            amount: Number(document.getElementById('finAmount').value),
            category: document.getElementById('finCategory').value,
            remarks: document.getElementById('finRemarks').value.trim()
        });
        closeDynamicModal();
    };
}

function openEditModal(record) {
    const isIncome = record.type === 'income';
    const modalTitleText = isIncome ? 'Edit Income' : 'Edit Expense';

    const dropdownOptions = isIncome
        ? `
            <option value="Donation" ${record.category === 'Donation' ? 'selected' : ''}>Donation</option>
            <option value="Registration" ${record.category === 'Registration' ? 'selected' : ''}>Registration</option>
            <option value="Sponsor" ${record.category === 'Sponsor' ? 'selected' : ''}>Sponsor</option>
            <option value="Collection" ${record.category === 'Collection' ? 'selected' : ''}>Collection</option>
            <option value="Advertisement" ${record.category === 'Advertisement' ? 'selected' : ''}>Advertisement</option>
            <option value="Other" ${record.category === 'Other' ? 'selected' : ''}>Other</option>
        `
        : `
            <option value="Stage" ${record.category === 'Stage' ? 'selected' : ''}>Stage</option>
            <option value="Sound" ${record.category === 'Sound' ? 'selected' : ''}>Sound</option>
            <option value="Food" ${record.category === 'Food' ? 'selected' : ''}>Food</option>
            <option value="Prize" ${record.category === 'Prize' ? 'selected' : ''}>Prize</option>
            <option value="Print" ${record.category === 'Print' ? 'selected' : ''}>Print</option>
            <option value="Decoration" ${record.category === 'Decoration' ? 'selected' : ''}>Decoration</option>
            <option value="Travel" ${record.category === 'Travel' ? 'selected' : ''}>Travel</option>
            <option value="Office" ${record.category === 'Office' ? 'selected' : ''}>Office</option>
            <option value="Other" ${record.category === 'Other' ? 'selected' : ''}>Other</option>
        `;

    const labelCategory = isIncome ? 'Source' : 'Category';

    const modalBody = `
        <form id="formFinanceRecord" style="display:flex; flex-direction:column; gap:1rem;">
            <div>
                <label style="display:block; font-size:0.82rem; font-weight:700; color:#334155; margin-bottom:0.3rem;">Date *</label>
                <input type="date" id="finDate" required value="${record.date || ''}" class="form-input-compact" style="width:100%; box-sizing:border-box;" />
            </div>

            <div>
                <label style="display:block; font-size:0.82rem; font-weight:700; color:#334155; margin-bottom:0.3rem;">Amount (₹) *</label>
                <input type="number" id="finAmount" min="1" step="any" placeholder="Enter amount" required value="${record.amount || ''}" class="form-input-compact" style="width:100%; box-sizing:border-box;" />
            </div>

            <div>
                <label style="display:block; font-size:0.82rem; font-weight:700; color:#334155; margin-bottom:0.3rem;">${labelCategory} *</label>
                <select id="finCategory" class="form-input-compact" style="width:100%; box-sizing:border-box;" required>
                    ${dropdownOptions}
                </select>
            </div>

            <div>
                <label style="display:block; font-size:0.82rem; font-weight:700; color:#334155; margin-bottom:0.3rem;">Remarks</label>
                <input type="text" id="finRemarks" placeholder="Optional notes" value="${safeEscape(record.remarks || '')}" class="form-input-compact" style="width:100%; box-sizing:border-box;" />
            </div>

            <div style="display:flex; gap:0.75rem; justify-content:flex-end; margin-top:0.5rem; border-top:1px solid #e2e8f0; padding-top:1rem;">
                <button type="button" id="btnCancelFinModal" class="btn btn-secondary btn-sm" style="font-weight:700;">Cancel</button>
                <button type="submit" class="btn btn-primary btn-sm" style="font-weight:800; background:${isIncome ? '#16a34a' : '#dc2626'}; border:none;">Save</button>
            </div>
        </form>
    `;

    showDynamicModal(modalTitleText, modalBody);

    document.getElementById('btnCancelFinModal').onclick = closeDynamicModal;
    document.getElementById('formFinanceRecord').onsubmit = async (e) => {
        e.preventDefault();
        await updateRecord(record.id, {
            type: record.type,
            date: document.getElementById('finDate').value,
            amount: Number(document.getElementById('finAmount').value),
            category: document.getElementById('finCategory').value,
            remarks: document.getElementById('finRemarks').value.trim()
        });
        closeDynamicModal();
    };
}

// ─────────────────────────────────────────────
// Firestore CRUD Operations
// ─────────────────────────────────────────────
async function saveRecord(data) {
    const instId = window.currentInstituteId;
    if (!instId) return;

    try {
        const colRef = collection(db, "institutes", instId, "finance_records");
        await addDoc(colRef, {
            ...data,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
    } catch (e) {
        console.error("Error adding finance record:", e);
        alert("Failed to save record. Please try again.");
    }
}

async function updateRecord(docId, data) {
    const instId = window.currentInstituteId;
    if (!instId || !docId) return;

    try {
        const docRef = doc(db, "institutes", instId, "finance_records", docId);
        await updateDoc(docRef, {
            ...data,
            updatedAt: serverTimestamp()
        });
    } catch (e) {
        console.error("Error updating finance record:", e);
        alert("Failed to update record. Please try again.");
    }
}

async function deleteRecord(docId) {
    const instId = window.currentInstituteId;
    if (!instId || !docId) return;

    if (!confirm("Are you sure you want to delete this record?")) return;

    try {
        const docRef = doc(db, "institutes", instId, "finance_records", docId);
        await deleteDoc(docRef);
    } catch (e) {
        console.error("Error deleting finance record:", e);
        alert("Failed to delete record. Please try again.");
    }
}

// ─────────────────────────────────────────────
// Dynamic Modal Helpers
// ─────────────────────────────────────────────
function showDynamicModal(title, bodyHtml) {
    const modal = document.getElementById('dynamicModal');
    const titleEl = document.getElementById('dynamicModalTitle');
    const bodyEl = document.getElementById('dynamicModalBody');
    const closeBtn = document.getElementById('closeDynamicModalBtn');

    if (!modal || !titleEl || !bodyEl) return;

    titleEl.textContent = title;
    bodyEl.innerHTML = bodyHtml;
    modal.classList.remove('hidden');

    if (closeBtn) {
        closeBtn.onclick = closeDynamicModal;
    }
}

function closeDynamicModal() {
    const modal = document.getElementById('dynamicModal');
    if (modal) modal.classList.add('hidden');
}

// ─────────────────────────────────────────────
// Report Printing & Exporting Logic
// ─────────────────────────────────────────────
function printReport() {
    const eventName = window.currentInstituteDetails?.name || 'Meelad Event';
    
    let totalIncome = 0;
    let totalExpense = 0;

    localRecords.forEach(r => {
        const amt = Number(r.amount) || 0;
        if (r.type === 'income') totalIncome += amt;
        else totalExpense += amt;
    });

    const balance = totalIncome - totalExpense;

    let rowsHtml = '';
    localRecords.forEach(r => {
        rowsHtml += `
            <tr>
                <td style="padding:6px 10px; border:1px solid #cbd5e1;">${r.date || ''}</td>
                <td style="padding:6px 10px; border:1px solid #cbd5e1; font-weight:bold; color:${r.type === 'income' ? '#15803d' : '#b91c1c'};">${r.type === 'income' ? 'Income' : 'Expense'}</td>
                <td style="padding:6px 10px; border:1px solid #cbd5e1;">${r.category || r.source || ''}</td>
                <td style="padding:6px 10px; border:1px solid #cbd5e1; text-align:right; font-weight:bold;">₹${(Number(r.amount) || 0).toLocaleString('en-IN')}</td>
                <td style="padding:6px 10px; border:1px solid #cbd5e1;">${r.remarks || ''}</td>
            </tr>
        `;
    });

    const printWin = window.open('', '_blank');
    if (!printWin) {
        alert("Pop-up blocked. Please allow pop-ups for this site to print reports.");
        return;
    }
    printWin.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Finance Report - ${eventName}</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; color: #0f172a; }
                h1 { margin-bottom: 4px; font-size: 20px; }
                .subtitle { font-size: 13px; color: #64748b; margin-bottom: 20px; }
                .cards { display: flex; gap: 15px; margin-bottom: 20px; }
                .card { flex: 1; padding: 12px; border: 1px solid #cbd5e1; border-radius: 6px; }
                .card-title { font-size: 11px; color: #64748b; text-transform: uppercase; }
                .card-val { font-size: 18px; font-weight: bold; margin-top: 4px; }
                table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 10px; }
                th { background: #f1f5f9; padding: 8px 10px; border: 1px solid #cbd5e1; text-align: left; }
                @media print {
                    body { padding: 0; }
                }
            </style>
        </head>
        <body>
            <h1>${eventName} — Finance Report</h1>
            <div class="subtitle">Generated on ${new Date().toLocaleDateString('en-IN')}</div>

            <div class="cards">
                <div class="card">
                    <div class="card-title">Total Income</div>
                    <div class="card-val" style="color:#15803d;">₹${totalIncome.toLocaleString('en-IN')}</div>
                </div>
                <div class="card">
                    <div class="card-title">Total Expense</div>
                    <div class="card-val" style="color:#dc2626;">₹${totalExpense.toLocaleString('en-IN')}</div>
                </div>
                <div class="card">
                    <div class="card-title">Balance</div>
                    <div class="card-val" style="color:${balance < 0 ? '#dc2626' : '#1d4ed8'};">₹${balance.toLocaleString('en-IN')}</div>
                </div>
            </div>

            <h3>Recent Records</h3>
            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th>Category / Source</th>
                        <th style="text-align:right;">Amount</th>
                        <th>Remarks</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>

            <script>
                window.onload = function() {
                    window.print();
                };
            </script>
        </body>
        </html>
    `);
    printWin.document.close();
}

function exportToExcel() {
    const eventName = window.currentInstituteDetails?.name || 'Meelad Event';
    let csvContent = "data:text/csv;charset=utf-8,";
    
    csvContent += `"${eventName} - Finance Report"\n`;
    csvContent += `"Date","Type","Category/Source","Amount","Remarks"\n`;

    localRecords.forEach(r => {
        const d = `"${r.date || ''}"`;
        const t = `"${r.type === 'income' ? 'Income' : 'Expense'}"`;
        const c = `"${(r.category || r.source || '').replace(/"/g, '""')}"`;
        const a = `"${r.amount || 0}"`;
        const rem = `"${(r.remarks || '').replace(/"/g, '""')}"`;
        csvContent += `${d},${t},${c},${a},${rem}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Finance_Report_${eventName.replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
