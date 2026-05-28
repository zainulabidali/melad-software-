import { auth, db } from './firebase.js';
import { getUserProfile, validateInstituteAccess } from './auth.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { doc, getDoc, collection, query, where, getCountFromServer, onSnapshot, updateDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// Import modules
import { initTeamsView } from './teams.js';
import { initCategoriesView } from './categories.js';
import { initStudentsView } from './students.js';
import { initProgramsView } from './programs.js';
import { initResultsView } from './results.js';
import { initParticipantsWorkflowView } from './participants-workflow.js';
import { initMarkEntryView } from './mark-entry.js';
import { initJudgesView } from './judges.js';
import { initExportsView } from './exports.js';
import { initTopScorersView } from './top-scorers.js';

// Global state
window.currentInstituteId = null;
window.currentInstituteDetails = null;

// Dashboard Memory Safe Real-Time Listener References & Data Cache
let dbUnsubscribes = [];
let dbData = {
    students: [],
    teams: [],
    programs: [],
    categories: [],
    judges: [],
    results: []
};
let radarChartInstance = null;
let barChartInstance = null;

// Routing State
const views = {
    'dashboard': initDashboardOverview,
    'teams': initTeamsView,
    'categories': initCategoriesView,
    'students': initStudentsView,
    'programs': initProgramsView,
    'judges': initJudgesView,
    'mark-entry': initMarkEntryView,
    'results': initResultsView,
    'exports': initExportsView,
    'top-scorers': initTopScorersView,
    'participants-workflow': (container, topActions) => {
        const payload = window.__participantsWorkflowPayload || {};
        return initParticipantsWorkflowView(container, topActions, payload);
    }
};

// Auth Guard
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = '../pages/login.html';
        return;
    }

    try {
        // Run centralized validation immediately upon auth state change or page refresh
        const isValid = await validateInstituteAccess(user);
        if (!isValid) return;

        const userProfile = await getUserProfile(user.uid);
        if (userProfile && userProfile.role === 'admin') {
            window.currentInstituteId = userProfile.instituteId;
            let isInitialized = false;

            // Listen to Institute status and check expiry real-time to detect instant deactivation
            const instRef = doc(db, "institutes", window.currentInstituteId);
            const unsubInstitute = onSnapshot(instRef, async (instSnap) => {
                if (instSnap.exists()) {
                    const instData = instSnap.data();
                    window.currentInstituteDetails = instData;
                    
                    // Timezone-safe UTC absolute timestamp comparison
                    const expiryDateObj = instData.expiryDate?.toDate?.() || (instData.expiryDate ? new Date(instData.expiryDate) : null);
                    const isExpired = expiryDateObj && (new Date().getTime() > expiryDateObj.getTime());
                    
                    if (isExpired) {
                        // Self-healing: trigger deactivation update in database
                        if (instData.status !== 'deactivated') {
                            await updateDoc(instRef, { status: "deactivated" }).catch(e => {});
                        }
                        
                        // Clean up all snapshot listeners
                        dbUnsubscribes.forEach(unsub => {
                            try { unsub(); } catch (e) {}
                        });
                        dbUnsubscribes = [];
                        try { unsubInstitute(); } catch (e) {}

                        // Force logout instantly due to expiry
                        await signOut(auth);
                        window.location.href = '../pages/login.html?error=expired';
                        return;
                    }
                    
                    if (instData.status === 'deactivated' || instData.status === 'inactive') {
                        // Clean up all snapshot listeners
                        dbUnsubscribes.forEach(unsub => {
                            try { unsub(); } catch (e) {}
                        });
                        dbUnsubscribes = [];
                        try { unsubInstitute(); } catch (e) {}

                        // Force logout instantly
                        await signOut(auth);
                        window.location.href = '../pages/login.html?error=deactivated';
                        return;
                    }

                    const instName = instData.name || instData.instituteName || 'Admin Portal';
                    const headerEl = document.getElementById('instituteNameHeader');
                    if (headerEl) {
                        headerEl.textContent = instName;
                    }

                    if (!isInitialized) {
                        isInitialized = true;
                        document.body.style.display = 'flex';
                        document.body.classList.remove('hidden');

                        setupNavigation();
                        // Default View
                        navigateTo('dashboard');
                    }
                } else {
                    // Institute was deleted
                    dbUnsubscribes.forEach(unsub => {
                        try { unsub(); } catch (e) {}
                    });
                    dbUnsubscribes = [];
                    try { unsubInstitute(); } catch (e) {}
                    await signOut(auth);
                    window.location.href = '../pages/login.html';
                }
            }, async (error) => {
                console.error("Institute realtime listener error:", error);
                // Fail-safe: if rules block us (due to active expiry in rule), sign out
                dbUnsubscribes.forEach(unsub => {
                    try { unsub(); } catch (e) {}
                });
                dbUnsubscribes = [];
                try { unsubInstitute(); } catch (e) {}
                await signOut(auth);
                window.location.href = '../pages/login.html?error=expired';
            });
            dbUnsubscribes.push(unsubInstitute);

        } else {
            await signOut(auth);
            window.location.href = '../pages/login.html';
        }
    } catch (err) {
        console.error("Auth Guard Error:", err);
    }
});

