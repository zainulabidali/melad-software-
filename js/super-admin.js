import { app, auth, db, updateDashboardMetadata } from './firebase.js';
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
// Load & Display Institutes (State & Reactive Pipeline)
// ─────────────────────────────────────────────
let allInstitutes = [];
let currentPage = 1;
let pageSize = 10;
let searchQuery = '';
let selectedStatus = 'all';
let selectedType = 'all';
let selectedDistrict = 'all';
let currentSort = 'date_desc';
let isControlsInitialized = false;

function initInstitutesControls() {
    if (isControlsInitialized) return;
    isControlsInitialized = true;

    const searchInput = document.getElementById('instSearchInput');
    const statusFilter = document.getElementById('instStatusFilter');
    const typeFilter = document.getElementById('instTypeFilter');
    const districtFilter = document.getElementById('instDistrictFilter');
    const sortSelect = document.getElementById('instSortSelect');
    const pageSizeSelect = document.getElementById('pageSizeSelect');
    const resetBtn = document.getElementById('resetFiltersBtn');

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value.trim().toLowerCase();
            currentPage = 1;
            applyFiltersAndRender();
        });
    }

    if (statusFilter) {
        statusFilter.addEventListener('change', (e) => {
            selectedStatus = e.target.value;
            currentPage = 1;
            applyFiltersAndRender();
        });
    }

    if (typeFilter) {
        typeFilter.addEventListener('change', (e) => {
            selectedType = e.target.value;
            currentPage = 1;
            applyFiltersAndRender();
        });
    }

    if (districtFilter) {
        districtFilter.addEventListener('change', (e) => {
            selectedDistrict = e.target.value;
            currentPage = 1;
            applyFiltersAndRender();
        });
    }

    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            currentSort = e.target.value;
            applyFiltersAndRender();
        });
    }

    if (pageSizeSelect) {
        pageSizeSelect.addEventListener('change', (e) => {
            pageSize = parseInt(e.target.value) || 10;
            currentPage = 1;
            applyFiltersAndRender();
        });
    }

    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            searchQuery = '';
            selectedStatus = 'all';
            selectedType = 'all';
            selectedDistrict = 'all';
            currentSort = 'date_desc';
            currentPage = 1;

            if (searchInput) searchInput.value = '';
            if (statusFilter) statusFilter.value = 'all';
            if (typeFilter) typeFilter.value = 'all';
            if (districtFilter) districtFilter.value = 'all';
            if (sortSelect) sortSelect.value = 'date_desc';

            applyFiltersAndRender();
        });
    }

    // Header click sort handlers
    document.querySelectorAll('.inst-table-th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const sortKey = th.getAttribute('data-sort');
            if (sortKey === 'name') {
                currentSort = currentSort === 'name_asc' ? 'name_desc' : 'name_asc';
            } else if (sortKey === 'district') {
                currentSort = currentSort === 'district_asc' ? 'district_desc' : 'district_asc';
            } else if (sortKey === 'status') {
                currentSort = currentSort === 'status_asc' ? 'status_desc' : 'status_asc';
            } else if (sortKey === 'expiry') {
                currentSort = currentSort === 'expiry_asc' ? 'expiry_desc' : 'expiry_asc';
            } else if (sortKey === 'date_desc') {
                currentSort = currentSort === 'date_desc' ? 'date_asc' : 'date_desc';
            }
            if (sortSelect) sortSelect.value = currentSort;
            applyFiltersAndRender();
        });
    });

    // Modal close triggers for View Modal
    const viewModal = document.getElementById('viewModal');
    const closeViewModalBtn = document.getElementById('closeViewModalBtn');
    const closeViewModalFooterBtn = document.getElementById('closeViewModalFooterBtn');
    
    const hideViewModal = () => viewModal && viewModal.classList.add('hidden');
    if (closeViewModalBtn) closeViewModalBtn.addEventListener('click', hideViewModal);
    if (closeViewModalFooterBtn) closeViewModalFooterBtn.addEventListener('click', hideViewModal);
}

