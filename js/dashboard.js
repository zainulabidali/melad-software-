import { auth, db, updateDashboardMetadata } from './firebase.js';
import { getUserProfile, validateInstituteAccess } from './auth.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { doc, getDoc, collection, query, where, getCountFromServer, onSnapshot, updateDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// Import modules
import { initTeamsView } from './teams.js';
import { initCategoriesView } from './categories.js';
import { initStudentsView, initAddStudentView } from './students.js';
import { initProgramsView } from './programs.js';
import { initResultsView } from './results.js';
import { initParticipantsWorkflowView } from './participants-workflow.js';
import { initMarkEntryView } from './mark-entry.js';
import { initJudgesView } from './judges.js';
import { initExportsView } from './exports.js';
import { initTopScorersView } from './top-scorers.js';
import { initScheduleView } from './schedule.js';
import { initSettingsView } from './settings.js';

// Global state
window.currentInstituteId = null;
window.currentInstituteDetails = null;
window.currentEventDetails = null;

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
    'add-student': initAddStudentView,
    'programs': initProgramsView,
    'judges': initJudgesView,
    'mark-entry': initMarkEntryView,
    'results': initResultsView,
    'exports': initExportsView,
    'top-scorers': initTopScorersView,
    'schedule': initScheduleView,
    'settings': initSettingsView,
    'participants-workflow': (container, topActions) => {
        const payload = window.__participantsWorkflowPayload || {};
        return initParticipantsWorkflowView(container, topActions, payload);
    }
};

// Standalone Mode Helper
async function initStandaloneMode(instId) {
    window.currentInstituteId = instId;
    document.body.classList.add('standalone-mode');
    
    try {
        const instRef = doc(db, "institutes", instId);
        onSnapshot(instRef, (instSnap) => {
            if (instSnap.exists()) {
                const instData = instSnap.data();
                window.currentInstituteDetails = instData;
                const headerEl = document.getElementById('instituteNameHeader');
                if (headerEl) {
                    const evName = instData.name || instData.instituteName || 'Mark Entry Portal';
                    headerEl.innerHTML = `<div style="font-size:1.1rem; font-weight:800; color:#ffffff; line-height:1.2;">${evName} — Mark Entry</div>`;
                }
            }
        });
    } catch(e) { console.error(e); }

    document.body.style.display = 'flex';
    document.body.classList.remove('hidden');
    setupNavigation();
    navigateTo('mark-entry');
}

