import { app, auth, db } from './firebase.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import {
    doc, getDoc, collection, addDoc, deleteDoc, onSnapshot,
    serverTimestamp, updateDoc, setDoc, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { getUserProfile } from './auth.js';

// ─────────────────────────────────────────────
// Route Protection
// ─────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = '../pages/login.html';
        return;
    }
    const userProfile = await getUserProfile(user.uid);
    if (userProfile && userProfile.role === 'super_admin') {
        document.body.style.display = 'flex';
        document.body.classList.remove('hidden');
        loadInstitutes();
        loadPendingAdmins();
    } else {
        await signOut(auth);
        window.location.href = '../pages/login.html';
    }
});

// ─────────────────────────────────────────────
// Toast System
// ─────────────────────────────────────────────
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-message">${message}</span>
        <button class="toast-close">&times;</button>
    `;
    container.appendChild(toast);
    toast.querySelector('.toast-close').onclick = () => {
        toast.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    };
    setTimeout(() => {
        if (document.body.contains(toast)) {
            toast.style.animation = 'slideOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }
    }, 4000);
}

// ─────────────────────────────────────────────
// XSS Protection
// ─────────────────────────────────────────────
function escapeHTML(str) {
    if (!str) return '';
    return str.toString().replace(/[&<>'"/]/g,
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

// ─────────────────────────────────────────────
// Sidebar Navigation
// ─────────────────────────────────────────────
document.getElementById('navInstitutes').addEventListener('click', (e) => {
    e.preventDefault();
    showSection('institutes');
});

document.getElementById('navPending').addEventListener('click', (e) => {
    e.preventDefault();
    showSection('pending');
});

function showSection(section) {
    const isInstitutes = section === 'institutes';
    const isPending = section === 'pending';

    document.getElementById('sectionInstitutes').classList.toggle('hidden', !isInstitutes);
    document.getElementById('sectionPending').classList.toggle('hidden', !isPending);

    document.getElementById('topbarActions').innerHTML = isInstitutes
        ? `<button class="btn btn-primary" id="openAddModalBtn">+ Add Institute</button>`
        : '';

    if (isInstitutes) {
        document.getElementById('pageTitle').textContent = 'Manage Institutes';
    } else if (isPending) {
        document.getElementById('pageTitle').textContent = 'Pending Registrations';
    }

    document.getElementById('navInstitutes').classList.toggle('active', isInstitutes);
    document.getElementById('navPending').classList.toggle('active', isPending);

    if (isInstitutes) {
        document.getElementById('openAddModalBtn').addEventListener('click', () => {
            addInstituteForm.reset();
            document.getElementById('modalAlert').classList.add('hidden');
            addModal.classList.remove('hidden');
        });
    }
}



// ─────────────────────────────────────────────
// Logout
// ─────────────────────────────────────────────
document.getElementById('logoutBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    await signOut(auth);
    window.location.href = '../pages/login.html';
});

// ─────────────────────────────────────────────
// Add Institute Modal
// ─────────────────────────────────────────────
const addModal = document.getElementById('addModal');
const addInstituteForm = document.getElementById('addInstituteForm');

document.getElementById('openAddModalBtn').addEventListener('click', () => {
    addInstituteForm.reset();
    document.getElementById('modalAlert').classList.add('hidden');
    addModal.classList.remove('hidden');
});

const hideAddModal = () => addModal.classList.add('hidden');
document.getElementById('closeAddModalBtn').addEventListener('click', hideAddModal);
document.getElementById('cancelAddModalBtn').addEventListener('click', hideAddModal);

window.submitForm = async function () {
    const instituteName = document.getElementById("name").value.trim();
    const type = document.getElementById("type").value.trim();
    const expiryRaw = document.getElementById("expiryDate").value;

    if (!instituteName || !type) {
        document.getElementById('modalAlert').textContent = 'Please fill in all fields.';
        document.getElementById('modalAlert').className = 'alert alert-error';
        document.getElementById('modalAlert').classList.remove('hidden');
        return;
    }

    let expiryDate = null;
    if (expiryRaw) {
        expiryDate = new Date(expiryRaw);
    }

    const btn = document.getElementById('saveInstituteBtn');
    const btnText = btn.querySelector('.btn-text');
    const spinner = btn.querySelector('.btn-spinner');

    btn.disabled = true;
    btnText.classList.add('hidden');
    spinner.classList.remove('hidden');

    try {
        await addDoc(collection(db, "institutes"), {
            name: instituteName,
            type: type,
            status: "active",
            expiryDate: expiryDate,
            createdAt: serverTimestamp()
        });
        showToast("✅ Institute created successfully!");
        addInstituteForm.reset();
        hideAddModal();
    } catch (error) {
        console.error("Error creating institute:", error);
        showToast("Failed to create institute: " + error.message, "error");
    } finally {
        btn.disabled = false;
        btnText.classList.remove('hidden');
        spinner.classList.add('hidden');
    }
};

// ─────────────────────────────────────────────
// Load & Display Institutes
// ─────────────────────────────────────────────
let allInstitutes = [];

function loadInstitutes() {
    const grid = document.getElementById('institutesGrid');
    const loader = document.getElementById('institutesLoader');
    loader.classList.remove('hidden');

    onSnapshot(collection(db, "institutes"), (snapshot) => {
        grid.innerHTML = '';
        loader.classList.add('hidden');
        allInstitutes = [];

        if (snapshot.empty) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1; margin-top:2rem;">
                    <div class="empty-state-icon">🏢</div>
                    <h3>No Institutes Found</h3>
                    <p>Click "Add Institute" to get started.</p>
                </div>
            `;
            return;
        }

        snapshot.forEach((docSnap) => {
            const inst = docSnap.data();
            const instId = docSnap.id;
            allInstitutes.push({ id: instId, name: inst.name || inst.instituteName, ...inst });

            const card = document.createElement('div');
            card.className = 'glass-card';
            const status = inst.status || 'active';
            const expiryDateObj = inst.expiryDate?.toDate?.();
            const isExpired = expiryDateObj && (new Date().getTime() > expiryDateObj.getTime());

            // Auto-deactivate status in database to self-heal
            if (isExpired && status === 'active') {
                updateDoc(doc(db, "institutes", instId), { status: "deactivated" }).catch(err => {
                    console.error("Auto-deactivation error for expired institute:", err);
                });
            }

            let badgeClass = status === 'active' ? 'badge-active' : 'badge-inactive';
            let statusLabel = status === 'active' ? 'Active' : (status === 'deactivated' ? 'Deactivated' : 'Inactive');

            if (isExpired) {
                badgeClass = 'badge-inactive'; // Red badge highlight
                statusLabel = 'Expired';
            }
            const expiryStr = expiryDateObj ? expiryDateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'No Expiry';
            const expiryRawStr = expiryDateObj ? expiryDateObj.toISOString().split('T')[0] : '';

            // Backward compatibility for old manual entries
            const instName = inst.instituteName || inst.name || 'Unnamed Institute';
            const instType = inst.instituteType || inst.type || 'General';
            const teacherName = inst.teacherName || '—';
            const teacherPhone = inst.teacherPhone || '—';
            const teacherPlace = inst.teacherPlace || '—';
            const teacherEmail = inst.teacherEmail || '—';

            card.innerHTML = `
                <div class="card-header">
                    <div>
                        <span class="card-type-tag">${escapeHTML(instType)}</span>
                        <h3 class="card-title">${escapeHTML(instName)}</h3>
                    </div>
                    <span class="badge ${badgeClass}">${statusLabel}</span>
                </div>
                <div class="card-body">
                    <div class="card-info-item">
                        <span class="card-info-icon">👤</span>
                        <div class="card-info-text">
                            <span class="card-info-label">Registered Teacher</span>
                            <span class="card-info-val">${escapeHTML(teacherName)}</span>
                        </div>
                    </div>
                    <div class="card-info-item">
                        <span class="card-info-icon">✉️</span>
                        <div class="card-info-text">
                            <span class="card-info-label">Teacher Email</span>
                            <span class="card-info-val"><a href="mailto:${escapeHTML(teacherEmail)}" style="color: var(--primary-color); font-weight: 600;">${escapeHTML(teacherEmail)}</a></span>
                        </div>
                    </div>
                    <div class="card-info-item">
                        <span class="card-info-icon">📞</span>
                        <div class="card-info-text">
                            <span class="card-info-label">Teacher Phone</span>
                            <span class="card-info-val">${escapeHTML(teacherPhone)}</span>
                        </div>
                    </div>
                    <div class="card-info-item">
                        <span class="card-info-icon">📍</span>
                        <div class="card-info-text">
                            <span class="card-info-label">Teacher Place</span>
                            <span class="card-info-val">${escapeHTML(teacherPlace)}</span>
                        </div>
                    </div>
                    <div class="card-info-item">
                        <span class="card-info-icon">📅</span>
                        <div class="card-info-text">
                            <span class="card-info-label">Expiry Date</span>
                            <span class="card-info-val" style="color: #4338ca;">${expiryStr}</span>
                        </div>
                    </div>
                </div>
                <div class="card-actions" style="flex-wrap: wrap; gap: 0.5rem;">
                    <button class="btn btn-secondary btn-sm edit-inst-btn" data-id="${instId}" data-all='${JSON.stringify({ name: instName, type: instType, expiryDate: expiryRawStr }).replace(/'/g, "&#39;")}'>✏️ Edit</button>
                    <button class="btn btn-secondary btn-sm toggle-status-btn" data-id="${instId}" data-status="${status}">
                        ${status === 'active' ? '⏸ Deactivate' : '▶ Activate'}
                    </button>
                    <button class="btn btn-danger btn-sm delete-inst-btn" data-id="${instId}">🗑 Delete</button>
                </div>
            `;
            grid.appendChild(card);
        });

        document.querySelectorAll('.edit-inst-btn').forEach(btn => {
            btn.addEventListener('click', openEditInstituteModal);
        });
        document.querySelectorAll('.delete-inst-btn').forEach(btn => {
            btn.addEventListener('click', deleteInstitute);
        });
        document.querySelectorAll('.toggle-status-btn').forEach(btn => {
            btn.addEventListener('click', toggleStatus);
        });
    }, (error) => {
        console.error("Error loading institutes:", error);
        loader.classList.add('hidden');
        showToast("Failed to load institutes.", "error");
    });
}

