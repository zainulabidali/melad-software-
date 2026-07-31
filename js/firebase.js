import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache, collection, getDocs, doc, writeBatch, setDoc, getDoc, getCountFromServer, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

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

let dbInstance;
try {
    dbInstance = initializeFirestore(app, {
        localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager()
        }),
        experimentalAutoDetectLongPolling: true
    });
} catch (e) {
    try {
        dbInstance = initializeFirestore(app, {
            localCache: persistentLocalCache(),
            experimentalAutoDetectLongPolling: true
        });
    } catch (e2) {
        dbInstance = initializeFirestore(app, {
            localCache: memoryLocalCache(),
            experimentalAutoDetectLongPolling: true
        });
    }
}
export const db = dbInstance;

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
        const [studentsSnap, teamsSnap, programsSnap, categoriesSnap, judgesSnap, resultsSnap, countSnap] = await Promise.all([
            getDocs(collection(db, "institutes", instituteId, "students")),
            getDocs(collection(db, "institutes", instituteId, "teams")),
            getDocs(collection(db, "institutes", instituteId, "programs")),
            getDocs(collection(db, "institutes", instituteId, "categories")),
            getDocs(collection(db, "institutes", instituteId, "judges")),
            getDocs(collection(db, "institutes", instituteId, "results")),
            getCountFromServer(collection(db, "institutes", instituteId, "students"))
        ]);

        const students = studentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const teams = teamsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const programs = programsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const categories = categoriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const judges = judgesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const results = resultsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const totalStudents = countSnap.data().count;
        const maleCount = students.filter(s => s.gender && s.gender.toString().trim().toLowerCase() === 'male').length;
        const femaleCount = students.filter(s => s.gender && s.gender.toString().trim().toLowerCase() === 'female').length;
        const totalCompetitions = programs.length;
        const totalTeams = teams.length;
        const totalCategories = categories.length;
        const totalJudges = judges.length;

        const stagesSet = new Set(programs.map(p => p.programLocation).filter(Boolean));
        const totalStages = stagesSet.size;

        const stageProgramCount = programs.filter(p => {
            const loc = (p.programLocation || p.location || '').trim().toLowerCase();
            return loc === 'stage';
        }).length;

        const offStageProgramCount = programs.filter(p => {
            const loc = (p.programLocation || p.location || '').trim().toLowerCase();
            return loc === 'off stage';
        }).length;

        const individualProgramCount = programs.filter(p => {
            const pType = (p.programType || p.type || 'individual').toLowerCase();
            return pType === 'individual';
        }).length;

        const groupProgramCount = programs.filter(p => {
            const pType = (p.programType || p.type || 'individual').toLowerCase();
            return pType === 'group';
        }).length;

        const generalProgramCount = programs.filter(p => {
            const pType = (p.programType || p.type || 'individual').toLowerCase();
            return pType === 'general';
        }).length;

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
                        if (w.teamId && w.teamId !== 'teamless' && w.teamName && w.teamName !== 'No Team' && w.totalPoints > 0) {
                            const current = teamPoints.get(w.teamName) || 0;
                            teamPoints.set(w.teamName, current + (w.totalPoints || 0));
                        }
                    });
                } else if (Array.isArray(r.winners)) {
                    r.winners.forEach(w => {
                        if (w.teamId && w.teamId !== 'teamless' && w.teamName && w.teamName !== 'No Team') {
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
            if (s.teamId && s.teamId !== 'teamless') {
                const team = teams.find(t => t.id === s.teamId);
                if (team && team.name) {
                    const current = teamCounts.get(team.name) || 0;
                    teamCounts.set(team.name, current + 1);
                }
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
            // Find category matching case-insensitively by ID or name
            const cat = categories.find(c => {
                const sCatId = s.categoryId ? s.categoryId.toString().toLowerCase().trim() : '';
                const sCatName = s.categoryName ? s.categoryName.toString().toLowerCase().trim() : '';
                const cId = c.id ? c.id.toString().toLowerCase().trim() : '';
                const cName = c.name ? c.name.toString().toLowerCase().trim() : '';
                
                return (sCatId && (cId === sCatId || cName === sCatId)) ||
                       (sCatName && (cId === sCatName || cName === sCatName));
            });
            
            const resolvedCatName = cat?.name || s.categoryName || 'General';
            
            // Match the resolved name case-insensitively to the initialized keys in catCounts to avoid duplicates
            let matchedKey = null;
            const targetLower = resolvedCatName.toLowerCase().trim();
            for (const key of catCounts.keys()) {
                if (key.toLowerCase().trim() === targetLower) {
                    matchedKey = key;
                    break;
                }
            }
            
            const finalKey = matchedKey || resolvedCatName.trim();
            if (finalKey) {
                const current = catCounts.get(finalKey) || 0;
                catCounts.set(finalKey, current + 1);
            }
        });


        const barChartData = {
            labels: [...catCounts.keys()],
            data: [...catCounts.values()]
        };

        const publishedCount = results.filter(r => r.status === 'published').length;

        // 5. Category Performance Aggregation
        const teamSet = new Set();
        teams.forEach(t => { if (t.name) teamSet.add(t.name); });
        const categoryMap = {};
        const processedProgramIds = new Set();

        results.forEach(r => {
            if (r.status !== 'published' || r.publicDisabled === true) return;
            const prog = programs.find(p => p.id === r.programId);
            if (prog && prog.leaderboardEnabled === false) return;

            const progKey = r.programId || r.id;
            if (processedProgramIds.has(progKey)) return;
            processedProgramIds.add(progKey);

            const catName = r.categoryName ? r.categoryName.trim() : '';
            if (!catName) return;

            if (!categoryMap[catName]) categoryMap[catName] = {};

            if (Array.isArray(r.marksData) && r.marksData.length > 0) {
                r.marksData.forEach(w => {
                    if (w.teamName && w.teamName !== 'No Team' && w.totalPoints > 0) {
                        const pts = Number(w.totalPoints || 0);
                        categoryMap[catName][w.teamName] = (categoryMap[catName][w.teamName] || 0) + pts;
                        teamSet.add(w.teamName);
                    }
                });
            } else if (Array.isArray(r.winners)) {
                r.winners.forEach(w => {
                    if (w.teamName && w.teamName !== 'No Team' && w.marks > 0) {
                        const pts = Number(w.marks || 0);
                        categoryMap[catName][w.teamName] = (categoryMap[catName][w.teamName] || 0) + pts;
                        teamSet.add(w.teamName);
                    }
                });
            }
        });

        const categoryNames = Object.keys(categoryMap);
        categoryNames.sort((a, b) => a.localeCompare(b));

        const categoryPerformance = categoryNames.map(catName => {
            const teamScoresObj = categoryMap[catName] || {};
            const teamList = Array.from(teamSet).map(name => ({
                name: name,
                points: teamScoresObj[name] || 0
            }));
            teamList.sort((a, b) => b.points - a.points);
            computeDenseRanking(teamList, t => t.points, 'rank');

            const maxPoints = Math.max(...teamList.map(t => t.points), 1);
            const processedTeams = teamList.map(t => ({
                ...t,
                pct: t.points > 0 ? Math.min(Math.round((t.points / maxPoints) * 100), 100) : 0
            }));

            return {
                categoryName: catName,
                teams: processedTeams
            };
        });

        // 6. Latest 4 Published Results
        const publishedResultsList = results.filter(r => r.status === 'published' && r.publicDisabled !== true);
        publishedResultsList.sort((a, b) => {
            const timeA = a.publishedAt?.seconds || a.updatedAt?.seconds || 0;
            const timeB = b.publishedAt?.seconds || b.updatedAt?.seconds || 0;
            return timeB - timeA;
        });

        const latestPublishedResults = publishedResultsList.slice(0, 4).map(r => {
            const prog = programs.find(p => p.id === r.programId);
            const progCode = r.programCode || prog?.code || r.programNumber || '';
            const progName = r.programName || prog?.name || 'Competition';
            const catName = r.categoryName || prog?.categoryName || '';

            let topWinnerName = '';
            let topTeamName = '';

            if (Array.isArray(r.marksData) && r.marksData.length > 0) {
                const sorted = [...r.marksData].sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0));
                if (sorted[0]) {
                    topWinnerName = sorted[0].studentName || 'Winner';
                    topTeamName = sorted[0].teamName || '';
                }
            } else if (Array.isArray(r.winners) && r.winners.length > 0) {
                const sorted = [...r.winners].sort((a, b) => (b.marks || 0) - (a.marks || 0));
                if (sorted[0]) {
                    topWinnerName = sorted[0].name || sorted[0].studentName || 'Winner';
                    topTeamName = sorted[0].teamName || '';
                }
            }

            return {
                id: r.id,
                programCode: progCode,
                programName: progName,
                categoryName: catName,
                winnerName: topWinnerName,
                winningTeam: topTeamName,
                publishedAt: r.publishedAt?.seconds ? r.publishedAt.seconds * 1000 : Date.now()
            };
        });

        // Write metadata document
        const metaRef = doc(db, "institutes", instituteId, "metadata", "dashboard");
        await setDoc(metaRef, {
            studentsCount: totalStudents,
            maleStudentsCount: maleCount,
            femaleStudentsCount: femaleCount,
            programsCount: totalCompetitions,
            stageProgramCount: stageProgramCount,
            offStageProgramCount: offStageProgramCount,
            individualProgramCount: individualProgramCount,
            groupProgramCount: groupProgramCount,
            generalProgramCount: generalProgramCount,
            teamsCount: totalTeams,
            categoriesCount: totalCategories,
            judgesCount: totalJudges,
            stagesCount: totalStages,
            publishedResultsCount: publishedCount,
            pendingProgramsCount: Math.max(0, totalCompetitions - publishedCount),
            overallProgressPct: totalCompetitions > 0 ? Math.round((publishedCount / totalCompetitions) * 100) : 0,
            leaderboard: sortedTeams,
            categoryPerformance: categoryPerformance,
            latestPublishedResults: latestPublishedResults,
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

const OVERVIEW_CACHE_TTL = 60 * 1000; // 60 seconds TTL

export function isOverviewCacheValid(cacheObj) {
    return cacheObj && cacheObj.data && cacheObj.lastFetched && (Date.now() - cacheObj.lastFetched < OVERVIEW_CACHE_TTL);
}

export function setCachedProgramOverview(instituteId, data) {
    const instId = instituteId || window.currentInstituteId;
    if (!instId) return;
    const key = `melad_cached_program_overview_${instId}`;
    const cacheObj = { data, lastFetched: Date.now() };
    window.cachedProgramOverview = cacheObj;
    try {
        localStorage.setItem(key, JSON.stringify(cacheObj));
    } catch (e) {
        console.error("Failed to write program overview cache to localStorage:", e);
    }
}

export function invalidateProgramOverviewCache(instituteId) {
    const instId = instituteId || window.currentInstituteId;
    window.cachedProgramOverview = null;
    try {
        if (instId) {
            localStorage.removeItem(`melad_cached_program_overview_${instId}`);
        }
    } catch (e) { }
}

export function getCachedProgramOverview(instituteId) {
    const instId = instituteId || window.currentInstituteId;
    if (!instId) return null;
    const key = `melad_cached_program_overview_${instId}`;

    if (isOverviewCacheValid(window.cachedProgramOverview)) {
        return window.cachedProgramOverview.data;
    }
    try {
        const local = localStorage.getItem(key);
        if (local) {
            const parsed = JSON.parse(local);
            if (isOverviewCacheValid(parsed)) {
                window.cachedProgramOverview = parsed;
                return parsed.data;
            }
        }
    } catch (e) {
        console.error("Error loading program overview cache from localStorage:", e);
    }
    return null;
}

export function invalidateTeamsCache(instituteId) {
    window.cachedTeams = null;
    try {
        localStorage.removeItem(`melad_cached_teams_${instituteId}`);
    } catch (e) { }
    invalidateProgramOverviewCache(instituteId);
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
    invalidateProgramOverviewCache(instituteId);
}

export async function getCachedTeams(instituteId, forceRefresh = false) {
    const instId = instituteId || window.currentInstituteId;
    const key = `melad_cached_teams_${instId}`;
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
    const snap = await getDocs(collection(db, "institutes", instId, "teams"));
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    setCachedTeams(instId, data);
    return data;
}

export async function getCachedCategories(instituteId, forceRefresh = false) {
    const instId = instituteId || window.currentInstituteId;
    const key = `melad_cached_categories_${instId}`;
    if (!forceRefresh) {
        if (isCacheValid(window.cachedCategories)) {
            return sortCategories(window.cachedCategories.data);
        }
        try {
            const local = localStorage.getItem(key);
            if (local) {
                const parsed = JSON.parse(local);
                if (isCacheValid(parsed)) {
                    window.cachedCategories = parsed;
                    return sortCategories(parsed.data);
                }
            }
        } catch (e) {
            console.error("Error loading categories cache from localStorage:", e);
        }
    }
    const snap = await getDocs(collection(db, "institutes", instId, "categories"));
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const sortedData = sortCategories(data);
    setCachedCategories(instId, sortedData);
    return sortedData;
}

export async function getCachedPrograms(instituteId, forceRefresh = false) {
    const instId = instituteId || window.currentInstituteId;
    const key = `melad_cached_programs_${instId}`;
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
    const snap = await getDocs(collection(db, "institutes", instId, "programs"));
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    setCachedPrograms(instId, data);
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

// Deterministic category sorting based on class structure
function getCategorySortStats(classes) {
    if (!Array.isArray(classes) || classes.length === 0) {
        return { min: 999, max: 999 };
    }
    const nums = [];
    classes.forEach(c => {
        const name = (typeof c === 'string' ? c : (c?.name || '')).trim();
        const nameLower = name.toLowerCase();
        const matches = nameLower.match(/\d+/g);
        if (matches) {
            matches.forEach(m => nums.push(parseInt(m, 10)));
        } else {
            if (nameLower.includes("play")) {
                nums.push(-4);
            } else if (nameLower.includes("nursery")) {
                nums.push(-3);
            } else if (nameLower.includes("lkg") || nameLower.includes("l.k.g")) {
                nums.push(-2);
            } else if (nameLower.includes("ukg") || nameLower.includes("u.k.g")) {
                nums.push(-1);
            } else {
                nums.push(999);
            }
        }
    });
    if (nums.length === 0) return { min: 999, max: 999 };
    return {
        min: Math.min(...nums),
        max: Math.max(...nums)
    };
}

export function sortCategories(categories) {
    if (!Array.isArray(categories)) return [];
    return [...categories].sort((a, b) => {
        const statsA = getCategorySortStats(a.classes);
        const statsB = getCategorySortStats(b.classes);
        if (statsA.min !== statsB.min) {
            return statsA.min - statsB.min;
        }
        if (statsA.max !== statsB.max) {
            return statsA.max - statsB.max;
        }
        const nameA = (a.name || '').toLowerCase();
        const nameB = (b.name || '').toLowerCase();
        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;
        return 0;
    });
}

// ─────────────────────────────────────────────
// Point Rules & Dynamic Grade Engine Config
// ─────────────────────────────────────────────
export const DEFAULT_GRADES = [
    { name: 'A+', minMark: 90, maxMark: 100, gradePoint: 5 },
    { name: 'A',  minMark: 80, maxMark: 89,  gradePoint: 4 },
    { name: 'B+', minMark: 70, maxMark: 79,  gradePoint: 3 },
    { name: 'B',  minMark: 60, maxMark: 69,  gradePoint: 2 },
    { name: 'C',  minMark: 50, maxMark: 59,  gradePoint: 1 }
];

export const DEFAULT_POINTS = {
    individual: {
        first: 10,
        second: 8,
        third: 6
    },
    group: {
        first: 10,
        second: 8,
        third: 6
    },
    general: {
        first: 10,
        second: 8,
        third: 6
    },
    grades: DEFAULT_GRADES
};

/**
 * Normalizes point configuration data loaded from Firestore or fallback.
 * Ensures `grades` property exists and is a valid, sorted array of grade objects.
 */
export function normalizePointsConfig(data) {
    if (!data || typeof data !== 'object') {
        return JSON.parse(JSON.stringify(DEFAULT_POINTS));
    }
    const config = { ...data };
    if (!config.individual) config.individual = { ...DEFAULT_POINTS.individual };
    if (!config.group) config.group = { ...DEFAULT_POINTS.group };
    if (!config.general) config.general = { ...DEFAULT_POINTS.general };

    if (!Array.isArray(config.grades) || config.grades.length === 0) {
        config.grades = JSON.parse(JSON.stringify(DEFAULT_GRADES));
    } else {
        // Clean and sanitize grade items
        config.grades = config.grades.map(g => ({
            name: String(g.name || '').trim(),
            minMark: Number(g.minMark),
            maxMark: Number(g.maxMark),
            gradePoint: Number(g.gradePoint || 0)
        })).filter(g => g.name !== '' && !isNaN(g.minMark) && !isNaN(g.maxMark));
    }

    // Keep grades sorted by minMark descending
    config.grades.sort((a, b) => b.minMark - a.minMark);
    return config;
}

/**
 * Validates a list of grade objects according to institutional grading rules.
 * Checks for range bounds (0-100), min <= max, non-overlapping mark ranges, and unique names.
 */
export function validateGradesConfig(gradesList) {
    if (!Array.isArray(gradesList) || gradesList.length === 0) {
        return { valid: false, message: "At least one grade definition is required." };
    }

    const seenNames = new Set();
    const sorted = [...gradesList].map(g => ({
        name: String(g.name || '').trim(),
        minMark: Number(g.minMark),
        maxMark: Number(g.maxMark),
        gradePoint: Number(g.gradePoint)
    }));

    for (let i = 0; i < sorted.length; i++) {
        const g = sorted[i];
        if (!g.name) {
            return { valid: false, message: `Grade row #${i + 1} has an empty grade name.` };
        }
        const lowerName = g.name.toLowerCase();
        if (seenNames.has(lowerName)) {
            return { valid: false, message: `Duplicate grade name "${g.name}" is not allowed.` };
        }
        seenNames.add(lowerName);

        if (isNaN(g.minMark) || g.minMark < 0 || g.minMark > 100) {
            return { valid: false, message: `Grade "${g.name}" minimum mark must be between 0 and 100.` };
        }
        if (isNaN(g.maxMark) || g.maxMark < 0 || g.maxMark > 100) {
            return { valid: false, message: `Grade "${g.name}" maximum mark must be between 0 and 100.` };
        }
        if (g.minMark > g.maxMark) {
            return { valid: false, message: `Grade "${g.name}" minimum mark (${g.minMark}) cannot be greater than maximum mark (${g.maxMark}).` };
        }
        if (isNaN(g.gradePoint) || g.gradePoint < 0) {
            return { valid: false, message: `Grade "${g.name}" grade point must be a valid non-negative number.` };
        }
    }

    // Check for range overlaps: two ranges [minA, maxA] and [minB, maxB] overlap if Math.max(minA, minB) <= Math.min(maxA, maxB)
    for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
            const a = sorted[i];
            const b = sorted[j];
            const overlapStart = Math.max(a.minMark, b.minMark);
            const overlapEnd = Math.min(a.maxMax || a.maxMark, b.maxMark);

            if (overlapStart <= overlapEnd) {
                return {
                    valid: false,
                    message: `Mark range for Grade "${a.name}" (${a.minMark}-${a.maxMark}) overlaps with Grade "${b.name}" (${b.minMark}-${b.maxMark}). Range overlapping is strictly forbidden.`
                };
            }
        }
    }

    return { valid: true };
}

/**
 * Dynamically computes Grade Name and Grade Points for a given score mark
 * based on the active institute's points configuration.
 */
export function getGradeAndPoints(score, pointsConfig = null, classType = 'individual') {
    if (score === null || score === undefined || score === '' || isNaN(Number(score))) {
        return { grade: '', points: 0 };
    }

    const numScore = Number(score);
    const config = normalizePointsConfig(pointsConfig);
    const gradesList = config.grades;

    const matched = gradesList.find(g => numScore >= g.minMark && numScore <= g.maxMark);
    if (matched) {
        return {
            grade: matched.name,
            points: Number(matched.gradePoint) || 0
        };
    }

    return { grade: '', points: 0 };
}

/**
 * Returns the grade points awarded for a given grade string (e.g. "A+", "A", "PASS")
 * based on the active points configuration.
 */
export function getGradePointsForGrade(gradeName, pointsConfig = null, classType = 'individual') {
    if (!gradeName || typeof gradeName !== 'string') return 0;
    const config = normalizePointsConfig(pointsConfig);
    const cleanGrade = gradeName.trim().toLowerCase();

    const matched = config.grades.find(g => g.name.toLowerCase() === cleanGrade);
    if (matched) {
        return Number(matched.gradePoint) || 0;
    }

    // Fallback for legacy database properties if any
    if (pointsConfig && pointsConfig[classType]) {
        const legacyMap = { 'a+': 'gradeAPlus', 'a': 'gradeA', 'b+': 'gradeBPlus', 'b': 'gradeB', 'c': 'gradeC' };
        const key = legacyMap[cleanGrade];
        if (key && pointsConfig[classType][key] !== undefined) {
            return Number(pointsConfig[classType][key]) || 0;
        }
    }

    return 0;
}

export async function getCachedPointsConfig(instituteId, forceRefresh = false) {
    const instId = instituteId || window.currentInstituteId;
    if (!instId) return normalizePointsConfig(DEFAULT_POINTS);
    const key = `melad_cached_points_${instId}`;
    if (!forceRefresh) {
        if (window.cachedPointsConfig && window.cachedPointsConfig.lastFetched && (Date.now() - window.cachedPointsConfig.lastFetched < 300000)) {
            return window.cachedPointsConfig.data;
        }
        try {
            const local = localStorage.getItem(key);
            if (local) {
                const parsed = JSON.parse(local);
                if (parsed && parsed.lastFetched && (Date.now() - parsed.lastFetched < 300000)) {
                    const normData = normalizePointsConfig(parsed.data);
                    window.cachedPointsConfig = { data: normData, lastFetched: parsed.lastFetched };
                    return normData;
                }
            }
        } catch (e) {
            console.error("Error loading points cache from localStorage:", e);
        }
    }
    try {
        const snap = await getDoc(doc(db, "institutes", instId, "metadata", "points"));
        const rawData = snap.exists() ? snap.data() : DEFAULT_POINTS;
        const normData = normalizePointsConfig(rawData);
        const cacheObj = { data: normData, lastFetched: Date.now() };
        window.cachedPointsConfig = cacheObj;
        localStorage.setItem(key, JSON.stringify(cacheObj));
        return normData;
    } catch (err) {
        console.warn("Network error loading points config from Firestore, attempting offline cache:", err);
        try {
            const local = localStorage.getItem(key);
            if (local) {
                const parsed = JSON.parse(local);
                if (parsed && parsed.data) {
                    const normData = normalizePointsConfig(parsed.data);
                    window.cachedPointsConfig = { data: normData, lastFetched: Date.now() };
                    return normData;
                }
            }
        } catch (e) {
            console.error("Error reading offline points cache:", e);
        }
        return normalizePointsConfig(DEFAULT_POINTS);
    }
}

export function invalidatePointsConfigCache(instituteId) {
    const instId = instituteId || window.currentInstituteId;
    if (!instId) return;
    window.cachedPointsConfig = null;
    localStorage.removeItem(`melad_cached_points_${instId}`);
}

if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
        if (e.key && e.key.startsWith('melad_cached_points_')) {
            window.cachedPointsConfig = null;
        }
    });
}

