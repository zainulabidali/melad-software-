import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { initializeFirestore, memoryLocalCache, collection, getDocs, doc, writeBatch, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCWGvKjqytJZHfuSnJGwBrVrFV8koYV7Cw",
    authDomain: "melad-software.firebaseapp.com",
    projectId: "melad-software",
    storageBucket: "melad-software.firebasestorage.app",
    messagingSenderId: "902797740173",
    appId: "1:902797740173:web:f1f19921932708f07afac4",
    measurementId: "G-PJQ84BLY8E"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
    localCache: memoryLocalCache(),
    experimentalAutoDetectLongPolling: true
});

// ─────────────────────────────────────────────
// SCHEMA MIGRATION: Flatten nested categories/students to institute level
// ─────────────────────────────────────────────
export async function migrateToNewSchema(instituteId, onProgress = () => { }) {
    try {
        // Check if migration already done
        const statusRef = doc(db, "institutes", instituteId, "migrationStatus", "v2");
        const statusSnap = await getDoc(statusRef);
        if (statusSnap.exists() && statusSnap.data().completed) {
            console.log("Migration already completed for this institute");
            return { success: true, message: "Already migrated" };
        }

        onProgress("Starting migration...");

        const batch = writeBatch(db);
        let categoriesCount = 0;
        let studentsCount = 0;

        // Step 1: Migrate categories from teams/{teamId}/categories to institutes/{id}/categories
        onProgress("Migrating categories...");
        const teamsSnap = await getDocs(collection(db, "institutes", instituteId, "teams"));

        for (const teamDoc of teamsSnap.docs) {
            const teamId = teamDoc.id;
            const categoriesSnap = await getDocs(
                collection(db, "institutes", instituteId, "teams", teamId, "categories")
            );

            for (const catDoc of categoriesSnap.docs) {
                const catData = catDoc.data();
                const catName = catData.name || 'Unnamed Category';
                const normalizedCatId = catName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || catDoc.id;
                const newCatRef = doc(collection(db, "institutes", instituteId, "categories"), normalizedCatId);

                // Merge class arrays if category already exists
                let mergedClasses = [...new Set([...(catData.classes || [])])];
                const existingCatSnap = await getDoc(newCatRef);
                if (existingCatSnap.exists()) {
                    const existingClasses = existingCatSnap.data().classes || [];
                    mergedClasses = [...new Set([...existingClasses, ...mergedClasses])];
                }

                batch.set(newCatRef, {
                    ...catData,
                    name: catName,
                    classes: mergedClasses,
                    migratedFrom: `teams/${teamId}/categories/${catDoc.id}`,
                    migratedAt: new Date()
                }, { merge: true });

                categoriesCount++;

                // Step 2: Migrate students from teams/{teamId}/categories/{catId}/students to institutes/{id}/students
                onProgress(`Migrating students from ${catName}...`);
                const studentsSnap = await getDocs(
                    collection(db, "institutes", instituteId, "teams", teamId, "categories", catDoc.id, "students")
                );

                for (const stuDoc of studentsSnap.docs) {
                    const stuData = stuDoc.data();

                    // Create new student record with categoryId and classId
                    const newStuRef = doc(collection(db, "institutes", instituteId, "students"));
                    batch.set(newStuRef, {
                        ...stuData,
                        categoryId: normalizedCatId,
                        categoryName: catName,
                        classId: stuData.class || stuData.classId || "General",
                        teamId: teamId,
                        migratedFrom: `teams/${teamId}/categories/${catDoc.id}/students/${stuDoc.id}`,
                        migratedAt: new Date()
                    });

                    studentsCount++;
                }
            }
        }

        // Commit batch
        onProgress("Saving migrated data...");
        await batch.commit();

        // Mark migration as complete
        const completionRef = doc(db, "institutes", instituteId, "migrationStatus", "v2");
        await setDoc(completionRef, {
            completed: true,
            completedAt: new Date(),
            categoriesMigrated: categoriesCount,
            studentsMigrated: studentsCount,
            version: "2.0"
        });

        onProgress(`✅ Migration complete! ${categoriesCount} categories, ${studentsCount} students migrated.`);
        return {
            success: true,
            message: `Migration complete! ${categoriesCount} categories, ${studentsCount} students migrated.`,
            stats: { categoriesCount, studentsCount }
        };

    } catch (error) {
        console.error("Migration error:", error);
        onProgress(`❌ Migration failed: ${error.message}`);
        throw error;
    }
}

