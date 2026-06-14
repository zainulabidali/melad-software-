import { db, updateDashboardMetadata, invalidateTeamsCache, invalidateCategoriesCache, invalidateProgramsCache } from './firebase.js';
import {
    collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// ─────────────────────────────────────────────
// View State & Cache
// ─────────────────────────────────────────────
let localConfig = {};
let recoveryBinItems = [];
let activeResetType = null; // 'results' | 'registrations' | 'event' | 'factory'

// ─────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────
export async function initSettingsView(container, topActions) {
    if (!window.currentInstituteId) {
        container.innerHTML = '<div class="empty-state"><h3>Access Denied</h3><p>Please log in again.</p></div>';
        return;
    }

    // Clear topActions (Settings has all actions in main content cards)
    topActions.innerHTML = '';

    container.innerHTML = '<div class="loader-container"><div class="spinner"></div></div>';

    // 1. Fetch current Event config
    await loadEventConfig();

    // 2. Fetch and clean up recovery bin (Auto Purge)
    await loadAndPurgeRecoveryBin();

    // 3. Render Settings View Layout
    renderSettingsLayout(container);

    // 4. Bind Events
    bindFormEvents();
    bindDangerZoneEvents(container);
}

// ─────────────────────────────────────────────
// Load and Save Event Config Logic
// ─────────────────────────────────────────────
async function loadEventConfig() {
    const instId = window.currentInstituteId;
    try {
        const configSnap = await getDoc(doc(db, "institutes", instId, "metadata", "eventConfig"));
        if (configSnap.exists()) {
            localConfig = configSnap.data();
        } else {
            localConfig = {
                eventName: window.currentInstituteDetails?.name || '',
                eventTagline: '',
                eventDescription: '',
                eventLocation: '',
                eventVenue: '',
                eventStartDate: '',
                eventEndDate: '',
                organizerName: '',
                contactNumber: ''
            };
        }
    } catch (e) {
        console.error("Error loading event config:", e);
    }
}

async function saveEventConfig() {
    const instId = window.currentInstituteId;
    const configData = {
        eventName: document.getElementById('setEventName').value.trim(),
        eventTagline: document.getElementById('setEventTagline').value.trim(),
        eventDescription: document.getElementById('setEventDesc').value.trim(),
        eventLocation: document.getElementById('setEventLocation').value.trim(),
        eventVenue: document.getElementById('setEventVenue').value.trim(),
        eventStartDate: document.getElementById('setEventStartDate').value,
        eventEndDate: document.getElementById('setEventEndDate').value,
        organizerName: document.getElementById('setOrganizerName').value.trim(),
        contactNumber: document.getElementById('setContactNumber').value.trim(),
        updatedAt: serverTimestamp()
    };

    try {
        await setDoc(doc(db, "institutes", instId, "metadata", "eventConfig"), configData);
        localConfig = configData;
        window.currentEventDetails = configData;
        
        // Dynamic propagation: update header name instantly
        const headerEl = document.getElementById('instituteNameHeader');
        if (headerEl) {
            headerEl.textContent = configData.eventName || window.currentInstituteDetails?.name || 'Admin Portal';
        }
        
        showToast("✓ Event configuration saved successfully!");
    } catch (e) {
        console.error("Error saving event config:", e);
        showToast("❌ Failed to save changes. Permission denied.");
    }
}

// ─────────────────────────────────────────────
// Recovery Bin & Auto Purge Logic
// ─────────────────────────────────────────────
async function loadAndPurgeRecoveryBin() {
    const instId = window.currentInstituteId;
    recoveryBinItems = [];
    const now = new Date();
    try {
        const binSnap = await getDocs(collection(db, "institutes", instId, "recoveryBin"));
        const expiredIds = [];

        binSnap.forEach(d => {
            const data = d.data();
            const expiry = data.expiryTime ? new Date(data.expiryTime) : null;
            
            // Auto Purge Check: If expired, flag for Firestore deletion
            if (expiry && now.getTime() > expiry.getTime()) {
                expiredIds.push(d.id);
            } else {
                recoveryBinItems.push({ id: d.id, ...data });
            }
        });

        // Safe Auto-Purge from database
        if (expiredIds.length > 0) {
            const batch = writeBatch(db);
            expiredIds.forEach(id => {
                batch.delete(doc(db, "institutes", instId, "recoveryBin", id));
            });
            await batch.commit();
            console.log(`Auto purged ${expiredIds.length} expired recovery records.`);
        }
    } catch (e) {
        console.error("Error loading recovery bin:", e);
    }
}

// ─────────────────────────────────────────────
// Render Scaffolding HTML
// ─────────────────────────────────────────────
function renderSettingsLayout(container) {
    container.innerHTML = `
        <div class="settings-grid">
            <!-- Left: Event Information Configuration -->
            <div class="card settings-left-card">
                <div class="settings-header-section">
                    <span style="font-size:1.5rem;">⚙️</span>
                    <h3 style="margin:0; font-size:1.15rem; font-weight:800; color:#0f172a;">Event Information</h3>
                </div>
                <p style="font-size:0.75rem; color:#64748b; margin-top:0.15rem; margin-bottom:1.5rem;">Configure the public portal brand parameters and event metadata details.</p>
                
                <form id="eventSettingsForm" style="display:flex; flex-direction:column; gap:1rem;">
                    <div class="form-group-compact">
                        <label class="form-label-compact">Event Name *</label>
                        <input type="text" id="setEventName" class="form-input-compact" required placeholder="e.g. Melad Fest 2026" value="${window.escapeHTML(localConfig.eventName || '')}" />
                    </div>

                    <div class="form-group-compact">
                        <label class="form-label-compact">Event Tagline</label>
                        <input type="text" id="setEventTagline" class="form-input-compact" placeholder="e.g. Inspiring Excellence Through Competition" value="${window.escapeHTML(localConfig.eventTagline || '')}" />
                    </div>

                    <div class="form-group-compact">
                        <label class="form-label-compact">Event Description</label>
                        <textarea id="setEventDesc" class="form-input-compact" rows="3" placeholder="Enter short event profile summary or details...">${window.escapeHTML(localConfig.eventDescription || '')}</textarea>
                    </div>

                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem;">
                        <div class="form-group-compact">
                            <label class="form-label-compact">Location</label>
                            <input type="text" id="setEventLocation" class="form-input-compact" placeholder="e.g. Central Madrasa Ground" value="${window.escapeHTML(localConfig.eventLocation || '')}" />
                        </div>
                        <div class="form-group-compact">
                            <label class="form-label-compact">Venue</label>
                            <input type="text" id="setEventVenue" class="form-input-compact" placeholder="e.g. Main Stage Complex" value="${window.escapeHTML(localConfig.eventVenue || '')}" />
                        </div>
                    </div>

                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem;">
                        <div class="form-group-compact">
                            <label class="form-label-compact">Start Date</label>
                            <input type="date" id="setEventStartDate" class="form-input-compact" value="${localConfig.eventStartDate || ''}" />
                        </div>
                        <div class="form-group-compact">
                            <label class="form-label-compact">End Date</label>
                            <input type="date" id="setEventEndDate" class="form-input-compact" value="${localConfig.eventEndDate || ''}" />
                        </div>
                    </div>

                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem;">
                        <div class="form-group-compact">
                            <label class="form-label-compact">Organizer Name</label>
                            <input type="text" id="setOrganizerName" class="form-input-compact" placeholder="e.g. Madrasa Committee" value="${window.escapeHTML(localConfig.organizerName || '')}" />
                        </div>
                        <div class="form-group-compact">
                            <label class="form-label-compact">Contact Number</label>
                            <input type="text" id="setContactNumber" class="form-input-compact" placeholder="Organizer Phone" value="${window.escapeHTML(localConfig.contactNumber || '')}" />
                        </div>
                    </div>

                    <div style="display:flex; gap:0.75rem; border-top:1px solid #e2e8f0; padding-top:1rem; margin-top:0.5rem;">
                        <button type="submit" class="btn btn-primary btn-sm" style="flex:1; font-weight:700;">✓ Save Changes</button>
                        <button type="button" id="btnResetSettingsForm" class="btn btn-secondary btn-sm" style="font-weight:700;">Reset Form</button>
                    </div>
                </form>
            </div>

            <!-- Right: Danger Zone -->
            <div class="card settings-right-card danger-zone-card">
                <div class="danger-header">
                    <span style="font-size:1.5rem;">🔴</span>
                    <h3 style="margin:0; font-size:1.15rem; font-weight:800; color:#ef4444;">Danger Zone</h3>
                </div>
                <div class="danger-warning-message">
                    <strong>Warning!</strong> This action may permanently remove important data. Please proceed carefully.
                </div>

                <div class="reset-options-list">
                    <div class="reset-option-item">
                        <div class="reset-details">
                            <h4>Reset Results Only</h4>
                            <p>Deletes all Marks, Standings, and Rankings. Keeps Students, Teams, Categories, and Programs intact.</p>
                        </div>
                        <button class="btn btn-danger btn-sm btn-reset-trigger" data-type="results">Reset Results</button>
                    </div>

                    <div class="reset-option-item">
                        <div class="reset-details">
                            <h4>Reset Registrations</h4>
                            <p>Deletes Participant registrations & Program assignments. Keeps Students, Teams, Categories, and Programs.</p>
                        </div>
                        <button class="btn btn-danger btn-sm btn-reset-trigger" data-type="registrations">Reset Registrations</button>
                    </div>

                    <div class="reset-option-item">
                        <div class="reset-details">
                            <h4>Reset Event Data</h4>
                            <p>Deletes Marks, Results, and Registrations. Keeps Students, Teams, Categories, and Programs.</p>
                        </div>
                        <button class="btn btn-danger btn-sm btn-reset-trigger" data-type="event">Reset Event Data</button>
                    </div>

                    <div class="reset-option-item">
                        <div class="reset-details">
                            <h4>Factory Reset Institute</h4>
                            <p>Full purge. Deletes all Students, Teams, Categories, Programs, Results, and Registrations. Returns to clean state.</p>
                        </div>
                        <button class="btn btn-danger btn-sm btn-reset-trigger" data-type="factory">Factory Reset</button>
                    </div>

                    <div class="reset-option-item">
                        <div class="reset-details">
                            <h4>Clear Local Cache & Storage</h4>
                            <p>Clears browser local storage, session storage, and invalidates all local caches. Forces a fresh application reload.</p>
                        </div>
                        <button class="btn btn-danger btn-sm" id="btnClearLocalCache" style="background: #e2e8f0; border-color: #cbd5e1; color: #475569;">Clear Cache</button>
                    </div>
                </div>
            </div>

            <!-- Bottom: Recovery Bin -->
            <div class="card settings-bottom-card">
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #cbd5e1; padding-bottom:0.75rem; margin-bottom:1rem;">
                    <h3 style="font-size:1.05rem; font-weight:800; color:#0f172a; display:flex; align-items:center; gap:0.4rem; margin:0;">
                        🗑 Recovery Bin
                    </h3>
                    <span class="badge badge-inactive" style="font-size:0.7rem; font-weight:700;">24-Hour Expiry Protection</span>
                </div>
                
                <div class="recovery-bin-container" id="recoveryBinContainer">
                    <!-- Loaded dynamically -->
                </div>
            </div>
        </div>
    `;

    renderRecoveryBinList();
}

// ─────────────────────────────────────────────
// Render Recovery Bin List
// ─────────────────────────────────────────────
function renderRecoveryBinList() {
    const container = document.getElementById('recoveryBinContainer');
    if (!container) return;

    if (recoveryBinItems.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding:2rem 1rem; color:#64748b;">
                <span style="font-size:2.5rem; display:block; margin-bottom:0.5rem; opacity:0.5;">🗑</span>
                <h4 style="font-weight:700; color:#475569; margin:0 0 0.25rem 0;">Trash is empty</h4>
                <p style="font-size:0.8rem; margin:0;">No deleted data documents currently stored in recovery.</p>
            </div>
        `;
        return;
    }

    // Sort by deleted timestamp descending
    const sorted = [...recoveryBinItems].sort((a, b) => {
        return new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime();
    });

    const now = new Date();

    container.innerHTML = `
        <div style="overflow-x:auto;">
            <table style="width:100%; border-collapse:collapse; min-width:600px; font-size:0.85rem; color:#1e293b;">
                <thead>
                    <tr style="background:#f8fafc; border-bottom:2px solid #cbd5e1; text-align:left;">
                        <th style="padding:0.5rem; color:#475569; font-weight:700; width:120px;">Type</th>
                        <th style="padding:0.5rem; color:#475569; font-weight:700;">Name/Details</th>
                        <th style="padding:0.5rem; color:#475569; font-weight:700; width:150px;">Deleted At</th>
                        <th style="padding:0.5rem; color:#475569; font-weight:700; width:150px;">Time Remaining</th>
                        <th style="padding:0.5rem; color:#475569; font-weight:700; width:150px; text-align:center;">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${sorted.map(item => {
                        const expiry = item.expiryTime ? new Date(item.expiryTime) : null;
                        let remainingStr = "Expired";
                        if (expiry) {
                            const diff = expiry.getTime() - now.getTime();
                            if (diff > 0) {
                                const hours = Math.floor(diff / (1000 * 60 * 60));
                                const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                                remainingStr = `${hours}h ${mins}m left`;
                            }
                        }

                        // Determine label name
                        let detailName = "Doc ID: " + item.originalId;
                        if (item.type === 'student') detailName = `🎓 ${item.data?.name || 'Unnamed'} (#${item.data?.chestNumber || '—'})`;
                        else if (item.type === 'team') detailName = `👥 ${item.data?.name || 'Unnamed Team'}`;
                        else if (item.type === 'category') detailName = `🏷️ ${item.data?.name || 'Unnamed Category'}`;
                        else if (item.type === 'program') detailName = `📝 ${item.data?.programName || 'Unnamed Program'}`;
                        else if (item.type === 'result') detailName = `🏆 Result for program ID: ${item.data?.programId || '—'}`;
                        else if (item.type === 'registration') detailName = `👤 Registered student: ${item.data?.studentName || '—'}`;

                        let badgeColor = '#64748b';
                        if (item.type === 'student') badgeColor = '#6366f1';
                        else if (item.type === 'team') badgeColor = '#10b981';
                        else if (item.type === 'program') badgeColor = '#f59e0b';
                        else if (item.type === 'result') badgeColor = '#c2410c';

                        return `
                            <tr style="border-bottom:1px solid #f1f5f9; hover:background:#f8fafc;">
                                <td style="padding:0.5rem; font-weight:700;">
                                    <span style="color:white; background:${badgeColor}; padding:0.15rem 0.45rem; border-radius:4px; font-size:0.68rem; text-transform:uppercase;">${item.type}</span>
                                </td>
                                <td style="padding:0.5rem; font-weight:600; color:#334155;">${window.escapeHTML(detailName)}</td>
                                <td style="padding:0.5rem; color:#64748b;">${new Date(item.deletedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} (${new Date(item.deletedAt).toLocaleDateString()})</td>
                                <td style="padding:0.5rem; font-weight:700; color:#ea580c;">${remainingStr}</td>
                                <td style="padding:0.5rem; text-align:center;">
                                    <button class="btn btn-secondary btn-sm btn-restore-bin" data-bin-id="${item.id}" style="padding:0.25rem 0.5rem; font-size:0.75rem; min-height:28px;">Restore</button>
                                    <button class="btn btn-danger btn-sm btn-delete-bin" data-bin-id="${item.id}" style="padding:0.25rem 0.5rem; font-size:0.75rem; min-height:28px;">Purge</button>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;

    // Wire restore and purge buttons
    container.querySelectorAll('.btn-restore-bin').forEach(btn => {
        btn.onclick = (e) => triggerRestore(e.target.dataset.binId);
    });

    container.querySelectorAll('.btn-delete-bin').forEach(btn => {
        btn.onclick = (e) => triggerPurge(e.target.dataset.binId);
    });
}

// ─────────────────────────────────────────────
// Form Actions Wiring
// ─────────────────────────────────────────────
function bindFormEvents() {
    const form = document.getElementById('eventSettingsForm');
    const resetBtn = document.getElementById('btnResetSettingsForm');

    if (form) {
        form.onsubmit = async (e) => {
            e.preventDefault();
            await saveEventConfig();
        };
    }

    if (resetBtn) {
        resetBtn.onclick = async () => {
            await loadEventConfig();
            document.getElementById('setEventName').value = localConfig.eventName || '';
            document.getElementById('setEventTagline').value = localConfig.eventTagline || '';
            document.getElementById('setEventDesc').value = localConfig.eventDescription || '';
            document.getElementById('setEventLocation').value = localConfig.eventLocation || '';
            document.getElementById('setEventVenue').value = localConfig.eventVenue || '';
            document.getElementById('setEventStartDate').value = localConfig.eventStartDate || '';
            document.getElementById('setEventEndDate').value = localConfig.eventEndDate || '';
            document.getElementById('setOrganizerName').value = localConfig.organizerName || '';
            document.getElementById('setContactNumber').value = localConfig.contactNumber || '';
            showToast("Form reset to currently saved configuration!");
        };
    }
}

// ─────────────────────────────────────────────
// Danger Zone Safety Overlay Logic
// ─────────────────────────────────────────────
function bindDangerZoneEvents(container) {
    container.querySelectorAll('.btn-reset-trigger').forEach(btn => {
        btn.onclick = (e) => {
            activeResetType = e.target.dataset.type;
            openWarningModal();
        };
    });

    const btnClearLocalCache = document.getElementById('btnClearLocalCache');
    if (btnClearLocalCache) {
        btnClearLocalCache.onclick = async () => {
            const confirmed = await window.customConfirm("Are you sure you want to clear the local storage cache? This will clear all saved session data and force a fresh page reload.");
            if (!confirmed) return;
            
            try {
                localStorage.clear();
                sessionStorage.clear();
                showToast("✓ Local storage cache cleared successfully.");
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            } catch (e) {
                console.error("Failed to clear local cache:", e);
                showToast("❌ Failed to clear local cache.");
            }
        };
    }
}

function openWarningModal() {
    // Recreate dynamic Warning popup element and inject it
    let overlay = document.getElementById('settingsWarningModal');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'settingsWarningModal';
        overlay.className = 'modal-overlay settings-warning-overlay';
        document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
        <div class="modal warning-modal-container">
            <div class="modal-header warning-modal-header" style="background:#ef4444; color:white;">
                <h3 style="color:white; font-size:1.15rem; font-weight:800; display:flex; align-items:center; gap:0.5rem; margin:0;">
                    ⚠️ Confirm Destructive Action
                </h3>
                <button class="close-modal" id="btnCancelWarning" style="color:white; cursor:pointer;">&times;</button>
            </div>
            <div class="modal-body warning-modal-body" style="display:flex; flex-direction:column; gap:1.25rem; padding:1.5rem;">
                <div style="font-size:0.875rem; color:#4b5563; font-weight:500; line-height:1.5;">
                    This action may permanently remove data and cannot be easily undone. A safety backup is highly recommended before performing this.
                </div>

                <!-- Backup Recommended Panel -->
                <div class="backup-recommended-box">
                    <span style="font-size:1.5rem;">📦</span>
                    <div style="flex:1;">
                        <h4 style="margin:0; font-size:0.85rem; font-weight:700; color:#b45309;">Backup Recommended</h4>
                        <p style="margin:0.15rem 0 0 0; font-size:0.75rem; color:#d97706;">Export and download active event collections to a JSON file.</p>
                    </div>
                    <button class="btn btn-secondary btn-sm" id="btnDownloadBackup" style="background:#fffbeb; border-color:#fcd34d; color:#b45309; font-weight:700; min-height:32px; font-size:0.78rem;">Download Backup</button>
                </div>

                <div style="border-top:1px dashed #cbd5e1; padding-top:1rem; display:flex; flex-direction:column; gap:0.75rem;">
                    <!-- Continue Trigger -->
                    <div id="safetyConfirmStep" style="display:flex; flex-direction:column; gap:0.75rem;">
                        <button class="btn btn-secondary btn-sm" id="btnContinueWithoutBackup" style="font-weight:700; color:#c2410c; background:#fff7ed; border-color:#ffedd5; width:100%;">Continue Without Backup</button>
                    </div>

                    <!-- Manual confirmation section (Initially Hidden) -->
                    <div id="manualConfirmationArea" style="display:none; flex-direction:column; gap:0.6rem;">
                        <label class="form-label" style="font-weight:700; color:#374151; font-size:0.8rem; text-transform:none; letter-spacing:0; margin:0;">
                            Type <strong>DELETE</strong> or <strong>RESET</strong> below to confirm deletion:
                        </label>
                        <input type="text" id="confirmTextVal" class="form-input" placeholder="Type here..." style="min-height:36px; padding:0.5rem; font-size:0.85rem;" />
                        
                        <div style="display:flex; gap:0.5rem; margin-top:0.5rem;">
                            <button class="btn btn-danger btn-sm" id="btnFinalDestruction" disabled style="flex:1; font-weight:700; min-height:36px;">Delete Permanently</button>
                            <button class="btn btn-secondary btn-sm" id="btnCancelSafety" style="font-weight:700; min-height:36px;">Cancel</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    overlay.style.display = 'flex';

    // Hook Cancel and Trigger buttons
    document.getElementById('btnCancelWarning').onclick = () => closeWarningModal();
    document.getElementById('btnDownloadBackup').onclick = async () => {
        await executeBackup();
        transitionToManualConfirm();
    };
    document.getElementById('btnContinueWithoutBackup').onclick = () => {
        transitionToManualConfirm();
    };

    const confirmInput = document.getElementById('confirmTextVal');
    const finalBtn = document.getElementById('btnFinalDestruction');

    confirmInput.oninput = (e) => {
        const val = e.target.value.trim().toUpperCase();
        finalBtn.disabled = (val !== 'DELETE' && val !== 'RESET');
    };

    finalBtn.onclick = async () => {
        closeWarningModal();
        await runStructuredReset();
    };

    document.getElementById('btnCancelSafety').onclick = () => closeWarningModal();
}

function closeWarningModal() {
    const overlay = document.getElementById('settingsWarningModal');
    if (overlay) overlay.style.display = 'none';
    activeResetType = null;
}

function transitionToManualConfirm() {
    const stepBox = document.getElementById('safetyConfirmStep');
    if (stepBox) stepBox.style.display = 'none';

    // Hide download button too
    const recommendedBox = document.querySelector('.backup-recommended-box');
    if (recommendedBox) recommendedBox.style.opacity = '0.65';

    const manualArea = document.getElementById('manualConfirmationArea');
    if (manualArea) manualArea.style.display = 'flex';
}

// ─────────────────────────────────────────────
// Backup Downloader JSON Logic (SECTION 6)
// ─────────────────────────────────────────────
async function executeBackup() {
    const instId = window.currentInstituteId;
    showToast("Generating backup. Please wait...");

    try {
        const backupData = {
            students: [],
            teams: [],
            categories: [],
            programs: [],
            results: [],
            registrations: []
        };

        // 1. Fetch Students
        const stuSnap = await getDocs(collection(db, "institutes", instId, "students"));
        stuSnap.forEach(d => backupData.students.push({ id: d.id, ...d.data() }));

        // 2. Fetch Teams
        const teamSnap = await getDocs(collection(db, "institutes", instId, "teams"));
        teamSnap.forEach(d => backupData.teams.push({ id: d.id, ...d.data() }));

        // 3. Fetch Categories
        const catSnap = await getDocs(collection(db, "institutes", instId, "categories"));
        catSnap.forEach(d => backupData.categories.push({ id: d.id, ...d.data() }));

        // 4. Fetch Programs & nested registrations
        const progSnap = await getDocs(collection(db, "institutes", instId, "programs"));
        for (const progDoc of progSnap.docs) {
            const pData = progDoc.data();
            backupData.programs.push({ id: progDoc.id, ...pData });

            // Nest participant registrations
            const partSnap = await getDocs(collection(db, "institutes", instId, "programs", progDoc.id, "participants"));
            partSnap.forEach(partDoc => {
                backupData.registrations.push({
                    id: partDoc.id,
                    programId: progDoc.id,
                    ...partDoc.data()
                });
            });
        }

        // 5. Fetch Results
        const resSnap = await getDocs(collection(db, "institutes", instId, "results"));
        resSnap.forEach(d => backupData.results.push({ id: d.id, ...d.data() }));

        // Trigger JSON download
        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        
        const dateStr = new Date().toISOString().slice(0, 10);
        a.download = `backup_${localConfig.eventName || instId}_${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast("✓ Backup downloaded successfully!");
    } catch (e) {
        console.error("Backup creation failed:", e);
        showToast("❌ Failed to create backup.");
    }
}

// ─────────────────────────────────────────────
// Reset Process Execution
// ─────────────────────────────────────────────
async function runStructuredReset() {
    const instId = window.currentInstituteId;
    const adminEmail = window.currentEventDetails?.organizerName || 'Admin User';
    const now = new Date();
    const expiry = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 Hours

    showToast("Processing destructive reset action...");

    try {
        const binRef = collection(db, "institutes", instId, "recoveryBin");

        if (activeResetType === 'results' || activeResetType === 'event' || activeResetType === 'factory') {
            // Fetch and move Results
            const resSnap = await getDocs(collection(db, "institutes", instId, "results"));
            const batch = writeBatch(db);
            
            for (const docSnap of resSnap.docs) {
                const docId = docSnap.id;
                const docData = docSnap.data();

                // 1. Copy to Recovery Bin
                const newBinDoc = doc(binRef);
                batch.set(newBinDoc, {
                    type: 'result',
                    originalId: docId,
                    originalPath: `institutes/${instId}/results/${docId}`,
                    data: docData,
                    deletedBy: adminEmail,
                    deletedAt: now.toISOString(),
                    expiryTime: expiry.toISOString()
                });

                // 2. Delete original Result doc
                batch.delete(docSnap.ref);
            }
            await batch.commit();
        }

        if (activeResetType === 'registrations' || activeResetType === 'event' || activeResetType === 'factory') {
            // Fetch and move registrations
            const progSnap = await getDocs(collection(db, "institutes", instId, "programs"));
            
            for (const progDoc of progSnap.docs) {
                const partSnap = await getDocs(collection(db, "institutes", instId, "programs", progDoc.id, "participants"));
                const batch = writeBatch(db);

                for (const partDoc of partSnap.docs) {
                    // Copy to Recovery Bin
                    const newBinDoc = doc(binRef);
                    batch.set(newBinDoc, {
                        type: 'registration',
                        originalId: partDoc.id,
                        originalPath: `institutes/${instId}/programs/${progDoc.id}/participants/${partDoc.id}`,
                        data: partDoc.data(),
                        deletedBy: adminEmail,
                        deletedAt: now.toISOString(),
                        expiryTime: expiry.toISOString()
                    });

                    // Delete original doc
                    batch.delete(partDoc.ref);
                }

                // Reset participantCount on original Program doc
                batch.update(progDoc.ref, { participantCount: 0 });
                await batch.commit();
            }
        }

        if (activeResetType === 'factory') {
            const batch = writeBatch(db);

            // Fetch and move Students
            const stuSnap = await getDocs(collection(db, "institutes", instId, "students"));
            stuSnap.forEach(stuDoc => {
                const newBinDoc = doc(binRef);
                batch.set(newBinDoc, {
                    type: 'student',
                    originalId: stuDoc.id,
                    originalPath: `institutes/${instId}/students/${stuDoc.id}`,
                    data: stuDoc.data(),
                    deletedBy: adminEmail,
                    deletedAt: now.toISOString(),
                    expiryTime: expiry.toISOString()
                });
                batch.delete(stuDoc.ref);
            });

            // Fetch and move Teams
            const teamSnap = await getDocs(collection(db, "institutes", instId, "teams"));
            teamSnap.forEach(teamDoc => {
                const newBinDoc = doc(binRef);
                batch.set(newBinDoc, {
                    type: 'team',
                    originalId: teamDoc.id,
                    originalPath: `institutes/${instId}/teams/${teamDoc.id}`,
                    data: teamDoc.data(),
                    deletedBy: adminEmail,
                    deletedAt: now.toISOString(),
                    expiryTime: expiry.toISOString()
                });
                batch.delete(teamDoc.ref);
            });

            // Fetch and move Categories
            const catSnap = await getDocs(collection(db, "institutes", instId, "categories"));
            catSnap.forEach(catDoc => {
                const newBinDoc = doc(binRef);
                batch.set(newBinDoc, {
                    type: 'category',
                    originalId: catDoc.id,
                    originalPath: `institutes/${instId}/categories/${catDoc.id}`,
                    data: catDoc.data(),
                    deletedBy: adminEmail,
                    deletedAt: now.toISOString(),
                    expiryTime: expiry.toISOString()
                });
                batch.delete(catDoc.ref);
            });

            // Fetch and move Programs (Note: registrations already purged above)
            const progSnap = await getDocs(collection(db, "institutes", instId, "programs"));
            progSnap.forEach(progDoc => {
                const newBinDoc = doc(binRef);
                batch.set(newBinDoc, {
                    type: 'program',
                    originalId: progDoc.id,
                    originalPath: `institutes/${instId}/programs/${progDoc.id}`,
                    data: progDoc.data(),
                    deletedBy: adminEmail,
                    deletedAt: now.toISOString(),
                    expiryTime: expiry.toISOString()
                });
                batch.delete(progDoc.ref);
            });

            // Clean dashboard metadata doc
            batch.delete(doc(db, "institutes", instId, "metadata", "dashboard"));

            await batch.commit();
        }

        // Clear appropriate local storage caches
        if (activeResetType === 'factory') {
            invalidateTeamsCache(instId);
            invalidateCategoriesCache(instId);
            invalidateProgramsCache(instId);
        } else if (activeResetType === 'registrations' || activeResetType === 'event') {
            invalidateProgramsCache(instId);
        }

        // Re-calculate and write clean dashboard metadata aggregates doc
        await updateDashboardMetadata(instId);

        showToast("✓ Reset completed successfully! Files moved to Recovery Bin.");
        
        // Reload Settings View and Bin list
        await loadAndPurgeRecoveryBin();
        renderRecoveryBinList();
    } catch (e) {
        console.error("Reset operation failed:", e);
        showToast("❌ Destructive reset failed. Permission denied.");
    }
}

// ─────────────────────────────────────────────
// Restore Actions Logic (SECTION 7)
// ─────────────────────────────────────────────
async function triggerRestore(binId) {
    const instId = window.currentInstituteId;
    const item = recoveryBinItems.find(x => x.id === binId);
    if (!item) return;

    showToast("Restoring recovery document...");

    try {
        const batch = writeBatch(db);

        // 1. Recreate doc at original path
        const originalDocRef = doc(db, item.originalPath);
        batch.set(originalDocRef, item.data);

        // Increment participantCount if restoring a nested participant registration
        if (item.type === 'registration') {
            const originalPathTokens = item.originalPath.split('/');
            const progId = originalPathTokens[3]; // institutes/{instId}/programs/{progId}/participants/{partId}
            const progRef = doc(db, "institutes", instId, "programs", progId);
            
            const progSnap = await getDoc(progRef);
            if (progSnap.exists()) {
                const currentCount = progSnap.data().participantCount || 0;
                batch.update(progRef, { participantCount: currentCount + 1 });
            }
        }

        // 2. Remove from Recovery Bin collection
        batch.delete(doc(db, "institutes", instId, "recoveryBin", binId));

        await batch.commit();
        showToast("✓ Document restored successfully!");

        // Refresh List
        await loadAndPurgeRecoveryBin();
        renderRecoveryBinList();
    } catch (e) {
        console.error("Failed to restore record:", e);
        showToast("❌ Restore failed.");
    }
}

// ─────────────────────────────────────────────
// Permanent Delete Actions (Purge Bin Doc)
// ─────────────────────────────────────────────
async function triggerPurge(binId) {
    const instId = window.currentInstituteId;
    const confirmed = await window.customConfirm("Are you sure you want to permanently delete this backup document from the recovery bin? This cannot be undone.");
    if (!confirmed) return;

    showToast("Purging recovery record...");

    try {
        await deleteDoc(doc(db, "institutes", instId, "recoveryBin", binId));
        showToast("✓ Record permanently deleted.");
        
        // Refresh List
        await loadAndPurgeRecoveryBin();
        renderRecoveryBinList();
    } catch (e) {
        console.error("Failed to purge record:", e);
        showToast("❌ Purge failed.");
    }
}

// ─────────────────────────────────────────────
// Toast Notification Helper
// ─────────────────────────────────────────────
function showToast(msg) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const t = document.createElement('div');
    t.className = `toast ${msg.startsWith('✓') ? 'success' : (msg.startsWith('❌') ? 'error' : '')}`;
    t.style.position = 'relative';
    t.style.bottom = 'auto';
    t.style.right = 'auto';
    
    // Auto strip tick indicators for text string
    t.innerHTML = `
        <div style="display:flex; align-items:center; gap:0.5rem; justify-content:space-between; width:100%;">
            <span>${window.escapeHTML(msg)}</span>
            <button style="background:transparent; border:none; color:inherit; font-size:1rem; cursor:pointer;" onclick="this.parentElement.parentElement.remove()">&times;</button>
        </div>
    `;

    container.appendChild(t);
    setTimeout(() => {
        t.style.animation = 'fadeOut 0.5s forwards';
        setTimeout(() => t.remove(), 500);
    }, 4000);
}