async function toggleStatus(e) {
    const btn = e.target.closest('.toggle-status-btn');
    if (!btn || btn.disabled) return;

    const instId = btn.getAttribute('data-id');
    const currentStatus = btn.getAttribute('data-status') || 'active';
    const newStatus = currentStatus === 'active' ? 'deactivated' : 'active';

    // Disable button to prevent double-click race conditions
    btn.disabled = true;
    const originalText = btn.innerHTML;
    btn.innerHTML = '⏳ Updating...';

    try {
        await updateDoc(doc(db, "institutes", instId), { status: newStatus });
        showToast(`✅ Institute successfully ${newStatus === 'active' ? 'activated' : 'deactivated'}!`);
    } catch (err) {
        console.error("Status toggle error:", err);
        showToast(`Failed to update status: ${err.message}`, 'error');
        // Restore button state on error
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// ─────────────────────────────────────────────
// Edit & Delete Institute
// ─────────────────────────────────────────────
const editModal = document.getElementById('editModal');
const hideEditModal = () => editModal.classList.add('hidden');
document.getElementById('closeEditModalBtn').addEventListener('click', hideEditModal);
document.getElementById('cancelEditModalBtn').addEventListener('click', hideEditModal);

function openEditInstituteModal(e) {
    const instId = e.target.getAttribute('data-id');
    const data = JSON.parse(e.target.getAttribute('data-all'));

    document.getElementById('editInstId').value = instId;
    document.getElementById('editName').value = data.name;
    document.getElementById('editType').value = data.type;
    document.getElementById('editExpiryDate').value = data.expiryDate || '';

    document.getElementById('editModalAlert').classList.add('hidden');
    editModal.classList.remove('hidden');
}

document.getElementById('updateInstituteBtn').addEventListener('click', async () => {
    const instId = document.getElementById('editInstId').value;
    const name = document.getElementById('editName').value.trim();
    const type = document.getElementById('editType').value.trim();
    const expiryRaw = document.getElementById('editExpiryDate').value;

    if (!name || !type) {
        document.getElementById('editModalAlert').textContent = 'Please fill in required fields.';
        document.getElementById('editModalAlert').className = 'alert alert-error';
        document.getElementById('editModalAlert').classList.remove('hidden');
        return;
    }

    let expiryDate = null;
    if (expiryRaw) {
        expiryDate = new Date(expiryRaw);
    }

    const btn = document.getElementById('updateInstituteBtn');
    btn.disabled = true;
    btn.querySelector('.btn-text').classList.add('hidden');
    btn.querySelector('.btn-spinner').classList.remove('hidden');

    try {
        await updateDoc(doc(db, "institutes", instId), {
            name: name,
            instituteName: name,
            type: type,
            instituteType: type,
            expiryDate: expiryDate
        });
        showToast("Institute updated successfully!");
        hideEditModal();
    } catch (err) {
        showToast(`Failed to update institute: ${err.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.querySelector('.btn-text').classList.remove('hidden');
        btn.querySelector('.btn-spinner').classList.add('hidden');
    }
});

async function deleteInstitute(e) {
    const instId = e.target.getAttribute('data-id');
    const confirmed = await window.customConfirm("Are you sure you want to delete this institute? This action cannot be undone.");
    if (!confirmed) return;

    try {
        await deleteDoc(doc(db, "institutes", instId));
        showToast("Institute deleted successfully.");
    } catch (err) {
        showToast(`Failed to delete institute: ${err.message}`, 'error');
    }
}

// ─────────────────────────────────────────────
// Load & Display Pending Registrations
// ─────────────────────────────────────────────
function loadPendingAdmins() {
    const grid = document.getElementById('pendingGrid');
    const loader = document.getElementById('pendingLoader');
    const badge = document.getElementById('pendingBadge');
    loader.classList.remove('hidden');

    const q = query(collection(db, "teachers"), where("status", "==", "pending"));

    onSnapshot(q, (snapshot) => {
        grid.innerHTML = '';
        loader.classList.add('hidden');

        const count = snapshot.size;
        if (count > 0) {
            badge.textContent = count;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }

        if (snapshot.empty) {
            grid.innerHTML = `
                <div class="empty-state" style="margin-top:2rem;">
                    <div class="empty-state-icon">✅</div>
                    <h3>All Clear!</h3>
                    <p>No pending registrations at this time.</p>
                </div>
            `;
            return;
        }

        let tableRows = '';
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const uid = docSnap.id;
            const createdAt = data.createdAt?.toDate?.() || new Date();
            const dateStr = createdAt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

            tableRows += `
                <tr>
                    <td>
                        <div class="table-teacher-name">
                            <div class="table-avatar">${escapeHTML(data.fullName ? data.fullName[0].toUpperCase() : 'T')}</div>
                            <span>${escapeHTML(data.fullName || '—')}</span>
                        </div>
                    </td>
                    <td><a href="mailto:${escapeHTML(data.email)}" style="color: var(--primary-color); font-weight: 600;">${escapeHTML(data.email)}</a></td>
                    <td>${escapeHTML(data.phone || '—')}</td>
                    <td>${escapeHTML(data.place || '—')}</td>
                    <td>${dateStr}</td>
                    <td>
                        <span class="badge" style="background:#fef3c7; color:#d97706; border:1px solid #fde68a; font-size:0.7rem;">Pending</span>
                    </td>
                    <td style="text-align: right;">
                        <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                            <button class="btn btn-primary btn-sm approve-btn" data-uid="${uid}" data-email="${escapeHTML(data.email)}" style="min-height: 36px; padding: 0.25rem 0.75rem;">
                                ✅ Approve
                            </button>
                            <button class="btn btn-danger btn-sm reject-btn" data-uid="${uid}" style="min-height: 36px; padding: 0.25rem 0.75rem;">
                                ❌ Reject
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });

        grid.innerHTML = `
            <div class="table-responsive">
                <table class="premium-table">
                    <thead>
                        <tr>
                            <th>Teacher Name</th>
                            <th>Email Address</th>
                            <th>Phone Number</th>
                            <th>Place / Location</th>
                            <th>Registration Date</th>
                            <th>Status</th>
                            <th style="text-align: right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRows}
                    </tbody>
                </table>
            </div>
        `;

        document.querySelectorAll('.approve-btn').forEach(btn => {
            btn.addEventListener('click', openApproveModal);
        });
        document.querySelectorAll('.reject-btn').forEach(btn => {
            btn.addEventListener('click', rejectAdmin);
        });

    }, (error) => {
        console.error("Error loading pending admins:", error);
        loader.classList.add('hidden');
        showToast("Failed to load pending registrations.", "error");
    });
}

// ─────────────────────────────────────────────
// Approve Modal Dynamic Expiry Calculation
// ─────────────────────────────────────────────
function updateExpiryPreview() {
    const durationSelect = document.getElementById('approvePlanDuration');
    const previewEl = document.getElementById('approveExpiryPreview');
    if (!durationSelect || !previewEl) return;

    const days = parseInt(durationSelect.value) || 30;
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + days);

    const formattedDate = expiry.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    previewEl.textContent = `📅 Expires on: ${formattedDate}`;
}