// Setup Navigation
function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item[data-view], .bottom-nav-item[data-view], .drawer-item[data-view]');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();

            // Remove active from all
            navItems.forEach(nav => nav.classList.remove('active'));

            const targetView = item.getAttribute('data-view');

            // Add active to all matching links
            document.querySelectorAll(`[data-view="${targetView}"]`).forEach(el => el.classList.add('active'));

            // Close drawer if it's open
            closeMoreDrawer();

            navigateTo(targetView);
        });
    });

    const logoutHandler = async (e) => {
        e.preventDefault();
        await signOut(auth);
        window.location.href = '../pages/login.html';
    };

    document.getElementById('logoutBtn')?.addEventListener('click', logoutHandler);
    document.getElementById('logoutDrawerBtn')?.addEventListener('click', logoutHandler);

    // Drawer Logic (Bottom sheet drawer legacy fallback bindings)
    const drawer = document.getElementById('moreDrawer');
    const overlay = document.getElementById('moreDrawerOverlay');
    const openBtn = document.getElementById('btnMoreMenu');
    const closeBtn = document.getElementById('closeDrawerBtn');

    function openMoreDrawer() {
        if (overlay) overlay.classList.add('visible');
        if (drawer) drawer.classList.add('open');
    }

    function closeMoreDrawer() {
        if (overlay) overlay.classList.remove('visible');
        if (drawer) drawer.classList.remove('open');
    }

    if (openBtn) {
        openBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openMoreDrawer();
        });
    }
    if (closeBtn) closeBtn.addEventListener('click', closeMoreDrawer);
    if (overlay) overlay.addEventListener('click', closeMoreDrawer);

    // Responsive Left Sidebar Drawer Controller
    const sidebar = document.querySelector('.sidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const closeSidebarBtn = document.getElementById('closeSidebarBtn');

    function openSidebarDrawer() {
        if (sidebar) sidebar.classList.add('open');
        if (sidebarOverlay) sidebarOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeSidebarDrawer() {
        if (sidebar) sidebar.classList.remove('open');
        if (sidebarOverlay) sidebarOverlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openSidebarDrawer();
        });
    }

    if (closeSidebarBtn) {
        closeSidebarBtn.addEventListener('click', (e) => {
            e.preventDefault();
            closeSidebarDrawer();
        });
    }

    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', closeSidebarDrawer);
    }

    // Escape Key Auto-Close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeSidebarDrawer();
            closeMoreDrawer();
        }
    });

    // Close when clicking any nav item inside the sidebar
    const sidebarNavItems = document.querySelectorAll('.sidebar .nav-item');
    sidebarNavItems.forEach(item => {
        item.addEventListener('click', () => {
            closeSidebarDrawer();
        });
    });

    // Swipe Left Gesture (touch support to close mobile drawer)
    let touchStartX = 0;
    let touchStartY = 0;
    if (sidebar) {
        sidebar.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
            touchStartY = e.changedTouches[0].screenY;
        }, { passive: true });

        sidebar.addEventListener('touchend', (e) => {
            const touchEndX = e.changedTouches[0].screenX;
            const touchEndY = e.changedTouches[0].screenY;
            const diffX = touchStartX - touchEndX;
            const diffY = Math.abs(touchStartY - touchEndY);

            // If swiped left by more than 50px and vertical movement is minimal
            if (diffX > 50 && diffY < 80) {
                closeSidebarDrawer();
            }
        }, { passive: true });
    }

    // Debounced window resize handler to safely reset layout scroll locks when returning to desktop screen width
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (window.innerWidth > 1024) {
                closeSidebarDrawer();
            }
        }, 100);
    });
}

