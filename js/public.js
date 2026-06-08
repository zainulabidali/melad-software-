import { db } from './firebase.js';
import {
    collection, getDocs, onSnapshot, query,
    orderBy, limit, where
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// ─────────────────────────────────────────────
// Utility: XSS Protection
// ─────────────────────────────────────────────
window.escapeHTML = function (str) {
    if (!str) return '';
    return str.toString().replace(/[&<>'"]/g,
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
};

const MEDALS = { 'First': '🥇', 'Second': '🥈', 'Third': '🥉', 'Participation': '🎖' };
const POS_CLASS = {
    'First': 'pos-first',
    'Second': 'pos-second',
    'Third': 'pos-third',
    'Participation': 'pos-participation'
};

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────
let currentInstituteId = null;
let currentInstituteName = '';
let allResults = []; // full results for current institute
let currentUnsubscribe = null;

// ─────────────────────────────────────────────
// DOM References
// ─────────────────────────────────────────────
const instSelect = document.getElementById('selectInstitute');
const catSelect = document.getElementById('selectCategory');
const progSelect = document.getElementById('selectProgram');
const resultsGrid = document.getElementById('resultsGrid');
const resultsHeader = document.getElementById('resultsHeader');
const resultsTitle = document.getElementById('resultsTitle');
const resultsCount = document.getElementById('resultsCount');

// ─────────────────────────────────────────────
// Init: Load Institutes
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const snapshot = await getDocs(collection(db, 'institutes'));
        let opts = '<option value="">— Select an Institute —</option>';
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (data.status === 'active') {
                opts += `<option value="${docSnap.id}" data-name="${window.escapeHTML(data.name)}">${window.escapeHTML(data.name)}</option>`;
            }
        });
        instSelect.innerHTML = opts;
    } catch (err) {
        instSelect.innerHTML = '<option value="">Error loading institutes</option>';
        console.error('Failed to load institutes:', err);
    }
});

// ─────────────────────────────────────────────
// Step 1: Institute selected → Load results & populate categories
// ─────────────────────────────────────────────
instSelect.addEventListener('change', (e) => {
    currentInstituteId = e.target.value;
    currentInstituteName = e.target.options[e.target.selectedIndex]?.getAttribute('data-name') || '';

    resetSelects();
    showGrid([]);

    if (!currentInstituteId) {
        showEmpty();
        return;
    }

    showLoading();
    subscribeToResults();
});

function resetSelects() {
    if (currentUnsubscribe) {
        currentUnsubscribe();
        currentUnsubscribe = null;
    }
    catSelect.innerHTML = '<option value="">Loading categories...</option>';
    catSelect.disabled = true;
    progSelect.innerHTML = '<option value="">Select category first</option>';
    progSelect.disabled = true;
    allResults = [];
}

// ─────────────────────────────────────────────
// Subscribe to results for selected institute
// ─────────────────────────────────────────────
function subscribeToResults() {
    const ref = collection(db, "institutes", currentInstituteId, "results");
    const q = query(ref, orderBy('publishedAt', 'desc'), limit(200));

    currentUnsubscribe = onSnapshot(q, (snapshot) => {
        allResults = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        populateCategorySelect();
        // Show all results initially
        filterAndRender();
    }, (err) => {
        console.error('Results snapshot error:', err);
        showError();
    });
}

// ─────────────────────────────────────────────
// Populate Category select from results data
// ─────────────────────────────────────────────
function populateCategorySelect() {
    const uniqueCats = new Map();
    allResults.forEach(r => {
        if (r.categoryId && r.categoryName && !uniqueCats.has(r.categoryId)) {
            uniqueCats.set(r.categoryId, r.categoryName);
        }
    });

    let opts = '<option value="">— All Categories —</option>';
    uniqueCats.forEach((name, id) => {
        opts += `<option value="${id}">${window.escapeHTML(name)}</option>`;
    });
    catSelect.innerHTML = opts;
    catSelect.disabled = uniqueCats.size === 0;

    progSelect.innerHTML = '<option value="">— All Programs —</option>';
    progSelect.disabled = true;
}