export async function updateDashboardMetadata(instituteId) {
    if (!instituteId) return;
    try {
        // Fetch collections in parallel using one-shot getDocs
        const [studentsSnap, teamsSnap, programsSnap, categoriesSnap, judgesSnap, resultsSnap] = await Promise.all([
            getDocs(collection(db, "institutes", instituteId, "students")),
            getDocs(collection(db, "institutes", instituteId, "teams")),
            getDocs(collection(db, "institutes", instituteId, "programs")),
            getDocs(collection(db, "institutes", instituteId, "categories")),
            getDocs(collection(db, "institutes", instituteId, "judges")),
            getDocs(collection(db, "institutes", instituteId, "results"))
        ]);

        const students = studentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const teams = teamsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const programs = programsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const categories = categoriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const judges = judgesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const results = resultsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const totalStudents = students.length;
        const maleCount = students.filter(s => s.gender && s.gender.toString().trim().toLowerCase() === 'male').length;
        const femaleCount = students.filter(s => s.gender && s.gender.toString().trim().toLowerCase() === 'female').length;
        const totalCompetitions = programs.length;
        const totalTeams = teams.length;
        const totalCategories = categories.length;
        const totalJudges = judges.length;

        const stagesSet = new Set(programs.map(p => p.programLocation).filter(Boolean));
        const totalStages = stagesSet.size;

        // 2. Real-time Live Team Leaderboard
        const teamPoints = new Map();
        teams.forEach(t => {
            if (t.name) teamPoints.set(t.name, 0);
        });

        results.forEach(r => {
            if (r.status === 'published') {
                const prog = programs.find(p => p.id === r.programId);
                if (prog && prog.leaderboardEnabled === false) return;

                if (Array.isArray(r.marksData) && r.marksData.length > 0) {
                    r.marksData.forEach(w => {
                        if (w.teamName && w.totalPoints > 0) {
                            const current = teamPoints.get(w.teamName) || 0;
                            teamPoints.set(w.teamName, current + (w.totalPoints || 0));
                        }
                    });
                } else if (Array.isArray(r.winners)) {
                    r.winners.forEach(w => {
                        if (w.teamName) {
                            const current = teamPoints.get(w.teamName) || 0;
                            teamPoints.set(w.teamName, current + (w.marks || 0));
                        }
                    });
                }
            }
        });

        const sortedTeams = [...teamPoints.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([name, points]) => ({ name, points }));

        // 3. Radar Chart (Participants By Team)
        const teamCounts = new Map();
        teams.forEach(t => {
            if (t.name) teamCounts.set(t.name, 0);
        });
        students.forEach(s => {
            if (s.teamId) {
                const team = teams.find(t => t.id === s.teamId);
                if (team && team.name) {
                    const current = teamCounts.get(team.name) || 0;
                    teamCounts.set(team.name, current + 1);
                }
            } else if (s.teamName) {
                const current = teamCounts.get(s.teamName) || 0;
                teamCounts.set(s.teamName, current + 1);
            }
        });

        const radarChartData = {
            labels: [...teamCounts.keys()],
            data: [...teamCounts.values()]
        };

        // 4. Bar Chart (Participants By Category)
        const catCounts = new Map();
        categories.forEach(c => {
            if (c.name) catCounts.set(c.name, 0);
        });
        students.forEach(s => {
            if (s.categoryId) {
                const cat = categories.find(c => c.id === s.categoryId);
                if (cat && cat.name) {
                    const current = catCounts.get(cat.name) || 0;
                    catCounts.set(cat.name, current + 1);
                }
            } else if (s.categoryName) {
                const current = catCounts.get(s.categoryName) || 0;
                catCounts.set(s.categoryName, current + 1);
            }
        });

        const barChartData = {
            labels: [...catCounts.keys()],
            data: [...catCounts.values()]
        };

        const publishedCount = results.filter(r => r.status === 'published').length;

        // Write metadata document
        const metaRef = doc(db, "institutes", instituteId, "metadata", "dashboard");
        await setDoc(metaRef, {
            studentsCount: totalStudents,
            maleStudentsCount: maleCount,
            femaleStudentsCount: femaleCount,
            programsCount: totalCompetitions,
            teamsCount: totalTeams,
            categoriesCount: totalCategories,
            judgesCount: totalJudges,
            stagesCount: totalStages,
            publishedResultsCount: publishedCount,
            leaderboard: sortedTeams,
            radarChartData: radarChartData,
            barChartData: barChartData,
            lastUpdated: new Date()
        });

        console.log("Dashboard metadata successfully updated!");
    } catch (e) {
        console.error("Error updating dashboard metadata:", e);
    }
}