export async function recalculateAllResultsPoints(instituteId) {
    if (!instituteId) return 0;

    // 1. Fetch normalized points configuration
    const pointsConfig = await getCachedPointsConfig(instituteId, true);

    // 2. Fetch all programs
    const progsSnap = await getDocs(collection(db, "institutes", instituteId, "programs"));
    const programsMap = new Map(progsSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));

    // 3. Fetch all results
    const resultsSnap = await getDocs(collection(db, "institutes", instituteId, "results"));
    const results = resultsSnap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));

    let count = 0;
    let batch = writeBatch(db);
    let batchCount = 0;

    for (let i = 0; i < results.length; i++) {
        const res = results[i];
        const prog = programsMap.get(res.programId);
        if (!prog) continue;

        // Determine program class type: general, group, individual
        const pType = (prog.programType || prog.type || 'individual').toLowerCase();
        let classType = 'individual';
        if (pType === 'general') classType = 'general';
        else if (pType === 'group') classType = 'group';

        const config = pointsConfig[classType] || DEFAULT_POINTS[classType];

        const positionPointsMap = {
            'First': config.first !== undefined ? Number(config.first) : 10,
            'Second': config.second !== undefined ? Number(config.second) : 8,
            'Third': config.third !== undefined ? Number(config.third) : 6,
            'Participation': 0
        };

        let changed = false;

        // Recalculate marksData
        let updatedMarksData = [];
        if (Array.isArray(res.marksData)) {
            updatedMarksData = res.marksData.map(m => {
                const markVal = (m.mark !== undefined && m.mark !== null && m.mark !== '') ? m.mark
                    : ((m.finalMark !== undefined && m.finalMark !== null && m.finalMark !== '') ? m.finalMark : m.score);

                const dynamicAuto = getGradeAndPoints(markVal, pointsConfig, classType);

                const effectiveGrade = resolveEffectiveGrade({
                    automaticGrade: dynamicAuto.grade || m.grade,
                    adminManualGrade: m.adminManualGrade,
                    legacyManualGrade: m.manualGrade,
                    manualGrades: m.manualGrades,
                    judgeSubmissionStatus: res.judgeSubmissionStatus,
                    judgeIds: res.judgeIds,
                    pointsConfig: pointsConfig
                });

                const gp = getGradePointsForGrade(effectiveGrade, pointsConfig, classType);
                const pp = positionPointsMap[m.position] || 0;
                const totalPoints = gp + pp;

                if (m.grade !== effectiveGrade || m.gradePoints !== gp || m.positionPoints !== pp || m.totalPoints !== totalPoints) {
                    changed = true;
                }

                return {
                    ...m,
                    grade: effectiveGrade,
                    gradePoints: gp,
                    positionPoints: pp,
                    totalPoints: totalPoints
                };
            });
        }

        // Recalculate winners
        let updatedWinners = [];
        if (Array.isArray(res.winners)) {
            updatedWinners = res.winners.map(w => {
                const markVal = (w.marks !== undefined && w.marks !== null && w.marks !== '') ? w.marks : w.mark;
                const dynamicAuto = getGradeAndPoints(markVal, pointsConfig, classType);

                const effectiveGrade = resolveEffectiveGrade({
                    automaticGrade: dynamicAuto.grade || w.grade,
                    adminManualGrade: w.adminManualGrade,
                    legacyManualGrade: w.manualGrade,
                    manualGrades: w.manualGrades,
                    judgeSubmissionStatus: res.judgeSubmissionStatus,
                    judgeIds: res.judgeIds,
                    pointsConfig: pointsConfig
                });

                const gp = getGradePointsForGrade(effectiveGrade, pointsConfig, classType);
                const pp = positionPointsMap[w.position] || 0;
                const totalPoints = gp + pp;

                if (w.grade !== effectiveGrade || w.gradePoints !== gp || w.positionPoints !== pp || w.marks !== totalPoints) {
                    changed = true;
                }

                return {
                    ...w,
                    grade: effectiveGrade,
                    gradePoints: gp,
                    positionPoints: pp,
                    marks: totalPoints
                };
            });
        }

        if (changed) {
            batch.update(res.ref, {
                marksData: updatedMarksData,
                winners: updatedWinners,
                updatedAt: serverTimestamp()
            });
            batchCount++;
            count++;

            if (batchCount === 400) {
                await batch.commit();
                batch = writeBatch(db);
                batchCount = 0;
            }
        }
    }

    if (batchCount > 0) {
        await batch.commit();
    }

    return count;
}