const durationDropdown = document.getElementById('approvePlanDuration');
if (durationDropdown) {
    durationDropdown.addEventListener('change', updateExpiryPreview);
}

// ─────────────────────────────────────────────
// Approve Modal
// ─────────────────────────────────────────────
const approveModal = document.getElementById('approveModal');

function openApproveModal(e) {
    const uid = e.target.getAttribute('data-uid');
    const email = e.target.getAttribute('data-email');

    document.getElementById('approveUid').value = uid;
    document.getElementById('approveEmail').textContent = email;

    // Reset inputs
    const nameInput = document.getElementById('approveInstName');
    const typeSelect = document.getElementById('approveInstType');
    const durationSelect = document.getElementById('approvePlanDuration');

    if (nameInput) nameInput.value = '';
    if (typeSelect) typeSelect.value = '';
    if (durationSelect) durationSelect.value = '365';

    updateExpiryPreview();
    approveModal.classList.remove('hidden');
}

document.getElementById('closeApproveModalBtn').addEventListener('click', () => approveModal.classList.add('hidden'));
document.getElementById('cancelApproveBtn').addEventListener('click', () => approveModal.classList.add('hidden'));

document.getElementById('confirmApproveBtn').addEventListener('click', async () => {
    const uid = document.getElementById('approveUid').value;
    const email = document.getElementById('approveEmail').textContent;
    const instituteName = document.getElementById('approveInstName').value.trim();
    const instituteType = document.getElementById('approveInstType').value;
    const durationDays = parseInt(document.getElementById('approvePlanDuration').value) || 365;

    if (!instituteName) {
        showToast("Please enter an Institute Name.", "error");
        return;
    }

    if (!instituteType) {
        showToast("Please select an Institute Type.", "error");
        return;
    }

    const btn = document.getElementById('confirmApproveBtn');
    const btnText = btn.querySelector('.btn-text');
    const spinner = btn.querySelector('.btn-spinner');

    btn.disabled = true;
    if (btnText) btnText.classList.add('hidden');
    if (spinner) spinner.classList.remove('hidden');

    try {
        // 1. Fetch teacher registration details
        const teacherRef = doc(db, "teachers", uid);
        const teacherSnap = await getDoc(teacherRef);
        if (!teacherSnap.exists()) {
            throw new Error("Teacher registration record not found in FireStore.");
        }
        const teacherData = teacherSnap.data();

        // 2. Generate Expiry Date
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + durationDays);

        // 3. Create institute
        const instRef = await addDoc(collection(db, "institutes"), {
            instituteName: instituteName,
            instituteType: instituteType,
            teacherName: teacherData.fullName || '—',
            teacherEmail: teacherData.email || email,
            teacherPhone: teacherData.phone || '—',
            teacherPlace: teacherData.place || '—',
            createdAt: teacherData.createdAt || serverTimestamp(),
            approvedAt: serverTimestamp(),
            expiryDate: expiryDate,
            status: "active"
        });
        const instituteId = instRef.id;

        // 4. Create active user profile in users
        await setDoc(doc(db, "users", uid), {
            email: email,
            role: "admin",
            instituteId: instituteId,
            createdAt: serverTimestamp()
        });

        // 5. Update pending teachers status (remove pending state)
        await updateDoc(teacherRef, {
            status: "approved",
            approvedAt: serverTimestamp(),
            instituteId: instituteId,
            instituteName: instituteName
        });

        approveModal.classList.add('hidden');
        showToast("✅ Institute created and teacher approved successfully!");
    } catch (error) {
        console.error("Approval Error:", error);
        showToast("Failed to approve and create: " + error.message, "error");
    } finally {
        btn.disabled = false;
        if (btnText) btnText.classList.remove('hidden');
        if (spinner) spinner.classList.add('hidden');
    }
});

