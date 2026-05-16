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