// ─────────────────────────────────────────────
// Student Participation Limits Helpers
// ─────────────────────────────────────────────

export function classifyProgram(program) {
    if (!program) return null;
    const type = (program.programType || program.type || 'individual').toLowerCase();
    
    // 1. General Program (highest priority)
    if (type === 'general') {
        return 'general';
    }
    
    // 2. Group Program
    if (type === 'group') {
        return 'group';
    }
    
    // 3 & 4. Individual Programs
    if (type === 'individual') {
        const location = (program.programLocation || program.location || '').trim().toLowerCase();
        if (location === 'stage') {
            return 'individual_stage';
        } else if (location === 'off stage' || location === 'offstage' || location === 'off-stage') {
            return 'individual_off_stage';
        }
    }
    return null;
}

export function resolveEffectiveParticipationLimits(participationLimits, student) {
    if (!participationLimits || participationLimits.enabled !== true) {
        return {
            stageIndividual: null,
            offStageIndividual: null,
            generalPrograms: null,
            groupPrograms: null
        };
    }

    const defaults = participationLimits.defaults || {};
    const rules = participationLimits.rules || [];

    const resolveField = (fieldName) => {
        // 1. CATEGORY + GENDER RULE
        const catGenderRule = rules.find(r => 
            r.categoryId && r.categoryId === student.categoryId && 
            r.gender && r.gender === student.gender
        );
        if (catGenderRule && catGenderRule[fieldName] !== undefined && catGenderRule[fieldName] !== null && catGenderRule[fieldName] !== '') {
            return catGenderRule[fieldName];
        }

        // 2. CATEGORY-ONLY RULE
        const catOnlyRule = rules.find(r => 
            r.categoryId && r.categoryId === student.categoryId && 
            (!r.gender || r.gender === '')
        );
        if (catOnlyRule && catOnlyRule[fieldName] !== undefined && catOnlyRule[fieldName] !== null && catOnlyRule[fieldName] !== '') {
            return catOnlyRule[fieldName];
        }

        // 3. GENDER-ONLY RULE
        const genderOnlyRule = rules.find(r => 
            (!r.categoryId || r.categoryId === '') && 
            r.gender && r.gender === student.gender
        );
        if (genderOnlyRule && genderOnlyRule[fieldName] !== undefined && genderOnlyRule[fieldName] !== null && genderOnlyRule[fieldName] !== '') {
            return genderOnlyRule[fieldName];
        }

        // 4. GLOBAL DEFAULT RULE
        if (defaults[fieldName] !== undefined && defaults[fieldName] !== null && defaults[fieldName] !== '') {
            return defaults[fieldName];
        }

        // 5. UNLIMITED
        return null;
    };

    return {
        stageIndividual: resolveField('stageIndividual'),
        offStageIndividual: resolveField('offStageIndividual'),
        generalPrograms: resolveField('generalPrograms'),
        groupPrograms: resolveField('groupPrograms')
    };
}