export async function migrateParticipantCounts(instituteId) {
    if (!instituteId) return;
    try {
        const progSnap = await getDocs(collection(db, "institutes", instituteId, "programs"));
        const batch = writeBatch(db);

        for (const progDoc of progSnap.docs) {
            const progId = progDoc.id;
            const progData = progDoc.data();
            const pType = (progData.programType || progData.type || 'individual').toLowerCase();
            const regType = (pType === 'general') ? (progData.registrationType || 'individual') : pType;
            const isGroup = pType === 'group' || regType === 'group';

            const partSnap = await getDocs(collection(db, "institutes", instituteId, "programs", progId, "participants"));
            let count = 0;

            if (isGroup) {
                partSnap.forEach(d => {
                    const data = d.data();
                    if (data.type === 'group' && Array.isArray(data.groups)) {
                        count += data.groups.length;
                    }
                });
            } else {
                partSnap.forEach(d => {
                    if (d.data().type === 'individual') count++;
                });
            }

            batch.update(progDoc.ref, { participantCount: count });
        }

        await batch.commit();
        console.log("Migration complete: All participantCount fields successfully updated!");
    } catch (e) {
        console.error("Migration failed:", e);
    }
}

export async function migrateTeamMemberCounts(instituteId) {
    if (!instituteId) return;
    try {
        const teamsSnap = await getDocs(collection(db, "institutes", instituteId, "teams"));
        const studentsSnap = await getDocs(collection(db, "institutes", instituteId, "students"));
        const batch = writeBatch(db);

        const teamCounts = new Map();
        studentsSnap.forEach(s => {
            const data = s.data();
            if (data.teamId) {
                teamCounts.set(data.teamId, (teamCounts.get(data.teamId) || 0) + 1);
            }
        });

        teamsSnap.forEach(teamDoc => {
            const count = teamCounts.get(teamDoc.id) || 0;
            batch.update(teamDoc.ref, { memberCount: count });
        });

        await batch.commit();
        console.log("Migration complete: All team memberCount fields successfully updated!");
    } catch (e) {
        console.error("Team member counts migration failed:", e);
    }
}

const CACHE_TTL = 30 * 60 * 1000; // 30 minutes in milliseconds

function isCacheValid(cacheObj) {
    return cacheObj && cacheObj.data && cacheObj.lastFetched && (Date.now() - cacheObj.lastFetched < CACHE_TTL);
}

