import { db } from './firebase.js';
import {
    collection, doc, getDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// ─────────────────────────────────────────────
// State & Helpers
// ─────────────────────────────────────────────
let allResults = [];
let instId = new URLSearchParams(window.location.search).get('id') || new URLSearchParams(window.location.search).get('instId');
let instituteDetails = null;

// Tracks the selected background style (1, 2, 3, or 4) per card result ID
const cardBgMap = {};

// Preloaded background images cache
const preloadedBgs = {};

function preloadAllBackgrounds() {
    for (let i = 1; i <= 10; i++) {
        const img = new Image();
        img.src = `../assets/poster-backgrounds/bg${i}.jpg`;
        preloadedBgs[i] = img;
    }
}

// Start preloading assets immediately on script load
preloadAllBackgrounds();

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

        // 2. Setup Real-time Firestore Listeners on Results (Strictly Published results only)
        const resultsRef = collection(db, "institutes", instId, "results");

        onSnapshot(resultsRef, (snapshot) => {
            const published = snapshot.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(r => r.status === 'published' && r.publicDisabled !== true);

            // Sort by published timestamp descending for base listing
            allResults = published.sort((a, b) => {
                const timeA = a.publishedAt?.seconds || 0;
                const timeB = b.publishedAt?.seconds || 0;
                return timeB - timeA;
            });

            // Initialize default style 1 for all cards
            allResults.forEach(r => {
                if (!cardBgMap[r.id]) {
                    cardBgMap[r.id] = 1;
                }
            });

            // Populate category filter select dropdown dynamically (Initial state)
            setupFilters();

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
// Setup Dynamic Category / Program Filters
// ─────────────────────────────────────────────
// State variables for selected filter options
let selectedCategory = "";
let selectedProgram = "";

function setupFilters() {
    const catContainer = document.getElementById('catFilterContainer');
    const catTrigger = document.getElementById('catSelectTrigger');
    const catText = document.getElementById('catSelectedVal');
    const catPanel = document.getElementById('catSelectPanel');

    const progContainer = document.getElementById('progFilterContainer');
    const progTrigger = document.getElementById('progSelectTrigger');
    const progText = document.getElementById('progSelectedVal');
    const progPanel = document.getElementById('progSelectPanel');

    // Reset options
    selectedCategory = "";
    selectedProgram = "";
    catText.textContent = "Select Category";
    catText.classList.add('placeholder');
    progText.textContent = "Select Program";
    progText.classList.add('placeholder');
    progContainer.classList.add('disabled');

    // Helper to toggle panel open/close
    const togglePanel = (container) => {
        const isOpen = container.classList.contains('open');
        // Close all other panels first
        document.querySelectorAll('.glass-select-container').forEach(c => c.classList.remove('open'));
        if (!isOpen) {
            container.classList.add('open');
        }
    };

    // Global click listener to close panels when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.glass-select-container')) {
            document.querySelectorAll('.glass-select-container').forEach(c => c.classList.remove('open'));
        }
    });

    catTrigger.onclick = (e) => {
        e.stopPropagation();
        togglePanel(catContainer);
    };

    progTrigger.onclick = (e) => {
        e.stopPropagation();
        if (progContainer.classList.contains('disabled')) return;
        togglePanel(progContainer);
    };

    // Load categories dynamically
    const categories = [...new Set(allResults.map(r => r.categoryName))].sort();
    
    const populateCategories = () => {
        catPanel.innerHTML = '';
        categories.forEach(c => {
            const isSelected = c === selectedCategory;
            const item = document.createElement('div');
            item.className = `glass-select-item ${isSelected ? 'selected' : ''}`;
            
            let checkHTML = '';
            if (isSelected) {
                checkHTML = `<span class="glass-select-check">✓</span>`;
            }
            
            item.innerHTML = `
                <span>${escapeHTML(c)}</span>
                ${checkHTML}
            `;
            
            item.onclick = (e) => {
                e.stopPropagation();
                selectedCategory = c;
                catText.textContent = c;
                catText.classList.remove('placeholder');
                catContainer.classList.remove('open');
                
                // Reset program
                selectedProgram = "";
                progText.textContent = "Select Program";
                progText.classList.add('placeholder');
                progContainer.classList.remove('disabled');
                
                // Re-populate categories & populate programs
                populateCategories();
                populatePrograms();
            };
            catPanel.appendChild(item);
        });
    };

    const populatePrograms = () => {
        progPanel.innerHTML = '';
        if (!selectedCategory) return;

        // Load only programs under that category
        const programs = [...new Set(
            allResults
                .filter(r => r.categoryName === selectedCategory)
                .map(r => r.programName)
        )].sort();

        programs.forEach(p => {
            const isSelected = p === selectedProgram;
            const item = document.createElement('div');
            item.className = `glass-select-item ${isSelected ? 'selected' : ''}`;
            
            let checkHTML = '';
            if (isSelected) {
                checkHTML = `<span class="glass-select-check">✓</span>`;
            }

            item.innerHTML = `
                <span>${escapeHTML(p)}</span>
                ${checkHTML}
            `;

            item.onclick = (e) => {
                e.stopPropagation();
                selectedProgram = p;
                progText.textContent = p;
                progText.classList.remove('placeholder');
                progContainer.classList.remove('open');
                
                // Re-populate programs
                populatePrograms();
            };
            progPanel.appendChild(item);
        });
    };

    // Populate category dropdown initially
    populateCategories();

    // Handle Search click workflow
    document.getElementById('btnFilterSearch').onclick = () => {
        if (!selectedCategory || !selectedProgram) {
            showToast("⚠️ Please select both Category and Program!");
            return;
        }

        // Query the single matching result
        const currentResult = allResults.find(r => r.categoryName === selectedCategory && r.programName === selectedProgram);
        if (!currentResult) {
            renderEmpty("Result Not Found", "The requested program standings have not been published yet.");
            return;
        }

        // Generate Result Poster
        renderSingleResult(currentResult);
    };
}