export function checkStudentParticipationEligibility(
    student,
    program,
    participationLimits,
    studentRegistrationsMap, // Maps studentId -> Set of programIds
    allProgramsMap // Maps programId -> program data
) {
    if (!participationLimits || participationLimits.enabled !== true) {
        return { eligible: true };
    }

    const classification = classifyProgram(program);
    if (!classification) {
        return { eligible: true };
    }

    const effectiveLimits = resolveEffectiveParticipationLimits(participationLimits, student);
    let limitField = '';
    let label = '';
    if (classification === 'general') {
        limitField = 'generalPrograms';
        label = 'General';
    } else if (classification === 'group') {
        limitField = 'groupPrograms';
        label = 'Group';
    } else if (classification === 'individual_stage') {
        limitField = 'stageIndividual';
        label = 'Individual Stage';
    } else if (classification === 'individual_off_stage') {
        limitField = 'offStageIndividual';
        label = 'Individual Off Stage';
    }

    const limit = effectiveLimits[limitField];
    if (limit === null || limit === undefined || limit === '') {
        return { eligible: true };
    }

    const limitVal = parseInt(limit, 10);
    if (isNaN(limitVal)) {
        return { eligible: true };
    }

    const regProgramIds = studentRegistrationsMap.get(student.id) || new Set();

    // Already registered in this program is always allowed
    if (regProgramIds.has(program.id)) {
        return { eligible: true, alreadyRegistered: true };
    }

    // Count registrations under same classification
    let count = 0;
    for (const pId of regProgramIds) {
        const p = allProgramsMap.get(pId);
        if (p) {
            const cls = classifyProgram(p);
            if (cls === classification) {
                count++;
            }
        }
    }

    if (count >= limitVal) {
        return {
            eligible: false,
            count,
            limit: limitVal,
            label
        };
    }

    return {
        eligible: true,
        count,
        limit: limitVal,
        label
    };
}

