import { db, auth } from './firebase.js';
import { signInAnonymously } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { initFinanceView } from './finance.js';

async function initFinanceAccess() {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    
    if (!token) {
        showError("Invalid link. Token is missing.");
        return;
    }

    try {
        const tokenSnap = await getDoc(doc(db, "finance_tokens", token));
        if (!tokenSnap.exists() || tokenSnap.data().enabled !== true) {
            showError("Invalid or expired Finance Link.");
            return;
        }

        const instId = tokenSnap.data().instituteId;
        
        // Expose global variables expected by finance.js
        window.currentInstituteId = instId;
        window.isSuperAdmin = false;
        
        // This acts as our permission bypass indicator for finance.js
        sessionStorage.setItem('publicFinanceMode', 'true');

        // Login anonymously
        const userCredential = await signInAnonymously(auth);
        
        // Register the session to satisfy firestore security rules
        await setDoc(doc(db, "institutes", instId, "financeSessions", userCredential.user.uid), {
            token: token,
            createdAt: serverTimestamp()
        });

        // Setup Institute Name header
        const instRef = doc(db, "institutes", instId);
        onSnapshot(instRef, (instSnap) => {
            if (instSnap.exists()) {
                const header = document.getElementById('instituteNameHeader');
                if (header) {
                    const name = instSnap.data().name || instSnap.data().instituteName || 'Finance Management';
                    header.innerText = name + ' - Finance Management';
                }
            }
        });

        // Hide loader, show content
        const loader = document.getElementById('authGateLoader');
        if (loader) loader.style.display = 'none';
        
        const mainContent = document.getElementById('mainContentWrapper');
        if (mainContent) mainContent.style.display = 'flex';

        // Initialize Finance View
        const container = document.getElementById('financeViewContainer');
        const dummyTopActions = document.createElement('div');
        await initFinanceView(container, dummyTopActions);

    } catch (e) {
        console.error("Finance initialization error:", e);
        showError("An error occurred while verifying the link.");
    }
}

function showError(msg) {
    const loader = document.getElementById('authGateLoader');
    if (loader) {
        loader.innerHTML = `
            <div style="text-align: center; max-width: 400px; padding: 2rem; background: #fff; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
                <h2 style="color: #ef4444; margin-bottom: 1rem;">Access Denied</h2>
                <p style="color: #64748b;">${msg}</p>
            </div>
        `;
    } else {
        alert(msg);
    }
}

// Polyfill escapeHTML if it's not present globally
if (typeof window.escapeHTML !== 'function') {
    window.escapeHTML = function (str) {
        if (!str) return '';
        return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    };
}

// Polyfill showToast if needed
if (typeof window.showToast !== 'function') {
    window.showToast = function(msg) {
        alert(msg.replace(/✓ |❌ /, ''));
    };
}

// Start
document.addEventListener('DOMContentLoaded', initFinanceAccess);
