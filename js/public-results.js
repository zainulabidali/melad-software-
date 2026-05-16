import { db } from './firebase.js';
import {
    collection, getDocs, doc, getDoc, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// ─────────────────────────────────────────────
// State & Helpers
// ─────────────────────────────────────────────
let allResults = [];
let filteredResults = [];
let instId = new URLSearchParams(window.location.search).get('instId');

const MEDALS = { First: '🥇', Second: '🥈', Third: '🥉', Participation: '🎖' };

function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}

// ─────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────
async function init() {
    if (!instId) {
        renderError("Invalid Link", "The result link is invalid or missing a valid institute ID.");
        return;
    }

    try {
        // 1. Load Institute Info
        const instSnap = await getDoc(doc(db, "institutes", instId));
        if (!instSnap.exists()) {
            renderError("Institute Not Found", "The requested institute does not exist.");
            return;
        }
        const instData = instSnap.data();
        renderHeader(instData.name);

        // 2. Fetch Results (Published Only)
        const resultsRef = collection(db, "institutes", instId, "results");
        const q = query(resultsRef, where("status", "==", "published"), orderBy("publishedAt", "desc"));
        const snap = await getDocs(q);
        
        // Filter out results with publicDisabled flag
        allResults = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(r => r.publicDisabled !== true);
            
        filteredResults = [...allResults];

        if (allResults.length === 0) {
            renderEmpty("No Results Published", "Check back later for competition updates.");
            hideOverlay();
            return;
        }

        // 3. Setup UI
        setupFilters();
        renderResults();
        document.getElementById('filterBar').style.display = 'flex';
        hideOverlay();

    } catch (err) {
        console.error(err);
        renderError("Connection Error", "Failed to load results. Please check your internet connection.");
        hideOverlay();
    }
}

function hideOverlay() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 400);
    }
}

// ─────────────────────────────────────────────
// Render Logic
// ─────────────────────────────────────────────
function renderHeader(name) {
    document.getElementById('headerSection').innerHTML = `
        <h1 class="inst-name">${escapeHTML(name)}</h1>
        <p class="page-title">🏆 Competition Results Portal</p>
    `;
}

function renderResults() {
    const list = document.getElementById('resultsList');
    if (filteredResults.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🔍</div>
                <h3>No matching results</h3>
                <p>Try changing your filters.</p>
            </div>
        `;
        return;
    }

    list.innerHTML = filteredResults.map(r => {
        const winnersHTML = (r.winners || []).map(w => `
            <div class="winner-row">
                <div class="position-badge">${MEDALS[w.position] || '🏅'}</div>
                <div class="winner-info">
                    <div class="winner-name">${escapeHTML(w.studentName)}</div>
                    <div class="winner-team">${escapeHTML(w.teamName || '')}</div>
                </div>
                ${w.grade ? `<span class="meta-badge" style="background:#e0e7ff;color:#4338ca;">Grade ${w.grade}</span>` : ''}
            </div>
        `).join('');

        return `
            <div class="result-card">
                <div class="meta-badges">
                    <span class="meta-badge">${escapeHTML(r.categoryName)}</span>
                    ${r.className ? `<span class="meta-badge">${escapeHTML(r.className)}</span>` : ''}
                    <span class="meta-badge" style="background:#f0fdf4;color:#166534;">${escapeHTML(r.genderCategory)}</span>
                    <span class="meta-badge" style="background:#fff7ed;color:#9a3412;">${escapeHTML(r.programLocation)}</span>
                </div>
                <div class="prog-name">
                    ${escapeHTML(r.programName)}
                </div>
                <div class="winners-list">
                    ${winnersHTML}
                </div>
            </div>
        `;
    }).join('');
}

function renderError(title, msg) {
    document.getElementById('headerSection').innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">❌</div>
            <h2 style="color:#e11d48; margin-bottom:0.5rem;">${escapeHTML(title)}</h2>
            <p>${escapeHTML(msg)}</p>
        </div>
    `;
}

function renderEmpty(title, msg) {
    document.getElementById('resultsList').innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">🏆</div>
            <h3>${escapeHTML(title)}</h3>
            <p>${escapeHTML(msg)}</p>
        </div>
    `;
}

// ─────────────────────────────────────────────
// Filter Logic
// ─────────────────────────────────────────────
function setupFilters() {
    const catSel = document.getElementById('catFilter');
    const classSel = document.getElementById('classFilter');

    // Populate unique categories
    const categories = [...new Set(allResults.map(r => r.categoryName))].sort();
    categories.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        catSel.appendChild(opt);
    });

    // Populate unique classes
    const classes = [...new Set(allResults.filter(r => r.className).map(r => r.className))].sort();
    classes.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        classSel.appendChild(opt);
    });

    // Bind events
    [catSel, classSel, document.getElementById('genderFilter'), document.getElementById('locationFilter')].forEach(el => {
        el.onchange = applyFilters;
    });
}

function applyFilters() {
    const cat = document.getElementById('catFilter').value;
    const cls = document.getElementById('classFilter').value;
    const gen = document.getElementById('genderFilter').value;
    const loc = document.getElementById('locationFilter').value;

    filteredResults = allResults.filter(r => {
        if (cat && r.categoryName !== cat) return false;
        if (cls && r.className !== cls) return false;
        if (gen && r.genderCategory !== gen) return false;
        if (loc && r.programLocation !== loc) return false;
        return true;
    });

    renderResults();
}

// Start
init();