// ─────────────────────────────────────────────
// Rendering Standings Poster Card
// ─────────────────────────────────────────────
function renderSingleResult(r) {
    const list = document.getElementById('resultsList');
    if (!list) return;

    const bgId = cardBgMap[r.id] || 1;

    // Sort all published results chronologically by publication time ascending to get index order number
    const sortedPublished = [...allResults].sort((a, b) => {
        const timeA = a.publishedAt?.seconds || 0;
        const timeB = b.publishedAt?.seconds || 0;
        return timeA - timeB; // oldest published standing is RESULT 1
    });

    // Calculate published order number
    const resultNumber = sortedPublished.findIndex(x => x.id === r.id) + 1;

    // Fetch Madrasa name branding
    const madrasaName = instituteDetails?.name || "Madrasa Results Portal";

    // Extract top 3 winners sorted strictly by finalMark descending
    const sortedWinners = [...(r.marksData || [])]
        .filter(w => w.finalMark && w.finalMark > 0)
        .sort((a, b) => (b.finalMark || 0) - (a.finalMark || 0))
        .slice(0, 3);

    const winnersHTML = sortedWinners.map((w, idx) => {
        const rank = idx + 1;
        const rankClass = `rank-circle-${rank}`;

        let detailsHTML = '';
        const isGroup = r.programType === 'group' || (r.programType === 'general' && r.registrationType === 'group');
        if (isGroup) {
    // Group Program: Large subgroup heading + gold subtitle
    const teamNameText = w.teamName || '—';
    const subgroupName = w.studentName || 'TEAM A';

    detailsHTML = `
        <div class="team-main">
            ${escapeHTML(subgroupName.toUpperCase())}
        </div>

        <div class="team-subtitle">
            ${escapeHTML(teamNameText.toUpperCase())}
        </div>
    `;
} else {
            // Individual Program: standard white bold student name + team subtitle
            const studentNameText = w.studentName || '—';
            const teamNameText = w.teamName || '—';
            detailsHTML = `
                <h3>${escapeHTML(studentNameText.toUpperCase())}</h3>
                <p>${escapeHTML(teamNameText.toUpperCase())}</p>
            `;
        }

        return `
            <div class="winner-card">
                <div class="rank-circle ${rankClass}">
                    ${rank}
                </div>
                <div style="display:flex; flex-direction:column;">
                    ${detailsHTML}
                </div>
            </div>
        `;
    }).join('');

    const finalWinnersHTML = winnersHTML || `<div style="text-align:center;padding:2.5rem 1.5rem;color:rgba(255,255,255,0.4);font-style:italic;">No standings recorded for this event.</div>`;

    list.innerHTML = `
        <div class="poster-container" id="container-${r.id}">
            
            <!-- Unified Poster Card Component in exact 4:5 aspect ratio -->
            <div class="result-poster" id="poster-${r.id}" style="background-image: url('../assets/poster-backgrounds/bg${bgId}.jpg')">
                
                <!-- Category, Program and Stacked Result Number (No Overlapping) -->
                <div class="poster-header" style="position: absolute; top: 60px; left: 40px; right: 40px; display: flex; flex-direction: column; gap: 6px; z-index: 10;">
                    <span class="category">${escapeHTML(r.categoryName)}</span>
                    <div class="program">${escapeHTML(r.programName)}</div>
                    <div class="result-number">RESULT ${resultNumber}</div>
                </div>

                <!-- Middle-to-Bottom Winners standings list -->
                <div class="p-winners-list" style="position: absolute; bottom: 85px; left: 40px; right: 40px; z-index: 10;">
                    ${finalWinnersHTML}
                </div>

                <!-- Dedicated Footer Madrasa Name (Premium branding) -->
                <div class="poster-footer">
                    ${escapeHTML(madrasaName)}
                </div>

            </div>

            <!-- Background Image Selection Thumbnail Strip (□ □ □ □) -->



            <div class="bg-picker-card">
                <span class="bg-picker-title">🎨 CHOOSE BACKGROUND DESIGN</span>
                <div class="thumbnail-list">
                    <div class="thumb ${bgId === 1 ? 'active' : ''}" data-id="${r.id}" data-bg="1">
                        <img src="../assets/poster-backgrounds/bg1.jpg" alt="Bg 1">
                    </div>
                    <div class="thumb ${bgId === 2 ? 'active' : ''}" data-id="${r.id}" data-bg="2">
                        <img src="../assets/poster-backgrounds/bg2.jpg" alt="Bg 2">
                    </div>
                    <div class="thumb ${bgId === 3 ? 'active' : ''}" data-id="${r.id}" data-bg="3">
                        <img src="../assets/poster-backgrounds/bg3.jpg" alt="Bg 3">
                    </div>
                    <div class="thumb ${bgId === 4 ? 'active' : ''}" data-id="${r.id}" data-bg="4">
                        <img src="../assets/poster-backgrounds/bg4.jpg" alt="Bg 4">
                    </div>
                    <div class="thumb ${bgId === 5 ? 'active' : ''}" data-id="${r.id}" data-bg="5">
                        <img src="../assets/poster-backgrounds/bg5.jpg" alt="Bg 5">
                    </div>
                    <div class="thumb ${bgId === 6 ? 'active' : ''}" data-id="${r.id}" data-bg="6">
                        <img src="../assets/poster-backgrounds/bg6.jpg" alt="Bg 6">
                    </div>
                    <div class="thumb ${bgId === 7 ? 'active' : ''}" data-id="${r.id}" data-bg="7">
                        <img src="../assets/poster-backgrounds/bg7.jpg" alt="Bg 7">
                    </div>
                    <div class="thumb ${bgId === 8 ? 'active' : ''}" data-id="${r.id}" data-bg="8">
                        <img src="../assets/poster-backgrounds/bg8.jpg" alt="Bg 8">
                    </div>
                    <div class="thumb ${bgId === 9 ? 'active' : ''}" data-id="${r.id}" data-bg="9">
                        <img src="../assets/poster-backgrounds/bg9.jpg" alt="Bg 9">
                    </div>
                    <div class="thumb ${bgId === 10 ? 'active' : ''}" data-id="${r.id}" data-bg="10">
                        <img src="../assets/poster-backgrounds/bg10.jpg" alt="Bg 10">
                    </div>
                </div>
            </div>

            <!-- Balanced Actions Buttons Row -->
            <div class="poster-actions">
                <button class="btn-action-primary btn-download" data-id="${r.id}">📥 Download Image</button>
                <button class="btn-action-secondary btn-share" data-id="${r.id}">📤 Share Image</button>
            </div>

        </div>
    `;

    // Wire thumbnail selector click triggers
    document.querySelectorAll('.thumb').forEach(box => {
        box.onclick = (e) => {
            const cardId = e.currentTarget.dataset.id;
            const bgNum = parseInt(e.currentTarget.dataset.bg, 10);

            // Update local state map
            cardBgMap[cardId] = bgNum;

            // Change background of target poster instantly (with smooth CSS fade transition)
            const posterEl = document.getElementById(`poster-${cardId}`);
            if (posterEl) {
                posterEl.style.backgroundImage = `url('../assets/poster-backgrounds/bg${bgNum}.jpg')`;
            }

            // Cycle active highlights in picker grid locally without full re-render
            const containerEl = document.getElementById(`container-${cardId}`);
            if (containerEl) {
                containerEl.querySelectorAll('.thumb').forEach(b => {
                    b.classList.remove('active');
                });
                e.currentTarget.classList.add('active');
            }
        };
    });

    // Wire Card Actions
    document.querySelector('.btn-download').onclick = () => {
        downloadPosterAsImage(r.id);
    };

    document.querySelector('.btn-share').onclick = () => {
        sharePosterContent(r.id);
    };
}