function clearDashboardListeners() {
    dbUnsubscribes.forEach(unsub => {
        try { unsub(); } catch (e) { console.error("Error unsubscribing dashboard:", e); }
    });
    dbUnsubscribes = [];

    if (radarChartInstance) {
        try { radarChartInstance.destroy(); } catch (e) { console.error("Error destroying radar chart:", e); }
        radarChartInstance = null;
    }
    if (barChartInstance) {
        try { barChartInstance.destroy(); } catch (e) { console.error("Error destroying bar chart:", e); }
        barChartInstance = null;
    }
}

function navigateTo(viewName) {
    // Clear active real-time dashboard listeners immediately on navigating away
    clearDashboardListeners();

    const mainContent = document.getElementById('mainContentArea');
    const topActions = document.getElementById('topbarActions');

    // Clear previous
    mainContent.innerHTML = '<div class="loader-container mt-4"><div class="spinner"></div></div>';
    topActions.innerHTML = '';

    // Titles Mapping
    const titles = {
        'dashboard': 'Dashboard Overview',
        'teams': 'Manage Teams',
        'categories': 'Manage Categories & Classes',
        'students': 'Student Directory',
        'programs': 'Manage Programs',
        'judges': 'Manage Judges',
        'mark-entry': 'Mark Entry',
        'results': 'Results',
        'exports': 'Exports',
        'top-scorers': 'Top Scorers'
    };

    document.getElementById('pageTitle').textContent = titles[viewName] || 'Dashboard';

    // Call View Initializer
    if (views[viewName]) {
        setTimeout(() => {
            views[viewName](mainContent, topActions);
            // Append the expiry proximity banner if ≤ 7 days remain
            checkAndShowExpiryWarning();
        }, 100);
    }
}

// ─────────────────────────────────────────────
// Centralized Proximity Expiry Banner Helper (7 days check)
// ─────────────────────────────────────────────
function checkAndShowExpiryWarning() {
    if (!window.currentInstituteDetails || !window.currentInstituteDetails.expiryDate) return;
    
    const expiryDateObj = window.currentInstituteDetails.expiryDate.toDate?.() || new Date(window.currentInstituteDetails.expiryDate);
    const msDiff = expiryDateObj.getTime() - new Date().getTime();
    const daysRemaining = Math.ceil(msDiff / (1000 * 60 * 60 * 24));
    
    // If subscription expires in 7 days or less (but is not yet expired)
    if (daysRemaining > 0 && daysRemaining <= 7) {
        // Prevent duplicate banner rendering
        if (document.getElementById('expiryWarningBanner')) return;
        
        const banner = document.createElement('div');
        banner.id = 'expiryWarningBanner';
        banner.style.cssText = `
            background: linear-gradient(135deg, #fff7ed, #ffedd5) !important;
            border: 1px solid #fed7aa !important;
            color: #c2410c !important;
            padding: 1rem 1.5rem !important;
            border-radius: 12px !important;
            margin-bottom: 1.5rem !important;
            font-size: 0.875rem !important;
            font-weight: 600 !important;
            display: flex !important;
            align-items: center !important;
            gap: 0.75rem !important;
            box-shadow: 0 4px 15px rgba(249, 115, 22, 0.05) !important;
            animation: modalSlideUp 0.4s ease !important;
        `;
        
        banner.innerHTML = `
            <span style="font-size: 1.25rem;">⚠️</span>
            <div style="flex: 1;">
                Subscription Warning: Your institute's subscription will expire in <strong style="color: #ea580c;">${daysRemaining} day${daysRemaining > 1 ? 's' : ''}</strong>. 
                Please contact the Super Admin to renew.
            </div>
        `;
        
        const mainContent = document.getElementById('mainContentArea');
        if (mainContent) {
            mainContent.insertBefore(banner, mainContent.firstChild);
        }
    }
}