async function rejectAdmin(e) {
    const uid = e.target.getAttribute('data-uid');
    const confirmed = await window.customConfirm("Are you sure you want to reject this registration? The user will NOT be able to access the system.");
    if (!confirmed) return;

    try {
        await updateDoc(doc(db, "teachers", uid), {
            status: "rejected",
            rejectedAt: serverTimestamp()
        });
        showToast("Registration rejected.", "error");
    } catch (error) {
        showToast("Failed to reject: " + error.message, "error");
    }
}

// ─────────────────────────────────────────────
// Responsive Mobile Drawer Navigation
// ─────────────────────────────────────────────
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

// Attach open and close triggers
if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openSidebarDrawer();
    });
}

if (closeSidebarBtn) {
    closeSidebarBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeSidebarDrawer();
    });
}

if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', () => {
        closeSidebarDrawer();
    });
}

// Close drawer when clicking sidebar navigation links
document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    item.addEventListener('click', () => {
        closeSidebarDrawer();
    });
});

// Close drawer on Escape key press
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar && sidebar.classList.contains('open')) {
        closeSidebarDrawer();
    }
});

// Automatically restore body scrolling and close drawer if screen size expands past desktop breakpoint
window.addEventListener('resize', () => {
    if (window.innerWidth > 1024) {
        closeSidebarDrawer();
    }
});