function updateDistrictFilterOptions() {
    const districtFilter = document.getElementById('instDistrictFilter');
    if (!districtFilter) return;

    const districts = new Set();
    allInstitutes.forEach(inst => {
        const place = inst.teacherPlace;
        if (place && place !== '—') {
            districts.add(place.trim());
        }
    });

    const currentVal = districtFilter.value;
    districtFilter.innerHTML = '<option value="all">All Districts</option>';
    Array.from(districts).sort().forEach(dist => {
        const opt = document.createElement('option');
        opt.value = dist;
        opt.textContent = dist;
        districtFilter.appendChild(opt);
    });

    if (Array.from(districts).includes(currentVal)) {
        districtFilter.value = currentVal;
    } else {
        districtFilter.value = 'all';
        selectedDistrict = 'all';
    }
}

function loadInstitutes() {
    initInstitutesControls();
    const loader = document.getElementById('institutesLoader');
    if (loader) loader.classList.remove('hidden');

    onSnapshot(collection(db, "institutes"), (snapshot) => {
        if (loader) loader.classList.add('hidden');
        allInstitutes = [];

        snapshot.forEach((docSnap) => {
            const inst = docSnap.data();
            const instId = docSnap.id;

            const status = inst.status || 'active';
            const expiryDateObj = inst.expiryDate?.toDate?.();
            const isExpired = expiryDateObj && (new Date().getTime() > expiryDateObj.getTime());

            // Self-heal expired institutes status in Firestore
            if (isExpired && status === 'active') {
                updateDoc(doc(db, "institutes", instId), { status: "deactivated" }).catch(err => {
                    console.error("Auto-deactivation error for expired institute:", err);
                });
            }

            allInstitutes.push({
                id: instId,
                name: inst.instituteName || inst.name || 'Unnamed Institute',
                type: inst.instituteType || inst.type || 'Madrasa',
                teacherName: inst.teacherName || '—',
                teacherPhone: inst.teacherPhone || '—',
                teacherPlace: inst.teacherPlace || inst.district || inst.address || '—',
                teacherEmail: inst.teacherEmail || '—',
                status: status,
                isExpired: isExpired,
                expiryDate: expiryDateObj,
                createdAt: inst.createdAt?.toDate?.() || inst.approvedAt?.toDate?.() || new Date(0),
                raw: inst
            });
        });

        updateDistrictFilterOptions();
        applyFiltersAndRender();
    }, (error) => {
        console.error("Error loading institutes:", error);
        if (loader) loader.classList.add('hidden');
        showToast("Failed to load institutes.", "error");
    });
}