export const GRADE_LEVEL_SCORE = {
    'A+': 5,
    'A': 4,
    'B+': 3,
    'B': 2,
    'C': 1
};
export const SCORE_TO_GRADE = {
    5: 'A+',
    4: 'A',
    3: 'B+',
    2: 'B',
    1: 'C'
};

export function isValidManualGrade(grade, pointsConfig = null) {
    if (!grade || typeof grade !== 'string') return false;
    const clean = grade.trim().toLowerCase();
    const config = normalizePointsConfig(pointsConfig);
    return config.grades.some(g => g.name.toLowerCase() === clean);
}

export function resolveEffectiveGrade({
    automaticGrade,
    adminManualGrade,
    legacyManualGrade,
    manualGrades,
    judgeSubmissionStatus,
    judgeIds,
    pointsConfig = null
}) {
    if (isValidManualGrade(adminManualGrade, pointsConfig)) {
        return adminManualGrade;
    }
    if (isValidManualGrade(legacyManualGrade, pointsConfig)) {
        return legacyManualGrade;
    }
    if (Array.isArray(manualGrades) && manualGrades.length > 0) {
        const validJudgeGrades = [];
        manualGrades.forEach((g, idx) => {
            if (isValidManualGrade(g, pointsConfig)) {
                let isSubmitted = true;
                if (Array.isArray(judgeIds) && judgeIds[idx]) {
                    const jid = judgeIds[idx];
                    const status = judgeSubmissionStatus ? judgeSubmissionStatus[jid] : null;
                    isSubmitted = (status === 'submitted' || status === true);
                }
                if (isSubmitted) {
                    validJudgeGrades.push(g);
                }
            }
        });
        if (validJudgeGrades.length > 0) {
            return aggregateManualGrades(validJudgeGrades, pointsConfig);
        }
    }
    return automaticGrade || '';
}

export function aggregateManualGrades(grades, pointsConfig = null) {
    if (!Array.isArray(grades) || grades.length === 0) return '';
    const pointsList = grades
        .map(g => getGradePointsForGrade(g, pointsConfig))
        .filter(p => p !== undefined && p !== null && !isNaN(p));
    if (pointsList.length === 0) return grades[0] || '';
    const avgPoint = pointsList.reduce((sum, val) => sum + val, 0) / pointsList.length;

    const config = normalizePointsConfig(pointsConfig);
    const gradesList = config.grades;

    let closest = gradesList[0];
    let minDiff = Infinity;
    for (const g of gradesList) {
        const diff = Math.abs(Number(g.gradePoint) - avgPoint);
        if (diff < minDiff) {
            minDiff = diff;
            closest = g;
        }
    }
    return closest ? closest.name : '';
}





