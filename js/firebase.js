// Firebase Config initialization
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { getFirestore, collection, getDocs, doc, writeBatch, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

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
export const db = getFirestore(app);

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

export async function getCachedTeams(instituteId, forceRefresh = false) {
    if (!window.cachedTeams) {
        window.cachedTeams = { data: null, lastFetched: null };
    }
    if (!forceRefresh && isCacheValid(window.cachedTeams)) {
        return window.cachedTeams.data;
    }
    const snap = await getDocs(collection(db, "institutes", instituteId, "teams"));
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    window.cachedTeams = { data, lastFetched: Date.now() };
    return data;
}

export async function getCachedCategories(instituteId, forceRefresh = false) {
    if (!window.cachedCategories) {
        window.cachedCategories = { data: null, lastFetched: null };
    }
    if (!forceRefresh && isCacheValid(window.cachedCategories)) {
        return window.cachedCategories.data;
    }
    const snap = await getDocs(collection(db, "institutes", instituteId, "categories"));
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    window.cachedCategories = { data, lastFetched: Date.now() };
    return data;
}

export async function getCachedPrograms(instituteId, forceRefresh = false) {
    if (!window.cachedPrograms) {
        window.cachedPrograms = { data: null, lastFetched: null };
    }
    if (!forceRefresh && isCacheValid(window.cachedPrograms)) {
        return window.cachedPrograms.data;
    }
    const snap = await getDocs(collection(db, "institutes", instituteId, "programs"));
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    window.cachedPrograms = { data, lastFetched: Date.now() };
    return data;
}


