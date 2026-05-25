import { db } from './firebase.js';
import {
    collection, doc, getDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// ─────────────────────────────────────────────
// State & Helpers
// ─────────────────────────────────────────────
let allResults = [];
let filteredResults = [];
let instId = new URLSearchParams(window.location.search).get('instId');
let instituteDetails = null;

// Tracks the selected template layout style (1, 2, or 3) per card result ID
const cardStylesMap = {}; 

const MEDALS = { First: '🥇', Second: '🥈', Third: '🥉', Participation: '🏅' };

function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}

// ─────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────
async function init() {
    if (!instId) {
        renderError("Invalid Link", "The results link is missing a valid institute identifier.");
        return;
    }

    try {
        // 1. Fetch Madrasa/Institute Profile Details
        const instSnap = await getDoc(doc(db, "institutes", instId));
        if (!instSnap.exists()) {
            renderError("Madrasa Not Found", "The requested Madrasa results portal does not exist.");
            return;
        }
        
        instituteDetails = { id: instSnap.id, ...instSnap.data() };
        document.getElementById('madrasaName').textContent = instituteDetails.name || "Results Portal";
        document.getElementById('festivalName').textContent = instituteDetails.festivalName || "Annual Islamic Cultural Meet";

        // 2. Setup Real-time Firestore Listeners on Results (Strictly Published results only)
        const resultsRef = collection(db, "institutes", instId, "results");
        
        onSnapshot(resultsRef, (snapshot) => {
            const published = snapshot.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(r => r.status === 'published' && r.publicDisabled !== true);
            
            // Sort by published timestamp descending
            allResults = published.sort((a, b) => {
                const timeA = a.publishedAt?.seconds || 0;
                const timeB = b.publishedAt?.seconds || 0;
                return timeB - timeA;
            });

            // Initialize default style 1 for any new cards
            allResults.forEach(r => {
                if (!cardStylesMap[r.id]) {
                    cardStylesMap[r.id] = 1;
                }
            });

            filteredResults = [...allResults];

            if (allResults.length === 0) {
                renderEmpty("No results published yet.", "Check back later for cultural events standings.");
                hideOverlay();
                return;
            }

            // Populate filter select dropdown options dynamically
            setupFilterDropdowns();
            
            // Execute filter and rendering
            applyFilters();
            
            document.getElementById('filterBar').style.display = 'flex';
            hideOverlay();
        }, (err) => {
            console.error("Standings snapshot error:", err);
            renderError("Access Denied", "Unable to establish database connection.");
            hideOverlay();
        });

    } catch (err) {
        console.error(err);
        renderError("Connection Failed", "Failed to connect to Madrasa records database.");
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
// Rendering Standings Posters
// ─────────────────────────────────────────────
function renderResults() {
    const list = document.getElementById('resultsList');
    if (!list) return;

    if (filteredResults.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🔍</div>
                <h3>No matching results</h3>
                <p>Try refining your search terms or filters.</p>
            </div>
        `;
        return;
    }

    list.innerHTML = filteredResults.map(r => {
        const styleId = cardStylesMap[r.id] || 1;
        const currentStyleClass = `poster-style-${styleId}`;

        // Dynamic Festival title or falls back
        const festTitle = instituteDetails?.festivalName || "Annual Islamic Cultural Meet";
        
        // Extract top 3 winners sorted strictly by finalMark descending
        const sortedWinners = [...(r.marksData || [])]
            .filter(w => w.finalMark && w.finalMark > 0)
            .sort((a, b) => (b.finalMark || 0) - (a.finalMark || 0))
            .slice(0, 3);

        const winnersHTML = sortedWinners.map((w, idx) => {
            const medal = idx === 0 ? '🥇' : (idx === 1 ? '🥈' : '🥉');
            const medalClass = `p-rank-${idx + 1}`;
            const gradeText = w.grade ? `<span class="p-grade">${escapeHTML(w.grade)}</span>` : '';
            const pointsText = w.totalPoints ? `<span class="p-points">${w.totalPoints} pts</span>` : '';

            return `
                <div class="p-winner-row">
                    <div class="p-rank-badge ${medalClass}">${medal}</div>
                    <div class="p-winner-info">
                        <div class="p-winner-name">${escapeHTML(r.programType === 'group' ? w.teamName : w.studentName)}</div>
                        <div class="p-winner-team">${escapeHTML(r.programType === 'group' ? 'Group Program' : (w.teamName || '—'))}</div>
                    </div>
                    <div class="p-score-badge">
                        ${gradeText}
                        ${pointsText}
                    </div>
                </div>
            `;
        }).join('');

        const finalWinnersHTML = winnersHTML || `<div style="text-align:center;padding:1.5rem;color:rgba(0,0,0,0.5);font-style:italic;">No standings recorded for this event.</div>`;

        return `
            <div class="poster-container" id="container-${r.id}">
                
                <!-- Poster Card Component -->
                <div class="${currentStyleClass}" id="poster-${r.id}">
                    <div class="poster-header">
                        <span class="p-meta-badge">${escapeHTML(r.categoryName)} ${r.className ? `(${escapeHTML(r.className)})` : ''}</span>
                        <div class="p-prog-name">${escapeHTML(r.programName)}</div>
                        <span class="p-sub-details">🏆 ${escapeHTML(festTitle)} Standings</span>
                    </div>
                    <div class="p-winners-list" style="display:flex; flex-direction:column; gap:0.75rem;">
                        ${finalWinnersHTML}
                    </div>
                </div>

                <!-- Template Selector Card -->
                <div class="design-picker-card">
                    <span>🎨 POSTER STYLE</span>
                    <div class="design-buttons">
                        <button class="design-btn ${styleId === 1 ? 'active' : ''}" data-id="${r.id}" data-style="1">Soft Elegant</button>
                        <button class="design-btn ${styleId === 2 ? 'active' : ''}" data-id="${r.id}" data-style="2">Editorial</button>
                        <button class="design-btn ${styleId === 3 ? 'active' : ''}" data-id="${r.id}" data-style="3">Artistic</button>
                    </div>
                </div>

                <!-- Action Button Trigger Row -->
                <div class="poster-actions-row">
                    <button class="action-btn action-btn-primary btn-download" data-id="${r.id}">📥 Download</button>
                    <button class="action-btn btn-print" data-id="${r.id}">🖨️ Print</button>
                    <button class="action-btn btn-share" data-id="${r.id}">📤 Share</button>
                </div>

            </div>
        `;
    }).join('');

    // Wire Card Style change events
    document.querySelectorAll('.design-btn').forEach(btn => {
        btn.onclick = (e) => {
            const cardId = e.target.dataset.id;
            const styleNum = parseInt(e.target.dataset.style, 10);
            cardStylesMap[cardId] = styleNum;
            
            // Re-render immediately
            renderResults();
        };
    });

    // Wire Card Actions
    document.querySelectorAll('.btn-download').forEach(btn => {
        btn.onclick = (e) => {
            const cardId = e.target.dataset.id;
            downloadPosterAsImage(cardId);
        };
    });

    document.querySelectorAll('.btn-print').forEach(btn => {
        btn.onclick = (e) => {
            const cardId = e.target.dataset.id;
            printTargetPoster(cardId);
        };
    });

    document.querySelectorAll('.btn-share').forEach(btn => {
        btn.onclick = (e) => {
            const cardId = e.target.dataset.id;
            sharePosterContent(cardId);
        };
    });
}

function renderError(title, msg) {
    document.getElementById('headerSection').innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">❌</div>
            <h2 style="color:#dc2626; margin-bottom:0.5rem; font-family:'Playfair Display', serif;">${escapeHTML(title)}</h2>
            <p>${escapeHTML(msg)}</p>
        </div>
    `;
}

function renderEmpty(title, msg) {
    document.getElementById('resultsList').innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">🕌</div>
            <h3 style="font-family:'Playfair Display', serif;">${escapeHTML(title)}</h3>
            <p>${escapeHTML(msg)}</p>
        </div>
    `;
}

// ─────────────────────────────────────────────
// Dynamic Filters Loading & Binding
// ─────────────────────────────────────────────
function setupFilterDropdowns() {
    const catSel = document.getElementById('catFilter');
    const progSel = document.getElementById('progFilter');

    // Retain initial placeholder options
    catSel.innerHTML = '<option value="">All Categories</option>';
    progSel.innerHTML = '<option value="">All Programs</option>';

    // Build unique categories set
    const categories = [...new Set(allResults.map(r => r.categoryName))].sort();
    categories.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        catSel.appendChild(opt);
    });

    // Build unique programs set
    const programs = [...new Set(allResults.map(r => r.programName))].sort();
    programs.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        progSel.appendChild(opt);
    });

    // Hook listeners
    catSel.onchange = applyFilters;
    progSel.onchange = applyFilters;
    document.getElementById('searchInput').oninput = applyFilters;
    document.getElementById('btnFilterSearch').onclick = applyFilters;
}

function applyFilters() {
    const queryStr = document.getElementById('searchInput').value.trim().toLowerCase();
    const cat = document.getElementById('catFilter').value;
    const prog = document.getElementById('progFilter').value;

    filteredResults = allResults.filter(r => {
        if (cat && r.categoryName !== cat) return false;
        if (prog && r.programName !== prog) return false;
        
        if (queryStr) {
            const name = (r.programName || '').toLowerCase();
            const category = (r.categoryName || '').toLowerCase();
            if (!name.includes(queryStr) && !category.includes(queryStr)) return false;
        }
        return true;
    });

    renderResults();
}

// ─────────────────────────────────────────────
// Printable Poster Isolated Trigger
// ─────────────────────────────────────────────
function printTargetPoster(cardId) {
    const wrapper = document.getElementById(`container-${cardId}`);
    if (!wrapper) return;

    // Add specific CSS classes for printing
    document.body.classList.add('print-active');
    wrapper.classList.add('print-target');

    // Trigger printing dialog
    window.print();

    // Safely remove classes after print box closes
    const clearPrintStyles = () => {
        document.body.classList.remove('print-active');
        wrapper.classList.remove('print-target');
        window.removeEventListener('afterprint', clearPrintStyles);
    };

    window.addEventListener('afterprint', clearPrintStyles);
    // Fallback timer for browsers that don't trigger afterprint correctly
    setTimeout(clearPrintStyles, 2000);
}

// ─────────────────────────────────────────────
// Clipboard & WhatsApp Content Sharing Action
// ─────────────────────────────────────────────
function sharePosterContent(cardId) {
    const r = allResults.find(x => x.id === cardId);
    if (!r) return;

    const festTitle = instituteDetails?.festivalName || "Annual Islamic Cultural Meet";
    const madrasaName = instituteDetails?.name || "Madrasa Results";
    
    // Fetch top 3 winners
    const sorted = [...(r.marksData || [])]
        .filter(w => w.finalMark && w.finalMark > 0)
        .sort((a, b) => (b.finalMark || 0) - (a.finalMark || 0))
        .slice(0, 3);

    const w1 = sorted[0] ? `${r.programType === 'group' ? sorted[0].teamName : sorted[0].studentName} (${r.programType === 'group' ? 'Group' : sorted[0].teamName})` : '—';
    const w2 = sorted[1] ? `${r.programType === 'group' ? sorted[1].teamName : sorted[1].studentName} (${r.programType === 'group' ? 'Group' : sorted[1].teamName})` : '—';
    const w3 = sorted[2] ? `${r.programType === 'group' ? sorted[2].teamName : sorted[2].studentName} (${r.programType === 'group' ? 'Group' : sorted[2].teamName})` : '—';

    const portalUrl = window.location.href;
    const shareText = `🏆 *${r.programName.toUpperCase()}* Result Published!\n\n🕌 *${madrasaName}*\n🌟 Festival: *${festTitle}*\n🏷️ Category: *${r.categoryName}*\n\n🥇 *1st:* ${w1}\n🥈 *2nd:* ${w2}\n🥉 *3rd:* ${w3}\n\n👉 Check all official published standings on the results portal:\n${portalUrl}`;

    navigator.clipboard.writeText(shareText).then(() => {
        showToast("✓ Copied sharing summary & portal link to clipboard!");
        
        // Open WhatsApp Web/Mobile with prefilled text
        const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
        window.open(waUrl, '_blank');
    }).catch(err => {
        console.error("Clipboard copy failure:", err);
        showToast("Sharing failed.");
    });
}

// ─────────────────────────────────────────────
// Off-screen Canvas Image Downloader Helper
// ─────────────────────────────────────────────
function downloadPosterAsImage(cardId) {
    const r = allResults.find(x => x.id === cardId);
    if (!r) return;

    const styleId = cardStylesMap[r.id] || 1;
    const madrasaName = (instituteDetails?.name || "Madrasa Results Portal").toUpperCase();
    const festTitle = (instituteDetails?.festivalName || "Annual Cultural Festival").toUpperCase();
    const programName = (r.programName || "Program Standing").toUpperCase();
    const categoryName = (r.categoryName || "General Category").toUpperCase();

    // Fetch top 3 winners
    const sorted = [...(r.marksData || [])]
        .filter(w => w.finalMark && w.finalMark > 0)
        .sort((a, b) => (b.finalMark || 0) - (a.finalMark || 0))
        .slice(0, 3);

    // Create high-res off-screen canvas (1200x800 for optimal social aspect-ratio)
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 800;
    const ctx = canvas.getContext('2d');

    // ─────────────────────────────────────────────
    // Styles rendering mapping
    // ─────────────────────────────────────────────
    if (styleId === 1) {
        // Theme 1: Soft Elegant pastel gradient
        const grad = ctx.createLinearGradient(0, 0, 1200, 800);
        grad.addColorStop(0, '#f8fafc');
        grad.addColorStop(0.5, '#eff6ff');
        grad.addColorStop(1, '#f5f3ff');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 1200, 800);

        // Double soft borders
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 16;
        ctx.strokeRect(8, 8, 1184, 784);

        ctx.strokeStyle = 'rgba(99, 102, 241, 0.08)';
        ctx.lineWidth = 2;
        ctx.strokeRect(20, 20, 1160, 760);

        // Header Metadata Badge
        ctx.fillStyle = '#e0e7ff';
        ctx.beginPath();
        ctx.roundRect(475, 45, 250, 42, 21);
        ctx.fill();

        ctx.font = 'bold 16px "Inter", sans-serif';
        ctx.fillStyle = '#4338ca';
        ctx.textAlign = 'center';
        ctx.fillText(categoryName, 600, 71);

        // Title and Event Name
        ctx.font = 'italic bold 52px "Playfair Display", Georgia, serif';
        ctx.fillStyle = '#1e1b4b';
        ctx.fillText(programName, 600, 155);

        ctx.font = 'bold 16px "Inter", sans-serif';
        ctx.fillStyle = '#475569';
        ctx.fillText(`🏆 ${festTitle} STANDINGS`, 600, 205);

        // Draw Divider
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.15)';
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.moveTo(100, 235);
        ctx.lineTo(1100, 235);
        ctx.stroke();
        ctx.setLineDash([]); // Reset dash

        // Render Winners rows
        const startY = 275;
        const rowHeight = 145;

        for (let i = 0; i < 3; i++) {
            const w = sorted[i];
            const y = startY + (i * rowHeight);

            // Row Card Backdrop
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = 'rgba(99, 102, 241, 0.04)';
            ctx.shadowBlur = 10;
            ctx.shadowOffsetY = 4;
            ctx.beginPath();
            ctx.roundRect(100, y, 1000, 120, 16);
            ctx.fill();
            ctx.shadowColor = 'transparent'; // Reset shadow

            // Medal Emojis & Rank
            let medalStr = '🥉';
            let medalColor = '#fde8e8'; // Fallback
            if (i === 0) { medalStr = '🥇'; medalColor = '#fef3c7'; }
            else if (i === 1) { medalStr = '🥈'; medalColor = '#f1f5f9'; }

            // Medal container circular background
            ctx.fillStyle = medalColor;
            ctx.beginPath();
            ctx.arc(175, y + 60, 36, 0, Math.PI * 2);
            ctx.fill();

            ctx.font = '36px "Inter"';
            ctx.fillText(medalStr, 175, y + 72);

            // Student/Winner Profile Text Info
            const wName = w ? (r.programType === 'group' ? w.teamName : w.studentName) : '—';
            const wTeam = w ? (r.programType === 'group' ? 'GROUP PROGRAM' : (w.teamName || '—')) : '—';
            const wGrade = w ? (w.grade || '') : '';
            const wPoints = w ? `${w.totalPoints || 0} pts` : '';

            ctx.textAlign = 'left';
            ctx.font = 'bold 30px "Inter", sans-serif';
            ctx.fillStyle = '#1e1b4b';
            ctx.fillText(wName, 245, y + 54);

            ctx.font = '700 16px "Inter", sans-serif';
            ctx.fillStyle = '#475569';
            ctx.fillText(wTeam.toUpperCase(), 245, y + 88);

            // Grade / Points badges
            ctx.textAlign = 'right';
            if (wGrade) {
                ctx.fillStyle = '#eff6ff';
                ctx.beginPath();
                ctx.roundRect(930, y + 42, 100, 32, 6);
                ctx.fill();

                ctx.font = 'bold 16px "Inter", sans-serif';
                ctx.fillStyle = '#1d4ed8';
                ctx.fillText(`GRADE ${wGrade}`, 980, y + 63);
            }

            if (wPoints) {
                ctx.font = '800 24px "Inter", sans-serif';
                ctx.fillStyle = '#4338ca';
                ctx.fillText(wPoints, 800, y + 68);
            }
        }

        // Footer Branding
        ctx.textAlign = 'center';
        ctx.font = 'bold 15px "Inter", sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(`🏫 OFFICIALLY PUBLISHED BY ${madrasaName}`, 600, 755);

    } else if (styleId === 2) {
        // Theme 2: Modern Editorial black & white
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 1200, 800);

        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 8;
        ctx.strokeRect(30, 30, 1140, 740);

        // Header lines
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'left';
        ctx.font = '900 16px "Inter", sans-serif';
        ctx.fillText(categoryName, 80, 100);

        ctx.font = '900 56px "Playfair Display", Georgia, serif';
        ctx.fillText(programName, 80, 165);

        ctx.font = 'bold 15px "Inter", sans-serif';
        ctx.fillText(`🏆 ${festTitle} STANDINGS`, 80, 205);

        // Solid Divider Line
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(80, 230);
        ctx.lineTo(1120, 230);
        ctx.stroke();

        // Render Winners row
        const startY = 270;
        const rowHeight = 135;

        for (let i = 0; i < 3; i++) {
            const w = sorted[i];
            const y = startY + (i * rowHeight);

            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(80, y + 110);
            ctx.lineTo(1120, y + 110);
            ctx.stroke();

            // Rank Number
            ctx.textAlign = 'left';
            ctx.fillStyle = '#000000';
            ctx.font = '900 42px "Cinzel", serif';
            ctx.fillText(`#0${i + 1}`, 90, y + 70);

            const wName = w ? (r.programType === 'group' ? w.teamName : w.studentName) : '—';
            const wTeam = w ? (r.programType === 'group' ? 'GROUP PROGRAM' : (w.teamName || '—')) : '—';
            const wGrade = w ? (w.grade || '') : '';
            const wPoints = w ? `${w.totalPoints || 0} pts` : '';

            ctx.font = '900 28px "Inter", sans-serif';
            ctx.fillText(wName, 260, y + 54);

            ctx.font = '500 16px "Inter", sans-serif';
            ctx.fillStyle = '#64748b';
            ctx.fillText(wTeam.toUpperCase(), 260, y + 84);

            ctx.textAlign = 'right';
            ctx.fillStyle = '#000000';
            if (wGrade) {
                ctx.font = 'bold 18px "Inter", sans-serif';
                ctx.fillText(`GRADE ${wGrade}`, 1080, y + 46);
            }
            if (wPoints) {
                ctx.font = '900 22px "Inter", sans-serif';
                ctx.fillText(wPoints, 1080, y + 80);
            }
        }

        ctx.textAlign = 'center';
        ctx.font = '900 14px "Inter", sans-serif';
        ctx.fillStyle = '#000000';
        ctx.fillText(`OFFICIALLY PUBLISHED BY ${madrasaName}`, 600, 735);

    } else {
        // Theme 3: Deep Emerald Artistic Islamic
        const grad = ctx.createLinearGradient(0, 0, 1200, 800);
        grad.addColorStop(0, '#022c22');
        grad.addColorStop(1, '#064e3b');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 1200, 800);

        // Thin Gold double borders
        ctx.strokeStyle = '#d97706';
        ctx.lineWidth = 6;
        ctx.strokeRect(20, 20, 1160, 760);

        ctx.strokeStyle = 'rgba(217, 119, 6, 0.4)';
        ctx.lineWidth = 1;
        ctx.strokeRect(30, 30, 1140, 740);

        // Metadata Badge
        ctx.fillStyle = 'rgba(217, 119, 6, 0.18)';
        ctx.strokeStyle = 'rgba(217, 119, 6, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(475, 45, 250, 42, 4);
        ctx.fill();
        ctx.stroke();

        ctx.font = 'bold 16px "Inter", sans-serif';
        ctx.fillStyle = '#fef08a';
        ctx.textAlign = 'center';
        ctx.fillText(categoryName, 600, 71);

        // Title and Event Name
        ctx.font = 'bold 44px "Cinzel", serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(programName, 600, 155);

        ctx.font = 'bold 16px "Inter", sans-serif';
        ctx.fillStyle = '#fbbf24';
        ctx.fillText(`🏆 ${festTitle} STANDINGS`, 600, 205);

        // Thin Gold Divider Line
        ctx.strokeStyle = 'rgba(217, 119, 6, 0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(100, 235);
        ctx.lineTo(1100, 235);
        ctx.stroke();

        // Render Winners row
        const startY = 275;
        const rowHeight = 145;

        for (let i = 0; i < 3; i++) {
            const w = sorted[i];
            const y = startY + (i * rowHeight);

            // Row Card Backdrop
            ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
            ctx.strokeStyle = 'rgba(217, 119, 6, 0.15)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(100, y, 1000, 120, 8);
            ctx.fill();
            ctx.stroke();

            // Rank Badge Number
            let rankMedal = '🥉';
            if (i === 0) rankMedal = '🥇';
            else if (i === 1) rankMedal = '🥈';

            ctx.font = '36px "Inter"';
            ctx.fillText(rankMedal, 175, y + 74);

            const wName = w ? (r.programType === 'group' ? w.teamName : w.studentName) : '—';
            const wTeam = w ? (r.programType === 'group' ? 'GROUP PROGRAM' : (w.teamName || '—')) : '—';
            const wGrade = w ? (w.grade || '') : '';
            const wPoints = w ? `${w.totalPoints || 0} pts` : '';

            ctx.textAlign = 'left';
            ctx.font = 'bold 28px "Inter", sans-serif';
            ctx.fillStyle = '#ffffff';
            ctx.fillText(wName, 245, y + 54);

            ctx.font = 'bold 16px "Inter", sans-serif';
            ctx.fillStyle = '#a7f3d0';
            ctx.fillText(wTeam.toUpperCase(), 245, y + 88);

            ctx.textAlign = 'right';
            if (wGrade) {
                ctx.fillStyle = 'rgba(217, 119, 6, 0.2)';
                ctx.strokeStyle = 'rgba(217, 119, 6, 0.3)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.roundRect(930, y + 42, 100, 32, 4);
                ctx.fill();
                ctx.stroke();

                ctx.font = 'bold 14px "Inter", sans-serif';
                ctx.fillStyle = '#fef08a';
                ctx.fillText(`GRADE ${wGrade}`, 980, y + 62);
            }

            if (wPoints) {
                ctx.font = '900 24px "Inter", sans-serif';
                ctx.fillStyle = '#fbbf24';
                ctx.fillText(wPoints, 800, y + 68);
            }
        }

        ctx.textAlign = 'center';
        ctx.font = 'bold 15px "Inter", sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.fillText(`OFFICIALLY PUBLISHED BY ${madrasaName}`, 600, 755);
    }

    // Trigger dynamic browser down file click download
    const link = document.createElement('a');
    link.download = `results_${r.programName.toLowerCase().replace(/\s+/g, '_')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast(`✓ Downloader finished: results_${r.programName.toLowerCase().replace(/\s+/g, '_')}.png`);
}

// Start Portal Load
init();