window.navigateToParticipantsWorkflow = function(progId, progData) {
    window.__participantsWorkflowPayload = { progId, progData };
    navigateTo('participants-workflow');
};

// Global UI Tools
window.showToast = function (message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-message">${message}</span>
        <button class="toast-close">&times;</button>
    `;
    container.appendChild(toast);

    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.onclick = () => {
        toast.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    };

    setTimeout(() => {
        if (document.body.contains(toast)) {
            toast.style.animation = 'slideOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }
    }, 4000);
};

window.escapeHTML = function (str) {
    if (!str) return '';
    return str.toString().replace(/[&<>'"]/g,
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
};

// ─────────────────────────────────────────────
// Dashboard Overview Logic (Upgraded Real-time Analytics System)
// ─────────────────────────────────────────────
let updateTimeout = null;

function requestDashboardUpdate() {
    clearTimeout(updateTimeout);
    updateTimeout = setTimeout(recalculateDashboard, 100);
}

function toggleChartEmptyState(containerId, isEmpty) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    let emptyOverlay = container.querySelector('.chart-empty-overlay');
    if (isEmpty) {
        if (!emptyOverlay) {
            emptyOverlay = document.createElement('div');
            emptyOverlay.className = 'chart-empty-overlay';
            emptyOverlay.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,0.85); z-index:10; font-weight:600; color:#64748b; font-size:0.95rem; border-radius:14px;';
            emptyOverlay.textContent = 'No data available';
            container.appendChild(emptyOverlay);
        }
    } else {
        if (emptyOverlay) emptyOverlay.remove();
    }
}

function updateCharts(teamLabels, teamData, catLabels, catData) {
    if (!window.Chart) {
        console.warn("Chart.js not loaded yet.");
        return;
    }

    const isTeamEmpty = teamData.length === 0 || teamData.every(v => v === 0);
    const isCatEmpty = catData.length === 0 || catData.every(v => v === 0);

    toggleChartEmptyState('radarContainer', isTeamEmpty);
    toggleChartEmptyState('barContainer', isCatEmpty);

    // Radar Chart (Participants by Team)
    const ctxRadar = document.getElementById('chartTeamsRadar')?.getContext('2d');
    if (ctxRadar) {
        if (radarChartInstance) {
            radarChartInstance.data.labels = teamLabels;
            radarChartInstance.data.datasets[0].data = teamData;
            radarChartInstance.update();
        } else {
            radarChartInstance = new Chart(ctxRadar, {
                type: 'radar',
                data: {
                    labels: teamLabels,
                    datasets: [{
                        label: 'Participants Count',
                        data: teamData,
                        backgroundColor: 'rgba(99, 102, 241, 0.2)',
                        borderColor: 'rgb(99, 102, 241)',
                        pointBackgroundColor: 'rgb(99, 102, 241)',
                        pointBorderColor: '#fff',
                        pointHoverBackgroundColor: '#fff',
                        pointHoverBorderColor: 'rgb(99, 102, 241)',
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false }
                    },
                    scales: {
                        r: {
                            angleLines: { display: true },
                            suggestedMin: 0,
                            ticks: { precision: 0 }
                        }
                    }
                }
            });
        }
    }

    // Horizontal Bar Chart (Participants by Category)
    const ctxBar = document.getElementById('chartCatsBar')?.getContext('2d');
    if (ctxBar) {
        if (barChartInstance) {
            barChartInstance.data.labels = catLabels;
            barChartInstance.data.datasets[0].data = catData;
            barChartInstance.update();
        } else {
            barChartInstance = new Chart(ctxBar, {
                type: 'bar',
                data: {
                    labels: catLabels,
                    datasets: [{
                        label: 'Participants Count',
                        data: catData,
                        backgroundColor: 'rgba(244, 63, 94, 0.85)',
                        borderColor: 'rgb(244, 63, 94)',
                        borderWidth: 1,
                        borderRadius: 6
                    }]
                },
                options: {
                    indexAxis: 'y', // Makes it horizontal
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false }
                    },
                    scales: {
                        x: {
                            suggestedMin: 0,
                            ticks: { precision: 0 }
                        }
                    }
                }
            });
        }
    }
}

function recalculateDashboard() {
    // 1. Update 6 Top Summary Cards
    const totalStudents = dbData.students.length;
    const totalCompetitions = dbData.programs.length;
    const totalTeams = dbData.teams.length;
    const totalCategories = dbData.categories.length;
    const totalJudges = dbData.judges.length;

    // Total stages calculated dynamically from the unique program locations
    const stagesSet = new Set(dbData.programs.map(p => p.programLocation).filter(Boolean));
    const totalStages = stagesSet.size;

    const elStudents = document.getElementById('statStudents');
    const elCompetitions = document.getElementById('statCompetitions');
    const elTeams = document.getElementById('statTeams');
    const elCategories = document.getElementById('statCategories');
    const elStages = document.getElementById('statStages');
    const elJudges = document.getElementById('statJudges');

    if (elStudents) elStudents.textContent = totalStudents;
    if (elCompetitions) elCompetitions.textContent = totalCompetitions;
    if (elTeams) elTeams.textContent = totalTeams;
    if (elCategories) elCategories.textContent = totalCategories;
    if (elStages) elStages.textContent = totalStages;
    if (elJudges) elJudges.textContent = totalJudges;

    // 2. Real-time Live Team Leaderboard
    const teamPoints = new Map();
    // Initialize all known teams with 0 points
    dbData.teams.forEach(t => {
        if (t.name) teamPoints.set(t.name, 0);
    });

    dbData.results.forEach(r => {
        if (r.status === 'published') {
            const prog = dbData.programs.find(p => p.id === r.programId);
            if (prog && prog.leaderboardEnabled === false) return;

            if (Array.isArray(r.marksData) && r.marksData.length > 0) {
                r.marksData.forEach(w => {
                    if (w.teamName && w.totalPoints > 0) {
                        const current = teamPoints.get(w.teamName) || 0;
                        teamPoints.set(w.teamName, current + (w.totalPoints || 0));
                    }
                });
            } else if (Array.isArray(r.winners)) {
                r.winners.forEach(w => {
                    if (w.teamName) {
                        const current = teamPoints.get(w.teamName) || 0;
                        teamPoints.set(w.teamName, current + (w.marks || 0));
                    }
                });
            }
        }
    });

    const sortedTeams = [...teamPoints.entries()].sort((a, b) => b[1] - a[1]);
    const leaderboardBody = document.getElementById('leaderboardBody');
    if (leaderboardBody) {
        if (sortedTeams.length === 0) {
            leaderboardBody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:1.25rem; color:#64748b; font-style:italic;">No points recorded yet.</td></tr>`;
        } else {
            leaderboardBody.innerHTML = sortedTeams.map(([name, points], idx) => {
                let rankHTML = `${idx + 1}`;
                if (idx === 0) rankHTML = '<span style="font-size:1.15rem;">🥇</span> 1st';
                else if (idx === 1) rankHTML = '<span style="font-size:1.15rem;">🥈</span> 2nd';
                else if (idx === 2) rankHTML = '<span style="font-size:1.15rem;">🥉</span> 3rd';
                else rankHTML = `${idx + 1}th`;

                return `
                    <tr style="border-bottom:1px solid #f1f5f9; hover:background:#f8fafc;">
                        <td style="padding:0.65rem 0.5rem; text-align:center; font-weight:800; color:#475569;">${rankHTML}</td>
                        <td style="padding:0.65rem 0.5rem; font-weight:700; color:#1e293b; max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                            ${window.escapeHTML(name)}
                        </td>
                        <td style="padding:0.65rem 0.5rem; text-align:right; font-weight:850; color:#4338ca;">
                            ${points} pts
                        </td>
                    </tr>
                `;
            }).join('');
        }
    }

    // 3. Public Result Portal Status Update
    const publishedCount = dbData.results.filter(r => r.status === 'published').length;
    const hasPublished = publishedCount > 0;
    const statusEl = document.getElementById('portalStatus');
    const copyBtn = document.getElementById('dashCopyLink');
    const waBtn = document.getElementById('dashWhatsApp');

    if (statusEl) {
        if (hasPublished) {
            statusEl.innerHTML = `<span style="color:#15803d;">✓ Public Portal Active (${publishedCount} results)</span>`;
            if (copyBtn) copyBtn.disabled = false;
            if (waBtn) {
                waBtn.style.pointerEvents = 'auto';
                waBtn.style.opacity = '1';
            }
        } else {
            statusEl.innerHTML = `<span style="color:#d97706;">⚠ No Published Results</span>`;
            if (copyBtn) copyBtn.disabled = true;
            if (waBtn) {
                waBtn.style.pointerEvents = 'none';
                waBtn.style.opacity = '0.5';
            }
        }
    }

    // 4. Aggregate Participants By Team (Radar Chart)
    const teamCounts = new Map();
    dbData.teams.forEach(t => {
        if (t.name) teamCounts.set(t.name, 0);
    });
    dbData.students.forEach(s => {
        if (s.teamName) {
            const current = teamCounts.get(s.teamName) || 0;
            teamCounts.set(s.teamName, current + 1);
        }
    });

    const teamLabels = [...teamCounts.keys()];
    const teamData = [...teamCounts.values()];

    // 5. Aggregate Participants By Category (Horizontal Bar Chart)
    const catCounts = new Map();
    dbData.categories.forEach(c => {
        if (c.name) catCounts.set(c.name, 0);
    });
    dbData.students.forEach(s => {
        if (s.categoryName) {
            const current = catCounts.get(s.categoryName) || 0;
            catCounts.set(s.categoryName, current + 1);
        }
    });

    const catLabels = [...catCounts.keys()];
    const catData = [...catCounts.values()];

    // Trigger charts drawing/updating
    updateCharts(teamLabels, teamData, catLabels, catData);
}