// Auth Guard
onAuthStateChanged(auth, async (user) => {
    const urlParams = new URLSearchParams(window.location.search);
    const isStandalone = urlParams.get('mode') === 'standalone' || urlParams.get('standalone') === 'true';
    const standaloneInstId = urlParams.get('instituteId') || urlParams.get('instId');

    if (!user) {
        if (isStandalone && standaloneInstId) {
            initStandaloneMode(standaloneInstId);
            return;
        }
        window.location.href = '../pages/login.html';
        return;
    }

    if (isStandalone && standaloneInstId) {
        document.body.classList.add('standalone-mode');
    }

    try {
        // Run centralized validation immediately upon auth state change or page refresh
        const isValid = await validateInstituteAccess(user);
        if (!isValid) return;

        const userProfile = await getUserProfile(user.uid);
        const impersonatedId = sessionStorage.getItem('impersonatedInstituteId');
        const isImpersonating = userProfile && userProfile.role === 'super_admin' && sessionStorage.getItem('superAdminImpersonating') === 'true' && impersonatedId;

        if (userProfile && (userProfile.role === 'admin' || isImpersonating)) {
            window.currentInstituteId = isImpersonating ? impersonatedId : userProfile.instituteId;
            let isInitialized = false;
            let unsubEventConfig = null;

            // Show impersonation banner if active
            if (isImpersonating) {
                const banner = document.getElementById('impersonationBanner');
                if (banner) {
                    banner.classList.remove('hidden');
                    const nameEl = document.getElementById('impersonatedInstName');
                    if (nameEl) nameEl.textContent = sessionStorage.getItem('impersonatedInstituteName') || 'Institute';
                }
                const returnBtn = document.getElementById('returnToSuperAdminBtn');
                if (returnBtn) {
                    returnBtn.onclick = (e) => {
                        e.preventDefault();
                        sessionStorage.removeItem('impersonatedInstituteId');
                        sessionStorage.removeItem('impersonatedInstituteName');
                        sessionStorage.removeItem('superAdminImpersonating');
                        window.location.href = './super-admin.html';
                    };
                }
            }

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
                            await updateDoc(instRef, { status: "deactivated" }).catch(e => { });
                        }

                        if (isImpersonating) {
                            window.customAlert ? window.customAlert("This institute's subscription has expired.", "Subscription Expired") : alert("This institute's subscription has expired.");
                            return;
                        }

                        // Clean up all snapshot listeners
                        dbUnsubscribes.forEach(unsub => {
                            try { unsub(); } catch (e) { }
                        });
                        dbUnsubscribes = [];
                        try { unsubInstitute(); } catch (e) { }
                        try { unsubEventConfig(); } catch (e) { }

                        sessionStorage.clear();
                        // Force logout instantly due to expiry
                        await signOut(auth);
                        window.location.href = '../pages/login.html?error=expired';
                        return;
                    }

                    if (instData.status === 'deactivated' || instData.status === 'inactive') {
                        if (isImpersonating) {
                            window.customAlert ? window.customAlert("This institute is currently deactivated.", "Institute Deactivated") : alert("This institute is currently deactivated.");
                            return;
                        }

                        // Clean up all snapshot listeners
                        dbUnsubscribes.forEach(unsub => {
                            try { unsub(); } catch (e) { }
                        });
                        dbUnsubscribes = [];
                        try { unsubInstitute(); } catch (e) { }
                        try { unsubEventConfig(); } catch (e) { }

                        sessionStorage.clear();
                        // Force logout instantly
                        await signOut(auth);
                        window.location.href = '../pages/login.html?error=deactivated';
                        return;
                    }

                    const headerEl = document.getElementById('instituteNameHeader');
                    if (headerEl) {
                        const evName = window.currentEventDetails?.eventName || instData.name || instData.instituteName || 'Admin Portal';
                        const madName = window.currentEventDetails?.madrasaName || instData.name || '';
                        headerEl.innerHTML = `
                            <div style="font-size:1.1rem; font-weight:800; color:#ffffff; line-height:1.2; letter-spacing:0.5px;">${evName}</div>
                            ${madName ? `<div style="font-size:0.75rem; font-weight:600; color:rgba(255,255,255,0.7); margin-top:2px; letter-spacing:0.5px;">${madName}</div>` : ''}
                        `;
                    }

                    // Keep cache synchronized and fresh in real time
                    sessionStorage.setItem('melad_institute_status', JSON.stringify({
                        status: instData.status || 'active',
                        expiryDate: expiryDateObj ? expiryDateObj.toISOString() : null
                    }));
                    sessionStorage.setItem('melad_last_validated', new Date().getTime().toString());

                    if (!isInitialized) {
                        isInitialized = true;
                        
                        // Setup Realtime Custom Event Name Listener
                        const configRef = doc(db, "institutes", window.currentInstituteId, "metadata", "eventConfig");
                        unsubEventConfig = onSnapshot(configRef, (configSnap) => {
                            if (configSnap.exists()) {
                                window.currentEventDetails = configSnap.data();
                                const eventName = window.currentEventDetails.eventName || window.currentInstituteDetails?.name || 'Admin Portal';
                                const madrasaName = window.currentEventDetails.madrasaName || window.currentInstituteDetails?.name || '';
                                const headerEl = document.getElementById('instituteNameHeader');
                                if (headerEl) {
                                    headerEl.innerHTML = `
                                        <div style="font-size:1.1rem; font-weight:800; color:#ffffff; line-height:1.2; letter-spacing:0.5px;">${eventName}</div>
                                        ${madrasaName ? `<div style="font-size:0.75rem; font-weight:600; color:rgba(255,255,255,0.7); margin-top:2px; letter-spacing:0.5px;">${madrasaName}</div>` : ''}
                                    `;
                                }
                            }
                        });

                        document.body.style.display = 'flex';
                        document.body.classList.remove('hidden');

                        setupNavigation();
                        // Default View
                        if (document.body.classList.contains('standalone-mode')) {
                            navigateTo('mark-entry');
                        } else {
                            navigateTo('dashboard');
                        }
                    }
                } else {
                    // Institute was deleted
                    if (isImpersonating) {
                        window.customAlert ? window.customAlert("This institute was deleted.", "Deleted") : alert("This institute was deleted.");
                        return;
                    }

                    dbUnsubscribes.forEach(unsub => {
                        try { unsub(); } catch (e) { }
                    });
                    dbUnsubscribes = [];
                    try { unsubInstitute(); } catch (e) { }
                    try { unsubEventConfig(); } catch (e) { }
                    sessionStorage.clear();
                    await signOut(auth);
                    window.location.href = '../pages/login.html';
                }
            }, async (error) => {
                console.error("Institute realtime listener error:", error);
                if (isImpersonating) {
                    window.customAlert ? window.customAlert("Realtime listener error: " + error.message, "Error") : alert("Realtime listener error: " + error.message);
                    return;
                }
                // Fail-safe: if rules block us (due to active expiry in rule), sign out
                dbUnsubscribes.forEach(unsub => {
                    try { unsub(); } catch (e) { }
                });
                dbUnsubscribes = [];
                try { unsubInstitute(); } catch (e) { }
                try { unsubEventConfig(); } catch (e) { }
                sessionStorage.clear();
                await signOut(auth);
                window.location.href = '../pages/login.html?error=expired';
            });
            dbUnsubscribes.push(unsubInstitute);

        } else {
            sessionStorage.clear();
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
        sessionStorage.clear();
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
            const activeDropdown = document.querySelector('.active-body-dropdown');
            if (activeDropdown) activeDropdown.remove();
        }
    });

    // Global Click Outside to Close Actions Dropdowns
    document.addEventListener('click', () => {
        const activeDropdown = document.querySelector('.active-body-dropdown');
        if (activeDropdown) activeDropdown.remove();
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
        'teams': 'Teams & Categories',
        'categories': 'Manage Categories & Classes',
        'students': 'Student Directory',
        'add-student': 'Register Students (Bulk)',
        'programs': 'Manage Programs',
        'judges': 'Manage Judges',
        'mark-entry': 'Mark Entry',
        'results': 'Results',
        'exports': 'Exports',
        'top-scorers': 'Top Scorers',
        'schedule': 'Schedule Management'
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
window.navigateTo = navigateTo;

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

window.navigateToParticipantsWorkflow = function (progId, progData) {
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

function getCategoryColor(categoryName, index) {
    const name = categoryName.toLowerCase().trim();
    if (name.includes('sub junior')) return '#3B82F6'; // Blue
    if (name.includes('junior')) return '#8B5CF6'; // Purple
    if (name.includes('senior')) return '#10B981'; // Green
    
    // Fallback list of modern colors
    const colors = [
        '#F59E0B', // Amber
        '#EC4899', // Pink
        '#06B6D4', // Cyan
        '#14B8A6', // Teal
        '#6366F1', // Indigo
        '#EF4444', // Red
        '#84CC16', // Lime
        '#10B981'  // Emerald
    ];
    return colors[index % colors.length];
}

const centerTextPlugin = {
    id: 'centerText',
    beforeDraw: function(chart) {
        if (chart.config.type !== 'doughnut') return;
        
        const { ctx, chartArea } = chart;
        if (!chartArea) return;
        
        const centerX = (chartArea.left + chartArea.right) / 2;
        const centerY = (chartArea.top + chartArea.bottom) / 2;
        
        ctx.save();
        
        // Draw "Total" label
        ctx.font = "600 11px 'Inter', sans-serif";
        ctx.fillStyle = "#64748b";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("TOTAL", centerX, centerY - 12);
        
        // Draw total count value
        const total = chart.data.datasets[0].data.reduce((sum, val) => sum + val, 0);
        ctx.font = "bold 26px 'Outfit', sans-serif";
        ctx.fillStyle = "#0f172a";
        ctx.fillText(total.toString(), centerX, centerY + 12);
        
        ctx.restore();
    }
};

function updateCharts(teamLabels, teamData, catLabels, catData) {
    if (!window.Chart) {
        console.warn("Chart.js not loaded yet.");
        return;
    }

    if (window.ChartDataLabels) {
        try {
            Chart.register(window.ChartDataLabels);
        } catch (e) {
            // Already registered or not supported
        }
        Chart.defaults.plugins.datalabels = { display: false };
    }

    const isTeamEmpty = teamData.length === 0 || teamData.every(v => v === 0);
    const isCatEmpty = catData.length === 0 || catData.every(v => v === 0);

    toggleChartEmptyState('radarContainer', isTeamEmpty);
    toggleChartEmptyState('barContainer', isCatEmpty);

    // Modern Bar Chart (Participants by Team)
    const ctxRadar = document.getElementById('chartTeamsRadar')?.getContext('2d');
    
    // Generate gradients for each team
    const gradients = [];
    const gradientStops = [
        { start: '#7C3AED', end: '#C084FC' }, // Team A: Purple → Violet
        { start: '#3B82F6', end: '#06B6D4' }, // Team B: Blue → Cyan
        { start: '#10B981', end: '#34D399' }, // Team C: Emerald → Green
        { start: '#F59E0B', end: '#FBBF24' }, // Amber → Yellow
        { start: '#EC4899', end: '#F472B6' }, // Pink
        { start: '#6366F1', end: '#818CF8' }  // Indigo
    ];

    if (ctxRadar) {
        teamLabels.forEach((label, idx) => {
            const stop = gradientStops[idx % gradientStops.length];
            const grad = ctxRadar.createLinearGradient(0, 300, 0, 50);
            grad.addColorStop(0, stop.start);
            grad.addColorStop(1, stop.end);
            gradients.push(grad);
        });

        if (radarChartInstance) {
            radarChartInstance.data.labels = teamLabels;
            radarChartInstance.data.datasets[0].data = teamData;
            radarChartInstance.data.datasets[0].backgroundColor = gradients;
            radarChartInstance.update();
        } else {
            radarChartInstance = new Chart(ctxRadar, {
                type: 'bar',
                data: {
                    labels: teamLabels,
                    datasets: [{
                        label: 'Participants Count',
                        data: teamData,
                        backgroundColor: gradients,
                        borderRadius: 8,
                        borderSkipped: false
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: {
                        duration: 1000,
                        easing: 'easeOutQuart'
                    },
                    plugins: {
                        legend: { display: false },
                        datalabels: {
                            display: true,
                            anchor: 'end',
                            align: 'top',
                            color: '#1e293b',
                            font: {
                                weight: '700',
                                family: "'Inter', sans-serif",
                                size: 12
                            },
                            formatter: (value) => value
                        }
                    },
                    scales: {
                        x: {
                            grid: { display: false },
                            ticks: {
                                font: {
                                    family: "'Inter', sans-serif",
                                    size: 12,
                                    weight: '600'
                                },
                                color: '#475569'
                            }
                        },
                        y: {
                            grid: { color: 'rgba(148, 163, 184, 0.1)' },
                            ticks: {
                                precision: 0,
                                font: {
                                    family: "'Inter', sans-serif",
                                    size: 11
                                },
                                color: '#64748b'
                            },
                            suggestedMin: 0
                        }
                    }
                }
            });
        }
    }

    // Modern Doughnut Chart (Participants by Category)
    const ctxBar = document.getElementById('chartCatsBar')?.getContext('2d');
    if (ctxBar) {
        const bgColors = catLabels.map((label, idx) => getCategoryColor(label, idx));
        if (barChartInstance) {
            barChartInstance.data.labels = catLabels;
            barChartInstance.data.datasets[0].data = catData;
            barChartInstance.data.datasets[0].backgroundColor = bgColors;
            barChartInstance.update();
        } else {
            barChartInstance = new Chart(ctxBar, {
                type: 'doughnut',
                data: {
                    labels: catLabels,
                    datasets: [{
                        data: catData,
                        backgroundColor: bgColors,
                        borderWidth: 2,
                        borderColor: '#ffffff',
                        hoverOffset: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '70%',
                    animation: {
                        duration: 1000,
                        easing: 'easeOutQuart'
                    },
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                usePointStyle: true,
                                padding: 15,
                                font: {
                                    family: "'Inter', sans-serif",
                                    size: 11,
                                    weight: '500'
                                },
                                color: '#475569'
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const label = context.label || '';
                                    const value = context.parsed || 0;
                                    const datapoints = context.dataset.data;
                                    const total = datapoints.reduce((total, datapoint) => total + datapoint, 0);
                                    const percentage = total > 0 ? ((value / total) * 100).toFixed(1) + '%' : '0%';
                                    return ` ${label}: ${value} (${percentage})`;
                                }
                            }
                        },
                        datalabels: {
                            display: true,
                            color: '#ffffff',
                            font: {
                                weight: '700',
                                size: 10,
                                family: "'Inter', sans-serif"
                            },
                            formatter: (value, ctx) => {
                                const datapoints = ctx.chart.data.datasets[0].data;
                                const total = datapoints.reduce((total, datapoint) => total + datapoint, 0);
                                if (total === 0) return '';
                                const percentage = ((value / total) * 100).toFixed(0);
                                return percentage > 5 ? percentage + '%' : '';
                            }
                        }
                    }
                },
                plugins: [centerTextPlugin]
            });
        }
    }
}

let metadataCache = null;

function recalculateDashboard() {
    if (!metadataCache) return;

    // 1. Update 6 Top Summary Cards
    const totalStudents = metadataCache.studentsCount || 0;
    const totalCompetitions = metadataCache.programsCount || 0;
    const totalTeams = metadataCache.teamsCount || 0;
    const totalCategories = metadataCache.categoriesCount || 0;
    const totalJudges = metadataCache.judgesCount || 0;
    const totalStages = metadataCache.stagesCount || 0;

    const elStudents = document.getElementById('statStudents');
    const elCompetitions = document.getElementById('statCompetitions');
    const elTeams = document.getElementById('statTeams');
    const elCategories = document.getElementById('statCategories');
    const elStages = document.getElementById('statStages');
    const elJudges = document.getElementById('statJudges');

    if (elStudents) elStudents.textContent = totalStudents;
    const elStudentsDesc = document.getElementById('statStudentsDesc');
    if (elStudentsDesc) {
        const maleCount = metadataCache.maleStudentsCount || 0;
        const femaleCount = metadataCache.femaleStudentsCount || 0;
        elStudentsDesc.textContent = `Male: ${maleCount} | Female: ${femaleCount}`;
    }
    if (elCompetitions) elCompetitions.textContent = totalCompetitions;
    if (elTeams) elTeams.textContent = totalTeams;
    if (elCategories) elCategories.textContent = totalCategories;
    if (elStages) elStages.textContent = totalStages;
    if (elJudges) elJudges.textContent = totalJudges;

    // 2. Real-time Live Team Leaderboard
    const sortedTeams = metadataCache.leaderboard || [];
    const leaderboardBody = document.getElementById('leaderboardBody');
    if (leaderboardBody) {
        if (sortedTeams.length === 0) {
            leaderboardBody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:2rem; color:#64748b; font-style:italic;">No points recorded yet.</td></tr>`;
        } else {
            leaderboardBody.innerHTML = sortedTeams.map(({ name, points }, idx) => {
                let rankHTML = `${idx + 1}`;
                if (idx === 0) rankHTML = '<span class="leaderboard-badge gold-medal">🥇 Gold</span>';
                else if (idx === 1) rankHTML = '<span class="leaderboard-badge silver-medal">🥈 Silver</span>';
                else if (idx === 2) rankHTML = '<span class="leaderboard-badge bronze-medal">🥉 Bronze</span>';
                else rankHTML = `<span style="font-weight: 700; color: #64748b; font-size: 0.85rem;">#${idx + 1}</span>`;

                return `
                    <tr style="border-bottom:1px solid #f1f5f9; transition: all 0.2s;">
                        <td style="padding:0.85rem 0.5rem; text-align:center;">${rankHTML}</td>
                        <td style="padding:0.85rem 0.5rem; font-weight:700; color:#1e293b; max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                            ${window.escapeHTML(name)}
                        </td>
                        <td style="padding:0.85rem 0.5rem; text-align:right; font-weight:800; color:#7C3AED;">
                            ${points} pts
                        </td>
                    </tr>
                `;
            }).join('');
        }
    }

    // 3. Public Result Portal Status Update
    const publishedCount = metadataCache.publishedResultsCount || 0;
    const hasPublished = publishedCount > 0;
    const statusEl = document.getElementById('portalStatus');
    const copyBtn = document.getElementById('dashCopyLink');
    const waBtn = document.getElementById('dashWhatsApp');

    if (statusEl) {
        if (hasPublished) {
            statusEl.innerHTML = `<span style="color:#10b981; font-weight:700; display:flex; align-items:center; gap:4px;">✓ Public Portal Active (${publishedCount} results)</span>`;
            if (copyBtn) copyBtn.disabled = false;
            if (waBtn) {
                waBtn.style.pointerEvents = 'auto';
                waBtn.style.opacity = '1';
            }
        } else {
            statusEl.innerHTML = `<span style="color:#f59e0b; font-weight:700; display:flex; align-items:center; gap:4px;">⚠ No Published Results</span>`;
            if (copyBtn) copyBtn.disabled = true;
            if (waBtn) {
                waBtn.style.pointerEvents = 'none';
                waBtn.style.opacity = '0.5';
            }
        }
    }

    // 4. Aggregate Participants By Team (Radar Chart)
    const teamLabels = metadataCache.radarChartData?.labels || [];
    const teamData = metadataCache.radarChartData?.data || [];

    // 5. Aggregate Participants By Category (Horizontal Bar Chart)
    const catLabels = metadataCache.barChartData?.labels || [];
    const catData = metadataCache.barChartData?.data || [];

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

    // Render HTML Scaffolding containing 6 top cards with exactly ONE premium SVG icon each and NO duplicate icons
    container.innerHTML = `
        <div class="dashboard-overview-container">
            
            <!-- 6 Top Summary Cards Grid -->
            <div class="dashboard-summary-cards">
                
                <!-- Card 👥 PARTICIPANTS -->
                <div class="card stat-card-premium">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="stat-title">Students</span>
                        <div class="stat-card-icon-container" style="background: rgba(124, 58, 237, 0.08);">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" style="color:#7C3AED;">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                            </svg>
                        </div>
                    </div>
                    <h2 class="stat-value" id="statStudents">-</h2>
                    <span class="stat-desc" id="statStudentsDesc">Enrolled students</span>
                </div>

                <!-- Card 🏆 COMPETITIONS -->
                <div class="card stat-card-premium">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="stat-title">Programs</span>
                        <div class="stat-card-icon-container" style="background: rgba(124, 58, 237, 0.08);">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" style="color:#7c3aed;">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-3.375c0-.621-.504-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 0 1-.982-3.172M9.497 0a7.454 7.454 0 0 0 .981 3.172M8.312 14.375a6.002 6.002 0 0 1-2.813-5.326m13.002 0a6.002 6.002 0 0 1-2.813 5.326M5.499 9.049a3.75 3.75 0 0 1 2.812-4.673M18.501 9.049a3.75 3.75 0 0 0-2.812-4.673M12 2.25A2.25 2.25 0 0 0 9.75 4.5v1.25a2.25 2.25 0 0 0 4.5 0V4.5A2.25 2.25 0 0 0 12 2.25z" />
                            </svg>
                        </div>
                    </div>
                    <h2 class="stat-value" id="statCompetitions">-</h2>
                    <span class="stat-desc">Active events</span>
                </div>

                <!-- Card 👥 TEAMS -->
                <div class="card stat-card-premium">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="stat-title">Teams</span>
                        <div class="stat-card-icon-container" style="background: rgba(234, 88, 12, 0.08);">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" style="color:#ea580c;">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
                            </svg>
                        </div>
                    </div>
                    <h2 class="stat-value" id="statTeams">-</h2>
                    <span class="stat-desc">Participating divisions</span>
                </div>

                <!-- Card 📄 CATEGORIES -->
                <div class="card stat-card-premium">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="stat-title">Categories</span>
                        <div class="stat-card-icon-container" style="background: rgba(16, 185, 129, 0.08);">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" style="color:#10b981;">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581a2.25 2.25 0 0 0 3.182 0l4.318-4.318a2.25 2.25 0 0 0 0-3.182L11.16 3.659A2.25 2.25 0 0 0 9.568 3ZM6 7.5h.008v.008H6V7.5Z" />
                            </svg>
                        </div>
                    </div>
                    <h2 class="stat-value" id="statCategories">-</h2>
                    <span class="stat-desc">Student groups</span>
                </div>

                <!-- Card 🧑‍⚖️ JUDGES -->
                <div class="card stat-card-premium">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="stat-title">Judges</span>
                        <div class="stat-card-icon-container" style="background: rgba(100, 116, 139, 0.08);">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" style="color:#64748b;">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M12 22h8M16 17v5M5 13l3.5-3.5M3 15l3.5-3.5M6 10l8.5 8.5-3 3-8.5-8.5 3-3ZM14.5 5.5l4 4-2.5 2.5-4-4 2.5-2.5Z" />
                            </svg>
                        </div>
                    </div>
                    <h2 class="stat-value" id="statJudges">-</h2>
                    <span class="stat-desc">Assigned evaluators</span>
                </div>

            </div>

            <!-- Two-Column Main Analytics Grid Area -->
            <div class="dashboard-main-grid">
                
                <!-- Left Column: Dynamic Charts -->
                <div class="charts-section">
                    
                    <!-- Card: Participants by Team (Bar Chart) -->
                    <div class="card chart-card" id="radarContainer">
                        <h3 style="font-size:1.05rem; font-weight:800; color:#0f172a; margin-top:0; margin-bottom:1.25rem; display:flex; align-items:center; gap:0.5rem; font-family:'Outfit',sans-serif;">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:1.2rem; height:1.2rem; color:#7C3AED;"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6a7.5 7.5 0 1 0 7.5 7.5h-7.5V6Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 10.5H21A7.5 7.5 0 0 0 13.5 3v7.5Z" /></svg>
                            Participants By Team
                        </h3>
                        <div class="chart-container">
                            <canvas id="chartTeamsRadar"></canvas>
                        </div>
                    </div>

                    <!-- Card: Participants by Category (Doughnut Chart) -->
                    <div class="card chart-card" id="barContainer">
                        <h3 style="font-size:1.05rem; font-weight:800; color:#0f172a; margin-top:0; margin-bottom:1.25rem; display:flex; align-items:center; gap:0.5rem; font-family:'Outfit',sans-serif;">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:1.2rem; height:1.2rem; color:#7C3AED;"><path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h15.75c.621 0 1.125.504 1.125 1.125v.75c0 .621-.504 1.125-1.125 1.125H4.125A1.125 1.125 0 0 1 3 13.875v-.75ZM3 19.125c0-.621.504-1.125 1.125-1.125h15.75c.621 0 1.125.504 1.125 1.125v.75c0 .621-.504 1.125-1.125 1.125H4.125A1.125 1.125 0 0 1 3 19.875v-.75ZM3 7.125C3 6.504 3.504 6 4.125 6h15.75c.621 0 1.125.504 1.125 1.125v.75c0 .621-.504 1.125-1.125 1.125H4.125A1.125 1.125 0 0 1 3 7.875v-.75Z" /></svg>
                            Participants By Category
                        </h3>
                        <div class="chart-container">
                            <canvas id="chartCatsBar"></canvas>
                        </div>
                    </div>

                </div>

                <!-- Right Column: Leaderboard -->
                <div class="leaderboard-section">
                    
                    <!-- Team Leaderboard Card -->
                    <div class="card" style="padding:1.75rem; border-radius:20px; border-color:#e2e8f0; box-shadow:0 10px 30px -10px rgba(15, 23, 42, 0.04);">
                        <h3 style="font-size:1.05rem; font-weight:800; color:#0f172a; margin-top:0; margin-bottom:0.2rem; display:flex; align-items:center; gap:0.5rem; font-family:'Outfit',sans-serif;">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:1.2rem; height:1.2rem; color:#7C3AED;"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-3.375c0-.621-.504-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 0 1-.982-3.172M9.497 0a7.454 7.454 0 0 0 .981 3.172M8.312 14.375a6.002 6.002 0 0 1-2.813-5.326m13.002 0a6.002 6.002 0 0 1-2.813 5.326M5.499 9.049a3.75 3.75 0 0 1 2.812-4.673M18.501 9.049a3.75 3.75 0 0 0-2.812-4.673M12 2.25A2.25 2.25 0 0 0 9.75 4.5v1.25a2.25 2.25 0 0 0 4.5 0V4.5A2.25 2.25 0 0 0 12 2.25z" /></svg>
                            Team Leaderboard
                        </h3>
                        <p style="font-size:0.75rem; color:#64748b; margin-bottom:1rem; font-weight:500;">Standings aggregated from published results.</p>
                        <div style="overflow-x:auto;">
                            <table style="width:100%; border-collapse:collapse; font-size:0.875rem;">
                                <thead>
                                    <tr style="border-bottom:2px solid #e2e8f0; text-align:left; background:#f8fafc;">
                                        <th style="padding:0.6rem 0.5rem; color:#475569; font-weight:700; width:70px; text-align:center; font-size:0.7rem; letter-spacing:0.04em;">RANK</th>
                                        <th style="padding:0.6rem 0.5rem; color:#475569; font-weight:700; font-size:0.7rem; letter-spacing:0.04em;">TEAM NAME</th>
                                        <th style="padding:0.6rem 0.5rem; color:#475569; font-weight:700; text-align:right; width:80px; font-size:0.7rem; letter-spacing:0.04em;">POINTS</th>
                                    </tr>
                                </thead>
                                <tbody id="leaderboardBody">
                                    <tr><td colspan="3" style="text-align:center; padding:1.5rem; color:#64748b;"><span class="spinner-sm"></span> Loading standings...</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                </div>

            </div>

            <!-- Public Result Portal Card (Full Width) -->
            <div class="card public-portal-card" style="border: 1px solid rgba(124, 58, 237, 0.15); background: linear-gradient(135deg, rgba(124, 58, 237, 0.02) 0%, rgba(59, 130, 246, 0.02) 100%); padding: 2rem; border-radius: 20px; box-shadow: 0 10px 30px -10px rgba(15, 23, 42, 0.04); margin-top: 1rem;">
                <div style="display: flex; flex-direction: row; justify-content: space-between; align-items: center; gap: 2rem; flex-wrap: wrap;">
                    
                    <!-- Left: Description and Status -->
                    <div style="flex: 1; min-width: 280px;">
                        <h3 class="card-title" style="color: #7C3AED; font-weight: 800; font-family: 'Outfit', sans-serif; display: flex; align-items: center; gap: 0.5rem; font-size: 1.25rem; margin-bottom: 0.5rem;">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" style="width: 1.4rem; height: 1.4rem;"><path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" /></svg>
                            Public Result Portal
                        </h3>
                        <p style="font-size: 0.9rem; color: #64748b; margin-bottom: 0.5rem; line-height: 1.5; font-weight: 500;">
                            Share published standings instantly with parents and students. Results auto-sync in real-time.
                        </p>
                        <div id="portalStatus" style="font-size: 0.85rem; font-weight: 700; display: inline-flex; align-items: center;">
                            <span class="spinner-sm"></span> Checking status...
                        </div>
                    </div>
                    
                    <!-- Right: Actions Grid -->
                    <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
                        <button class="btn btn-secondary" id="dashCopyLink" style="border-radius: 10px; font-weight: 600; padding: 0.75rem 1.25rem; display: flex; align-items: center; gap: 0.5rem;" disabled>
                            📋 Copy Link
                        </button>
                        <a href="https://wa.me/?text=${waMessage}" target="_blank" class="btn btn-primary" id="dashWhatsApp" 
                            style="background: #25D366; border-color: #25D366; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; pointer-events: none; opacity: 0.5; border-radius: 10px; font-weight: 600; padding: 0.75rem 1.25rem; gap: 0.5rem; color: white;">
                            📲 WhatsApp
                        </a>
                        <button class="btn btn-outline" id="dashOpenPortal" style="border-radius: 10px; font-weight: 700; padding: 0.75rem 1.5rem; display: flex; align-items: center; gap: 0.5rem; border-color: #7C3AED; color: #7C3AED;">
                            🌐 Open Portal
                        </button>
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

    // Attach a single optimized Snapshot Listener to the dashboard metadata aggregates document
    try {
        const metaRef = doc(db, "institutes", instId, "metadata", "dashboard");
        const metaUnsub = onSnapshot(metaRef, async (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                metadataCache = data;

                // Authoritative server-side student count check to override any local caching issues
                try {
                    const countSnap = await getCountFromServer(collection(db, "institutes", instId, "students"));
                    metadataCache.studentsCount = countSnap.data().count;
                } catch (e) {
                    console.error("Error fetching authoritative student count from server:", e);
                }

                recalculateDashboard();
                
                // Self-healing: if the sum of category chart counts doesn't match total students, trigger update
                const catTotal = data.barChartData?.data?.reduce((sum, v) => sum + v, 0) || 0;
                const needsSelfHealing = 
                    data.maleStudentsCount === undefined || 
                    data.femaleStudentsCount === undefined || 
                    catTotal !== metadataCache.studentsCount;

                if (needsSelfHealing) {
                    console.log("Self-healing dashboard metadata triggered due to legacy data or mismatch...");
                    if (!window.__selfHealingTriggered) {
                        window.__selfHealingTriggered = true;
                        await updateDashboardMetadata(instId).catch(e => console.error("Self-healing failed:", e));
                    }
                }
            } else {
                console.warn("Dashboard metadata aggregates document is missing. Triggering self-healing generation...");
                // Trigger background update
                await updateDashboardMetadata(instId);
            }
        }, (err) => {
            console.error("Error listening to dashboard metadata aggregates:", err);
        });
        dbUnsubscribes.push(metaUnsub);
    } catch (err) {
        console.error("Error launching database aggregates listener:", err);
    }
}