export function setCachedTeams(instituteId, data) {
    const key = `melad_cached_teams_${instituteId}`;
    const cacheObj = { data, lastFetched: Date.now() };
    window.cachedTeams = cacheObj;
    try {
        localStorage.setItem(key, JSON.stringify(cacheObj));
    } catch (e) {
        console.error("Failed to write teams cache to localStorage:", e);
    }
}

export function setCachedCategories(instituteId, data) {
    const key = `melad_cached_categories_${instituteId}`;
    const cacheObj = { data, lastFetched: Date.now() };
    window.cachedCategories = cacheObj;
    try {
        localStorage.setItem(key, JSON.stringify(cacheObj));
    } catch (e) {
        console.error("Failed to write categories cache to localStorage:", e);
    }
}

export function setCachedPrograms(instituteId, data) {
    const key = `melad_cached_programs_${instituteId}`;
    const cacheObj = { data, lastFetched: Date.now() };
    window.cachedPrograms = cacheObj;
    try {
        localStorage.setItem(key, JSON.stringify(cacheObj));
    } catch (e) {
        console.error("Failed to write programs cache to localStorage:", e);
    }
}

export function invalidateTeamsCache(instituteId) {
    window.cachedTeams = null;
    try {
        localStorage.removeItem(`melad_cached_teams_${instituteId}`);
    } catch (e) { }
}

export function invalidateCategoriesCache(instituteId) {
    window.cachedCategories = null;
    try {
        localStorage.removeItem(`melad_cached_categories_${instituteId}`);
    } catch (e) { }
}

export function invalidateProgramsCache(instituteId) {
    window.cachedPrograms = null;
    try {
        localStorage.removeItem(`melad_cached_programs_${instituteId}`);
    } catch (e) { }
}

export async function getCachedTeams(instituteId, forceRefresh = false) {
    const key = `melad_cached_teams_${instituteId}`;
    if (!forceRefresh) {
        if (isCacheValid(window.cachedTeams)) {
            return window.cachedTeams.data;
        }
        try {
            const local = localStorage.getItem(key);
            if (local) {
                const parsed = JSON.parse(local);
                if (isCacheValid(parsed)) {
                    window.cachedTeams = parsed;
                    return parsed.data;
                }
            }
        } catch (e) {
            console.error("Error loading teams cache from localStorage:", e);
        }
    }
    const snap = await getDocs(collection(db, "institutes", instituteId, "teams"));
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    setCachedTeams(instituteId, data);
    return data;
}

export async function getCachedCategories(instituteId, forceRefresh = false) {
    const key = `melad_cached_categories_${instituteId}`;
    if (!forceRefresh) {
        if (isCacheValid(window.cachedCategories)) {
            return window.cachedCategories.data;
        }
        try {
            const local = localStorage.getItem(key);
            if (local) {
                const parsed = JSON.parse(local);
                if (isCacheValid(parsed)) {
                    window.cachedCategories = parsed;
                    return parsed.data;
                }
            }
        } catch (e) {
            console.error("Error loading categories cache from localStorage:", e);
        }
    }
    const snap = await getDocs(collection(db, "institutes", instituteId, "categories"));
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    setCachedCategories(instituteId, data);
    return data;
}

export async function getCachedPrograms(instituteId, forceRefresh = false) {
    const key = `melad_cached_programs_${instituteId}`;
    if (!forceRefresh) {
        if (isCacheValid(window.cachedPrograms)) {
            return window.cachedPrograms.data;
        }
        try {
            const local = localStorage.getItem(key);
            if (local) {
                const parsed = JSON.parse(local);
                if (isCacheValid(parsed)) {
                    window.cachedPrograms = parsed;
                    return parsed.data;
                }
            }
        } catch (e) {
            console.error("Error loading programs cache from localStorage:", e);
        }
    }
    const snap = await getDocs(collection(db, "institutes", instituteId, "programs"));
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    setCachedPrograms(instituteId, data);
    return data;
}

// ─────────────────────────────────────────────
// CENTRALIZED DIALOGS AND ERROR HANDLING SYSTEM
// ─────────────────────────────────────────────

