import { auth, db } from './firebase.js';
import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import {
    doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// ─────────────────────────────────────────────
// Utility: Alert display
// ─────────────────────────────────────────────
function showAlert(message, type = 'error') {
    const alertBox = document.getElementById('alertMessage');
    if (!alertBox) return;
    alertBox.textContent = message;
    alertBox.className = `alert alert-${type === 'error' ? 'error' : 'info'}`;
    alertBox.classList.remove('hidden');
}

function hideAlert() {
    const alertBox = document.getElementById('alertMessage');
    if (alertBox) alertBox.classList.add('hidden');
}

// ─────────────────────────────────────────────
// Utility: Logout (exported for dashboard use)
// ─────────────────────────────────────────────
export async function logoutUser() {
    try {
        await signOut(auth);
        window.location.href = '../pages/login.html';
    } catch (error) {
        console.error("Logout Error", error);
    }
}
window.logoutUser = logoutUser;

// ─────────────────────────────────────────────
// Helper: Get user profile from Firestore
// Returns null if not found (pending or missing)
// ─────────────────────────────────────────────
export async function getUserProfile(uid) {
    try {
        const userRef = doc(db, "users", uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            return userSnap.data();
        }
        return null;
    } catch (e) {
        console.error("Error fetching user profile:", e);
        return null;
    }
}

// ─────────────────────────────────────────────
// Tab Switching Logic (login.html only)
// ─────────────────────────────────────────────
const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');

if (tabLogin && tabRegister) {
    tabLogin.addEventListener('click', () => {
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
        hideAlert();
    });

    tabRegister.addEventListener('click', () => {
        tabRegister.classList.add('active');
        tabLogin.classList.remove('active');
        registerForm.classList.remove('hidden');
        loginForm.classList.add('hidden');
        hideAlert();
    });
}

// ─────────────────────────────────────────────
// LOGIN FORM HANDLER
// ─────────────────────────────────────────────
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideAlert();

        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;
        const btn = document.getElementById('loginBtn');
        const btnText = btn.querySelector('.btn-text');
        const spinner = document.getElementById('loginSpinner');

        btn.disabled = true;
        btnText.classList.add('hidden');
        spinner.classList.remove('hidden');

        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // Check Firestore for approved profile
            const profile = await getUserProfile(user.uid);

            if (!profile) {
                // No approved profile → check pending status
                await signOut(auth);
                showAlert('⏳ Your account is pending Super Admin approval. Please wait for activation.', 'info');
                return;
            }

            if (profile.role === 'super_admin') {
                window.location.href = '../pages/super-admin.html';
            } else if (profile.role === 'admin') {
                window.location.href = '../pages/admin-dashboard.html';
            } else {
                await signOut(auth);
                showAlert('Invalid account configuration. Contact support.');
            }

        } catch (error) {
            console.error("Login Error:", error);
            if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
                showAlert('Invalid email or password. Please try again.');
            } else if (error.code === 'auth/too-many-requests') {
                showAlert('Too many failed attempts. Please try again later.');
            } else {
                showAlert(error.message);
            }
        } finally {
            btn.disabled = false;
            btnText.classList.remove('hidden');
            spinner.classList.add('hidden');
        }
    });
}

// ─────────────────────────────────────────────
// REGISTER FORM HANDLER
// ─────────────────────────────────────────────
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideAlert();

        const email = document.getElementById('regEmail').value.trim();
        const password = document.getElementById('regPassword').value;
        const confirmPassword = document.getElementById('regConfirmPassword').value;
        const btn = document.getElementById('registerBtn');
        const btnText = btn.querySelector('.btn-text');
        const spinner = document.getElementById('registerSpinner');

        // Validate passwords match
        if (password !== confirmPassword) {
            showAlert('Passwords do not match. Please try again.');
            return;
        }

        btn.disabled = true;
        btnText.classList.add('hidden');
        spinner.classList.remove('hidden');

        try {
            // 1. Create Firebase Auth account
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // 2. Write pending_admins document
            await setDoc(doc(db, "pending_admins", user.uid), {
                email: email,
                createdAt: serverTimestamp(),
                status: "pending"
            });

            // 3. Sign out immediately — they are NOT yet approved
            await signOut(auth);

            // 4. Redirect to the registration-complete page
            window.location.href = '../pages/registration-complete.html';

        } catch (error) {
            console.error("Registration Error:", error);
            if (error.code === 'auth/email-already-in-use') {
                showAlert('This email is already registered. Please sign in instead.');
            } else if (error.code === 'auth/weak-password') {
                showAlert('Password must be at least 6 characters long.');
            } else {
                showAlert(error.message);
            }
        } finally {
            btn.disabled = false;
            btnText.classList.remove('hidden');
            spinner.classList.add('hidden');
        }
    });
}

// ─────────────────────────────────────────────
// Auto-redirect if already logged in (login page)
// ─────────────────────────────────────────────
if (window.location.pathname.includes('login.html')) {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            const profile = await getUserProfile(user.uid);
            if (profile) {
                if (profile.role === 'super_admin') {
                    window.location.href = '../pages/super-admin.html';
                } else if (profile.role === 'admin') {
                    window.location.href = '../pages/admin-dashboard.html';
                }
            }
        }
    });
}
