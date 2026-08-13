const fs = require('fs');

async function run() {
    try {
        console.log("Fetching all institutes...");
        const res = await fetch('https://firestore.googleapis.com/v1/projects/melad-software/databases/(default)/documents/institutes?pageSize=500');
        const data = await res.json();
        
        const docs = data.documents || [];
        
        let report = {
            totalInstitutes: docs.length,
            expiredButActive: [],
            validButDeactivated: [],
            missingExpiryDate: [],
            invalidExpiryDate: [],
            duplicateIds: [],
            duplicateAdminUids: [],
            invalidStatuses: []
        };
        
        const now = new Date();
        const idSet = new Set();
        const uidSet = new Set();

        docs.forEach(doc => {
            const instId = doc.name.split('/').pop();
            const fields = doc.fields || {};
            
            const status = fields.status?.stringValue;
            const adminUid = fields.adminUid?.stringValue;
            const expiryDateObj = fields.expiryDate;
            
            // Check duplicates
            if (idSet.has(instId)) report.duplicateIds.push(instId);
            idSet.add(instId);
            
            if (adminUid) {
                if (uidSet.has(adminUid)) report.duplicateAdminUids.push(adminUid);
                uidSet.add(adminUid);
            }
            
            // Check status
            if (status !== 'active' && status !== 'deactivated') {
                report.invalidStatuses.push({ id: instId, status });
            }
            
            // Check expiry
            if (!expiryDateObj) {
                report.missingExpiryDate.push(instId);
            } else if (!expiryDateObj.timestampValue) {
                report.invalidExpiryDate.push({ id: instId, type: Object.keys(expiryDateObj)[0] });
            } else {
                const expiryTs = new Date(expiryDateObj.timestampValue);
                if (isNaN(expiryTs.getTime())) {
                    report.invalidExpiryDate.push({ id: instId, value: expiryDateObj.timestampValue });
                } else {
                    const isExpired = now.getTime() > expiryTs.getTime();
                    
                    if (isExpired && status === 'active') {
                        report.expiredButActive.push({ id: instId, expiry: expiryDateObj.timestampValue });
                    }
                    if (!isExpired && status === 'deactivated') {
                        report.validButDeactivated.push({ id: instId, expiry: expiryDateObj.timestampValue });
                    }
                }
            }
        });

        console.log("\n=== VALIDATION REPORT ===");
        console.log(JSON.stringify(report, null, 2));

    } catch (e) {
        console.error("Failed to run validation:", e);
    }
}

run();