if (typeof document !== 'undefined') {
    const styleEl = document.createElement('style');
    styleEl.id = 'custom-dialog-styles';
    styleEl.innerHTML = `
        .custom-modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(15, 23, 42, 0.65);
            backdrop-filter: blur(6px);
            -webkit-backdrop-filter: blur(6px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 100000;
            opacity: 0;
            transition: opacity 0.2s ease;
        }
        .custom-modal-dialog {
            background: #ffffff;
            border-radius: 16px;
            padding: 1.75rem;
            width: 92%;
            max-width: 440px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.15), 0 0 1px rgba(0, 0, 0, 0.1);
            border: 1px solid #e2e8f0;
            transform: scale(0.95);
            transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
            color: #1e293b;
        }
        .custom-modal-header {
            display: flex;
            align-items: flex-start;
            gap: 1rem;
            margin-bottom: 1.5rem;
        }
        .custom-modal-icon {
            border-radius: 50%;
            width: 42px;
            height: 42px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            font-size: 1.35rem;
        }
        .custom-modal-title {
            margin: 0 0 0.35rem 0;
            font-size: 1.15rem;
            font-weight: 700;
            color: #0f172a;
            line-height: 1.3;
        }
        .custom-modal-message {
            margin: 0;
            font-size: 0.9rem;
            color: #475569;
            line-height: 1.5;
            white-space: pre-line;
        }
        .custom-modal-actions {
            display: flex;
            gap: 0.75rem;
            justify-content: flex-end;
        }
        .custom-dialog-btn {
            min-height: 38px;
            font-weight: 600;
            padding: 0.5rem 1.25rem;
            font-size: 0.875rem;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s ease;
            font-family: inherit;
        }
        .custom-dialog-btn-secondary {
            background: #f1f5f9;
            color: #475569;
            border: 1px solid #e2e8f0;
        }
        .custom-dialog-btn-secondary:hover {
            background: #e2e8f0;
            color: #1e293b;
        }
        .custom-dialog-btn-primary {
            background: #4f46e5;
            color: #ffffff;
            border: none;
        }
        .custom-dialog-btn-primary:hover {
            background: #4338ca;
            box-shadow: 0 4px 12px rgba(79, 70, 229, 0.25);
        }
        .custom-dialog-btn-danger {
            background: #dc2626;
            color: #ffffff;
            border: none;
        }
        .custom-dialog-btn-danger:hover {
            background: #b91c1c;
            box-shadow: 0 4px 12px rgba(220, 38, 38, 0.25);
        }
    `;
    document.head.appendChild(styleEl);
}

