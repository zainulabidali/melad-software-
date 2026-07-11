import { db, updateDashboardMetadata, invalidateTeamsCache, invalidateCategoriesCache, invalidateProgramsCache, getCachedCategories, getCachedPointsConfig, recalculateAllResultsPoints, invalidatePointsConfigCache } from './firebase.js';
import {
    collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// ─────────────────────────────────────────────
// View State & Cache
// ─────────────────────────────────────────────
let localConfig = {};
let recoveryBinItems = [];
let activeResetType = null; // 'results' | 'registrations' | 'event' | 'factory'
let selectedLogoBase64 = null;
let isLogoRemoved = false;
let localCategories = [];

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

    // Fetch Categories
    try {
        localCategories = await getCachedCategories(window.currentInstituteId) || [];
    } catch(e) {
        console.error("Error loading categories in settings init:", e);
    }

    // 1. Fetch current Event config
    await loadEventConfig();

    // 2. Render Settings View Layout
    renderSettingsLayout(container);

    // 3. Bind Events
    bindFormEvents();
}

// ─────────────────────────────────────────────
// Load and Save Event Config Logic
// ─────────────────────────────────────────────
async function loadEventConfig() {
    const instId = window.currentInstituteId;
    selectedLogoBase64 = null;
    isLogoRemoved = false;
    try {
        const configSnap = await getDoc(doc(db, "institutes", instId, "metadata", "eventConfig"));
        if (configSnap.exists()) {
            localConfig = configSnap.data();
        } else {
            localConfig = {
                eventName: window.currentInstituteDetails?.name || '',
                madrasaName: window.currentInstituteDetails?.name || '',
                eventTagline: '',
                eventLogo: null,
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

    let logoValue = localConfig.eventLogo || null;
    if (isLogoRemoved) {
        logoValue = null;
    } else if (selectedLogoBase64) {
        logoValue = selectedLogoBase64;
    }

    const configData = {
        eventName: document.getElementById('setEventName').value.trim(),
        madrasaName: document.getElementById('setMadrasaName').value.trim(),
        eventTagline: document.getElementById('setEventTagline').value.trim(),
        eventLogo: logoValue,
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
        selectedLogoBase64 = null;
        isLogoRemoved = false;
        window.currentEventDetails = configData;
        
        // Update UI state buttons
        const btnRemoveLogo = document.getElementById('btnRemoveLogo');
        const btnUploadLogo = document.getElementById('btnUploadLogo');
        if (btnRemoveLogo && btnUploadLogo) {
            btnRemoveLogo.style.display = configData.eventLogo ? 'inline-block' : 'none';
            btnUploadLogo.textContent = configData.eventLogo ? 'Replace Logo' : 'Upload PNG Logo';
        }

        // Dynamic propagation: update header name instantly
        const headerEl = document.getElementById('instituteNameHeader');
        if (headerEl) {
            const evName = configData.eventName || window.currentInstituteDetails?.name || 'Admin Portal';
            const madName = configData.madrasaName || '';
            headerEl.innerHTML = `
                <div style="font-size:1.1rem; font-weight:800; color:#ffffff; line-height:1.2;">${window.escapeHTML(evName)}</div>
                ${madName ? `<div style="font-size:0.75rem; font-weight:600; color:rgba(255,255,255,0.7); margin-top:2px;">${window.escapeHTML(madName)}</div>` : ''}
            `;
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
            
            // Auto Purge Check: If expired or is a student recovery document, flag for Firestore deletion
            if ((expiry && now.getTime() > expiry.getTime()) || data.type === 'student') {
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
            <!-- Event Information Card (Spans full width) -->
            <div class="card settings-bottom-card" style="margin-top: 0;">
                <div class="settings-header-section" style="display:flex; align-items:center; gap:0.5rem; margin-bottom:1rem; border-bottom:1px solid #cbd5e1; padding-bottom:0.75rem;">
                    <span style="font-size:1.5rem;">⚙️</span>
                    <h3 style="margin:0; font-size:1.15rem; font-weight:800; color:#0f172a;">Event Information</h3>
                </div>
                <p style="font-size:0.75rem; color:#64748b; margin-top:-0.5rem; margin-bottom:1.5rem;">Configure the public portal brand parameters and event metadata details.</p>
                
                <form id="eventSettingsForm" style="display:flex; flex-direction:column; gap:1rem;">
                    <div class="form-group-compact">
                        <label class="form-label-compact">Event Name *</label>
                        <input type="text" id="setEventName" class="form-input-compact" required placeholder="e.g. I love Madeena " value="${window.escapeHTML(localConfig.eventName || '')}" />
                    </div>

                    <div class="form-group-compact">
                        <label class="form-label-compact">Madrasa Name *</label>
                        <input type="text" id="setMadrasaName" class="form-input-compact" required placeholder="e.g. FRM CHEROOR KOTTA MADRASA" value="${window.escapeHTML(localConfig.madrasaName || window.currentInstituteDetails?.name || '')}" />
                    </div>

                    <div class="form-group-compact">
                        <label class="form-label-compact">Event Tagline</label>
                        <input type="text" id="setEventTagline" class="form-input-compact" placeholder="e.g. Inspiring Excellence Through Competition" value="${window.escapeHTML(localConfig.eventTagline || '')}" />
                    </div>

                    <div class="form-group-compact">
                        <label class="form-label-compact">Event Logo (PNG format, transparent background preferred, max 2MB)</label>
                        <div style="display:flex; align-items:center; gap:1rem; margin-top:0.35rem; background:#f8fafc; padding:0.75rem; border:1px dashed #cbd5e1; border-radius:8px;">
                            <div id="eventLogoPreviewContainer" style="width:70px; height:70px; border-radius:8px; border:1px solid #cbd5e1; background:#ffffff; display:flex; align-items:center; justify-content:center; overflow:hidden; position:relative; flex-shrink:0;">
                                ${localConfig.eventLogo ? `<img id="eventLogoPreviewImg" src="${localConfig.eventLogo}" style="max-width:100%; max-height:100%; object-fit:contain;" />` : `<span id="eventLogoPlaceholder" style="font-size:0.7rem; color:#94a3b8; text-align:center; padding:2px;">No Logo</span>`}
                            </div>
                            <div style="display:flex; flex-direction:column; gap:0.4rem; flex:1;">
                                <input type="file" id="setEventLogo" accept="image/png" style="display:none;" />
                                <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                                    <button type="button" id="btnUploadLogo" class="btn btn-secondary btn-sm" style="font-weight:700;">${localConfig.eventLogo ? 'Replace Logo' : 'Upload PNG Logo'}</button>
                                    <button type="button" id="btnRemoveLogo" class="btn btn-danger btn-sm" style="font-weight:700; ${localConfig.eventLogo ? '' : 'display:none;'}">Remove Logo</button>
                                </div>
                                <span style="font-size:0.7rem; color:#64748b;">Accepts PNG only (max 2MB)</span>
                            </div>
                        </div>
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

            <!-- Management Settings Area -->
            <div class="settings-bottom-card" style="border: none !important; background: transparent !important; box-shadow: none !important; padding: 0 !important; margin-top: 1rem; margin-bottom: 0.25rem;">
                <h3 style="font-size:1.15rem; font-weight:800; color:#0f172a; margin:0; display:flex; align-items:center; gap:0.5rem;">
                    🛠️ Management Settings
                </h3>
                <p style="font-size:0.75rem; color:#64748b; margin:0.25rem 0 0 0;">Manage student entry limits and award-points allocation parameters.</p>
            </div>

            <!-- Card 1: Student Participation Limits -->
            <div class="card settings-left-card" style="margin-top: 0; min-height: 140px; display:flex; flex-direction:column; justify-content:space-between;">
                <div>
                    <h3 style="font-size:1rem; font-weight:800; color:#0f172a; display:flex; align-items:center; gap:0.4rem; margin:0;">
                        🎯 Student Participation Limits
                    </h3>
                    <p style="font-size:0.75rem; color:#64748b; margin-top:0.5rem; margin-bottom:1rem; line-height:1.4;">
                        Control how many programs a student can join. Customize default limits or set category and gender specific rules.
                    </p>
                </div>
                <div>
                    <button type="button" id="btnManageLimits" class="btn btn-primary btn-sm" style="font-weight:700; font-size:0.78rem; padding:0.45rem 1rem;">Manage Limits</button>
                </div>
            </div>

            <!-- Card 2: Point Management -->
            <div class="card settings-right-card" style="margin-top: 0; min-height: 140px; display:flex; flex-direction:column; justify-content:space-between;">
                <div>
                    <h3 style="font-size:1rem; font-weight:800; color:#0f172a; display:flex; align-items:center; gap:0.4rem; margin:0;">
                        🏆 Point Management
                    </h3>
                    <p style="font-size:0.75rem; color:#64748b; margin-top:0.5rem; margin-bottom:1rem; line-height:1.4;">
                        Configure points awarded for each rank and grade level. Standings & leaderboards refresh automatically.
                    </p>
                </div>
                <div>
                    <button type="button" id="btnManagePoints" class="btn btn-primary btn-sm" style="font-weight:700; font-size:0.78rem; padding:0.45rem 1rem;">Manage Points</button>
                </div>
            </div>

            <!-- Danger Zone Card (Compact, spans full width, always last) -->
            <div class="card settings-bottom-card" style="margin-top: 1rem; border: 1px solid #fee2e2; background: #fff5f5;">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
                    <div>
                        <h3 style="font-size:1.05rem; font-weight:800; color:#dc2626; display:flex; align-items:center; gap:0.4rem; margin:0;">
                            ⚠ Danger Zone
                        </h3>
                        <p style="font-size:0.75rem; color:#7f1d1d; margin:0.25rem 0 0 0;">
                            Manage reset and destructive event action purges.
                        </p>
                    </div>
                    <button type="button" id="btnOpenDangerZone" class="btn btn-danger btn-sm" style="font-weight:700; font-size:0.78rem; padding:0.45rem 1.25rem; background:#dc2626; border-color:#dc2626; color:#ffffff;">Open Danger Zone</button>
                </div>
            </div>
        </div>
    `;
}

function renderPointsManagementCardHTML() {
    return `
        <!-- Point Management Card -->
        <div class="card settings-bottom-card" style="margin-top: 0.5rem; margin-bottom: 0.5rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #cbd5e1; padding-bottom:0.75rem; margin-bottom:1rem;">
                <h3 style="font-size:1.05rem; font-weight:800; color:#0f172a; display:flex; align-items:center; gap:0.4rem; margin:0;">
                    ⚙️ Point Management
                </h3>
            </div>
            <p style="font-size:0.75rem; color:#64748b; margin-top:-0.5rem; margin-bottom:1.25rem;">
                Configure position and grade points used for program results and championship calculations.
            </p>
            <div style="display:flex; justify-content:flex-start;">
                <button type="button" id="btnManagePoints" class="btn btn-primary btn-sm" style="font-weight:700; font-size:0.78rem; padding:0.45rem 1rem;">Manage Points</button>
            </div>
        </div>
    `;
}

async function openPointManageModal() {
    const modal = document.getElementById('dynamicModal');
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');

    const modalEl = modal.querySelector('.modal');
    document.getElementById('closeDynamicModalBtn').onclick = () => {
        if (modalEl) modalEl.classList.remove('modal-large');
        modal.classList.add('hidden');
    };

    modalTitle.textContent = "⚙️ Points System Management";
    modalBody.innerHTML = `
        <div style="text-align:center;padding:3rem;">
            <span class="spinner" style="display:inline-block;width:2rem;height:2rem;border-width:3px;border-top-color:transparent;"></span>
            <p style="margin-top:1rem;color:#64748b;font-weight:600;">Loading points configuration rules...</p>
        </div>
    `;
    modal.classList.remove('hidden');

    try {
        const points = await getCachedPointsConfig(window.currentInstituteId, true);

        modalBody.innerHTML = `
            <style>
                .points-mgmt-table {
                    width: 100%;
                    border-collapse: collapse;
                    text-align: left;
                    font-size: 13px;
                }
                .points-mobile-label {
                    display: none;
                }
                @media (max-width: 600px) {
                    .points-mgmt-table, .points-mgmt-table tbody {
                        display: block !important;
                        width: 100% !important;
                    }
                    .points-mgmt-table thead {
                        display: none !important;
                    }
                    .points-mgmt-table tr {
                        display: block !important;
                        background: #ffffff !important;
                        border: 1px solid #e2e8f0 !important;
                        border-radius: 8px !important;
                        padding: 0.85rem !important;
                        margin-bottom: 0.85rem !important;
                        box-shadow: 0 1px 3px rgba(0,0,0,0.02) !important;
                    }
                    .points-mgmt-table td {
                        display: block !important;
                        padding: 0 !important;
                        border: none !important;
                    }
                    .points-mgmt-table td:first-child {
                        font-weight: 700 !important;
                        color: #1e293b !important;
                        font-size: 13.5px !important;
                        margin-bottom: 0.75rem !important;
                        border-bottom: 1px solid #f1f5f9 !important;
                        padding-bottom: 0.5rem !important;
                    }
                    .points-mgmt-table td:not(:first-child) {
                        display: inline-flex !important;
                        flex-direction: column !important;
                        align-items: center !important;
                        width: 32% !important;
                        box-sizing: border-box !important;
                        margin-top: 0.25rem !important;
                    }
                    .points-mobile-label {
                        display: block !important;
                        font-size: 11px !important;
                        font-weight: 600 !important;
                        color: #64748b !important;
                        margin-bottom: 0.25rem !important;
                        text-align: center !important;
                    }
                    .pt-input {
                        width: 100% !important;
                        max-width: 80px !important;
                    }
                }
            </style>

            <div style="padding: 1rem 1.5rem; max-height: 80vh; overflow-y: auto;">
                <p style="margin: 0 0 1.25rem 0; font-size: 0.85rem; color: #64748b; line-height: 1.5;">
                    Configure points awarded for each rank and grade level. Customize these settings per program type. Standings & dashboards will automatically refresh.
                </p>
                
                <div style="margin-bottom: 1.25rem; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background:#ffffff;">
                    <table class="points-mgmt-table">
                        <thead>
                            <tr style="background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                                <th style="padding: 0.75rem 1rem; font-weight: 700; color: #334155;">Point Rule</th>
                                <th style="padding: 0.75rem 1rem; font-weight: 700; color: #334155; text-align:center;">Individual</th>
                                <th style="padding: 0.75rem 1rem; font-weight: 700; color: #334155; text-align:center;">Group</th>
                                <th style="padding: 0.75rem 1rem; font-weight: 700; color: #334155; text-align:center;">General</th>
                            </tr>
                        </thead>
                        <tbody>
                            <!-- Ranks -->
                            <tr style="border-bottom: 1px solid #f1f5f9;">
                                <td style="padding: 0.75rem 1rem; font-weight: 600; color: #475569;">🥇 1st Place Points</td>
                                <td style="padding: 0.5rem 1rem; text-align:center;">
                                    <span class="points-mobile-label">Individual</span>
                                    <input type="number" min="0" class="form-input pt-input" id="pt_ind_first" value="${points.individual?.first ?? 10}" style="width:75px; text-align:center; padding:0.35rem;" />
                                </td>
                                <td style="padding: 0.5rem 1rem; text-align:center;">
                                    <span class="points-mobile-label">Group</span>
                                    <input type="number" min="0" class="form-input pt-input" id="pt_grp_first" value="${points.group?.first ?? 10}" style="width:75px; text-align:center; padding:0.35rem;" />
                                </td>
                                <td style="padding: 0.5rem 1rem; text-align:center;">
                                    <span class="points-mobile-label">General</span>
                                    <input type="number" min="0" class="form-input pt-input" id="pt_gen_first" value="${points.general?.first ?? 10}" style="width:75px; text-align:center; padding:0.35rem;" />
                                </td>
                            </tr>
                            <tr style="border-bottom: 1px solid #f1f5f9;">
                                <td style="padding: 0.75rem 1rem; font-weight: 600; color: #475569;">🥈 2nd Place Points</td>
                                <td style="padding: 0.5rem 1rem; text-align:center;">
                                    <span class="points-mobile-label">Individual</span>
                                    <input type="number" min="0" class="form-input pt-input" id="pt_ind_second" value="${points.individual?.second ?? 8}" style="width:75px; text-align:center; padding:0.35rem;" />
                                </td>
                                <td style="padding: 0.5rem 1rem; text-align:center;">
                                    <span class="points-mobile-label">Group</span>
                                    <input type="number" min="0" class="form-input pt-input" id="pt_grp_second" value="${points.group?.second ?? 8}" style="width:75px; text-align:center; padding:0.35rem;" />
                                </td>
                                <td style="padding: 0.5rem 1rem; text-align:center;">
                                    <span class="points-mobile-label">General</span>
                                    <input type="number" min="0" class="form-input pt-input" id="pt_gen_second" value="${points.general?.second ?? 8}" style="width:75px; text-align:center; padding:0.35rem;" />
                                </td>
                            </tr>
                            <tr style="border-bottom: 2px solid #cbd5e1;">
                                <td style="padding: 0.75rem 1rem; font-weight: 600; color: #475569;">🥉 3rd Place Points</td>
                                <td style="padding: 0.5rem 1rem; text-align:center;">
                                    <span class="points-mobile-label">Individual</span>
                                    <input type="number" min="0" class="form-input pt-input" id="pt_ind_third" value="${points.individual?.third ?? 6}" style="width:75px; text-align:center; padding:0.35rem;" />
                                </td>
                                <td style="padding: 0.5rem 1rem; text-align:center;">
                                    <span class="points-mobile-label">Group</span>
                                    <input type="number" min="0" class="form-input pt-input" id="pt_grp_third" value="${points.group?.third ?? 6}" style="width:75px; text-align:center; padding:0.35rem;" />
                                </td>
                                <td style="padding: 0.5rem 1rem; text-align:center;">
                                    <span class="points-mobile-label">General</span>
                                    <input type="number" min="0" class="form-input pt-input" id="pt_gen_third" value="${points.general?.third ?? 6}" style="width:75px; text-align:center; padding:0.35rem;" />
                                </td>
                            </tr>
                            <!-- Grades -->
                            <tr style="border-bottom: 1px solid #f1f5f9;">
                                <td style="padding: 0.75rem 1rem; font-weight: 600; color: #475569;">⭐ Grade A+ Points</td>
                                <td style="padding: 0.5rem 1rem; text-align:center;">
                                    <span class="points-mobile-label">Individual</span>
                                    <input type="number" min="0" class="form-input pt-input" id="pt_ind_aplus" value="${points.individual?.gradeAPlus ?? 5}" style="width:75px; text-align:center; padding:0.35rem;" />
                                </td>
                                <td style="padding: 0.5rem 1rem; text-align:center;">
                                    <span class="points-mobile-label">Group</span>
                                    <input type="number" min="0" class="form-input pt-input" id="pt_grp_aplus" value="${points.group?.gradeAPlus ?? 5}" style="width:75px; text-align:center; padding:0.35rem;" />
                                </td>
                                <td style="padding: 0.5rem 1rem; text-align:center;">
                                    <span class="points-mobile-label">General</span>
                                    <input type="number" min="0" class="form-input pt-input" id="pt_gen_aplus" value="${points.general?.gradeAPlus ?? 5}" style="width:75px; text-align:center; padding:0.35rem;" />
                                </td>
                            </tr>
                            <tr style="border-bottom: 1px solid #f1f5f9;">
                                <td style="padding: 0.75rem 1rem; font-weight: 600; color: #475569;">⭐ Grade A Points</td>
                                <td style="padding: 0.5rem 1rem; text-align:center;">
                                    <span class="points-mobile-label">Individual</span>
                                    <input type="number" min="0" class="form-input pt-input" id="pt_ind_a" value="${points.individual?.gradeA ?? 4}" style="width:75px; text-align:center; padding:0.35rem;" />
                                </td>
                                <td style="padding: 0.5rem 1rem; text-align:center;">
                                    <span class="points-mobile-label">Group</span>
                                    <input type="number" min="0" class="form-input pt-input" id="pt_grp_a" value="${points.group?.gradeA ?? 4}" style="width:75px; text-align:center; padding:0.35rem;" />
                                </td>
                                <td style="padding: 0.5rem 1rem; text-align:center;">
                                    <span class="points-mobile-label">General</span>
                                    <input type="number" min="0" class="form-input pt-input" id="pt_gen_a" value="${points.general?.gradeA ?? 4}" style="width:75px; text-align:center; padding:0.35rem;" />
                                </td>
                            </tr>
                            <tr style="border-bottom: 1px solid #f1f5f9;">
                                <td style="padding: 0.75rem 1rem; font-weight: 600; color: #475569;">⭐ Grade B+ Points</td>
                                <td style="padding: 0.5rem 1rem; text-align:center;">
                                    <span class="points-mobile-label">Individual</span>
                                    <input type="number" min="0" class="form-input pt-input" id="pt_ind_bplus" value="${points.individual?.gradeBPlus ?? 3}" style="width:75px; text-align:center; padding:0.35rem;" />
                                </td>
                                <td style="padding: 0.5rem 1rem; text-align:center;">
                                    <span class="points-mobile-label">Group</span>
                                    <input type="number" min="0" class="form-input pt-input" id="pt_grp_bplus" value="${points.group?.gradeBPlus ?? 3}" style="width:75px; text-align:center; padding:0.35rem;" />
                                </td>
                                <td style="padding: 0.5rem 1rem; text-align:center;">
                                    <span class="points-mobile-label">General</span>
                                    <input type="number" min="0" class="form-input pt-input" id="pt_gen_bplus" value="${points.general?.gradeBPlus ?? 3}" style="width:75px; text-align:center; padding:0.35rem;" />
                                </td>
                            </tr>
                            <tr style="border-bottom: 1px solid #f1f5f9;">
                                <td style="padding: 0.75rem 1rem; font-weight: 600; color: #475569;">⭐ Grade B Points</td>
                                <td style="padding: 0.5rem 1rem; text-align:center;">
                                    <span class="points-mobile-label">Individual</span>
                                    <input type="number" min="0" class="form-input pt-input" id="pt_ind_b" value="${points.individual?.gradeB ?? 2}" style="width:75px; text-align:center; padding:0.35rem;" />
                                </td>
                                <td style="padding: 0.5rem 1rem; text-align:center;">
                                    <span class="points-mobile-label">Group</span>
                                    <input type="number" min="0" class="form-input pt-input" id="pt_grp_b" value="${points.group?.gradeB ?? 2}" style="width:75px; text-align:center; padding:0.35rem;" />
                                </td>
                                <td style="padding: 0.5rem 1rem; text-align:center;">
                                    <span class="points-mobile-label">General</span>
                                    <input type="number" min="0" class="form-input pt-input" id="pt_gen_b" value="${points.general?.gradeB ?? 2}" style="width:75px; text-align:center; padding:0.35rem;" />
                                </td>
                            </tr>
                            <tr style="border-bottom: 1px solid #e2e8f0;">
                                <td style="padding: 0.75rem 1rem; font-weight: 600; color: #475569;">⭐ Grade C Points</td>
                                <td style="padding: 0.5rem 1rem; text-align:center;">
                                    <span class="points-mobile-label">Individual</span>
                                    <input type="number" min="0" class="form-input pt-input" id="pt_ind_c" value="${points.individual?.gradeC ?? 1}" style="width:75px; text-align:center; padding:0.35rem;" />
                                </td>
                                <td style="padding: 0.5rem 1rem; text-align:center;">
                                    <span class="points-mobile-label">Group</span>
                                    <input type="number" min="0" class="form-input pt-input" id="pt_grp_c" value="${points.group?.gradeC ?? 1}" style="width:75px; text-align:center; padding:0.35rem;" />
                                </td>
                                <td style="padding: 0.5rem 1rem; text-align:center;">
                                    <span class="points-mobile-label">General</span>
                                    <input type="number" min="0" class="form-input pt-input" id="pt_gen_c" value="${points.general?.gradeC ?? 1}" style="width:75px; text-align:center; padding:0.35rem;" />
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <!-- Apply option -->
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem; margin-bottom: 1.25rem; display: flex; align-items: flex-start; gap: 0.75rem;">
                    <input type="checkbox" id="chkRecalculatePoints" style="margin-top: 0.2rem; cursor: pointer;" checked />
                    <div>
                        <label for="chkRecalculatePoints" style="font-weight: 700; font-size: 13px; color: #1e293b; cursor: pointer; display: block; margin-bottom: 0.25rem;">
                            🔄 Apply new point rules to all existing results?
                        </label>
                        <p style="margin: 0; font-size: 11px; color: #64748b; line-height: 1.4;">
                            Highly Recommended. If checked, the system will instantly recalculate points across all past program results to reflect the updated point structure. Leaderboards and standings will update immediately.
                        </p>
                    </div>
                </div>

                <!-- Actions -->
                <div style="display: flex; justify-content: flex-end; gap: 0.75rem; border-top: 1px solid #f1f5f9; padding-top: 1rem;">
                    <button class="btn btn-secondary" id="btnCancelPoints" style="padding: 0.5rem 1rem; font-size: 12px; font-weight: 700; color: #475569; background: transparent; border: 1px solid #cbd5e1; border-radius: 6px; cursor: pointer;">Cancel</button>
                    <button class="btn btn-primary" id="btnSavePoints" style="padding: 0.5rem 1.25rem; font-size: 12px; font-weight: 700; color: #ffffff; background: #4f46e5; border: none; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 0.5rem;">Save Rules</button>
                </div>
            </div>
        `;

        const btnSave = document.getElementById('btnSavePoints');
        const btnCancel = document.getElementById('btnCancelPoints');
        const chkRecalc = document.getElementById('chkRecalculatePoints');

        btnCancel.onclick = () => {
            if (modalEl) modalEl.classList.remove('modal-large');
            modal.classList.add('hidden');
        };

        btnSave.onclick = async () => {
            btnSave.disabled = true;
            btnCancel.disabled = true;
            btnSave.innerHTML = `<span class="spinner" style="width:0.8rem;height:0.8rem;border-width:2px;border-top-color:transparent;"></span> Saving...`;

            const payload = {
                individual: {
                    first: parseInt(document.getElementById('pt_ind_first').value, 10) || 0,
                    second: parseInt(document.getElementById('pt_ind_second').value, 10) || 0,
                    third: parseInt(document.getElementById('pt_ind_third').value, 10) || 0,
                    gradeAPlus: parseInt(document.getElementById('pt_ind_aplus').value, 10) || 0,
                    gradeA: parseInt(document.getElementById('pt_ind_a').value, 10) || 0,
                    gradeBPlus: parseInt(document.getElementById('pt_ind_bplus').value, 10) || 0,
                    gradeB: parseInt(document.getElementById('pt_ind_b').value, 10) || 0,
                    gradeC: parseInt(document.getElementById('pt_ind_c').value, 10) || 0
                },
                group: {
                    first: parseInt(document.getElementById('pt_grp_first').value, 10) || 0,
                    second: parseInt(document.getElementById('pt_grp_second').value, 10) || 0,
                    third: parseInt(document.getElementById('pt_grp_third').value, 10) || 0,
                    gradeAPlus: parseInt(document.getElementById('pt_grp_aplus').value, 10) || 0,
                    gradeA: parseInt(document.getElementById('pt_grp_a').value, 10) || 0,
                    gradeBPlus: parseInt(document.getElementById('pt_grp_bplus').value, 10) || 0,
                    gradeB: parseInt(document.getElementById('pt_grp_b').value, 10) || 0,
                    gradeC: parseInt(document.getElementById('pt_grp_c').value, 10) || 0
                },
                general: {
                    first: parseInt(document.getElementById('pt_gen_first').value, 10) || 0,
                    second: parseInt(document.getElementById('pt_gen_second').value, 10) || 0,
                    third: parseInt(document.getElementById('pt_gen_third').value, 10) || 0,
                    gradeAPlus: parseInt(document.getElementById('pt_gen_aplus').value, 10) || 0,
                    gradeA: parseInt(document.getElementById('pt_gen_a').value, 10) || 0,
                    gradeBPlus: parseInt(document.getElementById('pt_gen_bplus').value, 10) || 0,
                    gradeB: parseInt(document.getElementById('pt_gen_b').value, 10) || 0,
                    gradeC: parseInt(document.getElementById('pt_gen_c').value, 10) || 0
                }
            };

            try {
                const docRef = doc(db, "institutes", window.currentInstituteId, "metadata", "points");
                await setDoc(docRef, payload);

                invalidatePointsConfigCache(window.currentInstituteId);

                if (chkRecalc && chkRecalc.checked) {
                    btnSave.innerHTML = `<span class="spinner" style="width:0.8rem;height:0.8rem;border-width:2px;border-top-color:transparent;"></span> Recalculating...`;
                    const updatedCount = await recalculateAllResultsPoints(window.currentInstituteId);
                    window.showToast?.(`Saved & recalculated ${updatedCount} results successfully!`, "success");
                } else {
                    window.showToast?.("Points rules saved successfully!", "success");
                }

                // Refresh dashboard standing totals
                await updateDashboardMetadata(window.currentInstituteId);

                modal.classList.add('hidden');
            } catch (err) {
                console.error("Save points rules error:", err);
                window.showToast?.("Failed to save point rules.", "error");
                btnSave.disabled = false;
                btnCancel.disabled = false;
                btnSave.textContent = "Save Rules";
            }
        };

    } catch (e) {
        console.error("Error opening point config modal:", e);
        modalBody.innerHTML = `<div style="padding:2rem;text-align:center;color:#ef4444;">Failed to load points config. Please try again.</div>`;
    }
}

function renderLimitsCardHTML() {
    return `
        <!-- Student Participation Limits Card (Compact) -->
        <div class="card settings-bottom-card" style="margin-top: 0.5rem; margin-bottom: 0.5rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
                <div>
                    <h3 style="font-size:1.05rem; font-weight:800; color:#0f172a; display:flex; align-items:center; gap:0.4rem; margin:0;">
                        🎯 Student Participation Limits
                    </h3>
                    <p style="font-size:0.75rem; color:#64748b; margin:0.25rem 0 0 0;">
                        Control how many programs a student can join.
                    </p>
                </div>
                <button type="button" id="btnManageLimits" class="btn btn-primary btn-sm" style="font-weight:700; font-size:0.78rem; padding:0.45rem 1.25rem;">Manage Limits</button>
            </div>
        </div>
    `;
}

function openLimitsManageModal() {
    const modal = document.getElementById('dynamicModal');
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');

    const modalEl = modal.querySelector('.modal');
    if (modalEl) modalEl.classList.add('modal-large');

    modalTitle.textContent = "🎯 Student Participation Limits";
    
    const limits = localConfig.participationLimits || { enabled: false, defaults: {}, rules: [] };
    const isEnabled = limits.enabled === true;

    modalBody.innerHTML = `
        <div style="padding: 1rem 1.5rem; max-height: 80vh; overflow-y: auto;">
            <style>
                @media (max-width: 768px) {
                    .limits-responsive-grid {
                        grid-template-columns: 1fr !important;
                        gap: 1rem !important;
                    }
                }
            </style>
            
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #cbd5e1; padding-bottom:0.75rem; margin-bottom:1rem; flex-wrap:wrap; gap:0.5rem;">
                <label style="display:inline-flex; align-items:center; gap:0.5rem; cursor:pointer; font-weight:700; color:#0f172a; font-size:0.85rem; user-select:none;">
                    <input type="checkbox" id="chkEnableLimits" style="width:1.2rem; height:1.2rem; cursor:pointer;" ${isEnabled ? 'checked' : ''} />
                    Enable Student Participation Limits
                </label>
            </div>
            <p style="font-size:0.75rem; color:#64748b; margin-top:-0.5rem; margin-bottom:1.25rem;">
                Optionally control how many programs each student can participate in. Set one common limit for everyone, or add specific rules for selected categories and genders.
                <span style="display:block; margin-top:0.35rem; color:var(--pw-primary, #6366f1); font-weight:600;">
                    ℹ️ Note: If no limit is configured, participation is Unlimited (No Limit).
                </span>
            </p>

            <div id="limitsConfigSection" style="${isEnabled ? 'display:block;' : 'display:none;'}">
                <div class="limits-responsive-grid" style="display:grid; grid-template-columns: 1fr 1.2fr; gap:1.5rem; align-items:start; width:100%;">
                    <!-- Left: Default Limits form -->
                    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:1.25rem; box-shadow:inset 0 1px 2px rgba(0,0,0,0.025);">
                        <h4 style="margin:0 0 1rem 0; font-size:0.8rem; font-weight:700; color:#475569; letter-spacing:0.5px; text-transform:uppercase; border-bottom:1px solid #e2e8f0; padding-bottom:0.5rem;">
                            DEFAULT LIMITS FOR EVERYONE
                        </h4>
                        <form id="frmDefaultLimits" style="display:flex; flex-direction:column; gap:0.85rem;">
                            <div class="form-group-compact">
                                <label class="form-label-compact" style="font-weight:600; color:#475569; font-size:0.78rem;">Individual Stage Programs Limit</label>
                                <input type="number" id="defStageLimit" min="1" class="form-input-compact" placeholder="Unlimited (No Limit)" value="${limits.defaults?.stageIndividual || ''}" />
                            </div>
                            <div class="form-group-compact">
                                <label class="form-label-compact" style="font-weight:600; color:#475569; font-size:0.78rem;">Individual Off Stage Programs Limit</label>
                                <input type="number" id="defOffStageLimit" min="1" class="form-input-compact" placeholder="Unlimited (No Limit)" value="${limits.defaults?.offStageIndividual || ''}" />
                            </div>
                            <div class="form-group-compact">
                                <label class="form-label-compact" style="font-weight:600; color:#475569; font-size:0.78rem;">General Programs Limit</label>
                                <input type="number" id="defGeneralLimit" min="1" class="form-input-compact" placeholder="Unlimited (No Limit)" value="${limits.defaults?.generalPrograms || ''}" />
                            </div>
                            <div class="form-group-compact">
                                <label class="form-label-compact" style="font-weight:600; color:#475569; font-size:0.78rem;">Group Programs Limit</label>
                                <input type="number" id="defGroupLimit" min="1" class="form-input-compact" placeholder="Unlimited (No Limit)" value="${limits.defaults?.groupPrograms || ''}" />
                            </div>
                            <p style="font-size:0.7rem; color:#64748b; margin:0 0 0.25rem 0; line-height:1.3;">
                                If no limit is set, students can participate in any number of programs in this section.
                            </p>
                            <div style="display:flex; gap:0.5rem; margin-top:0.25rem;">
                                <button type="submit" class="btn btn-primary btn-sm" style="flex:1; font-weight:700; font-size:0.78rem; padding:0.45rem;">Save Limits</button>
                                <button type="button" id="btnAddSpecificRule" class="btn btn-secondary btn-sm" style="font-weight:700; font-size:0.78rem; padding:0.45rem;">+ Add Specific Rule</button>
                            </div>
                        </form>
                    </div>

                    <!-- Right: Specific Rules List -->
                    <div>
                        <h4 style="margin:0 0 1rem 0; font-size:0.8rem; font-weight:700; color:#475569; letter-spacing:0.5px; text-transform:uppercase;">
                            SPECIFIC RULES
                        </h4>
                        <div id="specificRulesListContainer" style="display:flex; flex-direction:column; gap:0.75rem; max-height:280px; overflow-y:auto; padding-right:5px;">
                            <!-- Rules rendered here -->
                        </div>
                    </div>
                </div>
            </div>
            
            <div style="display: flex; justify-content: flex-end; gap: 0.75rem; border-top: 1px solid #f1f5f9; padding-top: 1rem; margin-top: 1.5rem;">
                <button class="btn btn-secondary" id="btnCancelLimits" style="padding: 0.5rem 1.25rem; font-size: 12px; font-weight: 700; color: #475569; background: transparent; border: 1px solid #cbd5e1; border-radius: 6px; cursor: pointer;">Close</button>
            </div>
        </div>
    `;
    modal.classList.remove('hidden');

    document.getElementById('closeDynamicModalBtn').onclick = () => {
        if (modalEl) modalEl.classList.remove('modal-large');
        modal.classList.add('hidden');
    };

    const btnCancel = document.getElementById('btnCancelLimits');
    btnCancel.onclick = () => {
        if (modalEl) modalEl.classList.remove('modal-large');
        modal.classList.add('hidden');
    };

    bindLimitsModalEvents();
}

function bindLimitsModalEvents() {
    const chkEnable = document.getElementById('chkEnableLimits');
    const configSection = document.getElementById('limitsConfigSection');
    const frmDefault = document.getElementById('frmDefaultLimits');
    const btnAddRule = document.getElementById('btnAddSpecificRule');

    if (chkEnable) {
        chkEnable.onchange = async () => {
            const limits = localConfig.participationLimits || { enabled: false, defaults: {}, rules: [] };
            const enabled = chkEnable.checked;
            if (configSection) {
                configSection.style.display = enabled ? 'block' : 'none';
            }
            limits.enabled = enabled;
            await saveParticipationLimits(limits);
        };
    }

    if (frmDefault) {
        frmDefault.onsubmit = async (e) => {
            e.preventDefault();
            const limits = localConfig.participationLimits || { enabled: false, defaults: {}, rules: [] };
            
            const stageVal = document.getElementById('defStageLimit').value.trim();
            const offStageVal = document.getElementById('defOffStageLimit').value.trim();
            const generalVal = document.getElementById('defGeneralLimit').value.trim();
            const groupVal = document.getElementById('defGroupLimit').value.trim();

            limits.defaults = {
                stageIndividual: stageVal !== '' ? parseInt(stageVal, 10) : null,
                offStageIndividual: offStageVal !== '' ? parseInt(offStageVal, 10) : null,
                generalPrograms: generalVal !== '' ? parseInt(generalVal, 10) : null,
                groupPrograms: groupVal !== '' ? parseInt(groupVal, 10) : null
            };

            await saveParticipationLimits(limits);
        };
    }

    if (btnAddRule) {
        btnAddRule.onclick = () => {
            openSpecificRuleModal();
        };
    }

    renderSpecificRulesList();
}

function openDangerZoneModal() {
    const modal = document.getElementById('dynamicModal');
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');

    const modalEl = modal.querySelector('.modal');
    if (modalEl) modalEl.classList.remove('modal-large');

    modalTitle.textContent = "⚠ Danger Zone";
    modalBody.innerHTML = `
        <div style="padding: 1rem 1.5rem; max-height: 80vh; overflow-y: auto;">
            <div style="background:#fef2f2; border:1px solid #fee2e2; border-radius:8px; padding:0.75rem; color:#7f1d1d; font-size:0.8rem; font-weight:600; margin-bottom:1.25rem;">
                <strong>Warning!</strong> These actions may permanently remove important data. Please proceed carefully.
            </div>

            <div class="reset-options-list" style="display:flex; flex-direction:column; gap:1.25rem;">
                <div class="reset-option-item" style="display:flex; justify-content:space-between; align-items:center; gap:1rem; border-bottom:1px solid #f1f5f9; padding-bottom:0.75rem;">
                    <div class="reset-details" style="flex:1;">
                        <h4 style="margin:0 0 0.25rem 0; font-size:0.85rem; font-weight:700; color:#1e293b;">Reset Results Only</h4>
                        <p style="margin:0; font-size:0.75rem; color:#64748b; line-height:1.4;">Deletes all Marks, Standings, and Rankings. Keeps Students, Teams, Categories, and Programs intact.</p>
                    </div>
                    <button class="btn btn-danger btn-sm btn-reset-trigger" data-type="results" style="flex-shrink:0;">Reset Results</button>
                </div>

                <div class="reset-option-item" style="display:flex; justify-content:space-between; align-items:center; gap:1rem; border-bottom:1px solid #f1f5f9; padding-bottom:0.75rem;">
                    <div class="reset-details" style="flex:1;">
                        <h4 style="margin:0 0 0.25rem 0; font-size:0.85rem; font-weight:700; color:#1e293b;">Reset Registrations</h4>
                        <p style="margin:0; font-size:0.75rem; color:#64748b; line-height:1.4;">Deletes Participant registrations & Program assignments. Keeps Students, Teams, Categories, and Programs.</p>
                    </div>
                    <button class="btn btn-danger btn-sm btn-reset-trigger" data-type="registrations" style="flex-shrink:0;">Reset Registrations</button>
                </div>

                <div class="reset-option-item" style="display:flex; justify-content:space-between; align-items:center; gap:1rem; border-bottom:1px solid #f1f5f9; padding-bottom:0.75rem;">
                    <div class="reset-details" style="flex:1;">
                        <h4 style="margin:0 0 0.25rem 0; font-size:0.85rem; font-weight:700; color:#1e293b;">Reset Event Data</h4>
                        <p style="margin:0; font-size:0.75rem; color:#64748b; line-height:1.4;">Deletes Marks, Results, and Registrations. Keeps Students, Teams, Categories, and Programs.</p>
                    </div>
                    <button class="btn btn-danger btn-sm btn-reset-trigger" data-type="event" style="flex-shrink:0;">Reset Event Data</button>
                </div>

                <div class="reset-option-item" style="display:flex; justify-content:space-between; align-items:center; gap:1rem; border-bottom:1px solid #f1f5f9; padding-bottom:0.75rem;">
                    <div class="reset-details" style="flex:1;">
                        <h4 style="margin:0 0 0.25rem 0; font-size:0.85rem; font-weight:700; color:#1e293b;">Factory Reset Institute</h4>
                        <p style="margin:0; font-size:0.75rem; color:#64748b; line-height:1.4;">Full purge. Deletes all Students, Teams, Categories, Programs, Results, and Registrations. Returns to clean state.</p>
                    </div>
                    <button class="btn btn-danger btn-sm btn-reset-trigger" data-type="factory" style="flex-shrink:0;">Factory Reset</button>
                </div>

                <div class="reset-option-item" style="display:flex; justify-content:space-between; align-items:center; gap:1rem; padding-bottom:0.75rem;">
                    <div class="reset-details" style="flex:1;">
                        <h4 style="margin:0 0 0.25rem 0; font-size:0.85rem; font-weight:700; color:#1e293b;">Clear Local Cache & Storage</h4>
                        <p style="margin:0; font-size:0.75rem; color:#64748b; line-height:1.4;">Clears browser local storage, session storage, and invalidates all local caches. Forces a fresh application reload.</p>
                    </div>
                    <button class="btn btn-danger btn-sm" id="btnClearLocalCache" style="flex-shrink:0; background: #e2e8f0; border-color: #cbd5e1; color: #475569;">Clear Cache</button>
                </div>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 0.75rem; border-top: 1px solid #f1f5f9; padding-top: 1rem; margin-top: 1rem;">
                <button class="btn btn-secondary" id="btnCancelDangerZone" style="padding: 0.5rem 1.25rem; font-size: 12px; font-weight: 700; color: #475569; background: transparent; border: 1px solid #cbd5e1; border-radius: 6px; cursor: pointer;">Close</button>
            </div>
        </div>
    `;
    modal.classList.remove('hidden');

    document.getElementById('closeDynamicModalBtn').onclick = () => {
        if (modalEl) modalEl.classList.remove('modal-large');
        modal.classList.add('hidden');
    };

    const btnCancel = document.getElementById('btnCancelDangerZone');
    btnCancel.onclick = () => {
        if (modalEl) modalEl.classList.remove('modal-large');
        modal.classList.add('hidden');
    };

    bindDangerZoneEvents(modalBody);
}

async function saveParticipationLimits(limitsData) {
    const instId = window.currentInstituteId;
    try {
        const docRef = doc(db, "institutes", instId, "metadata", "eventConfig");
        await setDoc(docRef, {
            participationLimits: limitsData,
            updatedAt: serverTimestamp()
        }, { merge: true });
        
        localConfig.participationLimits = limitsData;
        window.currentEventDetails = localConfig;
        showToast("✓ Participation limits updated successfully!");
    } catch (e) {
        console.error("Error saving participation limits:", e);
        showToast("❌ Failed to save participation limits. Permission denied.");
    }
}

function renderSpecificRulesList() {
    const limits = localConfig.participationLimits || { enabled: false, defaults: {}, rules: [] };
    const container = document.getElementById('specificRulesListContainer');
    if (!container) return;

    const rules = limits.rules || [];
    if (rules.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding:2rem 1rem; color:#94a3b8; border:1.5px dashed #e2e8f0; border-radius:12px;">
                <span style="font-size:1.75rem; display:block; margin-bottom:0.25rem;">📝</span>
                <span style="font-size:0.78rem; font-weight:600; color:#64748b;">No specific rules added</span>
                <p style="font-size:0.72rem; margin:0.15rem 0 0 0; color:#94a3b8;">Click "+ Add Specific Rule" to set limit overrides for categories or genders.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = rules.map((rule, idx) => {
        let categoryName = "All Categories";
        if (rule.categoryId) {
            const catObj = localCategories.find(c => c.id === rule.categoryId);
            categoryName = catObj ? catObj.name : rule.categoryId;
        }

        let genderLabel = "All Genders";
        if (rule.gender === "Male") genderLabel = "Boys";
        else if (rule.gender === "Female") genderLabel = "Girls";

        const valOrDef = (val) => (val !== undefined && val !== null && val !== '') ? `<strong style="color:#0f172a;">${val}</strong>` : `<span style="color:#94a3b8; font-style:italic;">Inherited</span>`;

        return `
            <div class="specific-rule-row" style="background:#ffffff; border:1px solid #e2e8f0; border-radius:10px; padding:0.75rem 1rem; display:flex; justify-content:space-between; align-items:center; gap:0.5rem; transition:transform 0.2s, box-shadow 0.2s; box-shadow:0 1px 2px rgba(0,0,0,0.02); hover:transform:translateY(-1px); hover:box-shadow:0 3px 6px rgba(0,0,0,0.05);">
                <div style="display:flex; flex-direction:column; gap:0.2rem; flex:1;">
                    <div style="font-size:0.825rem; font-weight:700; color:#1e293b;">
                        ${window.escapeHTML(categoryName)} &middot; ${window.escapeHTML(genderLabel)}
                    </div>
                    <div style="display:flex; gap:0.75rem; font-size:0.72rem; color:#64748b; flex-wrap:wrap;">
                        <span>Stage: ${valOrDef(rule.stageIndividual)}</span>
                        <span>Off Stage: ${valOrDef(rule.offStageIndividual)}</span>
                        <span>General: ${valOrDef(rule.generalPrograms)}</span>
                        <span>Group: ${valOrDef(rule.groupPrograms)}</span>
                    </div>
                </div>
                <div style="display:flex; gap:0.35rem;">
                    <button class="btn btn-secondary btn-sm btn-edit-rule" data-index="${idx}" style="font-size:0.72rem; padding:0.25rem 0.5rem; min-height:28px;">Edit</button>
                    <button class="btn btn-danger btn-sm btn-delete-rule" data-index="${idx}" style="font-size:0.72rem; padding:0.25rem 0.5rem; min-height:28px; background:#fef2f2; border-color:#fee2e2; color:#dc2626;">Delete</button>
                </div>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.btn-edit-rule').forEach(btn => {
        btn.onclick = (e) => {
            const index = parseInt(e.target.dataset.index, 10);
            openSpecificRuleModal(index);
        };
    });

    container.querySelectorAll('.btn-delete-rule').forEach(btn => {
        btn.onclick = (e) => {
            const index = parseInt(e.target.dataset.index, 10);
            deleteSpecificRule(index);
        };
    });
}

function openSpecificRuleModal(ruleIndex = null) {
    const modalTitle = document.getElementById('dynamicModalTitle');
    const modalBody = document.getElementById('dynamicModalBody');
    const modalOverlay = document.getElementById('dynamicModal');

    const modalEl = modalOverlay.querySelector('.modal');
    if (modalEl) modalEl.classList.remove('modal-large');

    const limits = localConfig.participationLimits || { enabled: false, defaults: {}, rules: [] };
    const rules = limits.rules || [];
    const rule = (ruleIndex !== null) ? rules[ruleIndex] : {
        categoryId: "",
        gender: "",
        stageIndividual: null,
        offStageIndividual: null,
        generalPrograms: null,
        groupPrograms: null
    };

    modalTitle.textContent = (ruleIndex !== null) ? "Edit Specific Rule" : "Add Specific Rule";

    const categoryOptionsHTML = localCategories.map(cat => {
        const isSelected = rule.categoryId === cat.id ? 'selected' : '';
        return `<option value="${cat.id}" ${isSelected}>${window.escapeHTML(cat.name)}</option>`;
    }).join('');

    const hasStageCustom = rule.stageIndividual !== null && rule.stageIndividual !== undefined && rule.stageIndividual !== '';
    const hasOffStageCustom = rule.offStageIndividual !== null && rule.offStageIndividual !== undefined && rule.offStageIndividual !== '';
    const hasGeneralCustom = rule.generalPrograms !== null && rule.generalPrograms !== undefined && rule.generalPrograms !== '';
    const hasGroupCustom = rule.groupPrograms !== null && rule.groupPrograms !== undefined && rule.groupPrograms !== '';

    modalBody.innerHTML = `
        <form id="frmSpecificRule" autocomplete="off" style="display:flex; flex-direction:column; gap:1rem;">
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:0.75rem; margin-bottom:0.25rem;">
                <h4 style="margin:0 0 0.5rem 0; font-size:0.75rem; font-weight:700; color:#475569; letter-spacing:0.5px; text-transform:uppercase;">
                    APPLY THIS RULE TO
                </h4>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem;">
                    <div class="form-group-compact">
                        <label class="form-label-compact" style="font-weight:600; color:#475569;">Category</label>
                        <select id="ruleCategory" class="form-input" style="font-size:0.85rem; padding:0.55rem 0.75rem; border-radius:8px;">
                            <option value="">All Categories</option>
                            ${categoryOptionsHTML}
                        </select>
                    </div>
                    <div class="form-group-compact">
                        <label class="form-label-compact" style="font-weight:600; color:#475569;">Gender</label>
                        <select id="ruleGender" class="form-input" style="font-size:0.85rem; padding:0.55rem 0.75rem; border-radius:8px;">
                            <option value="">All Genders</option>
                            <option value="Male" ${rule.gender === 'Male' ? 'selected' : ''}>Boys</option>
                            <option value="Female" ${rule.gender === 'Female' ? 'selected' : ''}>Girls</option>
                        </select>
                    </div>
                </div>
            </div>

            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:0.75rem;">
                <h4 style="margin:0 0 0.75rem 0; font-size:0.75rem; font-weight:700; color:#475569; letter-spacing:0.5px; text-transform:uppercase; border-bottom:1px solid #e2e8f0; padding-bottom:0.25rem;">
                    LIMITS FOR MATCHING STUDENTS
                </h4>
                <p style="font-size:0.7rem; color:#64748b; margin:-0.25rem 0 0.75rem 0;">
                    Inherited limit uses the next matching rule or the default. If no limit is configured, it is Unlimited.
                </p>
                <div style="display:flex; flex-direction:column; gap:0.75rem;">
                    <!-- Individual Stage -->
                    <div class="form-group-compact" style="display:grid; grid-template-columns: 1fr 1fr; gap:0.75rem; align-items:center;">
                        <label class="form-label-compact" style="font-weight:600; color:#475569; margin:0;">Individual Stage</label>
                        <div style="display:flex; flex-direction:column; gap:0.35rem;">
                            <select id="ruleStageSelect" class="form-input" style="font-size:0.85rem; padding:0.4rem 0.6rem; border-radius:6px; min-height:34px;">
                                <option value="default" ${!hasStageCustom ? 'selected' : ''}>Use Inherited Limit</option>
                                <option value="custom" ${hasStageCustom ? 'selected' : ''}>Custom Value</option>
                            </select>
                            <input type="number" id="ruleStageInput" min="1" class="form-input" style="font-size:0.85rem; padding:0.4rem 0.6rem; border-radius:6px; min-height:34px; ${hasStageCustom ? '' : 'display:none;'}" placeholder="Enter limit (e.g. 2)" value="${hasStageCustom ? rule.stageIndividual : ''}" />
                        </div>
                    </div>

                    <!-- Individual Off Stage -->
                    <div class="form-group-compact" style="display:grid; grid-template-columns: 1fr 1fr; gap:0.75rem; align-items:center;">
                        <label class="form-label-compact" style="font-weight:600; color:#475569; margin:0;">Individual Off Stage</label>
                        <div style="display:flex; flex-direction:column; gap:0.35rem;">
                            <select id="ruleOffStageSelect" class="form-input" style="font-size:0.85rem; padding:0.4rem 0.6rem; border-radius:6px; min-height:34px;">
                                <option value="default" ${!hasOffStageCustom ? 'selected' : ''}>Use Inherited Limit</option>
                                <option value="custom" ${hasOffStageCustom ? 'selected' : ''}>Custom Value</option>
                            </select>
                            <input type="number" id="ruleOffStageInput" min="1" class="form-input" style="font-size:0.85rem; padding:0.4rem 0.6rem; border-radius:6px; min-height:34px; ${hasOffStageCustom ? '' : 'display:none;'}" placeholder="Enter limit (e.g. 2)" value="${hasOffStageCustom ? rule.offStageIndividual : ''}" />
                        </div>
                    </div>

                    <!-- General Programs -->
                    <div class="form-group-compact" style="display:grid; grid-template-columns: 1fr 1fr; gap:0.75rem; align-items:center;">
                        <label class="form-label-compact" style="font-weight:600; color:#475569; margin:0;">General Programs</label>
                        <div style="display:flex; flex-direction:column; gap:0.35rem;">
                            <select id="ruleGeneralSelect" class="form-input" style="font-size:0.85rem; padding:0.4rem 0.6rem; border-radius:6px; min-height:34px;">
                                <option value="default" ${!hasGeneralCustom ? 'selected' : ''}>Use Inherited Limit</option>
                                <option value="custom" ${hasGeneralCustom ? 'selected' : ''}>Custom Value</option>
                            </select>
                            <input type="number" id="ruleGeneralInput" min="1" class="form-input" style="font-size:0.85rem; padding:0.4rem 0.6rem; border-radius:6px; min-height:34px; ${hasGeneralCustom ? '' : 'display:none;'}" placeholder="Enter limit (e.g. 2)" value="${hasGeneralCustom ? rule.generalPrograms : ''}" />
                        </div>
                    </div>

                    <!-- Group Programs -->
                    <div class="form-group-compact" style="display:grid; grid-template-columns: 1fr 1fr; gap:0.75rem; align-items:center;">
                        <label class="form-label-compact" style="font-weight:600; color:#475569; margin:0;">Group Programs</label>
                        <div style="display:flex; flex-direction:column; gap:0.35rem;">
                            <select id="ruleGroupSelect" class="form-input" style="font-size:0.85rem; padding:0.4rem 0.6rem; border-radius:6px; min-height:34px;">
                                <option value="default" ${!hasGroupCustom ? 'selected' : ''}>Use Inherited Limit</option>
                                <option value="custom" ${hasGroupCustom ? 'selected' : ''}>Custom Value</option>
                            </select>
                            <input type="number" id="ruleGroupInput" min="1" class="form-input" style="font-size:0.85rem; padding:0.4rem 0.6rem; border-radius:6px; min-height:34px; ${hasGroupCustom ? '' : 'display:none;'}" placeholder="Enter limit (e.g. 2)" value="${hasGroupCustom ? rule.groupPrograms : ''}" />
                        </div>
                    </div>
                </div>
            </div>

            <div class="modal-actions" style="margin-top:0.5rem; display:flex; gap:0.5rem;">
                <button type="button" class="btn btn-secondary w-full" id="btnCancelRule" style="font-weight:700;">Cancel</button>
                <button type="submit" class="btn btn-primary w-full" style="font-weight:700;">Save Rule</button>
            </div>
        </form>
    `;

    modalOverlay.classList.remove('hidden');
    document.getElementById('closeDynamicModalBtn').onclick = () => openLimitsManageModal();
    document.getElementById('btnCancelRule').onclick = () => openLimitsManageModal();

    const bindToggle = (selectId, inputId) => {
        const sel = document.getElementById(selectId);
        const inp = document.getElementById(inputId);
        if (sel && inp) {
            sel.onchange = () => {
                if (sel.value === 'custom') {
                    inp.style.display = 'block';
                    inp.required = true;
                    if (!inp.value) inp.value = '1';
                } else {
                    inp.style.display = 'none';
                    inp.required = false;
                    inp.value = '';
                }
            };
        }
    };

    bindToggle('ruleStageSelect', 'ruleStageInput');
    bindToggle('ruleOffStageSelect', 'ruleOffStageInput');
    bindToggle('ruleGeneralSelect', 'ruleGeneralInput');
    bindToggle('ruleGroupSelect', 'ruleGroupInput');

    document.getElementById('frmSpecificRule').onsubmit = async (e) => {
        e.preventDefault();

        const catVal = document.getElementById('ruleCategory').value || null;
        const genVal = document.getElementById('ruleGender').value || null;

        const isDuplicate = rules.some((r, idx) => {
            if (ruleIndex !== null && idx === ruleIndex) return false;
            const catMatch = (r.categoryId || null) === catVal;
            const genMatch = (r.gender || null) === genVal;
            return catMatch && genMatch;
        });

        if (isDuplicate) {
            window.showToast ? window.showToast("❌ A rule with this exact Category & Gender scope already exists.", "error") : alert("A rule with this exact Category & Gender scope already exists.");
            return;
        }

        const getLimitVal = (selectId, inputId) => {
            const sel = document.getElementById(selectId);
            const inp = document.getElementById(inputId);
            if (sel && inp && sel.value === 'custom') {
                const val = parseInt(inp.value, 10);
                return isNaN(val) ? null : val;
            }
            return null;
        };

        const stageVal = getLimitVal('ruleStageSelect', 'ruleStageInput');
        const offStageVal = getLimitVal('ruleOffStageSelect', 'ruleOffStageInput');
        const generalVal = getLimitVal('ruleGeneralSelect', 'ruleGeneralInput');
        const groupVal = getLimitVal('ruleGroupSelect', 'ruleGroupInput');

        const newRule = {
            categoryId: catVal,
            gender: genVal,
            stageIndividual: stageVal,
            offStageIndividual: offStageVal,
            generalPrograms: generalVal,
            groupPrograms: groupVal
        };

        if (ruleIndex !== null) {
            rules[ruleIndex] = newRule;
        } else {
            rules.push(newRule);
        }

        await saveParticipationLimits({
            enabled: limits.enabled,
            defaults: limits.defaults || {},
            rules: rules
        });
        openLimitsManageModal();
    };
}

async function deleteSpecificRule(index) {
    const limits = localConfig.participationLimits || { enabled: false, defaults: {}, rules: [] };
    const rules = limits.rules || [];

    const confirmed = await window.customConfirm("Are you sure you want to delete this specific rule override?");
    if (!confirmed) return;

    rules.splice(index, 1);
    await saveParticipationLimits({
        enabled: limits.enabled,
        defaults: limits.defaults || {},
        rules: rules
    });
    renderSpecificRulesList();
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

    // Filter out student recovery bin items and sort by deleted timestamp descending
    const sorted = [...recoveryBinItems]
        .filter(item => item.type !== 'student')
        .sort((a, b) => {
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
    const logoInput = document.getElementById('setEventLogo');
    const uploadBtn = document.getElementById('btnUploadLogo');
    const removeBtn = document.getElementById('btnRemoveLogo');
    const previewContainer = document.getElementById('eventLogoPreviewContainer');

    if (uploadBtn && logoInput) {
        uploadBtn.onclick = () => logoInput.click();
    }

    if (logoInput) {
        logoInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // Validate file format (PNG only)
            if (file.type !== 'image/png' && !file.name.toLowerCase().endsWith('.png')) {
                showToast("❌ Please select a valid PNG image file.");
                logoInput.value = '';
                return;
            }

            // Validate file size (Max 2MB)
            if (file.size > 2 * 1024 * 1024) {
                showToast("❌ Logo file size must be less than 2MB.");
                logoInput.value = '';
                return;
            }

            const reader = new FileReader();
            reader.onload = (evt) => {
                selectedLogoBase64 = evt.target.result;
                isLogoRemoved = false;
                if (previewContainer) {
                    previewContainer.innerHTML = `<img id="eventLogoPreviewImg" src="${selectedLogoBase64}" style="max-width:100%; max-height:100%; object-fit:contain;" />`;
                }
                if (removeBtn) removeBtn.style.display = 'inline-block';
                if (uploadBtn) uploadBtn.textContent = 'Replace Logo';
                showToast("✓ Logo selected! Click 'Save Changes' to apply.");
            };
            reader.readAsDataURL(file);
        };
    }

    if (removeBtn) {
        removeBtn.onclick = () => {
            selectedLogoBase64 = null;
            isLogoRemoved = true;
            if (logoInput) logoInput.value = '';
            if (previewContainer) {
                previewContainer.innerHTML = `<span id="eventLogoPlaceholder" style="font-size:0.7rem; color:#94a3b8; text-align:center; padding:2px;">No Logo</span>`;
            }
            removeBtn.style.display = 'none';
            if (uploadBtn) uploadBtn.textContent = 'Upload PNG Logo';
            showToast("Logo removed from preview. Click 'Save Changes' to confirm.");
        };
    }

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

            if (previewContainer) {
                previewContainer.innerHTML = localConfig.eventLogo ? `<img id="eventLogoPreviewImg" src="${localConfig.eventLogo}" style="max-width:100%; max-height:100%; object-fit:contain;" />` : `<span id="eventLogoPlaceholder" style="font-size:0.7rem; color:#94a3b8; text-align:center; padding:2px;">No Logo</span>`;
            }
            if (removeBtn) removeBtn.style.display = localConfig.eventLogo ? 'inline-block' : 'none';
            if (uploadBtn) uploadBtn.textContent = localConfig.eventLogo ? 'Replace Logo' : 'Upload PNG Logo';

            showToast("Form reset to currently saved configuration!");
        };
    }

    // Management Settings Bindings
    const btnManageLimits = document.getElementById('btnManageLimits');
    if (btnManageLimits) {
        btnManageLimits.onclick = () => {
            openLimitsManageModal();
        };
    }

    const btnManagePoints = document.getElementById('btnManagePoints');
    if (btnManagePoints) {
        btnManagePoints.onclick = () => {
            openPointManageModal();
        };
    }

    const btnOpenDangerZone = document.getElementById('btnOpenDangerZone');
    if (btnOpenDangerZone) {
        btnOpenDangerZone.onclick = () => {
            openDangerZoneModal();
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