async function initDashboardOverview(container, topActions) {
    const instId = window.currentInstituteId;
    const instName = window.currentInstituteDetails?.name || 'Institute';
    
    // Automatically detect any subfolder repository prefix (e.g. /melad_software) for GitHub Pages
    const origin = window.location.origin;
    const pathname = window.location.pathname;
    const pagesIndex = pathname.indexOf('/pages/');
    const repoPrefix = pagesIndex !== -1 ? pathname.substring(0, pagesIndex) : '';
    const publicUrl = `${origin}${repoPrefix}/pages/public-results.html?id=${instId}`;
    
    const waMessage = encodeURIComponent(`📢 *${instName}*\nതാഴെയുള്ള ലിങ്ക് ഉപയോഗിച്ച് റിസൾട്ട് പരിശോധിക്കാം:\n${publicUrl}`);

    // Reset old listeners first
    clearDashboardListeners();

    // Reset top Actions
    topActions.innerHTML = '';

    // Render HTML Scaffolding containing HSL customized 6 top cards, radar/bar charts canvases, and right side leaderboard
    container.innerHTML = `
        <div class="dashboard-overview-container">
            
            <!-- 6 Top Summary Cards Grid -->
            <div class="dashboard-summary-cards">
                
                <!-- Card 👥 PARTICIPANTS -->
                <div class="card stat-card-participants" style="padding:1.15rem; display:flex; flex-direction:column; gap:0.25rem;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:0.68rem; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:0.05em;">👥 Participants</span>
                        <span style="font-size:1.25rem;">🎓</span>
                    </div>
                    <h2 style="font-size:1.85rem; font-weight:850; margin:0.35rem 0 0.15rem 0; color:#0f172a;" id="statStudents">-</h2>
                    <span style="font-size:0.7rem; color:#64748b; font-weight:600;">Registered</span>
                </div>

                <!-- Card 🏆 COMPETITIONS -->
                <div class="card stat-card-competitions" style="padding:1.15rem; display:flex; flex-direction:column; gap:0.25rem;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:0.68rem; font-weight:700; color:#4338ca; text-transform:uppercase; letter-spacing:0.05em;">🏆 Competitions</span>
                        <span style="font-size:1.25rem;">📝</span>
                    </div>
                    <h2 style="font-size:1.85rem; font-weight:850; margin:0.35rem 0 0.15rem 0; color:#1e1b4b;" id="statCompetitions">-</h2>
                    <span style="font-size:0.7rem; color:#4338ca; font-weight:600;">Active / Final</span>
                </div>

                <!-- Card 👥 TEAMS -->
                <div class="card stat-card-teams" style="padding:1.15rem; display:flex; flex-direction:column; gap:0.25rem;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:0.68rem; font-weight:700; color:#c2410c; text-transform:uppercase; letter-spacing:0.05em;">👥 Teams</span>
                        <span style="font-size:1.25rem;">👥</span>
                    </div>
                    <h2 style="font-size:1.85rem; font-weight:850; margin:0.35rem 0 0.15rem 0; color:#7c2d12;" id="statTeams">-</h2>
                    <span style="font-size:0.7rem; color:#c2410c; font-weight:600;">Participating</span>
                </div>

                <!-- Card 📄 CATEGORIES -->
                <div class="card stat-card-categories" style="padding:1.15rem; display:flex; flex-direction:column; gap:0.25rem;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:0.68rem; font-weight:700; color:#15803d; text-transform:uppercase; letter-spacing:0.05em;">📄 Categories</span>
                        <span style="font-size:1.25rem;">🏷️</span>
                    </div>
                    <h2 style="font-size:1.85rem; font-weight:850; margin:0.35rem 0 0.15rem 0; color:#064e3b;" id="statCategories">-</h2>
                    <span style="font-size:0.7rem; color:#15803d; font-weight:600;">Event groups</span>
                </div>

                <!-- Card 🚩 STAGES -->
                <div class="card stat-card-stages" style="padding:1.15rem; display:flex; flex-direction:column; gap:0.25rem;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:0.68rem; font-weight:700; color:#a16207; text-transform:uppercase; letter-spacing:0.05em;">🚩 Stages</span>
                        <span style="font-size:1.25rem;">🚩</span>
                    </div>
                    <h2 style="font-size:1.85rem; font-weight:850; margin:0.35rem 0 0.15rem 0; color:#713f12;" id="statStages">-</h2>
                    <span style="font-size:0.7rem; color:#a16207; font-weight:600;">Active stages</span>
                </div>

                <!-- Card 🧑‍⚖️ JUDGES -->
                <div class="card stat-card-judges" style="padding:1.15rem; display:flex; flex-direction:column; gap:0.25rem;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:0.68rem; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:0.05em;">🧑‍⚖️ Judges</span>
                        <span style="font-size:1.25rem;">🧑‍⚖️</span>
                    </div>
                    <h2 style="font-size:1.85rem; font-weight:850; margin:0.35rem 0 0.15rem 0; color:#0f172a;" id="statJudges">-</h2>
                    <span style="font-size:0.7rem; color:#64748b; font-weight:600;">Registered</span>
                </div>

            </div>

            <!-- Two-Column Main Analytics Grid Area -->
            <div class="dashboard-main-grid">
                
                <!-- Left Column: Dynamic Charts -->
                <div class="charts-section">
                    
                    <!-- Card: Participants by Team (Radar Chart) -->
                    <div class="card chart-card" id="radarContainer" style="display:flex; flex-direction:column; padding:1.25rem; border-color:#cbd5e1;">
                        <h3 style="font-size:1rem; font-weight:800; color:#0f172a; margin-top:0; margin-bottom:1rem; display:flex; align-items:center; gap:0.35rem;">
                            📊 Participants By Team
                        </h3>
                        <div class="chart-container">
                            <canvas id="chartTeamsRadar"></canvas>
                        </div>
                    </div>

                    <!-- Card: Participants by Category (Horizontal Bar Chart) -->
                    <div class="card chart-card" id="barContainer" style="display:flex; flex-direction:column; padding:1.25rem; border-color:#cbd5e1;">
                        <h3 style="font-size:1rem; font-weight:800; color:#0f172a; margin-top:0; margin-bottom:1rem; display:flex; align-items:center; gap:0.35rem;">
                            📊 Participants By Category
                        </h3>
                        <div class="chart-container">
                            <canvas id="chartCatsBar"></canvas>
                        </div>
                    </div>

                </div>

                <!-- Right Column: Leaderboard and Result Portal -->
                <div class="leaderboard-section">
                    
                    <!-- Team Leaderboard Card -->
                    <div class="card" style="padding:1.25rem; border-color:#cbd5e1;">
                        <h3 style="font-size:1rem; font-weight:800; color:#0f172a; margin-top:0; margin-bottom:0.15rem; display:flex; align-items:center; gap:0.4rem;">
                            🏆 Team Leaderboard
                        </h3>
                        <p style="font-size:0.72rem; color:#64748b; margin-bottom:0.85rem;">Standings aggregated from published results.</p>
                        <div style="overflow-x:auto;">
                            <table style="width:100%; border-collapse:collapse; font-size:0.825rem;">
                                <thead>
                                    <tr style="border-bottom:2px solid #cbd5e1; text-align:left; background:#f8fafc;">
                                        <th style="padding:0.4rem; color:#475569; font-weight:700; width:50px; text-align:center;">RANK</th>
                                        <th style="padding:0.4rem; color:#475569; font-weight:700;">TEAM NAME</th>
                                        <th style="padding:0.4rem; color:#475569; font-weight:700; text-align:right; width:80px;">POINTS</th>
                                    </tr>
                                </thead>
                                <tbody id="leaderboardBody">
                                    <tr><td colspan="3" style="text-align:center; padding:1rem; color:#64748b;"><span class="spinner-sm"></span> Loading standings...</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <!-- Public Result Portal Card (original preserved card) -->
                    <div class="card" style="border: 1px solid var(--primary-color); background: #f0f7ff; padding:1.25rem;">
                        <div class="card-header" style="margin-bottom:0.5rem;">
                            <h3 class="card-title" style="color:var(--primary-color); font-weight:700;">🔗 Public Result Portal</h3>
                        </div>
                        <div class="card-body" style="padding: 0;">
                            <p style="font-size:0.8rem; color:#64748b; margin-bottom:0.75rem; line-height:1.4;">Share published results instantly with parents and students.</p>
                            <div id="portalStatus" style="font-size:0.75rem; font-weight:700; margin-bottom:0.75rem;">
                                <span class="spinner-sm"></span> Checking status...
                            </div>
                            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.5rem; margin-bottom:0.5rem;">
                                <button class="btn btn-secondary btn-sm" id="dashCopyLink" disabled>📋 Copy Link</button>
                                <a href="https://wa.me/?text=${waMessage}" target="_blank" class="btn btn-primary btn-sm" id="dashWhatsApp" 
                                    style="background:#25D366; border-color:#25D366; text-decoration:none; display:flex; align-items:center; justify-content:center; pointer-events:none; opacity:0.5;">
                                    📲 WhatsApp
                                </a>
                            </div>
                            <button class="btn btn-outline btn-sm w-full" id="dashOpenPortal">🌐 Open Portal</button>
                        </div>
                    </div>

                </div>

            </div>

        </div>
    `;

    // Bind Portal Actions
    document.getElementById('dashCopyLink').onclick = () => {
        navigator.clipboard.writeText(publicUrl).then(() => {
            window.showToast("Public result link copied!");
        });
    };
    document.getElementById('dashOpenPortal').onclick = () => window.open(publicUrl, '_blank');

    // Attach 6 Snapshot Listeners to Firestore collections
    const pushListener = (collName, ref, processor) => {
        const unsub = onSnapshot(ref, (snap) => {
            dbData[collName] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            processor();
        }, (err) => {
            console.error(`Error listening to ${collName}:`, err);
        });
        dbUnsubscribes.push(unsub);
    };

    try {
        pushListener('students', collection(db, "institutes", instId, "students"), requestDashboardUpdate);
        pushListener('teams', collection(db, "institutes", instId, "teams"), requestDashboardUpdate);
        pushListener('programs', collection(db, "institutes", instId, "programs"), requestDashboardUpdate);
        pushListener('categories', collection(db, "institutes", instId, "categories"), requestDashboardUpdate);
        pushListener('judges', collection(db, "institutes", instId, "judges"), requestDashboardUpdate);
        pushListener('results', collection(db, "institutes", instId, "results"), requestDashboardUpdate);
    } catch (err) {
        console.error("Error launching database listeners:", err);
    }
}
