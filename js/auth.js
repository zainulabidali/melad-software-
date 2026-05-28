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
// Dynamic Relative Path Helper
// ─────────────────────────────────────────────
const isSubFolder = window.location.pathname.includes('/pages/');
const pathPrefix = isSubFolder ? '../' : './';


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
        window.location.href = `${pathPrefix}pages/login.html`;
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
                window.location.href = `${pathPrefix}pages/super-admin.html`;
            } else if (profile.role === 'admin') {
                window.location.href = `${pathPrefix}pages/admin-dashboard.html`;
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
// REGISTER FORM HANDLER & VALIDATION
// ─────────────────────────────────────────────
const validators = {
    regFullName: (val) => {
        if (!val) return 'Full Name is required';
        if (val.length < 3) return 'Full Name must be at least 3 characters';
        return '';
    },
    regEmail: (val) => {
        if (!val) return 'Email is required';
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(val)) return 'Please enter a valid email address';
        return '';
    },
    regPhone: (val) => {
        if (!val) return 'Phone Number is required';
        const phoneRegex = /^\d+$/;
        if (!phoneRegex.test(val)) return 'Phone Number must contain numeric digits only';
        if (val.length < 10) return 'Phone Number must be at least 10 digits';
        return '';
    },
    regPlace: (val) => {
        if (!val) return 'Place / Location is required';
        return '';
    },
    regPassword: (val) => {
        if (!val) return 'Password is required';
        if (val.length < 6) return 'Password must be at least 6 characters';
        return '';
    },
    regConfirmPassword: (val) => {
        if (!val) return 'Confirm Password is required';
        const pass = document.getElementById('regPassword').value;
        if (val !== pass) return 'Passwords do not match';
        return '';
    }
};

function validateField(id) {
    const input = document.getElementById(id);
    const errBox = document.getElementById(`err-${id}`);
    if (!input || !errBox) return true;

    const val = input.value.trim();
    const errorMsg = validators[id](val);

    if (errorMsg) {
        input.classList.add('is-invalid');
        input.classList.remove('is-valid');
        errBox.textContent = '⚠ ' + errorMsg;
        errBox.classList.add('visible');
        return false;
    } else {
        input.classList.remove('is-invalid');
        input.classList.add('is-valid');
        errBox.textContent = '';
        errBox.classList.remove('visible');
        return true;
    }
}

if (registerForm) {
    const fieldsToValidate = ['regFullName', 'regEmail', 'regPhone', 'regPlace', 'regPassword', 'regConfirmPassword'];
    
    // Attach live input and blur validation listeners
    fieldsToValidate.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('input', () => {
                validateField(id);
                if (id === 'regPassword') {
                    const confirmInput = document.getElementById('regConfirmPassword');
                    if (confirmInput && confirmInput.value) {
                        validateField('regConfirmPassword');
                    }
                }
            });
            input.addEventListener('blur', () => {
                validateField(id);
            });
        }
    });

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideAlert();

        // 1. Run all validations first
        let formIsValid = true;
        fieldsToValidate.forEach(id => {
            if (!validateField(id)) {
                formIsValid = false;
            }
        });

        if (!formIsValid) {
            showAlert('Please resolve all validation errors highlighted in red.');
            return;
        }

        const email = document.getElementById('regEmail').value.trim();
        const password = document.getElementById('regPassword').value;
        const fullName = document.getElementById('regFullName').value.trim();
        const phone = document.getElementById('regPhone').value.trim();
        const place = document.getElementById('regPlace').value.trim();

        const btn = document.getElementById('registerBtn');
        const btnText = btn.querySelector('.btn-text');
        const spinner = document.getElementById('registerSpinner');

        btn.disabled = true;
        btnText.classList.add('hidden');
        spinner.classList.remove('hidden');

        try {
            // 1. Create Firebase Auth account
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // 2. Write teachers collection document instead of pending_admins
            await setDoc(doc(db, "teachers", user.uid), {
                fullName: fullName,
                email: email,
                phone: phone,
                place: place,
                instituteName: "",
                createdAt: serverTimestamp(),
                status: "pending"
            });

            // 3. Sign out immediately — they are NOT yet approved
            await signOut(auth);

            // 4. Redirect to the registration-complete page
            window.location.href = `${pathPrefix}pages/registration-complete.html`;

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
// Auto-redirect if already logged in (auth pages)
// ─────────────────────────────────────────────
const isAuthPage = window.location.pathname.includes('login.html') ||
    window.location.pathname.endsWith('index.html') ||
    window.location.pathname.endsWith('/') ||
    window.location.pathname === '' ||
    (!window.location.pathname.includes('.html') && !window.location.pathname.includes('/pages/'));

if (isAuthPage) {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            const profile = await getUserProfile(user.uid);
            if (profile) {
                if (profile.role === 'super_admin') {
                    window.location.href = `${pathPrefix}pages/super-admin.html`;
                } else if (profile.role === 'admin') {
                    window.location.href = `${pathPrefix}pages/admin-dashboard.html`;
                }
            }
        }
    });
}