window.customConfirm = function (message, title = "Confirm Action", options = {}) {
    const danger = options.danger || false;
    const okText = options.okText || "Yes, Proceed";
    const cancelText = options.cancelText || "Cancel";
    const icon = options.icon || (danger ? "⚠️" : "❓");
    const iconBg = options.iconBg || (danger ? "rgba(239, 68, 68, 0.08)" : "rgba(79, 70, 229, 0.08)");
    const iconColor = options.iconColor || (danger ? "#ef4444" : "#4f46e5");
    const okBtnClass = danger ? "custom-dialog-btn-danger" : "custom-dialog-btn-primary";

    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'custom-modal-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'custom-modal-dialog';

        dialog.innerHTML = `
            <div class="custom-modal-header">
                <div class="custom-modal-icon" style="background: ${iconBg}; color: ${iconColor};">
                    ${icon}
                </div>
                <div>
                    <h3 class="custom-modal-title">${window.escapeHTML ? window.escapeHTML(title) : title}</h3>
                    <p class="custom-modal-message">${window.escapeHTML ? window.escapeHTML(message) : message}</p>
                </div>
            </div>
            <div class="custom-modal-actions">
                <button id="customConfirmCancelBtn" class="custom-dialog-btn custom-dialog-btn-secondary">${cancelText}</button>
                <button id="customConfirmOkBtn" class="custom-dialog-btn ${okBtnClass}">${okText}</button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        setTimeout(() => {
            overlay.style.opacity = '1';
            dialog.style.transform = 'scale(1)';
        }, 10);

        const close = (result) => {
            overlay.style.opacity = '0';
            dialog.style.transform = 'scale(0.95)';
            document.body.style.overflow = originalOverflow;
            setTimeout(() => {
                overlay.remove();
                resolve(result);
            }, 250);
        };

        overlay.querySelector('#customConfirmCancelBtn').onclick = () => close(false);
        overlay.querySelector('#customConfirmOkBtn').onclick = () => close(true);

        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                document.removeEventListener('keydown', handleKeyDown);
                close(false);
            }
        };
        document.addEventListener('keydown', handleKeyDown);
    });
};

window.customAlert = function (message, title = "Alert", options = {}) {
    const icon = options.icon || "ℹ️";
    const iconBg = options.iconBg || "rgba(79, 70, 229, 0.08)";
    const iconColor = options.iconColor || "#4f46e5";
    const buttonText = options.buttonText || "OK";

    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'custom-modal-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'custom-modal-dialog';

        dialog.innerHTML = `
            <div class="custom-modal-header">
                <div class="custom-modal-icon" style="background: ${iconBg}; color: ${iconColor};">
                    ${icon}
                </div>
                <div>
                    <h3 class="custom-modal-title">${window.escapeHTML ? window.escapeHTML(title) : title}</h3>
                    <p class="custom-modal-message">${window.escapeHTML ? window.escapeHTML(message) : message}</p>
                </div>
            </div>
            <div class="custom-modal-actions">
                <button id="customAlertOkBtn" class="custom-dialog-btn custom-dialog-btn-primary" style="width: 100%;">${buttonText}</button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        setTimeout(() => {
            overlay.style.opacity = '1';
            dialog.style.transform = 'scale(1)';
        }, 10);

        const close = () => {
            overlay.style.opacity = '0';
            dialog.style.transform = 'scale(0.95)';
            document.body.style.overflow = originalOverflow;
            setTimeout(() => {
                overlay.remove();
                resolve();
            }, 250);
        };

        overlay.querySelector('#customAlertOkBtn').onclick = () => close();

        const handleKeyDown = (e) => {
            if (e.key === 'Escape' || e.key === 'Enter') {
                document.removeEventListener('keydown', handleKeyDown);
                close();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
    });
};