// ─────────────────────────────────────────────
// Step 2: Category selected → Filter programs
// ─────────────────────────────────────────────
catSelect.addEventListener('change', (e) => {
    const categoryId = e.target.value;
    progSelect.innerHTML = '<option value="">— All Programs —</option>';
    progSelect.disabled = true;

    if (categoryId) {
        const filteredResults = allResults.filter(r => r.categoryId === categoryId);
        const uniqueProgs = new Map();
        filteredResults.forEach(r => {
            if (r.programId && r.programName && !uniqueProgs.has(r.programId)) {
                uniqueProgs.set(r.programId, r.programName);
            }
        });

        uniqueProgs.forEach((name, id) => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = name;
            progSelect.appendChild(opt);
        });
        progSelect.disabled = uniqueProgs.size === 0;
    }

    filterAndRender();
});

// ─────────────────────────────────────────────
// Step 3: Program selected → filter results
// ─────────────────────────────────────────────
progSelect.addEventListener('change', () => {
    filterAndRender();
});

// ─────────────────────────────────────────────
// Filter + Render
// ─────────────────────────────────────────────
function filterAndRender() {
    const categoryId = catSelect.value;
    const programId = progSelect.value;

    let filtered = allResults;
    if (categoryId) filtered = filtered.filter(r => r.categoryId === categoryId);
    if (programId) filtered = filtered.filter(r => r.programId === programId);

    showGrid(filtered);
}

// ─────────────────────────────────────────────
// Render result cards
// ─────────────────────────────────────────────
function showGrid(results) {
    if (results.length === 0 && allResults.length === 0) {
        showEmpty('📭', 'No Results Published', 'This institute has no published event results yet.');
        resultsHeader.classList.add('hidden');
        return;
    }

    if (results.length === 0) {
        showEmpty('🔍', 'No Matching Results', 'Try selecting a different category or program.');
        resultsHeader.classList.add('hidden');
        return;
    }

    const progName = progSelect.value ? progSelect.options[progSelect.selectedIndex].text : 'All Programs';
    const catName = catSelect.value ? catSelect.options[catSelect.selectedIndex].text : 'All Categories';
    resultsTitle.textContent = progName !== 'All Programs' ? progName : catName;
    resultsCount.textContent = `${results.length} result${results.length !== 1 ? 's' : ''}`;
    resultsHeader.classList.remove('hidden');

    resultsGrid.innerHTML = '';
    results.forEach(result => {
        const card = buildResultCard(result);
        resultsGrid.appendChild(card);
    });
}

