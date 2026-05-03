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

    document.getElementById('sectionInstitutes').classList.toggle('hidden', !isInstitutes);
    document.getElementById('sectionPending').classList.toggle('hidden', isInstitutes);
    document.getElementById('topbarActions').innerHTML = isInstitutes
        ? `<button class="btn btn-primary" id="openAddModalBtn">+ Add Institute</button>`
        : '';
    document.getElementById('pageTitle').textContent = isInstitutes ? 'Manage Institutes' : 'Pending Registrations';

    document.getElementById('navInstitutes').classList.toggle('active', isInstitutes);
    document.getElementById('navPending').classList.toggle('active', !isInstitutes);

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
            allInstitutes.push({ id: instId, name: inst.name, ...inst });

            const card = document.createElement('div');
            card.className = 'card';
            const badgeClass = inst.status === 'active' ? 'badge-active' : 'badge-inactive';
            const statusLabel = inst.status === 'active' ? 'Active' : 'Inactive';

            const expiryDateObj = inst.expiryDate?.toDate?.();
            const expiryStr = expiryDateObj ? expiryDateObj.toLocaleDateString() : 'No Expiry';
            const expiryRawStr = expiryDateObj ? expiryDateObj.toISOString().split('T')[0] : '';

            card.innerHTML = `
                <div class="card-header">
                    <h3 class="card-title">${escapeHTML(inst.name)}</h3>
                    <span class="badge ${badgeClass}">${statusLabel}</span>
                </div>
                <div class="card-body">
                    <p class="mb-2"><strong>Type:</strong> ${escapeHTML(inst.type)}</p>
                    <p class="mb-2"><strong>Expiry:</strong> ${expiryStr}</p>
                    <p class="text-muted" style="font-size:0.75rem;">ID: ${instId}</p>
                </div>
                <div class="card-actions" style="flex-wrap: wrap; gap: 0.5rem;">
                    <button class="btn btn-secondary btn-sm edit-inst-btn" data-id="${instId}" data-all='${JSON.stringify({name: inst.name, type: inst.type, expiryDate: expiryRawStr}).replace(/'/g, "&#39;")}'>✏️ Edit</button>
                    <button class="btn btn-secondary btn-sm toggle-status-btn" data-id="${instId}" data-status="${inst.status}">
                        ${inst.status === 'active' ? '⏸ Deactivate' : '▶ Activate'}
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
    const instId = e.target.getAttribute('data-id');
    const currentStatus = e.target.getAttribute('data-status');
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    try {
        await updateDoc(doc(db, "institutes", instId), { status: newStatus });
        showToast(`Institute marked as ${newStatus}.`);
    } catch (err) {
        showToast(`Failed to update status: ${err.message}`, 'error');
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
            name,
            type,
            expiryDate
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
    if (!confirm("Are you sure you want to delete this institute? This action cannot be undone.")) return;

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

    const q = query(collection(db, "pending_admins"), where("status", "==", "pending"));

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

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const uid = docSnap.id;
            const createdAt = data.createdAt?.toDate?.() || new Date();
            const dateStr = createdAt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
            const timeStr = createdAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

            const card = document.createElement('div');
            card.className = 'pending-card';
            card.innerHTML = `
                <div class="pending-card-icon">👤</div>
                <div class="pending-card-info">
                    <div class="pending-card-email">${escapeHTML(data.email)}</div>
                    <div class="pending-card-meta">
                        <span>📅 ${dateStr}</span>
                        <span>🕐 ${timeStr}</span>
                        <span class="badge" style="background:#fef3c7; color:#d97706; border:1px solid #fde68a; font-size:0.7rem;">Pending</span>
                    </div>
                </div>
                <div class="pending-card-actions">
                    <button class="btn btn-primary btn-sm approve-btn" data-uid="${uid}" data-email="${escapeHTML(data.email)}">
                        ✅ Approve
                    </button>
                    <button class="btn btn-danger btn-sm reject-btn" data-uid="${uid}">
                        ❌ Reject
                    </button>
                </div>
            `;
            grid.appendChild(card);
        });

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
// Approve Modal
// ─────────────────────────────────────────────
const approveModal = document.getElementById('approveModal');

function openApproveModal(e) {
    const uid = e.target.getAttribute('data-uid');
    const email = e.target.getAttribute('data-email');

    document.getElementById('approveUid').value = uid;
    document.getElementById('approveEmail').textContent = email;

    // Populate institute select
    const select = document.getElementById('approveInstituteSelect');
    if (allInstitutes.length === 0) {
        select.innerHTML = '<option value="">No institutes available — create one first</option>';
    } else {
        let opts = '<option value="">— Select an Institute —</option>';
        allInstitutes.forEach(inst => {
            opts += `<option value="${inst.id}">${escapeHTML(inst.name)}</option>`;
        });
        select.innerHTML = opts;
    }

    approveModal.classList.remove('hidden');
}

document.getElementById('closeApproveModalBtn').addEventListener('click', () => approveModal.classList.add('hidden'));
document.getElementById('cancelApproveBtn').addEventListener('click', () => approveModal.classList.add('hidden'));

document.getElementById('confirmApproveBtn').addEventListener('click', async () => {
    const uid = document.getElementById('approveUid').value;
    const email = document.getElementById('approveEmail').textContent;
    const instituteId = document.getElementById('approveInstituteSelect').value;

    if (!instituteId) {
        showToast("Please select an institute to assign this teacher.", "error");
        return;
    }

    const btn = document.getElementById('confirmApproveBtn');
    const btnText = btn.querySelector('.btn-text');
    const spinner = btn.querySelector('.btn-spinner');

    btn.disabled = true;
    btnText.classList.add('hidden');
    spinner.classList.remove('hidden');

    try {
        // Create approved user profile
        await setDoc(doc(db, "users", uid), {
            email: email,
            role: "admin",
            instituteId: instituteId,
            createdAt: serverTimestamp()
        });

        // Update pending_admins status
        await updateDoc(doc(db, "pending_admins", uid), {
            status: "approved",
            approvedAt: serverTimestamp(),
            instituteId: instituteId
        });

        approveModal.classList.add('hidden');
        showToast("✅ Teacher approved and assigned successfully!");
    } catch (error) {
        console.error("Approval Error:", error);
        showToast("Failed to approve: " + error.message, "error");
    } finally {
        btn.disabled = false;
        btnText.classList.remove('hidden');
        spinner.classList.add('hidden');
    }
});

async function rejectAdmin(e) {
    const uid = e.target.getAttribute('data-uid');
    if (!confirm("Are you sure you want to reject this registration? The user will NOT be able to access the system.")) return;

    try {
        await updateDoc(doc(db, "pending_admins", uid), {
            status: "rejected",
            rejectedAt: serverTimestamp()
        });
        showToast("Registration rejected.", "error");
    } catch (error) {
        showToast("Failed to reject: " + error.message, "error");
    }
}