function renderError(title, msg) {
    document.getElementById('resultsList').innerHTML = `
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
            <div class="empty-icon">🔍</div>
            <h3 style="font-family:'Playfair Display', serif;">${escapeHTML(title)}</h3>
            <p>${escapeHTML(msg)}</p>
        </div>
    `;
}

// ─────────────────────────────────────────────
// Unified Off-screen 4:5 Aspect Ratio Canvas Drawer
// ─────────────────────────────────────────────
function generatePosterCanvas(r) {
    const bgId = cardBgMap[r.id] || 1;
    const madrasaName = (instituteDetails?.name || "Madrasa Results Portal").toUpperCase();
    const programName = (r.programName || "Program Standing").toUpperCase();
    const categoryName = (r.categoryName || "General Category").toUpperCase();

    // Sort all published results chronologically by publication time ascending to get index order number
    const sortedPublished = [...allResults].sort((a, b) => {
        const timeA = a.publishedAt?.seconds || 0;
        const timeB = b.publishedAt?.seconds || 0;
        return timeA - timeB;
    });

    const resultNumber = sortedPublished.findIndex(x => x.id === r.id) + 1;

    // Fetch top 3 winners
    const sorted = [...(r.marksData || [])]
        .filter(w => w.finalMark && w.finalMark > 0)
        .sort((a, b) => (b.finalMark || 0) - (a.finalMark || 0))
        .slice(0, 3);

    // Create high-res off-screen canvas (1200x1500 for exact 4:5 aspect ratio)
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 1500;
    const ctx = canvas.getContext('2d');

    // Draw preloaded background
    const bgImg = preloadedBgs[bgId];
    if (bgImg && bgImg.complete) {
        ctx.drawImage(bgImg, 0, 0, 1200, 1500);
    } else {
        // Fallback emerald-pine gradient if image load lags
        const grad = ctx.createLinearGradient(0, 0, 1200, 1500);
        grad.addColorStop(0, '#022c22');
        grad.addColorStop(1, '#064e3b');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 1200, 1500);
    }

    // Overlay dark subtle gradient for readability
    const gradient = ctx.createLinearGradient(0, 0, 0, 1500);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.1)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1200, 1500);

    // Category (top-left)
    ctx.textAlign = 'left';
    ctx.font = '600 52px "Inter", sans-serif';
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(categoryName, 100, 180);

    // Program Name (top-left)
    ctx.font = 'bold 128px "Cinzel", Georgia, serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(programName, 100, 300);

    // RESULT Number (stacked below program name to completely avoid overlays)
    ctx.font = '600 52px "Inter", sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillText(`RESULT ${resultNumber}`, 100, 380);

    // Render Winners (giving stacked headers clean breathing room)
    const startY = 480;
    const rowHeight = 230;

    for (let i = 0; i < sorted.length; i++) {
        const w = sorted[i];
        const y = startY + (i * rowHeight);

        // Glassmorphic translucent white backdrop card
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.beginPath();
        ctx.roundRect(100, y, 1000, 170, 45); // border-radius matches screen scales
        ctx.fill();

        // White card soft borders
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Rank Circle Gradient
        // 1st: Gold gradient, 2nd: Silver gradient, 3rd: Bronze gradient
        if (i === 0) {
            // Gold gradient
            const goldGrad = ctx.createLinearGradient(135, y + 35, 235, y + 135);
            goldGrad.addColorStop(0, '#FFE082');
            goldGrad.addColorStop(1, '#FFB300');
            ctx.fillStyle = goldGrad;
        } else if (i === 1) {
            // Silver gradient
            const silverGrad = ctx.createLinearGradient(135, y + 35, 235, y + 135);
            silverGrad.addColorStop(0, '#F1F5F9');
            silverGrad.addColorStop(1, '#94A3B8');
            ctx.fillStyle = silverGrad;
        } else {
            // Bronze gradient
            const bronzeGrad = ctx.createLinearGradient(135, y + 35, 235, y + 135);
            bronzeGrad.addColorStop(0, '#FFEDD5');
            bronzeGrad.addColorStop(1, '#D97706');
            ctx.fillStyle = bronzeGrad;
        }
        ctx.beginPath();
        ctx.arc(185, y + 85, 50, 0, Math.PI * 2);
        ctx.fill();

        // Rank Text inside Circle
        ctx.font = 'bold 42px "Inter", sans-serif';
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'center';
        ctx.fillText(`${i + 1}`, 185, y + 99);

        // Winner name & Subtitle (depending on programType)
        ctx.textAlign = 'left';
        const isGroup = r.programType === 'group' || (r.programType === 'general' && r.registrationType === 'group');
        if (isGroup) {
            // Group program: Large subgroup heading + gold subtitle
            const teamNameText = w ? w.teamName : '—';
            const subgroupName = w ? (w.studentName || 'TEAM A') : '—';

            ctx.font = 'bold 38px "Inter", sans-serif';
            ctx.fillStyle = '#ffffff'; // main heading color (white for glass contrast)
            ctx.fillText(subgroupName.toUpperCase(), 270, y + 72);

            ctx.font = '600 24px "Inter", sans-serif';
            ctx.fillStyle = '#D4A017'; // gold subtitle color
            ctx.fillText(teamNameText.toUpperCase(), 270, y + 122);
        } else {
            // Individual program: standard white large student heading + smaller team name subtitle
            const studentNameText = w ? w.studentName : '—';
            const teamNameText = w ? (w.teamName || '—') : '—';

            ctx.font = 'bold 38px "Inter", sans-serif';
            ctx.fillStyle = '#ffffff'; // white color heading
            ctx.fillText(studentNameText.toUpperCase(), 270, y + 72);

            ctx.font = '600 24px "Inter", sans-serif';
            ctx.fillStyle = '#cbd5e1'; // subtitle color
            ctx.fillText(teamNameText.toUpperCase(), 270, y + 122);
        }
    }

    // Centered Madrasa Footer Branding
    ctx.textAlign = 'center';
    ctx.font = 'bold 44px "Inter", sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText(madrasaName, 600, 1430);

    return canvas;
}