function applyFiltersAndRender() {
    const tableBody = document.getElementById('institutesTableBody');
    const countInfo = document.getElementById('instCountInfo');
    const resetBtn = document.getElementById('resetFiltersBtn');
    const pageInfoText = document.getElementById('pageInfoText');
    const paginationControls = document.getElementById('paginationControls');

    if (!tableBody) return;

    // 1. Filter
    let filtered = allInstitutes.filter(inst => {
        // Search Filter
        if (searchQuery) {
            const q = searchQuery;
            const matchName = inst.name.toLowerCase().includes(q);
            const matchType = inst.type.toLowerCase().includes(q);
            const matchPhone = inst.teacherPhone.toLowerCase().includes(q);
            const matchEmail = inst.teacherEmail.toLowerCase().includes(q);
            const matchPlace = inst.teacherPlace.toLowerCase().includes(q);
            const matchTeacher = inst.teacherName.toLowerCase().includes(q);
            if (!matchName && !matchType && !matchPhone && !matchEmail && !matchPlace && !matchTeacher) {
                return false;
            }
        }

        // Status Filter
        if (selectedStatus !== 'all') {
            if (selectedStatus === 'expired' && !inst.isExpired) return false;
            if (selectedStatus === 'active' && (inst.status !== 'active' || inst.isExpired)) return false;
            if (selectedStatus === 'deactivated' && inst.status !== 'deactivated') return false;
        }

        // Type Filter
        if (selectedType !== 'all' && inst.type !== selectedType) return false;

        // District Filter
        if (selectedDistrict !== 'all' && inst.teacherPlace !== selectedDistrict) return false;

        return true;
    });

    // Show / Hide reset button
    const isFiltered = searchQuery || selectedStatus !== 'all' || selectedType !== 'all' || selectedDistrict !== 'all' || currentSort !== 'date_desc';
    if (resetBtn) resetBtn.classList.toggle('hidden', !isFiltered);

    // Update stats text
    if (countInfo) {
        countInfo.textContent = `Showing ${filtered.length} of ${allInstitutes.length} institutes`;
    }

    // 2. Sort
    filtered.sort((a, b) => {
        if (currentSort === 'name_asc') return a.name.localeCompare(b.name);
        if (currentSort === 'name_desc') return b.name.localeCompare(a.name);
        if (currentSort === 'district_asc') return a.teacherPlace.localeCompare(b.teacherPlace);
        if (currentSort === 'district_desc') return b.teacherPlace.localeCompare(a.teacherPlace);
        if (currentSort === 'status_asc') return a.status.localeCompare(b.status);
        if (currentSort === 'status_desc') return b.status.localeCompare(a.status);
        if (currentSort === 'date_asc') return a.createdAt - b.createdAt;
        if (currentSort === 'date_desc') return b.createdAt - a.createdAt;
        if (currentSort === 'expiry_asc') {
            const timeA = a.expiryDate ? a.expiryDate.getTime() : Infinity;
            const timeB = b.expiryDate ? b.expiryDate.getTime() : Infinity;
            return timeA - timeB;
        }
        if (currentSort === 'expiry_desc') {
            const timeA = a.expiryDate ? a.expiryDate.getTime() : 0;
            const timeB = b.expiryDate ? b.expiryDate.getTime() : 0;
            return timeB - timeA;
        }
        return 0;
    });

    // 3. Pagination calculation
    const totalPages = Math.ceil(filtered.length / pageSize) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * pageSize;
    const paginatedItems = filtered.slice(startIndex, startIndex + pageSize);

    // Render Table Rows
    tableBody.innerHTML = '';
    if (filtered.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 3rem 1rem;">
                    <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">🔍</div>
                    <h4 style="margin: 0; font-size: 1.1rem; color: #334155; font-weight: 700;">No matching institutes found</h4>
                    <p style="margin: 0.25rem 0 0 0; font-size: 0.875rem; color: #64748b;">Try adjusting your search terms or filters.</p>
                </td>
            </tr>
        `;
    } else {
        paginatedItems.forEach(inst => {
            const tr = document.createElement('tr');
            
            let badgeClass = inst.status === 'active' ? 'badge-active' : 'badge-inactive';
            let statusLabel = inst.status === 'active' ? 'Active' : 'Inactive';

            if (inst.isExpired) {
                badgeClass = 'badge-expired';
                statusLabel = 'Expired';
            }

            const expiryStr = inst.expiryDate ? inst.expiryDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'No Expiry';
            const expiryRawStr = inst.expiryDate ? inst.expiryDate.toISOString().split('T')[0] : '';
            const createdStr = inst.createdAt && inst.createdAt.getTime() > 0 ? inst.createdAt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

            tr.innerHTML = `
                <td>
                    <div>
                        <div class="inst-row-title">${escapeHTML(inst.name)}</div>
                        <div style="font-size: 0.75rem; color: #64748b; font-weight: 600; margin-top: 2px;">
                            Code: <code style="background: #f1f5f9; padding: 2px 4px; border-radius: 4px; font-family: monospace;">${escapeHTML(inst.id)}</code>
                        </div>
                    </div>
                </td>
                <td>
                    <span style="font-weight: 600; color: #334155;">📍 ${escapeHTML(inst.teacherPlace)}</span>
                </td>
                <td>
                    <span style="font-weight: 600; color: #475569;">✉️ <a href="mailto:${escapeHTML(inst.teacherEmail)}" style="color: #6366f1;">${escapeHTML(inst.teacherEmail)}</a></span>
                </td>
                <td>
                    <span style="font-weight: 600; color: #475569;">📅 ${createdStr}</span>
                </td>
                <td>
                    <span style="font-weight: 600; color: #4338ca;">📅 ${expiryStr}</span>
                </td>
                <td>
                    <span class="badge ${badgeClass}">${statusLabel}</span>
                </td>
                <td style="text-align: right;">
                    <div class="action-dropdown">
                        <button class="dropdown-trigger" aria-label="Actions">⋮</button>
                        <div class="dropdown-menu">
                            <button class="dropdown-item view-inst-btn" data-id="${inst.id}">👁️ View Details</button>
                            <button class="dropdown-item edit-inst-btn" data-id="${inst.id}" data-all='${JSON.stringify({ name: inst.name, type: inst.type, expiryDate: expiryRawStr }).replace(/'/g, "&#39;")}'>✏️ Edit Institute</button>
                            <button class="dropdown-item login-inst-btn" data-id="${inst.id}" data-name="${escapeHTML(inst.name)}">🔑 Login as Admin</button>
                            <button class="dropdown-item toggle-status-btn" data-id="${inst.id}" data-status="${inst.status}">
                                ${inst.status === 'active' ? '⏸ Deactivate' : '▶ Activate'}
                            </button>
                            <button class="dropdown-item delete-inst-btn text-danger" data-id="${inst.id}">🗑 Delete</button>
                        </div>
                    </div>
                </td>
            `;
            tableBody.appendChild(tr);
        });
    }

    // Render Pagination Controls
    if (pageInfoText) {
        pageInfoText.textContent = `Page ${currentPage} of ${totalPages}`;
    }

    if (paginationControls) {
        paginationControls.innerHTML = '';
        
        const prevBtn = document.createElement('button');
        prevBtn.className = 'page-btn';
        prevBtn.textContent = '◀';
        prevBtn.disabled = currentPage === 1;
        prevBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                applyFiltersAndRender();
            }
        });
        paginationControls.appendChild(prevBtn);

        // Max 5 page numbers
        let startPage = Math.max(1, currentPage - 2);
        let endPage = Math.min(totalPages, startPage + 4);
        if (endPage - startPage < 4) {
            startPage = Math.max(1, endPage - 4);
        }

        for (let p = startPage; p <= endPage; p++) {
            const pBtn = document.createElement('button');
            pBtn.className = `page-btn ${p === currentPage ? 'active' : ''}`;
            pBtn.textContent = p;
            pBtn.addEventListener('click', () => {
                currentPage = p;
                applyFiltersAndRender();
            });
            paginationControls.appendChild(pBtn);
        }

        const nextBtn = document.createElement('button');
        nextBtn.className = 'page-btn';
        nextBtn.textContent = '▶';
        nextBtn.disabled = currentPage === totalPages;
        nextBtn.addEventListener('click', () => {
            if (currentPage < totalPages) {
                currentPage++;
                applyFiltersAndRender();
            }
        });
        paginationControls.appendChild(nextBtn);
    }

    // Re-bind actions
    document.querySelectorAll('.dropdown-trigger').forEach(trigger => {
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const parent = e.target.closest('.action-dropdown');
            const menu = parent.querySelector('.dropdown-menu');
            
            // Close any other open dropdowns
            document.querySelectorAll('.dropdown-menu.show').forEach(m => {
                if (m !== menu) m.classList.remove('show');
            });

            menu.classList.toggle('show');
        });
    });

    document.querySelectorAll('.view-inst-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.target.closest('.dropdown-menu')?.classList.remove('show');
            const instId = e.target.closest('.view-inst-btn').getAttribute('data-id');
            openViewInstituteModal(instId);
        });
    });
    document.querySelectorAll('.edit-inst-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.target.closest('.dropdown-menu')?.classList.remove('show');
            openEditInstituteModal(e);
        });
    });
    document.querySelectorAll('.login-inst-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.target.closest('.dropdown-menu')?.classList.remove('show');
            const targetBtn = e.target.closest('.login-inst-btn');
            const instId = targetBtn.getAttribute('data-id');
            const instName = targetBtn.getAttribute('data-name');
            loginAsAdmin(instId, instName);
        });
    });
    document.querySelectorAll('.delete-inst-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.target.closest('.dropdown-menu')?.classList.remove('show');
            deleteInstitute(e);
        });
    });
    document.querySelectorAll('.toggle-status-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.target.closest('.dropdown-menu')?.classList.remove('show');
            toggleStatus(e);
        });
    });

    // Global listener for closing dropdowns when clicking outside
    if (!window.hasGlobalDropdownListener) {
        window.hasGlobalDropdownListener = true;
        window.addEventListener('click', () => {
            document.querySelectorAll('.dropdown-menu.show').forEach(menu => {
                menu.classList.remove('show');
            });
        });
    }
}

async function openViewInstituteModal(instId) {
    const inst = allInstitutes.find(item => item.id === instId);
    if (!inst) return;

    const viewModal = document.getElementById('viewModal');
    const viewBody = document.getElementById('viewModalBody');
    const quickEditBtn = document.getElementById('viewEditQuickBtn');
    if (!viewModal || !viewBody) return;

    let badgeClass = inst.status === 'active' ? 'badge-active' : 'badge-inactive';
    let statusLabel = inst.status === 'active' ? 'Active' : 'Inactive';
    if (inst.isExpired) {
        badgeClass = 'badge-expired';
        statusLabel = 'Expired';
    }

    const expiryStr = inst.expiryDate ? inst.expiryDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'No Expiry Set';
    const createdStr = inst.createdAt ? inst.createdAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
    const initial = inst.name ? inst.name[0].toUpperCase() : '🏢';

    viewBody.innerHTML = `
        <div class="view-details-container" style="display: flex; flex-direction: column; gap: 1.5rem;">
            
            <!-- Header banner -->
            <div class="details-header-card" style="display: flex; align-items: center; justify-content: space-between; gap: 1.25rem; padding: 1.25rem; background: linear-gradient(135deg, #f8fafc, #f1f5f9); border-radius: 16px; border: 1px solid #e2e8f0; margin-bottom: 0;">
                <div style="display: flex; align-items: center; gap: 1.25rem;">
                    <div class="details-avatar" style="width: 56px; height: 56px; border-radius: 16px; background: linear-gradient(135deg, #6366f1, #4f46e5); color: #ffffff; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; font-weight: 800; flex-shrink: 0; box-shadow: 0 8px 20px rgba(99, 102, 241, 0.25);">${escapeHTML(initial)}</div>
                    <div>
                        <span class="inst-type-badge" style="font-size: 0.68rem; font-weight: 800; padding: 0.15rem 0.45rem; border-radius: 6px; background: #e0e7ff; color: #4338ca; text-transform: uppercase; letter-spacing: 0.04em;">${escapeHTML(inst.type)}</span>
                        <h2 style="font-size: 1.35rem; font-weight: 800; margin: 4px 0 0 0; color: #0f172a; font-family: 'Outfit', sans-serif;">${escapeHTML(inst.name)}</h2>
                    </div>
                </div>
                <div>
                    <span class="badge ${badgeClass}" style="padding: 0.4rem 0.8rem; font-size: 0.8rem; font-weight: 700;">${statusLabel}</span>
                </div>
            </div>

            <!-- Section Cards Grid -->
            <div class="details-grid-layout" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.25rem;">
                
                <!-- Card 1: Institute Information -->
                <div class="details-section-card" style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
                    <h3 style="margin: 0; font-size: 1rem; font-weight: 800; color: #0f172a; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid #f1f5f9; padding-bottom: 0.5rem; font-family: 'Outfit', sans-serif;">
                        <span>🏫</span> Institute Information
                    </h3>
                    <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                        <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #f1f5f9; padding-bottom: 0.5rem; align-items: center;">
                            <span style="font-size: 0.75rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Name</span>
                            <span style="font-size: 0.875rem; color: #1e293b; font-weight: 700; text-align: right;">${escapeHTML(inst.name)}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #f1f5f9; padding-bottom: 0.5rem; align-items: center;">
                            <span style="font-size: 0.75rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Institute Code</span>
                            <code style="font-size: 0.8rem; color: #4338ca; font-weight: 700; background: #f5f3ff; padding: 2px 6px; border-radius: 4px; font-family: monospace;">${escapeHTML(inst.id)}</code>
                        </div>
                        <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #f1f5f9; padding-bottom: 0.5rem; align-items: center;">
                            <span style="font-size: 0.75rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Address / Location</span>
                            <span style="font-size: 0.875rem; color: #1e293b; font-weight: 700; text-align: right;">${escapeHTML(inst.teacherPlace)}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 0.75rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Type</span>
                            <span style="font-size: 0.875rem; color: #475569; font-weight: 700;">${escapeHTML(inst.type)}</span>
                        </div>
                    </div>
                </div>

                <!-- Card 2: Administrator Details -->
                <div class="details-section-card" style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
                    <h3 style="margin: 0; font-size: 1rem; font-weight: 800; color: #0f172a; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid #f1f5f9; padding-bottom: 0.5rem; font-family: 'Outfit', sans-serif;">
                        <span>👤</span> Administrator
                    </h3>
                    <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                        <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #f1f5f9; padding-bottom: 0.5rem; align-items: center;">
                            <span style="font-size: 0.75rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Admin Name</span>
                            <span style="font-size: 0.875rem; color: #1e293b; font-weight: 700; text-align: right;">${escapeHTML(inst.teacherName)}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #f1f5f9; padding-bottom: 0.5rem; align-items: center;">
                            <span style="font-size: 0.75rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Email</span>
                            <span style="font-size: 0.875rem; color: #1e293b; font-weight: 700; text-align: right;"><a href="mailto:${escapeHTML(inst.teacherEmail)}" style="color: #6366f1;">${escapeHTML(inst.teacherEmail)}</a></span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 0.75rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Phone Number</span>
                            <span style="font-size: 0.875rem; color: #1e293b; font-weight: 700; text-align: right;">${escapeHTML(inst.teacherPhone)}</span>
                        </div>
                    </div>
                </div>

                <!-- Card 3: Subscription & Plan -->
                <div class="details-section-card" style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
                    <h3 style="margin: 0; font-size: 1rem; font-weight: 800; color: #0f172a; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid #f1f5f9; padding-bottom: 0.5rem; font-family: 'Outfit', sans-serif;">
                        <span>📅</span> Subscription
                    </h3>
                    <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                        <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #f1f5f9; padding-bottom: 0.5rem; align-items: center;">
                            <span style="font-size: 0.75rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Registration Date</span>
                            <span style="font-size: 0.875rem; color: #1e293b; font-weight: 700;">${createdStr}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #f1f5f9; padding-bottom: 0.5rem; align-items: center;">
                            <span style="font-size: 0.75rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Expiry Date</span>
                            <span style="font-size: 0.875rem; color: #e11d48; font-weight: 700;">${expiryStr}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #f1f5f9; padding-bottom: 0.5rem; align-items: center;">
                            <span style="font-size: 0.75rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Status</span>
                            <span class="badge ${badgeClass}" style="font-size: 0.7rem; font-weight: 800; padding: 2px 8px; border-radius: 4px;">${statusLabel}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 0.75rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Plan Type</span>
                            <span style="font-size: 0.875rem; color: #4f46e5; font-weight: 700;">${inst.expiryDate ? 'Annual Plan' : 'Trial Plan'}</span>
                        </div>
                    </div>
                </div>

                <!-- Card 4: Statistics (Responsive counts) -->
                <div class="details-section-card" style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
                    <h3 style="margin: 0; font-size: 1rem; font-weight: 800; color: #0f172a; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid #f1f5f9; padding-bottom: 0.5rem; font-family: 'Outfit', sans-serif;">
                        <span>📊</span> Statistics
                    </h3>
                    <div id="modalStatsGrid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; text-align: center; height: 100%; align-content: center;">
                        <div style="background: #f8fafc; padding: 0.6rem; border-radius: 10px; border: 1px solid #f1f5f9; display: flex; flex-direction: column; justify-content: center; min-height: 52px;">
                            <div style="font-size: 1.15rem; font-weight: 800; color: #4f46e5; line-height: 1.1;" id="statStudents">⏳</div>
                            <div style="font-size: 0.55rem; color: #64748b; font-weight: 700; text-transform: uppercase; margin-top: 4px; letter-spacing: 0.02em;">Students</div>
                        </div>
                        <div style="background: #f8fafc; padding: 0.6rem; border-radius: 10px; border: 1px solid #f1f5f9; display: flex; flex-direction: column; justify-content: center; min-height: 52px;">
                            <div style="font-size: 1.15rem; font-weight: 800; color: #0891b2; line-height: 1.1;" id="statPrograms">⏳</div>
                            <div style="font-size: 0.55rem; color: #64748b; font-weight: 700; text-transform: uppercase; margin-top: 4px; letter-spacing: 0.02em;">Programs</div>
                        </div>
                        <div style="background: #f8fafc; padding: 0.6rem; border-radius: 10px; border: 1px solid #f1f5f9; display: flex; flex-direction: column; justify-content: center; min-height: 52px;">
                            <div style="font-size: 1.15rem; font-weight: 800; color: #059669; line-height: 1.1;" id="statJudges">⏳</div>
                            <div style="font-size: 0.55rem; color: #64748b; font-weight: 700; text-transform: uppercase; margin-top: 4px; letter-spacing: 0.02em;">Judges</div>
                        </div>
                        <div style="background: #f8fafc; padding: 0.6rem; border-radius: 10px; border: 1px solid #f1f5f9; display: flex; flex-direction: column; justify-content: center; min-height: 52px;">
                            <div style="font-size: 1.15rem; font-weight: 800; color: #d97706; line-height: 1.1;" id="statTeams">⏳</div>
                            <div style="font-size: 0.55rem; color: #64748b; font-weight: 700; text-transform: uppercase; margin-top: 4px; letter-spacing: 0.02em;">Teams</div>
                        </div>
                        <div style="background: #f8fafc; padding: 0.6rem; border-radius: 10px; border: 1px solid #f1f5f9; display: flex; flex-direction: column; justify-content: center; min-height: 52px;">
                            <div style="font-size: 1.15rem; font-weight: 800; color: #7c3aed; line-height: 1.1;" id="statCategories">⏳</div>
                            <div style="font-size: 0.55rem; color: #64748b; font-weight: 700; text-transform: uppercase; margin-top: 4px; letter-spacing: 0.02em;">Categories</div>
                        </div>
                        <div style="background: #f8fafc; padding: 0.6rem; border-radius: 10px; border: 1px solid #f1f5f9; display: flex; flex-direction: column; justify-content: center; min-height: 52px;">
                            <div style="font-size: 1.15rem; font-weight: 800; color: #e11d48; line-height: 1.1;" id="statResults">⏳</div>
                            <div style="font-size: 0.55rem; color: #64748b; font-weight: 700; text-transform: uppercase; margin-top: 4px; letter-spacing: 0.02em;">Results</div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    `;

    if (quickEditBtn) {
        quickEditBtn.onclick = () => {
            viewModal.classList.add('hidden');
            const expiryRawStr = inst.expiryDate ? inst.expiryDate.toISOString().split('T')[0] : '';
            openEditInstituteModal({
                target: {
                    closest: () => null,
                    getAttribute: (attr) => {
                        if (attr === 'data-id') return inst.id;
                        if (attr === 'data-all') return JSON.stringify({ name: inst.name, type: inst.type, expiryDate: expiryRawStr });
                        return null;
                    }
                }
            });
        };
    }

    viewModal.classList.remove('hidden');

    // Fetch counts from dashboard metadata
    try {
        const metaRef = doc(db, "institutes", instId, "metadata", "dashboard");
        let metaSnap = await getDoc(metaRef);
        
        if (!metaSnap.exists()) {
            // Self-heal/compute metadata on the fly if it hasn't been created yet
            await updateDashboardMetadata(instId);
            metaSnap = await getDoc(metaRef);
        }

        if (metaSnap.exists()) {
            const meta = metaSnap.data();
            document.getElementById('statStudents').textContent = meta.studentsCount ?? 0;
            document.getElementById('statPrograms').textContent = meta.programsCount ?? 0;
            document.getElementById('statJudges').textContent = meta.judgesCount ?? 0;
            document.getElementById('statTeams').textContent = meta.teamsCount ?? 0;
            document.getElementById('statCategories').textContent = meta.categoriesCount ?? 0;
            document.getElementById('statResults').textContent = meta.publishedResultsCount ?? 0;
        } else {
            // Set fallback zero values if still unable to fetch
            document.getElementById('statStudents').textContent = '0';
            document.getElementById('statPrograms').textContent = '0';
            document.getElementById('statJudges').textContent = '0';
            document.getElementById('statTeams').textContent = '0';
            document.getElementById('statCategories').textContent = '0';
            document.getElementById('statResults').textContent = '0';
        }
    } catch (err) {
        console.error("Error fetching stats metadata:", err);
        // Set fallback error indicator
        document.getElementById('statStudents').textContent = '?';
        document.getElementById('statPrograms').textContent = '?';
        document.getElementById('statJudges').textContent = '?';
        document.getElementById('statTeams').textContent = '?';
        document.getElementById('statCategories').textContent = '?';
        document.getElementById('statResults').textContent = '?';
    }
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

function loginAsAdmin(instId, instName) {
    sessionStorage.setItem('impersonatedInstituteId', instId);
    sessionStorage.setItem('impersonatedInstituteName', instName);
    sessionStorage.setItem('superAdminImpersonating', 'true');
    showToast(`🔑 Switching to ${instName}...`);
    setTimeout(() => {
        window.location.href = './admin-dashboard.html';
    }, 800);
}

// ─────────────────────────────────────────────
// Edit & Delete Institute
// ─────────────────────────────────────────────
const editModal = document.getElementById('editModal');
const hideEditModal = () => editModal.classList.add('hidden');
document.getElementById('closeEditModalBtn').addEventListener('click', hideEditModal);
document.getElementById('cancelEditModalBtn').addEventListener('click', hideEditModal);

function openEditInstituteModal(e) {
    const btn = (e.target.closest && e.target.closest('.edit-inst-btn')) || e.target;
    const instId = btn.getAttribute('data-id');
    const data = JSON.parse(btn.getAttribute('data-all'));

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
    const btn = (e.target.closest && e.target.closest('.delete-inst-btn')) || e.target;
    const instId = btn.getAttribute('data-id');
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