// ─────────────────────────────────────────────
// Build a single result card DOM element
// ─────────────────────────────────────────────
function buildResultCard(result) {
    const winners = result.winners || [];
    const card = document.createElement('div');
    card.className = 'result-card';

    const winnersHTML = winners.map(w => {
        const medal = MEDALS[w.position] || '🏅';
        const posClass = POS_CLASS[w.position] || '';
        const gradeHTML = w.grade ? `<span class="winner-badge grade-badge">Grade ${window.escapeHTML(w.grade)}</span>` : '';
        const marksHTML = (w.marks != null && w.marks !== '') ? `<span class="winner-badge marks-badge">${window.escapeHTML(String(w.marks))} marks</span>` : '';

        return `
            <div class="winner-item ${posClass}">
                <span class="winner-medal">${medal}</span>
                <div class="winner-info">
                    <div class="winner-name">${window.escapeHTML(w.studentName)}</div>
                    <div class="winner-meta">
                        <span>${window.escapeHTML(w.position)} Place</span>
                        ${gradeHTML}
                        ${marksHTML}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    card.innerHTML = `
        <div class="result-card-header">
            <div class="result-card-category">${window.escapeHTML(result.categoryName)}</div>
            <div class="result-card-title">${window.escapeHTML(result.programName)}</div>
        </div>
        <div class="result-card-body">
            ${winnersHTML || '<p style="color:#94a3b8; font-size:0.875rem; text-align:center; padding:1rem;">No winners recorded.</p>'}
        </div>
        <div class="result-card-footer">
            <button class="btn-download" data-result-id="${result.id}">
                📥 Download Image
            </button>
        </div>
    `;

    card.querySelector('.btn-download').addEventListener('click', () => {
        downloadResultImage(result);
    });

    return card;
}

// ─────────────────────────────────────────────
// Download Result as Image (html2canvas)
// ─────────────────────────────────────────────
function downloadResultImage(result) {
    const winners = result.winners || [];

    const winnersHTML = winners.map(w => {
        const medal = MEDALS[w.position] || '🏅';
        const gradeStr = w.grade ? ` | Grade ${w.grade}` : '';
        const marksStr = (w.marks != null && w.marks !== '') ? ` | ${w.marks} Marks` : '';
        return `
            <div style="display:flex; align-items:center; gap:12px; padding:10px 14px; margin-bottom:8px; border-radius:10px; background:#f8fafc; border-left:4px solid #4338ca;">
                <span style="font-size:24px;">${medal}</span>
                <div>
                    <div style="font-weight:700; color:#1e293b; font-size:14px;">${w.studentName}</div>
                    <div style="font-size:11px; color:#64748b; margin-top:2px;">${w.position} Place${gradeStr}${marksStr}</div>
                </div>
            </div>
        `;
    }).join('');

    const printDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    // Create off-screen render target
    const target = document.createElement('div');
    target.style.cssText = `
        position: absolute; top: -9999px; left: -9999px;
        width: 600px; background: white; font-family: 'Inter', sans-serif;
        border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    `;
    target.innerHTML = `
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #1e1b4b, #4338ca); padding: 28px 32px; color: white;">
            <div style="font-size:11px; opacity:0.75; font-weight:600; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:6px;">🏫 ${window.escapeHTML(currentInstituteName)}</div>
            <div style="font-size:10px; opacity:0.65; margin-bottom:12px;">${window.escapeHTML(result.categoryName)}</div>
            <div style="font-size:22px; font-weight:800; letter-spacing:-0.02em;">${window.escapeHTML(result.programName)}</div>
        </div>
        <!-- Winners -->
        <div style="padding: 24px 32px;">
            <div style="font-size:11px; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:14px;">🏆 RESULTS</div>
            ${winnersHTML}
        </div>
        <!-- Footer -->
        <div style="padding: 14px 32px 20px; border-top: 1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:10px; color:#94a3b8;">Institute Event Portal</span>
            <span style="font-size:10px; color:#94a3b8;">Published: ${printDate}</span>
        </div>
    `;

    document.body.appendChild(target);

    html2canvas(target, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false
    }).then(canvas => {
        const link = document.createElement('a');
        link.download = `result-${window.escapeHTML(result.programName).replace(/\s+/g, '-')}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        document.body.removeChild(target);
    }).catch(err => {
        console.error('Download failed:', err);
        document.body.removeChild(target);
        window.customAlert('Image download failed. Please try again.', 'Error', { icon: '⚠️', iconColor: '#ef4444', iconBg: 'rgba(239, 68, 68, 0.08)' });
    });
}

// ─────────────────────────────────────────────
// State helpers
// ─────────────────────────────────────────────
function showLoading() {
    resultsHeader.classList.add('hidden');
    resultsGrid.innerHTML = `<div class="spinner-wrap"><div class="spinner"></div></div>`;
}

function showEmpty(icon = '🎯', title = 'Browse Results', msg = 'Select an institute above to view published event results.') {
    resultsGrid.innerHTML = `
        <div class="state-box">
            <span class="state-icon">${icon}</span>
            <h3>${title}</h3>
            <p>${msg}</p>
        </div>
    `;
}

function showError() {
    resultsHeader.classList.add('hidden');
    resultsGrid.innerHTML = `
        <div class="state-box">
            <span class="state-icon">⚠️</span>
            <h3>Permission Error</h3>
            <p>Could not load results. Security rules may be blocking public access. Deploy the updated Firestore rules.</p>
        </div>
    `;
}
