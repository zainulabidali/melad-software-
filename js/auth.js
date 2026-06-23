import { auth, db } from './firebase.js';
import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import {
    doc, getDoc, setDoc, serverTimestamp, updateDoc
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
        sessionStorage.clear();
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
    if (!uid) return null;
    try {
        const cachedUid = sessionStorage.getItem('melad_auth_uid');
        const cachedProfile = sessionStorage.getItem('melad_user_profile');
        if (cachedUid === uid && cachedProfile) {
            return JSON.parse(cachedProfile);
        }

        const userRef = doc(db, "users", uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            const data = userSnap.data();
            sessionStorage.setItem('melad_auth_uid', uid);
            sessionStorage.setItem('melad_user_profile', JSON.stringify(data));
            return data;
        }
        return null;
    } catch (e) {
        console.error("Error fetching user profile:", e);
        return null;
    }
}

// ─────────────────────────────────────────────
// Centralized Access Validation Helper
// ─────────────────────────────────────────────
export async function validateInstituteAccess(user) {
    if (!user) return false;
    
    try {
        const now = new Date().getTime();
        const cachedUid = sessionStorage.getItem('melad_auth_uid');
        const cachedValidTime = sessionStorage.getItem('melad_last_validated');
        const cachedInstStatus = sessionStorage.getItem('melad_institute_status');

        // If cache is valid (TTL < 5 minutes)
        if (cachedUid === user.uid && cachedValidTime && (now - parseInt(cachedValidTime, 10) < 300000) && cachedInstStatus) {
            const instData = JSON.parse(cachedInstStatus);
            const status = instData.status || 'active';
            const expiryDateObj = instData.expiryDate ? new Date(instData.expiryDate) : null;
            const isExpired = expiryDateObj && (now >= expiryDateObj.getTime());

            if (isExpired || status !== 'active') {
                sessionStorage.clear();
                await signOut(auth);
                return false;
            }
            return true;
        }

        // Database hit and cache prime on cache miss
        const profile = await getUserProfile(user.uid);
        if (!profile) {
            // Check if they exist in the teachers collection
            const teacherRef = doc(db, "teachers", user.uid);
            const teacherSnap = await getDoc(teacherRef);
            if (teacherSnap.exists()) {
                const teacherData = teacherSnap.data();
                const status = teacherData.status || 'pending';
                
                sessionStorage.clear();
                await signOut(auth);
                
                if (status === 'pending') {
                    if (typeof showAlert === 'function' && document.getElementById('alertMessage')) {
                        showAlert('Your registration is under review. Please wait for Super Admin approval.', 'info');
                    }
                    window.location.href = `${pathPrefix}pages/registration-complete.html`;
                } else if (status === 'rejected') {
                    if (typeof showAlert === 'function' && document.getElementById('alertMessage')) {
                        const reason = teacherData.rejectionReason || teacherData.message || '';
                        const msg = reason ? `Your registration request has been rejected. Reason: ${reason}. Please contact the administrator.` : 'Your registration request has been rejected. Please contact the administrator.';
                        showAlert(msg, 'error');
                    }
                } else {
                    if (typeof showAlert === 'function' && document.getElementById('alertMessage')) {
                        showAlert('Invalid account configuration. Contact support.', 'error');
                    }
                }
                return false;
            }

            sessionStorage.clear();
            await signOut(auth);
            return false;
        }

        // Super admins have global bypass
        if (profile.role === 'super_admin') {
            sessionStorage.setItem('melad_auth_uid', user.uid);
            sessionStorage.setItem('melad_last_validated', now.toString());
            return true;
        }

        if (profile.role === 'admin') {
            const instId = profile.instituteId;
            if (!instId) {
                sessionStorage.clear();
                await signOut(auth);
                return false;
            }

            const instRef = doc(db, "institutes", instId);
            const instSnap = await getDoc(instRef);
            if (!instSnap.exists()) {
                sessionStorage.clear();
                await signOut(auth);
                return false;
            }

            const instData = instSnap.data();
            const status = instData.status || 'active';
            
            // Timezone-safe UTC absolute timestamp comparison
            const expiryDateObj = instData.expiryDate?.toDate?.() || (instData.expiryDate ? new Date(instData.expiryDate) : null);
            const isExpired = expiryDateObj && (now >= expiryDateObj.getTime());

            if (isExpired) {
                // Auto-deactivate status in database to self-heal
                if (status !== 'deactivated') {
                    await updateDoc(instRef, { status: "deactivated" }).catch(e => {});
                }
                sessionStorage.clear();
                await signOut(auth);
                
                // Show alert directly if on login/auth page, otherwise fall back to redirect
                if (typeof showAlert === 'function' && document.getElementById('alertMessage')) {
                    showAlert('Your institute subscription has expired. Please contact Super Admin.', 'error');
                } else {
                    window.location.href = `${pathPrefix}pages/login.html?error=expired`;
                }
                return false;
            }

            if (status !== 'active') {
                sessionStorage.clear();
                await signOut(auth);
                
                // Show alert directly if on login/auth page, otherwise fall back to redirect
                if (typeof showAlert === 'function' && document.getElementById('alertMessage')) {
                    showAlert('Your institute account has been deactivated. Please contact the administrator.', 'error');
                } else {
                    window.location.href = `${pathPrefix}pages/login.html?error=deactivated`;
                }
                return false;
            }

            // Cache valid state on success
            sessionStorage.setItem('melad_auth_uid', user.uid);
            sessionStorage.setItem('melad_institute_status', JSON.stringify({
                status,
                expiryDate: expiryDateObj ? expiryDateObj.toISOString() : null
            }));
            sessionStorage.setItem('melad_last_validated', now.toString());

            return true;
        }

        sessionStorage.clear();
        await signOut(auth);
        return false;
    } catch (e) {
        console.error("Centralized Access Validation Error:", e);
        sessionStorage.clear();
        await signOut(auth);
        return false;
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

            // 1. Run centralized validation
            const isValid = await validateInstituteAccess(user);
            if (!isValid) return;

            // 2. Redirect if valid
            const profile = await getUserProfile(user.uid);
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
            window.isRegistering = true;
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
            window.isRegistering = false;
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
        if (window.isRegistering) return;
        if (user) {
            const isValid = await validateInstituteAccess(user);
            if (isValid) {
                const profile = await getUserProfile(user.uid);
                if (profile.role === 'super_admin') {
                    window.location.href = `${pathPrefix}pages/super-admin.html`;
                } else if (profile.role === 'admin') {
                    window.location.href = `${pathPrefix}pages/admin-dashboard.html`;
                }
            }
        }
    });
}

// ─────────────────────────────────────────────
// Show Deactivation or Expiry Notice dynamically
// ─────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('error') === 'deactivated') {
        showAlert('Your institute account has been deactivated. Please contact the administrator.', 'error');
    } else if (urlParams.get('error') === 'expired') {
        showAlert('Your institute subscription has expired. Please contact Super Admin.', 'error');
    }
});
