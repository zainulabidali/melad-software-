import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, where, getDoc, doc } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyCWGvKjqytJZHfuSnJGwBrVrFV8koYV7Cw",
    authDomain: "melad-software.firebaseapp.com",
    projectId: "melad-software",
    storageBucket: "melad-software.firebasestorage.app",
    messagingSenderId: "902797740173",
    appId: "1:902797740173:web:f1f19921932708f07afac4"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function test() {
    try {
        const instId = "OTm8dyIxxhQ78KzKSqzI";
        
        console.log("Checking dashboard metadata...");
        const dashSnap = await getDoc(doc(db, "institutes", instId, "metadata", "dashboard"));
        if (dashSnap.exists()) {
            const data = dashSnap.data();
            console.log("dashboard exists: true");
            console.log("publicPublishedResultsCount:", data.publicPublishedResultsCount);
            console.log("publicPendingProgramsCount:", data.publicPendingProgramsCount);
            console.log("programsCount:", data.programsCount);
        } else {
            console.log("dashboard exists: false");
        }
        
        console.log("Fetching published results...");
        const resultsRef = collection(db, "institutes", instId, "results");
        const pubQuery = query(
            resultsRef, 
            where("status", "==", "published")
        );
        
        const snap = await getDocs(pubQuery);
        const allPublished = snap.docs.length;
        const publicReleased = snap.docs.filter(d => d.data().publicReleased === true).length;
        
        console.log("Status=published count:", allPublished);
        console.log("publicReleased=true count:", publicReleased);
        process.exit(0);
    } catch (e) {
        console.error("Error:", e.message);
        process.exit(1);
    }
}
test();
