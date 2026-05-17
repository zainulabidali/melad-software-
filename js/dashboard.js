import { auth, db } from './firebase.js';
import { getUserProfile } from './auth.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { doc, getDoc, collection, query, where, getCountFromServer } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// Import modules
import { initTeamsView } from './teams.js';
import { initCategoriesView } from './categories.js';
import { initStudentsView } from './students.js';
import { initProgramsView } from './programs.js';
import { initResultsView } from './results.js';
import { initParticipantsWorkflowView } from './participants-workflow.js';

// Global state
window.currentInstituteId = null;
window.currentInstituteDetails = null;

// Routing State
const views = {
    'dashboard': initDashboardOverview,
    'teams': initTeamsView,
    'categories': initCategoriesView,
    'students': initStudentsView,
    'programs': initProgramsView,
    'results': initResultsView,
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
        const userProfile = await getUserProfile(user.uid);
        if (userProfile && userProfile.role === 'admin') {
            window.currentInstituteId = userProfile.instituteId;

            // Fetch Institute Name securely
            const instDoc = await getDoc(doc(db, "institutes", window.currentInstituteId));
            if (instDoc.exists()) {
                window.currentInstituteDetails = instDoc.data();
                document.getElementById('instituteNameHeader').textContent = instDoc.data().name;
            }

            document.body.style.display = 'flex';
            document.body.classList.remove('hidden');

            setupNavigation();
            // Default View
            navigateTo('dashboard');
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

    // Drawer Logic
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
}

function navigateTo(viewName) {
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
        'results': 'Publish Event Results'
    };

    document.getElementById('pageTitle').textContent = titles[viewName] || 'Dashboard';

    // Call View Initializer
    if (views[viewName]) {
        setTimeout(() => {
            if (viewName === 'participants-workflow') {
                views[viewName](mainContent, topActions);
            } else {
                views[viewName](mainContent, topActions);
            }
        }, 100);
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

// Dashboard Overview Logic
async function initDashboardOverview(container, topActions) {
    const instId = window.currentInstituteId;
    const instName = window.currentInstituteDetails?.name || 'Institute';
    const publicUrl = `${window.location.origin}/pages/public-results.html?instId=${instId}`;
    const waMessage = encodeURIComponent(`📢 *${instName}* പരീക്ഷാഫലം പ്രസിദ്ധീകരിച്ചിരിക്കുന്നു.\n\nതാഴെയുള്ള ലിങ്ക് ഉപയോഗിച്ച് റിസൾട്ട് പരിശോധിക്കാം:\n${publicUrl}\n\nبارك الله فيكم`);

    container.innerHTML = `
        <div class="grid" id="analyticsGrid" style="grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));">
            <!-- Stats -->
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title text-muted">Total Teams</h3>
                    <span class="icon" style="font-size:1.5rem;">👥</span>
                </div>
                <h2 style="font-size:2.5rem; margin-top:0.5rem;" id="statTeams">-</h2>
            </div>
            
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title text-muted">Total Students</h3>
                    <span class="icon" style="font-size:1.5rem;">🎓</span>
                </div>
                <h2 style="font-size:2.5rem; margin-top:0.5rem;" id="statStudents">-</h2>
            </div>

            <!-- Public Portal Card -->
            <div class="card" style="border: 1px solid var(--primary-color); background: #f0f7ff;">
                <div class="card-header">
                    <h3 class="card-title" style="color:var(--primary-color); font-weight:700;">🔗 Public Result Portal</h3>
                </div>
                <div class="card-body" style="padding: 0.5rem 0;">
                    <p style="font-size:0.85rem; color:#64748b; margin-bottom:1rem;">Share published results instantly with parents and students.</p>
                    <div id="portalStatus" style="font-size:0.75rem; font-weight:700; margin-bottom:1rem;">
                        <span class="spinner-sm"></span> Checking status...
                    </div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.5rem; margin-bottom:0.5rem;">
                        <button class="btn btn-secondary btn-sm" id="dashCopyLink" disabled>📋 Copy Link</button>
                        <a href="https://wa.me/?text=${waMessage}" target="_blank" class="btn btn-primary btn-sm" id="dashWhatsApp" 
                            style="background:#25D366; border-color:#25D366; text-decoration:none; display:flex; align-items:center; justify-content:center; ${'pointer-events:none; opacity:0.5;'}">
                            📲 WhatsApp
                        </a>
                    </div>
                    <button class="btn btn-outline btn-sm w-full" id="dashOpenPortal">🌐 Open Portal</button>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h3 class="card-title text-muted">Institute Status</h3>
                    <span class="icon" style="font-size:1.5rem;">✅</span>
                </div>
                <h2 style="font-size:1.5rem; margin-top:1rem; text-transform:capitalize;" class="text-success">${window.currentInstituteDetails?.status || 'Active'}</h2>
            </div>
        </div>
    `;

    // Bind Portal Actions
    document.getElementById('dashCopyLink').onclick = () => {
        navigator.clipboard.writeText(publicUrl).then(() => {
            window.showToast("Link copied successfully!");
        });
    };
    document.getElementById('dashOpenPortal').onclick = () => window.open(publicUrl, '_blank');

    try {
        // Teams Count
        const teamsColl = collection(db, "institutes", instId, "teams");
        const snapTeams = await getCountFromServer(teamsColl);
        document.getElementById('statTeams').textContent = snapTeams.data().count;

        // Students Count (Flat Collection)
        const stuColl = collection(db, "institutes", instId, "students");
        const snapStu = await getCountFromServer(stuColl);
        document.getElementById('statStudents').textContent = snapStu.data().count;

        // Portal Status Check
        const resultsColl = collection(db, "institutes", instId, "results");
        const qPublished = query(resultsColl, where("status", "==", "published"));
        const snapPublished = await getCountFromServer(qPublished);
        const hasPublished = snapPublished.data().count > 0;

        const statusEl = document.getElementById('portalStatus');
        const copyBtn = document.getElementById('dashCopyLink');
        const waBtn = document.getElementById('dashWhatsApp');

        if (hasPublished) {
            statusEl.innerHTML = `<span style="color:#15803d;">✓ Public Portal Active (${snapPublished.data().count} results)</span>`;
            copyBtn.disabled = false;
            waBtn.style.pointerEvents = 'auto';
            waBtn.style.opacity = '1';
        } else {
            statusEl.innerHTML = `<span style="color:#d97706;">⚠ No Published Results</span>`;
            copyBtn.disabled = true;
            waBtn.style.pointerEvents = 'none';
            waBtn.style.opacity = '0.5';
        }

    } catch (err) {
        console.error("Dashboard Analytics Error:", err);
    }
}