// ─────────────────────────────────────────────
// Poster Image Direct Download
// ─────────────────────────────────────────────
function downloadPosterAsImage(cardId) {
    const r = allResults.find(x => x.id === cardId);
    if (!r) return;

    const canvas = generatePosterCanvas(r);

    // Trigger standard browser download handler
    const link = document.createElement('a');
    link.download = `result_${r.programName.toLowerCase().replace(/\s+/g, '_')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast(`✓ Image downloaded: result_${r.programName.toLowerCase().replace(/\s+/g, '_')}.png`);
}

// ─────────────────────────────────────────────
// Native Web Share API or Clipboard Fallsharing
// ─────────────────────────────────────────────
function sharePosterContent(cardId) {
    const r = allResults.find(x => x.id === cardId);
    if (!r) return;

    const madrasaName = instituteDetails?.name || "Madrasa Results";

    // Fetch top 3 winners
    const sorted = [...(r.marksData || [])]
        .filter(w => w.finalMark && w.finalMark > 0)
        .sort((a, b) => (b.finalMark || 0) - (a.finalMark || 0))
        .slice(0, 3);

    const isGroup = r.programType === 'group' || (r.programType === 'general' && r.registrationType === 'group');
    const w1 = sorted[0] ? `${isGroup ? sorted[0].teamName : sorted[0].studentName} (${isGroup ? 'Group' : sorted[0].teamName})` : '—';
    const w2 = sorted[1] ? `${isGroup ? sorted[1].teamName : sorted[1].studentName} (${isGroup ? 'Group' : sorted[1].teamName})` : '—';
    const w3 = sorted[2] ? `${isGroup ? sorted[2].teamName : sorted[2].studentName} (${isGroup ? 'Group' : sorted[2].teamName})` : '—';

    const portalUrl = window.location.href;
    const shareText = `🏆 *${r.programName.toUpperCase()}* Result Published!\n\n🕌 *${madrasaName}*\n🏷️ Category: *${r.categoryName}*\n\n🥇 *1st:* ${w1}\n🥈 *2nd:* ${w2}\n🥉 *3rd:* ${w3}\n\n👉 Check official standings on the portal:\n${portalUrl}`;

    // Helper function for clipboard text copy fallback
    const copyToClipboardFallback = () => {
        navigator.clipboard.writeText(shareText).then(() => {
            showToast("✓ Copied standings summary & portal link to clipboard!");

            // Open WhatsApp Web/Mobile with prefilled text
            const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
            window.open(waUrl, '_blank');
        }).catch(err => {
            console.error("Clipboard copy failure:", err);
            showToast("Sharing copy failed.");
        });
    };

    // Generate image canvas
    const canvas = generatePosterCanvas(r);

    // Attempt direct image file sharing through Web Share API if supported
    if (navigator.canShare && navigator.share) {
        canvas.toBlob((blob) => {
            if (!blob) {
                console.error("Failed to generate blob from canvas");
                copyToClipboardFallback();
                return;
            }

            const fileName = `result_${r.programName.toLowerCase().replace(/\s+/g, '_')}.png`;
            const file = new File([blob], fileName, { type: 'image/png' });

            // Double check if sharing this specific file is allowed by the browser
            if (navigator.canShare({ files: [file] })) {
                navigator.share({
                    files: [file],
                    title: `${r.programName} Standings`,
                    text: shareText
                }).then(() => {
                    showToast("✓ Shared standings image successfully!");
                }).catch(err => {
                    console.warn("Native sharing cancelled or failed:", err);
                    copyToClipboardFallback();
                });
            } else {
                console.warn("Direct image sharing not supported by this browser");
                copyToClipboardFallback();
            }
        }, 'image/png');
    } else {
        // Fallback for browsers that do not support Web Share API (desktop)
        copyToClipboardFallback();
    }
}

// Start Portal Load
init();