window.customPrompt = function (message, defaultValue = "", title = "Input Required", options = {}) {
    const okText = options.okText || "Submit";
    const cancelText = options.cancelText || "Cancel";
    const icon = options.icon || "✏️";
    const iconBg = options.iconBg || "rgba(79, 70, 229, 0.08)";
    const iconColor = options.iconColor || "#4f46e5";
    const placeholder = options.placeholder || "Type here...";

    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'custom-modal-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'custom-modal-dialog';

        dialog.innerHTML = `
            <div class="custom-modal-header">
                <div class="custom-modal-icon" style="background: ${iconBg}; color: ${iconColor};">
                    ${icon}
                </div>
                <div style="flex: 1;">
                    <h3 class="custom-modal-title">${window.escapeHTML ? window.escapeHTML(title) : title}</h3>
                    <p class="custom-modal-message">${window.escapeHTML ? window.escapeHTML(message) : message}</p>
                    <input type="text" id="customPromptInput" class="form-input" value="${window.escapeHTML ? window.escapeHTML(defaultValue) : defaultValue}" placeholder="${window.escapeHTML ? window.escapeHTML(placeholder) : placeholder}" style="width: 100%; margin-top: 1rem; min-height: 38px; padding: 0.5rem 0.75rem; border: 1px solid #cbd5e1; border-radius: 8px; font-family: inherit; font-size: 0.875rem;" />
                </div>
            </div>
            <div class="custom-modal-actions">
                <button id="customPromptCancelBtn" class="custom-dialog-btn custom-dialog-btn-secondary">${cancelText}</button>
                <button id="customPromptOkBtn" class="custom-dialog-btn custom-dialog-btn-primary">${okText}</button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const inputEl = overlay.querySelector('#customPromptInput');
        inputEl.focus();
        if (defaultValue) {
            inputEl.setSelectionRange(0, defaultValue.length);
        }

        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        setTimeout(() => {
            overlay.style.opacity = '1';
            dialog.style.transform = 'scale(1)';
        }, 10);

        const close = (result) => {
            overlay.style.opacity = '0';
            dialog.style.transform = 'scale(0.95)';
            document.body.style.overflow = originalOverflow;
            setTimeout(() => {
                overlay.remove();
                resolve(result);
            }, 250);
        };

        overlay.querySelector('#customPromptCancelBtn').onclick = () => close(null);
        overlay.querySelector('#customPromptOkBtn').onclick = () => close(inputEl.value);

        inputEl.onkeydown = (e) => {
            if (e.key === 'Enter') {
                close(inputEl.value);
            }
        };

        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                document.removeEventListener('keydown', handleKeyDown);
                close(null);
            }
        };
        document.addEventListener('keydown', handleKeyDown);
    });
};

window.handleError = function (error, context = "operation") {
    console.error(`Error during ${context}:`, error);

    let friendlyMessage = "Something went wrong. Please try again.";
    let msg = (typeof error === 'string') ? error : (error?.message || '');

    if (error && error.code) {
        switch (error.code) {
            case 'permission-denied':
            case 'PERMISSION_DENIED':
                friendlyMessage = "You do not have permission to perform this action.";
                break;
            case 'unavailable':
                friendlyMessage = "Connection problem detected. Please try again.";
                break;
            case 'not-found':
                friendlyMessage = "The requested record could not be found.";
                break;
            case 'already-exists':
                friendlyMessage = "A record with these details already exists.";
                break;
        }
    } else if (msg) {
        if (msg === "unauthenticated") {
            friendlyMessage = "You must be logged in to perform this action.";
        } else if (msg === "deactivated") {
            friendlyMessage = "Your institute account has been deactivated. Please contact the administrator.";
        } else if (msg === "expired") {
            friendlyMessage = "Your institute subscription has expired. Please contact Super Admin.";
        } else if (msg === "permission-denied" || msg.includes("permission") || msg.includes("Permission") || msg.includes("insufficient")) {
            friendlyMessage = "You do not have permission to perform this action.";
        } else if (msg.includes("network") || msg.includes("Network")) {
            friendlyMessage = "Connection problem detected. Please try again.";
        } else if (context === "deleting student") {
            friendlyMessage = "Unable to delete student. Please try again.";
        }
    } else {
        if (context === "deleting student") {
            friendlyMessage = "Unable to delete student. Please try again.";
        }
    }

    window.customAlert(friendlyMessage, "Error Occurred", {
        icon: "⚠️",
        iconBg: "rgba(239, 68, 68, 0.08)",
        iconColor: "#ef4444",
        buttonText: "OK"
    });
};

// Centralized Dense Ranking Calculation
export function computeDenseRanking(items, getScoreFn, rankPropName = 'rank') {
    if (!Array.isArray(items) || items.length === 0) return items;

    // Sort descending strictly by score
    items.sort((a, b) => {
        const scoreA = getScoreFn(a) || 0;
        const scoreB = getScoreFn(b) || 0;
        return scoreB - scoreA;
    });

    let currentRank = 0;
    let prevScore = null;

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const score = getScoreFn(item);

        if (score !== prevScore) {
            currentRank++;
            prevScore = score;
        }
        item[rankPropName] = currentRank;
    }
    return items;
}




