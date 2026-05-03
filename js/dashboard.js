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
    'results': initResultsView
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
        if(overlay) overlay.classList.add('visible');
        if(drawer) drawer.classList.add('open');
    }

    function closeMoreDrawer() {
        if(overlay) overlay.classList.remove('visible');
        if(drawer) drawer.classList.remove('open');
    }

    if(openBtn) {
        openBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openMoreDrawer();
        });
    }
    if(closeBtn) closeBtn.addEventListener('click', closeMoreDrawer);
    if(overlay) overlay.addEventListener('click', closeMoreDrawer);
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
            views[viewName](mainContent, topActions);
        }, 100);
    }
}

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
    container.innerHTML = `
        <div class="grid" id="analyticsGrid">
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
                    <h3 class="card-title text-muted">Total Classes/Categories</h3>
                    <span class="icon" style="font-size:1.5rem;">🏷️</span>
                </div>
                <h2 style="font-size:2.5rem; margin-top:0.5rem;" id="statCategories">-</h2>
            </div>
            <!-- Aggregation requires collectionGroup across subcollections or specific pathing -->
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title text-muted">Institute Status</h3>
                    <span class="icon" style="font-size:1.5rem;">✅</span>
                </div>
                <h2 style="font-size:1.5rem; margin-top:1rem; text-transform:capitalize;" class="text-success">${window.currentInstituteDetails?.status || 'Active'}</h2>
            </div>
        </div>
    `;

    try {
        // Teams Count
        const teamsColl = collection(db, "institutes", window.currentInstituteId, "teams");
        const snapTeams = await getCountFromServer(teamsColl);
        document.getElementById('statTeams').textContent = snapTeams.data().count;

        // Note: Counting nested subcollections across all teams realistically needs a cloud function
        // or a `collectionGroup` query filtered by instituteId. We can demonstrate a simple collectionGroup query if security rules allow, or just skip global counting of students for now to keep it efficient.
        document.getElementById('statCategories').textContent = "View Modules";
    } catch (err) {
        console.error("Dashboard Analytics Error:", err);
    }
}
